//! The media canvas module `media@1` (issue #499; technical design: The media module): strips on
//! tracks, buses with processors whose state checkpoints its tail, emitters, and a video's frames
//! on image@1. Its kit is every part of the canvas kit on its fixtures, the carried-state part
//! over a reverb's checkpointed tail among them, with no behavior part.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Raised, Range, Registrar, Semver, StepInput,
    Stepper,
};
use serde_json::{json, Value};

use crate::mix::BLOCK;
use crate::reverb::{Reverb, Spec, State};

/// The fixture reverb the carried-state stepper runs: small, so its state hashes cheaply.
const SPEC: Spec = Spec {
    decay: 0.4,
    size: 0.05,
    damping: 0.5,
    mix: 0.5,
};
const RATE: i64 = 48_000;
/// Steps a second: one a block.
const HZ: i64 = RATE / BLOCK;

fn manifest(implementation: &str) -> Manifest {
    let dep = |r: &str| Dependency {
        range: Range::parse(r).expect("a range"),
        optional: false,
    };
    Manifest {
        name: "media".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [("scene3d".to_string(), dep("^1"))].into_iter().collect(),
        feature: "media".into(),
        license: "Apache-2.0".into(),
        implements: "media@1".into(),
        implementation: Implementation::reference(
            implementation,
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// `media`, the shipped implementation of media@1.
pub fn module() -> Module {
    Module {
        manifest: manifest("media"),
        register: |r| register(r, restore, READER),
    }
}

/// The planted implementation (#499): its reverb checkpoint leaves out its tail.
pub fn checkpoint_without_tail() -> Module {
    Module {
        manifest: manifest("media.checkpoint_without_tail"),
        register: |r| register(r, restore_without_tail, READER),
    }
}

/// The planted layout (#501): `export.target@1` declared here instead of in the core.
pub fn declaring_export_targets() -> Module {
    Module {
        manifest: manifest("media"),
        register: |r| {
            r.registry(deep_canvas::registry::core_lists::export_target_registry());
            register(r, restore, READER);
        },
    }
}

/// The planted target (#501): `png`'s fidelity reader is its own writer, media.
pub fn png_reads_itself() -> Module {
    Module {
        manifest: manifest("media"),
        register: |r| register(r, restore, "media"),
    }
}

/// The independent reader of media's export targets: a fresh decode worker.
const READER: &str = "decode_worker";

fn register(r: &mut Registrar, restore: fn(&Value) -> Value, png_reader: &str) {
    // #204: the synth presets packs fill, read from a pack's `presets`.
    r.registry(crate::synth::registry());
    r.pack_field("presets", crate::synth::presets_field);
    // The targets the encode job writes (Export: Targets): each held to the document by
    // export.fidelity on what a fresh decode worker reads back, hidden items left out.
    for (target, reader) in [("video", READER), ("png", png_reader)] {
        r.entry(
            "export.target@1",
            target,
            json!({"writer": "media", "fidelity": ["export.fidelity"],
                   "reader": reader, "hidden": "left_out"}),
            "R6",
        );
    }
    // #503: a spectrum's bands (Analysis bake) as the array `spectrum.<bake ID>`, one element per
    // band, so a mark set's bars and rings read them as columns.
    r.entry(
        deep_canvas::columns::REGISTRY,
        "media.spectrum@1",
        json!({"form": "spectrum.<name>", "types": ["f64"], "fixture": spectrum_fixture()}),
        "R6",
    );
    // A bell on a box, so the kit checks a document with strips and an emitter (#427).
    r.fixture("bell", deep_canvas_scene3d::emitters::bell(), None)
        .sidecar(json!({"codes": []}));
    r.fixture("reverb", crate::fixtures::reverb_board(), None)
        .sidecar(json!({"codes": [], "at_times": ["0s", "3s"]}));
    r.stepper(Stepper {
        hz: HZ,
        // The first block boundary at or after each whole second (Blocks), as steps from 1.
        checkpoints: (0..4).map(|s| s * HZ + 1).collect(),
        init,
        step,
        checkpoint: Value::clone,
        restore,
        rollback: |_, cp| cp.clone(),
        occurrences: |_| Vec::new(),
    });
    // A strip as an item (Strip and track), for a document that keeps its strips beside its
    // items; it draws nothing.
    r.kind(strip_kind(), &[], "");
    r.rule("image", av_link);
    r.rule("media.strip", av_link_strip);
}

/// The spectrum entry's kit fixture, from the bake's own math: a 1 kHz sine of amplitude 0.5 from
/// 0.1 s to 0.2 s at 8 kHz, four log bands from 100 Hz to 3 kHz, 512-sample windows, a row every
/// 0.1 s. Each frame is a row's levels, and each frame's changed ranges the bands its row changed.
fn spectrum_fixture() -> Value {
    use crate::analysis::spectrum::{edges, rows, Scale};
    use deep_canvas::ops;
    let tone: Vec<f32> = (0..3200)
        .map(|i| match i {
            800..1600 => (0.5 * ops::sin(ops::TAU * 1000.0 * f64::from(i) / 8000.0)) as f32,
            _ => 0.0,
        })
        .collect();
    let frames = rows(
        &tone,
        1,
        8000,
        10,
        512,
        &edges(4, Scale::Log, [100.0, 3000.0]),
        true,
    );
    let changed: Vec<Vec<[usize; 2]>> = (frames.iter().enumerate())
        .map(|(k, f)| match k {
            0 => vec![[0, f.len()]],
            _ => (0..f.len())
                .filter(|&b| f[b] != frames[k - 1][b])
                .map(|b| [b, b + 1])
                .collect(),
        })
        .collect();
    json!({"frames": frames, "changed": changed, "seeks": [{"from": 3, "to": 2, "rows": frames[2]}]})
}

/// `media.strip@1`: Strip and track's fields as params, each with the forms a strip's readers
/// take (#1973): the mix's (`mixdown`), the picture link's and the score's.
fn strip_kind() -> Entry {
    let json = |(name, form): (&'static str, &'static str)| Param {
        name,
        ty: ParamType::Json(form),
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    let fields = [
        ("track", "u16"),
        ("src", "sha256 | {asset?: sha256, synth?, score?: item ID}"),
        ("start", "flick | time"),
        ("in", "flick | time"),
        ("out", "flick | time"),
        ("rate", "number | [p, q] | <p>/<q>"),
        ("offset", "flick | time"),
        ("span", "flick | time"),
        ("loop", "bool"),
        (
            "gain",
            "dB | text (-inf) | {keys: [{t: flick, value: dB | text, interp?}]}",
        ),
        ("pitch", "st | expr"),
        ("pan", "-1..1"),
        ("bus", "bus ID"),
        (
            "enabled",
            "bool | {keys: [{t: flick, value: bool, interp?}]}",
        ),
        (
            "fade_in",
            "{length: flick, curve?: linear | equal_power | exp}",
        ),
        (
            "fade_out",
            "{length: flick, curve?: linear | equal_power | exp}",
        ),
        ("align", "{onset?: strongest | first, to: flick | time}"),
        ("at_stage", "play | wait"),
        ("tags", "[text]"),
    ];
    Entry {
        family: "media",
        name: "strip",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: fields.into_iter().map(json).collect(),
        }],
        migrations: vec![],
    }
}

/// The sound strips of `doc` playing `asset`: the `strips` map's and `media.strip@1` items', each
/// with the path its fields sit under.
fn strips_of<'d>(doc: &'d Value, asset: &str) -> Vec<(String, &'d Value)> {
    let mut out = Vec::new();
    for (sid, strip) in doc["strips"].as_object().into_iter().flatten() {
        if crate::doc::strip_asset(strip) == Some(asset) {
            out.push((format!("strips/{sid}"), strip));
        }
    }
    for (iid, item) in doc["items"].as_object().into_iter().flatten() {
        if item["kind"] == "media.strip@1"
            && crate::doc::strip_asset(&item["params"]) == Some(asset)
        {
            out.push((format!("items/{iid}/params"), &item["params"]));
        }
    }
    out
}

/// The fields a picture and its sound must agree on, as the check compares them.
fn linked_fields() -> &'static [&'static str] {
    if crate::planted("av_link_compares_start_only") || crate::planted("av_link_start_only") {
        &["start"]
    } else {
        &["start", "in", "rate"]
    }
}

