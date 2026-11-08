//! The spatial index (issue #421, renderer fixes; the #421 acceptance README: Assumed surfaces):
//! each item's world bounds and its hierarchy's, a bounding-volume hierarchy over them built in
//! ID order, and the view, box, nearest-n and radius queries it answers. A node is skipped only
//! when no item under it can pass, and each item then takes the exact test, so every answer is
//! what a scan of every item's bounds gives.

use std::cell::Cell;
use std::collections::BTreeMap;

use deep_canvas::camera::Vec3;
use deep_canvas::ops::sqrt;
use serde_json::{json, Map, Value};

use crate::scene::{camera, corners8, matmul, placed_at, Affine3, Camera, Refused};

/// An axis-aligned box in world metres, closed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub min: Vec3,
    pub max: Vec3,
}

impl Aabb {
    fn of(points: &[Vec3]) -> Aabb {
        let mut b = Aabb {
            min: [f64::INFINITY; 3],
            max: [f64::NEG_INFINITY; 3],
        };
        for p in points {
            for k in 0..3 {
                b.min[k] = b.min[k].min(p[k]);
                b.max[k] = b.max[k].max(p[k]);
            }
        }
        b
    }

    fn union(self, o: Aabb) -> Aabb {
        Aabb {
            min: [0, 1, 2].map(|k| self.min[k].min(o.min[k])),
            max: [0, 1, 2].map(|k| self.max[k].max(o.max[k])),
        }
    }

    fn touches(&self, o: &Aabb) -> bool {
        (0..3).all(|k| self.min[k] <= o.max[k] && o.min[k] <= self.max[k])
    }

    /// From `p` to the box, 0 inside.
    fn distance(&self, p: Vec3) -> f64 {
        let d = [0, 1, 2].map(|k| (self.min[k] - p[k]).max(0.0).max(p[k] - self.max[k]));
        sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
    }

    fn corners(&self) -> [Vec3; 8] {
        let (a, b) = (self.min, self.max);
        [0, 1, 2, 3, 4, 5, 6, 7].map(|i| {
            [
                if i & 4 == 0 { a[0] } else { b[0] },
                if i & 2 == 0 { a[1] } else { b[1] },
                if i & 1 == 0 { a[2] } else { b[2] },
            ]
        })
    }

    fn centre(&self) -> Vec3 {
        [0, 1, 2].map(|k| (self.min[k] + self.max[k]) / 2.0)
    }

    fn json(&self) -> Value {
        json!({"min": self.min, "max": self.max})
    }
}

/// #421's wrong programs, each reachable only through a proof surface's `planted`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Plants {
    /// A view keeps an item only when its bounds' centre is inside.
    pub cull_by_center: bool,
    /// A node's subtree unions only its direct children's own bounds.
    pub bounds_children_only: bool,
}

/// A query: the items a camera's view keeps, those whose bounds touch a box, the n nearest a
/// point, or every one within r of it.
#[derive(Clone, Debug, PartialEq)]
pub enum Query {
    View(String),
    Box(Aabb),
    Nearest(Vec3, usize),
    Radius(Vec3, f64),
}

fn vec3(v: Option<&Value>) -> Option<Vec3> {
    match v?.as_array()?.as_slice() {
        [x, y, z] => Some([x.as_f64()?, y.as_f64()?, z.as_f64()?]),
        _ => None,
    }
}

impl Query {
    pub fn parse(v: &Value) -> Option<Query> {
        let (name, q) = v.as_object().filter(|o| o.len() == 1)?.iter().next()?;
        Some(match name.as_str() {
            "view" => Query::View(q.as_str()?.to_string()),
            "box" => Query::Box(Aabb {
                min: vec3(q.get("min"))?,
                max: vec3(q.get("max"))?,
            }),
            "nearest" => Query::Nearest(
                vec3(q.get("point"))?,
                usize::try_from(q.get("n")?.as_u64()?).ok()?,
            ),
            "radius" => Query::Radius(
                vec3(q.get("point"))?,
                q.get("r")?.as_f64().filter(|r| *r >= 0.0)?,
            ),
            _ => return None,
        })
    }
}

/// A plane, inside where `n · p + k ≥ 0`.
type Plane = (Vec3, f64);

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn comb(a: Vec3, x: f64, b: Vec3, y: f64) -> Vec3 {
    [0, 1, 2].map(|k| a[k] * x + b[k] * y)
}

