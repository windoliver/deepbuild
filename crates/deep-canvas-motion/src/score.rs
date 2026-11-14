//! #154: a score, `score.music@1` (canvas primitives: Score `score.music@1` and `score.render@1`,
//! As built), read at check. Each event's onset resolves through the document's tempo map and
//! markers to a flick and to the 48 kHz sample it rounds to, its length in beats from its own beat
//! position, and the check refuses, naming the event, a note on a sustained pad below MIDI 48
//! unless its instrument is marked `bass`, and a note held over 60 s. What it reads is what the
//! render plan hands each stem's job, so the job never resolves a time itself.

use std::collections::BTreeMap;

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::registry::Raised;
use deep_canvas::schedule::Hasher;
use serde_json::{json, Map, Value};

use crate::doc::{self, Ctx};
use crate::tempo::Tempo;

/// The stems' sample rate.
pub const RATE: i64 = 48_000;
const PER_SAMPLE: i64 = FLICKS_PER_SECOND / RATE;
/// A held note's longest: 60 s.
pub const HELD_MAX: i64 = 60 * FLICKS_PER_SECOND;
/// A sustained pad's lowest note, unless its instrument is marked `bass`.
pub const PAD_LOWEST: f64 = 48.0;
pub const PLUCKS: [&str; 3] = ["nylon", "steel", "harp"];
pub const SYNTHS: [&str; 5] = ["sine", "triangle", "saw", "square", "pad"];

/// #204: a synth instrument may name a pack's preset as `<pack>.<name>@<major>`.
pub fn pack_preset(name: &str) -> bool {
    let Some((pack, rest)) = name.split_once('.') else {
        return false;
    };
    let Some((preset, major)) = rest.rsplit_once('@') else {
        return false;
    };
    !pack.is_empty()
        && !preset.is_empty()
        && !major.is_empty()
        && major.bytes().all(|b| b.is_ascii_digit())
}

/// An instrument's source, read from either `{sampled: {...}}` or `{type: "sampled", ...}`.
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Sampled { library: String, preset: String },
    Pluck { preset: String, overrides: Value },
    Synth { preset: String },
}

#[derive(Clone, Debug)]
pub struct Instrument {
    pub id: String,
    pub source: Source,
    pub stem: String,
    pub bass: bool,
}

/// One event, resolved.
#[derive(Clone, Debug)]
pub struct Note {
    pub id: String,
    pub inst: String,
    pub stem: String,
    /// Its declared onset, in flicks.
    pub t: i64,
    /// The 48 kHz sample its onset rounds to.
    pub sample: i64,
    /// Its length in flicks and in samples.
    pub dur: i64,
    pub dur_samples: i64,
    pub pitch: f64,
    /// Its other fields as written: vel, pan, gain, attack, release, bend, vib.
    pub rest: Map<String, Value>,
}

/// A score as its check resolved it.
#[derive(Clone, Debug)]
pub struct Score {
    pub seed: String,
    pub instruments: BTreeMap<String, Instrument>,
    /// In (onset, event ID) order.
    pub notes: Vec<Note>,
    /// The loop region in flicks, declared or (`looping`) by default.
    pub loop_region: Option<(i64, i64)>,
}

/// One thing the check found: an error refuses the score, a warning doesn't.
#[derive(Clone, Debug, PartialEq)]
pub struct Problem {
    pub code: &'static str,
    pub severity: &'static str,
    pub path: String,
    pub what: String,
}

fn error(code: &'static str, path: String, what: String) -> Problem {
    Problem {
        code,
        severity: "error",
        path,
        what,
    }
}

/// The score's seed: hash(its item ID).
pub fn seed_of(id: &str) -> String {
    Hasher::v1("score.seed").text(id).finish().hex()
}

/// The 48 kHz sample `t` rounds to, a half away from zero.
pub fn sample_of(t: i64) -> i64 {
    let (q, r) = (t.div_euclid(PER_SAMPLE), t.rem_euclid(PER_SAMPLE));
    if 2 * r >= PER_SAMPLE {
        q + 1
    } else {
        q
    }
}

/// A pitch as MIDI: a number, or a name such as `C4` (60), `F#3` or `Bb2`.
pub fn midi_of(v: &Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    let s = v.as_str()?.trim();
    let mut chars = s.chars();
    let base = match chars.next()?.to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let rest = chars.as_str();
    let (shift, octave) = match rest.chars().next()? {
        '#' => (1, &rest[1..]),
        'b' => (-1, &rest[1..]),
        _ => (0, rest),
    };
    let octave: i64 = octave.parse().ok()?;
    Some(((octave + 1) * 12 + base + shift) as f64)
}

