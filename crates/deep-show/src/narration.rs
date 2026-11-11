//! Issue #502: a film's script (canvas primitives: Narration and captions). A line with a
//! recording plays as a strip on the bus `narration`, its words read from the words bake's record
//! its asset lists in `attached`; the words time the captions, the word markers and the spans a
//! `ducking` entry keyed by the narration reads. The caption layer is what the script adds to the
//! picture: the caption showing at t, drawn over the frame in the frame's own units.

use std::sync::Arc;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{default_view, Scheduler, Session as DocSession};
use deep_canvas::time as clock;
use deep_canvas_media::captions::{self, Block, Caption, Limits, Profile, Timing};
use deep_canvas_media::mix::{Gain, Strip};
use deep_canvas_media::{doc as media_doc, script, FLICKS};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::evidence;
use crate::hub::Hub;

/// The job kind whose record holds a recording's words.
const WORDS: &str = "bake.words";

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// One line of a script, as compiled.
pub(crate) struct Line {
    pub id: String,
    pub text: String,
    pub t: i64,
    /// `caption`: text only, no sound.
    pub caption: bool,
    /// Its recording: the asset's SHA-256, and the take's `in` and `out` in the asset.
    pub take: Option<(String, i64, i64)>,
    /// Each word of its text as (start, end) in document time; empty for a `caption` line.
    pub words: Vec<(i64, i64)>,
}

/// A document's script, compiled once per script and assets.
pub(crate) struct Script {
    pub lines: Vec<Line>,
    /// Each word marker, `<line>.word:<text>#k`, with its time.
    pub markers: Vec<(String, i64)>,
    /// The first thing that keeps the script from compiling: a BLOCKED line or a refused one.
    pub problem: Option<Value>,
    /// The narrator or the recording whose license doesn't allow sharing, if any.
    pub unshareable: Option<Value>,
}

impl Script {
    /// Each speaking line's span: its first word's start to its last word's end.
    pub fn spans(&self) -> Vec<(i64, i64)> {
        self.lines.iter().filter_map(|l| Some((l.words.first()?.0, l.words.last()?.1))).collect()
    }
}

/// How an export draws and lays out its captions, while it runs.
#[derive(Clone)]
pub(crate) struct View {
    /// The export's frame, in flicks.
    pub frame: i64,
    /// False for `captions.mode: closed`.
    pub draw: bool,
    /// The export's `captions.profile`.
    pub profile: Option<String>,
}

/// A document's captions as laid out: the profile that holds them, its limits and the captions.
pub(crate) struct Laid {
    pub profile: &'static Profile,
    pub limits: Limits,
    pub captions: Vec<Caption>,
}

pub(crate) fn graphemes(text: &str) -> usize {
    deep_text::unicode::graphemes(text).len()
}

fn shareable(license: Option<&Value>) -> bool {
    license.and_then(|l| l.get("shareable")).and_then(Value::as_bool) == Some(true)
}

