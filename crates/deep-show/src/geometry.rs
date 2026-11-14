//! `geometry` and `kinds` (issue #420; the #420 acceptance README: The surface under test): an
//! item's built mesh read back from its build node in a clean evaluation at t, or its vertex
//! count from its params alone with nothing built; and every kind the build registers with its
//! schema, dirty map, reads, fixture and sweep.

use deep_canvas::schedule::{Hasher, Val};
use deep_canvas_scene3d::build::{spec_of, Built};
use deep_canvas_scene3d::builders::{self, Ctx, Plants};
use deep_canvas_scene3d::geom::{EdgeKind, Mesh};
use deep_canvas_scene3d::stack;
use serde_json::{json, Map, Value};

use crate::frames::session_view;
use crate::hub::EvalTime;
use crate::hub::Hub;

pub(crate) mod shape;

/// `geometry`: which items, at what time, which stage, and whether to count only.
#[derive(Debug)]
pub struct Geometry {
    pub doc: String,
    pub items: Option<Vec<String>>,
    pub t: EvalTime,
    pub built: bool,
    pub estimate_only: bool,
    /// Fractions of arc length a `curve@1` row answers at (#441).
    pub at: Vec<f64>,
    /// The block count to run the stack at, in place of scene3d's (#440).
    pub blocks: Option<usize>,
    /// How many corners each face of the builder's mesh is turned by before the stack (#440).
    pub rotate: usize,
    /// Each item built afresh, with its steps' CPU times in milliseconds (#2017).
    pub timings: bool,
}

/// Milliseconds on a monotonic clock since its first reading in this process: what `timings`
/// read around each step (#2017).
fn now_ms() -> f64 {
    static EPOCH: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    EPOCH
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1e3
}

pub fn parse(c: &Map<String, Value>) -> Option<Geometry> {
    let items = match c.get("items") {
        None => None,
        Some(v) => Some(
            v.as_array()?
                .iter()
                .map(|i| i.as_str().map(str::to_string))
                .collect::<Option<_>>()?,
        ),
    };
    let built = match c.get("stage").map(Value::as_str) {
        None | Some(Some("final")) => false,
        Some(Some("built")) => true,
        _ => return None,
    };
    let estimate_only = match c.get("estimate_only") {
        None => false,
        Some(v) => v.as_bool()?,
    };
    let at = match c.get("at") {
        None => Vec::new(),
        Some(v) => v
            .as_array()?
            .iter()
            .map(|u| u.as_f64().filter(|u| (0.0..=1.0).contains(u)))
            .collect::<Option<_>>()?,
    };
    let blocks = match c.get("blocks") {
        None => None,
        Some(v) => Some(v.as_u64().filter(|b| (1..=64).contains(b))? as usize),
    };
    let rotate = match c.get("rotate_corners") {
        None => 0,
        Some(v) => v.as_u64()? as usize,
    };
    let timings = match c.get("timings") {
        None => false,
        Some(v) => v.as_bool()?,
    };
    Some(Geometry {
        at,
        blocks,
        rotate,
        timings,
        doc: c.get("doc")?.as_str()?.to_string(),
        items,
        t: crate::time::eval_time(c.get("t"))?,
        built,
        estimate_only,
    })
}

const BUILD_OPS: [&str; 3] = ["scene3d.build", "scene3d.rebuild", "building.build"];

fn has_geometry(kind: &str) -> bool {
    builders::KINDS.contains(&kind)
        || deep_canvas_scene3d::building::KINDS.contains(&kind)
        || kind == ASSET
}

const ASSET: &str = "mesh.asset@1";

