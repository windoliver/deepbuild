//! camera.framing's camera paths (#457; canvas primitives: Check input: loop kinds: camera paths):
//! each shot sampled at `path_rate` and at every key, on evaluated data in f64, with clearance
//! bounded between samples by the interval forms of the camera's pose (The closed function list)
//! and a span split until its bound decides it; corners compared at each key, a recording's
//! magnification against `raster_max`, and the circle of confusion at each kept item's centre
//! against `focus_coc_max`. A span no bound settles is an estimate, never a pass.

use deep_canvas::camera::{Offsets, Spec};
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::interval::Iv;
use deep_canvas::ops::{acos, deg, sqrt};
use deep_canvas::schedule::core_ops::Datum;
use deep_canvas_motion::curve::Ease;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Planted, Program, State, TRANSFORM};
use deep_canvas_motion::shots::{At, Move};
use deep_canvas_scene3d::scene::Scene;
use serde_json::{json, Value};

use crate::occluded::Occluders;
use crate::scene::{self, is_of};

type V3 = [f64; 3];
const F: f64 = FLICKS_PER_SECOND as f64;

/// The planted wrong programs: `clearance: auto` the near plane's half-diagonal alone; path
/// measures read at their samples alone; a sweep run at its samples alone.
pub const PLANTED_HALF_DIAGONAL: &str = "clearance_half_diagonal";
pub const PLANTED_SAMPLED: &str = "paths_sampled_at_30hz";
pub const PLANTED_SWEEP_SAMPLES: &str = "framing_sweeps_samples_only";

/// The most halvings a span takes before what's left is an estimate.
const DEPTH: u32 = 14;

/// The check input's path fields.
pub(crate) struct Opts {
    rate: i64,
    clearance: Option<f64>,
    corners: bool,
    raster_max: f64,
    focus_coc_max: f64,
    /// The export's width in px the raster measure divides by: `render.widths`' widest.
    width: Option<f64>,
    half_diagonal: bool,
    sampled_only: bool,
    pub sweep_samples_only: bool,
}

impl Opts {
    pub(crate) fn read(input: &Value) -> Opts {
        let planted = input.get("planted").and_then(Value::as_str);
        Opts {
            rate: input
                .get("path_rate")
                .and_then(Value::as_f64)
                .map_or(30, |r| r.max(30.0).round() as i64),
            clearance: input.get("clearance").and_then(Value::as_f64),
            corners: input.get("corners").is_none_or(|c| c == "refuse"),
            raster_max: crate::number(input, "/raster_max", 1.5).min(1.5),
            focus_coc_max: crate::number(input, "/focus_coc_max", 1.5).min(1.5),
            width: input
                .pointer("/render/widths")
                .and_then(Value::as_array)
                .and_then(|w| w.iter().filter_map(Value::as_f64).reduce(f64::max)),
            half_diagonal: planted == Some(PLANTED_HALF_DIAGONAL),
            sampled_only: planted == Some(PLANTED_SAMPLED),
            sweep_samples_only: planted == Some(PLANTED_SWEEP_SAMPLES),
        }
    }
}

/// One reading of a measure: the shot, the time, the item and the value, whether it fails, and
/// the key a corner is at.
#[derive(Clone, Debug)]
pub(crate) struct Reading {
    pub shot: Option<String>,
    pub t: i64,
    pub measure: &'static str,
    pub item: String,
    pub value: f64,
    pub limit: f64,
    pub fails: bool,
    pub key: Option<(String, String)>,
    /// Under a sweep's stretch, the control's value it was read at.
    pub at: Option<f64>,
}

impl Reading {
    pub(crate) fn json(&self) -> Value {
        json!({"shot": self.shot, "t": self.t, "measure": self.measure, "item": self.item,
               "value": self.value})
    }
}

/// What the measures found over a document: their worst readings, and the spans only sampled.
#[derive(Default)]
pub(crate) struct Found {
    pub readings: Vec<Reading>,
    pub estimates: Vec<Value>,
}

/// A camera pose: the eye, the target, the field of view across the wider side (0 flat) and the
/// view width.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Pose {
    eye: V3,
    target: V3,
    width: f64,
}

/// Where one component of the eye comes from: a program slot, or a fixed value.
#[derive(Clone, Copy)]
enum Src {
    Slot(usize),
    Fixed(f64),
}

/// The document's camera through time, without evaluating the scene.
pub(crate) struct Rig<'a> {
    doc: &'a Value,
    program: Program,
    cam: String,
    cam_item: usize,
    /// The camera's index in the shot plan.
    planned: Option<usize>,
    /// Where each eye component comes from, for a camera placed by `position`.
    eye: Option<[Src; 3]>,
}

fn flicks(text: &Value) -> Option<i64> {
    use deep_canvas::grammar::{Time, TimeContext};
    let ctx = TimeContext {
        frame_rate: (60, 1),
        ..TimeContext::default()
    };
    text.as_i64()
        .or_else(|| Time::parse(text.as_str()?).ok()?.resolve(&ctx).ok())
}

impl<'a> Rig<'a> {
    pub(crate) fn new(doc: &'a Value) -> Option<Rig<'a>> {
        let (cam, item) = scene::camera_of(doc)?;
        let program = Program::compile(doc.as_object()?).ok()?;
        let cam_item = program.items.iter().position(|i| *i == cam)?;
        let planned = program.shots.as_deref().and_then(|p| p.camera(&cam));
        let position: Option<Vec<f64>> = item
            .pointer("/params/position")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect());
        let eye = position.filter(|p| p.len() == 3).map(|p| {
            std::array::from_fn(|k| {
                let field = |path: &[&str]| {
                    program.fields.iter().find(|f| {
                        f.item == Some(cam_item)
                            && f.written
                            && f.path.iter().map(String::as_str).eq(path.iter().copied())
                    })
                };
                let ks = k.to_string();
                if let Some(f) = field(&["params", "position", &ks]) {
                    Src::Slot(f.slot)
                } else if let Some(f) = field(&["params", "position"]).filter(|f| f.width == 3) {
                    Src::Slot(f.slot + k)
                } else {
                    Src::Fixed(p[k])
                }
            })
        });
        Some(Rig {
            doc,
            program,
            cam,
            cam_item,
            planned,
            eye,
        })
    }

