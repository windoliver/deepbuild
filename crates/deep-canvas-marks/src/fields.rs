//! Issue #467: the 2D fields films need (canvas primitives: Frame and group: y sort; Frame and
//! group: parallax). Each is closed form in t and the camera pose, so seeking equals playing.

use serde_json::{Map, Value};

use crate::scene::{num, Refused};

/// How far a looping parallax band may be from a whole number of repeats over the span, in u.
pub const LOOP_TOLERANCE: f64 = 1e-3;

/// The most copies a repeat draws per axis.
pub const MAX_REPEAT_COUNT: u64 = 8;

/// `parallax {rate, repeat, repeat_count, drift, origin}` on a group.
#[derive(Clone, Debug, PartialEq)]
pub struct Parallax {
    pub rate: [f64; 2],
    /// Per axis, the repeat in u; `None` on an axis that doesn't repeat.
    pub repeat: [Option<f64>; 2],
    pub repeat_count: u64,
    pub drift: [f64; 2],
    pub origin: [f64; 2],
}

fn pair(v: Option<&Value>, default: [f64; 2], path: &str) -> Result<[f64; 2], Refused> {
    match v {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Array(l)) if l.len() == 2 => match (num(l.first()), num(l.get(1))) {
            (Some(a), Some(b)) => Ok([a, b]),
            _ => Err(bad(path)),
        },
        Some(_) => Err(bad(path)),
    }
}

fn bad(path: &str) -> Refused {
    Refused {
        code: "bad_doc",
        path: path.to_string(),
    }
}

impl Parallax {
    /// A group's `params.parallax`, or `None`.
    pub fn read(id: &str, params: &Map<String, Value>) -> Result<Option<Parallax>, Refused> {
        let path = format!("items/{id}/params/parallax");
        let p = match params.get("parallax") {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(p)) => p,
            Some(_) => return Err(bad(&path)),
        };
        let at = |f: &str| format!("{path}/{f}");
        let repeat = match p.get("repeat") {
            None | Some(Value::Null) => [None, None],
            Some(Value::String(s)) if s == "none" => [None, None],
            v => {
                let r = pair(v, [0.0, 0.0], &at("repeat"))?;
                if r.iter().any(|v| *v < 0.0) {
                    return Err(Refused {
                        code: "out_of_range",
                        path: at("repeat"),
                    });
                }
                r.map(|v| (v > 0.0).then_some(v))
            }
        };
        let repeat_count = match p.get("repeat_count") {
            None | Some(Value::Null) => 1,
            Some(v) => v.as_u64().ok_or_else(|| bad(&at("repeat_count")))?,
        };
        if repeat_count == 0 || repeat_count > MAX_REPEAT_COUNT {
            return Err(Refused {
                code: "out_of_range",
                path: at("repeat_count"),
            });
        }
        Ok(Some(Parallax {
            rate: pair(p.get("rate"), [1.0, 1.0], &at("rate"))?,
            repeat,
            repeat_count,
            drift: pair(p.get("drift"), [0.0, 0.0], &at("drift"))?,
            origin: pair(p.get("origin"), [0.0, 0.0], &at("origin"))?,
        }))
    }

    /// The offset before any wrap: origin + camera × (1 − rate) + drift × t, in u.
    pub fn unwrapped(&self, camera: [f64; 2], t_seconds: f64) -> [f64; 2] {
        [0, 1].map(|i| {
            self.origin[i] + camera[i] * (1.0 - self.rate[i]) + self.drift[i] * t_seconds
        })
    }

    /// The group's offset at t: [`Parallax::unwrapped`] wrapped by repeat with a floored modulo.
    pub fn offset(&self, camera: [f64; 2], t_seconds: f64) -> [f64; 2] {
        let o = self.unwrapped(camera, t_seconds);
        [0, 1].map(|i| match self.repeat[i] {
            Some(r) => o[i] - r * (o[i] / r).floor(),
            None => o[i],
        })
    }

    /// Over a looping span of `span` seconds, each repeating axis's jump at the wrap: how far the
    /// band's travel is from a whole number of repeats, in u. Empty when it drifts on no axis
    /// that repeats.
    pub fn loop_jumps(&self, span: f64) -> Vec<(usize, f64)> {
        let mut out = Vec::new();
        for i in 0..2 {
            let Some(r) = self.repeat[i] else { continue };
            let travel = self.drift[i] * span;
            let jump = (travel - r * (travel / r).round()).abs();
            out.push((i, jump));
        }
        out
    }
}

