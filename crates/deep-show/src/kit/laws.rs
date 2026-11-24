//! Issue #231: the export module's two laws, counted by the export's work counters, which are
//! the same on every machine (Export, Cost): whatever its length, a held span costs one frame's
//! draw and hash, and in a delivery one more of each for export.fidelity; and a frame handed
//! over as a GPU surface is never read back, only its digest.

use std::path::Path;

use serde_json::{json, Value};

use super::{failure, Case, Ctx, PartRun, Verdict};
use crate::export::Job;
use crate::hub::Hub;

/// The part's name.
pub const PART: &str = "laws";
const MODULE: &str = "export";
/// The kit's document ID: a revision the laws' own exports could write lands here.
const KIT_DOC: &str = "kit:export.laws";

/// The laws' film: 64 × 36 at 24 fps for half a second, a block that holds still and, when
/// `moving`, a bar that moves every frame.
fn film(moving: bool) -> Value {
    let layer = "kit";
    let rect = |id: &str, bounds: [i64; 4], role: &str, order: &str| {
        json!({"id": id, "kind": "rect@1", "layer": layer, "name": id, "order": order,
            "params": {"box": bounds, "paint": {"fill": {"role": role}}}})
    };
    let mut items = serde_json::Map::new();
    items.insert(
        "cam".into(),
        json!({"id": "cam", "kind": "camera@1", "layer": layer, "name": "cam", "order": "a0",
        "params": {"projection": "orthographic", "target": [32, 18, 0], "view_width": 64}}),
    );
    items.insert("block".into(), rect("block", [4, 6, 20, 24], "ink", "a1"));
    let mut channels = serde_json::Map::new();
    if moving {
        items.insert("bar".into(), rect("bar", [0, 0, 6, 36], "accent", "a2"));
        channels.insert("move".into(), json!({"target": "items/bar/params/box/0", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "0.5s", "value": 48, "interp": "linear"}}}));
    }
    json!({
        "format": 1, "profile": "film", "title": "export laws kit", "size": [64, 36],
        "layers": {layer: {"writer": "kit", "title": "Kit", "order": "a0"}},
        "camera": "cam", "transport": {"span": "0.5s", "frame_rate": [24, 1]},
        "channels": channels, "items": items,
    })
}

/// One export of the laws' film at `out`: its reply.
fn exported(hub: &mut Hub<'_>, moving: bool, out: &Path, job: Job) -> Value {
    let job = Job {
        doc: KIT_DOC.into(),
        out: out.to_string_lossy().into_owned(),
        ..job
    };
    hub.export_doc(&job, film(moving))
}

/// A failed case's failure: the law, what broke it and the counts or the reply that show it.
fn broken(law: &str, what: &str, shown: Value) -> Value {
    failure(
        "law_broken",
        MODULE,
        PART,
        json!({"law": law, "what": what, "shown": shown}),
    )
}

/// A held span costs one frame's draw and hash, and in a delivery one more of each.
fn held_span(hub: &mut Hub<'_>, dir: &Path) -> Case {
    let mut case = Case::new("held_span", Verdict::Pass);
    let draft = Job {
        draft: true,
        ..Default::default()
    };
    let runs = [
        ("draft", exported(hub, false, &dir.join("draft.mp4"), draft)),
        (
            "delivery",
            exported(hub, false, &dir.join("delivery.mp4"), Job::default()),
        ),
    ];
    let mut counted = serde_json::Map::new();
    for (purpose, reply) in runs {
        if reply["outcome"] != "exported" {
            let what = format!("the hold's {purpose} isn't exported");
            case.fail(Verdict::Fail, broken("held_span", &what, reply));
            continue;
        }
        let work = &reply["work"];
        let mut own = json!({"draws": work["draws"], "hashes": work["hashes"]});
        let again = u64::from(purpose == "delivery");
        if again == 1 {
            own["fidelity"] = work["fidelity"].clone();
        }
        let one = |v: &Value, n: u64| v.as_u64() == Some(n);
        let frames = reply["receipt"]["frames"].as_u64().unwrap_or(0);
        let held = one(&work["draws"], 1)
            && one(&work["hashes"], 1)
            && one(&work["fidelity"]["draws"], again)
            && one(&work["fidelity"]["hashes"], again)
            && frames > 1
            && one(&reply["receipt"]["reused_frames"], frames - 1);
        if !held {
            let what = format!("the hold's {purpose} costs more than one frame's draw and hash");
            let shown = json!({"work": work, "frames": frames, "reused_frames": reply["receipt"]["reused_frames"]});
            case.fail(Verdict::Fail, broken("held_span", &what, shown));
        }
        counted.insert(purpose.into(), own);
    }
    case.with("counted", Value::Object(counted))
}

