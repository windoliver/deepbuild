//! Issue #851: a game shell played in the replica (Check input: shell journeys). `{"call": "play", "document": <a
//! shell document>, "documents": {sha256 → document}, "assets": {sha256 → base64}, "shell": {journey, device, size}}`
//! plays one journey of the shell headless on the replica's virtual clock (`deep_logic::shell`), with each screen's
//! document evaluated and drawn here by the canvas's own 2D raster: its items' boxes in the view's pixels,
//! letterboxed into the size, and its frames kept at `<out>/frames/<sha256>.png`, and a scene change's frames as one
//! animated PNG. Frames show what happened; they decide nothing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas::show::{stamp, Writer, WriterKind};
use deep_canvas_marks::look::{self, Look};
use deep_canvas_marks::scene::Record;
use deep_canvas_marks::select;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use deep_logic::shell::run::{plants_of, Screens};
use deep_marks_raster::Renderer;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use vello_cpu::kurbo::Affine;

use super::Plant;

/// The canvas's evaluation and raster of a shell's documents.
struct Canvas {
    renderer: Renderer,
    look: Look,
    evidence: PathBuf,
    frames: PathBuf,
}

fn refused(what: String) -> Value {
    json!({"ok": false, "code": "not_drawn", "what": what})
}

impl Canvas {
    fn new(out: &Path, evidence: PathBuf) -> Canvas {
        let def = look::shipped("clean").expect("the clean look ships");
        let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
        Canvas {
            renderer: Renderer::new(),
            look: look::resolve(&def, &bundled).expect("the clean look resolves"),
            evidence,
            frames: out.join("frames"),
        }
    }

    /// The document evaluated at its start, its scale into `size` and the letterbox's offset in pixels. A screen or
    /// a level is a payload: it's stamped as the shell's own writer layer first, as the hub stamps a revision, unless
    /// it already names its layers.
    fn drawn(
        &mut self,
        doc: &Value,
        size: [f64; 2],
    ) -> Result<(deep_marks_raster::Drawn, f64, [f64; 2]), Value> {
        let stamped = if doc.get("layers").is_some() {
            doc.clone()
        } else {
            let writer = Writer {
                kind: WriterKind::Agent,
                id: "shell".into(),
            };
            let title = doc
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("shell screen")
                .to_string();
            stamp(doc.clone(), "doc-shell", &writer, &title)
                .map_err(|issues| json!({"ok": false, "code": "bad_doc", "what": format!("a screen's document can't be stamped: {issues:?}")}))?
        };
        let map = stamped
            .as_object()
            .ok_or_else(|| refused("a screen's document is an object".into()))?;
        let program = Program::compile(map)
            .map_err(|r| json!({"ok": false, "code": r.code, "what": format!("a screen's document doesn't compile: {}", r.path), "path": r.path}))?;
        let mut state = program.state();
        program.evaluate(0, Validity::Full, &mut state);
        let shown = deep_canvas_motion::eval::shown_doc(map, &program, &state);
        let map = shown.as_object().unwrap_or(map);
        let drawn = self
            .renderer
            .prepare(map, 0, &self.look.light, self.look.status.as_ref(), &Record::default(), &self.evidence)
            .map_err(|u| json!({"ok": false, "code": u.code, "what": format!("a screen's document doesn't draw: {}", u.path), "path": u.path}))?;
        let [dw, dh] = drawn.frame.size;
        let s = (size[0] / dw).min(size[1] / dh);
        let offset = [(size[0] - dw * s) / 2.0, (size[1] - dh * s) / 2.0];
        Ok((drawn, s, offset))
    }

    fn keep(&self, png: &[u8]) -> Option<String> {
        let sha = format!("{:x}", Sha256::digest(png));
        std::fs::create_dir_all(&self.frames).ok()?;
        std::fs::write(self.frames.join(format!("{sha}.png")), png).ok()?;
        Some(sha)
    }
}

impl Screens for Canvas {
    fn boxes(&mut self, doc: &Value, size: [f64; 2]) -> Result<BTreeMap<String, [f64; 4]>, Value> {
        let (drawn, s, o) = self.drawn(doc, size)?;
        let texts = select::texts(&drawn.frame, &mut deep_text::Shaper::new());
        let px = |b: [f64; 4]| [o[0] + b[0] * s, o[1] + b[1] * s, b[2] * s, b[3] * s];
        Ok(drawn
            .boxes()
            .into_iter()
            .map(|(id, b)| {
                // A text's box holds every line it draws.
                let b = match texts.iter().find(|t| t.item == id) {
                    Some(t) => {
                        let r = t.rect;
                        let (x0, y0) = (b[0].min(r[0]), b[1].min(r[1]));
                        let (x1, y1) = (
                            (b[0] + b[2]).max(r[0] + r[2]),
                            (b[1] + b[3]).max(r[1] + r[3]),
                        );
                        [x0, y0, x1 - x0, y1 - y0]
                    }
                    None => b,
                };
                (id, px(b))
            })
            .collect())
    }

