//! Issue #412: `deep_kinds` (technical design: the agent-tools paragraph; the #412 acceptance
//! README: deep_kinds). One listing for every registry and hub slot, `deep://registries` in the one
//! shape, with the kinds as entries of `kind@1`, the canvas modules with their versions, the
//! module-set digest, and each canvas interface with the implementation the build chose; a
//! familiar-names pack's words, answered from its aliases and never inferred; search over the
//! entries, the installed guides and the gallery of example documents, each example pinned by its
//! hash and never served when its bytes don't match; the gallery's verified marks from corpus runs
//! that played the steps an example declares; the one-page sheet; and the canonical dump and the
//! diff of two dumps, reading renames and retirements only from migration records.
//!
//! Every reply that could pass 64 KB is cut there with a cursor. A refusal is `{"error": error@2}`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use deep_canvas::canon::NoShape;
use deep_canvas::kinds::{Entry, ParamType, Version};
use deep_canvas::registry::lists::entry_digest;
use deep_canvas::registry::{core_name, Sealed};
use deep_canvas::schedule::sha256_hex;
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// No reply passes this many bytes of JSON without a cursor.
pub const REPLY_CAP: usize = 65_536;
/// What a page's own content may take, leaving room for the fields every reply carries.
const PAGE_BUDGET: usize = REPLY_CAP - 8_192;
/// A page of a guide, in bytes of its text, so its reply stays under the cap.
const GUIDE_PAGE: usize = 32_768;
/// The sheet's cap.
pub const SHEET_CAP: usize = 32_768;

/// The planted wrong programs a startup argument names (the #412 acceptance README).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// The listing names each interface's reference implementation.
    NamesReference,
    ListingWithoutPackEntries,
    /// Every unit field offers `1/2m` beside its grammar's forms.
    FormRefusedByGrammar,
    ListingWithoutStability,
    /// Each entry's moves are the text stored for `test-cue`'s defaults, not its expansion.
    MovesStoredText,
    SheetWithoutPackEntries,
    /// The dump writes each entry's fields as an object keyed by name.
    DumpFieldsByName,
    /// The diff pairs fields by spelling, reading no migration record.
    DiffBySpelling,
    /// An example whose last run exited 0 is listed verified, whatever it played.
    VerifiedByExit,
    /// #546: the step ceilings publish the fuel budget's cap as every ceiling.
    StepCeilingsCap,
    /// #546: the logic guide's dice game rolls from the step's seed.
    DiceFromStepSeed,
    /// #1971: the listing `op: field` prints from leaves out `test.slab@3`'s `corner`.
    FieldWithoutCorner,
    /// #1971: the line `op: field` answers for `test.slab@3.width` is padded to 600 bytes.
    FieldLine600Bytes,
    /// #1971: an object path answers its kind's lines in field-name order.
    FieldObjectByName,
    /// #1973: the line `op: field` answers for `slab@1.size` prints its type, `json`, and no form.
    FieldSizeJsonAlone,
    /// #1974: `puff@1`'s reader takes 2 for a radius left out, where its line says 1.
    DefaultsReaderFallsBackTo2,
    /// #1974: that reader, and a defaults run that builds nothing: it compares each default the
    /// line prints with the dump's.
    DefaultsComparedWithDumpOnly,
    /// #1974: the defaults run skips every field typed json.
    DefaultsSkipJson,
    /// #548: the bindings generator orders each region's fields by name before laying them out.
    BindingsByName,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        Some(match name {
            "kinds_names_reference" => Planted::NamesReference,
            "listing_without_pack_entries" => Planted::ListingWithoutPackEntries,
            "form_refused_by_grammar" => Planted::FormRefusedByGrammar,
            "listing_without_stability" => Planted::ListingWithoutStability,
            "moves_stored_text" => Planted::MovesStoredText,
            "sheet_without_pack_entries" => Planted::SheetWithoutPackEntries,
            "dump_fields_by_name" => Planted::DumpFieldsByName,
            "diff_by_spelling" => Planted::DiffBySpelling,
            "verified_by_exit" => Planted::VerifiedByExit,
            "step_ceilings_publish_fuel_cap" => Planted::StepCeilingsCap,
            "guide_dice_rolls_from_step_seed" => Planted::DiceFromStepSeed,
            "field_listing_without_corner" => Planted::FieldWithoutCorner,
            "field_line_600_bytes" => Planted::FieldLine600Bytes,
            "field_object_by_name" => Planted::FieldObjectByName,
            "field_size_json_alone" => Planted::FieldSizeJsonAlone,
            "defaults_reader_falls_back_to_2" => Planted::DefaultsReaderFallsBackTo2,
            "defaults_compared_with_dump_only" => Planted::DefaultsComparedWithDumpOnly,
            "defaults_skip_json" => Planted::DefaultsSkipJson,
            "bindings_fields_by_name" => Planted::BindingsByName,
            _ => return None,
        })
    }
}

/// The moves stored for `pop_in` at 0.5 s: the planted listing that is text, not its expansion.
const STORED_MOVES: &str = r#"[{"path":"at/scale","from":0.0,"to":1.0,"start":0.0,"span":0.5,"ease":{"spring":{"frequency":4.0,"damping_ratio":0.3,"decay":7.5398223686155035,"peak":{"at":0.1309993642018405,"value":1.3729475476163014}}}}]"#;

/// An `op: field` miss (#1971): `unknown_field` in the shared shape (error@4), its remediation
/// naming the close names in order, a rename with the kind version that made it.
fn field_miss(path: &str, what: &str, close: &[Value]) -> Value {
    let named: Vec<String> = close
        .iter()
        .map(|c| {
            let n = c["name"].as_str().unwrap_or_default();
            match (c["renamed_in"].as_str(), c["defines"].as_str()) {
                (Some(k), _) => format!("{n} (renamed in {k})"),
                (_, Some(f)) => format!("{n}, which defines {f}"),
                _ => n.to_string(),
            }
        })
        .collect();
    let remediation = match named.as_slice() {
        [] => format!("{what}."),
        [one] => format!("{what}. Did you mean {one}?"),
        [rest @ .., last] => format!("{what}. Did you mean {} or {last}?", rest.join(", ")),
    };
    refused("unknown_field", "/path", &remediation, path)
}

/// A refusal in the shared shape (error@2).
fn refused(code: &str, path: &str, remediation: &str, actual: &str) -> Value {
    json!({"error": {"code": code, "retryable": false, "remediation": remediation, "path": path,
                     "actual": actual.chars().take(8192).collect::<String>(), "evidence": []}})
}

// ---------------------------------------------------------------------------------------------
// The installed guides and gallery, and a scenario's folder in their place.

/// The installed corpus: the gallery index and each file it names, as this build ships them.
const INSTALLED: &[(&str, &str)] = &[
    ("gallery.json", include_str!("../gallery/gallery.json")),
    (
        "product-reveal.json",
        include_str!("../gallery/product-reveal.json"),
    ),
    (
        "data-story.json",
        include_str!("../gallery/data-story.json"),
    ),
    (
        "canvas-working-order.md",
        include_str!("../gallery/canvas-working-order.md"),
    ),
    (
        "familiar-names.md",
        include_str!("../gallery/familiar-names.md"),
    ),
    ("logic.md", include_str!("../gallery/logic.md")),
    // #548: logic@1's example, and its program's source.
    (
        "logic-counter.json",
        include_str!("../gallery/logic-counter.json"),
    ),
    (
        "logic-counter.wat",
        include_str!("../gallery/logic-counter.wat"),
    ),
];

/// One example of the gallery, as its index records it.
#[derive(Clone, Debug)]
struct Example {
    file: String,
    hash: String,
    title: String,
    steps: u64,
    words: Vec<String>,
    /// #548: the file holding the source of the program it runs, served beside it.
    source: Option<String>,
}

/// The guides and gallery a call reads: the installed corpus, or a scenario's folder.
struct Corpus {
    dir: Option<PathBuf>,
    examples: Vec<Example>,
    /// `(name, title, file)`.
    guides: Vec<(String, String, String)>,
}

