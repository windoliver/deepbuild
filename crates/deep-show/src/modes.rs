//! deep_show's diagnostic modes (issue #411; #427 the 3D ones; canvas primitives: Render-back:
//! diagnostic modes): the same frame at t drawn as a view in place of the look, returned as a
//! display-only snapshot by hash with what it drew as numbers. A mode is a tool entry of the
//! canvas module whose data it draws; one no module in this build draws answers
//! `module_missing`, naming the module, never an empty snapshot. A mode call without a document
//! draws the current revision and mints none; it draws offscreen, never on a live view. Nothing a
//! mode returns feeds a check or counts as evidence: its snapshot is held as display only.

use deep_canvas::schedule::core_ops::{Fields, Transform};
use deep_canvas_scene3d::scene::{Affine3, Layer3, Line, Scene, Segment};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted, Show};

/// The closed list, each with the canvas module whose data it draws.
pub const MODES: [(&str, &str); 20] = [
    ("lighting_only", "scene3d"),
    ("overdraw", "scene3d"),
    ("normals", "scene3d"),
    ("cascade_splits", "scene3d"),
    ("shadow_atlas", "scene3d"),
    ("luminance_false_color", "scene3d"),
    ("lights_per_cluster", "scene3d"),
    ("lod_per_item", "scene3d"),
    ("receivers_casters", "scene3d"),
    ("skeleton", "skin"),
    ("lights_cameras", "scene3d"),
    ("bounds", "core"),
    ("physics_shapes", "physics"),
    ("uv_checker", "scene3d"),
    // #427's further modes.
    ("deviation", "scene3d"),
    ("tangents", "scene3d"),
    ("probes", "scene3d"),
    ("sound_sources", "media"),
    ("motion_paths", "scene3d"),
    ("pick_hierarchy", "scene3d"),
];

/// The modes that need data no module in this build evaluates yet: skeleton with skinned
/// playback (#130), physics shapes with the physics module (#97).
const UNDRAWN: [&str; 2] = ["skeleton", "physics_shapes"];

/// The UV checker's cells per uv0 unit.
const PER_UNIT: f64 = 8.0;
/// A normal or tangent line's length, m.
const NORMAL_M: f64 = 0.05;

/// A mode call's request: the mode and what it reads (#427: README, Assumed surfaces 3).
pub struct ModeArgs {
    pub mode: String,
    /// #412: where the readings an earlier answer cut at 64 KB left off.
    pub cursor: usize,
    /// deviation: the item measured, and its reference asset's SHA-256.
    pub item: Option<String>,
    pub reference: Option<String>,
    /// motion paths: the items and the span, flicks.
    pub select: Vec<String>,
    pub span: Option<[i64; 2]>,
    /// pick hierarchy: the deepest level drawn, the root's 0.
    pub depth: Option<usize>,
}

/// A mode's canvas module, for a name on the closed list.
pub fn owner(mode: &str) -> Option<&'static str> {
    MODES.iter().find(|(m, _)| *m == mode).map(|(_, o)| *o)
}

/// An item's evaluated 2D box `[x, y, w, h]` in its own space, from its lowered params.
fn local_box(fields: &Value) -> Option<[f64; 4]> {
    let params = fields.get("params")?;
    let n = |v: &Value| v.as_f64();
    if let Some(Value::Array(b)) = params.get("box") {
        let v: Vec<f64> = b.iter().map(n).collect::<Option<_>>()?;
        return <[f64; 4]>::try_from(v.as_slice()).ok();
    }
    if let (Some(Value::Array(c)), Some(r)) = (params.get("center"), params.get("r").and_then(n)) {
        let (x, y) = (n(c.first()?)?, n(c.get(1)?)?);
        return Some([x - r, y - r, 2.0 * r, 2.0 * r]);
    }
    let b = params.get("box")?;
    Some([0.0, 0.0, n(b.get("w")?)?, n(b.get("h")?)?])
}

/// The box's corners under the world transform: scaled, turned about z, moved; their bounds.
fn world_bounds(b: [f64; 4], t: &Transform) -> ([f64; 3], [f64; 3]) {
    let a = deep_canvas::ops::rad(t.rot[2]);
    let (cos, sin) = if t.rot[2] == 0.0 {
        (1.0, 0.0)
    } else {
        (deep_canvas::ops::cos(a), deep_canvas::ops::sin(a))
    };
    let mut min = [f64::INFINITY, f64::INFINITY, t.pos[2]];
    let mut max = [f64::NEG_INFINITY, f64::NEG_INFINITY, t.pos[2]];
    for (x, y) in [
        (b[0], b[1]),
        (b[0] + b[2], b[1]),
        (b[0], b[1] + b[3]),
        (b[0] + b[2], b[1] + b[3]),
    ] {
        let (x, y) = (x * t.scale[0], y * t.scale[1]);
        let p = [t.pos[0] + x * cos - y * sin, t.pos[1] + x * sin + y * cos];
        for k in 0..2 {
            min[k] = min[k].min(p[k]);
            max[k] = max[k].max(p[k]);
        }
    }
    (min, max)
}

