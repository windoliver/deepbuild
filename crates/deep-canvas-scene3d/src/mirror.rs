//! Material: mirror (#465): the planar part a material mirrors in, and the view that one extra
//! pass draws from the camera mirrored in that part's plane at t, clipped at the plane.
//!
//! The extra pass draws the scene as it is from a proper camera, the eye, forward and up
//! reflected in the plane and right turned the other way, so lights, shadows and the sky stay
//! the scene's own. That camera's picture is the mirror image flipped about the camera's centre:
//! a point on the plane the view shows at frame px (x, y) shows at (2 × centre x − x, y) in it.
//! It keeps no history, so seeking equals playing.

use std::collections::BTreeSet;

use deep_canvas::camera::Vec3;
use deep_canvas::ops;
use serde_json::Value;

use crate::scene::{Layer3, Refused, Scene, Shape};

/// A view's mirror: the material that carries it, the parts it shades, and its plane.
#[derive(Clone, Debug, PartialEq)]
pub struct Mirror {
    /// The `material@1` item whose `mirror` it is.
    pub material: String,
    /// The solids whose material it is, by ID: where the mirrored picture shows.
    pub parts: BTreeSet<String>,
    /// The planar part it names, whose plane at t [`view`] reads again each frame.
    pub plane: String,
    /// The plane's unit normal, toward the camera, and its offset along it, in m, at evaluation.
    pub normal: Vec3,
    pub offset: f64,
    /// `strength`, 0 to 1: the mirrored picture's share over the part's own shading.
    pub strength: f64,
    /// `blur` in px of the frame, plus what the material's roughness adds.
    pub blur: f64,
}

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The blur in frame px a roughness of 1 adds, so a rough mirror reads frosted.
const PX_PER_ROUGHNESS: f64 = 20.0;

