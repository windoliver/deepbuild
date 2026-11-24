//! #3258: soft bodies that passed through what they met (canvas primitives: Check input: loop
//! kinds; `physics.audit`'s `soft.through`). Read at every step in f64 from each particle's and
//! each body's canonical state and the document's own shapes, apart from the backend's contacts,
//! which hold nothing of a particle that stood above a plate at one step and stands below it at
//! the next. A soft body passes three ways, each counted once for each pair:
//!
//! - **Through a shape:** a particle goes into a body's shape and comes out on its far side, where
//!   the shape's outward normals at the two points face apart, in one step or over several, its
//!   path taken in the body's own frame. A shape with no inside (a plane, a heightfield, a mesh) is
//!   passed when a particle crosses it and ends more than `penetration.max` beyond it.
//! - **Between particles:** over a step, an edge or a face meets a shape thinner than the gap
//!   between its particles' spheres while the shape touches none of those spheres. A thicker shape
//!   is the particles' to hold, and so is one that touches them.
//! - **Through a soft body:** with every point moving in a straight line over the step, a particle
//!   crosses a face it isn't a corner of, or an edge crosses an edge it shares no particle with,
//!   and ends on its other side.
//!
//! A soft body meets what their collision groups let it meet, never a sensor, and itself only with
//! `self_contacts` on: with it off its own count is a reading, never a failure. A copy a tear made
//! of a particle isn't read, since it has no address of its lattice.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::backend::State;
use crate::doc::{Soft, World};

mod solid;
use solid::{
    apart, bounds, cross, dot, farthest, join, len, lerp, meets, normal, overlap, parts, sub,
    Bounds, Faces, Frame, Sheet, Solid, Sorted, V3,
};

/// The rule a failure names.
pub const RULE: &str = "soft.through";

/// How far apart two normals, or two directions, face before they face apart: past rounding.
const APART: f64 = 1e-9;
/// How near a particle's sphere, m, a shape is the sphere's to hold: past rounding.
const HELD: f64 = 1e-6;

/// A planted reading (tests/acceptance/3258): one that reads only the backend's contact pairs; one
/// that takes a particle's path in the world, against the shape where it stands; one that reads
/// each step alone; and one that counts every particle that was inside a shape.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    ContactPairs,
    WorldPath,
    OneStep,
    AnyInside,
}

/// A part of a soft body, by its particles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Part {
    Particle(u32),
    Edge([u32; 2]),
    Face([u32; 3]),
}

impl Part {
    /// What a failure names it by.
    fn key(&self) -> &'static str {
        match self {
            Part::Particle(_) => "particle",
            Part::Edge(_) => "edge",
            Part::Face(_) => "face",
        }
    }

    fn particles(&self) -> &[u32] {
        match self {
            Part::Particle(i) => std::slice::from_ref(i),
            Part::Edge(e) => e,
            Part::Face(f) => f,
        }
    }
}

/// What a part passed through: a shape use, or a soft body's part, each by its place in the lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Met {
    Use(usize),
    Soft(usize, Part),
}

/// One way through: the step, the soft body and the part of it that passed, and what it met.
#[derive(Debug)]
struct Pass {
    step: u64,
    soft: usize,
    part: Part,
    met: Met,
    /// The gap between the part's particles, m, where a shape passed between them.
    gap: f64,
}

/// A soft body: its edges and faces that no tear has cut, and its particles at the last two steps
/// with the box around them all.
struct Lattice<'w> {
    id: &'w str,
    soft: &'w Soft,
    edges: Vec<[u32; 2]>,
    faces: Vec<[u32; 3]>,
    from: Vec<V3>,
    to: Vec<V3>,
    /// The box each particle sweeps over the step.
    swept: Vec<Bounds>,
    around: Bounds,
}

impl Lattice<'_> {
    /// The box a part sweeps over the step.
    fn sweeps(&self, part: &[u32]) -> Bounds {
        let at = |i: &u32| self.swept[*i as usize];
        part[1..].iter().fold(at(&part[0]), |b, i| join(&b, &at(i)))
    }

    fn name(&self, i: u32) -> String {
        format!("{}#{}", self.id, self.soft.addresses[i as usize])
    }
}

/// A shape use that holds soft bodies off, and where its body stood at the last two steps.
struct Use<'w> {
    body: &'w str,
    index: usize,
    member: u32,
    collides: u32,
    solids: Vec<Solid>,
    sheet: Option<Sheet>,
    last: Option<Frame>,
    now: Option<Frame>,
}

/// The reading over one run, fed each step's state.
pub struct Through<'w> {
    w: &'w World,
    planted: Planted,
    /// `penetration.max`, m.
    depth: f64,
    softs: Vec<Lattice<'w>>,
    uses: Vec<Use<'w>>,
    /// The normal at which a particle went in and hasn't come out, its body's frame, by soft body,
    /// shape use and particle; with the side of a face's winding it came from.
    within: BTreeMap<(usize, usize, usize), (V3, f64)>,
    seen: BTreeSet<(usize, Part, Met)>,
    passes: Vec<Pass>,
    own: u64,
}