    fn state(&self, t: i64) -> State {
        let mut state = self.program.state();
        self.program.evaluate(t, Validity::Full, &mut state);
        state
    }

    /// The shots of the document's camera, `(ID, start, end)`; none without a shot plan.
    pub(crate) fn shots(&self) -> Vec<(String, i64, i64)> {
        let (Some(plan), Some(cam)) = (self.program.shots.as_deref(), self.planned) else {
            return Vec::new();
        };
        plan.shots
            .iter()
            .filter(|s| s.camera == cam && s.end > s.start)
            .map(|s| (s.id.clone(), s.start, s.end))
            .collect()
    }

    fn pose(&self, t: i64) -> Option<Pose> {
        let state = self.state(t);
        if let (Some(plan), Some(cam)) = (self.program.shots.as_deref(), self.planned) {
            let keyed = |c: usize| plan.keyed_pose(c, &self.program, &state);
            let p = plan
                .shown(
                    cam,
                    t,
                    &At {
                        reduced: false,
                        planted: Planted::None,
                        indexed: None,
                        keyed: &keyed,
                    },
                )
                .pose;
            return Some(Pose {
                eye: p.position,
                target: p.target,
                width: p.view_width,
            });
        }
        // No shot: the camera's own params as its channels and drivers write them.
        let mut params = self
            .doc
            .pointer(&format!("/items/{}/params", self.cam))?
            .clone();
        let (_, fields) = self.program.item_values(&state, &self.cam)?;
        for (path, value) in fields {
            if path.first().map(String::as_str) != Some("params") {
                continue;
            }
            let v = match value {
                Datum::Num(x) => json!(x),
                Datum::Nums(xs) => json!(xs),
                _ => continue,
            };
            if let Some(slot) = params.pointer_mut(&format!("/{}", path[1..].join("/"))) {
                *slot = v;
            }
        }
        let path = format!("items/{}/params", self.cam);
        let spec = Spec::read(
            &deep_canvas::kinds::with_defaults("camera@1", params.as_object()?),
            &path,
        )
        .ok()?;
        let rig = spec.rig(&path).ok()?;
        let p = spec.pose(&rig, &Offsets::default());
        Some(Pose {
            eye: p.position,
            target: p.target,
            width: p.view_width,
        })
    }

    /// Whether the camera's pose over `[a, b]` comes from its own params (no shot, or a keyed
    /// one), or else the shot's move and whether its eye holds, moves along a line or turns on an
    /// arc, by a monotone ease.
    fn move_over(&self, a: i64, b: i64) -> Option<Option<(Move, bool)>> {
        let (Some(plan), Some(cam)) = (self.program.shots.as_deref(), self.planned) else {
            return Some(None);
        };
        let i = plan.shot_at(cam, a)?;
        if plan.shot_at(cam, b) != Some(i) {
            return None;
        }
        let shot = &plan.shots[i];
        if shot.keyed {
            return Some(None);
        }
        // A glide mixes in the pose before the shot: no form here bounds it.
        if shot.glide.is_some_and(|g| a < shot.start + g) {
            return None;
        }
        let monotone = matches!(
            shot.ease,
            Ease::Linear | Ease::InCubic | Ease::OutCubic | Ease::InOutCubic
        );
        Some(Some((shot.moves.clone(), monotone)))
    }

    /// A box certain to hold the eye over the flicks `[a, b]`, from the interval forms of what
    /// writes it, `bound` the program with each control held to the range it's bounded over;
    /// `None` where no form bounds it.
    fn eye_box(&self, bound: &Program, a: i64, b: i64) -> Option<[Iv; 3]> {
        let at = |t| self.pose(t).map(|p| p.eye);
        let hull = |p: V3, q: V3| -> [Iv; 3] {
            std::array::from_fn(|k| Iv::new(p[k].min(q[k]), p[k].max(q[k])))
        };
        match self.move_over(a, b)? {
            None => {}
            // The eye holds still under these moves.
            Some((Move::Hold | Move::Shake | Move::Pan | Move::LensZoom, _)) => {
                let (p, q) = (at(a)?, at(b)?);
                return (p == q).then(|| hull(p, q));
            }
            // It slides along a line, monotone in an eased share of the move.
            Some((Move::Push | Move::Pull | Move::LogZoom, true)) => {
                return Some(hull(at(a)?, at(b)?))
            }
            Some(_) => return None,
        }
        let eye = self.eye?;
        let (sa, sb) = (self.state(a), self.state(b));
        let secs = Iv::new(a as f64 / F, b as f64 / F);
        let mut out = [Iv::point(0.0); 3];
        for (k, src) in eye.iter().enumerate() {
            out[k] = match *src {
                Src::Fixed(v) => Iv::point(v),
                Src::Slot(s) if self.program.time_only(s) => {
                    self.program
                        .slot_window(s, a, b, sa.slots[s], sb.slots[s])?
                }
                Src::Slot(s) => bound.slot_bound_over(s, secs)?,
            };
            if !out[k].is_bounded() {
                return None;
            }
        }
        // A parent that moves the camera moves its eye too: no form here follows it.
        if self
            .program
            .writes(self.cam_item * TRANSFORM..(self.cam_item + 1) * TRANSFORM)
        {
            return None;
        }
        Some(out)
    }

    /// What the camera's param at `path` (a one-wide field, such as `view_width`) holds over the
    /// flicks `[a, b]`: its slot's window or driver bound, or its value where nothing writes it.
    fn param_bound(&self, bound: &Program, path: &[&str], a: i64, b: i64) -> Option<Iv> {
        let written = self.program.fields.iter().find(|f| {
            f.item == Some(self.cam_item)
                && f.written
                && f.width == 1
                && f.path.iter().map(String::as_str).eq(path.iter().copied())
        });
        let Some(f) = written else {
            let (p, q) = (self.pose(a)?, self.pose(b)?);
            return (p.width == q.width).then(|| Iv::point(p.width));
        };
        let s = f.slot;
        let iv = if self.program.time_only(s) {
            let (sa, sb) = (self.state(a), self.state(b));
            self.program
                .slot_window(s, a, b, sa.slots[s], sb.slots[s])?
        } else {
            bound.slot_bound_over(s, Iv::new(a as f64 / F, b as f64 / F))?
        };
        iv.is_bounded().then_some(iv)
    }