/// A seconds literal, `"0.25s"`, as seconds.
fn seconds(text: &str) -> Option<f64> {
    text.strip_suffix('s')?
        .trim()
        .parse()
        .ok()
        .filter(|v: &f64| v.is_finite())
}

/// `"bar:beat"`, with or without the `b`, its beat possibly fractional.
fn bar_beat(text: &str) -> Option<(u64, f64)> {
    let text = text.strip_suffix('b').unwrap_or(text);
    let (bar, beat) = text.split_once(':')?;
    Some((
        bar.parse().ok()?,
        beat.parse().ok().filter(|b: &f64| b.is_finite())?,
    ))
}

fn source_of(v: &Value) -> Option<Source> {
    let (kind, body) = match v.get("type").and_then(Value::as_str) {
        Some(kind) => (kind, v),
        None => {
            let o = v.as_object()?;
            let (k, body) = o.iter().next().filter(|_| o.len() == 1)?;
            (k.as_str(), body)
        }
    };
    let text = |k: &str| body.get(k).and_then(Value::as_str).map(str::to_string);
    match kind {
        "sampled" => Some(Source::Sampled {
            library: text("library")?,
            preset: text("preset")?,
        }),
        "pluck" => Some(Source::Pluck {
            preset: text("preset")?,
            overrides: body.get("overrides").cloned().unwrap_or(json!({})),
        }),
        "synth" => Some(Source::Synth {
            preset: text("preset")?,
        }),
        _ => None,
    }
}

/// The document's time context: its frame rate, its tempo map and its markers.
fn context(doc: &Map<String, Value>) -> Result<Ctx, Problem> {
    let refused = |r: doc::Refused| {
        error(
            r.code,
            r.path.clone(),
            format!("the document's time doesn't resolve at {}", r.path),
        )
    };
    let transport = doc.get("transport").and_then(Value::as_object);
    let mut ctx = Ctx::of(doc::frame_rate_of(transport).map_err(refused)?);
    ctx.tempo = Tempo::read(doc, &ctx.time, false).map_err(refused)?;
    doc::markers_of(doc, &mut ctx).map_err(refused)?;
    Ok(ctx)
}

/// Whether a strip with `loop: true` plays one of the score's stems: then its region defaults.
fn looped_by_strip(doc: &Map<String, Value>, id: &str) -> bool {
    let names = |s: &Value| {
        s.get("loop").and_then(Value::as_bool) == Some(true)
            && s.pointer("/src/score").and_then(Value::as_str) == Some(id)
    };
    let strips = doc
        .get("strips")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values());
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values())
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("media.strip@1"))
        .filter_map(|i| i.get("params"));
    strips.chain(items).any(names)
}

