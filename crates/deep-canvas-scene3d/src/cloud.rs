//! A 3D `mark.point` (canvas primitives: Marks in 3D): its schema, one point at its item's
//! place, or a set whose positions come from a depth video's frame at t (#503). A set's points
//! are display only: the shipped compute operator `points.video@1` writes them on the GPU from
//! the decoded frame, so nothing here holds one. What the scene and evaluated data keep is the
//! set's frustum from near, far and fov, the box every point stays in.

use std::sync::Arc;

use deep_canvas::camera::Vec3;
use deep_canvas::ops::{rad, tan};
use serde_json::{json, Value};

use crate::look::Look3;
use crate::scene::{apply, num, origin, paint, Affine3, Point, PointShape, Refused};
use crate::spec::{common, item, p, Spec, G, S};

/// A step leaves one point per `step`-th pixel of each row and column, at most this far apart.
pub const MAX_STEP: u64 = 8;

/// A `mark.point {from: video}` set: which video and frame, and how its pixels unproject.
#[derive(Clone, Debug, PartialEq)]
pub struct Cloud {
    /// The depth video's SHA-256.
    pub asset: String,
    /// Which source frame shows at t, as Image `image@1`: video frames takes them.
    pub frames: Value,
    /// The depth value is the red code ÷ 255; otherwise the luma's.
    pub red: bool,
    /// Where a white pixel and a black one sit, in m from the item's origin along its −Z.
    pub near: f64,
    pub far: f64,
    /// tan of half the field of view across, then up.
    pub tan: [f64; 2],
    pub step: u32,
    /// The paint's color, when it names one; otherwise each point takes its pixel's.
    pub painted: Option<[u8; 3]>,
    /// The item's world transform, which places the set's own space.
    pub model: Affine3,
}

impl Cloud {
    /// The set's frustum: (±z × tan_x, ±z × tan_y, −z) at z = near and far, in the world.
    /// Every point lies inside the box of these, and no point is one of them.
    pub fn corners(&self) -> [Vec3; 8] {
        std::array::from_fn(|k| {
            let z = if k & 4 == 0 { self.near } else { self.far };
            let x = if k & 1 == 0 { -z } else { z } * self.tan[0];
            let y = if k & 2 == 0 { -z } else { z } * self.tan[1];
            apply(&self.model, [x, y, -z])
        })
    }
}

/// The points a `w × h` frame gives at `step`: (w ÷ step) × (h ÷ step).
pub fn count(size: [u32; 2], step: u32) -> u64 {
    let step = step.max(1);
    u64::from(size[0] / step) * u64::from(size[1] / step)
}

fn out_of_range<T>(path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code: "out_of_range",
        path: path.into(),
    })
}

/// A point's `from: video` under the item's world `model`, or `None` for a point at its own
/// place. Positions come from one source: a second (`chunks`, `vertices`, or another `from`) is
/// refused naming the item, and a field outside its range naming the field.
pub fn parse(params: &Value, path: &str, model: Affine3) -> Result<Option<Cloud>, Refused> {
    let given = |k: &str| params.get(k).filter(|v| !v.is_null());
    let from = given("from");
    let sources = from.map_or(0, |f| f.as_object().map_or(1, |o| o.len().max(1)))
        + ["chunks", "vertices"]
            .into_iter()
            .filter(|k| given(k).is_some())
            .count();
    if sources > 1 {
        return out_of_range(path.strip_suffix("/params").unwrap_or(path));
    }
    let Some(from) = from else {
        return Ok(None);
    };
    let Some(video) = from.get("video").filter(|v| v.is_object()) else {
        return out_of_range(format!("{path}/from"));
    };
    let at = |field: &str| format!("{path}/from/video/{field}");
    const FIELDS: [&str; 7] = ["asset", "frames", "depth", "near", "far", "fov", "step"];
    if let Some(k) = video
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k)
        .find(|k| !FIELDS.contains(&k.as_str()))
    {
        return out_of_range(at(k));
    }
    let asset = match video.get("asset").and_then(Value::as_str) {
        Some(s) if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) => s,
        _ => return out_of_range(at("asset")),
    };
    let red = match video
        .get("depth")
        .filter(|v| !v.is_null())
        .map(Value::as_str)
    {
        None | Some(Some("luma")) => false,
        Some(Some("r")) => true,
        Some(_) => return out_of_range(at("depth")),
    };
    let Some(near) = num(video.get("near")).filter(|n| *n > 0.0) else {
        return out_of_range(at("near"));
    };
    let Some(far) = num(video.get("far")).filter(|f| *f > near) else {
        return out_of_range(at("far"));
    };
    let fov: Vec<f64> = match video.get("fov").and_then(Value::as_array) {
        Some(a) if a.len() == 2 => a.iter().filter_map(|v| num(Some(v))).collect(),
        _ => Vec::new(),
    };
    let [fx, fy] = fov[..] else {
        return out_of_range(at("fov"));
    };
    if ![fx, fy].iter().all(|d| *d > 0.0 && *d < 180.0) {
        return out_of_range(at("fov"));
    }
    let step = match video.get("step").filter(|v| !v.is_null()) {
        None => 1,
        Some(s) => match s.as_u64() {
            Some(s @ 1..=MAX_STEP) => s as u32,
            _ => return out_of_range(at("step")),
        },
    };
    Ok(Some(Cloud {
        asset: asset.to_ascii_lowercase(),
        frames: video.get("frames").cloned().unwrap_or(Value::Null),
        red,
        near,
        far,
        tan: [tan(rad(fx) / 2.0), tan(rad(fy) / 2.0)],
        step,
        painted: None,
        model,
    }))
}

