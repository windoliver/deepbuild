//! A project's hub on another machine (#1338). A clone of a project this machine joined (`deep join`) sends its hooks
//! to that project's hub over TLS 1.3: the hub must prove the key its ID names before anything is sent, and this
//! machine proves the key its credential is bound to. The route has its own deadlines, declared with their measured
//! overhead in the adapter facts (`routes.network`), and the fast rules stay local, so a slow or cut link never weakens a
//! guard. Every hub's hello names its writer generation: a hub below the highest this machine has seen of it is a copy
//! left behind, and nothing is sent to it.

use std::fs;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_contracts::{parse, Value};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned};

/// The network route's fail-open time from the hook's start: `routes.network.failOpenMs` in the adapter facts.
pub const FAIL_OPEN: Duration = Duration::from_millis(1500);

/// A joined project's hub: its ID (the SHA-256 of its certificate), where it is reached, and this machine's credential.
pub struct Remote {
    pub hub: String,
    address: String,
    token: String,
}

/// A stream whose reads can be held to a deadline.
pub trait Timed: Read {
    fn read_timeout(&self, t: Option<Duration>) -> io::Result<()>;
}
impl Timed for UnixStream {
    fn read_timeout(&self, t: Option<Duration>) -> io::Result<()> {
        self.set_read_timeout(t)
    }
}
impl Timed for Stream {
    fn read_timeout(&self, t: Option<Duration>) -> io::Result<()> {
        self.set_read_timeout(t)
    }
}

/// The connection a hook speaks over: the hub's socket, or a joined hub's TLS connection.
pub enum Stream {
    Unix(UnixStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}
impl Stream {
    fn tcp(&self) -> Option<&TcpStream> {
        match self {
            Stream::Tls(s) => Some(s.get_ref()),
            Stream::Unix(_) => None,
        }
    }
    pub fn set_read_timeout(&self, t: Option<Duration>) -> io::Result<()> {
        match self {
            Stream::Unix(s) => s.set_read_timeout(t),
            _ => self.tcp().map_or(Ok(()), |s| s.set_read_timeout(t)),
        }
    }
    pub fn set_write_timeout(&self, t: Option<Duration>) -> io::Result<()> {
        match self {
            Stream::Unix(s) => s.set_write_timeout(t),
            _ => self.tcp().map_or(Ok(()), |s| s.set_write_timeout(t)),
        }
    }
}
impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Stream::Unix(s) => s.read(buf),
            Stream::Tls(s) => s.read(buf),
        }
    }
}
impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Stream::Unix(s) => s.write(buf),
            Stream::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Stream::Unix(s) => s.flush(),
            Stream::Tls(s) => s.flush(),
        }
    }
}

