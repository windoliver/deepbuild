//! Level of detail and the light cut in a view3d session (issue #425; tests/acceptance/425/README.md,
//! Assumed surfaces 1–3): each frame's bands, blend levels and mesh levels from scene3d's pure
//! selection, resolved into what the renderer draws, and the light policy at the frame's view,
//! reported as the CPU computed them from the canonical view. The planted wrong programs keep
//! session state, read the wall clock or an earlier frame, or the drawn frame's scale; the shipped
//! selection reads only the view.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use deep_canvas_scene3d::light::{self, Policy};
use deep_canvas_scene3d::lod::{self, bands_at, errors_px, level_at, Choice, Show, OF};
use deep_canvas_scene3d::scene::{Camera, Scene};
use serde_json::{json, Value};

use crate::Planted;

/// A band change fades over this much of the host's clock in the planted program.
const FADE: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct Selection {
    planted: Option<Planted>,
    /// The planted programs' session state: each item's last bands, a fade's start, the last
    /// frame's camera, and the lights last shaded.
    held: BTreeMap<String, Vec<Show>>,
    fading: BTreeMap<String, (Vec<Show>, Instant)>,
    last_camera: Option<Camera>,
    shaded: Vec<String>,
}

impl Selection {
    pub fn new(planted: Option<Planted>) -> Selection {
        Selection {
            planted,
            ..Selection::default()
        }
    }

    /// The frame's choices and light cut: computed, drawn into `scene`, and returned for the
    /// report. `scale` is the internal scale the frame draws at; `noop` that no GPU draws it.
    pub fn apply(&mut self, scene: &mut Scene, scale: f64, noop: bool) -> (Vec<Choice>, Policy) {
        let mut choices = lod::select(scene);
        let camera = scene.camera.clone();
        let solids: Vec<_> = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| s.lod.is_some())
            .collect();
        for (c, s) in choices.iter_mut().zip(&solids) {
            let lod = s.lod.as_ref().expect("filtered");
            match self.planted {
                Some(Planted::BandHysteresis) => {
                    if let Some(held) = self.held.get(&c.item).filter(|h| h.len() == 1) {
                        let wide = bands_at(&lod.bands, lod.margin + 0.1, c.size_px);
                        if *held != c.bands && wide.0.len() == 2 {
                            c.bands = held.clone();
                            c.blend = None;
                        }
                    }
                    self.held.insert(c.item.clone(), c.bands.clone());
                }
                Some(Planted::BandFadeByWallClock) => {
                    let last = self.held.insert(c.item.clone(), c.bands.clone());
                    if let Some(old) = last.filter(|o| *o != c.bands) {
                        self.fading.insert(c.item.clone(), (old, Instant::now()));
                    }
                    if let Some((old, at)) = self.fading.get(&c.item) {
                        let gone = at.elapsed().as_secs_f64() / FADE.as_secs_f64();
                        if gone < 1.0 {
                            c.bands = vec![old[0], *c.bands.last().expect("a band")];
                            c.blend = Some((gone * f64::from(OF)) as u32);
                        }
                    }
                }
                Some(Planted::LevelByEarlierFrame) if c.level.is_some() => {
                    let cam = self.last_camera.as_ref().unwrap_or(&camera);
                    let e = errors_px(cam, &s.model, lod);
                    c.level = Some(level_at(&e, lod.lod_px));
                    c.errors_px = Some(e);
                    c.triangles = c.level.map(|l| lod::triangles(c, lod, l));
                }
                Some(Planted::BlendLevelOnGpu) => {
                    let drawn = (c.size_px as f32 * scale as f32) as f64;
                    let (bands, blend) = bands_at(&lod.bands, lod.margin, drawn);
                    c.bands = bands;
                    c.blend = if noop { None } else { blend };
                }
                _ => {}
            }
        }
        self.last_camera = Some(camera);
        let policy = self.cut(scene);
        let side = deep_scene3d_render::shadow::SIZE;
        lod::shadow_levels(
            scene,
            &mut choices,
            deep_scene3d_render::shadow_texels(scene, side),
        );
        lod::resolve(scene, &choices);
        (choices, policy)
    }

    /// The light cut at the scene's view: the policy's, or the planted one held by session
    /// hysteresis, which the scene then draws.
    fn cut(&mut self, scene: &mut Scene) -> Policy {
        let mut policy = light::policy(&scene.lights, &scene.camera);
        if self.planted != Some(Planted::LightCutHysteresis) {
            return policy;
        }
        let scores = light::scores(&scene.lights, &scene.camera);
        let index = |id: &str| scene.lights.iter().position(|l| l.id == id);
        let cut = policy
            .shaded
            .iter()
            .map(|&(i, _)| scores[i])
            .fold(f64::INFINITY, f64::min);
        for held in std::mem::take(&mut self.shaded) {
            let Some(h) = index(&held) else { continue };
            if policy.shaded.iter().any(|&(i, _)| i == h) || scores[h] < 0.9 * cut {
                continue;
            }
            // Kept shaded in place of the weakest light shaded now that wasn't before.
            if let Some(k) = policy
                .shaded
                .iter()
                .enumerate()
                .min_by(|a, b| scores[a.1 .0].total_cmp(&scores[b.1 .0]))
                .map(|(k, _)| k)
            {
                let (out, w) = policy.shaded[k];
                policy.shaded[k] = (h, w);
                policy.left_out.retain(|id| *id != held);
                policy.left_out.push(scene.lights[out].id.clone());
            }
        }
        self.shaded = policy
            .shaded
            .iter()
            .map(|&(i, _)| scene.lights[i].id.clone())
            .collect();
        scene.light_cut = Some(policy.clone());
        policy
    }
}

/// The frame's `lod` rows (Assumed surfaces 1).
pub fn rows(choices: &[Choice]) -> Value {
    json!(choices
        .iter()
        .map(|c| json!({
            "item": c.item,
            "bands": c.bands.iter().map(|b| b.name()).collect::<Vec<_>>(),
            "blend": c.blend.filter(|_| c.bands.len() == 2).map(|l| json!({"level": l, "of": OF})),
            "level": c.level,
            "errors_px": c.errors_px,
            "triangles": c.triangles,
            "shadow_level": c.shadow_level,
        }))
        .collect::<Vec<_>>())
}

/// The frame's `light_cut` (Assumed surfaces 2).
pub fn cut_json(scene: &Scene, policy: &Policy) -> Value {
    json!({
        "shaded": policy
            .shaded
            .iter()
            .map(|&(i, w)| json!({"light": scene.lights[i].id, "weight": w}))
            .collect::<Vec<_>>(),
        "left_out": policy.left_out,
    })
}
