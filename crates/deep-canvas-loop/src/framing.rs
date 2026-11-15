//! `camera.framing` (#1938; canvas primitives: Check input: loop kinds, Camera `camera@1`:
//! framing): the kept items projected through the evaluated camera at each checked time, held
//! inside the safe frame less `margin`, spanning `fill` of its shorter side, clear of overlays,
//! with the horizon level; its fix the camera's distance or roll as one patch op, in closed form.

use deep_canvas::ops::{atan2, deg, sqrt};
use deep_canvas::registry::{Raised, Report};
use deep_canvas_scene3d::scene::{Camera, Scene, Shape2};
use serde_json::{json, Value};

use crate::scene::{self, blocked};

pub const KIND: &str = "camera.framing";
pub const CODE: &str = "loop.framing";

type Vec3 = [f64; 3];

/// The check input's numbers, which a brief may only tighten.
struct Opts {
    margin: f64,
    fill: [f64; 2],
    horizon_max: f64,
}

/// One checked time's reading.
struct Reading {
    t: i64,
    /// Kept items with a point outside the frame they must stay inside, or behind the eye.
    cut: Vec<String>,
    fill: f64,
    horizon: f64,
    /// The overlays the kept items' box reaches.
    under: Vec<String>,
}

impl Reading {
    fn framed(&self, o: &Opts) -> bool {
        self.cut.is_empty() && self.fill >= o.fill[0] && self.fill <= o.fill[1]
    }
}

/// The safe frame `[x0, y0, x1, y1]` in px, and inside it the frame the kept items must stay in.
fn frames(doc: &Value, cam: &Camera, o: &Opts) -> ([f64; 4], [f64; 4]) {
    let [w, h] = cam.size;
    let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0);
    let s = [safe, safe, w - safe, h - safe];
    let m = o.margin * (s[2] - s[0]).min(s[3] - s[1]);
    (s, [s[0] + m, s[1] + m, s[2] - m, s[3] - m])
}

/// Every world point each kept item draws at, by item; a kept item that draws nothing is
/// BLOCKED.
fn points(scene: &Scene, keep: &[String]) -> Result<Vec<(String, Vec<Vec3>)>, Value> {
    keep.iter()
        .map(|id| {
            let pts: Vec<Vec3> = scene
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .filter(|s| scene::is_of(&s.id, id))
                .flat_map(|s| s.points())
                .collect();
            if pts.is_empty() {
                Err(blocked("not_drawn", KIND, &[id.clone()], &format!("items/{id}")))
            } else {
                Ok((id.clone(), pts))
            }
        })
        .collect()
}

/// The boxes overlays and readouts cover on the frame, by ID: each view overlay's rect (#506)
/// among them.
fn overlay_boxes(doc: &Value, scene: &Scene) -> Vec<(String, [f64; 4])> {
    let mut out = Vec::new();
    for v in deep_canvas_scene3d::views::placed(doc, scene.size, None).unwrap_or_default() {
        let [x, y, w, h] = v.rect.map(f64::from);
        out.push((v.id, [x, y, x + w, y + h]));
    }
    for o in &scene.overlays {
        let Some([ox, oy]) = o.origin else { continue };
        for s in &o.shapes {
            let b = match s {
                Shape2::Rect { rect, .. } => *rect,
                Shape2::Circle { center, r, .. } => {
                    [center[0] - r, center[1] - r, center[0] + r, center[1] + r]
                }
            };
            out.push((o.id.clone(), [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy]));
        }
    }
    for r in &scene.readouts {
        if let Some([cx, cy, _]) = scene.camera.project(r.pos) {
            let [qw, qh] = r.quad;
            out.push((
                r.id.clone(),
                [cx - qw / 2.0, cy - qh / 2.0, cx + qw / 2.0, cy + qh / 2.0],
            ));
        }
    }
    out
}

