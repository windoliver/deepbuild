//! Views of one document (#506): what a view inset draws from its own camera inside the frame,
//! one level deep. A nested view keeps its own view state: it is drawn from the scene before its
//! levels of detail were resolved at the main camera, with no light cut carried over, so its
//! levels, light cut, backdrop copy and mirror are its own, never the main view's from the same
//! frame.

use std::collections::BTreeSet;

use deep_canvas::camera::Vec3;

use serde_json::Value;

use crate::scene::{Affine3, Camera, Refused, Scene};

/// The view overlay's kind: this document from another camera in a rect of the frame.
pub const KIND: &str = "overlay.view@1";

/// A view inset at t: the window quad its picture draws on (a solid with the inset's ID), the
/// camera it draws from at `size` (an eye inset's follows the viewing camera instead), the items
/// it draws and, for an eye inset, the window's plane in the place it looks out of, which
/// nothing in front of draws.
#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub id: String,
    pub camera: Camera,
    pub size: [u32; 2],
    /// The items it draws by ID (`include` less `exclude`, their parts and children), or all.
    pub keep: Option<BTreeSet<String>>,
    /// `map: eye`: its camera follows the viewing camera's eye and its picture is drawn at the
    /// frame's own pixels; the face's outward normal and offset, moved through `through`.
    pub eye: Option<Eye>,
}

/// An eye inset's moving parts: the transform taking the inset's face to `through` (identity
/// without one) and the plane of the window there, normal out of the face.
#[derive(Clone, Debug, PartialEq)]
pub struct Eye {
    pub by: Affine3,
    pub plane: (Vec3, f64),
}

/// A view overlay placed in a frame of `size` px: its camera, its rect `[x, y, w, h]` px, and its
/// border's color.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub id: String,
    pub camera: String,
    pub rect: [u32; 4],
    pub border: [u8; 3],
}

/// Each view overlay of `doc` in a frame of `size` px: `size` a share of the safe frame's width
/// and height, in its bottom-right corner (Overlay: `overlay.view@1`), its border in its role.
pub fn placed(doc: &Value, size: [u32; 2], look: Option<&crate::look::Look3>) -> Result<Vec<Placed>, Refused> {
    let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0).max(0.0);
    let mut out = Vec::new();
    for (id, item) in doc.get("items").and_then(Value::as_object).into_iter().flatten() {
        if item.get("kind").and_then(Value::as_str) != Some(KIND) {
            continue;
        }
        let path = format!("items/{id}/params");
        let p = item.get("params").cloned().unwrap_or(Value::Null);
        let Some(camera) = p.get("camera").and_then(Value::as_str) else {
            return Err(Refused { code: "bad_input", path: format!("{path}/camera") });
        };
        let share = match p.get("size").and_then(Value::as_array).map(Vec::as_slice) {
            None => [0.3, 0.3],
            Some([w, h]) => match (w.as_f64(), h.as_f64()) {
                (Some(w), Some(h)) if w > 0.0 && w <= 1.0 && h > 0.0 && h <= 1.0 => [w, h],
                _ => return Err(Refused { code: "out_of_range", path: format!("{path}/size") }),
            },
            _ => return Err(Refused { code: "out_of_range", path: format!("{path}/size") }),
        };
        let (fw, fh) = (f64::from(size[0]) - 2.0 * safe, f64::from(size[1]) - 2.0 * safe);
        let w = (share[0] * fw).round().max(1.0);
        let h = (share[1] * fh).round().max(1.0);
        let x = (f64::from(size[0]) - safe - w).max(0.0);
        let y = (f64::from(size[1]) - safe - h).max(0.0);
        let role = p.get("border").and_then(Value::as_str).unwrap_or("ink");
        out.push(Placed {
            id: id.clone(),
            camera: camera.to_string(),
            rect: [x as u32, y as u32, w as u32, h as u32],
            border: look.and_then(|l| l.role(role)).unwrap_or([0, 0, 0]),
        });
    }
    Ok(out)
}

