//! #1042: a web player's public sources (canvas primitives: Export: web player), `web: {sources:
//! [{reading: ID, url: https, every: s ≥ 60, path}]}`: the readings the player may go on asking
//! for, each from a host that needs no key. The export holds each declaration to those fields and
//! to a reading the document reads, then asks the source once itself, with no cookie, key or
//! credential: one that answers only with a key is refused, naming it, so a bundle never names a
//! source its player couldn't read. The app's own secrets are never read here.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName};
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use serde_json::{json, Value};

/// How long the export waits for a source to connect, and then to answer.
const WAIT: Duration = Duration::from_secs(20);

/// The IDs of the bound values of `doc` that show the reading `id`, or one of its series.
pub(super) fn bound(doc: &Value, id: &str) -> Vec<String> {
    let handle = format!("reading:{id}");
    let shows = |b: &Value| {
        let source = b["source"].as_str().unwrap_or("");
        source.split_once('#').map_or(source, |(s, _)| s) == handle
    };
    let values = doc["bound_values"].as_object().into_iter().flatten();
    values
        .filter(|(_, b)| shows(b))
        .map(|(id, _)| id.clone())
        .collect()
}

/// A source's host and the path it is asked for, from its `https` URL; nothing else is one.
fn parts(url: &str) -> Option<(&str, &str)> {
    let rest = url.strip_prefix("https://")?;
    let rest = rest.split_once('#').map_or(rest, |(r, _)| r);
    let at = rest.find(['/', '?']).unwrap_or(rest.len());
    let (host, path) = rest.split_at(at);
    // A name or a password in the URL is a credential.
    (!host.is_empty() && !host.contains('@')).then_some((host, path))
}

/// The origin a page reaches the source at `url` through: `https://` and its host.
pub(super) fn origin(url: &str) -> Option<String> {
    parts(url).map(|(host, _)| format!("https://{host}"))
}

/// The sources `web` declares, each as the bundle's index page names it (`{reading, url, every,
/// path, bound}`), or the refusals of the ones that aren't `{reading, url: https, every: s ≥ 60,
/// path}` on a reading `doc` reads, each `{item, code, why}`.
pub(super) fn declared(doc: &Value, web: &Value) -> Result<Vec<Value>, Vec<Value>> {
    let (mut out, mut refused) = (Vec::new(), Vec::new());
    let list = match web.get("sources") {
        None | Some(Value::Null) => return Ok(out),
        Some(Value::Array(list)) => list,
        Some(_) => {
            return Err(vec![
                json!({"item": "web/sources", "code": "web.source", "why": "web.sources isn't a list"}),
            ])
        }
    };
    for (i, s) in list.iter().enumerate() {
        let at = format!("web/sources/{i}");
        let id = s["reading"].as_str().filter(|r| !r.is_empty());
        let mut refuse = |why: String| {
            refused.push(json!({"item": id.unwrap_or(&at), "code": "web.source", "why": why}));
        };
        let (Some(id), Some(url), Some(every), Some(path)) = (
            id,
            s["url"].as_str(),
            s["every"].as_f64(),
            s["path"].as_str(),
        ) else {
            refuse(format!("{at} isn't {{reading: ID, url, every, path}}"));
            continue;
        };
        let reads = !bound(doc, id).is_empty() || doc["sources"].get(id).is_some();
        if parts(url).is_none() {
            refuse(format!(
                "the source {id}'s url {url} isn't an https URL with no name or password in it"
            ));
        } else if every < 60.0 {
            refuse(format!(
                "the source {id} is asked every {every} s; a public source is asked every 60 s or more"
            ));
        } else if !reads {
            refuse(format!("the document reads no reading {id}"));
        } else {
            out.push(json!({"reading": id, "url": url, "every": every, "path": path, "bound": bound(doc, id)}));
        }
    }
    if refused.is_empty() {
        Ok(out)
    } else {
        Err(refused)
    }
}

/// The status `url` answers a request that carries no cookie, key or credential, trusting the
/// platform's own authorities and the PEM authorities `ca`.
fn status(url: &str, ca: &[u8]) -> Result<u16, String> {
    let (host, path) = parts(url).ok_or("it isn't an https URL")?;
    let mut roots = RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        // A platform certificate rustls can't read is left out; the handshake names the rest.
        let _ = roots.add(cert);
    }
    for cert in CertificateDer::pem_slice_iter(ca) {
        let cert = cert.map_err(|e| format!("source_ca can't be read: {e}"))?;
        roots.add(cert).map_err(|e| format!("source_ca: {e}"))?;
    }
    let config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_root_certificates(roots)
            .with_no_client_auth();
    // https's own port when the URL names none; an IPv6 address sits in brackets.
    let named = host.rsplit_once(':').filter(|(_, p)| !p.contains(']'));
    let name = named.map_or(host, |(n, _)| n);
    let authority = match named {
        Some(_) => host.to_string(),
        None => format!("{host}:443"),
    };
    let server = ServerName::try_from(name.trim_matches(['[', ']']).to_string())
        .map_err(|e| format!("{name} isn't a host name: {e}"))?;
    let addr = authority.to_socket_addrs().map_err(|e| e.to_string())?;
    let addr = addr.into_iter().next().ok_or("it resolves to no address")?;
    let tcp = TcpStream::connect_timeout(&addr, WAIT).map_err(|e| e.to_string())?;
    tcp.set_read_timeout(Some(WAIT))
        .map_err(|e| e.to_string())?;
    let tls = ClientConnection::new(Arc::new(config), server).map_err(|e| e.to_string())?;
    let mut stream = StreamOwned::new(tls, tcp);
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    // The status line alone: `HTTP/1.1 200 OK`.
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    while line.len() < 64 && !line.ends_with(b"\n") {
        match stream.read(&mut byte) {
            Ok(1) => line.push(byte[0]),
            Ok(_) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    let line = String::from_utf8_lossy(&line);
    let code = line.split(' ').nth(1).and_then(|c| c.parse().ok());
    code.ok_or_else(|| format!("it answered {:?}, not HTTP", line.trim_end()))
}

/// The refusals of the declared `sources` a player couldn't read, each `{item, code, why}`
/// naming its reading: one that answers a request with no key 401 or 403 needs a key
/// (`web.source_key`), and one that gives the export no answer is one nobody checked
/// (`web.source_unanswered`).
pub(super) fn refusals(sources: &[Value], ca: &[u8]) -> Vec<Value> {
    let mut out = Vec::new();
    for s in sources {
        let (id, url) = (&s["reading"], s["url"].as_str().unwrap_or(""));
        match status(url, ca) {
            Ok(code @ (401 | 403)) => out.push(json!({"item": id, "code": "web.source_key", "status": code,
                "why": format!("the source {} ({url}) answers only with a key: asked with none, it answers {code}; a web player reads only public sources that need no key", id.as_str().unwrap_or(""))})),
            Ok(_) => {}
            Err(why) => out.push(json!({"item": id, "code": "web.source_unanswered",
                "why": format!("the source {} ({url}) gave the export no answer ({why}), so nothing shows it needs no key", id.as_str().unwrap_or(""))})),
        }
    }
    out
}
