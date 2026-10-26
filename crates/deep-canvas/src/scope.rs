//! The interaction scope (issue #383; technical design: One way to interact, in every scene, and
//! Editing by people and agents): one owner for every gesture on a canvas, whatever draws its
//! items. A drag pans a flat view or turns a 3D one, a pinch or a scroll zooms toward the
//! pointer, a click selects and opens the panel, a double-click flies in, Esc backs out one
//! step, and ⌘K flies to an item by name. A gesture is a press with its moves and its release, a
//! scroll's or a pinch's begin, changes and end, or a key press; it hit-tests only where it
//! starts, never mid-gesture, and commits once, on the input that ends it. Only navigation (a
//! double-click, ⌘K, Esc) frames the camera, never a click. In a flat view an item is its
//! `params.box`; in 3D it is the box of its `params.size` about its position, picked by the
//! nearest face under the pointer. Every canvas draws a full-screen
//! button; Esc leaves full screen before it backs out of a level. All of it is session state:
//! the document is never written.

use serde_json::{json, Map, Value};

use crate::camera::{Offsets, Pivot, Pose, Projector, Refused, Rig, Spec};
use crate::document::member;
use crate::kinds::with_defaults;

/// The verb the full-screen button is bound to (Control: `verb`).
pub const FULL_SCREEN: &str = "canvas.full_screen";

/// Two clicks within this long, flicks (500 ms), and this many px, on one item make a
/// double-click.
const DOUBLE_FLICKS: i64 = 352_800_000;
const DOUBLE_PX: f64 = 4.0;
/// A press turns into a drag once the pointer has moved this many px from where it went down.
const DRAG_PX: f64 = 3.0;
/// A flown-to item spans this share of the view's limiting side.
const FILL: f64 = 1.0 / 1.2;
/// The full-screen button's size and its inset from the canvas's top right, px.
const BUTTON: f64 = 32.0;
const INSET: f64 = 8.0;

/// The wrong programs the #383 suite proves its tests fail on, each reachable only through it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// On a `view` document a scroll pans in time instead of zooming.
    pub line_scroll_pans: bool,
    /// A drag commits on every move.
    pub commit_every_move: bool,
    /// A drag hit-tests on every move.
    pub pick_mid_gesture: bool,
    /// Only `scene`, `world` and `figure` canvases get a full-screen button.
    pub full_screen_only_3d: bool,
    /// Esc leaves full screen and goes back to the top at once.
    pub esc_to_root: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    Begin,
    Change,
    End,
}

/// One hardware input to the canvas, positions in window px.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Down([f64; 2]),
    Up([f64; 2]),
    Move([f64; 2]),
    Scroll {
        phase: Phase,
        pos: [f64; 2],
        delta: [f64; 2],
    },
    Pinch {
        phase: Phase,
        pos: [f64; 2],
        scale: f64,
    },
    Key {
        key: String,
        cmd: bool,
    },
    Text(String),
}

/// What one input did: the hit tests it ran and the serials of the gestures it committed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Done {
    pub picks: u32,
    pub commits: Vec<u64>,
}

/// Where an item sits: a rect in page u (`[x, y, w, h]`), or a 3D box by its centre and half
/// sizes.
#[derive(Clone, Copy)]
enum Bounds {
    Rect([f64; 4]),
    Box { centre: [f64; 3], half: [f64; 3] },
}

/// An item the scope can hit: where it sits, its parent and where it stacks.
struct Target {
    id: String,
    name: String,
    parent: Option<String>,
    order: String,
    bounds: Bounds,
}

/// What a press landed on.
#[derive(Clone, Debug, PartialEq)]
enum Hit {
    Button,
    Item(String),
    Empty,
}

/// A press in progress.
struct Press {
    at: [f64; 2],
    hit: Hit,
    /// The content point under the press and the offsets then: a drag keeps it under the pointer.
    grabbed: [f64; 2],
    from: Offsets,
    dragging: bool,
    /// The second press of a double-click.
    double: bool,
}