impl Corpus {
    fn read(dir: Option<&Path>) -> Option<Corpus> {
        let index: Value = match dir {
            Some(d) => serde_json::from_slice(&std::fs::read(d.join("gallery.json")).ok()?).ok()?,
            None => serde_json::from_str(INSTALLED[0].1).ok()?,
        };
        let text = |v: &Value, k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let examples = index["examples"]
            .as_array()?
            .iter()
            .map(|e| Example {
                file: text(e, "file"),
                hash: text(e, "hash"),
                title: text(e, "title"),
                steps: e.get("steps").and_then(Value::as_u64).unwrap_or(0),
                words: e["words"]
                    .as_array()
                    .map(|w| {
                        w.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
                source: e.get("source").and_then(Value::as_str).map(str::to_string),
            })
            .collect();
        let guides = index["guides"]
            .as_array()?
            .iter()
            .map(|g| (text(g, "name"), text(g, "title"), text(g, "file")))
            .collect();
        Some(Corpus {
            dir: dir.map(Path::to_path_buf),
            examples,
            guides,
        })
    }

    /// A file's stored bytes.
    fn bytes(&self, file: &str) -> Option<Vec<u8>> {
        match &self.dir {
            Some(d) => std::fs::read(d.join(file)).ok(),
            None => INSTALLED
                .iter()
                .find(|(f, _)| *f == file)
                .map(|(_, t)| t.as_bytes().to_vec()),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The listing.

/// A kind's fields in the one shape: each param with its type, unit, range, whether it takes a
/// list and its default; a field that takes a literal also lists its grammar and the forms the
/// grammar's printer writes.
fn fields_of(version: &Version, planted: Option<Planted>) -> Vec<Value> {
    version
        .params
        .iter()
        .map(|p| {
            let mut f = json!({
                "name": p.name,
                "type": match p.ty { ParamType::F32 => "number", ParamType::Str => "string", ParamType::Json(_) => "json" },
                "unit": if p.unit.is_empty() { Value::Null } else { json!(p.unit) },
                "range": match (p.min, p.max) { (None, None) => Value::Null, (lo, hi) => json!([lo, hi]) },
                "list": p.default.is_array(),
                "default": p.default,
            });
            if p.ty == ParamType::F32 && !p.unit.is_empty() {
                // The forms the grammar reads in this unit on their own: a frame-relative form
                // needs a document's frame, which a listing has none of.
                let mut forms: Vec<String> = deep_canvas::document::literal_forms(p.unit)
                    .into_iter()
                    .filter(|f| parses_to(f, p.unit))
                    .collect();
                if planted == Some(Planted::FormRefusedByGrammar) {
                    forms.push("1/2m".into());
                }
                f["grammar"] = json!("unit");
                f["forms"] = json!(forms);
            }
            if let ParamType::Json(declared) = p.ty {
                // #1973: the forms its reader declares, one per alternative, printed from the
                // parsed declaration.
                f["grammar"] = json!("form");
                f["forms"] = json!(declared_forms(declared));
            }
            f
        })
        .collect()
}

/// A structured field's forms as `deep_kinds` prints them: each alternative of its parsed
/// declaration (#1973). A declaration the form language can't read prints none, and the kit's
/// every-field test fails naming it.
pub(crate) fn declared_forms(declared: &str) -> Vec<String> {
    deep_canvas::form::parse(declared)
        .map(|f| f.alternatives().iter().map(|a| a.print()).collect())
        .unwrap_or_default()
}

/// Whether `form` reads in the unit grammar as a value in `unit`, with no document's frame.
fn parses_to(form: &str, unit: &str) -> bool {
    use deep_canvas::grammar::{UnitContext, UnitLiteral};
    UnitLiteral::parse(form)
        .and_then(|l| l.convert(unit, &UnitContext::default()))
        .is_ok()
}

/// A kind's params as a JSON Schema in the contracts' closed node list: a number in its range, a
/// string, or a structured value its own reader checks.
fn schema_of(version: &Version) -> Value {
    let properties: Map<String, Value> = version
        .params
        .iter()
        .map(|p| {
            let s = match p.ty {
                ParamType::F32 => {
                    let mut s = json!({"type": "number"});
                    if let Some(lo) = p.min {
                        s["minimum"] = json!(lo);
                    }
                    if let Some(hi) = p.max {
                        s["maximum"] = json!(hi);
                    }
                    s
                }
                ParamType::Str => json!({"type": "string"}),
                ParamType::Json(_) => {
                    json!({"x-opaque": "a structured value the kind's own reader checks"})
                }
            };
            (p.name.to_string(), s)
        })
        .collect();
    json!({"type": "object", "properties": properties, "required": [], "additionalProperties": false})
}

/// The params an example item of a kind takes: each param's default that isn't null.
fn example_params(version: &Version) -> Map<String, Value> {
    version
        .params
        .iter()
        .filter(|p| !p.default.is_null())
        .map(|p| (p.name.to_string(), p.default.clone()))
        .collect()
}

/// An example of a kind drawn with no kind-registry entry: its params, the items it reads beside
/// it (a scale, a matte's source and target, an overlay's frame and anchor), and the modules
/// those need (#1973: every listed kind has an example).
struct Drawn {
    params: Value,
    others: Value,
    modules: &'static [&'static str],
}

/// An item of an example beside the kind's own.
fn other(id: &str, kind: &str, order: &str, params: Value) -> (String, Value) {
    let name = id.to_uppercase();
    (
        id.to_string(),
        json!({"id": id, "kind": kind, "name": name, "order": order, "params": params}),
    )
}

/// Examples for the kinds the marks module, the data module and scene3d draw with no
/// kind-registry entry, each from the reader that draws it.
fn drawn_example(kind: &str) -> Option<Drawn> {
    let alone = |params: Value| Drawn {
        params,
        others: json!({}),
        modules: &[],
    };
    let accent = json!({"fill": {"role": "accent"}});
    let scale = |range: [f64; 2]| json!({"type": "linear", "domain": [0, 10], "range": range});
    let camera = || {
        other(
            "cam",
            "camera@1",
            "b0",
            json!({"projection": "perspective", "position": [4, 3, 5], "target": [0, 0, 0], "fov": 40}),
        )
    };
    Some(match kind {
        "rect@1" => alone(json!({"box": [16, 16, 128, 72], "paint": accent})),
        "text@1" => alone(
            json!({"font": "body", "size": 13, "box": {"w": 160, "h": 20}, "text": "A label"}),
        ),
        "path@1" => alone(json!({"d": "M 16 16 L 144 88", "paint": {"stroke": {"role": "ink"}}})),
        // An image names its asset by hash; the document's store holds the bytes.
        "image@1" => alone(json!({
            "asset": "0".repeat(64), "box": [16, 16, 128, 72], "fit": "contain",
            "alt": "A placeholder image",
        })),
        // Three points from one f32 column (60, 160 and 260, little-endian, in base64).
        "marks@1" => alone(json!({
            "mark": "point", "n": 3,
            "columns": {"x": {"dtype": "f32", "len": 3, "data": "AABwQgAAIEMAAIJD"}},
            "encode": {"x": {"column": "x"}, "y": 100}, "paint": accent,
        })),
        "scale@1" => alone(scale([16.0, 304.0])),
        "axis@1" => Drawn {
            params: json!({"scale": "xs", "side": "bottom", "at": 160}),
            others: Value::Object(Map::from_iter([other(
                "xs",
                "scale@1",
                "b0",
                scale([16.0, 304.0]),
            )])),
            modules: &[],
        },
        "mask@1" => alone(json!({"shape": "rect", "box": [16, 16, 288, 168]})),
        "group@1" => alone(json!({"opacity": 1})),
        "star@1" => alone(json!({
            "center": [160, 100], "points": 5, "outer_r": 60, "inner_r": 26, "paint": accent,
        })),
        "frame@1" => alone(
            json!({"box": [16, 16, 288, 168], "radius": 8, "paint": {"fill": {"role": "muted"}}}),
        ),
        // A matte draws its hidden source's coverage over its target.
        "matte@1" => Drawn {
            params: json!({"mode": "alpha", "source": "s", "applies_to": "r"}),
            others: Value::Object(Map::from_iter([
                other(
                    "r",
                    "rect@1",
                    "b0",
                    json!({"box": [16, 16, 288, 168], "paint": accent}),
                ),
                (
                    "s".into(),
                    json!({"id": "s", "kind": "circle@1", "name": "S", "order": "b1", "visible": false,
                           "params": {"center": [160, 100], "r": 60, "paint": {"fill": {"role": "ink"}}}}),
                ),
            ])),
            modules: &[],
        },
        "axes3d@1" => {
            let unit = json!({"domain": [0, 1], "range": [0, 2]});
            Drawn {
                params: json!({"x": "sx", "y": "sy", "z": "sz", "lengths": [2, 2, 2]}),
                others: Value::Object(Map::from_iter([
                    camera(),
                    other("sx", "scale@1", "b1", unit.clone()),
                    other("sy", "scale@1", "b2", unit.clone()),
                    other("sz", "scale@1", "b3", unit),
                ])),
                modules: &["scene3d"],
            }
        }
        // A 2D frame placed at a box's projection.
        "overlay.frame@1" => Drawn {
            params: json!({"frame": "f", "anchor": {"item": "b"}}),
            others: Value::Object(Map::from_iter([
                camera(),
                other(
                    "b",
                    "mark.box@1",
                    "b1",
                    json!({"size": [1, 1, 1], "paint": accent}),
                ),
                other(
                    "f",
                    "frame@1",
                    "b2",
                    json!({"box": [0, 0, 120, 40], "paint": {"fill": {"role": "muted"}}}),
                ),
            ])),
            modules: &["marks2d"],
        },
        _ => return None,
    })
}

/// An example document holding one item of `kind` and the items it reads beside it: its text,
/// which its hash pins. One with a camera beside it is a scene.
fn example_text(kind: &str, params: Value, module: Option<&str>, preview: bool) -> String {
    let drawn = Drawn {
        params,
        others: json!({}),
        modules: &[],
    };
    example_doc(kind, drawn, module, preview)
}

fn example_doc(kind: &str, drawn: Drawn, module: Option<&str>, preview: bool) -> String {
    let mut requires = Map::new();
    let modules: Map<String, Value> = module
        .into_iter()
        .chain(drawn.modules.iter().copied())
        .map(|m| (m.to_string(), json!("^1")))
        .collect();
    if !modules.is_empty() {
        requires.insert("modules".into(), Value::Object(modules));
    }
    if preview {
        requires.insert("preview".into(), json!([kind]));
    }
    let mut items = Map::from_iter([(
        "x1".to_string(),
        json!({"id": "x1", "kind": kind, "name": "X1", "order": "a0", "params": drawn.params}),
    )]);
    if let Value::Object(others) = drawn.others {
        items.extend(others);
    }
    let scene = items.contains_key("cam");
    let mut doc = json!({
        "format": 1, "profile": if scene { "scene" } else { "board" },
        "title": format!("{kind}, at its defaults"),
        "description": format!("One {kind} item at its defaults, generated from the kind's schema."),
        "size": [320, 200],
        "items": items,
    });
    if scene {
        doc["camera"] = json!("cam");
    }
    if !requires.is_empty() {
        doc["requires"] = Value::Object(requires);
    }
    format!(
        "{}\n",
        serde_json::to_string_pretty(&doc).unwrap_or_default()
    )
}

/// One kind as an entry of `kind@1`, with its example's text.
pub(crate) struct KindRow {
    pub(crate) entry: Value,
    pub(crate) example: Option<String>,
}

/// One-line descriptions of the kinds the core and its first-party modules register.
fn kind_description(name: &str, module: &str, version: Option<&Version>) -> String {
    let params = version
        .map(|v| {
            v.params
                .iter()
                .map(|p| p.name)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let what = match name {
        "circle@1" => "a dot or a ring about its center",
        "rect@1" => "a filled box",
        "text@1" => "shaped text in a box",
        "path@1" => "a path from SVG path data",
        "camera@1" => "the camera a 3D view looks through",
        _ if module == "core" => "a core kind",
        _ => "a kind",
    };
    if params.is_empty() {
        format!("{what} ({module})")
    } else {
        format!("{what} ({module}): {params}")
    }
}

/// Every kind the build draws: the kind registry's, then the marks module's and scene3d's drawn
/// with no registry entry, each with its schema, fields, example, stability and kit result.
pub(crate) fn kind_rows(sealed: &Sealed, planted: Option<Planted>) -> Vec<KindRow> {
    let registry = sealed.kinds();
    let since = "R2";
    let mut out: Vec<KindRow> = Vec::new();
    let mut named: Vec<String> = Vec::new();
    let module_kinds: BTreeMap<String, &deep_canvas::registry::Kind> = sealed
        .modules
        .iter()
        .flat_map(|m| m.shapes.kinds.iter().map(|k| (k.entry.full_name(), k)))
        .collect();
    let push = |name: String, module: String, entry: Option<&Entry>, out: &mut Vec<KindRow>| {
        let version = entry.map(Entry::current);
        let kind = module_kinds
            .get(name.split('@').next().unwrap_or_default())
            .copied();
        let preview = kind.and_then(|k| k.preview.clone());
        let retired = kind.and_then(|k| k.deprecated.clone());
        let stability = match (&preview, &retired) {
            (Some(_), _) => "preview",
            (_, Some(_)) => "retired",
            _ => "stable",
        };
        let owner = (module != "core").then_some(module.as_str());
        let example = match version {
            Some(v) => Some(example_text(
                &name,
                Value::Object(example_params(v)),
                owner,
                preview.is_some(),
            )),
            None => drawn_example(&name).map(|d| example_doc(&name, d, owner, preview.is_some())),
        };
        let schema = match version {
            Some(v) => schema_of(v),
            None => {
                json!({"x-opaque": "params the drawing module reads; the kind registry holds no schema for them yet"})
            }
        };
        let mut fields = version.map(|v| fields_of(v, planted)).unwrap_or_default();
        fields.extend(crate::forms::of(&name));
        let description = kind
            .and_then(|k| k.description.clone())
            .unwrap_or_else(|| kind_description(&name, &module, version));
        let shape = json!({"schema": schema, "fields": fields});
        let mut e = json!({
            "name": name, "registry": "kind@1", "origin": "first_party", "module": module,
            "binds": "all", "schema": schema,
            "example": example.as_deref().map(|t| sha256_hex(t.as_bytes())),
            "since": since, "digest": entry_digest("kind@1", &name, &shape, since),
            "kit": {"verdict": "PASS", "rules": [{"rule": "sealed", "verdict": "PASS"}]},
            "cost": Value::Null, "stability": stability, "available": stability != "retired",
            "description": description, "fields": fields,
        });
        if let Some(p) = preview {
            e["tracking"] = json!(p.tracking);
            e["preview_since"] = json!(p.since);
            e["decide_by"] = json!(p.decide_by);
        }
        if let Some((since, by)) = retired {
            e["deprecated_since"] = json!(since);
            e["replaced_by"] = json!(by);
        }
        if let Some(entry) = entry {
            let migrations: Vec<Value> = entry
                .migrations
                .iter()
                .map(|m| json!({
                    "from": format!("{}@{}", entry.full_name(), m.from),
                    "to": format!("{}@{}", entry.full_name(), m.to),
                    "renames": m.renames.iter().map(|r| json!({"from": r.from, "to": r.to})).collect::<Vec<_>>(),
                    "retires": m.retires,
                }))
                .collect();
            if !migrations.is_empty() {
                e["migrations"] = json!(migrations);
            }
        }
        out.push(KindRow { entry: e, example });
    };
    for entry in registry.entries() {
        let full = entry.full_name();
        let name = format!("{full}@{}", entry.current().major);
        let module = sealed.module_of_kind(&full).unwrap_or("core").to_string();
        named.push(name.clone());
        push(name, module, Some(entry), &mut out);
    }
    let drawn_by = |m: &str| sealed.modules.iter().any(|x| x.name == m);
    let marks = if drawn_by("marks2d") {
        "marks2d"
    } else {
        "core"
    };
    for kind in deep_canvas_marks::scene::KINDS {
        if !named.iter().any(|n| n == kind) {
            named.push(kind.to_string());
            // The data module's kinds, in a build without it: listed, unavailable, naming why.
            let owner = deep_canvas_marks::scene::module_of(kind);
            if owner == "data" && marks == "marks2d" && !drawn_by(owner) {
                push(kind.to_string(), owner.into(), None, &mut out);
                if let Some(e) = out.last_mut().map(|r| &mut r.entry) {
                    e["available"] = json!(false);
                    e["code"] = json!("module_missing");
                    e["kit"] = json!({"verdict": "BLOCKED", "rules": [{"rule": "sealed", "verdict": "BLOCKED"}]});
                }
                continue;
            }
            let module = if marks == "marks2d" { owner } else { marks };
            push(kind.to_string(), module.into(), None, &mut out);
        }
    }
    // #548: logic@1, with its exports, the one subset and its budgets, and its gallery example.
    if drawn_by("logic") && !named.iter().any(|n| n == "logic@1") {
        named.push("logic@1".into());
        push("logic@1".into(), "logic".into(), None, &mut out);
        if let Some(row) = out.last_mut() {
            let text = INSTALLED.iter().find(|(f, _)| *f == "logic-counter.json").map(|(_, t)| t.to_string());
            if let (Some(o), Value::Object(l)) = (row.entry.as_object_mut(), deep_logic::piece::listing()) {
                o.extend(l);
            }
            row.entry["example"] = json!(text.as_deref().map(|t| sha256_hex(t.as_bytes())));
            row.example = text;
        }
    }
    if drawn_by("scene3d") {
        let more = deep_canvas_scene3d::scene::KINDS
            .iter()
            .chain([&deep_canvas_scene3d::scene::OVERLAY]);
        for kind in more {
            if !named.iter().any(|n| n == kind) {
                named.push(kind.to_string());
                push(kind.to_string(), "scene3d".into(), None, &mut out);
            }
        }
    }
    out
}

/// The contract row of `kind@1`, the registry every kind is an entry of.
fn kind_registry_row() -> Value {
    let rows: Vec<Value> = serde_json::from_str(include_str!(
        "../../../packages/contracts/canvas-registries.json"
    ))
    .unwrap_or_default();
    let mut row = rows
        .into_iter()
        .find(|r| r["registry"] == "kind@1")
        .unwrap_or_else(|| json!({"registry": "kind@1"}));
    let digest = entry_digest("kind@1", "kind@1", &row["entry"], "");
    row["kind"] = json!("registry");
    row["name"] = json!("kind@1");
    row["binds"] = json!("all");
    row["kit"] = json!([]);
    row["planted"] = json!([]);
    row["digest"] = json!(digest);
    row
}

/// A `deep://registries` entry in the one shape: its registry's binds, entry schema and
/// stability, its kit result deciding whether it is available.
fn one_shape(e: &mut Value, row: &Value, sealed: &Sealed, planted: Option<Planted>) {
    let Some(o) = e.as_object_mut() else { return };
    let pass = o.get("kit").and_then(|k| k.get("verdict")) == Some(&json!("PASS"));
    o.entry("binds").or_insert_with(|| row["binds"].clone());
    o.entry("schema").or_insert_with(|| row["entry"].clone());
    o.entry("example").or_insert(Value::Null);
    o.entry("cost").or_insert(Value::Null);
    let retired = row.get("deprecated_since").is_some();
    o.entry("stability").or_insert_with(|| {
        json!(if retired {
            "retired"
        } else {
            row["stability"].as_str().unwrap_or("stable")
        })
    });
    if o["stability"] == "preview" {
        for field in ["tracking", "preview_since", "decide_by"] {
            if let Some(t) = row.get(field) {
                o.entry(field).or_insert_with(|| t.clone());
            }
        }
    }
    o.entry("available").or_insert(json!(pass && !retired));
    let registry = row["name"].as_str().unwrap_or_default();
    if !o.contains_key("description") {
        let from = o
            .get("pack")
            .or(o.get("module"))
            .and_then(Value::as_str)
            .unwrap_or("core");
        let text = format!("an entry of {registry}, from {from}");
        o.insert("description".into(), json!(text));
    }
    if let Some(def) = sealed.registry(registry).map(|r| &r.def) {
        if let (Some(moves), Some(value)) = (def.moves, o.get("value")) {
            let printed = if planted == Some(Planted::MovesStoredText) {
                serde_json::from_str(STORED_MOVES).unwrap_or_default()
            } else {
                moves(value)
            };
            o.insert("moves".into(), json!(printed));
        }
    }
}

/// The whole listing: the header, and every registry and slot with its entries in the one shape.
pub struct Listing {
    pub header: Value,
    pub rows: Vec<Value>,
    /// Each example's text by its hash: the kinds' generated examples.
    examples: BTreeMap<String, String>,
}

impl Hub<'_> {
    fn kinds_planted(&self) -> Option<Planted> {
        self.startup.kinds
    }

    /// The listing as this process holds it, with the packs installed and the plug-ins' entries.
    pub fn kinds_listing(&self) -> Listing {
        let sealed = &self.startup.sealed;
        let planted = self.kinds_planted();
        let mut l = listing(
            sealed,
            planted,
            self.registries_reply(),
            &self.scenario.plugin_entries,
        );
        // #202: each installed pack's recipe-backed kinds, as entries of kind@1.
        if planted != Some(Planted::ListingWithoutPackEntries) {
            let head = l.rows[0].clone();
            for row in self.pack_kind_rows() {
                let mut e = row.entry;
                if let (Some(t), Some(h)) = (row.example, e["example"].as_str()) {
                    l.examples.insert(h.to_string(), t);
                }
                one_shape(&mut e, &head, sealed, planted);
                if let Some(list) = l.rows[0]["entries"].as_array_mut() {
                    list.push(e);
                }
            }
        }
        l
    }

    /// Each admitted pack's kinds backed by recipes (Pack: kinds in any pack): its schema from its
    /// recipe's inputs, its example by hash, its kit's result and its cost at defaults beside its
    /// largest counts over its params' extremes.
    fn pack_kind_rows(&self) -> Vec<KindRow> {
        let mut out = Vec::new();
        for pack in self.packs.all() {
            let id = pack.id.text();
            let origin = if self.pack_authors.contains_key(&id) {
                "agent"
            } else {
                "pack"
            };
            for (name, kind) in &pack.kinds {
                let Some(recipe) = pack.recipes.get(&kind.recipe) else {
                    continue;
                };
                let properties: Map<String, Value> = recipe
                    .inputs
                    .iter()
                    .map(|(n, i)| {
                        let ty = match i.ty.as_str() {
                            "number" => "number",
                            "integer" => "integer",
                            "bool" => "boolean",
                            "text" | "ID" | "choice" => "string",
                            "records" | "vec3" | "range" => "array",
                            _ => "object",
                        };
                        let mut s = json!({"type": ty, "default": i.default});
                        if let Some(lo) = i.min {
                            s["minimum"] = json!(lo);
                        }
                        if let Some(hi) = i.max {
                            s["maximum"] = json!(hi);
                        }
                        if !i.options.is_empty() {
                            s["enum"] = json!(i.options);
                        }
                        (n.clone(), s)
                    })
                    .collect();
                let schema = json!({"type": "object", "properties": properties, "required": [], "additionalProperties": false});
                // Its first example, by the hash its pack lists it under.
                let example = kind.examples.first().map(|(sha, _)| sha.clone());
                let shape = json!({"schema": schema, "pack": id, "recipe": kind.recipe});
                let since = pack.id.version.to_string();
                let e = json!({
                    "name": name, "registry": "kind@1", "origin": origin, "pack": id,
                    "recipe": kind.recipe, "minor": kind.minor, "binds": "author",
                    "schema": schema,
                    "example": example,
                    "examples": kind.examples.iter().map(|(sha, _)| sha.clone()).collect::<Vec<_>>(),
                    "since": since, "digest": entry_digest("kind@1", name, &shape, &since),
                    "children": kind.children, "capabilities": kind.capabilities,
                    "rules": kind.rules.iter().map(|r| json!({"code": r.code, "expr": r.expr.text})).collect::<Vec<_>>(),
                    "kit": kind.kit,
                    "cost": {"class": kind.class.name(), "at_defaults": kind.at_defaults, "at_extremes": kind.at_extremes},
                    "description": format!("{name}, a kind backed by the recipe {} of {id}", kind.recipe),
                });
                let text = example.and_then(|sha| kind.texts.get(&sha).cloned());
                out.push(KindRow {
                    entry: e,
                    example: text,
                });
            }
        }
        out
    }

    /// `{"call": "deep_kinds", …}`.
    pub fn kinds_reply(&self, call: &Value) -> Value {
        let empty = Map::new();
        let c = call.as_object().unwrap_or(&empty);
        let op = c.get("op").and_then(Value::as_str).unwrap_or_default();
        let allowed: &[&str] =
            match op {
                "list" => &["registry", "cursor"],
                "word" => &["word"],
                "search" => &["query", "cursor"],
                "read" => &["example", "guide", "offset"],
                "gallery" => &["cursor"],
                "sheet" | "step_ceilings" => &[],
                "field" => &["path"],
                "bindings" => &["doc", "item", "language"],
                _ => return refused(
                    "enum",
                    "/op",
                    "Give op as one of list, word, search, read, gallery, sheet, step_ceilings, field or bindings.",
                    op,
                ),
            };
        // A field the op doesn't take is refused at its path; null reads as left out.
        for (k, v) in c {
            if k == "call" || k == "op" || v.is_null() {
                continue;
            }
            if !allowed.contains(&k.as_str()) {
                return refused(
                    "unlisted_field",
                    &format!("/{k}"),
                    &format!("Leave out {k}: {op} takes only {}.", allowed.join(", ")),
                    k,
                );
            }
        }
        let text = |k: &str| c.get(k).and_then(Value::as_str);
        let cursor = text("cursor");
        match op {
            "list" => self.kinds_list(text("registry"), cursor),
            "word" => match text("word") {
                Some(w) => self.kinds_word(w),
                None => refused(
                    "required",
                    "/word",
                    "Give word, the word another tool uses.",
                    "",
                ),
            },
            "search" => match text("query") {
                Some(q) => self.kinds_search(q, cursor),
                None => refused(
                    "required",
                    "/query",
                    "Give query, the words a hit must hold.",
                    "",
                ),
            },
            "read" => match (text("example"), text("guide")) {
                (Some(hash), None) => self.kinds_read_example(hash),
                (None, Some(name)) => {
                    let offset = c.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
                    self.kinds_read_guide(name, offset)
                }
                _ => refused(
                    "required",
                    "/example",
                    "Give example, a hash, or guide, a name.",
                    "",
                ),
            },
            "gallery" => self.kinds_gallery(cursor),
            "field" => match text("path") {
                Some(p) => self.kinds_field(p),
                None => refused(
                    "required",
                    "/path",
                    "Give path, <kind>@<major>.<field> for one field or <kind>@<major> for all of them.",
                    "",
                ),
            },
            "bindings" => self.kinds_bindings(text("doc"), text("item"), text("language")),
            // The logic module's step ceilings (Logic: work across steps, #546).
            "step_ceilings" => json!({"step_ceilings": deep_logic::budget::ceilings(
                self.kinds_planted() == Some(Planted::StepCeilingsCap)
            )}),
            _ => self.kinds_sheet(),
        }
    }

    /// `op: bindings` (#548): a document's logic item's typed bindings in the pinned language, Rust,
    /// from its region map in declaration order, which its declarations alone give, so a program
    /// is built against them before it exists.
    fn kinds_bindings(&self, doc: Option<&str>, item: Option<&str>, language: Option<&str>) -> Value {
        if language != Some("rust") {
            return refused("enum", "/language", "Give language as rust, the pinned language.", language.unwrap_or_default());
        }
        let (Some(doc), Some(item)) = (doc, item) else {
            return refused("required", "/item", "Give doc and item, the logic item whose bindings these are.", "");
        };
        let Some(form) = self.forms.get(doc) else {
            return refused("ref_unresolved", "/doc", "Give doc, a document the hub holds.", doc);
        };
        let maps = crate::logic::piece_json(form)
            .map(|p| deep_logic::piece::region_maps(&p, &Default::default()));
        let Some((_, layout, emits)) = maps.and_then(Result::ok).and_then(|m| m.into_iter().find(|(id, _, _)| id == item)) else {
            return refused("ref_unresolved", "/item", "Give item, a logic item of the document that check admits.", item);
        };
        let by_name = self.kinds_planted() == Some(Planted::BindingsByName);
        json!({"bindings": deep_logic::bindings::rust(item, &layout, &emits, by_name)})
    }

    /// `op: field` (#1971): one line per field, printed from the listing's kind entry: the field's
    /// row (name, type, unit, range, default and its grammar's forms) with the kind's canvas module
    /// and stability. `<kind>@<major>` answers every field in the listing's order. A miss is
    /// `unknown_field`, naming the close names the document check gives, renames first.
    fn kinds_field(&self, path: &str) -> Value {
        let sealed = &self.startup.sealed;
        let planted = self.kinds_planted();
        // The kind ends at the first dot after its major: `test.slab@3.width`.
        let cut = path
            .find('@')
            .and_then(|at| path[at..].find('.').map(|d| at + d));
        let (kind, field) = match cut {
            Some(d) => (&path[..d], Some(&path[d + 1..])),
            None => (path, None),
        };
        let rows = kind_rows(sealed, planted);
        let Some(e) = rows.iter().map(|r| &r.entry).find(|e| e["name"] == kind) else {
            let close =
                deep_canvas::document::kind_names(kind, &sealed.kinds(), sealed.close_fault);
            return field_miss(path, &format!("{kind} is no kind this build lists"), &close);
        };
        let mut fields: Vec<&Value> = e["fields"].as_array().into_iter().flatten().collect();
        if planted == Some(Planted::FieldWithoutCorner) && kind == "test.slab@3" {
            fields.retain(|f| f["name"] != "corner");
        }
        let line = |f: &Value| {
            let mut l = f.clone();
            l["path"] = json!(format!("{kind}.{}", f["name"].as_str().unwrap_or_default()));
            l["module"] = e["module"].clone();
            l["stability"] = e["stability"].clone();
            if planted == Some(Planted::FieldLine600Bytes) && l["path"] == "test.slab@3.width" {
                // `,"pad":""` is 9 bytes.
                let pad = 600usize.saturating_sub(l.to_string().len() + 9);
                l["pad"] = json!(" ".repeat(pad));
            }
            if planted == Some(Planted::FieldSizeJsonAlone) && l["path"] == "slab@1.size" {
                if let Some(o) = l.as_object_mut() {
                    o.remove("grammar");
                    o.remove("forms");
                }
            }
            l
        };
        let Some(name) = field else {
            let mut lines: Vec<Value> = fields.into_iter().map(line).collect();
            if planted == Some(Planted::FieldObjectByName) {
                lines.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
            }
            return json!({"path": path, "lines": lines});
        };
        if let Some(f) = fields.iter().find(|f| f["name"] == name) {
            return json!({"path": path, "lines": [line(f)]});
        }
        let registry = sealed.kinds();
        let close = match deep_canvas::kinds::lookup(&registry, kind) {
            deep_canvas::kinds::Lookup::Known { entry, .. } => {
                let fault = sealed.close_fault;
                let owners = deep_canvas::document::owners(name, entry, &registry, fault);
                deep_canvas::document::field_names(name, entry, entry.current(), &owners, fault)
            }
            _ => Vec::new(),
        };
        let have: Vec<&str> = fields.iter().filter_map(|f| f["name"].as_str()).collect();
        let what = if close.is_empty() {
            format!(
                "{kind} has no field {name}; its fields are {}",
                have.join(", ")
            )
        } else {
            format!("{kind} has no field {name}")
        };
        field_miss(path, &what, &close)
    }

    fn corpus(&self) -> Option<Corpus> {
        Corpus::read(self.scenario.gallery.as_deref())
    }

    fn kinds_list(&self, registry: Option<&str>, cursor: Option<&str>) -> Value {
        let l = self.kinds_listing();
        let rows: Vec<Value> = match registry {
            Some(name) => l.rows.into_iter().filter(|r| r["name"] == name).collect(),
            None => l.rows,
        };
        let (row0, entry0) = cursor
            .and_then(|c| c.split_once('.'))
            .and_then(|(a, b)| Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?)))
            .unwrap_or((0, 0));
        let mut out = l.header.clone();
        out["packs"] = self.packs_listed();
        let mut size = out.to_string().len() + 64;
        let mut page: Vec<Value> = Vec::new();
        let mut next = None;
        'rows: for (i, row) in rows.iter().enumerate().skip(row0) {
            let mut head = row.clone();
            let entries = head
                .as_object_mut()
                .and_then(|o| o.remove("entries"))
                .and_then(|e| e.as_array().cloned())
                .unwrap_or_default();
            let from = if i == row0 { entry0 } else { 0 };
            let mut kept: Vec<Value> = Vec::new();
            let head_size = head.to_string().len() + 16;
            if size + head_size > PAGE_BUDGET && !page.is_empty() {
                next = Some(format!("{i}.{from}"));
                break;
            }
            size += head_size;
            for (j, e) in entries.iter().enumerate().skip(from) {
                let n = e.to_string().len() + 1;
                if size + n > PAGE_BUDGET && !(page.is_empty() && kept.is_empty()) {
                    if row.get("entries").is_some() {
                        head["entries"] = json!(kept);
                    }
                    page.push(head);
                    next = Some(format!("{i}.{j}"));
                    break 'rows;
                }
                size += n;
                kept.push(e.clone());
            }
            if row.get("entries").is_some() {
                head["entries"] = json!(kept);
            }
            page.push(head);
        }
        out["registries"] = json!(page);
        if let Some(n) = next {
            out["next"] = json!(n);
        }
        out
    }

    /// The packs installed here (#1720), each with its version and origin, its recipes and the
    /// kind each of its words maps to.
    fn packs_listed(&self) -> Value {
        let packs: Vec<Value> = self
            .packs
            .all()
            .map(|p| {
                let recipes: Vec<String> = p
                    .recipes
                    .values()
                    .map(|r| format!("{}@{}", r.id, r.major))
                    .collect();
                let aliases: Map<String, Value> = p
                    .aliases
                    .iter()
                    .map(|(word, a)| (word.clone(), a["target"].clone()))
                    .collect();
                // #1958: a retired version stays listed, as retired.
                let state = if self.packs.is_retired(&p.id.text()) { "retired" } else { "installed" };
                json!({"pack": p.id.id, "version": p.id.version.to_string(), "state": state,
                       "origin": self.pack_origin(&p.id.text()), "recipes": recipes, "aliases": aliases})
            })
            .collect();
        Value::Array(packs)
    }

    /// A word from a familiar-names pack installed here: the kind it maps to and the conversion
    /// the pack states, or `no_match`; never a mapping by spelling.
    fn kinds_word(&self, word: &str) -> Value {
        for p in self.packs.all() {
            if let Some(alias) = p.aliases.get(word) {
                let mut out = json!({"word": word, "target": alias["target"],
                                     "conversion": alias["conversion"], "pack": p.id.text()});
                if let Some(old) = alias.get("renamed_from") {
                    out["renamed_from"] = old.clone();
                }
                return out;
            }
        }
        json!({"word": word, "code": "no_match"})
    }

    /// Hits for every word of `query`, best first: the gallery's examples, the guides, then the
    /// listing's entries, each ranked by how many of its texts hold the query's words.
    fn kinds_search(&self, query: &str, cursor: Option<&str>) -> Value {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let corpus = self.corpus();
        let mut hits: Vec<(usize, usize, String, Value)> = Vec::new();
        let mut consider = |rank: usize, texts: &[&str], hit: Value| {
            let hay = texts.join(" ").to_lowercase();
            if words.is_empty() || !words.iter().all(|w| hay.contains(w.as_str())) {
                return;
            }
            // A word in a name or title counts twice.
            let head = texts.first().copied().unwrap_or_default().to_lowercase();
            let score: usize = words
                .iter()
                .map(|w| 1 + usize::from(head.contains(w.as_str())))
                .sum();
            let name = hit["name"].as_str().unwrap_or_default().to_string();
            hits.push((usize::MAX - score, rank, name, hit));
        };
        if let Some(c) = &corpus {
            for e in &c.examples {
                let mut texts = vec![e.title.as_str()];
                texts.extend(e.words.iter().map(String::as_str));
                consider(
                    0,
                    &texts,
                    json!({"kind": "example", "name": e.title, "title": e.title, "hash": e.hash}),
                );
            }
            for (name, title, _) in &c.guides {
                consider(
                    1,
                    &[title.as_str(), name.as_str()],
                    json!({"kind": "guide", "name": name, "title": title}),
                );
            }
        }
        for row in self.kinds_listing().rows {
            for e in row["entries"].as_array().into_iter().flatten() {
                let name = e["name"].as_str().unwrap_or_default();
                let description = e["description"].as_str().unwrap_or_default();
                let mut hit = json!({"kind": "entry", "name": name, "title": description, "registry": row["name"]});
                if let Some(h) = e["example"].as_str() {
                    hit["hash"] = json!(h);
                }
                consider(2, &[name, description], hit);
            }
        }
        hits.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));
        let all: Vec<Value> = hits.into_iter().map(|h| h.3).collect();
        if all.is_empty() {
            return json!({"hits": [], "code": "no_match"});
        }
        let (page, next) = paged(&all, cursor);
        let mut out = json!({"hits": page});
        if let Some(n) = next {
            out["next"] = json!(n);
        }
        out
    }