fn refused(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// The view's mirror, from the materials its solids name: the first such material in item order
/// is the view's (at most one per view), and any other draws its fallback, the material without
/// its mirror. `None` when no drawn solid's material carries one.
pub fn find<'a>(
    layers: &[Layer3],
    eye: Vec3,
    get: impl Fn(&str) -> Option<&'a Value>,
) -> Result<Option<Mirror>, Refused> {
    let solids = || layers.iter().flat_map(|l| &l.solids);
    let mut found: Option<(String, &'a Value)> = None;
    let mut parts = BTreeSet::new();
    for s in solids() {
        let owner = s.id.split_once('#').map_or(s.id.as_str(), |(o, _)| o);
        let Some(name) = get(owner)
            .and_then(|i| i.get("material"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let Some(spec) = get(name)
            .and_then(|m| m.pointer("/params/mirror"))
            .filter(|m| m.is_object())
        else {
            continue;
        };
        match &found {
            None => found = Some((name.to_string(), spec)),
            Some((m, _)) if m != name => continue,
            Some(_) => {}
        }
        parts.insert(s.id.clone());
    }
    let Some((material, spec)) = found else {
        return Ok(None);
    };
    let path = |k: &str| format!("items/{material}/params/mirror/{k}");
    let num = |k: &str, default: f64, range: [f64; 2]| -> Result<f64, Refused> {
        match spec.get(k) {
            None | Some(Value::Null) => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= range[0] && *x <= range[1])
                .ok_or_else(|| refused("out_of_range", path(k))),
        }
    };
    let strength = num("strength", 1.0, [0.0, 1.0])?;
    let blur = num("blur", 0.0, [0.0, 64.0])?;
    let plane = spec
        .get("plane")
        .and_then(Value::as_str)
        .ok_or_else(|| refused("bad_input", path("plane")))?;
    let part = solids()
        .find(|s| s.id == plane)
        .ok_or_else(|| refused("ref_unresolved", path("plane")))?;
    let (normal, offset) =
        plane_of(part, eye).ok_or_else(|| refused("out_of_range", path("plane")))?;
    let roughness = get(&material)
        .and_then(|m| m.pointer("/params/roughness"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    Ok(Some(Mirror {
        material,
        parts,
        plane: plane.to_string(),
        normal,
        offset,
        strength,
        blur: blur + roughness * PX_PER_ROUGHNESS,
    }))
}

/// #166: a water's own mirror (Material: water): at strength 1 with no blur, in the plane of its
/// first part, over its parts. `None` when that part isn't planar.
pub fn own(layers: &[Layer3], eye: Vec3, water: &crate::water::Water) -> Option<Mirror> {
    let plane = water.parts.iter().next()?;
    let part = layers
        .iter()
        .flat_map(|l| &l.solids)
        .find(|s| &s.id == plane)?;
    let (normal, offset) = plane_of(part, eye)?;
    Some(Mirror {
        material: water.material.clone(),
        parts: water.parts.clone(),
        plane: plane.clone(),
        normal,
        offset,
        strength: 1.0,
        blur: 0.0,
    })
}

/// A planar part's plane: its thinnest axis, through its face toward `eye`. `None` for a part
/// that isn't planar (its thinnest side over a tenth of the next).
fn plane_of(part: &crate::scene::Solid, eye: Vec3) -> Option<(Vec3, f64)> {
    let m = &part.model;
    let (lo, hi) = match (&part.shape, &part.mesh) {
        (Shape::Built(_), Some(mesh)) => {
            let [lo, hi] = mesh.bounds();
            (lo, hi)
        }
        _ => ([-0.5; 3], [0.5; 3]),
    };
    let axis = |k: usize| [m[0][k], m[1][k], m[2][k]];
    let mut sides: Vec<(f64, usize)> = (0..3)
        .map(|k| (ops::sqrt(dot(axis(k), axis(k))) * (hi[k] - lo[k]), k))
        .collect();
    sides.sort_by(|a, b| a.0.total_cmp(&b.0));
    let (thin, k) = sides[0];
    if thin.is_nan() || thin > 0.1 * sides[1].0 || sides[1].0 <= 0.0 {
        return None;
    }
    // The normal is the inverse transpose's column: the cross of the other two axes.
    let [a, b] = [axis((k + 1) % 3), axis((k + 2) % 3)];
    let n = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let len = ops::sqrt(dot(n, n));
    if len <= 0.0 {
        return None;
    }
    let mut n = n.map(|v| v / len);
    let mid = |c: [f64; 3]| -> Vec3 {
        std::array::from_fn(|r| m[r][0] * c[0] + m[r][1] * c[1] + m[r][2] * c[2] + m[r][3])
    };
    let centre = mid(std::array::from_fn(|c| (lo[c] + hi[c]) / 2.0));
    if dot(
        n,
        [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]],
    ) < 0.0
    {
        n = n.map(|v| -v);
    }
    Some((n, dot(n, centre) + thin / 2.0))
}

/// The scene the mirror's pass draws, at `size` px: the camera mirrored in the plane (see the
/// module's note), clipped at the plane so nothing behind the mirror shows, with no overlays,
/// labels or readouts (a mirror never mirrors them) and without the mirror's own parts. Another
/// mirror in it draws its fallback, since the pass it draws in has no mirror of its own.
pub fn view(scene: &Scene, m: &Mirror, size: [u32; 2]) -> Scene {
    let mut s = scene.clone();
    // The plane where its part stands at t, seen from the eye at t.
    let (n, offset) = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .find(|p| p.id == m.plane)
        .and_then(|p| plane_of(p, scene.camera.eye))
        .unwrap_or((m.normal, m.offset));
    let point = |p: Vec3| {
        let d = 2.0 * (dot(n, p) - offset);
        [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]]
    };
    let vector = |v: Vec3| {
        let d = 2.0 * dot(n, v);
        [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]
    };
    let c = &mut s.camera;
    let k = f64::from(size[0]) / f64::from(scene.size[0]);
    c.eye = point(c.eye);
    c.forward = vector(c.forward);
    c.up = vector(c.up);
    c.right = vector(c.right).map(|v| -v);
    c.roll = [c.roll[0], -c.roll[1]];
    c.size = [f64::from(size[0]), f64::from(size[1])];
    c.scale *= k;
    c.centre = [c.centre[0] * k, c.centre[1] * k];
    s.size = size;
    s.jitter = [s.jitter[0] * k, s.jitter[1] * k];
    s.overlays.clear();
    s.readouts.clear();
    s.motion = None;
    s.velocity = None;
    for layer in &mut s.layers {
        layer.labels.clear();
        layer.solids.retain(|p| !m.parts.contains(&p.id));
    }
    // Nothing behind the plane: the cutaway hides where n·p < offset, beside any planes the
    // scene's own cutaway has when it hides past any of them.
    let clip = (n.map(|v| -v), -offset);
    let cutaway = match scene.cutaway.clone() {
        Some(mut cut)
            if !cut.intersect
                && cut.applies_to.is_none()
                && cut.planes.len() < crate::cut::MAX_PLANES =>
        {
            cut.planes.push(clip);
            cut
        }
        _ => crate::cut::Cutaway {
            id: format!("{}#mirror", m.material),
            planes: vec![clip],
            intersect: false,
            applies_to: None,
            cap: None,
            cap_lit: false,
            shadows_whole: true,
            document: true,
        },
    };
    s.set_cutaway(Some(cutaway));
    s.mirror = None;
    s.read_reflection = false;
    // A flare is the lens's, not the reflection's.
    s.flare = None;
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::label::Labels;
    use crate::look::Look3;
    use serde_json::json;

    /// A point on the plane shows in the mirrored view at (2 × centre x − x, y), scaled to its
    /// size, and a point above the plane shows where its reflection does in the view: what the
    /// composite reads.
    #[test]
    fn the_mirrored_view_shows_the_reflection_flipped_about_the_centre() {
        let look =
            Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [320, 180], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 20, "elevation": 25, "distance": 8}, "fov": 40, "roll": 7}},
                "glass": {"id": "glass", "kind": "material@1", "name": "M", "order": "a1", "layer": "main", "params": {"roughness": 0, "mirror": {"strength": 1, "plane": "floor"}}},
                "floor": {"id": "floor", "kind": "mark.box@1", "name": "F", "order": "b0", "layer": "main", "material": "glass", "params": {"size": [6, 0.02, 6]}, "at": {"pos": [0, -0.01, 0]}},
                "cube": {"id": "cube", "kind": "mark.box@1", "name": "B", "order": "b1", "layer": "main", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 1, 0]}}
            }
        });
        let scene = crate::scene::evaluate(&doc, 0, &look, &mut Labels::new()).unwrap();
        let m = scene.mirror.clone().expect("the floor mirrors");
        assert_eq!(m.parts.iter().collect::<Vec<_>>(), ["floor"]);
        assert!(
            (m.normal[1] - 1.0).abs() < 1e-9 && m.offset.abs() < 1e-9,
            "{m:?}"
        );
        let half = [160, 90];
        let v = view(&scene, &m, half);
        assert!(v
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .all(|s| s.id != "floor"));
        let c = &scene.camera;
        for p in [[0.3, 0.0, -0.7], [1.5, 0.0, 2.0], [-2.0, 0.0, 0.4]] {
            let a = c.project(p).unwrap();
            let b = v.camera.project(p).unwrap();
            assert!(
                (b[0] * 2.0 - (2.0 * c.centre[0] - a[0])).abs() < 1e-6,
                "{p:?}: {a:?} {b:?}"
            );
            assert!((b[1] * 2.0 - a[1]).abs() < 1e-6, "{p:?}: {a:?} {b:?}");
        }
        // The cube's top at y 1.5 shows in the mirror where (x, −1.5, z) is behind the floor.
        let top = [0.2, 1.5, 0.1];
        let seen = c.project([0.2, -1.5, 0.1]).unwrap();
        let b = v.camera.project(top).unwrap();
        assert!(
            (b[0] * 2.0 - (2.0 * c.centre[0] - seen[0])).abs() < 1e-6
                && (b[1] * 2.0 - seen[1]).abs() < 1e-6
        );
    }
}