/// Lays `picture` (the view's frame at its rect's size, 4 bytes a pixel) over `frame` (`size`
/// px, the same byte order) in `view`'s rect, with a 1 px border of `border` just outside it.
pub fn lay(view: &Placed, picture: &[u8], frame: &mut [u8], size: [u32; 2], border: [u8; 4]) {
    let [fw, fh] = size.map(i64::from);
    let [x0, y0, w, h] = view.rect.map(i64::from);
    let mut put = |x: i64, y: i64, px: &[u8]| {
        if (0..fw).contains(&x) && (0..fh).contains(&y) {
            let o = ((y * fw + x) * 4) as usize;
            frame[o..o + 4].copy_from_slice(px);
        }
    };
    for y in 0..h {
        for x in 0..w {
            let o = ((y * w + x) * 4) as usize;
            if let Some(p) = picture.get(o..o + 4) {
                put(x0 + x, y0 + y, p);
            }
        }
    }
    for x in x0 - 1..=x0 + w {
        put(x, y0 - 1, &border);
        put(x, y0 + h, &border);
    }
    for y in y0..y0 + h {
        put(x0 - 1, y, &border);
        put(x0 + w, y, &border);
    }
}

/// The document a view overlay draws: `doc` from `camera`, every view overlay taken out (one
/// level deep), and of what draws only what its `include` keeps (all, with none) less `exclude`.
pub fn document(doc: &Value, view: &Placed) -> Value {
    let mut out = doc.clone();
    let params = doc.pointer(&format!("/items/{}/params", view.id)).cloned().unwrap_or(Value::Null);
    let map = doc.as_object().cloned().unwrap_or_default();
    let keep = crate::inset::kept_view(&map, &params);
    if let Some(o) = out.as_object_mut() {
        o.insert("camera".into(), Value::String(view.camera.clone()));
        if let Some(items) = o.get_mut("items").and_then(Value::as_object_mut) {
            items.retain(|id, item| {
                let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
                let draws = crate::scene::is_3d(kind) || kind.starts_with("light.") || kind == "sky@1";
                kind != KIND && (!draws || keep.as_ref().is_none_or(|k| k.contains(id)))
            });
        }
    }
    out
}

/// An `overlay.frame@1`'s 2D frame: the overlay, the frame's top left corner in its own px, and
/// the frame with every item inside it, which draw only through the overlay.
#[derive(Clone, Debug, PartialEq)]
pub struct Framed {
    pub overlay: String,
    pub corner: [f64; 2],
    pub items: std::collections::BTreeSet<String>,
}

/// Each overlay frame of `doc` (#506): what a host draws on top of the scene at the overlay's
/// place, and never where the frame stands.
pub fn framed(doc: &Value) -> Vec<Framed> {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some(crate::scene::OVERLAY) {
            continue;
        }
        let Some(frame) = item.pointer("/params/frame").and_then(Value::as_str) else {
            continue;
        };
        let corner = items
            .get(frame)
            .and_then(|f| f.pointer("/params/box"))
            .and_then(Value::as_array)
            .map_or([0.0; 2], |b| [0, 1].map(|k| b.get(k).and_then(Value::as_f64).unwrap_or(0.0)));
        let mut held = BTreeSet::from([frame.to_string()]);
        loop {
            let more: Vec<String> = items
                .iter()
                .filter(|(c, i)| {
                    !held.contains(*c)
                        && i.get("parent").and_then(Value::as_str).is_some_and(|p| held.contains(p))
                })
                .map(|(c, _)| c.clone())
                .collect();
            if more.is_empty() {
                break;
            }
            held.extend(more);
        }
        out.push(Framed {
            overlay: id.clone(),
            corner,
            items: held,
        });
    }
    out
}

fn owner(id: &str) -> &str {
    id.split_once('#').map_or(id, |(o, _)| o)
}

/// The viewing camera moved rigidly by `by`: its eye and axes carried, its lens, size and
/// planes kept, so a ray through any frame px is the same ray in the moved place.
pub fn moved(camera: &Camera, by: &Affine3) -> Camera {
    let apply = |p: Vec3| -> Vec3 {
        std::array::from_fn(|r| by[r][0] * p[0] + by[r][1] * p[1] + by[r][2] * p[2] + by[r][3])
    };
    let turn = |v: Vec3| -> Vec3 {
        std::array::from_fn(|r| by[r][0] * v[0] + by[r][1] * v[1] + by[r][2] * v[2])
    };
    Camera {
        eye: apply(camera.eye),
        right: turn(camera.right),
        up: turn(camera.up),
        forward: turn(camera.forward),
        ..camera.clone()
    }
}