/// A level flown into: its item, and the offsets Esc gives back.
struct Level {
    id: String,
    back: Offsets,
}

pub struct Scope {
    spec: Spec,
    rig: Rig,
    offsets: Offsets,
    profile: String,
    panel: [f64; 4],
    display: [f64; 2],
    full_screen: bool,
    selection: Vec<String>,
    details: Option<String>,
    hover: Option<String>,
    levels: Vec<Level>,
    palette: Option<String>,
    press: Option<Press>,
    /// The last click: when, where and on what, for a double-click.
    last_click: Option<(i64, [f64; 2], Hit)>,
    planted: Planted,
}

fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    crate::ops::hypot(a[0] - b[0], a[1] - b[1])
}

fn within(r: [f64; 4], p: [f64; 2]) -> bool {
    p[0] >= r[0] && p[1] >= r[1] && p[0] <= r[0] + r[2] && p[1] <= r[1] + r[3]
}

/// Three numbers of `value`, or `None`.
fn three(value: Option<&Value>) -> Option<[f64; 3]> {
    let a = value?.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// The items a press can hit, in the order they stack, bottom first: in a flat view those with
/// a `params.box` offset by `at.pos`; in 3D those with a `params.size`, centred on their
/// position with their parents' positions added.
fn targets(doc: &Value, flat: bool) -> Vec<Target> {
    let items = member(doc, "items").and_then(Value::as_object);
    let pos = |item: &Value| three(member(item, "at").and_then(|a| member(a, "pos")));
    let mut out: Vec<Target> = items
        .into_iter()
        .flatten()
        .filter_map(|(id, item)| {
            let params = member(item, "params");
            let bounds = if flat {
                let b = params
                    .and_then(|p| member(p, "box"))
                    .and_then(Value::as_array)?;
                let n = |i: usize| b.get(i).and_then(Value::as_f64);
                let at = pos(item).unwrap_or([0.0; 3]);
                Bounds::Rect([at[0] + n(0)?, at[1] + n(1)?, n(2)?, n(3)?])
            } else {
                let size = three(params.and_then(|p| member(p, "size")))?;
                let mut centre = pos(item).unwrap_or([0.0; 3]);
                let mut seen = vec![id.as_str()];
                let mut up = member(item, "parent").and_then(Value::as_str);
                while let Some(parent) = up.filter(|p| !seen.contains(p)) {
                    let Some(p) = items.and_then(|i| i.get(parent)) else {
                        break;
                    };
                    let at = pos(p).unwrap_or([0.0; 3]);
                    centre = [0, 1, 2].map(|k| centre[k] + at[k]);
                    seen.push(parent);
                    up = member(p, "parent").and_then(Value::as_str);
                }
                Bounds::Box {
                    centre,
                    half: size.map(|v| v.abs() / 2.0),
                }
            };
            let text = |k: &str| member(item, k).and_then(Value::as_str).map(str::to_string);
            Some(Target {
                id: id.clone(),
                name: text("name").unwrap_or_else(|| id.clone()),
                parent: text("parent"),
                order: text("order").unwrap_or_default(),
                bounds,
            })
        })
        .collect();
    out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    out
}

/// The depth of the nearest face of a 3D box under the pixel `at` (panel px), or `None` when the
/// pointer misses it or a corner lies behind the eye.
fn face_depth(view: &Projector, centre: [f64; 3], half: [f64; 3], at: [f64; 2]) -> Option<f64> {
    let corner = |bits: usize| {
        let s = |axis: usize| if bits >> axis & 1 == 1 { 1.0 } else { -1.0 };
        [0, 1, 2].map(|k| centre[k] + s(k) * half[k])
    };
    let projected: Vec<_> = (0..8)
        .map(|b| view.project(corner(b)))
        .collect::<Option<_>>()?;
    // Each face as its four corners in order around it (bits: x 1, y 2, z 4).
    let faces = [
        [0, 2, 6, 4],
        [1, 3, 7, 5],
        [0, 1, 5, 4],
        [2, 3, 7, 6],
        [0, 1, 3, 2],
        [4, 5, 7, 6],
    ];
    faces
        .iter()
        .filter(|face| {
            let q: Vec<[f64; 2]> = face
                .iter()
                .map(|&i| [projected[i].x, projected[i].y])
                .collect();
            let side = |a: [f64; 2], b: [f64; 2]| {
                (b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0])
            };
            let signs: Vec<f64> = (0..4).map(|i| side(q[i], q[(i + 1) % 4])).collect();
            signs.iter().all(|s| *s >= 0.0) || signs.iter().all(|s| *s <= 0.0)
        })
        .map(|face| face.iter().map(|&i| projected[i].depth).sum::<f64>() / 4.0)
        .min_by(f64::total_cmp)
}

