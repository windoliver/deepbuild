//! Typed geometry attributes (canvas primitives: Attribute and field; issue #1781): the table
//! every built mesh carries, name → {domain, type, values}, with one value per element of its
//! domain. Mesh domains count on welded positions and polygon faces, numbered as the mesh's
//! polygon view numbers them: points in order of first appearance, faces in the order of their
//! first triangles, corners face after face from each face's lowest point, and edges by their
//! sorted ends. A float attribute on points or faces stays where a mesh always kept one, a number
//! per vertex or per triangle, which materials and a sway read; every other one is kept by
//! element in [`Mesh::typed`]. A step that makes a mesh from another carries them by what each
//! new element was made from, and one with no rule for an attribute leaves it out, which the
//! stack refuses.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::builders::{Fault, CODED};
use crate::geom::Mesh;
use crate::poly::{key, Poly};

/// The planted mesh that keeps every attribute's values as f32.
pub const KEPT_AS_F32: &str = "attrs_kept_as_f32";

/// The names a built-in holds, which nothing writes.
pub const BUILT_IN: [&str; 5] = ["position", "normal", "uv0", "id", "index"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Domain {
    Point,
    Edge,
    Face,
    Corner,
    Curve,
    Instance,
}

const DOMAINS: [(&str, Domain); 6] = [
    ("point", Domain::Point),
    ("edge", Domain::Edge),
    ("face", Domain::Face),
    ("corner", Domain::Corner),
    ("curve", Domain::Curve),
    ("instance", Domain::Instance),
];

impl Domain {
    pub fn name(self) -> &'static str {
        DOMAINS.iter().find(|d| d.1 == self).map_or("", |d| d.0)
    }

    pub fn named(name: &str) -> Option<Domain> {
        DOMAINS.iter().find(|d| d.0 == name).map(|d| d.1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Type {
    Bool,
    I32,
    U32,
    F32,
    Vec2,
    Vec3,
    Vec4,
    Quat,
    Color,
}

/// Each type's name and how many numbers one value holds.
const TYPES: [(&str, Type, usize); 9] = [
    ("bool", Type::Bool, 1),
    ("i32", Type::I32, 1),
    ("u32", Type::U32, 1),
    ("f32", Type::F32, 1),
    ("vec2", Type::Vec2, 2),
    ("vec3", Type::Vec3, 3),
    ("vec4", Type::Vec4, 4),
    ("quat", Type::Quat, 4),
    ("color", Type::Color, 4),
];

impl Type {
    pub fn name(self) -> &'static str {
        TYPES.iter().find(|t| t.1 == self).map_or("", |t| t.0)
    }

    pub fn named(name: &str) -> Option<Type> {
        TYPES.iter().find(|t| t.0 == name).map(|t| t.1)
    }

    pub fn width(self) -> usize {
        TYPES.iter().find(|t| t.1 == self).map_or(1, |t| t.2)
    }

    /// Whether a new element's value is blended from those it was made from: a float type's is;
    /// a bool, i32, u32 or quat never is.
    pub fn blends(self) -> bool {
        !matches!(self, Type::Bool | Type::I32 | Type::U32 | Type::Quat)
    }
}

/// One attribute: its values in f64, `ty.width()` numbers per element of `domain`.
#[derive(Clone, Debug, PartialEq)]
pub struct Attribute {
    pub domain: Domain,
    pub ty: Type,
    pub values: Vec<f64>,
}

pub type Typed = BTreeMap<String, Attribute>;

/// Why an attribute can't be written or carried.
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    /// Its array's length differs from its domain's count.
    Count {
        name: String,
        domain: Domain,
        got: usize,
        want: usize,
    },
    /// Its name is a built-in's.
    BuiltIn(String),
    /// Its name is already written with another domain or type.
    Second {
        name: String,
        was: (Domain, Type),
        now: (Domain, Type),
    },
    /// A modifier has no rule for an attribute its input carries.
    NoRule {
        modifier: String,
        name: String,
        domain: Domain,
        ty: Type,
    },
}

/// The codes an attribute or a store's field is refused with.
pub const CODES: [&str; 6] = [
    "attribute.length",
    "attribute.reserved",
    "attribute.second_writer",
    "attribute.no_rule",
    "field.nodes",
    "fallback_missing",
];

/// A refusal with its code, the path it names and what it found, as a builder's fault.
pub(crate) fn coded(code: &str, path: &str, found: &Value) -> Fault {
    format!("{}{CODED}{found}", crate::builders::coded(code, path))
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::Count { .. } => CODES[0],
            Refusal::BuiltIn(_) => CODES[1],
            Refusal::Second { .. } => CODES[2],
            Refusal::NoRule { .. } => CODES[3],
        }
    }

    /// What it names: the attribute, and its domain and both counts, both writers' domains and
    /// types, or the modifier with the attribute's domain and type.
    pub fn found(&self) -> Value {
        let kind = |(d, t): &(Domain, Type)| json!({"domain": d.name(), "type": t.name()});
        match self {
            Refusal::Count {
                name,
                domain,
                got,
                want,
            } => json!({"attribute": name, "domain": domain.name(), "length": got, "count": want}),
            Refusal::BuiltIn(name) => json!({"attribute": name}),
            Refusal::Second { name, was, now } => {
                json!({"attribute": name, "first": kind(was), "second": kind(now)})
            }
            Refusal::NoRule {
                modifier,
                name,
                domain,
                ty,
            } => {
                json!({"modifier": modifier, "attribute": name, "domain": domain.name(), "type": ty.name()})
            }
        }
    }

    /// The refusal at `path` under its item, as a builder's fault.
    pub(crate) fn fault(&self, path: &str) -> Fault {
        coded(self.code(), path, &self.found())
    }
}