impl<'w> Through<'w> {
    /// The reading of `w`, none for a world with no soft body.
    pub fn new(w: &'w World, depth: f64, planted: Planted) -> Option<Self> {
        let softs: Vec<Lattice> = w
            .soft
            .iter()
            .map(|(id, soft)| Lattice {
                id,
                soft,
                edges: soft.edges.clone(),
                faces: soft.triangles.clone(),
                from: Vec::new(),
                to: Vec::new(),
                swept: Vec::new(),
                around: bounds([]),
            })
            .collect();
        if softs.is_empty() {
            return None;
        }
        let mut uses = Vec::new();
        for (body, b) in &w.bodies {
            for (index, u) in b.shapes.iter().enumerate().filter(|(_, u)| !u.sensor) {
                let (solids, sheet) = parts(w, &u.shape, &u.offset);
                uses.push(Use {
                    body,
                    index,
                    member: u.member,
                    collides: u.collides,
                    solids,
                    sheet,
                    last: None,
                    now: None,
                });
            }
        }
        Some(Through {
            w,
            planted,
            depth,
            softs,
            uses,
            within: BTreeMap::new(),
            seen: BTreeSet::new(),
            passes: Vec::new(),
            own: 0,
        })
    }

    /// Cuts the edges of soft body `id` a tear's row lists, by address: no edge, and no side of a
    /// face, from that step on.
    pub fn tear(&mut self, id: &str, edges: &[[String; 2]]) {
        let Some(l) = self.softs.iter_mut().find(|l| l.id == id) else {
            return;
        };
        let at = |a: &String| l.soft.addresses.iter().position(|x| x == a);
        let cut: BTreeSet<[u32; 2]> = edges
            .iter()
            .filter_map(|[a, b]| Some((at(a)? as u32, at(b)? as u32)))
            .map(|(a, b)| [a.min(b), a.max(b)])
            .collect();
        let torn = |a: u32, b: u32| cut.contains(&[a.min(b), a.max(b)]);
        l.edges.retain(|[a, b]| !torn(*a, *b));
        l.faces
            .retain(|[a, b, c]| !(torn(*a, *b) || torn(*b, *c) || torn(*c, *a)));
    }

    /// Reads the state after step `step` (0 the state as built); a body `state` leaves out meets
    /// nothing.
    pub fn step(&mut self, step: u64, state: &State) {
        if self.planted == Planted::ContactPairs {
            return;
        }
        for (l, s) in self.softs.iter_mut().zip(&state.soft) {
            l.from = std::mem::replace(&mut l.to, s.positions.clone());
            if l.from.len() != l.to.len() {
                l.from.clone_from(&l.to);
            }
            let paths = l.from.iter().zip(&l.to);
            l.swept = paths.map(|(a, b)| join(&(*a, *a), &(*b, *b))).collect();
            let boxes = l.swept.iter().copied();
            l.around = boxes.reduce(|a, b| join(&a, &b)).unwrap_or(bounds([]));
        }
        for u in &mut self.uses {
            let at = state.bodies.binary_search_by(|b| b.id.as_str().cmp(u.body));
            let now = at.ok().map(|i| &state.bodies[i]);
            u.last = std::mem::replace(&mut u.now, now.map(|b| Frame::new(b.pos, b.rot)));
        }
        for s in 0..self.softs.len() {
            for u in 0..self.uses.len() {
                self.shape(step, s, u);
            }
        }
        for s in 0..self.softs.len() {
            for other in s..self.softs.len() {
                self.softs(step, s, other);
            }
        }
    }

    fn record(&mut self, step: u64, soft: usize, part: Part, met: Met, gap: f64) {
        if !self.seen.insert((soft, part, met)) {
            return;
        }
        let itself = matches!(met, Met::Soft(other, _) if other == soft);
        if itself && !self.softs[soft].soft.self_contacts {
            self.own += 1;
            return;
        }
        self.passes.push(Pass {
            step,
            soft,
            part,
            met,
            gap,
        });
    }