impl Scope {
    /// The scope of a canvas showing `doc` in `panel` (window px) on a display of `display` px:
    /// the document's own camera, or a flat one over its page when it names none.
    pub fn new(
        doc: &Value,
        panel: [f64; 4],
        display: [f64; 2],
        planted: Planted,
    ) -> Result<Scope, Refused> {
        let camera = member(doc, "camera")
            .and_then(Value::as_str)
            .and_then(|id| member(doc, "items")?.get(id))
            .filter(|c| member(c, "kind").and_then(Value::as_str) == Some("camera@1"));
        let (params, path) = match camera {
            Some(c) => (
                member(c, "params")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default(),
                "camera/params".to_string(),
            ),
            None => {
                let size = |i: usize| {
                    member(doc, "size")
                        .and_then(|s| s.get(i))
                        .and_then(Value::as_f64)
                        .unwrap_or(panel[2 + i])
                };
                let mut p = Map::new();
                p.insert("projection".into(), json!("orthographic"));
                p.insert("target".into(), json!([size(0) / 2.0, size(1) / 2.0, 0.0]));
                p.insert("view_width".into(), json!(size(0)));
                (p, "size".to_string())
            }
        };
        let spec = Spec::read(&with_defaults("camera@1", &params), &path)?;
        let rig = spec.rig(&path)?;
        Ok(Scope {
            spec,
            rig,
            offsets: Offsets::default(),
            profile: member(doc, "profile")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            panel,
            display,
            full_screen: false,
            selection: Vec::new(),
            details: None,
            hover: None,
            levels: Vec::new(),
            palette: None,
            press: None,
            last_click: None,
            planted,
        })
    }

    pub fn pose(&self) -> Pose {
        self.spec.pose(&self.rig, &self.offsets)
    }

    /// The canvas's rect in window px: its panel's, or the display's in full screen.
    pub fn rect(&self) -> [f64; 4] {
        if self.full_screen {
            [0.0, 0.0, self.display[0], self.display[1]]
        } else {
            self.panel
        }
    }

    /// The controls the canvas draws over itself: the full-screen button at its top right.
    fn button(&self) -> Option<[f64; 4]> {
        let three_d = matches!(self.profile.as_str(), "scene" | "world" | "figure");
        if self.planted.full_screen_only_3d && !three_d {
            return None;
        }
        let r = self.rect();
        Some([r[0] + r[2] - INSET - BUTTON, r[1] + INSET, BUTTON, BUTTON])
    }

    /// u per px across the canvas, for a flat view.
    fn u_per_px(&self, offsets: &Offsets) -> f64 {
        self.rig.view_width / offsets.zoom / self.rect()[2]
    }

    /// The page point under `p` with `offsets`, in a flat view.
    fn content(&self, p: [f64; 2], offsets: &Offsets) -> [f64; 2] {
        let r = self.rect();
        let k = self.u_per_px(offsets);
        let t = self.spec.pose(&self.rig, offsets).target;
        [
            t[0] + (p[0] - (r[0] + r[2] / 2.0)) * k,
            t[1] + (p[1] - (r[1] + r[3] / 2.0)) * k,
        ]
    }

