//! The network seam's macOS backend (#140, #309): a copy's connection over https to the one relay
//! it was given, the hello check, joining and forwarding; and its session, relay@1's repeat rule,
//! which the network seam's suite plays through its local test relay. It never reaches another
//! host and never moves to another relay on its own.

use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas_seams::network::{Frame as WireFrame, Transport, Wire};
use deep_canvas_seams::Backend;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName};
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use serde_json::Value;
use tungstenite::{Message, WebSocket};

use crate::wire;

pub const BACKEND: Backend = Backend {
    name: "network.macos",
    version: "1.0.0",
};

/// How long a copy waits to connect and for the relay's hello.
const OPEN: Duration = Duration::from_secs(10);

/// What a relay's hello allows per connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub frames_per_s: u64,
    pub frame_bytes: u64,
}

/// The host a relay URL names: `https://<host>[/...]` → `<host>`.
pub fn host(relay: &str) -> String {
    let rest = relay.strip_prefix("https://").unwrap_or(relay);
    rest.split('/').next().unwrap_or_default().to_string()
}

/// The hello check: a relay that names another protocol or digest, or no limits, is refused
/// before anything is sent, naming its host and what it answered.
pub fn check_hello(host: &str, hello: &Value) -> Result<Limits, String> {
    let protocol = hello["protocol"].as_str().unwrap_or("nothing");
    if protocol != wire::PROTOCOL {
        return Err(format!(
            "refused the relay {host}: its hello answered {protocol}, not {}",
            wire::PROTOCOL
        ));
    }
    let (digest, committed) = (hello["digest"].as_str().unwrap_or("none"), wire::digest());
    if digest != committed {
        return Err(format!(
            "refused the relay {host}: its hello answered relay@1 with the digest {digest}, not the committed {committed}"
        ));
    }
    let limit = |name: &str| hello["limits"][name].as_u64().filter(|n| *n > 0);
    match (limit("frames_per_s"), limit("frame_bytes")) {
        (Some(frames_per_s), Some(frame_bytes)) if frame_bytes > wire::HEADER as u64 => {
            Ok(Limits {
                frames_per_s,
                frame_bytes,
            })
        }
        _ => Err(format!(
            "refused the relay {host}: its hello names no usable limits"
        )),
    }
}

/// What arrived on a connection.
pub enum Event {
    /// A control message.
    Control(Value),
    /// A frame another copy of the match sent.
    Frame(Vec<u8>),
}

/// A copy's connection to its relay: a WebSocket over https.
pub struct Connection {
    ws: WebSocket<StreamOwned<ClientConnection, TcpStream>>,
    pub host: String,
}

impl Connection {
    /// Connects to the relay `relay` names, trusting the PEM authorities `ca`, and reads its hello.
    pub fn open(relay: &str, ca: &[u8]) -> Result<(Connection, Value), String> {
        let host = host(relay);
        let fail = |what: String| format!("the relay {host} {what}");
        let mut roots = RootCertStore::empty();
        for cert in CertificateDer::pem_slice_iter(ca) {
            let cert = cert.map_err(|e| format!("the authority for {host} can't be read: {e}"))?;
            roots
                .add(cert)
                .map_err(|e| format!("the authority for {host}: {e}"))?;
        }
        let config =
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .map_err(|e| e.to_string())?
                .with_root_certificates(roots)
                .with_no_client_auth();
        let name = host.rsplit_once(':').map_or(host.as_str(), |(n, _)| n);
        let server = ServerName::try_from(name.to_string())
            .map_err(|e| fail(format!("isn't a host name: {e}")))?;
        let addr: SocketAddr = host
            .to_socket_addrs()
            .map_err(|e| fail(format!("can't be resolved: {e}")))?
            .next()
            .ok_or_else(|| fail("resolves to no address".into()))?;
        let tcp = TcpStream::connect_timeout(&addr, OPEN)
            .map_err(|e| fail(format!("is unreachable: {e}")))?;
        tcp.set_read_timeout(Some(OPEN))
            .map_err(|e| e.to_string())?;
        tcp.set_nodelay(true).map_err(|e| e.to_string())?;
        let tls = ClientConnection::new(Arc::new(config), server).map_err(|e| e.to_string())?;
        let (ws, _) = tungstenite::client(format!("wss://{host}/"), StreamOwned::new(tls, tcp))
            .map_err(|e| fail(format!("refused the https connection: {e}")))?;
        let mut conn = Connection { ws, host };
        match conn.next(OPEN)? {
            Some(Event::Control(hello)) if hello.get("hello").is_some() => {
                Ok((conn, hello["hello"].clone()))
            }
            _ => Err(conn.fail("sent no hello")),
        }
    }

    fn fail(&self, what: impl std::fmt::Display) -> String {
        format!("the relay {} {what}", self.host)
    }

    pub fn send_control(&mut self, message: &Value) -> Result<(), String> {
        let sent = self.ws.send(Message::text(message.to_string()));
        sent.map_err(|e| self.fail(format!("dropped the connection: {e}")))
    }

    pub fn send_frame(&mut self, frame: Vec<u8>) -> Result<(), String> {
        let sent = self.ws.send(Message::binary(frame));
        sent.map_err(|e| self.fail(format!("dropped the connection: {e}")))
    }

