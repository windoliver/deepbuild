//! `camera.framing` (#1938; canvas primitives: Check input: loop kinds, Camera `camera@1`:
//! framing): the kept items projected through the evaluated camera at each checked time, held
//! inside the safe frame less `margin`, spanning `fill` of its shorter side, clear of overlays,
//! with the horizon level and, with `verticals_max` (#468), the kept items' vertical edges upright;
//! its fix the camera's distance or roll as one patch op, or a level camera and a lens shift, in
//! closed form.

use deep_canvas::ops::{asin, atan2, cos, deg, rad, sin, sqrt, tan};
use std::cell::Cell;

use deep_canvas::registry::{Raised, Report};
use deep_canvas_scene3d::scene::{Camera, Scene, Shape2};
use serde_json::{json, Map, Value};

use crate::occluded::{self, Occluders, Share};
use crate::paths;
use crate::scene::{self, blocked};

pub const KIND: &str = "camera.framing";
pub const CODE: &str = "loop.framing";

type Vec3 = [f64; 3];

/// The check input's numbers, which a brief may only tighten.
struct Opts {
    margin: f64,
    fill: [f64; 2],
    horizon_max: f64,
    /// Off unless the input names it (#468).
    verticals_max: Option<f64>,
    /// #457: the most of a kept item's in-frame sample points other items may hide, the points
    /// per kept item, the items that never occlude, and the planted program's additive stops.
    occluded_max: f64,
    samples: usize,
    except: Vec<String>,
    add_occludes: bool,
    /// The planted programs: patterns seeded by item order; a cutaway hiding whole items.
    by_order: bool,
    cut_whole: bool,
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
    /// The kept item whose projected vertical edge leans most, and its lean in degrees.
    lean: Option<(String, f64)>,
    /// #457: each kept item's occluded share.
    occluded: Vec<Share>,
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
                Err(blocked(
                    "not_drawn",
                    KIND,
                    std::slice::from_ref(id),
                    &format!("items/{id}"),
                ))
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

/// What a check run times through the host's clock (the loop reads none): the occluded share and
/// the camera path measures, in ms, on the main reading alone.
pub struct Timer<'a> {
    clock: Option<&'a dyn Fn() -> f64>,
    occluded: Cell<f64>,
    paths: Cell<f64>,
}