    /// The camera's target over `[a, b]` where it holds still: nothing writes it and the pose
    /// at both ends aims at one point.
    fn still_target(&self, a: i64, b: i64) -> Option<V3> {
        let writes = self.program.fields.iter().any(|f| {
            f.item == Some(self.cam_item)
                && f.written
                && f.path.get(1).is_some_and(|p| p == "target" || p == "orbit")
        });
        let (p, q) = (self.pose(a)?, self.pose(b)?);
        let keeps = match self.move_over(a, b)? {
            None => !writes,
            Some((m, _)) => matches!(
                m,
                Move::Hold | Move::Push | Move::Pull | Move::LogZoom | Move::LensZoom
            ),
        };
        (keeps && p.target == q.target).then_some(p.target)
    }

    /// Whether anything but the camera moves: the solids then differ from time to time.
    fn others_move(&self) -> bool {
        (0..self.program.items.len())
            .filter(|&i| i != self.cam_item)
            .any(|i| {
                self.program.writes(i * TRANSFORM..(i + 1) * TRANSFORM)
                    || self
                        .program
                        .fields
                        .iter()
                        .any(|f| f.item == Some(i) && f.written)
            })
    }

    /// How far any solid can move over the flicks `[a, b]`: each moving item's position spread
    /// plus its turn's spread (rad) times `extent`, summed, so a part a moving parent carries is
    /// held too; `None` where no form bounds a mover, or a solid's own params change.
    fn others_reach(&self, a: i64, b: i64, extent: f64, solids: &[String]) -> Option<f64> {
        let (sa, sb) = (self.state(a), self.state(b));
        let window = |s: usize| {
            self.program
                .slot_window(s, a, b, sa.slots[s], sb.slots[s])
                .filter(Iv::is_bounded)
                .map(|iv| iv.width())
        };
        let mut total = 0.0;
        for (i, id) in self.program.items.iter().enumerate() {
            if i == self.cam_item {
                continue;
            }
            let draws = solids.iter().any(|s| is_of(s, id));
            if draws
                && self
                    .program
                    .fields
                    .iter()
                    .any(|f| f.item == Some(i) && f.written)
            {
                return None;
            }
            let base = i * TRANSFORM;
            if !self.program.writes(base..base + TRANSFORM) {
                continue;
            }
            if self.program.writes(base + 6..base + 9) {
                return None;
            }
            let p: Vec<f64> = (0..3).map(|k| window(base + k)).collect::<Option<_>>()?;
            let r: f64 = (0..3).map(|k| window(base + 3 + k)).sum::<Option<f64>>()?;
            total += sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) + r.to_radians() * extent;
        }
        Some(total)
    }

    /// Each key of a channel that writes the camera's params: its channel, its ID and its time,
    /// with whether it holds or steps.
    fn keys(&self) -> Vec<(String, String, i64, bool)> {
        let prefix = format!("items/{}/params/", self.cam);
        let mut out = Vec::new();
        for (cid, c) in self
            .doc
            .get("channels")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if !c["target"].as_str().is_some_and(|t| t.starts_with(&prefix)) {
                continue;
            }
            for (kid, k) in c
                .get("keys")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                let Some(t) = k.get("t").and_then(flicks) else {
                    continue;
                };
                let interp = k.get("interp").and_then(Value::as_str).unwrap_or("");
                out.push((
                    cid.clone(),
                    kid.clone(),
                    t,
                    matches!(interp, "hold" | "step"),
                ));
            }
        }
        out.sort_by_key(|k| k.2);
        out
    }
}

/// `doc` with each slider-like control held to `[lo, hi]` around its value, `swept` (a control
/// and its stretch) to that stretch: the program a bound over that setting is read from.
pub(crate) fn held(doc: &Value, swept: Option<(&str, f64, f64)>) -> Value {
    let mut out = doc.clone();
    if let Some(cs) = out.get_mut("controls").and_then(Value::as_object_mut) {
        for (id, c) in cs.iter_mut() {
            let kind = c.get("kind").and_then(Value::as_str).unwrap_or("slider");
            if matches!(kind, "toggle" | "choice" | "stages" | "transport") {
                continue;
            }
            let Some(v) = c.get("default").and_then(Value::as_f64) else {
                continue;
            };
            let (lo, hi) = match swept {
                Some((s, lo, hi)) if s == id => (lo, hi),
                _ => {
                    let e = 1e-12 * v.abs().max(1.0);
                    (v - e, v + e)
                }
            };
            if let Some(m) = c.as_object_mut() {
                m.insert("range".into(), json!([lo, hi]));
                m.insert("default".into(), json!(lo.max(v.min(hi))));
            }
        }
    }
    out
}

/// The least distance that keeps solids out of the near plane and the space before it:
/// √(n² + h²) for a near plane `n` out with half-diagonal `h` (the planted program: `h` alone).
fn auto_clearance(scene: &Scene, half_only: bool) -> Option<f64> {
    let cam = &scene.camera;
    if !cam.perspective || cam.scale <= 0.0 {
        return None;
    }
    let n = cam.near;
    let [w, h] = cam.size;
    let half = n * sqrt((w / 2.0) * (w / 2.0) + (h / 2.0) * (h / 2.0)) / cam.scale;
    Some(if half_only {
        half
    } else {
        sqrt(n * n + half * half)
    })
}

/// The owner item of a solid's ID.
fn owner(id: &str) -> String {
    id.split('#').next().unwrap_or(id).to_string()
}

fn dist(a: V3, b: V3) -> f64 {
    let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
}

/// `doc` with control `id` at `value`, written where it binds as a session draws it (Control:
/// `binds`): a toggle writes its range's (or options') entry for off and on.
pub(crate) fn with_control(doc: &Value, id: &str, value: &Value) -> Value {
    let mut out = scene::with_set(doc, &format!("controls/{id}/default"), value.clone());
    let c = &doc["controls"][id];
    let v = match c["kind"].as_str() {
        Some("toggle") => {
            let on = value
                .as_bool()
                .unwrap_or_else(|| value.as_f64().is_some_and(|x| x >= 0.5));
            ["range", "options"]
                .iter()
                .find_map(|k| {
                    c[*k]
                        .as_array()
                        .and_then(|a| a.get(usize::from(on)))
                        .cloned()
                })
                .unwrap_or(json!(on))
        }
        _ => value.clone(),
    };
    for b in c["binds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        deep_canvas::document::variants::set_path(&mut out, b, v.clone());
    }
    out
}

