//! The media canvas module's emitters (issue #427; canvas primitives: Emitter, Strip and track):
//! a document's `strips` and the positional voices its `emitters` place on its items. This
//! subset reads them as data: where each voice is at t, its cone and its distance model, which
//! the sound sources diagnostic mode draws. Mixing and playback are the media module's later
//! work; nothing here makes a sound.

use deep_canvas::camera::Vec3;
use serde_json::{json, Map, Value};

use crate::scene::{placed_at, Refused};

/// One positional voice at t, its fields as authored (defaults where omitted).
#[derive(Clone, Debug, PartialEq)]
pub struct Emitter {
    pub id: String,
    /// The item it follows, and that item's world position at t, m.
    pub item: String,
    pub pos: Vec3,
    /// Unit: the item's own −Z in the world at t, the cone's axis.
    pub forward: Vec3,
    /// The strip it plays.
    pub src: String,
    /// The cone: inner and outer angles in degrees, and the gain outside the outer.
    pub inner: f64,
    pub outer: f64,
    pub outer_gain: f64,
    /// `distance.max`, m: past it the distance gain holds.
    pub range: f64,
    /// `distance.model`: inverse, linear or exponential.
    pub model: String,
    pub ref_m: f64,
    pub rolloff: f64,
}

fn bad<T>(code: &'static str, path: String) -> Result<T, Refused> {
    Err(Refused { code, path })
}

/// A number field of `obj`, its default when absent, refused outside `ok`.
fn number(
    obj: Option<&Value>,
    key: &str,
    default: f64,
    ok: impl Fn(f64) -> bool,
    path: &str,
) -> Result<f64, Refused> {
    match obj.and_then(|o| o.get(key)) {
        None => Ok(default),
        Some(v) => match v.as_f64() {
            Some(n) if ok(n) => Ok(n),
            _ => bad("out_of_range", format!("{path}/{key}")),
        },
    }
}

/// The document's emitters at `t`, in ID order: each on its item's world position at t, its
/// strip named in `strips`.
pub fn emitters(doc: &Value, t: i64) -> Result<Vec<Emitter>, Refused> {
    let empty = Map::new();
    let list = match doc.get("emitters") {
        None => return Ok(Vec::new()),
        Some(Value::Object(m)) => m,
        Some(_) => return bad("out_of_range", "emitters".into()),
    };
    let strips = doc
        .get("strips")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let placed = placed_at(doc, t)?;
    let mut out = Vec::new();
    for (id, e) in list {
        let path = format!("emitters/{id}");
        let item = e.get("item").and_then(Value::as_str).unwrap_or("");
        let Some((_, _, m)) = placed.iter().find(|(i, _, _)| i == item) else {
            return bad("ref_unresolved", format!("{path}/item"));
        };
        let src = e.get("src").and_then(Value::as_str).unwrap_or("");
        if !strips.contains_key(src) {
            return bad("ref_unresolved", format!("{path}/src"));
        }
        let distance = e.get("distance");
        let dpath = format!("{path}/distance");
        let model = match distance.and_then(|d| d.get("model")) {
            None => "inverse".to_string(),
            Some(Value::String(s))
                if ["inverse", "linear", "exponential"].contains(&s.as_str()) =>
            {
                s.clone()
            }
            Some(_) => return bad("out_of_range", format!("{dpath}/model")),
        };
        let cone = e.get("cone");
        let cpath = format!("{path}/cone");
        let angle = |n: f64| (0.0..=360.0).contains(&n);
        let inner = number(cone, "inner", 360.0, angle, &cpath)?;
        let outer = number(cone, "outer", 360.0, angle, &cpath)?;
        if outer < inner {
            return bad("out_of_range", format!("{cpath}/outer"));
        }
        out.push(Emitter {
            id: id.clone(),
            item: item.to_string(),
            pos: [m[0][3], m[1][3], m[2][3]],
            forward: forward(m),
            src: src.to_string(),
            inner,
            outer,
            outer_gain: number(
                cone,
                "outer_gain",
                0.0,
                |n| (0.0..=1.0).contains(&n),
                &cpath,
            )?,
            range: number(distance, "max", 10_000.0, |n| n > 0.0, &dpath)?,
            ref_m: number(distance, "ref", 1.0, |n| n > 0.0, &dpath)?,
            rolloff: number(distance, "rolloff", 1.0, |n| n >= 0.0, &dpath)?,
            model,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// The world direction of a transform's own −Z, unit.
fn forward(m: &crate::scene::Affine3) -> Vec3 {
    let v = [-m[0][2], -m[1][2], -m[2][2]];
    let l = deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if l > 0.0 {
        v.map(|c| c / l)
    } else {
        [0.0, 0.0, -1.0]
    }
}

/// A bell on a box: a document with strips and an emitter (#427), a media module fixture.
pub fn bell() -> Value {
    json!({
        "format": 1, "profile": "scene", "title": "A bell",
        "description": "A small box with a positional voice playing a sine chime.",
        "size": [320, 240], "camera": "cam",
        "requires": {"modules": {"scene3d": "^1", "media": "^1"}},
        "transport": {"span": "2s"},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0],
                               "orbit": {"azimuth": 30, "elevation": 25, "distance": 6}, "fov": 40}},
            "bell": {"id": "bell", "kind": "mark.box@1", "name": "Bell", "order": "a1",
                     "params": {"size": [0.3, 0.3, 0.3], "paint": {"fill": {"role": "muted"}}},
                     "at": {"pos": [0, 0.5, 0]}}
        },
        "strips": {"chime": {"synth": "sine", "freq": 440, "span": "2s"}},
        "emitters": {"voice": {"item": "bell", "src": "chime",
                               "distance": {"model": "inverse", "ref": 1, "max": 12, "rolloff": 1},
                               "cone": {"inner": 40, "outer": 100, "outer_gain": 0.25}}}
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_emitter_reads_its_fields_and_its_parented_items_world_position() {
        let mut doc = bell();
        doc["items"]["stand"] = json!({"id": "stand", "kind": "mark.box@1", "name": "Stand",
            "order": "a2", "params": {"size": [1, 1, 1]}, "at": {"pos": [2, 0, 0]}});
        doc["items"]["bell"]["parent"] = json!("stand");
        doc["emitters"]["far"] = json!({"item": "bell", "src": "chime"});
        let e = emitters(&doc, 0).expect("emitters");
        assert_eq!(e.len(), 2);
        let far = &e[0];
        assert_eq!(far.id, "far");
        assert_eq!(
            (far.inner, far.outer, far.outer_gain, far.range),
            (360.0, 360.0, 0.0, 10_000.0)
        );
        let v = &e[1];
        assert_eq!(v.pos, [2.0, 0.5, 0.0]);
        assert_eq!(v.forward, [0.0, 0.0, -1.0]);
        assert_eq!(
            (v.inner, v.outer, v.outer_gain, v.range, v.model.as_str()),
            (40.0, 100.0, 0.25, 12.0, "inverse")
        );
        doc["emitters"]["far"]["src"] = json!("gong");
        assert_eq!(
            emitters(&doc, 0).map(|_| ()),
            Err(Refused {
                code: "ref_unresolved",
                path: "emitters/far/src".into()
            })
        );
    }
}