/// A `curve@1` row (#441): its length and closure, and at each u of `at` its point, frame and
/// d²P/du²; with `timings`, how long its arc-length table took (#2017).
fn curve_row(
    id: &str,
    key: &str,
    item: &Value,
    at: &[f64],
    planted: Option<&str>,
    timings: bool,
) -> Value {
    use deep_canvas_scene3d::curve::Curve;
    let params = item.get("params").cloned().unwrap_or(json!({}));
    let made = if timings {
        Curve::timed(&params, now_ms).map(|(c, ms)| (c, Some(ms)))
    } else {
        Curve::new(&params).map(|c| (c, None))
    };
    let (mut c, arc_length_ms) = match made {
        Ok(c) => c,
        Err(path) => return json!({"code": "out_of_range", "path": format!("items/{id}/{path}")}),
    };
    c.seam_twist = planted
        .and_then(Plants::named)
        .is_some_and(|p| p.sweep.seam_twist);
    let rows: Vec<Value> = at
        .iter()
        .map(|u| {
            let f = c.frame(*u);
            json!({"u": u, "point": f.point, "tangent": f.tangent, "normal": f.normal,
                   "binormal": f.binormal(), "accel": c.accel(*u)})
        })
        .collect();
    let mut row = json!({"id": id, "kind": "curve@1", "key": key,
           "outputs": {"length": c.length, "closure": c.closure.to_degrees()}, "at": rows});
    if let Some(ms) = arc_length_ms {
        row["arc_length_ms"] = json!(ms);
    }
    row
}

/// A `mesh.asset@1`'s mesh, its glTF read from the evidence store by sha256; or the refusal.
fn asset_mesh(evidence: &std::path::Path, id: &str, item: &Value) -> Result<Mesh, Value> {
    let at = format!("items/{id}/params/sha256");
    let sha = item
        .pointer("/params/sha256")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let bytes = crate::evidence::read(evidence, sha)
        .ok_or_else(|| json!({"code": "asset_missing", "path": at}))?;
    let node = item.pointer("/params/node").cloned().unwrap_or(json!(0));
    deep_canvas_scene3d::gltf::mesh(&bytes, &node)
        .map_err(|why| json!({"code": "out_of_range", "path": format!("items/{id}/{}", why.split(':').next().unwrap_or(""))}))
}

/// A row's `declared`: its vertices, and its welded points, edges and faces where known (#440).
fn declared_json(vertices: u64, welded: Option<[u64; 3]>) -> Value {
    match welded {
        Some([p, e, f]) => json!({"vertices": vertices, "points": p, "edges": e, "faces": f}),
        None => json!({"vertices": vertices}),
    }
}

/// An item's placement from its `at` (scale, then rotate R = Rz·Ry·Rx in degrees, then the
/// position), item space to world.
fn placement(item: &Value) -> impl Fn([f64; 3]) -> [f64; 3] {
    let three = |k: &str, d: f64| -> [f64; 3] {
        match item.pointer(&format!("/at/{k}")) {
            Some(Value::Number(n)) => [n.as_f64().unwrap_or(d); 3],
            Some(Value::Array(a)) => {
                [0, 1, 2].map(|i| a.get(i).and_then(Value::as_f64).unwrap_or(d))
            }
            _ => [d; 3],
        }
    };
    let (pos, rot, size) = (three("pos", 0.0), three("rot", 0.0), three("scale", 1.0));
    let [sx, sy, sz] = rot.map(|a| deep_canvas::ops::sin(deep_canvas::ops::rad(a)));
    let [cx, cy, cz] = rot.map(|a| deep_canvas::ops::cos(deep_canvas::ops::rad(a)));
    move |p: [f64; 3]| {
        let q = [p[0] * size[0], p[1] * size[1], p[2] * size[2]];
        let q = [q[0], cx * q[1] - sx * q[2], sx * q[1] + cx * q[2]];
        let q = [cy * q[0] + sy * q[2], q[1], -sy * q[0] + cy * q[2]];
        let q = [cz * q[0] - sz * q[1], sz * q[0] + cz * q[1], q[2]];
        [q[0] + pos[0], q[1] + pos[1], q[2] + pos[2]]
    }
}

