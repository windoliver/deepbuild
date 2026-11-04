//! Issue #491: the tempo map (canvas primitives: Tempo map and cue alignment). Segments chain, each
//! starting where the previous one ends, and hold whole bars, so each boundary lands on a downbeat.
//! Beat to time is closed form: 60·x ÷ b0 for a constant tempo, exact in integers when the BPM is,
//! and t0 + 60·N ÷ (b1 − b0) · ln(bpm(x) ÷ b0) for a ramp linear in beats, in pinned math; both
//! round to the nearest flick.

use deep_canvas::grammar::{Time, TimeContext, FLICKS_PER_SECOND};
use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::doc::Refused;

/// A number as the exact ratio n ÷ 1000 when it is one (BPMs and spans are written so).
fn milli(x: f64) -> Option<i128> {
    let m = x * 1000.0;
    (m.is_finite() && m.abs() < 1e15 && m == m.round()).then_some(m as i128)
}

/// n ÷ d rounded to the nearest integer, a half away from zero (d > 0).
fn round_div(n: i128, d: i128) -> i128 {
    let (q, r) = (n.div_euclid(d), n.rem_euclid(d));
    if 2 * r >= d {
        q + 1
    } else {
        q
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Section {
    /// The section's first bar, from 1.
    bar: u64,
    /// Beats in a bar (the meter's upper number).
    per_bar: u64,
    start: i64,
    bpm: f64,
    /// The BPM at its end: `bpm` without a ramp.
    to_bpm: f64,
    /// Its length in beats.
    span: f64,
}

/// A document's tempo map, read once at check.
#[derive(Clone, Debug, PartialEq)]
pub struct Tempo {
    sections: Vec<Section>,
    /// The planted twin of #491 AC1: a constant section's beats kept in f32 seconds.
    f32_seconds: bool,
}

fn bad(code: &'static str, path: String, detail: Value) -> Refused {
    Refused {
        code,
        path,
        detail: Some(Box::new(detail)),
    }
}

impl Section {
    /// Flicks from the section's start to `x` beats into it.
    fn offset(&self, x: f64, f32_seconds: bool) -> i64 {
        let f = FLICKS_PER_SECOND as f64;
        if self.to_bpm != self.bpm {
            // ∫ 60 ÷ bpm(b) db over [0, x], bpm(b) = b0 + (b1 − b0)·b ÷ N.
            let (b0, b1, n) = (self.bpm, self.to_bpm, self.span);
            let s = 60.0 * n / (b1 - b0) * ops::log1p((b1 - b0) * x / (n * b0));
            return (s * f).round() as i64;
        }
        if f32_seconds {
            let s = (x as f32) * ((60.0 / self.bpm) as f32);
            return (s * FLICKS_PER_SECOND as f32).round() as i64;
        }
        match (milli(x), milli(self.bpm)) {
            (Some(xm), Some(bm)) if bm > 0 => {
                round_div(60 * i128::from(FLICKS_PER_SECOND) * xm, bm) as i64
            }
            _ => (60.0 * x / self.bpm * f).round() as i64,
        }
    }

    /// The beats from the section's start to `t`, inverted from `offset` (for the notice's fix).
    fn beats_at(&self, t: i64) -> f64 {
        let s = (t - self.start) as f64 / FLICKS_PER_SECOND as f64;
        if self.to_bpm != self.bpm {
            let (b0, b1, n) = (self.bpm, self.to_bpm, self.span);
            return n * b0 / (b1 - b0) * ops::expm1(s * (b1 - b0) / (60.0 * n));
        }
        s * self.bpm / 60.0
    }
}

impl Tempo {
    /// Reads `tempo_map`, or `None` when the document has none.
    pub fn read(
        doc: &Map<String, Value>,
        ctx: &TimeContext,
        f32_seconds: bool,
    ) -> Result<Option<Tempo>, Refused> {
        let Some(map) = doc.get("tempo_map") else {
            return Ok(None);
        };
        let Some(Value::Array(segments)) = map.get("segments") else {
            return Err(bad("bad_doc", "tempo_map/segments".into(), json!({})));
        };
        if segments.is_empty() {
            return Err(bad("bad_doc", "tempo_map/segments".into(), json!({})));
        }
        let mut tempo = Tempo {
            sections: Vec::new(),
            f32_seconds,
        };
        for (i, s) in segments.iter().enumerate() {
            let path = format!("tempo_map/segments/{i}");
            let num = |k: &str| {
                s.get(k)
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite() && *v > 0.0)
                    .ok_or_else(|| bad("out_of_range", format!("{path}/{k}"), json!({})))
            };
            let (bpm, span) = (num("bpm")?, num("span")?);
            let per_bar = match s.get("meter") {
                Some(Value::Array(m)) if m.len() == 2 => m[0].as_u64().filter(|&n| n > 0),
                _ => None,
            }
            .ok_or_else(|| bad("bad_doc", format!("{path}/meter"), json!({})))?;
            let to_bpm = match s.get("ramp") {
                None => bpm,
                Some(Value::String(n)) if n == "none" => bpm,
                Some(Value::Object(r))
                    if r.get("shape").and_then(Value::as_str) == Some("linear_in_beats") =>
                {
                    r.get("to_bpm")
                        .and_then(Value::as_f64)
                        .filter(|v| v.is_finite() && *v > 0.0)
                        .ok_or_else(|| {
                            bad("out_of_range", format!("{path}/ramp/to_bpm"), json!({}))
                        })?
                }
                Some(_) => return Err(bad("bad_doc", format!("{path}/ramp"), json!({}))),
            };
            let (bar, start) = match tempo.sections.last() {
                None => {
                    let text = s.get("at").and_then(Value::as_str).unwrap_or("0s");
                    let t = Time::parse(text)
                        .and_then(|t| t.resolve(ctx))
                        .map_err(|_| {
                            bad("bad_time", format!("{path}/at"), json!({"time": text}))
                        })?;
                    (1, t)
                }
                Some(prev) => {
                    // Each section holds whole bars, so the next starts on a downbeat.
                    let bars = prev.span / prev.per_bar as f64;
                    if bars != bars.round() {
                        return Err(bad(
                            "tempo_not_whole_bars",
                            format!("tempo_map/segments/{}/span", i - 1),
                            json!({"span": prev.span, "meter": prev.per_bar}),
                        ));
                    }
                    let bar = prev.bar + bars as u64;
                    let chained = prev.start + prev.offset(prev.span, f32_seconds);
                    (
                        bar,
                        tempo.chained_at(s.get("at"), bar, chained, ctx, &path)?,
                    )
                }
            };
            tempo.sections.push(Section {
                bar,
                per_bar,
                start,
                bpm,
                to_bpm,
                span,
            });
        }
        Ok(Some(tempo))
    }

    /// A later segment's start: its chained start, checked against the `at` it gives.
    fn chained_at(
        &self,
        at: Option<&Value>,
        bar: u64,
        chained: i64,
        ctx: &TimeContext,
        path: &str,
    ) -> Result<i64, Refused> {
        let Some(at) = at else {
            return Ok(chained);
        };
        let text = at.as_str().unwrap_or_default();
        match Time::parse(text) {
            Ok(Time::Beats { bar: b, beat }) if b == bar && beat == 1 => Ok(chained),
            Ok(Time::Beats { .. }) => Err(bad(
                "tempo_off_chain",
                format!("{path}/at"),
                json!({"at": text, "chained": format!("{bar}:1b")}),
            )),
            Ok(t) => {
                let explicit = t
                    .resolve(ctx)
                    .map_err(|_| bad("bad_time", format!("{path}/at"), json!({"time": text})))?;
                if (explicit - chained).abs() > 1 {
                    return Err(bad(
                        "tempo_off_chain",
                        format!("{path}/at: {text} ({explicit} flicks) is more than 1 flick from its chained start, {chained} flicks"),
                        json!({"at": text, "explicit": explicit, "chained": chained}),
                    ));
                }
                Ok(explicit)
            }
            Err(_) => Err(bad("bad_time", format!("{path}/at"), json!({"time": text}))),
        }
    }

    /// Bar `bar`, beat `beat` in flicks, or why it isn't on the map.
    pub fn beat(&self, bar: u64, beat: u64) -> Result<i64, String> {
        let s = self
            .sections
            .iter()
            .rev()
            .find(|s| s.bar <= bar)
            .ok_or_else(|| format!("bar {bar} is before the tempo map"))?;
        if beat == 0 || beat > s.per_bar {
            return Err(format!("beat {beat} is not in a bar of {}", s.per_bar));
        }
        let x = ((bar - s.bar) * s.per_bar + beat - 1) as f64;
        if x > s.span {
            return Err(format!("{bar}:{beat}b is past the tempo map's end"));
        }
        Ok(s.start + s.offset(x, self.f32_seconds))
    }

    /// The bar:beat that lands exactly on `t`, if one does.
    pub fn beat_on(&self, t: i64) -> Option<String> {
        let s = self.sections.iter().rev().find(|s| s.start <= t)?;
        let x = s.beats_at(t).round().max(0.0) as u64;
        (x.saturating_sub(1)..=x + 1).find_map(|x| {
            let (bar, beat) = (s.bar + x / s.per_bar, x % s.per_bar + 1);
            (self.beat(bar, beat) == Ok(t)).then(|| format!("{bar}:{beat}b"))
        })
    }

    /// The beat nearest `t`, in flicks, on the map (ties to the earlier).
    pub fn nearest_beat(&self, t: i64) -> Option<i64> {
        let i = self
            .sections
            .iter()
            .rposition(|s| s.start <= t)
            .unwrap_or(0);
        let mut candidates = Vec::new();
        for s in &self.sections[i..(i + 2).min(self.sections.len())] {
            let x = s.beats_at(t).floor().max(0.0) as u64;
            for x in x.saturating_sub(1)..=x + 2 {
                let (bar, beat) = (s.bar + x / s.per_bar, x % s.per_bar + 1);
                candidates.extend(self.beat(bar, beat).ok());
            }
        }
        candidates
            .into_iter()
            .min_by_key(|&b| ((b - t).unsigned_abs(), b))
    }

    /// The nearest bar:beat at or before `t`, for a literal no beat lands on.
    pub fn beat_before(&self, t: i64) -> Option<String> {
        let s = self.sections.iter().rev().find(|s| s.start <= t)?;
        let x = s.beats_at(t).floor().max(0.0) as u64;
        Some(format!("{}:{}b", s.bar + x / s.per_bar, x % s.per_bar + 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempo(segments: Value) -> Result<Option<Tempo>, Refused> {
        let doc = json!({"tempo_map": {"segments": segments}});
        Tempo::read(
            doc.as_object().unwrap(),
            &TimeContext {
                frame_rate: (30, 1),
                ..TimeContext::default()
            },
            false,
        )
    }

    #[test]
    fn a_literal_finds_the_beat_it_lands_on() {
        let t = tempo(json!([{"at": "0s", "bpm": 96, "meter": [4, 4], "span": 16}, {"at": "5:1b", "bpm": 120, "meter": [4, 4], "span": 8}]))
            .unwrap()
            .unwrap();
        assert_eq!(t.beat_on(8_820_000_000).as_deref(), Some("6:2b"));
        assert_eq!(t.beat(6, 2), Ok(8_820_000_000));
        assert_eq!(t.beat_on(8_820_000_001), None);
        assert!(t.beat(4, 5).is_err() && t.beat(8, 1).is_err());
        // 96 BPM beats every 0.625 s: 1.3 s is nearest 1.25 s, and 10.2 s the 120 BPM 10.0 s.
        assert_eq!(t.nearest_beat(917_280_000), Some(882_000_000));
        assert_eq!(t.nearest_beat(7_197_120_000), Some(7_056_000_000));
    }

    #[test]
    fn a_section_of_part_bars_is_refused() {
        let r = tempo(
            json!([{"bpm": 96, "meter": [4, 4], "span": 6}, {"bpm": 120, "meter": [4, 4], "span": 8}]),
        );
        assert_eq!(r.unwrap_err().code, "tempo_not_whole_bars");
    }
}
