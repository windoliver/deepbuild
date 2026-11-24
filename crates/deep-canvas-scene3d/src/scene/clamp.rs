//! #298 (canvas primitives: Overlay: clamped to the edge): an overlay anchored to an item's point
//! whose `hide` is `clamp`. While its anchor projects inside the safe frame it draws there as any
//! anchored overlay does; while the anchor projects outside it, or lies behind the camera, the
//! overlay draws centered where the ray from the safe frame's center toward the projection meets
//! the safe frame, inset by `clamp_inset` and by the overlay's own half size, so it never leaves
//! the safe area. `edge` and `edge_angle` come from that one projection, in closed form from the
//! camera and the anchor's point at t, so seeking equals playing; a driver reads them as the
//! vars `<overlay>.edge` and `<overlay>.edge_angle`, which a frame binds on its document
//! ([`view_values`], [`bound`]).

use deep_canvas::ops::{atan2, deg};

use super::*;

/// The wrong programs of the clamp, chosen only by `deep-gpu run --planted` (tests/acceptance/298):
/// a clamp of each axis on its own, one that keeps a behind-camera projection unmirrored, one to
/// the frame instead of the safe frame, and a leader that goes on drawing while clamped.
const EACH_AXIS: &str = "clamp_each_axis";
const UNMIRRORED: &str = "clamp_unmirrored_behind";
const TO_FRAME: &str = "clamp_to_frame";
pub(super) const LEADER_DRAWS: &str = "leader_draws_while_clamped";

/// A clamping overlay's view values at t: `<overlay>.edge` and `<overlay>.edge_angle`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Edge {
    /// Whether it draws on the safe frame's edge: `edge` reads 1 while it does, else 0.
    pub clamped: bool,
    /// The direction from the safe frame's center toward the anchor in degrees, 0 to the right
    /// and clockwise, as screen y points down.
    pub angle: f64,
}

/// The frame origin of an overlay of `size` px anchored to `point`, and its view values: at the
/// projection plus `offset` while that lies inside the frame less `safe`, else centered on the
/// edge of the safe frame less `inset` and the overlay's half size, toward the projection. Behind
/// a perspective eye the projection is mirrored through the center, the division taking the
/// depth's size, so the direction is the way to turn.
fn place(
    camera: &Camera,
    (safe, inset): (f64, f64),
    size: [f64; 2],
    point: Vec3,
    offset: [f64; 2],
    planted: Option<&str>,
) -> ([f64; 2], Edge) {
    let [w, h] = camera.size;
    let center = [w / 2.0, h / 2.0];
    let [vx, vy, vz] = camera.to_view(point);
    let behind = camera.perspective && vz <= 0.0;
    let s = if camera.perspective {
        camera.scale / vz.abs().max(1e-9)
    } else {
        camera.scale
    };
    let s = if behind && planted == Some(UNMIRRORED) {
        -s
    } else {
        s
    };
    let (x, y) = (vx * s, -vy * s);
    let [c, sn] = camera.roll;
    let p = [
        camera.centre[0] + x * c - y * sn,
        camera.centre[1] + x * sn + y * c,
    ];
    let d = [p[0] - center[0], p[1] - center[1]];
    let turn = deg(atan2(d[1], d[0]));
    let angle = if turn < 0.0 { turn + 360.0 } else { turn };
    let angle = if angle < 360.0 { angle } else { 0.0 };
    let inside = !behind && p[0] >= safe && p[0] <= w - safe && p[1] >= safe && p[1] <= h - safe;
    if inside {
        let edge = Edge {
            clamped: false,
            angle,
        };
        return ([p[0] + offset[0], p[1] + offset[1]], edge);
    }
    let half = [size[0] / 2.0, size[1] / 2.0];
    let keep = if planted == Some(TO_FRAME) { 0.0 } else { safe };
    let reach = [
        (center[0] - keep - inset - half[0]).max(0.0),
        (center[1] - keep - inset - half[1]).max(0.0),
    ];
    // An anchor at the center itself, as one straight behind the eye, has no direction: right.
    let d = if d == [0.0; 2] { [1.0, 0.0] } else { d };
    // The ray meets the nearer pair of sides first; that axis lands on the side exactly.
    let (tx, ty) = (reach[0] / d[0].abs(), reach[1] / d[1].abs());
    let at = if planted == Some(EACH_AXIS) {
        [
            center[0] + d[0].clamp(-reach[0], reach[0]),
            center[1] + d[1].clamp(-reach[1], reach[1]),
        ]
    } else if tx <= ty || ty.is_nan() {
        [center[0] + reach[0].copysign(d[0]), center[1] + d[1] * tx]
    } else {
        [center[0] + d[0] * ty, center[1] + reach[1].copysign(d[1])]
    };
    let edge = Edge {
        clamped: true,
        angle,
    };
    ([at[0] - half[0], at[1] - half[1]], edge)
}

/// An overlay's frame origin and view values when its `hide` is `clamp`, else `None`: `params`
/// its own at t (`offset`, `clamp_inset`), `size` its frame's and `point` its anchor's.
pub(super) fn placed(
    (params, path): (&Value, &str),
    (camera, safe): (&Camera, f64),
    size: [f64; 2],
    point: Vec3,
    planted: Option<&str>,
) -> Result<Option<([f64; 2], Edge)>, Refused> {
    if params.get("hide").and_then(Value::as_str) != Some("clamp") {
        return Ok(None);
    }
    let inset = match params.get("clamp_inset") {
        None => 0.0,
        v => num(v).filter(|x| *x >= 0.0).ok_or_else(|| Refused {
            code: "out_of_range",
            path: format!("{path}/clamp_inset"),
        })?,
    };
    let offset = xy(params.get("offset")).unwrap_or([0.0; 2]);
    let at = place(camera, (safe, inset), size, point, offset, planted);
    Ok(Some(at))
}

