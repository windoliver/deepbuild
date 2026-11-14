//! #1938: the frames a pixel check reads (canvas primitives: Check input: loop kinds), drawn as
//! render-back draws the revision: a 3D one on this machine's GPU, a 2D one by the CPU raster.
//! Pixels hold on the machine that drew them, so each draw carries the run's environment
//! fingerprint, which a verdict read on another machine compares (`against`); one drawn on a
//! software adapter decides nothing and reads INCONCLUSIVE; with no GPU, or a revision that
//! won't draw, the check is BLOCKED, never passed.

use std::collections::BTreeMap;

use deep_canvas::registry::Frame;
use serde_json::{json, Value};

use crate::hub::{Claim, Hub, Planted};

/// What a pixel check reads on one deliverable.
pub(crate) enum Drawn {
    /// The frames, and the fingerprint of the environment that drew them.
    Frames(Vec<Frame>, String),
    /// Unrun: the row is BLOCKED.
    Blocked(Value),
    /// Pixels that hold on no machine a check can name: the row is INCONCLUSIVE.
    Elsewhere(Value),
}

/// The times a check input's `at_times` names, in flicks, else the start.
fn times(input: &Value) -> Vec<i64> {
    let named: Vec<i64> = input["at_times"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| t.as_str().and_then(crate::hub::flicks).or_else(|| t.as_i64()))
        .collect();
    if named.is_empty() {
        vec![0]
    } else {
        named
    }
}

/// Linear RGB of straight sRGB-encoded RGBA, alpha 1.
fn linear(rgba: &[u8]) -> Vec<f32> {
    let lut: Vec<f32> = (0..256)
        .map(|c| deep_canvas::color::srgb_decode(f64::from(c) / 255.0) as f32)
        .collect();
    rgba.chunks_exact(4)
        .flat_map(|p| [lut[p[0] as usize], lut[p[1] as usize], lut[p[2] as usize], 1.0])
        .collect()
}

/// An object-ID target's bytes as each px's pick.
fn ids_of(bytes: &[u8]) -> Vec<u32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
        .collect()
}