    /// The next message within `wait`, or None.
    pub fn next(&mut self, wait: Duration) -> Result<Option<Event>, String> {
        let wait = wait.max(Duration::from_millis(1));
        self.ws
            .get_ref()
            .sock
            .set_read_timeout(Some(wait))
            .map_err(|e| e.to_string())?;
        let until = Instant::now() + wait;
        loop {
            match self.ws.read() {
                Ok(Message::Text(text)) => {
                    let value = serde_json::from_str(&text)
                        .map_err(|e| self.fail(format!("sent a message that isn't JSON: {e}")))?;
                    return Ok(Some(Event::Control(value)));
                }
                Ok(Message::Binary(bytes)) => return Ok(Some(Event::Frame(bytes.to_vec()))),
                Ok(Message::Close(_)) => return Err(self.fail("closed the connection")),
                Ok(_) => {}
                Err(tungstenite::Error::Io(e))
                    if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
                {
                    if Instant::now() >= until {
                        return Ok(None);
                    }
                }
                Err(e) => return Err(self.fail(format!("dropped the connection: {e}"))),
            }
        }
    }

    /// Leaves: sends the close and waits for the relay's, by which time it has let the seat go.
    pub fn close(mut self) {
        let _ = self.ws.close(None);
        let _ = self.ws.get_ref().sock.set_read_timeout(Some(OPEN));
        while self.ws.read().is_ok() {}
    }
}

/// The macOS backend's session as the network seam's suite plays it: each frame repeats this copy's
/// steps from the lowest one its peer confirmed and carries its own `confirmed`, so a frame the
/// relay drops is recovered from the next one; steps that arrive early wait, and a step already
/// handed on is never handed on again. On the seam's wire a relay@1 frame's steps travel as `Data`
/// (each step and its message) and its `confirmed` as `Ack`.
#[derive(Default)]
pub struct Session {
    next: u64,
    /// Steps sent and not yet confirmed by the peer: step → message.
    unconfirmed: BTreeMap<u64, u64>,
    /// The lowest step this copy holds every message for: everything before it was handed on.
    confirmed: u64,
    early: BTreeMap<u64, u64>,
    owe_confirm: bool,
}

/// Steps one frame repeats at most, well inside the shipped relay's frame_bytes.
const STEPS_PER_FRAME: usize = 1024;

impl Transport for Session {
    fn backend(&self) -> Backend {
        BACKEND
    }

    fn connect(&mut self, wire: &mut dyn Wire, relay: &str) {
        wire.connect(relay);
    }

    fn join(&mut self, wire: &mut dyn Wire) {
        wire.send(WireFrame::Join);
    }

    fn send(&mut self, id: u64) {
        self.unconfirmed.insert(self.next, id);
        self.next += 1;
    }

    fn step(&mut self, wire: &mut dyn Wire) -> Vec<u64> {
        for frame in wire.receive() {
            match frame {
                WireFrame::Join => {}
                WireFrame::Data(steps) => {
                    for (step, id) in steps {
                        if step >= self.confirmed {
                            self.early.entry(step).or_insert(id);
                        }
                    }
                    self.owe_confirm = true;
                }
                WireFrame::Ack(confirmed) => {
                    self.unconfirmed = self.unconfirmed.split_off(&confirmed)
                }
            }
        }
        let mut arrived = Vec::new();
        while let Some(id) = self.early.remove(&self.confirmed) {
            arrived.push(id);
            self.confirmed += 1;
        }
        let repeat: Vec<(u64, u64)> = self
            .unconfirmed
            .iter()
            .take(STEPS_PER_FRAME)
            .map(|(s, id)| (*s, *id))
            .collect();
        if !repeat.is_empty() {
            wire.send(WireFrame::Data(repeat));
        }
        if self.owe_confirm {
            wire.send(WireFrame::Ack(self.confirmed));
            self.owe_confirm = false;
        }
        arrived
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas_seams::network::suite;

    #[test]
    fn the_session_passes_the_network_seams_suite() {
        let r = suite(10_000, 2, &mut || Box::new(Session::default()));
        assert_eq!(r.faults, Vec::<&str>::new());
        assert_eq!(r.delivered, r.sent);
    }

    #[test]
    fn the_hello_check_names_the_host_and_what_it_answered() {
        let limits = serde_json::json!({"frames_per_s": 240, "frame_bytes": 65536});
        let other =
            serde_json::json!({"protocol": "relay@2", "digest": wire::digest(), "limits": limits});
        let why = check_hello("127.0.0.1:9", &other).unwrap_err();
        assert!(
            why.contains("127.0.0.1:9") && why.contains("relay@2"),
            "{why}"
        );
        let digest = format!("d1:{}", "0".repeat(64));
        let other = serde_json::json!({"protocol": "relay@1", "digest": digest, "limits": limits});
        assert!(check_hello("h:1", &other).unwrap_err().contains(&digest));
        let good =
            serde_json::json!({"protocol": "relay@1", "digest": wire::digest(), "limits": limits});
        assert!(check_hello("h:1", &good).is_ok());
    }
}
