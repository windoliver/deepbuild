//! Issue #405: the core's `geometry.audit` on a claim's deliverables (canvas primitives: Geometry
//! audit, Control sweep). Each state a document can reach is evaluated and read as true shapes
//! placed in world metres, never as pixels; the geometry is the core's
//! (`deep_canvas::geometry_audit`). A control sweep audits its samples, then bounds each part's
//! motion between them by the interval forms of the motion program that control feeds.

use std::collections::BTreeSet;

use deep_canvas::geometry_audit::{Change, Config, Fault, Seat, Shape, Solid, V3};
use deep_canvas::interval::Iv;
use deep_canvas_motion::program::{Program, TRANSFORM};
use deep_canvas_scene3d::scene::{self, Affine3};
use serde_json::{json, Value};

/// The check kind.
pub const GEOMETRY_AUDIT: &str = "geometry.audit";

/// The audit's wrong programs: #405's sweep, which audits its samples alone and bounds nothing
/// between them, and #1936's audit, which runs its overlap pass alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    SamplesOnly,
    OverlapsOnly,
    /// #1700's, in the shape readings (`geometry.shape`).
    Shape(crate::geometry::shape::Planted),
    /// #409's, in the film audit's craft@1 checks.
    Craft(crate::film_audit::craft::Planted),
}

/// A wrong program of the audit's, of the shape readings' or of the craft checks', by the name
/// its acceptance suite gives it.
pub(crate) fn planted(name: &str) -> Option<crate::hub::Planted> {
    Some(crate::hub::Planted::Audit(match name {
        "sweep_audits_samples_only" => Planted::SamplesOnly,
        "audit_checks_overlaps_only" => Planted::OverlapsOnly,
        _ => match crate::geometry::shape::planted(name) {
            Some(p) => Planted::Shape(p),
            None => Planted::Craft(crate::film_audit::craft::planted(name)?),
        },
    }))
}

fn apply(m: &Affine3, p: V3) -> V3 {
    let mut out = [0.0; 3];
    for (i, o) in out.iter_mut().enumerate() {
        *o = m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3];
    }
    out
}

fn column(m: &Affine3, j: usize) -> V3 {
    [m[0][j], m[1][j], m[2][j]]
}

