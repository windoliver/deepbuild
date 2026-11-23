//! #2892: `ship.bytes` and the record of the `ship` checks' test server (#1300's measure, without its
//! brief, link rate or times). `ship.bytes` sums the stored bytes of every file a web bundle's index
//! page loads: the page, its two scripts and every file its manifest lists, never the fallback
//! page's, which load only in the player's place. The test server serves the bundle as a static
//! host does, the index page with `no-cache` and every other file with a max-age of a year, each
//! file as stored with no content encoding, to a fresh headless Chrome profile until the player is
//! `ready`, and records each response it sent. The page opens in a frame of the server's own page,
//! which reads `ready` and posts it back; neither is recorded. Chrome runs in a process group of
//! its own, stopped by its PID, and its profile is removed. Nothing leaves this machine.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

/// How long the player may take to be ready; past it the record says it wasn't.
const DEADLINE: Duration = Duration::from_secs(180);
/// After `ready`, how long the server keeps serving the files a page asks for later.
const LATER: Duration = Duration::from_secs(2);

/// The server's own page: the bundle's index page in a frame, `ready` (or the player's notice, 5 s
/// after it shows without `ready`) posted back to `/.ship/done`.
const HOST: &str = r#"<!doctype html><meta charset="utf-8"><title>ship</title>
<iframe id="f" src="/index.html" style="width:960px;height:540px;border:0"></iframe>
<script>
const f = document.getElementById('f'), t0 = Date.now();
let noticed = 0;
const post = (v) => fetch('/.ship/done', { method: 'POST', body: JSON.stringify(v) });
const tick = () => {
  let d = null;
  try { d = f.contentDocument; } catch {}
  const p = d && d.querySelector('deep-player');
  if (p && p.ready) return post({ ready: true });
  const notice = d && d.querySelector('[data-deep-notice]');
  if (notice && !noticed) noticed = Date.now();
  if ((noticed && Date.now() - noticed > 5000) || Date.now() - t0 > 175000) return post({ ready: false, notice: notice ? notice.textContent : null });
  setTimeout(tick, 100);
};
tick();
</script>
"#;

/// The files a bundle's index page loads, each by its path in the bundle: the page, the element's
/// script, the page glue the import map names and every file the manifest lists, with the bytes
/// each is stored in and, for one stored compressed, the bytes it inflates to.
fn loaded(bundle: &Path) -> Result<Vec<(String, u64, u64)>, Value> {
    let index = std::fs::read_to_string(bundle.join("index.html"))
        .map_err(|_| json!({"code": "ship.no_bundle", "why": format!("{} holds no index.html", bundle.display())}))?;
    let between = |open: &str, close: &str| -> Option<String> {
        let at = index.find(open)? + open.len();
        let rest = &index[at..];
        let body = &rest[rest.find('>')? + 1..];
        Some(body[..body.find(close)?].to_string())
    };
    let manifest: Value = between("id=\"deep-bundle\"", "</script>")
        .and_then(|m| serde_json::from_str(&m.replace("<\\/", "</")).ok())
        .ok_or_else(|| json!({"code": "ship.no_bundle", "why": "the index page carries no bundle manifest"}))?;
    let map: Value = between("type=\"importmap\"", "</script>")
        .and_then(|m| serde_json::from_str(&m).ok())
        .unwrap_or(Value::Null);
    let mut paths = vec!["index.html".to_string()];
    let scripts = index.split("<script type=\"module\" src=\"./").skip(1);
    paths.extend(scripts.filter_map(|s| Some(s[..s.find('"')?].to_string())));
    let imports = map["imports"].as_object().into_iter().flatten();
    paths.extend(
        imports.filter_map(|(_, p)| Some(p.as_str()?.trim_start_matches("./").to_string())),
    );
    let mut out = Vec::new();
    for path in paths {
        let stored = std::fs::metadata(bundle.join(&path))
            .map(|m| m.len())
            .unwrap_or(0);
        out.push((path, stored, stored));
    }
    for f in manifest["files"].as_array().into_iter().flatten() {
        let path = f["path"].as_str().unwrap_or_default().to_string();
        let stored = std::fs::metadata(bundle.join(&path))
            .map(|m| m.len())
            .unwrap_or(0);
        let inflated = f["inflated"]["bytes"].as_u64().unwrap_or(stored);
        out.push((path, stored, inflated));
    }
    Ok(out)
}

/// The `ship` call: `ship.bytes` for the web bundle at `bundle`, and the record of its test server
/// serving it to the Chrome at `chrome`. `inflated` sums inflated bytes instead (a planted measure).
pub(crate) fn measure(bundle: &Path, chrome: &Path, inflated: bool) -> Value {
    let files = match loaded(bundle) {
        Ok(f) => f,
        Err(e) => return json!({"outcome": "failed", "issues": [e]}),
    };
    let bytes: u64 = files
        .iter()
        .map(|(_, s, i)| if inflated { i } else { s })
        .sum();
    match serve(bundle, chrome) {
        Ok(served) => json!({"outcome": "measured", "bytes": bytes, "served": served}),
        Err(why) => json!({"outcome": "failed", "bytes": bytes,
            "issues": [{"code": "ship.not_served", "why": why}]}),
    }
}