impl<'a> Timer<'a> {
    pub fn new(clock: Option<&'a dyn Fn() -> f64>) -> Timer<'a> {
        Timer {
            clock,
            occluded: Cell::new(0.0),
            paths: Cell::new(0.0),
        }
    }

    fn time<T>(&self, into: &Cell<f64>, on: bool, f: impl FnOnce() -> T) -> T {
        match self.clock.filter(|_| on) {
            Some(clock) => {
                let start = clock();
                let out = f();
                into.set(into.get() + clock() - start);
                out
            }
            None => f(),
        }
    }

    /// `{occluded_ms, paths_ms}`, where a clock ran.
    pub fn timing(&self) -> Map<String, Value> {
        let mut out = Map::new();
        if self.clock.is_some() {
            out.insert("occluded_ms".into(), json!(self.occluded.get()));
            out.insert("paths_ms".into(), json!(self.paths.get()));
        }
        out
    }
}

fn read(
    doc: &Value,
    scene: &Scene,
    t: i64,
    keep: &[String],
    o: &Opts,
    timer: Option<&Timer<'_>>,
) -> Result<Reading, Value> {
    let cam = &scene.camera;
    let (safe, inner) = frames(doc, cam, o);
    let side = (safe[2] - safe[0]).min(safe[3] - safe[1]);
    let mut cut = Vec::new();
    let mut bbox = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for (id, pts) in points(scene, keep)? {
        let mut out = false;
        for p in pts {
            // Behind the eye nothing draws; the near plane is the scene's own nearest depth.
            let behind = cam.perspective && cam.to_view(p)[2] <= 0.0;
            match cam.project(p).filter(|_| !behind) {
                Some([x, y, _]) => {
                    bbox = [
                        bbox[0].min(x),
                        bbox[1].min(y),
                        bbox[2].max(x),
                        bbox[3].max(y),
                    ];
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
    let occluded = |_: ()| {
        let occ = Occluders::new(scene, &o.except, o.add_occludes, o.cut_whole);
        keep.iter()
            .map(|id| {
                // The planted program seeds a pattern by the item's place in draw order.
                let seed = if o.by_order {
                    let mut order: Vec<(&str, &String)> = doc["items"]
                        .as_object()
                        .into_iter()
                        .flatten()
                        .map(|(k, v)| (v["order"].as_str().unwrap_or(""), k))
                        .collect();
                    order.sort();
                    order
                        .iter()
                        .position(|(_, k)| *k == id)
                        .unwrap_or(0)
                        .to_string()
                } else {
                    id.clone()
                };
                occluded::share(scene, &occ, id, o.samples, &seed)
            })
            .collect()
    };
    let occluded = match timer {
        Some(tm) => tm.time(&tm.occluded, true, || occluded(())),
        None => occluded(()),
    };
    Ok(Reading {
        t,
        cut,
        fill,
        horizon,
        under,
        lean: lean(scene, keep),
        occluded,
    })
}

/// #457: a flat (2D) document's reading at `t`: each kept item's box in u through the camera's
/// pose at t (its view width about its target, y down), held inside the safe frame less its
/// margin and spanning `fill` of its shorter side, as a 3D reading holds its projected points.
fn read_flat(doc: &Value, t: i64, keep: &[String], o: &Opts) -> Result<Reading, Value> {
    let size: Vec<f64> = doc
        .get("size")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let [w, h] = [
        size.first().copied().unwrap_or(1.0),
        size.get(1).copied().unwrap_or(1.0),
    ];
    let posed = deep_canvas_motion::shots::posed(doc, t);
    let (_, cam) = scene::camera_of(posed.as_ref().unwrap_or(doc))
        .ok_or_else(|| blocked("ref_unresolved", KIND, &[], "camera"))?;
    let p = &cam["params"];
    let target: Vec<f64> = p["target"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let (tx, ty) = (
        target.first().copied().unwrap_or(w / 2.0),
        target.get(1).copied().unwrap_or(h / 2.0),
    );
    let width = p["view_width"].as_f64().unwrap_or(w);
    let k = w / width;
    let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0);
    let sf = [safe, safe, w - safe, h - safe];
    let m = o.margin * (sf[2] - sf[0]).min(sf[3] - sf[1]);
    let inner = [sf[0] + m, sf[1] + m, sf[2] - m, sf[3] - m];
    let mut cut = Vec::new();
    let mut bbox = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for id in keep {
        let b: Vec<f64> = doc
            .pointer(&format!("/items/{id}/params/box"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        let [x, y, bw, bh] = <[f64; 4]>::try_from(b).map_err(|_| {
            blocked(
                "not_drawn",
                KIND,
                std::slice::from_ref(id),
                &format!("items/{id}"),
            )
        })?;
        let px = |u: f64, v: f64| [(u - tx) * k + w / 2.0, (v - ty) * k + h / 2.0];
        let (a, c) = (px(x, y), px(x + bw, y + bh));
        bbox = [
            bbox[0].min(a[0]),
            bbox[1].min(a[1]),
            bbox[2].max(c[0]),
            bbox[3].max(c[1]),
        ];
        if a[0] < inner[0] || a[1] < inner[1] || c[0] > inner[2] || c[1] > inner[3] {
            cut.push(id.clone());
        }
    }
    let side = (sf[2] - sf[0]).min(sf[3] - sf[1]);
    Ok(Reading {
        t,
        cut,
        fill: (bbox[2] - bbox[0]).max(bbox[3] - bbox[1]) / side,
        horizon: p["roll"].as_f64().unwrap_or(0.0).abs(),
        under: Vec::new(),
        lean: None,
        occluded: Vec::new(),
    })
}

/// The kept item whose vertical edges lean most on the frame, and that lean in degrees from the
/// frame's vertical: each solid's edges along its own y over its local box, where they stand
/// within 1° of the world's vertical, both ends in front of the eye.
fn lean(scene: &Scene, keep: &[String]) -> Option<(String, f64)> {
    let cam = &scene.camera;
    let mut worst: Option<(String, f64)> = None;
    for id in keep {
        for s in scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| scene::is_of(&s.id, id))
        {
            // The local box: the unit shape's, or the mesh's own extent.
            let (lo, hi) = match &s.mesh {
                Some(m) => m.positions.iter().fold(
                    ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]),
                    |(lo, hi), p| {
                        (
                            std::array::from_fn(|k| lo[k].min(p[k])),
                            std::array::from_fn(|k| hi[k].max(p[k])),
                        )
                    },
                ),
                None => ([-0.5; 3], [0.5; 3]),
            };
            if !lo[0].is_finite() {
                continue;
            }
            let at = |p: Vec3| -> Vec3 {
                let m = &s.model;
                std::array::from_fn(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
            };
            for x in [lo[0], hi[0]] {
                for z in [lo[2], hi[2]] {
                    let (a, b) = (at([x, lo[1], z]), at([x, hi[1], z]));
                    let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                    let len = length(d);
                    if len <= 0.0 || d[1].abs() / len < 0.999_85 {
                        continue;
                    }
                    let front = |p: Vec3| !cam.perspective || cam.to_view(p)[2] > 0.0;
                    let (Some(pa), Some(pb)) = (
                        cam.project(a).filter(|_| front(a)),
                        cam.project(b).filter(|_| front(b)),
                    ) else {
                        continue;
                    };
                    let angle = deg(atan2((pb[0] - pa[0]).abs(), (pb[1] - pa[1]).abs()));
                    if worst.as_ref().is_none_or(|w| angle > w.1) {
                        worst = Some((id.clone(), angle));
                    }
                }
            }
        }
    }
    worst
}

/// The ops that level the camera and shift its lens instead, so what it aimed at stays where it
/// was on the frame: the target (or the orbit's elevation) set level with the eye, and the
/// shift raised by the pitch's tangent over the frame's height in focal lengths.
fn level_ops(doc: &Value, scene: &Scene) -> Option<(Vec<Value>, f64)> {
    let (cam_id, item) = scene::camera_of(doc)?;
    let params = item.get("params")?;
    let cam = &scene.camera;
    if !cam.perspective {
        return None;
    }
    let f = cam.forward;
    let pitch = atan2(f[1], sqrt(f[0] * f[0] + f[2] * f[2]));
    let rise = cam.scale * tan(pitch) / cam.size[1];
    let at = |p: &str| format!("items/{cam_id}/params/{p}");
    let op = |path: String, value: Value| json!({"op": "set", "id": cam_id, "path": path, "value": value});
    let level = if params.get("orbit").is_some_and(Value::is_object) {
        op(at("orbit/elevation"), json!(0))
    } else {
        let t = params.get("target").and_then(Value::as_array)?;
        let t: Vec<f64> = t.iter().filter_map(Value::as_f64).collect();
        let [x, _, z] = <[f64; 3]>::try_from(t).ok()?;
        op(at("target"), json!([x, cam.eye[1], z]))
    };
    let own: Vec<f64> = params
        .get("shift")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let (sx, sy) = (
        own.first().copied().unwrap_or(0.0),
        own.get(1).copied().unwrap_or(0.0),
    );
    let shift = op(at("shift"), json!([sx, sy + rise]));
    Some((vec![level, shift], deg(pitch)))
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
        [
            inner[0] + hair,
            inner[1] + hair,
            inner[2] - hair,
            inner[3] - hair,
        ]
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

/// #457: one orbit (`az`) or elevation (`el`) step of the camera, in degrees, as one patch op
/// with its words: an orbiting camera steps its own azimuth or elevation; one with a position
/// turns that position about its target. None for a camera it can't step, or past straight up
/// or down.
fn orbit_step(doc: &Value, az: f64, el: f64) -> Option<(Value, String)> {
    let (cam_id, item) = scene::camera_of(doc)?;
    let params = item.get("params")?;
    let at = |p: &str| format!("items/{cam_id}/params/{p}");
    let op = |path: String, value: Value| json!({"op": "set", "id": cam_id, "path": path, "value": value});
    let words = if az != 0.0 {
        format!("orbit the camera {az:+}°")
    } else {
        format!(
            "{} the camera {}°",
            if el > 0.0 { "raise" } else { "lower" },
            el.abs()
        )
    };
    if let Some(o) = params.get("orbit").filter(|o| o.is_object()) {
        let num = |k: &str, d: f64| o.get(k).and_then(Value::as_f64).unwrap_or(d);
        if az != 0.0 {
            return Some((
                op(at("orbit/azimuth"), json!(num("azimuth", 45.0) + az)),
                words,
            ));
        }
        let e = num("elevation", 30.0) + el;
        return (e.abs() < 90.0).then(|| (op(at("orbit/elevation"), json!(e)), words));
    }
    let v3 = |v: Option<&Value>| -> Option<[f64; 3]> {
        let a: Vec<f64> = v?.as_array()?.iter().filter_map(Value::as_f64).collect();
        <[f64; 3]>::try_from(a).ok()
    };
    let p = v3(params.get("position"))?;
    let t = v3(params.get("target")).unwrap_or([0.0; 3]);
    let d = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
    let r = sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if r <= 0.0 {
        return None;
    }
    let e = deg(asin((d[1] / r).clamp(-1.0, 1.0))) + el;
    if e.abs() >= 90.0 {
        return None;
    }
    let (e, a) = (rad(e), rad(deg(atan2(d[0], d[2])) + az));
    let moved = [
        t[0] + r * cos(e) * sin(a),
        t[1] + r * sin(e),
        t[2] + r * cos(e) * cos(a),
    ];
    Some((op(at("position"), json!(moved)), words))
}

/// The smallest orbit or elevation step that `passes`: 5° steps out to 90° either way, then each
/// degree up to the first that passed.
fn least_step(doc: &Value, passes: impl Fn(&Value) -> bool) -> Option<(Value, String)> {
    const DIRS: [(f64, f64); 4] = [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)];
    let at = |m: u32| {
        DIRS.iter()
            .filter_map(|&(a, e)| orbit_step(doc, a * f64::from(m), e * f64::from(m)))
            .find(|(op, _)| passes(op))
    };
    let coarse = (5..=90).step_by(5).find(|&m| at(m).is_some())?;
    ((coarse - 4)..=coarse).find_map(at)
}

pub fn report(lowered: &Value, input: &Value) -> Report {
    report_with(lowered, input, &Timer::new(None))
}

/// The check run with `timer`, through which the host times its parts (#457).
pub fn report_with(lowered: &Value, input: &Value, timer: &Timer<'_>) -> Report {
    let mut out = Report::default();
    let planted = input.get("planted").and_then(Value::as_str);
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
        verticals_max: input.get("verticals_max").and_then(Value::as_f64),
        occluded_max: crate::number(input, "/occluded_max", 0.4).min(0.4),
        samples: input
            .get("occluded_samples")
            .and_then(Value::as_u64)
            .map_or(64, |n| n.clamp(1, u64::from(u16::MAX)) as usize),
        except: input
            .get("except")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        add_occludes: planted == Some(occluded::PLANTED_ADD_OCCLUDES),
        by_order: planted == Some(occluded::PLANTED_BY_ORDER),
        cut_whole: planted == Some(occluded::PLANTED_CUT_WHOLE),
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
    let flat = !(deep_canvas_scene3d::scene::has_3d(lowered)
        || lowered.pointer("/requires/modules/scene3d").is_some());
    let paths_o = paths::Opts::read(input);
    // The document as it is, then at each value of each of the brief's sweeps.
    let mut runs: Vec<(Value, Option<(String, Value)>)> = vec![(lowered.clone(), None)];
    let swept = paths::sweeps(lowered, input);
    for (id, values, _) in &swept {
        for v in values {
            runs.push((
                paths::with_control(lowered, id, v),
                Some((id.clone(), v.clone())),
            ));
        }
    }
    for (k, (doc, sweep)) in runs.iter().enumerate() {
        let main = k == 0;
        let one = judged(doc, input, &o, &keep, &times, flat, main.then_some(timer));
        let tag = |mut v: Value| {
            if let Some((c, value)) = sweep {
                v["sweep"] = json!({"control": c, "value": value});
            }
            v
        };
        if let Some(b) = one.blocked.into_iter().next() {
            out.blocked.push(tag(b));
            continue;
        }
        if main {
            out.results.extend(one.results);
        }
        for (id, r, actual) in one.raised {
            // A failure at a sweep's value the document as it is doesn't have is the sweep's.
            if !main
                && out
                    .raised
                    .iter()
                    .any(|(i, x, _)| *i == id && x.code == r.code && x.what == r.what)
            {
                continue;
            }
            out.raised.push((id, r, tag(actual)));
        }
        // The camera path measures, at this value.
        let found = timer.time(&timer.paths, main, || {
            paths::measure(doc, input, &paths_o, &keep, &times, None)
        });
        record(&mut out, found, sweep.as_ref(), main);
    }
    // Between a slider's samples, clearance bounded over each stretch of its values.
    for (id, values, _) in swept.iter().filter(|s| s.2) {
        let vs: Vec<f64> = values.iter().filter_map(Value::as_f64).collect();
        for w in vs.windows(2) {
            let found = paths::measure(
                lowered,
                input,
                &paths_o,
                &keep,
                &times,
                Some((id, w[0], w[1])),
            );
            record(&mut out, found, Some(&(id.clone(), Value::Null)), false);
        }
    }
    // A span only sampled never passes the check: it's refused, naming the shot and the span.
    if out.raised.is_empty() {
        if let Some(Value::Array(est)) = out.results.first().map(|r| r["estimates"].clone()) {
            if let Some(e) = est.first() {
                let mut b = blocked("estimate", KIND, &[], "shots");
                b["estimate"] = e.clone();
                out.blocked.push(b);
            }
        }
    }
    out
}

/// The path readings `found` into the report: each listed on the first checked time's results,
/// each failure raised with what it measured, `sweep` naming a control and its value.
fn record(out: &mut Report, found: paths::Found, sweep: Option<&(String, Value)>, listed: bool) {
    if let Some(first) = out.results.first_mut() {
        let list = first["paths"].as_array().cloned().unwrap_or_default();
        let mut list = list;
        if listed {
            list.extend(found.readings.iter().map(paths::Reading::json));
        }
        first["paths"] = Value::Array(list);
        if !found.estimates.is_empty() {
            let mut est = first["estimates"].as_array().cloned().unwrap_or_default();
            est.extend(found.estimates.iter().cloned());
            first["estimates"] = Value::Array(est);
        }
    }
    for r in found.readings.iter().filter(|r| r.fails) {
        let mut actual = json!({"measure": r.measure, "shot": r.shot, "t": r.t, "item": r.item,
                                "value": r.value, "limit": r.limit});
        let mut path = format!("items/{}", r.item);
        let what = match (r.measure, &r.key) {
            ("clearance", _) => format!("the camera passes {:.3} m from {}, inside its clearance of {:.3} m", r.value, r.item, r.limit),
            ("corners", Some((c, k))) => {
                actual["key"] = json!(k);
                path = format!("channels/{c}/keys/{k}");
                format!("the camera's velocity jumps {:.2} m/s at key {k}, past a tenth of the shot's mean speed: set its keys to auto tangents", r.value)
            }
            ("raster_max", _) => format!("{} is magnified {:.2}× past its own pixels, past raster_max {}", r.item, r.value, r.limit),
            ("focus_coc_max", _) => format!("{}'s centre blurs to a circle of confusion of {:.2} px, past focus_coc_max {}: move the focus to it", r.item, r.value, r.limit),
            _ => format!("{} reads {:.3}", r.measure, r.value),
        };
        match (sweep, r.at) {
            (Some((c, _)), Some(v)) => actual["sweep"] = json!({"control": c, "value": v}),
            (Some((c, v)), None) if !v.is_null() => {
                actual["sweep"] = json!({"control": c, "value": v})
            }
            _ => {}
        }
        let raised = Raised {
            code: CODE,
            severity: "error",
            path,
            what,
            fix_ops: None,
        };
        out.raised.push((r.item.clone(), raised, actual));
    }
}

/// One run of the framing measures on `lowered`: its readings at each checked time and what
/// fails them, each fix checked on a copy.
fn judged(
    lowered: &Value,
    input: &Value,
    o: &Opts,
    keep: &[String],
    times: &[i64],
    flat: bool,
    timer: Option<&Timer<'_>>,
) -> Report {
    let mut out = Report::default();
    let keep = keep.to_vec();
    let read_all = |doc: &Value| -> Result<Vec<(Reading, Option<Scene>)>, Value> {
        times
            .iter()
            .map(|&t| {
                if flat {
                    return Ok((read_flat(doc, t, &keep, o)?, None));
                }
                // A shot poses the camera at each time, as the frame draws it (#506: the main
                // shot's kept items).
                let posed = deep_canvas_motion::shots::posed(doc, t);
                let doc = posed.as_ref().unwrap_or(doc);
                let s = scene::evaluate(doc, input, t, KIND)?;
                Ok((read(doc, &s, t, &keep, o, None)?, Some(s)))
            })
            .collect()
    };
    let readings = match times
        .iter()
        .map(|&t| {
            if flat {
                return Ok((read_flat(lowered, t, &keep, o)?, None));
            }
            let posed = deep_canvas_motion::shots::posed(lowered, t);
            let doc = posed.as_ref().unwrap_or(lowered);
            let s = scene::evaluate(doc, input, t, KIND)?;
            Ok((read(doc, &s, t, &keep, o, timer)?, Some(s)))
        })
        .collect::<Result<Vec<_>, Value>>()
    {
        Ok(r) => r,
        Err(b) => {
            out.blocked.push(b);
            return out;
        }
    };
    let cam_id = scene::camera_of(lowered)
        .map(|(id, _)| id)
        .unwrap_or_default();
    let first = keep[0].clone();
    for (r, _) in &readings {
        out.results.push(json!({
            "t": r.t, "keep": keep, "cut": r.cut, "fill": r.fill, "range": o.fill,
            "horizon": r.horizon, "under": r.under,
            "verticals": r.lean.as_ref().map(|(id, a)| json!({"item": id, "angle": a})),
            "occluded": r.occluded.iter().map(|x| json!({
                "item": x.item, "share": x.share, "occluders": x.occluders,
                "in_frame": x.in_frame, "points": x.points,
            })).collect::<Vec<_>>(),
        }));
    }
    // The subject: cut by the frame, or spanning outside `fill`; one fix moves the camera.
    if let Some((r, s)) = readings.iter().find(|(r, _)| !r.framed(o)) {
        // The fix is named as ops only when every checked time reads framed with it applied.
        // The smallest move that keeps them inside the frame first; else the one that sets
        // them in the middle of `fill`.
        let fix = [false, true]
            .into_iter()
            .filter_map(|middle| distance_op(lowered, s.as_ref()?, &keep, o, middle))
            .find(|(op, _)| {
                let fixed = scene::with_set(
                    lowered,
                    op["path"].as_str().unwrap_or_default(),
                    op["value"].clone(),
                );
                read_all(&fixed).is_ok_and(|rs| rs.iter().all(|(r, _)| r.framed(o)))
            });
        let fault = if r.cut.is_empty() {
            format!(
                "the kept items span {:.2} of the safe frame's shorter side, outside {:?}",
                r.fill, o.fill
            )
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
        let cures =
            read_all(&fixed).is_ok_and(|rs| rs.iter().all(|(r, _)| r.horizon <= o.horizon_max));
        let raised = Raised {
            code: CODE,
            severity: "error",
            path: path.clone(),
            what: format!(
                "the horizon tilts {:.2}°, past {}°: set the camera's roll to 0",
                r.horizon, o.horizon_max
            ),
            fix_ops: cures
                .then(|| vec![json!({"op": "set", "id": cam_id, "path": path, "value": 0})]),
        };
        out.raised.push((
            first.clone(),
            raised,
            json!({"t": r.t, "horizon": r.horizon, "max": o.horizon_max, "camera": cam_id}),
        ));
    }
    // #468: vertical edges that lean on the frame: a pitched camera, which a level camera and a
    // lens shift fix.
    if let Some(max) = o.verticals_max {
        if let Some((r, s)) = readings
            .iter()
            .find(|(r, _)| r.lean.as_ref().is_some_and(|l| l.1 > max))
        {
            let (item, angle) = r.lean.clone().unwrap_or_default();
            let fix = s
                .as_ref()
                .and_then(|s| level_ops(lowered, s))
                .filter(|(ops, _)| {
                    let fixed = ops.iter().fold(lowered.clone(), |d, op| {
                        scene::with_set(
                            &d,
                            op["path"].as_str().unwrap_or_default(),
                            op["value"].clone(),
                        )
                    });
                    read_all(&fixed).is_ok_and(|rs| {
                        rs.iter()
                            .all(|(r, _)| r.lean.as_ref().is_none_or(|l| l.1 <= max))
                    })
                });
            let words = match &fix {
                Some((ops, pitch)) => format!(
                    ": level the camera (it pitches {pitch:.2}°) and shift the lens to {}",
                    ops[1]["value"]
                ),
                None => String::new(),
            };
            let raised = Raised {
                code: CODE,
                severity: "error",
                path: format!("items/{cam_id}/params"),
                what: format!(
                    "{item}'s vertical edges lean {angle:.2}°, past verticals_max {max}°{words}"
                ),
                fix_ops: fix.map(|(ops, _)| ops),
            };
            out.raised.push((
                item.clone(),
                raised,
                json!({"t": r.t, "item": item, "angle": angle, "max": max, "camera": cam_id}),
            ));
        }
    }
    // #457: a kept item other items hide past occluded_max; its fix is the smallest orbit or
    // elevation step, found on evaluated data, under which every checked time reads under it.
    let hidden = |r: &Reading| -> Option<(String, f64, Vec<String>)> {
        r.occluded
            .iter()
            .filter(|x| x.share > o.occluded_max)
            .max_by(|a, b| a.share.total_cmp(&b.share))
            .map(|x| (x.item.clone(), x.share, x.occluders.clone()))
    };
    if let Some((r, (item, share, occluders))) =
        readings.iter().find_map(|(r, _)| hidden(r).map(|h| (r, h)))
    {
        let fix = least_step(lowered, |op| {
            let fixed = scene::with_set(
                lowered,
                op["path"].as_str().unwrap_or_default(),
                op["value"].clone(),
            );
            read_all(&fixed).is_ok_and(|rs| {
                rs.iter().all(|(r, _)| {
                    r.occluded
                        .iter()
                        .all(|x| x.item != item || x.share < o.occluded_max)
                })
            })
        });
        let words = match &fix {
            Some((_, w)) => format!(": {w}"),
            None => String::new(),
        };
        let raised = Raised {
            code: CODE,
            severity: "error",
            path: format!("items/{cam_id}/params"),
            what: format!(
                "{share:.2} of {item}'s points in frame are hidden by {}, past occluded_max {}{words}",
                occluders.join(", "),
                o.occluded_max
            ),
            fix_ops: fix.map(|(op, _)| vec![op]),
        };
        out.raised.push((
            item.clone(),
            raised,
            json!({"t": r.t, "item": item, "share": share, "occluders": occluders,
                   "max": o.occluded_max, "camera": cam_id}),
        ));
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
        out.raised
            .push((first, raised, json!({"t": r.t, "under": r.under})));
    }
    out
}