/// The six planes of a camera's view between its near and far: its screen's edges through the
/// eye (or, orthographic, along the view), with the roll and shift its pixels have.
fn planes(cam: &Camera) -> [Plane; 6] {
    let [c, s] = cam.roll;
    // The world directions of the screen's x (right) and y (down) axes.
    let x = comb(cam.right, c, cam.up, s);
    let y = comb(cam.right, s, cam.up, -c);
    let f = cam.forward;
    let [w, h] = cam.size;
    let [cx, cy] = cam.centre;
    // Inside where the point's pixel is on the frame's side of each edge: `sign × scale × (a ·
    // d) ÷ z + off ≥ 0` with d from the eye (z = 1 orthographic).
    let edge = |a: Vec3, sign: f64, off: f64| -> Plane {
        if cam.perspective {
            let n = comb(a, sign * cam.scale, f, off);
            (n, -dot(n, cam.eye))
        } else {
            let n = comb(a, sign * cam.scale, f, 0.0);
            (n, off - dot(n, cam.eye))
        }
    };
    [
        edge(x, 1.0, cx),
        edge(x, -1.0, w - cx),
        edge(y, 1.0, cy),
        edge(y, -1.0, h - cy),
        (f, -dot(f, cam.eye) - cam.near),
        (comb(f, -1.0, f, 0.0), dot(f, cam.eye) + cam.far),
    ]
}

/// Whether some plane has all eight of the box's corners outside it.
fn outside(planes: &[Plane; 6], b: &Aabb) -> bool {
    let corners = b.corners();
    planes
        .iter()
        .any(|(n, k)| corners.iter().all(|c| dot(*n, *c) + k < 0.0))
}

const LEAF: usize = 4;

struct Node {
    bounds: Aabb,
    /// The items in `order[start..end]`, or the two children.
    start: usize,
    end: usize,
    kids: Option<(usize, usize)>,
}

/// One item's entry: its world bounds (none without geometry), its hierarchy's, its children.
pub struct Entry {
    pub bounds: Option<Aabb>,
    pub subtree: Option<Aabb>,
    pub children: Vec<String>,
}

/// A document's items at t, indexed.
pub struct Index {
    pub entries: BTreeMap<String, Entry>,
    cameras: BTreeMap<String, Camera>,
    /// The IDs of the items with bounds, in the hierarchy's order.
    order: Vec<(String, Aabb)>,
    nodes: Vec<Node>,
    plants: Plants,
}

/// A solid's world model: its world transform times its size.
fn model(world: &Affine3, size: Vec3) -> Affine3 {
    matmul(
        world,
        &[
            [size[0], 0.0, 0.0, 0.0],
            [0.0, size[1], 0.0, 0.0],
            [0.0, 0.0, size[2], 0.0],
        ],
    )
}

impl Index {
    /// `doc`'s items at `t`: each solid's bounds are its eight corners in the world.
    pub fn new(doc: &Value, t: i64, plants: Plants) -> Result<Index, Refused> {
        let placed = placed_at(doc, t)?;
        let mut entries: BTreeMap<String, Entry> = BTreeMap::new();
        let mut parents: Vec<(String, String)> = Vec::new();
        let mut corners: Vec<Vec3> = Vec::new();
        for (id, item, world) in &placed {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            let bounds =
                matches!(kind, "mark.box@1" | "mark.cylinder@1" | "mark.sphere@1").then(|| {
                    let size = vec3(item.pointer("/params/size")).unwrap_or([1.0; 3]);
                    let c = corners8(&model(world, size));
                    corners.extend(c);
                    Aabb::of(&c)
                });
            if let Some(p) = item.get("parent").and_then(Value::as_str) {
                parents.push((p.to_string(), id.clone()));
            }
            entries.insert(
                id.clone(),
                Entry {
                    bounds,
                    subtree: None,
                    children: Vec::new(),
                },
            );
        }
        parents.sort();
        for (p, c) in parents {
            if let Some(e) = entries.get_mut(&p) {
                e.children.push(c);
            }
        }
        let ids: Vec<String> = entries.keys().cloned().collect();
        for id in &ids {
            let sub = subtree(&entries, id, plants, &mut Vec::new());
            if let Some(e) = entries.get_mut(id) {
                e.subtree = sub;
            }
        }

        let size = match doc.get("size").and_then(Value::as_array).map(Vec::as_slice) {
            Some([w, h]) => [w.as_f64().unwrap_or(1.0), h.as_f64().unwrap_or(1.0)],
            _ => [1.0, 1.0],
        };
        let empty = Map::new();
        let mut cameras = BTreeMap::new();
        for (id, item, _) in &placed {
            if item.get("kind").and_then(Value::as_str) == Some("camera@1") {
                let params = item
                    .get("params")
                    .and_then(Value::as_object)
                    .unwrap_or(&empty);
                cameras.insert(
                    id.clone(),
                    camera(params, size, &corners, &format!("items/{id}/params"))?,
                );
            }
        }

        let mut order: Vec<(String, Aabb)> = entries
            .iter()
            .filter_map(|(id, e)| Some((id.clone(), e.bounds?)))
            .collect();
        let mut nodes = Vec::new();
        if !order.is_empty() {
            let n = order.len();
            build(&mut order, 0, n, &mut nodes);
        }
        Ok(Index {
            entries,
            cameras,
            order,
            nodes,
            plants,
        })
    }