    /// The pan that puts the page point `c` under `p` at `zoom`.
    fn pan_to(&self, c: [f64; 2], p: [f64; 2], zoom: f64) -> [f64; 3] {
        let r = self.rect();
        let k = self.rig.view_width / zoom / r[2];
        [
            c[0] - (p[0] - (r[0] + r[2] / 2.0)) * k - self.spec.target[0],
            c[1] - (p[1] - (r[1] + r[3] / 2.0)) * k - self.spec.target[1],
            self.offsets.pan[2],
        ]
    }

    /// Zooms by `factor` toward the pointer: the content under it stays there.
    fn zoom_at(&mut self, p: [f64; 2], factor: f64) {
        let [lo, hi] = self.spec.user.zoom;
        let zoom = (self.offsets.zoom * factor).clamp(lo, hi);
        if self.rig.flat {
            let c = self.content(p, &self.offsets);
            self.offsets.pan = self.pan_to(c, p, zoom);
        }
        self.offsets.zoom = zoom;
    }

    /// The topmost item under `p`, or the button over it: in a flat view the last-stacked box
    /// that holds it, in 3D the box whose face under it is nearest.
    fn hit(&self, doc: &Value, p: [f64; 2]) -> Hit {
        if self.button().is_some_and(|b| within(b, p)) {
            return Hit::Button;
        }
        if !within(self.rect(), p) {
            return Hit::Empty;
        }
        let all = targets(doc, self.rig.flat);
        if self.rig.flat {
            let c = self.content(p, &self.offsets);
            return all
                .into_iter()
                .rev()
                .find(|t| matches!(t.bounds, Bounds::Rect(r) if within(r, c)))
                .map_or(Hit::Empty, |t| Hit::Item(t.id));
        }
        let r = self.rect();
        let view = Projector::new(&self.pose(), [r[2], r[3]], [r[2], r[3]]);
        let at = [p[0] - r[0], p[1] - r[1]];
        let mut best: Option<(f64, String)> = None;
        for t in all.iter().rev() {
            let Bounds::Box { centre, half } = t.bounds else {
                continue;
            };
            if let Some(depth) = face_depth(&view, centre, half, at) {
                if best.as_ref().is_none_or(|(d, _)| depth < *d) {
                    best = Some((depth, t.id.clone()));
                }
            }
        }
        best.map_or(Hit::Empty, |(_, id)| Hit::Item(id))
    }

    /// Flies to `id`: the levels down to it, its nesting path, and in a flat view the camera that
    /// frames it.
    fn fly(&mut self, doc: &Value, id: &str) {
        let all = targets(doc, self.rig.flat);
        let mut path = vec![id.to_string()];
        while let Some(parent) = all
            .iter()
            .find(|t| &t.id == path.last().expect("not empty"))
            .and_then(|t| t.parent.clone())
            .filter(|p| !path.contains(p))
        {
            path.push(parent);
        }
        path.reverse();
        let kept = self
            .levels
            .iter()
            .zip(&path)
            .take_while(|(l, id)| &l.id == *id)
            .count();
        self.levels.truncate(kept);
        for step in &path[kept..] {
            self.levels.push(Level {
                id: step.clone(),
                back: self.offsets,
            });
            if let Some(t) = all.iter().find(|t| &t.id == step) {
                self.frame(t.bounds);
            }
        }
    }

