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

/// Whether sounds play (#1998): `sounds` in config.json, on unless it says false. You change it in the box's words.
pub fn sounds_on() -> bool {
    std::fs::read_to_string(root().join("config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|config| config.get("sounds")?.as_bool())
        .unwrap_or(true)
}

/// The hub's address: the setting's, or the installed hub's socket.
pub fn address() -> PathBuf {
    configured_address().unwrap_or_else(|| root().join("hub.sock"))
}

/// The hub contract the app speaks, "major.minor" (#41): the hub's `CONTRACT` in packages/hub/src/wire.ts.
pub const CONTRACT: &str = "1.0";
/// Every hub method the app calls besides the record's reads, which only the one reader names (#326).
const CALLS: &[&str] = &[
    "notifications.report",
    "views.shown",
    "views.hidden",
    "row.read",
    "canvas.drawn",
    "canvas.user",
    "find.read",
];

/// Every hub method the app calls (#41), which the hub's hello must list (`FEATURES` in packages/hub/src/wire.ts): the
/// one reader's reads, then the rest.
pub fn needs() -> Vec<&'static str> {
    crate::record::READS.iter().chain(CALLS).copied().collect()
}
const HUB_FIX: &str =
    "Update DeepBuild so the hub matches this app, then restart it with `deep setup`.";
const CLIENT_FIX: &str = "Update this app or CLI to the version that matches the running hub.";

/// The one screen the app shows instead of calling, when the hub's hello doesn't cover what the app calls: which side
/// is older and the one step that fixes it, as packages/hub/src/compat.ts words it. `None` when the hello covers it.
#[cfg(not(feature = "plant-calls-unlisted"))]
pub fn older(hello: &Value) -> Option<String> {
    let parts = |contract: &str| {
        let mut parts = contract
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0));
        (parts.next().unwrap_or(0), parts.next().unwrap_or(0))
    };
    let need = parts(CONTRACT);
    let contract = hello.get("contract").and_then(Value::as_str);
    let listed = |method: &&str| {
        hello
            .get("features")
            .and_then(Value::as_array)
            .is_some_and(|features| features.iter().any(|f| f.as_str() == Some(method)))
    };
    let missing: Vec<&str> = needs().into_iter().filter(|m| !listed(m)).collect();
    match contract.map(parts) {
        Some(have) if have.0 > need.0 => Some(format!(
            "This app is older than the hub: it speaks contract {CONTRACT} and the hub speaks {}.\n{CLIENT_FIX}",
            contract.unwrap_or_default()
        )),
        Some(have) if have >= need && missing.is_empty() => None,
        Some(have) if have >= need => Some(format!(
            "The hub is older than this app: it does not list {}.\n{HUB_FIX}",
            missing.join(", ")
        )),
        _ => Some(format!(
            "The hub is older than this app: it speaks contract {} and this app needs {CONTRACT}.\n{HUB_FIX}",
            contract.unwrap_or("none")
        )),
    }
}

/// The planted app (#41, in no shipped build): every hello covers it, so it calls without checking.
#[cfg(feature = "plant-calls-unlisted")]
pub fn older(_: &Value) -> Option<String> {
    None
}

/// A refusal the hub wrote, as error@2 gives it, or a hub older than the app, with the screen it shows instead.
#[derive(Debug)]
pub enum HubError {
    Io(io::Error),
    Protocol(String),
    Refused(Value),
    Older(String),
}

impl From<io::Error> for HubError {
    fn from(error: io::Error) -> Self {
        HubError::Io(error)
    }
}

/// What a refusal says, in the hub's own words where it gave some.
pub fn why(error: &HubError) -> String {
    match error {
        HubError::Refused(refusal) => refusal["message"]
            .as_str()
            .map_or_else(|| refusal.to_string(), str::to_owned),
        other => format!("{other:?}"),
    }
}

/// Issue #1462: a replica's own copy of the hub, which takes every call the app makes of it in place of a socket.
pub type Local = std::sync::Arc<dyn Fn(&str, &Value) -> Result<Value, HubError> + Send + Sync>;

static LOCAL: std::sync::Mutex<Option<Local>> = std::sync::Mutex::new(None);

/// Sends the app's calls to `local` from now on: the replica's door, in no shipped build.
#[cfg(feature = "fixtures")]
pub fn set_local(local: Option<Local>) {
    *LOCAL.lock().unwrap_or_else(|e| e.into_inner()) = local;
}

/// The replica's copy of the hub, when one takes the app's calls.
pub fn local() -> Option<Local> {
    LOCAL.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// One call the app makes of its hub on a connection of its own: a write a control asks for. Blocks, so a view runs
/// it off the main thread.
pub fn call_app(method: &str, params: Value) -> Result<Value, HubError> {
    match local() {
        Some(local) => local(method, &params),
        None => HubClient::app()?.call(method, params),
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

    /// Whether the hub's hello covers every method the app calls (#41); otherwise the screen it shows, before any call.
    pub fn covers_app(&self) -> Result<(), HubError> {
        older(&self.hello).map_or(Ok(()), |screen| Err(HubError::Older(screen)))
    }

    /// A connection of its own to the hub at its address, as the app.
    pub fn app() -> Result<Self, HubError> {
        let token = std::fs::read_to_string(root().join("control.token"))?;
        let mut client = HubClient::connect(&address())?;
        client.hello_app(token.trim())?;
        Ok(client)
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
