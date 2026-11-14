//! #524: `soft@1` (canvas primitives: `soft@1`): ropes, cloth, balloons and soft volumes, each a
//! lattice of particles with stable addresses, read into this crate's own types so no backend's
//! soft-body types reach a world document. A rope's particles are addressed by index, a cloth's
//! by its address pattern's row and column (`r{row}c{col}`, row-major), and a balloon's or a
//! volume's by `v{i}` in its mesh's welded order. A balloon's mesh is the geodesic ball its
//! subdivisions name and a volume's its source item's welded mesh, both resolved where the world
//! meets its scene (deep-physics-rapier's `source.rs`) as `mesh: {vertices, triangles}`; a
//! source that isn't closed, or holds more welded vertices than `max_particles`, is refused here,
//! naming its first open edge or the count. The world's `capacity` is read here too, since its
//! `particles` counts these lattices.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::{join, Body, Material, Reader};

/// A soft body's own fields, `mesh` the one its world's scene resolves.
const SOFT_KEYS: &[&str] = &[
    "kind",
    "shape",
    "positions",
    "to",
    "particles",
    "origin",
    "du",
    "dv",
    "nu",
    "nv",
    "center",
    "radius",
    "subdivisions",
    "from",
    "max_particles",
    "inflate",
    "mesh",
    "edges",
    "address",
    "masses",
    "pins",
    "pinned_to",
    "clusters",
    "stretch",
    "shear",
    "bend",
    "tension_only",
    "particle_radius",
    "self_contacts",
    "damping",
    "tear",
    "contact_material",
    "collision_group",
];

/// The code of a soft volume whose source isn't closed.
pub const OPEN_MESH: &str = "physics.open_mesh";

/// The mass of a particle no `masses` entry names, kg.
const DEFAULT_MASS: f64 = 0.01;

/// What a soft body is (`soft@1`: `shape`).
#[derive(Clone, Debug, PartialEq)]
pub enum SoftShape {
    Rope,
    /// `nu` columns along `du` by `nv` rows along `dv`.
    Cloth {
        nu: usize,
        nv: usize,
    },
    /// The geodesic ball of `subdivisions`, its target volume `inflate` times its rest volume.
    Balloon {
        subdivisions: u32,
    },
    /// The welded mesh of the scene's item `from`.
    Volume {
        from: String,
    },
}

/// A constraint family's stiffness: its natural frequency and damping ratio.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stiffness {
    pub hz: f64,
    pub damping_ratio: f64,
}

/// `tear {strain, force: N, smoothing: s}`: an edge stretched past `strain` (a fraction of its
/// rest length) or pulled past `force` tears.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tear {
    pub strain: Option<f64>,
    pub force: Option<f64>,
    pub smoothing: f64,
}

/// One pinned particle: held where it starts (`body: None`), or carried by a body at the body's
/// anchor `point` (local m) or where it starts when no anchor is named.
#[derive(Clone, Debug, PartialEq)]
pub struct Pin {
    pub particle: u32,
    pub body: Option<String>,
    pub point: Option<[f64; 3]>,
}

/// A soft body as the backend builds it: its particles in address order, its edges and
/// triangles over their indices.
#[derive(Clone, Debug, PartialEq)]
pub struct Soft {
    pub shape: SoftShape,
    pub addresses: Vec<String>,
    /// Each particle's rest position, world m.
    pub positions: Vec<[f64; 3]>,
    /// Structural edges: a rope's chain, a cloth's rows and columns, a mesh's triangle sides, or
    /// the list written.
    pub edges: Vec<[u32; 2]>,
    /// A cloth's cell diagonals.
    pub shear_edges: Vec<[u32; 2]>,
    /// Each particle to its second neighbour along a rope, a cloth's rows and its columns.
    pub bend_edges: Vec<[u32; 2]>,
    /// A cloth's cells, two each, or a closed mesh's surface, outward.
    pub triangles: Vec<[u32; 3]>,
    /// A balloon's or a volume's target volume over its rest volume; 1 for the others.
    pub inflate: f64,
    pub masses: Vec<f64>,
    pub pins: Vec<Pin>,
    pub clusters: BTreeMap<String, Vec<u32>>,
    pub stretch: Stiffness,
    pub shear: Stiffness,
    pub bend: Stiffness,
    pub tension_only: bool,
    pub particle_radius: f64,
    pub self_contacts: bool,
    pub damping: f64,
    pub tear: Option<Tear>,
    pub material: Option<String>,
    pub member: u32,
    pub collides: u32,
}