fn read(doc: &Value, scene: &Scene, t: i64, keep: &[String], o: &Opts) -> Result<Reading, Value> {
    let cam = &scene.camera;
    let (safe, inner) = frames(doc, cam, o);
    let side = (safe[2] - safe[0]).min(safe[3] - safe[1]);
    let mut cut = Vec::new();
    let mut bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for (id, pts) in points(scene, keep)? {
        let mut out = false;
        for p in pts {
            // Behind the eye nothing draws; the near plane is the scene's own nearest depth.
            let behind = cam.perspective && cam.to_view(p)[2] <= 0.0;
            match cam.project(p).filter(|_| !behind) {
                Some([x, y, _]) => {
                    bbox = [bbox[0].min(x), bbox[1].min(y), bbox[2].max(x), bbox[3].max(y)];
                    out |= x < inner[0] || x > inner[2] || y < inner[1] || y > inner[3];
                }
                None => out = true,
            }
        }
        if out {
            cut.push(id);
        }
    }
    let fill = if bbox[0].is_finite() {
        (bbox[2] - bbox[0]).max(bbox[3] - bbox[1]) / side
    } else {
        0.0
    };
    let mut under: Vec<String> = overlay_boxes(doc, scene)
        .into_iter()
        .filter(|(_, b)| b[0] < bbox[2] && b[2] > bbox[0] && b[1] < bbox[3] && b[3] > bbox[1])
        .map(|(id, _)| id)
        .collect();
    under.dedup();
    let horizon = deg(atan2(cam.roll[1], cam.roll[0])).abs();
    Ok(Reading {
        t,
        cut,
        fill,
        horizon,
        under,
    })
}

/// Where the kept items should land, as offsets from the camera's centre: the frame they must stay
/// inside, a hair within it, or the square the middle of `fill` spans about the safe frame's
/// centre; `None` when the camera's centre is outside it, where no distance frames the subject.
fn target(doc: &Value, cam: &Camera, o: &Opts, middle: bool) -> Option<([f64; 2], [f64; 2])> {
    let (safe, inner) = frames(doc, cam, o);
    let b = if middle {
        let half = (o.fill[0] + o.fill[1]) / 4.0 * (safe[2] - safe[0]).min(safe[3] - safe[1]);
        let c = [(safe[0] + safe[2]) / 2.0, (safe[1] + safe[3]) / 2.0];
        [
            (c[0] - half).max(inner[0]),
            (c[1] - half).max(inner[1]),
            (c[0] + half).min(inner[2]),
            (c[1] + half).min(inner[3]),
        ]
    } else {
        let hair = 0.01 * (inner[2] - inner[0]).min(inner[3] - inner[1]);
        [inner[0] + hair, inner[1] + hair, inner[2] - hair, inner[3] - hair]
    };
    let lo = [b[0] - cam.centre[0], b[1] - cam.centre[1]];
    let hi = [b[2] - cam.centre[0], b[3] - cam.centre[1]];
    (lo[0] < 0.0 && hi[0] > 0.0 && lo[1] < 0.0 && hi[1] > 0.0).then_some((lo, hi))
}

/// How far the camera must move back along its view (m, negative: forward) so every kept point
/// lands inside the target: exact, since a point's offset from the frame centre scales by one
/// over its depth.
fn pull_back(doc: &Value, scene: &Scene, keep: &[String], o: &Opts, middle: bool) -> Option<f64> {
    let cam = &scene.camera;
    let (lo, hi) = target(doc, cam, o, middle)?;
    let [co, sn] = cam.roll;
    let mut need = f64::NEG_INFINITY;
    let mut nearest = f64::INFINITY;
    for (_, pts) in points(scene, keep).ok()? {
        for p in pts {
            let [vx, vy, vz] = cam.to_view(p);
            let ax = (vx * co + vy * sn) * cam.scale;
            let ay = (vx * sn - vy * co) * cam.scale;
            for (a, l, h) in [(ax, lo[0], hi[0]), (ay, lo[1], hi[1])] {
                need = need.max(if a > 0.0 { a / h } else { a / l } - vz);
            }
            nearest = nearest.min(vz);
        }
    }
    // The nearest kept point stays in front of the eye.
    Some(need.max(1e-3 - nearest))
}

/// The same for an orthographic camera: the px per m every kept point fits the target at.
fn ortho_scale(doc: &Value, scene: &Scene, keep: &[String], o: &Opts, middle: bool) -> Option<f64> {
    let cam = &scene.camera;
    let (lo, hi) = target(doc, cam, o, middle)?;
    let [co, sn] = cam.roll;
    let mut s = f64::INFINITY;
    for (_, pts) in points(scene, keep).ok()? {
        for p in pts {
            let [vx, vy, _] = cam.to_view(p);
            let bx = vx * co + vy * sn;
            let by = vx * sn - vy * co;
            for (b, l, h) in [(bx, lo[0], hi[0]), (by, lo[1], hi[1])] {
                if b != 0.0 {
                    s = s.min(if b > 0.0 { h / b } else { l / b });
                }
            }
        }
    }
    s.is_finite().then_some(s)
}

