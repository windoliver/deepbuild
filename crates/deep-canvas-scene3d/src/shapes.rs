//! An item's true shape placed in the world (canvas primitives: Geometry audit; Constraint:
//! rest_on; issues #405 and #2013): the pieces the geometry audit reads, which `rest_on` rests an
//! item on and `distribute` projects onto, so the contact one of them makes is the contact the
//! audit finds.

use deep_canvas::geometry_audit::{Joint, Shape, V3};
use deep_canvas::ops::sqrt;
use serde_json::Value;

use crate::scene::{apply, Affine3};

fn column(m: &Affine3, j: usize) -> V3 {
    [m[0][j], m[1][j], m[2][j]]
}

fn norm(v: V3) -> f64 {
    sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

/// The box `[lo, hi]` in a part's own space, placed by `m`.
pub fn placed_box(m: &Affine3, lo: V3, hi: V3) -> Shape {
    let c = apply(
        m,
        [
            (lo[0] + hi[0]) / 2.0,
            (lo[1] + hi[1]) / 2.0,
            (lo[2] + hi[2]) / 2.0,
        ],
    );
    let mut axes = [[0.0; 3]; 3];
    let mut half = [0.0; 3];
    for j in 0..3 {
        let col = column(m, j);
        let l = norm(col);
        half[j] = l * (hi[j] - lo[j]).abs() / 2.0;
        axes[j] = if l > 0.0 {
            [col[0] / l, col[1] / l, col[2] / l]
        } else {
            [0.0; 3]
        };
        if l == 0.0 {
            axes[j][j] = 1.0;
        }
    }
    Shape::Obb { c, axes, half }
}

fn v3(v: &Value) -> Option<V3> {
    let a = v.as_array()?;
    Some([
        a.first()?.as_f64()?,
        a.get(1)?.as_f64()?,
        a.get(2)?.as_f64()?,
    ])
}

/// #2014: a terrain plate's true shape, the surface its samples make split as they are drawn,
/// moved by `m`'s translation (a plate is ground: nothing turns or scales it); none for another
/// item.
fn terrain(item: &Value, m: &Affine3) -> Result<Option<Shape>, String> {
    let Some(params) = item
        .get("params")
        .filter(|p| crate::terrain::of_params(p).is_some())
    else {
        return Ok(None);
    };
    let t = crate::terrain::build(params, false)?;
    Ok(Some(Shape::Heights(std::sync::Arc::new(
        t.heights(apply(m, [0.0; 3])),
    ))))
}

/// #1636: a capsule chain a piece carries itself, `{"points": [p], "radii": [one per span]}` in
/// its own space, placed by `m`; none for a piece that reads its item's path (a tube's, a coil's).
fn chain(c: &Value, m: &Affine3, scale: f64) -> Option<Vec<Shape>> {
    let points: Vec<V3> = c
        .get("points")?
        .as_array()?
        .iter()
        .map(v3)
        .collect::<Option<_>>()?;
    let radii = c.get("radii")?.as_array()?;
    if points.len() < 2 || radii.len() + 1 != points.len() {
        return None;
    }
    let placed: Vec<V3> = points.iter().map(|q| apply(m, *q)).collect();
    Some(
        placed
            .windows(2)
            .zip(radii)
            .map(|(w, r)| Shape::Capsule {
                a: w[0],
                b: w[1],
                r: r.as_f64().unwrap_or(0.0) * scale,
            })
            .collect(),
    )
}

/// #1636: how near their fork, in the parent's radius there, a fork's branches may meet.
const FORK_ZONE: f64 = 1.5;

/// #1636: a builder's pieces that are solids of their own (a tree's capsule chain per branch,
/// `{"capsules": {"branch", "points", "radii"}}`) placed by `m`: each piece's ID `<id>#<branch>`,
/// its capsules and its joints. Each fork the mesh lists (`outputs.forks`: `{parent, children}`)
/// joins its parent and its children, two by two, within 1.5 times the parent's last ring's radius
/// of that ring's centre (the mean of its vertices, and their mean distance from it). Empty for a
/// mesh none of whose pieces names a branch.
pub fn pieces(
    id: &str,
    mesh: &crate::geom::Mesh,
    m: &Affine3,
) -> Vec<(String, Vec<Shape>, Vec<Joint>)> {
    let scale = (0..3).map(|j| norm(column(m, j))).fold(0.0, f64::max);
    let mut out: Vec<(String, Vec<Shape>, Vec<Joint>)> = mesh
        .true_shape
        .iter()
        .filter_map(|piece| {
            let c = piece.get("capsules")?;
            let branch = c.get("branch")?.as_str()?;
            Some((format!("{id}#{branch}"), chain(c, m, scale)?, Vec::new()))
        })
        .collect();
    let rows = mesh.outputs.get("branches").and_then(Value::as_array);
    let last_ring = |branch: &str| -> Option<(V3, f64)> {
        let row = rows?
            .iter()
            .find(|b| b.get("id").and_then(Value::as_str) == Some(branch))?;
        let ring: Vec<V3> = row
            .get("rings")?
            .as_array()?
            .last()?
            .get("vertices")?
            .as_array()?
            .iter()
            .map(|i| {
                mesh.positions
                    .get(usize::try_from(i.as_u64()?).ok()?)
                    .copied()
            })
            .collect::<Option<_>>()?;
        let n = ring.len() as f64;
        let c: V3 = std::array::from_fn(|k| ring.iter().map(|p| p[k]).sum::<f64>() / n);
        let r = ring
            .iter()
            .map(|p| norm([p[0] - c[0], p[1] - c[1], p[2] - c[2]]))
            .sum::<f64>()
            / n;
        Some((c, r))
    };
    let forks = mesh.outputs.get("forks").and_then(Value::as_array);
    for fork in forks.into_iter().flatten() {
        let Some(parent) = fork.get("parent").and_then(Value::as_str) else {
            continue;
        };
        let Some((c, r)) = last_ring(parent) else {
            continue;
        };
        let kin: Vec<String> = std::iter::once(parent)
            .chain(
                fork.get("children")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str),
            )
            .map(|b| format!("{id}#{b}"))
            .collect();
        let at = apply(m, c);
        for (solid, _, joints) in out.iter_mut().filter(|(s, _, _)| kin.contains(s)) {
            joints.extend(kin.iter().filter(|k| *k != solid).map(|k| Joint {
                with: k.clone(),
                at,
                r: FORK_ZONE * r * scale,
            }));
        }
    }
    out
}