impl Soft {
    /// The particles an output's `from` reads after `#`: every one for none, `pins` its pinned
    /// ones, else the one at that address.
    pub fn read(&self, part: Option<&str>) -> Vec<usize> {
        match part {
            None => (0..self.positions.len()).collect(),
            Some("pins") => self.pins.iter().map(|p| p.particle as usize).collect(),
            Some(a) => self
                .addresses
                .iter()
                .position(|x| x == a)
                .into_iter()
                .collect(),
        }
    }

    /// Whether its particles enclose a volume: a balloon or a volume.
    pub fn closed(&self) -> bool {
        matches!(
            self.shape,
            SoftShape::Balloon { .. } | SoftShape::Volume { .. }
        )
    }
}

/// `a` and `b` as an edge, the lower index first.
fn edge(a: u32, b: u32) -> [u32; 2] {
    [a.min(b), a.max(b)]
}

/// Each side of `triangles` once, sorted, with how many triangles hold it.
pub fn sides(triangles: &[[u32; 3]]) -> BTreeMap<[u32; 2], u32> {
    let mut out = BTreeMap::new();
    for t in triangles {
        for k in 0..3 {
            *out.entry(edge(t[k], t[(k + 1) % 3])).or_insert(0) += 1;
        }
    }
    out
}

impl Reader {
    /// `capacity: {bodies, shapes, joints, contacts, particles}`, every count required.
    pub(super) fn capacity(&mut self, m: &Map<String, Value>) -> BTreeMap<String, u64> {
        const KEYS: [&str; 5] = ["bodies", "shapes", "joints", "contacts", "particles"];
        let Some(v) = m.get("capacity") else {
            self.refuse(
                "physics.missing_field",
                "capacity".into(),
                &Value::Null,
                "capacity is required: {bodies, shapes, joints, contacts, particles}".into(),
            );
            return BTreeMap::new();
        };
        let c = &self.obj(v, "capacity", &KEYS);
        let mut out = BTreeMap::new();
        for k in KEYS {
            match c.get(k).and_then(Value::as_u64) {
                Some(n) if n <= u32::MAX as u64 => {
                    out.insert(k.to_string(), n);
                }
                _ => self.refuse(
                    "out_of_range",
                    format!("capacity/{k}"),
                    c.get(k).unwrap_or(&Value::Null),
                    format!("capacity/{k} must be a whole number up to {}", u32::MAX),
                ),
            }
        }
        out
    }

    /// `soft: {ID → soft@1}`.
    pub(super) fn softs(
        &mut self,
        m: &Map<String, Value>,
        bodies: &BTreeMap<String, Body>,
        materials: &BTreeMap<String, Material>,
        groups: &[String],
    ) -> BTreeMap<String, Soft> {
        let mut out = BTreeMap::new();
        for (id, v) in self.map(m, "soft") {
            let p = format!("soft/{id}");
            if bodies.contains_key(id) {
                let what = format!("{id} is both a body and a soft body; IDs are one namespace");
                self.refuse("out_of_range", p.clone(), v, what);
            }
            if let Some(s) = self.soft(v, &p, id, bodies, materials, groups) {
                out.insert(id.clone(), s);
            }
        }
        out
    }

    fn whole(
        &mut self,
        m: &Map<String, Value>,
        key: &str,
        p: &str,
        default: f64,
        most: f64,
    ) -> f64 {
        let n = self.num(m, key, p, default, 0.0, most);
        if n.fract() != 0.0 {
            let what = format!("{} must be a whole number", join(p, key));
            self.refuse("out_of_range", join(p, key), &m[key], what);
        }
        n
    }

