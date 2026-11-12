//! Issue #2014: the terrain plate (canvas primitives: Builder plate: terrain). A `plate@1` whose
//! `terrain` gives a height field: samples every `spacing` over `size`, built at full detail, each
//! cell split along the diagonal from its (column, row + 1) corner to its (column + 1, row) one.
//! The drawn mesh, the physics height-field shape, picks, `rest_on`, the geometry audit and height
//! queries all read these samples split that one way ([`deep_canvas::heights`]), so they agree
//! everywhere on a cell. The size cap counts samples: size ÷ spacing is at most 4,096 a side.

use deep_canvas::expr::{Expr, Nothing, V};
use deep_canvas::heights::Heights;
use serde_json::Value;

use crate::builders::Fault;
use crate::geom::{add, cross, dot, scale, sub, unit, Mesh, V3};

/// The most cells a plate takes a side: 4,097 samples.
pub const MAX_CELLS: u64 = 4096;
/// A terrain's fields (Builder plate: terrain).
const KEYS: [&str; 5] = ["height", "size", "spacing", "tile", "lod_levels"];
/// #2014's planted builder: it draws each cell split along its other diagonal.
pub const OTHER_DIAGONAL: &str = "terrain_splits_other_diagonal";
/// #2014's planted cap: it reads the size cap in metres, not samples.
pub const CAP_IN_METRES: &str = "terrain_cap_in_metres";

/// A terrain plate's samples, in its own space: `cols` × `rows` heights row by row, a row along
/// +X and rows along +Z, over `size` m centred on its origin.
#[derive(Clone, Debug, PartialEq)]
pub struct Terrain {
    pub size: [f64; 2],
    pub cols: usize,
    pub rows: usize,
    pub h: Vec<f64>,
}

fn bad(name: &str) -> Fault {
    format!("params/terrain/{name}")
}

/// The plate's `terrain`, when it has one.
pub fn of_params(params: &Value) -> Option<&Value> {
    params.get("terrain").filter(|t| !t.is_null())
}

/// Cells a side from `size` and `spacing`: their ratio, a whole number within a part in 10⁹, and
/// otherwise the next one up, so no cell is wider than `spacing`.
fn cells(size: f64, spacing: f64) -> f64 {
    let n = size / spacing;
    let near = n.round();
    if (n - near).abs() <= 1e-9 * near.max(1.0) {
        near.max(1.0)
    } else {
        n.ceil()
    }
}

/// The terrain's size and samples a side, its cap held: size ÷ spacing at most 4,096 a side, or
/// with `cap_in_metres` the planted cap that reads size alone. A plate past it is refused at its
/// `terrain`, whose block names its size and spacing.
pub fn grid(t: &Value, cap_in_metres: bool) -> Result<([f64; 2], [usize; 2]), Fault> {
    if let Some(k) = t
        .as_object()
        .and_then(|o| o.keys().find(|k| !KEYS.contains(&k.as_str())))
    {
        return Err(bad(k));
    }
    // Tiles and levels are read by levels of detail (#2017); here each is held to its range.
    if t.get("tile")
        .is_some_and(|v| !v.as_f64().is_some_and(|x| x.is_finite() && x > 0.0))
    {
        return Err(bad("tile"));
    }
    if t.get("lod_levels")
        .is_some_and(|v| !v.as_u64().is_some_and(|n| n <= 6))
    {
        return Err(bad("lod_levels"));
    }
    let size = t
        .get("size")
        .and_then(Value::as_array)
        .filter(|a| a.len() == 2)
        .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
        .filter(|s| s.iter().all(|x| x.is_finite() && *x > 0.0))
        .ok_or_else(|| bad("size"))?;
    let spacing = match t.get("spacing") {
        None => 1.0,
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad("spacing"))?,
    };
    let n = [cells(size[0], spacing), cells(size[1], spacing)];
    let read = if cap_in_metres { size } else { n };
    if read.iter().any(|x| *x > MAX_CELLS as f64) {
        return Err("params/terrain".into());
    }
    Ok((size, [n[0] as usize + 1, n[1] as usize + 1]))
}

