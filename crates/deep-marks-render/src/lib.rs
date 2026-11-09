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
//! wakeups and CPU read from this process, and #1487's: `idle`'s `view.rect`, the region the
//! window shows, whose frame clock counts only items that meet it (planted
//! `valid_until_ignores_view`); and #398's: `check`, `raster` and `geometry` import
//! each `vector@1` item's SVG from the line's `store` and draw it as marks2d's items, `geometry`
//! answers a vector's `parts`, and the planted `write_fades_fills_from_start` and
//! `import_skips_clip_path`; and #1175's: `check` answers a `verdict` that stays INCONCLUSIVE
//! while an import dropped an element the request's `accepted` doesn't hold, and the planted
//! `import_drops_marker`; and #221's: every frame places items by relation, `check` refuses a
//! `relation_cycle`, and `geometry` takes `t` and answers the item's `box` and its nine `points`;
//! and #417's: `look` lists the shipped looks (`{"list": "shipped"}`) and answers font roles and
//! each theme's roles in OKLab, `check` and `raster` hold the status distance only where the
//! document binds status (and take the planted `status_distance_0_03`), set text in the look's
//! fonts with its fallback list and `lang`, and refuse a grapheme no face draws with
//! `text.glyph_missing`; a session's step may switch the look; and #1479's: `view.zoom` up to 16,
//! `render` answers `rasterized` (the glyphs the atlas rasterized for the line) and
//! `from_largest` (glyphs drawn from its largest raster for want of an outline), and takes the
//! planted `drops_glyph`.
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
use deep_canvas_vector::svg::Twin;
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

/// The look's type in a theme (#417): its fonts and fallback list.
fn type_of(look: &Look, theme: Theme) -> &deep_canvas_marks::scene::Type {
    match theme {
        Theme::Dark => &look.dark_type,
        Theme::Light => &look.light_type,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Theme {
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
    /// #417: the look the session is shown in from this step on.
    look: Option<Look>,
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
        /// #417 AC2's wrong program: a look switch that empties every node cache.
        switch_rebuilds: bool,
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
        /// #1487: the region of the document the window shows, `[x, y, w, h]`, and whether the
        /// planted clock counts every item wherever the view is (the merge base's rule).
        region: Option<([f64; 4], bool)>,
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
        /// #1479 AC1's wrong program: each text's second grapheme left out, silently.
        drops_glyph: bool,
        store: Option<PathBuf>,
    },
}

/// A line answered before any platform-specific work: a check, a look, or a refusal of either.
enum Answer {
    Now(Value),
    /// #160: a `path` line, answered frame by frame against the process's built tessellations.
    Path(Box<raster::PathRequest>),
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

/// Each theme's roles as `#rrggbb`, or `#rrggbbaa` for a role at an alpha (#882), and (#417) a font
/// role as the name of the look's font it names.
fn roles(look: &Look) -> Value {
    type Fonts = std::collections::BTreeMap<String, String>;
    let theme = |opaque: &Palette,
                 alpha: &std::collections::BTreeMap<String, look::Rgba>,
                 fonts: &Fonts| {
        let mut out: Map<String, Value> = opaque
            .iter()
            .map(|(r, [red, g, b])| (r.clone(), json!(format!("#{red:02x}{g:02x}{b:02x}"))))
            .collect();
        out.extend(alpha.iter().map(|(r, [red, g, b, a])| {
            (r.clone(), json!(format!("#{red:02x}{g:02x}{b:02x}{a:02x}")))
        }));
        out.extend(fonts.iter().map(|(r, f)| (r.clone(), json!(f))));
        Value::Object(out)
    };
    json!({
        "light": theme(&look.light, &look.light_alpha, &look.light_fonts),
        "dark": theme(&look.dark, &look.dark_alpha, &look.dark_fonts),
    })
}

/// A look as a request names it: a shipped look's ID, a look@1 definition, or #391's role map
/// `{light, dark?}` (with no status map), with the definition it resolved from. The status guard
/// refuses a look@1 that gives two states one glyph, naming the pair, and holds the status
/// distance `at` where it holds.
fn look(value: Option<&Value>, at: look::Distance) -> Option<Result<(Look, Value), look::Refusal>> {
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
                data_distance: map
                    .get("data_distance")
                    .and_then(Value::as_f64)
                    .unwrap_or(look::DATA_DISTANCE),
                ..Look::default()
            };
            return Some(Ok((roles, Value::Object(map.clone()))));
        }
        _ => return None,
    };
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    Some(look::resolve_in(&def, &bundled, at).map(|l| (l, def)))
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
            .filter(|z| z.is_finite() && *z > 0.0 && *z <= 16.0)?,
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