/// A polygon view's corners and edges by their places in a corner or an edge attribute's array.
struct Places {
    /// Each face's first corner.
    start: Vec<u32>,
    /// The edges' sorted ends, in order.
    edges: Vec<(u32, u32)>,
}

impl Places {
    fn of(p: &Poly) -> Places {
        let mut at = 0;
        let start = p
            .faces
            .iter()
            .map(|c| {
                at += c.len() as u32;
                at - c.len() as u32
            })
            .collect();
        Places {
            start,
            edges: p.edges().into_keys().collect(),
        }
    }

    /// The corner of `face` at `point`; its first where it has none there.
    fn corner(&self, p: &Poly, face: usize, point: u32) -> usize {
        let k = p.faces[face].iter().position(|q| *q == point);
        self.start[face] as usize + k.unwrap_or(0)
    }

    fn edge(&self, a: u32, b: u32) -> Option<usize> {
        self.edges.binary_search(&key(a, b)).ok()
    }
}

/// `typed`, in the numbering of the view `src`, as the view `out` numbers it: each point of `out`
/// was made from `point(p)` of `src`, each face from `face(f)`, and face `f`'s corner `k` from
/// the source face's corner at `corner(f, k)`, so a corner's value never leaves its source face.
/// An edge's value comes from the source edge between its ends' sources, with `edges`; an
/// attribute with no source for an element is left out.
pub(crate) fn onto(
    typed: &Typed,
    src: &Poly,
    out: &Poly,
    point: &dyn Fn(u32) -> u32,
    face: &dyn Fn(usize) -> usize,
    corner: &dyn Fn(usize, usize) -> u32,
    edges: bool,
) -> Typed {
    if typed.is_empty() {
        return Typed::new();
    }
    let (from, to) = (Places::of(src), Places::of(out));
    let source = |domain: Domain| -> Option<Vec<usize>> {
        Some(match domain {
            Domain::Point => (0..out.points.len() as u32)
                .map(|p| point(p) as usize)
                .collect(),
            Domain::Face => (0..out.faces.len()).map(face).collect(),
            Domain::Corner => out
                .faces
                .iter()
                .enumerate()
                .flat_map(|(f, c)| (0..c.len()).map(move |k| (f, k)))
                .map(|(f, k)| from.corner(src, face(f), corner(f, k)))
                .collect(),
            Domain::Edge if edges => {
                let mut list = vec![None; to.edges.len()];
                for (f, c) in out.faces.iter().enumerate() {
                    for k in 0..c.len() {
                        let next = (k + 1) % c.len();
                        let e = to.edge(c[k], c[next])?;
                        if list[e].is_none() {
                            list[e] = Some(from.edge(corner(f, k), corner(f, next))?);
                        }
                    }
                }
                list.into_iter().collect::<Option<_>>()?
            }
            _ => return None,
        })
    };
    typed
        .iter()
        .filter_map(|(name, a)| {
            let w = a.ty.width();
            let values = source(a.domain)?
                .into_iter()
                .flat_map(|s| a.values[s * w..(s + 1) * w].iter().copied())
                .collect();
            Some((
                name.clone(),
                Attribute {
                    values,
                    domain: a.domain,
                    ty: a.ty,
                },
            ))
        })
        .collect()
}

/// A mesh's elements: its polygon view, each vertex's point and each triangle's face.
pub struct Elements {
    pub poly: Poly,
    pub point: Vec<u32>,
    pub face: Vec<u32>,
    places: Places,
}

