//! What the renderer's velocity target reads (#419; canvas primitives: Motion blur: velocity): each
//! solid at t ± half the shutter, never an earlier frame.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use deep_canvas_scene3d::geom::Mesh;
use deep_canvas_scene3d::samples::Blur;
use deep_canvas_scene3d::scene::{Motion, MotionSolid, Scene, Solid};

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
