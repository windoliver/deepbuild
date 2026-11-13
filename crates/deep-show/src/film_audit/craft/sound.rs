//! Issue #409: craft@1's sound checks (canvas primitives: Film audit: craft@1): accents, silences,
//! sound_coverage, sound_bridges, mix.balance and sound_lock, read from the film's mix as an export
//! renders it (its strips, when and on which bus they play, and its samples) and from its score.

use std::sync::Arc;

use deep_canvas_media::mix::{Mix, Planted as MixPlanted, Player};
use serde_json::{json, Map, Value};

use super::{flag, flicks, markers, moved, raise, seconds, secs, Ctx, Found, Planted};
use crate::hub::Hub;
use crate::shared::FLICKS;

/// A strip of the film's mix: when it plays and on which bus.
pub(super) struct Sound {
    start: i64,
    end: i64,
    bus: String,
}

/// Power in each band of `x` (mono at `rate`): `[edges[k], edges[k + 1])`, the last band from the
/// last edge to Nyquist; 4096-sample Hann frames.
fn band_powers(x: &[f32], rate: f64, edges: &[f64]) -> Vec<f64> {
    const N: usize = 4096;
    let mut out = vec![0.0; edges.len()];
    let window: Vec<f64> = (0..N)
        .map(|k| 0.5 - 0.5 * (std::f64::consts::TAU * k as f64 / N as f64).cos())
        .collect();
    for chunk in x.chunks(N).filter(|c| c.len() == N) {
        let mut re: Vec<f64> = chunk
            .iter()
            .zip(&window)
            .map(|(s, w)| f64::from(*s) * w)
            .collect();
        let mut im = vec![0.0; N];
        deep_canvas_media::analysis::fft::fft(&mut re, &mut im);
        for k in 1..N / 2 {
            let hz = k as f64 * rate / N as f64;
            if let Some(b) = edges.iter().rposition(|e| hz >= *e) {
                out[b] += re[k] * re[k] + im[k] * im[k];
            }
        }
    }
    out
}