/// Flicks a second.
const FLICKS: f64 = 705_600_000.0;

/// The 2D camera's position: the `target` of the `camera@1` the document names, at t; the origin
/// without one.
pub fn camera_of(doc: &Map<String, Value>, items: &Map<String, Value>) -> [f64; 2] {
    let cam = doc
        .get("camera")
        .and_then(Value::as_str)
        .and_then(|id| items.get(id))
        .filter(|c| c.get("kind").and_then(Value::as_str) == Some("camera@1"));
    let target = cam.and_then(|c| c.pointer("/params/target"));
    match target.and_then(Value::as_array) {
        Some(l) => [num(l.first()).unwrap_or(0.0), num(l.get(1)).unwrap_or(0.0)],
        None => [0.0, 0.0],
    }
}

/// A parallax group's offset in evaluated `items` at `t` flicks, or `None` for an item that
/// isn't one.
pub fn group_offset(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    id: &str,
    t: i64,
) -> Result<Option<[f64; 2]>, Refused> {
    let Some(item) = items.get(id) else {
        return Ok(None);
    };
    if item.get("kind").and_then(Value::as_str) != Some("group@1") {
        return Ok(None);
    }
    let params = item.get("params").and_then(Value::as_object);
    let Some(p) = params.map(|p| Parallax::read(id, p)).transpose()?.flatten() else {
        return Ok(None);
    };
    Ok(Some(p.offset(camera_of(doc, items), t as f64 / FLICKS)))
}

/// `items` at `t` flicks with every parallax group's descendants moved by its offset, and with
/// repeat, laid again one repeat apart per axis from one repeat before it, `repeat_count` copies
/// in all, as `<id>~<i>.<j>`; `None` when no group has parallax.
pub fn apply(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    t: i64,
) -> Result<Option<Map<String, Value>>, Refused> {
    let mut groups = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("group@1") {
            continue;
        }
        if let Some(p) = item
            .get("params")
            .and_then(Value::as_object)
            .map(|params| Parallax::read(id, params))
            .transpose()?
            .flatten()
        {
            groups.push((id.clone(), p));
        }
    }
    if groups.is_empty() {
        return Ok(None);
    }
    let camera = camera_of(doc, items);
    let mut out = items.clone();
    for (gid, p) in &groups {
        let o = p.offset(camera, t as f64 / FLICKS);
        let under: Vec<String> = items
            .iter()
            .filter(|(_, it)| descends(items, it, gid))
            .map(|(id, _)| id.clone())
            .collect();
        let steps = |axis: usize| -> Vec<f64> {
            match p.repeat[axis] {
                Some(r) => (0..p.repeat_count).map(|k| (k as f64 - 1.0) * r).collect(),
                None => vec![0.0],
            }
        };
        let (xs, ys) = (steps(0), steps(1));
        for id in &under {
            let item = out.remove(id).unwrap_or(Value::Null);
            for (i, dx) in xs.iter().enumerate() {
                for (j, dy) in ys.iter().enumerate() {
                    let mut copy = item.clone();
                    let pos = copy.pointer("/at/pos").and_then(Value::as_array).cloned();
                    let mut at: Vec<Value> = pos.unwrap_or_else(|| vec![0.0.into(), 0.0.into()]);
                    while at.len() < 2 {
                        at.push(0.0.into());
                    }
                    let shift = [o[0] + dx, o[1] + dy];
                    for (k, s) in shift.iter().enumerate() {
                        at[k] = (num(at.get(k)).unwrap_or(0.0) + s).into();
                    }
                    if !copy.get("at").is_some_and(Value::is_object) {
                        copy["at"] = Value::Object(Map::new());
                    }
                    copy["at"]["pos"] = Value::Array(at);
                    let name = if xs.len() * ys.len() == 1 {
                        id.clone()
                    } else {
                        format!("{id}~{i}.{j}")
                    };
                    out.insert(name, copy);
                }
            }
        }
    }
    Ok(Some(out))
}

