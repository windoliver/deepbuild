//! The app's client for the hub's socket (#16): it takes the hub's address from the one setting every client
//! reads (`hub.address` in ~/.deepbuild/config.json, `unix:<path>`; absent, ~/.deepbuild/hub.sock), presents
//! the control token as the app, and calls the hub's methods. Every line both ways is one JSON object with `v`.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

/// The installed hub's root: ~/.deepbuild.
pub fn root() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".deepbuild")
}

/// The configured address, if the setting names one.
pub fn configured_address() -> Option<PathBuf> {
    let text = std::fs::read_to_string(root().join("config.json")).ok()?;
    let config: Value = serde_json::from_str(&text).ok()?;
    let address = config.get("hub")?.get("address")?.as_str()?;
    address.strip_prefix("unix:").map(PathBuf::from)
}

/// The hub's address: the setting's, or the installed hub's socket.
pub fn address() -> PathBuf {
    configured_address().unwrap_or_else(|| root().join("hub.sock"))
}

/// A refusal the hub wrote, as error@2 gives it.
#[derive(Debug)]
pub enum HubError {
    Io(io::Error),
    Protocol(String),
    Refused(Value),
}

impl From<io::Error> for HubError {
    fn from(error: io::Error) -> Self {
        HubError::Io(error)
    }
}

/// One connection to the hub, after its hello.
pub struct HubClient {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    /// The hub's hello: its start ID and the features it lists.
    pub hello: Value,
    ids: u64,
}

impl HubClient {
    pub fn connect(path: &Path) -> Result<Self, HubError> {
        let stream = UnixStream::connect(path)?;
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        let writer = stream.try_clone()?;
        let mut client = HubClient {
            reader: BufReader::new(stream),
            writer,
            hello: Value::Null,
            ids: 0,
        };
        client.hello = client.read()?;
        if client.hello.get("hello").and_then(Value::as_str) != Some("deep-hub") {
            return Err(HubError::Protocol(format!(
                "not a hub's hello: {}",
                client.hello
            )));
        }
        Ok(client)
    }

    fn read(&mut self) -> Result<Value, HubError> {
        let mut line = String::new();
        if self.reader.read_line(&mut line)? == 0 {
            return Err(HubError::Protocol("the hub closed the connection".into()));
        }
        let value: Value = serde_json::from_str(line.trim_end())
            .map_err(|e| HubError::Protocol(format!("{e}: {line}")))?;
        if value.get("v").and_then(Value::as_u64) != Some(1) {
            return Err(HubError::Protocol(format!("a line without v: 1: {line}")));
        }
        Ok(value)
    }

    fn send(&mut self, message: Value) -> Result<(), HubError> {
        let mut line =
            serde_json::to_string(&message).map_err(|e| HubError::Protocol(e.to_string()))?;
        line.push('\n');
        self.writer.write_all(line.as_bytes())?;
        Ok(())
    }

    /// Presents the control token as the app; the hub answers with the role it took.
    pub fn hello_app(&mut self, token: &str) -> Result<(), HubError> {
        self.send(json!({ "v": 1, "hello": "app", "token": token }))?;
        let reply = self.read()?;
        match reply.get("role").and_then(Value::as_str) {
            Some("app") => Ok(()),
            _ => Err(reply
                .get("error")
                .cloned()
                .map(HubError::Refused)
                .unwrap_or_else(|| HubError::Protocol(reply.to_string()))),
        }
    }

    /// One method call: its result, or the hub's refusal.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, HubError> {
        self.ids += 1;
        let id = format!("app#{}", self.ids);
        self.send(json!({ "v": 1, "id": id, "method": method, "params": params }))?;
        loop {
            let line = self.read()?;
            if line.get("id").and_then(Value::as_str) != Some(id.as_str()) {
                continue;
            }
            if let Some(error) = line.get("error") {
                return Err(HubError::Refused(error.clone()));
            }
            return line
                .get("result")
                .cloned()
                .ok_or_else(|| HubError::Protocol(line.to_string()));
        }
    }
}
