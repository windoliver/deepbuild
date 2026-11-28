//! `effects.audit` (canvas primitives: Check input: loop kinds), the effects module's, beside
//! its shipped effects, so the loop module depends only on scene3d and look (#1940).
//!

use deep_canvas::registry::{Frame, Raised, Report};
use serde_json::{json, Value};

use crate::particles::{bounds, eval, item, rule, Planted, V3};

pub const KIND: &str = "effects.audit";
pub const UNREAD: &str = "effects.audit_unread";
pub const COUNT: &str = "effects.count_peak";
pub const BOUNDS: &str = "effects.bounds";
pub const OVERDRAW: &str = "effects.overdraw";
pub const GPU_MS: &str = "effects.gpu_ms";

const OVERDRAW_MAX: f64 = 8.0;
const FLICKS: f64 = 705_600_000.0;
const MAX_FRAMES: usize = 1 << 14;
const MAX_STATES: usize = 1 << 26;

pub fn report(lowered: &Value, input: &Value) -> Report {
    let mut r = frames(lowered, input, &[]);
    r.blocked.retain(|b| b["reason"] != "not_run");
    r
}

#[derive(Default)]
struct Read {
    peak: usize,
    at: f64,
    reach: Option<[V3; 2]>,
    key: String,
    bake: Option<eval::Baked>,
    refused: Option<Value>,
}

pub fn frames(lowered: &Value, input: &Value, drawn: &[Frame]) -> Report {
    let mut out = Report::default();
    let items = rule::items(lowered);
    if items.is_empty() {
        let others: Vec<&str> = lowered["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, it)| {
                it["kind"]
                    .as_str()
                    .is_some_and(|k| k.starts_with("particles"))
            })
            .map(|(id, _)| id.as_str())
            .collect();
        out.blocked.push(
            json!({"code": UNREAD, "reason": "no_effect", "kind": KIND, "ids": others,
            "why": "the deliverable holds no particles@1 item, the only kind it reads"}),
        );
        return out;
    }
    let Some(reads) = readings(lowered, &items) else {
        for (id, _) in &items {
            out.blocked.push(
                json!({"code": UNREAD, "reason": "not_bounded", "kind": KIND, "ids": [id],
                "why": format!("its span can't be read, isn't finite or runs past {MAX_FRAMES} frames")}),
            );
        }
        return out;
    };
    let limits = Limits::of(input);
    for ((id, it), r) in items.iter().zip(reads) {
        match r.refused {
            Some(b) => out.blocked.push(b),
            None => judge(&limits, id, it, &r, drawn, &mut out),
        }
    }
    out
}

pub fn peak_times(lowered: &Value) -> Vec<i64> {
    let items = rule::items(lowered);
    let mut at: Vec<i64> = readings(lowered, &items)
        .into_iter()
        .flatten()
        .filter(|r| r.refused.is_none() && r.peak > 0)
        .map(|r| (r.at * FLICKS).round() as i64)
        .collect();
    at.sort_unstable();
    at.dedup();
    at
}

