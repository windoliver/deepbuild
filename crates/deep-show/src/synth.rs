//! #204: a synth's strip as the host compiles it for the mix (canvas primitives: Synth `synth@1`,
//! As built): its preset resolved from a pack the document pins, each param's expression bound to
//! t, the document's channels, its logic items' baked outputs and, in a spawned voice, its
//! occurrence's fields, as a function of document time the media module calls once a block.

use std::sync::Arc;

use deep_canvas::expr::{Expr, Nothing};
use deep_canvas_media::synth::check;
use deep_canvas_media::synth::play::{Param, Spec};
use deep_canvas_media::synth::preset::Preset;
use deep_canvas_media::synth::voice::{key, Twists};
use deep_canvas_media::FLICKS;
use deep_canvas_motion::array::Read;
use serde_json::{json, Map, Value};

/// A synth checkpoint ring's byte budget when the strip names none.
pub const BUDGET: usize = 64 << 20;
/// The most names one param's expression reads.
const VARS: usize = 16;

fn bad(what: String) -> Value {
    json!({"code": "bad_media", "what": what})
}

/// The preset a document names as `<pack>.<name>@<major>`, from a pack it pins.
pub fn preset_of(d: &Value, name: &str) -> Result<(Arc<Preset>, String), Value> {
    let v = preset_json(d, name)?;
    let p = Preset::compile(&v).map_err(|f| {
        json!({"code": "synth.unknown_preset", "preset": name, "what": format!("the preset `{name}` fails {}: {}", f.rule, f.why)})
    })?;
    Ok((Arc::new(p), name.to_string()))
}