/// A part's true shape from its builder's pieces (`true_shape`, in its own space) placed by `m`:
/// a sphere, a box, capsules along its path (whose first and last points are its ends) or along
/// the chain it carries, or the box around its mesh where nothing simpler is exact.
pub fn built(
    doc: &Value,
    item: &Value,
    mesh: &crate::geom::Mesh,
    m: &Affine3,
) -> (Vec<Shape>, Vec<V3>) {
    if let Ok(Some(surface)) = terrain(item, m) {
        return (vec![surface], Vec::new());
    }
    let [lo, hi] = mesh.bounds();
    let scale = (0..3).map(|j| norm(column(m, j))).fold(0.0, f64::max);
    let mut ends = Vec::new();
    let mut shapes = Vec::new();
    for piece in &mesh.true_shape {
        if let Some(b) = piece.get("sphere") {
            let c = b.get("centre").and_then(v3).unwrap_or([0.0; 3]);
            let r = b.get("radius").and_then(Value::as_f64).unwrap_or(0.0);
            shapes.push(Shape::Ball {
                c: apply(m, c),
                r: r * scale,
            });
            continue;
        }
        if let Some(c) = piece.get("capsules") {
            if let Some(chain) = chain(c, m, scale) {
                shapes.extend(chain);
                continue;
            }
            let r = c.get("radius").and_then(Value::as_f64).unwrap_or(0.0) * scale;
            let path = crate::builders::path(doc, item.pointer("/params/path"));
            if let Some(p) = path.filter(|p| p.points.len() > 1) {
                let pts: Vec<V3> = p.points.iter().map(|q| apply(m, *q)).collect();
                if !p.closed {
                    ends = vec![pts[0], pts[pts.len() - 1]];
                }
                shapes.extend(pts.windows(2).map(|w| Shape::Capsule {
                    a: w[0],
                    b: w[1],
                    r,
                }));
                continue;
            }
        }
        let (blo, bhi) = match piece.get("box") {
            Some(b) => (
                b.get("min").and_then(v3).unwrap_or(lo),
                b.get("max").and_then(v3).unwrap_or(hi),
            ),
            None => (lo, hi),
        };
        shapes.push(placed_box(m, blo, bhi));
    }
    if shapes.is_empty() {
        shapes.push(placed_box(m, lo, hi));
    }
    (shapes, ends)
}

