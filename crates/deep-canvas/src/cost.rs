//! The cost model (issue #379; canvas primitives: The cost model). Every operator and render pass
//! declares terms, nanoseconds per item, vertex and glyph on the CPU and per pixel and vertex on
//! the GPU, plus bytes of GPU memory per item and per pixel, whose coefficients a micro-benchmark
//! measured on a reference Mac (`costs.json`, with that machine's environment fingerprint). The
//! check sums them over a document into CPU time, GPU time and GPU memory per frame from those
//! coefficients alone, so a refusal is the same on every machine, and names the items that cost
//! the most. A coefficient file names the build that measured it, its Cargo profile and its
//! toolchain, and is read only when that profile is optimized (issue #855): a debug build's
//! timings are of crates the shipped build optimizes.
//! Issue #856: shaping's glyphs are measured cold and warm apart, `ns_per_glyph` and
//! `ns_per_glyph_warm`: a frame is charged the warm cost, since a text is shaped once and its run
//! reused from the shaped-run cache, and the cold cost decides whether shaping leaves the UI thread.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::registry::{Per, Sealed, SealedOp};
use crate::schedule::is_check_phase;

/// The coefficients the reference Mac measured (`node benchmarks/canvas.mjs costs --write`).
pub const REFERENCE: &str = include_str!("../costs.json");

/// One operator's or pass's terms.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Terms {
    pub ns_per_item: f64,
    pub ns_per_vertex: f64,
    pub ns_per_glyph: f64,
    /// A glyph whose run is already shaped; 0 where warm and cold aren't measured apart.
    pub ns_per_glyph_warm: f64,
    pub ns_per_px: f64,
    pub bytes_per_item: f64,
    pub bytes_per_px: f64,
}

const TERMS: [&str; 7] = [
    "ns_per_item",
    "ns_per_vertex",
    "ns_per_glyph",
    "ns_per_glyph_warm",
    "ns_per_px",
    "bytes_per_item",
    "bytes_per_px",
];

impl Terms {
    fn read(v: &Value) -> Terms {
        let n = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        Terms {
            ns_per_item: n(TERMS[0]),
            ns_per_vertex: n(TERMS[1]),
            ns_per_glyph: n(TERMS[2]),
            ns_per_glyph_warm: n(TERMS[3]),
            ns_per_px: n(TERMS[4]),
            bytes_per_item: n(TERMS[5]),
            bytes_per_px: n(TERMS[6]),
        }
    }

    /// A glyph's cost in a frame: warm where it is measured apart, since a run is shaped once.
    pub fn ns_per_frame_glyph(&self) -> f64 {
        if self.ns_per_glyph_warm > 0.0 {
            self.ns_per_glyph_warm
        } else {
            self.ns_per_glyph
        }
    }

    /// The terms it declares, without the zeros.
    pub fn to_json(&self) -> Value {
        let values = [
            self.ns_per_item,
            self.ns_per_vertex,
            self.ns_per_glyph,
            self.ns_per_glyph_warm,
            self.ns_per_px,
            self.bytes_per_item,
            self.bytes_per_px,
        ];
        let map: Map<String, Value> = TERMS
            .iter()
            .zip(values)
            .filter(|(_, v)| *v != 0.0)
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect();
        Value::Object(map)
    }
}

/// The Cargo profiles that optimize every crate: what a coefficient file's build must be.
pub const OPTIMIZED: [&str; 2] = ["release", "bench"];

/// Every operator's and pass's terms, the fingerprint of the machine they were measured on, and
/// the build that measured them: `{profile, toolchain}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Coefficients {
    pub fingerprint: Value,
    pub build: Value,
    pub terms: BTreeMap<String, Terms>,
}

/// Why a coefficient file isn't read: the profile it names (`None` when it names none, or isn't
/// a coefficient file at all) and what is wrong.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused {
    pub profile: Option<String>,
    pub what: String,
}