    fn frame(&mut self, doc: &Value, size: [f64; 2], veil: f64) -> Option<String> {
        let (drawn, s, o) = self.drawn(doc, size).ok()?;
        let px = [
            size[0].round().max(1.0) as u16,
            size[1].round().max(1.0) as u16,
        ];
        let k = s / drawn.scale(px);
        let view = Affine::translate((o[0] / s * k, o[1] / s * k)) * Affine::scale(k);
        let ground = drawn.frame.ground;
        let mut rgba = self
            .renderer
            .raster(&drawn.part(Some(view), true, false), px, Some(ground));
        if veil > 0.0 {
            let a = veil.clamp(0.0, 1.0);
            for p in rgba.as_chunks_mut::<4>().0 {
                for c in 0..3 {
                    p[c] = (f64::from(p[c]) * (1.0 - a) + f64::from(ground[c]) * a).round() as u8;
                }
            }
        }
        let image = image::RgbaImage::from_raw(u32::from(px[0]), u32::from(px[1]), rgba)?;
        let mut png = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .ok()?;
        self.keep(&png)
    }

    fn texts(&mut self, doc: &Value, size: [f64; 2]) -> Result<BTreeMap<String, String>, Value> {
        let (drawn, _, _) = self.drawn(doc, size)?;
        let texts = select::texts(&drawn.frame, &mut deep_text::Shaper::new());
        Ok(texts.into_iter().map(|t| (t.item, t.source)).collect())
    }

    fn recording(&mut self, frames: &[String]) -> Option<String> {
        if frames.is_empty() {
            return None;
        }
        let paths: Vec<PathBuf> = frames
            .iter()
            .map(|f| self.frames.join(format!("{f}.png")))
            .collect();
        let apng = super::animated_png::animated_png(&paths, 60).ok()?;
        self.keep(&apng)
    }
}

/// The play: the shell document, its documents and programs, the journey, and the planted shell when one is chosen.
pub fn run(call: &Value, plant: Option<Plant>, out: &Path) -> Result<Value, Value> {
    let document = call.get("document").ok_or_else(
        || json!({"ok": false, "code": "bad_input", "what": "a shell's play takes its document"}),
    )?;
    if call.pointer("/shell/journey").and_then(Value::as_str) == Some("replay") {
        return replay(document, call, out);
    }
    let mut call = call.clone();
    if let Some(store) = call.pointer("/shell/store").and_then(Value::as_str) {
        let name = format!("{:x}", Sha256::digest(store.as_bytes()));
        let dir = out.join("profiles").join(name);
        std::fs::create_dir_all(&dir).map_err(
            |e| json!({"ok": false, "code": "blocked", "what": format!("{}: {e}", dir.display())}),
        )?;
        call["saves_dir"] = json!(dir);
    }
    let call = &call;
    let inline = call.get("assets").cloned().unwrap_or(json!({}));
    let evidence = call
        .get("evidence")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let stored = |sha: &str| -> Option<Vec<u8>> {
        if let Some(b) = inline.get(sha).and_then(Value::as_str) {
            return B64.decode(b).ok();
        }
        let root = evidence
            .as_ref()
            .filter(|_| sha.len() == 64 && sha.is_ascii())?;
        std::fs::read(root.join(&sha[..2]).join(&sha[2..])).ok()
    };
    let mut canvas = Canvas::new(
        out,
        evidence.clone().unwrap_or_else(|| out.join("evidence")),
    );
    let name = match plant {
        Some(Plant::ShellPauseRunsClock) => Some("pause-runs-level-clock"),
        Some(Plant::ShellFocusStaysDisabled) => Some("focus-stays-on-disabled"),
        Some(Plant::ShellPromptsKeepKeys) => Some("prompts-keep-key-glyphs"),
        Some(Plant::ShellDoneOnEnter) => Some("done-on-enter"),
        Some(Plant::ShellDoneInSave) => Some("done-in-save"),
        Some(Plant::ShellSettingInReadRegion) => Some("setting-through-reads"),
        _ => None,
    };
    // A screen's or a level's document by hash: the call's own, or one the evidence store holds.
    let docs =
        |sha: &str| -> Option<Value> { stored(sha).and_then(|b| serde_json::from_slice(&b).ok()) };
    deep_logic::shell::run::play(document, &stored, &docs, call, &mut canvas, plants_of(name))
}

fn replay(document: &Value, call: &Value, out: &Path) -> Result<Value, Value> {
    let spec = &call["shell"];
    let i = spec["of"].as_u64().unwrap_or(0) as usize;
    let levels = document
        .get("items")
        .and_then(Value::as_object)
        .and_then(|items| items.values().find(|it| it["kind"] == "shell@1"))
        .and_then(|it| it.pointer("/params/levels"))
        .and_then(Value::as_array);
    let mut level = levels
        .and_then(|l| l.get(i))
        .map(|l| l["doc"].clone())
        .unwrap_or(Value::Null);
    if let Some(h) = level.as_str().map(str::to_string) {
        let bytes = call
            .pointer(&format!("/documents/{h}"))
            .cloned()
            .or_else(|| {
                let b = call.pointer(&format!("/assets/{h}"))?.as_str()?;
                serde_json::from_slice(&B64.decode(b).ok()?).ok()
            });
        level = bytes.unwrap_or(Value::Null);
    }
    if !level.is_object() {
        return Err(
            json!({"ok": false, "code": "bad_input", "what": format!("the shell has no level {i} to replay")}),
        );
    }
    let alone = json!({"call": "play", "document": level, "assets": call.get("assets"), "seed": call.get("seed"),
                       "track": call.get("track"), "span": {"steps": spec["steps"]}, "values": spec["values"]});
    let reply = super::play::run(&alone, None, out).map_err(|f| {
        let mut e = f.0;
        e.insert("ok".into(), json!(false));
        Value::Object(e)
    })?;
    Ok(
        json!({"ok": true, "shell": {"journey": "replay", "level": i, "values": reply["values"], "final": reply["final"],
                                     "steps": reply["steps"], "entries": reply["entries"]}}),
    )
}