fn readings(lowered: &Value, items: &[(&String, &Value)]) -> Option<Vec<Read>> {
    let times = times(lowered, items)?;
    let flicks: Vec<i64> = times.iter().map(|t| (t * FLICKS).round() as i64).collect();
    let look =
        deep_canvas_scene3d::look::Look3::read(&crate::particles::neutral_look(lowered)).ok();
    let scene_at = |t: i64| {
        let look = look.as_ref()?;
        let mut labels = deep_canvas_scene3d::scene::Labels::new();
        deep_canvas_scene3d::scene::evaluate(lowered, t, look, &mut labels).ok()
    };
    let moving = moves(lowered, items, &flicks);
    let first = scene_at(0);
    let doc_seed = lowered["seed"].as_u64().unwrap_or(0);
    let mut reads: Vec<Read> = items.iter().map(|_| Read::default()).collect();
    for (k, (&t, &f)) in times.iter().zip(&flicks).enumerate() {
        let later = (moving && k > 0).then(|| scene_at(f)).flatten();
        let scene = if moving && k > 0 {
            later.as_ref()
        } else {
            first.as_ref()
        };
        for ((id, _), r) in items.iter().zip(reads.iter_mut()) {
            if r.refused.is_some() {
                continue;
            }
            let Some(scene) = scene else {
                r.refused = Some(
                    json!({"code": UNREAD, "reason": "not_evaluated", "kind": KIND, "ids": [id], "at": t}),
                );
                continue;
            };
            let key = if moving {
                placed(lowered, scene, id)
            } else {
                String::new()
            };
            if r.bake.is_none() || r.key != key {
                let seed = item::item_seed(doc_seed, id);
                match item::baked(
                    lowered,
                    scene,
                    id,
                    seed,
                    Planted::default(),
                    &mut Vec::new(),
                ) {
                    Ok(b) => (r.bake, r.key) = (Some(b), key),
                    Err(e) => {
                        r.refused = Some(
                            json!({"code": UNREAD, "reason": "not_baked", "kind": KIND, "ids": [id],
                            "refusal": e.code, "path": e.path, "at": t}),
                        );
                        continue;
                    }
                }
            }
            let b = r.bake.as_ref().expect("baked above");
            if b.spec.count as usize * times.len() > MAX_STATES {
                r.refused = Some(
                    json!({"code": UNREAD, "reason": "not_bounded", "kind": KIND, "ids": [id],
                    "why": format!("{} particles over {} frames is past {MAX_STATES} states",
                        b.spec.count, times.len())}),
                );
                continue;
            }
            let live = (0..b.spec.count)
                .filter(|&e| eval::state(b, e, t).is_some())
                .count();
            if live > r.peak {
                (r.peak, r.at) = (live, t);
            }
            if let Some([lo, hi]) = bounds::bounds(b, t) {
                let reach = r.reach.get_or_insert([lo, hi]);
                for k in 0..3 {
                    reach[0][k] = reach[0][k].min(lo[k]);
                    reach[1][k] = reach[1][k].max(hi[k]);
                }
            }
        }
    }
    Some(reads)
}

/// Where only issues are read, what the check couldn't read is an error, never a pass.
pub fn issues(lowered: &Value, input: &Value) -> Vec<(String, Raised)> {
    let r = frames(lowered, input, &[]);
    let unread = r.blocked.into_iter().map(|b| {
        let id = b["ids"][0].as_str().unwrap_or_default().to_string();
        let what = match b["unread"].as_array() {
            Some(u) => u
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(", "),
            None => b["reason"].as_str().unwrap_or("readings").to_string(),
        };
        let raised = Raised {
            code: UNREAD,
            severity: "error",
            path: format!("items/{id}"),
            what: format!("effects.audit couldn't read {id}: {what}"),
            fix_ops: None,
        };
        (id, raised)
    });
    r.raised
        .into_iter()
        .map(|(id, r, _)| (id, r))
        .chain(unread)
        .collect()
}

fn times(doc: &Value, items: &[(&String, &Value)]) -> Option<Vec<f64>> {
    let (p, q) = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .unwrap_or((60, 1));
    let step = f64::from(q) / f64::from(p.max(1));
    let emits = || {
        items
            .iter()
            .filter_map(|(id, it)| crate::particles::spec::read(doc, id, &it["params"]).ok())
            .map(|s| s.span + s.life[1])
            .fold(0.0, f64::max)
    };
    let end = match doc.pointer("/transport/span") {
        None => emits().min(10.0),
        Some(v) => deep_canvas::document::duration(doc, v).ok()? as f64 / FLICKS,
    };
    let n = (end / step).ceil().max(1.0);
    if !n.is_finite() || n > MAX_FRAMES as f64 {
        return None;
    }
    Some((0..n as usize).map(|k| k as f64 * step).collect())
}

fn moves(doc: &Value, items: &[(&String, &Value)], flicks: &[i64]) -> bool {
    let Some(map) = doc.as_object() else {
        return true;
    };
    let moved = |id: &str| {
        let p = &doc["items"][id]["params"];
        let along = &p["motion"]["along"];
        if !along["curve"].is_null()
            || !along["curves"].is_null()
            || !along["collection"].is_null()
            || !p["emit"]["shape"]["along"].is_null()
        {
            return true;
        }
        let anchor = p["emit"]["anchor"].as_str();
        if p["space"] == "world" && anchor.is_some() {
            return false;
        }
        let source = anchor.unwrap_or(id);
        deep_canvas_scene3d::trail::places(map, source, flicks)
            .map_or(true, |at| at.windows(2).any(|w| w[0] != w[1]))
    };
    items.iter().any(|(id, _)| {
        let mut at = Some(id.as_str());
        (0..16).any(|_| {
            let Some(i) = at else { return false };
            at = doc["items"][i]["params"]["emit"]["on"]["particles"].as_str();
            moved(i)
        })
    })
}