fn norm(v: V3) -> f64 {
    deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

use deep_canvas_scene3d::shapes::{built as built_shapes, placed_box};

fn v3(v: &Value) -> Option<V3> {
    let a = v.as_array()?;
    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
}

/// Where an item sits (Geometry audit: scenes): the hash of its geometry, which is its kind and
/// the numbers that shape it in its own space; its own bounds `[lo, hi]` placed by `m`; its
/// origin, which is its pivot where it has one; its yaw; and its boundary edges.
fn seat_of(item: &Value, shape: impl Iterator<Item = f64>, m: &Affine3, [lo, hi]: [V3; 2], edges: Vec<[V3; 2]>) -> Seat {
    let mut h = deep_canvas::schedule::Hasher::new(GEOMETRY_AUDIT);
    h.text(item.get("kind").and_then(Value::as_str).unwrap_or(""));
    for x in shape {
        h.bytes(&x.to_bits().to_le_bytes());
    }
    Seat {
        geometry: h.finish(),
        corners: std::array::from_fn(|k| apply(m, std::array::from_fn(|j| if k >> j & 1 == 0 { lo[j] } else { hi[j] }))),
        origin: apply(m, item.pointer("/at/pivot").and_then(v3).unwrap_or([0.0; 3])),
        yaw: deep_canvas::ops::deg(deep_canvas::ops::atan2(-m[2][0], m[0][0])),
        edges,
    }
}

/// A built mesh's boundary edges placed by `m`: each edge one face holds, on positions welded as
/// geometry.shading welds them (Check input: loop kinds: shading defects).
fn boundary_edges(mesh: &deep_canvas_scene3d::geom::Mesh, m: &Affine3) -> Vec<[V3; 2]> {
    let (welded, _) = deep_canvas_loop::count::weld(&mesh.positions, 0.00001);
    let mut faces: std::collections::BTreeMap<[u32; 2], (usize, [u32; 2])> = std::collections::BTreeMap::new();
    for t in mesh.indices.as_chunks::<3>().0 {
        let w = [t[0], t[1], t[2]].map(|i| welded[i as usize]);
        // A face whose corners weld together has no edges.
        if w[0] == w[1] || w[1] == w[2] || w[0] == w[2] {
            continue;
        }
        for (k, j) in [(0, 1), (1, 2), (2, 0)] {
            faces.entry([w[k].min(w[j]), w[k].max(w[j])]).or_insert((0, [t[k], t[j]])).0 += 1;
        }
    }
    faces.values().filter(|(n, _)| *n == 1).map(|(_, e)| e.map(|i| apply(m, mesh.positions[i as usize]))).collect()
}

/// Every solid part of `doc` at `t` (flicks), as the audit reads it: its true shape placed in the
/// world by its evaluated transform and its parents', and a wire's or tube's ends; paint and light
/// play no part. `moved` names the parts motion places.
pub(crate) fn solids_at(doc: &Value, t: i64, moved: &BTreeSet<String>) -> Result<Vec<Solid>, String> {
    let placed = scene::placed_at(doc, t).map_err(|r| format!("{} at {}", r.code, r.path))?;
    let secs = t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
    let mut out = Vec::new();
    for (id, item, m) in &placed {
        if item.get("visible") == Some(&Value::Bool(false)) {
            continue;
        }
        // #2013: an instancer's elements, each its prototype's true shape at the element's place,
        // so a scatter that leaves overlaps fails here (Attribute and field: distribute).
        if item.get("kind").and_then(Value::as_str) == Some("instance@1") {
            let rows = scene::elements_at(doc, t, id, None).map_err(|r| format!("{} at {}", r.code, r.path))?.unwrap_or_default();
            let identity = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]];
            let protos: Vec<Vec<Shape>> = item
                .pointer("/params/of")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|p| {
                    let found = p.as_str().and_then(|p| placed.iter().find(|(x, _, _)| x == p));
                    found
                        .and_then(|(p, proto, _)| deep_canvas_scene3d::shapes::of(doc, p, proto, &identity, secs).ok().flatten())
                        .map_or_else(Vec::new, |(s, _)| s)
                })
                .collect();
            for r in &rows {
                let at = scene::matmul(m, &r.at());
                let shapes: Vec<Shape> = protos.get(r.proto).into_iter().flatten().map(|s| deep_canvas_scene3d::shapes::placed(s, &at)).collect();
                if !shapes.is_empty() {
                    out.push(Solid { id: format!("{id}#{}", r.id), shapes, ends: Vec::new(), moved: moved.contains(id), seat: None });
                }
            }
            continue;
        }
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let size = item.pointer("/params/size").and_then(v3).unwrap_or([1.0; 3]);
        let half = [size[0] / 2.0, size[1] / 2.0, size[2] / 2.0];
        let low = [-half[0], -half[1], -half[2]];
        // A mark is a closed solid: it has no boundary edge.
        let mark = || seat_of(item, size.into_iter(), m, [low, half], Vec::new());
        let (shapes, ends, seat) = match kind {
            "mark.box@1" | "mark.cylinder@1" => (vec![placed_box(m, low, half)], Vec::new(), mark()),
            "mark.sphere@1" => {
                let r = (0..3).map(|j| norm(column(m, j)) * half[j]).fold(0.0, f64::max);
                (vec![Shape::Ball { c: apply(m, [0.0; 3]), r }], Vec::new(), mark())
            }
            // #419's stand-in for the physics module: each body a ball at the bake's position.
            "fixture.world@1" => {
                let params = item.get("params").cloned().unwrap_or(Value::Null);
                let w = deep_canvas_scene3d::fixtures::bake(&params, &format!("items/{id}/params"))
                    .map_err(|r| format!("{} at {}", r.code, r.path))?;
                for (b, p) in w.bodies.iter().zip(w.at(t)) {
                    out.push(Solid { id: format!("{id}#{}", b.id), shapes: vec![Shape::Ball { c: p, r: b.radius }], ends: Vec::new(), moved: true, seat: None });
                }
                continue;
            }
            k if deep_canvas_scene3d::builders::KINDS.contains(&k) => {
                let run = deep_canvas_scene3d::stack::Run::default();
                let built = deep_canvas_scene3d::build::built(doc, id, item, &run, secs)
                    .map_err(|p| format!("out_of_range at items/{id}/{p}"))?;
                let Some(mesh) = built.mesh.filter(|m| m.triangles() > 0) else {
                    continue;
                };
                let numbers = mesh.positions.iter().flatten().copied().chain(mesh.indices.iter().map(|i| f64::from(*i)));
                let (shapes, ends) = built_shapes(doc, item, &mesh, m);
                (shapes, ends, seat_of(item, numbers, m, mesh.bounds(), boundary_edges(&mesh, m)))
            }
            _ => continue,
        };
        out.push(Solid { id: id.clone(), shapes, ends, moved: moved.contains(id), seat: Some(seat) });
    }
    Ok(out)
}

/// The items whose transform motion writes, or one of whose parents' it writes: motion places
/// them, which holds them.
pub(crate) fn moved_items(doc: &Value, program: Option<&Program>) -> BTreeSet<String> {
    let Some(p) = program else {
        return BTreeSet::new();
    };
    let items = doc.get("items").and_then(Value::as_object);
    let written = |id: &str| {
        p.items
            .iter()
            .position(|x| x == id)
            .is_some_and(|i| p.writes(i * TRANSFORM..(i + 1) * TRANSFORM))
    };
    let mut out = BTreeSet::new();
    for id in items.into_iter().flatten().map(|(k, _)| k) {
        if chain(doc, id).iter().any(|m| written(m)) {
            out.insert(id.clone());
        }
    }
    out
}

/// An item and its parents, nearest first.
fn chain(doc: &Value, id: &str) -> Vec<String> {
    let mut out = vec![id.to_string()];
    let mut at = doc.pointer(&format!("/items/{id}/parent")).and_then(Value::as_str);
    while let Some(p) = at {
        if out.iter().any(|x| x == p) || out.len() > 8 {
            break;
        }
        out.push(p.to_string());
        at = doc.pointer(&format!("/items/{p}/parent")).and_then(Value::as_str);
    }
    out
}

/// `doc` with control `id` set to `value`: what a document reaches with the control there.
pub(crate) fn with_control(doc: &Value, id: &str, value: f64) -> Value {
    let mut out = doc.clone();
    if let Some(c) = out.pointer_mut(&format!("/controls/{id}")).and_then(Value::as_object_mut) {
        c.insert("default".into(), json!(value));
    }
    out
}

