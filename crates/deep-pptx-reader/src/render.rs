//! The pinned LibreOffice, run headless, drawing each slide of a pptx file to a PNG at the size
//! asked for (issue #732: the fidelity reader). It runs as its own process with a profile of its
//! own under the caller's work folder, driven over a pipe by a small UNO script in LibreOffice's
//! own Python: the script loads the deck hidden and read-only and hands each slide to LibreOffice's
//! graphic export filter, so LibreOffice lays out and draws every pixel.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// The LibreOffice version the reader pins, as `soffice --version` begins it.
pub const PINNED: &str = "26.8.3";

/// How long one deck may take to draw before the run is stopped.
const LIMIT: Duration = Duration::from_secs(300);

/// A LibreOffice found on this machine: its `soffice`, the Python that carries its UNO bridge, and
/// its version line.
#[derive(Clone, Debug)]
pub struct Office {
    pub soffice: PathBuf,
    pub python: PathBuf,
    pub version: String,
}

/// Why no pinned LibreOffice can draw here: none is installed, or another version is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Missing {
    NotFound,
    Version(String),
}

impl Missing {
    /// What the reader is missing, in words.
    pub fn why(&self) -> String {
        match self {
            Missing::NotFound => format!(
                "no LibreOffice is installed (the reader pins LibreOffice {PINNED}, at /Applications/LibreOffice.app or as soffice on PATH)"
            ),
            Missing::Version(v) => {
                format!("LibreOffice {v} is installed, and the reader pins {PINNED}")
            }
        }
    }
}

/// The places LibreOffice's `soffice` is looked for: each folder on PATH, then where the macOS
/// app and Linux packages put it.
fn candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .map(|d| d.join("soffice"))
                .collect()
        })
        .unwrap_or_default();
    out.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
    out.push("/usr/lib/libreoffice/program/soffice".into());
    out.push("/opt/libreoffice/program/soffice".into());
    out
}

/// The Python beside `soffice` that carries LibreOffice's UNO bridge.
fn python_of(soffice: &Path) -> Option<PathBuf> {
    let real = std::fs::canonicalize(soffice).ok()?;
    let dir = real.parent()?;
    [
        dir.join("../Resources/python"),
        dir.join("python"),
        dir.join("python.bin"),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

/// The pinned LibreOffice, or why there is none.
pub fn find() -> Result<Office, Missing> {
    let mut other = None;
    for soffice in candidates().into_iter().filter(|p| p.is_file()) {
        let Some(python) = python_of(&soffice) else {
            continue;
        };
        let Ok(out) = Command::new(&soffice)
            .args(["--headless", "--version"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        else {
            continue;
        };
        let line = String::from_utf8_lossy(&out.stdout)
            .lines()
            .find(|l| l.starts_with("LibreOffice"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let version = line.split_whitespace().nth(1).unwrap_or_default();
        if version == PINNED || version.starts_with(&format!("{PINNED}.")) {
            return Ok(Office {
                soffice,
                python,
                version: line,
            });
        }
        other.get_or_insert_with(|| version.to_string());
    }
    Err(other.map_or(Missing::NotFound, Missing::Version))
}

/// The UNO script: connects to the LibreOffice listening on the pipe, loads the deck hidden and
/// read-only, draws each slide to `slide-NNN.png` in the output folder at the size asked for,
/// and ends the LibreOffice.
const SCRIPT: &str = r#"import os, sys, time
import uno
from com.sun.star.beans import PropertyValue

def pv(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p

pipe, src, out, w, h = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
ctx = None
deadline = time.time() + 120
while ctx is None:
    try:
        ctx = resolver.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % pipe)
    except Exception:
        if time.time() > deadline:
            sys.exit("LibreOffice never answered on its pipe")
        time.sleep(0.05)
smgr = ctx.ServiceManager
desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(src)), "_blank", 0,
                                   (pv("Hidden", True), pv("ReadOnly", True)))
if doc is None:
    sys.exit("LibreOffice could not open the deck")
try:
    pages = doc.getDrawPages()
    for i in range(pages.getCount()):
        f = smgr.createInstanceWithContext("com.sun.star.drawing.GraphicExportFilter", ctx)
        f.setSourceDocument(pages.getByIndex(i))
        data = uno.Any("[]com.sun.star.beans.PropertyValue", (pv("PixelWidth", w), pv("PixelHeight", h)))
        url = uno.systemPathToFileUrl(os.path.join(out, "slide-%03d.png" % (i + 1)))
        uno.invoke(f, "filter", ((pv("URL", url), pv("MediaType", "image/png"), pv("FilterData", data)),))
    print(pages.getCount())
finally:
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass
"#;

/// Stops a child this run started, by its own PID, and reaps it.
fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Draws each slide of the deck at `pptx` at `size` with `office`, in a fresh profile under
/// `work`: each slide's PNG bytes, in slide order.
pub fn render(
    office: &Office,
    pptx: &Path,
    size: [u32; 2],
    work: &Path,
) -> Result<Vec<Vec<u8>>, String> {
    let profile = work.join("profile");
    let out = work.join("slides");
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let script = work.join("render.py");
    std::fs::write(&script, SCRIPT).map_err(|e| e.to_string())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let pipe = format!("deep_pptx_{}_{nanos}", std::process::id());
    let profile_url = format!("file://{}", profile.display());
    let mut office_run = Command::new(&office.soffice)
        .args([
            "--headless",
            "--invisible",
            "--nologo",
            "--norestore",
            "--nodefault",
            "--nolockcheck",
            "--nofirststartwizard",
        ])
        .arg(format!("-env:UserInstallation={profile_url}"))
        .arg(format!(
            "--accept=pipe,name={pipe};urp;StarOffice.ComponentContext"
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("LibreOffice didn't start: {e}"))?;
    let client = Command::new(&office.python)
        .arg(&script)
        .arg(&pipe)
        .arg(pptx)
        .arg(&out)
        .arg(size[0].to_string())
        .arg(size[1].to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut client = match client {
        Ok(c) => c,
        Err(e) => {
            stop(&mut office_run);
            return Err(format!("LibreOffice's Python didn't start: {e}"));
        }
    };
    let started = Instant::now();
    let status = loop {
        match client.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if started.elapsed() > LIMIT => break None,
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break None,
        }
    };
    let Some(status) = status else {
        stop(&mut client);
        stop(&mut office_run);
        return Err(format!(
            "LibreOffice didn't draw the deck within {} s",
            LIMIT.as_secs()
        ));
    };
    let mut err = String::new();
    if let Some(mut e) = client.stderr.take() {
        let _ = std::io::Read::read_to_string(&mut e, &mut err);
    }
    // LibreOffice ends once the script terminates it; past a short wait it is stopped.
    let until = Instant::now() + Duration::from_secs(20);
    while office_run.try_wait().ok().flatten().is_none() && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    stop(&mut office_run);
    if !status.success() {
        return Err(format!(
            "LibreOffice's render failed: {}",
            err.lines().rev().take(6).collect::<Vec<_>>().join(" | ")
        ));
    }
    let mut slides = Vec::new();
    for k in 1.. {
        let png = out.join(format!("slide-{k:03}.png"));
        match std::fs::read(&png) {
            Ok(b) => slides.push(b),
            Err(_) => break,
        }
    }
    Ok(slides)
}