    fn stiffness(&mut self, m: &Map<String, Value>, key: &str, p: &str, d: Stiffness) -> Stiffness {
        let s = &self.obj(
            m.get(key).unwrap_or(&Value::Null),
            &join(p, key),
            &["hz", "damping_ratio"],
        );
        let p = join(p, key);
        Stiffness {
            hz: self.num(s, "hz", &p, d.hz, f64::MIN_POSITIVE, f64::MAX),
            damping_ratio: self.num(s, "damping_ratio", &p, d.damping_ratio, 0.0, f64::MAX),
        }
    }

    /// The rest positions and addresses of a shape's lattice, its edges by kind and triangles.
    #[allow(clippy::type_complexity)]
    fn lattice(
        &mut self,
        s: &Map<String, Value>,
        p: &str,
        id: &str,
    ) -> Option<(SoftShape, Vec<[f64; 3]>, Vec<String>, f64)> {
        let shape = s.get("shape").and_then(Value::as_str).unwrap_or("");
        let inflate = |r: &mut Reader| r.num(s, "inflate", p, 1.0, f64::MIN_POSITIVE, f64::MAX);
        match shape {
            "rope" => {
                // `positions: [m] | {from, to, particles}`, or `from`, `to` and `particles` beside it.
                let flat: Map<String, Value> = ["from", "to", "particles"]
                    .iter()
                    .filter_map(|k| Some((k.to_string(), s.get(*k)?.clone())))
                    .collect();
                let (at, v) = match s.get("positions") {
                    Some(v) => (join(p, "positions"), v.clone()),
                    None => (p.to_string(), Value::Object(flat)),
                };
                let v = &v;
                let points: Vec<[f64; 3]> = match v {
                    Value::Array(a) => {
                        let pts: Option<Vec<[f64; 3]>> = a.iter().map(vec3_of).collect();
                        let Some(pts) = pts else {
                            let what = format!("{at} must be a list of points, m");
                            self.refuse("out_of_range", at, v, what);
                            return None;
                        };
                        pts
                    }
                    Value::Object(o) if !o.is_empty() => {
                        let o = &self.obj(v, &at, &["from", "to", "particles"]);
                        let (a, b) = (
                            self.vec3(o, "from", &at, [0.0; 3]),
                            self.vec3(o, "to", &at, [0.0; 3]),
                        );
                        let n = self.whole(o, "particles", &at, 0.0, f64::from(u16::MAX)) as usize;
                        (0..n)
                            .map(|i| {
                                let f = i as f64 / (n.max(2) - 1) as f64;
                                [0, 1, 2].map(|k| a[k] + f * (b[k] - a[k]))
                            })
                            .collect()
                    }
                    _ => Vec::new(),
                };
                if points.len() < 2 {
                    let what = format!("rope {id} needs at least 2 particles: positions as points, or {{from, to, particles}}");
                    self.refuse("physics.missing_field", at, v, what);
                    return None;
                }
                let addresses = (0..points.len()).map(|i| i.to_string()).collect();
                Some((SoftShape::Rope, points, addresses, 1.0))
            }
            "cloth" => {
                let origin = self.vec3(s, "origin", p, [0.0; 3]);
                let du = self.vec3(s, "du", p, [0.1, 0.0, 0.0]);
                let dv = self.vec3(s, "dv", p, [0.0, -0.1, 0.0]);
                let nu = self.whole(s, "nu", p, 0.0, f64::from(u16::MAX)) as usize;
                let nv = self.whole(s, "nv", p, 0.0, f64::from(u16::MAX)) as usize;
                if nu < 2 || nv < 2 {
                    let what = format!("cloth {id} needs nu and nv of at least 2");
                    self.refuse(
                        "out_of_range",
                        join(p, "nu"),
                        s.get("nu").unwrap_or(&Value::Null),
                        what,
                    );
                    return None;
                }
                let pattern = match s.get("address") {
                    None => "r{row}c{col}".to_string(),
                    Some(Value::String(a)) if a.contains("{row}") && a.contains("{col}") => {
                        a.clone()
                    }
                    Some(a) => {
                        let what = format!("{p}/address must be a pattern naming {{row}} and {{col}}, such as r{{row}}c{{col}}");
                        self.refuse("out_of_range", join(p, "address"), a, what);
                        return None;
                    }
                };
                let mut points = Vec::new();
                let mut addresses = Vec::new();
                for row in 0..nv {
                    for col in 0..nu {
                        let (c, r) = (col as f64, row as f64);
                        points.push([0, 1, 2].map(|k| origin[k] + c * du[k] + r * dv[k]));
                        addresses.push(
                            pattern
                                .replace("{row}", &row.to_string())
                                .replace("{col}", &col.to_string()),
                        );
                    }
                }
                Some((SoftShape::Cloth { nu, nv }, points, addresses, 1.0))
            }
            "balloon" | "volume" => {
                let at = join(p, "mesh");
                let shape = if shape == "balloon" {
                    self.vec3(s, "center", p, [0.0; 3]);
                    self.num(s, "radius", p, 0.5, f64::MIN_POSITIVE, f64::MAX);
                    let d = self.whole(s, "subdivisions", p, 2.0, 5.0) as u32;
                    SoftShape::Balloon { subdivisions: d }
                } else {
                    let Some(from) = self.text(s, "from", p) else {
                        let what = format!("volume {id} needs from: the ID of a built item or a mesh asset, closed");
                        self.refuse("physics.missing_field", join(p, "from"), &Value::Null, what);
                        return None;
                    };
                    SoftShape::Volume { from }
                };
                let inflate = inflate(self);
                let Some(mesh) = s.get("mesh") else {
                    let (key, what) = match &shape {
                        SoftShape::Volume { from } => ("from", format!("volume {id}'s source {from} is built from the scene that holds it, and this world isn't read in a scene")),
                        _ => ("mesh", format!("balloon {id}'s mesh is built where its world is read, and wasn't")),
                    };
                    self.refuse("ref_unresolved", join(p, key), &Value::Null, what);
                    return None;
                };
                let o = &self.obj(mesh, &at, &["vertices", "triangles"]);
                let vertices: Option<Vec<[f64; 3]>> = o
                    .get("vertices")
                    .and_then(Value::as_array)
                    .and_then(|a| a.iter().map(vec3_of).collect());
                let triangles: Option<Vec<[u32; 3]>> = o
                    .get("triangles")
                    .and_then(Value::as_array)
                    .and_then(|a| a.iter().map(tri_of).collect());
                let (Some(vertices), Some(triangles)) = (vertices, triangles) else {
                    let what =
                        format!("{at} must be {{vertices: [[x, y, z]], triangles: [[a, b, c]]}}");
                    self.refuse("out_of_range", at, mesh, what);
                    return None;
                };
                let n = vertices.len() as u32;
                if let Some(t) = triangles.iter().find(|t| t.iter().any(|i| *i >= n)) {
                    let what = format!("{at} has a triangle {t:?} past its {n} vertices");
                    self.refuse("out_of_range", at, mesh, what);
                    return None;
                }
                if let SoftShape::Volume { from } = &shape {
                    let most = self.whole(s, "max_particles", p, 2048.0, f64::from(u16::MAX));
                    if f64::from(n) > most {
                        let what = format!("volume {id}'s source {from} has {n} welded vertices, more than its max_particles of {most}; a remesh job lowers it");
                        self.refuse(
                            "over_budget",
                            join(p, "max_particles"),
                            &Value::from(n),
                            what,
                        );
                        return None;
                    }
                }
                let open = sides(&triangles).into_iter().find(|(_, c)| *c != 2);
                if let Some(([a, b], c)) = open {
                    let source = match &shape {
                        SoftShape::Volume { from } => format!("volume {id}'s source {from}"),
                        _ => format!("balloon {id}"),
                    };
                    let what = format!("{source} isn't closed: its edge v{a} to v{b} is on {c} triangle{}, not two", if c == 1 { "" } else { "s" });
                    let key = if matches!(shape, SoftShape::Volume { .. }) {
                        "from"
                    } else {
                        "mesh"
                    };
                    self.refuse(
                        OPEN_MESH,
                        join(p, key),
                        &serde_json::json!([format!("v{a}"), format!("v{b}")]),
                        what,
                    );
                    return None;
                }
                let addresses = (0..vertices.len()).map(|i| format!("v{i}")).collect();
                Some((shape, vertices, addresses, inflate))
            }
            _ => {
                let what = format!("{p}/shape must be one of rope, cloth, balloon, volume");
                self.refuse(
                    "out_of_range",
                    join(p, "shape"),
                    s.get("shape").unwrap_or(&Value::Null),
                    what,
                );
                None
            }
        }
    }

