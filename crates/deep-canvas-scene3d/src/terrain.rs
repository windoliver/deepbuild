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
        let tris = m.triangles();
        smooth(&mut m, tris);
        m.part("top", 0);
        m
    }
}

/// Each vertex's normal from the first `tris` triangles that meet it, weighted by their areas
/// and turned to face +Y.
fn smooth(m: &mut Mesh, tris: usize) {
    let mut acc = vec![[0.0; 3]; m.positions.len()];
    for t in 0..tris {
        let [a, b, c] = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
        let n = cross(
            sub(m.positions[b], m.positions[a]),
            sub(m.positions[c], m.positions[a]),
        );
        for v in [a, b, c] {
            acc[v] = add(acc[v], n);
        }
    }
    for (v, n) in acc.into_iter().enumerate() {
        if n != [0.0; 3] {
            m.normals[v] = if dot(n, [0.0, 1.0, 0.0]) < 0.0 {
                unit(scale(n, -1.0))
            } else {
                unit(n)
            };
        }
    }
}

/// The most tiles a plate draws a side; past it a tile spans twice the cells.
const MAX_TILES: usize = 64;

/// #2017: the levels a plate draws, `lod_levels`; 1, full detail only, when absent or 0.
pub fn lod_levels(params: &Value) -> usize {
    of_params(params)
        .and_then(|t| t.get("lod_levels"))
        .and_then(Value::as_u64)
        .map_or(1, |n| (n as usize).max(1))
}

/// #2017: a plate's full-detail normals, one per sample row by row, their x and z (y ≥ 0 is
/// rebuilt), which its tiles' pixels read at every level, keyed by its content.
#[derive(Clone, Debug, PartialEq)]
pub struct Normals {
    pub key: u64,
    pub cols: u32,
    pub rows: u32,
    pub xz: Vec<[f32; 2]>,
}

/// #2017: one tile of a plate: its column and row, its bounds in the plate's own space, and its
/// meshes by level, level k keeping every 2^k-th sample, each with its error: its largest
/// height off full detail, in m.
#[derive(Clone, Debug)]
pub struct Tile {
    pub at: [u32; 2],
    pub bounds: [V3; 2],
    pub levels: Vec<crate::lod::Level>,
}

/// #2017: a plate's tiles from its full-detail mesh `full` (keyed by `hash`), made once per
/// content key and kept in `memo`, the host's; none where the plate draws at full detail only: `lod_levels` under 2, or a mesh
/// that is no longer one vertex per sample (a stack or flat shading changed it).
pub fn tiles(
    params: &Value,
    full: &Mesh,
    hash: u64,
    memo: &crate::memo::Memo,
) -> Option<std::sync::Arc<Vec<Tile>>> {
    use std::sync::Arc;
    let levels = lod_levels(params);
    let t = of_params(params)?;
    let (_, [cols, rows]) = grid(t, false).ok()?;
    if levels < 2 || full.positions.len() != cols * rows || full.normals.len() != cols * rows {
        return None;
    }
    let spacing = t.get("spacing").and_then(Value::as_f64).unwrap_or(1.0);
    let tile = t.get("tile").and_then(Value::as_f64).unwrap_or(64.0);
    let mut tc = (cells(tile, spacing) as usize).next_multiple_of(1 << (levels - 1));
    while (cols - 1).div_ceil(tc) > MAX_TILES || (rows - 1).div_ceil(tc) > MAX_TILES {
        tc *= 2;
    }
    let key = (hash, tc, levels);
    let made = &memo.tiles;
    if let Some((_, tiles)) = made.lock().ok()?.iter().find(|(k, _)| *k == key) {
        return Some(tiles.clone());
    }
    let tiles = Arc::new(Plate { full, cols, rows }.tiles(tc, levels, hash));
    if let Ok(mut m) = made.lock() {
        if m.len() >= 4 {
            m.remove(0);
        }
        m.push((key, tiles.clone()));
    }
    Some(tiles)
}

/// A plate's full-detail mesh, one vertex per sample row by row.
struct Plate<'a> {
    full: &'a Mesh,
    cols: usize,
    rows: usize,
}

