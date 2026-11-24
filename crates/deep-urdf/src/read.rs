//! A robot description read from its XML: its links, its joints and every other element by tag
//! and name. Nothing a file carries is run: an element of the macro namespace, or a value that
//! needs a macro expanded, refuses the file, naming it, and so does a mesh, naming its path, since
//! the job is given no mesh file.

use roxmltree::{Document, Node};

/// An `<origin>`: metres, then roll, pitch and yaw in radians about the fixed X, Y and Z.
#[derive(Clone, Copy, Default)]
pub struct Pose {
    pub xyz: [f64; 3],
    pub rpy: [f64; 3],
}

pub enum Geometry {
    Box([f64; 3]),
    Sphere(f64),
    Cylinder { radius: f64, length: f64 },
}

pub struct Shaped {
    pub origin: Pose,
    pub geometry: Geometry,
}

pub struct Inertial {
    pub origin: Pose,
    pub mass: f64,
    /// `ixx, ixy, ixz, iyy, iyz, izz`, where the file writes an `<inertia>`.
    pub tensor: Option<[f64; 6]>,
}

pub struct Link {
    pub name: String,
    /// Its `<inertial>`, where the file gives one with a mass above 0.
    pub inertial: Option<Inertial>,
    pub collisions: Vec<Shaped>,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Revolute,
    Continuous,
    Prismatic,
    Fixed,
    /// A floating or planar joint, one that follows another, or a type that is none of these: it
    /// still says where its child link stands.
    Unplaced,
}

pub struct Joint {
    pub name: String,
    pub kind: Kind,
    pub parent: String,
    pub child: String,
    pub origin: Pose,
    pub axis: [f64; 3],
    pub lower: f64,
    pub upper: f64,
    pub effort: f64,
    /// Its speed limit: rad/s, or m/s on a prismatic joint.
    pub speed: f64,
}

/// An element with no place, by its tag and its name.
pub struct Dropped {
    pub element: String,
    pub name: String,
}

#[derive(Default)]
pub struct Robot {
    pub name: String,
    pub links: Vec<Link>,
    pub joints: Vec<Joint>,
    pub dropped: Vec<Dropped>,
}

const NOTHING: &str = "nothing was written";

/// An element's name as the file writes it, with its prefix.
fn written(n: Node) -> String {
    let tag = n.tag_name();
    match tag.namespace().and_then(|ns| n.lookup_prefix(ns)) {
        Some(prefix) if !prefix.is_empty() => format!("{prefix}:{}", tag.name()),
        _ => tag.name().to_string(),
    }
}

fn child<'a, 'i>(n: Node<'a, 'i>, tag: &str) -> Option<Node<'a, 'i>> {
    n.children()
        .find(|c| c.is_element() && c.tag_name().name() == tag)
}

/// A row for `n`: its own name, the link a simulator extension refers to, or `holder`'s.
fn row(n: Node, holder: &str) -> Dropped {
    let name = n.attribute("name").or(n.attribute("reference"));
    Dropped {
        element: written(n),
        name: name.unwrap_or(holder).to_string(),
    }
}

/// `key`'s `N` numbers on `n`, or `default` where the file leaves the attribute out.
fn floats<const N: usize>(n: Node, key: &str, default: [f64; N]) -> Result<[f64; N], String> {
    let Some(text) = n.attribute(key) else {
        return Ok(default);
    };
    let odd = || {
        format!(
            "<{} {key}=\"{text}\"> isn't the {N} finite number(s) it takes; {NOTHING}",
            written(n)
        )
    };
    let mut parts = text.split_whitespace();
    let mut out = [0.0; N];
    for o in &mut out {
        let part = parts.next().ok_or_else(odd)?;
        *o = part
            .parse()
            .ok()
            .filter(|v: &f64| v.is_finite())
            .ok_or_else(odd)?;
    }
    if parts.next().is_some() {
        return Err(odd());
    }
    Ok(out)
}

fn float(n: Option<Node>, key: &str) -> Result<f64, String> {
    Ok(match n {
        Some(n) => floats(n, key, [0.0])?[0],
        None => 0.0,
    })
}

fn origin(n: Node) -> Result<Pose, String> {
    Ok(match child(n, "origin") {
        Some(o) => Pose {
            xyz: floats(o, "xyz", [0.0; 3])?,
            rpy: floats(o, "rpy", [0.0; 3])?,
        },
        None => Pose::default(),
    })
}

/// A `<visual>`'s or `<collision>`'s box, sphere or cylinder; none for any other geometry.
fn geometry(n: Node, link: &str) -> Result<Option<Geometry>, String> {
    let shape = child(n, "geometry").and_then(|g| g.children().find(|c| c.is_element()));
    let Some(g) = shape else { return Ok(None) };
    Ok(Some(match g.tag_name().name() {
        "box" => Geometry::Box(floats(g, "size", [0.0; 3])?),
        "sphere" => Geometry::Sphere(float(Some(g), "radius")?),
        "cylinder" => Geometry::Cylinder {
            radius: float(Some(g), "radius")?,
            length: float(Some(g), "length")?,
        },
        "mesh" => {
            let path = g.attribute("filename").unwrap_or("");
            return Err(format!("{path} is none of the files the job was given: a <{}> of the link {link} names a mesh by that path, and the job reads only its inputs; {NOTHING}", written(n)));
        }
        _ => return Ok(None),
    }))
}