/// The score item `id` of `doc`, resolved; or every error that refuses it. Warnings come with it.
pub fn read(doc: &Value, id: &str) -> Result<(Score, Vec<Problem>), Vec<Problem>> {
    let Some(d) = doc.as_object() else {
        return Err(vec![error(
            "bad_doc",
            String::new(),
            "a document is an object".into(),
        )]);
    };
    let base = format!("items/{id}/params");
    let params = d
        .get("items")
        .and_then(|i| i.get(id))
        .and_then(|i| i.get("params"))
        .cloned()
        .unwrap_or(Value::Null);
    let ctx = context(d).map_err(|p| vec![p])?;
    let mut problems = Vec::new();

    let mut instruments = BTreeMap::new();
    for (iid, inst) in params
        .get("instruments")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let path = format!("{base}/instruments/{iid}");
        let Some(source) = inst.get("source").and_then(source_of) else {
            problems.push(error("score.unknown_source", format!("{path}/source"), format!("the instrument {iid}'s source is sampled {{library, preset}}, pluck {{preset}} or synth {{preset}}")));
            continue;
        };
        match &source {
            Source::Pluck { preset, .. } if !PLUCKS.contains(&preset.as_str()) => {
                problems.push(error(
                    "score.unknown_preset",
                    format!("{path}/source"),
                    format!(
                    "the instrument {iid} names the pluck preset {preset}, which isn't one of {}",
                    PLUCKS.join(", ")
                ),
                ))
            }
            // #204: or a pack's synth preset, `<pack>.<name>@<major>`, which the host resolves.
            Source::Synth { preset }
                if !SYNTHS.contains(&preset.as_str()) && !pack_preset(preset) =>
            {
                problems.push(error(
                    "score.unknown_preset",
                    format!("{path}/source"),
                    format!(
                    "the instrument {iid} names the synth preset {preset}, which isn't one of {}",
                    SYNTHS.join(", ")
                ),
                ))
            }
            _ => {}
        }
        let stem = inst
            .get("stem")
            .and_then(Value::as_str)
            .unwrap_or(iid)
            .to_string();
        let bass = inst.get("bass").and_then(Value::as_bool).unwrap_or(false);
        instruments.insert(
            iid.clone(),
            Instrument {
                id: iid.clone(),
                source,
                stem,
                bass,
            },
        );
    }

    let tempo = ctx.tempo.as_ref();
    let mut notes = Vec::new();
    for (eid, e) in params
        .get("events")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let path = format!("{base}/events/{eid}");
        let named = |code: &'static str, what: String| {
            error(code, path.clone(), format!("the event {eid}: {what}"))
        };
        let Some(inst) = e
            .get("inst")
            .and_then(Value::as_str)
            .and_then(|i| instruments.get(i))
        else {
            problems.push(named(
                "score.unknown_instrument",
                format!(
                    "names the instrument {}, which the score doesn't hold",
                    e.get("inst").unwrap_or(&Value::Null)
                ),
            ));
            continue;
        };
        let Some(pitch) = e.get("pitch").and_then(midi_of) else {
            problems.push(named(
                "score.bad_pitch",
                "its pitch is a MIDI number or a name such as C4".into(),
            ));
            continue;
        };
        // The onset, and its beat position for a length in beats.
        let at = e.get("at");
        let resolved: Result<(i64, Option<f64>), String> = match at {
            Some(Value::String(text)) if bar_beat(text).is_some() => {
                let (bar, beat) = bar_beat(text).unwrap_or_default();
                match tempo {
                    None => Err(format!(
                        "its onset {text} is a bar:beat and the document has no tempo map"
                    )),
                    Some(tm) => tm
                        .position(bar, beat)
                        .and_then(|x| Ok((tm.at_position(x)?, Some(x)))),
                }
            }
            // A number is a time as the document stores one: whole flicks.
            Some(Value::Number(n)) => n
                .as_i64()
                .or_else(|| {
                    n.as_f64()
                        .filter(|f| f.is_finite())
                        .map(|f| f.round() as i64)
                })
                .map(|t| (t, None))
                .ok_or_else(|| "its onset isn't a time".into()),
            Some(v @ Value::String(_)) => {
                match doc::time_of(Some(v), &ctx, &format!("{path}/at")) {
                    Ok(t) => Ok((t, None)),
                    Err(r) => Err(format!("its onset {v} doesn't resolve ({})", r.code)),
                }
            }
            _ => Err("it has no onset `at`".into()),
        };
        let (mut t, position) = match resolved {
            Ok(r) => r,
            Err(why) => {
                problems.push(named("score.time_unresolved", why));
                continue;
            }
        };
        if let Some(strum) = e.get("strum").and_then(Value::as_f64) {
            t += (strum * FLICKS_PER_SECOND as f64).round() as i64;
        }
        // The length: a number or "Nb" in beats from its own beat position, "Ns" in seconds.
        let end: Result<i64, String> = match e.get("dur") {
            Some(Value::String(s)) if s.ends_with('s') => s[..s.len() - 1]
                .parse::<f64>()
                .map(|v| t + (v * FLICKS_PER_SECOND as f64).round() as i64)
                .map_err(|_| format!("its length {s} isn't a number of seconds")),
            Some(v) => {
                let beats = v.as_f64().or_else(|| {
                    v.as_str()
                        .and_then(|s| s.strip_suffix('b'))
                        .and_then(|s| s.parse().ok())
                });
                match (beats, tempo) {
                    (None, _) => Err("its length is beats or seconds (\"1.5s\")".into()),
                    (Some(_), None) => {
                        Err("its length is in beats and the document has no tempo map".into())
                    }
                    (Some(b), Some(tm)) => {
                        let from = position.unwrap_or_else(|| tm.position_of(t));
                        tm.at_position(from + b)
                            .map(|end| end + (t - tm.at_position(from).unwrap_or(t)))
                    }
                }
            }
            None => Err("it has no length `dur`".into()),
        };
        let end = match end {
            Ok(end) if end > t => end,
            Ok(_) => {
                problems.push(named(
                    "score.bad_duration",
                    "its length isn't positive".into(),
                ));
                continue;
            }
            Err(why) => {
                problems.push(named("score.bad_duration", why));
                continue;
            }
        };
        let dur = end - t;
        if dur > HELD_MAX {
            problems.push(named(
                "score.note_too_long",
                format!(
                    "it is held {:.3} s, over 60 s",
                    dur as f64 / FLICKS_PER_SECOND as f64
                ),
            ));
        }
        let pad = matches!(&inst.source, Source::Synth { preset } if preset == "pad");
        if pad && !inst.bass && pitch < PAD_LOWEST {
            problems.push(named("score.pad_too_low", format!("it plays MIDI {pitch} on the sustained pad {}, below MIDI 48, and the instrument isn't marked bass", inst.id)));
        }
        // Attack and release are seconds, written `"0.01s"` or as a number; the tool reads numbers.
        let rest = ["vel", "pan", "gain", "attack", "release", "bend", "vib"]
            .iter()
            .filter_map(|k| {
                let v = e.get(*k)?;
                let v = match (*k, v.as_str()) {
                    ("attack" | "release", Some(text)) => json!(seconds(text)?),
                    _ => v.clone(),
                };
                Some((k.to_string(), v))
            })
            .collect();
        let sample = sample_of(t);
        notes.push(Note {
            id: eid.clone(),
            inst: inst.id.clone(),
            stem: inst.stem.clone(),
            t,
            sample,
            dur,
            dur_samples: (sample_of(end) - sample).max(1),
            pitch,
            rest,
        });
    }
    notes.sort_by(|a, b| (a.t, &a.id).cmp(&(b.t, &b.id)));

    let declared = params.get("loop").filter(|l| !l.is_null());
    let loop_region = match (declared, tempo) {
        (Some(l), Some(tm)) => {
            let at = |k: &str| {
                l.get(k)
                    .and_then(Value::as_str)
                    .and_then(bar_beat)
                    .ok_or_else(|| format!("its loop's {k} is a bar:beat"))
                    .and_then(|(bar, beat)| tm.at_position(tm.position(bar, beat)?))
            };
            match (at("from"), at("to")) {
                (Ok(a), Ok(b)) if b > a => Some((a, b)),
                (Ok(_), Ok(_)) => {
                    problems.push(error(
                        "score.bad_loop",
                        format!("{base}/loop"),
                        "its loop ends before it starts".into(),
                    ));
                    None
                }
                (Err(why), _) | (_, Err(why)) => {
                    problems.push(error("score.bad_loop", format!("{base}/loop"), why));
                    None
                }
            }
        }
        (Some(_), None) => {
            problems.push(error(
                "score.bad_loop",
                format!("{base}/loop"),
                "a loop region is bar:beat and the document has no tempo map".into(),
            ));
            None
        }
        // By default, when a strip loops one of its stems: from its start to its last bar line.
        (None, Some(tm)) if looped_by_strip(d, id) && !notes.is_empty() => {
            let first = notes.iter().map(|n| n.t).min().unwrap_or(0);
            let last = notes.iter().map(|n| n.t + n.dur).max().unwrap_or(0);
            // The map's bar lines up to the first at or after the last note's end.
            let mut lines = Vec::new();
            let mut bar = 1;
            while let Some(at) = tm
                .position(bar, 1.0)
                .ok()
                .and_then(|p| tm.at_position(p).ok())
            {
                lines.push(at);
                if at >= last {
                    break;
                }
                bar += 1;
            }
            let start = lines.iter().rev().find(|&&b| b <= first).copied();
            let end = lines.iter().find(|&&b| b >= last).copied();
            start.zip(end).filter(|(a, b)| b > a)
        }
        _ => None,
    };

    let (errors, warnings): (Vec<_>, Vec<_>) =
        problems.into_iter().partition(|p| p.severity == "error");
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok((
        Score {
            seed: seed_of(id),
            instruments,
            notes,
            loop_region,
        },
        warnings,
    ))
}