/// A frame handed over as a GPU surface is never read back, only its digest.
fn surface_digest_only(hub: &mut Hub<'_>, dir: &Path) -> Case {
    const LAW: &str = "surface_digest_only";
    let mut case = Case::new(LAW, Verdict::Pass);
    let Some(tool) = hub.surface_tool("png_seq") else {
        let what = "no encode tool of this build takes GPU surfaces";
        case.fail(Verdict::Blocked, broken(LAW, what, Value::Null));
        return case;
    };
    let job = Job {
        codec: "png_seq".into(),
        draft: true,
        tool: Some(tool.clone()),
        pins: vec![tool],
        ..Default::default()
    };
    let reply = exported(hub, true, &dir.join("frames"), job);
    if reply["outcome"] != "exported" {
        case.fail(Verdict::Fail, broken(LAW, "the film isn't exported", reply));
        return case;
    }
    if reply["receipt"]["handoff"] != "surface" {
        let what = "the hand-off was a copy through memory, not a GPU surface";
        case.fail(
            Verdict::Blocked,
            broken(LAW, what, reply["receipt"]["handoff"].clone()),
        );
        return case;
    }
    let work = &reply["work"];
    let frames = reply["receipt"]["frames"].as_u64().unwrap_or(0);
    let counted = json!({"frames": frames, "frames_read_back": work["frames_read_back"],
        "digests_read_back": work["digests_read_back"], "digest_bytes_read_back": work["digest_bytes_read_back"]});
    let is = |key: &str, n: u64| work[key].as_u64() == Some(n);
    let digests = is("digests_read_back", frames) && is("digest_bytes_read_back", 32 * frames);
    if !is("frames_read_back", 0) {
        let what = "frames handed over as GPU surfaces were read back: frames_read_back isn't 0";
        case.fail(Verdict::Fail, broken(LAW, what, counted.clone()));
    } else if frames < 2 || !digests {
        let what = "one 32-byte digest is read back for each frame, and nothing else";
        case.fail(Verdict::Fail, broken(LAW, what, counted.clone()));
    }
    case.with("counted", counted)
}

/// The export module's `laws` part, on the GPU; `None` for another module or without it.
pub fn run(hub: &mut Hub<'_>, ctx: &Ctx<'_>) -> Option<PartRun> {
    if ctx.module != MODULE || !ctx.call.backends.iter().any(|b| b == "gpu") {
        return None;
    }
    let dir = std::env::temp_dir().join(format!("deep-kit-laws-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let mut run = PartRun::new(2);
    // With no GPU lease held nothing is drawn: each law is BLOCKED.
    if super::lease::unleased() {
        for law in ["held_span", "surface_digest_only"] {
            let mut case = Case::new(law, Verdict::Pass);
            let why = broken(law, "the kit holds no GPU lease", Value::Null);
            case.fail(Verdict::Blocked, why);
            run.cases.push(case);
        }
        return Some(run);
    }
    // The laws' exports draw under the lease the kit holds.
    let _within = super::lease::within();
    run.cases.push(held_span(hub, &dir));
    run.cases.push(surface_digest_only(hub, &dir));
    hub.revisions.remove(KIT_DOC);
    let _ = std::fs::remove_dir_all(&dir);
    Some(run)
}