impl Plate<'_> {
    fn h(&self, c: usize, r: usize) -> f64 {
        self.full.positions[r * self.cols + c][1]
    }

    /// Its tiles of `tc` cells a side, each with up to `levels` levels.
    fn tiles(&self, tc: usize, levels: usize, hash: u64) -> Vec<Tile> {
        let (nx, nz) = ((self.cols - 1).div_ceil(tc), (self.rows - 1).div_ceil(tc));
        let span = |i: usize, n: usize| (i * tc, ((i + 1) * tc).min(n - 1));
        // Each tile's cells and its levels' errors: a ragged last tile keeps the levels whose
        // step divides its cells.
        let errors: Vec<Vec<f64>> = (0..nz)
            .flat_map(|j| (0..nx).map(move |i| (i, j)))
            .map(|(i, j)| {
                let ((c0, c1), (r0, r1)) = (span(i, self.cols), span(j, self.rows));
                // Each level's error is no lower than the finer one's (Level of detail: levels by
                // error), so the coarsest within lod_px is the last.
                let mut worst = 0.0f64;
                (0..levels)
                    .take_while(|k| (c1 - c0) % (1 << k) == 0 && (r1 - r0) % (1 << k) == 0)
                    .map(|k| {
                        worst = worst.max(self.error([c0, c1, r0, r1], 1 << k));
                        worst
                    })
                    .collect()
            })
            .collect();
        let worst = |i: usize, j: usize| errors[j * nx + i].iter().copied().fold(0.0, f64::max);
        let normals = std::sync::Arc::new(Normals {
            key: hash,
            cols: self.cols as u32,
            rows: self.rows as u32,
            xz: self
                .full
                .normals
                .iter()
                .map(|n| [n[0] as f32, n[2] as f32])
                .collect(),
        });
        let mut out = Vec::new();
        for j in 0..nz {
            for i in 0..nx {
                let ((c0, c1), (r0, r1)) = (span(i, self.cols), span(j, self.rows));
                // Neighbours at −X, +X, −Z and +Z; a skirt hangs from each shared edge by this
                // tile's largest error and its neighbours', so no two levels leave a gap.
                let sides = [i > 0, i + 1 < nx, j > 0, j + 1 < nz];
                let near = [
                    (i.wrapping_sub(1), j),
                    (i + 1, j),
                    (i, j.wrapping_sub(1)),
                    (i, j + 1),
                ];
                let around = sides
                    .iter()
                    .zip(near)
                    .filter(|(s, _)| **s)
                    .map(|(_, (a, b))| worst(a, b))
                    .fold(0.0, f64::max);
                let drop = worst(i, j) + around;
                let levels = errors[j * nx + i]
                    .iter()
                    .enumerate()
                    .map(|(k, &error)| {
                        let mut m = self.level([c0, c1, r0, r1], 1 << k, drop, sides);
                        m.terrain = Some(normals.clone());
                        let mut h = deep_canvas::schedule::Hasher::new("scene3d.terrain.tile");
                        h.bytes(&hash.to_le_bytes());
                        for n in [i, j, k, tc, levels] {
                            h.int(n as i64);
                        }
                        let key = h.finish().0;
                        crate::lod::Level {
                            mesh: std::sync::Arc::new(m),
                            hash: u64::from_le_bytes(key[..8].try_into().expect("8 bytes")),
                            error,
                        }
                    })
                    .collect();
                let ys = (r0..=r1).flat_map(|r| (c0..=c1).map(move |c| (c, r)));
                let (lo, hi) = ys.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), (c, r)| {
                    (lo.min(self.h(c, r)), hi.max(self.h(c, r)))
                });
                let at = |c: usize, r: usize| self.full.positions[r * self.cols + c];
                let (a, b) = (at(c0, r0), at(c1, r1));
                out.push(Tile {
                    at: [i as u32, j as u32],
                    bounds: [[a[0], lo, a[2]], [b[0], hi, b[2]]],
                    levels,
                });
            }
        }
        out
    }

    /// The largest height off full detail, in m, of cells `[c0, c1, r0, r1]` drawn every `s`
    /// samples: each coarse cell split as a full one is, along its (c, r + s)–(c + s, r)
    /// diagonal, so every fine cell lies in one coarse triangle and the largest gap is at a
    /// sample.
    fn error(&self, [c0, c1, r0, r1]: [usize; 4], s: usize) -> f64 {
        let mut e = 0.0f64;
        // Every sample: full detail is its own surface.
        if s == 1 {
            return e;
        }
        for r in r0..=r1 {
            for c in c0..=c1 {
                let block = |x: usize, x0: usize, x1: usize| (x0 + (x - x0) / s * s).min(x1 - s);
                let (bc, br) = (block(c, c0, c1), block(r, r0, r1));
                let (u, v) = ((c - bc) as f64 / s as f64, (r - br) as f64 / s as f64);
                let (h00, h10) = (self.h(bc, br), self.h(bc + s, br));
                let (h01, h11) = (self.h(bc, br + s), self.h(bc + s, br + s));
                let y = if u + v <= 1.0 {
                    h00 + u * (h10 - h00) + v * (h01 - h00)
                } else {
                    h11 + (1.0 - u) * (h01 - h11) + (1.0 - v) * (h10 - h11)
                };
                e = e.max((y - self.h(c, r)).abs());
            }
        }
        e
    }

    /// Cells `[c0, c1, r0, r1]` drawn every `s` samples: the full mesh's vertices there with
    /// their normals, uv0 and attributes, uv1 the sample's place on the plate's grid, cells
    /// split as the full ones are, and a skirt `drop` m deep under each edge `sides` marks.
    fn level(&self, [c0, c1, r0, r1]: [usize; 4], s: usize, drop: f64, sides: [bool; 4]) -> Mesh {
        let full = self.full;
        let (nc, nr) = ((c1 - c0) / s + 1, (r1 - r0) / s + 1);
        let mut m = Mesh::default();
        let take = |m: &mut Mesh, i: usize, j: usize, down: f64| {
            let (c, r) = (c0 + i * s, r0 + j * s);
            let v = r * self.cols + c;
            let p = full.positions[v];
            m.positions.push([p[0], p[1] - down, p[2]]);
            m.normals.push(full.normals[v]);
            if let Some(u) = full.uv0.get(v) {
                m.uv0.push(*u);
            }
            m.uv1.push([
                c as f64 / (self.cols - 1) as f64,
                r as f64 / (self.rows - 1) as f64,
            ]);
            if let Some(t) = full.tangents.get(v) {
                m.tangents.push(*t);
            }
            for (k, values) in &full.attributes {
                m.attributes.entry(k.clone()).or_default().push(values[v]);
            }
            (m.positions.len() - 1) as u32
        };
        for j in 0..nr {
            for i in 0..nc {
                take(&mut m, i, j, 0.0);
            }
        }
        let at = |i: usize, j: usize| (j * nc + i) as u32;
        for j in 0..nr - 1 {
            for i in 0..nc - 1 {
                let face = (j * (nc - 1) + i) as u32;
                m.tri(at(i, j), at(i, j + 1), at(i + 1, j), face);
                m.tri(at(i, j + 1), at(i + 1, j + 1), at(i + 1, j), face);
            }
        }
        m.part("top", 0);
        let top = m.triangles();
        let edges: [(Vec<(usize, usize)>, V3); 4] = [
            ((0..nr).map(|j| (0, j)).collect(), [-1.0, 0.0, 0.0]),
            ((0..nr).map(|j| (nc - 1, j)).collect(), [1.0, 0.0, 0.0]),
            ((0..nc).map(|i| (i, 0)).collect(), [0.0, 0.0, -1.0]),
            ((0..nc).map(|i| (i, nr - 1)).collect(), [0.0, 0.0, 1.0]),
        ];
        let mut face = ((nc - 1) * (nr - 1)) as u32;
        for ((edge, out), side) in edges.into_iter().zip(sides) {
            if !side || drop <= 0.0 {
                continue;
            }
            let low: Vec<u32> = edge
                .iter()
                .map(|&(i, j)| take(&mut m, i, j, drop))
                .collect();
            for (k, w) in edge.windows(2).enumerate() {
                let (a, b) = (at(w[0].0, w[0].1), at(w[1].0, w[1].1));
                let (la, lb) = (low[k], low[k + 1]);
                let p = |v: u32| m.positions[v as usize];
                if dot(cross(sub(p(b), p(a)), sub(p(lb), p(a))), out) >= 0.0 {
                    m.quad(a, b, lb, la, face);
                } else {
                    m.quad(a, la, lb, b, face);
                }
                face += 1;
            }
        }
        m.part("skirt", top);
        m
    }
}

