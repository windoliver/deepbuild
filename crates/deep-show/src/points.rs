//! #540 (canvas primitives: Control: point): a point control in a panel. A press of one of its
//! buttons writes a press entry, a path drag one move a cell entered (or a `spacing` moved on the
//! ground), and the release a release entry, each computed once, at the gesture, from what the
//! panel shows then: a 2D cell through the inverse of the 2D camera, or in 3D the ray from the
//! viewer's camera through the pointer, met with a level plane, a terrain plate's height samples
//! or a target's drawn surface on the CPU (`deep_canvas_scene3d::pointer`), with the target the
//! object-ID target names within the control's margin. A drag with the control's buttons is the
//! control's, never the camera's. The entries are stored, so no replay computes them again;
//! `world` bakes a scene's world on the track as the hub holds it, and `match` runs every copy
//! of a lockstep match on it.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_canvas::camera::{Pose, Projector, FLICKS_PER_SECOND};
use deep_canvas::scope::Event;
use deep_canvas_input::point::{self as control, Drag, On, Point};
use deep_canvas_marks::atlas;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::pointer::{self, Ground, Ray};
use deep_canvas_scene3d::scene::{evaluate_with, placed_at, Labels, Scene};
use deep_logic::world::Entry;
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// The button and modifiers an `input` event carries: `button`, and `mods` by name.
#[derive(Clone, Debug, Default)]
pub struct Gesture {
    pub button: Option<String>,
    pub mods: [bool; 4],
}

pub fn gesture(v: &Value) -> Gesture {
    let mods: Vec<&str> = v
        .get("mods")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let has = |names: &[&str]| names.iter().any(|n| mods.contains(n));
    Gesture {
        button: v.get("button").and_then(Value::as_str).map(str::to_string),
        mods: [
            has(&["shift"]),
            has(&["ctrl", "control"]),
            has(&["alt", "option"]),
            has(&["meta", "cmd"]),
        ],
    }
}

/// What a panel holds of its point controls: the press a drag is in, each control's hover
/// (viewer state), and, for the planted replays alone, each entry's pointer.
#[derive(Default)]
pub(crate) struct Viewer {
    press: Option<Press>,
    pub(crate) hover: BTreeMap<String, Value>,
    kept: Vec<Kept>,
}

#[derive(Clone)]
struct Press {
    control: String,
    button: String,
    mods: [bool; 4],
    /// The press's flick and panel point, and the pointer's last panel point.
    t: i64,
    at: [f64; 2],
    last: [f64; 2],
    /// Whether its press entry is written: the planted `press_cell_next_frame` defers it.
    written: bool,
    /// A ground path's last point and the distance moved since its last move entry.
    ground: Option<[f64; 3]>,
    moved: f64,
}

/// An entry's pointer, kept for the planted twins that compute it again at a replay.
#[derive(Clone)]
struct Kept {
    control: String,
    t: i64,
    at: [f64; 2],
    press: [f64; 2],
}

/// The planted twins that compute an entry again when a replay reads the track.
const AGAIN: [&str; 3] = [
    "box_corners_on_replay",
    "surface_hit_on_replay",
    "throw_reads_camera",
];

/// A document's lockstep match: its `net@1` item.
fn net_of(form: &Value) -> Option<&Value> {
    form.get("items")?
        .as_object()?
        .values()
        .find(|i| i.get("kind").and_then(Value::as_str) == Some("net@1"))
}

/// An entry's stamp: the gesture's flick, or in a lockstep match the first match step at or
/// after it plus the match's `delay` (Net: each copy stamps its own entries `delay` steps ahead).
fn stamp(form: &Value, t: i64) -> i64 {
    let Some(n) = net_of(form) else {
        return t;
    };
    let rate = n.pointer("/params/step_rate").and_then(Value::as_i64);
    let step = FLICKS_PER_SECOND / rate.filter(|r| *r > 0).unwrap_or(20);
    let delay = n
        .pointer("/params/delay")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    (t.max(0) + step - 1) / step * step + delay * step
}