type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn unit(a: V3) -> V3 {
    let l = dot(a, a).sqrt();
    if l > 0.0 {
        mul(a, 1.0 / l)
    } else {
        a
    }
}

/// A point under an affine map (rows).
fn apply(m: &Affine3, p: V3) -> V3 {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}
/// A direction under the map's linear part.
fn turn(m: &Affine3, d: V3) -> V3 {
    [0, 1, 2].map(|r| m[r][0] * d[0] + m[r][1] * d[1] + m[r][2] * d[2])
}
/// A normal under the map: the inverse transpose of its linear part, by cofactors.
fn turn_normal(m: &Affine3, n: V3) -> V3 {
    let c = |i: usize| [m[0][i], m[1][i], m[2][i]];
    let (a, b, d) = (c(0), c(1), c(2));
    let (x, y, z) = (cross(b, d), cross(d, a), cross(a, b));
    unit([
        x[0] * n[0] + y[0] * n[1] + z[0] * n[2],
        x[1] * n[0] + y[1] * n[1] + z[1] * n[2],
        x[2] * n[0] + y[2] * n[1] + z[2] * n[2],
    ])
}
fn origin(m: &Affine3) -> V3 {
    [m[0][3], m[1][3], m[2][3]]
}

/// A box's twelve edges.
fn box_edges(min: V3, max: V3) -> Vec<(V3, V3)> {
    let c = |i: usize| {
        [
            if i & 1 == 0 { min[0] } else { max[0] },
            if i & 2 == 0 { min[1] } else { max[1] },
            if i & 4 == 0 { min[2] } else { max[2] },
        ]
    };
    let mut out = Vec::new();
    for i in 0..8usize {
        for bit in [1, 2, 4] {
            if i & bit == 0 {
                out.push((c(i), c(i | bit)));
            }
        }
    }
    out
}

/// A circle of 32 segments about `centre` in the plane of `u` and `v` (unit, perpendicular).
fn circle(centre: V3, u: V3, v: V3, r: f64) -> Vec<(V3, V3)> {
    let at = |k: usize| {
        let a = std::f64::consts::TAU * k as f64 / 32.0;
        add(centre, add(mul(u, r * a.cos()), mul(v, r * a.sin())))
    };
    (0..32).map(|k| (at(k), at(k + 1))).collect()
}