/// The check's rule over a `score.music@1` item: each problem, naming its event.
pub fn rule(doc: &Value, id: &str, _item: &Value) -> Vec<Raised> {
    let raised = |p: Problem| Raised {
        code: p.code,
        severity: p.severity,
        path: p.path,
        what: p.what,
        fix_ops: None,
    };
    match read(doc, id) {
        Ok((_, warnings)) => warnings.into_iter().map(raised).collect(),
        Err(errors) => errors.into_iter().map(raised).collect(),
    }
}

/// `sound_lock {instruments}` (Film audit: craft@1, until #409 lands): every score instrument's
/// name is in the brief's sound palette; one that isn't fails, naming the item and the instrument.
pub fn sound_lock(lowered: &Value, input: &Value) -> deep_canvas::registry::Report {
    let mut out = deep_canvas::registry::Report::default();
    let Some(palette) = input.get("instruments").and_then(Value::as_array) else {
        out.blocked.push(json!({"code": "sound_lock.no_palette", "why": "the brief names no sound palette (instruments)"}));
        return out;
    };
    let palette: Vec<&str> = palette.iter().filter_map(Value::as_str).collect();
    for (id, item) in lowered
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if item.get("kind").and_then(Value::as_str) != Some("score.music@1") {
            continue;
        }
        for name in item
            .pointer("/params/instruments")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(k, _)| k)
        {
            if !palette.contains(&name.as_str()) {
                let raised = Raised {
                    code: "sound_lock.off_palette",
                    severity: "error",
                    path: format!("items/{id}/params/instruments/{name}"),
                    what: format!("the score {id}'s instrument {name} isn't in the brief's sound palette ({})", palette.join(", ")),
                    fix_ops: None,
                };
                out.raised.push((id.clone(), raised, json!(name)));
            }
        }
    }
    out
}