    /// Reads soft body `s` against shape use `u` over the step.
    fn shape(&mut self, step: u64, s: usize, u: usize) {
        let (l, shape) = (&self.softs[s], &self.uses[u]);
        let meet = l.soft.member & shape.collides != 0 && shape.member & l.soft.collides != 0;
        let Some(now) = shape.now.filter(|_| meet) else {
            return;
        };
        // A body that came to be in this step stands where it is.
        let last = match self.planted {
            Planted::WorldPath => now,
            _ => shape.last.unwrap_or(now),
        };
        let mut found = Vec::new();
        // Each solid that may be met, with its two frames, and the particles' paths in it.
        let mut solids: Vec<(&Solid, Vec<[V3; 2]>)> = Vec::new();
        for solid in &shape.solids {
            let (f, t) = (last.of_child(&solid.frame), now.of_child(&solid.frame));
            let (a, b) = (f.around(&solid.bounds), t.around(&solid.bounds));
            if overlap(&bounds([a.0, a.1, b.0, b.1]), &l.around) {
                let path = l.from.iter().zip(&l.to);
                let path = path.map(|(a, b)| [f.local(*a), t.local(*b)]);
                solids.push((solid, path.collect()));
            }
        }
        if solids.is_empty() && shape.sheet.is_none() {
            return;
        }
        // A shape with no inside has no solid, and its own reading below.
        let particles = if solids.is_empty() { 0 } else { l.to.len() };
        for p in 0..particles {
            let key = (s, u, p);
            let mut was = match (&self.planted, self.within.is_empty()) {
                (Planted::OneStep, _) | (_, true) => None,
                _ => self.within.remove(&key),
            };
            let spans = solids.iter().filter_map(|(solid, path)| {
                let [a, b] = path[p];
                solid.cross(a, b)
            });
            // A compound is one shape: what its children hold between them is one stay inside.
            let mut spans: Vec<_> = spans.collect();
            spans.sort_by(|a, b| a.t[0].total_cmp(&b.t[0]));
            spans.dedup_by(|next, kept| {
                let joins = next.t[0] <= kept.t[1];
                if joins && next.t[1] > kept.t[1] {
                    (kept.t[1], kept.n[1]) = (next.t[1], next.n[1]);
                }
                joins
            });
            for span in spans {
                let entry = if span.t[0] < 0.0 {
                    was.take()
                } else {
                    Some((span.n[0], 0.0))
                };
                let stays = span.t[1] > 1.0;
                let through = !stays && entry.is_some_and(|(n, _)| dot(n, span.n[1]) < -APART);
                if through || self.planted == Planted::AnyInside {
                    found.push((Part::Particle(p as u32), 0.0));
                }
                if let Some(n) = entry.filter(|_| stays) {
                    self.within.insert(key, n);
                }
            }
        }
        let slack = l.soft.particle_radius + HELD;
        for (solid, path) in &solids {
            let far = |set: &[V3]| solid.apart(set);
            between(l, path, &solid.bounds, solid.thin, slack, &far, &mut found);
        }
        if let Some(sheet) = &shape.sheet {
            let (f, t) = (last.of_child(&sheet.frame), now.of_child(&sheet.frame));
            let path = l.from.iter().zip(&l.to);
            let path: Vec<[V3; 2]> = path.map(|(a, b)| [f.local(*a), t.local(*b)]).collect();
            for (p, [a, b]) in path.iter().enumerate() {
                let was = self.within.remove(&(s, u, p));
                let (beyond, through) = past(&sheet.faces, self.depth, was, *a, *b);
                if through {
                    found.push((Part::Particle(p as u32), 0.0));
                }
                if let Some(n) = beyond {
                    self.within.insert((s, u, p), n);
                }
            }
            let around = bounds(path.iter().flatten().copied());
            if sheet.thin.is_finite() && overlap(&sheet.bounds, &around) {
                for t in sheet.faces.near(&around) {
                    let far = |set: &[V3]| apart(set, &|d| farthest(&t, d));
                    let slack = slack + self.depth;
                    between(l, &path, &bounds(t), sheet.thin, slack, &far, &mut found);
                }
            }
        }
        for (part, gap) in found {
            self.record(step, s, part, Met::Use(u), gap);
        }
    }

    /// Reads soft body `s` against `other`, or itself, over the step.
    fn softs(&mut self, step: u64, s: usize, other: usize) {
        let (a, b) = (&self.softs[s], &self.softs[other]);
        let meet = a.soft.member & b.soft.collides != 0 && b.soft.member & a.soft.collides != 0;
        if s != other && !(meet && overlap(&a.around, &b.around)) {
            return;
        }
        // Boxes are sorted along their longest side.
        let size = sub(b.around.1, b.around.0);
        let axis = (0..3).fold(0, |k, i| if size[i] > size[k] { i } else { k });
        let mut found = Vec::new();
        let mut faces = |x: usize, y: usize| {
            let (l, m) = (&self.softs[x], &self.softs[y]);
            let boxes = Sorted::new(axis, m.faces.iter().map(|f| m.sweeps(f)));
            let particles = if m.faces.is_empty() { 0 } else { l.to.len() };
            for p in 0..particles {
                for k in boxes.near(&l.swept[p]) {
                    let f = m.faces[k];
                    if x == y && f.contains(&(p as u32)) {
                        continue;
                    }
                    let at = |c: u32| [m.from[c as usize], m.to[c as usize]];
                    let moves = [at(f[0]), at(f[1]), at(f[2]), [l.from[p], l.to[p]]];
                    if crosses(&moves, in_face) {
                        found.push((x, Part::Particle(p as u32), y, Part::Face(f)));
                    }
                }
            }
        };
        faces(s, other);
        if s != other {
            faces(other, s);
        }
        let mut edges = |i: usize, k: usize| {
            let (e, f) = (a.edges[i], b.edges[k]);
            let at = |l: &Lattice, c: u32| [l.from[c as usize], l.to[c as usize]];
            let moves = [at(a, e[0]), at(a, e[1]), at(b, f[0]), at(b, f[1])];
            let shared = s == other && f.iter().any(|p| e.contains(p));
            if !shared && crosses(&moves, in_edges) {
                found.push((s, Part::Edge(e), other, Part::Edge(f)));
            }
        };
        let boxes = Sorted::new(axis, b.edges.iter().map(|e| b.sweeps(e)));
        if s == other {
            boxes.pairs().for_each(|(i, k)| edges(i, k));
        } else {
            for (i, e) in a.edges.iter().enumerate() {
                let swept = a.sweeps(e);
                boxes.near(&swept).for_each(|k| edges(i, k));
            }
        }
        // Particles first, then by their places.
        found.sort_by_key(|f| (matches!(f.1, Part::Edge(_)), *f));
        for (x, part, y, met) in found {
            self.record(step, x, part, Met::Soft(y, met), 0.0);
        }
    }

