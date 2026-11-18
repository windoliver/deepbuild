#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    pub friction: f64,
    pub restitution: f64,
    pub density: Option<f64>,
    pub rolling_resistance: f64,
    pub tangent_speed: f64,
    /// Such as "wood": a hit carries both sides' tags (#1918).
    pub tag: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    Sphere {
        radius: f64,
    },
    Box {
        half: [f64; 3],
    },
    Capsule {
        half_height: f64,
        radius: f64,
    },
    Cylinder {
        half_height: f64,
        radius: f64,
    },
    Plane {
        normal: [f64; 3],
    },
    /// The hull of at most 64 points, rounded by `radius`.
    Convex {
        points: Vec<[f64; 3]>,
        radius: f64,
    },
    /// Triangles over vertices; static only.
    Mesh {
        vertices: Vec<[f64; 3]>,
        triangles: Vec<[u32; 3]>,
    },
    /// #2014: `rows` × `cols` heights, row by row, row along +Z and column along +X, spanning
    /// `scale[0]` × `scale[2]` m centred on the body with each height times `scale[1]`; each cell
    /// splits along the diagonal from its (column, row + 1) corner to its (column + 1, row) one,
    /// as a terrain plate draws it. Static only.
    Heightfield {
        cols: usize,
        rows: usize,
        heights: Vec<f64>,
        scale: [f64; 3],
    },
    /// Other shapes of the world by ID, each at its pose.
    Compound {
        children: Vec<(String, Pose)>,
    },
}

/// A rotation as written: a quaternion `[x, y, z, w]` or Euler degrees `[x, y, z]`.
#[derive(Clone, Debug, PartialEq)]
pub enum Rot {
    Quat([f64; 4]),
    Deg([f64; 3]),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    pub pos: [f64; 3],
    pub rot: Rot,
}