/// The document at control value `v` (or as it is).
fn at_control(doc: &Value, control: Option<(&str, f64)>) -> Value {
    match control {
        Some((id, v)) => with_control(doc, id, &json!(v)),
        None => doc.clone(),
    }
}

/// The clearance search over one shot: its samples, then each span between them (or, under a
/// sweep, the shot over each stretch of the control's values) bounded, and halved until its
/// bound clears the limit or a point inside falls short of it.
struct Clearance<'a> {
    limit: f64,
    shot: Option<String>,
    /// The document as checked, its camera, and its program with each control held.
    doc: &'a Value,
    rig: &'a Rig<'a>,
    bound: &'a Program,
    input: &'a Value,
    /// The swept control, if any.
    control: Option<&'a str>,
    /// The solids where nothing but the camera moves; else each time's are evaluated.
    still: Option<&'a Occluders<'a>>,
    worst: Option<Reading>,
    estimates: Vec<Value>,
}

impl Clearance<'_> {
    /// The nearest solid to the eye at `t` with the control at `v`: its distance and owner.
    fn point(&self, t: i64, v: Option<f64>) -> Option<(f64, String)> {
        let eye = match (self.control, v) {
            (Some(c), Some(v)) => Rig::new(&at_control(self.doc, Some((c, v))))?.pose(t)?.eye,
            _ => self.rig.pose(t)?.eye,
        };
        let near = |idx: &Occluders<'_>| {
            idx.nearest(eye, f64::INFINITY)
                .map(|(solid, d)| (d, owner(&solid.id)))
        };
        match self.still {
            Some(idx) => near(idx),
            None => {
                let doc = at_control(self.doc, self.control.zip(v));
                let s = scene::evaluate(&doc, self.input, t.max(0), crate::framing::KIND).ok()?;
                near(&Occluders::of(&s, |_| true))
            }
        }
    }

    fn note(&mut self, t: i64, v: Option<f64>, d: f64, item: String) {
        let better = self.worst.as_ref().is_none_or(|w| {
            d < w.value - 1e-9
                || ((d - w.value).abs() <= 1e-9
                    && (t, v.unwrap_or(0.0)) < (w.t, w.at.unwrap_or(0.0)))
        });
        if better {
            self.worst = Some(Reading {
                shot: self.shot.clone(),
                t,
                measure: "clearance",
                item,
                value: d,
                limit: self.limit,
                fails: d < self.limit,
                key: None,
                at: v,
            });
        }
    }

    /// Where the distance dips deepest over `[lo, hi]`, by golden sections: along time with the
    /// control at `fixed`, or along the control's values at time `fixed`.
    fn deepest(&mut self, lo: f64, hi: f64, along_t: bool, fixed: Option<f64>) {
        const R: f64 = 0.618_033_988_749_894_8;
        let at = |x: f64| -> (i64, Option<f64>) {
            if along_t {
                (x.round() as i64, fixed)
            } else {
                (fixed.unwrap_or(0.0) as i64, Some(x))
            }
        };
        let eval = |me: &Self, x: f64| {
            let (t, v) = at(x);
            me.point(t, v)
        };
        let (mut a, mut b) = (lo, hi);
        let (mut c, mut d) = (b - R * (b - a), a + R * (b - a));
        let (mut fc, mut fd) = (eval(self, c), eval(self, d));
        let tol = if along_t { 1.0 } else { 1e-9 };
        while (b - a).abs() > tol {
            let (Some(x), Some(y)) = (&fc, &fd) else {
                return;
            };
            if x.0 <= y.0 {
                (b, d, fd) = (d, c, fc);
                c = b - R * (b - a);
                fc = eval(self, c);
            } else {
                (a, c, fc) = (c, d, fd);
                d = a + R * (b - a);
                fd = eval(self, d);
            }
        }
        let (t, v) = at((a + b) / 2.0);
        if let Some((dd, item)) = self.point(t, v) {
            self.note(t, v, dd, item);
        }
    }

    /// Settles `[a, b]` × `[va, vb]`; false when it found a failure or left an estimate.
    fn region(&mut self, a: i64, b: i64, vs: Option<(f64, f64)>, depth: u32) -> bool {
        // What a control writes where it binds has no interval form here: only sampled.
        let binds = self.control.is_some_and(|c| {
            self.doc["controls"][c]["binds"]
                .as_array()
                .is_some_and(|b| !b.is_empty())
        });
        if binds {
            self.estimate(a, b, vs);
            return false;
        }
        let doc: Value;
        let swept;
        let (rig, bound) = match (self.control, vs) {
            (Some(c), Some((x, y))) => {
                doc = at_control(self.doc, Some((c, (x + y) / 2.0)));
                let held_doc = held(&doc, Some((c, x, y)));
                match (
                    Rig::new(&doc),
                    held_doc.as_object().and_then(|m| Program::compile(m).ok()),
                ) {
                    (Some(r), Some(p)) => {
                        swept = (r, p);
                        (&swept.0, &swept.1)
                    }
                    _ => {
                        self.estimate(a, b, vs);
                        return false;
                    }
                }
            }
            _ => (self.rig, self.bound),
        };
        let Some(bx) = rig.eye_box(bound, a, b) else {
            self.estimate(a, b, vs);
            return false;
        };
        let centre: V3 = std::array::from_fn(|k| (bx[k].lo + bx[k].hi) / 2.0);
        let half = sqrt((0..3).map(|k| (bx[k].width() / 2.0).powi(2)).sum::<f64>());
        // The solids where they stand at the span's start, and how far any of them can move.
        let near_reach = match self.still {
            Some(idx) => Some((
                idx.nearest(centre, f64::INFINITY)
                    .map_or(f64::INFINITY, |(_, d)| d),
                0.0,
            )),
            None => {
                let doc = at_control(self.doc, self.control.zip(vs.map(|(x, y)| (x + y) / 2.0)));
                scene::evaluate(&doc, self.input, a.max(0), crate::framing::KIND)
                    .ok()
                    .and_then(|s| {
                        let idx = Occluders::of(&s, |_| true);
                        let ids: Vec<String> = s
                            .layers
                            .iter()
                            .flat_map(|l| &l.solids)
                            .map(|x| x.id.clone())
                            .collect();
                        let reach = rig.others_reach(a, b, idx.extent(), &ids)?;
                        Some((
                            idx.nearest(centre, f64::INFINITY)
                                .map_or(f64::INFINITY, |(_, d)| d),
                            reach,
                        ))
                    })
            }
        };
        let Some((near, reach)) = near_reach else {
            self.estimate(a, b, vs);
            return false;
        };
        if near - half - reach >= self.limit {
            return true;
        }
        // The middle point: a failure there ends the search.
        let tm = a + (b - a) / 2;
        let vm = vs.map(|(x, y)| (x + y) / 2.0);
        if let Some((d, item)) = self.point(tm, vm) {
            self.note(tm, vm, d, item);
            if d < self.limit {
                match vs {
                    Some((x, y)) => self.deepest(x, y, false, Some(tm as f64)),
                    None => self.deepest(a as f64, b as f64, true, None),
                }
                return false;
            }
        }
        if depth >= DEPTH {
            self.estimate(a, b, vs);
            return false;
        }
        match vs {
            Some((x, y)) if y - x > 1e-9 => {
                let m = (x + y) / 2.0;
                self.region(a, b, Some((x, m)), depth + 1)
                    && self.region(a, b, Some((m, y)), depth + 1)
            }
            _ if b - a > 1 => {
                self.region(a, tm, vs, depth + 1) && self.region(tm, b, vs, depth + 1)
            }
            _ => true,
        }
    }

    fn estimate(&mut self, a: i64, b: i64, vs: Option<(f64, f64)>) {
        let mut e = json!({"measure": "clearance", "shot": self.shot, "span": [a, b]});
        if let (Some(c), Some((x, y))) = (self.control, vs) {
            e["sweep"] = json!({"control": c, "from": x, "to": y});
        }
        self.estimates.push(e);
    }
}

