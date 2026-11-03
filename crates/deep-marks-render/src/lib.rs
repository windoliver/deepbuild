//! `deep-canvas-render <frames|session|render|check|look|raster|geometry>`: JSON lines in, one
//! JSON line out per input line, in order, exit 0. A line that can't be read, lacks a required field or names an
//! unknown `planted` value answers `{"ok":false,"code":"bad_input"}`, before anything
//! platform-specific; off macOS every drawing line answers `{"ok":false,"code":"unsupported_platform"}`.
//! The surface is the #391 acceptance README's, with #392's added: `check` and `look` (on every
//! platform), looks by ID or as look@1, status states, readings with their as-of time, replay and
//! frame captures, and #882's: `look` answers each theme's roles; and #373's: `raster` and `geometry` (on every platform), R2's 2D marks drawn by
//! Vello CPU, and `check` with a look adding the marks2d module's own check; and #381's: `raster`
//! answers each text@1 item's shown string and glyphs (`texts`), and takes `shapes_spans_apart`;
//! and #854's: `idle`, a document held on screen on the real clock for `seconds`, its frames,
//! wakeups and CPU read from this process; and #398's: `check`, `raster` and `geometry` import
//! each `vector@1` item's SVG from the line's `store` and draw it as marks2d's items, `geometry`
//! answers a vector's `parts`, and the planted `write_fades_fills_from_start` and
//! `import_skips_clip_path`; and #221's: every frame places items by relation, `check` refuses a
//! `relation_cycle`, and `geometry` takes `t` and answers the item's `box` and its nine `points`.
//!
//! A document's view is drawn headless with GPUI's offscreen Metal renderer through GPUI's own
//! frame path, and only when the frame clock arms a frame: at the session's first frame, at a new
//! revision, view or reading, when the presented frame's `valid_until` passes, and at the pinned
//! time a bound value on screen goes stale or the age it shows ticks (canvas primitives: Frame
//! clock and scheduler). The view's zoom is the window's scale factor.
//!
//! Issue #140 adds the library entry [`layer`]: one 2D writer layer's marks drawn alone by Vello
//! CPU and by GPUI, the edges they draw and each glyph run and stroke as a coverage mask, which
//! `deep-gpu`'s live-headless calls compare.

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use deep_canvas_marks::look::{self, Look};
use deep_canvas_marks::scene::{Palette, Planted, Record};
use serde_json::{json, Map, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refused(code: &str, path: &str) -> Value {
    json!({"ok": false, "code": code, "path": path})
}

/// The seams' backends that fed a result (#140): the fonts and the CPU always, and the headless
/// renderer when Vello CPU drew it.
pub(crate) fn backends(headless: bool) -> Value {
    let mut fed = vec![
        ("fonts", deep_text::FONTS),
        ("cpu", deep_canvas_seams::cpu(std::env::consts::ARCH)),
    ];
    if headless {
        fed.push(("headless", deep_canvas_seams::HEADLESS));
    }
    deep_canvas_seams::json(&fed)
}

/// The look's roles in a theme.
fn palette_of(look: &Look, theme: Theme) -> &Palette {
    match theme {
        Theme::Dark => &look.dark,
        Theme::Light => &look.light,
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
/// frame, the view, the record, and how many frames it presents.
struct Step {
    doc: Option<Map<String, Value>>,
    t: i64,
    view: Option<View>,
    record: Option<Record>,
    frames: u32,
}

enum Request {
    Frames {
        doc: Map<String, Value>,
        look: Look,
        view: View,
        record: Record,
        hz: i64,
        vsyncs: u32,
        store: Option<PathBuf>,
        /// The host time of vsync 0.
        start: i64,
        /// In a replay, the record time vsync 0 maps to.
        replay: Option<i64>,
        /// Each vsync whose frame on screen is written as a PNG, and where.
        captures: Vec<(u32, String)>,
        /// #392 AC3's wrong program: a frame clock that arms only on readings.
        arms_only_on_readings: bool,
    },
    Session {
        look: Look,
        steps: Vec<Step>,
        store: Option<PathBuf>,
    },
    /// #854: the document held on screen on the real clock.
    Idle {
        doc: Map<String, Value>,
        look: Look,
        view: View,
        record: Record,
        seconds: u64,
        /// The wrong program: a frame clock that arms a frame each vsync.
        arms_each_vsync: bool,
    },
    Render {
        out: String,
        doc: Map<String, Value>,
        look: Look,
        view: View,
        t: i64,
        record: Record,
        /// The AC6 wrong build: gradients through GPUI's own OKLab option.
        gpui_oklab: bool,
        store: Option<PathBuf>,
    },
}

/// A line answered before any platform-specific work: a check, a look, or a refusal of either.
enum Answer {
    Now(Value),
    Draw(Box<Request>),
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

/// Each theme's roles as `#rrggbb`, or `#rrggbbaa` for a role at an alpha (#882).
fn roles(look: &Look) -> Value {
    let theme = |opaque: &Palette, alpha: &std::collections::BTreeMap<String, look::Rgba>| {
        let mut out: Map<String, Value> = opaque
            .iter()
            .map(|(r, [red, g, b])| (r.clone(), json!(format!("#{red:02x}{g:02x}{b:02x}"))))
            .collect();
        out.extend(alpha.iter().map(|(r, [red, g, b, a])| {
            (r.clone(), json!(format!("#{red:02x}{g:02x}{b:02x}{a:02x}")))
        }));
        Value::Object(out)
    };
    json!({"light": theme(&look.light, &look.light_alpha), "dark": theme(&look.dark, &look.dark_alpha)})
}

/// A look as a request names it: a shipped look's ID, a look@1 definition, or #391's role map
/// `{light, dark?}` (with no status map), with the definition it resolved from. The status guard
/// refuses a look@1 that gives two states one glyph, naming the pair.
fn look(value: Option<&Value>) -> Option<Result<(Look, Value), look::Refusal>> {
    let def = match value? {
        Value::String(id) => look::shipped(id)?,
        Value::Object(map) if map.contains_key("status") || map.contains_key("palette") => {
            Value::Object(map.clone())
        }
        Value::Object(map) => {
            let light = palette(map.get("light")?)?;
            let dark = match map.get("dark") {
                None => light.clone(),
                Some(d) => palette(d)?,
            };
            let roles = Look {
                light,
                dark,
                light_alpha: Default::default(),
                dark_alpha: Default::default(),
                status: None,
                data_distance: map
                    .get("data_distance")
                    .and_then(Value::as_f64)
                    .unwrap_or(look::DATA_DISTANCE),
            };
            return Some(Ok((roles, Value::Object(map.clone()))));
        }
        _ => return None,
    };
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    Some(look::resolve(&def, &bundled).map(|l| (l, def)))
}

/// The record a request pins: `readings` (a number, or `{value, as_of}` with its as-of time on the
/// record's clock) and `states` (handle → state).
pub fn record(input: &Map<String, Value>) -> Option<Record> {
    let mut record = Record::default();
    if let Some(value) = input.get("readings") {
        for (h, r) in value.as_object()? {
            let (value, as_of) = match r {
                Value::Object(o) => (o.get("value")?, Some(o.get("as_of")?.as_i64()?)),
                n => (n, None),
            };
            record
                .readings
                .insert(h.clone(), value.as_f64().filter(|n| n.is_finite())?);
            if let Some(a) = as_of {
                record.as_of.insert(h.clone(), a);
            }
        }
    }
    if let Some(value) = input.get("states") {
        for (h, state) in value.as_object()? {
            record.states.insert(h.clone(), state.as_str()?.to_string());
        }
    }
    Some(record)
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

/// Each imported `vector@1` item by ID (#398).
type Vectors = BTreeMap<String, deep_canvas_vector::Imported>;

/// The document check: the core's, then the vector module's import of each vector item from
/// `store`, then, with a look and no error yet, the marks2d module's over the document with its
/// vectors drawn as marks2d's items; and the imported vectors.
fn check(
    doc: &Map<String, Value>,
    look: Option<&Look>,
    store: Option<&Path>,
    skips_clip_path: bool,
) -> (Value, Vectors) {
    let result = deep_canvas::document::check(&Value::Object(doc.clone()));
    let mut issues = result.issues;
    let (found, vectors) =
        deep_canvas_vector::check(doc, |sha| asset::bytes(store, sha), skips_clip_path);
    issues.extend(found);
    // Relations (#221): a cycle through relations or parents, or a target the document lacks.
    if !issues.iter().any(|i| i.severity == "error") {
        let items = doc.get("items").and_then(Value::as_object);
        let frame = deep_canvas_marks::relations::Frame::of(doc);
        if let Err(r) =
            deep_canvas_marks::relations::check(items.unwrap_or(&Map::new()), frame.safe)
        {
            let ids = match r.chain.as_slice() {
                [] => vec![r.path.split('/').nth(1).unwrap_or("").to_string()],
                [chain @ .., _] => chain.to_vec(),
            };
            let what = if r.chain.is_empty() {
                "a relation names an item the document lacks or can't be read".to_string()
            } else {
                format!("placed by relation in a cycle: {}", r.chain.join(" → "))
            };
            let fix = if r.chain.is_empty() {
                "Name an item the document holds, as `beside`, `onto` or `to` takes it."
            } else {
                "Place one item of the chain by something outside it, so no relation reads back."
            };
            issues.push(deep_canvas::document::Issue {
                ids,
                fix: fix.into(),
                ..deep_canvas::document::Issue::error(
                    r.code,
                    "",
                    r.path,
                    json!({"chain": r.chain}),
                    &what,
                )
            });
        }
    }
    let ok = !issues.iter().any(|i| i.severity == "error");
    if let (true, Some(look)) = (ok, look) {
        let mut drawn = doc.clone();
        if let Some(Value::Object(items)) = doc.get("items") {
            let items = deep_canvas_vector::lower_items(items, &vectors, Default::default());
            drawn.insert("items".into(), Value::Object(items));
        }
        // An issue on an item a vector draws as names the vector.
        for mut issue in deep_canvas_marks::check::check(&drawn, look) {
            for id in issue.ids.iter_mut() {
                if let Some(v) = vectors.keys().find(|v| id.starts_with(&format!("{v}."))) {
                    *id = v.clone();
                }
            }
            issues.push(issue);
        }
    }
    let ok = !issues.iter().any(|i| i.severity == "error");
    let answer = json!({
        "ok": ok,
        "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>(),
        // #397: every number a mark set or an axis shows, with what it traces to.
        "numbers": deep_canvas_marks::check::numbers(doc).0,
        "notices": result.notices.iter().map(|n| n.to_json()).collect::<Vec<_>>(),
    });
    (answer, vectors)
}

/// #398 AC6's wrong program, which `check`, `raster` and `geometry` take: an importer that skips
/// `<clipPath>` without an issue. `None` for another planted value, which another command reads.
fn skips_clip_path(input: &Map<String, Value>) -> bool {
    input.get("planted").and_then(Value::as_str) == Some("import_skips_clip_path")
}

/// A document the check refuses, as a drawing command answers it: the first error's code.
fn refused_by_check(checked: &Value) -> Option<Value> {
    if checked["ok"] == json!(true) {
        return None;
    }
    let issues = checked["issues"].as_array()?;
    let first = issues.iter().find(|i| i["severity"] == "error")?;
    Some(json!({"ok": false, "code": first["code"], "issues": issues}))
}

/// Every document a line carries (`doc`, and each step's in a session) with its mark sets'
/// sidecar columns read from the line's `store` and inlined, and the line's `doc`'s table columns
/// read from its `evidence` store (#397).
fn inline_sidecars(input: &mut Map<String, Value>) -> Result<(), Value> {
    let store = input
        .get("store")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let store = store.as_deref();
    let evidence = input
        .get("evidence")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    if let Some(Value::Object(doc)) = input.get_mut("doc") {
        asset::sidecars(doc, store)?;
        asset::tables(doc, evidence.as_deref())?;
    }
    if let Some(Value::Array(steps)) = input.get_mut("steps") {
        for step in steps {
            if let Some(Value::Object(doc)) = step.get_mut("doc") {
                asset::sidecars(doc, store)?;
            }
        }
    }
    Ok(())
}

fn parse(command: &str, input: &Map<String, Value>) -> Option<Answer> {
    // `check` reads the document and the look, `look` the look alone; both answer on every
    // platform. A look the status guard refuses is the answer, and nothing is drawn.
    let look = match (command, input.get("look")) {
        ("check" | "geometry", None) => None,
        (_, value) => match look(value)? {
            Ok(found) => Some(found),
            Err(refusal) => return Some(Answer::Now(refusal.to_json())),
        },
    };
    if command == "look" {
        let (look, def) = look?;
        return Some(Answer::Now(
            json!({"ok": true, "look": def, "roles": roles(&look)}),
        ));
    }
    let skips = skips_clip_path(input);
    let store_dir = store(input.get("store"))?;
    if command == "check" || command == "geometry" {
        if input.get("planted").is_some() && !skips {
            return None;
        }
        let doc = doc(input.get("doc"))?;
        let (checked, vectors) = check(
            &doc,
            look.as_ref().map(|(l, _)| l),
            store_dir.as_deref(),
            skips,
        );
        if command == "check" {
            return Some(Answer::Now(checked));
        }
        let item = input.get("item")?.as_str()?;
        let t = input.get("t").map_or(Some(0), Value::as_i64)?;
        return Some(Answer::Now(
            refused_by_check(&checked).unwrap_or_else(|| raster::geometry(&doc, item, t, &vectors)),
        ));
    }
    let (look, _) = look?;
    if command == "raster" {
        let (planted, encoded_luma, spans_apart) = match input.get("planted") {
            None => (Planted::None, false, false),
            Some(Value::String(p)) if p == "arc_closed_along_chord" => {
                (Planted::ArcClosedAlongChord, false, false)
            }
            Some(Value::String(p)) if p == "mask_encoded_luma" => (Planted::None, true, false),
            Some(Value::String(p)) if p == "shapes_spans_apart" => (Planted::None, false, true),
            Some(Value::String(p)) if p == "reads_process_locale" => (Planted::None, false, false),
            Some(Value::String(p)) if p == "sectors_source_over" => {
                (Planted::SectorsSourceOver, false, false)
            }
            Some(Value::String(p))
                if p == "write_fades_fills_from_start" || p == "import_skips_clip_path" =>
            {
                (Planted::None, false, false)
            }
            Some(_) => return None,
        };
        let write = match input.get("planted").and_then(Value::as_str) {
            Some("write_fades_fills_from_start") => deep_canvas_vector::Write::FadesFillsFromStart,
            _ => deep_canvas_vector::Write::Honest,
        };
        let config = raster::Config {
            simd: match input.get("simd").map(Value::as_str) {
                None | Some(Some("scalar")) => raster::Simd::Scalar,
                Some(Some("neon")) => raster::Simd::Neon,
                Some(Some("detected")) => raster::Simd::Detected,
                Some(_) => return None,
            },
            u8: match input.get("pipeline").map(Value::as_str) {
                None | Some(Some("f32")) => false,
                Some(Some("u8")) => true,
                Some(_) => return None,
            },
            golden: input.get("golden").map_or(Some(true), Value::as_bool)?,
        };
        // A golden at any setting but the scalar level through the f32 pipeline draws nothing.
        if let Some(setting) = config.refusal() {
            return Some(Answer::Now(refused("golden_config", setting)));
        }
        let blend_inputs = match input.get("blend_inputs") {
            None => None,
            Some(v) => Some(PathBuf::from(v.as_str()?)),
        };
        let mut doc = doc(input.get("doc"))?;
        // #140's wrong program: the number formatter takes its marks from the process's locale.
        if input.get("planted").and_then(Value::as_str) == Some("reads_process_locale") {
            let lang = ["LC_ALL", "LC_NUMERIC", "LANG"]
                .iter()
                .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
                .unwrap_or_default();
            let locale = lang.split('.').next().unwrap_or("").replace('_', "-");
            doc.insert("locale".into(), Value::String(locale));
        }
        let request = raster::Request {
            out: input.get("out")?.as_str()?.to_string(),
            doc,
            view: view(input.get("view"))?,
            t: input.get("t").map_or(Some(0), Value::as_i64)?,
            record: record(input)?,
            store: store_dir,
            planted,
            vectors: Vectors::new(),
            write,
            encoded_luma,
            spans_apart,
            look,
            config,
            blend_inputs,
        };
        let mut request = request;
        let (checked, vectors) = check(
            &request.doc,
            Some(&request.look),
            request.store.as_deref(),
            skips,
        );
        request.vectors = vectors;
        return Some(Answer::Now(
            refused_by_check(&checked).unwrap_or_else(|| raster::answer(request)),
        ));
    }
    let request = match command {
        "frames" => {
            let hz = match input.get("refresh_hz") {
                None => 60,
                Some(v) => v.as_i64().filter(|hz| *hz > 0 && 705_600_000 % hz == 0)?,
            };
            let arms_only_on_readings = match input.get("planted") {
                None => false,
                Some(Value::String(p)) if p == "arms_only_on_readings" => true,
                Some(_) => return None,
            };
            let captures = match input.get("captures") {
                None => Vec::new(),
                Some(list) => list
                    .as_array()?
                    .iter()
                    .map(|c| {
                        let vsync = u32::try_from(c.get("vsync")?.as_u64()?).ok()?;
                        Some((vsync, c.get("out")?.as_str()?.to_string()))
                    })
                    .collect::<Option<Vec<_>>>()?,
            };
            Request::Frames {
                doc: doc(input.get("doc"))?,
                look,
                view: view(input.get("view"))?,
                record: record(input)?,
                hz,
                vsyncs: u32::try_from(input.get("vsyncs")?.as_u64()?)
                    .ok()
                    .filter(|n| *n <= 100_000)?,
                store: store(input.get("store"))?,
                start: input.get("start").map_or(Some(0), Value::as_i64)?,
                replay: match input.get("replay") {
                    None => None,
                    Some(r) => Some(r.get("record_t")?.as_i64()?),
                },
                captures,
                arms_only_on_readings,
            }
        }
        "idle" => Request::Idle {
            doc: doc(input.get("doc"))?,
            look,
            view: view(input.get("view"))?,
            record: record(input)?,
            seconds: input
                .get("seconds")?
                .as_u64()
                .filter(|s| (1..=600).contains(s))?,
            arms_each_vsync: match input.get("planted") {
                None => false,
                Some(Value::String(p)) if p == "arms_each_vsync" => true,
                Some(_) => return None,
            },
        },
        "session" => {
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
                        record: if s.contains_key("readings") || s.contains_key("states") {
                            Some(record(s)?)
                        } else {
                            None
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
            Request::Session {
                look,
                steps,
                store: store(input.get("store"))?,
            }
        }
        "render" => {
            let gpui_oklab = match input.get("planted") {
                None => false,
                Some(Value::String(p)) if p == "gpui_oklab_gradient" => true,
                Some(_) => return None,
            };
            Request::Render {
                out: input.get("out")?.as_str()?.to_string(),
                doc: doc(input.get("doc"))?,
                look,
                view: view(input.get("view"))?,
                t: input.get("t").map_or(Some(0), Value::as_i64)?,
                record: record(input)?,
                gpui_oklab,
                store: store(input.get("store"))?,
            }
        }
        _ => return None,
    };
    Some(Answer::Draw(Box::new(request)))
}

/// The binary's entry (`src/main.rs`): reads the command and answers stdin's lines.
pub fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    if ![
        "frames", "session", "render", "check", "look", "raster", "geometry", "idle",
    ]
    .contains(&command.as_str())
    {
        eprintln!(
            "deep-canvas-render: usage: deep-canvas-render frames | session | render | check | look | raster | geometry"
        );
        std::process::exit(2);
    }
    let mut out = io::stdout().lock();
    #[cfg(target_os = "macos")]
    let mut renderer = macos::Renderer::new();
    for buf in io::stdin().lock().split(b'\n') {
        let Ok(buf) = buf else { break };
        let line = std::str::from_utf8(&buf).map(|l| l.trim_end_matches(['\n', '\r']));
        let request = match line.map(serde_json::from_str::<Value>) {
            Ok(Ok(Value::Object(mut input))) => match inline_sidecars(&mut input) {
                Ok(()) => parse(&command, &input),
                Err(refusal) => Some(Answer::Now(refusal)),
            },
            _ => None,
        };
        let answer = match request {
            None => bad_input(),
            Some(Answer::Now(answer)) => answer,
            Some(Answer::Draw(request)) => {
                #[cfg(target_os = "macos")]
                {
                    renderer.answer(*request)
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

mod asset;
pub mod gpu;
pub mod layer;
#[cfg(target_os = "macos")]
mod macos;
mod place;
mod raster;
mod status;
