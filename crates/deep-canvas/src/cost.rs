//! The cost model (issue #379; canvas primitives: The cost model). Every operator and render pass
//! declares terms, nanoseconds per item, vertex and glyph on the CPU and per pixel and vertex on
//! the GPU, plus bytes of GPU memory per item and per pixel, whose coefficients a micro-benchmark
//! measured on a reference Mac (`costs.json`, with that machine's environment fingerprint). The
//! check sums them over a document into CPU time, GPU time and GPU memory per frame from those
//! coefficients alone, so a refusal is the same on every machine, and names the items that cost
//! the most. A coefficient file names the build that measured it, its Cargo profile and its
//! toolchain, and is read only when that profile is optimized (issue #855): a debug build's
//! timings are of crates the shipped build optimizes.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::registry::{Per, Sealed};

/// The coefficients the reference Mac measured (`node benchmarks/canvas.mjs costs --write`).
pub const REFERENCE: &str = include_str!("../costs.json");

/// One operator's or pass's terms.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Terms {
    pub ns_per_item: f64,
    pub ns_per_vertex: f64,
    pub ns_per_glyph: f64,
    pub ns_per_px: f64,
    pub bytes_per_item: f64,
    pub bytes_per_px: f64,
}

const TERMS: [&str; 6] = [
    "ns_per_item",
    "ns_per_vertex",
    "ns_per_glyph",
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
            ns_per_px: n(TERMS[3]),
            bytes_per_item: n(TERMS[4]),
            bytes_per_px: n(TERMS[5]),
        }
    }

    /// The terms it declares, without the zeros.
    pub fn to_json(&self) -> Value {
        let values = [
            self.ns_per_item,
            self.ns_per_vertex,
            self.ns_per_glyph,
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
            t.ns_per_px *= factor;
        }
        out
    }

    fn get(&self, name: &str) -> Terms {
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

/// The estimate of `doc` (lowered) in the build `sealed` describes, from `coefficients`: each
/// operator over the items its own `applies` gives it (a document's operator over all of them),
/// each pass over the frame and the items of its module's kinds, and the CPU each module's kinds
/// register per item.
pub fn estimate(doc: &Value, sealed: &Sealed, coefficients: &Coefficients) -> Estimate {
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
    let mut by_item: BTreeMap<&str, f64> = BTreeMap::new();
    for op in &sealed.ops {
        if op.op.run.is_none() {
            continue;
        }
        let t = coefficients.get(&op.key);
        // A document's operator works over every item, so its terms are per item of the document.
        let document = op.op.per == Per::Document;
        if document && op.op.applies.is_some_and(|f| !f(doc, "", &Value::Null)) {
            continue;
        }
        for (id, item) in items {
            if !document && op.op.applies.is_some_and(|f| !f(doc, id, item)) {
                continue;
            }
            let c = counts(item);
            let ns = t.ns_per_item + t.ns_per_vertex * c.vertices + t.ns_per_glyph * c.glyphs;
            cpu_ns += ns;
            bytes += t.bytes_per_item;
            *by_item.entry(id).or_default() += ns;
        }
    }
    for m in &sealed.modules {
        let kinds: Vec<String> = m
            .shapes
            .kinds
            .iter()
            .map(|k| format!("{}.{}", k.entry.family, k.entry.name))
            .collect();
        let drawn: Vec<(&String, &Value)> = items
            .iter()
            .filter(|(_, i)| {
                i.get("kind")
                    .and_then(Value::as_str)
                    .and_then(|k| k.split('@').next())
                    .is_some_and(|k| kinds.iter().any(|x| x == k))
            })
            .collect();
        if drawn.is_empty() {
            continue;
        }
        for pass in &m.shapes.passes {
            let t = coefficients.get(&pass.name);
            gpu_ns += t.ns_per_px * px;
            bytes += t.bytes_per_px * px;
            for (id, item) in &drawn {
                let ns = t.ns_per_vertex * counts(item).vertices + t.ns_per_item;
                gpu_ns += ns;
                bytes += t.bytes_per_item;
                *by_item.entry(id.as_str()).or_default() += ns;
            }
        }
    }
    for (id, item) in items {
        let full = item
            .get("kind")
            .and_then(Value::as_str)
            .and_then(|k| k.split('@').next())
            .unwrap_or("");
        for c in sealed.costs_for(full) {
            let ns = c(item) * 1e6;
            cpu_ns += ns;
            *by_item.entry(id).or_default() += ns;
        }
    }
    out.cpu_ms = cpu_ns / 1e6;
    out.gpu_ms = gpu_ns / 1e6;
    out.gpu_mb = bytes / 1e6;
    out.by_item = items
        .keys()
        .map(|id| (id.clone(), by_item.get(id.as_str()).copied().unwrap_or(0.0)))
        .collect();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