    /// How many times something passed through, and how many a soft body whose `self_contacts` is
    /// off passed through itself.
    pub fn counts(&self) -> (usize, u64) {
        (self.passes.len(), self.own)
    }

    /// The audit's failure once more than `max` passed through, naming the first past it.
    pub fn failure(&self, max: u64) -> Option<Value> {
        let p = self.passes.get(usize::try_from(max).ok()?)?;
        let names = |soft: usize, part: &Part| -> Vec<String> {
            let of = |i: &u32| self.softs[soft].name(*i);
            part.particles().iter().map(of).collect()
        };
        let named = |part: &Part, all: &[String]| match part {
            Part::Particle(_) => format!("particle {}", all[0]),
            _ => format!("the {} {}", part.key(), all.join(" to ")),
        };
        // A particle's address, or the addresses of an edge's or a face's particles.
        let value = |part: &Part, all: &[String]| match part {
            Part::Particle(_) => json!(all[0]),
            _ => json!(all),
        };
        let mut row = Map::new();
        let id = self.softs[p.soft].id;
        let all = names(p.soft, &p.part);
        row.insert(p.part.key().into(), value(&p.part, &all));
        let what = named(&p.part, &all);
        let (what, mut ids, fix) = match &p.met {
            Met::Use(u) => {
                let shape = &self.uses[*u];
                let name = &self.w.bodies[shape.body].shapes[shape.index].shape;
                let used = json!({"body": shape.body, "index": shape.index, "shape": name});
                row.insert("shape".into(), used);
                let met = format!("{}'s shape {} ({name})", shape.body, shape.index);
                let (what, fix) = match p.part {
                    Part::Particle(_) => (
                        format!("{what} passed through {met}"),
                        format!("Raise {id}'s particle_radius or the world's substeps, or thicken the shape"),
                    ),
                    _ => (
                        format!("{what} met {met}, thinner than the {:.4} m gap between its particles", p.gap),
                        format!("Put {id}'s particles closer together than the shape is thick, raise its particle_radius, or thicken the shape"),
                    ),
                };
                (what, vec![id, shape.body], fix)
            }
            Met::Soft(other, part) => {
                let (there, all) = (self.softs[*other].id, names(*other, part));
                row.insert("other".into(), json!(there));
                let met = match part {
                    Part::Edge(_) => "other_edge",
                    _ => part.key(),
                };
                row.insert(met.into(), value(part, &all));
                let fix = format!("Raise {id}'s or {there}'s particle_radius, put their particles closer together, or raise the world's substeps");
                let what = format!("{what} passed through {}", named(part, &all));
                (what, vec![id, there], fix)
            }
        };
        ids.dedup();
        let n = self.passes.len();
        let head = json!({"rule": RULE, "id": id, "ids": ids, "step": p.step, "measured": n, "limit": max,
            "what": format!("{what} at step {}; {n} passed through in all, past soft.through.max {max}", p.step), "fix": fix});
        let Value::Object(mut out) = head else {
            return None;
        };
        out.extend(row);
        Some(Value::Object(out))
    }
}

/// Each edge and face of `l` that meets a convex part of a shape over the step, with the gap
/// between its particles: those whose gap is wider than the shape is `thin`, and whose particles'
/// spheres, grown to `slack`, it doesn't touch. `path` is each particle's, in the part's frame,
/// `around` the part's box and `far` how far a set of points is from it.
fn between(
    l: &Lattice,
    path: &[[V3; 2]],
    around: &Bounds,
    thin: f64,
    slack: f64,
    far: &dyn Fn(&[V3]) -> (f64, V3),
    found: &mut Vec<(Part, f64)>,
) {
    let edges = l.edges.iter().map(|e| Part::Edge(*e));
    for part in edges.chain(l.faces.iter().map(|f| Part::Face(*f))) {
        let of = |i: &u32| path[*i as usize];
        let at = part.particles();
        if !overlap(around, &bounds(at.iter().flat_map(of))) {
            continue;
        }
        let (from, to): (Vec<V3>, Vec<V3>) = at.iter().map(of).map(|[a, b]| (a, b)).unzip();
        let apart = |i: usize| len(sub(to[i], to[(i + 1) % to.len()]));
        let widest = (0..to.len()).map(apart).fold(0.0, f64::max);
        let gap = widest - 2.0 * l.soft.particle_radius;
        let clear = |(a, b): (&V3, &V3)| far(&[*a, *b]).0 > slack;
        if thin < gap && from.iter().zip(&to).all(clear) && meets(&from, &to, far) {
            found.push((part, gap));
        }
    }
}

