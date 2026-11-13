//! Issue #500: sounds on moments in `media_mix` (the #500 spawn and cue acceptance READMEs). A
//! Spawn's voices are planned once from a baked occurrence list the document carries
//! (`occurrences`), a strip's `align` places it by its asset's onset, and a sound cue (`cues`)
//! moves a strip so its onset or peak lands on the first frame that shows its moment.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_media::analysis::onsets::{self, Method, Onset};
use deep_canvas_media::emitter::{Cone, Distance, Model};
use deep_canvas_media::mix::{Emit, Gain, Place, Source, Strip};
use deep_canvas_media::spawn::{self, Occ, Pick, Plan, Steal};
use deep_canvas::expr::{Expr, Nothing};
use deep_canvas_media::{doc, FLICKS};
use serde_json::{json, Map, Value};

use crate::hub::Hub;
use crate::mixdown::listener;

fn gcd(a: i128, b: i128) -> i128 {
    if b == 0 {
        a.abs().max(1)
    } else {
        gcd(b, a % b)
    }
}

fn reduced(p: i128, q: i128) -> (i64, i64) {
    let g = gcd(p, q);
    ((p / g) as i64, (q / g) as i64)
}

fn ceil_div(a: i128, b: i128) -> i128 {
    a.div_euclid(b) + i128::from(a.rem_euclid(b) != 0)
}

/// The attack starts of a source's onset bake (transient, its default threshold).
pub fn onsets_of(s: &Source) -> Vec<Onset> {
    onsets::onsets(&s.samples, s.channels, s.rate, Method::Transient, Method::Transient.default_threshold())
}

