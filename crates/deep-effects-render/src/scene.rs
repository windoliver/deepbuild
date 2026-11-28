//! The post stage a 3D frame draws through, from its scene, its look and its document (#380;
//! canvas primitives: Place in the frame): the settings `view3d`, render-back and the app's canvas
//! panel each hand the shipped effects ([`crate::frame::Effects`]) at a frame's t, and the
//! document's own operators (#1719).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas::document::frame_rate_of;
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::ops;
use deep_canvas_effects::graph;
use deep_canvas_effects::interp::{hash1, Image};
use deep_canvas_effects::particles::spec::Refusal;
use deep_canvas_effects::particles::stepped;
use deep_canvas_effects::{effect, module, shipped};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Scene;
use deep_scene3d_render::targets::Want;
use serde_json::{json, Value};

use crate::docops::item_seed;
use crate::frame::{self as fx, Effects, Settings, Sparks};
use crate::particles::{self, Plain};
use crate::velocity;

const FLICKS: f64 = FLICKS_PER_SECOND as f64;

/// #1719: a frame of a document as a host draws it through its post stage: the evaluated scene, the
/// look it draws in, the shipped effects' settings, and, where it holds GPU operators of its own, the
/// document they are built from with the core's targets they read.
pub struct Staged {
    pub scene: Scene,
    pub look: Look3,
    pub settings: Settings,
    pub operators: Option<Value>,
    pub want: Want,
}

/// A host's own evaluation of a document at a time, in the look it draws it in.
pub type Evaluate<'a> = dyn FnMut(&Value, i64) -> Result<(Scene, Look3), Refusal> + 'a;

/// #1719: `doc` at `t` flicks in the look `look_json` defines, for a host with no session of its own
/// (no selection, no planted program, its noise keyed by its items' seeds), as `view3d` stages it:
/// its film effects' particles written beside them (#508), its mesh particles an instancer's
/// elements (#450), and where an operator reads the velocity target, the evaluations half a shutter
/// either side of t.
pub fn staged(
    doc: &Value,
    t: i64,
    look_json: &Value,
    evaluate: &mut Evaluate<'_>,
) -> Result<Staged, Refusal> {
    let kinds = || doc["items"].as_object().into_iter().flatten();
    let has = |k: &str| kinds().any(|(_, i)| i["kind"] == k);
    let lowered = has("effect@1").then(|| {
        let mut d = doc.clone();
        effect::lower(&mut d);
        d
    });
    let doc = lowered.as_ref().unwrap_or(doc);
    let mut at = |doc: &Value, t: i64| -> Result<(Scene, Look3), Refusal> {
        let (mut scene, look) = evaluate(doc, t)?;
        particles::follow_effects(&mut scene, doc).map_err(|r| {
            let i = &r["issues"][0];
            let text = |k: &str| i[k].as_str().unwrap_or_default().to_string();
            Refusal::new("refused", text("path"), text("what"))
        })?;
        Ok((scene, look))
    };
    let seconds = t as f64 / FLICKS;
    let (mut scene, look) = at(doc, t)?;
    let plants = Default::default();
    if let Some(fed) = particles::meshes(doc, &scene, seconds, plants)? {
        scene = at(&fed, t)?.0;
    }
    let operators = module::OPERATOR_KINDS.iter().any(|(_, k)| has(k));
    let reads = |target| operators && module::reads_core(doc, target);
    let want = Want {
        velocity: reads("velocity"),
        emission: reads("emission"),
        normal: false,
    };
    if want.velocity {
        let rate = doc.get("transport").and_then(frame_rate_of);
        let fps = rate.map_or(60.0, |(p, q)| f64::from(p) / f64::from(q.max(1)));
        let shutter = (look.blur.as_ref()).map_or(0.5 / fps, |b| b.shutter_s(fps));
        let half = (shutter * FLICKS / 2.0).round() as i64;
        let (open, close) = (at(doc, t - half)?.0, at(doc, t + half)?.0);
        let (pairing, blur) = (velocity::Pairing::Shipped, Default::default());
        let (motion, _) = velocity::motion(&scene, &open, &close, pairing, &blur);
        scene.velocity = Some(Arc::new(motion));
    }
    let seed = doc["seed"].as_u64().unwrap_or(0);
    let mut settings = settings(&scene, look_json, &look, &[], seconds, seed, Seeding::Item);
    particles::frame(&mut settings, doc, &scene, seconds, &mut Plain)?;
    particles::effects(&mut settings, doc, &scene, seconds, plants, Seeding::Item)?;
    Ok(Staged {
        scene,
        look,
        settings,
        operators: operators.then(|| doc.clone()),
        want,
    })
}

