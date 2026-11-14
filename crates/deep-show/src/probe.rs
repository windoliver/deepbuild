//! Issue #1401: render-back of a 3D revision, and its pixel probes (canvas primitives:
//! Render-back, `camera` and `probes`; Selection, `hit`). The revision is drawn on the GPU at the
//! requested `t` through the requested camera, or its own; a probe asks what lies under one pixel
//! of that offscreen copy. The object-ID pass says whether the frame drew a surface there, and a
//! CPU ray in f64 through the pixel's centre on the evaluated triangles says what and where
//! (`hit::through`), never a depth reading. A hit on another writer's layer answers
//! `ref_unresolved` and no position. Like all of render-back, display only, never evidence.

use deep_canvas::show::{Writer, WriterKind};
use deep_canvas_scene3d::hit::{self, Hit};
use deep_canvas_scene3d::scene::Camera;
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted};
use crate::refused;
use crate::scene3d::Targets;

/// A render-back's `camera` (a camera item's ID) and `probes` (view px, x right and y down).
#[derive(Default)]
pub struct Probes {
    pub camera: Option<String>,
    pub at: Vec<[u32; 2]>,
    /// #1725: a contact sheet of named views, each drawn through a camera framing the scene.
    pub views: Vec<&'static str>,
}

/// The named views a contact sheet takes, each an orbit's azimuth and elevation in degrees about
/// the scene's bounds: front looks along -Z, right along -X, top straight down.
const VIEWS: [(&str, [f64; 2]); 6] = [
    ("front", [0.0, 0.0]),
    ("back", [180.0, 0.0]),
    ("left", [-90.0, 0.0]),
    ("right", [90.0, 0.0]),
    ("top", [0.0, 90.0]),
    ("three_quarter", [45.0, 30.0]),
];

/// A view's field of view, degrees, and how far past the bounds' sphere its frame reaches.
const VIEW_FOV: f64 = 40.0;
const VIEW_PAD: f64 = 1.1;

/// The most probes one render-back answers (Render-back: `probes ≤ 64`).
const MOST: usize = 64;