/// Whether `kind` is one this binary draws though a module owns it: `vector@1` (the vector
/// module's) and R1's mark sets, axes and scales (the data module's).
fn drawn_here(kind: &Value) -> bool {
    let name = kind.as_str().and_then(|k| k.split('@').next());
    matches!(name, Some("vector" | "marks" | "axis" | "scale" | "tiles.terrain"))
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
    (twin, distance_0_03, twin_parallax): (Twin, bool, bool),
    ctx: &formulas::Ctx,
) -> (Value, Vectors) {
    let result = deep_canvas::document::check(&Value::Object(doc.clone()));
    // This binary draws vector@1 and R1's mark sets, axes and scales itself, so their modules
    // aren't missing from it (#1162 made those kinds the vector and data modules').
    let mut issues: Vec<_> = result
        .issues
        .into_iter()
        .filter(|i| {
            let effects = i.path == "requires/modules/effects";
            !(i.code == "module_missing" && (drawn_here(&i.actual) || effects))
        })
        .collect();
    // #467: each terrain recipe expands here into its mark set, its choice fixed by its seed.
    let mut expansions = Vec::new();
    for (id, item) in doc.get("items").and_then(Value::as_object).into_iter().flatten() {
        if item.get("kind").and_then(Value::as_str) != Some(deep_canvas_marks::terrain::KIND) {
            continue;
        }
        match deep_canvas_marks::terrain::expand(id, item) {
            Ok((name, derived)) => {
                expansions.push(json!({"instance": id, "derived": {name: derived}}))
            }
            Err(r) => issues.push(deep_canvas::document::Issue::error(
                r.code,
                id,
                r.path,
                Value::Null,
                "the terrain recipe can't expand as its params say",
            )),
        }
    }
    let (found, vectors) = deep_canvas_vector::check(doc, |sha| asset::bytes(store, sha), twin);
    issues.extend(found);
    // #406: a quote's raw bytes against its source's, and a formula's numbers.
    issues.extend(deep_canvas_marks::check::quotes(doc, |sha| {
        asset::bytes(store, sha)
    }));
    let (formula_numbers, formula_issues) = deep_canvas_vector::numbers(doc);
    issues.extend(formula_issues);
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
    // #505: the formulas at t = 0 with the request's input: their refusals and checks, the
    // stretches drawn as estimates, and the items marks2d checks once they're lowered.
    let mut formula_notices: Vec<Value> = Vec::new();
    let mut curves = Map::new();
    let mut lowered = None;
    if formulas::has_formulas(doc) {
        if let Ok(program) = formulas::program(doc, ctx) {
            let mut items = doc
                .get("items")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let found = formulas::lower(doc, &program, &mut items, 0, ctx);
            for (id, p) in &found.plots {
                if let deep_canvas_marks::function::Form::Over { .. } = p.form {
                    curves.insert(
                        id.clone(),
                        json!({"bound": p.drawn.bound, "estimate": p.drawn.estimates}),
                    );
                }
            }
            issues.extend(found.issues);
            formula_notices = found.notices;
            lowered = Some(items);
        }
    }
    let ok = !issues.iter().any(|i| i.severity == "error");
    if let (true, Some(look)) = (ok, look) {
        let mut drawn = doc.clone();
        if let Some(Value::Object(items)) = lowered
            .as_ref()
            .map(|i| Value::Object(i.clone()))
            .as_ref()
            .or(doc.get("items"))
        {
            let mut items = deep_canvas_vector::lower_items(items, &vectors, Default::default());
            // A terrain draws as the atlas set it expands into, which marks2d doesn't check.
            items.retain(|_, i| {
                i.get("kind").and_then(Value::as_str) != Some(deep_canvas_marks::terrain::KIND)
            });
            // #399: graphs draw as marks2d's items, and labels place where the view draws them.
            let items = match graphs::lower(doc, &items, &vectors, Default::default()) {
                Ok((mut items, _)) => {
                    items.retain(|_, i| i.get("kind").and_then(Value::as_str) != Some("label@1"));
                    items
                }
                Err(refusal) => {
                    issues.push(deep_canvas::document::Issue::error(
                        graphs::code(&refusal),
                        "",
                        refusal["path"].as_str().unwrap_or("").to_string(),
                        json!(null),
                        "the graph can't be laid out as its params say",
                    ));
                    items
                }
            };
            drawn.insert("items".into(), Value::Object(items));
        }
        // An issue on an item a vector draws as names the vector.
        // #417 AC9's wrong check compares against 0.03 in place of the look's status distance.
        let min = distance_0_03.then_some(0.03);
        // #467 AC6's wrong check compares a band's offsets without the repeat's modulo.
        let unwrapped = twin_parallax;
        let checked = deep_canvas_marks::check::check(&drawn, look, min);
        let checked = checked.into_iter().filter(|i| !(unwrapped && i.code == "parallax_loop_jump"));
        let planted = unwrapped.then(|| deep_canvas_marks::fields::loop_issues(doc, false));
        for mut issue in checked.chain(planted.into_iter().flatten()) {
            for id in issue.ids.iter_mut() {
                if let Some(v) = vectors.keys().find(|v| id.starts_with(&format!("{v}."))) {
                    *id = v.clone();
                }
            }
            issues.push(issue);
        }
    }
    let ok = !issues.iter().any(|i| i.severity == "error");
    let numbers = [deep_canvas_marks::check::numbers(doc).0, formula_numbers].concat();
    let answer = json!({
        "ok": ok,
        "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>(),
        // #397: every number a mark set or an axis shows, with what it traces to; #406: a
        // template's story numbers, a quote's quotation and a formula's numbers.
        "numbers": numbers,
        "notices": result.notices.iter().map(|n| n.to_json()).chain(formula_notices).collect::<Vec<_>>(),
        "curves": curves,
        "lowered": result.lowered,
        "expansions": expansions,
    });
    (answer, vectors)
}