/// How far into a strip a source sample sounds: (sample's flick − in) at the strip's rate.
fn into_strip(sample: i64, source: &Source, r#in: i64, rate: (i64, i64)) -> i64 {
    let src = sample as i128 * FLICKS as i128 / source.rate.max(1) as i128;
    ceil_div((src - r#in as i128) * rate.1 as i128, rate.0.max(1) as i128) as i64
}

/// Where a strip with `align: {onset: strongest | first, to}` starts, so its onset lands at `to`.
pub fn aligned_start(d: &Value, sid: &str, s: &Value, strip: &Strip) -> Result<Option<i64>, String> {
    let Some(a) = s.get("align") else {
        return Ok(None);
    };
    let to = doc::time(d, a.get("to")).ok_or(format!("strip {sid}: align.to"))?;
    let found = onsets_of(&strip.source);
    let peak = |o: &Onset| {
        let c = strip.source.channels.max(1);
        (0..c).map(|k| strip.source.samples.get(o.peak as usize * c + k).map_or(0.0, |x| x.abs())).fold(0.0, f32::max)
    };
    let onset = match a.get("onset").and_then(Value::as_str).unwrap_or("strongest") {
        "first" => found.first(),
        "strongest" => found.iter().reduce(|best, o| if peak(o) > peak(best) { o } else { best }),
        o => return Err(format!("strip {sid}: align.onset {o}")),
    };
    let onset = onset.ok_or(format!("strip {sid}: align finds no onset in its asset"))?;
    Ok(Some(to - into_strip(onset.sample, &strip.source, strip.r#in, strip.rate)))
}

/// The document's sound cues, each moving its strip in `strips`, and what each resolved to.
pub fn cues(d: &Value, strips: &mut [Strip]) -> Map<String, Value> {
    let mut out = Map::new();
    let empty = Map::new();
    for (id, c) in d.get("cues").and_then(Value::as_object).unwrap_or(&empty) {
        let reply = match cue(d, c, strips) {
            Ok(lands) => json!({"state": "resolved", "lands": lands}),
            Err(why) => json!({"state": "BLOCKED", "reason": format!("cue `{id}`: {why}")}),
        };
        out.insert(id.clone(), reply);
    }
    out
}

fn cue(d: &Value, c: &Value, strips: &mut [Strip]) -> Result<i64, String> {
    let target = c.get("cue").and_then(Value::as_str).ok_or("it names no strip to cue")?;
    let strip = strips.iter_mut().find(|s| s.id == target).ok_or(format!("`{target}` is not a strip"))?;
    match c.get("move").and_then(Value::as_str).unwrap_or("sound") {
        "sound" => {}
        m => return Err(format!("move: {m} on strip `{target}`; a strip cue moves its sound")),
    }
    let moment = match c.get("moment") {
        None => return Err("it has no moment to land on".into()),
        v => doc::time(d, v).ok_or("its moment is not a time")?,
    };
    let offset = match c.get("offset") {
        None => 0,
        v => doc::time(d, v).ok_or("its offset is not a time")?,
    };
    let at = (moment + offset) as i128;
    let lands = match c.get("land").and_then(Value::as_str).unwrap_or("frame") {
        "frame" => {
            let (p, q) = doc::rate(d.pointer("/transport/frame_rate"))
                .filter(|_| d.pointer("/transport/frame_rate").is_some())
                .ok_or("land: frame needs the transport's frame_rate")?;
            let frame = FLICKS as i128 * q as i128;
            // The first frame that shows the moment: ⌈t ÷ Δ⌉ · Δ, in integer arithmetic.
            (ceil_div(at * p as i128, frame) * frame / p as i128) as i64
        }
        "sample" => {
            let rate = d.pointer("/transport/sample_rate").and_then(Value::as_i64).unwrap_or(48_000).max(1) as i128;
            (ceil_div(at * rate, FLICKS as i128) * FLICKS as i128 / rate) as i64
        }
        l => return Err(format!("land: {l}")),
    };
    let anchor = c.get("anchor").and_then(Value::as_str).unwrap_or("");
    let found = onsets_of(&strip.source);
    let in_sample = (strip.r#in as i128 * strip.source.rate as i128).div_euclid(FLICKS as i128) as i64;
    let onset = found
        .iter()
        .find(|o| o.sample >= in_sample)
        .ok_or(format!("the onset bake of strip `{target}`'s asset finds no attack for its {anchor} anchor"))?;
    let sample = match anchor {
        "onset" => onset.sample,
        "peak" => onset.peak,
        a => return Err(format!("anchor `{a}` doesn't resolve on strip `{target}`: a strip cue reads its onset or peak")),
    };
    strip.start = lands - into_strip(sample, &strip.source, strip.r#in, strip.rate);
    Ok(lands)
}

/// A spawn's strip template: its source, in, out and rate.
struct Template {
    source: Arc<Source>,
    r#in: i64,
    out: i64,
    rate: (i64, i64),
}

/// A time remap's map (parent flick → child flick), as keys.
struct Remap {
    keys: Vec<(i64, i64, bool)>,
}

impl Remap {
    /// The constant rate (child per parent) as a reduced fraction, if the map has one.
    fn constant(&self) -> Option<(i64, i64)> {
        if self.keys.len() < 2 {
            return Some((1, 1));
        }
        let slope = |w: &[(i64, i64, bool)]| (w[1].1 as i128 - w[0].1 as i128, w[1].0 as i128 - w[0].0 as i128);
        let (p, q) = slope(&self.keys[..2]);
        let same = self.keys.windows(2).all(|w| {
            let (a, b) = slope(w);
            w[0].2 && a * q == p * b
        });
        (same && p > 0 && q > 0).then(|| reduced(p, q))
    }

    /// The first parent flick at which the child reaches `c`.
    fn parent(&self, c: i64) -> i64 {
        let k = &self.keys;
        match k.len() {
            0 => c,
            1 => c - k[0].1 + k[0].0,
            n => {
                let i = (0..n - 1).find(|&i| c <= k[i + 1].1).unwrap_or(n - 2);
                let (t0, v0, t1, v1) = (k[i].0 as i128, k[i].1 as i128, k[i + 1].0 as i128, k[i + 1].1 as i128);
                if v1 == v0 {
                    return t0 as i64;
                }
                (t0 + ceil_div((c as i128 - v0) * (t1 - t0), v1 - v0)) as i64
            }
        }
    }
}

/// One planned voice: its spawn, occurrence and index among the spawn's voices, the spawn-local
/// index of the voice that stole it, its strip and its line in the reply.
struct Planned {
    spawn: String,
    occurrence: usize,
    local: usize,
    stolen_by: Option<usize>,
    strip: Strip,
    report: Value,
}

/// A live play's decoded assets, by SHA-256, as [`Hub::voices`] reads them (#525).
pub(crate) type Sources<'s> = &'s mut dyn FnMut(&str) -> Result<Arc<Source>, Value>;

impl Hub<'_> {
    /// Every spawn's voices as strips, and the reply's `voices`: in start order, ties by spawn
    /// ID, then occurrence index.
    pub(crate) fn spawned(&mut self, d: &Value, master: usize) -> Result<(Vec<Strip>, Vec<Value>), Value> {
        let planted = self.scenario.module_planted.clone();
        Hub::voices(d, master, planted.as_deref(), &mut |sha| self.source(sha))
    }

    /// [`Hub::spawned`] with the module's wrong program `planted` and the assets from `source`,
    /// which a live play holds decoded (#525).
    pub(crate) fn voices(d: &Value, master: usize, planted: Option<&str>, source: Sources) -> Result<(Vec<Strip>, Vec<Value>), Value> {
        let bad = |what: String| json!({"code": "bad_media", "what": what});
        let empty = Map::new();
        let obj = |k: &str| d.get(k).and_then(Value::as_object).unwrap_or(&empty);
        let planted = |p: &str| planted == Some(p);
        let ms = FLICKS / 1000;
        let three_d = d.get("scene").is_some_and(Value::is_object);
        let (ear, right) = listener(d);
        // Each item's place by the body it shows.
        let bodies: BTreeMap<i64, [f64; 3]> = d
            .pointer("/scene/items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(_, it)| Some((it.get("body")?.as_i64()?, vec3(it.get("position"))?)))
            .collect();
        let mut all: Vec<Planned> = Vec::new();
        let mut spawns: Vec<(&String, &Value)> = obj("spawns").iter().collect();
        spawns.sort_by(|a, b| a.0.cmp(b.0));
        for (sid, sp) in spawns {
            let on = sp.get("on").ok_or_else(|| bad(format!("spawn {sid}: on")))?;
            let list = on.get("list").and_then(Value::as_str).ok_or_else(|| bad(format!("spawn {sid}: on.list")))?;
            // gain and pan: a number, or an expression over the occurrence's fields (#544).
            let num = |k: &str| match sp.get(k) {
                None => Ok(None),
                Some(Value::String(text)) => Expr::compile(text, &Nothing, 64)
                    .map(|e| Some(Num::Expr(e)))
                    .map_err(|r| bad(format!("spawn {sid}: {k} `{text}`: {}", r.why))),
                Some(v) => v.as_f64().map(|n| Some(Num::Fixed(n))).ok_or_else(|| bad(format!("spawn {sid}: {k} is a number or an expression"))),
            };
            let (gain, pan, pitch) = (num("gain")?, num("pan")?, num("pitch")?);
            // A field a row lacks reads as NaN; the planted twin reads an undeclared one as 0.
            let missing = if planted("undeclared_field_reads_zero") { 0.0 } else { f64::NAN };
            if !matches!(pitch, None | Some(Num::Fixed(0.0))) {
                return Err(bad(format!("spawn {sid}: pitch isn't read here")));
            }
            let kinds_of = |k: &str| -> Option<Vec<String>> {
                Some(on.get(k)?.as_array()?.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            };
            if !planted("undeclared_field_reads_zero") {
                if let Some(mut u) = undeclared(d, sid, sp) {
                    u["code"] = json!("occurrence.undeclared");
                    return Err(u);
                }
            }
            let Some(rows) = obj("occurrences").get(list).and_then(Value::as_array) else {
                return Err(json!({"code": "unbaked_list", "spawn": sid, "list": list,
                    "why": format!("spawn {sid} reads `{list}`, which isn't a baked occurrence list in the document")}));
            };
            if on.get("where").is_some() {
                return Err(bad(format!("spawn {sid}: on.where isn't read here")));
            }
            let (kinds, tags) = (kinds_of("kinds"), kinds_of("tags"));
            let keep = |r: &Value| {
                let kind = r.get("kind").and_then(Value::as_str).unwrap_or("");
                let has = |t: &String| r.get("tags").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.as_str() == Some(t)));
                kinds.as_ref().is_none_or(|k| k.iter().any(|x| x == kind))
                    && tags.as_ref().is_none_or(|t| t.iter().all(has))
                    && ["a", "b"].iter().all(|k| on.get(*k).is_none_or(|v| r.get(*k) == Some(v)))
            };
            // Templates and their weights.
            let entries: Vec<(&Value, f64)> = match sp.get("play") {
                Some(Value::Array(a)) => a
                    .iter()
                    .map(|e| Some((e.get("template")?, e.get("weight").map_or(Some(1.0), Value::as_f64)?)))
                    .collect::<Option<_>>()
                    .ok_or_else(|| bad(format!("spawn {sid}: play")))?,
                Some(t) => vec![(t, 1.0)],
                None => return Err(bad(format!("spawn {sid}: play"))),
            };
            let mut templates = Vec::new();
            for (t, _) in &entries {
                let sha = doc::strip_asset(t).ok_or_else(|| bad(format!("spawn {sid}: a template's src.asset")))?;
                let source = source(sha)?;
                let time = |k: &str| doc::time(d, t.get(k)).ok_or_else(|| bad(format!("spawn {sid}: a template's {k}")));
                let r#in = time("in")?;
                let out = if t.get("out").is_some() { time("out")? } else { source.duration() };
                let rate = doc::rate(t.get("rate")).ok_or_else(|| bad(format!("spawn {sid}: a template's rate")))?;
                templates.push(Template { source, r#in, out, rate });
            }
            let pick = match sp.get("pick").and_then(Value::as_str).unwrap_or("weighted") {
                "weighted" => Pick::Weighted,
                "no_repeat" => Pick::NoRepeat,
                p => return Err(bad(format!("spawn {sid}: pick {p} (by_variant lands with foley@1)"))),
            };
            let steal = match sp.get("steal").and_then(Value::as_str).unwrap_or("oldest") {
                "oldest" => Steal::Oldest,
                "furthest" => Steal::Furthest,
                "quietest" => Steal::Quietest,
                "none" => Steal::None,
                s => return Err(bad(format!("spawn {sid}: steal {s}"))),
            };
            let max_voices = sp.get("max_voices").map_or(Some(8), Value::as_u64).filter(|n| (1..=64).contains(n));
            let max_voices = max_voices.ok_or_else(|| bad(format!("spawn {sid}: max_voices (1 to 64)")))? as usize;
            let cooldown = match sp.get("cooldown") {
                None => 30 * ms,
                v => doc::time(d, v).ok_or_else(|| bad(format!("spawn {sid}: cooldown")))?,
            };
            let seed = match sp.get("seed") {
                None => String::new(),
                Some(Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
            };
            let at = sp.get("at").and_then(Value::as_str).unwrap_or("point");
            if !["point", "a", "b", "none"].contains(&at) {
                return Err(bad(format!("spawn {sid}: at {at}")));
            }
            let distance = match sp.get("distance") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) if s == "none" => None,
                Some(o @ Value::Object(_)) => {
                    let f = |k: &str, dflt: f64| o.get(k).and_then(Value::as_f64).unwrap_or(dflt);
                    let model = match o.get("model").and_then(Value::as_str) {
                        None | Some("inverse") => Model::Inverse,
                        Some("linear") => Model::Linear,
                        Some("exponential") => Model::Exponential,
                        Some(m) => return Err(bad(format!("spawn {sid}: distance model {m}"))),
                    };
                    Some(Distance { model, reference: f("ref", 1.0), max: f("max", 10_000.0), rolloff: f("rolloff", 1.0) })
                }
                Some(_) => return Err(bad(format!("spawn {sid}: distance"))),
            };
            let follow = sp.get("follow_remap").and_then(Value::as_bool).unwrap_or(false);
            let bus = master;
            // The remap over the list's world, if one.
            let world = list.strip_suffix(".occurrences").unwrap_or(list);
            let remap = obj("remaps")
                .values()
                .find(|r| r.get("target").and_then(Value::as_str) == Some(world))
                .map(|r| -> Result<Remap, Value> {
                    let keys = r
                        .pointer("/map/keys")
                        .and_then(Value::as_array)
                        .and_then(|k| {
                            k.iter()
                                .map(|k| {
                                    let linear = k.get("interp").and_then(Value::as_str) != Some("hold");
                                    Some((k.get("t")?.as_i64()?, k.get("value")?.as_i64()?, linear))
                                })
                                .collect::<Option<Vec<_>>>()
                        })
                        .ok_or_else(|| bad(format!("remap over {world}: map.keys")))?;
                    let mut keys = keys;
                    keys.sort_by_key(|k| k.0);
                    Ok(Remap { keys })
                })
                .transpose()?;
            let rate_of_remap = remap.as_ref().map(Remap::constant);
            // The point each occurrence is heard from, in 3D.
            let heard = |r: &Value| -> Option<[f64; 3]> {
                if !three_d || pan.is_some() {
                    return None;
                }
                let body = |k: &str| r.get(k).and_then(Value::as_i64).and_then(|b| bodies.get(&b).copied());
                match at {
                    "point" if planted("spawn_pans_from_item_origin") => body("a").or_else(|| body("b")),
                    "point" => vec3(r.get("point")),
                    "a" => body("a"),
                    "b" => body("b"),
                    _ => None,
                }
            };
            let mut index = Vec::new();
            let mut occs = Vec::new();
            for (k, r) in rows.iter().enumerate().filter(|(_, r)| keep(r)) {
                let t = r.get("t").and_then(Value::as_i64).ok_or_else(|| bad(format!("{list}[{k}]: t")))?;
                let start = match &remap {
                    Some(m) if !planted("spawn_starts_at_child_flick") => m.parent(t),
                    _ => t,
                };
                let distance = heard(r).map_or(0.0, |p| {
                    let v = [p[0] - ear[0], p[1] - ear[1], p[2] - ear[2]];
                    deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
                });
                let id = |k: &str| r.get(k).map_or_else(String::new, Value::to_string);
                index.push(k);
                let gain = gain.as_ref().map_or(1.0, |g| 10f64.powf(g.at(r, missing) / 20.0));
                occs.push(Occ { t, start, pair: (id("a"), id("b")), gain, distance });
            }
            let plan = Plan {
                id: sid.clone(),
                seed,
                weights: entries.iter().map(|e| e.1).collect(),
                pick,
                cooldown: if planted("spawn_ignores_cooldown") { 0 } else { cooldown },
                max_voices,
                steal,
            };
            let rate_of = |t: &Template| match rate_of_remap {
                Some(Some((p, q))) if follow => reduced(t.rate.0 as i128 * p as i128, t.rate.1 as i128 * q as i128),
                _ => t.rate,
            };
            let length = |t: &Template| {
                let (p, q) = rate_of(t);
                ceil_div((t.out - t.r#in).max(0) as i128 * q as i128, p as i128) as i64
            };
            let voices = spawn::plan(&plan, &occs, |k| length(&templates[k]));
            for (n, v) in voices.iter().enumerate() {
                let t = &templates[v.template];
                let row = &rows[index[v.occurrence]];
                let span = v.stop.map_or(length(t), |s| s - v.start);
                let emitter = heard(row).map(|source| Emit {
                    id: format!("{sid}.{n}"),
                    distance: distance.unwrap_or(Distance { rolloff: 0.0, ..Distance::default() }),
                    cone: Cone::default(),
                    place: Arc::new(move |_| Place { source, forward: [0.0, 0.0, 1.0], listener: ear, right }),
                });
                let rate = rate_of(t);
                let strip = Strip {
                    id: format!("{sid}.{n}"),
                    source: t.source.clone(),
                    start: v.start,
                    r#in: t.r#in,
                    out: t.out,
                    rate,
                    gain: Gain::Db(gain.as_ref().map_or(0.0, |g| g.at(row, missing))),
                    pan: pan.as_ref().map_or(0.0, |p| p.at(row, missing)),
                    fade_in: None,
                    fade_out: None,
                    looped: false,
                    span,
                    bus,
                    // Audio under a remap is muted unless its rate is constant.
                    disabled: if matches!(rate_of_remap, Some(None)) { vec![(i64::MIN, i64::MAX)] } else { Vec::new() },
                    emitter,
                };
                let report = json!({"spawn": sid, "occurrence": index[v.occurrence],
                    "pair": [row.get("a").cloned().unwrap_or(Value::Null), row.get("b").cloned().unwrap_or(Value::Null)],
                    "template": v.template, "start": v.start, "end": v.start + span, "rate": [rate.0, rate.1]});
                all.push(Planned { spawn: sid.clone(), occurrence: index[v.occurrence], local: n, stolen_by: v.stolen_by, strip, report });
            }
        }
        all.sort_by(|a, b| (a.strip.start, &a.spawn, a.occurrence).cmp(&(b.strip.start, &b.spawn, b.occurrence)));
        let global: BTreeMap<(&str, usize), usize> = all.iter().enumerate().map(|(g, v)| ((v.spawn.as_str(), v.local), g)).collect();
        let stolen: Vec<Option<usize>> = all.iter().map(|v| v.stolen_by.map(|k| global[&(v.spawn.as_str(), k)])).collect();
        let mut strips = Vec::new();
        let mut reports = Vec::new();
        for (mut v, stolen_by) in all.into_iter().zip(stolen) {
            v.report["stolen_by"] = json!(stolen_by);
            strips.push(v.strip);
            reports.push(v.report);
        }
        Ok((strips, reports))
    }
}

/// What a spawn on a logic item's occurrences reads that the item doesn't declare in `emits` (a
/// kind its filter names, or a field its gain or pan expression reads): `{spawn, reader, list,
/// name, close, why}`, from the document alone, before any step runs (#544).
pub(crate) fn undeclared(d: &Value, sid: &str, sp: &Value) -> Option<Value> {
    let on = sp.get("on")?;
    let list = on.get("list")?.as_str()?;
    let item = d.get("items")?.get(list.strip_suffix(".occurrences")?)?;
    if item.get("kind").and_then(Value::as_str) != Some("logic@1") {
        return None;
    }
    let emits = item.pointer("/params/emits").and_then(Value::as_object).cloned().unwrap_or_default();
    let kinds: Option<Vec<String>> = on.get("kinds").and_then(Value::as_array).map(|a| a.iter().filter_map(|k| k.as_str().map(str::to_string)).collect());
    let exprs: Vec<Expr> = ["gain", "pan"].iter().filter_map(|k| Expr::compile(sp.get(*k)?.as_str()?, &Nothing, 64).ok()).collect();
    let fields: Vec<&str> = exprs.iter().flat_map(|e| e.vars.iter().map(String::as_str)).collect();
    let (name, close) = deep_canvas::document::undeclared(&emits, kinds.as_deref(), &fields)?;
    let logic = list.trim_end_matches(".occurrences");
    Some(json!({"spawn": sid, "reader": format!("spawns/{sid}"), "list": list, "name": name, "close": close,
        "why": format!("spawn {sid} reads `{name}`, which {logic} doesn't declare in emits")}))
}

/// Each spawn's [`undeclared`] read, as the check's error on it.
pub(crate) fn undeclared_issues(d: &Value) -> Vec<deep_canvas::document::Issue> {
    let spawns = d.get("spawns").and_then(Value::as_object).into_iter().flatten();
    spawns
        .filter_map(|(sid, sp)| {
            let u = undeclared(d, sid, sp)?;
            let close = u["close"].as_array().into_iter().flatten().map(|n| json!({"name": n})).collect();
            let why = u["why"].as_str().unwrap_or_default().to_string();
            Some(deep_canvas::document::Issue {
                close,
                ..deep_canvas::document::Issue::envelope("occurrence.undeclared", format!("spawns/{sid}"), u, &why)
            })
        })
        .collect()
}

/// A spawn's gain or pan: a number, or an expression over its occurrence's fields.
enum Num {
    Fixed(f64),
    Expr(Expr),
}

impl Num {
    /// Its value for an occurrence row, a field the row lacks reading as `missing`.
    fn at(&self, row: &Value, missing: f64) -> f64 {
        match self {
            Num::Fixed(n) => *n,
            Num::Expr(e) => {
                let vars: Vec<f64> = e.vars.iter().map(|v| row.get(v).and_then(Value::as_f64).unwrap_or(missing)).collect();
                e.eval_num(&vars)
            }
        }
    }
}

fn vec3(v: Option<&Value>) -> Option<[f64; 3]> {
    let a = v?.as_array()?;
    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
}
