//! Motion blur's helpers for `view3d` (#419; canvas primitives: Motion blur, Motion blur:
//! velocity): whether two evaluations draw the same, how far anything travels between two
//! sample times, and what the renderer's velocity target reads: each solid at t ± half the
//! shutter, never an earlier frame.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use deep_canvas_scene3d::geom::Mesh;
use deep_canvas_scene3d::samples::Blur;
use deep_canvas_scene3d::scene::{Affine3, Motion, MotionSolid, Scene, Shape, Solid};

type V3 = [f64; 3];

fn apply(m: &Affine3, p: V3) -> V3 {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

/// Whether two evaluations draw the same picture: their marks, camera and light. Readouts and
/// atlas pages are left out: a readout draws over the frame, never in it.
pub fn draws_same(a: &Scene, b: &Scene) -> bool {
    a.layers == b.layers
        && a.camera == b.camera
        && a.sun == b.sun
        && a.lights == b.lights
        && a.sky == b.sky
        && a.cutaway == b.cutaway
}

/// The points a solid's travel is measured at, in its own space: its mesh's vertices, or its
/// unit shape's corners.
fn points(s: &Solid) -> Vec<V3> {
    match (&s.mesh, s.shape) {
        (Some(m), _) => m.positions.clone(),
        (None, Shape::Built(_)) => Vec::new(),
        (None, _) => (0..8)
            .map(|c| [c & 1, c & 2, c & 4].map(|b| if b == 0 { -0.5 } else { 0.5 }))
            .collect(),
    }
}

/// The most any solid's points move on screen between evaluations `a` and `b`, px, each seen
/// through its own camera: a camera's move moves everything it shows.
pub fn travel(a: &Scene, b: &Scene) -> f64 {
    let bs: HashMap<&str, &Solid> = b
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .map(|s| (s.id.as_str(), s))
        .collect();
    let mut most: f64 = 0.0;
    for sa in a.layers.iter().flat_map(|l| &l.solids) {
        let Some(sb) = bs.get(sa.id.as_str()) else {
            continue;
        };
        let (pa, pb) = (points(sa), points(sb));
        if pa.len() != pb.len() {
            // A topology change: the whole item counts as moving.
            return f64::INFINITY;
        }
        for (p, q) in pa.iter().zip(&pb) {
            let (Some(x), Some(y)) = (
                a.camera.project(apply(&sa.model, *p)),
                b.camera.project(apply(&sb.model, *q)),
            ) else {
                continue;
            };
            most = most.max((x[0] - y[0]).hypot(x[1] - y[1]));
        }
    }
    most
}

/// How a velocity pairs a solid's surface across the shutter.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Pairing {
    /// The solid's pre-skins at t ± s/2 where its topology holds, its transform alone where not.
    Shipped,
    /// #419 AC4's wrong program: the transform alone, always.
    TransformOnly,
    /// #419 AC6's wrong program: vertex i with vertex i, across a topology change too.
    ByIndex,
}

/// The renderer's motion for the frame evaluated as `at`, from the evaluations at t − s/2
/// (`open`) and t + s/2 (`close`): each solid's world at both times and, where its surface
/// deforms with its topology held, its pre-skins; with the items whose topology changed inside
/// the shutter, which take their transform alone.
pub fn motion(
    at: &Scene,
    open: &Scene,
    close: &Scene,
    pairing: Pairing,
    blur: &Blur,
) -> (Motion, Vec<String>) {
    let by_id = |s: &Scene| -> HashMap<String, Solid> {
        s.layers
            .iter()
            .flat_map(|l| &l.solids)
            .map(|x| (x.id.clone(), x.clone()))
            .collect()
    };
    let (o, c) = (by_id(open), by_id(close));
    let mut topology = Vec::new();
    let mut solids = BTreeMap::new();
    for s in at.layers.iter().flat_map(|l| &l.solids) {
        let (Some(so), Some(sc)) = (o.get(&s.id), c.get(&s.id)) else {
            continue;
        };
        let same =
            |a: &Mesh, b: &Mesh| a.positions.len() == b.positions.len() && a.indices == b.indices;
        let meshes = match (&s.mesh, &so.mesh, &sc.mesh) {
            (Some(m), Some(mo), Some(mc)) if pairing != Pairing::TransformOnly => {
                if same(m, mo) && same(m, mc) {
                    (m.positions != mo.positions || m.positions != mc.positions)
                        .then(|| (mo.clone(), mc.clone()))
                } else if pairing == Pairing::ByIndex {
                    // Vertex i at t with vertex i (or the last there is) at each side.
                    let paired = |side: &Mesh| -> Arc<Mesh> {
                        let mut p = (**m).clone();
                        for (i, q) in p.positions.iter_mut().enumerate() {
                            *q = side.positions[i.min(side.positions.len() - 1)];
                        }
                        Arc::new(p)
                    };
                    Some((paired(mo), paired(mc)))
                } else {
                    topology.push(s.id.clone());
                    None
                }
            }
            _ => None,
        };
        solids.insert(
            s.id.clone(),
            MotionSolid {
                open: so.model,
                close: sc.model,
                meshes,
            },
        );
    }
    topology.sort();
    topology.dedup();
    let motion = Motion {
        open: open.camera.clone(),
        close: close.camera.clone(),
        solids,
        taps: blur.taps,
        max_px: blur.max_px,
        tile_px: blur.tile_px,
    };
    (motion, topology)
}