/// How far any point of each part can move while control `id` runs over `[a, b]` at time `t`
/// (flicks), from the interval forms of what writes its transform and its parents' (The closed
/// function list).
pub(crate) fn reach_over(doc: &Value, id: &str, a: f64, b: f64, t: i64, solids: &[Solid]) -> Vec<Option<f64>> {
    let mut stretched = with_control(doc, id, a);
    if let Some(c) = stretched.pointer_mut(&format!("/controls/{id}")).and_then(Value::as_object_mut) {
        c.insert("range".into(), json!([a, b]));
    }
    let Some(program) = stretched.as_object().and_then(|m| Program::compile(m).ok()) else {
        return vec![None; solids.len()];
    };
    let secs = t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
    let spread = |slot: usize| -> Option<f64> {
        if program.time_only(slot) {
            return Some(0.0);
        }
        let iv: Iv = program.slot_bound_over(slot, Iv::point(secs))?;
        iv.is_bounded().then_some(iv.hi - iv.lo)
    };
    reach(&stretched, t, &program, solids, &spread)
}

/// How far any point of each part can move over the flicks `[a, b]` as the document plays.
pub(crate) fn reach_over_time(doc: &Value, program: &Program, a: i64, b: i64, solids: &[Solid]) -> Vec<Option<f64>> {
    let (mut sa, mut sb) = (program.state(), program.state());
    program.evaluate_local(a, deep_canvas_motion::eval::Validity::Full, &mut sa);
    program.evaluate_local(b, deep_canvas_motion::eval::Validity::Full, &mut sb);
    let spread = |slot: usize| -> Option<f64> {
        let iv = program.slot_window(slot, a, b, sa.slots[slot], sb.slots[slot])?;
        iv.is_bounded().then_some(iv.hi - iv.lo)
    };
    reach(doc, a, program, solids, &spread)
}

/// Each part's reach from each slot's spread (`spread`, `None` where no form bounds it): its own
/// and its parents' position spread plus each turn's spread times how far the part lies from
/// that turn's centre. `None` for a part no form bounds: a body a physics world places, a slot a
/// placement, a follow or a constraint writes, or a scale that changes.
fn reach(doc: &Value, t: i64, program: &Program, solids: &[Solid], spread: &dyn Fn(usize) -> Option<f64>) -> Vec<Option<f64>> {
    let placed: Vec<(String, Value, Affine3)> = scene::placed_at(doc, t).unwrap_or_default();
    solids
        .iter()
        .map(|s| {
            let owner = s.id.split('#').next().unwrap_or(&s.id);
            if doc.pointer(&format!("/items/{owner}/kind")).and_then(Value::as_str) == Some("fixture.world@1") {
                return None;
            }
            let corners = deep_canvas::geometry_audit::bounds(s);
            let mut reach = 0.0;
            for m in chain(doc, owner) {
                let Some(i) = program.items.iter().position(|x| *x == m) else {
                    continue;
                };
                let base = i * TRANSFORM;
                for k in 0..3 {
                    if spread(base + 6 + k)? > 0.0 {
                        return None;
                    }
                }
                let dpos = norm([spread(base)?, spread(base + 1)?, spread(base + 2)?]);
                let dturn: f64 = (0..3).map(|k| spread(base + 3 + k).map(deep_canvas::ops::rad)).sum::<Option<f64>>()?;
                let origin: V3 = placed
                    .iter()
                    .find(|(id, _, _)| *id == m)
                    .map_or([0.0; 3], |(_, _, a)| [a[0][3], a[1][3], a[2][3]]);
                let far = (0..8)
                    .map(|c| {
                        let p = [0, 1, 2].map(|k| if c >> k & 1 == 0 { corners[0][k] } else { corners[1][k] });
                        norm([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]])
                    })
                    .fold(0.0, f64::max);
                reach += dpos + (far + reach) * dturn;
            }
            // #504: the assemblies the part rides, each a slide by its value and a share of its
            // apart vector; a turn that moves isn't bounded here, so the stretch is an estimate.
            let mut at = program.member(owner);
            while let Some(a) = at {
                let x = &program.assemblies[a];
                let value = spread(x.slot)?;
                match x.joint.as_ref().map(|j| &j.kind) {
                    Some(deep_canvas_motion::assembly::Kind::Turn) if value > 0.0 => return None,
                    Some(deep_canvas_motion::assembly::Kind::Slide) => reach += value,
                    _ => {}
                }
                reach += spread(x.slot + 1)? * norm(x.apart);
                at = x.parent;
            }
            Some(reach)
        })
        .collect()
}

/// Each ID a list or a set of lists holds.
fn ids_in(v: Option<&Value>) -> BTreeSet<String> {
    v.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

/// What a geometry audit's check input lets go: the items it declares floating (`floating`,
/// `support.floating` or `except`) and the contacts it allows (`relations`, pairs of IDs).
fn exceptions_of(input: &Value) -> (BTreeSet<String>, BTreeSet<(String, String)>) {
    let mut floating = ids_in(input.get("floating"));
    floating.extend(ids_in(input.pointer("/support/floating")));
    floating.extend(ids_in(input.get("except")));
    let relations = input
        .get("relations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let p = p.as_array()?;
            let (a, b) = (p.first()?.as_str()?, p.get(1)?.as_str()?);
            Some(if a <= b { (a.to_string(), b.to_string()) } else { (b.to_string(), a.to_string()) })
        })
        .collect();
    (floating, relations)
}