    /// #427: the hierarchy's nodes from the root down, each with its depth (the root's 0),
    /// whether it is a leaf, and its box; the pick hierarchy mode draws them.
    pub fn hierarchy(&self) -> Vec<(usize, bool, Aabb)> {
        let mut out = Vec::new();
        let mut stack = if self.nodes.is_empty() {
            Vec::new()
        } else {
            vec![(0usize, 0usize)]
        };
        while let Some((at, depth)) = stack.pop() {
            let n = &self.nodes[at];
            out.push((depth, n.kids.is_none(), n.bounds));
            if let Some((a, b)) = n.kids {
                stack.push((b, depth + 1));
                stack.push((a, depth + 1));
            }
        }
        out
    }

    /// The query's items: a view's and a box's in ID order, the nearest and those within a radius
    /// by distance, then ID.
    pub fn answer(&self, q: &Query) -> Result<Vec<String>, Refused> {
        let mut out: Vec<(f64, &str)> = Vec::new();
        match q {
            Query::View(id) => {
                let Some(cam) = self.cameras.get(id) else {
                    return Err(Refused {
                        code: "ref_unresolved",
                        path: format!("items/{id}"),
                    });
                };
                let p = planes(cam);
                if self.plants.cull_by_center {
                    for (id, b) in &self.order {
                        let c = b.centre();
                        if p.iter().all(|(n, k)| dot(*n, c) + k >= 0.0) {
                            out.push((0.0, id));
                        }
                    }
                } else {
                    self.walk(
                        |b| !outside(&p, b),
                        |id, b| {
                            if !outside(&p, b) {
                                out.push((0.0, id));
                            }
                        },
                    );
                }
            }
            Query::Box(q) => self.walk(
                |b| b.touches(q),
                |id, b| {
                    if b.touches(q) {
                        out.push((0.0, id));
                    }
                },
            ),
            Query::Radius(p, r) => self.walk(
                |b| b.distance(*p) <= *r,
                |id, b| {
                    let d = b.distance(*p);
                    if d <= *r {
                        out.push((d, id));
                    }
                },
            ),
            Query::Nearest(p, n) => {
                // Best first: a node is left only when n items are nearer than all of it.
                let worst = Cell::new(f64::INFINITY);
                self.walk(
                    |b| b.distance(*p) <= worst.get(),
                    |id, b| {
                        out.push((b.distance(*p), id));
                        if out.len() >= *n {
                            out.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(b.1)));
                            out.truncate(*n);
                            worst.set(out.last().map_or(f64::INFINITY, |x| x.0));
                        }
                    },
                );
                if *n == 0 {
                    out.clear();
                }
            }
        }
        out.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(b.1)));
        Ok(out.into_iter().map(|(_, id)| id.to_string()).collect())
    }

    /// Visits each item under a node `enter` accepts.
    fn walk<'a>(
        &'a self,
        mut enter: impl FnMut(&Aabb) -> bool,
        mut visit: impl FnMut(&'a str, &Aabb),
    ) {
        let mut stack = if self.nodes.is_empty() {
            vec![]
        } else {
            vec![0]
        };
        while let Some(i) = stack.pop() {
            let node = &self.nodes[i];
            if !enter(&node.bounds) {
                continue;
            }
            match node.kids {
                Some((a, b)) => stack.extend([b, a]),
                None => {
                    for (id, b) in &self.order[node.start..node.end] {
                        visit(id, b);
                    }
                }
            }
        }
    }

    /// The `items` part of the `spatial` reply.
    pub fn items_json(&self) -> Value {
        let items: Map<String, Value> = self
            .entries
            .iter()
            .map(|(id, e)| {
                (
                    id.clone(),
                    json!({"bounds": e.bounds.map(|b| b.json()), "subtree": e.subtree.map(|b| b.json()),
                           "children": e.children}),
                )
            })
            .collect();
        Value::Object(items)
    }
}

