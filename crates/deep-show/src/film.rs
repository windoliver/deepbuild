//! A 2D film's shots in a frame (issue #493; canvas primitives: Shot, Transition, Transport's
//! reduced motion, Frame and group: parallax): the camera each shot writes, through the motion
//! module's compiled program, so a build without scene3d draws the same; the sides a transition
//! or a reduced-motion dissolve draws, each through its own camera and finished in its own look,
//! then blended as finished, display-referred pixels; and the film block an `eval` reports.

use std::sync::Arc;

use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas_marks::finish::{srgb_decode, srgb_encode, tone, ToneMap};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Planted, Program};
use deep_canvas_motion::shots::{At, Kind, Plan, Pose};
use serde_json::{json, Map, Value};
use vello_cpu::kurbo::Affine;

/// The motion module's compiled program for a session, where its document has one.
pub(crate) fn program_of(sched: &Scheduler<'_>, session: &DocSession) -> Option<Arc<Program>> {
    let v = session.value(sched, "motion.program", None)?;
    v.as_typed::<Arc<Program>>().map(|p| Arc::clone(&*p))
}

/// The plan of a 2D film with timeline shots, and the index of its document camera.
pub(crate) fn plan_of<'a>(program: &'a Program, doc: &Value) -> Option<(&'a Plan, usize)> {
    let plan = program.shots.as_deref().filter(|p| !p.shots.is_empty())?;
    let cam = plan.camera(doc.get("camera")?.as_str()?)?;
    plan.cameras[cam].flat.then_some((plan, cam))
}

/// One side a frame draws: its camera and the look it is finished in.
pub(crate) struct Side {
    pub pose: Pose,
    pub look: Option<String>,
}

/// How two sides blend: the incoming side's share, and the kind's shape.
pub(crate) enum Mix {
    Fade(f64),
    Dip(f64),
    Wipe { angle: f64, feather: f64, p: f64 },
    Push { angle: f64, p: f64 },
}

/// What a frame draws: one side, or two blended, and the side whose status marks draw on top.
pub(crate) struct Sides {
    pub sides: Vec<Side>,
    pub mix: Option<Mix>,
    pub status: usize,
}

fn at<'a>(reduced: bool, keyed: &'a dyn Fn(usize) -> Option<Pose>) -> At<'a> {
    At { reduced, planted: Planted::None, indexed: None, keyed }
}

/// The sides of the frame at t.
pub(crate) fn sides(program: &Program, doc: &Value, t: i64, reduced: bool) -> Option<Sides> {
    let (plan, cam) = plan_of(program, doc)?;
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    let keyed = |c: usize| plan.keyed_pose(c, program, &state);
    let at = at(reduced, &keyed);
    let look = |i: Option<usize>| i.and_then(|i| plan.shots[i].look.clone());
    // A transition's window draws both sides; under reduced motion all but a cut, a cross-fade
    // and a dip become cross-fades.
    for tr in &plan.transitions {
        if plan.shots[tr.from].camera != cam || t < tr.start || t >= tr.end {
            continue;
        }
        let p = tr.progress(t);
        let mix = match (&tr.kind, reduced) {
            (Kind::Cut | Kind::Whip { .. }, _) => continue,
            (Kind::Dip, _) => Mix::Dip(p),
            (Kind::Wipe { angle, feather }, false) => Mix::Wipe { angle: *angle, feather: *feather, p },
            (Kind::Push { angle }, false) => Mix::Push { angle: *angle, p },
            _ => Mix::Fade(p),
        };
        return Some(Sides {
            sides: vec![
                Side { pose: plan.side(tr.from, t, &at), look: look(Some(tr.from)) },
                Side { pose: plan.side(tr.to, t, &at), look: look(Some(tr.to)) },
            ],
            mix: Some(mix),
            status: usize::from(t >= tr.cut),
        });
    }
    let shown = plan.shown(cam, t, &at);
    let l = look(shown.shot);
    Some(match shown.dissolve {
        Some((mix, from, to)) => Sides {
            sides: vec![Side { pose: from, look: l.clone() }, Side { pose: to, look: l }],
            mix: Some(Mix::Fade(mix)),
            status: usize::from(mix >= 0.5),
        },
        None => Sides { sides: vec![Side { pose: shown.pose, look: l }], mix: None, status: 0 },
    })
}