impl Coefficients {
    pub fn read(text: &str) -> Result<Coefficients, Refused> {
        let refused = |profile: Option<&str>, what: String| Refused {
            profile: profile.map(str::to_string),
            what,
        };
        let v: Value = serde_json::from_str(text).map_err(|e| refused(None, e.to_string()))?;
        let profile = v["build"]["profile"].as_str();
        match profile {
            Some(p) if OPTIMIZED.contains(&p) => {}
            Some(p) => {
                return Err(refused(
                    Some(p),
                    format!("costs: measured by a `{p}` build, which isn't optimized; measure with `release`"),
                ))
            }
            None => {
                return Err(refused(
                    None,
                    "costs: names no build profile, so nothing says it was measured optimized"
                        .into(),
                ))
            }
        }
        let terms = v["terms"]
            .as_object()
            .ok_or_else(|| refused(profile, "costs: no terms".into()))?
            .iter()
            .map(|(k, t)| (k.clone(), Terms::read(t)))
            .collect();
        Ok(Coefficients {
            fingerprint: v["fingerprint"].clone(),
            build: v["build"].clone(),
            terms,
        })
    }

    /// The reference Mac's coefficients, which every check estimates with unless the process
    /// reads another file into its sealed set.
    pub fn reference() -> Coefficients {
        Coefficients::read(REFERENCE).expect("costs.json is the build's own, measured optimized")
    }

    /// Every term multiplied by `factor` (the planted check that estimates on its own machine).
    pub fn scaled(&self, factor: f64) -> Coefficients {
        let mut out = self.clone();
        for t in out.terms.values_mut() {
            t.ns_per_item *= factor;
            t.ns_per_vertex *= factor;
            t.ns_per_glyph *= factor;
            t.ns_per_glyph_warm *= factor;
            t.ns_per_px *= factor;
        }
        out
    }

    pub fn get(&self, name: &str) -> Terms {
        self.terms.get(name).copied().unwrap_or_default()
    }
}

/// What an item gives its operators to work on.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Counts {
    pub vertices: f64,
    pub glyphs: f64,
}

/// A path's vertices: the coordinate pairs of its `d`.
fn path_vertices(d: &str) -> f64 {
    let mut numbers = 0u64;
    let mut in_number = false;
    for c in d.chars() {
        let part = c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e';
        if part && !in_number {
            numbers += 1;
        }
        in_number = part && !(c == '-' && in_number);
    }
    (numbers / 2) as f64
}

/// What an item of its kind builds: a path its points, a solid its mesh, a text its glyphs, a
/// mark set its rows; anything else a quad.
pub fn counts(item: &Value) -> Counts {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let p = &item["params"];
    let family = kind.split('@').next().unwrap_or("");
    let vertices = match family {
        "path" => p
            .get("d")
            .and_then(Value::as_str)
            .map_or(4.0, path_vertices),
        "mark.box" => 24.0,
        "mark.cylinder" | "mark.sphere" => 256.0,
        "marks" => p.get("n").and_then(Value::as_f64).unwrap_or(1.0) * 4.0,
        _ => 4.0,
    };
    let glyphs = ["text", "label", "body"]
        .iter()
        .find_map(|k| p.get(*k).and_then(Value::as_str))
        .map_or(0.0, |t| t.chars().count() as f64);
    Counts { vertices, glyphs }
}

/// A document's cost per frame, and each item's share of it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Estimate {
    pub cpu_ms: f64,
    pub gpu_ms: f64,
    pub gpu_mb: f64,
    /// Each item's nanoseconds of CPU and GPU together, in item order.
    pub by_item: Vec<(String, f64)>,
}

impl Estimate {
    /// The `n` items that cost the most, the costliest first, ties by ID.
    pub fn top(&self, n: usize) -> Vec<String> {
        let mut list: Vec<&(String, f64)> =
            self.by_item.iter().filter(|(_, ns)| *ns > 0.0).collect();
        list.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        list.into_iter().take(n).map(|(id, _)| id.clone()).collect()
    }
}

/// The items a warm frame evaluates (canvas primitives: Invalidation and damage, "CPU O(dirty)"):
/// those an item operator reading the time applies to, as a channel moves them, with the items
/// whose params name one of them or that hang from one, as a flag per item in item order. `None`
/// when nothing moves: a still document draws only when it shows or changes, and that frame
/// evaluates every item.
fn moving(item_ops: &[&SealedOp], facts: &Facts<'_>, ids: &[&str]) -> Option<Vec<bool>> {
    let timed: Vec<usize> = item_ops
        .iter()
        .enumerate()
        .filter(|(_, o)| o.op.reads.iter().any(|r| r == "t"))
        .map(|(k, _)| k)
        .collect();
    let n = item_ops.len();
    let mut dirty: Vec<bool> = (0..ids.len())
        .map(|i| timed.iter().any(|&k| facts.applies[i * n + k]))
        .collect();
    if !dirty.contains(&true) {
        return None;
    }
    // Each item an item names in its params or hangs from, with the items that do.
    let mut readers: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for &(i, named) in &facts.named {
        readers.entry(named).or_default().push(i);
    }
    let mut next: Vec<usize> = (0..ids.len()).filter(|&i| dirty[i]).collect();
    while let Some(i) = next.pop() {
        for &r in readers.get(ids[i]).into_iter().flatten() {
            if !dirty[r] {
                dirty[r] = true;
                next.push(r);
            }
        }
    }
    Some(dirty)
}