/// #2017: where the vertical line through world (x, z) meets a tile's drawn top surface, `mesh`
/// placed by `model`: the height there in the world, or none off the tile.
pub fn drawn_height(mesh: &Mesh, model: &crate::scene::Affine3, x: f64, z: f64) -> Option<f64> {
    let top = mesh.parts.get("top")?;
    top.iter().find_map(|&t| {
        let [a, b, c] = [0, 1, 2].map(|j| {
            let v = mesh.indices[3 * t as usize + j] as usize;
            crate::scene::apply(model, mesh.positions[v])
        });
        let d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if d.abs() < 1e-300 {
            return None;
        }
        let l0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        let l1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        let l2 = 1.0 - l0 - l1;
        let inside = [l0, l1, l2].iter().all(|l| *l >= -1e-12);
        inside.then(|| l0 * a[1] + l1 * b[1] + l2 * c[1])
    })
}

/// #2017's planted plate in a scene: every terrain tile's levels shade from their own normals.
pub fn plant_level_normals(scene: &mut crate::scene::Scene) {
    for s in scene.layers.iter_mut().flat_map(|l| &mut l.solids) {
        let Some(lod) = s.lod.as_ref().filter(|l| l.tile.is_some()) else {
            continue;
        };
        let mut lod = (**lod).clone();
        lod.levels = lod.levels.iter().map(own_normals).collect();
        s.mesh = Some(lod.levels[0].mesh.clone());
        s.shape = crate::scene::Shape::Built(lod.levels[0].hash);
        s.lod = Some(std::sync::Arc::new(lod));
    }
}

/// #2017's planted plate: a tile's level with normals made from its own top triangles, and no
/// full-detail normals for the pixels to read.
fn own_normals(level: &crate::lod::Level) -> crate::lod::Level {
    let mut m = (*level.mesh).clone();
    m.terrain = None;
    let top = m.parts.get("top").map_or(0, Vec::len);
    smooth(&mut m, top);
    crate::lod::Level {
        mesh: std::sync::Arc::new(m),
        hash: level.hash ^ 0x4c45_5645_4c4e_0000,
        error: level.error,
    }
}