    /// The camera that holds an item wholly in view, centred on it: a flat view's width, or in
    /// 3D the distance at which the box's bounding sphere fits the narrower side. A camera that
    /// pivots about its eye never moves its eye, so it isn't framed.
    fn frame(&mut self, bounds: Bounds) {
        let r = self.rect();
        let [lo, hi] = self.spec.user.zoom;
        let rect = match bounds {
            Bounds::Rect(rect) if self.rig.flat => rect,
            Bounds::Box { centre, half } if !self.rig.flat => {
                if self.spec.user.pivot == Pivot::Eye {
                    return;
                }
                let radius = crate::ops::sqrt(half.iter().map(|h| h * h).sum::<f64>());
                let pose = self.pose();
                let narrow = r[2].min(r[3]) / r[2].max(r[3]);
                let distance = if pose.fov > 0.0 {
                    let half_angle =
                        crate::ops::atan(crate::ops::tan(crate::ops::rad(pose.fov) / 2.0) * narrow);
                    radius / crate::ops::sin(half_angle) / FILL
                } else {
                    // Orthographic: the zoom divides the view width through the target.
                    radius * 2.0 / narrow / FILL * self.rig.distance / self.rig.view_width
                };
                self.offsets.zoom = (self.rig.distance / distance).clamp(lo, hi);
                self.offsets.pan = [0, 1, 2].map(|k| centre[k] - self.spec.target[k]);
                return;
            }
            _ => return,
        };
        let width = rect[2].max(rect[3] * r[2] / r[3]) / FILL;
        let zoom = (self.rig.view_width / width).clamp(lo, hi);
        self.offsets.zoom = zoom;
        self.offsets.pan = [
            rect[0] + rect[2] / 2.0 - self.spec.target[0],
            rect[1] + rect[3] / 2.0 - self.spec.target[1],
            self.offsets.pan[2],
        ];
    }

    /// Esc: closes the palette, else leaves full screen, else backs out one level.
    fn back(&mut self) {
        if self.palette.take().is_some() {
            return;
        }
        if self.planted.esc_to_root {
            self.full_screen = false;
            if let Some(top) = self.levels.first() {
                self.offsets = top.back;
            }
            self.levels.clear();
            return;
        }
        if self.full_screen {
            self.full_screen = false;
        } else if let Some(level) = self.levels.pop() {
            self.offsets = level.back;
        }
    }

    /// A click on what the press hit: the button toggles full screen; an item is selected and
    /// its panel opens; empty space clears both. The camera never moves.
    fn click(&mut self, hit: &Hit) {
        match hit {
            Hit::Button => self.full_screen = !self.full_screen,
            Hit::Item(id) => {
                self.selection = vec![id.clone()];
                self.details = Some(id.clone());
            }
            Hit::Empty => {
                self.selection.clear();
                self.details = None;
            }
        }
    }

    /// The camera a drag to `p` leaves: a flat view keeps the grabbed point under the pointer; a
    /// 3D one turns by the drag's px.
    fn drag(&mut self, p: [f64; 2]) {
        let Some(press) = &self.press else { return };
        let (grabbed, from, at) = (press.grabbed, press.from, press.at);
        if self.rig.flat {
            self.offsets.pan = self.pan_to(grabbed, p, self.offsets.zoom);
            return;
        }
        let user = self.spec.user;
        self.offsets.azimuth = from.azimuth - (p[0] - at[0]) * user.turn;
        let elevation = self.rig.elevation + from.elevation + (p[1] - at[1]) * user.tilt;
        self.offsets.elevation = elevation.clamp(user.pitch[0], user.pitch[1]) - self.rig.elevation;
    }