/// How a span settled: its bound stayed within the limit, a time inside read past it, or no
/// bound decided it within the depth (an estimate).
enum Settled {
    Within,
    Past(i64, f64),
    Estimate,
}

/// Settles `[a, b]` for a measure whose most over a span `most` bounds and whose value at a time
/// `at` reads: halved, its middle read, until the bound stays within `limit` or a reading passes
/// it.
fn settle(
    a: i64,
    b: i64,
    depth: u32,
    limit: f64,
    most: &dyn Fn(i64, i64) -> Option<f64>,
    at: &dyn Fn(i64) -> Option<f64>,
) -> Settled {
    match most(a, b) {
        Some(m) if m <= limit => return Settled::Within,
        None => return Settled::Estimate,
        _ => {}
    }
    let m = a + (b - a) / 2;
    if let Some(v) = at(m).filter(|v| *v > limit) {
        return Settled::Past(m, v);
    }
    if depth >= DEPTH || b - a <= 1 {
        return Settled::Estimate;
    }
    match settle(a, m, depth + 1, limit, most, at) {
        Settled::Within => settle(m, b, depth + 1, limit, most, at),
        other => other,
    }
}

/// The times one shot is sampled at: every 1/rate s from its start, its end, and every key in it.
fn samples(start: i64, end: i64, rate: i64, keys: &[(String, String, i64, bool)]) -> Vec<i64> {
    let mut out = scene::sampled(&[(start, end)], rate);
    out.extend(
        keys.iter()
            .map(|k| k.2)
            .filter(|t| (start..=end).contains(t)),
    );
    out.sort_unstable();
    out.dedup();
    out
}

/// The camera path measures of `doc` over each shot, or over the checked `times` where there is
/// none. Under a sweep's `stretch` (a control and two of its values), only clearance is measured,
/// bounded over the stretch.
pub(crate) fn measure(
    doc: &Value,
    input: &Value,
    o: &Opts,
    keep: &[String],
    times: &[i64],
    stretch: Option<(&str, f64, f64)>,
) -> Found {
    let mut found = Found::default();
    let Some(rig) = Rig::new(doc) else {
        return found;
    };
    let Some(bound) = held(doc, None)
        .as_object()
        .and_then(|m| Program::compile(m).ok())
    else {
        return found;
    };
    let keys = rig.keys();
    let shots: Vec<(Option<String>, i64, i64)> = match rig.shots() {
        s if s.is_empty() => times.iter().map(|&t| (None, t, t)).collect(),
        s => s.into_iter().map(|(id, a, b)| (Some(id), a, b)).collect(),
    };
    let first = shots.first().map_or(0, |s| s.1).max(0);
    let flat = scene::evaluate(doc, input, first, crate::framing::KIND).ok();
    let moving = rig.others_move();
    let still = flat
        .as_ref()
        .filter(|_| !moving)
        .map(|s| Occluders::of(s, |_| true));
    // Clearance, in 3D through a perspective camera.
    let limit = flat
        .as_ref()
        .and_then(|s| auto_clearance(s, o.half_diagonal).map(|auto| o.clearance.unwrap_or(auto)));
    if let Some(limit) = limit {
        for (shot, start, end) in &shots {
            let ts = samples(*start, *end, o.rate, &keys);
            let mut c = Clearance {
                limit,
                shot: shot.clone(),
                doc,
                rig: &rig,
                bound: &bound,
                input,
                control: stretch.map(|s| s.0),
                still: still.as_ref(),
                worst: None,
                estimates: Vec::new(),
            };
            if let Some((_, x, y)) = stretch {
                if !o.sweep_samples_only {
                    c.region(*start, (*end).max(*start + 1), Some((x, y)), 0);
                }
            } else {
                for &t in &ts {
                    if let Some((d, item)) = c.point(t, None) {
                        c.note(t, None, d, item);
                    }
                }
                if c.worst.as_ref().is_some_and(|w| w.fails) {
                    // The deepest point about the worst sample.
                    let t = c.worst.as_ref().map_or(0, |w| w.t);
                    let step = (F / o.rate as f64) as i64;
                    c.deepest(
                        (t - step).max(*start) as f64,
                        (t + step).min(*end) as f64,
                        true,
                        None,
                    );
                } else if !o.sampled_only {
                    for w in ts.windows(2) {
                        let settled = c.region(w[0], w[1], None, 0);
                        if !settled && c.worst.as_ref().is_some_and(|w| w.fails) {
                            break;
                        }
                    }
                }
            }
            // Under a stretch only a failure is a reading of its own: the samples read the rest.
            found
                .readings
                .extend(c.worst.filter(|w| stretch.is_none() || w.fails));
            found.estimates.extend(c.estimates);
        }
    }
    if stretch.is_some() {
        return found;
    }
    corners(&rig, &shots, o, &keys, &mut found);
    raster(doc, input, &rig, &bound, &shots, o, &keys, &mut found);
    if flat.as_ref().is_some_and(|s| s.dof.is_some()) {
        focus(
            doc, input, &rig, &bound, &shots, o, keep, &keys, moving, &mut found,
        );
    }
    found
}

