//! Issue #458 (Scope: translation invariance): world positions compose in f64 and reach the GPU
//! relative to an origin near the view. The origin is the camera's target on a 1 km grid, so a
//! view within 500 m of the world's origin draws from the scene as it stands, bit for bit as
//! before, and a view anywhere else draws from a copy moved by the origin in f64: what the
//! renderer uploads is then no further from zero than the view is from its grid point, and a
//! document moved by whole kilometres uploads the same numbers. A scene holding something placed
//! by a field this module doesn't carry (water, terrain tints, a mirror, a cutaway, nested views,
//! projected insets, height fog, a painted ground, sway, trails, point clouds, logic-fed
//! instancers) draws from its absolute positions, as every scene did.

use std::sync::Arc;

use deep_canvas_scene3d::scene::{Camera, EdgesOf, Layer3, Motion, MotionSolid, Scene};

type V3 = [f64; 3];

/// The grid the origin snaps to, in m.
const CELL: f64 = 1000.0;

/// The view's origin: its camera's target on the grid, zero within 500 m of the world's.
pub fn of(scene: &Scene) -> V3 {
    let o = scene.camera.target.map(|c| (c / CELL).round() * CELL);
    if o.iter().all(|c| c.is_finite()) {
        o
    } else {
        [0.0; 3]
    }
}

/// Whether `scene` holds something placed in the world by a field [`moved`] doesn't carry.
fn fixed(scene: &Scene) -> bool {
    let sky = scene
        .sky
        .as_ref()
        .is_some_and(|s| s.fog_height.is_some() || s.background_ground.is_some());
    let layer = |l: &Layer3| {
        !l.fed.is_empty()
            || l.solids.iter().any(|s| s.sway.is_some())
            || l.lines.iter().any(|line| line.trail.is_some())
            || l.points.iter().any(|p| p.cloud.is_some())
    };
    sky || scene.water.is_some()
        || scene.mirror.is_some()
        || scene.cutaway.is_some()
        || !scene.tints.is_empty()
        || !scene.views.is_empty()
        || !scene.projected.is_empty()
        || scene.layers.iter().any(layer)
        || scene.sources.as_ref().is_some_and(|s| s.iter().any(layer))
}

/// `scene` with everything placed in it moved by its origin, so its camera's target lies within
/// 500 m of zero; `None` when the origin is zero already, or the scene holds what can't be moved.
pub fn moved(scene: &Scene) -> Option<Scene> {
    let o = of(scene);
    if o == [0.0; 3] || fixed(scene) {
        return None;
    }
    let point = |p: &mut V3| (0..3).for_each(|k| p[k] -= o[k]);
    let rows = |m: &mut [[f64; 4]; 3]| (0..3).for_each(|k| m[k][3] -= o[k]);
    let camera = |c: &mut Camera| {
        point(&mut c.eye);
        point(&mut c.target);
    };
    let layers = |layers: &mut Vec<Layer3>| {
        for l in layers {
            l.solids.iter_mut().for_each(|s| rows(&mut s.model));
            for line in &mut l.lines {
                for s in &mut line.segments {
                    point(&mut s.a);
                    point(&mut s.b);
                }
                line.points.iter_mut().for_each(point);
                if let Some(e) = &line.edges {
                    let mut model = e.model;
                    rows(&mut model);
                    line.edges = Some(Arc::new(EdgesOf {
                        model,
                        ..(**e).clone()
                    }));
                }
            }
            l.points.iter_mut().for_each(|p| point(&mut p.pos));
            l.labels.iter_mut().for_each(|p| point(&mut p.pos));
            l.images.iter_mut().for_each(|p| point(&mut p.pos));
            l.puffs.iter_mut().for_each(|p| point(&mut p.pos));
        }
    };
    let motion = |m: &Arc<Motion>| {
        let mut m = (**m).clone();
        camera(&mut m.open);
        camera(&mut m.close);
        for MotionSolid { open, close, .. } in m.solids.values_mut() {
            rows(open);
            rows(close);
        }
        Arc::new(m)
    };
    let mut s = scene.clone();
    camera(&mut s.camera);
    layers(&mut s.layers);
    if let Some(sources) = &scene.sources {
        let mut sources = (**sources).clone();
        layers(&mut sources);
        s.sources = Some(Arc::new(sources));
    }
    s.lights.iter_mut().for_each(|l| point(&mut l.pos));
    s.others.iter_mut().for_each(|p| point(&mut p.pos));
    s.readouts.iter_mut().for_each(|p| point(&mut p.pos));
    s.probes.iter_mut().for_each(|p| point(&mut p.pos));
    s.curves.values_mut().flatten().for_each(point);
    s.volumes.values_mut().for_each(|(_, m)| rows(m));
    s.motion = scene.motion.as_ref().map(motion);
    s.velocity = scene.velocity.as_ref().map(motion);
    Some(s)
}