/// A render-back call's `camera` and `probes`; `None` when either is malformed or past 64 probes.
pub fn parse(c: &Map<String, Value>) -> Option<Probes> {
    let camera = crate::optional(c.get("camera"), |v| Some(v.as_str()?.to_string()))?;
    let px = |v: &Value| u32::try_from(v.as_u64()?).ok();
    let at = crate::optional(c.get("probes"), |v| {
        let list = v.as_array().filter(|l| l.len() <= MOST)?;
        list.iter()
            .map(|p| match p.as_array()?.as_slice() {
                [x, y] => Some([px(x)?, px(y)?]),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
    })?
    .unwrap_or_default();
    let views = crate::optional(c.get("sheet"), |s| {
        let list = s.get("views")?.as_array().filter(|l| !l.is_empty())?;
        list.iter()
            .map(|n| {
                VIEWS
                    .iter()
                    .find(|(name, _)| Some(*name) == n.as_str())
                    .map(|(name, _)| *name)
            })
            .collect::<Option<Vec<_>>>()
    })?
    .unwrap_or_default();
    Some(Probes { camera, at, views })
}

/// Whether a revision draws in 3D: it holds a 3D writer layer, or requires scene3d, as one of
/// glTF meshes does.
pub fn draws_3d(doc: &Value) -> bool {
    deep_canvas_scene3d::scene::has_3d(doc) || doc.pointer("/requires/modules/scene3d").is_some()
}

impl Hub<'_> {
    /// Render-back of a 3D revision `shown` at `t` for `session`: drawn on the GPU through
    /// `probes.camera` or its own camera, its snapshot kept by hash, and with probes, `hits`: one
    /// list a probe, nearest first.
    pub(crate) fn render_back_3d(
        &mut self,
        session: &str,
        rev: u64,
        shown: &Value,
        t: i64,
        size: Option<[u16; 2]>,
        probes: &Probes,
    ) -> Value {
        if !probes.views.is_empty() {
            // A sheet of views draws through its own cameras: a camera or probes beside it ask
            // about one frame it doesn't draw.
            if probes.camera.is_some() || !probes.at.is_empty() {
                return json!({"code": "out_of_range", "path": "sheet"});
            }
            return self.view_sheet(rev, shown, t, size, &probes.views);
        }
        let mut doc = shown.clone();
        if let Some(cam) = &probes.camera {
            let kind = doc
                .get("items")
                .and_then(|i| i.get(cam))
                .and_then(|c| c.get("kind"));
            if kind != Some(&json!("camera@1")) {
                return json!({"code": "ref_unresolved", "path": "camera"});
            }
            doc["camera"] = json!(cam);
        }
        // #493: a shot writes the camera's pose the frame is drawn through.
        let doc = crate::film::posed(&doc, t).unwrap_or(doc);
        let size = size.unwrap_or_else(|| {
            crate::snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)))
        });
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let palette = self.look.light.clone();
        let planted = self.scenario.planted;
        let Some(gpu) = self.gpu3() else {
            return refused("unsupported_platform");
        };
        let (scene, look) = match gpu.evaluate(&doc, t, &palette, size, &read) {
            Ok(s) => s,
            Err(u) => return json!({"code": u.code, "path": u.path}),
        };
        let depth = planted == Some(Planted::ProbeFromDepth);
        let Some((rgba, targets)) = gpu.draw_scene(&scene, &look, depth) else {
            return refused("unsupported_platform");
        };
        let light = self.light3d(&doc, t);
        let png = crate::snapshot::png(rgba, size);
        let Ok(sha) = crate::evidence::put(&self.scenario.evidence, &png) else {
            return refused("not_written");
        };
        let mut snapshot = json!({"sha256": sha, "w": size[0], "h": size[1]});
        if let Some(l) = light {
            snapshot["light"] = l;
        }
        let mut reply = json!({
            "rev": rev, "t": t, "outcome": "presented",
            "snapshots": [snapshot],
            "backends": crate::seams::backends(true),
        });
        if probes.at.is_empty() {
            return reply;
        }
        let frame = size.map(u32::from);
        let centre = |p: [u32; 2]| p.map(|v| f64::from(v) + 0.5);
        let ats: Vec<([f64; 2], bool)> = probes
            .at
            .iter()
            .map(|p| (centre(*p), targets.pick(*p, frame).is_some()))
            .collect();
        let mut lists = hit::through(&scene, &ats);
        for (list, p) in lists.iter_mut().zip(&probes.at) {
            match planted {
                Some(Planted::ProbeFromDepth) => {
                    from_depth(list, &scene.camera, &targets, *p, frame)
                }
                Some(Planted::ProbeNearestItem) if list.is_empty() => {
                    list.extend(nearest_item(&scene, &targets, *p, frame));
                }
                _ => {}
            }
        }
        let thread = &self.scenario.sessions[session].thread;
        let caller = Writer {
            kind: WriterKind::Agent,
            id: thread.clone(),
        }
        .text();
        reply["hits"] = lists
            .iter()
            .map(|l| {
                l.iter()
                    .map(|h| entry(h, &doc, &caller))
                    .collect::<Vec<_>>()
            })
            .collect();
        reply
    }
}