/// A part's true shape, with a wire's or tube's ends.
pub type Placed = (Vec<Shape>, Vec<V3>);

/// The true shape of `item` placed by `m` (its world transform without its size) at `secs`, and a
/// wire's or tube's ends; `None` for a kind that is no solid. Paint and light play no part.
pub fn of(
    doc: &Value,
    id: &str,
    item: &Value,
    m: &Affine3,
    secs: f64,
) -> Result<Option<Placed>, String> {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let size = item
        .pointer("/params/size")
        .and_then(v3)
        .unwrap_or([1.0; 3]);
    let half = [size[0] / 2.0, size[1] / 2.0, size[2] / 2.0];
    Ok(Some(match kind {
        "mark.box@1" | "mark.cylinder@1" => (
            vec![placed_box(m, [-half[0], -half[1], -half[2]], half)],
            Vec::new(),
        ),
        "mark.sphere@1" => {
            let r = (0..3)
                .map(|j| norm(column(m, j)) * half[j])
                .fold(0.0, f64::max);
            (
                vec![Shape::Ball {
                    c: apply(m, [0.0; 3]),
                    r,
                }],
                Vec::new(),
            )
        }
        // #2014: a terrain plate's surface, with no mesh built.
        "plate@1"
            if item
                .get("params")
                .and_then(crate::terrain::of_params)
                .is_some() =>
        {
            let surface =
                terrain(item, m).map_err(|p| format!("out_of_range at items/{id}/{p}"))?;
            (surface.into_iter().collect(), Vec::new())
        }
        k if crate::builders::KINDS.contains(&k) => {
            let run = crate::stack::Run::default();
            let made = crate::build::built(doc, id, item, &run, secs)
                .map_err(|p| format!("out_of_range at items/{id}/{p}"))?;
            let Some(mesh) = made.mesh.filter(|m| m.triangles() > 0) else {
                return Ok(None);
            };
            built(doc, item, &mesh, m)
        }
        _ => return Ok(None),
    }))
}

/// `shape`, given in a prototype's own space, placed by `m` (a turn, one scale and a move): an
/// instancer's element (#2013).
pub fn placed(shape: &Shape, m: &Affine3) -> Shape {
    let dir = |v: V3| [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
    let scale = (0..3).map(|j| norm(column(m, j))).fold(0.0, f64::max);
    match shape {
        Shape::Obb { c, axes, half } => {
            let mut out = (*axes, *half);
            for k in 0..3 {
                let d = dir(axes[k]);
                let l = norm(d);
                out.1[k] = half[k] * l;
                if l > 0.0 {
                    out.0[k] = [d[0] / l, d[1] / l, d[2] / l];
                }
            }
            Shape::Obb {
                c: apply(m, *c),
                axes: out.0,
                half: out.1,
            }
        }
        Shape::Ball { c, r } => Shape::Ball {
            c: apply(m, *c),
            r: r * scale,
        },
        Shape::Capsule { a, b, r } => Shape::Capsule {
            a: apply(m, *a),
            b: apply(m, *b),
            r: r * scale,
        },
        Shape::Heights(h) => Shape::Heights(std::sync::Arc::new(h.moved(apply(m, [0.0; 3])))),
    }
}