impl Hub<'_> {
    /// The document's script, compiled; `None` for a document without one.
    pub(crate) fn script_of(&mut self, doc: &Value) -> Option<Arc<Script>> {
        let s = doc.get("script").filter(|s| s.get("lines").is_some_and(Value::is_object))?;
        let late = deep_canvas_media::planted("words_bake_200ms_late");
        let key = hex(Sha256::digest(format!("{s}\n{}\n{late}", doc.get("assets").unwrap_or(&Value::Null))));
        if let Some(found) = self.media.scripts.get(&key) {
            return Some(found.clone());
        }
        let compiled = Arc::new(self.compile(doc, s, late));
        self.media.scripts.insert(key, compiled.clone());
        Some(compiled)
    }

    fn compile(&mut self, doc: &Value, s: &Value, late: bool) -> Script {
        let mut out = Script { lines: Vec::new(), markers: Vec::new(), problem: None, unshareable: None };
        if !shareable(s.pointer("/narrator/license")) {
            out.unshareable = Some(json!({"narrator": s.pointer("/narrator/name"), "license": s.pointer("/narrator/license")}));
        }
        let mut lines: Vec<(i64, &String, &Value)> = s["lines"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(id, l)| (media_doc::time(doc, l.get("t")).unwrap_or(0), id, l))
            .collect();
        lines.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
        for (t, id, l) in lines {
            let text = l.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
            let kind = l.get("kind").and_then(Value::as_str).unwrap_or("speech");
            let mut line = Line { id: id.clone(), text, t, caption: kind == "caption", take: None, words: Vec::new() };
            if !line.caption {
                match self.take_of(doc, id, l, t, late) {
                    Ok((take, words)) => {
                        let texts: Vec<&str> = line.text.split_whitespace().collect();
                        if words.len() != texts.len() {
                            out.problem.get_or_insert(json!({"outcome": "refused", "code": "narration.words_differ", "line": id,
                                "words": texts.len(), "record_words": words.len(),
                                "why": format!("line `{id}` has {} words and its words record counts {} inside its take", texts.len(), words.len())}));
                        } else {
                            out.markers.extend(script::marker_names(id, &texts).into_iter().zip(words.iter().map(|w| w.0)));
                            line.words = words;
                        }
                        if out.unshareable.is_none() && !shareable(asset_of(doc, l).and_then(|a| a.get("license"))) {
                            out.unshareable = Some(json!({"line": id, "asset": l.pointer("/recording/asset")}));
                        }
                        line.take = Some(take);
                    }
                    Err(problem) => {
                        out.problem.get_or_insert(problem);
                    }
                }
            }
            out.lines.push(line);
        }
        out
    }

    /// A speaking line's take and its words in document time, or why it has none.
    #[allow(clippy::type_complexity)]
    fn take_of(&mut self, doc: &Value, id: &str, l: &Value, t: i64, late: bool) -> Result<((String, i64, i64), Vec<(i64, i64)>), Value> {
        let Some(rec) = l.get("recording") else {
            return Err(json!({"outcome": "blocked", "state": "BLOCKED", "code": "narration.speech_job", "line": id,
                "reason": format!("line `{id}` has no recording, so it needs its speech job, which hasn't run")}));
        };
        let refused = |code: &str, why: String| json!({"outcome": "refused", "code": code, "line": id, "why": why});
        let asset = asset_of(doc, l).ok_or_else(|| refused("narration.no_asset", format!("line `{id}`'s recording names `{}`, which isn't an entry of assets", rec["asset"])))?;
        let sha = asset.get("sha256").and_then(Value::as_str).unwrap_or_default().to_string();
        let (rate, channels, pcm) = self.pcm(&sha)?;
        let bytes: Vec<u8> = pcm.iter().flat_map(|x| x.to_le_bytes()).collect();
        let pcm_sha = hex(Sha256::digest(&bytes));
        let end = ((pcm.len() / channels.max(1)) as i128 * FLICKS as i128 / rate.max(1) as i128) as i64;
        let r#in = media_doc::time(doc, rec.get("in")).unwrap_or(0);
        let out = match rec.get("out") {
            None => end,
            v => media_doc::time(doc, v).unwrap_or(end),
        };
        let records: Vec<(String, Value)> = (asset.get("attached").and_then(Value::as_array).into_iter().flatten())
            .filter_map(Value::as_str)
            .filter_map(|r| Some((r.to_string(), serde_json::from_slice(&evidence::read(&self.scenario.evidence, r)?).ok()?)))
            .collect();
        let Some((record, r)) = records.iter().find(|(_, r)| r["kind"] == WORDS).or(records.first()) else {
            let _ = evidence::put(&self.scenario.evidence, &bytes);
            return Err(json!({"outcome": "blocked", "state": "BLOCKED", "code": "narration.words_unbaked", "line": id, "job": WORDS,
                "pcm_sha256": pcm_sha, "sample_rate": rate, "channels": channels,
                "reason": format!("line `{id}`'s recording has no words record attached: run {WORDS} on the PCM {pcm_sha}")}));
        };
        if r["kind"] != WORDS {
            return Err(refused("record_of_another_kind", format!("line `{id}`'s attached record {record} is of {}, not {WORDS}", r["kind"])));
        }
        if r["pcm_sha256"] != pcm_sha.as_str() {
            return Err(refused("record_of_another_pcm", format!("line `{id}`'s words record {record} is of the PCM {}, not {pcm_sha}", r["pcm_sha256"])));
        }
        let words: Option<Vec<(i64, i64)>> = r["words"]
            .as_array()
            .and_then(|ws| ws.iter().map(|w| Some((w.get("start")?.as_i64()?, w.get("end")?.as_i64()?))).collect());
        let words = words.ok_or_else(|| refused("bad_record", format!("line `{id}`'s words record {record} lists no words")))?;
        // Planted: the words bake reads 200 ms late.
        let shift = if late { FLICKS / 5 } else { 0 };
        let counted = script::counted(&words, t, r#in, out).into_iter().map(|(s, e)| (s + shift, e + shift)).collect();
        Ok(((sha, r#in, out), counted))
    }

    /// The script's lines with recordings as strips on bus `bus`.
    pub(crate) fn narration_strips(&mut self, s: &Script, bus: usize) -> Result<Vec<Strip>, Value> {
        let mut out = Vec::new();
        for l in &s.lines {
            let Some((sha, r#in, end)) = &l.take else { continue };
            out.push(Strip {
                id: format!("script.{}", l.id),
                source: self.source(sha)?,
                start: l.t,
                r#in: *r#in,
                out: *end,
                rate: (1, 1),
                gain: Gain::Db(0.0),
                pan: 0.0,
                fade_in: None,
                fade_out: None,
                looped: false,
                span: (end - r#in).max(0),
                bus,
                disabled: Vec::new(),
                emitter: None,
            });
        }
        Ok(out)
    }

    /// The document's captions, laid out on frames `frame` flicks long and held to `profile`,
    /// the script's block's, or the first shipped profile that names the document's locale.
    pub(crate) fn captions_of(&mut self, doc: &Value, frame: i64, profile: Option<&str>) -> Result<Option<Laid>, Value> {
        let Some(s) = self.script_of(doc) else { return Ok(None) };
        if let Some(problem) = &s.problem {
            return Err(problem.clone());
        }
        let block = doc.pointer("/script/captions").cloned().unwrap_or(Value::Null);
        let locale = doc.get("locale").and_then(Value::as_str).unwrap_or("en");
        let named = profile.or_else(|| block.get("profile").and_then(Value::as_str));
        let profile = match named {
            Some(name) => captions::profile(name).ok_or_else(|| json!({"outcome": "refused", "code": "unknown_caption_profile", "profile": name}))?,
            None => captions::profile_for(locale).ok_or_else(|| {
                json!({"outcome": "blocked", "state": "BLOCKED", "code": "caption_profile_missing", "locale": locale,
                    "reason": format!("no shipped caption profile names the locale `{locale}`")})
            })?,
        };
        let seconds = |k: &str| block.get(k).and_then(Value::as_f64).map(|s| (s * FLICKS as f64).round() as i64);
        let whole = |k: &str| block.get(k).and_then(Value::as_u64);
        let limits = profile.limits.stricter(&Block {
            max_chars: whole("max_chars").map(|n| n as usize),
            max_lines: whole("max_lines").map(|n| n as usize),
            max_cps_milli: block.get("max_cps").and_then(Value::as_f64).map(|c| (c * 1000.0).round() as i64),
            min_dur: seconds("min_dur"),
            gap_frames: whole("gap_frames").map(|n| n as i64),
        });
        let lines: Vec<captions::Line> = s
            .lines
            .iter()
            .map(|l| captions::Line {
                id: &l.id,
                text: &l.text,
                timing: if l.caption { Timing::At(l.t) } else { Timing::Words(l.words.clone()) },
            })
            .collect();
        let captions = captions::layout(&lines, &limits, frame, &graphemes).map_err(|m| {
            json!({"outcome": "refused", "code": "narration.words_differ", "line": m.line, "words": m.words, "record_words": m.times})
        })?;
        Ok(Some(Laid { profile, limits, captions }))
    }

    /// Sets the caption the frame at `t` draws: the one showing then, in a live view or in the
    /// export that is running, or none.
    pub(crate) fn caption_at(&mut self, doc: &Value, t: i64) {
        self.renderer.caption = None;
        if doc.get("script").is_none() {
            return;
        }
        let view = self.media.captions.clone();
        if view.as_ref().is_some_and(|v| !v.draw) {
            return;
        }
        let frame = match &view {
            Some(v) => v.frame,
            None => {
                let (p, q) = doc.get("transport").and_then(frame_rate_of).unwrap_or((60, 1));
                clock::frame_length(p, q).unwrap_or(FLICKS / 60)
            }
        };
        let profile = view.and_then(|v| v.profile);
        let Ok(Some(laid)) = self.captions_of(doc, frame, profile.as_deref()) else { return };
        let Some(caption) = laid.captions.iter().find(|c| c.start <= t && t < c.end) else { return };
        self.renderer.caption = self.caption_drawn(doc, caption, laid.limits.max_lines);
    }

    /// One caption as the layer draws it: its lines, centred, in the block's font role at its
    /// size, inside its box, over a rect of the box in its plate role when it names one.
    fn caption_drawn(&mut self, doc: &Value, caption: &Caption, max_lines: usize) -> Option<Arc<crate::snapshot::Drawn>> {
        let block = doc.pointer("/script/captions").cloned().unwrap_or(Value::Null);
        let size = doc.get("size").and_then(Value::as_array)?;
        let (w, h) = (size.first()?.as_f64()?, size.get(1)?.as_f64()?);
        let text_size = block.get("size").and_then(Value::as_f64).unwrap_or(13.0);
        let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0);
        let line_height = (1.3 * text_size).round();
        let rect: Vec<f64> = match block.get("box").and_then(Value::as_array) {
            Some(b) if b.len() == 4 => b.iter().filter_map(Value::as_f64).collect(),
            _ => {
                let tall = max_lines as f64 * line_height;
                vec![safe, h - safe - tall, w - 2.0 * safe, tall]
            }
        };
        if rect.len() != 4 {
            return None;
        }
        let text = caption.lines.join("\n");
        let key = hex(Sha256::digest(format!("{text}\n{block}\n{rect:?}\n{w}x{h}\n{}", doc.get("look").unwrap_or(&Value::Null))));
        if let Some(found) = self.media.captions_drawn.get(&key) {
            return Some(found.clone());
        }
        let mut items = serde_json::Map::new();
        if let Some(role) = block.get("plate").and_then(Value::as_str) {
            items.insert("plate".into(), json!({"id": "plate", "kind": "rect@1", "layer": "captions", "name": "Caption plate", "order": "a1",
                "params": {"box": rect, "paint": {"fill": {"role": role}}}}));
        }
        items.insert("text".into(), json!({"id": "text", "kind": "text@1", "layer": "captions", "name": "Caption", "order": "a2",
            "params": {"text": text, "font": block.get("font").and_then(Value::as_str).unwrap_or("body"), "size": text_size,
                "box": {"w": rect[2], "h": rect[3]}, "autosize": "none", "align": "center", "valign": "middle"},
            "at": {"pos": [rect[0], rect[1], 0]}}));
        let mut layer = json!({"format": 1, "id": doc.get("id").cloned().unwrap_or(json!("captions")), "profile": "figure",
            "title": "Captions", "description": "The caption layer of a film: the caption showing now.", "size": [w, h],
            "layers": {"captions": {"writer": "captions", "title": "Captions", "order": "a0"}}, "items": items});
        if let Some(look) = doc.get("look") {
            layer["look"] = look.clone();
        }
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, &layer);
        session.frame(&mut sched, 0, &default_view(&layer));
        let painted = crate::frames::drawing_of(&sched, &session)?;
        let drawn = Arc::new(self.renderer.prepare_drawing(&painted, &self.scenario.evidence).ok()?);
        self.media.captions_drawn.insert(key, drawn.clone());
        Some(drawn)
    }

    /// The caption layer over a finished frame: the caption set for this frame, drawn once.
    pub(crate) fn caption_over(&mut self, rgba: &mut [u8], size: [u16; 2]) {
        if let Some(caption) = self.renderer.caption.take() {
            let top = self.renderer.raster(&caption, size, None);
            crate::snapshot::over(rgba, &top);
        }
    }
}

/// The `assets` entry a line's recording names.
fn asset_of<'d>(doc: &'d Value, line: &Value) -> Option<&'d Value> {
    doc.get("assets")?.get(line.pointer("/recording/asset")?.as_str()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_license_that_says_shareable_true_allows_sharing() {
        assert!(shareable(Some(&json!({"id": "CC0-1.0", "shareable": true}))));
        assert!(!shareable(Some(&json!({"id": "platform", "shareable": false}))));
        // An unknown license is never treated as shareable.
        assert!(!shareable(Some(&json!({"id": "unknown"}))));
        assert!(!shareable(None));
    }
}
