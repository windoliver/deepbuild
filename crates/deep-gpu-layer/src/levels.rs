//! Levels by reference in a 3D view (issue #383; canvas primitives: Level of detail, `open`, and
//! chunks streamed by view, for residency and settling). An item whose params carry `open: {at_px,
//! doc}` loads the document it names once its projected size reaches `at_px` device px while it
//! is on screen, on a loader thread off the frame loop, and that document's items draw in the
//! opener's frame: a top-level item's `at.pos` is relative to its opener's. A document whose opener leaves the screen, or shrinks below `at_px`, is
//! evicted, so a large project costs only what's on screen. The view has settled when every
//! document it selects is resident.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use deep_canvas_scene3d::scene::{corners, Camera, Scene};
use serde_json::{Map, Value};

/// The loader threads: a view that opens many documents at once settles in a few frames.
const LOADERS: usize = 8;

/// A loaded document's ID handle and its parsed JSON, or why it didn't load.
type Loaded = (String, Result<Value, String>);

pub struct Levels {
    paths: BTreeMap<String, PathBuf>,
    resident: BTreeMap<String, Value>,
    pending: BTreeSet<String>,
    requests: Sender<(String, PathBuf)>,
    loaded: Receiver<Loaded>,
    /// The planted twin: every document an item opens, wherever the item is.
    everything: bool,
}

/// An opener in the composed document: its item and where it opens.
struct Opener {
    id: String,
    item: Value,
    at_px: f64,
    doc: String,
}

fn openers(items: &Map<String, Value>) -> Vec<Opener> {
    items
        .iter()
        .filter_map(|(id, item)| {
            let open = item.get("params")?.get("open")?;
            Some(Opener {
                id: id.clone(),
                item: item.clone(),
                at_px: open.get("at_px")?.as_f64()?,
                doc: open.get("doc")?.as_str()?.to_string(),
            })
        })
        .collect()
}