/// A particle's path from `a` to `b` past `faces`: the normal it crossed them by, facing where it
/// came from, with that side of the face's winding, while it is beyond them (`was` before this
/// step); and whether it ends more than `depth` beyond.
fn past(
    faces: &Faces,
    depth: f64,
    was: Option<(V3, f64)>,
    a: V3,
    b: V3,
) -> (Option<(V3, f64)>, bool) {
    if let Faces::Plane(n) = faces {
        let (from, to) = (dot(*n, a), dot(*n, b));
        let beyond = to < 0.0 && (was.is_some() || from >= 0.0);
        return (beyond.then_some((*n, 1.0)), beyond && to < -depth);
    }
    let path = bounds([a, b]);
    let mut crossed = Vec::new();
    for t in faces.near(&path) {
        let Some(n) = normal(&t) else { continue };
        let (from, to) = (dot(n, sub(a, t[0])), dot(n, sub(b, t[0])));
        if (from >= 0.0) == (to >= 0.0) {
            continue;
        }
        let at = from / (from - to);
        if in_face([t[0], t[1], t[2], lerp(a, b, at)]) {
            let side = if from >= 0.0 { 1.0 } else { -1.0 };
            crossed.push((at, n.map(|x| x * side), side));
        }
    }
    crossed.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut beyond = was;
    for (_, n, side) in crossed {
        beyond = match beyond {
            None => Some((n, side)),
            // Out again where it came from, or round a corner, unless on the far side.
            Some((entry, _)) if dot(entry, n) <= APART => None,
            kept => kept,
        };
    }
    let Some((entry, side)) = beyond else {
        return (None, false);
    };
    // Beyond every face that faces where it came from by more than `depth`.
    let reach = (b.map(|x| x - depth), b.map(|x| x + depth));
    let near = faces.near(&reach).into_iter().any(|t| {
        let same = normal(&t).is_some_and(|n| side * dot(n, entry) > 0.0);
        same && apart(&[b], &|d| farthest(&t, d)).0 <= depth
    });
    (beyond, !near)
}

/// Whether the last point, in the plane of the first three, is in their triangle.
fn in_face([a, b, c, p]: [V3; 4]) -> bool {
    let n = cross(sub(b, a), sub(c, a));
    let least = -APART * dot(n, n);
    let sides = [(a, b), (b, c), (c, a)];
    let inside = |(u, v): &(V3, V3)| dot(cross(sub(*v, *u), sub(p, *u)), n) >= least;
    dot(n, n) > 0.0 && sides.iter().all(inside)
}

/// Whether two segments in one plane, each two of the points, cross.
fn in_edges([a, b, c, d]: [V3; 4]) -> bool {
    let (e, f, r) = (sub(b, a), sub(d, c), sub(c, a));
    let n = cross(e, f);
    let nn = dot(n, n);
    let within = |x: f64| x >= -APART * nn && x <= nn * (1.0 + APART);
    nn > 0.0 && within(dot(cross(r, f), n)) && within(dot(cross(r, e), n))
}