/// A flat pose as the affine from the document's units to its pixels: the target at the frame's
/// centre, the view width across it, turned by the roll.
pub(crate) fn view(pose: &Pose, size: [f64; 2]) -> Affine {
    let k = size[0] / pose.view_width;
    Affine::translate((size[0] / 2.0, size[1] / 2.0))
        * Affine::rotate(pose.roll.to_radians())
        * Affine::scale(k)
        * Affine::translate((-pose.target[0], -pose.target[1]))
}

/// A look's tone map applied to finished sRGB pixels, as the look finishes a side.
pub(crate) fn finish(rgba: &mut [u8], map: ToneMap) {
    if map == ToneMap::None {
        return;
    }
    let mut seen: std::collections::HashMap<[u8; 3], [u8; 3]> = std::collections::HashMap::new();
    for px in rgba.chunks_exact_mut(4) {
        let key = [px[0], px[1], px[2]];
        let out = *seen.entry(key).or_insert_with(|| {
            let y = tone(map, key.map(|v| srgb_decode(f64::from(v) / 255.0)));
            y.map(|v| (srgb_encode(v).clamp(0.0, 1.0) * 255.0).round() as u8)
        });
        px[..3].copy_from_slice(&out);
    }
}

/// Two finished sides blended by `mix` (Transition), per 8-bit channel; `ink` is a dip's color.
pub(crate) fn blend(a: &[u8], b: &[u8], mix: &Mix, size: [u16; 2], ink: [u8; 3]) -> Vec<u8> {
    let (w, h) = (usize::from(size[0]), usize::from(size[1]));
    let lerp = |x: u8, y: u8, p: f64| (f64::from(x) + (f64::from(y) - f64::from(x)) * p).round() as u8;
    let mut out = vec![0u8; a.len()];
    // The share of the incoming side at a pixel, for the kinds that cover it by place.
    let along = |angle: f64| {
        let (c, s) = (angle.to_radians().cos(), angle.to_radians().sin());
        let ends = [(0.0, 0.0), (w as f64, 0.0), (0.0, h as f64), (w as f64, h as f64)].map(|(x, y)| x * c + y * s);
        let lo = ends.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = ends.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        (c, s, lo, hi - lo)
    };
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let (pa, pb) = (&a[i..i + 4], &b[i..i + 4]);
            let o = &mut out[i..i + 4];
            match *mix {
                Mix::Fade(p) => {
                    for c in 0..4 {
                        o[c] = lerp(pa[c], pb[c], p);
                    }
                }
                Mix::Dip(p) => {
                    let (from, to, q) = if p < 0.5 { (pa, None, p * 2.0) } else { (pb, Some(()), p * 2.0 - 1.0) };
                    for c in 0..3 {
                        o[c] = if to.is_none() { lerp(from[c], ink[c], q) } else { lerp(ink[c], from[c], q) };
                    }
                    o[3] = 255;
                }
                Mix::Wipe { angle, feather, p } => {
                    let (c, s, lo, len) = along(angle);
                    let at = ((x as f64 + 0.5) * c + (y as f64 + 0.5) * s - lo) / len;
                    let edge = p * len;
                    let d = at * len - edge;
                    let share = if feather > 0.0 {
                        (0.5 - d / feather).clamp(0.0, 1.0)
                    } else if d < 0.0 {
                        1.0
                    } else {
                        0.0
                    };
                    for k in 0..4 {
                        o[k] = if share == 1.0 { pb[k] } else if share == 0.0 { pa[k] } else { lerp(pa[k], pb[k], share) };
                    }
                }
                Mix::Push { angle, p } => {
                    // The incoming side slides in along the angle, the outgoing one ahead of it.
                    let (c, s, _, len) = along(angle);
                    let shift = p * len;
                    let (dx, dy) = ((shift * c).round() as i64, (shift * s).round() as i64);
                    let from = |sx: i64, sy: i64, img: &[u8]| -> Option<[u8; 4]> {
                        (sx >= 0 && sy >= 0 && (sx as usize) < w && (sy as usize) < h).then(|| {
                            let j = (sy as usize * w + sx as usize) * 4;
                            [img[j], img[j + 1], img[j + 2], img[j + 3]]
                        })
                    };
                    let (xi, yi) = (x as i64, y as i64);
                    let len_x = (len * c).round() as i64;
                    let len_y = (len * s).round() as i64;
                    let v = from(xi - dx, yi - dy, a).or_else(|| from(xi - dx + len_x, yi - dy + len_y, b)).unwrap_or([0, 0, 0, 255]);
                    o.copy_from_slice(&v);
                }
            }
        }
    }
    out
}

