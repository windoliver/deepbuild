//! The interaction scope (issue #383; technical design: One way to interact, in every scene, and
//! Editing by people and agents): one owner for every gesture on a canvas, whatever draws its
//! items. A drag pans a flat view or turns a 3D one, a pinch or a scroll zooms toward the
//! pointer, a click selects and opens the panel, a double-click flies in, Esc backs out one
//! step, and ⌘K flies to an item by name. A gesture is a press with its moves and its release, a
//! scroll's or a pinch's begin, changes and end, or a key press; it hit-tests only where it
//! starts, never mid-gesture, and commits once, on the input that ends it. Only navigation (a
//! double-click, ⌘K, Esc) frames the camera, never a click. In a flat view an item is its
//! `params.box` (a text item's `{w, h}` from its position); in 3D a solid is the box of its
//! `params.size` about its position, picked by the nearest face under the pointer, and a line or
//! a point is hit within a few px of it. Every canvas draws a full-screen button; Esc ends
//! isolation, then leaves full screen, then backs out a level. Its view controls filter items out
//! by kind or writer, isolate one, pick a lens (provenance by writer, or how each item changed),
//! scrub the record's time, compare against an earlier revision and pause the transport at a
//! playhead; the caller hands it the revision the view shows and the one compared against. A
//! shift-click toggles an item in the selection, and a point and ask reads what the pointer is
//! on (issue #384). All of it is session state: the document is never written.

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
    /// The primary button pressed; with `toggle` (shift held) a click adds the item it hits to
    /// the selection, or takes it out, keeping the rest (Selection: `mode: toggle`).
    Down {
        pos: [f64; 2],
        toggle: bool,
    },
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
    /// An entry on one of the canvas's view controls (Scope and input classes: view class), the
    /// value `null` to clear it: `filter` `{kinds, writers}`, `isolate` an item ID, `lens`
    /// `writer` or `changed`, `time` the flicks the view shows the record as of, `compare` the
    /// revision shown as before, `playhead` the flicks the transport is paused at.
    Control {
        control: String,
        value: Value,
    },
}

/// What a lens colors each shown item by: the writer whose layer holds it (provenance), or how
/// it changed since the revision compared against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lens {
    Writer,
    Changed,
}

/// The view controls' state: session state, never written to the document.
#[derive(Clone, Debug, Default, PartialEq)]
struct View {
    /// Kinds and writers the filter hides.
    kinds: Vec<String>,
    writers: Vec<String>,
    /// The item isolation keeps, with its parents and children; everything else is hidden.
    isolate: Option<String>,
    lens: Option<Lens>,
    /// The record's time the view shows, in flicks; live without one.
    time: Option<i64>,
    /// The revision compared against, shown as before.
    compare: Option<u64>,
    /// The transport's playhead, paused at this time in flicks; playing without one.
    playhead: Option<i64>,
}

/// How each item differs between two revisions, by ID.
fn diff(before: &Value, after: &Value) -> Map<String, Value> {
    let empty = Map::new();
    let items = |d| {
        member(d, "items")
            .and_then(Value::as_object)
            .unwrap_or(&empty)
    };
    let (a, b) = (items(before), items(after));
    let mut out = Map::new();
    for (id, item) in b {
        let how = match a.get(id) {
            None => "added",
            Some(was) if was != item => "changed",
            Some(_) => continue,
        };
        out.insert(id.clone(), json!(how));
    }
    for id in a.keys().filter(|id| !b.contains_key(*id)) {
        out.insert(id.clone(), json!("removed"));
    }
    out
}

/// The writer whose layer holds `item`, as the document's `layers` name it.
fn writer_of<'a>(doc: &'a Value, item: &Value) -> Option<&'a str> {
    let layer = member(item, "layer").and_then(Value::as_str)?;
    member(doc, "layers")
        .and_then(|l| member(l, layer))
        .and_then(|l| member(l, "writer"))
        .and_then(Value::as_str)
}

/// How exactly a point and ask's pointer hit (Selection): an item by ID, a place on an item, or
/// only a region of the frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Precision {
    Id,
    Geometry,
    Region,
}