impl Elements {
    pub fn of(m: &Mesh) -> Elements {
        let point = m.welded();
        let poly = Poly::of_welded(m, &point);
        // A face's triangles: its origin, and the others of the origin's face ID.
        let mut by_id = BTreeMap::new();
        let mut face = vec![u32::MAX; m.triangles()];
        for (f, t) in poly.origin.iter().enumerate() {
            by_id.insert(m.faces[*t as usize], f as u32);
            face[*t as usize] = f as u32;
        }
        for (t, f) in face.iter_mut().enumerate() {
            if *f == u32::MAX {
                *f = by_id[&m.faces[t]];
            }
        }
        Elements {
            places: Places::of(&poly),
            poly,
            point,
            face,
        }
    }

    /// How many elements `domain` holds; a mesh holds no curve and no instance.
    pub fn count(&self, domain: Domain) -> usize {
        match domain {
            Domain::Point => self.poly.points.len(),
            Domain::Edge => self.places.edges.len(),
            Domain::Face => self.poly.faces.len(),
            Domain::Corner => self.poly.corners(),
            Domain::Curve | Domain::Instance => 0,
        }
    }

    /// Each point's first vertex.
    pub fn first(&self) -> Vec<u32> {
        let mut first = vec![u32::MAX; self.poly.points.len()];
        for (v, p) in self.point.iter().enumerate().rev() {
            first[*p as usize] = v as u32;
        }
        first
    }

    /// Each face's first corner.
    pub fn starts(&self) -> &[u32] {
        &self.places.start
    }

    /// The mesh's table: its typed attributes, each float one it keeps per vertex read at its
    /// points, and each it keeps per triangle read at its faces.
    pub fn table(&self, m: &Mesh) -> Typed {
        let mut out = m.typed.clone();
        let first = self.first();
        let read = |domain, values: Vec<f64>| Attribute {
            domain,
            ty: Type::F32,
            values,
        };
        // A name that starts with NUL is the stack's own, never an attribute.
        for (name, v) in m.attributes.iter().filter(|(n, _)| !n.starts_with('\0')) {
            let values = first.iter().map(|i| v[*i as usize]).collect();
            out.insert(name.clone(), read(Domain::Point, values));
        }
        for (name, v) in &m.face_attributes {
            let values = self.poly.origin.iter().map(|t| v[*t as usize]).collect();
            out.insert(name.clone(), read(Domain::Face, values));
        }
        out
    }

    /// Writes attribute `name` on `m`, whose elements these are.
    pub fn write(&self, m: &mut Mesh, name: &str, a: Attribute) -> Result<(), Refusal> {
        if BUILT_IN.contains(&name) {
            return Err(Refusal::BuiltIn(name.into()));
        }
        let (got, want) = (a.values.len(), self.count(a.domain) * a.ty.width());
        if got != want {
            return Err(Refusal::Count {
                name: name.into(),
                domain: a.domain,
                got: got / a.ty.width(),
                want: want / a.ty.width(),
            });
        }
        let now = (a.domain, a.ty);
        let was = match m.typed.get(name) {
            Some(b) => Some((b.domain, b.ty)),
            None if m.attributes.contains_key(name) => Some((Domain::Point, Type::F32)),
            None if m.face_attributes.contains_key(name) => Some((Domain::Face, Type::F32)),
            None => None,
        };
        if let Some(was) = was.filter(|w| *w != now) {
            return Err(Refusal::Second {
                name: name.into(),
                was,
                now,
            });
        }
        match now {
            (Domain::Point, Type::F32) => {
                let v = self.point.iter().map(|p| a.values[*p as usize]).collect();
                m.attributes.insert(name.into(), v);
            }
            (Domain::Face, Type::F32) => {
                let v = self.face.iter().map(|f| a.values[*f as usize]).collect();
                m.face_attributes.insert(name.into(), v);
            }
            _ => {
                m.typed.insert(name.into(), a);
            }
        }
        Ok(())
    }
}

/// `src`'s typed attributes on `out`, a mesh a step made of it: `out`'s vertex `v` came from
/// `src`'s vertex `vertex(v)`, and its triangle `t` from `tri(t)`. Only an array or a mirror
/// carries an edge attribute (`edges`).
pub(crate) fn carry(
    src: &Mesh,
    out: &mut Mesh,
    vertex: &dyn Fn(usize) -> usize,
    tri: &dyn Fn(usize) -> usize,
    edges: bool,
) {
    out.typed.clear();
    if src.typed.is_empty() {
        return;
    }
    let (from, to) = (Elements::of(src), Elements::of(out));
    let first = to.first();
    let point = |v: u32| from.point[vertex(v as usize)];
    out.typed = onto(
        &src.typed,
        &from.poly,
        &to.poly,
        &|p| point(first[p as usize]),
        &|f| from.face[tri(to.poly.origin[f] as usize)] as usize,
        &|f, k| point(to.poly.vertex[f][k]),
        edges,
    );
}