/// An item as the estimate reads it on its own: its place in the document, its ID and itself.
pub(crate) type Entry<'e> = (usize, &'e String, &'e Value);

/// What the estimate reads of a run of items, each on its own: its kind's family and name, its
/// counts, whether each frame operator over items applies to it (a row per item), and the items
/// it names in its params or hangs from.
pub(crate) struct Facts<'e> {
    fulls: Vec<&'e str>,
    counts: Vec<Counts>,
    applies: Vec<bool>,
    named: Vec<(usize, &'e str)>,
    /// Whether each item is `visible: false`, which no pass draws (#1938).
    hidden: Vec<bool>,
}

fn facts<'e>(
    doc: &Value,
    items: &Map<String, Value>,
    item_ops: &[&SealedOp],
    run: &[Entry<'e>],
) -> Facts<'e> {
    let mut f = Facts {
        fulls: Vec::with_capacity(run.len()),
        counts: Vec::with_capacity(run.len()),
        applies: Vec::with_capacity(run.len() * item_ops.len()),
        named: Vec::new(),
        hidden: Vec::with_capacity(run.len()),
    };
    for &(i, id, item) in run {
        f.hidden.push(item.get("visible") == Some(&Value::Bool(false)));
        f.fulls.push(
            item.get("kind")
                .and_then(Value::as_str)
                .and_then(|k| k.split('@').next())
                .unwrap_or(""),
        );
        f.counts.push(counts(item));
        f.applies.extend(
            item_ops
                .iter()
                .map(|o| o.op.applies.is_none_or(|a| a(doc, id, item))),
        );
        let mut named = Vec::new();
        if let Some(p) = item.get("parent").and_then(Value::as_str) {
            named.push(p);
        }
        item_ids_in(&item["params"], items, &mut named);
        f.named.extend(named.into_iter().map(|n| (i, n)));
    }
    f
}

/// Each string at any depth of `v` that is an item's ID.
fn item_ids_in<'d>(v: &'d Value, items: &Map<String, Value>, out: &mut Vec<&'d str>) {
    match v {
        Value::String(s) if items.contains_key(s) => out.push(s),
        Value::Array(a) => a.iter().for_each(|x| item_ids_in(x, items, out)),
        Value::Object(m) => m.values().for_each(|x| item_ids_in(x, items, out)),
        _ => {}
    }
}

/// The estimate of `doc` (lowered) in the build `sealed` describes, from `coefficients`, for one
/// warm frame (The cost model: "Frame CPU" is warm frame times): each frame operator over the
/// items its own `applies` gives it (a document's operator over all of them) that the frame
/// evaluates, while a check phase's operators run once at check and cost no frame; each pass over
/// the frame and the items of its module's kinds; and the CPU each module's kinds register per
/// item. GPU memory holds every item, moving or not.
pub fn estimate(doc: &Value, sealed: &Sealed, coefficients: &Coefficients) -> Estimate {
    estimate_by(doc, sealed, coefficients, |entries, work| {
        vec![work(entries)]
    })
}