    /// An example by its hash: its stored bytes, served only when they hash to it.
    fn kinds_read_example(&self, hash: &str) -> Value {
        if let Some(text) = self.kinds_listing().examples.get(hash) {
            return json!({"example": hash, "text": text});
        }
        let corpus = self.corpus();
        let Some(e) = corpus
            .as_ref()
            .and_then(|c| c.examples.iter().find(|e| e.hash == hash))
        else {
            return refused(
                "not_found",
                "/example",
                "Give the hash of an example deep_kinds lists or a search found.",
                hash,
            );
        };
        let bytes = corpus.as_ref().and_then(|c| c.bytes(&e.file));
        match bytes {
            Some(b) if sha256_hex(&b) == hash => match String::from_utf8(b) {
                Ok(text) => {
                    let mut out = json!({"example": hash, "title": e.title, "text": text});
                    if let Some(s) = e.source.as_ref().and_then(|f| corpus.as_ref()?.bytes(f)) {
                        out["source"] = json!({"file": e.source, "text": String::from_utf8_lossy(&s)});
                    }
                    out
                }
                Err(_) => refused("unavailable", "/example", "The example isn't UTF-8 text; it is not served.", hash),
            },
            _ => refused(
                "unavailable",
                "/example",
                "The example's stored bytes don't match its hash, so it is never served; reinstall the gallery.",
                hash,
            ),
        }
    }