/// A `mark.point` at t under its item's world `model`: its shape, size and color, and its set
/// from a depth video when it has one, which takes each pixel's color unless its paint names one.
pub(crate) fn point(
    id: &str,
    params: &Value,
    path: &str,
    model: Affine3,
    look: &Look3,
) -> Result<Point, Refused> {
    let shape = match params.get("shape").and_then(Value::as_str) {
        None | Some("dot") => PointShape::Dot,
        Some("square") => PointShape::Square,
        Some("diamond") => PointShape::Diamond,
        Some(_) => return out_of_range(format!("{path}/shape")),
    };
    let cloud = parse(params, path, model)?;
    let color = match (&cloud, params.get("paint")) {
        (Some(_), None) => None,
        _ => Some(paint(look, params, path)?),
    };
    Ok(Point {
        id: id.to_string(),
        pos: origin(&model),
        size: num(params.get("size")).unwrap_or(4.0),
        world: params.get("size_space").and_then(Value::as_str) == Some("world"),
        shape,
        color: color.unwrap_or([255; 3]),
        cloud: cloud.map(|c| {
            Arc::new(Cloud {
                painted: color,
                ..c
            })
        }),
    })
}

/// `mark.point@1`'s schema (Item and kind: schema; #420), its `from` a rebuild like its size.
pub(crate) fn spec() -> Spec {
    let video = |far: u32| json!({"video": {"asset": "a".repeat(64), "near": 1, "far": far, "fov": [60, 45]}});
    Spec {
        kind: "mark.point@1",
        module: "scene3d",
        params: common(vec![
            p("size", "px", "px", json!(4), G, json!(4), json!(6)),
            p(
                "shape",
                "dot | square | diamond",
                "",
                json!("dot"),
                S,
                json!("dot"),
                json!("square"),
            ),
            p(
                "from",
                "video {asset, frames, depth: luma | r, near, far, fov: [deg, deg], step}",
                "",
                Value::Null,
                G,
                video(5),
                video(6),
            ),
        ]),
        reads: None,
        fixture: json!({"it": item("mark.point@1", json!({"size": 4, "paint": {"fill": {"role": "ink"}}}))}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{evaluate, Labels};
    use crate::spatial::{Index, Plants};

    const ID: [[f64; 4]; 3] = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];

    fn hash() -> String {
        "0f".repeat(32)
    }

    /// The criterion's set: 1 to 5 m, 60° × 45°.
    fn video() -> Value {
        json!({"asset": hash(), "near": 1, "far": 5, "fov": [60, 45]})
    }

    fn with(field: &str, v: Value) -> Value {
        let mut video = video();
        video[field] = v;
        json!({"from": {"video": video}})
    }

    fn refusal(params: Value) -> Refused {
        parse(&params, "items/pts/params", ID).expect_err("refused")
    }

    #[test]
    fn a_video_set_reads_its_fields_and_counts_its_steps() {
        let c = parse(&json!({"from": {"video": video()}}), "items/pts/params", ID)
            .expect("it reads")
            .expect("a set");
        assert_eq!(
            (c.asset.as_str(), c.near, c.far),
            (hash().as_str(), 1.0, 5.0)
        );
        assert_eq!((c.red, c.step, c.painted), (false, 1, None));
        assert!(
            (c.tan[0] - 0.577_350_269_189_625_8).abs() < 1e-15,
            "tan 30°: {}",
            c.tan[0]
        );
        assert!(
            (c.tan[1] - 0.414_213_562_373_095).abs() < 1e-15,
            "tan 22.5°: {}",
            c.tan[1]
        );
        let red = parse(&with("depth", json!("r")), "items/pts/params", ID)
            .unwrap()
            .unwrap();
        assert!(red.red, "depth: r reads red");
        let two = parse(&with("step", json!(2)), "items/pts/params", ID)
            .unwrap()
            .unwrap();
        assert_eq!(two.step, 2);
        assert_eq!(count([640, 480], 1), 307_200);
        assert_eq!(count([1920, 1080], 1), 2_073_600);
        assert_eq!(count([1920, 1080], 2), 518_400);
        assert_eq!(count([5, 3], 2), 2, "a partial step leaves no point");
        assert_eq!(parse(&json!({"size": 4}), "items/pts/params", ID), Ok(None));
    }

    #[test]
    fn a_field_out_of_its_range_or_a_second_source_is_refused_naming_it() {
        let field = |f: &str| format!("items/pts/params/from/video/{f}");
        for (params, path) in [
            (with("step", json!(0)), field("step")),
            (with("step", json!(9)), field("step")),
            (with("step", json!(1.5)), field("step")),
            (with("near", json!(0)), field("near")),
            (with("far", json!(1)), field("far")),
            (with("far", json!(0.5)), field("far")),
            (with("fov", json!([0, 45])), field("fov")),
            (with("fov", json!([60, 180])), field("fov")),
            (with("fov", json!([60])), field("fov")),
            (with("depth", json!("g")), field("depth")),
            (with("asset", Value::Null), field("asset")),
            (with("asset", json!("ab")), field("asset")),
            (with("stpe", json!(2)), field("stpe")),
            (
                json!({"from": {"image": {}}}),
                "items/pts/params/from".into(),
            ),
            (
                json!({"from": {"video": video(), "surface": {}}}),
                "items/pts".into(),
            ),
            (
                json!({"from": {"video": video()}, "chunks": hash()}),
                "items/pts".into(),
            ),
            (
                json!({"from": {"video": video()}, "vertices": {"of": "m"}}),
                "items/pts".into(),
            ),
        ] {
            let r = refusal(params.clone());
            assert_eq!(
                (r.code, r.path.as_str()),
                ("out_of_range", path.as_str()),
                "{params}"
            );
        }
    }

    fn doc(paint: Option<Value>) -> Value {
        let mut params = json!({"size": 2, "from": {"video": video()}});
        if let Some(p) = paint {
            params["paint"] = p;
        }
        json!({
            "format": 1, "size": [320, 240], "camera": "cam",
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                        "params": {"projection": "perspective", "position": [0, 0, 10], "target": [0, 0, 0], "fov": 40}},
                "pts": {"id": "pts", "kind": "mark.point@1", "order": "a1", "params": params}
            }
        })
    }

    /// The criterion's evaluated data: the set's box from near, far and fov (x within ±2.887 m,
    /// y within ±2.071 m, z from −5 to −1 m) and none of its points; the camera's far reaches it.
    #[test]
    fn a_set_is_its_frustum_box_in_evaluated_data_never_its_points() {
        let index = Index::new(&doc(None), 0, Plants::default()).expect("indexed");
        let row = &index.items_json()["pts"];
        let keys: Vec<&String> = row.as_object().expect("a row").keys().collect();
        assert_eq!(
            keys,
            ["bounds", "subtree", "children"],
            "the row holds no points: {row}"
        );
        let near = |v: &Value, want: f64| (v.as_f64().unwrap() - want).abs() < 5e-4;
        let (min, max) = (&row["bounds"]["min"], &row["bounds"]["max"]);
        for (v, want) in [
            (&min[0], -2.887),
            (&max[0], 2.887),
            (&min[1], -2.071),
            (&max[1], 2.071),
            (&min[2], -5.0),
            (&max[2], -1.0),
        ] {
            assert!(near(v, want), "bounds {row}: want {want}");
        }
        let look = Look3::read(&json!({"roles": {"ink": "#202020", "ground": "#ffffff"}})).unwrap();
        let scene = evaluate(&doc(None), 0, &look, &mut Labels::new()).expect("it draws");
        let point = &scene.layers[0].points[0];
        let cloud = point.cloud.as_ref().expect("the point is a set");
        assert_eq!((cloud.near, cloud.far, cloud.painted), (1.0, 5.0, None));
        // The farthest corner is 15 m down the view; its origin alone would leave far at 11 m.
        assert!(
            scene.camera.far > 15.0,
            "far {} covers the set",
            scene.camera.far
        );
        let ink = json!({"fill": {"role": "ink"}});
        let painted = evaluate(&doc(Some(ink)), 0, &look, &mut Labels::new()).unwrap();
        let cloud = painted.layers[0].points[0].cloud.clone().unwrap();
        assert_eq!(cloud.painted, Some([0x20; 3]), "the paint names its color");
    }
}