/// `mix.balance` (Film audit: craft@1, until #409 lands) reads the music bus's power bake from the
/// export; no export writes per-bus power bakes yet (#509), so it is BLOCKED, never PASS.
pub fn mix_balance(_lowered: &Value, input: &Value) -> deep_canvas::registry::Report {
    let mut out = deep_canvas::registry::Report::default();
    if input.pointer("/bakes/music").is_none() {
        out.blocked.push(json!({"code": "mix.balance.no_bake", "why": "the music bus has no per-bus power bake from an export (#509)"}));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(events: Value, instruments: Value) -> Value {
        json!({
            "tempo_map": {"segments": [{"bpm": 120, "meter": [4, 4], "span": 64}]},
            "items": {"s": {"kind": "score.music@1", "params": {"instruments": instruments, "events": events}}}
        })
    }

    /// The pad and held-note limits each with its boundary pair: MIDI 48 and 60 s pass, and
    /// MIDI 47.99 and 60.0001 s are refused, naming the event.
    #[test]
    fn pad_and_held_limits_hold_at_their_boundaries() {
        let pad = json!({"pad": {"source": {"synth": {"preset": "pad"}}}, "low": {"source": {"synth": {"preset": "pad"}}, "bass": true}});
        let ok = doc(
            json!({"a": {"at": "1:1", "inst": "pad", "pitch": 48, "dur": "60s"}, "b": {"at": "1:1", "inst": "low", "pitch": 40, "dur": 1}}),
            pad.clone(),
        );
        assert!(read(&ok, "s").is_ok(), "{:?}", read(&ok, "s").err());
        let low = doc(
            json!({"a": {"at": "1:1", "inst": "pad", "pitch": 47.99, "dur": 1}}),
            pad.clone(),
        );
        let e = read(&low, "s").unwrap_err();
        assert_eq!(
            (e[0].code, e[0].path.as_str()),
            ("score.pad_too_low", "items/s/params/events/a")
        );
        let long = doc(
            json!({"a": {"at": "1:1", "inst": "pad", "pitch": 60, "dur": "60.0001s"}}),
            pad,
        );
        assert_eq!(read(&long, "s").unwrap_err()[0].code, "score.note_too_long");
    }

    /// At 120 BPM a beat is half a second: bar 5 beat 1 sits 16 beats in, at 8 s, and a
    /// fractional beat and a length in beats land where the closed form puts them.
    #[test]
    fn onsets_resolve_through_the_tempo_map() {
        let d = doc(
            json!({"a": {"at": "5:1", "inst": "p", "pitch": "A4", "dur": 2}, "b": {"at": "5:2.5b", "inst": "p", "pitch": 60, "dur": "0.25s"}}),
            json!({"p": {"source": {"pluck": {"preset": "nylon"}}}}),
        );
        let (s, _) = read(&d, "s").unwrap();
        let a = &s.notes[0];
        assert_eq!(
            (a.t, a.sample, a.dur, a.pitch),
            (8 * FLICKS_PER_SECOND, 384_000, FLICKS_PER_SECOND, 69.0)
        );
        let b = &s.notes[1];
        assert_eq!(
            (b.t, b.sample, b.dur_samples, b.pitch),
            (
                8 * FLICKS_PER_SECOND + 3 * FLICKS_PER_SECOND / 4,
                420_000,
                12_000,
                60.0
            )
        );
    }
}