/// A height field: a number, an expression over `position` (the sample's [x, 0, z] in the
/// plate's own space), or a plate's `{wave}` or `{noise}`.
fn field(t: &Value) -> Result<Box<dyn Fn(f64, f64) -> f64>, Fault> {
    let v = t.get("height").ok_or_else(|| bad("height"))?;
    if let Some(h) = v.as_f64() {
        return Ok(Box::new(move |_, _| h));
    }
    if let Some(text) = v.as_str() {
        let e = Expr::compile(text, &Nothing, 256)
            .ok()
            .filter(|e| e.vars.iter().all(|n| n == "position"))
            .ok_or_else(|| bad("height"))?;
        return Ok(Box::new(move |x, z| {
            let vars: Vec<V> = e.vars.iter().map(|_| V::V(3, [x, 0.0, z, 0.0])).collect();
            e.eval(&vars).num()
        }));
    }
    let v = v.clone();
    crate::builders::height_at(&v, 0.0, 0.0).ok_or_else(|| bad("height"))?;
    Ok(Box::new(move |x, z| {
        crate::builders::height_at(&v, x, z).unwrap_or(f64::NAN)
    }))
}

/// The terrain a plate's params give: its samples evaluated at full detail, each a finite number.
pub fn build(params: &Value, cap_in_metres: bool) -> Result<Terrain, Fault> {
    let t = of_params(params).ok_or_else(|| bad(""))?;
    let (size, [cols, rows]) = grid(t, cap_in_metres)?;
    let f = field(t)?;
    let mut h = Vec::with_capacity(cols * rows);
    for r in 0..rows {
        for c in 0..cols {
            let q = Heights::local(size, cols, rows, c, r, 0.0);
            let y = f(q[0], q[2]);
            if !y.is_finite() {
                return Err(bad("height"));
            }
            h.push(y);
        }
    }
    Ok(Terrain {
        size,
        cols,
        rows,
        h,
    })
}

/// The builder: the drawn plate, split along the other diagonal under the planted builder; the
/// cap read in metres under the planted cap.
pub fn built(params: &Value, planted: Option<&str>) -> Result<Mesh, Fault> {
    Ok(build(params, planted == Some(CAP_IN_METRES))?.mesh(planted == Some(OTHER_DIAGONAL)))
}

/// Its vertex and triangle counts from its params alone, its own cap in samples in place of a
/// builder's vertex cap.
pub fn counted(params: &Value, planted: Option<&str>) -> Result<(u64, u64), Fault> {
    let t = of_params(params).ok_or_else(|| bad(""))?;
    let (_, [cols, rows]) = grid(t, planted == Some(CAP_IN_METRES))?;
    Ok(((cols * rows) as u64, 2 * ((cols - 1) * (rows - 1)) as u64))
}

impl Terrain {
    /// Its surface with its centre at `centre` in the world.
    pub fn heights(&self, centre: V3) -> Heights {
        Heights::new(centre, self.size, self.cols, self.rows, self.h.clone())
            .unwrap_or_else(|| unreachable!("a built terrain has 2 × 2 finite samples or more"))
    }

    /// The drawn plate: a vertex per sample, two triangles per cell split as the surface is (the
    /// planted builder splits along the other diagonal), each cell one face, normals smooth.
    pub fn mesh(&self, other_diagonal: bool) -> Mesh {
        let s = self.heights([0.0; 3]);
        let mut m = Mesh::default();
        for r in 0..self.rows {
            for c in 0..self.cols {
                m.vertex(s.at(c, r), [0.0, 1.0, 0.0]);
            }
        }
        let at = |c: usize, r: usize| (r * self.cols + c) as u32;
        for r in 0..self.rows - 1 {
            for c in 0..self.cols - 1 {
                let face = (r * (self.cols - 1) + c) as u32;
                let (p00, p01, p10, p11) = (at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r + 1));
                if other_diagonal {
                    m.tri(p00, p01, p11, face);
                    m.tri(p00, p11, p10, face);
                } else {
                    m.tri(p00, p01, p10, face);
                    m.tri(p01, p11, p10, face);
                }
            }
        }
        let mut acc = vec![[0.0; 3]; m.positions.len()];
        for t in 0..m.triangles() {
            let [a, b, c] = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
            let n = cross(
                sub(m.positions[b], m.positions[a]),
                sub(m.positions[c], m.positions[a]),
            );
            for v in [a, b, c] {
                acc[v] = add(acc[v], n);
            }
        }
        m.normals = acc
            .into_iter()
            .map(|n| {
                if dot(n, [0.0, 1.0, 0.0]) < 0.0 {
                    unit(scale(n, -1.0))
                } else {
                    unit(n)
                }
            })
            .collect();
        m.part("top", 0);
        m
    }
}