/// An item's own bounds with its children's subtrees; under the plant, their own bounds.
fn subtree(
    entries: &BTreeMap<String, Entry>,
    id: &str,
    plants: Plants,
    path: &mut Vec<String>,
) -> Option<Aabb> {
    let e = entries.get(id)?;
    if path.iter().any(|p| p == id) {
        return None;
    }
    path.push(id.to_string());
    let mut out = e.bounds;
    for c in &e.children {
        let sub = if plants.bounds_children_only {
            entries.get(c).and_then(|x| x.bounds)
        } else {
            subtree(entries, c, plants, path)
        };
        out = match (out, sub) {
            (Some(a), Some(b)) => Some(a.union(b)),
            (a, b) => a.or(b),
        };
    }
    path.pop();
    out
}

/// The hierarchy over `order[start..end]`: split at the median of the longest axis of the
/// centres, ties by ID, so the same items always build the same tree.
fn build(order: &mut [(String, Aabb)], start: usize, end: usize, nodes: &mut Vec<Node>) -> usize {
    let slice = &mut order[start..end];
    let bounds = slice
        .iter()
        .skip(1)
        .fold(slice[0].1, |a, (_, b)| a.union(*b));
    let at = nodes.len();
    nodes.push(Node {
        bounds,
        start,
        end,
        kids: None,
    });
    if end - start > LEAF {
        let centres = Aabb::of(&slice.iter().map(|(_, b)| b.centre()).collect::<Vec<_>>());
        let ext = [0, 1, 2].map(|k| centres.max[k] - centres.min[k]);
        let axis = (0..3).fold(0, |a, k| if ext[k] > ext[a] { k } else { a });
        slice.sort_by(|a, b| {
            a.1.centre()[axis]
                .total_cmp(&b.1.centre()[axis])
                .then(a.0.cmp(&b.0))
        });
        let mid = start + (end - start) / 2;
        let a = build(order, start, mid, nodes);
        let b = build(order, mid, end, nodes);
        nodes[at].kids = Some((a, b));
    }
    at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_answers_as_a_scan() {
        let mut items = Map::new();
        items.insert(
            "cam".into(),
            json!({"kind": "camera@1", "params": {"projection": "perspective",
            "position": [0, 5, 20], "target": [0, 0, 0], "fov": 40, "near": 0.5, "far": 30}}),
        );
        for i in 0..40 {
            let f = f64::from(i);
            items.insert(format!("b{i:02}"), json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]},
                "at": {"pos": [(f * 7.3) % 30.0 - 15.0, 0, (f * 3.1) % 40.0 - 25.0], "rot": [0, f * 17.0, 0]}}));
        }
        let doc = json!({"size": [640, 400], "camera": "cam", "items": items});
        let index = Index::new(&doc, 0, Plants::default()).expect("indexed");
        let all: Vec<(&String, Aabb)> = index
            .entries
            .iter()
            .filter_map(|(id, e)| Some((id, e.bounds?)))
            .collect();
        let q = Aabb {
            min: [-5.0, -1.0, -5.0],
            max: [5.0, 1.0, 5.0],
        };
        let scan: Vec<String> = all
            .iter()
            .filter(|(_, b)| b.touches(&q))
            .map(|(id, _)| id.to_string())
            .collect();
        assert_eq!(index.answer(&Query::Box(q)).expect("answered"), scan);
        let p = planes(&index.cameras["cam"]);
        let scan: Vec<String> = all
            .iter()
            .filter(|(_, b)| !outside(&p, b))
            .map(|(id, _)| id.to_string())
            .collect();
        let view = index.answer(&Query::View("cam".into())).expect("answered");
        assert_eq!(view, scan);
        assert!(
            view.len() > 3 && view.len() < 40,
            "the view keeps some, not all: {view:?}"
        );
        let mut by: Vec<(f64, String)> = all
            .iter()
            .map(|(id, b)| (b.distance([1.0, 0.0, 2.0]), id.to_string()))
            .collect();
        by.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let nearest: Vec<String> = by.iter().take(5).map(|x| x.1.clone()).collect();
        assert_eq!(
            index
                .answer(&Query::Nearest([1.0, 0.0, 2.0], 5))
                .expect("answered"),
            nearest
        );
    }
}