impl Hub<'_> {
    pub(crate) fn geometry(&mut self, g: &Geometry) -> Value {
        let t = match self.resolve_time(&g.doc, &g.t) {
            Ok(t) => t,
            Err(code) => return json!({"code": code}),
        };
        // #524: a soft body's skin draws its item where its particles are at `t`.
        if self
            .played_form(&g.doc)
            .is_some_and(|f| deep_canvas_physics::skin::writes(&f))
        {
            self.load_frame(&g.doc, t);
        }
        let planted = self.scenario.module_planted.clone();
        let outlines = self.startup.sealed.outlines.clone();
        let Some(session) = self.sessions.get(&g.doc) else {
            return json!({"code": "no_revision"});
        };
        let Some(doc) = session.document().cloned() else {
            return json!({"code": "no_revision"});
        };
        let empty = Map::new();
        let items = doc
            .get("items")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let ids: Vec<String> = match &g.items {
            Some(list) => list.clone(),
            None => items
                .iter()
                .filter(|(_, v)| has_geometry(v.get("kind").and_then(Value::as_str).unwrap_or("")))
                .map(|(k, _)| k.clone())
                .collect(),
        };
        if g.estimate_only {
            let ctx = Ctx {
                id: "",
                doc: &doc,
                plants: planted
                    .as_deref()
                    .and_then(Plants::named)
                    .unwrap_or_default(),
                outlines: &outlines,
                planted: planted.as_deref(),
            };
            let mut out = Vec::new();
            for id in &ids {
                let Some(item) = items.get(id) else {
                    return json!({"code": "ref_unresolved", "path": format!("items/{id}")});
                };
                let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
                let params = item.get("params").cloned().unwrap_or(json!({}));
                if kind == ASSET {
                    let m = match asset_mesh(&self.scenario.evidence, id, item) {
                        Ok(m) => m,
                        Err(refused) => return refused,
                    };
                    let mut h = Hasher::new("deep-show.estimate");
                    h.bytes(&deep_canvas::schedule::canonical(item));
                    out.push(json!({"id": id, "kind": kind, "declared": {"vertices": m.positions.len()}, "key": h.finish().hex()}));
                    continue;
                }
                let run = stack::Run {
                    planted: planted.clone(),
                    blocks: g.blocks,
                    rotate: g.rotate,
                    outlines: outlines.clone(),
                    fills: self.startup.sealed.fills.clone(),
                    clock: None,
                };
                let ctx = Ctx {
                    id: id.as_str(),
                    ..ctx
                };
                let counted = builders::counts(kind, &params, &ctx).and_then(|c| {
                    // A stack that reads its mesh's topology counts on the builder's mesh, or on
                    // the mesh the steps before it leave.
                    let before = |k: usize| -> Result<Mesh, String> {
                        let mesh = builders::build(kind, &params, &ctx)?;
                        Ok(stack::apply(mesh, &stack::prefix(item, k), &doc, id, 0.0, &run)?.0)
                    };
                    stack::estimate(c, item, &before)
                });
                let declared = match counted {
                    Ok(d) => declared_json(d.vertices, d.welded),
                    Err(path) => {
                        return json!({"code": "out_of_range", "path": format!("items/{id}/{path}")})
                    }
                };
                // What the count reads: the item's geometry and the items it names.
                let mut h = Hasher::new("deep-show.estimate");
                h.bytes(&deep_canvas::schedule::canonical(item));
                out.push(
                    json!({"id": id, "kind": kind, "declared": declared, "key": h.finish().hex()}),
                );
            }
            return json!({"builds": 0, "items": out});
        }
        let view = session_view(session, &Map::new());
        let scratch = session.clean(&mut self.sched, t, &view, None);
        let nodes = scratch.nodes(&self.sched);
        let builds = nodes
            .iter()
            .filter(|n| BUILD_OPS.contains(&n.operator.as_str()))
            .count();
        // Each item's world matrix at t, as its instance record holds it (#433).
        let worlds: std::collections::HashMap<String, deep_canvas_scene3d::scene::Affine3> =
            deep_canvas_scene3d::scene::placed_at(&doc, t)
                .map(|p| p.into_iter().map(|(id, _, m)| (id, m)).collect())
                .unwrap_or_default();
        // #226: a point's row is where the frame draws it, after its modifiers and its parents.
        let pointed = ids.iter().any(|id| {
            items
                .get(id)
                .and_then(|i| i.get("kind"))
                .and_then(Value::as_str)
                == Some("mark.point@1")
        });
        let points = if pointed {
            let sealed = &self.startup.sealed;
            match crate::scene3d::points_at(&doc, t, &self.look.light, sealed, planted.as_deref()) {
                Ok(points) => points,
                Err(u) => return json!({"code": u.code, "path": u.path}),
            }
        } else {
            Default::default()
        };
        let mut out = Vec::new();
        let node_of = |id: &str| {
            nodes
                .iter()
                .find(|n| BUILD_OPS.contains(&n.operator.as_str()) && n.item.as_deref() == Some(id))
        };
        for id in &ids {
            if let Some(pos) = points.get(id) {
                out.push(json!({"id": id, "kind": "mark.point@1", "pos": pos}));
                continue;
            }
            // A mesh-edge line answers the segments it draws (#440).
            if let Some(line) = items.get(id).filter(|i| {
                i.get("kind").and_then(Value::as_str) == Some("mark.line@1")
                    && i.pointer("/params/edges").is_some()
            }) {
                let edges = &line["params"]["edges"];
                let of = edges.get("of").and_then(Value::as_str).unwrap_or("");
                let target = of.split('#').next().unwrap_or("");
                let mesh = node_of(target)
                    .and_then(|n| n.values.first())
                    .and_then(Val::as_typed::<Built>)
                    .and_then(|b| b.mesh.clone());
                let (Some(mesh), Some(kind)) = (mesh, EdgeKind::read(edges).ok()) else {
                    return json!({"code": "ref_unresolved", "path": format!("items/{id}/params/edges/of")});
                };
                let place = placement(items.get(target).unwrap_or(&Value::Null));
                let segments: Vec<[[f64; 3]; 2]> = mesh
                    .edge_list(kind, planted.as_deref())
                    .into_iter()
                    .map(|[a, b]| [place(a), place(b)])
                    .collect();
                out.push(json!({"id": id, "kind": "mark.line@1", "segments": segments}));
                continue;
            }
            // #2013: an instancer's row is its elements as its scatter (or its written columns)
            // feeds them, each point in world metres.
            if let Some(item) = items
                .get(id)
                .filter(|i| i.get("kind").and_then(Value::as_str) == Some("instance@1"))
            {
                // #2017: a scatter is laid out afresh on every call; with `timings`, the time
                // from its document to the elements this row lists.
                let started =
                    (g.timings && item.pointer("/params/from/distribute").is_some()).then(now_ms);
                let rows = match deep_canvas_scene3d::scene::elements_at(
                    &doc,
                    t,
                    id,
                    planted.as_deref(),
                ) {
                    Ok(rows) => rows.unwrap_or_default(),
                    Err(r) => return json!({"code": r.code, "path": r.path}),
                };
                let distribute_ms = started.map(|s| now_ms() - s);
                let world = worlds.get(id.as_str());
                let elements: Vec<Value> = rows
                    .iter()
                    .map(|r| {
                        let mut e = r.to_json();
                        if let Some(w) = world {
                            e["pos"] = json!([0, 1, 2].map(|i| w[i][0] * r.pos[0]
                                + w[i][1] * r.pos[1]
                                + w[i][2] * r.pos[2]
                                + w[i][3]));
                        }
                        e
                    })
                    .collect();
                let mut row =
                    json!({"id": id, "kind": "instance@1", "elements": elements, "world": world});
                if let Some(ms) = distribute_ms {
                    row["distribute_ms"] = json!(ms);
                }
                out.push(row);
                continue;
            }
            let Some(node) = nodes.iter().find(|n| {
                BUILD_OPS.contains(&n.operator.as_str()) && n.item.as_deref() == Some(id)
            }) else {
                return json!({"code": "ref_unresolved", "path": format!("items/{id}")});
            };
            if let Some(item) = items
                .get(id)
                .filter(|i| i.get("kind").and_then(Value::as_str) == Some("curve@1"))
            {
                let row = curve_row(id, &node.key, item, &g.at, planted.as_deref(), g.timings);
                if row.get("code").is_some() {
                    return row;
                }
                out.push(row);
                continue;
            }
            // Asked for another block count or turned corners: built again so; with timings,
            // built afresh with each step timed (#2017).
            let rebuilt = (g.blocks.is_some() || g.rotate > 0 || g.timings)
                .then(|| items.get(id))
                .flatten()
                .filter(|i| {
                    builders::KINDS.contains(&i.get("kind").and_then(Value::as_str).unwrap_or(""))
                })
                .map(|i| {
                    let run = stack::Run {
                        planted: planted.clone(),
                        blocks: g.blocks,
                        rotate: g.rotate,
                        outlines: outlines.clone(),
                        fills: self.startup.sealed.fills.clone(),
                        clock: g.timings.then_some(now_ms as fn() -> f64),
                    };
                    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
                    deep_canvas_scene3d::build::built(&doc, id, i, &run, seconds)
                });
            let rebuilt = match rebuilt {
                Some(Ok(b)) => Some(std::sync::Arc::new(b)),
                Some(Err(path)) => {
                    return json!({"code": "out_of_range", "path": format!("items/{id}/{path}")})
                }
                None => None,
            };
            let Some(b) = rebuilt.or_else(|| node.values.first().and_then(Val::as_typed::<Built>))
            else {
                let issue = scratch
                    .report
                    .issues
                    .iter()
                    .find(|i| i.path.starts_with(&format!("items/{id}")));
                return json!({"code": issue.map_or("input_failed", |i| i.code), "path": issue.map_or(format!("items/{id}"), |i| i.path.clone())});
            };
            let asset = if b.kind == ASSET {
                match asset_mesh(
                    &self.scenario.evidence,
                    id,
                    items.get(id).unwrap_or(&Value::Null),
                ) {
                    Ok(m) => Some(m),
                    Err(refused) => return refused,
                }
            } else {
                None
            };
            let mesh = if asset.is_some() {
                asset.as_ref()
            } else if g.built {
                b.built.as_ref()
            } else {
                b.mesh.as_ref()
            };
            // A built row counts the builder's mesh: its vertices, and its welded points, edges
            // and faces (#2017).
            let builder = g.built
                && spec_of(&b.kind).is_some_and(|_| builders::KINDS.contains(&b.kind.as_str()));
            let welded = if builder {
                b.built.as_ref().map(stack::welded)
            } else {
                b.welded
            };
            let declared = if builder {
                let params = items
                    .get(id)
                    .and_then(|i| i.get("params"))
                    .cloned()
                    .unwrap_or(json!({}));
                let ctx = Ctx {
                    id: id.as_str(),
                    doc: &doc,
                    plants: planted
                        .as_deref()
                        .and_then(Plants::named)
                        .unwrap_or_default(),
                    outlines: &outlines,
                    planted: planted.as_deref(),
                };
                builders::estimate(&b.kind, &params, &ctx).unwrap_or(b.declared)
            } else if let Some(m) = &asset {
                m.positions.len() as u64
            } else {
                b.declared
            };
            let mut row = json!({"id": id, "kind": b.kind, "declared": declared_json(declared, welded), "key": node.key,
                                 "blocks": b.blocks,
                                 "stack": b.rows.iter().map(|r| {
                                     let mut step = r.to_json();
                                     if let Some(ms) = r.ms {
                                         step["ms"] = json!(ms);
                                     }
                                     step
                                 }).collect::<Vec<_>>()});
            if let Some(m) = mesh {
                if let (Value::Object(r), Value::Object(mut mj)) = (&mut row, m.to_json()) {
                    // A sweep's or a tube's rings stand on the row itself (#441).
                    let rings = mj
                        .get_mut("outputs")
                        .and_then(Value::as_object_mut)
                        .and_then(|o| o.remove("rings"));
                    r.extend(mj);
                    if let Some(rings) = rings {
                        r.insert("rings".into(), rings);
                    }
                    if let Some(w) = worlds.get(id.as_str()) {
                        r.insert("world".into(), json!(w));
                    }
                }
            }
            out.push(row);
        }
        json!({"builds": builds, "items": out})
    }

    /// `kinds`: every kind the build registers, scene3d's and the building module's with their
    /// schemas, dirty maps, reads, fixtures and sweeps.
    pub(crate) fn kind_schemas_reply(&self) -> Value {
        let planted = self.scenario.module_planted.as_deref();
        let kinds: Vec<Value> = crate::kit::manifest::Manifest::kinds_of(&self.startup.sealed)
            .into_iter()
            .map(|k| {
                let module = self.module_of(&k);
                match spec_of(&k).filter(|s| s.module == module) {
                    Some(spec) => deep_canvas_scene3d::spec::row(&spec, planted),
                    None => json!({"kind": k, "module": module, "params": {}, "dirty": {}, "fixture": null, "sweep": {}}),
                }
            })
            .collect();
        json!({"kinds": kinds})
    }
}