/// Two unit vectors perpendicular to `d` and to each other.
fn basis(d: V3) -> (V3, V3) {
    let up = if d[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let u = unit(cross(d, up));
    (u, cross(d, u))
}

/// What one 3D mode read and draws: its rows, its lines and, for deviation, its summary.
#[derive(Default)]
struct Read {
    rows: Vec<Value>,
    lines: Vec<(V3, V3)>,
    extra: Map<String, Value>,
}

/// The view a mode draws its surfaces in.
fn view_of(mode: &str) -> Option<deep_scene3d_render::Diag> {
    use deep_scene3d_render::Diag;
    Some(match mode {
        "lighting_only" => Diag::LightingOnly,
        "overdraw" => Diag::Overdraw,
        "cascade_splits" => Diag::CascadeSplits,
        "shadow_atlas" => Diag::ShadowAtlas,
        "luminance_false_color" => Diag::Luminance,
        "lights_per_cluster" => Diag::LightsPerCluster,
        "lod_per_item" => Diag::LodPerItem,
        "receivers_casters" => Diag::ReceiversCasters,
        _ => return None,
    })
}

impl Hub<'_> {
    /// A deep_show or deep show call in a diagnostic mode, its readings from its cursor.
    pub fn mode_show(&mut self, show: &Show, args: &ModeArgs) -> Value {
        let mode = args.mode.as_str();
        let module = owner(mode).unwrap_or("core");
        let missing = |module: &str| {
            json!({"outcome": "refused", "code": "module_missing", "module": module,
                   "mode": mode, "issues": [], "snapshots": [], "drawn": []})
        };
        let built = module == "core"
            || self.startup.sealed.modules.iter().any(|m| m.name == module)
                && (module == "scene3d"
                    || self
                        .startup
                        .sealed
                        .modules
                        .iter()
                        .any(|m| m.name == "scene3d"));
        if UNDRAWN.contains(&mode) || !built {
            return missing(module);
        }
        // With a document the call is a deep_show that also draws the mode (#411); without one
        // it draws the current revision and mints none (#427).
        let mut reply = if show.document.is_null() {
            match self.current(&show.doc) {
                Some(r) => json!({"outcome": "presented", "rev": r.rev, "issues": []}),
                None => {
                    return json!({"outcome": "refused", "code": "no_revision", "mode": mode,
                                  "snapshots": [], "drawn": []});
                }
            }
        } else {
            let reply = self.show_call(show);
            if reply.get("outcome").and_then(Value::as_str) != Some("presented") {
                return reply;
            }
            reply
        };
        let Some(revision) = self.query_revision(&show.doc, None) else {
            return json!({"outcome": "refused", "code": "no_revision", "mode": mode,
                          "snapshots": [], "drawn": []});
        };
        reply["rev"] = json!(revision.rev);
        // A document with a 3D layer, or one that requires scene3d, such as one of glTF meshes.
        let three = deep_canvas_scene3d::scene::has_3d(&revision.drawn)
            || revision
                .drawn
                .pointer("/requires/modules/scene3d")
                .is_some();
        let drawn = if three {
            match self.mode_3d(show, args, &revision.drawn, &mut reply) {
                Ok(rows) => rows,
                Err(refusal) => return refusal,
            }
        } else if mode == "bounds" {
            let drawn = self.bounds_at(&show.doc, show.t);
            reply["snapshots"] = json!([]);
            if let Some((sha, picture, size)) = self.bounds_picture(&show.doc, &drawn, show.size) {
                let mut entry = crate::snapshot::entry(&sha, &picture, size);
                entry["display_only"] = json!(true);
                self.display_only.insert(sha);
                reply["snapshots"] = json!([entry]);
            }
            drawn
        } else {
            // A 3D mode on a document with no 3D layer: nothing for it to draw.
            return json!({"outcome": "refused", "code": "out_of_range", "path": "mode",
                          "mode": mode, "snapshots": [], "drawn": []});
        };
        reply["mode"] = json!(mode);
        reply["display_only"] = json!(true);
        // #412: the readings past what fits under 64 KB come on the next page, by its cursor.
        let (page, next) =
            crate::query::fitted(&drawn, args.cursor, crate::query::reply_room(&reply));
        reply["drawn"] = json!(page);
        if let Some(n) = next {
            reply["next"] = json!(n.to_string());
        }
        // A mode's picture and readings are never evidence: a check they'd pass stays unproven.
        if reply.get("result").and_then(Value::as_str) == Some("PASS") {
            reply["result"] = json!("INCONCLUSIVE");
            reply["reason"] = json!(
                "display_only: a diagnostic mode's snapshot and readings never count as evidence"
            );
        }
        reply
    }

    /// A 3D mode: the revision evaluated at t with its assets from the evidence store, read for
    /// the mode, drawn offscreen in its view with its lines over it, kept by hash as display
    /// only; the reply gains its snapshot and visible table. Its rows, or the refusal.
    fn mode_3d(
        &mut self,
        show: &Show,
        args: &ModeArgs,
        doc: &Value,
        reply: &mut Value,
    ) -> Result<Vec<Value>, Value> {
        let mode = args.mode.as_str();
        let refuse = |code: &str, extra: Value| {
            let mut r = json!({"outcome": "refused", "code": code, "mode": mode,
                               "snapshots": [], "drawn": []});
            if let (Some(r), Some(e)) = (r.as_object_mut(), extra.as_object()) {
                r.extend(e.clone());
            }
            r
        };
        let size = show.size.unwrap_or_else(|| {
            crate::snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)))
        });
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let palette = self.look.light.clone();
        let ink = palette.get("ink").copied().unwrap_or([0x1f, 0x23, 0x28]);
        let Some(gpu) = self.gpu3() else {
            return Err(refuse("unsupported_platform", json!({})));
        };
        let (mut scene, look) = gpu
            .evaluate(doc, show.t, &palette, size, &read)
            .map_err(|u| refuse(u.code, json!({"path": u.path})))?;
        let planted = |p: Planted| self.scenario.planted == Some(p);
        let mut diag = view_of(mode);
        let read_out = match mode {
            "bounds" => self.bounds_3d(
                &scene,
                doc,
                show.t,
                planted(Planted::BoundsAuthoredPosition),
            ),
            "lights_cameras" => lights_cameras(&scene, doc, planted(Planted::LightsLocalPosition)),
            "uv_checker" => {
                let fit = planted(Planted::CheckerFitsSurface);
                diag = Some(deep_scene3d_render::Diag::UvChecker { fit });
                uv_checker(&scene, fit)
            }
            "normals" => normals(&scene, planted(Planted::NormalsFromFaces)),
            "tangents" => tangents(&scene),
            "motion_paths" => motion_paths(doc, args)?,
            "pick_hierarchy" => pick_hierarchy(doc, show.t, args.depth.unwrap_or(usize::MAX))?,
            "probes" => self.probes(&scene),
            "sound_sources" => sound_sources(doc, show.t)?,
            "deviation" => {
                let (read_out, per_vertex, top) =
                    self.deviation(&scene, args, planted(Planted::DeviationOneWay))?;
                diag = Some(deep_scene3d_render::Diag::Deviation { per_vertex, top });
                read_out
            }
            _ => Read::default(),
        };
        // The visible table of the frame this mode drew, refreshed for every revision (the
        // planted one keeps a document's until its item count changes).
        let mut boxes = scene.boxes();
        if planted(Planted::ModeIdsByCount) {
            let count = doc
                .get("items")
                .and_then(Value::as_object)
                .map_or(0, Map::len);
            let kept = self
                .mode_ids
                .entry(show.doc.clone())
                .or_insert((count, boxes.clone()));
            if kept.0 != count {
                *kept = (count, boxes.clone());
            }
            boxes = kept.1.clone();
        }
        if !read_out.lines.is_empty() {
            scene.layers.push(Layer3 {
                id: "diagnostic".into(),
                solids: Vec::new(),
                lines: vec![Line {
                    id: "diagnostic".into(),
                    segments: read_out
                        .lines
                        .iter()
                        .map(|(a, b)| Segment {
                            a: *a,
                            b: *b,
                            wa: 1.5,
                            wb: 1.5,
                        })
                        .collect(),
                    world: false,
                    color: ink,
                    edges: None,
                    over: false,
                    joined: false,
                }],
                points: Vec::new(),
                labels: Vec::new(),
                puffs: Vec::new(),
            });
        }
        let diag = diag.unwrap_or(deep_scene3d_render::Diag::Plain);
        let gpu = self
            .gpu3()
            .ok_or_else(|| refuse("unsupported_platform", json!({})))?;
        let (rgba, counts) = gpu
            .render(&scene, &look, &diag)
            .ok_or_else(|| refuse("unsupported_platform", json!({})))?;
        let png = crate::snapshot::png(rgba, size);
        let sha = crate::evidence::put(&self.scenario.evidence, &png)
            .map_err(|_| refuse("evidence_unwritable", json!({})))?;
        self.display_only.insert(sha.clone());
        reply["snapshots"] =
            json!([{"sha256": sha, "w": size[0], "h": size[1], "display_only": true}]);
        reply["visible"] = crate::snapshot::visible(boxes, 1.0, size);
        if let Some(r) = reply.as_object_mut() {
            r.extend(read_out.extra);
        }
        let mut rows = read_out.rows;
        match mode {
            "overdraw" => {
                rows.push(json!({"id": "frame", "what": "overdraw", "max": counts.max_overdraw}))
            }
            "lights_per_cluster" => rows.push(json!({"id": "frame", "what": "lights_per_cluster",
                                                     "max": counts.max_lights_per_cluster})),
            "cascade_splits" => rows.push(json!({"id": "frame", "what": "cascade_splits",
                                                 "splits_m": counts.cascade_splits,
                                                 "drawn_by_frame": counts.cascaded})),
            _ => {}
        }
        Ok(rows)
    }

    /// Each solid's evaluated world bounds at t, as the frame draws it, by item ID.
    fn bounds_3d(&self, scene: &Scene, doc: &Value, t: i64, authored: bool) -> Read {
        let _ = t;
        let mut out = Read::default();
        for layer in &scene.layers {
            for s in &layer.solids {
                let pts = s.points();
                let (mut min, mut max) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
                for p in &pts {
                    for k in 0..3 {
                        min[k] = min[k].min(p[k]);
                        max[k] = max[k].max(p[k]);
                    }
                }
                if !min[0].is_finite() {
                    continue;
                }
                let mut pos = origin(&s.model);
                if authored {
                    // The planted reader: the document's authored position, not the one at t.
                    let at = authored_pos(doc, &s.id);
                    let shift = sub(at, pos);
                    min = add(min, shift);
                    max = add(max, shift);
                    pos = at;
                }
                out.lines.extend(box_edges(min, max));
                out.rows
                    .push(json!({"id": s.id, "what": "box", "pos": pos, "min": min, "max": max}));
            }
        }
        out
    }

    /// Each probe at its world position, drawn as a sphere shaded from its own stored data,
    /// which the evidence store keeps by hash.
    fn probes(&mut self, scene: &Scene) -> Read {
        let mut out = Read::default();
        for p in &scene.probes {
            let data = crate::evidence::put(&self.scenario.evidence, &p.data).ok();
            let (u, v) = basis([0.0, 1.0, 0.0]);
            out.lines.extend(circle(p.pos, u, v, p.size[0] / 2.0));
            out.rows.push(
                json!({"id": p.id, "what": "probe", "type": p.kind.name(), "pos": p.pos,
                                 "size": p.size, "data": data}),
            );
        }
        out
    }

    /// The deviation of an item's surface from its reference asset, both ways (Asset job:
    /// simplify's measure), with each face's worst distance and each vertex's for the shading.
    #[allow(clippy::type_complexity)]
    fn deviation(
        &self,
        scene: &Scene,
        args: &ModeArgs,
        one_way: bool,
    ) -> Result<
        (
            Read,
            std::sync::Arc<std::collections::BTreeMap<String, Vec<f32>>>,
            f64,
        ),
        Value,
    > {
        let refuse = |code: &str, extra: Value| {
            let mut r = json!({"outcome": "refused", "code": code, "mode": "deviation",
                               "snapshots": [], "drawn": []});
            if let (Some(r), Some(e)) = (r.as_object_mut(), extra.as_object()) {
                r.extend(e.clone());
            }
            r
        };
        let (Some(item), Some(reference)) = (&args.item, &args.reference) else {
            return Err(refuse("bad_input", json!({"path": "item"})));
        };
        let Some(bytes) = crate::evidence::read(&self.scenario.evidence, reference) else {
            return Err(refuse("reference_missing", json!({"reference": reference})));
        };
        let reference_mesh = deep_canvas_scene3d::gltf::mesh(&bytes, &json!(0))
            .map_err(|_| refuse("reference_missing", json!({"reference": reference})))?;
        let solid = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .find(|s| &s.id == item && s.mesh.is_some())
            .ok_or_else(|| refuse("ref_unresolved", json!({"path": format!("items/{item}")})))?;
        let mesh = solid.mesh.as_ref().expect("found with a mesh");
        let item_pos: Vec<V3> = mesh
            .positions
            .iter()
            .map(|p| apply(&solid.model, *p))
            .collect();
        let ref_pos: Vec<V3> = reference_mesh
            .positions
            .iter()
            .map(|p| apply(&solid.model, *p))
            .collect();
        let d = deep_canvas_scene3d::deviation::measure(
            &item_pos,
            &mesh.indices,
            &ref_pos,
            &reference_mesh.indices,
            one_way,
        );
        let mut faces: Vec<(usize, f64)> = d.faces.iter().copied().enumerate().collect();
        faces.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let worst: Vec<Value> = faces
            .iter()
            .take(10)
            .map(|(f, x)| json!({"face": f, "distance_m": x}))
            .collect();
        let way = |w: &deep_canvas_scene3d::deviation::Way| json!({"largest_m": w.largest_m, "mean_m": w.mean_m});
        let mut out = Read::default();
        out.extra.insert(
            "deviation".into(),
            json!({"item": item, "reference": reference, "largest_m": d.largest_m,
                   "mean_m": d.mean_m, "to_reference": way(&d.to_reference),
                   "from_reference": way(&d.from_reference), "worst": worst,
                   "legend": {"unit": "m", "top": d.largest_m}}),
        );
        out.rows.push(
            json!({"id": item, "what": "deviation", "largest_m": d.largest_m,
                             "mean_m": d.mean_m}),
        );
        let per_vertex = std::sync::Arc::new(std::collections::BTreeMap::from([(
            item.clone(),
            d.per_vertex.iter().map(|x| *x as f32).collect::<Vec<f32>>(),
        )]));
        Ok((out, per_vertex, d.largest_m))
    }

    /// Each item's evaluated bounds at `t`, from its world transform and its fields, by stable ID.
    fn bounds_at(&mut self, doc: &str, t: i64) -> Vec<Value> {
        let Some(revision) = self.query_revision(doc, None) else {
            return Vec::new();
        };
        let session = self.evaluated(&revision.drawn, t);
        let ids: Vec<String> = revision
            .doc
            .get("items")
            .and_then(Value::as_object)
            .map(|items| items.keys().cloned().collect())
            .unwrap_or_default();
        let mut out = Vec::new();
        for id in ids {
            let world = session
                .read(&self.sched, "core.world", Some(&id))
                .and_then(|(v, _)| v.as_typed::<Transform>());
            let fields = session
                .read(&self.sched, "core.fields", Some(&id))
                .and_then(|(v, _)| v.as_typed::<Fields>());
            let (Some(world), Some(fields)) = (world, fields) else {
                continue;
            };
            let Some(b) = local_box(&fields.to_json()) else {
                continue;
            };
            let (min, max) = world_bounds(b, &world);
            out.push(json!({"id": id, "what": "box", "pos": world.pos, "min": min, "max": max}));
        }
        out
    }

    /// The bounds view: each box outlined in the look's ink on its ground, at the document's size,
    /// rendered on the CPU and kept in the evidence store.
    fn bounds_picture(
        &mut self,
        doc: &str,
        drawn: &[Value],
        size: Option<[u16; 2]>,
    ) -> Option<(String, crate::snapshot::Drawn, [u16; 2])> {
        let revision = self.query_revision(doc, None)?;
        let mut items = Map::new();
        for (i, row) in drawn.iter().enumerate() {
            let (min, max) = (row["min"].as_array()?, row["max"].as_array()?);
            let (x0, y0) = (min[0].as_f64()?, min[1].as_f64()?);
            let (x1, y1) = (max[0].as_f64()?, max[1].as_f64()?);
            let id = format!("bounds.{i:05}");
            items.insert(
                id.clone(),
                json!({"id": id, "kind": "rect@1", "name": format!("Bounds of {}", row["id"].as_str()?),
                       "order": format!("a{i:05}"),
                       "params": {"box": [x0, y0, x1 - x0, y1 - y0],
                                  "paint": {"stroke": {"role": "ink", "width": 1}}}}),
            );
        }
        let view = json!({"format": 1, "profile": "board", "title": "Bounds",
                          "description": "Each item's evaluated bounds, outlined: a diagnostic view.",
                          "size": revision.doc.get("size").cloned().unwrap_or(json!([320, 200])),
                          "items": items});
        let session = self.evaluated(&view, 0);
        let painted = crate::frames::drawing_of(&self.sched, &session)?;
        self.canonical_png(&painted, size).ok()
    }
}