    /// The particles `v` names: an address, or a cluster's name; the refusal naming it otherwise.
    fn selected(
        &mut self,
        v: &str,
        at: &str,
        index: &BTreeMap<String, u32>,
        clusters: &BTreeMap<String, Vec<u32>>,
        id: &str,
    ) -> Vec<u32> {
        if let Some(i) = index.get(v) {
            return vec![*i];
        }
        if let Some(c) = clusters.get(v) {
            return c.clone();
        }
        let what = format!("{v:?} is no particle address or cluster of soft body {id}");
        self.refuse("ref_unresolved", at.into(), &Value::from(v), what);
        Vec::new()
    }

    fn soft(
        &mut self,
        v: &Value,
        p: &str,
        id: &str,
        bodies: &BTreeMap<String, Body>,
        materials: &BTreeMap<String, Material>,
        groups: &[String],
    ) -> Option<Soft> {
        let s = &self.obj(v, p, SOFT_KEYS);
        if let Some(k) = s.get("kind").filter(|k| *k != "soft@1") {
            self.refuse(
                "out_of_range",
                join(p, "kind"),
                k,
                format!("{p}/kind must be soft@1"),
            );
        }
        let (shape, positions, addresses, inflate) = self.lattice(s, p, id)?;
        let index: BTreeMap<String, u32> = addresses
            .iter()
            .enumerate()
            .map(|(i, a)| (a.clone(), i as u32))
            .collect();
        let n = positions.len() as u32;
        // Edges by kind and triangles, from the lattice.
        let (mut edges, mut shear_edges, mut bend_edges, mut triangles) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let mesh_triangles = || -> Vec<[u32; 3]> {
            s.get("mesh")
                .and_then(|m| m.get("triangles"))
                .and_then(Value::as_array)
                .and_then(|a| a.iter().map(tri_of).collect())
                .unwrap_or_default()
        };
        let default_edges = match &shape {
            SoftShape::Rope => {
                edges = (0..n - 1).map(|i| [i, i + 1]).collect();
                bend_edges = (0..n.saturating_sub(2)).map(|i| [i, i + 2]).collect();
                "chain"
            }
            SoftShape::Cloth { nu, nv } => {
                let (nu, nv) = (*nu as u32, *nv as u32);
                let at = |r: u32, c: u32| r * nu + c;
                for r in 0..nv {
                    for c in 0..nu {
                        if c + 1 < nu {
                            edges.push([at(r, c), at(r, c + 1)]);
                        }
                        if r + 1 < nv {
                            edges.push([at(r, c), at(r + 1, c)]);
                        }
                        if c + 1 < nu && r + 1 < nv {
                            shear_edges.push([at(r, c), at(r + 1, c + 1)]);
                            shear_edges.push([at(r, c + 1), at(r + 1, c)]);
                            // The plate's own split of each cell (Builder plate: grid).
                            triangles.push([at(r, c), at(r, c + 1), at(r + 1, c + 1)]);
                            triangles.push([at(r, c), at(r + 1, c + 1), at(r + 1, c)]);
                        }
                        if c + 2 < nu {
                            bend_edges.push([at(r, c), at(r, c + 2)]);
                        }
                        if r + 2 < nv {
                            bend_edges.push([at(r, c), at(r + 2, c)]);
                        }
                    }
                }
                "grid"
            }
            SoftShape::Balloon { .. } | SoftShape::Volume { .. } => {
                triangles = mesh_triangles();
                edges = sides(&triangles).into_keys().collect();
                "list"
            }
        };
        match s.get("edges") {
            None => {}
            Some(Value::String(e)) if e == default_edges => {}
            Some(Value::Array(list)) => {
                let mut written = Vec::new();
                for (k, pair) in list.iter().enumerate() {
                    let at = format!("{p}/edges/{k}");
                    let ends: Option<Vec<&str>> = pair
                        .as_array()
                        .filter(|a| a.len() == 2)
                        .and_then(|a| a.iter().map(Value::as_str).collect());
                    let Some(ends) = ends else {
                        let what = format!("{at} must be two particle addresses");
                        self.refuse("out_of_range", at, pair, what);
                        continue;
                    };
                    match (index.get(ends[0]), index.get(ends[1])) {
                        (Some(a), Some(b)) if a != b => written.push(edge(*a, *b)),
                        _ => {
                            let what = format!("{at} must name two particles of soft body {id}");
                            self.refuse("ref_unresolved", at, pair, what);
                        }
                    }
                }
                edges = written;
                shear_edges.clear();
                bend_edges.clear();
            }
            Some(e) => {
                let what = format!(
                    "{p}/edges must be {default_edges} for a {} or a list of address pairs",
                    s.get("shape")
                        .and_then(Value::as_str)
                        .unwrap_or("soft body")
                );
                self.refuse("out_of_range", join(p, "edges"), e, what);
            }
        }
        // Clusters first, so masses and pins may name them.
        let mut clusters = BTreeMap::new();
        if let Some(x) = s.get("clusters").filter(|x| !x.is_object()) {
            let what = format!("{p}/clusters must be an object of name → addresses");
            self.refuse("out_of_range", join(p, "clusters"), x, what);
        }
        if let Some(cs) = s.get("clusters").and_then(Value::as_object) {
            for (name, list) in cs {
                let at = format!("{p}/clusters/{name}");
                let mut members = Vec::new();
                for (k, a) in list.as_array().into_iter().flatten().enumerate() {
                    match a.as_str().and_then(|a| index.get(a)) {
                        Some(i) => members.push(*i),
                        None => {
                            let what = format!("{a} is no particle address of soft body {id}");
                            self.refuse("ref_unresolved", format!("{at}/{k}"), a, what);
                        }
                    }
                }
                if !list.is_array() {
                    let what = format!("{at} must be a list of particle addresses");
                    self.refuse("out_of_range", at, list, what);
                }
                clusters.insert(name.clone(), members);
            }
        }
        // Masses.
        let mo = &self.obj(
            s.get("masses").unwrap_or(&Value::Null),
            &join(p, "masses"),
            &["default", "by"],
        );
        let mp = join(p, "masses");
        let default = self.num(
            mo,
            "default",
            &mp,
            DEFAULT_MASS,
            f64::MIN_POSITIVE,
            f64::MAX,
        );
        let mut masses = vec![default; n as usize];
        for (sel, kg) in mo
            .get("by")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let at = format!("{mp}/by/{sel}");
            let Some(kg) = kg.as_f64().filter(|x| *x > 0.0) else {
                self.refuse(
                    "out_of_range",
                    at,
                    kg,
                    "a particle's mass must be a number of kg above 0".into(),
                );
                continue;
            };
            for i in self.selected(sel, &at, &index, &clusters, id) {
                masses[i as usize] = kg;
            }
        }
        // Pins: held where they start, or carried by a body.
        let mut pins: Vec<Pin> = Vec::new();
        for (k, a) in s
            .get("pins")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let at = format!("{p}/pins/{k}");
            let sel = a.as_str().unwrap_or_default();
            for i in self.selected(sel, &at, &index, &clusters, id) {
                pins.push(Pin {
                    particle: i,
                    body: None,
                    point: None,
                });
            }
        }
        if let Some(x) = s.get("pins").filter(|x| !x.is_array()) {
            self.refuse(
                "out_of_range",
                join(p, "pins"),
                x,
                format!("{p}/pins must be a list of addresses"),
            );
        }
        for (a, to) in s
            .get("pinned_to")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let at = format!("{p}/pinned_to/{a}");
            let particles = self.selected(a, &at, &index, &clusters, id);
            let name = to.as_str().unwrap_or_default();
            let (body, point) = if name == "world" {
                (None, None)
            } else {
                let (b, anchor) = name
                    .split_once('#')
                    .map_or((name, None), |(b, a)| (b, Some(a)));
                match bodies.get(b) {
                    None => {
                        let what = format!("{to} is not a body of this world, nor world");
                        self.refuse("ref_unresolved", at.clone(), to, what);
                        continue;
                    }
                    Some(body) => {
                        let point = match anchor {
                            None => None,
                            Some(x) => match body.anchors.get(x) {
                                Some(pt) => Some(*pt),
                                None => {
                                    self.refuse(
                                        "ref_unresolved",
                                        at.clone(),
                                        to,
                                        format!("{b} has no anchor {x:?}"),
                                    );
                                    continue;
                                }
                            },
                        };
                        (Some(b.to_string()), point)
                    }
                }
            };
            for i in particles {
                pins.retain(|q| q.particle != i);
                pins.push(Pin {
                    particle: i,
                    body: body.clone(),
                    point,
                });
            }
        }
        pins.sort_by_key(|q| q.particle);
        let stretch = self.stiffness(
            s,
            "stretch",
            p,
            Stiffness {
                hz: 30.0,
                damping_ratio: 1.0,
            },
        );
        let shear = self.stiffness(s, "shear", p, stretch);
        let bend = self.stiffness(
            s,
            "bend",
            p,
            Stiffness {
                hz: 10.0,
                damping_ratio: 1.0,
            },
        );
        let tear = s.get("tear").map(|t| {
            let tp = join(p, "tear");
            let o = &self.obj(t, &tp, &["strain", "force", "smoothing"]);
            let (strain, force) = (
                self.opt_num(o, "strain", &tp, f64::MIN_POSITIVE),
                self.opt_num(o, "force", &tp, f64::MIN_POSITIVE),
            );
            if strain.is_none() && force.is_none() {
                self.refuse(
                    "physics.missing_field",
                    tp.clone(),
                    t,
                    format!("{tp} needs a strain or a force"),
                );
            }
            Tear {
                strain,
                force,
                smoothing: self.num(o, "smoothing", &tp, 0.0, 0.0, f64::MAX),
            }
        });
        let material = s
            .get("contact_material")
            .and_then(Value::as_str)
            .map(String::from);
        if let Some(m) = &material {
            if !materials.contains_key(m) {
                let what = format!("{m:?} is not a contact material of this world");
                self.refuse(
                    "ref_unresolved",
                    join(p, "contact_material"),
                    &s["contact_material"],
                    what,
                );
            }
        }
        Some(Soft {
            shape,
            addresses,
            positions,
            edges,
            shear_edges,
            bend_edges,
            triangles,
            inflate,
            masses,
            pins,
            clusters,
            stretch,
            shear,
            bend,
            tension_only: self.flag(s, "tension_only", p, false),
            particle_radius: self.num(s, "particle_radius", p, 0.0, 0.0, f64::MAX),
            self_contacts: self.flag(s, "self_contacts", p, false),
            damping: self.num(s, "damping", p, 0.0, 0.0, f64::MAX),
            tear,
            material,
            member: self.group(s, p, groups),
            collides: u32::MAX,
        })
    }
}

impl Reader {
    /// `collision_group`: the one group a soft body is a member of, colliding with every group;
    /// every group when absent.
    fn group(&mut self, s: &Map<String, Value>, p: &str, groups: &[String]) -> u32 {
        let Some(v) = s.get("collision_group") else {
            return u32::MAX;
        };
        match v.as_str().and_then(|g| groups.iter().position(|x| x == g)) {
            Some(bit) => 1 << bit,
            None => {
                let what = format!("{v} is not one of the world's collision_groups");
                self.refuse("ref_unresolved", join(p, "collision_group"), v, what);
                u32::MAX
            }
        }
    }
}

fn vec3_of(v: &Value) -> Option<[f64; 3]> {
    let a = v.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

fn tri_of(v: &Value) -> Option<[u32; 3]> {
    let a = v.as_array().filter(|a| a.len() == 3)?;
    let i = |k: usize| a[k].as_u64().and_then(|x| u32::try_from(x).ok());
    Some([i(0)?, i(1)?, i(2)?])
}