    /// A guide's page at `offset` bytes: at most a page of its text, cut on a character, saying
    /// whether it was cut and where the next page starts.
    fn kinds_read_guide(&self, name: &str, offset: usize) -> Value {
        let corpus = self.corpus();
        let mut text = corpus.as_ref().and_then(|c| {
            let (_, _, file) = c.guides.iter().find(|(n, _, _)| n == name)?;
            String::from_utf8(c.bytes(file)?).ok()
        });
        // The planted dice game keys its throws by the step's seed, at 264 in its read region.
        if self.kinds_planted() == Some(Planted::DiceFromStepSeed) {
            text = text.map(|t| {
                t.replace(
                    "(local.set $key (i64.load (i32.const 1024)))",
                    "(local.set $key (i64.load (i32.const 264)))",
                )
            });
        }
        let Some(text) = text else {
            return refused(
                "not_found",
                "/guide",
                "Give a guide's name as a search hit gives it.",
                name,
            );
        };
        if offset > text.len() || !text.is_char_boundary(offset) {
            return refused(
                "range",
                "/offset",
                "Give 0 or the next offset a page gave.",
                &offset.to_string(),
            );
        }
        let mut end = (offset + GUIDE_PAGE).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        let truncated = end < text.len();
        let mut out = json!({"guide": name, "offset": offset, "text": &text[offset..end], "truncated": truncated});
        if truncated {
            out["next"] = json!(end);
        }
        out
    }