    /// One input at `t` (flicks) with the router's `serial`, against the current revision `doc`.
    pub fn input(&mut self, doc: &Value, t: i64, serial: u64, event: &Event) -> Done {
        let mut done = Done::default();
        let commit = |done: &mut Done| done.commits.push(serial);
        match event {
            Event::Down(p) => {
                let hit = self.hit(doc, *p);
                done.picks = 1;
                self.hover = match &hit {
                    Hit::Item(id) => Some(id.clone()),
                    _ => None,
                };
                let double = matches!(hit, Hit::Item(_))
                    && self.last_click.as_ref().is_some_and(|(at, q, h)| {
                        t - at <= DOUBLE_FLICKS && distance(*q, *p) <= DOUBLE_PX && *h == hit
                    });
                self.press = Some(Press {
                    at: *p,
                    grabbed: if self.rig.flat {
                        self.content(*p, &self.offsets)
                    } else {
                        [0.0, 0.0]
                    },
                    from: self.offsets,
                    hit,
                    dragging: false,
                    double,
                });
            }
            Event::Move(p) => match self.press.as_mut() {
                Some(press) => {
                    if distance(press.at, *p) >= DRAG_PX {
                        press.dragging = true;
                    }
                    if press.dragging {
                        self.drag(*p);
                    }
                    if self.planted.pick_mid_gesture {
                        done.picks = 1;
                        self.hover = match self.hit(doc, *p) {
                            Hit::Item(id) => Some(id),
                            _ => None,
                        };
                    }
                    if self.planted.commit_every_move {
                        commit(&mut done);
                    }
                }
                None => {
                    // A hover between gestures: the pointer rests over what it hits.
                    done.picks = 1;
                    self.hover = match self.hit(doc, *p) {
                        Hit::Item(id) => Some(id),
                        _ => None,
                    };
                }
            },
            Event::Up(p) => {
                if self.press.as_ref().is_some_and(|press| press.dragging) {
                    self.drag(*p);
                }
                if let Some(press) = self.press.take() {
                    if press.dragging {
                        self.last_click = None;
                    } else if press.double {
                        if let Hit::Item(id) = &press.hit {
                            self.fly(doc, id);
                        }
                        self.last_click = None;
                    } else {
                        self.click(&press.hit);
                        self.last_click = Some((t, *p, press.hit));
                    }
                }
                commit(&mut done);
            }
            Event::Scroll { phase, pos, delta } => {
                if *phase == Phase::Change {
                    if self.planted.line_scroll_pans && self.profile == "view" && self.rig.flat {
                        let k = self.u_per_px(&self.offsets);
                        self.offsets.pan[0] += delta[1] * k;
                    } else {
                        let rate = self.spec.user.zoom_rate;
                        self.zoom_at(*pos, crate::ops::exp(-delta[1] * rate));
                    }
                }
                if *phase == Phase::End {
                    commit(&mut done);
                }
            }
            Event::Pinch { phase, pos, scale } => {
                if *phase == Phase::Change && scale.is_finite() && *scale > 0.0 {
                    self.zoom_at(*pos, *scale);
                }
                if *phase == Phase::End {
                    commit(&mut done);
                }
            }
            Event::Key { key, cmd } => {
                match (key.as_str(), cmd) {
                    ("Escape", _) => self.back(),
                    ("k", true) => self.palette = Some(String::new()),
                    ("Return", _) => {
                        if let Some(query) = self.palette.take() {
                            let all = targets(doc, self.rig.flat);
                            let found = all
                                .iter()
                                .find(|t| t.name == query)
                                .or_else(|| all.iter().find(|t| t.name.starts_with(&query)))
                                .map(|t| t.id.clone());
                            if let Some(id) = found {
                                self.fly(doc, &id);
                            }
                        }
                    }
                    _ => {}
                }
                commit(&mut done);
            }
            Event::Text(text) => {
                if let Some(query) = self.palette.as_mut() {
                    query.push_str(text);
                }
            }
        }
        done
    }

    pub fn to_json(&self) -> Value {
        json!({
            "camera": self.pose().to_json(),
            "rect": self.rect(),
            "full_screen": self.full_screen,
            "buttons": self
                .button()
                .map(|b| vec![json!({"verb": FULL_SCREEN, "rect": b})])
                .unwrap_or_default(),
            "selection": self.selection,
            "details": self.details,
            "hover": self.hover,
            "level": self.levels.iter().map(|l| &l.id).collect::<Vec<_>>(),
            "palette": {
                "open": self.palette.is_some(),
                "query": self.palette.clone().unwrap_or_default(),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: i64 = 705_600;

    /// A 3D scene looking down −z from 10 m at the origin, in an 800 × 600 panel: a 2 m box at
    /// the origin and a 1 m box 3 m nearer the eye, both on the line of sight.
    fn scene() -> Value {
        let solid = |id: &str, size: f64, z: f64, order: &str| {
            json!({"id": id, "kind": "mark.box@1", "name": id, "order": order,
                "params": {"size": [size, size, size]}, "at": {"pos": [0, 0, z]}})
        };
        json!({
            "format": 1, "profile": "scene", "size": [800, 600], "camera": "cam",
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 10], "fov": 40}},
                "near": solid("near", 1.0, 3.0, "a1"),
                "far": solid("far", 2.0, 0.0, "a2"),
            }
        })
    }