/// The first of `before`'s attributes `m` no longer holds as it was, or holds with an array whose
/// length differs from its domain's count: what the step between them has no rule for.
pub(crate) fn dropped(before: &[(String, Domain, Type)], m: &Mesh) -> Option<usize> {
    if before.is_empty() {
        return None;
    }
    let e = Elements::of(m);
    before.iter().position(|(name, domain, ty)| {
        !m.typed.get(name).is_some_and(|a| {
            (a.domain, a.ty) == (*domain, *ty) && a.values.len() == e.count(*domain) * ty.width()
        })
    })
}

/// Planted ([`KEPT_AS_F32`]): every attribute's values as f32 holds them.
pub(crate) fn kept_as_f32(m: &mut Mesh) {
    let typed = m.typed.values_mut().map(|a| &mut a.values);
    let kept = m
        .attributes
        .values_mut()
        .chain(m.face_attributes.values_mut());
    for x in typed.chain(kept).flatten() {
        *x = f64::from(*x as f32);
    }
}

/// The fixture builder's kind (#1781): `test.attrs@1 {attributes: [{name, domain, type,
/// values}]}`, a 1 m box with the attributes its params list. Only a test build registers it
/// ([`register_fixture`]), so a shipped build skips an item of it as a kind it doesn't know.
pub const FIXTURE: &str = "test.attrs@1";

/// Registers the fixture builder's kind: a test build's scene3d calls it after its own kinds.
pub fn register_fixture(r: &mut deep_canvas::registry::Registrar) {
    if let Some(spec) = crate::spec::of(FIXTURE) {
        r.kind(crate::spec::entry(&spec, "test", "attrs"), &[], "");
    }
}

/// The fixture builder's box, as a slab's params.
pub(crate) fn fixture_box() -> Value {
    json!({"size": [1, 1, 1]})
}

/// One element's value as its numbers: a bool as 0 or 1 (or true or false), an i32 or a u32 a
/// whole number in its range, a float a number, and a vector a list of its components.
fn numbers(ty: Type, v: &Value) -> Option<Vec<f64>> {
    let whole = |lo: f64, hi: f64| {
        v.as_f64()
            .filter(|x| x.fract() == 0.0 && (lo..=hi).contains(x))
    };
    Some(match ty {
        Type::Bool => vec![match v.as_bool() {
            Some(b) => f64::from(u8::from(b)),
            None => whole(0.0, 1.0)?,
        }],
        Type::I32 => vec![whole(f64::from(i32::MIN), f64::from(i32::MAX))?],
        Type::U32 => vec![whole(0.0, f64::from(u32::MAX))?],
        Type::F32 => vec![v.as_f64()?],
        _ => {
            let list = v.as_array().filter(|l| l.len() == ty.width())?;
            list.iter().map(Value::as_f64).collect::<Option<_>>()?
        }
    })
}

/// Writes the attributes the fixture builder's `params` list on its mesh.
pub(crate) fn listed(m: &mut Mesh, params: &Value) -> Result<(), Fault> {
    let Some(list) = params.get("attributes") else {
        return Ok(());
    };
    let e = Elements::of(m);
    for (i, a) in list
        .as_array()
        .ok_or("params/attributes")?
        .iter()
        .enumerate()
    {
        let at = |field: &str| format!("params/attributes/{i}/{field}");
        let name = a
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| at("name"))?;
        let word = |field: &str| {
            a.get(field)
                .and_then(Value::as_str)
                .ok_or_else(|| at(field))
        };
        let domain = Domain::named(word("domain")?).ok_or_else(|| at("domain"))?;
        let ty = Type::named(word("type")?).ok_or_else(|| at("type"))?;
        let values = a.get("values").and_then(Value::as_array);
        let values = values
            .and_then(|l| l.iter().map(|v| numbers(ty, v)).collect::<Option<Vec<_>>>())
            .ok_or_else(|| at("values"))?
            .concat();
        let attribute = Attribute { domain, ty, values };
        e.write(m, name, attribute).map_err(|r| match r {
            Refusal::Count { .. } => r.fault(&at("values")),
            _ => r.fault(&at("name")),
        })?;
    }
    Ok(())
}