/// The preset's own value, as its pack carries it.
pub fn preset_json(d: &Value, name: &str) -> Result<Value, Value> {
    let unknown =
        |why: String| json!({"code": "synth.unknown_preset", "preset": name, "what": why});
    let Some((pack, key)) = name.split_once('.') else {
        return Err(unknown(format!(
            "the preset `{name}` isn't named <pack>.<name>@<major>"
        )));
    };
    let pins = d
        .get("packs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);
    let manifest = pins
        .filter(|pin| {
            let id = pin.rsplit_once('@').map_or(*pin, |(id, _)| id);
            id.rsplit_once('/').map_or(id, |(_, n)| n) == pack
        })
        .find_map(crate::packs::manifest_of)
        .ok_or_else(|| unknown(format!("the preset `{name}` names the pack `{pack}`, which the document doesn't pin or isn't installed")))?;
    manifest
        .pointer(&format!(
            "/presets/{}",
            key.replace('~', "~0").replace('/', "~1")
        ))
        .cloned()
        .ok_or_else(|| unknown(format!("the pack `{pack}` has no preset `{key}`")))
}

/// What a param's expression reads besides constants.
enum Var {
    T,
    Channel(usize),
    Logic(Read),
    Value(f64),
}

/// The channels a document's motion reads, by ID, for params that read one.
struct Channels {
    list: Vec<deep_canvas_motion::doc::Channel>,
}

impl Channels {
    fn of(d: &Value) -> Channels {
        let list = d
            .as_object()
            .and_then(|o| deep_canvas_motion::doc::read(o).ok())
            .map(|m| m.channels)
            .unwrap_or_default();
        Channels { list }
    }
}

/// Mangles each dotted name (`<logic ID>.<name>`, or a channel ID with dots) to a plain one the
/// expression's lexer reads, returning the text and the names in order.
fn undot(text: &str) -> (String, Vec<(String, String)>) {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut names = Vec::new();
    let mut i = 0;
    let word = |c: char| c.is_alphanumeric() || c == '_';
    while i < chars.len() {
        let c = chars[i];
        let starts = (c.is_alphabetic() || c == '_')
            && (i == 0 || !(word(chars[i - 1]) || chars[i - 1] == '.'));
        if !starts {
            out.push(c);
            i += 1;
            continue;
        }
        let begin = i;
        while i < chars.len()
            && (word(chars[i])
                || (chars[i] == '.'
                    && chars
                        .get(i + 1)
                        .is_some_and(|n| n.is_alphabetic() || *n == '_')))
        {
            i += 1;
        }
        let name: String = chars[begin..i].iter().collect();
        if name.contains('.') {
            let plain = format!("dotted_{}", names.len());
            out.push_str(&plain);
            names.push((plain, name));
        } else {
            out.push_str(&name);
        }
    }
    (out, names)
}

/// One param compiled: its value, clamped to the param's range, at document time t.
fn param(
    d: &Value,
    channels: &Channels,
    text: &str,
    of: &deep_canvas_media::synth::preset::Param,
    fields: Option<&Value>,
    logic_per_step: bool,
) -> Result<Param, String> {
    let (lo, hi, default) = (of.lo, of.hi, of.default);
    let (plain, dotted) = undot(text);
    let e = Expr::compile(&plain, &Nothing, 64)
        .map_err(|r| format!("`{text}`: {} {}", r.call, r.why))?;
    if e.vars.len() > VARS {
        return Err(format!(
            "`{text}` reads {} names, more than {VARS}",
            e.vars.len()
        ));
    }
    let mut vars = Vec::with_capacity(e.vars.len());
    for v in &e.vars {
        let name = dotted
            .iter()
            .find(|(p, _)| p == v)
            .map_or(v.as_str(), |(_, n)| n.as_str());
        let found = if name == "t" {
            Some(Var::T)
        } else if let Some(x) = fields.and_then(|f| f.get(name)).and_then(Value::as_f64) {
            Some(Var::Value(x))
        } else if let Some(c) = channels.list.iter().position(|c| c.id == name) {
            Some(Var::Channel(c))
        } else {
            d.pointer(&format!("/arrays/{name}"))
                .and_then(Read::of)
                .map(Var::Logic)
        };
        vars.push(found.ok_or_else(|| format!("`{text}` reads `{name}`, which is neither t, a channel, a logic item's baked output nor a field of the occurrence"))?);
    }
    let clamp = move |x: f64| {
        if x.is_finite() {
            x.clamp(lo, hi)
        } else {
            default
        }
    };
    if vars.iter().all(|v| matches!(v, Var::Value(_))) {
        let vals: Vec<f64> = vars
            .iter()
            .map(|v| if let Var::Value(x) = v { *x } else { 0.0 })
            .collect();
        return Ok(Param::Const(clamp(e.eval_num(&vals))));
    }
    let chans: Vec<deep_canvas_motion::doc::Channel> = vars
        .iter()
        .filter_map(|v| {
            if let Var::Channel(c) = v {
                Some(channels.list[*c].clone())
            } else {
                None
            }
        })
        .collect();
    let f = move |t: i64| {
        let mut vals = [0.0f64; VARS];
        let mut ch = 0;
        for (slot, v) in vals.iter_mut().zip(&vars) {
            *slot = match v {
                Var::T => t as f64 / FLICKS as f64,
                Var::Value(x) => *x,
                Var::Channel(_) => {
                    let mut out = [0.0f64; 4];
                    chans[ch].read(t, &mut out);
                    ch += 1;
                    out[0]
                }
                // The planted synth reads logic once a step, at the step's left limit.
                Var::Logic(r) if logic_per_step => r.at(t.div_euclid(r.every()) * r.every() - 1),
                Var::Logic(r) => r.at(t),
            };
        }
        clamp(e.eval_num(&vals[..vars.len()]))
    };
    Ok(Param::Curve(Arc::new(f)))
}

/// The plants a synth reads from the run's planted name (tests/acceptance/204/README.md).
#[derive(Clone, Copy, Debug, Default)]
pub struct Plants {
    pub twists: Twists,
    pub half_tail: bool,
    pub frame_hold: bool,
    pub logic_per_step: bool,
}

impl Plants {
    pub fn now() -> Plants {
        let p = deep_canvas_media::planted;
        Plants {
            twists: Twists {
                phase_f32: p("osc_phase_f32"),
                shaper_bias: p("shaper_bias"),
                crush_short_bit: p("crush_7_bits"),
            },
            half_tail: p("synth_tail_halved"),
            frame_hold: p("synth_holds_params_per_frame"),
            logic_per_step: p("synth_reads_logic_per_frame"),
        }
    }
}

/// A strip's (or a spawned voice's) synth: `{preset, params, voices, seed, byte_budget}`, with
/// `voice` its index for the noise's key and `fields` its occurrence's, for a spawned voice. The
/// span is the strip's, in flicks; the spec's tail is to be added to it.
pub fn spec_of(
    d: &Value,
    id: &str,
    sy: &Value,
    span: i64,
    voice: u32,
    fields: Option<&Value>,
    plants: Plants,
) -> Result<Spec, Value> {
    let name = sy
        .get("preset")
        .and_then(Value::as_str)
        .ok_or_else(|| bad(format!("synth {id}: preset")))?;
    let (preset, _) = preset_of(d, name)?;
    let empty = Map::new();
    let given = sy
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    for k in given.keys() {
        if preset.param(k).is_none() {
            return Err(
                json!({"code": "synth.unknown_param", "strip": id, "param": k,
                "what": format!("synth {id}: the preset {name} has no param `{k}`")}),
            );
        }
    }
    let channels = Channels::of(d);
    let mut params = Vec::with_capacity(preset.params.len());
    for p in &preset.params {
        params.push(match given.get(&p.name) {
            None => Param::Const(p.default),
            Some(Value::Number(n)) => {
                Param::Const(n.as_f64().unwrap_or(p.default).clamp(p.lo, p.hi))
            }
            Some(Value::String(text)) => {
                param(d, &channels, text, p, fields, plants.logic_per_step)
                    .map_err(|w| bad(format!("synth {id}: param {}: {w}", p.name)))?
            }
            Some(_) => {
                return Err(bad(format!(
                    "synth {id}: param {} is a number or an expression",
                    p.name
                )))
            }
        });
    }
    let seed = sy.get("seed").and_then(Value::as_u64).unwrap_or(0);
    // A strip's voices, each its own noise key; a spawned voice is the one its occurrence names.
    let voices = match sy.get("voices") {
        None => 1,
        Some(v) => {
            v.as_u64()
                .filter(|n| (1..=32).contains(n))
                .ok_or_else(|| bad(format!("synth {id}: voices is 1 to 32")))? as u32
        }
    };
    let keys = match fields {
        Some(_) => vec![key(seed, id, voice)],
        None => (0..voices).map(|v| key(seed, id, v)).collect(),
    };
    let budget = sy
        .get("byte_budget")
        .and_then(Value::as_u64)
        .map_or(BUDGET, |b| b as usize);
    let tail = (check::tail(&preset, plants.half_tail) * FLICKS as f64).ceil() as i64;
    let frame = frame_flicks(d);
    Ok(Spec {
        name: name.to_string(),
        preset,
        params,
        keys,
        gate: span,
        tail,
        budget,
        twists: plants.twists,
        frame_hold: plants.frame_hold.then_some(frame),
        inherits: None,
    })
}

/// Whether a document plays a synth: a strip's or a spawn template's `src.synth`.
pub fn holds_synth(d: &Value) -> bool {
    let strips = d
        .get("strips")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    let spawns = d
        .get("spawns")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    strips
        .into_iter()
        .any(|(_, s)| s.pointer("/src/synth").is_some())
        || spawns.into_iter().any(|(_, sp)| match sp.get("play") {
            Some(Value::Array(a)) => a.iter().any(|e| e.pointer("/template/src/synth").is_some()),
            Some(t) => t.pointer("/src/synth").is_some(),
            None => false,
        })
}

/// #204's bake at check on the live path: a mix that holds a synth renders across its strips once,
/// filling its rings, and returns to its start.
pub fn bake(player: &mut deep_canvas_media::mix::Player) {
    let mix = player.mix.clone();
    if !mix.strips.iter().any(|s| s.synth.is_some()) {
        return;
    }
    let end = mix
        .strips
        .iter()
        .map(|s| s.start.saturating_add(s.span))
        .max()
        .unwrap_or(0);
    let to = (end as i128 * mix.rate as i128 / FLICKS as i128) as i64;
    player.bake(to);
    player.seek(0);
}

/// The document's frame in flicks: its transport's frame rate, 60 by default.
fn frame_flicks(d: &Value) -> i64 {
    let fr = d.pointer("/transport/frame_rate");
    let (n, den) = match fr {
        Some(Value::Array(a)) => (
            a.first().and_then(Value::as_i64).unwrap_or(60),
            a.get(1).and_then(Value::as_i64).unwrap_or(1),
        ),
        Some(v) => (v.as_i64().unwrap_or(60), 1),
        None => (60, 1),
    };
    FLICKS * den.max(1) / n.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dotted_names_become_plain_vars() {
        let (t, names) = undot("60 + 4 * car.speed - step.gain*2 + 1.5");
        assert_eq!(t, "60 + 4 * dotted_0 - dotted_1*2 + 1.5");
        assert_eq!(
            names,
            [
                ("dotted_0".into(), "car.speed".into()),
                ("dotted_1".into(), "step.gain".into())
            ]
        );
    }
}