fn member<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}
fn text(value: &Value, key: &str) -> Option<String> {
    match member(value, key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// A repo URL's forge identity, `host/owner/name` in lower case, as the hub reads it (paths.ts forgeIdentity).
fn forge_identity(url: &str) -> Option<String> {
    let mut rest = url.trim();
    if let Some(at) = rest.find("://") {
        if rest[..at]
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == '+')
            && at > 0
        {
            rest = &rest[at + 3..];
        }
    }
    if let Some(at) = rest.find('@') {
        if !rest[..at].contains(['/', ' ']) && at > 0 {
            rest = &rest[at + 1..];
        }
    }
    let end = rest.find(['/', ':'])?;
    let (host, mut rest) = (&rest[..end], &rest[end..]);
    if let Some(digits) = rest.strip_prefix(':') {
        let n = digits.chars().take_while(char::is_ascii_digit).count();
        if n > 0 && digits[n..].starts_with(['/', ':']) {
            rest = &digits[n..];
        }
    }
    let mut path = rest.trim_start_matches(['/', ':']).trim_end_matches('/');
    path = path.strip_suffix(".git").unwrap_or(path);
    (!host.is_empty() && path.contains('/')).then(|| format!("{host}/{path}").to_lowercase())
}

/// The origin remote's forge identity of the repo holding `cwd`, a worktree's main checkout included.
fn forge_of(cwd: &Path) -> Option<String> {
    let mut dir = Some(cwd);
    while let Some(d) = dir {
        let git = d.join(".git");
        let config = if git.is_dir() {
            fs::read_to_string(git.join("config")).ok()
        } else if git.is_file() {
            let pointer = fs::read_to_string(&git).ok()?;
            let gitdir = d.join(pointer.trim().strip_prefix("gitdir:")?.trim());
            fs::read_to_string(gitdir.join("config"))
                .or_else(|_| fs::read_to_string(gitdir.join("../../config")))
                .ok()
        } else {
            None
        };
        if let Some(config) = config {
            let mut origin = false;
            for line in config.lines() {
                let line = line.trim();
                if line.starts_with('[') {
                    origin = line.trim_matches(['[', ']']).trim() == "remote \"origin\"";
                } else if let Some(url) = origin.then(|| line.strip_prefix("url")).flatten() {
                    return forge_identity(url.trim_start().strip_prefix('=')?);
                }
            }
            return None;
        }
        dir = d.parent();
    }
    None
}

/// A joined hub by its ID (~/.deepbuild/hubs/<hub ID>.json).
fn by_id(home: &Path, hub: &str) -> Option<Remote> {
    let v = parse(&fs::read_to_string(home.join("hubs").join(format!("{hub}.json"))).ok()?).ok()?;
    Some(Remote {
        hub: text(&v, "hub")?,
        address: text(&v, "address")?,
        token: text(&v, "token")?,
    })
}

/// The joined hub whose project is the forge identity of the repo holding `cwd` (~/.deepbuild/hubs/<hub ID>.json).
pub fn joined(home: &Path, cwd: &Path) -> Option<Remote> {
    let dir = home.join("hubs");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .collect();
    let forge = forge_of(cwd)?;
    files.sort();
    files
        .iter()
        .filter(|f| f.extension().is_some_and(|x| x == "json"))
        .filter_map(|f| parse(&fs::read_to_string(f).ok()?).ok())
        .find(|v| text(v, "project").as_deref() == Some(forge.as_str()))
        .and_then(|v| {
            Some(Remote {
                hub: text(&v, "hub")?,
                address: text(&v, "address")?,
                token: text(&v, "token")?,
            })
        })
}

/// Pins the hub's certificate by its ID; its handshake signature is checked against that certificate's key.
#[derive(Debug)]
struct Pinned {
    hub: String,
    provider: Arc<rustls::crypto::CryptoProvider>,
}
impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let id = hex(ring::digest::digest(&ring::digest::SHA256, end_entity).as_ref());
        if id == self.hub {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(format!(
                "the machine answering isn't the project's hub: it proved {}, and the hub is {}",
                &id[..16],
                &self.hub[..16.min(self.hub.len())]
            )))
        }
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Err(rustls::Error::General("TLS 1.3 only".into()))
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A TLS connection to the joined hub by `deadline`, this machine's key proved, and the hook's hello with its credential
/// queued behind the handshake; none if the hub can't be reached, or proves another key, in time.
pub fn connect(home: &Path, remote: &Remote, deadline: Instant) -> Option<Stream> {
    let left = deadline.checked_duration_since(Instant::now())?;
    let key_file = home.join("keys").join(format!("{}.key", remote.hub));
    let certs = vec![CertificateDer::from_pem_file(format!("{}.cert", key_file.display())).ok()?];
    let key = PrivateKeyDer::from_pem_file(&key_file).ok()?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .ok()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned {
            hub: remote.hub.clone(),
            provider,
        }))
        .with_client_auth_cert(certs, key)
        .ok()?;
    let addr = remote.address.to_socket_addrs().ok()?.next()?;
    let tcp = TcpStream::connect_timeout(&addr, left).ok()?;
    let _ = tcp.set_nodelay(true);
    let name = ServerName::try_from("deep-hub").ok()?;
    let conn = ClientConnection::new(Arc::new(config), name).ok()?;
    let stream = Stream::Tls(Box::new(StreamOwned::new(conn, tcp)));
    Some(stream)
}