impl Precision {
    pub fn name(self) -> &'static str {
        match self {
            Precision::Id => "id",
            Precision::Geometry => "geometry",
            Precision::Region => "region",
        }
    }
}

/// What a point and ask points at: the item, how exactly, the region meant, and the text of a
/// text item under the pointer, exactly as the document holds it.
#[derive(Clone, Debug, PartialEq)]
pub struct Pointed {
    pub id: Option<String>,
    pub precision: Precision,
    /// `[x, y, w, h]`.
    pub region: Option<[f64; 4]>,
    pub quote: Option<String>,
}

/// The side of the region a point and ask sends about the pointer, in the frame's units.
const REGION: f64 = 16.0;

/// The region a point and ask sends about the point `c`: a square of [`REGION`] centred on it,
/// moved and cut to lie within `within` (`[x, y, w, h]`).
pub fn region_about(c: [f64; 2], within: [f64; 4]) -> [f64; 4] {
    let side = |i: usize| {
        let (lo, len) = (within[i], within[i + 2]);
        let w = REGION.min(len.max(0.0));
        let start = (c[i] - w / 2.0).clamp(lo, lo + len - w);
        (start, w)
    };
    let ((x, w), (y, h)) = (side(0), side(1));
    [x, y, w, h]
}

/// What one input did: the hit tests it ran and the serials of the gestures it committed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Done {
    pub picks: u32,
    pub commits: Vec<u64>,
}

/// Where an item sits: a rect in page u (`[x, y, w, h]`), or a 3D box by its centre and half
/// sizes.
#[derive(Clone)]
enum Bounds {
    Rect([f64; 4]),
    Box {
        centre: [f64; 3],
        half: [f64; 3],
    },
    /// A 3D line through its points, or a point or label at its one point: hit within a few px.
    Path(Vec<[f64; 3]>),
}

impl Bounds {
    /// A 3D item's box, centre and half sizes; a flat rect has none.
    fn box3(&self) -> Option<([f64; 3], [f64; 3])> {
        match self {
            Bounds::Rect(_) => None,
            Bounds::Box { centre, half } => Some((*centre, *half)),
            Bounds::Path(points) => {
                let lo = |k: usize| points.iter().map(|p| p[k]).fold(f64::MAX, f64::min);
                let hi = |k: usize| points.iter().map(|p| p[k]).fold(f64::MIN, f64::max);
                Some((
                    [0, 1, 2].map(|k| (lo(k) + hi(k)) / 2.0),
                    // A point has no extent; framing gives it a metre about it.
                    [0, 1, 2].map(|k| ((hi(k) - lo(k)) / 2.0).max(0.5)),
                ))
            }
        }
    }
}

/// How near the pointer must come to a 3D point or line to hit it, px.
const POINT_PX: f64 = 8.0;
const LINE_PX: f64 = 6.0;