    /// The gallery's examples, each verified only when its last corpus run on this module-set
    /// digest played at least the steps it declares; else unverified with the steps played, or
    /// not run.
    fn kinds_gallery(&self, cursor: Option<&str>) -> Value {
        let here = &self.startup.sealed.set_digest;
        let by_exit = self.kinds_planted() == Some(Planted::VerifiedByExit);
        let rows: Vec<Value> =
            self.corpus()
                .map(|c| c.examples)
                .unwrap_or_default()
                .into_iter()
                .map(|e| {
                    let last = self.scenario.corpus_runs.iter().rev().find(|r| {
                        r["example"] == e.hash.as_str() && r["module_set"] == here.as_str()
                    });
                    let mut row = json!({"hash": e.hash, "title": e.title, "steps": e.steps});
                    match last {
                        None => row["status"] = json!("not_run"),
                        Some(r) => {
                            let played = r["played"].as_u64().unwrap_or(0);
                            let verified = if by_exit {
                                r["exit"] == 0
                            } else {
                                played >= e.steps
                            };
                            row["status"] = json!(if verified { "verified" } else { "unverified" });
                            row["played"] = json!(played);
                        }
                    }
                    row
                })
                .collect();
        let (page, next) = paged(&rows, cursor);
        let mut out = json!({"examples": page});
        if let Some(n) = next {
            out["next"] = json!(n);
        }
        out
    }

