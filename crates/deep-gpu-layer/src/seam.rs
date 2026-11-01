//! The GPU seam's calls (issue #140; README: The surface under test): the seam's part of the
//! `adapter` reply, `gated` (a gated feature's fixtures on this device, with their content keys
//! and receipts) and `seam_suite` (the GPU seam's conformance suite: the exact-class fixtures,
//! compared across GPU families).

use deep_canvas::canon::{revision_hash, NoShape};
use deep_gpu::device::Gpu;
use deep_gpu::seam::{self, BACKEND, TABLE, TIER};
use serde_json::{json, Value};

use crate::effects::{exact_bits, family};
use crate::fixtures;
use crate::{refused, App};

/// The seam's fields of the `adapter` reply: the device's granted features read from the device.
pub fn adapter(gpu: &Gpu, reply: &mut Value) {
    let Some(c) = gpu.seam() else { return };
    let o = reply.as_object_mut().expect("an object");
    o.insert("seam".into(), BACKEND.json());
    o.insert("adapter".into(), c.adapter.json());
    o.insert("tier".into(), json!(TIER));
    o.insert("table".into(), TABLE.iter().map(seam::Row::json).collect());
    o.insert("reported".into(), json!(c.reported));
    o.insert(
        "granted".into(),
        json!(seam::holds(gpu.device().device.features())),
    );
    o.insert("withheld".into(), json!(c.withheld));
    o.insert("quirks".into(), json!({"digest": c.quirks}));
}

/// `{"call": "gated", "feature"}`: every fixture the table lists for a gated feature, on this
/// device, through the path the device's features take.
pub fn gated(app: &mut App, call: &Value) -> Value {
    let Some(row) = call["feature"]
        .as_str()
        .and_then(seam::row)
        .filter(|r| !r.required)
    else {
        return refused("bad_input", "gated takes a gated feature of the table");
    };
    let planted = app.planted;
    app.worker.call(move |state| {
        let Some(c) = state.gpu.seam() else {
            return refused("no_device", "the noop backend has no adapter");
        };
        let device = state.gpu.device();
        let granted = device.device.features().contains(row.wgpu);
        let took = if granted { row.feature } else { row.fallback.unwrap_or(row.feature) };
        let receipt = json!({"gpu": BACKEND.json(), "adapter": {"name": c.adapter.name}, "quirks": c.quirks});
        let list: Vec<Value> = row
            .fixtures
            .iter()
            .map(|f| {
                let ran = fixtures::run(&device, f, false, planted);
                let path = ran.as_ref().map_or(took, |r| r.took);
                // The content key of the result the fixture's render feeds: what it was drawn
                // from, the backend and the quirk table in force among it.
                let key = revision_hash(
                    &json!({"fixture": f, "took": path, "backend": BACKEND.json(), "adapter": c.adapter.json(), "quirks": c.quirks}),
                    &NoShape,
                )
                .unwrap_or_default();
                let mut x = json!({"fixture": f, "took": path, "content_key": key, "receipt": receipt});
                match ran {
                    Ok(r) if r.golden && r.took == took => x["result"] = json!("PASS"),
                    Ok(r) => {
                        x["result"] = json!("FAIL");
                        x["reason"] = json!(format!("{f} on {} missed its golden", r.took));
                    }
                    Err(e) => {
                        x["result"] = json!("FAIL");
                        x["reason"] = json!(e);
                    }
                }
                x
            })
            .collect();
        json!({"feature": row.feature, "granted": granted, "took": took, "fixtures": list})
    })
}

/// `{"call": "seam_suite", "seam": "gpu", "records"?: [path]}`: this GPU's exact-class record,
/// written into `out` and compared with the records given. With fewer than two GPU families
/// among them the cross-family part is BLOCKED with one unblock ask, and the suite never PASS.
pub fn seam_suite(app: &mut App, out: &str, call: &Value) -> Value {
    if call["seam"] != "gpu" {
        return refused("bad_input", "seam_suite runs the gpu seam's suite");
    }
    let mut records = Vec::new();
    for p in call["records"].as_array().into_iter().flatten() {
        match p
            .as_str()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        {
            Some(r) => records.push(r),
            None => return refused("bad_input", format!("record {p} isn't readable")),
        }
    }
    let (name, bits) = exact_bits(app);
    let mine = family(&name);
    let record =
        json!({"gpu": {"name": name, "family": mine}, "backend": BACKEND.json(), "fixtures": bits});
    let path = std::path::Path::new(out).join(format!(
        "gpu-record-{}.json",
        revision_hash(&record, &NoShape).unwrap_or_default()
    ));
    if let Err(e) = std::fs::write(
        &path,
        serde_json::to_vec_pretty(&record).unwrap_or_default(),
    ) {
        return refused("not_written", e.to_string());
    }
    let exact = json!({"part": "exact_class", "result": if bits.is_empty() { "FAIL" } else { "PASS" }, "fixtures": bits.len()});
    let mut families: Vec<&str> = std::iter::once(mine.as_str())
        .chain(records.iter().filter_map(|r| r["gpu"]["family"].as_str()))
        .collect();
    families.sort_unstable();
    families.dedup();
    let mut asks = Vec::new();
    let cross = if families.len() < 2 {
        asks.push(json!({"kind": "unblock", "ask": format!("run deep-gpu's seam_suite on a Mac whose GPU is of another family than {mine} (an M1 beside this M3) and pass its record here"), "needs": "a second GPU family"}));
        json!({"part": "cross_family", "result": "BLOCKED", "families": families})
    } else {
        let differs: Vec<Value> = records
            .iter()
            .flat_map(|r| {
                bits.iter()
                    .filter(|(f, b)| r["fixtures"][f.as_str()].as_str() != Some(b.as_str()))
                    .map(|(f, _)| json!({"fixture": f, "families": [mine, r["gpu"]["family"]]}))
                    .collect::<Vec<_>>()
            })
            .collect();
        json!({"part": "cross_family", "result": if differs.is_empty() { "PASS" } else { "FAIL" }, "families": families, "differs": differs})
    };
    let parts = [exact, cross];
    let any = |r: &str| parts.iter().any(|p| p["result"] == r);
    let result = if any("FAIL") {
        "FAIL"
    } else if any("BLOCKED") {
        "BLOCKED"
    } else {
        "PASS"
    };
    json!({"seam": "gpu", "backend": BACKEND.json(), "result": result, "record": path.to_string_lossy(), "parts": parts, "asks": asks})
}

/// `--adapters <file>` (test-seam): `{"adapters": [{"name", "type", "vendor", "device",
/// "driver", "memory", "features": [feature]}]}`, each a test adapter reporting exactly the
/// table features it lists.
#[cfg(feature = "test-seam")]
pub fn test_adapters(path: &str) -> Option<Vec<(seam::Identity, Vec<&'static str>)>> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    v["adapters"]
        .as_array()?
        .iter()
        .map(|a| {
            let features = a["features"]
                .as_array()?
                .iter()
                .map(|f| f.as_str().and_then(seam::row).map(|r| r.feature))
                .collect::<Option<Vec<_>>>()?;
            let id = seam::Identity {
                name: a["name"].as_str()?.into(),
                vendor: u32::try_from(a["vendor"].as_u64()?).ok()?,
                device: u32::try_from(a["device"].as_u64()?).ok()?,
                driver: a["driver"].as_str()?.into(),
                kind: a["type"].as_str()?.into(),
                memory: a["memory"].as_u64()?,
                test: true,
            };
            Some((id, features))
        })
        .collect()
}