/// The hook's hello on a joined hub's connection: its person's credential, after which its request is read.
pub fn hello(remote: &Remote) -> String {
    format!(
        "{{\"v\":1,\"hello\":\"hook\",\"token\":{}}}\n",
        deep_contracts::jcs(&Value::String(remote.token.clone()))
    )
}

/// Whether a hub at `generation` may take this hook (#1338): a refusal naming both generations when this machine has
/// seen a newer one of the hub `hub`, else none, a newer generation kept from here (~/.deepbuild/generations.json).
pub fn refused_generation(home: &Path, hub: &str, generation: Option<f64>) -> Option<String> {
    let at = generation
        .filter(|g| g.fract() == 0.0 && *g >= 1.0)
        .unwrap_or(1.0);
    let file = home.join("generations.json");
    let read = fs::read_to_string(&file).ok().and_then(|t| parse(&t).ok());
    let mut hubs: Vec<(String, f64)> = match read.as_ref().and_then(|v| member(v, "hubs")) {
        Some(Value::Object(members)) => members
            .iter()
            .filter_map(|(k, v)| match v {
                Value::Number(n) => Some((k.clone(), *n)),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    let highest = hubs.iter().find(|(k, _)| k == hub).map_or(0.0, |(_, n)| *n);
    if at < highest {
        return Some(format!(
            "deep-hook: this hub's record is at writer generation {at}, older than generation {highest}, which this machine has seen of it: it is a copy left behind by a restore or a move, so nothing was sent to it."
        ));
    }
    if at > highest {
        hubs.retain(|(k, _)| k != hub);
        hubs.push((hub.to_string(), at));
        let body = hubs
            .iter()
            .map(|(k, n)| format!("{}:{n}", deep_contracts::jcs(&Value::String(k.clone()))))
            .collect::<Vec<_>>()
            .join(",");
        let tmp = file.with_extension(format!("json.{}", std::process::id()));
        if fs::write(&tmp, format!("{{\"v\":1,\"hubs\":{{{body}}}}}\n")).is_ok() {
            let _ = fs::rename(&tmp, &file);
        }
    }
    None
}

/// Where hooks for a joined hub wait while its link is down: a folder of their own, never this machine's own hub's.
pub fn spool_folder(home: &Path, hub: &str) -> PathBuf {
    home.join("spool").join(hub)
}

/// Starts `deep-hook spool-send <hub>` apart from this hook when hooks wait for that hub; the hook doesn't wait on it.
pub fn send_later(home: &Path, hub: &str) {
    if !spool_folder(home, hub).join("spool.jsonl").exists() {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        let _ = Command::new(exe)
            .arg("spool-send")
            .arg(hub)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// How each request deep-hook spools begins, so one appended right after a cut line is found in it.
const REQUEST: &str = "{\"v\":1,\"agent\":";

/// The requests in a spool file's text, in the order they were written. A line that doesn't parse, cut by a write
/// that never finished, is skipped as this machine's own hub skips one: the hub would refuse it and end the
/// connection, holding back every request after it. One appended right after the cut bytes shares their line.
fn requests(text: &str) -> Vec<&str> {
    text.lines()
        .filter_map(|line| {
            if parse(line).is_ok() {
                return Some(line);
            }
            line.match_indices(REQUEST)
                .map(|(at, _)| &line[at..])
                .find(|glued| parse(glued).is_ok())
        })
        .collect()
}

/// How long a spool sender may take, all of it.
const SEND_BUDGET: Duration = Duration::from_secs(20);

/// `deep-hook spool-send <hub>`: the hooks spooled for a joined hub, sent over one connection as late hooks under this
/// machine's credential, each file removed once the hub took every request in it. A spool moves aside first, so a hook
/// that spools meanwhile starts a new one; the hub records an event once, so a file two senders took counts once.
pub fn send_spool(home: &Path, hub: &str) -> ExitCode {
    let folder = spool_folder(home, hub);
    let live = folder.join("spool.jsonl");
    if live.exists() {
        let _ = fs::rename(
            &live,
            folder.join(format!(
                "held-{:020}-{}.jsonl",
                now_ns(),
                std::process::id()
            )),
        );
    }
    let mut files: Vec<PathBuf> = match fs::read_dir(&folder) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("held-") && n.ends_with(".jsonl"))
            })
            .collect(),
        Err(_) => return ExitCode::SUCCESS,
    };
    files.sort();
    let Some(remote) = by_id(home, hub) else {
        return ExitCode::from(1);
    };
    let deadline = Instant::now() + SEND_BUDGET;
    let Some(stream) = connect(home, &remote, deadline) else {
        return ExitCode::from(1);
    };
    let _ = stream.set_read_timeout(Some(SEND_BUDGET));
    let _ = stream.set_write_timeout(Some(SEND_BUDGET));
    let mut reader = io::BufReader::new(stream);
    let mut line = String::new();
    // The hub's hello, and its generation, first: a hub left behind gets none of them.
    if io::BufRead::read_line(&mut reader, &mut line).unwrap_or(0) == 0 {
        return ExitCode::from(1);
    }
    let hello = parse(line.trim_end()).ok();
    let generation = hello.as_ref().and_then(|h| match member(h, "generation") {
        Some(Value::Number(n)) => Some(*n),
        _ => None,
    });
    if refused_generation(home, hub, generation).is_some() {
        return ExitCode::from(1);
    }
    let hello = format!(
        "{{\"v\":1,\"hello\":\"spool\",\"token\":{}}}\n",
        deep_contracts::jcs(&Value::String(remote.token.clone()))
    );
    if reader.get_mut().write_all(hello.as_bytes()).is_err() {
        return ExitCode::from(1);
    }
    line.clear();
    if io::BufRead::read_line(&mut reader, &mut line).unwrap_or(0) == 0
        || !line.contains("\"role\"")
    {
        return ExitCode::from(1);
    }
    for file in files {
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        for request in requests(&text) {
            if reader
                .get_mut()
                .write_all(format!("{request}\n").as_bytes())
                .is_err()
            {
                return ExitCode::from(1);
            }
            line.clear();
            if io::BufRead::read_line(&mut reader, &mut line).unwrap_or(0) == 0
                || !line.contains("\"ack\"")
            {
                return ExitCode::from(1);
            }
        }
        let _ = fs::remove_file(&file);
        if Instant::now() > deadline {
            break;
        }
    }
    ExitCode::SUCCESS
}

fn now_ns() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cut_line_in_a_spool_holds_back_no_request_after_it() {
        let request = |id: &str| {
            format!(
                r#"{{"v":1,"agent":"claude-code","event":"PreToolUse","seq":"1","id":"{id}","pid":1,"ppid":1,"matched":[],"payload":{{"session_id":"s"}}}}"#
            )
        };
        let (first, glued, third) = (request("a"), request("b"), request("c"));
        // Two writes never finished: the second request was appended right after the first one's cut bytes.
        let text = format!(
            "{first}\n{}{glued}\n{third}\n{}",
            &first[..40],
            &third[..25]
        );
        assert_eq!(requests(&text), [&first, &glued, &third]);
        assert_eq!(requests("{cut\n\n"), Vec::<&str>::new());
    }

    #[test]
    fn forge_identities_read_as_the_hub_reads_them() {
        for (url, want) in [
            (
                "https://github.com/acme/shop.git",
                Some("github.com/acme/shop"),
            ),
            ("git@github.com:Acme/Shop.git", Some("github.com/acme/shop")),
            (
                "ssh://git@github.com:22/acme/shop/",
                Some("github.com/acme/shop"),
            ),
            ("https://github.com/acme", None),
        ] {
            assert_eq!(forge_identity(url).as_deref(), want, "{url}");
        }
    }

    #[test]
    fn the_network_route_keeps_the_fail_open_time_its_facts_declare() {
        let facts = parse(include_str!("../../../adapters/claude-code.facts.json")).unwrap();
        let route = member(member(&facts, "routes").unwrap(), "network").unwrap();
        assert_eq!(
            member(route, "failOpenMs"),
            Some(&Value::Number(FAIL_OPEN.as_millis() as f64))
        );
    }
}