/// corners: at each key inside a shot, the eye's velocity and the aim's turning rate on either
/// side; a jump over a tenth of the shot's mean, or over 0.01 m/s and 0.5°/s in a shot that
/// barely moves, fails, except at a hold key.
fn corners(
    rig: &Rig<'_>,
    shots: &[(Option<String>, i64, i64)],
    o: &Opts,
    keys: &[(String, String, i64, bool)],
    found: &mut Found,
) {
    if !o.corners {
        return;
    }
    let d = (F / 1000.0) as i64;
    for (shot, start, end) in shots.iter().filter(|s| s.0.is_some()) {
        let ts = samples(*start, *end, o.rate, keys);
        let poses: Vec<Pose> = ts.iter().filter_map(|&t| rig.pose(t)).collect();
        let span = (end - start) as f64 / F;
        let speed = poses
            .windows(2)
            .map(|w| dist(w[0].eye, w[1].eye))
            .sum::<f64>()
            / span;
        let turn = poses.windows(2).map(|w| angle(w[0], w[1])).sum::<f64>() / span;
        let mut worst: Option<Reading> = None;
        for (cid, kid, t, hold) in keys {
            if *hold || *t <= *start + d || *t >= *end - d {
                continue;
            }
            let (Some(p0), Some(p1), Some(p2)) = (rig.pose(t - d), rig.pose(*t), rig.pose(t + d))
            else {
                continue;
            };
            let s = d as f64 / F;
            let v0: V3 = std::array::from_fn(|k| (p1.eye[k] - p0.eye[k]) / s);
            let v1: V3 = std::array::from_fn(|k| (p2.eye[k] - p1.eye[k]) / s);
            let jump = dist(v0, v1);
            let aim = (angle(p1, p2) - angle(p0, p1)).abs() / s;
            let fails = if speed >= 0.01 || turn >= 0.5 {
                jump > 0.1 * speed.max(0.01) || aim > 0.1 * turn.max(0.5)
            } else {
                jump > 0.01 || aim > 0.5
            };
            let r = Reading {
                shot: shot.clone(),
                t: *t,
                measure: "corners",
                item: rig.cam.clone(),
                value: jump,
                limit: 0.1 * speed,
                fails,
                key: Some((cid.clone(), kid.clone())),
                at: None,
            };
            if worst
                .as_ref()
                .is_none_or(|w| (r.fails, r.value) > (w.fails, w.value))
            {
                worst = Some(r);
            }
        }
        found.readings.extend(worst);
    }
}

/// The angle in degrees between two poses' aims.
fn angle(a: Pose, b: Pose) -> f64 {
    let unit = |p: Pose| -> V3 {
        let d: V3 = std::array::from_fn(|k| p.target[k] - p.eye[k]);
        let l = sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        if l > 0.0 {
            d.map(|x| x / l)
        } else {
            [0.0, 0.0, 1.0]
        }
    };
    let (u, v) = (unit(a), unit(b));
    deg(acos(
        (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).clamp(-1.0, 1.0),
    ))
}

/// A PNG's width and height in px, from its header.
fn png_size(bytes: &[u8]) -> Option<[f64; 2]> {
    if bytes.len() < 24 || &bytes[1..4] != b"PNG" {
        return None;
    }
    let be =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    Some([f64::from(be(16)), f64::from(be(20))])
}

#[allow(clippy::too_many_arguments)]
/// raster_max: each image or video in frame, its export px per source px, from the view width
/// the camera shows and the picture's own pixels; bounded between samples by the view width's
/// range where the shot holds or zooms monotonely.
fn raster(
    doc: &Value,
    input: &Value,
    rig: &Rig<'_>,
    bound: &Program,
    shots: &[(Option<String>, i64, i64)],
    o: &Opts,
    keys: &[(String, String, i64, bool)],
    found: &mut Found,
) {
    let size: Vec<f64> = doc
        .get("size")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let [Some(&fw), Some(&fh)] = [size.first(), size.get(1)] else {
        return;
    };
    let export = o.width.unwrap_or(fw);
    let pictures: Vec<(String, [f64; 4], f64)> = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| matches!(i["kind"].as_str(), Some("image@1" | "video@1")))
        .filter_map(|(id, i)| {
            let b: Vec<f64> = i
                .pointer("/params/box")?
                .as_array()?
                .iter()
                .filter_map(Value::as_f64)
                .collect();
            let sha = i.pointer("/params/asset").and_then(Value::as_str)?;
            let bytes = input
                .pointer(&format!("/assets/{sha}"))
                .and_then(Value::as_str)
                .and_then(deep_canvas::base64::decode)?;
            let [sw, _] = png_size(&bytes)?;
            (b.len() == 4 && b[2] > 0.0 && sw > 0.0)
                .then(|| (id.clone(), [b[0], b[1], b[2], b[3]], sw / b[2]))
        })
        .collect();
    if pictures.is_empty() {
        return;
    }
    for (shot, start, end) in shots {
        let ts = samples(*start, *end, o.rate, keys);
        for (id, b, per_u) in &pictures {
            let mut worst: Option<Reading> = None;
            for &t in &ts {
                let Some(p) = rig.pose(t) else { continue };
                if p.width <= 0.0 {
                    continue;
                }
                let vh = p.width * fh / fw;
                let inside = b[0] < p.target[0] + p.width / 2.0
                    && b[0] + b[2] > p.target[0] - p.width / 2.0
                    && b[1] < p.target[1] + vh / 2.0
                    && b[1] + b[3] > p.target[1] - vh / 2.0;
                if !inside {
                    continue;
                }
                let value = export / p.width / per_u;
                if worst.as_ref().is_none_or(|w| value > w.value + 1e-12) {
                    worst = Some(Reading {
                        shot: shot.clone(),
                        t,
                        measure: "raster_max",
                        item: id.clone(),
                        value,
                        limit: o.raster_max,
                        fails: value > o.raster_max,
                        key: None,
                        at: None,
                    });
                }
            }
            found.readings.extend(worst);
        }
        // Between samples: a hold or a monotone zoom is bounded by its samples; a keyed view
        // width by its own interval form, halved until it decides.
        if !o.sampled_only {
            for w in ts.windows(2) {
                let monotone = matches!(
                    rig.move_over(w[0], w[1]),
                    Some(Some((
                        Move::Hold
                            | Move::Shake
                            | Move::Pan
                            | Move::Push
                            | Move::Pull
                            | Move::LogZoom,
                        true
                    )))
                );
                if monotone {
                    continue;
                }
                for (id, _, per_u) in &pictures {
                    let most = |a: i64, b: i64| {
                        rig.move_over(a, b)?
                            .is_none()
                            .then(|| rig.param_bound(bound, &["params", "view_width"], a, b))
                            .flatten()
                            .filter(|vw| vw.lo > 0.0)
                            .map(|vw| export / vw.lo / per_u)
                    };
                    let at = |t: i64| {
                        rig.pose(t)
                            .filter(|p| p.width > 0.0)
                            .map(|p| export / p.width / per_u)
                    };
                    match settle(w[0], w[1], 0, o.raster_max, &most, &at) {
                        Settled::Within => {}
                        Settled::Past(t, value) => found.readings.push(Reading {
                            shot: shot.clone(),
                            t,
                            measure: "raster_max",
                            item: id.clone(),
                            value,
                            limit: o.raster_max,
                            fails: true,
                            key: None,
                            at: None,
                        }),
                        Settled::Estimate => found.estimates.push(
                            json!({"measure": "raster_max", "shot": shot, "span": [w[0], w[1]]}),
                        ),
                    }
                }
            }
        }
    }
}

