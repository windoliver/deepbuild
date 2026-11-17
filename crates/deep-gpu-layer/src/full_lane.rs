//! The `full_lane` call (issue #458; tests/acceptance/458/relations/README.md: `full_lane`): every
//! GPU fixture of the parity suite's full lane, run on the adapter the device reports. The lane
//! judges only on a hardware GPU: the run records the adapter's name, driver and device type as
//! the GPU seam read them from the device, never from the lane's configuration, and on a CPU or
//! software adapter every fixture is BLOCKED, naming the adapter, and no golden is compared or
//! blessed.

use serde_json::{json, Value};

use crate::{App, Planted};

/// The lane's GPU fixtures, `parity/relation/<name>.scene` each: a relation's sides as documents
/// and looks, its size and frame.
const FIXTURES: [(&str, &str); 8] = [
    (
        "exposure-doubles",
        include_str!("../fixtures/parity/relation/exposure-doubles.json"),
    ),
    (
        "lights-add",
        include_str!("../fixtures/parity/relation/lights-add.json"),
    ),
    (
        "ortho-shift",
        include_str!("../fixtures/parity/relation/ortho-shift.json"),
    ),
    (
        "sphere-turn",
        include_str!("../fixtures/parity/relation/sphere-turn.json"),
    ),
    (
        "occluder-never-brightens",
        include_str!("../fixtures/parity/relation/occluder-never-brightens.json"),
    ),
    (
        "instances-keep-hash",
        include_str!("../fixtures/parity/relation/instances-keep-hash.json"),
    ),
    (
        "translation",
        include_str!("../fixtures/parity/relation/translation.json"),
    ),
    (
        "light-level",
        include_str!("../fixtures/parity/relation/light-level.json"),
    ),
];

/// The adapter a lane run judges by: its name, driver and device type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Adapter {
    pub name: String,
    pub driver: String,
    pub kind: String,
}

impl Adapter {
    fn json(&self) -> Value {
        json!({"name": self.name, "driver": self.driver, "type": self.kind})
    }
}

/// The adapter the run is on: the device's own, as the seam read it; the planted lane takes the
/// one its configuration names.
fn adapter(app: &mut App) -> Option<Adapter> {
    if app.planted == Some(Planted::LaneAdapterFromConfiguration) {
        if let Some(configured) = &app.lane_adapter {
            return Some(configured.clone());
        }
    }
    app.worker.call(|state| {
        state.gpu.seam().map(|c| Adapter {
            name: c.adapter.name.clone(),
            driver: c.adapter.driver.clone(),
            kind: c.adapter.kind.clone(),
        })
    })
}

/// Why nothing GPU is judged on this run's adapter, naming it and its device type, or `None` on
/// a hardware adapter.
pub fn software(app: &mut App) -> Option<String> {
    let a = adapter(app)?;
    (a.kind == "cpu").then(|| {
        format!(
            "the full lane judges only on a hardware GPU: the adapter is {}, device type {}",
            a.name, a.kind
        )
    })
}

/// One fixture's run: its sides' documents and assets written under `out`, judged by `relation`.
/// What can't run is BLOCKED with the reason.
fn judged(app: &mut App, out: &str, name: &str, text: &str) -> (&'static str, Option<String>) {
    let blocked = |why: String| ("BLOCKED", Some(why));
    let Ok(fixture) = serde_json::from_str::<Value>(text) else {
        return blocked(format!("the fixture of {name} doesn't parse"));
    };
    let dir = std::path::Path::new(out);
    let written = |file: String, bytes: &[u8]| -> Result<String, String> {
        let path = dir.join(file);
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    };
    let mut call = json!({
        "call": "relation", "relation": name, "size": fixture["size"], "frame": fixture["frame"],
        "fps": fixture["fps"], "sides": {},
    });
    if !fixture["k"].is_null() {
        call["k"] = fixture["k"].clone();
    }
    for (side, v) in fixture["sides"].as_object().into_iter().flatten() {
        match written(
            format!("{name}-{side}.json"),
            v["doc"].to_string().as_bytes(),
        ) {
            Ok(doc) => call["sides"][side] = json!({"doc": doc, "look": v["look"]}),
            Err(e) => return blocked(e),
        }
    }
    for (sha, gltf) in fixture["assets"].as_object().into_iter().flatten() {
        let bytes = gltf.as_str().unwrap_or_default().as_bytes();
        match written(format!("{sha}.gltf"), bytes) {
            Ok(path) => call["assets"][sha] = json!(path),
            Err(e) => return blocked(e),
        }
    }
    let reply = crate::relation::call(app, out, &call);
    let reason = reply["reason"].as_str().map(str::to_string);
    match reply["result"].as_str() {
        Some("PASS") => ("PASS", None),
        Some("FAIL") => ("FAIL", reason),
        Some("BLOCKED") => ("BLOCKED", reason),
        _ => blocked(format!("{name} didn't run: {reply}")),
    }
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    let configured = &call["configured"]["adapter"];
    app.lane_adapter = configured["name"].as_str().map(|name| Adapter {
        name: name.to_string(),
        driver: configured["driver"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        kind: configured["type"].as_str().unwrap_or_default().to_string(),
    });
    let Some(on) = adapter(app) else {
        return crate::refused("no_device", "the noop backend has no adapter");
    };
    let blocked = software(app);
    let mut fixtures = Vec::new();
    for (name, text) in FIXTURES {
        let (result, reason) = match &blocked {
            // Nothing is drawn or judged on a software adapter.
            Some(reason) => ("BLOCKED", Some(reason.clone())),
            None => judged(app, out, name, text),
        };
        let mut row = json!({"fixture": format!("parity/relation/{name}.scene"), "result": result});
        if let Some(reason) = reason {
            row["reason"] = json!(reason);
        }
        fixtures.push(row);
    }
    // The lane's GPU fixtures are relations, which read no golden.
    json!({
        "lane": "full",
        "adapter": on.json(),
        "fixtures": fixtures,
        "goldens": {"compared": [], "blessed": []},
    })
}