/// av_unlinked from a strip item's side: against each picture of its asset.
fn av_link_strip(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let Some(asset) = crate::doc::strip_asset(&item["params"]) else {
        return Vec::new();
    };
    if item.pointer("/params/offset").is_some() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (pid, pic) in doc["items"].as_object().into_iter().flatten() {
        let (Some(frames), Some(a)) = (
            pic.pointer("/params/frames"),
            pic.pointer("/params/asset").and_then(Value::as_str),
        ) else {
            continue;
        };
        if a != asset {
            continue;
        }
        for f in linked_fields() {
            if crate::doc::link_value(doc, frames, f)
                != crate::doc::link_value(doc, &item["params"], f)
            {
                out.push(Raised {
                    code: "av_unlinked",
                    severity: "error",
                    path: format!("items/{pid}/params/frames/{f}"),
                    what: format!(
                        "the sound strip {id} and the picture {pid} of one video disagree on {f}; move both together, or give the strip an offset"
                    ),
                    fix_ops: None,
                });
            }
        }
    }
    out
}

fn init() -> Value {
    json!({"step": 0, "reverb": Reverb::new(SPEC, RATE).state.to_json()})
}

/// One block of the fixture's input (a click every 0.1 s) through the reverb.
fn step(state: &mut Value, input: &StepInput<'_>) {
    let mut reverb = Reverb::new(SPEC, RATE);
    if let Some(s) = State::from_json(&state["reverb"]) {
        reverb.state = s;
    }
    let first = (input.step - 1) * BLOCK;
    let mut block = vec![0f32; 2 * BLOCK as usize];
    for (i, f) in block.as_chunks_mut::<2>().0.iter_mut().enumerate() {
        if (first + i as i64) % (RATE / 10) == 0 {
            f[0] = 0.5;
            f[1] = 0.5;
        }
    }
    reverb.process(&mut block);
    let out: f64 = block.iter().map(|x| *x as f64).sum();
    *state = json!({"step": input.step, "out": out, "reverb": reverb.state.to_json()});
}

