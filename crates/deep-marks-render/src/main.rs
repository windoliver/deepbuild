//! `deep-canvas-render <frames|session|render>`: JSON lines in, one JSON line out per input line, in
//! order, exit 0. A line that can't be read, lacks a required field or names an unknown `planted`
//! value answers `{"ok":false,"code":"bad_input"}`, before anything platform-specific; off macOS
//! every other line answers `{"ok":false,"code":"unsupported_platform"}`. The surface is the #391
//! acceptance README's.
//!
//! A document's view is drawn headless with GPUI's offscreen Metal renderer through GPUI's own
//! frame path, and only when the frame clock arms a frame: at the session's first frame, at a new
//! revision, view or reading, and when the presented frame's `valid_until` passes (canvas
//! primitives: Frame clock and scheduler). The view's zoom is the window's scale factor.

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use deep_canvas_marks::scene::Palette;
use serde_json::{json, Map, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refused(code: &str, path: &str) -> Value {
    json!({"ok": false, "code": code, "path": path})
}

/// The look the roles resolve through, per theme.
struct Look {
    light: Palette,
    dark: Option<Palette>,
}

impl Look {
    fn palette(&self, theme: Theme) -> &Palette {
        match theme {
            Theme::Dark => self.dark.as_ref().unwrap_or(&self.light),
            Theme::Light => &self.light,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Theme {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct View {
    zoom: f64,
    theme: Theme,
}

/// One step of a document session: a whole revision (or the last one), the time of its first
/// frame, the view, the readings, and how many frames it presents.
struct Step {
    doc: Option<Map<String, Value>>,
    t: i64,
    view: Option<View>,
    readings: Option<BTreeMap<String, f64>>,
    frames: u32,
}

enum Request {
    Frames {
        doc: Map<String, Value>,
        look: Look,
        view: View,
        readings: BTreeMap<String, f64>,
        hz: i64,
        vsyncs: u32,
        store: Option<PathBuf>,
    },
    Session {
        look: Look,
        steps: Vec<Step>,
        store: Option<PathBuf>,
    },
    Render {
        out: String,
        doc: Map<String, Value>,
        look: Look,
        view: View,
        t: i64,
        /// The AC6 wrong build: gradients through GPUI's own OKLab option.
        gpui_oklab: bool,
        store: Option<PathBuf>,
    },
}

fn palette(value: &Value) -> Option<Palette> {
    let Value::Object(map) = value else {
        return None;
    };
    map.iter()
        .map(|(role, rgb)| {
            let parts = rgb.as_array().filter(|p| p.len() == 3)?;
            let mut c = [0u8; 3];
            for (slot, part) in c.iter_mut().zip(parts) {
                *slot = u8::try_from(part.as_u64()?).ok()?;
            }
            Some((role.clone(), c))
        })
        .collect()
}

fn look(value: Option<&Value>) -> Option<Look> {
    let map = value?.as_object()?;
    Some(Look {
        light: palette(map.get("light")?)?,
        dark: match map.get("dark") {
            None => None,
            Some(d) => Some(palette(d)?),
        },
    })
}

fn view(value: Option<&Value>) -> Option<View> {
    let Some(value) = value else {
        return Some(View {
            zoom: 1.0,
            theme: Theme::Light,
        });
    };
    let map = value.as_object()?;
    let zoom = match map.get("zoom") {
        None => 1.0,
        Some(z) => z
            .as_f64()
            .filter(|z| z.is_finite() && *z > 0.0 && *z <= 8.0)?,
    };
    let theme = match map.get("theme").and_then(Value::as_str) {
        None | Some("light") => Theme::Light,
        Some("dark") => Theme::Dark,
        Some(_) => return None,
    };
    Some(View { zoom, theme })
}

fn readings(value: Option<&Value>) -> Option<BTreeMap<String, f64>> {
    let Some(value) = value else {
        return Some(BTreeMap::new());
    };
    value
        .as_object()?
        .iter()
        .map(|(h, n)| Some((h.clone(), n.as_f64().filter(|n| n.is_finite())?)))
        .collect()
}

/// The content-addressed store an image is read from by its sha256: a directory whose files are
/// named by their hashes. A document never names a path; only the request does.
fn store(value: Option<&Value>) -> Option<Option<PathBuf>> {
    match value {
        None => Some(None),
        Some(Value::String(dir)) => Some(Some(PathBuf::from(dir))),
        Some(_) => None,
    }
}

fn doc(value: Option<&Value>) -> Option<Map<String, Value>> {
    value?.as_object().cloned()
}

fn parse(command: &str, input: &Map<String, Value>) -> Option<Request> {
    match command {
        "frames" => {
            let hz = match input.get("refresh_hz") {
                None => 60,
                Some(v) => v.as_i64().filter(|hz| *hz > 0 && 705_600_000 % hz == 0)?,
            };
            Some(Request::Frames {
                doc: doc(input.get("doc"))?,
                look: look(input.get("look"))?,
                view: view(input.get("view"))?,
                readings: readings(input.get("readings"))?,
                hz,
                vsyncs: u32::try_from(input.get("vsyncs")?.as_u64()?)
                    .ok()
                    .filter(|n| *n <= 100_000)?,
                store: store(input.get("store"))?,
            })
        }
        "session" => {
            let look = look(input.get("look"))?;
            let steps = input
                .get("steps")?
                .as_array()?
                .iter()
                .map(|s| {
                    let s = s.as_object()?;
                    Some(Step {
                        doc: match s.get("doc") {
                            None => None,
                            d => Some(doc(d)?),
                        },
                        t: s.get("t")?.as_i64()?,
                        view: match s.get("view") {
                            None => None,
                            v => Some(view(v)?),
                        },
                        readings: match s.get("readings") {
                            None => None,
                            r => Some(readings(r)?),
                        },
                        frames: match s.get("frames") {
                            None => 5,
                            Some(f) => u32::try_from(f.as_u64()?)
                                .ok()
                                .filter(|f| (1..=600).contains(f))?,
                        },
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            // The first step opens the session, so it carries the document.
            steps.first()?.doc.as_ref()?;
            Some(Request::Session {
                look,
                steps,
                store: store(input.get("store"))?,
            })
        }
        "render" => {
            let gpui_oklab = match input.get("planted") {
                None => false,
                Some(Value::String(p)) if p == "gpui_oklab_gradient" => true,
                Some(_) => return None,
            };
            Some(Request::Render {
                out: input.get("out")?.as_str()?.to_string(),
                doc: doc(input.get("doc"))?,
                look: look(input.get("look"))?,
                view: view(input.get("view"))?,
                t: match input.get("t") {
                    None => 0,
                    Some(t) => t.as_i64()?,
                },
                gpui_oklab,
                store: store(input.get("store"))?,
            })
        }
        _ => None,
    }
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    if !["frames", "session", "render"].contains(&command.as_str()) {
        eprintln!("deep-canvas-render: usage: deep-canvas-render frames | session | render");
        std::process::exit(2);
    }
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    #[cfg(target_os = "macos")]
    let mut renderer = macos::Renderer::new();
    let mut buf = Vec::new();
    let mut reader = stdin.lock();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = std::str::from_utf8(&buf).map(|l| l.trim_end_matches(['\n', '\r']));
        let request = match line.map(serde_json::from_str::<Value>) {
            Ok(Ok(Value::Object(input))) => parse(&command, &input),
            _ => None,
        };
        let answer = match request {
            None => bad_input(),
            Some(request) => {
                #[cfg(target_os = "macos")]
                {
                    renderer.answer(request)
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = request;
                    json!({"ok": false, "code": "unsupported_platform"})
                }
            }
        };
        if writeln!(out, "{answer}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}

#[cfg(target_os = "macos")]
mod macos;