    fn scope(doc: &Value) -> Scope {
        Scope::new(
            doc,
            [0.0, 0.0, 800.0, 600.0],
            [1600.0, 900.0],
            Planted::default(),
        )
        .expect("the scene's camera reads")
    }

    fn click(s: &mut Scope, doc: &Value, t: i64, p: [f64; 2]) {
        s.input(doc, t, 1, &Event::Down(p));
        s.input(doc, t + 60 * MS, 2, &Event::Up(p));
    }

    #[test]
    fn a_click_in_3d_selects_the_nearest_box_under_the_pointer() {
        let doc = scene();
        let mut s = scope(&doc);
        // The centre: both boxes are under it; the near one wins on depth though it stacks first.
        click(&mut s, &doc, 0, [400.0, 300.0]);
        assert_eq!(s.selection, ["near"]);
        // 95 px right: past the near box's edge (about 78 px), inside the far one's (about 110 px).
        click(&mut s, &doc, 2000 * MS, [495.0, 300.0]);
        assert_eq!(s.selection, ["far"]);
        click(&mut s, &doc, 4000 * MS, [700.0, 300.0]);
        assert!(s.selection.is_empty(), "nothing is under the pointer there");
    }

    #[test]
    fn a_double_click_in_3d_flies_to_the_box_and_esc_backs_out() {
        let doc = scene();
        let mut s = scope(&doc);
        let before = s.pose();
        click(&mut s, &doc, 0, [400.0, 300.0]);
        assert_eq!(s.pose(), before, "a click never moves the camera");
        click(&mut s, &doc, 120 * MS, [400.0, 300.0]);
        let flown = s.pose();
        let levels: Vec<&str> = s.levels.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(levels, ["near"]);
        assert_eq!(flown.target, [0.0, 0.0, 3.0], "the view centres on the box");
        assert!(flown.distance < before.distance, "and comes closer");
        // The box's bounding sphere fits the narrower side: its corners stay in the panel.
        let view = Projector::new(&flown, [800.0, 600.0], [800.0, 600.0]);
        for bits in 0..8 {
            let s = |axis: usize| if bits >> axis & 1 == 1 { 0.5 } else { -0.5 };
            let p = view.project([s(0), s(1), 3.0 + s(2)]).expect("in front");
            assert!((0.0..=800.0).contains(&p.x) && (0.0..=600.0).contains(&p.y));
        }
        let esc = Event::Key {
            key: "Escape".into(),
            cmd: false,
        };
        s.input(&doc, 2000 * MS, 5, &esc);
        assert_eq!(
            s.pose(),
            before,
            "Esc gives back the camera before the flight"
        );
        assert!(s.levels.is_empty());
    }

    #[test]
    fn a_drag_in_3d_turns_about_the_target() {
        let doc = scene();
        let mut s = scope(&doc);
        let before = s.pose();
        s.input(&doc, 0, 1, &Event::Down([700.0, 300.0]));
        s.input(&doc, 16 * MS, 2, &Event::Move([760.0, 300.0]));
        let done = s.input(&doc, 32 * MS, 3, &Event::Up([760.0, 300.0]));
        let after = s.pose();
        assert_ne!(after.azimuth, before.azimuth, "the drag turns");
        assert_eq!(after.target, before.target, "about the target, which stays");
        assert_eq!(done.commits, [3], "one commit, on the release");
    }
}