fn link(n: Node, out: &mut Robot) -> Result<(), String> {
    let name = n
        .attribute("name")
        .ok_or(format!("a <link> has no name; {NOTHING}"))?;
    let mut link = Link {
        name: name.to_string(),
        inertial: None,
        collisions: Vec::new(),
    };
    for c in n.children().filter(|c| c.is_element()) {
        match c.tag_name().name() {
            "inertial" => {
                let mass = float(child(c, "mass"), "value")?;
                let mut tensor = None;
                if let Some(i) = child(c, "inertia") {
                    let mut t = [0.0; 6];
                    for (v, key) in t.iter_mut().zip(["ixx", "ixy", "ixz", "iyy", "iyz", "izz"]) {
                        *v = float(Some(i), key)?;
                    }
                    tensor = Some(t);
                }
                if mass > 0.0 {
                    link.inertial = Some(Inertial {
                        origin: origin(c)?,
                        mass,
                        tensor,
                    });
                }
            }
            "collision" => match geometry(c, name)? {
                Some(geometry) => link.collisions.push(Shaped {
                    origin: origin(c)?,
                    geometry,
                }),
                None => out.dropped.push(row(c, name)),
            },
            // A link's item draws its meshes, and a mesh is refused above: a box, a sphere or a
            // cylinder drawn has no place.
            "visual" => {
                geometry(c, name)?;
                out.dropped.push(row(c, name));
            }
            _ => out.dropped.push(row(c, name)),
        }
    }
    out.links.push(link);
    Ok(())
}

fn joint(n: Node, out: &mut Robot) -> Result<(), String> {
    let name = n
        .attribute("name")
        .ok_or(format!("a <joint> has no name; {NOTHING}"))?;
    let end = |tag: &str| {
        child(n, tag)
            .and_then(|c| c.attribute("link"))
            .map(str::to_string)
            .ok_or(format!("the joint {name} names no {tag} link; {NOTHING}"))
    };
    let mut kind = match n.attribute("type") {
        Some("revolute") => Kind::Revolute,
        Some("continuous") => Kind::Continuous,
        Some("prismatic") => Kind::Prismatic,
        Some("fixed") => Kind::Fixed,
        _ => Kind::Unplaced,
    };
    for c in n.children().filter(|c| c.is_element()) {
        match c.tag_name().name() {
            "parent" | "child" | "origin" | "axis" | "limit" => {}
            // joint@1 couples no two joints of an articulation, so a joint that follows another
            // has no place.
            "mimic" => kind = Kind::Unplaced,
            _ => out.dropped.push(row(c, name)),
        }
    }
    if kind == Kind::Unplaced {
        out.dropped.push(row(n, name));
    }
    let limit = child(n, "limit");
    out.joints.push(Joint {
        name: name.to_string(),
        kind,
        parent: end("parent")?,
        child: end("child")?,
        origin: origin(n)?,
        axis: match child(n, "axis") {
            Some(a) => floats(a, "xyz", [1.0, 0.0, 0.0])?,
            None => [1.0, 0.0, 0.0],
        },
        lower: float(limit, "lower")?,
        upper: float(limit, "upper")?,
        effort: float(limit, "effort")?,
        speed: float(limit, "velocity")?,
    });
    Ok(())
}

/// The file as a robot, or why it is refused, naming what in it.
pub fn robot(file: &[u8]) -> Result<Robot, String> {
    let text =
        std::str::from_utf8(file).map_err(|_| format!("the file isn't UTF-8 text; {NOTHING}"))?;
    let doc = Document::parse(text).map_err(|e| {
        format!("the file isn't the XML a robot description is written in: {e}; {NOTHING}")
    })?;
    let root = doc.root_element();
    for n in root.descendants().filter(|n| n.is_element()) {
        let ns = n.tag_name().namespace().unwrap_or("");
        if ns.to_ascii_lowercase().contains("xacro") {
            return Err(format!("the file needs a macro expanded: {}; the job runs no code from a file, so {NOTHING}", written(n)));
        }
        // A value a macro would fill in, wherever the file writes one.
        let unfilled =
            |a: &roxmltree::Attribute| a.value().contains("${") || a.value().contains("$(");
        if let Some(a) = n.attributes().find(unfilled) {
            return Err(format!("the file needs a macro expanded: <{} {}=\"{}\">; the job runs no code from a file, so {NOTHING}", written(n), a.name(), a.value()));
        }
    }
    if root.tag_name().name() != "robot" {
        return Err(format!(
            "the file's root element is <{}>, not <robot>; {NOTHING}",
            written(root)
        ));
    }
    let mut out = Robot {
        name: root.attribute("name").unwrap_or("robot").to_string(),
        ..Robot::default()
    };
    for n in root.children().filter(|n| n.is_element()) {
        match n.tag_name().name() {
            "link" => link(n, &mut out)?,
            "joint" => joint(n, &mut out)?,
            _ => out.dropped.push(row(n, "")),
        }
    }
    Ok(out)
}