/// Serves `bundle` to a fresh headless Chrome profile until its player is ready, and answers the
/// server's record: whether the player was ready, and each response it sent.
fn serve(bundle: &Path, chrome: &Path) -> Result<Value, String> {
    if !chrome.exists() {
        return Err(format!("no Chrome at {}", chrome.display()));
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let (posted, done) = mpsc::channel();
    let record = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let server = {
        let (stop, record, root) = (stop.clone(), record.clone(), bundle.to_path_buf());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => answer(stream, &root, &record, &posted),
                    Err(_) => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        })
    };
    let profile =
        std::env::temp_dir().join(format!("deep-ship-chrome-{}-{port}", std::process::id()));
    let started = std::process::Command::new(chrome)
        .args([
            "--headless=new",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--use-mock-keychain",
            "--password-store=basic",
            "--disable-background-networking",
            "--disable-component-update",
            "--enable-unsafe-webgpu",
            "--ignore-gpu-blocklist",
        ])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("http://127.0.0.1:{port}/.ship"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0)
        .spawn();
    let out = match started {
        Ok(mut child) => {
            let got = done.recv_timeout(DEADLINE);
            std::thread::sleep(LATER);
            // Chrome and its helpers are its own process group: stopped by its PID.
            // SAFETY: kill sends a signal to the process group this call started; no memory is
            // touched.
            unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
            let _ = child.wait();
            let page: Value = got
                .ok()
                .and_then(|b: Vec<u8>| serde_json::from_slice(&b).ok())
                .unwrap_or(json!({"ready": false}));
            Ok((page["ready"] == true, page["notice"].clone()))
        }
        Err(e) => Err(format!("Chrome didn't start: {e}")),
    };
    stop.store(true, Ordering::Relaxed);
    let _ = server.join();
    let _ = std::fs::remove_dir_all(&profile);
    let (ready, notice) = out?;
    let responses = std::mem::take(&mut *record.lock().map_err(|e| e.to_string())?);
    Ok(json!({"ready": ready, "notice": notice, "responses": responses}))
}

/// One request: the server's own page and post, or a bundle file sent as stored with no content
/// encoding, recorded.
fn answer(
    stream: TcpStream,
    root: &Path,
    record: &Mutex<Vec<Value>>,
    posted: &mpsc::Sender<Vec<u8>>,
) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let Ok(clone) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(clone);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else {
        return;
    };
    let mut length = 0usize;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).unwrap_or(0) == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut out = stream;
    let send = |out: &mut TcpStream, status: &str, kind: &str, cache: &str, body: &[u8]| {
        let head = format!("HTTP/1.1 {status}\r\ncontent-type: {kind}\r\ncontent-length: {}\r\ncache-control: {cache}\r\nconnection: close\r\n\r\n", body.len());
        let _ = out.write_all(head.as_bytes());
        let _ = out.write_all(body);
    };
    let path = target.split(['?', '#']).next().unwrap_or("/");
    if method == "POST" && path == "/.ship/done" {
        let mut body = vec![0; length];
        let _ = reader.read_exact(&mut body);
        send(&mut out, "200 OK", "text/plain", "no-store", b"ok");
        let _ = posted.send(body);
        return;
    }
    if path == "/.ship" {
        send(
            &mut out,
            "200 OK",
            "text/html; charset=utf-8",
            "no-store",
            HOST.as_bytes(),
        );
        return;
    }
    let rel = path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let inside = !rel.split('/').any(|s| s == ".." || s.is_empty());
    let body = inside.then(|| std::fs::read(root.join(rel)).ok()).flatten();
    let (status, sent) = match &body {
        Some(bytes) => {
            let kind = match rel.rsplit('.').next() {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "text/javascript",
                Some("json") => "application/json",
                Some("css") => "text/css",
                _ if bytes.starts_with(b"\0asm") => "application/wasm",
                _ => "application/octet-stream",
            };
            let cache = if rel == "index.html" {
                "no-cache"
            } else {
                "max-age=31536000"
            };
            send(&mut out, "200 OK", kind, cache, bytes);
            (200, bytes.len())
        }
        None => {
            send(&mut out, "404 Not Found", "text/plain", "no-store", b"");
            (404, 0)
        }
    };
    if let Ok(mut r) = record.lock() {
        r.push(json!({"path": rel, "status": status, "bytes": sent, "content_encoding": null}));
    }
}
