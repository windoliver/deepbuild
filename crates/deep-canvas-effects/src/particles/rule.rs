//! The check over a document's particles@1 items (#449; Particles `particles@1`: `count`; The
//! cost model; Operator budgets by class): each item's params read, its count against its
//! budget class's cap, a landing's receivers static; and the estimate of what the items cost in
//! the class's operator time and storage. A refusal is the canvas core's issue, naming the item.

use deep_canvas::document::Issue;
use deep_canvas_scene3d::shore;
use serde_json::{json, Map, Value};

use super::spec::{self, count_cap, Refusal};

/// GPU nanoseconds a particle costs its compute pass, every field on (estimate; the design's 2 to
/// 5 ns, at its low end so a showpiece's 1,048,576 fit its 4 ms).
pub const NS_PER_PARTICLE: f64 = 2.0;
/// Scratch bytes a particle holds: its instance columns.
pub const SCRATCH: u64 = 32;

/// The document's budget class (`figure` when it names none).
pub fn class_of(doc: &Value) -> &str {
    doc["budget"]["class"].as_str().unwrap_or("figure")
}

/// A class's operator time, ms (none for an export) and storage, bytes (Operator budgets by class).
fn class_budget(class: &str) -> (Option<f64>, u64) {
    let (ms, mb) = match class {
        "core_view" => (Some(0.2), 8),
        "data_view" => (Some(0.5), 64),
        "figure" => (Some(1.0), 32),
        "work_product" => (Some(1.0), 64),
        "showpiece" => (Some(4.0), 128),
        _ => (None, 128),
    };
    (ms, mb << 20)
}

/// The canvas core's issue for a refusal of item `id`.
pub fn issue(id: &str, r: &Refusal) -> Issue {
    let mut i = Issue::error(r.code, id, r.path.clone(), r.actual.clone(), &r.what);
    i.ids.extend(r.also.iter().filter(|a| *a != id).cloned());
    i
}

/// Every particles@1 item of `doc`, by ID.
pub fn items(doc: &Value) -> Vec<(&String, &Value)> {
    doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, v)| v["kind"] == "particles@1")
        .collect()
}

/// Item `id`'s count past its class's cap (or `every`, a planted cap for every class).
pub fn count(doc: &Value, id: &str, item: &Value, every: Option<u32>) -> Option<Refusal> {
    let class = class_of(doc);
    let cap = every.unwrap_or_else(|| count_cap(class));
    let n = item["params"]["count"].as_u64()?;
    (n > u64::from(cap)).then(|| {
        Refusal::new(
            "out_of_range",
            format!("items/{id}/params/count"),
            format!("{id}: count {n} is past the {class} class's cap of {cap} particles an item"),
        )
        .with(json!({"count": n, "cap": cap, "class": class}))
    })
}

/// The check's issues over `doc`'s particles@1 items. `every`: a planted cap applied to every
/// class instead of the class's own.
pub fn issues(doc: &Value, every: Option<u32>) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in items(doc) {
        let p = &item["params"];
        let s = match spec::read(doc, id, p) {
            Ok(s) => s,
            Err(r) => {
                out.push(issue(id, &r));
                continue;
            }
        };
        if let Some(r) = count(doc, id, item, every) {
            out.push(issue(id, &r));
        }
        if let spec::Shape::Surface(of) = &s.shape {
            if let Some(r) = super::surface::over_cap(doc, id, of, None) {
                out.push(issue(id, &r));
            }
        }
        if let Some(land) = &s.land {
            let members: Vec<&str> = doc["collections"][&land.on]["members"]
                .as_array()
                .map(|m| m.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if let Some(m) = doc
                .as_object()
                .and_then(|d| shore::moving_member(d, members.iter().copied()))
            {
                out.push(issue(id, &super::bake::moving(id, m)));
            }
        }
    }
    out.extend(over_budget(doc));
    out
}

/// One item's share of the estimate: its elements, its operator time and its scratch.
fn share(count: u32) -> (u32, f64, u64) {
    (
        count,
        f64::from(count) * NS_PER_PARTICLE / 1e6,
        u64::from(count) * SCRATCH,
    )
}

/// The estimate of `doc`'s particles in its class: each item's compute elements (its count),
/// its share of operator time and its scratch, and the document's operator time and storage,
/// each item's included, as `{class, operator_ms, storage_bytes, items}`.
pub fn estimate(doc: &Value) -> Value {
    let mut items = Map::new();
    let (mut ms, mut bytes) = (0.0, 0u64);
    for (id, item) in items_counted(doc) {
        let (elements, op_ms, scratch) = share(item);
        let tables = spec::read(doc, id, &doc["items"][id]["params"])
            .ok()
            .and_then(|s| s.turbulence)
            .map_or(0, |t| u64::from(t.paths) * u64::from(t.steps) * 12);
        ms += op_ms;
        bytes += scratch + tables;
        items.insert(
            id.clone(),
            json!({"elements": elements, "operator_ms": op_ms, "scratch_bytes": scratch}),
        );
    }
    json!({"class": class_of(doc), "operator_ms": ms, "storage_bytes": bytes, "items": items})
}

fn items_counted(doc: &Value) -> Vec<(&String, u32)> {
    items(doc)
        .into_iter()
        .map(|(id, v)| {
            let c = v["params"]["count"].as_u64().unwrap_or(256);
            (id, c.min(u64::from(u32::MAX)) as u32)
        })
        .collect()
}

/// The document's particles past its class's operator time or storage, naming the costliest.
fn over_budget(doc: &Value) -> Vec<Issue> {
    let class = class_of(doc);
    let (cap_ms, cap_bytes) = class_budget(class);
    let e = estimate(doc);
    let costliest = items_counted(doc)
        .into_iter()
        .max_by_key(|(id, c)| (*c, std::cmp::Reverse((*id).clone())))
        .map(|(id, _)| id.clone());
    let Some(id) = costliest else {
        return Vec::new();
    };
    let ms = e["operator_ms"].as_f64().unwrap_or(0.0);
    let bytes = e["storage_bytes"].as_u64().unwrap_or(0);
    let mut out = Vec::new();
    if cap_ms.is_some_and(|c| ms > c) || bytes > cap_bytes {
        let r = Refusal::new(
            "over_budget",
            format!("items/{id}/params/count"),
            format!(
                "the document's particles take {ms:.2} ms of operator time and {:.1} MB of operator storage, past the {class} class's {} and {} MB; {id} costs most",
                bytes as f64 / f64::from(1u32 << 20),
                cap_ms.map_or("no cap".to_string(), |c| format!("{c} ms")),
                cap_bytes >> 20
            ),
        )
        .with(json!({"operator_ms": ms, "storage_bytes": bytes}));
        out.push(issue(&id, &r));
    }
    out
}