/// The transport's span in seconds when it loops with wrap.
fn wrapping_span(doc: &Map<String, Value>) -> Option<f64> {
    let transport = doc.get("transport")?;
    if transport.get("loop").and_then(Value::as_str) != Some("wrap") {
        return None;
    }
    let ctx = deep_canvas::grammar::TimeContext {
        frame_rate: deep_canvas::document::frame_rate_of(transport).unwrap_or((60, 1)),
        markers: Default::default(),
    };
    let flicks = match transport.get("span")? {
        Value::String(t) => deep_canvas::grammar::Time::parse(t).ok()?.resolve(&ctx).ok()?,
        v => v.as_i64()?,
    };
    (flicks > 0).then_some(flicks as f64 / FLICKS)
}

/// The loop rule (Frame and group: parallax): in a document whose transport loops with wrap, a
/// parallax group that drifts on an axis it repeats must travel a whole number of repeats over
/// the span, within [`LOOP_TOLERANCE`], or its band jumps at the wrap; each one that doesn't,
/// naming the group, the axis and the jump in u. `modulo: false` is the planted check that
/// compares the offsets at the ends without the repeat's modulo.
pub fn loop_issues(doc: &Map<String, Value>, modulo: bool) -> Vec<deep_canvas::document::Issue> {
    let Some(span) = wrapping_span(doc) else {
        return Vec::new();
    };
    let items = doc.get("items").and_then(Value::as_object);
    let mut out = Vec::new();
    for (id, item) in items.into_iter().flatten() {
        if item.get("kind").and_then(Value::as_str) != Some("group@1") {
            continue;
        }
        let params = item.get("params").and_then(Value::as_object);
        let Some(Ok(Some(p))) = params.map(|params| Parallax::read(id, params)) else {
            continue;
        };
        let jumps: Vec<(usize, f64)> = if modulo {
            p.loop_jumps(span)
        } else {
            (0..2)
                .filter(|i| p.repeat[*i].is_some())
                .map(|i| (i, (p.drift[i] * span).abs()))
                .collect()
        };
        for (axis, jump) in jumps.into_iter().filter(|(_, j)| *j > LOOP_TOLERANCE) {
            let travel = p.drift[axis] * span;
            let mut issue = deep_canvas::document::Issue::error(
                "parallax_loop_jump",
                id,
                format!("items/{id}/params/parallax/drift/{axis}"),
                serde_json::json!({"axis": axis, "travel": travel, "repeat": p.repeat[axis], "jump": jump}),
                "its band travels no whole number of repeats over the loop, so it jumps at the wrap",
            );
            issue.fix = "Set drift to a whole number of repeats over the span, or the span to fit the drift.".into();
            out.push(issue);
        }
    }
    out
}

/// Whether `item` sits under the group `gid`.
fn descends(items: &Map<String, Value>, item: &Value, gid: &str) -> bool {
    let mut at = item.get("parent").and_then(Value::as_str);
    for _ in 0..=items.len() {
        match at {
            Some(p) if p == gid => return true,
            Some(p) => at = items.get(p).and_then(|i| i.get("parent")).and_then(Value::as_str),
            None => return false,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn band(repeat: f64, drift: f64) -> Parallax {
        let params = json!({"parallax": {"repeat": [repeat, 0], "drift": [drift, 0]}});
        Parallax::read("g", params.as_object().unwrap())
            .unwrap()
            .unwrap()
    }

    #[test]
    fn a_band_that_travels_whole_repeats_has_no_jump_and_one_that_doesnt_does() {
        let cloud = band(170.0, 170.0 / 4.7);
        assert!(cloud.loop_jumps(4.7)[0].1 < LOOP_TOLERANCE);
        let marquee = band(881.0, -183.5);
        let jump = marquee.loop_jumps(4.8)[0].1;
        assert!((jump - 0.2).abs() < 1e-6, "{jump}");
    }
}