/// The document's own statements: its `audit` and every geometry audit among its own `checks`.
/// They are its writer's, and narrow only that writer's checks (Check input).
pub(crate) fn own_exceptions(doc: &Value) -> (BTreeSet<String>, BTreeSet<(String, String)>) {
    let (mut floating, mut relations) = doc.get("audit").map(exceptions_of).unwrap_or_default();
    for c in doc.get("checks").and_then(Value::as_array).into_iter().flatten() {
        if c.get("kind").and_then(Value::as_str) == Some(GEOMETRY_AUDIT) {
            let (f, r) = exceptions_of(c);
            floating.extend(f);
            relations.extend(r);
        }
    }
    (floating, relations)
}

/// The contacts objects allow (Object: `relations`): each item with the items it is seated on,
/// joined to or fixed to. They are the figure's own structure, not an exception.
pub(crate) fn structure(doc: &Value) -> BTreeSet<(String, String)> {
    let mut out = BTreeSet::new();
    for (id, item) in doc.get("items").and_then(Value::as_object).into_iter().flatten() {
        for rel in ["seated_on", "joined_to", "fixed_to"] {
            for other in ids_in(item.pointer(&format!("/relations/{rel}"))) {
                out.insert(if *id <= other { (id.clone(), other) } else { (other, id.clone()) });
            }
        }
    }
    out
}

/// The values a sweep audits for one control (Control sweep: `samples`): a slider's, a turn's or
/// a drag's `n` points evenly over its range, ends included, never fewer; each value of a toggle,
/// a choice or a stages control. `None` for a control the document doesn't declare. The second
/// is whether between two values the range is bounded (continuous) or there is nothing between.
fn values_of(control: &Value, samples: &Value) -> Option<(Vec<f64>, bool)> {
    let kind = control.get("kind").and_then(Value::as_str).unwrap_or("slider");
    match kind {
        "toggle" | "transport" => Some((vec![0.0, 1.0], false)),
        "choice" | "stages" => {
            let n = control
                .get("options")
                .or_else(|| control.get("stages"))
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
                .max(1);
            Some(((0..n).map(|k| k as f64).collect(), false))
        }
        _ => {
            let r = control.get("range").and_then(Value::as_array)?;
            let (lo, hi) = (r.first()?.as_f64()?, r.get(1)?.as_f64()?);
            let n = samples.as_u64().unwrap_or(2).max(2) as usize;
            let vs = (0..n).map(|k| lo + (hi - lo) * k as f64 / (n - 1) as f64).collect();
            Some((vs, true))
        }
    }
}

/// One requirement's run on one deliverable.
#[derive(Default)]
pub(crate) struct DocRun {
    /// Its failures as issues, with the document's own exceptions applied.
    pub issues: Vec<Value>,
    /// The document's own exceptions a failure needed: each excuses one the definition doesn't.
    pub excused_by: BTreeSet<String>,
    /// Each stretch only sampled: `{control, range, ids}`, an estimate that never decides.
    pub estimates: Vec<Value>,
    /// A state this build can't evaluate, by name.
    pub not_run: Vec<String>,
    /// The refusals of a check that needs what a sweep only sampled.
    pub refused: Vec<Value>,
    pub ms: f64,
}

