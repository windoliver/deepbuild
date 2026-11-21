//! #280: net.budget's web part (canvas primitives: Check input: net kinds: "its web part runs in
//! the web player in headless Chrome on the reference Mac"). The app serves the web player's full
//! set, the piece's files and one page on 127.0.0.1, starts the Chrome the scenario names on that
//! page in its own process group, and takes back the part the page posts: the match's stepping
//! measured in the player as the app measures its own, five runs after a warm-up. It stops Chrome
//! by its PID and deletes the profile it gave it. Nothing leaves this machine.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Value};

use crate::hub::Hub;

/// How long the page may take to measure the piece before the part reads as not run.
const DEADLINE: Duration = Duration::from_secs(3600);

/// What the page loads: the player's files and the piece's, by SHA-256.
pub struct Files {
    by_sha: BTreeMap<String, Vec<u8>>,
    fonts: Vec<Value>,
    document: String,
    track: String,
}

const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>net.budget's web part</title><script type="module">
const post = (body) => fetch('/results', { method: 'POST', body: JSON.stringify(body) });
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
try {
  const ask = await (await fetch('/ask.json')).json();
  const glue = await import('/glue.js');
  await glue.default({ module_or_path: await bytes('/player.wasm') });
  for (const f of ask.fonts) glue.provide_font(f.file, await bytes('/f/' + f.sha256));
  const player = new glue.Player();
  for (const sha of ask.files) player.add_file(sha, await bytes('/f/' + sha));
  const part = JSON.parse(player.net_budget(ask.document, ask.track, JSON.stringify(ask.request)));
  await post({ part, userAgent: navigator.userAgent, isolated: crossOriginIsolated });
} catch (e) { await post({ error: String((e && e.stack) || e) }); }
</script>"#;

impl Hub<'_> {
    /// The files net.budget's web part loads for `doc`: the full set's player, the document as
    /// presented, the input track recorded before the match, everything the document names by
    /// hash and the bundled faces.
    pub(crate) fn web_files(&mut self, doc: &str, track: &[Value]) -> Result<Files, Value> {
        let presented = self
            .presented_doc(doc)
            .ok_or_else(|| json!("the document isn't presented"))?;
        let root = self.scenario.evidence.clone();
        let mut by_sha = BTreeMap::new();
        let mut put = |bytes: Vec<u8>| {
            let sha = sha256_hex(&bytes);
            by_sha.insert(sha.clone(), bytes);
            sha
        };
        let document = put(serde_json::to_vec(&presented).unwrap_or_default());
        let held = crate::track_call::held_bytes(track)
            .ok_or_else(|| json!("the recorded track isn't one the web player reads"))?;
        let track = put(held);
        for (_, path, sha) in crate::extended::hashes(&presented, true) {
            let bytes = crate::evidence::read(&root, &sha)
                .ok_or_else(|| json!(format!("the store holds no {sha}, which {path} names")))?;
            put(bytes);
        }
        let fonts = deep_text::FACES
            .iter()
            .map(|f| json!({"file": f.file, "sha256": put(f.bytes().to_vec())}))
            .collect();
        Ok(Files {
            by_sha,
            fonts,
            document,
            track,
        })
    }
}

