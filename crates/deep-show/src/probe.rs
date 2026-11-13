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
}

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
    Some(Probes { camera, at })
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
        let png = crate::snapshot::png(rgba, size);
        let Ok(sha) = crate::evidence::put(&self.scenario.evidence, &png) else {
            return refused("not_written");
        };
        let mut reply = json!({
            "rev": rev, "t": t, "outcome": "presented",
            "snapshots": [{"sha256": sha, "w": size[0], "h": size[1]}],
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