/// Whether four points, each moving in a straight line from its first place to its second, end
/// turned over: their volume's sign changes over the step, where `hit` at a time it is zero.
fn crosses(moves: &[[V3; 2]; 4], hit: fn([V3; 4]) -> bool) -> bool {
    let at = |t: f64| moves.map(|[a, b]| lerp(a, b, t));
    let volume = |[a, b, c, d]: [V3; 4]| dot(cross(sub(b, a), sub(c, a)), sub(d, a));
    let side = |t: f64| volume(at(t)) >= 0.0;
    if side(0.0) == side(1.0) {
        return false;
    }
    // The volume is a cubic in time: its turns split the step where it can be bisected.
    let [from, to] = [0, 1].map(|k| moves.map(|m| m[k]));
    let edges = |p: [V3; 4]| [1, 2, 3].map(|i| sub(p[i], p[0]));
    let (p, q) = (edges(from), edges(to));
    let r = [0, 1, 2].map(|i| sub(q[i], p[i]));
    let det = |a: V3, b: V3, c: V3| dot(cross(a, b), c);
    let c1 = det(r[0], p[1], p[2]) + det(p[0], r[1], p[2]) + det(p[0], p[1], r[2]);
    let c2 = det(p[0], r[1], r[2]) + det(r[0], p[1], r[2]) + det(r[0], r[1], p[2]);
    let c3 = det(r[0], r[1], r[2]);
    let mut cuts = vec![0.0];
    let root = deep_canvas::ops::sqrt((c2 * c2 - 3.0 * c3 * c1).max(0.0));
    let turns = if c3.abs() > 1e-12 * (c1.abs() + c2.abs()) {
        [(-c2 - root) / (3.0 * c3), (-c2 + root) / (3.0 * c3)]
    } else {
        [-c1 / (2.0 * c2), f64::NAN]
    };
    let mut turns = turns.to_vec();
    turns.retain(|t| *t > 0.0 && *t < 1.0);
    turns.sort_by(f64::total_cmp);
    cuts.extend(turns);
    cuts.push(1.0);
    cuts.windows(2).any(|w| {
        let (mut lo, mut hi) = (w[0], w[1]);
        let first = side(lo);
        if first == side(hi) {
            return false;
        }
        for _ in 0..60 {
            let m = (lo + hi) / 2.0;
            if side(m) == first {
                lo = m;
            } else {
                hi = m;
            }
        }
        hit(at(hi))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{BodyState, SoftState};
    use crate::caps::RAPIER3D;
    use crate::check::check;
    use crate::roles::TABLE;

    const UPRIGHT: [f64; 4] = [0.0, 0.0, 0.0, 1.0];

    /// A world of one static body `b` on shape `s`, with `soft` in it.
    fn world(shape: Value, soft: Value) -> World {
        world_at(shape, json!({}), soft)
    }

    fn world_at(shape: Value, offset: Value, soft: Value) -> World {
        let doc = json!({
            "kind": "physics.world@1",
            "capacity": {"bodies": 4, "shapes": 8, "joints": 0, "contacts": 8, "particles": 64},
            "collision_groups": ["a", "b"],
            "shapes": {"s": shape, "half": {"kind": "box", "half": [0.5, 0.1, 0.5]}},
            "bodies": {"b": {"kind": "static", "shapes": [{"shape": "s", "offset": offset, "member": ["a"], "collides": ["a"]}]}},
            "soft": soft
        });
        check(&doc, &RAPIER3D, &TABLE).expect("the world is admitted")
    }

    /// A rope of `n` particles 0.1 m apart along x, each at height `y`.
    fn rope(n: usize, group: &str) -> Value {
        json!({"r": {"shape": "rope", "from": [0, 1, 0], "to": [0.1 * (n - 1) as f64, 1, 0], "particles": n, "collision_group": group}})
    }

    /// `w` read over `states`, each soft body's particles at each step.
    fn read<'w>(w: &'w World, states: &[Vec<Vec<V3>>]) -> Through<'w> {
        let mut t = Through::new(w, 0.01, Planted::None).expect("the world holds a soft body");
        feed(&mut t, w, 0, states);
        t
    }

    fn feed(t: &mut Through, w: &World, from: u64, states: &[Vec<Vec<V3>>]) {
        for (k, positions) in states.iter().enumerate() {
            let body = |id: &String| BodyState {
                id: id.clone(),
                rot: UPRIGHT,
                ..BodyState::default()
            };
            let soft = |(id, p): (&String, &Vec<V3>)| SoftState {
                id: id.clone(),
                positions: p.clone(),
                velocities: vec![[0.0; 3]; p.len()],
            };
            let state = State {
                step: from + k as u64,
                bodies: w.bodies.keys().map(body).collect(),
                soft: w.soft.keys().zip(positions).map(soft).collect(),
            };
            t.step(from + k as u64, &state);
        }
    }

    /// The rope of two particles whose first takes `path`, its second far off.
    fn path(points: &[V3]) -> Vec<Vec<Vec<V3>>> {
        points
            .iter()
            .map(|p| vec![vec![*p, [9.0, 9.0, 9.0]]])
            .collect()
    }

    /// What passed through shape `shape` on the path a particle takes through `points`.
    fn passed(shape: &Value, points: &[V3]) -> usize {
        let w = world(shape.clone(), rope(2, "a"));
        let t = read(&w, &path(points));
        t.passes
            .iter()
            .filter(|p| p.part == Part::Particle(0))
            .count()
    }

    #[test]
    fn a_particle_is_through_a_solid_once_it_comes_out_on_the_far_side() {
        let cube: Vec<V3> = (0..8)
            .map(|k| [0, 1, 2].map(|i| if k >> i & 1 == 0 { -0.1 } else { 0.1 }))
            .collect();
        let stacked = json!({"kind": "compound", "children": [{"shape": "half", "pose": {"pos": [0, 0.05, 0]}}, {"shape": "half", "pose": {"pos": [0, -0.05, 0]}}]});
        for shape in [
            json!({"kind": "sphere", "radius": 0.1}),
            json!({"kind": "box", "half": [0.1, 0.1, 0.1]}),
            json!({"kind": "capsule", "half_height": 0.05, "radius": 0.1}),
            json!({"kind": "cylinder", "half_height": 0.1, "radius": 0.1}),
            json!({"kind": "convex", "points": cube}),
            json!({"kind": "convex", "points": cube, "radius": 0.02}),
            stacked.clone(),
        ] {
            let (above, inside, below) = ([0.01, 0.4, 0.0], [0.01, 0.0, 0.01], [0.0, -0.4, 0.0]);
            assert_eq!(passed(&shape, &[above, below]), 1, "in one step: {shape}");
            assert_eq!(
                passed(&shape, &[above, inside, inside, below]),
                1,
                "over several: {shape}"
            );
            assert_eq!(
                passed(&shape, &[above, inside, above]),
                0,
                "pushed back out: {shape}"
            );
            assert_eq!(
                passed(&shape, &[inside, below]),
                0,
                "started inside: {shape}"
            );
            assert_eq!(
                passed(&shape, &[above, [0.9, 0.4, 0.0], [0.9, -0.4, 0.0]]),
                0,
                "beside it: {shape}"
            );
        }
        let cut = [[0.09, 0.2, 0.0], [0.09, 0.09, 0.0], [0.2, 0.09, 0.0]];
        let hull = |radius: f64| json!({"kind": "convex", "points": cube, "radius": radius});
        let square = json!({"kind": "box", "half": [0.1, 0.1, 0.1]});
        assert_eq!(passed(&square, &cut), 0, "round a corner");
        assert_eq!(passed(&hull(0.0), &cut), 0, "round a hull's corner");
        // Beside a hull's upright edge: past its rounding, and in a wider one.
        let rim = |y: f64| [0.119, y, 0.119];
        assert_eq!(passed(&hull(0.02), &[rim(0.4), rim(-0.4)]), 0);
        assert_eq!(passed(&hull(0.05), &[rim(0.4), rim(-0.4)]), 1);
        // Out of one child's far side into the other, and back.
        let pushed = [[0.01, 0.4, 0.0], [0.01, -0.1, 0.0], [0.01, 0.4, 0.0]];
        assert_eq!(
            passed(&stacked, &pushed),
            0,
            "inside a compound's other child"
        );
    }

    #[test]
    fn a_shape_with_no_inside_is_passed_once_a_particle_ends_past_penetration_beyond_it() {
        let quad = json!({"kind": "mesh", "vertices": [[-1, 0, -1], [-1, 0, 1], [1, 0, 1], [1, 0, -1]], "triangles": [[0, 1, 2], [0, 2, 3]]});
        let field = json!({"kind": "heightfield", "cols": 3, "rows": 3, "heights": vec![0.0; 9], "scale": [2, 1, 2]});
        for shape in [
            json!({"kind": "plane", "normal": [0, 1, 0]}),
            quad.clone(),
            field.clone(),
        ] {
            let at = |y: f64| [0.01, y, 0.02];
            assert_eq!(
                passed(&shape, &[at(0.1), at(-0.005), at(-0.009)]),
                0,
                "within: {shape}"
            );
            assert_eq!(
                passed(&shape, &[at(0.1), at(-0.005), at(-0.011)]),
                1,
                "past: {shape}"
            );
            assert_eq!(
                passed(&shape, &[at(0.1), at(-0.005), at(0.1), [5.0, 0.1, 0.0]]),
                0,
                "back: {shape}"
            );
            assert_eq!(
                passed(&shape, &[at(-0.2), at(-0.4)]),
                0,
                "never across: {shape}"
            );
        }
        // Round the edge of a mesh box, and down its side.
        let box_mesh = json!({"kind": "mesh",
            "vertices": [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
            "triangles": [[3, 7, 6], [3, 6, 2], [1, 2, 6], [1, 6, 5]]});
        let round = [
            [0.999, 1.1, 0.0],
            [0.999, 0.998, 0.0],
            [1.1, 0.998, 0.0],
            [1.1, -0.5, 0.0],
        ];
        assert_eq!(passed(&box_mesh, &round), 0);
        // Under a slope, just beneath it all the way down.
        let hill = json!({"kind": "heightfield", "cols": 3, "rows": 2, "heights": [1, 0, -1, 1, 0, -1], "scale": [2, 1, 2]});
        let along: Vec<V3> = (0..9)
            .map(|k| [-0.8 + 0.2 * f64::from(k), 0.799 - 0.2 * f64::from(k), 0.1])
            .collect();
        let slide = [vec![[-0.8, 1.0, 0.1]], along].concat();
        assert_eq!(passed(&hill, &slide), 0);
    }

    #[test]
    fn a_shape_between_particles_is_passed_where_it_is_thinner_than_the_gap_and_touches_none() {
        // A rope level along x falls past a rod that lies along z at x = `x`.
        let fall = |r: f64, x: f64, radius: f64, dy: f64| {
            let mut soft = rope(3, "a");
            soft["r"]["particle_radius"] = json!(radius);
            let rod = json!({"kind": "capsule", "half_height": 1.0, "radius": r});
            let w = world_at(rod, json!({"pos": [x, 0, 0], "rot": [90, 0, 0]}), soft);
            let at = |y: f64| vec![(0..3).map(|i| [0.1 * f64::from(i), y, 0.0]).collect()];
            let states: Vec<_> = (0..20).map(|k| at(0.31 - dy * f64::from(k))).collect();
            let t = read(&w, &states);
            t.passes.iter().map(|p| p.part).collect::<Vec<_>>()
        };
        let middle = [Part::Edge([0, 1])];
        assert_eq!(fall(0.002, 0.05, 0.0, 0.02), middle, "in small steps");
        assert_eq!(fall(0.002, 0.05, 0.0, 0.5), middle, "in one");
        assert_eq!(fall(0.002, 0.05, 0.03, 0.02), middle, "thinner than 0.04 m");
        assert_eq!(fall(0.021, 0.05, 0.03, 0.02), [], "thicker than 0.04 m");
        assert_eq!(
            fall(0.002, 0.02, 0.03, 0.02),
            [],
            "its particle's sphere's to hold"
        );
        assert_eq!(fall(0.002, 0.25, 0.0, 0.02), [], "beside it");
        // The corner of a thick box, up between two particles that stay clear of it.
        let corner = json!({"pos": [0.05, -deep_canvas::ops::sqrt(0.5), 0], "rot": [0, 0, 45]});
        let thick = json!({"kind": "box", "half": [0.5, 0.5, 0.5]});
        let w = world_at(thick, corner, rope(2, "a"));
        let at = |y: f64| vec![vec![[0.0, y, 0.0], [0.1, y, 0.0]]];
        assert_eq!(
            read(&w, &[at(0.1), at(-0.01)]).counts().0,
            0,
            "as thick as the gap"
        );
    }

    #[test]
    fn a_soft_body_meets_only_what_its_groups_let_it_and_no_torn_edge() {
        let plate = json!({"kind": "box", "half": [1.0, 0.002, 1.0]});
        let fall = |y: f64| vec![vec![[0.0, y, 0.0], [0.1, y, 0.0]]];
        for (group, n) in [("a", 2), ("b", 0)] {
            let w = world(plate.clone(), rope(2, group));
            assert_eq!(
                read(&w, &[fall(0.1), fall(-0.1)]).counts().0,
                n,
                "group {group}"
            );
        }
        // A rod through the torn edge of a rope.
        let rod = json!({"kind": "sphere", "radius": 0.002});
        let w = world(rod, rope(2, "a"));
        let at = |y: f64| vec![vec![[-0.05, y, 0.0], [0.05, y, 0.0]]];
        assert_eq!(read(&w, &[at(0.1), at(-0.1)]).counts().0, 1);
        let mut t = read(&w, &[at(0.2)]);
        t.tear("r", &[["0".to_string(), "1".to_string()]]);
        feed(&mut t, &w, 1, &[at(0.1), at(-0.1)]);
        assert_eq!(t.counts().0, 0);
    }

    #[test]
    fn a_particle_through_a_face_and_an_edge_through_an_edge_end_on_the_other_side() {
        let far = json!({"kind": "sphere", "radius": 0.1});
        let sheet = json!({"shape": "cloth", "origin": [0, 0, 0], "du": [1, 0, 0], "dv": [0, 0, 1], "nu": 2, "nv": 2});
        let w = world(far, json!({"c": sheet, "r": rope(2, "a")["r"].clone()}));
        let still: Vec<V3> = vec![
            [5.0, 0.0, 5.0],
            [6.0, 0.0, 5.0],
            [5.0, 0.0, 6.0],
            [6.0, 0.0, 6.0],
        ];
        let run = |paths: &[[V3; 2]]| {
            let states: Vec<_> = paths
                .iter()
                .map(|p| vec![still.clone(), p.to_vec()])
                .collect();
            let t = read(&w, &states);
            t.passes.iter().map(|p| (p.part, p.met)).collect::<Vec<_>>()
        };
        // Its first particle down through the face, its second clear of the cloth's side.
        let down = |y: f64| [[5.7, y, 5.3], [5.7, y, 8.0]];
        let face = Met::Soft(0, Part::Face([0, 1, 3]));
        // Then the cloth's edge, from its third particle to its fourth, through the rope's.
        let edges = (Part::Edge([2, 3]), Met::Soft(1, Part::Edge([0, 1])));
        assert_eq!(
            run(&[down(0.2), down(-0.2)]),
            [(Part::Particle(0), face), edges]
        );
        assert_eq!(run(&[down(0.2), down(0.1)]), [], "short of it");
        assert_eq!(run(&[down(0.2), down(0.2)]), [], "still");
        let past = |y: f64| [[7.5, y, 5.3], [7.5, y, 8.0]];
        assert_eq!(run(&[past(0.2), past(-0.2)]), [], "beside it");
    }

    #[test]
    fn an_edge_that_crosses_another_and_back_in_one_step_ends_where_it_was() {
        let still = |p: V3| [p, p];
        // The second edge dips under the first, at (0, 0, 0), while it slides along z, and is
        // above it again by the end; or is under it.
        let moves = |end: f64| {
            [
                still([-1.0, 0.0, 0.0]),
                still([1.0, 0.0, 0.0]),
                [[0.0, 0.0, -1.0], [0.0, -2.0, -3.0]],
                [[0.0, 0.8, 3.0], [0.0, end, 1.0]],
            ]
        };
        assert!(!crosses(&moves(0.8), in_edges));
        assert!(crosses(&moves(0.1), in_edges));
    }
}