/// A collection's members (Document envelope: `collections`), or none for one the document
/// doesn't list by its members.
fn members(doc: &Value, name: &Value) -> Option<BTreeSet<String>> {
    let list = doc.get("collections")?.get(name.as_str()?)?.get("members")?.as_array()?;
    Some(list.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

/// A fault's fix as patch ops (Patch), where a patch can make it: an item removed, or an item
/// with no parent that no motion places set to its new place. Any other fix is its words.
fn fix_of(f: &Fault, doc: &Value, moved: &BTreeSet<String>) -> Value {
    let ops = match &f.change {
        Some(Change::Remove(id)) => Some(vec![json!({"op": "delete", "id": id})]),
        Some(Change::Place { id, by, yaw }) => doc
            .pointer(&format!("/items/{id}"))
            .filter(|item| item.get("parent").is_none() && !moved.contains(id))
            .map(|item| {
                let pos = item.pointer("/at/pos").and_then(v3).unwrap_or([0.0; 3]);
                let turn = item.pointer("/at/rot/1").and_then(Value::as_f64).unwrap_or(0.0) + yaw;
                let set = |path: &str, value: Value| json!({"op": "set", "id": id, "path": format!("items/{id}/at/{path}"), "value": value});
                let mut ops = vec![set("pos", json!([pos[0] + by[0], pos[1] + by[1], pos[2] + by[2]]))];
                if *yaw != 0.0 {
                    ops.push(set("rot/1", json!(turn)));
                }
                ops
            }),
        None => None,
    };
    ops.map_or_else(|| json!(f.fix), Value::Array)
}

/// A fault as an issue (What holds a document to its rules): the state it was found in, its time
/// and, in a sweep, the control and its value there.
fn issue(f: &Fault, state: &str, t: i64, sweep: Option<(&str, f64)>, fix: Value) -> Value {
    use deep_canvas::geometry_audit::{COINCIDENT, FLOATING, OFF_GRID, OVERLAP, SEAM};
    let what = match f.code {
        OVERLAP => format!("{} passes {:.4} m into {}", f.ids[0], f.by, f.ids[1]),
        FLOATING => format!("nothing holds {}", f.ids[0]),
        COINCIDENT => format!("{} and {} are one geometry in one place", f.ids[0], f.ids[1]),
        OFF_GRID => format!("{} is {:.4} m off its grid, or turned off a quarter turn", f.ids[0], f.by),
        SEAM => format!("the seam between {} and {} leaves a {:.4} m gap", f.ids[0], f.ids[1], f.by),
        _ => format!("an end of {} lands on nothing", f.ids[0]),
    };
    let mut v = json!({"check": GEOMETRY_AUDIT, "code": f.code, "severity": "error", "ids": f.ids,
                       "state": state, "t": t, "what": what, "fix": fix});
    if f.code == OVERLAP {
        v["depth"] = json!(f.by);
    }
    if f.code == SEAM {
        v["gap"] = json!(f.by);
    }
    if let Some((control, value)) = sweep {
        v["sweep"] = json!({"control": control, "value": value});
    }
    v
}

/// What a sweep only sampled, as the row lists it, and the refusal of a check that needs it: the
/// control (none for the loop), its samples, the stretches between them no bound settled with the
/// parts it couldn't bound there, and their hull.
fn estimated(swept: &deep_canvas::geometry_audit::Swept, state: &str, control: Option<&str>, samples: &[f64], out: &mut DocRun) {
    if swept.estimates.is_empty() {
        return;
    }
    let lo = swept.estimates.iter().map(|(r, _)| r[0]).fold(f64::INFINITY, f64::min);
    let hi = swept.estimates.iter().map(|(r, _)| r[1]).fold(f64::NEG_INFINITY, f64::max);
    let ids: BTreeSet<&String> = swept.estimates.iter().flat_map(|(_, ids)| ids).collect();
    let stretches: Vec<[f64; 2]> = swept.estimates.iter().map(|(r, _)| *r).collect();
    out.estimates.push(json!({"state": state, "control": control, "samples": samples, "stretches": stretches, "ids": ids}));
    out.refused.push(json!({"code": "sweep_unbounded", "kind": GEOMETRY_AUDIT, "state": state, "control": control,
        "range": [lo, hi], "ids": ids,
        "why": "no interval form bounds these parts between the samples, so the audit there is an estimate, which never decides a check"}));
}

/// What the audit reads for one requirement and one deliverable.
pub(crate) struct Audit<'a> {
    pub doc: Value,
    pub input: &'a Value,
    /// Exceptions you approved for this requirement.
    pub approved: &'a BTreeSet<String>,
    /// #405's planted sweep: its samples alone, nothing bounded between them.
    pub samples_only: bool,
    /// #1936's planted audit: the overlap pass alone.
    pub overlaps_only: bool,
    /// #504's planted sweep: the control stepped, every assembly posed at its rest value.
    pub assemblies_at_rest: bool,
}

impl Audit<'_> {
    /// What the input allows and, for a scene, asks for (Geometry audit: scenes): coincident
    /// items, `grid` and `seams`. A collection the document doesn't list is never passed over.
    fn config(&self, own: bool, out: &mut DocRun) -> Config {
        let d = Config::default();
        let tol = |k: &str, def: f64| self.input.pointer(&format!("/tolerance/{k}")).and_then(Value::as_f64).unwrap_or(def);
        let (mut floating, mut relations) = exceptions_of(self.input);
        floating.extend(self.approved.iter().cloned());
        relations.extend(structure(&self.doc));
        if own {
            let (f, r) = own_exceptions(&self.doc);
            floating.extend(f);
            relations.extend(r);
        }
        let mut cfg = Config { sunk: tol("sunk", d.sunk), touch: tol("touch", d.touch), land: tol("land", d.land), floating, relations, ..d };
        if self.overlaps_only {
            return cfg;
        }
        cfg.scene = self.input.get("scope").and_then(Value::as_str) == Some("scene");
        if let Some(g) = self.input.get("grid") {
            let sub = g.get("sub").and_then(Value::as_f64).filter(|s| *s > 0.0);
            cfg.grid = sub.zip(members(&self.doc, &g["items"]));
            if cfg.grid.is_none() {
                out.not_run.push("grid".into());
            }
        }
        if let Some(s) = self.input.get("seams") {
            let sets = |pair: &Value| Some([members(&self.doc, &pair[0])?, members(&self.doc, &pair[1])?]);
            let pairs: Option<Vec<_>> = s.get("pairs").and_then(Value::as_array).and_then(|p| p.iter().map(sets).collect());
            cfg.seams = pairs.map(|p| (p, s.get("max_gap").and_then(Value::as_f64).unwrap_or(0.001)));
            if cfg.seams.is_none() {
                out.not_run.push("seams".into());
            }
        }
        cfg
    }

    /// Runs every state the input names, or every state the document can reach, with the
    /// document's own exceptions (`own`) or with the definition's alone.
    fn run(&self, own: bool, out: &mut DocRun) -> Vec<Value> {
        let cfg = self.config(own, out);
        let doc = &self.doc;
        let program = doc.as_object().and_then(|m| Program::compile(m).ok());
        let moved = moved_items(doc, program.as_ref());
        let t0 = self
            .input
            .get("at_times")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|t| t.as_str().and_then(crate::hub::flicks).or_else(|| t.as_i64()))
            .unwrap_or(0);
        let controls = doc.get("controls").and_then(Value::as_object).cloned().unwrap_or_default();
        let span = program.as_ref().and_then(|p| p.motion.transport.span);
        let states: Vec<String> = match self.input.get("states").and_then(Value::as_array) {
            Some(s) => s.iter().filter_map(Value::as_str).map(str::to_string).collect(),
            None => {
                let mut s = vec!["rest".to_string()];
                if !controls.is_empty() {
                    s.push("sweeps".into());
                }
                if doc.get("tour").is_some() {
                    s.push("tour".into());
                }
                if span.is_some_and(|s| s > 0) {
                    s.push("loop".into());
                }
                s
            }
        };
        let assemblies = doc.get("assemblies").and_then(Value::as_object).is_some_and(|a| !a.is_empty());
        // What this build doesn't audit yet is never passed over: combining sweeps by corners or
        // a grid, the widest display strings, and a sweep taken apart, which needs assemblies.
        if let Some(c) = self.input.get("combine").and_then(Value::as_str).filter(|c| *c != "each") {
            out.not_run.push(format!("combine: {c}"));
        }
        if self.input.get("displays").is_some_and(|d| !d.is_null()) {
            out.not_run.push("displays".into());
        }
        if self.input.get("at").and_then(Value::as_str) == Some("apart") && assemblies {
            out.not_run.push("at: apart".into());
        }
        let mut issues: Vec<Value> = Vec::new();
        let mut seen: BTreeSet<(String, Vec<String>)> = BTreeSet::new();
        let mut push = |f: &Fault, state: &str, t: i64, sweep: Option<(&str, f64)>, issues: &mut Vec<Value>| {
            if self.overlaps_only && f.code != deep_canvas::geometry_audit::OVERLAP {
                return;
            }
            if seen.insert((f.code.to_string(), f.ids.clone())) {
                issues.push(issue(f, state, t, sweep, fix_of(f, doc, &moved)));
            }
        };
        for state in &states {
            match state.as_str() {
                // With no assemblies there is nothing to take apart: apart is rest.
                "rest" | "apart" | "take_apart" if state == "rest" || !assemblies => {
                    match solids_at(doc, t0, &moved) {
                        Ok(s) => {
                            for f in deep_canvas::geometry_audit::audit(&s, &cfg) {
                                push(&f, state, t0, None, &mut issues);
                            }
                        }
                        Err(why) => out.not_run.push(format!("{state}: {why}")),
                    }
                }
                "sweeps" | "tour" => {
                    let named = if state == "tour" {
                        doc.pointer("/tour/keys").and_then(Value::as_object).cloned().unwrap_or_default()
                    } else {
                        self.input.get("sweeps").and_then(Value::as_object).cloned().unwrap_or_default()
                    };
                    // A sweep never skips a control that moves geometry: one the input doesn't
                    // name is swept at its range's ends, bounded between them.
                    let mut list: Vec<(String, Value)> = named.into_iter().collect();
                    if state == "sweeps" {
                        for id in controls.keys() {
                            if !list.iter().any(|(c, _)| c == id) {
                                list.push((id.clone(), json!(2)));
                            }
                        }
                    }
                    for (id, samples) in list {
                        let Some(control) = controls.get(&id) else {
                            out.not_run.push(format!("{state}:{id}"));
                            continue;
                        };
                        let values = if state == "tour" {
                            let mut vs: Vec<f64> = samples
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|k| k.get(1).and_then(Value::as_f64))
                                .collect();
                            vs.sort_by(f64::total_cmp);
                            values_of(control, &json!(2)).map(|(_, c)| (vs, c))
                        } else if samples == "replay" {
                            None
                        } else {
                            values_of(control, &samples)
                        };
                        let Some((vs, continuous)) = values else {
                            out.not_run.push(format!("{state}:{id}"));
                            continue;
                        };
                        // A value the parts can't be evaluated at is never audited as empty.
                        let mut failed: Option<String> = None;
                        let mut state_at = |v: f64| {
                            let mut swept = with_control(doc, &id, v);
                            if self.assemblies_at_rest {
                                // Planted: nothing that writes an assembly's value runs.
                                for section in ["drivers", "channels"] {
                                    if let Some(m) = swept.get_mut(section).and_then(Value::as_object_mut) {
                                        m.retain(|_, w| !w["target"].as_str().is_some_and(|t| t.starts_with("assemblies/")));
                                    }
                                }
                            }
                            solids_at(&swept, t0, &moved).unwrap_or_else(|why| {
                                failed.get_or_insert(format!("{state}:{id} at {v}: {why}"));
                                Vec::new()
                            })
                        };
                        let mut bound = |a: f64, b: f64, solids: &[Solid]| {
                            if !continuous || self.samples_only {
                                return vec![Some(0.0); solids.len()];
                            }
                            reach_over(doc, &id, a, b, t0, solids)
                        };
                        let swept = deep_canvas::geometry_audit::sweep(&vs, &cfg, &mut state_at, &mut bound);
                        out.not_run.extend(failed);
                        for (v, faults) in &swept.failed {
                            for f in faults {
                                push(f, state, t0, Some((&id, *v)), &mut issues);
                            }
                        }
                        estimated(&swept, state, Some(&id), &vs, out);
                    }
                }
                "loop" => {
                    let (Some(p), Some(span)) = (program.as_ref(), span) else {
                        continue;
                    };
                    let (num, den) = p.motion.frame_rate;
                    let step = (deep_canvas::grammar::FLICKS_PER_SECOND * i64::from(den) / i64::from(num.max(1))).max(1);
                    let frames: Vec<f64> = (0..=span / step).map(|k| (k * step) as f64).chain([span as f64]).collect();
                    let mut failed: Option<String> = None;
                    let mut state_at = |v: f64| {
                        solids_at(doc, v as i64, &moved).unwrap_or_else(|why| {
                            failed.get_or_insert(format!("loop at {v}: {why}"));
                            Vec::new()
                        })
                    };
                    let mut bound = |a: f64, b: f64, solids: &[Solid]| {
                        if self.samples_only {
                            return vec![Some(0.0); solids.len()];
                        }
                        reach_over_time(doc, p, a as i64, b as i64, solids)
                    };
                    let swept = deep_canvas::geometry_audit::sweep(&frames, &cfg, &mut state_at, &mut bound);
                    out.not_run.extend(failed);
                    for (v, faults) in &swept.failed {
                        for f in faults {
                            push(f, state, *v as i64, None, &mut issues);
                        }
                    }
                    estimated(&swept, state, None, &frames, out);
                }
                other => out.not_run.push(other.to_string()),
            }
        }
        issues
    }
}