/// Whether item `id` of `form` is an instancer, whose elements a target names by key.
fn instancer(form: &Value, id: &str) -> bool {
    form.pointer(&format!("/items/{id}/kind")) == Some(&json!("instance@1"))
}

/// An element's key: `slot.gen` as [slot, gen], an integer as [n, 0].
fn key_of(k: &str) -> [i64; 2] {
    let n = |s: &str| s.parse().unwrap_or(0);
    match k.split_once('.') {
        Some((a, b)) => [n(a), n(b)],
        None => [n(k), 0],
    }
}

/// The ground point an entry's value holds.
fn ground_of(v: &Value) -> Option<[f64; 3]> {
    serde_json::from_value(v.get("ground")?.clone()).ok()
}

/// A surface hit as an entry holds it: on a mesh its point, normal, uv and face; on a line or
/// point mark the point nearest the ray alone.
fn surface_of(scene: &Scene, id: &str, ray: &Ray, planted: Option<&str>) -> Option<Value> {
    match pointer::surface(scene, id, ray, planted) {
        Some(s) => Some(json!({"point": s.point, "normal": s.normal, "uv": s.uv, "face": s.face})),
        None => pointer::on_mark(scene, id, ray)
            .map(|p| json!({"point": p, "normal": null, "uv": null, "face": null})),
    }
}