/// What the depth of field reads at a time: each kept item's centre, the CoC's `k` and focus
/// distance, and an orthographic view's own CoC where it is one.
type Lens = (Vec<Option<V3>>, f64, f64, bool, f64);

/// focus_coc_max: the circle of confusion at each kept item's centre, from the lens in closed
/// form at its evaluated depth, read at each sample; between samples bounded from the box that
/// holds the eye and a still target, the depth's interval through them, and the lens and focus
/// held (no channel or driver writes them), halved until the bound decides.
#[allow(clippy::too_many_arguments)]
fn focus(
    doc: &Value,
    input: &Value,
    rig: &Rig<'_>,
    bound: &Program,
    shots: &[(Option<String>, i64, i64)],
    o: &Opts,
    keep: &[String],
    keys: &[(String, String, i64, bool)],
    moving: bool,
    found: &mut Found,
) {
    // Each kept item's centre and the dof's `k` and focus at `t`.
    let read = |t: i64| -> Option<Lens> {
        let posed = deep_canvas_motion::shots::posed(doc, t);
        let s = scene::evaluate(
            posed.as_ref().unwrap_or(doc),
            input,
            t.max(0),
            crate::framing::KIND,
        )
        .ok()?;
        let dof = s.dof.as_ref()?;
        let centres = keep
            .iter()
            .map(|id| {
                let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
                for solid in s
                    .layers
                    .iter()
                    .flat_map(|l| &l.solids)
                    .filter(|x| !x.cast_only && is_of(&x.id, id))
                {
                    for p in deep_canvas_scene3d::shore::triangles(solid)
                        .iter()
                        .flatten()
                    {
                        for j in 0..3 {
                            lo[j] = lo[j].min(p[j]);
                            hi[j] = hi[j].max(p[j]);
                        }
                    }
                }
                lo[0]
                    .is_finite()
                    .then(|| std::array::from_fn(|j| (lo[j] + hi[j]) / 2.0))
            })
            .collect();
        Some((centres, dof.k, dof.focus, dof.orthographic, dof.ortho_coc))
    };
    let coc = |t: i64, k: usize| -> Option<f64> {
        let (centres, kk, s, ortho, oc) = read(t)?;
        if ortho {
            return Some(oc);
        }
        let c = centres[k]?;
        let p = rig.pose(t)?;
        let f: V3 = std::array::from_fn(|j| p.target[j] - p.eye[j]);
        let l = sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
        let d = (0..3).map(|j| (c[j] - p.eye[j]) * f[j] / l).sum::<f64>();
        (d > 0.0).then(|| kk * (d - s).abs() / d)
    };
    // Whether a channel or driver writes the lens, the aperture, the field of view or the dof.
    let optics_move = ["channels", "drivers"].iter().any(|k| {
        doc[*k].as_object().into_iter().flatten().any(|(_, c)| {
            c["target"].as_str().is_some_and(|t| {
                ["/dof", "/lens", "/aperture", "/fov", "/view_width"]
                    .iter()
                    .any(|x| t.contains(x))
            })
        })
    });
    for (shot, start, end) in shots {
        let ts = samples(*start, *end, o.rate, keys);
        let still = !moving && ts.windows(2).all(|w| rig.pose(w[0]) == rig.pose(w[1]));
        let read_at: Vec<i64> = if still {
            ts.iter().take(1).copied().collect()
        } else {
            ts.clone()
        };
        let mut worst: Vec<Option<Reading>> = vec![None; keep.len()];
        let note = |worst: &mut Vec<Option<Reading>>, k: usize, t: i64, value: f64| {
            if worst[k].as_ref().is_none_or(|w| value > w.value + 1e-12) {
                worst[k] = Some(Reading {
                    shot: shot.clone(),
                    t,
                    measure: "focus_coc_max",
                    item: keep[k].clone(),
                    value,
                    limit: o.focus_coc_max,
                    fails: value > o.focus_coc_max,
                    key: None,
                    at: None,
                });
            }
        };
        for &t in &read_at {
            for k in 0..keep.len() {
                if let Some(v) = coc(t, k) {
                    note(&mut worst, k, t, v);
                }
            }
        }
        if !still && !o.sampled_only {
            for w in ts.windows(2) {
                for k in 0..keep.len() {
                    if worst[k].as_ref().is_some_and(|r| r.fails) {
                        continue;
                    }
                    // The most blur over a span: the depth's interval from the eye's box to the
                    // still centre along the aim at a still target, at its ends.
                    let most = |a: i64, b: i64| -> Option<f64> {
                        if moving || optics_move {
                            return None;
                        }
                        let (centres, kk, s, ortho, oc) = read(a)?;
                        if ortho {
                            return Some(oc);
                        }
                        let c = centres[k]?;
                        let (e, tg) = (rig.eye_box(bound, a, b)?, rig.still_target(a, b)?);
                        let u: [Iv; 3] = std::array::from_fn(|j| Iv::point(c[j]).sub(e[j]));
                        let v: [Iv; 3] = std::array::from_fn(|j| Iv::point(tg[j]).sub(e[j]));
                        let dot = (0..3).fold(Iv::point(0.0), |acc, j| acc.add(u[j].mul(v[j])));
                        let len = deep_canvas::interval::sqrt(
                            (0..3).fold(Iv::point(0.0), |acc, j| acc.add(v[j].sqr())),
                        );
                        if len.lo <= 0.0 {
                            return None;
                        }
                        let d = dot.div(len);
                        (d.lo > 0.0 && d.is_bounded())
                            .then(|| kk * (1.0 - s / d.lo).abs().max((1.0 - s / d.hi).abs()))
                    };
                    let at = |t: i64| coc(t, k);
                    match settle(w[0], w[1], 0, o.focus_coc_max, &most, &at) {
                        Settled::Within => {}
                        Settled::Past(t, v) => note(&mut worst, k, t, v),
                        Settled::Estimate => {
                            found.estimates.push(json!({"measure": "focus_coc_max",
                            "shot": shot, "item": keep[k], "span": [w[0], w[1]]}))
                        }
                    }
                }
            }
        }
        found.readings.extend(worst.into_iter().flatten());
    }
}