/// The importer `check`, `raster` and `geometry` take: #398 AC6's wrong program, which skips
/// `<clipPath>` without an issue, or #1175 AC2's, which drops `<marker>` with only a warning; the
/// honest one for another planted value, which another command reads.
fn import_twin(input: &Map<String, Value>) -> Twin {
    match input.get("planted").and_then(Value::as_str) {
        Some("import_skips_clip_path") => Twin::SkipsClipPath,
        Some("import_drops_marker") => Twin::DropsMarker,
        _ => Twin::Honest,
    }
}

/// #1175: the issues a person accepted, `[{item, element}]`; `None` when malformed.
fn accepted(value: Option<&Value>) -> Option<Vec<(String, String)>> {
    let Some(value) = value else {
        return Some(Vec::new());
    };
    value
        .as_array()?
        .iter()
        .map(|a| {
            let field = |k: &str| a.get(k).and_then(Value::as_str).map(str::to_string);
            Some((field("item")?, field("element")?))
        })
        .collect()
}

/// #1175: the check's verdict. Each element or attribute an import didn't draw as the SVG writes
/// it is open until the person accepts it; with no error, open items make it INCONCLUSIVE, never
/// PASS.
fn verdict(checked: &mut Value, accepted: &[(String, String)]) {
    let mut open: Vec<Value> = Vec::new();
    for issue in checked["issues"].as_array().into_iter().flatten() {
        let (Some("svg_unsupported"), Some(item), Some(element)) = (
            issue["code"].as_str(),
            issue["ids"][0].as_str(),
            issue["actual"].as_str(),
        ) else {
            continue;
        };
        let entry = json!({"item": item, "element": element});
        let taken = accepted.iter().any(|(i, e)| i == item && e == element);
        if !taken && !open.contains(&entry) {
            open.push(entry);
        }
    }
    let outcome = match (checked["ok"] == json!(true), open.is_empty()) {
        (false, _) => "FAIL",
        (true, false) => "INCONCLUSIVE",
        (true, true) => "PASS",
    };
    checked["verdict"] = json!({"outcome": outcome, "open": open});
}

/// #417 AC9's wrong program, which `check` and `raster` take: a status distance of 0.03.
fn distance_0_03(input: &Map<String, Value>) -> bool {
    input.get("planted").and_then(Value::as_str) == Some("status_distance_0_03")
}

