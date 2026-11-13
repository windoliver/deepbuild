//! Issue #491: the tempo map (canvas primitives: Tempo map and cue alignment). Segments chain, each
//! starting where the previous one ends, and hold whole bars, so each boundary lands on a downbeat.
//! Beat to time is closed form: 60·x ÷ b0 for a constant tempo, exact in integers when the BPM is,
//! and t0 + 60·N ÷ (b1 − b0) · ln(bpm(x) ÷ b0) for a ramp linear in beats, in pinned math; both
//! round to the nearest flick. Section starts are kept to 2⁻³² flick, so a beat rounds once, at
//! the end, rather than once per section before it.

use deep_canvas::grammar::{Time, TimeContext, FLICKS_PER_SECOND};
use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::doc::Refused;

/// A number as the exact ratio n ÷ 1000 when it is one (BPMs and spans are written so).
fn milli(x: f64) -> Option<i128> {
    let m = x * 1000.0;
    (m.is_finite() && m.abs() < 1e15 && m == m.round()).then_some(m as i128)
}

/// A section start's units: 2⁻³² flick.
const SUB: i128 = 1 << 32;

/// `sub` rounded to the nearest flick, if it is on the clock.
fn flick(sub: i128) -> Option<i64> {
    i64::try_from(round_div(sub, SUB)).ok()
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
    /// In [`SUB`] units.
    start: i128,
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
    /// [`SUB`] units from the section's start to `x` beats into it, or `None` past any clock.
    fn offset(&self, x: f64, f32_seconds: bool) -> Option<i128> {
        let f = FLICKS_PER_SECOND as f64 * SUB as f64;
        let sub =
            |v: f64| (v.is_finite() && v.abs() < (1u128 << 120) as f64).then(|| v.round() as i128);
        if self.to_bpm != self.bpm {
            // ∫ 60 ÷ bpm(b) db over [0, x], bpm(b) = b0 + (b1 − b0)·b ÷ N.
            let (b0, b1, n) = (self.bpm, self.to_bpm, self.span);
            return sub(60.0 * n / (b1 - b0) * ops::log1p((b1 - b0) * x / (n * b0)) * f);
        }
        if f32_seconds {
            let s = (x as f32) * ((60.0 / self.bpm) as f32);
            return sub(f64::from((s * FLICKS_PER_SECOND as f32).round()))
                .and_then(|v| v.checked_mul(SUB));
        }
        match (milli(x), milli(self.bpm)) {
            (Some(xm), Some(bm)) if bm > 0 => (60 * i128::from(FLICKS_PER_SECOND) * SUB)
                .checked_mul(xm)
                .map(|n| round_div(n, bm)),
            _ => sub(60.0 * x / self.bpm * f),
        }
    }

    /// Its start in flicks (on the clock, as [`Tempo::read`] checks).
    fn at(&self) -> i64 {
        flick(self.start).unwrap_or(i64::MAX)
    }

    /// The beats from the section's start to `t`, inverted from `offset` (for the notice's fix),
    /// held to the section so a time past the map's end reads its last beat.
    fn beats_at(&self, t: i64) -> f64 {
        let s = (t as f64 - self.start as f64 / SUB as f64) / FLICKS_PER_SECOND as f64;
        let x = if self.to_bpm != self.bpm {
            let (b0, b1, n) = (self.bpm, self.to_bpm, self.span);
            n * b0 / (b1 - b0) * ops::expm1(s * (b1 - b0) / (60.0 * n))
        } else {
            s * self.bpm / 60.0
        };
        x.clamp(0.0, self.span)
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
                Some(Value::Array(m)) if m.len() == 2 && m[1].as_u64().is_some_and(|u| u > 0) => {
                    m[0].as_u64().filter(|&n| n > 0)
                }
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
                    let text = match s.get("at") {
                        None => "0s",
                        Some(Value::String(text)) => text.as_str(),
                        Some(at) => {
                            return Err(bad("bad_time", format!("{path}/at"), json!({"time": at})))
                        }
                    };
                    let t = Time::parse(text)
                        .and_then(|t| t.resolve(ctx))
                        .map_err(|_| {
                            bad("bad_time", format!("{path}/at"), json!({"time": text}))
                        })?;
                    (1, i128::from(t) * SUB)
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
                    let past = || {
                        bad(
                            "out_of_range",
                            format!("tempo_map/segments/{}/span", i - 1),
                            json!({}),
                        )
                    };
                    let bar = prev.bar.checked_add(bars as u64).ok_or_else(past)?;
                    let chained =
                        prev.start + prev.offset(prev.span, f32_seconds).ok_or_else(past)?;
                    let explicit = tempo.chained_at(
                        s.get("at"),
                        bar,
                        flick(chained).ok_or_else(past)?,
                        ctx,
                        &path,
                    )?;
                    (bar, explicit.map_or(chained, |t| i128::from(t) * SUB))
                }
            };
            // The section ends on the clock, so every beat in it does.
            let end = Section {
                bar,
                per_bar,
                start,
                bpm,
                to_bpm,
                span,
            }
            .offset(span, f32_seconds);
            if end.and_then(|e| flick(start + e)).is_none() {
                return Err(bad("out_of_range", format!("{path}/span"), json!({})));
            }
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

    /// A later segment's explicit start, checked against its chained start; `None` when it gives
    /// none, or gives it as the chained bar.
    fn chained_at(
        &self,
        at: Option<&Value>,
        bar: u64,
        chained: i64,
        ctx: &TimeContext,
        path: &str,
    ) -> Result<Option<i64>, Refused> {
        let Some(at) = at else {
            return Ok(None);
        };
        let text = at.as_str().unwrap_or_default();
        match Time::parse(text) {
            Ok(Time::Beats { bar: b, beat }) if b == bar && beat == 1 => Ok(None),
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
                Ok(Some(explicit))
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
        let past = || format!("{bar}:{beat}b is past the tempo map's end");
        let x = (bar - s.bar)
            .checked_mul(s.per_bar)
            .and_then(|x| x.checked_add(beat - 1))
            .ok_or_else(past)? as f64;
        if x > s.span {
            return Err(past());
        }
        s.offset(x, self.f32_seconds)
            .and_then(|o| flick(s.start + o))
            .ok_or_else(past)
    }

    /// #154: the beats from the map's first downbeat to bar `bar`, beat `beat` (fractional, from
    /// 1), for a score's note at a beat between beats; or why it isn't on the map.
    pub fn position(&self, bar: u64, beat: f64) -> Result<f64, String> {
        let (i, s) = self
            .sections
            .iter()
            .enumerate()
            .rev()
            .find(|(_, s)| s.bar <= bar)
            .ok_or_else(|| format!("bar {bar} is before the tempo map"))?;
        if !(beat >= 1.0 && beat < s.per_bar as f64 + 1.0) {
            return Err(format!("beat {beat} is not in a bar of {}", s.per_bar));
        }
        Ok(self.start_beats(i) + ((bar - s.bar) * s.per_bar) as f64 + (beat - 1.0))
    }

    /// The flick `x` beats after the map's first downbeat, or why it isn't on the map.
    pub fn at_position(&self, x: f64) -> Result<i64, String> {
        let past = || format!("beat {x} is past the tempo map's end");
        let i = (0..self.sections.len())
            .rev()
            .find(|&i| self.start_beats(i) <= x)
            .ok_or_else(|| format!("beat {x} is before the tempo map"))?;
        let s = &self.sections[i];
        let local = x - self.start_beats(i);
        if local > s.span {
            return Err(past());
        }
        s.offset(local, self.f32_seconds)
            .and_then(|o| flick(s.start + o))
            .ok_or_else(past)
    }

    /// The beats from the map's first downbeat to `t`, for a note whose onset is a time.
    pub fn position_of(&self, t: i64) -> f64 {
        let i = self.sections.iter().rposition(|s| s.at() <= t).unwrap_or(0);
        self.start_beats(i) + self.sections[i].beats_at(t)
    }

    /// The beats before section `i`.
    fn start_beats(&self, i: usize) -> f64 {
        self.sections[..i].iter().map(|s| s.span).sum()
    }

    /// The bar:beat that lands exactly on `t`, if one does.
    pub fn beat_on(&self, t: i64) -> Option<String> {
        let s = self.sections.iter().rev().find(|s| s.at() <= t)?;
        let x = s.beats_at(t).round() as u64;
        (x.saturating_sub(1)..=x + 1).find_map(|x| {
            let (bar, beat) = (s.bar + x / s.per_bar, x % s.per_bar + 1);
            (self.beat(bar, beat) == Ok(t)).then(|| format!("{bar}:{beat}b"))
        })
    }

    /// The beat nearest `t`, in flicks, on the map (ties to the earlier).
    pub fn nearest_beat(&self, t: i64) -> Option<i64> {
        let i = self.sections.iter().rposition(|s| s.at() <= t).unwrap_or(0);
        let mut candidates = Vec::new();
        for s in &self.sections[i..(i + 2).min(self.sections.len())] {
            let x = s.beats_at(t).floor() as u64;
            for x in x.saturating_sub(1)..=x + 2 {
                let (bar, beat) = (s.bar + x / s.per_bar, x % s.per_bar + 1);
                candidates.extend(self.beat(bar, beat).ok());
            }
        }
        candidates.into_iter().min_by_key(|&b| (b.abs_diff(t), b))
    }

    /// The nearest bar:beat at or before `t`, for a literal no beat lands on.
    pub fn beat_before(&self, t: i64) -> Option<String> {
        let s = self.sections.iter().rev().find(|s| s.at() <= t)?;
        let x = s.beats_at(t).floor() as u64;
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

    #[test]
    fn a_beat_past_a_chained_start_rounds_once() {
        // 4 beats at 74 BPM end at 2,288,432,432.43 flicks, and a 110 BPM beat is 384,872,727.27:
        // 2:2b is 2,673,305,159.70, nearest 2,673,305,160, not the sum of the two roundings.
        let t = tempo(json!([{"at": "0s", "bpm": 74, "meter": [4, 4], "span": 4}, {"at": "2:1b", "bpm": 110, "meter": [4, 4], "span": 4}]))
            .unwrap()
            .unwrap();
        assert_eq!(t.beat(2, 2), Ok(2_673_305_160));
    }

    #[test]
    fn a_map_past_the_clock_or_with_no_beat_unit_is_refused() {
        for (segments, code) in [
            (
                json!([{"bpm": 120, "meter": [4, 4], "span": 1e300}, {"at": "2:1b", "bpm": 120, "meter": [4, 4], "span": 4}]),
                "out_of_range",
            ),
            (
                json!([{"bpm": 0.001, "meter": [4, 4], "span": 4_000_000}]),
                "out_of_range",
            ),
            (
                json!([{"bpm": 120, "meter": [4, "x"], "span": 4}]),
                "bad_doc",
            ),
        ] {
            assert_eq!(
                tempo(segments.clone()).map(|_| ()).unwrap_err().code,
                code,
                "{segments}"
            );
        }
        // The first segment's `at` is a time, as every other time field is.
        let at = tempo(json!([{"at": 2, "bpm": 120, "meter": [4, 4], "span": 4}]));
        assert_eq!(at.map(|_| ()).unwrap_err().code, "bad_time");
    }

    #[test]
    fn a_time_far_past_a_ramp_finds_the_map_end() {
        // A 16-beat 90 → 150 BPM ramp ends at 8.1732 s, so 700 s is far past its last beat.
        let t = tempo(json!([{"at": "0s", "bpm": 90, "meter": [4, 4], "span": 16, "ramp": {"to_bpm": 150, "shape": "linear_in_beats"}}]))
            .unwrap()
            .unwrap();
        let far = 700 * FLICKS_PER_SECOND;
        assert_eq!(t.beat_on(far), None);
        assert_eq!(t.nearest_beat(far), t.beat(5, 1).ok());
        assert_eq!(t.beat_before(far).as_deref(), Some("5:1b"));
    }
}