fn placed(doc: &Value, scene: &deep_canvas_scene3d::scene::Scene, id: &str) -> String {
    let mut key = String::new();
    let mut at = Some(id);
    for _ in 0..16 {
        let Some(i) = at else { break };
        match item::prepare(doc, scene, i) {
            Ok(p) => {
                let origin = p.world.is_none().then_some(p.origin);
                key.push_str(&format!("{origin:?}{:?};", p.curve.0));
                at = p.parent;
            }
            Err(_) => break,
        }
    }
    key
}

struct Limits {
    count_peak: Option<u64>,
    bounds: Option<[V3; 2]>,
    overdraw: Option<f64>,
    gpu_ms: Option<f64>,
}

impl Limits {
    fn of(input: &Value) -> Self {
        let number = |v: &Value| v.as_f64().filter(|x| x.is_finite() && *x >= 0.0);
        let overdraw = match input.get("overdraw") {
            None => Some(OVERDRAW_MAX),
            Some(o) if o.is_object() => o.get("max").map_or(Some(OVERDRAW_MAX), number),
            Some(_) => None,
        };
        Limits {
            count_peak: input["count_peak"].as_u64(),
            bounds: corners(&input["bounds"]),
            overdraw,
            gpu_ms: number(&input["gpu_ms"]),
        }
    }

    fn unread(&self) -> Vec<&'static str> {
        [
            ("count_peak", self.count_peak.is_none()),
            ("bounds", self.bounds.is_none()),
            ("overdraw", self.overdraw.is_none()),
            ("gpu_ms", self.gpu_ms.is_none()),
        ]
        .into_iter()
        .filter_map(|(n, missing)| missing.then_some(n))
        .collect()
    }
}

fn corners(v: &Value) -> Option<[V3; 2]> {
    let c = |k: usize| -> Option<V3> {
        let a = v.get(k)?.as_array()?;
        let x = |i: usize| a.get(i)?.as_f64().filter(|x| x.is_finite());
        Some([x(0)?, x(1)?, x(2)?])
    };
    let (a, b) = (c(0)?, c(1)?);
    Some([
        [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])],
        [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])],
    ])
}

fn scaled(id: &str, it: &Value, k: f64) -> Vec<Value> {
    let p = &it["params"];
    let down = |n: f64| (n * k).floor().max(1.0);
    let set =
        |path: String, value: Value| json!({"op": "set", "id": id, "path": path, "value": value});
    let count = p["count"].as_f64().unwrap_or(256.0);
    let mut ops = vec![set(
        format!("items/{id}/params/count"),
        json!(down(count) as u64),
    )];
    for (i, b) in p["emit"]["bursts"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(c) = b["count"].as_f64() {
            ops.push(set(
                format!("items/{id}/params/emit/bursts/{i}/count"),
                json!(down(c) as u64),
            ));
        }
    }
    if let Some(r) = p["emit"]["rate"].as_f64() {
        ops.push(set(format!("items/{id}/params/emit/rate"), json!(r * k)));
    }
    ops
}

fn raise(
    out: &mut Report,
    id: &str,
    code: &'static str,
    what: String,
    fix: Vec<Value>,
    actual: Value,
) {
    let path = fix
        .first()
        .and_then(|o| o["path"].as_str())
        .unwrap_or_default()
        .to_string();
    let r = Raised {
        code,
        severity: "error",
        path,
        what,
        fix_ops: Some(fix),
    };
    out.raised.push((id.to_string(), r, actual));
}