impl Hub<'_> {
    /// #1725: a contact sheet of named views of a 3D revision `shown` at `t`, from one call: each
    /// view drawn through a camera of its own that orbits the centre of the scene's world bounds
    /// at the view's azimuth and elevation and frames their sphere, with its own snapshot by hash
    /// and its own visible table. Display only, like all of render-back.
    fn view_sheet(
        &mut self,
        rev: u64,
        shown: &Value,
        t: i64,
        size: Option<[u16; 2]>,
        views: &[&'static str],
    ) -> Value {
        const CAMERA: &str = "view.sheet.camera";
        let size = size.unwrap_or_else(|| {
            crate::snapshot::px([0, 1].map(|i| shown["size"][i].as_f64().unwrap_or(1.0)))
        });
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let palette = self.look.light.clone();
        let Some(gpu) = self.gpu3() else {
            return refused("unsupported_platform");
        };
        // The scene's world bounds, from what it draws through its own camera.
        let (scene, _) = match gpu.evaluate(shown, t, &palette, size, &read) {
            Ok(s) => s,
            Err(u) => return json!({"code": u.code, "path": u.path}),
        };
        let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .flat_map(|s| s.points())
        {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        if !lo[0].is_finite() {
            (lo, hi) = ([-0.5; 3], [0.5; 3]);
        }
        let centre: [f64; 3] = std::array::from_fn(|k| (lo[k] + hi[k]) / 2.0);
        use deep_canvas::ops::{atan, rad, sin, sqrt, tan};
        let radius = sqrt(
            (0..3)
                .map(|k| (hi[k] - lo[k]) / 2.0)
                .map(|h| h * h)
                .sum::<f64>(),
        )
        .max(0.01);
        // The field of view spans the wider side; the sphere fits the narrower one's.
        let (w, h) = (f64::from(size[0]), f64::from(size[1]));
        let half = atan(w.min(h) / w.max(h) * tan(rad(VIEW_FOV) / 2.0));
        let distance = radius * VIEW_PAD / sin(half);
        let mut snapshots = Vec::new();
        for view in views {
            let [azimuth, elevation] = VIEWS
                .iter()
                .find(|(n, _)| n == view)
                .map_or([0.0; 2], |v| v.1);
            let mut doc = shown.clone();
            doc["camera"] = json!(CAMERA);
            doc["items"][CAMERA] = json!({"id": CAMERA, "kind": "camera@1", "name": "View", "order": "zz",
                "params": {"target": centre, "fov": VIEW_FOV,
                           "orbit": {"azimuth": azimuth, "elevation": elevation, "distance": distance}}});
            let Some(gpu) = self.gpu3() else {
                return refused("unsupported_platform");
            };
            let (scene, look) = match gpu.evaluate(&doc, t, &palette, size, &read) {
                Ok(s) => s,
                Err(u) => return json!({"code": u.code, "path": u.path, "view": view}),
            };
            let Some((rgba, _)) = gpu.draw_scene(&scene, &look, false) else {
                return refused("unsupported_platform");
            };
            let png = crate::snapshot::png(rgba, size);
            let Ok(sha) = crate::evidence::put(&self.scenario.evidence, &png) else {
                return refused("not_written");
            };
            snapshots.push(
                json!({"view": view, "sha256": sha, "w": size[0], "h": size[1],
                                  "visible": crate::snapshot::visible(scene.boxes(), 1.0, size)}),
            );
        }
        json!({"rev": rev, "t": t, "outcome": "presented", "snapshots": snapshots,
               "backends": crate::seams::backends(true)})
    }
}

impl Targets {
    /// The pick the object-ID pass drew at frame px `p` of a frame `frame` px, `None` where it
    /// drew no surface.
    fn pick(&self, p: [u32; 2], frame: [u32; 2]) -> Option<u32> {
        let [x, y] = self.at(p, frame);
        let i = (y * self.size[0] + x) as usize * 4;
        let v = u32::from_le_bytes(self.ids.get(i..i + 4)?.try_into().ok()?);
        (v != 0).then_some(v)
    }

    /// The targets' px under the centre of frame px `p`, below internal scale 1 too.
    fn at(&self, p: [u32; 2], frame: [u32; 2]) -> [u32; 2] {
        std::array::from_fn(|k| {
            let v = (f64::from(p[k]) + 0.5) * f64::from(self.size[k]) / f64::from(frame[k]);
            (v as u32).min(self.size[k] - 1)
        })
    }
}

/// One hit as the caller reads it: the item, its sub-address, the point, the normal and the
/// distance; on a layer another writer writes, `ref_unresolved` and no position.
fn entry(h: &Hit, doc: &Value, caller: &str) -> Value {
    let layer = doc
        .get("items")
        .and_then(|i| i.get(&h.item))
        .and_then(|i| i.get("layer"));
    let writer = layer
        .and_then(Value::as_str)
        .and_then(|l| doc.get("layers")?.get(l)?.get("writer")?.as_str());
    if writer.is_some_and(|w| w != caller) {
        return json!({"code": "ref_unresolved"});
    }
    json!({"item": h.item, "sub": h.sub, "point": h.point, "normal": h.normal, "distance": h.distance})
}

/// #1401's planted depth reader: each hit put back where the probe's ray reaches the view depth
/// the depth target holds at its pixel, as a probe must never be.
fn from_depth(list: &mut [Hit], cam: &Camera, targets: &Targets, p: [u32; 2], frame: [u32; 2]) {
    let [x, y] = targets.at(p, frame);
    let i = (y * targets.size[0] + x) as usize * 4;
    let Some(z) = targets.view_depth.as_ref().and_then(|d| d.get(i..i + 4)) else {
        return;
    };
    let vz = f64::from(f32::from_le_bytes([z[0], z[1], z[2], z[3]]));
    let at = p.map(|v| f64::from(v) + 0.5);
    let point = cam.unproject(at[0], at[1], vz);
    let o = if cam.perspective {
        cam.eye
    } else {
        cam.unproject(at[0], at[1], 0.0)
    };
    for h in list {
        h.point = point;
        h.distance = (0..3)
            .map(|k| (point[k] - o[k]).powi(2))
            .sum::<f64>()
            .sqrt();
    }
}

/// #1401's planted nearest-item probe: a probe that meets nothing answers the item drawn
/// nearest its pixel, as a probe must never.
fn nearest_item(
    scene: &deep_canvas_scene3d::scene::Scene,
    targets: &Targets,
    p: [u32; 2],
    frame: [u32; 2],
) -> Option<Hit> {
    let [cx, cy] = targets.at(p, frame).map(i64::from);
    let [w, h] = targets.size;
    let (_, at) = (0..h)
        .flat_map(|y| (0..w).map(move |x| [x, y]))
        .filter(|q| targets.pick(*q, targets.size).is_some())
        .map(|[x, y]| {
            (
                (i64::from(x) - cx).pow(2) + (i64::from(y) - cy).pow(2),
                [x, y],
            )
        })
        .min()?;
    let id = targets.picks.get(&targets.pick(at, targets.size)?)?;
    let centre: [f64; 2] = std::array::from_fn(|k| {
        (f64::from(at[k]) + 0.5) * f64::from(frame[k]) / f64::from(targets.size[k])
    });
    hit::hits(scene, centre, &[id.as_str()])
        .into_iter()
        .next()
        .or(Some(Hit {
            item: id.split('#').next().unwrap_or(id).to_string(),
            sub: None,
            point: [0.0; 3],
            normal: [0.0, 0.0, 1.0],
            distance: 0.0,
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(probes: usize) -> Map<String, Value> {
        let at: Vec<Value> = (0..probes).map(|k| json!([k, 2 * k])).collect();
        json!({"call": "render_back", "camera": "cam", "probes": at})
            .as_object()
            .unwrap()
            .clone()
    }

    /// #1401: a render-back takes up to 64 probes, each a pixel `[x, y]`, and refuses more.
    #[test]
    fn a_render_back_takes_up_to_64_probes() {
        let p = parse(&call(64)).unwrap();
        assert_eq!(p.camera.as_deref(), Some("cam"));
        assert_eq!(p.at.len(), 64);
        assert_eq!(p.at[3], [3, 6]);
        assert!(parse(&call(65)).is_none());
    }
}
