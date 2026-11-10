//! Built geometry (canvas primitives: Builder; Builder: shading; Marks in 3D: mesh edges; issue
//! #420): the mesh a builder returns, with each triangle's face so a mesh-edge line can draw its
//! quads, its closed parts with the genus the builder computes, its named parts and outputs; flat
//! shading, which gives each triangle its own three vertices and normal; and the polygon
//! triangulation the prisms, caps and plans share. Everything is f64 through the ops module.

use std::collections::BTreeMap;

use deep_canvas::ops::sqrt;
use deep_canvas::schedule::{canonical, Canonical};
use serde_json::{json, Value};

pub type V3 = [f64; 3];
pub type V2 = [f64; 2];

/// What a builder returns: `positions`, `normals` and `indices` (triangle t is
/// `indices[3t..3t + 3]`, counter-clockwise from outside), each triangle's `faces` entry (two
/// triangles of one quad or one polygon share it, so a mesh-edge line of kind `quads` leaves the
/// edge between them out), the named parts, the closed parts with their genus, and the outputs a
/// building kind reports.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesh {
    pub positions: Vec<V3>,
    pub normals: Vec<V3>,
    pub indices: Vec<u32>,
    pub faces: Vec<u32>,
    pub parts: BTreeMap<String, Vec<u32>>,
    /// Each closed part: its triangles and its genus.
    pub closed: BTreeMap<String, (Vec<u32>, u32)>,
    pub outputs: BTreeMap<String, Value>,
    /// Named frames: an origin and its x, y and z axes, in the item's space.
    pub anchors: BTreeMap<String, [V3; 4]>,
    /// Named numbers a builder computes (its area, its volume, a riser's height).
    pub values: BTreeMap<String, f64>,
    /// Analytic or convex pieces that stand for the mesh where a check needs an exact shape.
    pub true_shape: Vec<Value>,
    /// One texture coordinate per vertex, in metres over `uv_scale` (Builder: uv), or none.
    pub uv0: Vec<V2>,
    /// The second texture coordinate per vertex: the builder's own charts packed into the unit
    /// square without overlap, for bakes, or none.
    pub uv1: Vec<V2>,
    /// A glTF asset's own tangents, xyz and the bitangent's sign in w, one per vertex, or none
    /// (the renderer then makes them from uv0; #423).
    pub tangents: Vec<[f64; 4]>,
    /// Each triangle's face is one a bevel made (weak where normals weigh faces), or none.
    pub weak: Vec<bool>,
    /// Named per-vertex values, which a material input reads: a `store` modifier keeps a
    /// field as one, such as a wind weight an engine reads.
    pub attributes: BTreeMap<String, Vec<f64>>,
    /// Its index-only levels by error, as the simplify job stored them (#425): each level's
    /// indices over these vertices and its error as a fraction of `lod_extent`, coarser after.
    pub lods: Vec<(Vec<u32>, f64)>,
    /// The extent the levels' errors are fractions of, in the mesh's own m.
    pub lod_extent: f64,
    /// Named per-face values, one per triangle (a face's triangles share one).
    pub face_attributes: BTreeMap<String, Vec<f64>>,
    /// The quads the mesh had before its stack's first `subdivide`, as a `cage` mesh-edge line
    /// draws them, each edge by its two ends.
    pub cage: Option<Vec<[V3; 2]>>,
}

/// What a mesh-edge line draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EdgeKind {
    All,
    Quads,
    Cage,
    /// The edges sharper than `angle` degrees, and with `border` those of one face (#1640).
    Crease { angle: f64, border: bool },
}