/// The depth of a 3D line or point under the pixel `at`, or `None` when the pointer passes
/// farther from it than a point's or a line's reach.
fn path_depth(view: &Projector, points: &[[f64; 3]], at: [f64; 2]) -> Option<f64> {
    let projected: Vec<_> = points.iter().filter_map(|p| view.project(*p)).collect();
    if projected.len() != points.len() {
        return None;
    }
    if let [only] = projected.as_slice() {
        return (distance([only.x, only.y], at) <= POINT_PX).then_some(only.depth);
    }
    projected
        .windows(2)
        .filter_map(|w| {
            let (a, b) = ([w[0].x, w[0].y], [w[1].x, w[1].y]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let len2 = dx * dx + dy * dy;
            let k = if len2 > 0.0 {
                (((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let near = [a[0] + dx * k, a[1] + dy * k];
            (distance(near, at) <= LINE_PX).then(|| w[0].depth + (w[1].depth - w[0].depth) * k)
        })
        .min_by(f64::total_cmp)
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
    /// Shift held: the click toggles what it hits in the selection.
    toggle: bool,
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
    view: View,
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
/// a `params.box` offset by `at.pos`; in 3D a solid's box of its `params.size`, a line through
/// its `params.points` and a point or a label at its position, each with its parents' positions
/// added.
fn targets(doc: &Value, flat: bool) -> Vec<Target> {
    let items = member(doc, "items").and_then(Value::as_object);
    let pos = |item: &Value| three(member(item, "at").and_then(|a| member(a, "pos")));
    let mut out: Vec<Target> = items
        .into_iter()
        .flatten()
        .filter_map(|(id, item)| {
            let params = member(item, "params");
            let bounds = if flat {
                let b = params.and_then(|p| member(p, "box"))?;
                let at = pos(item).unwrap_or([0.0; 3]);
                match b.as_array() {
                    Some(b) => {
                        let n = |i: usize| b.get(i).and_then(Value::as_f64);
                        Bounds::Rect([at[0] + n(0)?, at[1] + n(1)?, n(2)?, n(3)?])
                    }
                    // A text item's box, `{w, h}` from its position.
                    None => {
                        let n = |k: &str| member(b, k).and_then(Value::as_f64);
                        Bounds::Rect([at[0], at[1], n("w")?, n("h")?])
                    }
                }
            } else {
                if member(item, "kind").and_then(Value::as_str) == Some("camera@1") {
                    return None;
                }
                let own = pos(item);
                let mut centre = own.unwrap_or([0.0; 3]);
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
                let size = params.and_then(|p| member(p, "size"));
                let size = three(size).or_else(|| size?.as_f64().map(|s| [s; 3]));
                let points: Vec<[f64; 3]> = params
                    .and_then(|p| member(p, "points"))
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|q| three(Some(q)))
                    .map(|q| [0, 1, 2].map(|k| q[k] + centre[k]))
                    .collect();
                match (points.len() >= 2, size) {
                    // A line, by the points it runs through.
                    (true, _) => Bounds::Path(points),
                    (false, Some(size)) => Bounds::Box {
                        centre,
                        half: size.map(|v| v.abs() / 2.0),
                    },
                    // A point or a label: where it sits.
                    (false, None) if own.is_some() => Bounds::Path(vec![centre]),
                    (false, None) => return None,
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
            view: View::default(),
            planted,
        })
    }

    /// The record's time the view shows, flicks, or `None` while it's live: which revision the
    /// caller hands the scope.
    pub fn time(&self) -> Option<i64> {
        self.view.time
    }

    /// The revision the view compares against, shown as before.
    pub fn compare(&self) -> Option<u64> {
        self.view.compare
    }

    /// The time the transport is paused at, flicks, or `None` while it plays.
    pub fn playhead(&self) -> Option<i64> {
        self.view.playhead
    }

    /// The selected IDs (Selection: `ids`).
    pub fn selection(&self) -> &[String] {
        &self.selection
    }

    /// What a point and ask at `p` (window px) points at in `doc` (Selection): the topmost item
    /// under the pointer by ID with a text item's text as its quote, a place on an image, which
    /// holds no IDs, as the image and a region on it, or with no item under it a region of the
    /// page alone. A region is in page u, about the pointer and within what it lies on.
    pub fn point(&self, doc: &Value, p: [f64; 2]) -> Pointed {
        let item = match self.hit(doc, p) {
            Hit::Item(id) => member(doc, "items")
                .and_then(|i| member(i, &id))
                .map(|i| (id, i)),
            _ => None,
        };
        let at = self.rig.flat.then(|| self.content(p, &self.offsets));
        let Some((id, item)) = item else {
            let page = [0, 1].map(|i| {
                member(doc, "size")
                    .and_then(|s| s.get(i))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
            });
            return Pointed {
                id: None,
                precision: Precision::Region,
                region: at.map(|c| region_about(c, [0.0, 0.0, page[0], page[1]])),
                quote: None,
            };
        };
        let kind = member(item, "kind").and_then(Value::as_str).unwrap_or("");
        let text = || {
            member(item, "params")
                .and_then(|p| member(p, "text"))
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        match (kind, at) {
            ("image@1", Some(c)) => {
                let bounds = targets(doc, true)
                    .into_iter()
                    .find(|t| t.id == id)
                    .and_then(|t| match t.bounds {
                        Bounds::Rect(r) => Some(r),
                        _ => None,
                    });
                Pointed {
                    id: Some(id),
                    precision: Precision::Geometry,
                    region: bounds.map(|r| region_about(c, r)),
                    quote: None,
                }
            }
            _ => Pointed {
                id: Some(id),
                precision: Precision::Id,
                region: None,
                quote: (kind == "text@1").then(text).flatten(),
            },
        }
    }

    /// The items the view hides: those the filter names by kind or writer, and outside an
    /// isolated item, its parents and its children, by ID. The document keeps them all.
    pub fn hidden(&self, doc: &Value) -> Vec<String> {
        let Some(items) = member(doc, "items").and_then(Value::as_object) else {
            return Vec::new();
        };
        let parent = |id: &str| {
            items
                .get(id)
                .and_then(|i| member(i, "parent"))
                .and_then(Value::as_str)
        };
        // Whether `id` is `of` or nested under it.
        let under = |id: &str, of: &str| {
            let mut at = Some(id);
            let mut steps = 0;
            while let Some(a) = at.filter(|_| steps <= items.len()) {
                if a == of {
                    return true;
                }
                at = parent(a);
                steps += 1;
            }
            false
        };
        items
            .iter()
            .filter(|(id, item)| {
                if member(item, "kind").and_then(Value::as_str) == Some("camera@1") {
                    return false;
                }
                let kind = member(item, "kind").and_then(Value::as_str).unwrap_or("");
                let filtered = self.view.kinds.iter().any(|k| k == kind)
                    || writer_of(doc, item)
                        .is_some_and(|w| self.view.writers.iter().any(|x| x == w));
                let outside = self
                    .view
                    .isolate
                    .as_deref()
                    .is_some_and(|keep| !under(id, keep) && !under(keep, id));
                filtered || outside
            })
            .map(|(id, _)| id.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// The document as the view draws it, never saved: what the view hides set invisible, and
    /// under a lens each shown item's fill set to the look role its key draws in. The changed
    /// lens draws what was added or changed in `accent` and the rest `muted`; the writer lens
    /// draws your items in `ink` and every agent's in `accent`. Status colors stay status's.
    pub fn view_document(&self, doc: &Value, before: Option<&Value>) -> Value {
        let mut out = doc.clone();
        let hidden = self.hidden(doc);
        let changed = before.map(|b| diff(b, doc)).unwrap_or_default();
        let roles: Map<String, Value> = match self.view.lens {
            None => Map::new(),
            Some(lens) => member(doc, "items")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .map(|(id, item)| {
                    let role = match lens {
                        Lens::Changed if changed.contains_key(id) => "accent",
                        Lens::Changed => "muted",
                        Lens::Writer => match writer_of(doc, item) {
                            Some(w) if w.starts_with("agent:") => "accent",
                            _ => "ink",
                        },
                    };
                    (id.clone(), json!(role))
                })
                .collect(),
        };
        if let Some(items) = out.get_mut("items").and_then(Value::as_object_mut) {
            for (id, item) in items.iter_mut() {
                if member(item, "kind").and_then(Value::as_str) == Some("camera@1") {
                    continue;
                }
                if hidden.binary_search(id).is_ok() {
                    item["visible"] = json!(false);
                }
                if let (Some(role), Some(params)) = (roles.get(id), item.get_mut("params")) {
                    params["paint"]["fill"] = json!({"role": role});
                }
            }
        }
        out
    }

    /// The verdicts a change to what's selected would make stale: each verdict whose key holds
    /// a digest of a record state a selected item shows (`verdict.made`'s `key.state_digests`,
    /// by the handle a bound value reads), in ID order.
    pub fn stale_if_changed(&self, doc: &Value, verdicts: &Map<String, Value>) -> Vec<String> {
        let handles: Vec<&str> = member(doc, "bound_values")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, b)| {
                let target = member(b, "target").and_then(Value::as_str).unwrap_or("");
                self.selection
                    .iter()
                    .any(|id| target.starts_with(&format!("items/{id}/")))
            })
            .filter_map(|(_, b)| member(b, "source").and_then(Value::as_str))
            .collect();
        verdicts
            .iter()
            .filter(|(_, v)| {
                member(v, "key")
                    .and_then(|k| member(k, "state_digests"))
                    .and_then(Value::as_object)
                    .is_some_and(|digests| handles.iter().any(|h| digests.contains_key(*h)))
            })
            .map(|(id, _)| id.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// The items a press or ⌘K can reach: every target the view doesn't hide.
    fn shown_targets(&self, doc: &Value) -> Vec<Target> {
        let hidden = self.hidden(doc);
        let mut all = targets(doc, self.rig.flat);
        all.retain(|t| hidden.binary_search(&t.id).is_err());
        all
    }

    /// An entry on a view control; `false` when the value isn't one the control takes.
    fn control(&mut self, control: &str, value: &Value) -> bool {
        let strings = |v: Option<&Value>| -> Option<Vec<String>> {
            match v {
                None | Some(Value::Null) => Some(Vec::new()),
                Some(v) => v
                    .as_array()?
                    .iter()
                    .map(|s| s.as_str().map(str::to_string))
                    .collect(),
            }
        };
        match (control, value) {
            ("filter", Value::Null) => {
                self.view.kinds.clear();
                self.view.writers.clear();
            }
            ("filter", Value::Object(f)) => {
                let (Some(kinds), Some(writers)) =
                    (strings(f.get("kinds")), strings(f.get("writers")))
                else {
                    return false;
                };
                self.view.kinds = kinds;
                self.view.writers = writers;
            }
            ("isolate", Value::Null) => self.view.isolate = None,
            ("isolate", Value::String(id)) => self.view.isolate = Some(id.clone()),
            ("lens", Value::Null) => self.view.lens = None,
            ("lens", Value::String(l)) if l == "writer" => self.view.lens = Some(Lens::Writer),
            ("lens", Value::String(l)) if l == "changed" => self.view.lens = Some(Lens::Changed),
            ("time", Value::Null) => self.view.time = None,
            ("time", v) if v.as_i64().is_some_and(|t| t >= 0) => self.view.time = v.as_i64(),
            ("compare", Value::Null) => self.view.compare = None,
            ("compare", v) if v.as_u64().is_some() => self.view.compare = v.as_u64(),
            ("playhead", Value::Null) => self.view.playhead = None,
            ("playhead", v) if v.as_i64().is_some_and(|t| t >= 0) => {
                self.view.playhead = v.as_i64()
            }
            _ => return false,
        }
        true
    }

    pub fn pose(&self) -> Pose {
        self.spec.pose(&self.rig, &self.offsets)
    }

    /// The panel moved to `panel` (window px) on a display of `display` px: a view popped out
    /// into its own window (#400). The camera, selection and levels stay.
    pub fn placed(&mut self, panel: [f64; 4], display: [f64; 2]) {
        self.panel = panel;
        self.display = display;
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
        let all = self.shown_targets(doc);
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
            let depth = match &t.bounds {
                Bounds::Box { centre, half } => face_depth(&view, *centre, *half, at),
                Bounds::Path(points) => path_depth(&view, points, at),
                Bounds::Rect(_) => None,
            };
            if let Some(depth) = depth {
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
                self.frame(&t.bounds);
            }
        }
    }

    /// The camera that holds an item wholly in view, centred on it: a flat view's width, or in
    /// 3D the distance at which the box's bounding sphere fits the narrower side. A camera that
    /// pivots about its eye never moves its eye, so it isn't framed.
    fn frame(&mut self, bounds: &Bounds) {
        let r = self.rect();
        let [lo, hi] = self.spec.user.zoom;
        let rect = match (bounds, bounds.box3()) {
            (Bounds::Rect(rect), _) if self.rig.flat => *rect,
            (_, Some((centre, half))) if !self.rig.flat => {
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

    /// Esc: closes the palette, else ends isolation, else leaves full screen, else backs out one
    /// level.
    fn back(&mut self) {
        if self.palette.take().is_some() || self.view.isolate.take().is_some() {
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
    /// its panel opens; empty space clears both. With `toggle` an item joins the selection, or
    /// leaves it, and empty space keeps it. The camera never moves.
    fn click(&mut self, hit: &Hit, toggle: bool) {
        match hit {
            Hit::Button => self.full_screen = !self.full_screen,
            Hit::Item(id) if toggle => {
                match self.selection.iter().position(|s| s == id) {
                    Some(i) => {
                        self.selection.remove(i);
                    }
                    None => self.selection.push(id.clone()),
                }
                self.details = Some(id.clone());
            }
            Hit::Empty if toggle => {}
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
            Event::Down { pos: p, toggle } => {
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
                    toggle: *toggle,
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
                        self.click(&press.hit, press.toggle);
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
                            let all = self.shown_targets(doc);
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
            Event::Control { control, value } => {
                if self.control(control, value) {
                    commit(&mut done);
                }
            }
        }
        done
    }

    /// The scope's state over `doc`, the revision it shows, `before`, the one it compares
    /// against, and the record's `verdicts`: what the view hides, how each item changed, the key
    /// the lens colors by, and the verdicts a change to the selection would make stale.
    pub fn to_json(
        &self,
        doc: &Value,
        before: Option<&Value>,
        verdicts: &Map<String, Value>,
    ) -> Value {
        let changed = before.map(|b| diff(b, doc));
        let hidden = self.hidden(doc);
        let lens = self.view.lens.map(|lens| {
            let items = member(doc, "items").and_then(Value::as_object);
            let key: Map<String, Value> = items
                .into_iter()
                .flatten()
                .filter(|(id, item)| {
                    hidden.binary_search(id).is_err()
                        && member(item, "kind").and_then(Value::as_str) != Some("camera@1")
                })
                .map(|(id, item)| {
                    let v = match lens {
                        Lens::Writer => json!(writer_of(doc, item)),
                        Lens::Changed => changed
                            .as_ref()
                            .and_then(|c| c.get(id).cloned())
                            .unwrap_or(json!("same")),
                    };
                    (id.clone(), v)
                })
                .collect();
            let by = match lens {
                Lens::Writer => "writer",
                Lens::Changed => "changed",
            };
            json!({"by": by, "key": key})
        });
        let view = &self.view;
        json!({
            "view": {
                "filter": (!view.kinds.is_empty() || !view.writers.is_empty())
                    .then(|| json!({"kinds": view.kinds, "writers": view.writers})),
                "isolate": view.isolate,
                "time": view.time,
                "compare": view.compare,
                "playhead": view.playhead,
            },
            "hidden": hidden,
            "changed": changed,
            "lens": lens,
            "stale_if_changed": self.stale_if_changed(doc, verdicts),
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
        s.input(
            doc,
            t,
            1,
            &Event::Down {
                pos: p,
                toggle: false,
            },
        );
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
        s.input(
            &doc,
            0,
            1,
            &Event::Down {
                pos: [700.0, 300.0],
                toggle: false,
            },
        );
        s.input(&doc, 16 * MS, 2, &Event::Move([760.0, 300.0]));
        let done = s.input(&doc, 32 * MS, 3, &Event::Up([760.0, 300.0]));
        let after = s.pose();
        assert_ne!(after.azimuth, before.azimuth, "the drag turns");
        assert_eq!(after.target, before.target, "about the target, which stays");
        assert_eq!(done.commits, [3], "one commit, on the release");
    }

    /// A flat board, page = panel (800 × 450): you wrote `note`; alpha wrote `region`, which
    /// holds `box`, and `line`.
    fn board() -> Value {
        let item = |id: &str, kind: &str, layer: &str, x: f64, parent: Option<&str>| {
            let mut i = json!({"id": id, "kind": kind, "layer": layer, "name": id, "order": "a1",
                "params": {"box": [x, 100.0, 100.0, 100.0]}});
            if let Some(p) = parent {
                i["parent"] = json!(p);
            }
            i
        };
        json!({
            "format": 1, "profile": "board", "size": [800, 450],
            "layers": {"you-main": {"writer": "you:you"}, "alpha-main": {"writer": "agent:alpha"}},
            "items": {
                "note": item("note", "text@1", "you-main", 0.0, None),
                "region": item("region", "frame@1", "alpha-main", 200.0, None),
                "box": item("box", "rect@1", "alpha-main", 210.0, Some("region")),
                "line": item("line", "rect@1", "alpha-main", 500.0, None),
            }
        })
    }

    fn board_scope(doc: &Value) -> Scope {
        Scope::new(
            doc,
            [0.0, 0.0, 800.0, 450.0],
            [1600.0, 900.0],
            Planted::default(),
        )
        .expect("the board reads")
    }

    fn set(s: &mut Scope, doc: &Value, control: &str, value: Value) -> Done {
        let event = Event::Control {
            control: control.into(),
            value,
        };
        s.input(doc, 0, 9, &event)
    }

    #[test]
    fn a_filter_hides_by_kind_or_writer_and_what_it_hides_cant_be_picked() {
        let doc = board();
        let mut s = board_scope(&doc);
        click(&mut s, &doc, 0, [550.0, 150.0]);
        assert_eq!(s.selection, ["line"], "shown, it's picked");
        let done = set(&mut s, &doc, "filter", json!({"writers": ["agent:alpha"]}));
        assert_eq!(done.commits, [9], "a control entry commits once");
        assert_eq!(s.hidden(&doc), ["box", "line", "region"]);
        click(&mut s, &doc, 2000 * MS, [550.0, 150.0]);
        assert!(s.selection.is_empty(), "hidden, it isn't");
        set(&mut s, &doc, "filter", json!({"kinds": ["text@1"]}));
        assert_eq!(s.hidden(&doc), ["note"]);
        set(&mut s, &doc, "filter", Value::Null);
        assert!(s.hidden(&doc).is_empty());
        let refused = set(&mut s, &doc, "lens", json!("taste"));
        assert!(
            refused.commits.is_empty(),
            "a value the control doesn't take commits nothing"
        );
    }

    #[test]
    fn isolation_keeps_an_item_with_its_parents_and_children_and_esc_ends_it_first() {
        let doc = board();
        let mut s = board_scope(&doc);
        set(&mut s, &doc, "isolate", json!("region"));
        assert_eq!(
            s.hidden(&doc),
            ["line", "note"],
            "region and the box it holds stay"
        );
        set(&mut s, &doc, "isolate", json!("box"));
        assert_eq!(
            s.hidden(&doc),
            ["line", "note"],
            "isolating the child keeps its parent"
        );
        s.full_screen = true;
        let esc = Event::Key {
            key: "Escape".into(),
            cmd: false,
        };
        s.input(&doc, 0, 10, &esc);
        assert!(s.hidden(&doc).is_empty(), "the first Esc ends isolation");
        assert!(s.full_screen, "and only that");
        s.input(&doc, 0, 11, &esc);
        assert!(!s.full_screen, "the next leaves full screen");
    }

    #[test]
    fn the_writer_lens_keys_each_shown_item_by_its_layers_writer() {
        let doc = board();
        let mut s = board_scope(&doc);
        set(&mut s, &doc, "lens", json!("writer"));
        set(&mut s, &doc, "filter", json!({"kinds": ["text@1"]}));
        let state = s.to_json(&doc, None, &Map::new());
        assert_eq!(state["lens"]["by"], json!("writer"));
        assert_eq!(
            state["lens"]["key"],
            json!({"region": "agent:alpha", "box": "agent:alpha", "line": "agent:alpha"}),
            "a hidden item has no key"
        );
        let mut later = doc.clone();
        later["items"]["line"]["params"]["box"][0] = json!(520.0);
        later["items"]
            .as_object_mut()
            .expect("items")
            .remove("note");
        set(&mut s, &doc, "lens", json!("changed"));
        let state = s.to_json(&later, Some(&doc), &Map::new());
        assert_eq!(
            state["changed"],
            json!({"line": "changed", "note": "removed"})
        );
        assert_eq!(state["lens"]["key"]["line"], json!("changed"));
        assert_eq!(state["lens"]["key"]["box"], json!("same"));
    }

    #[test]
    fn a_click_in_3d_hits_a_point_or_a_line_within_a_few_px_of_it() {
        // The scene's camera, with a point 2 m right of the target and a rail 2 m below it.
        let mut doc = scene();
        let items = doc["items"].as_object_mut().expect("items");
        items.remove("near");
        items.remove("far");
        items.insert(
            "dot".into(),
            json!({"id": "dot", "kind": "mark.point@1", "name": "Dot", "order": "a1", "at": {"pos": [2, 0, 0]}}),
        );
        items.insert(
            "rail".into(),
            json!({"id": "rail", "kind": "mark.line@1", "name": "Rail", "order": "a2",
                "params": {"points": [[-3, -2, 0], [3, -2, 0]]}}),
        );
        let mut s = scope(&doc);
        // 2 m at 10 m is 2 × focal ÷ 10 px from the centre, focal = 400 ÷ tan 20°.
        let px = 2.0 * 400.0 / crate::ops::tan(crate::ops::rad(20.0)) / 10.0;
        click(&mut s, &doc, 0, [400.0 + px + 5.0, 300.0]);
        assert_eq!(s.selection, ["dot"], "5 px from the point");
        click(&mut s, &doc, 2000 * MS, [450.0, 300.0 + px - 4.0]);
        assert_eq!(s.selection, ["rail"], "4 px from the rail");
        click(&mut s, &doc, 4000 * MS, [450.0, 300.0 + px - 20.0]);
        assert!(s.selection.is_empty(), "20 px from both");
    }

    #[test]
    fn selecting_a_bound_value_lights_the_verdicts_that_read_its_state() {
        let mut doc = board();
        doc["bound_values"] = json!({
            "b1": {"target": "items/note/params/text", "source": "reading:rd-latency"},
            "b2": {"target": "items/line/params/text", "source": "reading:rd-errors"},
        });
        let verdicts: Map<String, Value> = serde_json::from_value(json!({
            "vd-1": {"outcome": "PASS", "key": {"state_digests": {"reading:rd-latency": "sha-a"}}},
            "vd-2": {"outcome": "PASS", "key": {"state_digests": {"reading:rd-errors": "sha-b"}}},
            "vd-3": {"outcome": "FAIL", "key": {"state_digests": {"reading:rd-latency": "sha-a", "reading:rd-cpu": "sha-c"}}},
        }))
        .expect("verdicts");
        let mut s = board_scope(&doc);
        click(&mut s, &doc, 0, [50.0, 150.0]);
        assert_eq!(s.selection, ["note"]);
        assert_eq!(
            s.to_json(&doc, None, &verdicts)["stale_if_changed"],
            json!(["vd-1", "vd-3"])
        );
        click(&mut s, &doc, 2000 * MS, [250.0, 150.0]);
        assert_eq!(s.selection, ["region"], "a region shows no bound value");
        assert_eq!(s.stale_if_changed(&doc, &verdicts), Vec::<String>::new());
    }

    #[test]
    fn the_view_document_hides_what_the_view_hides_and_paints_the_lens_and_saves_nothing() {
        let doc = board();
        let mut s = board_scope(&doc);
        set(&mut s, &doc, "filter", json!({"kinds": ["text@1"]}));
        set(&mut s, &doc, "lens", json!("writer"));
        let view = s.view_document(&doc, None);
        assert_eq!(view["items"]["note"]["visible"], json!(false));
        assert_eq!(
            view["items"]["line"]["params"]["paint"]["fill"]["role"],
            json!("accent")
        );
        assert_eq!(
            view["items"]["note"]["params"]["paint"]["fill"]["role"],
            json!("ink")
        );
        assert_eq!(doc, board(), "the document itself is unchanged");
    }
}
