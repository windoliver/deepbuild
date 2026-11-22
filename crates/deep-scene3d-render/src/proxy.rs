//! A proxy band's mesh, made where a scene is drawn (#2738; canvas primitives: Level of detail:
//! proxies). scene3d records the mesh a proxy is made from; this crate simplifies it with
//! meshoptimizer once per content key, before a view resolves its choices, so nothing that only
//! evaluates a scene (physics among them) links meshoptimizer's C++.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use deep_canvas::gauge::{Gauge, Kept, Place};
use deep_canvas_scene3d::geom::Mesh;
use deep_canvas_scene3d::lod::{self, Choice, Level, Lod, Proxy};
use deep_canvas_scene3d::scene::Scene;

/// #1431: the proxies made (`proxy_of`'s process-wide map), a failed one counted in entries:
/// past either bound, the proxies asked for longest ago go first.
static PROXY_GAUGE: Gauge = Gauge::new("PROXIES", Place::Heap, 1_024, 64_000_000);

/// The heap bytes a proxy level's mesh holds: its vertices' arrays and its indices.
fn level_bytes(level: &Option<Level>) -> u64 {
    level.as_ref().map_or(0, |l| {
        let m = &l.mesh;
        (24 * (m.positions.len() + m.normals.len())
            + 16 * (m.uv0.len() + m.uv1.len())
            + 32 * m.tangents.len()
            + 4 * m.indices.len()) as u64
    })
}

/// The proxy of `mesh` (keyed by `hash`) that keeps `p.ratio` of its triangles within `p.error`,
/// made once per content key by meshoptimizer and stored by hash, never per frame.
fn proxy_of(mesh: &Mesh, hash: u64, p: Proxy) -> Option<Level> {
    type Key = (u64, u64, u64);
    // cache: entries 1_024, bytes 64_000_000
    static PROXIES: OnceLock<Mutex<Kept<Key, Option<Level>>>> = OnceLock::new();
    let key = (hash, p.ratio.to_bits(), p.error.unwrap_or(-1.0).to_bits());
    let made = PROXIES.get_or_init(|| Mutex::new(Kept::new(&PROXY_GAUGE)));
    {
        let mut made = made.lock().ok()?;
        made.turn();
        if let Some(l) = made.get(&key) {
            return l.clone();
        }
    }
    let positions: Vec<f32> = mesh
        .positions
        .iter()
        .flat_map(|q| q.map(|v| v as f32))
        .collect();
    let level = meshopt::VertexDataAdapter::new(meshopt::typed_to_bytes(&positions), 12, 0)
        .ok()
        .and_then(|adapter| {
            let target = ((mesh.indices.len() / 3) as f64 * p.ratio) as usize * 3;
            let mut error = 0.0f32;
            let indices = meshopt::simplify(
                &mesh.indices,
                &adapter,
                target.max(3),
                p.error.unwrap_or(1.0) as f32,
                meshopt::SimplifyOptions::None,
                Some(&mut error),
            );
            if indices.is_empty() {
                return None;
            }
            let leveled = Mesh {
                lods: vec![(indices, f64::from(error))],
                ..mesh.clone()
            };
            lod::levels(&Arc::new(leveled), hash ^ 0x5052_4f58_5900_0000).pop()
        });
    if let Ok(mut m) = made.lock() {
        m.insert(key, level.clone(), level_bytes(&level));
        m.evict();
    }
    level
}

/// The scene with each item drawn as its choice says ([`lod::resolve`]), each proxy band's mesh
/// made first.
pub fn resolve(scene: &mut Scene, choices: &[Choice]) {
    made(scene);
    lod::resolve(scene, choices);
}

/// Each proxy band's mesh on a mesh without levels, made once for every solid that shares one
/// level of detail.
pub fn made(scene: &mut Scene) {
    // By the shared level of detail's address; each entry holds it, so no address is reused.
    let mut made: HashMap<*const Lod, (Arc<Lod>, Arc<Lod>)> = HashMap::new();
    for s in scene.layers.iter_mut().flat_map(|l| &mut l.solids) {
        let Some(of) = &s.lod else { continue };
        let (Some(p), Some((mesh, hash)), None) = (of.proxy, &of.proxy_source, &of.proxy_mesh)
        else {
            continue;
        };
        let (_, with) = made.entry(Arc::as_ptr(of)).or_insert_with(|| {
            let with = Lod {
                proxy_mesh: proxy_of(mesh, *hash, p),
                ..(**of).clone()
            };
            (of.clone(), Arc::new(with))
        });
        s.lod = Some(with.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas_scene3d::lod::{select, Show};
    use deep_canvas_scene3d::look::Look3;
    use deep_canvas_scene3d::scene::{evaluate, Labels, Solid};
    use serde_json::json;

    fn ball(scene: &Scene) -> &Solid {
        scene.layers[0]
            .solids
            .iter()
            .find(|s| s.id == "ball")
            .expect("the ball")
    }

    #[test]
    fn a_proxy_band_draws_the_simplified_mesh_at_its_ratio() {
        // A 64-segment ball 10 m from the camera under one proxy band.
        let look = Look3::read(&json!({"roles": {"block": "#808080", "ground": "#ffffff"}}))
            .expect("the look reads");
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [320, 240],
            "camera": "cam", "budget": {"class": "work_product"},
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 10], "fov": 40}},
                "ball": {"id": "ball", "kind": "ball@1", "layer": "main", "name": "B", "order": "a1",
                    "params": {"radius": 1, "segments": 64, "paint": {"fill": {"role": "block"}}},
                    "lod": {"bands": [{"below_px": 1000, "show": "proxy", "params": {"ratio": 0.25}}]}},
            }
        });
        let mut s = evaluate(&doc, 0, &look, &mut Labels::new()).expect("the scene evaluates");
        let full = ball(&s).mesh.as_ref().expect("a built mesh").triangles();
        let choices = select(&s);
        assert_eq!(choices[0].bands, vec![Show::Proxy]);
        resolve(&mut s, &choices);
        let drawn = ball(&s).mesh.as_ref().expect("the proxy").triangles();
        assert!(
            drawn > 0 && drawn as f64 <= 0.3 * full as f64,
            "{drawn} of {full} triangles"
        );
    }
}
