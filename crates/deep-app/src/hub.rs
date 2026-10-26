//! The app's client for the hub's socket (#16): it takes the hub's address from the one setting every client
//! reads (`hub.address` in ~/.deepbuild/config.json, `unix:<path>`; absent, ~/.deepbuild/hub.sock), presents
//! the control token as the app, and calls the hub's methods. Every line both ways is one JSON object with `v`.

use std::collections::VecDeque;
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
    /// Lines that came while a call waited for its reply, such as stream frames, in the order they came.
    pending: VecDeque<Value>,
    /// What a read that timed out had of its line so far.
    partial: String,
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
            pending: VecDeque::new(),
            partial: String::new(),
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
        self.read_within(Duration::from_secs(10))?
            .ok_or_else(|| HubError::Io(io::ErrorKind::TimedOut.into()))
    }

    /// The next line within `timeout`, or None when none came; a line cut by the timeout is kept for the next read.
    fn read_within(&mut self, timeout: Duration) -> Result<Option<Value>, HubError> {
        self.writer
            .set_read_timeout(Some(timeout.max(Duration::from_millis(1))))?;
        match self.reader.read_line(&mut self.partial) {
            Ok(0) => return Err(HubError::Protocol("the hub closed the connection".into())),
            Ok(_) => {}
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(None)
            }
            Err(e) => return Err(e.into()),
        }
        let line = std::mem::take(&mut self.partial);
        let value: Value = serde_json::from_str(line.trim_end())
            .map_err(|e| HubError::Protocol(format!("{e}: {line}")))?;
        if value.get("v").and_then(Value::as_u64) != Some(1) {
            return Err(HubError::Protocol(format!("a line without v: 1: {line}")));
        }
        Ok(Some(value))
    }

    /// The next line that answered no call, such as a stream frame, within `timeout`.
    pub fn next(&mut self, timeout: Duration) -> Result<Option<Value>, HubError> {
        match self.pending.pop_front() {
            Some(line) => Ok(Some(line)),
            None => self.read_within(timeout),
        }
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
                self.pending.push_back(line);
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