impl Hub<'_> {
    /// #1939: the light of `doc`'s kept subject in the 3D frame just drawn of it at `t` and
    /// `size`, read by render.exposure's own measure: `{clipped, crushed, key_ev}`, readings that
    /// pass or fail nothing; `None` where it keeps no subject, or the frame shows none of it.
    pub(crate) fn light3d(&mut self, doc: &Value, t: i64, size: Option<[u16; 2]>) -> Option<Value> {
        let posed = crate::film::posed(doc, t);
        let doc = posed.as_ref().unwrap_or(doc);
        let size = size.unwrap_or_else(|| {
            crate::snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)))
        });
        let exposure = crate::scene3d::look_of(doc, &self.look.light).exposure;
        let whole = self.scenario.planted == Some(Planted::LightFromWholeFrame);
        let gpu = self.gpu3()?;
        // Nothing is read back for a frame that draws none of the subject.
        let subject = deep_canvas_loop::exposure::kept_drawn(doc, &gpu.picks())?;
        let targets = gpu.targets(size.map(u32::from), false)?;
        let frame = Frame {
            t,
            size: targets.size,
            linear: Vec::new(),
            exposure,
            rgba: Vec::new(),
            ids: ids_of(&targets.ids),
            picks: targets.picks,
            roles: BTreeMap::new(),
        };
        // The check's own px and measure, the subject's px alone read and in the check's order.
        let at: Vec<usize> = if whole {
            (0..frame.ids.len()).collect()
        } else {
            let px = deep_canvas_loop::exposure::subject_px(&frame, &subject);
            px.iter()
                .enumerate()
                .filter_map(|(i, s)| s.then_some(i))
                .collect()
        };
        let linear = gpu.pre_tone_at(&at)?;
        let r = deep_canvas_loop::exposure::measure(&linear, exposure, &vec![true; at.len()])?;
        Some(json!({"clipped": r.clipped, "crushed": r.crushed, "key_ev": r.key_ev}))
    }

    /// For each requirement whose check kind reads pixels, each deliverable's frames:
    /// requirement ID → document → what was drawn.
    pub(crate) fn pixel_runs(&mut self, c: &Claim) -> BTreeMap<String, BTreeMap<String, Drawn>> {
        let mut out = BTreeMap::new();
        for r in &c.requirements {
            let kind = r.check["kind"].as_str().unwrap_or_default();
            let Some(draws) = self
                .startup
                .sealed
                .check_kind(kind)
                .and_then(|(_, check)| check.frames.map(|(d, _)| d))
            else {
                continue;
            };
            let ts = times(&r.check);
            let mut by_doc = BTreeMap::new();
            for d in &c.deliverables {
                let Some(document) = self.current_of(d).map(|cur| cur.doc.clone()) else {
                    continue;
                };
                by_doc.insert(d.clone(), self.frames_of(&document, &ts, draws));
            }
            out.insert(r.id.clone(), by_doc);
        }
        out
    }

    /// `document` drawn at each of `times`, `draws` frames from each, as render-back draws it.
    pub(crate) fn frames_of(&mut self, document: &Value, times: &[i64], draws: u8) -> Drawn {
        let frame = document
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .and_then(|(p, q)| deep_canvas::time::frame_length(p, q).ok())
            .unwrap_or_else(|| deep_canvas::time::frame_length(60, 1).unwrap_or(1));
        let at: Vec<i64> = times
            .iter()
            .flat_map(|&t| (0..i64::from(draws.max(1))).map(move |k| t + k * frame))
            .collect();
        if crate::probe::draws_3d(document) {
            self.frames_3d(document, &at)
        } else {
            self.frames_2d(document, &at)
        }
    }

    fn frames_3d(&mut self, document: &Value, at: &[i64]) -> Drawn {
        let (_, fingerprint) = crate::kit::goldens::environment(self, "gpu");
        let size =
            crate::snapshot::px([0, 1].map(|i| document["size"][i].as_f64().unwrap_or(1.0)));
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let palette = self.look.light.clone();
        let Some(gpu) = self.gpu3() else {
            return Drawn::Blocked(json!({"code": "gpu_unavailable",
                "ask": "run the check on a machine with a GPU to draw its frames on"}));
        };
        let software = gpu
            .device()
            .adapter
            .as_ref()
            .is_some_and(|a| a.device_type == wgpu::DeviceType::Cpu);
        if software {
            return Drawn::Elsewhere(json!({"code": "software_adapter", "drew": fingerprint}));
        }
        let mut frames = Vec::new();
        for &t in at {
            // #493: a shot writes the camera's pose the frame is drawn through.
            let doc = crate::film::posed(document, t).unwrap_or_else(|| document.clone());
            let (scene, look) = match gpu.evaluate(&doc, t, &palette, size, &read) {
                Ok(s) => s,
                Err(u) => {
                    return Drawn::Blocked(
                        json!({"code": "not_presented", "reason": u.code, "path": u.path, "t": t}),
                    )
                }
            };
            let drawn = gpu
                .draw_scene(&scene, &look, false)
                .and_then(|(rgba, targets)| Some((rgba, targets, gpu.pre_tone()?)));
            let Some((rgba, targets, linear)) = drawn else {
                return Drawn::Blocked(
                    json!({"code": "not_presented", "reason": "unsupported_platform", "t": t}),
                );
            };
            frames.push(Frame {
                t,
                size: targets.size,
                linear,
                exposure: look.exposure,
                rgba,
                ids: ids_of(&targets.ids),
                picks: targets.picks,
                roles: palette.clone(),
            });
        }
        Drawn::Frames(frames, fingerprint)
    }

    /// A 2D revision by the CPU raster render-back draws it with. Its object-ID pass is each
    /// item's box in draw order, and a text's own px are those its draw changes: the frame drawn
    /// again with the text hidden differs there.
    fn frames_2d(&mut self, document: &Value, at: &[i64]) -> Drawn {
        let (_, fingerprint) = crate::kit::goldens::environment(self, "vello_cpu");
        let shown = crate::shared::drawable(document);
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let texts: Vec<String> = shown["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, i)| i["kind"] == deep_canvas_loop::contrast::TEXT_2D)
            .map(|(id, _)| id.clone())
            .collect();
        let mut frames = Vec::new();
        for &t in at {
            let draw = |hub: &mut Self, doc: &Value| {
                let drawn = hub
                    .renderer
                    .prepare(
                        doc.as_object()?,
                        t,
                        &hub.look.light,
                        hub.look.status.as_ref(),
                        &hub.record(),
                        &hub.scenario.evidence,
                    )
                    .ok()?;
                let size = crate::snapshot::px(drawn.frame.size);
                let rgba = hub.renderer.raster(&drawn, size, Some(ground));
                Some((rgba, size, drawn.boxes(), drawn.frame.size))
            };
            let Some((rgba, size, boxes, units)) = draw(self, &shown) else {
                return Drawn::Blocked(json!({"code": "not_presented", "t": t}));
            };
            let [w, h] = [usize::from(size[0]), usize::from(size[1])];
            let scale = [w as f64 / units[0].max(1e-9), h as f64 / units[1].max(1e-9)];
            let mut picks: BTreeMap<u32, String> = BTreeMap::new();
            let mut ids = vec![0u32; w * h];
            let span = |b: &[f64; 4]| {
                let px = |v: f64, s: f64, n: usize| ((v * s).round().max(0.0) as usize).min(n);
                let (x0, x1) = (px(b[0], scale[0], w), px(b[0] + b[2], scale[0], w));
                let (y0, y1) = (px(b[1], scale[1], h), px(b[1] + b[3], scale[1], h));
                (x0, x1, y0, y1)
            };
            for (k, (id, b)) in boxes.iter().enumerate() {
                let pick = k as u32 + 1;
                picks.insert(pick, id.clone());
                if texts.contains(id) {
                    continue;
                }
                let (x0, x1, y0, y1) = span(b);
                for y in y0..y1 {
                    ids[y * w + x0..y * w + x1].fill(pick);
                }
            }
            for text in &texts {
                let Some((pick, b)) = boxes
                    .iter()
                    .enumerate()
                    .find(|(_, (i, _))| i == text)
                    .map(|(k, (_, b))| (k as u32 + 1, *b))
                else {
                    continue;
                };
                let mut hidden = shown.clone();
                hidden["items"][text]["visible"] = json!(false);
                let Some((without, ..)) = draw(self, &hidden) else {
                    return Drawn::Blocked(json!({"code": "not_presented", "t": t, "path": format!("items/{text}")}));
                };
                let mut drew = false;
                for (i, (a, b)) in rgba.chunks_exact(4).zip(without.chunks_exact(4)).enumerate() {
                    if a != b {
                        ids[i] = pick;
                        drew = true;
                    }
                }
                // A text drawn in its ground's own color changes no px: its glyphs' box is
                // where it is, on that ground.
                if !drew {
                    let (x0, x1, y0, y1) = span(&b);
                    for y in y0..y1 {
                        ids[y * w + x0..y * w + x1].fill(pick);
                    }
                }
            }
            frames.push(Frame {
                t,
                size: [w as u32, h as u32],
                linear: linear(&rgba),
                exposure: 1.0,
                rgba,
                ids,
                picks,
                roles: self.look.light.clone(),
            });
        }
        Drawn::Frames(frames, fingerprint)
    }

    /// #1938: a verdict read as `against`, another run's verdict on the claim, reads it here: a
    /// pixel row holds where that verdict's row names this run's fingerprint, and is INCONCLUSIVE
    /// where it names another, naming both. Rows of checks that hold on any machine are as judged.
    pub(crate) fn read_against(&self, rows: &mut [Value], against: &Value) {
        let theirs: BTreeMap<&str, &Value> = against["requirements"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| Some((r["id"].as_str()?, r)))
            .collect();
        let anywhere = self.planted(Planted::PixelChecksHoldAnywhere);
        for row in rows.iter_mut() {
            let Some(own) = row.get("fingerprint").cloned() else {
                continue;
            };
            let was = row["id"].as_str().and_then(|id| theirs.get(id));
            let drew = was.map(|r| r["fingerprint"].clone()).unwrap_or(Value::Null);
            if drew == own || anywhere {
                continue;
            }
            row["against"] = json!({"fingerprint": drew, "result": was.map(|r| r["result"].clone())});
            let elsewhere = json!({"code": "environment_changed", "drew": drew, "run": own});
            match row.get_mut("inconclusive").and_then(Value::as_array_mut) {
                Some(list) => list.push(elsewhere),
                None => row["inconclusive"] = json!([elsewhere]),
            }
            if row["result"] != "BLOCKED" && row["result"] != "INVALID" {
                row["result"] = json!("INCONCLUSIVE");
            }
        }
    }
}