/// [`estimate`], reading the items on their own through `split`, which runs `work` over runs of
/// the entries and returns each run's facts in order: the check splits a big document's across
/// the cores.
pub(crate) fn estimate_by(
    doc: &Value,
    sealed: &Sealed,
    coefficients: &Coefficients,
    split: impl for<'e> FnOnce(
        &mut [Entry<'e>],
        &(dyn Fn(&mut [Entry<'e>]) -> Facts<'e> + Sync),
    ) -> Vec<Facts<'e>>,
) -> Estimate {
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let px = doc
        .get("size")
        .and_then(Value::as_array)
        .map_or(0.0, |s| s.iter().filter_map(Value::as_f64).product::<f64>());
    let mut out = Estimate::default();
    let mut cpu_ns = 0.0;
    let mut gpu_ns = 0.0;
    let mut bytes = 0.0;
    // The frame operators over items, in plan order.
    let item_ops: Vec<&SealedOp> = sealed
        .ops
        .iter()
        .filter(|o| o.op.run.is_some() && !is_check_phase(&o.op.phase) && o.op.per != Per::Document)
        .collect();
    // Each item's facts, read once, not once per operator, pass and module.
    let mut entries: Vec<Entry<'_>> = items
        .iter()
        .enumerate()
        .map(|(i, (id, item))| (i, id, item))
        .collect();
    let mut f = Facts {
        fulls: Vec::with_capacity(items.len()),
        counts: Vec::with_capacity(items.len()),
        applies: Vec::with_capacity(items.len() * item_ops.len()),
        named: Vec::new(),
        hidden: Vec::with_capacity(items.len()),
    };
    for part in split(&mut entries, &|run| facts(doc, items, &item_ops, run)) {
        f.fulls.extend(part.fulls);
        f.counts.extend(part.counts);
        f.applies.extend(part.applies);
        f.named.extend(part.named);
        f.hidden.extend(part.hidden);
    }
    let ids: Vec<&str> = items.keys().map(String::as_str).collect();
    let evaluated = moving(&item_ops, &f, &ids);
    let mut by_item = vec![0.0; items.len()];
    // The next item operator's row in `f.applies`.
    let mut k = 0;
    for op in &sealed.ops {
        if op.op.run.is_none() || is_check_phase(&op.op.phase) {
            continue;
        }
        let t = coefficients.get(&op.key);
        // A document's operator works over every item, so its terms are per item of the document.
        let document = op.op.per == Per::Document;
        if document && op.op.applies.is_some_and(|f| !f(doc, "", &Value::Null)) {
            continue;
        }
        let row = (!document).then(|| {
            k += 1;
            k - 1
        });
        for i in 0..items.len() {
            if row.is_some_and(|k| !f.applies[i * item_ops.len() + k]) {
                continue;
            }
            bytes += t.bytes_per_item;
            // #1938: an item `visible: false` draws nothing, and the frame's evaluation skips
            // it; a document's operator still works over it.
            if (f.hidden[i] && !document) || evaluated.as_ref().is_some_and(|e| !e[i]) {
                continue;
            }
            let c = f.counts[i];
            let ns =
                t.ns_per_item + t.ns_per_vertex * c.vertices + t.ns_per_frame_glyph() * c.glyphs;
            cpu_ns += ns;
            by_item[i] += ns;
        }
    }
    for m in &sealed.modules {
        let kinds: Vec<String> = m
            .shapes
            .kinds
            .iter()
            .map(|k| format!("{}.{}", k.entry.family, k.entry.name))
            .collect();
        // A GPU operator item (`gpu.*`, #429) runs as its own pass, never as the module's
        // shipped ones, so it doesn't charge them; nor does an item `visible: false` (#1938),
        // which no pass draws.
        let drawn: Vec<usize> = (0..f.fulls.len())
            .filter(|&i| {
                !f.hidden[i]
                    && !f.fulls[i].starts_with("gpu.")
                    && kinds.iter().any(|x| x == f.fulls[i])
            })
            .collect();
        if drawn.is_empty() {
            continue;
        }
        for pass in &m.shapes.passes {
            let t = coefficients.get(&pass.name);
            gpu_ns += t.ns_per_px * px;
            bytes += t.bytes_per_px * px;
            for &i in &drawn {
                let ns = t.ns_per_vertex * f.counts[i].vertices + t.ns_per_item;
                gpu_ns += ns;
                bytes += t.bytes_per_item;
                by_item[i] += ns;
            }
        }
    }
    let mut costs: BTreeMap<&str, Vec<_>> = BTreeMap::new();
    for (i, item) in items.values().enumerate() {
        if f.hidden[i] {
            continue;
        }
        let registered = costs
            .entry(f.fulls[i])
            .or_insert_with(|| sealed.costs_for(f.fulls[i]));
        for c in registered.iter() {
            let ns = c(item) * 1e6;
            cpu_ns += ns;
            by_item[i] += ns;
        }
    }
    out.cpu_ms = cpu_ns / 1e6;
    out.gpu_ms = gpu_ns / 1e6;
    out.gpu_mb = bytes / 1e6;
    out.by_item = items.keys().cloned().zip(by_item).collect();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{BuildSet, Manifest, Module, Range, Registrar, Registry, Semver};
    use crate::schedule::Val;

    fn register_tick(r: &mut Registrar) {
        r.array("tick.at", "f64", "item", "geometry", "items");
        r.operator("move", "items", &["t"], &["tick.at"])
            .applies(|_, _, item| item.pointer("/params/moves") == Some(&json!(true)))
            .run(|v| v.write("tick.at", Val::typed(0.0f64)));
    }

    /// A module whose operator reads the time over the items marked `moves`, as a channel does.
    fn tick() -> Module {
        Module {
            manifest: Manifest {
                name: "tick".into(),
                version: Semver {
                    major: 1,
                    minor: 0,
                    patch: 0,
                },
                core: Range::parse("*").expect("a range"),
                depends_on: BTreeMap::new(),
                feature: "tick".into(),
                license: "Apache-2.0".into(),
                implements: "tick@1".into(),
                implementation: crate::registry::Implementation::reference(
                    "tick",
                    Semver {
                        major: 1,
                        minor: 0,
                        patch: 0,
                    },
                ),
            },
            register: register_tick,
        }
    }

    /// A board of `still` still rects, beside a moving one when `moves`, its child and a rect
    /// whose params name it.
    fn board(still: usize, moves: bool) -> Value {
        let rect = |params: Value| json!({"kind": "rect@1", "params": params});
        let mut items = Map::new();
        for i in 0..still {
            items.insert(format!("s{i}"), rect(json!({"box": [0, 0, 1, 1]})));
        }
        items.insert(
            "m".into(),
            rect(json!({"box": [0, 0, 1, 1], "moves": moves})),
        );
        let mut child = rect(json!({"box": [0, 0, 1, 1]}));
        child["parent"] = json!("m");
        items.insert("child".into(), child);
        items.insert(
            "namer".into(),
            rect(json!({"box": [0, 0, 1, 1], "near": "m"})),
        );
        json!({"format": 1, "size": [100, 100], "items": items})
    }

    #[test]
    fn a_frame_charges_its_moving_items_and_their_readers_and_no_check_phase() {
        let sealed = Registry::new(BuildSet::Core)
            .with(tick())
            .seal()
            .expect("seals");
        let per_item = |ns| Terms {
            ns_per_item: ns,
            ..Terms::default()
        };
        let coefficients = Coefficients {
            fingerprint: Value::Null,
            build: Value::Null,
            terms: BTreeMap::from([
                ("core.fields".to_string(), per_item(1000.0)),
                ("core.lower".to_string(), per_item(1e6)),
            ]),
        };
        // The moving rect, its child and the rect naming it, never the 100 still ones.
        let moving = estimate(&board(100, true), &sealed, &coefficients);
        assert_eq!(moving.cpu_ms, 0.003);
        assert_eq!(moving.top(5), ["child", "m", "namer"]);
        // Nothing moves: the frame that shows it evaluates every item.
        let still = estimate(&board(100, false), &sealed, &coefficients);
        assert_eq!(still.cpu_ms, 0.103);
    }

    #[test]
    fn a_file_from_a_build_that_isnt_optimized_is_refused_naming_its_profile() {
        let file = |build: &str| format!(r#"{{"fingerprint": {{}}, {build} "terms": {{}}}}"#);
        let dev = Coefficients::read(&file(
            r#""build": {"profile": "dev", "toolchain": "rustc"},"#,
        ));
        assert_eq!(dev.map_err(|r| r.profile), Err(Some("dev".to_string())));
        let none = Coefficients::read(&file(""));
        assert_eq!(none.map_err(|r| r.profile), Err(None));
        assert!(Coefficients::read(&file(
            r#""build": {"profile": "release", "toolchain": "rustc"},"#
        ))
        .is_ok());
    }

    #[test]
    fn a_path_counts_its_coordinate_pairs() {
        assert_eq!(path_vertices("M0 40 L12.5 60 L25 40"), 3.0);
        assert_eq!(path_vertices("M-1 -2 L3e2 4"), 2.0);
    }

    #[test]
    fn the_top_contributors_are_the_costliest_items_ties_by_id() {
        let e = Estimate {
            by_item: vec![
                ("a".into(), 5.0),
                ("b".into(), 50.0),
                ("c".into(), 5.0),
                ("d".into(), 0.0),
            ],
            ..Estimate::default()
        };
        assert_eq!(e.top(3), ["b", "a", "c"]);
    }
}