/// The brief's sweeps the check input carries: each control with its values, a slider's spaced
/// evenly over its range, and whether between two values its range is continuous.
pub(crate) fn sweeps(doc: &Value, input: &Value) -> Vec<(String, Vec<Value>, bool)> {
    let Some(named) = input.get("sweeps").and_then(Value::as_object) else {
        return Vec::new();
    };
    let controls = doc.get("controls").and_then(Value::as_object);
    named
        .iter()
        .filter_map(|(id, samples)| {
            let c = controls?.get(id)?;
            let kind = c.get("kind").and_then(Value::as_str).unwrap_or("slider");
            match kind {
                "toggle" => Some((id.clone(), vec![json!(false), json!(true)], false)),
                "choice" | "stages" => {
                    let n = c
                        .get("options")
                        .or_else(|| c.get("stages"))
                        .and_then(Value::as_array)
                        .map_or(1, Vec::len);
                    Some((id.clone(), (0..n).map(|k| json!(k)).collect(), false))
                }
                _ => {
                    let r = c.get("range").and_then(Value::as_array)?;
                    let (lo, hi) = (r.first()?.as_f64()?, r.get(1)?.as_f64()?);
                    let n = samples.as_u64().unwrap_or(2).max(2) as usize;
                    let vs = (0..n)
                        .map(|k| json!(lo + (hi - lo) * k as f64 / (n - 1) as f64))
                        .collect();
                    Some((id.clone(), vs, true))
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    /// A box 3 m out under a 50 mm lens at f/1.4 focused at 3 m, and a camera a driver bobs
    /// 0.5 m along its view 15 times a second: at every 30 Hz sample it stands 3 m out, in focus.
    fn bobbing_focus() -> Value {
        json!({
            "format": 1, "profile": "scene", "size": [1920, 1080], "camera": "cam",
            "transport": {"span": "1s"},
            "shots": {"s": {"start": "0s", "end": "1s", "camera": "cam", "move": "hold", "keyed": true}},
            "drivers": {"bob": {"target": "items/cam/params/position/2",
                                "expr": "3 + 0.5 * sin(30 * pi * t)", "vars": {"t": "time"}}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "params": {"projection": "perspective",
                    "position": [0, 0, 3], "target": [0, 0, 0], "near": 0.05, "far": 100,
                    "lens": {"focal_length": 50, "sensor": [36, 24], "fit": "horizontal"},
                    "aperture": {"f_stop": 1.4, "blades": 0}}},
                "box": {"id": "box", "kind": "mark.box@1", "params": {"size": [0.4, 0.4, 0.4]},
                        "at": {"pos": [0, 0, 0]}},
                "fx": {"id": "fx", "kind": "effect@1", "params": {"kind": "dof", "dof": {"focus": 3,
                    "coc": "physical", "taps": 64, "rotate": "pixel_hash", "far_over_near": "refuse"}}}
            }
        })
    }

    fn focus(input: &Value) -> Vec<super::Reading> {
        let keep = ["box".to_string()];
        super::measure(
            &bobbing_focus(),
            input,
            &super::Opts::read(input),
            &keep,
            &[0],
            None,
        )
        .readings
        .into_iter()
        .filter(|r| r.measure == "focus_coc_max")
        .collect()
    }

    #[test]
    fn focus_is_bounded_between_samples() {
        let input = json!({"kind": "camera.framing", "keep": ["box"]});
        let read = focus(&input);
        let f = read.iter().find(|r| r.fails);
        // At 1/60 s the eye is 3.5 m out: 0.05² × 0.5 ÷ (1.4 × 3.5 × 2.95) m × 1920 px ÷ 36 mm
        // = 4.6 px, past 1.5, so the bound must find a failure there.
        let f = f.unwrap_or_else(|| panic!("no focus failure between samples: {read:?}"));
        assert!(
            (f.t as f64 / 705_600_000.0 - 1.0 / 60.0).abs() < 1.0 / 300.0,
            "{f:?}"
        );
        // The samples alone stand in focus: read only there, nothing fails.
        let planted =
            json!({"kind": "camera.framing", "keep": ["box"], "planted": super::PLANTED_SAMPLED});
        assert!(
            focus(&planted).iter().all(|r| !r.fails),
            "{:?}",
            focus(&planted)
        );
    }
}