impl Hub<'_> {
    /// The film's strips as its mix plays them: when and on which bus.
    fn sounds_of(&mut self, drawn: &Value) -> Result<Vec<Sound>, String> {
        let mix = self.mix_of(drawn).map_err(|e| e.to_string())?;
        Ok(mix
            .strips
            .iter()
            .map(|s| Sound {
                start: s.start,
                end: s.start + s.span,
                bus: mix
                    .buses
                    .get(s.bus)
                    .map(|b| b.id.clone())
                    .unwrap_or_default(),
            })
            .collect())
    }

    /// The film's mix (only bus `bus`'s strips, when named), rendered from `from` to `to` as
    /// interleaved stereo, and its rate.
    fn rendered(
        &mut self,
        drawn: &Value,
        bus: Option<&str>,
        from: i64,
        to: i64,
    ) -> Result<(Vec<f32>, f64), String> {
        let mut mix = self.mix_of(drawn).map_err(|e| e.to_string())?;
        if let Some(bus) = bus {
            let keep = mix
                .buses
                .iter()
                .position(|b| b.id == bus)
                .ok_or(format!("the film has no {bus} bus"))?;
            let Mix {
                rate,
                strips,
                buses,
                ..
            } = mix;
            let strips = strips.into_iter().filter(|s| s.bus == keep).collect();
            mix = Mix::new(rate, strips, buses)?;
        }
        let rate = mix.rate;
        let at = |t: i64| (i128::from(t) * i128::from(rate) / i128::from(FLICKS)) as i64;
        let (a, b) = (at(from), at(to));
        let mut player = Player::new(Arc::new(mix), MixPlanted::default());
        player.seek(a);
        let mut buf = vec![0f32; 2 * (b - a).max(0) as usize];
        player.read(&mut buf);
        Ok((buf, rate as f64))
    }

    fn sounds<'c>(&mut self, ctx: &'c mut Ctx) -> Result<&'c [Sound], String> {
        if ctx.sounds.is_none() {
            ctx.sounds = Some(self.sounds_of(&ctx.drawn));
        }
        match ctx.sounds.as_ref() {
            Some(Ok(s)) => Ok(s),
            Some(Err(e)) => Err(e.clone()),
            None => Err(String::new()),
        }
    }

    /// accents: each picture accent (a moment tagged `accent`, or a camera accent) lands within
    /// `within` frames of a sound starting, and each short sound (a hit) within as many of one.
    pub(super) fn accents(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let by_label = self.planted(flag(Planted::CameraByLabel));
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let within = fields.get("within").and_then(Value::as_f64).unwrap_or(1.0);
        let near = (within * film.frame as f64).round() as i64;
        let mut picture: Vec<i64> = markers(&drawn, "moment", Some("accent"))
            .into_iter()
            .map(|(_, t, _)| t)
            .collect();
        picture.extend((0..film.shots.len()).filter_map(|i| moved(&film, &drawn, i, by_label).1));
        picture.sort_unstable();
        picture.dedup();
        let out = match self.sounds(ctx) {
            Err(e) => Found {
                blocked: vec![
                    json!({"code": "craft.accents", "why": format!("the film's mix can't be read: {e}")}),
                ],
                ..Found::default()
            },
            Ok(sounds) => {
                let onsets: Vec<i64> = sounds.iter().map(|s| s.start).collect();
                let hits: Vec<i64> = sounds
                    .iter()
                    .filter(|s| secs(s.end - s.start) <= 0.5)
                    .map(|s| s.start)
                    .collect();
                let mut out = Found::default();
                for &t in &picture {
                    if !onsets.iter().any(|o| (o - t).abs() <= near) {
                        let shot = film.id_at(t).to_string();
                        out.issues.push(raise("accents", "craft.accents", "error", &[&shot], t,
                            format!("the picture's accent at {:.3} s has no sound starting within {within} frame(s)", secs(t))));
                    }
                }
                for &t in &hits {
                    if !picture.iter().any(|p| (p - t).abs() <= near) {
                        let shot = film.id_at(t).to_string();
                        out.issues.push(raise("accents", "craft.accents", "error", &[&shot], t,
                            format!("the hit at {:.3} s lands on no picture accent within {within} frame(s)", secs(t))));
                    }
                }
                out.measure = json!({"picture": picture, "hits": hits});
                out
            }
        };
        ctx.film = Some(Some(film));
        out
    }

    pub(super) fn silences(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let count_min = fields.get("count_min").and_then(Value::as_u64).unwrap_or(2) as usize;
        let length_min = seconds(fields.get("length_min")).unwrap_or(0.5);
        let max_dbfs = fields
            .get("max_dbfs")
            .and_then(Value::as_f64)
            .unwrap_or(-60.0);
        let refuse = fields.get("cues_inside").is_none_or(|v| v == "refuse");
        let out = match self.rendered(&drawn, None, film.start, film.start + film.span) {
            Err(e) => Found {
                blocked: vec![
                    json!({"code": "craft.silences", "why": format!("the film's mix can't be rendered: {e}")}),
                ],
                ..Found::default()
            },
            Ok((buf, rate)) => {
                let block = (rate / 100.0).round().max(1.0) as usize;
                let quiet: Vec<bool> = buf
                    .chunks(2 * block)
                    .map(|c| {
                        let p = c.iter().map(|x| f64::from(*x) * f64::from(*x)).sum::<f64>()
                            / c.len().max(1) as f64;
                        10.0 * p.max(1e-30).log10() <= max_dbfs
                    })
                    .collect();
                let mut found = Vec::new();
                let mut run: Option<usize> = None;
                for k in 0..=quiet.len() {
                    match (quiet.get(k).copied().unwrap_or(false), run) {
                        (true, None) => run = Some(k),
                        (false, Some(s)) => {
                            let (a, b) = (
                                s as f64 * block as f64 / rate,
                                k as f64 * block as f64 / rate,
                            );
                            if b - a + 1e-9 >= length_min {
                                found.push((film.start + flicks(a), film.start + flicks(b)));
                            }
                            run = None;
                        }
                        _ => {}
                    }
                }
                let mut out = Found::default();
                if found.len() < count_min {
                    let first = film.shots.first().map_or("", |s| s.id.as_str());
                    out.issues.push(raise("silences", "craft.silences", "error", &[first], film.start,
                        format!("the mix holds {} silence(s) of {length_min} s or more, under {count_min}", found.len())));
                }
                if refuse {
                    for (id, t, _) in markers(&drawn, "cue", None) {
                        if found.iter().any(|(a, b)| *a <= t && t < *b) {
                            let shot = film.id_at(t).to_string();
                            let mut i = raise(
                                "silences",
                                "craft.silences",
                                "error",
                                &[&shot],
                                t,
                                format!(
                                    "the cue `{id}` at {:.3} s plays inside a silence",
                                    secs(t)
                                ),
                            );
                            i["ids"] = json!([shot, id]);
                            out.issues.push(i);
                        }
                    }
                }
                out.measure = json!({"silences": found.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>()});
                out
            }
        };
        ctx.film = Some(Some(film));
        out
    }

    pub(super) fn sound_coverage(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let within = fields.get("within").and_then(Value::as_f64).unwrap_or(1.0);
        let near = (within * film.frame as f64).round() as i64;
        let beds: Vec<String> = fields
            .get("beds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let out = match self.sounds(ctx) {
            Err(e) => Found {
                blocked: vec![
                    json!({"code": "craft.sound_coverage", "why": format!("the film's mix can't be read: {e}")}),
                ],
                ..Found::default()
            },
            Ok(sounds) => {
                let mut out = Found::default();
                for (id, t, _) in markers(&drawn, "moment", Some("action")) {
                    if !sounds.iter().any(|s| (s.start - t).abs() <= near) {
                        let shot = film.id_at(t).to_string();
                        let mut i = raise("sound_coverage", "craft.sound_coverage", "error", &[&shot], t,
                            format!("the action `{id}` at {:.3} s has no sound starting within {within} frame(s)", secs(t)));
                        i["ids"] = json!([shot, id]);
                        out.issues.push(i);
                    }
                }
                let mut sections = markers(&drawn, "section", None);
                if sections.is_empty() {
                    sections.push(("film".into(), film.start, film.span));
                }
                for (id, t, span) in sections {
                    let end = t + span.max(film.frame);
                    for bus in &beds {
                        let covered: i64 = sounds
                            .iter()
                            .filter(|s| &s.bus == bus)
                            .map(|s| (s.end.min(end) - s.start.max(t)).max(0))
                            .sum();
                        if 2 * covered < end - t {
                            let shot = film.id_at(t).to_string();
                            let mut i = raise(
                                "sound_coverage",
                                "craft.sound_coverage",
                                "error",
                                &[&shot],
                                t,
                                format!("the section `{id}` has no {bus} bed playing through it"),
                            );
                            i["actual"] = json!({"section": id, "bus": bus});
                            out.issues.push(i);
                        }
                    }
                }
                out
            }
        };
        ctx.film = Some(Some(film));
        out
    }

    pub(super) fn sound_bridges(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let count_min = fields.get("count_min").and_then(Value::as_u64).unwrap_or(2) as usize;
        let lead = flicks(seconds(fields.get("lead_or_tail")).unwrap_or(0.25));
        let out = match self.sounds(ctx) {
            Err(e) => Found {
                blocked: vec![
                    json!({"code": "craft.sound_bridges", "why": format!("the film's mix can't be read: {e}")}),
                ],
                ..Found::default()
            },
            Ok(sounds) => {
                let bridged: Vec<bool> = film
                    .cuts
                    .iter()
                    .map(|&(c, _, _)| {
                        sounds.iter().any(|s| {
                            s.start < c && c < s.end && (c - s.start >= lead || s.end - c >= lead)
                        })
                    })
                    .collect();
                let n = bridged.iter().filter(|b| **b).count();
                let mut out = Found::default();
                if n < count_min {
                    let what = format!(
                        "{n} of {} cuts are bridged by sound, under {count_min}",
                        film.cuts.len()
                    );
                    match film.cuts.iter().zip(&bridged).find(|(_, b)| !**b) {
                        Some(((c, a, b), _)) => out.issues.push(raise(
                            "sound_bridges",
                            "craft.sound_bridges",
                            "error",
                            &[&film.shots[*a].id, &film.shots[*b].id],
                            *c,
                            what,
                        )),
                        None => out.issues.push(raise(
                            "sound_bridges",
                            "craft.sound_bridges",
                            "error",
                            &[film.shots.first().map_or("", |s| s.id.as_str())],
                            film.start,
                            what,
                        )),
                    }
                }
                out.measure = json!({"bridged": n, "cuts": film.cuts.len()});
                out
            }
        };
        ctx.film = Some(Some(film));
        out
    }

    /// mix.balance: per shot, the music bus's power in its lowest band and in its air band
    /// against its mids, rendered as the export mixes it.
    pub(super) fn mix_balance(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let edges: Vec<f64> = fields.get("bands").and_then(Value::as_array).map_or_else(
            || vec![20.0, 120.0, 500.0, 2000.0, 8000.0],
            |b| b.iter().filter_map(Value::as_f64).collect(),
        );
        let low_max = fields
            .get("low_max")
            .and_then(Value::as_f64)
            .unwrap_or(-3.0);
        let air_max = fields
            .get("air_max")
            .and_then(Value::as_f64)
            .unwrap_or(-15.0);
        let mut out = Found::default();
        let mut windows = Vec::new();
        let spans: Vec<(String, i64, i64)> = film
            .shots
            .iter()
            .map(|s| (s.id.clone(), s.start, s.end))
            .collect();
        for (id, a, b) in spans {
            let (buf, rate) = match self.rendered(&drawn, Some("music"), a, b) {
                Ok(r) => r,
                Err(e) => {
                    out.blocked.push(json!({"code": "craft.mix.balance", "why": format!("the music bus can't be rendered: {e}")}));
                    break;
                }
            };
            let mono: Vec<f32> = buf
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| (c[0] + c[1]) / 2.0)
                .collect();
            let p = band_powers(&mono, rate, &edges);
            let (low, mid, air) = (
                p[0],
                p.get(2).copied().unwrap_or(0.0),
                *p.last().unwrap_or(&0.0),
            );
            if p.iter().sum::<f64>() <= 1e-9 {
                continue;
            }
            let db = |x: f64| 10.0 * ((x + 1e-20) / (mid + 1e-20)).log10();
            let (low_db, air_db) = (db(low), db(air));
            windows.push(json!({"shot": id, "low_db": low_db, "air_db": air_db}));
            for (band, v, max) in [("lowest", low_db, low_max), ("air", air_db, air_max)] {
                if v > max {
                    let mut i = raise("mix.balance", "craft.mix.balance", "error", &[&id], a,
                        format!("over `{id}` the music's {band} band is {v:.1} dB against its mids, past {max} dB"));
                    i["actual"] = json!({"band": band, "db": v});
                    out.issues.push(i);
                }
            }
        }
        if windows.is_empty() && out.blocked.is_empty() {
            out.blocked.push(json!({"code": "craft.mix.balance", "why": "the music bus plays nothing to balance"}));
        }
        out.measure = json!({"windows": windows});
        ctx.film = Some(Some(film));
        out
    }
}