fn length(a: Vec3) -> f64 {
    sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

/// The one patch op that moves the camera to frame the kept items, worked out on `scene`, for
/// the way the camera states its distance (its position, its orbit distance or its view width),
/// with what it does in words. A camera that frames by `fit` sets its own distance, so no op is
/// named for it.
fn distance_op(
    doc: &Value,
    scene: &Scene,
    keep: &[String],
    o: &Opts,
    middle: bool,
) -> Option<(Value, String)> {
    let (cam_id, item) = scene::camera_of(doc)?;
    let params = item.get("params")?;
    if params.get("fit").is_some() {
        return None;
    }
    let cam = &scene.camera;
    let at = |p: &str| format!("items/{cam_id}/params/{p}");
    let op = |path: String, value: Value| json!({"op": "set", "id": cam_id, "path": path, "value": value});
    if !cam.perspective {
        let width = cam.size[0] / ortho_scale(doc, scene, keep, o, middle)?;
        let words = format!("set the view width to {width:.2} m");
        return Some((op(at("view_width"), json!(width)), words));
    }
    let delta = pull_back(doc, scene, keep, o, middle)?;
    let words = format!(
        "{} the camera {:.2} m",
        if delta > 0.0 { "pull back" } else { "move in" },
        delta.abs()
    );
    if let Some(p) = params.get("position").and_then(Value::as_array) {
        let p: Vec<f64> = p.iter().filter_map(Value::as_f64).collect();
        let [x, y, z] = <[f64; 3]>::try_from(p).ok()?;
        let f = cam.forward;
        let moved = [x - f[0] * delta, y - f[1] * delta, z - f[2] * delta];
        return Some((op(at("position"), json!(moved)), words));
    }
    let target = params
        .get("target")
        .and_then(Value::as_array)
        .map(|t| t.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
        .and_then(|t| <[f64; 3]>::try_from(t).ok())
        .unwrap_or([0.0; 3]);
    let d = length([
        cam.eye[0] - target[0],
        cam.eye[1] - target[1],
        cam.eye[2] - target[2],
    ]);
    if params.pointer("/orbit/distance").is_some() {
        return Some((op(at("orbit/distance"), json!(d + delta)), words));
    }
    // The distance follows from the view width and the field of view: scale is the focal
    // length in px over the wider side, so the width at distance d is d × wider ÷ scale.
    let wider = cam.size[0].max(cam.size[1]);
    let width = (d + delta) * wider / cam.scale;
    Some((op(at("view_width"), json!(width)), words))
}

pub fn report(lowered: &Value, input: &Value) -> Report {
    let mut out = Report::default();
    // Values the design lists alone; anything else is refused, never read loosely.
    for (field, only) in [("inside", "safe"), ("cut", "refuse"), ("overlay", "avoid")] {
        if input.get(field).is_some_and(|v| v != only) {
            out.blocked.push(blocked("out_of_range", KIND, &[], field));
        }
    }
    let fill = input
        .get("fill")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<_>>());
    let o = Opts {
        margin: crate::number(input, "/margin", 0.04).max(0.04),
        fill: match fill.as_deref() {
            Some([lo, hi]) => [lo.max(0.2), hi.min(0.9)],
            _ => [0.2, 0.9],
        },
        horizon_max: crate::number(input, "/horizon_max", 1.0).min(1.0),
    };
    let keep = match scene::kept(lowered, input, "keep", KIND) {
        Ok(k) => k,
        Err(b) => {
            out.blocked.push(b);
            return out;
        }
    };
    // #506: a film's main shot is checked along its span, at 30 Hz (`path_rate`'s default) from
    // each of the envelope camera's shots' start to its end, when the input names no times; a
    // film whose shots it can't read is BLOCKED, never passed on one sample.
    let shot_times = match lowered.get("shots").and_then(Value::as_object) {
        Some(s) if !s.is_empty() && input.get("at_times").is_none() => {
            match deep_canvas_motion::shots::spans(lowered).map(|s| scene::sampled(&s, 30)) {
                Some(t) if !t.is_empty() => Some(Ok(t)),
                _ => Some(Err(blocked("not_run", KIND, &[], "shots"))),
            }
        }
        _ => None,
    };
    let times = match shot_times.unwrap_or_else(|| scene::times(input, KIND)) {
        Ok(t) => t,
        Err(b) => {
            out.blocked.push(b);
            return out;
        }
    };
    if !out.blocked.is_empty() {
        return out;
    }
    let read_all = |doc: &Value| -> Result<Vec<(Reading, Scene)>, Value> {
        times
            .iter()
            .map(|&t| {
                // A shot poses the camera at each time, as the frame draws it (#506: the main
                // shot's kept items).
                let posed = deep_canvas_motion::shots::posed(doc, t);
                let doc = posed.as_ref().unwrap_or(doc);
                let s = scene::evaluate(doc, input, t, KIND)?;
                Ok((read(doc, &s, t, &keep, &o)?, s))
            })
            .collect()
    };
    let readings = match read_all(lowered) {
        Ok(r) => r,
        Err(b) => {
            out.blocked.push(b);
            return out;
        }
    };
    let cam_id = scene::camera_of(lowered).map(|(id, _)| id).unwrap_or_default();
    let first = keep[0].clone();
    for (r, _) in &readings {
        out.results.push(json!({
            "t": r.t, "keep": keep, "cut": r.cut, "fill": r.fill, "range": o.fill,
            "horizon": r.horizon, "under": r.under,
        }));
    }
    // The subject: cut by the frame, or spanning outside `fill`; one fix moves the camera.
    if let Some((r, s)) = readings.iter().find(|(r, _)| !r.framed(&o)) {
        // The fix is named as ops only when every checked time reads framed with it applied.
        // The smallest move that keeps them inside the frame first; else the one that sets
        // them in the middle of `fill`.
        let fix = [false, true]
            .into_iter()
            .filter_map(|middle| distance_op(lowered, s, &keep, &o, middle))
            .find(|(op, _)| {
                let fixed = scene::with_set(
                    lowered,
                    op["path"].as_str().unwrap_or_default(),
                    op["value"].clone(),
                );
                read_all(&fixed).is_ok_and(|rs| rs.iter().all(|(r, _)| r.framed(&o)))
            });
        let fault = if r.cut.is_empty() {
            format!("the kept items span {:.2} of the safe frame's shorter side, outside {:?}", r.fill, o.fill)
        } else {
            format!("{} cut by the safe frame less its margin", r.cut.join(", "))
        };
        let what = match &fix {
            Some((_, words)) => format!("{fault}: {words}"),
            None => fault,
        };
        let id = r.cut.first().cloned().unwrap_or_else(|| first.clone());
        let actual = json!({"t": r.t, "keep": keep, "cut": r.cut, "fill": r.fill,
                            "range": o.fill, "camera": cam_id});
        let raised = Raised {
            code: CODE,
            severity: "error",
            path: format!("items/{cam_id}/params"),
            what,
            fix_ops: fix.map(|(op, _)| vec![op]),
        };
        out.raised.push((id, raised, actual));
    }
    // The horizon: the camera's roll, set level.
    if let Some((r, _)) = readings.iter().find(|(r, _)| r.horizon > o.horizon_max) {
        let path = format!("items/{cam_id}/params/roll");
        let fixed = scene::with_set(lowered, &path, json!(0));
        let cures = read_all(&fixed).is_ok_and(|rs| rs.iter().all(|(r, _)| r.horizon <= o.horizon_max));
        let raised = Raised {
            code: CODE,
            severity: "error",
            path: path.clone(),
            what: format!("the horizon tilts {:.2}°, past {}°: set the camera's roll to 0", r.horizon, o.horizon_max),
            fix_ops: cures.then(|| vec![json!({"op": "set", "id": cam_id, "path": path, "value": 0})]),
        };
        out.raised.push((first.clone(), raised, json!({"t": r.t, "horizon": r.horizon, "max": o.horizon_max, "camera": cam_id})));
    }
    // An overlay over the subject: no camera move clears it in closed form, so its fix is text.
    if let Some((r, _)) = readings.iter().find(|(r, _)| !r.under.is_empty()) {
        let raised = Raised {
            code: CODE,
            severity: "error",
            path: format!("items/{}", r.under[0]),
            what: format!("the kept items lie under {}", r.under.join(", ")),
            fix_ops: None,
        };
        out.raised.push((first, raised, json!({"t": r.t, "under": r.under})));
    }
    out
}