/// An item's authored `at.pos`, or the origin.
fn authored_pos(doc: &Value, id: &str) -> V3 {
    let p = doc.pointer(&format!("/items/{id}/at/pos"));
    [0, 1, 2].map(|k| {
        p.and_then(|p| p.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    })
}

/// Each light's range, cone and direction and the camera's frustum, by stable ID, at its world
/// position.
fn lights_cameras(scene: &Scene, doc: &Value, local: bool) -> Read {
    use deep_canvas_scene3d::light::LightKind;
    let mut out = Read::default();
    for l in &scene.lights {
        // The planted reader: the light's own `at.pos`, its parent ignored.
        let pos = if local {
            authored_pos(doc, &l.id)
        } else {
            l.pos
        };
        let kind = match l.kind {
            LightKind::Sun => "sun",
            LightKind::Point => "point",
            LightKind::Spot => "spot",
            LightKind::Area => "area",
        };
        let dir = unit(l.dir);
        match l.kind {
            // A sun has no place: a ring at its own `at.pos` facing its direction, with its rays.
            LightKind::Sun => {
                let (u, v) = basis(dir);
                out.lines.extend(circle(pos, u, v, 0.25));
                out.lines.push((pos, add(pos, mul(dir, 1.5))));
                for k in 0..4 {
                    let a = std::f64::consts::FRAC_PI_2 * k as f64;
                    let rim = add(pos, add(mul(u, 0.25 * a.cos()), mul(v, 0.25 * a.sin())));
                    out.lines.push((rim, add(rim, mul(dir, 0.75))));
                }
            }
            LightKind::Spot => {
                let reach = if l.range.is_finite() && l.range > 0.0 {
                    l.range.min(3.0)
                } else {
                    1.0
                };
                let (u, v) = basis(dir);
                for cos in [l.cone[0], l.cone[1]] {
                    let sin = (1.0 - cos * cos).max(0.0).sqrt();
                    let centre = add(pos, mul(dir, reach * cos));
                    let r = reach * sin;
                    out.lines.extend(circle(centre, u, v, r));
                    for k in 0..4 {
                        let a = std::f64::consts::FRAC_PI_2 * k as f64;
                        out.lines.push((
                            pos,
                            add(centre, add(mul(u, r * a.cos()), mul(v, r * a.sin()))),
                        ));
                    }
                }
            }
            _ => {
                let r = if l.range.is_finite() && l.range > 0.0 {
                    l.range.min(3.0)
                } else {
                    0.5
                };
                for (u, v) in [
                    ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
                    ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
                    ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
                ] {
                    out.lines.extend(circle(pos, u, v, r));
                }
                // Its place: a cross 0.3 m across.
                for axis in [[0.15, 0.0, 0.0], [0.0, 0.15, 0.0], [0.0, 0.0, 0.15]] {
                    out.lines.push((sub(pos, axis), add(pos, axis)));
                }
            }
        }
        out.rows.push(json!({"id": l.id, "what": "light", "kind": kind, "pos": pos, "dir": dir,
                             "range": if l.range.is_finite() { json!(l.range) } else { Value::Null }}));
    }
    // The view's camera: its frustum from the near plane to 2 m past it.
    let cam = &scene.camera;
    let [w, h] = cam.size;
    let near = cam.near.max(0.05);
    let corners =
        |z: f64| [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]].map(|[x, y]| cam.unproject(x, y, z));
    let (a, b) = (corners(near), corners(near + 2.0));
    for k in 0..4 {
        out.lines.push((a[k], a[(k + 1) % 4]));
        out.lines.push((b[k], b[(k + 1) % 4]));
        out.lines.push((a[k], b[k]));
    }
    let id = doc
        .get("camera")
        .and_then(Value::as_str)
        .unwrap_or("camera");
    out.rows
        .push(json!({"id": id, "what": "camera", "pos": cam.eye, "forward": cam.forward}));
    out
}

