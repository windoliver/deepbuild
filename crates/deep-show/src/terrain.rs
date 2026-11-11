//! `terrain_rays` (#2014; the #2014 acceptance README: The new call): rays met by a terrain plate
//! at 0 s three ways. `drawn` meets the triangles the plate's builder made, in f64; `physics` meets
//! the plate's own height-field shape (Shape: `heightfield`, on its samples) through the physics
//! backend interface's ray query on the pinned backend; and `pick` is the ground point a point
//! control writes for that ray, the plate's samples met as the two triangles per cell its
//! height-field collision uses, rounded to 1/1024 m (Control: point).

use deep_canvas::heights::{meet, Heights};
use deep_canvas_physics::backend::Backend;
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_scene3d::scene::Affine3;
use deep_canvas_scene3d::{build, stack, terrain};
use deep_physics_rapier::Rapier;
use serde_json::{json, Map, Value};

use crate::hub::Hub;

type V3 = [f64; 3];

#[derive(Debug)]
pub struct TerrainRays {
    pub doc: String,
    pub item: String,
    pub rays: Vec<(V3, V3)>,
}

fn v3(v: &Value) -> Option<V3> {
    let a = v.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

pub fn parse(c: &Map<String, Value>) -> Option<TerrainRays> {
    Some(TerrainRays {
        doc: c.get("doc")?.as_str()?.to_string(),
        item: c.get("item")?.as_str()?.to_string(),
        rays: c
            .get("rays")?
            .as_array()?
            .iter()
            .map(|r| Some((v3(r.get("from")?)?, v3(r.get("dir")?)?)))
            .collect::<Option<_>>()?,
    })
}

/// The farthest a ray reaches, m.
const REACH: f64 = 1e7;

/// `p` placed by `m`.
fn apply(m: &Affine3, p: V3) -> V3 {
    [0, 1, 2].map(|i| m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3])
}

fn along(o: V3, d: V3, k: f64) -> V3 {
    [o[0] + d[0] * k, o[1] + d[1] * k, o[2] + d[2] * k]
}

/// The plate's surface as one static body holding its height-field shape, built on the pinned
/// backend; `None` when the backend refuses it.
fn collision(t: &terrain::Terrain, centre: V3) -> Option<Rapier> {
    let world = json!({
        "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1, "gravity": [0, 0, 0],
        "mode": "dynamic", "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0}, "backend": {"name": RAPIER3D.backend, "version": format!("={}", RAPIER3D.version)},
        "shapes": {"terrain": {"kind": "heightfield", "cols": t.cols, "rows": t.rows, "heights": t.h, "scale": [t.size[0], 1, t.size[1]]}},
        "bodies": {"ground": {"kind": "static", "shapes": [{"shape": "terrain"}], "pose": {"pos": centre}}}
    });
    let w =
        deep_canvas_physics::check::check(&world, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
            .ok()?;
    let mut b = Rapier::default();
    b.build(&w).ok()?;
    Some(b)
}

impl Hub<'_> {
    pub(crate) fn terrain_rays(&mut self, r: &TerrainRays) -> Value {
        let Some(doc) = self
            .sessions
            .get(&r.doc)
            .and_then(|s| s.document().cloned())
        else {
            return json!({"code": "no_revision"});
        };
        let Some(item) = doc.pointer(&format!("/items/{}", r.item)) else {
            return json!({"code": "ref_unresolved", "path": format!("items/{}", r.item)});
        };
        let m: Affine3 = deep_canvas_scene3d::scene::placed_at(&doc, 0)
            .ok()
            .and_then(|p| {
                p.into_iter()
                    .find(|(id, ..)| *id == r.item)
                    .map(|(.., m)| m)
            })
            .unwrap_or([
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
            ]);
        let run = stack::Run {
            planted: self.scenario.module_planted.clone(),
            outlines: self.startup.sealed.outlines.clone(),
            ..Default::default()
        };
        let built = match build::built(&doc, &r.item, item, &run, 0.0) {
            Ok(b) => b,
            Err(path) => {
                return json!({"code": "out_of_range", "path": format!("items/{}/{path}", r.item)})
            }
        };
        let tris: Vec<[V3; 3]> = built.mesh.as_ref().map_or_else(Vec::new, |mesh| {
            mesh.indices
                .chunks(3)
                .map(|t| [0, 1, 2].map(|k| apply(&m, mesh.positions[t[k] as usize])))
                .collect()
        });
        let centre = apply(&m, [0.0; 3]);
        let plate = item
            .get("params")
            .filter(|p| terrain::of_params(p).is_some())
            .and_then(|p| terrain::build(p, false).ok());
        let surface: Option<Heights> = plate.as_ref().map(|t| t.heights(centre));
        let physics = plate.as_ref().and_then(|t| collision(t, centre));
        let rays: Vec<Value> = r
            .rays
            .iter()
            .map(|&(o, d)| {
                let drawn = tris
                    .iter()
                    .filter_map(|t| meet(o, d, t))
                    .min_by(f64::total_cmp)
                    .map(|k| along(o, d, k));
                let hit = physics
                    .as_ref()
                    .and_then(|b| b.ray(o, d, REACH))
                    .map(|k| along(o, d, k));
                let pick = surface
                    .as_ref()
                    .and_then(|s| s.ray(o, d))
                    .map(|(k, _)| along(o, d, k).map(|x| (x * 1024.0).round() / 1024.0));
                json!({"drawn": drawn, "physics": hit, "pick": pick})
            })
            .collect();
        let shape = plate.map(|t| json!({"kind": "heightfield", "samples": [t.cols, t.rows]}));
        json!({"shape": shape, "rays": rays})
    }
}