impl EdgeKind {
    /// A mesh-edge line's `edges`: its kind, and a crease's `angle` (default 30, 0 to 180) and
    /// `border` (default true); `Err` names the field it refuses.
    pub fn read(edges: &Value) -> Result<EdgeKind, &'static str> {
        // A crease is `"crease"` or `{"crease": {"angle": deg}}`, as other variants with fields.
        let (name, fields) = match edges.get("kind") {
            None | Some(Value::Null) => ("quads", &Value::Null),
            Some(Value::String(s)) => (s.as_str(), &Value::Null),
            Some(Value::Object(o)) if o.len() == 1 => {
                let (k, v) = o.iter().next().expect("one key");
                (k.as_str(), v)
            }
            Some(_) => return Err("kind"),
        };
        Ok(match name {
            "all" if fields.is_null() => EdgeKind::All,
            "quads" if fields.is_null() => EdgeKind::Quads,
            "cage" if fields.is_null() => EdgeKind::Cage,
            "crease" => EdgeKind::Crease {
                angle: match fields.get("angle") {
                    None | Some(Value::Null) => 30.0,
                    Some(v) => v
                        .as_f64()
                        .filter(|a| (0.0..=180.0).contains(a))
                        .ok_or("kind/crease/angle")?,
                },
                border: match edges.get("border") {
                    None | Some(Value::Null) => true,
                    Some(v) => v.as_bool().ok_or("border")?,
                },
            },
            _ => return Err("kind"),
        })
    }
}

impl Canonical for Mesh {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.positions, &self.normals, &self.indices, &self.faces).encode(out);
        let parts: Vec<(&String, &Vec<u32>)> = self.parts.iter().collect();
        parts.encode(out);
        let closed: Vec<(&String, &Vec<u32>, u32)> =
            self.closed.iter().map(|(k, (t, g))| (k, t, *g)).collect();
        closed.encode(out);
        canonical(&json!(self.outputs)).encode(out);
        let anchors: Vec<(&String, &[V3; 4])> = self.anchors.iter().collect();
        anchors.encode(out);
        let values: Vec<(&String, &f64)> = self.values.iter().collect();
        values.encode(out);
        canonical(&json!(self.true_shape)).encode(out);
        self.uv0.encode(out);
        self.uv1.encode(out);
        self.tangents.encode(out);
        self.weak.encode(out);
        let attributes: Vec<(&String, &Vec<f64>)> = self.attributes.iter().collect();
        attributes.encode(out);
        let faces: Vec<(&String, &Vec<f64>)> = self.face_attributes.iter().collect();
        faces.encode(out);
        self.cage.encode(out);
    }
}

pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn scale(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn length(a: V3) -> f64 {
    sqrt(dot(a, a))
}
/// `a` at unit length, or +Y for a zero vector.
pub fn unit(a: V3) -> V3 {
    let l = length(a);
    if l < 1e-15 {
        [0.0, 1.0, 0.0]
    } else {
        scale(a, 1.0 / l)
    }
}

impl Mesh {
    pub fn triangles(&self) -> usize {
        self.indices.len() / 3
    }

    /// A vertex at `p` with normal `n`; each attribute gets a 0 for it.
    pub fn vertex(&mut self, p: V3, n: V3) -> u32 {
        self.positions.push(p);
        self.normals.push(n);
        for values in self.attributes.values_mut() {
            values.push(0.0);
        }
        (self.positions.len() - 1) as u32
    }

    /// A triangle of face `face`, left out when two of its corners are one point (a cone's
    /// apex): its vertices stay, counted.
    pub fn tri(&mut self, a: u32, b: u32, c: u32, face: u32) {
        let [pa, pb, pc] = [a, b, c].map(|i| self.positions[i as usize]);
        if length(cross(sub(pb, pa), sub(pc, pa))) < 1e-14 {
            return;
        }
        self.indices.extend([a, b, c]);
        self.faces.push(face);
    }

    /// The quad a, b, c, d (counter-clockwise from outside) as two triangles of one face.
    pub fn quad(&mut self, a: u32, b: u32, c: u32, d: u32, face: u32) {
        self.tri(a, b, c, face);
        self.tri(a, c, d, face);
    }

    /// A new face ID: builders number faces in the order they make them.
    pub fn next_face(&self) -> u32 {
        self.faces.last().map_or(0, |f| f + 1)
    }

    /// The triangles from `from` on, as a closed part of genus `genus`.
    pub fn close(&mut self, name: &str, from: usize, genus: u32) {
        let list = (from as u32..self.triangles() as u32).collect();
        self.closed.insert(name.to_string(), (list, genus));
    }

    /// The triangles from `from` on, as a named part.
    pub fn part(&mut self, name: &str, from: usize) {
        let list: Vec<u32> = (from as u32..self.triangles() as u32).collect();
        self.parts.entry(name.to_string()).or_default().extend(list);
    }

    /// A flat polygon (`points` counter-clockwise from outside, with `holes` clockwise) as its
    /// own vertices with its one normal, triangulated as one face.
    pub fn polygon(&mut self, points: &[V3], holes: &[Vec<V3>]) {
        let n = newell(points);
        let (u, v) = basis(n);
        let flat = |p: &V3| [dot(*p, u), dot(*p, v)];
        let outer: Vec<V2> = points.iter().map(flat).collect();
        let inner: Vec<Vec<V2>> = holes.iter().map(|h| h.iter().map(flat).collect()).collect();
        let tris = triangulate(&outer, &inner);
        let base = self.positions.len() as u32;
        for p in points.iter().chain(holes.iter().flatten()) {
            self.vertex(*p, n);
        }
        let face = self.next_face();
        for [a, b, c] in tris {
            self.tri(base + a, base + b, base + c, face);
        }
    }

    /// Each closed part wound outward: a part whose signed volume is negative is turned over,
    /// its vertices' normals with it.
    pub fn orient(&mut self) {
        let parts: Vec<Vec<u32>> = self.closed.values().map(|(t, _)| t.clone()).collect();
        for tris in parts {
            if self.volume(&tris) >= 0.0 {
                continue;
            }
            let mut seen = std::collections::BTreeSet::new();
            for &t in &tris {
                let k = 3 * t as usize;
                self.indices.swap(k + 1, k + 2);
                for j in 0..3 {
                    let v = self.indices[k + j];
                    if seen.insert(v) {
                        self.normals[v as usize] = scale(self.normals[v as usize], -1.0);
                    }
                }
            }
        }
    }

    /// The signed volume `tris` enclose.
    pub fn volume(&self, tris: &[u32]) -> f64 {
        tris.iter()
            .map(|&t| {
                let k = 3 * t as usize;
                let [a, b, c] = [0, 1, 2].map(|j| self.positions[self.indices[k + j] as usize]);
                dot(a, cross(b, c)) / 6.0
            })
            .sum()
    }

    /// Flat shading: every triangle its own three vertices, each with the triangle's normal; the
    /// triangles keep their order, faces and parts.
    pub fn flat(&self) -> Mesh {
        let mut out = Mesh {
            faces: self.faces.clone(),
            parts: self.parts.clone(),
            closed: self.closed.clone(),
            outputs: self.outputs.clone(),
            attributes: self
                .attributes
                .keys()
                .map(|k| (k.clone(), Vec::new()))
                .collect(),
            anchors: self.anchors.clone(),
            values: self.values.clone(),
            true_shape: self.true_shape.clone(),
            face_attributes: self.face_attributes.clone(),
            cage: self.cage.clone(),
            weak: self.weak.clone(),
            ..Mesh::default()
        };
        let uv = self.uv0.len() == self.positions.len();
        for t in 0..self.triangles() {
            let ids = [0, 1, 2].map(|j| self.indices[3 * t + j] as usize);
            let [a, b, c] = ids.map(|i| self.positions[i]);
            let n = unit(cross(sub(b, a), sub(c, a)));
            for (k, p) in [a, b, c].into_iter().enumerate() {
                let i = out.vertex(p, n);
                for (name, values) in &self.attributes {
                    out.attributes.get_mut(name).expect("made above")[i as usize] = values[ids[k]];
                }
                if uv {
                    out.uv0.push(self.uv0[ids[k]]);
                }
                if self.uv1.len() == self.positions.len() {
                    out.uv1.push(self.uv1[ids[k]]);
                }
                out.indices.push(i);
            }
        }
        out
    }

    /// The mesh's points moved by `f`, its normals by `g`.
    pub fn mapped(&self, f: impl Fn(V3) -> V3, g: impl Fn(V3, V3) -> V3) -> Mesh {
        let mut out = self.clone();
        // Moved points leave a file's tangents behind; the renderer makes them again.
        out.tangents.clear();
        for (k, p) in self.positions.iter().enumerate() {
            out.positions[k] = f(*p);
            out.normals[k] = unit(g(*p, self.normals[k]));
        }
        out
    }

    /// `other` appended, its parts named with `suffix` when given.
    pub fn append(&mut self, other: &Mesh, suffix: &str) {
        let base = self.positions.len() as u32;
        let tbase = self.triangles() as u32;
        let fbase = self.next_face();
        // Texture coordinates carry over only where both meshes have them.
        if self.uv0.len() == self.positions.len() && other.uv0.len() == other.positions.len() {
            self.uv0.extend(&other.uv0);
        } else {
            self.uv0.clear();
        }
        if self.uv1.len() == self.positions.len() && other.uv1.len() == other.positions.len() {
            self.uv1.extend(&other.uv1);
        } else {
            self.uv1.clear();
        }
        if !self.weak.is_empty() || !other.weak.is_empty() {
            self.weak.resize(tbase as usize, false);
            if other.weak.is_empty() {
                self.weak
                    .extend(std::iter::repeat_n(false, other.triangles()));
            } else {
                self.weak.extend(&other.weak);
            }
        }
        // An attribute either side lacks reads 0 there.
        let names: Vec<String> = self
            .attributes
            .keys()
            .chain(other.attributes.keys())
            .cloned()
            .collect();
        for name in names {
            let mine = self
                .attributes
                .entry(name.clone())
                .or_insert_with(|| vec![0.0; base as usize]);
            match other.attributes.get(&name) {
                Some(theirs) => mine.extend(theirs),
                None => mine.extend(std::iter::repeat_n(0.0, other.positions.len())),
            }
        }
        let names: Vec<String> = self
            .face_attributes
            .keys()
            .chain(other.face_attributes.keys())
            .cloned()
            .collect();
        for name in names {
            let mine = self
                .face_attributes
                .entry(name.clone())
                .or_insert_with(|| vec![0.0; tbase as usize]);
            match other.face_attributes.get(&name) {
                Some(theirs) => mine.extend(theirs),
                None => mine.extend(std::iter::repeat_n(0.0, other.triangles())),
            }
        }
        self.positions.extend(&other.positions);
        self.normals.extend(&other.normals);
        self.indices.extend(other.indices.iter().map(|i| i + base));
        self.faces.extend(other.faces.iter().map(|f| f + fbase));
        for (name, tris) in &other.parts {
            self.parts
                .entry(format!("{name}{suffix}"))
                .or_default()
                .extend(tris.iter().map(|t| t + tbase));
        }
        for (name, (tris, g)) in &other.closed {
            self.closed.insert(
                format!("{name}{suffix}"),
                (tris.iter().map(|t| t + tbase).collect(), *g),
            );
        }
    }

    /// The triangles turned over (a reflection's winding).
    pub fn turned(&self) -> Mesh {
        let mut out = self.clone();
        for t in 0..out.triangles() {
            out.indices.swap(3 * t + 1, 3 * t + 2);
        }
        out
    }

    /// The axis-aligned bounds of the positions.
    pub fn bounds(&self) -> [V3; 2] {
        let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for p in &self.positions {
            for k in 0..3 {
                b[0][k] = b[0][k].min(p[k]);
                b[1][k] = b[1][k].max(p[k]);
            }
        }
        b
    }

    /// The mesh's edges as a mesh-edge line draws them (Marks in 3D: mesh edges), each by its
    /// two ends: on positions welded to 1e-6 m, so an edge split for its normals draws once;
    /// `all` draws every triangle edge, `quads` leaves out an edge both of whose triangles are one
    /// face. `welded: false` is the planted reader that keys edges by vertex index.
    pub fn edges(&self, all: bool, welded: bool) -> Vec<[V3; 2]> {
        let at = self.welded_ids(welded);
        // Each edge by its sorted ends, with the faces of the triangles on it and one position
        // per end.
        let mut edges: BTreeMap<(u32, u32), (Vec<u32>, [V3; 2])> = BTreeMap::new();
        for t in 0..self.triangles() {
            for j in 0..3 {
                let (i, k) = (self.indices[3 * t + j], self.indices[3 * t + (j + 1) % 3]);
                let (a, b) = (at[i as usize], at[k as usize]);
                if a == b {
                    continue;
                }
                let key = (a.min(b), a.max(b));
                let ends = if a < b { [i, k] } else { [k, i] };
                let e = edges
                    .entry(key)
                    .or_insert_with(|| (Vec::new(), ends.map(|v| self.positions[v as usize])));
                e.0.push(self.faces[t]);
            }
        }
        edges
            .into_values()
            .filter(|(faces, _)| all || faces.len() != 2 || faces[0] != faces[1])
            .map(|(_, ends)| ends)
            .collect()
    }

    /// Each vertex's point on positions welded to 1e-6 m, numbered in first-seen order; with
    /// `welded: false`, its own index.
    fn welded_ids(&self, welded: bool) -> Vec<u32> {
        if !welded {
            return (0..self.positions.len() as u32).collect();
        }
        let mut ids: BTreeMap<[i64; 3], u32> = BTreeMap::new();
        self.positions
            .iter()
            .map(|p| {
                let next = ids.len() as u32;
                *ids.entry(p.map(|x| (x / 1e-6).round() as i64)).or_insert(next)
            })
            .collect()
    }

    /// The edges where the surface turns (Marks in 3D: mesh edges, kind `crease`; #1640), each
    /// by its two ends, on positions welded to 1e-6 m: an edge whose two triangles' normals part
    /// by more than `angle` degrees, one more than two triangles meet at, and with `border` one
    /// that bounds a single triangle. A triangle welding collapses or of no area bounds no edge.
    /// `below` is #1640's planted reader, which keeps the edges at or under the angle instead.
    pub fn creases(&self, angle: f64, border: bool, below: bool) -> Vec<[V3; 2]> {
        let at = self.welded_ids(true);
        let cos = deep_canvas::ops::cos(deep_canvas::ops::rad(angle));
        let mut edges: BTreeMap<(u32, u32), (Vec<V3>, [V3; 2])> = BTreeMap::new();
        for t in 0..self.triangles() {
            let v = [0, 1, 2].map(|j| self.indices[3 * t + j]);
            let w = v.map(|i| at[i as usize]);
            let p = v.map(|i| self.positions[i as usize]);
            let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
            if w[0] == w[1] || w[1] == w[2] || w[0] == w[2] || dot(n, n) < 1e-24 {
                continue;
            }
            for j in 0..3 {
                let (i, k) = (v[j], v[(j + 1) % 3]);
                let (a, b) = (w[j], w[(j + 1) % 3]);
                let ends = if a < b { [i, k] } else { [k, i] };
                edges
                    .entry((a.min(b), a.max(b)))
                    .or_insert_with(|| (Vec::new(), ends.map(|e| self.positions[e as usize])))
                    .0
                    .push(unit(n));
            }
        }
        edges
            .into_values()
            .filter(|(n, _)| match n.as_slice() {
                [_] => border,
                [a, b] => (dot(*a, *b) < cos) != below,
                _ => true,
            })
            .map(|(_, ends)| ends)
            .collect()
    }

    /// The edges a mesh-edge line of `kind` draws (Marks in 3D: mesh edges): `cage` the quads
    /// the stack left before its first subdivide (the mesh's own quads when it has none), with
    /// #440's planted readers: `quads_keep_diagonals` (quads drawn as all) and
    /// `cage_reads_subdivided` (the cage read from the subdivided mesh).
    pub fn edge_list(&self, kind: EdgeKind, planted: Option<&str>) -> Vec<[V3; 2]> {
        match kind {
            EdgeKind::All => self.edges(true, true),
            EdgeKind::Quads => self.edges(planted == Some("quads_keep_diagonals"), true),
            EdgeKind::Cage => match &self.cage {
                Some(cage) if planted != Some("cage_reads_subdivided") => cage.clone(),
                _ => self.edges(false, true),
            },
            EdgeKind::Crease { angle, border } => {
                self.crease_set(angle, border, planted).0.as_ref().clone()
            }
        }
    }

    /// The crease set and whether this call derived it: derived once per content key (its
    /// positions and triangles, the angle and `border`) and kept while the process runs, at most
    /// 64 sets. #1640's planted readers: `crease_below_angle` keeps the edges under the angle,
    /// `edges_derive_every_frame` skips the cache.
    pub fn crease_set(
        &self,
        angle: f64,
        border: bool,
        planted: Option<&str>,
    ) -> (std::sync::Arc<Vec<[V3; 2]>>, bool) {
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex, OnceLock};
        type Made = HashMap<[u8; 16], Arc<Vec<[V3; 2]>>>;
        static MADE: OnceLock<Mutex<Made>> = OnceLock::new();
        let below = planted == Some("crease_below_angle");
        let mut h = deep_canvas::schedule::Hasher::new("scene3d.creases");
        h.bytes(&(&self.positions, &self.indices).canonical_bytes())
            .bytes(&angle.to_le_bytes())
            .int(i64::from(border) | (i64::from(below) << 1));
        let key = h.finish().0;
        let made = MADE.get_or_init(Default::default);
        let cached = planted != Some("edges_derive_every_frame");
        if let Some(set) = cached.then(|| made.lock().ok()?.get(&key).cloned()).flatten() {
            return (set, false);
        }
        let set = Arc::new(self.creases(angle, border, below));
        if let (true, Ok(mut m)) = (cached, made.lock()) {
            if m.len() >= 64 {
                m.clear();
            }
            m.insert(key, set.clone());
        }
        (set, true)
    }

    /// The mesh as the `geometry` call reports it.
    pub fn to_json(&self) -> Value {
        let closed: serde_json::Map<String, Value> = self
            .closed
            .iter()
            .map(|(k, (t, g))| (k.clone(), json!({"triangles": t, "genus": g})))
            .collect();
        let anchors: serde_json::Map<String, Value> = self
            .anchors
            .iter()
            .map(|(k, [o, x, y, z])| (k.clone(), json!({"pos": o, "x": x, "y": y, "z": z})))
            .collect();
        let attributes: serde_json::Map<String, Value> = self
            .attributes
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    json!({"domain": "point", "type": "f32", "values": v}),
                )
            })
            .chain(self.face_attributes.iter().map(|(k, v)| {
                (
                    k.clone(),
                    json!({"domain": "face", "type": "f32", "values": v}),
                )
            }))
            .collect();
        let bounds = (!self.positions.is_empty()).then(|| self.bounds());
        json!({"positions": self.positions, "normals": self.normals, "indices": self.indices,
               "closed": closed, "parts": self.parts, "outputs": self.outputs, "anchors": anchors,
               "values": self.values, "true_shape": self.true_shape, "uv0": self.uv0,
               "uv1": self.uv1, "faces": self.faces, "attributes": attributes, "bounds": bounds})
    }
}