/// Each surface's uv0 extent counted in checker cells, 8 per uv0 unit (the planted reader fits
/// 8 × 8 to each surface).
fn uv_checker(scene: &Scene, fit: bool) -> Read {
    let mut out = Read::default();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        let Some(m) = s.mesh.as_ref().filter(|m| !m.uv0.is_empty()) else {
            continue;
        };
        let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for uv in &m.uv0 {
            for k in 0..2 {
                lo[k] = lo[k].min(uv[k]);
                hi[k] = hi[k].max(uv[k]);
            }
        }
        let cells = if fit {
            [8, 8]
        } else {
            [0, 1].map(|k| ((hi[k] - lo[k]) * PER_UNIT).round() as i64)
        };
        out.rows.push(
            json!({"id": s.id, "what": "checker", "cells": cells, "per_unit": PER_UNIT as i64,
                             "uv_min": lo, "uv_max": hi}),
        );
    }
    out
}

/// Each vertex's normal line, vertex + 0.05 m × its world normal (the planted reader draws a
/// face normal of the first face using the vertex).
fn normals(scene: &Scene, from_faces: bool) -> Read {
    let mut out = Read::default();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        let Some(m) = s.mesh.as_ref() else {
            continue;
        };
        let mut face_of: Vec<Option<V3>> = vec![None; m.positions.len()];
        if from_faces {
            for t in m.indices.chunks_exact(3) {
                let [a, b, c] = [0, 1, 2].map(|k| m.positions[t[k] as usize]);
                let n = unit(cross(sub(b, a), sub(c, a)));
                for &v in t {
                    face_of[v as usize].get_or_insert(n);
                }
            }
        }
        for (k, p) in m.positions.iter().enumerate() {
            let n = match face_of[k] {
                Some(f) => f,
                None => m.normals.get(k).copied().unwrap_or([0.0, 1.0, 0.0]),
            };
            let from = apply(&s.model, *p);
            let to = add(from, mul(turn_normal(&s.model, n), NORMAL_M));
            out.lines.push((from, to));
            out.rows
                .push(json!({"id": s.id, "what": "normal", "vertex": k, "from": from, "to": to}));
        }
    }
    out
}