/// A look's answer: its definition, each theme's roles, and (#417) each theme's opaque roles in
/// OKLab as resolved.
fn look_answer(look: &Look, def: Value) -> Value {
    let oklab = |m: &std::collections::BTreeMap<String, [f64; 3]>| {
        Value::Object(m.iter().map(|(r, l)| (r.clone(), json!(l))).collect())
    };
    json!({"ok": true, "look": def, "roles": roles(look),
           "oklab": {"light": oklab(&look.light_oklab), "dark": oklab(&look.dark_oklab)}})
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
    if command == "look" && input.get("list").is_some() {
        if input.get("list").and_then(Value::as_str) != Some("shipped") {
            return None;
        }
        return Some(Answer::Now(json!({"ok": true, "shipped": look::SHIPPED})));
    }
    // The look's own guard holds the status distance everywhere, as the app's look; a document's
    // look, only where the document binds status, which its check judges (#417).
    let at = if command == "look" {
        look::Distance::Everywhere
    } else {
        look::Distance::WhereStatusShows
    };
    let look = match (command, input.get("look")) {
        ("check" | "geometry" | "path", None) => None,
        (_, value) => match look(value, at)? {
            Ok(found) => Some(found),
            Err(refusal) => return Some(Answer::Now(refusal.to_json())),
        },
    };
    if command == "look" {
        let (look, def) = look?;
        return Some(Answer::Now(look_answer(&look, def)));
    }
    let skips = import_twin(input);
    let near = distance_0_03(input);
    let unwrapped = input.get("planted").and_then(Value::as_str) == Some("parallax_without_modulo");
    let store_dir = store(input.get("store"))?;
    // #505: the input track the document's controls read, and a formula's planted program.
    let formula_plant = input
        .get("planted")
        .and_then(Value::as_str)
        .and_then(deep_canvas_marks::function::Planted::named);
    let ctx = formulas::Ctx {
        input: formulas::input_of(input.get("input"))?,
        planted: formula_plant.unwrap_or_default(),
    };
    if command == "path" {
        let planted = match input.get("planted") {
            None => Planted::None,
            Some(Value::String(p)) => raster::planted_path(p)?,
            Some(_) => return None,
        };
        let doc = doc(input.get("doc"))?;
        let item = input.get("item")?.as_str()?.to_string();
        let times: Vec<i64> = match input.get("times") {
            None => vec![0],
            Some(Value::Array(list)) => {
                list.iter().map(Value::as_i64).collect::<Option<Vec<_>>>()?
            }
            Some(_) => return None,
        };
        let anchors: Vec<String> = match input.get("anchors") {
            None => Vec::new(),
            Some(Value::Array(list)) => list
                .iter()
                .map(|v| v.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()?,
            Some(_) => return None,
        };
        let timing = match input.get("timing") {
            None => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return None,
        };
        let (checked, vectors) = check(
            &doc,
            look.as_ref().map(|(l, _)| l),
            store_dir.as_deref(),
            (skips, near, unwrapped),
            &ctx,
        );
        if let Some(refused) = refused_by_check(&checked) {
            return Some(Answer::Now(refused));
        }
        return Some(Answer::Path(Box::new(raster::PathRequest {
            doc,
            item,
            times,
            anchors,
            timing,
            planted,
            look: look.map(|(l, _)| l),
            vectors,
        })));
    }
    // #399 AC7's wrong router, which `geometry` takes.
    let straight = input.get("planted").and_then(Value::as_str) == Some("straight_router");
    if command == "check" || command == "geometry" {
        if input.get("planted").is_some()
            && skips == Twin::Honest
            && !near
            && !(unwrapped && command == "check")
            && !(straight && command == "geometry")
            && formula_plant.is_none()
        {
            return None;
        }
        let doc = doc(input.get("doc"))?;
        let (checked, vectors) = check(
            &doc,
            look.as_ref().map(|(l, _)| l),
            store_dir.as_deref(),
            (skips, near, unwrapped),
            &ctx,
        );
        let timing = input.get("timing") == Some(&Value::Bool(true));
        if command == "check" {
            let mut checked = checked;
            if timing {
                match raster::rank_ms(&doc) {
                    Ok(rank_ms) => checked["timing"] = json!({"rank_ms": rank_ms}),
                    Err(r) => return Some(Answer::Now(refused(r.code, &r.path))),
                }
            }
            verdict(&mut checked, &accepted(input.get("accepted"))?);
            // #149: a look's `fw` and `fh` read the document it draws.
            if let (Some((_, def)), Some(frame)) = (
                look.as_ref(),
                deep_canvas::document::frame_of(&Value::Object(doc.clone())),
            ) {
                let mut lowered = def.clone();
                deep_canvas::grammar::lower_frame_literals(&mut lowered, frame);
                checked["lowered_look"] = lowered;
            }
            return Some(Answer::Now(checked));
        }
        let item = input.get("item")?.as_str()?;
        let t = input.get("t").map_or(Some(0), Value::as_i64)?;
        let color_at: Option<Vec<f64>> = match input.get("color_at") {
            None => None,
            Some(v) => Some(
                v.as_array()?
                    .iter()
                    .map(Value::as_f64)
                    .collect::<Option<_>>()?,
            ),
        };
        return Some(Answer::Now(refused_by_check(&checked).unwrap_or_else(
            || {
                let router = if straight {
                    deep_canvas_graph::view::Router::Straight
                } else {
                    deep_canvas_graph::view::Router::Orthogonal
                };
                let look = look.as_ref().map(|(l, _)| l);
                raster::geometry(
                    &doc,
                    item,
                    t,
                    &vectors,
                    router,
                    (look, timing),
                    (&ctx, color_at.as_deref()),
                )
            },
        )));
    }
    let (look, _) = look?;
    // #399: the view's label placement at each stop of a camera path, and a series' crosshair.
    if command == "labels" {
        let placer = match input.get("planted") {
            None => graphs::Placer::Honest,
            Some(v) if v == "folds_every_label" => graphs::Placer::FoldsEveryLabel,
            Some(_) => return None,
        };
        let stops = input
            .get("path")?
            .as_array()?
            .iter()
            .map(|s| {
                let zoom = s
                    .get("zoom")?
                    .as_f64()
                    .filter(|z| *z > 0.0 && z.is_finite())?;
                Some((zoom, s.get("t").map_or(Some(0), Value::as_i64)?))
            })
            .collect::<Option<Vec<_>>>()?;
        let doc = doc(input.get("doc"))?;
        let (checked, vectors) = check(
            &doc,
            Some(&look),
            store_dir.as_deref(),
            (Twin::Honest, false, false),
            &formulas::Ctx::default(),
        );
        if let Some(refusal) = refused_by_check(&checked) {
            return Some(Answer::Now(refusal));
        }
        let mut boards: BTreeMap<i64, graphs::Board> = BTreeMap::new();
        let mut steps = Vec::with_capacity(stops.len());
        for (zoom, t) in stops {
            let board = match boards.entry(t) {
                std::collections::btree_map::Entry::Occupied(b) => b.into_mut(),
                std::collections::btree_map::Entry::Vacant(slot) => {
                    match raster::label_board(&doc, &look, t, &vectors) {
                        Ok(b) => slot.insert(b),
                        Err(refusal) => return Some(Answer::Now(refusal)),
                    }
                }
            };
            let (bucket, labels, folded) = board.stop(zoom, placer);
            steps.push(
                json!({"zoom": zoom, "bucket": bucket, "t": t, "folded": folded, "labels": labels}),
            );
        }
        return Some(Answer::Now(json!({"ok": true, "steps": steps})));
    }
    if command == "crosshair" {
        if input.get("planted").is_some() {
            return None;
        }
        let doc = doc(input.get("doc"))?;
        let item = input.get("item")?.as_str()?;
        let x = input.get("x")?.as_f64()?;
        return Some(Answer::Now(raster::crosshair(&doc, item, x)));
    }
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
            Some(Value::String(p)) if p == "merge_zero_fills" => {
                (Planted::MergeZeroFills, false, false)
            }
            Some(Value::String(p)) if p == "decimate_first_last" => {
                (Planted::DecimateFirstLast, false, false)
            }
            Some(Value::String(p)) if p == "decimate_min_max" => {
                (Planted::DecimateMinMax, false, false)
            }
            Some(Value::String(p))
                if p == "write_fades_fills_from_start"
                    || p == "import_skips_clip_path"
                    || p == "import_drops_marker"
                    || p == "status_distance_0_03"
                    || p == "triangle_peaks_at_start"
                    || p == "on_curve_left_edge"
                    || p == "roll_moves_every_grapheme"
                    || p == "weight_snaps_to_static"
                    || p == "stops_at_midpoint"
                    || p == "drops_cells_by_corner_signs" =>
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
            antialias: input.get("antialias").map_or(Some(true), Value::as_bool)?,
            encoded_luma,
            spans_apart,
            look,
            config,
            blend_inputs,
            text_plant: match input.get("planted").and_then(Value::as_str) {
                Some("triangle_peaks_at_start") => {
                    deep_canvas_marks::animator::Plant::TrianglePeaksAtStart
                }
                Some("on_curve_left_edge") => deep_canvas_marks::animator::Plant::OnCurveLeftEdge,
                Some("roll_moves_every_grapheme") => {
                    deep_canvas_marks::animator::Plant::RollMovesEveryGrapheme
                }
                _ => deep_canvas_marks::animator::Plant::None,
            },
            snaps_weight: input.get("planted").and_then(Value::as_str)
                == Some("weight_snaps_to_static"),
            formulas: ctx,
        };
        let mut request = request;
        // #496: the runs this line shapes, its check included, counted from here.
        deep_text::cache::record();
        let _ = deep_text::cache::take_log();
        raster::preshape(&request);
        let (checked, vectors) = check(
            &request.doc,
            Some(&request.look),
            request.store.as_deref(),
            (skips, near, unwrapped),
            &request.formulas,
        );
        request.vectors = vectors;
        let mut answer = refused_by_check(&checked).unwrap_or_else(|| raster::answer(request));
        if answer.get("ok") == Some(&Value::Bool(true)) {
            answer["shaped"] = json!(deep_text::cache::take_log().len());
        }
        return Some(Answer::Now(answer));
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
                Some(Value::String(p)) if p == "valid_until_ignores_view" => false,
                Some(_) => return None,
            },
            region: match input.get("view").and_then(|v| v.get("rect")) {
                None => None,
                Some(r) => {
                    let r: Vec<f64> = r
                        .as_array()?
                        .iter()
                        .map(Value::as_f64)
                        .collect::<Option<_>>()?;
                    let [x, y, w, h] = r[..] else { return None };
                    if !(r.iter().all(|n| n.is_finite()) && w > 0.0 && h > 0.0) {
                        return None;
                    }
                    let ignores = input.get("planted").and_then(Value::as_str)
                        == Some("valid_until_ignores_view");
                    Some(([x, y, w, h], ignores))
                }
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
                        look: match s.get("look") {
                            None => None,
                            l => match self::look(l, at)? {
                                Ok((l, _)) => Some(l),
                                Err(_) => return None,
                            },
                        },
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            // The first step opens the session, so it carries the document.
            steps.first()?.doc.as_ref()?;
            let switch_rebuilds = match input.get("planted") {
                None => false,
                Some(Value::String(p)) if p == "look_switch_rebuilds" => true,
                Some(_) => return None,
            };
            Request::Session {
                look,
                steps,
                store: store(input.get("store"))?,
                switch_rebuilds,
            }
        }
        "render" => {
            let (gpui_oklab, drops_glyph) = match input.get("planted") {
                None => (false, false),
                Some(Value::String(p)) if p == "gpui_oklab_gradient" => (true, false),
                Some(Value::String(p)) if p == "drops_glyph" => (false, true),
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
                drops_glyph,
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
        "frames",
        "session",
        "render",
        "check",
        "look",
        "raster",
        "geometry",
        "idle",
        "labels",
        "crosshair",
        "path",
    ]
    .contains(&command.as_str())
    {
        eprintln!(
            "deep-canvas-render: usage: deep-canvas-render frames | session | render | check | look | raster | geometry | labels | crosshair | path"
        );
        std::process::exit(2);
    }
    let mut out = io::stdout().lock();
    // #160: the tessellations this process built, by their key, so `path` reports what a later
    // frame reused.
    let mut built = std::collections::BTreeSet::new();
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
            Some(Answer::Path(request)) => raster::path_answer(*request, &mut built),
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
mod formulas;
pub mod gpu;
mod graphs;
pub mod layer;
#[cfg(target_os = "macos")]
mod macos;
mod place;
mod raster;
mod status;
