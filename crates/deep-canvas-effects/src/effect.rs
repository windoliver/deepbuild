//! Issue #508: `effect@1`'s film kinds (canvas primitives: Effect; Particles `particles@1`):
//! `wave_field`, `plume`, `arc` and `airflow`, each with its params under its own name, every
//! number ranged and refused at check naming its field. A plume and an airflow are presets of
//! particles@1: [`lower`] writes their particles items into the document beside the effect, so
//! they draw, bound and evaluate as any particles item does; a wave field and an arc are shipped
//! pass graphs ([`crate::shipped::wave_field`], [`crate::shipped::arc`]), and a plume's haze is
//! [`crate::shipped::haze`].

use serde_json::{json, Map, Value};

use crate::particles::spec::Refusal;

/// The film kinds, as `effect@1`'s `kind` names them.
pub const KINDS: [&str; 4] = ["wave_field", "plume", "arc", "airflow"];

/// One number of a kind's params: its path under the kind's param, its default and its range.
pub struct F {
    pub path: &'static str,
    pub default: f64,
    pub min: f64,
    pub max: f64,
}

const fn f(path: &'static str, default: f64, min: f64, max: f64) -> F {
    F {
        path,
        default,
        min,
        max,
    }
}

/// At most this many shock cells: a cell's bright and dim keys fit the draw's 12 opacity keys.
pub const MAX_SHOCK_CELLS: f64 = 4.0;
/// At most this many airflow paths.
pub const MAX_PATHS: usize = 8;

const PLUME: &[F] = &[
    f("radius", 0.25, 0.001, 100.0),
    f("reach", 2.0, 0.0, 1000.0),
    f("heat", 1.0, 0.0, 64.0),
    f("shock_cells", 0.0, 0.0, MAX_SHOCK_CELLS),
    f("turbulence", 0.2, 0.0, 100.0),
    f("seed", 0.0, 0.0, 4_294_967_295.0),
    f("haze/strength", 0.0, 0.0, 32.0),
    f("haze/scale", 0.5, 0.001, 100.0),
];
const AIRFLOW: &[F] = &[
    f("around/copies", 1.0, 1.0, 16.0),
    f("around/span/0", 0.0, -360.0, 360.0),
    f("around/span/1", 360.0, -360.0, 360.0),
    f("count", 256.0, 1.0, 65_536.0),
    f("speed", 1.0, 0.001, 1000.0),
    f("length", 2.0, 0.001, 1000.0),
    f("fade/in", 0.0, 0.0, 60.0),
    f("fade/out", 0.0, 0.0, 60.0),
];
const WAVE_FIELD: &[F] = &[
    f("amplitude", 1.0, 0.0, 64.0),
    f("wavelength", 0.5, 0.001, 1000.0),
    f("speed", 1.0, -1000.0, 1000.0),
    f("radius", 3.0, 0.001, 10_000.0),
];
const ARC: &[F] = &[
    f("intensity", 4.0, 0.0, 64.0),
    f("width", 2.0, 0.25, 64.0),
    f("jitter", 12.0, 0.0, 256.0),
    f("rate", 12.0, 0.0, 120.0),
    f("waves", 6.0, 1.0, 64.0),
];

/// A kind's ranged numbers.
pub fn fields(kind: &str) -> &'static [F] {
    match kind {
        "plume" => PLUME,
        "airflow" => AIRFLOW,
        "wave_field" => WAVE_FIELD,
        "arc" => ARC,
        _ => &[],
    }
}

fn at<'a>(v: &'a Value, path: &str) -> &'a Value {
    path.split('/').fold(v, |v, k| match k.parse::<usize>() {
        Ok(i) if v.is_array() => &v[i],
        _ => &v[k],
    })
}

/// The number at `path` of the item's `kind` param, or its default.
pub fn num(params: &Value, kind: &str, path: &str) -> f64 {
    let d = fields(kind).iter().find(|x| x.path == path);
    at(&params[kind], path)
        .as_f64()
        .or(d.map(|x| x.default))
        .unwrap_or(0.0)
}