/// sound_lock: every score instrument is in the brief's sound palette.
pub(super) fn sound_lock(fields: &Map<String, Value>, ctx: &Ctx) -> Found {
    let drawn = &ctx.drawn;
    let Some(Some(film)) = ctx.film.as_ref() else {
        return Found::default();
    };
    let Some(palette) = fields.get("instruments").and_then(Value::as_array) else {
        return Found {
            blocked: vec![
                json!({"code": "craft.sound_lock", "why": "the brief names no sound palette (instruments)"}),
            ],
            ..Found::default()
        };
    };
    let palette: Vec<&str> = palette.iter().filter_map(Value::as_str).collect();
    let mut out = Found::default();
    for (id, item) in drawn["items"].as_object().into_iter().flatten() {
        if item["kind"] != "score.music@1" {
            continue;
        }
        let Ok((score, _)) = deep_canvas_motion::score::read(drawn, id) else {
            out.blocked.push(json!({"code": "craft.sound_lock", "why": format!("the score `{id}` can't be read")}));
            continue;
        };
        for name in score
            .instruments
            .keys()
            .filter(|n| !palette.contains(&n.as_str()))
        {
            let t = score
                .notes
                .iter()
                .find(|n| &n.inst == name)
                .map_or(film.start, |n| n.t);
            let shot = film.id_at(t).to_string();
            let mut i = raise(
                "sound_lock",
                "craft.sound_lock",
                "error",
                &[&shot],
                t,
                format!(
                    "the score `{id}`'s instrument {name} isn't in the brief's sound palette ({})",
                    palette.join(", ")
                ),
            );
            i["ids"] = json!([shot, id]);
            i["actual"] = json!({"item": id, "instrument": name});
            out.issues.push(i);
        }
    }
    out.measure = json!({"palette": palette});
    out
}