/// `over` composited over `under`: the status pass drawn once on the blended sides.
pub(crate) fn over(under: &mut [u8], over: &[u8]) {
    for (u, o) in under.chunks_exact_mut(4).zip(over.chunks_exact(4)) {
        let a = u32::from(o[3]);
        if a == 0 {
            continue;
        }
        for c in 0..3 {
            u[c] = ((u32::from(o[c]) * 255 + u32::from(u[c]) * (255 - a) + 127) / 255) as u8;
        }
        u[3] = 255;
    }
}

/// The film block an `eval` with `film` reports: each camera's pose, a reduced-motion cut's
/// dissolve, each parallax group's offset and each text's glyphs.
pub(crate) fn block(program: &Program, doc: &Value, t: i64, reduced: bool, glyphs: Map<String, Value>) -> Value {
    let Some(plan) = program.shots.as_deref() else {
        return json!({"cameras": {}, "dissolve": null, "parallax": {}, "glyphs": glyphs});
    };
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    let keyed = |c: usize| plan.keyed_pose(c, program, &state);
    let at = at(reduced, &keyed);
    let doc_cam = doc.get("camera").and_then(Value::as_str).and_then(|c| plan.camera(c));
    let mut cameras = Map::new();
    let mut dissolve = Value::Null;
    for (c, camera) in plan.cameras.iter().enumerate() {
        if camera.own.is_none() && plan.shot_at(c, t).is_none() {
            continue;
        }
        let shown = plan.shown(c, t, &at);
        let name = shown.shot.map(|s| plan.shots[s].id.as_str());
        cameras.insert(camera.id.clone(), shown.pose.to_json(name));
        if Some(c) == doc_cam {
            if let Some((mix, from, to)) = shown.dissolve {
                dissolve = json!({"mix": mix, "from": from.to_json(name), "to": to.to_json(name)});
            }
        }
    }
    let parallax: Map<String, Value> = plan
        .groups
        .iter()
        .filter_map(|g| Some((g.id.clone(), json!(plan.parallax(program, &g.id, t, reduced)?))))
        .collect();
    json!({"cameras": cameras, "dissolve": dissolve, "parallax": parallax, "glyphs": glyphs})
}

/// A 3D document with its envelope camera posed as its shots write it at t (Shot: a shot alone
/// writes its camera's pose), for the 3D frame; `None` when no timeline shot writes it.
pub(crate) fn posed(doc: &Value, t: i64) -> Option<Value> {
    let shots = doc.get("shots")?.as_object()?;
    if !shots.values().any(|s| s.get("start").is_some()) {
        return None;
    }
    let program = Program::compile(doc.as_object()?).ok()?;
    let plan = program.shots.as_deref()?;
    let id = doc.get("camera")?.as_str()?;
    let cam = plan.camera(id)?;
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    let keyed = |c: usize| plan.keyed_pose(c, &program, &state);
    let pose = plan.shown(cam, t, &at(false, &keyed)).pose;
    let mut out = doc.clone();
    let params = out.pointer_mut(&format!("/items/{id}/params"))?.as_object_mut()?;
    for k in ["orbit", "view_width", "kick"] {
        params.remove(k);
    }
    params.insert("position".into(), json!(pose.position));
    params.insert("target".into(), json!(pose.target));
    params.insert("roll".into(), json!(pose.roll));
    if pose.perspective() {
        params.insert("fov".into(), json!(pose.fov));
    } else {
        params.insert("view_width".into(), json!(pose.view_width));
    }
    Some(out)
}