/// The item's `axis`, unit, +Y when it gives none or a zero one.
pub fn axis(v: &Value) -> [f64; 3] {
    let a = [0, 1, 2].map(|k| v[k].as_f64().unwrap_or(0.0));
    let l = deep_canvas::ops::sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    if v.as_array().is_some_and(|x| x.len() == 3) && l > 0.0 {
        a.map(|x| x / l)
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// The effect's resolution as a scale of the view: full 1, half ½, quarter ¼.
pub fn scale(params: &Value) -> f64 {
    match params["resolution"].as_str() {
        Some("full") => 1.0,
        Some("quarter") => 0.25,
        _ => 0.5,
    }
}

/// Whether an item is an effect of a film kind, and which.
pub fn kind_of(item: &Value) -> Option<&str> {
    (item["kind"] == "effect@1")
        .then(|| item["params"]["kind"].as_str())
        .flatten()
        .filter(|k| KINDS.contains(k))
}

/// The refusals of item `id`'s params: every number out of its range, naming its field, and an
/// arc's or an airflow's names that reach nothing.
pub fn refusals(doc: &Value, id: &str, item: &Value) -> Vec<Refusal> {
    let Some(kind) = kind_of(item) else {
        return Vec::new();
    };
    let p = &item["params"];
    let path = |f: &str| format!("items/{id}/params/{f}");
    let bad = |f: &str, what: String| Refusal::new("out_of_range", path(f), format!("{id}: {what}"));
    let mut out = Vec::new();
    for x in fields(kind) {
        let v = at(&p[kind], x.path);
        if v.is_null() {
            continue;
        }
        match v.as_f64() {
            Some(n) if n.is_finite() && n >= x.min && n <= x.max => {}
            _ => out.push(
                bad(
                    &format!("{kind}/{}", x.path),
                    format!("{kind}.{} runs from {} to {}", x.path.replace('/', "."), x.min, x.max),
                )
                .with(v.clone()),
            ),
        }
    }
    if !p["resolution"].is_null()
        && !matches!(p["resolution"].as_str(), Some("full" | "half" | "quarter"))
    {
        out.push(bad("resolution", "resolution is full, half or quarter".into()));
    }
    if !(p["seed"].is_null() || p["seed"] == "item" || p["seed"].is_u64()) {
        out.push(bad("seed", "seed is item or a whole number".into()));
    }
    for (f, v) in [("axis", &p["axis"]), ("airflow/around/axis", at(p, "airflow/around/axis"))] {
        let three = v.as_array().filter(|a| a.len() == 3 && a.iter().all(Value::is_number));
        let zero = three.is_some_and(|a| a.iter().all(|x| x.as_f64() == Some(0.0)));
        if !v.is_null() && (three.is_none() || zero) {
            out.push(bad(f, format!("{f} is three numbers, not all 0")));
        }
    }
    let items = &doc["items"];
    let names = |v: &Value, kinds: &[&str]| v.as_str().is_some_and(|n| kinds.is_empty() || kinds.contains(&items[n]["kind"].as_str().unwrap_or("")));
    if kind == "arc" && !names(&p["arc"]["to"], &[]) {
        out.push(Refusal::new("ref_unresolved", path("arc/to"), format!("{id}: arc.to names no item")));
    }
    if kind == "airflow" {
        let paths = p["airflow"]["paths"].as_array().map_or(&[][..], Vec::as_slice);
        if paths.is_empty() || paths.len() > MAX_PATHS {
            out.push(bad("airflow/paths", format!("airflow.paths names 1 to {MAX_PATHS} curves")));
        }
        let copies = num(p, "airflow", "around/copies");
        for (j, c) in paths.iter().enumerate() {
            let f = format!("airflow/paths/{j}");
            if !names(c, &["curve@1"]) {
                out.push(Refusal::new("ref_unresolved", path(&f), format!("{id}: {f} names no curve@1")));
            } else if copies > 1.0 && literal(&items[c.as_str().unwrap_or("")]).is_none() {
                out.push(bad(&f, format!("{f} is turned about an axis, so its curve gives literal points")));
            }
        }
    }
    out
}

/// A curve item's literal points.
fn literal(curve: &Value) -> Option<Vec<[f64; 3]>> {
    curve["params"]["points"]
        .as_array()?
        .iter()
        .map(|q| {
            let a = q.as_array().filter(|a| a.len() == 3)?;
            Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
        })
        .collect()
}

/// Every film effect's refusals over `doc`, as the check's issues a refused call holds.
pub fn issues(doc: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    for (id, item) in doc["items"].as_object().into_iter().flatten() {
        for r in refusals(doc, id, item) {
            out.push(json!({"code": r.code, "severity": "error", "ids": [id], "path": r.path,
                            "actual": *r.actual, "what": r.what}));
        }
    }
    out
}

/// A plume's particles: how many, and each one's life, s (its speed is its reach over its life).
pub const PLUME_COUNT: u64 = 2048;
pub const PLUME_LIFE: f64 = 1.0;
/// A plume puff's size over life, px.
pub const PLUME_SIZE: [f64; 2] = [14.0, 36.0];

/// Each preset's cost, ns per px of the view at its particles' resolution (= ms per megapixel; a
/// plume's puffs at half, an airflow's streaks at full), as `view3d` timed its `effect/<item>` pass
/// on this crate's fixtures (the plume without haze) at 1920 × 1080 on a reference Mac (Mac17,10),
/// as [`crate::shipped::EFFECT_MEASURED_NS_PER_PX`] was. Its particles cost by count, not by px, so
/// the declaration holds at that size.
pub const COST: [(&str, f64); 2] = [("plume", 2.12), ("airflow", 0.216)];

/// A preset's cost, ns per px at its resolution.
pub fn cost(kind: &str) -> Option<f64> {
    COST.iter().find(|(k, _)| *k == kind).map(|(_, c)| *c)
}

/// The document with each plume's and airflow's particles@1 items written beside it: a plume's
/// `<id>.particles`, an airflow's `<id>.p<j>c<k>` for path j and copy k, with each copy's curve
/// `<id>.p<j>c<k>.curve` turned about the axis through the curve's own origin. Each written item
/// carries `lowered: <effect>`, and those of an earlier lowering go first, so lowering again
/// after a patch gives the same document.
pub fn lower(doc: &mut Value) {
    let Some(items) = doc["items"].as_object_mut() else {
        return;
    };
    items.retain(|_, v| v.get("lowered").is_none());
    let mut added = Map::new();
    for (id, item) in items.iter() {
        let p = &item["params"];
        let derived = |key: &str, params: Value, k: usize| {
            let mut d = item.clone();
            if d.get("id").is_some() {
                d["id"] = json!(key);
            }
            d["kind"] = json!("particles@1");
            d["params"] = params;
            d["lowered"] = json!(id);
            if let Some(o) = item["order"].as_str() {
                d["order"] = json!(format!("{o}{k}"));
            }
            d
        };
        match kind_of(item) {
            Some("plume") => {
                let n = |f: &str| num(p, "plume", f);
                let a = axis(&p["axis"]);
                let v = a.map(|x| x * n("reach") / PLUME_LIFE);
                let mut params = json!({
                    "count": PLUME_COUNT, "life": PLUME_LIFE,
                    "emit": {"shape": {"sphere": {"r": n("radius")}}, "rate": PLUME_COUNT as f64 / PLUME_LIFE},
                    "motion": {"ballistic": {"velocity": v, "gravity": [0.0, 0.0, 0.0]}},
                    "opacity": shock_keys(n("heat"), n("shock_cells") as usize),
                    "size": PLUME_SIZE, "draw": "puff",
                    "resolution": if scale(p) >= 1.0 { "full" } else { "half" },
                });
                if let Some(anchor) = p["anchor"].as_str() {
                    params["emit"]["anchor"] = json!(anchor);
                }
                if n("turbulence") > 0.0 {
                    params["turbulence"] = json!({"strength": n("turbulence"), "frequency": 1.0 / n("radius"),
                                                  "seed": n("seed") as u64});
                }
                let key = format!("{id}.particles");
                added.insert(key.clone(), derived(&key, params, 0));
            }
            Some("airflow") => {
                let n = |f: &str| num(p, "airflow", f);
                let copies = n("around/copies").max(1.0) as usize;
                let (a0, a1) = (n("around/span/0"), n("around/span/1"));
                let whole = (a1 - a0).abs() >= 360.0;
                let around = axis(at(p, "airflow/around/axis"));
                let life = n("length") / n("speed");
                let paths = p["airflow"]["paths"].as_array().cloned().unwrap_or_default();
                for (j, c) in paths.iter().filter_map(Value::as_str).enumerate() {
                    for k in 0..copies {
                        let steps = if whole { copies } else { (copies - 1).max(1) };
                        let deg = a0 + (a1 - a0) * k as f64 / steps as f64;
                        let pid = format!("{id}.p{j}c{k}");
                        let curve = match literal(&items[c]) {
                            Some(points) if deg != 0.0 => {
                                let mut cv = items[c].clone();
                                let turned: Vec<[f64; 3]> =
                                    points.iter().map(|q| turn(*q, around, deg)).collect();
                                cv["params"]["points"] = json!(turned);
                                cv["lowered"] = json!(id);
                                if cv.get("id").is_some() {
                                    cv["id"] = json!(format!("{pid}.curve"));
                                }
                                added.insert(format!("{pid}.curve"), cv);
                                format!("{pid}.curve")
                            }
                            _ => c.to_string(),
                        };
                        let params = json!({
                            "count": n("count") as u64, "life": life,
                            "emit": {"shape": {"along": curve}, "rate": n("count") / life},
                            "motion": {"along": {"curve": curve, "speed": n("speed")}},
                            "opacity": fade_keys(n("fade/in") / life, n("fade/out") / life),
                            "draw": "streak",
                        });
                        added.insert(pid.clone(), derived(&pid, params, j * copies + k));
                    }
                }
            }
            _ => {}
        }
    }
    items.extend(added);
}

/// A plume's opacity over life: `heat` at birth, then each shock cell's dim and bright keys, and
/// 0 at death.
fn shock_keys(heat: f64, cells: usize) -> Value {
    let cells = cells.min(MAX_SHOCK_CELLS as usize);
    if cells == 0 {
        return json!([{"at": 0.0, "value": heat}, {"at": 1.0, "value": heat}]);
    }
    let n = 2 * cells + 1;
    let keys: Vec<Value> = (0..=n)
        .map(|j| {
            let value = match j {
                _ if j == n => 0.0,
                _ if j % 2 == 0 => heat,
                _ => 0.45 * heat,
            };
            json!({"at": j as f64 / n as f64, "value": value})
        })
        .collect();
    json!(keys)
}

/// An airflow streak's opacity over life: in from 0 over the share `fin`, out to 0 over `fout`.
fn fade_keys(fin: f64, fout: f64) -> Value {
    let a = fin.clamp(0.0, 1.0);
    let b = (1.0 - fout).clamp(a, 1.0);
    json!([
        {"at": 0.0, "value": if a > 0.0 { 0.0 } else { 1.0 }},
        {"at": a, "value": 1.0},
        {"at": b, "value": 1.0},
        {"at": 1.0, "value": if b < 1.0 { 0.0 } else { 1.0 }},
    ])
}

/// `q` turned `deg` about the unit axis `k` through the origin (Rodrigues' rotation).
fn turn(q: [f64; 3], k: [f64; 3], deg: f64) -> [f64; 3] {
    let (s, c) = (
        deep_canvas::ops::sin(deg.to_radians()),
        deep_canvas::ops::cos(deg.to_radians()),
    );
    let d = k[0] * q[0] + k[1] * q[1] + k[2] * q[2];
    let x = [
        k[1] * q[2] - k[2] * q[1],
        k[2] * q[0] - k[0] * q[2],
        k[0] * q[1] - k[1] * q[0],
    ];
    [0, 1, 2].map(|i| q[i] * c + x[i] * s + k[i] * d * (1.0 - c))
}

/// Each film kind's fixture document (AC6: each draws a fixture from its params).
pub fn fixture(kind: &str) -> Option<Value> {
    let text = match kind {
        "wave_field" => include_str!("../fixtures/wave_field.json"),
        "plume" => include_str!("../fixtures/plume.json"),
        "arc" => include_str!("../fixtures/arc.json"),
        "airflow" => include_str!("../fixtures/airflow.json"),
        _ => return None,
    };
    serde_json::from_str(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::particles::{eval, spec, turbulence};

    fn effect(kind: &str, params: Value) -> Value {
        let mut p = json!({"kind": kind});
        p[kind] = params;
        json!({"kind": "effect@1", "params": p})
    }

    fn doc(items: Value) -> Value {
        json!({"items": items})
    }

    /// Every number of every kind: refused just past either end of its range, naming its own
    /// field, and passed at both ends and its default; `None` when that holds of `rule`.
    fn ranges_hold(rule: &dyn Fn(&Value, &str, &Value) -> Vec<Refusal>) -> Option<String> {
        let names = json!({"b": {"kind": "mark.box@1"}, "c": {"kind": "curve@1", "params": {"points": [[0, 0, 0], [1, 0, 0]]}}});
        for kind in KINDS {
            for x in fields(kind) {
                let base = |v: f64| {
                    let mut params = json!({});
                    if kind == "arc" {
                        params["to"] = json!("b");
                    }
                    if kind == "airflow" {
                        params["paths"] = json!(["c"]);
                    }
                    let mut slot = &mut params;
                    let parts: Vec<&str> = x.path.split('/').collect();
                    for (k, part) in parts.iter().enumerate() {
                        let last = k + 1 == parts.len();
                        slot = match part.parse::<usize>() {
                            Ok(i) => {
                                if !slot.is_array() {
                                    *slot = json!([0.0, 360.0]);
                                }
                                &mut slot[i]
                            }
                            Err(_) if last => &mut slot[*part],
                            Err(_) => {
                                if slot[*part].is_null() {
                                    slot[*part] = json!({});
                                }
                                &mut slot[*part]
                            }
                        };
                    }
                    *slot = json!(v);
                    let mut items = names.clone();
                    items["e"] = effect(kind, params);
                    doc(items)
                };
                let want = format!("items/e/params/{kind}/{}", x.path);
                let span = (x.max - x.min).max(1.0);
                for v in [x.min - 1e-3 * span, x.max + 1e-3 * span] {
                    let d = base(v);
                    let got: Vec<String> = rule(&d, "e", &d["items"]["e"]).into_iter().map(|r| r.path).collect();
                    if got != [want.clone()] {
                        return Some(format!("{kind}.{} = {v}: refused at {got:?}, not {want}", x.path));
                    }
                }
                for v in [x.min, x.max, x.default] {
                    let d = base(v);
                    let got = rule(&d, "e", &d["items"]["e"]);
                    if !got.is_empty() {
                        return Some(format!("{kind}.{} = {v} is in range, refused at {}", x.path, got[0].path));
                    }
                }
            }
        }
        None
    }

    /// Each film kind's numbers are refused past their ranges naming the field; the twin that
    /// names the kind's param, not the field, fails it.
    #[test]
    fn ranges_refuse_naming_the_field() {
        assert_eq!(ranges_hold(&refusals), None);
        let twin = |d: &Value, id: &str, item: &Value| -> Vec<Refusal> {
            refusals(d, id, item)
                .into_iter()
                .map(|mut r| {
                    let kind = item["params"]["kind"].as_str().unwrap_or("");
                    r.path = format!("items/{id}/params/{kind}");
                    r
                })
                .collect()
        };
        assert!(ranges_hold(&twin).is_some(), "the twin naming the kind's param passes");
    }

    /// The farthest any live particle of `doc`'s item `id` stands from `origin` over 3 s.
    fn farthest(doc: &Value, id: &str, origin: [f64; 3]) -> f64 {
        let item = &doc["items"][id];
        let s = spec::read(doc, id, &item["params"]).expect("the plume's particles read");
        let mut b = eval::Baked::new(id, s.clone(), 11, origin);
        b.turbulence = s.turbulence.map(|t| turbulence::build(&t, 11, false));
        let mut far: f64 = 0.0;
        for k in 0..30 {
            let cols = eval::columns(&b, 0.1 * f64::from(k));
            for row in cols.chunks(eval::FLOATS).filter(|r| r[3] >= 0.0) {
                let d = [0, 1, 2].map(|i| row[i] - origin[i]);
                far = far.max(crate::particles::len(d));
            }
        }
        far
    }

    /// A plume lowers to particles@1 whose f64 closed form stays within its radius, reach and
    /// turbulence of its anchor; the twin whose speed ignores the reach goes past it.
    #[test]
    fn plume_particles_stay_within_reach_and_turbulence() {
        let p = json!({"radius": 0.1, "reach": 0.5, "turbulence": 0.2, "seed": 3});
        let mut d = doc(json!({"pl": effect("plume", p)}));
        lower(&mut d);
        let derived = &d["items"]["pl.particles"];
        assert_eq!(derived["kind"], "particles@1");
        assert_eq!(derived["lowered"], "pl");
        let bound = 0.1 + 0.5 + 0.2;
        let far = farthest(&d, "pl.particles", [0.0; 3]);
        assert!(far > 0.3 && far <= bound + 1e-9, "farthest {far} against {bound}");
        // The twin: a speed of 2 m/s whatever the reach.
        let mut twin = d.clone();
        twin["items"]["pl.particles"]["params"]["motion"]["ballistic"]["velocity"] = json!([0.0, 2.0, 0.0]);
        assert!(farthest(&twin, "pl.particles", [0.0; 3]) > bound, "the twin stays within reach");
        // Lowered again, it's the same document.
        let once = d.clone();
        lower(&mut d);
        assert_eq!(d, once);
    }

    /// The angles each copy of path 0 stands at about +Y, from its first point.
    fn angles(d: &Value) -> Vec<f64> {
        (0..3)
            .map(|k| {
                let pid = format!("fl.p0c{k}");
                let curve = d["items"][&pid]["params"]["motion"]["along"]["curve"].as_str().unwrap_or_default().to_string();
                let q = &d["items"][&curve]["params"]["points"][0];
                let (x, z) = (q[0].as_f64().unwrap_or(0.0), q[2].as_f64().unwrap_or(0.0));
                (deep_canvas::ops::atan2(-z, x).to_degrees() + 360.0) % 360.0
            })
            .collect()
    }

    fn turned_by_thirds(a: &[f64]) -> bool {
        a.len() == 3 && a.iter().zip([0.0, 120.0, 240.0]).all(|(x, w)| (x - w).abs() < 1e-9 || (x - w).abs() > 360.0 - 1e-9)
    }

    /// An airflow's three copies of a path stand at 0, 120 and 240° about its axis; the twin
    /// that doesn't turn them fails.
    #[test]
    fn airflow_copies_turn_by_thirds() {
        let a = json!({"paths": ["c"], "around": {"axis": [0, 1, 0], "copies": 3}});
        let mut d = doc(json!({
            "c": {"kind": "curve@1", "params": {"points": [[1.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}},
            "fl": effect("airflow", a),
        }));
        lower(&mut d);
        assert!(turned_by_thirds(&angles(&d)), "angles {:?}", angles(&d));
        for k in 0..3 {
            assert_eq!(d["items"][&format!("fl.p0c{k}")]["params"]["draw"], "streak");
        }
        let mut twin = d.clone();
        for k in 0..3 {
            twin["items"][&format!("fl.p0c{k}")]["params"]["motion"]["along"]["curve"] = json!("c");
        }
        assert!(!turned_by_thirds(&angles(&twin)), "the unturned twin passes");
    }
}