/// `form` seen through the viewer's camera: its camera item posed as `pose`.
fn posed(form: &mut Value, pose: &Pose) {
    let Some(cam) = form
        .get("camera")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    let Some(p) = form
        .pointer_mut(&format!("/items/{cam}/params"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    p.remove("orbit");
    p.insert("position".into(), json!(pose.position));
    p.insert("target".into(), json!(pose.target));
    p.insert("roll".into(), json!(pose.roll));
    if pose.fov > 0.0 {
        p.insert("fov".into(), json!(pose.fov));
    } else {
        p.insert("view_width".into(), json!(pose.view_width));
    }
}

impl Hub<'_> {
    fn planted_name(&self) -> Option<String> {
        self.scenario.module_planted.clone()
    }

    /// The revision `doc` presents, which holds every item as written (a lockstep match's
    /// `net@1` among them).
    fn presented_doc(&self, doc: &str) -> Option<Value> {
        self.sessions.get(doc).and_then(|s| s.document().cloned())
    }

    fn set_press(&mut self, panel: &str, press: Option<Press>) {
        if let Some(s) = self.scopes.get_mut(panel) {
            s.points.press = press;
        }
    }

    /// A pointer event on a panel with point controls, before its scope takes it: `Some` with
    /// the entries appended when the event is a point control's (a press of one of its buttons,
    /// and the drag and release it starts), which the scope then never sees; a move with no
    /// button held sets each control's hover.
    pub(crate) fn point_pointer(
        &mut self,
        panel: &str,
        doc: &Value,
        event: &Event,
        g: &Gesture,
        serial: u64,
    ) -> Result<Option<Vec<Value>>, Value> {
        let controls = control::controls(doc);
        let Some(id) = self.panel_doc(panel).filter(|_| !controls.is_empty()) else {
            return Ok(None);
        };
        let held = self.scopes.get(panel).and_then(|s| s.points.press.clone());
        let now = self.now;
        let find = |name: &str| controls.iter().find(|c| c.id == name).cloned();
        match (event, held) {
            (Event::Down { pos, .. }, None) => {
                let button = g.button.clone().unwrap_or_else(|| "primary".into());
                let Some(c) = controls.iter().find(|c| c.takes(&button)).cloned() else {
                    return Ok(None);
                };
                let late = c.drag == Drag::Path
                    && self.planted_name().as_deref() == Some("press_cell_next_frame");
                let mut press = Press {
                    control: c.id.clone(),
                    button,
                    mods: g.mods,
                    t: now,
                    at: *pos,
                    last: *pos,
                    written: !late,
                    ground: None,
                    moved: 0.0,
                };
                let mut out = Vec::new();
                if !late {
                    let v = self.value(panel, &id, &c, &press, "press", *pos)?;
                    press.ground = ground_of(&v);
                    out = self.write(panel, &id, &c, v, now, *pos, *pos, serial)?;
                }
                self.set_press(panel, Some(press));
                Ok(Some(out))
            }
            (Event::Move(pos), Some(mut press)) => {
                let Some(c) = find(&press.control) else {
                    return Ok(None);
                };
                let out = self.moves(panel, &id, &c, &mut press, *pos, serial)?;
                press.last = *pos;
                self.set_press(panel, Some(press));
                Ok(Some(out))
            }
            (Event::Up(pos), Some(mut press)) => {
                self.set_press(panel, None);
                let Some(c) = find(&press.control) else {
                    return Ok(None);
                };
                let mut out = self.moves(panel, &id, &c, &mut press, *pos, serial)?;
                let v = self.value(panel, &id, &c, &press, "release", *pos)?;
                out.extend(self.write(panel, &id, &c, v, now, *pos, press.at, serial)?);
                Ok(Some(out))
            }
            (Event::Move(pos), None) if g.button.is_none() => {
                self.hover(panel, &id, &controls, *pos)?;
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    /// The move entries a drag writes as the pointer goes to `pos`: on a grid set one for each
    /// cell the segment from its last point enters, in order; on the ground one each `spacing`
    /// its ground point moves. The planted `press_cell_next_frame` writes the deferred press
    /// first, with the cell under the pointer now.
    fn moves(
        &mut self,
        panel: &str,
        doc: &str,
        c: &Point,
        press: &mut Press,
        pos: [f64; 2],
        serial: u64,
    ) -> Result<Vec<Value>, Value> {
        let mut out = Vec::new();
        if !press.written {
            press.written = true;
            let v = self.value(panel, doc, c, press, "press", pos)?;
            out.extend(self.write(panel, doc, c, v, press.t, pos, press.at, serial)?);
        }
        if c.drag != Drag::Path || pos == press.last {
            return Ok(out);
        }
        let now = self.now;
        if let On::Set(set) = &c.on {
            let (Some(a), Some(b)) = (
                self.cell_units(panel, doc, set, press.last),
                self.cell_units(panel, doc, set, pos),
            ) else {
                return Ok(out);
            };
            for cell in control::crossed(a, b) {
                if !self.in_grid(doc, set, cell) {
                    continue;
                }
                let mut v = base(press, "move");
                v["cell"] = json!(cell);
                out.extend(self.write(panel, doc, c, v, now, pos, press.at, serial)?);
            }
            return Ok(out);
        }
        let v = self.value(panel, doc, c, press, "move", pos)?;
        let Some(g) = ground_of(&v) else {
            return Ok(out);
        };
        if let Some(p) = press.ground {
            press.moved += deep_canvas::ops::sqrt((0..3).map(|k| (g[k] - p[k]).powi(2)).sum());
        }
        press.ground = Some(g);
        if press.moved >= c.spacing {
            press.moved = 0.0;
            out.extend(self.write(panel, doc, c, v, now, pos, press.at, serial)?);
        }
        Ok(out)
    }

    /// An entry's value for `phase` at panel point `pos`, computed now from what the panel
    /// shows: a cell, or in 3D the ray and what it meets, the target under the pointer, and on a
    /// box's release its corners and the units inside it.
    fn value(
        &mut self,
        panel: &str,
        doc: &str,
        c: &Point,
        press: &Press,
        phase: &str,
        pos: [f64; 2],
    ) -> Result<Value, Value> {
        let mut v = base(press, phase);
        if let On::Set(set) = &c.on {
            if let Some(cell) = self.cell(panel, doc, set, pos) {
                v["cell"] = json!(cell);
            }
            return Ok(v);
        }
        let planted = self.planted_name();
        let planted = planted.as_deref();
        let t = if planted == Some("surface_at_rest") {
            0
        } else {
            self.now
        };
        let Some((scene, look)) = self.scene_at(panel, doc, t)? else {
            return Ok(v);
        };
        let px = self.frame_px(panel, &scene, pos);
        let ray = pointer::ray(&scene.camera, px);
        v["ray"] = json!({"origin": ray.origin, "dir": ray.dir});
        let heights = match &c.on {
            On::Plate(plate) => self.heights(doc, plate, t),
            _ => None,
        };
        let ground = match (&c.on, &heights) {
            (On::Plane(y), _) => Some(Ground::Plane(*y)),
            (On::Plate(_), Some(h)) => Some(Ground::Plate(h)),
            _ => None,
        };
        if let Some(g) = &ground {
            if let Some(p) = pointer::ground(g, &ray, planted) {
                v["ground"] = json!(p);
            }
        }
        if phase != "move" && !c.targets.is_empty() {
            if let Some(picked) = self.picked(&scene, &look, c, px, planted) {
                let item = picked.split('#').next().unwrap_or_default();
                let set = c.targets.iter().position(|t| t == item).unwrap_or(0);
                let key = match picked.split_once('#') {
                    Some((owner, sub))
                        if self.forms.get(doc).is_some_and(|f| instancer(f, owner)) =>
                    {
                        key_of(sub)
                    }
                    _ => [0, 0],
                };
                v["hit"] = json!({"set": set, "key": key});
                if c.on == On::Surface {
                    if let Some(s) = surface_of(&scene, &picked, &ray, planted) {
                        v["surface"] = s;
                    }
                }
            }
        }
        if phase == "release" && c.drag == Drag::Box {
            let from = self.frame_px(panel, &scene, press.at);
            if let Some(g) = &ground {
                v["corners"] = json!(pointer::corners(&scene.camera, g, from, px, planted));
            }
            let form = self.forms.get(doc).cloned().unwrap_or_default();
            let sets: Vec<&str> = c
                .targets
                .iter()
                .map(String::as_str)
                .filter(|t| instancer(&form, t))
                .collect();
            if !sets.is_empty() {
                // The units drawn inside the box at the gesture; the planted `box_keys_at_apply`
                // takes them where they stand when the entry applies.
                let at_apply = planted == Some("box_keys_at_apply");
                let rev = self.presented_doc(doc).unwrap_or_default();
                let units_scene = if at_apply {
                    self.scene_at(panel, doc, stamp(&rev, self.now))?
                        .map(|s| s.0)
                } else {
                    Some(scene)
                };
                if let Some(s) = units_scene {
                    let (keys, truncated) = pointer::units(&s, &sets, from, px);
                    let keys: Vec<[i64; 2]> = keys.into_iter().map(|(_, k)| k).collect();
                    v["units"] = json!({"keys": keys, "truncated": truncated});
                }
            }
        }
        Ok(v)
    }

    /// One entry of `c` on `doc`'s track, stamped at `t` (in a lockstep match, `delay` steps
    /// on), as a pick writes one, rebaking the document's logic when a logic item reads it.
    #[allow(clippy::too_many_arguments)]
    fn write(
        &mut self,
        panel: &str,
        doc: &str,
        c: &Point,
        value: Value,
        t: i64,
        at: [f64; 2],
        press: [f64; 2],
        serial: u64,
    ) -> Result<Vec<Value>, Value> {
        let t = self.presented_doc(doc).map_or(t, |f| stamp(&f, t));
        if self
            .planted_name()
            .is_some_and(|p| AGAIN.contains(&p.as_str()))
        {
            if let Some(s) = self.scopes.get_mut(panel) {
                s.points.kept.push(Kept {
                    control: c.id.clone(),
                    t,
                    at,
                    press,
                });
            }
        }
        self.pick(doc, &c.id, value, t, serial)
    }

    /// Each point control's hover: the cell or ground point under the pointer, viewer state.
    fn hover(
        &mut self,
        panel: &str,
        doc: &str,
        controls: &[Point],
        pos: [f64; 2],
    ) -> Result<(), Value> {
        for c in controls {
            let h = match &c.on {
                On::Set(set) => self.cell(panel, doc, set, pos).map(|x| json!(x)),
                On::Surface => None,
                On::Plane(_) | On::Plate(_) => {
                    let press = Press {
                        control: c.id.clone(),
                        button: String::new(),
                        mods: [false; 4],
                        t: self.now,
                        at: pos,
                        last: pos,
                        written: true,
                        ground: None,
                        moved: 0.0,
                    };
                    let probe = Point {
                        targets: Vec::new(),
                        drag: Drag::None,
                        ..c.clone()
                    };
                    let v = self.value(panel, doc, &probe, &press, "move", pos)?;
                    ground_of(&v).map(|g| json!(g))
                }
            };
            if let Some(s) = self.scopes.get_mut(panel) {
                match h {
                    Some(h) => s.points.hover.insert(c.id.clone(), h),
                    None => s.points.hover.remove(&c.id),
                };
            }
        }
        Ok(())
    }

    /// Panel point `pos` in the frame's px.
    fn frame_px(&self, panel: &str, scene: &Scene, pos: [f64; 2]) -> [f64; 2] {
        let r = self
            .scopes
            .get(panel)
            .map_or([0.0, 0.0, 1.0, 1.0], |s| s.scope.rect());
        let size = scene.camera.size;
        [
            (pos[0] - r[0]) * size[0] / r[2],
            (pos[1] - r[1]) * size[1] / r[3],
        ]
    }

    /// The panel's 3D scene at `t` as its viewer sees it: the revision as the hub draws its 3D
    /// frame at `t` (played on the track, its worlds' outputs and its logic's arrays), through
    /// the viewer's camera; none before any revision.
    fn scene_at(
        &mut self,
        panel: &str,
        doc: &str,
        t: i64,
    ) -> Result<Option<(Scene, Look3)>, Value> {
        let Some(rev) = self.sessions.get(doc).and_then(|s| s.document().cloned()) else {
            return Ok(None);
        };
        let shown = self.shown_at(doc, &self.with_outputs(doc, &rev), t);
        let mut form = self.arranged(doc, &shown);
        if let Some(pose) = self.scopes.get(panel).map(|s| s.scope.pose()) {
            posed(&mut form, &pose);
        }
        let look = Look3::from_roles(self.look.light.clone());
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let scene = evaluate_with(&form, t, &look, &mut Labels::new(), &read)
            .map_err(|r| json!({"code": r.code, "path": r.path}))?;
        Ok(Some((scene, look)))
    }

    /// The terrain plate `plate`'s height samples where it stands at `t`.
    fn heights(&self, doc: &str, plate: &str, t: i64) -> Option<deep_canvas::heights::Heights> {
        let form = self.forms.get(doc)?;
        let params = form.pointer(&format!("/items/{plate}/params"))?;
        let terrain = deep_canvas_scene3d::terrain::build(params, false).ok()?;
        let m = placed_at(form, t)
            .ok()?
            .into_iter()
            .find(|(id, ..)| id == plate)
            .map(|(.., m)| m)?;
        Some(terrain.heights([m[0][3], m[1][3], m[2][3]]))
    }

    /// The target of `c` the object-ID target names at frame px `px` within its margin; none
    /// where nothing of its targets draws there or this machine draws no 3D.
    fn picked(
        &mut self,
        scene: &Scene,
        look: &Look3,
        c: &Point,
        px: [f64; 2],
        planted: Option<&str>,
    ) -> Option<String> {
        let margin = if planted == Some("point_pick_one_pixel") {
            0
        } else {
            c.margin
        };
        let (_, targets) = self.gpu3()?.draw_scene(scene, look, false)?;
        let ids = pointer::Ids {
            size: targets.size,
            ids: &targets.ids,
            picks: &targets.picks,
        };
        let is_target = |id: &str| {
            let item = id.split('#').next().unwrap_or_default();
            c.targets.iter().any(|t| t == item)
        };
        pointer::topmost(scene, &ids, px, margin, &is_target, planted)
    }

    /// Panel point `pos` in set `set`'s cell units, through the inverse of the 2D camera.
    fn cell_units(&self, panel: &str, doc: &str, set: &str, pos: [f64; 2]) -> Option<[f64; 2]> {
        let s = self.scopes.get(panel)?;
        let (pose, r) = (s.scope.pose(), s.scope.rect());
        let page = Projector::new(&pose, [r[2], r[3]], [r[2], r[3]])
            .unproject_flat(pos[0] - r[0], pos[1] - r[1]);
        let item = self.forms.get(doc)?.pointer(&format!("/items/{set}"))?;
        let grid = atlas::Grid::read(item.get("params")?.as_object()?, "").ok()?;
        let at = |k: usize| {
            item.pointer(&format!("/at/pos/{k}"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        };
        grid.cell_at([page[0] - at(0), page[1] - at(1)])
    }

    /// Whether `cell` lies inside set `set`'s `grid.size`, when it has one.
    fn in_grid(&self, doc: &str, set: &str, cell: [i64; 2]) -> bool {
        let size = self
            .forms
            .get(doc)
            .and_then(|f| f.pointer(&format!("/items/{set}/params"))?.as_object())
            .and_then(atlas::sized);
        size.is_none_or(|[cols, rows]| {
            (0..cols as i64).contains(&cell[0]) && (0..rows as i64).contains(&cell[1])
        })
    }

    /// The cell of set `set` under panel point `pos`: the one whose area holds it; none outside
    /// its `grid.size`.
    fn cell(&self, panel: &str, doc: &str, set: &str, pos: [f64; 2]) -> Option<[i64; 2]> {
        let u = self.cell_units(panel, doc, set, pos)?;
        let cell = u.map(|v| (v + 0.5).floor() as i64);
        self.in_grid(doc, set, cell).then_some(cell)
    }

    /// The planted twins that compute a point entry again when a replay reads `doc`'s track:
    /// from its kept pointer through the camera as it is now, its corners, its surface or its
    /// ray.
    pub(crate) fn points_read(&mut self, doc: &str, track: &mut [Value]) -> Result<(), Value> {
        let Some(p) = self.planted_name().filter(|p| AGAIN.contains(&p.as_str())) else {
            return Ok(());
        };
        let panel = self.scenario.docs.get(doc).cloned().unwrap_or_default();
        let kept = self
            .scopes
            .get(&panel)
            .map(|s| s.points.kept.clone())
            .unwrap_or_default();
        let controls = self
            .forms
            .get(doc)
            .map(control::controls)
            .unwrap_or_default();
        for e in track.iter_mut() {
            let k = kept
                .iter()
                .find(|k| e["control"] == k.control.as_str() && e["t"].as_i64() == Some(k.t));
            let c = k.and_then(|k| controls.iter().find(|c| c.id == k.control));
            let (Some(k), Some(c)) = (k, c) else {
                continue;
            };
            let t = e["t"].as_i64().unwrap_or(0);
            let Some((scene, _)) = self.scene_at(&panel, doc, t)? else {
                continue;
            };
            let px = self.frame_px(&panel, &scene, k.at);
            let ray = pointer::ray(&scene.camera, px);
            match p.as_str() {
                "throw_reads_camera" if e["value"]["ray"].is_object() => {
                    e["value"]["ray"] = json!({"origin": ray.origin, "dir": ray.dir});
                }
                "box_corners_on_replay" if e["value"]["corners"].is_array() => {
                    let from = self.frame_px(&panel, &scene, k.press);
                    let heights = match &c.on {
                        On::Plate(plate) => self.heights(doc, plate, t),
                        _ => None,
                    };
                    let g = match (&c.on, &heights) {
                        (On::Plane(y), _) => Ground::Plane(*y),
                        (On::Plate(_), Some(h)) => Ground::Plate(h),
                        _ => continue,
                    };
                    e["value"]["corners"] =
                        json!(pointer::corners(&scene.camera, &g, from, px, None));
                }
                "surface_hit_on_replay" if e["value"]["surface"].is_object() => {
                    let set = e["value"]["hit"]["set"].as_u64().unwrap_or(0) as usize;
                    let Some(item) = c.targets.get(set) else {
                        continue;
                    };
                    let id = scene
                        .layers
                        .iter()
                        .flat_map(|l| &l.solids)
                        .map(|s| s.id.clone())
                        .find(|id| id == item || id.starts_with(&format!("{item}#")))
                        .unwrap_or_else(|| item.clone());
                    e["value"]["surface"] =
                        surface_of(&scene, &id, &ray, None).unwrap_or(Value::Null);
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// `world`: world `world` of `doc`'s scene baked again from step 0 over its span, on the
    /// track as the hub holds it now: its step hashes, every body's state after each step, and
    /// its occurrences.
    pub(crate) fn world_call(&mut self, doc: &str, world: &str) -> Value {
        let track = self.track_read(doc);
        let bake = crate::physics::Bake {
            doc: doc.into(),
            world: world.into(),
            track,
        };
        self.physics_bake_read(&bake, true)
    }

    /// `match`: the document's lockstep match, as its `net@1` item declares it, every copy run
    /// in this process over a test relay: each copy holds every player's entries at their
    /// stamped steps (here the panel's, player 1's) and reports its logic items' steps.
    pub(crate) fn match_call(&mut self, doc: &str, steps: i64) -> Value {
        let (Some(form), Some(rev)) = (self.forms.get(doc).cloned(), self.presented_doc(doc))
        else {
            return json!({"code": "no_revision"});
        };
        let Some(net) = net_of(&rev) else {
            return json!({"code": "no_match", "what": "the document has no net@1 item"});
        };
        let players = net
            .pointer("/params/players")
            .and_then(Value::as_u64)
            .filter(|p| (1..=8).contains(p))
            .unwrap_or(2);
        let piece = match self.logic_piece(&form) {
            Ok(Some(p)) => Rc::new(p),
            Ok(None) => return json!({"code": "no_logic"}),
            Err(i) => return json!({"code": i.code, "issues": [i.to_json()]}),
        };
        let track = self.track_read(doc);
        let entries: Vec<Entry> = track.iter().filter_map(Entry::parse).collect();
        let mut copies = Vec::new();
        for player in 1..=players {
            match crate::picks::stepped(&piece, &entries, steps) {
                Ok(s) => copies.push(json!({"player": player, "steps": s, "track": track})),
                Err(e) => return e,
            }
        }
        json!({"copies": copies})
    }
}

/// An entry's value before what it meets: its phase, button and modifiers.
fn base(press: &Press, phase: &str) -> Value {
    let m = press.mods;
    json!({"phase": phase, "button": press.button,
           "mods": {"shift": m[0], "ctrl": m[1], "alt": m[2], "meta": m[3]}})
}

/// `world` and `match`: `{doc, world}` and `{doc, steps}`.
pub fn parse_world(c: &Map<String, Value>) -> Option<(String, String)> {
    Some((
        c.get("doc")?.as_str()?.to_string(),
        c.get("world")?.as_str()?.to_string(),
    ))
}

pub fn parse_match(c: &Map<String, Value>) -> Option<(String, i64)> {
    Some((
        c.get("doc")?.as_str()?.to_string(),
        c.get("steps")?
            .as_i64()
            .filter(|n| (1..=100_000).contains(n))?,
    ))
}