impl Staged {
    /// Whether the frame's post stage moves with t beside what the motion program moves: it draws
    /// particles or a film effect, or an operator of its document reads the time or steps with it.
    pub fn moves(&self) -> bool {
        let s = &self.settings;
        let doc = self.operators.as_ref();
        let items = doc.and_then(|d| d["items"].as_object()).into_iter();
        let mut operators = items
            .flatten()
            .filter_map(|(id, item)| graph::read(&module::operator_of(id, item)?).ok());
        !s.sparks.is_empty()
            || !s.emits.is_empty()
            || operators.any(|o| {
                let timed =
                    |i: &graph::Input| matches!(i.from, graph::From::Time | graph::From::Phase(_));
                o.stepped.is_some() || o.inputs.values().any(timed)
            })
    }
}

impl Effects {
    /// #1719: the next frame's settings and its document's own operators, built again only for
    /// another document than the last frame's.
    pub fn stage(&mut self, frame: &Staged) {
        self.settings = frame.settings.clone();
        let doc = frame.operators.as_ref();
        if self.op_doc.as_ref().map(|(d, ..)| d) != doc {
            let (options, check) = Default::default();
            self.op_doc = doc.map(|d| (d.clone(), options, check));
            self.docops = None;
        }
    }
}

/// How the shipped noise is keyed: by the item's seed, or (planted) salted by a frame counter or a
/// clock's reading.
#[derive(Clone, Copy, Debug)]
pub enum Seeding {
    Item,
    Salted(u32),
}

impl Seeding {
    fn key(self, seed: u32) -> u32 {
        match self {
            Seeding::Item => seed,
            Seeding::Salted(n) => hash1(seed ^ n),
        }
    }
}

pub fn linear_of(c: [u8; 3]) -> [f64; 3] {
    c.map(|v| {
        let x = f64::from(v) / 255.0;
        if x <= 0.04045 {
            x / 12.92
        } else {
            ops::pow((x + 0.055) / 1.055, 2.4)
        }
    })
}

fn role(look: &Look3, name: Option<&str>, fallback: &str) -> [f64; 3] {
    let c = name
        .and_then(|n| look.role(n))
        .or_else(|| look.role(fallback))
        .unwrap_or([128, 128, 128]);
    linear_of(c)
}

fn pair(v: Option<&Value>, default: [f64; 2]) -> [f64; 2] {
    match v {
        Some(Value::Number(n)) => {
            let x = n.as_f64().unwrap_or(default[0]);
            [x, x]
        }
        Some(Value::Array(a)) => [
            a.first().and_then(Value::as_f64).unwrap_or(default[0]),
            a.get(1).and_then(Value::as_f64).unwrap_or(default[1]),
        ],
        _ => default,
    }
}

/// #2485: where an item stands, and a curve resampled, as the effects crate's bake reads them.
pub use deep_canvas_effects::particles::item::{item_pos, resampled};

/// A channel over life (Particles: `size, opacity: channels over life`): a number, `[birth,
/// death]`, or keys `[{at, value}]`, as its values at birth and at death.
fn over_life(v: Option<&Value>, default: f64) -> [f64; 2] {
    match v {
        Some(Value::Array(keys)) if keys.iter().all(Value::is_object) && !keys.is_empty() => {
            let at = |k: &Value| k["value"].as_f64().unwrap_or(default);
            [at(&keys[0]), at(&keys[keys.len() - 1])]
        }
        other => pair(other, [default, default]),
    }
}