/// Each vertex's tangent from uv0 (or the asset's own), with the glTF handedness: the bitangent
/// is w × normal × tangent.
fn tangents(scene: &Scene) -> Read {
    let mut out = Read::default();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        let Some(m) = s
            .mesh
            .as_ref()
            .filter(|m| !m.uv0.is_empty() || !m.tangents.is_empty())
        else {
            continue;
        };
        let n = m.positions.len();
        let (mut tan, mut bit) = (vec![[0.0; 3]; n], vec![[0.0; 3]; n]);
        if m.tangents.is_empty() {
            for t in m.indices.chunks_exact(3) {
                let [a, b, c] = [0, 1, 2].map(|k| t[k] as usize);
                let (e1, e2) = (
                    sub(m.positions[b], m.positions[a]),
                    sub(m.positions[c], m.positions[a]),
                );
                let (du1, dv1) = (m.uv0[b][0] - m.uv0[a][0], m.uv0[b][1] - m.uv0[a][1]);
                let (du2, dv2) = (m.uv0[c][0] - m.uv0[a][0], m.uv0[c][1] - m.uv0[a][1]);
                let det = du1 * dv2 - du2 * dv1;
                if det == 0.0 {
                    continue;
                }
                let r = 1.0 / det;
                let sdir = mul(sub(mul(e1, dv2), mul(e2, dv1)), r);
                let tdir = mul(sub(mul(e2, du1), mul(e1, du2)), r);
                for v in [a, b, c] {
                    tan[v] = add(tan[v], sdir);
                    bit[v] = add(bit[v], tdir);
                }
            }
        }
        for k in 0..n {
            let normal = m.normals.get(k).copied().unwrap_or([0.0, 0.0, 1.0]);
            let (t, w) = match m.tangents.get(k) {
                Some(t) => ([t[0], t[1], t[2]], if t[3] < 0.0 { -1 } else { 1 }),
                None => {
                    // Gram–Schmidt against the normal; the handedness from the bitangent.
                    let t = unit(sub(tan[k], mul(normal, dot(normal, tan[k]))));
                    (
                        t,
                        if dot(cross(normal, t), bit[k]) < 0.0 {
                            -1
                        } else {
                            1
                        },
                    )
                }
            };
            let world = unit(turn(&s.model, t));
            let from = apply(&s.model, m.positions[k]);
            let to = add(from, mul(world, NORMAL_M));
            out.lines.push((from, to));
            out.rows.push(
                json!({"id": s.id, "what": "tangent", "vertex": k, "from": from, "to": to,
                                 "tangent": world, "w": w}),
            );
        }
    }
    out
}