/// The area of the convex polygon `poly` clipped to `[0, w] × [0, h]` (Sutherland–Hodgman).
fn area_on(poly: Vec<[f64; 2]>, w: f64, h: f64) -> f64 {
    type Inside = fn(&[f64; 2], f64) -> bool;
    let edges: [(usize, f64, Inside); 4] = [
        (0, 0.0, |p, e| p[0] >= e),
        (0, w, |p, e| p[0] <= e),
        (1, 0.0, |p, e| p[1] >= e),
        (1, h, |p, e| p[1] <= e),
    ];
    let mut out = poly;
    for (axis, edge, inside) in edges {
        let input = std::mem::take(&mut out);
        for (i, a) in input.iter().enumerate() {
            let b = &input[(i + 1) % input.len()];
            let cut = |a: &[f64; 2], b: &[f64; 2]| {
                let k = (edge - a[axis]) / (b[axis] - a[axis]);
                [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
            };
            match (inside(a, edge), inside(b, edge)) {
                (true, true) => out.push(*b),
                (true, false) => out.push(cut(a, b)),
                (false, true) => {
                    out.push(cut(a, b));
                    out.push(*b);
                }
                (false, false) => {}
            }
        }
        if out.is_empty() {
            return 0.0;
        }
    }
    let n = out.len();
    (0..n)
        .map(|i| out[i][0] * out[(i + 1) % n][1] - out[(i + 1) % n][0] * out[i][1])
        .sum::<f64>()
        .abs()
        / 2.0
}

/// The convex hull of `points`, counter-clockwise (Andrew's monotone chain).
fn hull(mut points: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    points.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    points.dedup();
    if points.len() < 3 {
        return points;
    }
    let cross = |o: [f64; 2], a: [f64; 2], b: [f64; 2]| {
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    };
    let mut lower: Vec<[f64; 2]> = Vec::new();
    for &p in &points {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<[f64; 2]> = Vec::new();
    for &p in points.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Where a box's corners land in px, its edges cut at the near plane first, so a box that
/// reaches behind the eye projects as the part of it in front (corners in `corners`' order: the
/// x, y and z halves as bits 4, 2 and 1).
fn on_screen_points(corners: &[[f64; 3]], camera: &Camera) -> Vec<[f64; 2]> {
    let depth = |p: &[f64; 3]| camera.to_view(*p)[2];
    let near = if camera.perspective {
        camera.near
    } else {
        f64::MIN
    };
    let mut points = Vec::new();
    for (i, a) in corners.iter().enumerate() {
        if depth(a) >= near {
            points.extend(camera.project(*a).map(|p| [p[0], p[1]]));
        }
        for bit in [1, 2, 4] {
            let Some(b) = corners.get(i | bit).filter(|_| i & bit == 0) else {
                continue;
            };
            let (da, db) = (depth(a), depth(b));
            if (da < near) != (db < near) {
                let k = (near - da) / (db - da);
                let cut = [0, 1, 2].map(|j| a[j] + (b[j] - a[j]) * k);
                points.extend(camera.project(cut).map(|p| [p[0], p[1]]));
            }
        }
    }
    points
}

/// The least area, px², an opener must cover on screen to count as shown: a sliver past the
/// frame's edge covers no pixel.
const SHOWN_PX2: f64 = 16.0;

impl Levels {
    pub fn new(paths: BTreeMap<String, PathBuf>, everything: bool) -> Levels {
        let (requests, jobs) = channel::<(String, PathBuf)>();
        let (done, loaded) = channel::<Loaded>();
        let jobs = Arc::new(Mutex::new(jobs));
        for n in 0..LOADERS {
            let (jobs, done) = (jobs.clone(), done.clone());
            std::thread::Builder::new()
                .name(format!("deep-gpu levels {n}"))
                .spawn(move || loop {
                    let next = jobs.lock().unwrap_or_else(|e| e.into_inner()).recv();
                    let Ok((handle, path)) = next else { return };
                    let doc = std::fs::read_to_string(&path)
                        .map_err(|e| e.to_string())
                        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()));
                    if done.send((handle, doc)).is_err() {
                        return;
                    }
                })
                .expect("spawn a level loader");
        }
        Levels {
            paths,
            resident: BTreeMap::new(),
            pending: BTreeSet::new(),
            requests,
            loaded,
            everything,
        }
    }

    /// Takes the documents the loader has finished; a document that didn't load stays out.
    pub fn collect(&mut self) {
        while let Ok((handle, doc)) = self.loaded.try_recv() {
            self.pending.remove(&handle);
            if let Ok(doc) = doc {
                self.resident.insert(handle, doc);
            }
        }
    }

    /// The root with each resident document's items drawn in its opener's frame, and the
    /// documents whose items it holds.
    pub fn compose(&self, root: &Value) -> (Value, Vec<String>) {
        let mut doc = root.clone();
        let mut attached: Vec<String> = Vec::new();
        let Some(items) = doc.get_mut("items").and_then(Value::as_object_mut) else {
            return (doc, attached);
        };
        let mut frontier: Vec<Opener> = openers(items);
        while let Some(opener) = frontier.pop() {
            let Some(child) = self.resident.get(&opener.doc) else {
                continue;
            };
            if attached.contains(&opener.doc) {
                continue;
            }
            attached.push(opener.doc.clone());
            let mut added = Map::new();
            for (id, item) in child
                .get("items")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                if items.contains_key(id)
                    || item.get("kind").and_then(Value::as_str) == Some("camera@1")
                {
                    continue;
                }
                let mut item = item.clone();
                // A top-level item of the child sits in its opener's frame: its position is
                // relative to the opener's (which already holds its own opener's, level by level).
                if item.get("parent").is_none() {
                    let pos = |v: &Value, i: usize| v["at"]["pos"][i].as_f64().unwrap_or(0.0);
                    let at = [0, 1, 2].map(|i| pos(&item, i) + pos(&opener.item, i));
                    item["at"]["pos"] = serde_json::json!(at);
                }
                added.insert(id.clone(), item);
            }
            frontier.extend(openers(&added));
            items.extend(added);
        }
        attached.sort();
        (doc, attached)
    }

    /// The documents the view selects: those whose opener is on screen and at least `at_px`
    /// across; the planted twin selects every one an item opens.
    pub fn select(&self, composed: &Value, scene: &Scene) -> BTreeSet<String> {
        let Some(items) = composed.get("items").and_then(Value::as_object) else {
            return BTreeSet::new();
        };
        let [w, h] = [f64::from(scene.size[0]), f64::from(scene.size[1])];
        openers(items)
            .into_iter()
            .filter(|o| self.paths.contains_key(&o.doc))
            .filter(|o| {
                if self.everything {
                    return true;
                }
                let Some(solid) = scene
                    .layers
                    .iter()
                    .flat_map(|l| &l.solids)
                    .find(|s| s.id == o.id)
                else {
                    return false;
                };
                let points = on_screen_points(&corners(&solid.model), &scene.camera);
                if points.is_empty() {
                    return false;
                }
                let span = |axis: usize| {
                    let (lo, hi) = points.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| {
                        (lo.min(p[axis]), hi.max(p[axis]))
                    });
                    hi - lo
                };
                span(0).max(span(1)) >= o.at_px && area_on(hull(points), w, h) >= SHOWN_PX2
            })
            .map(|o| o.doc)
            .collect()
    }

    /// Asks the loader for what `selected` lacks and evicts what it no longer holds; true when
    /// every selected document is resident.
    pub fn settle(&mut self, selected: &BTreeSet<String>) -> bool {
        let settled = selected.iter().all(|h| self.resident.contains_key(h));
        self.resident.retain(|h, _| selected.contains(h));
        for handle in selected {
            if self.resident.contains_key(handle) || self.pending.contains(handle) {
                continue;
            }
            if let Some(path) = self.paths.get(handle) {
                if self.requests.send((handle.clone(), path.clone())).is_ok() {
                    self.pending.insert(handle.clone());
                }
            }
        }
        settled
    }
}