/// The clamping overlay a driver's var names as `<overlay>.edge` or `<overlay>.edge_angle`.
fn named<'a>(doc: &'a Value, var: &'a Value) -> Option<&'a str> {
    let (id, field) = var.as_str()?.rsplit_once('.')?;
    let hide = doc.get("items")?.get(id)?.pointer("/params/hide")?;
    (matches!(field, "edge" | "edge_angle") && hide.as_str() == Some("clamp")).then_some(id)
}

/// The item and the member of it each driver of `doc` writes that reads one of `ids`' view
/// values: `items/<item>/<member>/…`.
fn written<'a>(doc: &'a Value, ids: &[&str]) -> Vec<(&'a str, &'a str)> {
    let drivers = doc.get("drivers").and_then(Value::as_object);
    let reads = |d: &Value| {
        let vars = d.get("vars").and_then(Value::as_object);
        vars.into_iter()
            .flatten()
            .any(|(_, v)| named(doc, v).is_some_and(|id| ids.contains(&id)))
    };
    let target = |d: &'a Value| {
        let path = d.get("target")?.as_str()?.strip_prefix("items/")?;
        let mut parts = path.splitn(3, '/');
        Some((parts.next()?, parts.next()?))
    };
    drivers
        .into_iter()
        .flatten()
        .filter(|(_, d)| reads(d))
        .filter_map(|(_, d)| target(d))
        .collect()
}

/// The view values `doc`'s drivers read at t: each clamping overlay a driver's var names, with
/// its `edge` and `edge_angle` from the camera and its anchor's pose at t.
pub fn view_values(
    doc: &Value,
    t: i64,
    planted: Option<&str>,
) -> Result<Vec<(String, Edge)>, Refused> {
    let drivers = doc.get("drivers").and_then(Value::as_object);
    let mut ids: Vec<&str> = drivers
        .into_iter()
        .flatten()
        .flat_map(|(_, d)| d.get("vars").and_then(Value::as_object))
        .flatten()
        .filter_map(|(_, v)| named(doc, v))
        .collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let items = placed_at(doc, t)?;
    let item = |id: &str| items.iter().find(|(i, _, _)| i == id);
    let side = |k: usize| num(doc.pointer(&format!("/size/{k}"))).map(f64::round);
    let (Some(w), Some(h)) = (side(0), side(1)) else {
        return refused("out_of_range", "size");
    };
    let cam = doc
        .get("camera")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = item(cam).and_then(|(_, c, _)| c.get("params")?.as_object());
    let Some(params) = params else {
        return refused("ref_unresolved", "camera");
    };
    let camera = camera(params, [w, h], &[], &format!("items/{cam}/params"))?;
    let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0);
    let mut out = Vec::new();
    for id in ids {
        let Some(params) = item(id).and_then(|(_, o, _)| o.get("params")) else {
            continue;
        };
        let target = params.pointer("/anchor/item").and_then(Value::as_str);
        let Some((_, _, world)) = target.and_then(item) else {
            continue;
        };
        let point = apply(
            world,
            vec3(params.pointer("/anchor/point")).unwrap_or([0.0; 3]),
        );
        let frame = params.get("frame").and_then(Value::as_str);
        let frame = frame.and_then(item).map(|(_, f, _)| f);
        let size = [2, 3].map(|k| {
            let b = frame.and_then(|f| f.pointer(&format!("/params/box/{k}")));
            num(b).unwrap_or(0.0)
        });
        let path = format!("items/{id}/params");
        let within = (&camera, safe);
        if let Some((_, edge)) = placed((params, path.as_str()), within, size, point, planted)? {
            out.push((id.to_string(), edge));
        }
    }
    Ok(out)
}

/// `doc` as a frame at t reads it with `values` bound: each overlay's `edge` and `edge_angle` on
/// its item, where a driver's var finds them, and on each item those drivers write, the member
/// they write as evaluated, so a read or a raster of the document's own items holds it too.
pub fn bound(doc: &Value, t: i64, values: &[(String, Edge)]) -> Result<Value, Refused> {
    let mut out = doc.clone();
    let item_of = |out: &mut Value, id: &str| {
        let item = out.get_mut("items").and_then(|i| i.get_mut(id));
        item.and_then(Value::as_object_mut).is_some()
    };
    for (id, edge) in values {
        if item_of(&mut out, id) {
            out["items"][id]["edge"] = u8::from(edge.clamped).into();
            out["items"][id]["edge_angle"] = edge.angle.into();
        }
    }
    let ids: Vec<&str> = values.iter().map(|(id, _)| id.as_str()).collect();
    let targets = written(doc, &ids);
    let Some(map) = out.as_object() else {
        return Ok(out);
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let owns = |id: &str| targets.iter().any(|(owner, _)| *owner == id);
    let evaluated = eval::written_with(map, &program, &state, owns);
    for (owner, member) in targets {
        let value = evaluated.get(owner).and_then(|item| item.get(member));
        if let (Some(value), true) = (value, item_of(&mut out, owner)) {
            out["items"][owner][member] = value.clone();
        }
    }
    Ok(out)
}