/// The transport's frame length in flicks, from its `frame_rate` (60/1 by default).
fn frame_flicks(doc: &Value) -> i64 {
    let rate = doc
        .pointer("/transport/frame_rate")
        .and_then(Value::as_str)
        .unwrap_or("60/1");
    let (n, d) = rate.split_once('/').unwrap_or((rate, "1"));
    let (n, d) = (
        n.trim().parse::<i64>().unwrap_or(60),
        d.trim().parse::<i64>().unwrap_or(1),
    );
    crate::shared::FLICKS * d / n.max(1)
}

/// Each selected item's evaluated positions over the span, one at every frame, with ticks at
/// the key times of the channels that target it.
fn motion_paths(doc: &Value, args: &ModeArgs) -> Result<Read, Value> {
    let refuse = |code: &str, path: &str| {
        json!({"outcome": "refused", "code": code, "mode": "motion_paths", "path": path,
               "snapshots": [], "drawn": []})
    };
    let [t0, t1] = args.span.ok_or_else(|| refuse("bad_input", "span"))?;
    if t1 < t0 {
        return Err(refuse("out_of_range", "span"));
    }
    let frame = frame_flicks(doc);
    let at = |t: i64| -> Result<Vec<(String, V3)>, Value> {
        let placed =
            deep_canvas_scene3d::scene::placed_at(doc, t).map_err(|r| refuse(r.code, &r.path))?;
        Ok(placed
            .into_iter()
            .map(|(id, _, w)| (id, origin(&w)))
            .collect())
    };
    let pos_of =
        |placed: &[(String, V3)], id: &str| placed.iter().find(|(i, _)| i == id).map(|(_, p)| *p);
    let mut times: Vec<i64> = Vec::new();
    let mut t = t0;
    while t <= t1 {
        times.push(t);
        t += frame;
    }
    let frames: Vec<Vec<(String, V3)>> = times.iter().map(|t| at(*t)).collect::<Result<_, _>>()?;
    let mut out = Read::default();
    for id in &args.select {
        let mut samples = Vec::new();
        let mut prev: Option<V3> = None;
        for (t, placed) in times.iter().zip(&frames) {
            let Some(p) = pos_of(placed, id) else {
                return Err(refuse("ref_unresolved", &format!("items/{id}")));
            };
            if let Some(q) = prev {
                out.lines.push((q, p));
            }
            prev = Some(p);
            samples.push(json!({"t": t, "pos": p}));
        }
        // The keys of every channel whose target is this item.
        let prefix = format!("items/{id}/");
        let mut keys: Vec<i64> = doc
            .get("channels")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|c| c.values())
            .filter(|c| {
                c.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&prefix))
            })
            .flat_map(|c| {
                c.get("keys")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flat_map(|k| k.values())
            })
            .filter_map(|k| crate::hub::flicks(k.get("t")?.as_str()?))
            .filter(|t| (t0..=t1).contains(t))
            .collect();
        keys.sort_unstable();
        keys.dedup();
        let mut ticks = Vec::new();
        for t in keys {
            let p = pos_of(&at(t)?, id)
                .ok_or_else(|| refuse("ref_unresolved", &format!("items/{id}")))?;
            let (u, v) = ([0.06, 0.0, 0.0], [0.0, 0.0, 0.06]);
            out.lines.push((sub(p, u), add(p, u)));
            out.lines.push((sub(p, v), add(p, v)));
            ticks.push(json!({"t": t, "pos": p}));
        }
        out.rows
            .push(json!({"id": id, "what": "path", "samples": samples, "ticks": ticks}));
    }
    Ok(out)
}