fn restore(cp: &Value) -> Value {
    cp.clone()
}

fn restore_without_tail(cp: &Value) -> Value {
    let mut v = cp.clone();
    if let Some(s) = State::from_json(&cp["reverb"]) {
        v["reverb"] = s.without_tail().to_json();
    }
    v
}

/// `av_unlinked`: a picture of a video asset and a sound strip of the same asset agree on start,
/// in and rate unless the strip declares an `offset`.
fn av_link(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let Some(frames) = item.pointer("/params/frames") else {
        return Vec::new();
    };
    let Some(asset) = item.pointer("/params/asset").and_then(Value::as_str) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (at, strip) in strips_of(doc, asset) {
        if strip.get("offset").is_some() {
            continue;
        }
        for f in linked_fields() {
            if crate::doc::link_value(doc, frames, f) != crate::doc::link_value(doc, strip, f) {
                out.push(Raised {
                    code: "av_unlinked",
                    severity: "error",
                    path: format!("{at}/{f}"),
                    what: format!(
                        "the picture {id} and the sound strip at {at} of one video disagree on {f}; move both together, or give the strip an offset"
                    ),
                    fix_ops: None,
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::registry::lists::schema_fault;

    /// #501: media fills `video` and `png` into `export.target@1`, each passing the core's kit;
    /// only the planted layout declares the registry here.
    #[test]
    fn media_fills_the_video_and_png_export_targets() {
        let def = deep_canvas::registry::core_lists::export_target_registry();
        let mut r = Registrar::default();
        (module().register)(&mut r);
        // #204: media declares synth.preset@1, and never export.target@1.
        let declared: Vec<&str> = r.registries.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(declared, [crate::synth::REGISTRY]);
        let targets: Vec<_> = r
            .entries
            .iter()
            .filter(|e| e.registry == "export.target@1")
            .collect();
        let names: Vec<&str> = targets.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["video", "png"]);
        for e in targets {
            assert_eq!(schema_fault(&def.entry, &e.value, ""), None, "{}", e.name);
            assert!(def.run_kit(&e.name, &e.value).pass(), "{}", e.name);
            assert_eq!(e.value["writer"], "media");
        }
        let mut planted = Registrar::default();
        (declaring_export_targets().register)(&mut planted);
        let declared: Vec<&str> = planted.registries.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(declared, ["export.target@1", crate::synth::REGISTRY]);
    }
}