impl Mesh {
    /// Each vertex's welded point (positions equal to 1e-6 m are one), numbered from 0.
    pub fn welded(&self) -> Vec<u32> {
        let mut ids: BTreeMap<[i64; 3], u32> = BTreeMap::new();
        self.positions
            .iter()
            .map(|p| {
                let key = p.map(|x| (x / 1e-6).round() as i64);
                let next = ids.len() as u32;
                *ids.entry(key).or_insert(next)
            })
            .collect()
    }

    /// The closed parts recomputed from the triangles: each connected piece (on welded points)
    /// with no open edge is a closed part `solid.k`, its genus from V − E + F = 2 − 2g.
    pub fn close_components(&mut self) {
        let w = self.welded();
        let n = w.iter().max().map_or(0, |m| *m as usize + 1);
        let mut root: Vec<usize> = (0..n).collect();
        fn find(root: &mut [usize], mut x: usize) -> usize {
            while root[x] != x {
                root[x] = root[root[x]];
                x = root[x];
            }
            x
        }
        let tri = |t: usize| [0, 1, 2].map(|j| w[self.indices[3 * t + j] as usize] as usize);
        for t in 0..self.triangles() {
            let [a, b, c] = tri(t);
            for (x, y) in [(a, b), (b, c)] {
                let (rx, ry) = (find(&mut root, x), find(&mut root, y));
                root[rx] = ry;
            }
        }
        let mut pieces: BTreeMap<usize, Vec<u32>> = BTreeMap::new();
        for t in 0..self.triangles() {
            let r = find(&mut root, tri(t)[0]);
            pieces.entry(r).or_default().push(t as u32);
        }
        self.closed.clear();
        for (k, tris) in pieces.into_values().enumerate() {
            let mut edges: BTreeMap<(usize, usize), u32> = BTreeMap::new();
            let mut verts = std::collections::BTreeSet::new();
            for &t in &tris {
                let v = tri(t as usize);
                for j in 0..3 {
                    let (a, b) = (v[j], v[(j + 1) % 3]);
                    verts.insert(a);
                    *edges.entry((a.min(b), a.max(b))).or_default() += 1;
                }
            }
            if edges.values().any(|c| *c != 2) {
                continue;
            }
            let chi = verts.len() as i64 - edges.len() as i64 + tris.len() as i64;
            let genus = ((2 - chi) / 2).max(0) as u32;
            self.closed.insert(format!("solid.{k}"), (tris, genus));
        }
    }
}