    fn kinds_sheet(&self) -> Value {
        let l = self.kinds_listing();
        let drop_packs = self.kinds_planted() == Some(Planted::SheetWithoutPackEntries);
        let text = sheet_text(&sheet_lines(&l.rows, drop_packs));
        json!({"module_set": self.startup.sealed.set_digest, "bytes": text.len(), "text": text})
    }
}

/// The listing of `sealed` with `registries`, the `deep://registries` reply, and the plug-ins'
/// entries.
fn listing(
    sealed: &Sealed,
    planted: Option<Planted>,
    registries: Value,
    plugins: &[Value],
) -> Listing {
    let kinds = kind_rows(sealed, planted);
    let mut examples = BTreeMap::new();
    let mut kind_row = kind_registry_row();
    let mut entries = Vec::new();
    for k in kinds {
        if let (Some(t), Some(h)) = (&k.example, k.entry["example"].as_str()) {
            examples.insert(h.to_string(), t.clone());
        }
        entries.push(k.entry);
    }
    kind_row["entries"] = json!(entries);
    let mut rows = vec![kind_row];
    rows.extend(
        registries["registries"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    );
    for row in rows.iter_mut() {
        if row["kind"] != "registry" {
            continue;
        }
        let head = row.clone();
        let name = row["name"].clone();
        if let Some(list) = row.get_mut("entries").and_then(Value::as_array_mut) {
            for p in plugins.iter().filter(|p| p["registry"] == name) {
                let mut e = p["entry"].clone();
                let value = e.clone();
                let entry_name = e["name"].as_str().unwrap_or_default().to_string();
                e = json!({"name": entry_name, "registry": name, "origin": "plugin", "plugin": p["plugin"],
                           "value": value, "since": core_name(),
                           "digest": entry_digest(name.as_str().unwrap_or_default(), &entry_name, &value, ""),
                           "kit": p["kit"]});
                list.push(e);
            }
            if planted == Some(Planted::ListingWithoutPackEntries) {
                list.retain(|e| e["origin"] != "pack" && e["origin"] != "agent");
            }
            for e in list.iter_mut() {
                one_shape(e, &head, sealed, planted);
                if planted == Some(Planted::ListingWithoutStability) {
                    if let Some(o) = e.as_object_mut() {
                        o.remove("stability");
                    }
                }
            }
        }
    }
    let interfaces: Vec<Value> = sealed
        .interfaces
        .iter()
        .map(|i| {
            let implementation = if planted == Some(Planted::NamesReference) {
                i.reference.clone()
            } else {
                i.implementation.name.clone()
            };
            json!({"name": i.name, "digest": i.digest, "implementation": implementation, "module": i.module})
        })
        .collect();
    let header = json!({
        "core_version": core_name(),
        "module_set": sealed.set_digest,
        "modules": sealed.modules.iter().map(|m| json!({"name": m.name, "version": m.version.to_string(),
            "kit": crate::kit::ledger::kit_of(&m.name, m.digest.as_str())})).collect::<Vec<_>>(),
        "interfaces": interfaces,
    });
    Listing {
        header,
        rows,
        examples,
    }
}

/// A list cut at the reply cap: the page from `cursor` (an index) and the next one's index.
fn paged(all: &[Value], cursor: Option<&str>) -> (Vec<Value>, Option<String>) {
    let from = cursor.and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
    let mut size = 128;
    let mut page = Vec::new();
    for (i, v) in all.iter().enumerate().skip(from) {
        let n = v.to_string().len() + 1;
        if size + n > PAGE_BUDGET && !page.is_empty() {
            return (page, Some(i.to_string()));
        }
        size += n;
        page.push(v.clone());
    }
    (page, None)
}

// ---------------------------------------------------------------------------------------------
// The sheet.

/// One line of the sheet: its entry, its group and its text.
pub struct SheetLine {
    pub entry: String,
    group: String,
    text: String,
}

/// Every available entry's line: `name@version — description — example hash`, grouped by canvas
/// module (the kinds' modules, then each registry's owner), recipes first.
pub fn sheet_lines(rows: &[Value], drop_packs: bool) -> Vec<SheetLine> {
    let mut out: Vec<SheetLine> = Vec::new();
    for row in rows.iter().filter(|r| r["kind"] == "registry") {
        for e in row["entries"].as_array().into_iter().flatten() {
            if e["available"] == false
                || (drop_packs && (e["origin"] == "pack" || e["origin"] == "agent"))
            {
                continue;
            }
            let name = e["name"].as_str().unwrap_or_default();
            let group = e["module"]
                .as_str()
                .or(e["pack"].as_str())
                .or(row["owner"].as_str())
                .unwrap_or("core")
                .to_string();
            let mut text = format!("- {name}");
            if row["name"] != "kind@1" {
                text.push_str(&format!(" ({})", row["name"].as_str().unwrap_or_default()));
            }
            if let Some(d) = e["description"].as_str().filter(|d| !d.is_empty()) {
                text.push_str(&format!(": {d}"));
            }
            if let Some(h) = e["example"].as_str() {
                text.push_str(&format!(" [{}]", &h[..12.min(h.len())]));
            }
            out.push(SheetLine {
                entry: name.to_string(),
                group,
                text,
            });
        }
    }
    // Recipes first, then the groups by name; inside a group, the listing's order.
    let recipe = |g: &str| !g.contains("recipe");
    out.sort_by(|a, b| (recipe(&a.group), &a.group).cmp(&(recipe(&b.group), &b.group)));
    out
}

/// The sheet's text: a heading per group and its lines.
pub fn sheet_text(lines: &[SheetLine]) -> String {
    let mut text = format!("# deep_kinds: every available entry of {}\n", core_name());
    let mut group = "";
    for l in lines {
        if l.group != group {
            group = &l.group;
            text.push_str(&format!("\n## {group}\n"));
        }
        text.push_str(&l.text);
        text.push('\n');
    }
    text
}

/// The build's sheet past the cap: the entries whose lines, longest first, take it back under,
/// and the bytes over. The seal refuses such a build (#412: an entry that won't fit ships as a
/// recipe or a gallery example instead of widening the sheet).
pub fn sheet_overrun(sealed: &Sealed) -> Option<(Vec<String>, usize)> {
    let l = listing(sealed, None, json!({"registries": []}), &[]);
    let lines = sheet_lines(&l.rows, false);
    let total = sheet_text(&lines).len();
    if total <= SHEET_CAP {
        return None;
    }
    let mut by_size: Vec<&SheetLine> = lines.iter().collect();
    by_size.sort_by_key(|l| std::cmp::Reverse(l.text.len()));
    let mut left = total;
    let mut named = Vec::new();
    for l in by_size {
        if left <= SHEET_CAP {
            break;
        }
        left -= l.text.len() + 1;
        named.push(l.entry.clone());
    }
    Some((named, total - SHEET_CAP))
}

// ---------------------------------------------------------------------------------------------
// The dump and the diff (`deep-show kinds --dump <dir>`, `--diff <a> <b>`).

/// The whole sealed listing as one canonical JSON value: the header, then every registry with
/// its entries, each entry's fields an ordered array (`kinds.dump@1`).
pub fn dump_value(sealed: &Sealed, planted: Option<Planted>) -> Value {
    let l = listing(
        sealed,
        planted,
        json!({"registries": sealed.registries.iter().map(|r| r.to_json(&[])).collect::<Vec<_>>()}),
        &[],
    );
    let rows: Vec<Value> = l
        .rows
        .iter()
        .map(|r| {
            let entries: Vec<Value> = r["entries"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|e| {
                    let fields: Vec<Value> = e["fields"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|f| {
                            let mut f = f.clone();
                            if let Some(o) = f.as_object_mut() {
                                o.remove("grammar");
                                o.remove("forms");
                                o.remove("form");
                            }
                            f
                        })
                        .collect();
                    let fields = if planted == Some(Planted::DumpFieldsByName) {
                        Value::Object(fields.iter().map(|f| (f["name"].as_str().unwrap_or_default().to_string(), f.clone())).collect())
                    } else {
                        json!(fields)
                    };
                    let mut d = json!({"name": e["name"], "registry": r["name"], "origin": e["origin"],
                                       "since": e["since"], "stability": e["stability"], "digest": e["digest"],
                                       "fields": fields});
                    if let Some(m) = e.get("migrations") {
                        d["migrations"] = m.clone();
                    }
                    d
                })
                .collect();
            json!({"name": r["name"], "owner": r["owner"], "since": r["since"], "digest": r["digest"], "entries": entries})
        })
        .collect();
    let mut out = l.header;
    out["format"] = json!("kinds.dump@1");
    out["registries"] = json!(rows);
    out
}

/// The dump's bytes: RFC 8785 text.
pub fn dump_bytes(value: &Value) -> Vec<u8> {
    deep_canvas::canon::canonical_bytes(value, &NoShape).unwrap_or_default()
}

/// Each entry of a dump by name, with its fields in order and its migrations.
fn entries_of(dump: &Value) -> Vec<&Value> {
    dump["registries"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|r| r["entries"].as_array().into_iter().flatten())
        .collect()
}

fn fields_by_name(e: &Value) -> Vec<(&str, &Value)> {
    e["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| (f["name"].as_str().unwrap_or_default(), f))
        .collect()
}

/// The changes from dump `a` to dump `b`: each entry added or removed, and each field added,
/// removed, renamed, retired or changed in default, unit or range. An entry of `b` pairs with the
/// one of `a` its migration record names, and renames and retirements come only from that
/// record, never from spelling (unless planted).
pub fn diff(a: &Value, b: &Value, planted: Option<Planted>) -> Vec<Value> {
    let by_spelling = planted == Some(Planted::DiffBySpelling);
    let old = entries_of(a);
    let new = entries_of(b);
    let mut out = Vec::new();
    let mut paired_old: Vec<String> = Vec::new();
    for e in &new {
        let name = e["name"].as_str().unwrap_or_default();
        let registry = &e["registry"];
        let migrations: Vec<&Value> = e["migrations"].as_array().into_iter().flatten().collect();
        let from = old
            .iter()
            .find(|o| o["registry"] == *registry && o["name"] == name)
            .or_else(|| {
                migrations.iter().find_map(|m| {
                    old.iter()
                        .find(|o| o["registry"] == *registry && o["name"] == m["from"])
                })
            });
        let Some(o) = from else {
            out.push(json!({"entry": name, "change": "added"}));
            continue;
        };
        paired_old.push(o["name"].as_str().unwrap_or_default().to_string());
        let mut renames: Vec<(String, String, String)> = Vec::new();
        let mut retires: Vec<String> = Vec::new();
        // The steps from the old entry's major up to the new one's; none between two dumps of
        // one major.
        let major = |v: &Value| -> u64 {
            v.as_str()
                .and_then(|t| t.rsplit_once('@'))
                .and_then(|(_, m)| m.parse().ok())
                .unwrap_or(0)
        };
        let (lo, hi) = (major(&o["name"]), major(&e["name"]));
        if !by_spelling {
            for m in migrations
                .iter()
                .filter(|m| major(&m["from"]) >= lo && major(&m["to"]) <= hi)
            {
                let renamed_in = m["to"].as_str().unwrap_or_default().to_string();
                for r in m["renames"].as_array().into_iter().flatten() {
                    renames.push((
                        r["from"].as_str().unwrap_or_default().into(),
                        r["to"].as_str().unwrap_or_default().into(),
                        renamed_in.clone(),
                    ));
                }
                retires.extend(
                    m["retires"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(str::to_string),
                );
            }
        }
        let was = fields_by_name(o);
        let now = fields_by_name(e);
        for (f, fo) in &was {
            if let Some((_, to, renamed_in)) = renames.iter().find(|(from, _, _)| from == f) {
                out.push(json!({"entry": name, "field": f, "change": "renamed", "to": to, "renamed_in": renamed_in}));
                if let Some((_, fnew)) = now.iter().find(|(n, _)| n == to) {
                    changed(&mut out, name, to, fo, fnew);
                }
                continue;
            }
            if retires.iter().any(|r| r == f) {
                out.push(json!({"entry": name, "field": f, "change": "retired"}));
                continue;
            }
            match now.iter().find(|(n, _)| n == f) {
                Some((_, fnew)) => changed(&mut out, name, f, fo, fnew),
                None => out.push(json!({"entry": name, "field": f, "change": "removed"})),
            }
        }
        for (f, _) in &now {
            let renamed_to = renames.iter().any(|(_, to, _)| to == f);
            if !renamed_to && !was.iter().any(|(n, _)| n == f) {
                out.push(json!({"entry": name, "field": f, "change": "added"}));
            }
        }
    }
    for o in &old {
        let name = o["name"].as_str().unwrap_or_default();
        if !paired_old.iter().any(|p| p == name) {
            out.push(json!({"entry": name, "change": "removed"}));
        }
    }
    out
}

/// A field's default, unit and range changes between two dumps.
fn changed(out: &mut Vec<Value>, entry: &str, field: &str, was: &Value, now: &Value) {
    for k in ["default", "unit", "range"] {
        if was.get(k) != now.get(k) {
            out.push(json!({"entry": entry, "field": field, "change": k,
                            "from": was.get(k).cloned().unwrap_or(Value::Null),
                            "to": now.get(k).cloned().unwrap_or(Value::Null)}));
        }
    }
}

/// `deep-show kinds --dump <dir> | --diff <a> <b> | --defaults [--planted <name>]`: one JSON line,
/// exit 0, or a refusal and exit 2. `--defaults` is #1974's run, its verdict in its report.
pub fn command(
    args: &[String],
    seal: impl Fn(Option<Planted>) -> Result<Sealed, String>,
) -> (Value, i32) {
    let mut planted = None;
    let mut rest: Vec<&String> = Vec::new();
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--planted" {
            match args.get(i + 1).and_then(|n| Planted::named(n)) {
                Some(p) => planted = Some(p),
                None => return (json!({"ok": false, "code": "bad_input"}), 2),
            }
            i += 2;
        } else {
            rest.push(&args[i]);
            i += 1;
        }
    }
    let read = |p: &str| -> Option<Value> { serde_json::from_slice(&std::fs::read(p).ok()?).ok() };
    match rest.as_slice() {
        [flag, dir] if flag.as_str() == "--dump" => {
            let sealed = match seal(planted) {
                Ok(s) => s,
                Err(what) => {
                    return (
                        json!({"ok": false, "code": "seal_refused", "what": what}),
                        2,
                    )
                }
            };
            let value = dump_value(&sealed, planted);
            let hex = sealed.set_digest.trim_start_matches("d1:").to_string();
            let path = Path::new(dir.as_str()).join(format!("{hex}.json"));
            if let Err(e) = std::fs::create_dir_all(dir.as_str())
                .and_then(|_| std::fs::write(&path, dump_bytes(&value)))
            {
                return (
                    json!({"ok": false, "code": "write_failed", "what": e.to_string()}),
                    2,
                );
            }
            (
                json!({"ok": true, "path": path, "module_set": sealed.set_digest}),
                0,
            )
        }
        [flag] if flag.as_str() == "--defaults" => match seal(planted) {
            Ok(sealed) => (crate::defaults::run(&sealed, planted), 0),
            Err(what) => (
                json!({"ok": false, "code": "seal_refused", "what": what}),
                2,
            ),
        },
        [flag, a, b] if flag.as_str() == "--diff" => match (read(a), read(b)) {
            (Some(a), Some(b)) => (json!({"ok": true, "changes": diff(&a, &b, planted)}), 0),
            _ => (
                json!({"ok": false, "code": "bad_input", "what": "a dump can't be read as JSON"}),
                2,
            ),
        },
        _ => (
            json!({"ok": false, "code": "bad_input", "what": "deep-show kinds --dump <dir> | --diff <a> <b> | --defaults"}),
            2,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #1973: every structured field of the full build declares forms the form language reads,
    /// its line prints at least one, and its own default is one of them; so does every scene3d
    /// spec param for its default, both its sweep values and its fixture's, which its reader
    /// takes.
    #[test]
    fn every_structured_field_prints_forms_that_take_its_own_values() {
        let full = crate::BuildSet::Full;
        let sealed = crate::assemble(full, crate::modules(full))
            .seal()
            .expect("the shipped set seals");
        let mut bad = Vec::new();
        let mut held =
            |name: String, declared: &str, values: &[&Value]| match deep_canvas::form::parse(
                declared,
            ) {
                Err(u) => bad.push(format!("{name}: `{declared}` doesn't read: {}", u.why)),
                Ok(f) => {
                    for v in values {
                        if let Some(got) = f.miss(v) {
                            bad.push(format!("{name}: `{}` refuses {v}: got {got}", f.print()));
                        }
                    }
                }
            };
        for entry in sealed.kinds().entries() {
            for v in &entry.versions {
                for p in &v.params {
                    if let Some(declared) = p.ty.form() {
                        let name = format!("{}@{}.{}", entry.full_name(), v.major, p.name);
                        held(name, declared, &[&p.default]);
                    }
                }
            }
        }
        for spec in deep_canvas_scene3d::spec::all() {
            // The params its fixture's items of its kind set.
            let fixture: Vec<&Map<String, Value>> = spec
                .fixture
                .as_object()
                .into_iter()
                .flat_map(Map::values)
                .filter(|i| i["kind"] == spec.kind)
                .filter_map(|i| i["params"].as_object())
                .collect();
            for q in &spec.params {
                let name = format!("{}.{} (spec)", spec.kind, q.name);
                let mut values = vec![&q.default, &q.sweep.0, &q.sweep.1];
                values.extend(fixture.iter().filter_map(|p| p.get(q.name)));
                held(name, q.declared(), &values);
            }
        }
        for row in kind_rows(&sealed, None) {
            for f in row.entry["fields"].as_array().into_iter().flatten() {
                let printed = f["forms"].as_array().map_or(0, Vec::len);
                if f["type"] == "json" && printed == 0 {
                    bad.push(format!(
                        "{}.{}: prints no form",
                        row.entry["name"], f["name"]
                    ));
                }
            }
        }
        assert!(bad.is_empty(), "{}", bad.join("\n"));
    }
}