/// Hides what lies past `plane` (n·p > offset) in `s`, beside its own cutaway's planes when they
/// hide past any of them; `id` names a cutaway made for it.
pub fn clip(s: &mut Scene, plane: (Vec3, f64), id: String) {
    let cutaway = match s.cutaway.clone() {
        Some(mut cut)
            if !cut.intersect
                && cut.applies_to.is_none()
                && cut.planes.len() < crate::cut::MAX_PLANES =>
        {
            cut.planes.push(plane);
            cut
        }
        _ => crate::cut::Cutaway {
            id,
            planes: vec![plane],
            intersect: false,
            applies_to: None,
            cap: None,
            cap_lit: false,
            shadows_whole: true,
            document: true,
        },
    };
    s.set_cutaway(Some(cutaway));
}

/// The scene view `v` draws: `scene` from its camera at its size, with the main view's levels
/// unresolved and no light cut carried over, no overlays, readouts, motion or flare, no view
/// inset's window (one level deep), only the items it keeps, and an eye inset clipped at its
/// window.
pub fn seen(scene: &Scene, v: &View) -> Scene {
    let mut s = scene.clone();
    if let Some(sources) = &scene.sources {
        s.layers = sources.as_ref().clone();
    }
    s.sources = None;
    let windows: BTreeSet<&str> = scene.views.iter().map(|w| w.id.as_str()).collect();
    let keeps = |id: &str| {
        !windows.contains(owner(id)) && v.keep.as_ref().is_none_or(|k| k.contains(owner(id)))
    };
    for layer in &mut s.layers {
        layer.solids.retain(|x| keeps(&x.id));
        layer.lines.retain(|x| keeps(&x.id));
        layer.points.retain(|x| keeps(&x.id));
        layer.labels.retain(|x| keeps(&x.id));
        layer.puffs.retain(|x| keeps(&x.id));
    }
    // An eye inset's view follows the viewing camera as it is now, at the frame's own size.
    let (camera, size) = match &v.eye {
        Some(e) => (moved(&scene.camera, &e.by), scene.size),
        None => (v.camera.clone(), v.size),
    };
    let k = f64::from(size[0]) / f64::from(scene.size[0].max(1));
    s.camera = camera;
    s.size = size;
    s.jitter = [s.jitter[0] * k, s.jitter[1] * k];
    s.views.clear();
    s.light_cut = None;
    s.overlays.clear();
    s.readouts.clear();
    s.motion = None;
    s.velocity = None;
    s.flare = None;
    s.read_reflection = false;
    s.read_foam = false;
    if let Some(e) = &v.eye {
        clip(&mut s, e.plane, format!("{}#window", v.id));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn camera() -> Camera {
        Camera {
            size: [320.0, 180.0],
            eye: [1.0, 0.5, 4.0],
            right: [1.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            forward: [0.0, 0.0, -1.0],
            perspective: true,
            scale: 400.0,
            centre: [160.0, 90.0],
            roll: [1.0, 0.0],
            near: 0.1,
            far: 100.0,
        }
    }

    /// A camera moved by a turn of 90° about y and a shift to x = 10 shows a point moved the same
    /// way at the same px as the viewing camera shows the point.
    #[test]
    fn a_moved_camera_shows_moved_points_where_the_viewer_shows_the_points() {
        let by = [
            [0.0, 0.0, 1.0, 10.0],
            [0.0, 1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0, 0.0],
        ];
        let c = camera();
        let m = moved(&c, &by);
        for p in [[0.0, 0.0, -3.0], [0.4, -0.2, -1.5], [-1.0, 1.0, 0.5]] {
            let q = std::array::from_fn(|r| by[r][0] * p[0] + by[r][1] * p[1] + by[r][2] * p[2] + by[r][3]);
            let a = c.project(p).unwrap();
            let b = m.project(q).unwrap();
            assert!((0..3).all(|k| (a[k] - b[k]).abs() < 1e-9), "{a:?} {b:?}");
        }
    }
}