/// The audit of one deliverable for one requirement: its issues with the document's own
/// exceptions applied, and which of those exceptions a failure needed.
pub(crate) fn audit_document(a: &Audit<'_>) -> DocRun {
    let started = std::time::Instant::now();
    let mut out = DocRun::default();
    let issues = a.run(true, &mut out);
    let (own_f, own_r) = own_exceptions(&a.doc);
    let (def_f, def_r) = exceptions_of(a.input);
    let only_own: BTreeSet<String> = own_f
        .difference(&def_f)
        .filter(|f| !a.approved.contains(*f))
        .cloned()
        .chain(own_r.difference(&def_r).filter(|(x, y)| !a.approved.contains(&format!("{x}~{y}"))).map(|(x, y)| format!("{x}~{y}")))
        .collect();
    if !only_own.is_empty() {
        let mut scratch = DocRun::default();
        let strict = a.run(false, &mut scratch);
        let key = |i: &Value| (i["code"].clone(), i["ids"].clone());
        let have: BTreeSet<String> = issues.iter().map(|i| format!("{:?}", key(i))).collect();
        let extra: Vec<&Value> = strict.iter().filter(|i| !have.contains(&format!("{:?}", key(i)))).collect();
        for i in &extra {
            let ids: Vec<String> = i["ids"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
            let pair = match ids.as_slice() {
                [x, y] => format!("{}~{}", x.min(y), x.max(y)),
                _ => String::new(),
            };
            let named: Vec<&String> = only_own.iter().filter(|e| ids.contains(e) || **e == pair).collect();
            if named.is_empty() {
                out.excused_by.extend(only_own.iter().cloned());
            } else {
                out.excused_by.extend(named.into_iter().cloned());
            }
        }
    }
    out.issues = issues;
    out.ms = started.elapsed().as_secs_f64() * 1e3;
    out
}

/// One requirement's geometry audit over every deliverable.
#[derive(Default)]
pub(crate) struct Judged {
    pub issues: Vec<Value>,
    /// A state this build can't evaluate.
    pub blocked: Vec<Value>,
    /// The refusals of a check over a range a sweep only sampled.
    pub refused: Vec<Value>,
    pub estimates: Vec<Value>,
    /// Each exception only the document's own statement makes, with its ask's ID and whether
    /// this verdict asks it (an ask is made once, never twice).
    pub pending: Vec<(String, String, bool)>,
    pub ms: f64,
}

impl crate::hub::Hub<'_> {
    /// `geometry.audit` on each requirement of the claim that names it, on every deliverable's
    /// current revision: requirement ID → what it found.
    pub(crate) fn geometry_audit_runs(&mut self, claim: &str, c: &crate::hub::Claim) -> std::collections::BTreeMap<String, Judged> {
        let mut out = std::collections::BTreeMap::new();
        let samples_only = self.planted(crate::hub::Planted::Audit(Planted::SamplesOnly));
        let overlaps_only = self.planted(crate::hub::Planted::Audit(Planted::OverlapsOnly));
        for r in c.requirements.iter().filter(|r| r.check["kind"] == GEOMETRY_AUDIT) {
            let mut j = Judged::default();
            let prefix = format!("{claim}/{}/", r.id);
            let approved: BTreeSet<String> = self
                .audit_asks
                .iter()
                .filter(|(k, v)| k.starts_with(&prefix) && **v == Some(true))
                .map(|(k, _)| k[prefix.len()..].to_string())
                .collect();
            for doc in &c.deliverables {
                let Some(revision) = self.query_revision(doc, None) else {
                    continue;
                };
                let mut drawn = revision.drawn;
                if drawn.get("size").is_none() {
                    drawn["size"] = json!([640, 480]);
                }
                let assemblies_at_rest = self.planted(crate::hub::Planted::SweepPosesAssembliesAtRest);
                let run = audit_document(&Audit { doc: drawn, input: &r.check, approved: &approved, samples_only, overlaps_only, assemblies_at_rest });
                j.ms += run.ms;
                for mut i in run.issues {
                    i["doc"] = json!(doc);
                    j.issues.push(i);
                }
                for s in run.not_run {
                    j.blocked.push(json!({"code": "not_run", "kind": GEOMETRY_AUDIT, "state": s, "doc": doc, "ids": []}));
                }
                // A check that needs the audit over a stretch only sampled is refused there, naming
                // the control and the stretch, never passed on its samples.
                for (list, from) in [(&mut j.estimates, run.estimates), (&mut j.refused, run.refused)] {
                    list.extend(from.into_iter().map(|mut e| {
                        e["doc"] = json!(doc);
                        e
                    }));
                }
                for x in run.excused_by {
                    let id = format!("{prefix}{x}");
                    let fresh = !self.audit_asks.contains_key(&id);
                    if fresh {
                        self.audit_asks.insert(id.clone(), None);
                    }
                    if self.audit_asks.get(&id) == Some(&Some(false)) {
                        // You said no: what only that exception let go fails.
                        j.issues.push(json!({"check": GEOMETRY_AUDIT, "code": "exception_not_approved", "severity": "error",
                            "ids": [x], "doc": doc, "what": format!("`{x}` is excused only by the document's own statement, which you didn't approve"),
                            "fix": format!("fix what `{x}` excuses, or name it in the definition")}));
                    } else {
                        j.pending.push((id, x, fresh));
                    }
                }
            }
            out.insert(r.id.clone(), j);
        }
        out
    }

    /// `{"call": "answer", "claim", "requirement", "answer"}`: your answer to the approval asks a
    /// geometry audit opened on a claim's requirement. A yes lets each exception narrow that
    /// requirement's check from the next verdict on; only you decide, never a working agent.
    pub(crate) fn answer_call(&mut self, via: Option<&crate::hub::Via>, claim: &str, requirement: &str, yes: bool) -> Value {
        let (writer, you) = self.decider(via);
        if !you {
            return json!({"outcome": "refused", "code": "not_your_decision", "writer": writer});
        }
        let prefix = format!("{claim}/{requirement}/");
        let open: Vec<String> = self
            .audit_asks
            .iter()
            .filter(|(k, v)| k.starts_with(&prefix) && v.is_none())
            .map(|(k, _)| k.clone())
            .collect();
        if open.is_empty() {
            return json!({"outcome": "refused", "code": "no_open_ask", "claim": claim, "requirement": requirement});
        }
        for k in &open {
            self.audit_asks.insert(k.clone(), Some(yes));
        }
        json!({"outcome": "answered", "asks": open, "answer": if yes { "yes" } else { "no" }})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The scene audit of a floor, which may float, and one kit piece, a 1 m box placed by `at`
    /// under `parent`, with `check`'s fields.
    fn audited(at: Value, parent: Option<&str>, check: Value) -> DocRun {
        let solid = |id: &str, size: [f64; 3], at: Value| {
            json!({"id": id, "kind": "mark.box@1", "layer": "main", "name": id, "order": "a1", "params": {"size": size}, "at": at})
        };
        let mut piece = solid("piece", [1.0; 3], at);
        if let Some(p) = parent {
            piece["parent"] = json!(p);
        }
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [64, 64],
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "collections": {"kit": {"members": ["piece"]}},
            "items": {"floor": solid("floor", [6.0, 0.2, 6.0], json!({"pos": [0, -0.1, 0]})), "piece": piece},
        });
        let mut input = json!({"kind": GEOMETRY_AUDIT, "scope": "scene", "support": {"floating": ["floor"]}});
        input.as_object_mut().expect("an object").extend(check.as_object().expect("an object").clone());
        audit_document(&Audit { doc, input: &input, approved: &BTreeSet::new(), samples_only: false, overlaps_only: false, assemblies_at_rest: false })
    }

    #[test]
    fn a_turned_piece_is_snapped_by_ops_and_a_parented_one_in_words() {
        let grid = json!({"grid": {"unit": 1, "sub": 0.5, "items": "kit"}});
        let turned = audited(json!({"pos": [2, 0.5, 0], "rot": [0, 80, 0]}), None, grid.clone()).issues;
        assert_eq!(turned.len(), 1, "{turned:?}");
        assert_eq!((&turned[0]["code"], &turned[0]["ids"]), (&json!("geometry.off_grid"), &json!(["piece"])));
        let ops = turned[0]["fix"].as_array().expect("the fix is patch ops");
        assert_eq!(ops[0], json!({"op": "set", "id": "piece", "path": "items/piece/at/pos", "value": [2.0, 0.5, 0.0]}));
        assert_eq!((&ops[1]["op"], &ops[1]["path"]), (&json!("set"), &json!("items/piece/at/rot/1")));
        assert!((ops[1]["value"].as_f64().expect("a yaw") - 90.0).abs() < 1e-9, "{ops:?}");
        // Under the floor, 0.05 m off in x: its `at` is not its place, so no op sets it.
        let parented = audited(json!({"pos": [2.05, 0.6, 0]}), Some("floor"), grid).issues;
        assert_eq!(parented.len(), 1, "{parented:?}");
        assert_eq!(parented[0]["code"], "geometry.off_grid");
        assert!(parented[0]["fix"].is_string(), "{parented:?}");
    }

    #[test]
    fn a_collection_the_document_lacks_is_never_passed_over() {
        let check = json!({"grid": {"sub": 0.5, "items": "nope"}, "seams": {"pairs": [["kit", "nope"]]}});
        let run = audited(json!({"pos": [2, 0.5, 0]}), None, check);
        assert_eq!(run.not_run, ["grid", "seams"]);
        assert!(run.issues.is_empty(), "{:?}", run.issues);
    }
}