/// #508: a channel over life's keys `[{at, value}]`, up to 12, as the draw reads them when there
/// are more than two.
fn life_keys(v: Option<&Value>) -> Vec<(f64, f64)> {
    v.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|k| k.is_object())
        .take(12)
        .map(|k| {
            (
                k["at"].as_f64().unwrap_or(0.0),
                k["value"].as_f64().unwrap_or(1.0),
            )
        })
        .collect()
}

/// One particles@1 item as the operator and the draw read it: its emitter, motion, life and
/// look over life (Particles `particles@1`; #420).
fn sparks_of(
    scene: &Scene,
    o: &deep_canvas_scene3d::scene::Other,
    look: &Look3,
    seed: u32,
) -> Sparks {
    let p = &o.params;
    let emit = &p["emit"];
    let count = p["count"]
        .as_u64()
        .unwrap_or(256)
        .min(u64::from(shipped::MAX_PARTICLES_SHOWPIECE)) as u32;
    let life = pair(p.get("life"), [1.0, 1.0]);
    let motion = p["motion"]
        .as_object()
        .and_then(|m| m.keys().next().cloned())
        .unwrap_or_else(|| "ballistic".into());
    let m = &p["motion"][&motion];
    let ballistic = &p["motion"]["ballistic"];
    let v0 = pair(ballistic.get("v0"), [1.0, 2.0]);
    let origin = emit["anchor"]
        .as_str()
        .and_then(|a| item_pos(scene, a))
        .unwrap_or(o.pos);
    // The emitter's shape, and the curve it or the motion runs along.
    let (shape, shape_curve) = match &emit["shape"] {
        Value::Object(s) => match s.get("along").and_then(Value::as_str) {
            Some(c) => (3, Some(c.to_string())),
            None => (0, None),
        },
        Value::String(s) => (
            shipped::SHAPES.iter().position(|x| x == s).unwrap_or(0) as u32,
            None,
        ),
        _ => (0, None),
    };
    let curve_id = m["curve"].as_str().map(str::to_string).or(shape_curve);
    let (curve, curve_len) = curve_id
        .and_then(|c| scene.curves.get(&c))
        .map(|pts| resampled(pts))
        .unwrap_or((vec![origin; shipped::CURVE_POINTS as usize], 0.0));
    let code = shipped::MOTIONS
        .iter()
        .position(|x| *x == motion)
        .unwrap_or(0) as u32;
    let mut stops: Vec<(f64, [f64; 3])> = p["color"]
        .as_array()
        .map(|c| {
            c.iter()
                .take(4)
                .map(|k| {
                    (
                        k["at"].as_f64().unwrap_or(0.0),
                        role(look, k["role"].as_str(), "accent"),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    if stops.is_empty() {
        stops.push((0.0, role(look, None, "accent")));
    }
    let params = BTreeMap::from([
        ("particles.count".to_string(), json!(count)),
        (
            "particles.rate".to_string(),
            json!(emit["rate"].as_f64().unwrap_or(100.0)),
        ),
        (
            "particles.span".to_string(),
            json!(emit["span"].as_f64().unwrap_or(1e9)),
        ),
        ("particles.life_min".to_string(), json!(life[0])),
        ("particles.life_max".to_string(), json!(life[1])),
        ("particles.v0_min".to_string(), json!(v0[0])),
        ("particles.v0_max".to_string(), json!(v0[1])),
        (
            "particles.drag".to_string(),
            json!(ballistic["drag"].as_f64().unwrap_or(0.0)),
        ),
        (
            "particles.gravity".to_string(),
            ballistic
                .get("gravity")
                .cloned()
                .unwrap_or(json!([0.0, -9.8, 0.0])),
        ),
        ("particles.origin".to_string(), json!(origin)),
        ("particles.motion".to_string(), json!(code)),
        ("particles.shape".to_string(), json!(shape)),
        (
            "particles.radius".to_string(),
            json!(emit["radius"].as_f64().unwrap_or(0.25)),
        ),
        ("particles.curve".to_string(), json!(curve)),
        ("particles.curve_len".to_string(), json!(curve_len)),
        (
            "particles.speed".to_string(),
            json!(m["speed"].as_f64().unwrap_or(1.0)),
        ),
        (
            "particles.axis".to_string(),
            m.get("axis").cloned().unwrap_or(json!([0.0, 1.0, 0.0])),
        ),
        (
            "particles.spin".to_string(),
            json!(ops::rad(m["rate"].as_f64().unwrap_or(0.0))),
        ),
        (
            "particles.amplitude".to_string(),
            json!(m["amplitude"].as_f64().unwrap_or(0.0)),
        ),
        (
            "particles.frequency".to_string(),
            json!(m["frequency"].as_f64().unwrap_or(0.0)),
        ),
    ]);
    let draw = ["dot", "spark", "puff", "streak"]
        .iter()
        .position(|d| Some(*d) == p["draw"].as_str())
        .unwrap_or(0) as u32;
    // #853: a stepped item's dots are grains, drawn over what is behind them at their own color.
    let grains = o.kind == "particles.stepped@1" && draw == 0;
    Sparks {
        item: o.id.clone(),
        params,
        count,
        seed,
        size_px: 1.0,
        // Sparks are emissive, bright enough to glow.
        opacity: if grains { 1.0 } else { 4.0 },
        size: over_life(p.get("size"), 3.0),
        fade: over_life(p.get("opacity"), 1.0),
        fade_keys: life_keys(p.get("opacity")),
        stops,
        draw: if grains { fx::GRAINS } else { draw },
        half: draw == 2 && p["resolution"].as_str() != Some("full"),
        closed: None,
        ribbon: None,
        effect: None,
        cost_ns: None,
        // #853: a stepped item draws the rows its own operator wrote this frame.
        rows: (o.kind == "particles.stepped@1")
            .then(|| (stepped::rows_op(&o.id), stepped::ROWS.into())),
        baked: None,
    }
}

/// The bloom's lens dirt image (#418) when `seeded`: made from `seed` (the look's, else the
/// document's), its low 32 bits, once per seed and kept; `None` otherwise.
fn dirt_of(dirt: &Value, seed: u64) -> Option<Arc<Image>> {
    static SEEDED: Mutex<BTreeMap<u32, Arc<Image>>> = Mutex::new(BTreeMap::new());
    if dirt["texture"] != "seeded" {
        return None;
    }
    let seed = seed as u32;
    let mut held = SEEDED.lock().unwrap_or_else(|e| e.into_inner());
    Some(
        held.entry(seed)
            .or_insert_with(|| Arc::new(deep_canvas_effects::dirt::seeded(seed)))
            .clone(),
    )
}

/// The settings the look, the scene and the session's selection give a frame at `t`.
pub fn settings(
    scene: &Scene,
    look_json: &Value,
    look: &Look3,
    selection: &[String],
    t: f64,
    doc_seed: u64,
    seeding: Seeding,
) -> Settings {
    let mut roles = BTreeMap::new();
    let ground = &look_json["ground_3d"];
    let grid = (ground["kind"] == "grid").then(|| {
        let r = &ground["roles"];
        roles.insert(
            "grid_minor".into(),
            role(look, r["minor"].as_str(), "muted"),
        );
        roles.insert("grid_major".into(), role(look, r["major"].as_str(), "ink"));
        roles.insert("grid_axis".into(), role(look, r["axis"].as_str(), "accent"));
        let eye = scene.camera.eye;
        // `auto` fades at the view's bounds: three times the eye's distance from the origin.
        let fade = ground["fade"].as_f64().unwrap_or_else(|| {
            (3.0 * ops::sqrt(eye[0] * eye[0] + eye[1] * eye[1] + eye[2] * eye[2])).max(10.0)
        });
        BTreeMap::from([
            (
                "ground_3d.height".to_string(),
                json!(ground["height"].as_f64().unwrap_or(0.0)),
            ),
            (
                "ground_3d.spacing".to_string(),
                json!(ground["spacing"].as_f64().unwrap_or(1.0)),
            ),
            (
                "ground_3d.major_every".to_string(),
                json!(ground["major_every"].as_u64().unwrap_or(10)),
            ),
            (
                "ground_3d.width".to_string(),
                json!(ground["width"].as_f64().unwrap_or(1.0)),
            ),
            ("ground_3d.fade".to_string(), json!(fade)),
        ])
    });
    // A scene of materials shades the sun's shadow through its cascades instead (#422).
    let shadow = scene
        .sun
        .as_ref()
        .filter(|s| s.shadow && !scene.cascaded())
        .map(|s| (BTreeMap::new(), seeding.key(item_seed(doc_seed, &s.id))));
    let mut sparks: Vec<Sparks> = scene
        .others
        .iter()
        .filter(|o| o.kind == "particles@1" || o.kind == "particles.stepped@1")
        .map(|o| sparks_of(scene, o, look, seeding.key(item_seed(doc_seed, &o.id))))
        .collect();
    // #508: the film effects: a plume's or an airflow's particles cost as its preset declares,
    // and a wave field's or an arc's emission pass.
    let mut emits = Vec::new();
    for o in scene.others.iter().filter(|o| o.kind == "effect@1") {
        let p = &o.params;
        let kind = p["kind"].as_str().unwrap_or_default();
        if let Some(cost) = effect::cost(kind) {
            for sp in sparks
                .iter_mut()
                .filter(|sp| lowered_from(&sp.item, &o.id, kind))
            {
                sp.effect = Some(o.id.clone());
                sp.cost_ns = Some(cost);
            }
        }
        if let Some(e) = emit_of(scene, o, look, effect_seed(doc_seed, o, seeding)) {
            emits.push(e);
        }
    }
    roles.insert("selection".into(), role(look, Some("selection"), "accent"));
    let bloom = look_json["bloom"].as_object().map(|b| {
        b.iter()
            .map(|(k, v)| (format!("bloom.{k}"), v.clone()))
            .collect::<BTreeMap<_, _>>()
    });
    let dirt = bloom
        .as_ref()
        .and_then(|b| b.get("bloom.dirt"))
        .and_then(|d| dirt_of(d, look_json["seed"].as_u64().unwrap_or(doc_seed)));
    Settings {
        grid,
        shadow,
        sparks,
        emits,
        hazes: Vec::new(),
        checks: false,
        overdraw: false,
        selection: selection.to_vec(),
        outline_width: 2,
        bloom,
        dirt,
        roles,
        t,
        strokes: look.strokes.as_ref().map(|s| {
            Arc::new(gpu_strokes(&deep_canvas_scene3d::strokes::lay(
                scene,
                s,
                &scene.camera,
            )))
        }),
    }
}

/// #508: whether particles item `id` is one effect `effect` of `kind` lowered to.
fn lowered_from(id: &str, effect: &str, kind: &str) -> bool {
    match kind {
        "plume" => id == format!("{effect}.particles"),
        _ => id
            .strip_prefix(effect)
            .and_then(|r| r.strip_prefix(".p"))
            .is_some_and(|r| r.contains('c')),
    }
}

/// #508: an effect item's seed (Effect: `seed: item | u64 = item`), keyed as every shipped noise.
pub fn effect_seed(doc_seed: u64, o: &deep_canvas_scene3d::scene::Other, seeding: Seeding) -> u32 {
    let base = match o.params["seed"].as_u64() {
        Some(s) => hash1(s as u32) ^ (s >> 32) as u32,
        None => item_seed(doc_seed, &o.id),
    };
    seeding.key(base)
}

/// #508: a wave field's or an arc's emission pass from its params and the scene at t: its anchor
/// (and an arc's end) where the scene puts them, its own role's color in the slot its pass reads.
fn emit_of(
    scene: &Scene,
    o: &deep_canvas_scene3d::scene::Other,
    look: &Look3,
    seed: u32,
) -> Option<fx::Emit> {
    use effect::{axis, num, scale};
    let p = &o.params;
    let kind = p["kind"].as_str()?;
    let anchor = p["anchor"]
        .as_str()
        .and_then(|a| item_pos(scene, a))
        .unwrap_or(o.pos);
    let k = scale(p);
    let n = |f: &str| json!(num(p, kind, f));
    let (kind, op, slot, params) = match kind {
        "wave_field" => (
            "wave_field",
            "wave_field@1",
            "wave",
            BTreeMap::from([
                ("wave.point".to_string(), json!(anchor)),
                ("wave.normal".to_string(), json!(axis(&p["axis"]))),
                ("wave.amplitude".to_string(), n("amplitude")),
                ("wave.wavelength".to_string(), n("wavelength")),
                ("wave.speed".to_string(), n("speed")),
                ("wave.radius".to_string(), n("radius")),
            ]),
        ),
        "arc" => {
            let to = p["arc"]["to"].as_str().and_then(|a| item_pos(scene, a))?;
            // Its px widths at the view's size, drawn at its resolution.
            let px = |f: &str| json!(num(p, "arc", f) * k);
            (
                "arc",
                "arc@1",
                "arc",
                BTreeMap::from([
                    ("arc.from".to_string(), json!(anchor)),
                    ("arc.to".to_string(), json!(to)),
                    ("arc.intensity".to_string(), n("intensity")),
                    ("arc.width".to_string(), px("width")),
                    ("arc.jitter".to_string(), px("jitter")),
                    ("arc.rate".to_string(), n("rate")),
                    ("arc.waves".to_string(), n("waves")),
                ]),
            )
        }
        _ => return None,
    };
    Some(fx::Emit {
        item: o.id.clone(),
        kind,
        op,
        params,
        seed,
        scale: k,
        roles: BTreeMap::from([(slot.into(), role(look, p[kind]["role"].as_str(), "accent"))]),
    })
}

/// #462: the strokes a frame laid, as the effects chain's draw reads them (colors linear).
pub fn gpu_strokes(laid: &[deep_canvas_scene3d::strokes::Dab]) -> Vec<crate::strokes::Dab> {
    laid.iter()
        .map(|d| crate::strokes::Dab {
            at: d.at,
            near: d.near,
            angle: d.angle,
            length: d.length,
            width: d.width,
            color: d
                .color
                .map(|c| deep_canvas::color::srgb_decode(f64::from(c) / 255.0) * d.shade),
            seed: f64::from(d.seed) / f64::from(u32::MAX),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas_scene3d::scene::{evaluate, Labels};

    /// #508: two wave fields each draw in their own role's color: A's pass reads ink, B's accent.
    #[test]
    fn each_wave_field_draws_in_its_own_role() {
        let doc = json!({
            "format": 1, "id": "two-waves", "profile": "scene", "title": "t", "description": "d",
            "size": [320, 240], "camera": "cam", "seed": 508,
            "requires": {"modules": {"scene3d": "^1", "effects": "^1"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                        "params": {"projection": "orthographic", "position": [0, 0, 10], "target": [0, 0, 0],
                                   "view_width": 6.4, "near": 0.05, "far": 100}},
                "a": {"id": "a", "kind": "effect@1", "order": "a1",
                      "params": {"kind": "wave_field", "wave_field": {"role": "ink"}}},
                "b": {"id": "b", "kind": "effect@1", "order": "a2",
                      "params": {"kind": "wave_field", "wave_field": {"role": "accent"}}},
            },
        });
        let look_json = json!({"roles": {"ink": "#202020", "accent": "#e04010"}});
        let look = Look3::read(&look_json).expect("the look reads");
        let scene = evaluate(&doc, 0, &look, &mut Labels::new()).expect("the scene evaluates");
        let s = settings(&scene, &look_json, &look, &[], 0.0, 508, Seeding::Item);
        let read = |id: &str| {
            let e = s
                .emits
                .iter()
                .find(|e| e.item == id)
                .expect("its emission pass");
            e.roles["wave"]
        };
        let (ink, accent) = (
            role(&look, Some("ink"), "accent"),
            role(&look, Some("accent"), "ink"),
        );
        assert_ne!(ink, accent);
        assert_eq!(
            read("a"),
            ink,
            "wave field a (role ink) draws in another color"
        );
        assert_eq!(
            read("b"),
            accent,
            "wave field b (role accent) draws in another color"
        );
    }
}