fn judge(limits: &Limits, id: &str, it: &Value, r: &Read, drawn: &[Frame], out: &mut Report) {
    let undeclared = limits.unread();
    if !undeclared.is_empty() {
        out.blocked.push(
            json!({"code": UNREAD, "reason": "not_declared", "kind": KIND, "ids": [id], "unread": undeclared,
            "why": "the check input states no limit these readings can be judged against"}),
        );
    }
    let peak = r.peak;
    if let Some(limit) = limits.count_peak.filter(|l| peak as u64 > *l) {
        raise(
            out,
            id,
            COUNT,
            format!(
                "{id} has {peak} particles live at once at {} s, past count_peak {limit}",
                r.at
            ),
            scaled(id, it, limit as f64 / peak as f64),
            json!({"machines": "any", "count_peak": peak, "at": r.at, "limit": limit}),
        );
    }
    if let (Some(box_), Some(reach)) = (limits.bounds, r.reach) {
        if (0..3).any(|k| reach[0][k] < box_[0][k] || reach[1][k] > box_[1][k]) {
            let kill = json!({"box": box_, "keep": "inside"});
            raise(
                out,
                id,
                BOUNDS,
                format!("{id}'s particles reach {reach:?}, outside its declared box {box_:?}"),
                vec![
                    json!({"op": "set", "id": id, "path": format!("items/{id}/params/kill"), "value": kill}),
                ],
                json!({"machines": "any", "bounds": reach, "declared": box_}),
            );
        }
    }
    let live = |t: i64| {
        r.bake.as_ref().is_some_and(|b| {
            (0..b.spec.count).any(|e| eval::state(b, e, t as f64 / FLICKS).is_some())
        })
    };
    let shown: Vec<&Frame> = drawn.iter().filter(|fr| live(fr.t)).collect();
    let most = |f: fn(&deep_canvas::registry::ItemPass) -> Option<f64>| {
        shown
            .iter()
            .filter_map(|fr| fr.passes.get(id).and_then(f))
            .reduce(f64::max)
    };
    let (overdraw, gpu_ms) = (
        most(|p| p.overdraw),
        most(|p| p.gpu_ms.filter(|ms| *ms > 0.0)),
    );
    let unread: Vec<&str> = [("overdraw", overdraw), ("gpu_ms", gpu_ms)]
        .iter()
        .filter(|(_, v)| v.is_none())
        .map(|(n, _)| *n)
        .collect();
    if !unread.is_empty() {
        let (code, why) = match (drawn.is_empty(), shown.is_empty()) {
            (true, _) => ("not_run", "no host drew and timed the effect's own pass"),
            (false, true) => (
                "not_measured",
                "no frame drawn had any of its particles live",
            ),
            (false, false) => (
                "not_measured",
                "the host drew it but couldn't measure its pass",
            ),
        };
        out.blocked
            .push(json!({"code": UNREAD, "reason": code, "kind": KIND, "ids": [id], "unread": unread, "why": why}));
    }
    if let (Some(o), Some(max)) = (overdraw, limits.overdraw) {
        if o > max {
            raise(
                out,
                id,
                OVERDRAW,
                format!("{id} stacks {o} fragments on a px, past overdraw {max}"),
                scaled(id, it, max / o),
                json!({"machines": "same", "overdraw": o, "max": max}),
            );
        }
    }
    if let (Some(m), Some(d)) = (gpu_ms, limits.gpu_ms) {
        if m > d {
            raise(
                out,
                id,
                GPU_MS,
                format!("{id}'s pass takes {m:.4} ms on the GPU, past its declared {d} ms"),
                scaled(id, it, d / m),
                json!({"machines": "same", "gpu_ms": m, "declared": d}),
            );
        }
    }
    out.results
        .push(json!({"id": id, "count_peak": peak, "bounds": r.reach,
        "overdraw": overdraw, "gpu_ms": gpu_ms, "declared_ms": limits.gpu_ms}));
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::registry::ItemPass;

    fn doc(id: &str, count: u32, radius: f64, v0: Option<[f64; 2]>) -> Value {
        let motion = match v0 {
            Some(v) => json!({"v0": v, "gravity": [0, 0, 0], "drag": 0}),
            None => json!({"velocity": [0, 0, 0], "gravity": [0, 0, 0], "drag": 0}),
        };
        json!({"format": 1, "profile": "scene", "size": [320, 240], "camera": "cam", "seed": 7,
            "transport": {"span": "2s"},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "params": {"projection": "perspective",
                    "position": [0, 0, 6], "target": [0, 0, 0], "fov": 40}},
                id: {"id": id, "kind": "particles@1", "at": {"pos": [0, 0, 0]}, "params": {
                    "count": count, "emit": {"shape": "sphere", "radius": radius,
                        "bursts": [{"t": 0, "count": count}]},
                    "life": [1, 1], "motion": {"ballistic": motion}, "draw": "dot", "size": 2,
                    "opacity": 1, "color": [{"at": 0, "role": "accent"}], "seed": 7}}}})
    }

    fn input(over: Value) -> Value {
        let mut i = json!({"kind": KIND, "count_peak": 4096, "bounds": [[-3, -3, -3], [3, 3, 3]],
            "overdraw": {"max": 8}, "gpu_ms": 100});
        for (k, v) in over.as_object().expect("an object") {
            i[k] = v.clone();
        }
        i
    }

    fn codes(r: &Report) -> Vec<&str> {
        r.raised.iter().map(|(_, r, _)| r.code).collect()
    }

    fn drawn(id: &str, overdraw: f64, gpu_ms: f64) -> Vec<Frame> {
        let pass = ItemPass {
            overdraw: Some(overdraw),
            gpu_ms: Some(gpu_ms),
        };
        vec![Frame {
            passes: [(id.to_string(), pass)].into(),
            ..Frame::default()
        }]
    }

    #[test]
    fn a_peak_past_count_peak_fails_naming_the_item_with_its_counts_scaled_and_holds_anywhere() {
        let input = input(json!({"count_peak": 1000}));
        let r = frames(
            &doc("sparks", 2000, 1.5, None),
            &input,
            &drawn("sparks", 1.0, 0.1),
        );
        assert_eq!(codes(&r), [COUNT]);
        let (id, raised, actual) = &r.raised[0];
        assert_eq!(
            (id.as_str(), actual["machines"].as_str()),
            ("sparks", Some("any"))
        );
        assert_eq!(actual["count_peak"], 2000);
        let ops = raised.fix_ops.as_ref().expect("patch ops");
        assert_eq!(
            ops[0],
            json!({"op": "set", "id": "sparks", "path": "items/sparks/params/count", "value": 1000})
        );
        assert_eq!(ops[1]["path"], "items/sparks/params/emit/bursts/0/count");
        assert!(r.blocked.is_empty());
        let twin = frames(
            &doc("sparks", 500, 1.5, None),
            &input,
            &drawn("sparks", 1.0, 0.1),
        );
        assert!(twin.raised.is_empty() && twin.blocked.is_empty());
    }

    #[test]
    fn particles_thrown_out_of_the_declared_box_fail_with_a_kill_box_and_slow_ones_pass() {
        let input = input(json!({"bounds": [[1, 1, 1], [-1, -1, -1]]}));
        let r = frames(
            &doc("embers", 64, 0.3, Some([2.0, 3.0])),
            &input,
            &drawn("embers", 1.0, 0.1),
        );
        assert_eq!(codes(&r), [BOUNDS]);
        let ops = r.raised[0].1.fix_ops.as_ref().expect("patch ops");
        assert_eq!(ops[0]["path"], "items/embers/params/kill");
        assert_eq!(
            ops[0]["value"],
            json!({"box": [[-1.0, -1.0, -1.0], [1.0, 1.0, 1.0]], "keep": "inside"})
        );
        let twin = frames(
            &doc("embers", 64, 0.3, Some([0.1, 0.2])),
            &input,
            &drawn("embers", 1.0, 0.1),
        );
        assert!(twin.raised.is_empty(), "{:?}", codes(&twin));
    }

    #[test]
    fn overdraw_past_its_max_and_time_past_its_declaration_fail_on_the_passes_drawn() {
        let input = input(json!({"gpu_ms": 0.5}));
        let d = doc("smoke", 64, 0.0, None);
        assert_eq!(
            codes(&frames(&d, &input, &drawn("smoke", 64.0, 0.6))),
            [OVERDRAW, GPU_MS]
        );
        let r = frames(&d, &input, &drawn("smoke", 64.0, 0.6));
        assert!(r.raised.iter().all(|(_, _, a)| a["machines"] == "same"));
        assert!(frames(&d, &input, &drawn("smoke", 4.0, 0.4))
            .raised
            .is_empty());
        let mut at_eight = input.clone();
        at_eight
            .as_object_mut()
            .expect("an object")
            .remove("overdraw");
        assert!(frames(&d, &at_eight, &drawn("smoke", 8.0, 0.1))
            .raised
            .is_empty());
        assert_eq!(
            codes(&frames(&d, &at_eight, &drawn("smoke", 9.0, 0.1))),
            [OVERDRAW]
        );
    }

    #[test]
    fn passes_no_host_drew_are_blocked_and_an_error_never_a_pass() {
        let d = doc("smoke", 4, 0.0, None);
        let r = frames(&d, &input(json!({})), &[]);
        assert!(r.raised.is_empty());
        assert_eq!(r.blocked.len(), 1);
        assert_eq!(r.blocked[0]["reason"], "not_run");
        assert_eq!(r.blocked[0]["unread"], json!(["overdraw", "gpu_ms"]));
        assert!(report(&d, &input(json!({}))).blocked.is_empty());
        let raised = issues(&d, &input(json!({})));
        assert_eq!(raised.len(), 1);
        assert_eq!((raised[0].1.code, raised[0].1.severity), (UNREAD, "error"));
    }

    #[test]
    fn a_limit_left_out_or_given_as_no_limit_is_blocked_never_passed() {
        let d = doc("sparks", 2000, 1.5, None);
        let mut i = input(json!({"count_peak": "1000", "gpu_ms": -1}));
        i.as_object_mut().expect("an object").remove("bounds");
        let r = frames(&d, &i, &drawn("sparks", 1.0, 0.1));
        assert!(r.raised.is_empty());
        let b = r
            .blocked
            .iter()
            .find(|b| b["reason"] == "not_declared")
            .expect("not_declared");
        assert_eq!(b["unread"], json!(["count_peak", "bounds", "gpu_ms"]));
    }

    #[test]
    fn passes_drawn_with_no_particle_live_read_nothing_and_peaks_are_where_they_are_fullest() {
        let d = doc("smoke", 64, 0.0, None);
        let mut late = drawn("smoke", 1.0, 0.1);
        late[0].t = (1.5 * FLICKS) as i64;
        let r = frames(&d, &input(json!({})), &late);
        assert!(r.raised.is_empty());
        assert_eq!(r.blocked[0]["reason"], "not_measured");
        assert_eq!(peak_times(&d), [0]);
    }

    #[test]
    fn a_span_past_the_frames_read_is_blocked_never_cut_short() {
        let mut d = doc("sparks", 16, 0.2, None);
        d["transport"]["span"] = json!("600s");
        let r = frames(&d, &input(json!({})), &drawn("sparks", 1.0, 0.1));
        assert!(r.raised.is_empty());
        assert_eq!(r.blocked[0]["reason"], "not_bounded");
    }

    #[test]
    fn an_emitter_that_moves_is_read_where_it_stands_at_each_frame() {
        let mut d = doc("drift", 16, 0.2, None);
        d["items"]["drift"]["params"]["life"] = json!([2, 2]);
        d["channels"] = json!({"carry": {"target": "items/drift/at/pos/0", "type": "f32", "keys": {
            "k0": {"t": "0s", "value": 0, "interp": "linear"},
            "k1": {"t": "2s", "value": 3, "interp": "linear"}}}});
        let r = frames(
            &d,
            &input(json!({"bounds": [[-1, -1, -1], [1, 1, 1]]})),
            &drawn("drift", 1.0, 0.1),
        );
        assert_eq!(codes(&r), [BOUNDS], "{:?}", r.blocked);
    }

    #[test]
    fn a_deliverable_with_no_particles_item_is_blocked_not_passed() {
        let mut d = doc("sparks", 64, 1.0, None);
        d["items"].as_object_mut().expect("items").remove("sparks");
        let r = frames(&d, &input(json!({})), &drawn("sparks", 1.0, 0.1));
        assert!(r.raised.is_empty());
        assert_eq!(r.blocked.len(), 1, "{:?}", r.blocked);
        assert_eq!(
            (
                r.blocked[0]["code"].as_str(),
                r.blocked[0]["reason"].as_str()
            ),
            (Some(UNREAD), Some("no_effect"))
        );
        assert_eq!(issues(&d, &input(json!({})))[0].1.code, UNREAD);
    }

    #[test]
    fn a_gpu_time_read_as_zero_is_unread_not_a_pass() {
        let input = input(json!({"gpu_ms": 0.0001}));
        let r = frames(
            &doc("flare", 256, 1.0, None),
            &input,
            &drawn("flare", 1.0, 0.0),
        );
        assert!(r.raised.is_empty());
        assert_eq!(r.blocked.len(), 1, "{:?}", r.blocked);
        assert_eq!(r.blocked[0]["unread"], json!(["gpu_ms"]));
    }

    #[test]
    fn a_span_that_cant_be_read_is_not_bounded_not_cut_short() {
        let mut d = doc("sparks", 64, 1.0, None);
        d["transport"]["span"] = json!("forever");
        let r = frames(&d, &input(json!({})), &drawn("sparks", 1.0, 0.1));
        assert!(r.raised.is_empty());
        assert_eq!(r.blocked[0]["reason"], "not_bounded", "{:?}", r.blocked);
    }
}