/// A polygon's normal by Newell's method.
pub fn newell(points: &[V3]) -> V3 {
    let mut n = [0.0; 3];
    for k in 0..points.len() {
        let (a, b) = (points[k], points[(k + 1) % points.len()]);
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    unit(n)
}

/// Two unit vectors across `n`, so (u, v, n) is right-handed.
pub fn basis(n: V3) -> (V3, V3) {
    let up = if n[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let u = unit(cross(up, n));
    (u, cross(n, u))
}

/// A polygon's signed area (positive counter-clockwise).
pub fn area2(points: &[V2]) -> f64 {
    let mut a = 0.0;
    for k in 0..points.len() {
        let (p, q) = (points[k], points[(k + 1) % points.len()]);
        a += p[0] * q[1] - q[0] * p[1];
    }
    a / 2.0
}

fn cross2(o: V2, a: V2, b: V2) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/// `p` on the segment a–c, strictly between its ends.
fn between(p: V2, a: V2, c: V2) -> bool {
    let len2 = (c[0] - a[0]) * (c[0] - a[0]) + (c[1] - a[1]) * (c[1] - a[1]);
    let t = ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / len2;
    cross2(a, c, p).abs() <= 1e-12 && t > 1e-12 && t < 1.0 - 1e-12
}

fn inside(p: V2, a: V2, b: V2, c: V2) -> bool {
    cross2(a, b, p) > 1e-12 && cross2(b, c, p) > 1e-12 && cross2(c, a, p) > 1e-12
}

/// Ear clipping of `outer` with `holes` bridged in, each triangle counter-clockwise, its
/// corners indexing `outer` then each hole in turn: a polygon of n corners and h holes makes
/// n + 2h − 2 triangles, fewer where corners lie in a line.
pub fn triangulate(outer: &[V2], holes: &[Vec<V2>]) -> Vec<[u32; 3]> {
    let mut points: Vec<V2> = outer.to_vec();
    let mut ring: Vec<u32> = (0..outer.len() as u32).collect();
    if area2(outer) < 0.0 {
        ring.reverse();
    }
    let mut starts = Vec::new();
    for h in holes {
        starts.push(points.len() as u32);
        points.extend(h);
    }
    // Holes bridged in from the rightmost first.
    let mut order: Vec<usize> = (0..holes.len()).collect();
    let right = |h: usize| {
        holes[h]
            .iter()
            .map(|p| p[0])
            .fold(f64::NEG_INFINITY, f64::max)
    };
    order.sort_by(|a, b| right(*b).total_cmp(&right(*a)));
    for h in order {
        let hole = &holes[h];
        if hole.len() < 3 {
            continue;
        }
        let mut hring: Vec<u32> = (0..hole.len() as u32).map(|k| starts[h] + k).collect();
        if area2(hole) > 0.0 {
            hring.reverse();
        }
        let (mi, m) = hring
            .iter()
            .enumerate()
            .max_by(|a, b| points[*a.1 as usize][0].total_cmp(&points[*b.1 as usize][0]))
            .map(|(k, &i)| (k, points[i as usize]))
            .expect("a hole has corners");
        // The nearest ring edge the ray from m along +x crosses, and its end further along x.
        let mut best: Option<(f64, usize)> = None;
        for k in 0..ring.len() {
            let (a, b) = (
                points[ring[k] as usize],
                points[ring[(k + 1) % ring.len()] as usize],
            );
            if (a[1] > m[1]) == (b[1] > m[1]) && a[1] != m[1] && b[1] != m[1] {
                continue;
            }
            if a[1] == b[1] {
                continue;
            }
            let x = a[0] + (m[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
            if x >= m[0] && best.is_none_or(|(bx, _)| x < bx) {
                let pick = if a[0] > b[0] { k } else { (k + 1) % ring.len() };
                best = Some((x, pick));
            }
        }
        let Some((x, mut pick)) = best else { continue };
        // A ring corner inside the triangle (m, hit, pick) sees m better: the one nearest the ray.
        let hit = [x, m[1]];
        let p = points[ring[pick] as usize];
        let mut tan = f64::INFINITY;
        for (k, &i) in ring.iter().enumerate() {
            let q = points[i as usize];
            if q == p || q[0] < m[0] {
                continue;
            }
            let tri = if p[1] < m[1] {
                (m, p, hit)
            } else {
                (m, hit, p)
            };
            if inside(q, tri.0, tri.1, tri.2) {
                let t = (q[1] - m[1]).abs() / (q[0] - m[0]).max(1e-15);
                if t < tan {
                    tan = t;
                    pick = k;
                }
            }
        }
        let mut merged = ring[..=pick].to_vec();
        merged.extend(hring[mi..].iter().chain(&hring[..mi]));
        merged.push(hring[mi]);
        merged.push(ring[pick]);
        merged.extend(&ring[pick + 1..]);
        ring = merged;
    }
    let mut out = Vec::new();
    while ring.len() > 3 {
        let n = ring.len();
        let mut cut = None;
        for k in 0..n {
            let (a, b, c) = (ring[(k + n - 1) % n], ring[k], ring[(k + 1) % n]);
            let (pa, pb, pc) = (points[a as usize], points[b as usize], points[c as usize]);
            if cross2(pa, pb, pc) <= 1e-12 {
                continue;
            }
            // A corner inside the ear, or on the edge it closes, would be left out of it.
            let blocked = ring.iter().any(|&i| {
                let q = points[i as usize];
                q != pa && q != pb && q != pc && (inside(q, pa, pb, pc) || between(q, pa, pc))
            });
            if !blocked {
                cut = Some(k);
                break;
            }
        }
        match cut {
            Some(k) => {
                out.push([ring[(k + n - 1) % n], ring[k], ring[(k + 1) % n]]);
                ring.remove(k);
            }
            // No ear: drop a corner in a line with its neighbours, or stop.
            None => {
                let flat = (0..n).find(|&k| {
                    let (a, b, c) = (ring[(k + n - 1) % n], ring[k], ring[(k + 1) % n]);
                    cross2(points[a as usize], points[b as usize], points[c as usize]).abs()
                        <= 1e-12
                });
                match flat {
                    Some(k) => {
                        ring.remove(k);
                    }
                    None => break,
                }
            }
        }
    }
    if ring.len() == 3 {
        let [a, b, c] = [ring[0], ring[1], ring[2]];
        if cross2(points[a as usize], points[b as usize], points[c as usize]) > 1e-12 {
            out.push([a, b, c]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rectangle_with_a_hole_makes_eight_triangles_of_its_area() {
        let outer = [[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]];
        let hole = vec![[0.5, 0.25], [1.5, 0.25], [1.5, 0.75], [0.5, 0.75]];
        let tris = triangulate(&outer, std::slice::from_ref(&hole));
        assert_eq!(tris.len(), 8);
        let pts: Vec<V2> = outer.iter().chain(hole.iter()).copied().collect();
        let area: f64 = tris
            .iter()
            .map(|t| area2(&[pts[t[0] as usize], pts[t[1] as usize], pts[t[2] as usize]]))
            .sum();
        assert!((area - 1.5).abs() < 1e-12, "{area}");
    }
}

#[cfg(test)]
mod staircase {
    use super::*;

    /// A stair's section has its inner corners in a line: no ear may close over them.
    #[test]
    fn a_staircase_section_triangulates_whole() {
        let (n, g, r) = (15usize, 0.25, 2.6 / 15.0);
        let mut s: Vec<V2> = vec![[0.0, 0.0]];
        for k in 0..n {
            s.push([k as f64 * g, (k + 1) as f64 * r]);
            s.push([(k + 1) as f64 * g, (k + 1) as f64 * r]);
        }
        s.push([n as f64 * g, 0.0]);
        s.reverse();
        let t = triangulate(&s, &[]);
        assert_eq!(t.len(), s.len() - 2, "{} points", s.len());
    }
}