/// The hierarchy built for surface hits (the spatial index's, #421), its boxes down to `depth`.
fn pick_hierarchy(doc: &Value, t: i64, depth: usize) -> Result<Read, Value> {
    let index =
        deep_canvas_scene3d::spatial::Index::new(doc, t, Default::default()).map_err(|r| {
            json!({"outcome": "refused", "code": r.code, "path": r.path, "mode": "pick_hierarchy",
               "snapshots": [], "drawn": []})
        })?;
    let nodes = index.hierarchy();
    let mut out = Read::default();
    let leaves = nodes.iter().filter(|n| n.1).count();
    let deepest = nodes.iter().map(|n| n.0).max().unwrap_or(0);
    for (k, (d, leaf, b)) in nodes.iter().enumerate().filter(|(_, n)| n.0 <= depth) {
        out.lines.extend(box_edges(b.min, b.max));
        out.rows.push(
            json!({"id": format!("node.{k:04}"), "what": "pick_box", "depth": d,
                             "leaf": leaf, "min": b.min, "max": b.max}),
        );
    }
    out.extra.insert(
        "hierarchy".into(),
        json!({"depth": deepest, "leaves": leaves}),
    );
    Ok(out)
}

/// Each positional voice: its inner and outer cone and its range about its item, as its fields
/// give them.
fn sound_sources(doc: &Value, t: i64) -> Result<Read, Value> {
    let voices = deep_canvas_scene3d::emitters::emitters(doc, t).map_err(|r| {
        json!({"outcome": "refused", "code": r.code, "path": r.path, "mode": "sound_sources",
               "snapshots": [], "drawn": []})
    })?;
    let mut out = Read::default();
    for v in voices {
        let (u, w) = basis(v.forward);
        for half in [v.inner / 2.0, v.outer / 2.0] {
            let a = half.min(179.0).to_radians();
            let reach = 0.6;
            let centre = add(v.pos, mul(v.forward, reach * a.cos()));
            out.lines.extend(circle(centre, u, w, reach * a.sin()));
        }
        let r = if v.range.is_finite() {
            v.range.min(5.0)
        } else {
            5.0
        };
        out.lines
            .extend(circle(v.pos, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], r));
        out.rows.push(
            json!({"id": v.id, "what": "voice", "item": v.item, "pos": v.pos,
                             "inner": v.inner, "outer": v.outer, "outer_gain": v.outer_gain,
                             "range": v.range}),
        );
    }
    Ok(out)
}