/// The part the web player measured for `request` (`{track, steps, len, window, frame_ms,
/// from_step}`), playing the piece in headless Chrome at `chrome`.
pub fn measure(chrome: &Path, files: &Files, request: &Value) -> Result<Value, Value> {
    if !chrome.exists() {
        return Err(json!(format!("no Chrome at {}", chrome.display())));
    }
    let (wasm, glue) = crate::export::full_player();
    let fonts: Vec<&str> = files
        .fonts
        .iter()
        .filter_map(|f| f["sha256"].as_str())
        .collect();
    let ask = json!({
        "document": files.document, "track": files.track, "request": request, "fonts": files.fonts,
        "files": files.by_sha.keys().filter(|s| !fonts.contains(&s.as_str())).collect::<Vec<_>>(),
    });
    let mut routes: BTreeMap<String, (&str, Vec<u8>)> = BTreeMap::new();
    routes.insert("/".into(), ("text/html", PAGE.as_bytes().to_vec()));
    routes.insert(
        "/ask.json".into(),
        ("application/json", ask.to_string().into_bytes()),
    );
    routes.insert("/glue.js".into(), ("text/javascript", glue.to_vec()));
    routes.insert("/player.wasm".into(), ("application/wasm", wasm.to_vec()));
    for (sha, bytes) in &files.by_sha {
        routes.insert(
            format!("/f/{sha}"),
            ("application/octet-stream", bytes.clone()),
        );
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| json!(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| json!(e.to_string()))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| json!(e.to_string()))?;
    let (posted, results) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let server = {
        let stop = stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if let Some(body) = serve(stream, &routes) {
                            let _ = posted.send(body);
                        }
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(20)),
                }
            }
        })
    };
    let profile =
        std::env::temp_dir().join(format!("deep-280-chrome-{}-{port}", std::process::id()));
    let started = std::process::Command::new(chrome)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--use-mock-keychain",
            "--password-store=basic",
            "--disable-background-networking",
            "--disable-component-update",
        ])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("http://127.0.0.1:{port}/"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0)
        .spawn();
    let out = match started {
        Ok(mut child) => {
            let got = results.recv_timeout(DEADLINE);
            // Chrome and its helpers are its own process group: stopped by its PID.
            // SAFETY: kill sends a signal to the process group this call started; no memory is
            // touched.
            unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
            let _ = child.wait();
            match got {
                Ok(body) => read_post(&body),
                Err(_) => Err(json!(format!(
                    "the web player didn't post its part within {} s",
                    DEADLINE.as_secs()
                ))),
            }
        }
        Err(e) => Err(json!(format!("Chrome didn't start: {e}"))),
    };
    stop.store(true, Ordering::Relaxed);
    let _ = server.join();
    let _ = std::fs::remove_dir_all(&profile);
    out
}

/// The page's post: the part, with the browser it ran in.
fn read_post(body: &[u8]) -> Result<Value, Value> {
    let v: Value = serde_json::from_slice(body).map_err(|_| json!("the page's post isn't JSON"))?;
    if let Some(e) = v.get("error") {
        return Err(json!(format!("the web player failed: {e}")));
    }
    let mut part = v.get("part").cloned().unwrap_or(Value::Null);
    if let Some(e) = part.get("error") {
        return Err(json!(format!("the web player failed: {e}")));
    }
    part["browser"] = json!({"user_agent": v["userAgent"], "isolated": v["isolated"]});
    Ok(part)
}

/// One request: a GET answered from `routes`, or the page's POST, whose body it returns.
fn serve(stream: TcpStream, routes: &BTreeMap<String, (&str, Vec<u8>)>) -> Option<Vec<u8>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next()?.to_string(), parts.next()?.to_string());
    let mut length = 0usize;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut out = stream;
    // Cross-origin isolated, so the page's clock keeps its finer resolution.
    let head = |status: &str, kind: &str, len: usize| {
        format!("HTTP/1.1 {status}\r\ncontent-type: {kind}\r\ncontent-length: {len}\r\ncache-control: no-store\r\ncross-origin-opener-policy: same-origin\r\ncross-origin-embedder-policy: require-corp\r\nconnection: close\r\n\r\n")
    };
    if method == "POST" {
        let mut body = vec![0; length];
        reader.read_exact(&mut body).ok()?;
        let _ = out.write_all(head("200 OK", "text/plain", 2).as_bytes());
        let _ = out.write_all(b"ok");
        return Some(body);
    }
    match routes.get(path.as_str()) {
        Some((kind, bytes)) => {
            let _ = out.write_all(head("200 OK", kind, bytes.len()).as_bytes());
            let _ = out.write_all(bytes);
        }
        None => {
            let _ = out.write_all(head("404 Not Found", "text/plain", 0).as_bytes());
        }
    }
    None
}
