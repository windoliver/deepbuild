//! Issue #407: the core's film audit and flicker check on a claim's deliverables (canvas
//! primitives: Film audit, Flicker check, Film brief). Each deliverable's current revision is
//! played through every frame of its span at its own frame rate, as made and under reduced motion
//! (Transport), and each frame is read as evaluated data: every text the draw list holds, its
//! glyphs' boxes in the frame's pixels after their animators lift them and their reveal fades
//! them, their opacity, the text's color and size and the fill it sits on, and every item's
//! extent. The audit holds each text to its reading hold, captions to their profile, a headline's
//! longest copy to its line limit, the items a cut carries to their state before it, a cursor to
//! the texts it presses and, under a brief with sources, each factual sentence to its quote. The
//! flicker check reads each frame's relative luminance from its CPU raster. The rules are the
//! core's (`deep_canvas::film_audit`).

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use deep_canvas::film_audit::{self as audit, Count, Flicker, Hold, Readable, Seen};
use deep_canvas_marks::scene::{Fill, Mark, Scope};
use deep_text::unicode::Reading;
use serde_json::{json, Map, Value};
use vello_cpu::kurbo::{Affine, Point};

use crate::hub::{Claim, Hub, Planted};
use crate::shared::FLICKS;

/// The shortest reading hold this build allows: the test build standing in for a new release's
/// stricter rule raises it to 2 s (#407's criterion 9); a shipped build keeps the design's.
const HOLD_FLOOR: Option<f64> = if cfg!(feature = "test-hold-min-2s") {
    Some(2.0)
} else {
    None
};

/// The two renditions every film is audited in (Transport: reduced motion).
const RENDITIONS: [(&str, bool); 2] = [("as_made", false), ("reduced_motion", true)];

/// The codes the film audit raises, as static names for show-time admission's issues.
const CODES: [&str; 10] = [
    "film.hold_short",
    "film.line_limit",
    "film.boundary",
    "film.cursor_crossing",
    "film.caption",
    "film.uncited",
    "film.quote_missing",
    "film.number_mismatch",
    "film.moment_missing",
    "film.cue_missing",
];

/// One text at one frame of a rendition.
#[derive(Clone, Debug)]
struct TextAt {
    /// The item that draws it.
    item: String,
    text: String,
    /// Each glyph's box in the frame's pixels, `[x0, y0, x1, y1]`, and its opacity.
    boxes: Vec<[f64; 4]>,
    opacity: Vec<f64>,
    color: [u8; 3],
    /// The color it sits on: the topmost solid fill drawn before it under its glyphs' centre,
    /// else the frame's ground.
    ground: [u8; 3],
    /// Its size in the frame's pixels.
    size: f64,
}

/// One frame of a rendition: its texts, and every item's extent in the frame's pixels.
#[derive(Default)]
struct FrameAt {
    texts: Vec<TextAt>,
    extents: BTreeMap<String, [f64; 4]>,
}

/// A film played frame by frame in one rendition.
struct Played {
    /// Flicks a frame, and the time of frame 0.
    frame: i64,
    start: i64,
    size: [f64; 2],
    safe: f64,
    frames: Vec<FrameAt>,
}

impl Played {
    fn t(&self, k: usize) -> i64 {
        self.start + k as i64 * self.frame
    }

    /// The first frame `item` draws in, by its glyphs' opacity.
    fn first_shown(&self, item: &str) -> Option<usize> {
        self.frames.iter().position(|f| {
            f.texts
                .iter()
                .any(|x| x.item == item && x.opacity.iter().any(|o| *o > 0.0))
        })
    }
}

/// What the film audit found on one document.
#[derive(Default)]
pub(crate) struct Audited {
    pub issues: Vec<Value>,
    pub blocked: Vec<Value>,
    /// The parts it didn't run, by name (`claims`: a brief with no sources).
    pub not_run: Vec<&'static str>,
}

/// One text's hold in one rendition.
struct HoldOf {
    item: String,
    rendition: &'static str,
    need: f64,
    held: f64,
    t: i64,
}

fn solid(fill: &Fill) -> Option<[u8; 3]> {
    match fill {
        Fill::Solid(c) => Some(*c),
        _ => None,
    }
}

fn seconds(t: i64) -> f64 {
    t as f64 / FLICKS as f64
}

fn issue(code: &str, ids: &[&str], t: i64, what: String, fix: &str) -> Value {
    json!({"check": audit::FILM_AUDIT, "code": code, "severity": "error", "ids": ids, "t": t,
           "what": what, "fix": fix})
}

/// The time a document's field holds, in flicks, read at its own frame rate.
fn time_of(doc: &Value, v: Option<&Value>) -> Option<i64> {
    deep_canvas_media::doc::time(doc, v)
}

impl Hub<'_> {
    /// `drawn` played through every frame of its span in one rendition, each frame read as
    /// evaluated data. None when it has no frame rate a frame can be cut from.
    fn film_played(&mut self, drawn: &Value, reduced: bool) -> Option<Played> {
        let (p, q) = drawn
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let frame = deep_canvas::time::frame_length(p, q).ok()?;
        let span = time_of(drawn, drawn.pointer("/transport/span")).unwrap_or(0);
        let start = time_of(drawn, drawn.pointer("/transport/start")).unwrap_or(0);
        let count = (span / frame).max(1) as usize;
        let size = [
            drawn["size"][0].as_f64().unwrap_or(1.0),
            drawn["size"][1].as_f64().unwrap_or(1.0),
        ];
        let safe = drawn["safe"].as_f64().unwrap_or(24.0);
        let revealed: Vec<String> = drawn["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, i)| i.pointer("/params/reveal").is_some_and(|r| !r.is_null()))
            .map(|(id, _)| id.clone())
            .collect();
        let mut session = self.evaluated(drawn, start);
        let mut view = deep_canvas::schedule::default_view(drawn);
        view[deep_canvas::schedule::REDUCED_MOTION] = Value::Bool(reduced);
        let program = crate::film::program_of(&self.sched, &session);
        let mut outlines = crate::film_layout::Outlines::new();
        let mut shaper: Option<deep_text::Shaper> = None;
        let mut frames = Vec::with_capacity(count);
        for k in 0..count {
            let t = start + k as i64 * frame;
            session.frame(&mut self.sched, t, &view);
            let camera = program.as_deref().and_then(|p| {
                crate::film::sides(p, drawn, t, reduced).map(|s| {
                    // During a transition the side shown most is the one read, its share fading
                    // its texts.
                    let (k, share) = match &s.mix {
                        Some(crate::film::Mix::Fade(m) | crate::film::Mix::Dip(m)) => {
                            if *m >= 0.5 {
                                (1, *m)
                            } else {
                                (0, 1.0 - *m)
                            }
                        }
                        Some(_) => (s.status, 1.0),
                        None => (0, 1.0),
                    };
                    let k = k.min(s.sides.len() - 1);
                    (crate::film::view(&s.sides[k].pose, size), share)
                })
            });
            let (view_of, share) = camera.unwrap_or((Affine::IDENTITY, 1.0));
            // Each revealed text's evaluated params at t, where its reveal's progress is keyed.
            let mut params: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
            for id in &revealed {
                if let Some(p) = session
                    .read(&self.sched, "core.fields", Some(id))
                    .and_then(|(v, _)| v.as_typed::<deep_canvas::schedule::core_ops::Fields>())
                    .map(|f| f.to_json())
                    .and_then(|f| f.get("params").and_then(Value::as_object).cloned())
                {
                    params.insert(id.clone(), p);
                }
            }
            let painted = crate::frames::drawing_of(&self.sched, &session);
            let at = painted
                .as_ref()
                .and_then(|p| p.drawing.clone())
                .map(|d| frame_of(&d, view_of, share, &params, &mut outlines, &mut shaper))
                .unwrap_or_default();
            frames.push(at);
        }
        Some(Played {
            frame,
            start,
            size,
            safe,
            frames,
        })
    }

    /// Each text's hold in each rendition, and the texts in a script with no stated rate, BLOCKED
    /// naming it.
    fn holds(&mut self, drawn: &Value, input: &Value) -> (Vec<HoldOf>, Vec<Value>) {
        let hold = Hold::from_input(input, HOLD_FLOOR);
        // The look's minimum size: its smallest text role, where it gives sizes.
        let look_min = self
            .look
            .sizes
            .as_ref()
            .and_then(|s| s.text.values().map(|r| r.size).reduce(f64::min))
            .unwrap_or(0.0);
        let readable = Readable::from_input(input, look_min);
        let cards = title_cards(drawn);
        let mut out = Vec::new();
        let mut blocked: Vec<Value> = Vec::new();
        for (rendition, reduced) in RENDITIONS {
            let Some(played) = self.film_played(drawn, reduced) else {
                continue;
            };
            let seen = seen_by_item(&played, &readable);
            for (item, seen) in &seen {
                let run = audit::first_run(seen);
                let text = run
                    .map(|r| seen[r.first].text.clone())
                    .or_else(|| {
                        seen.iter()
                            .rev()
                            .find(|s| !s.text.is_empty())
                            .map(|s| s.text.clone())
                    })
                    .unwrap_or_default();
                let (mut cjk, mut other) = (0, 0);
                let mut unrated = None;
                for g in deep_text::unicode::grapheme_clusters(&text) {
                    match deep_text::unicode::reading(g) {
                        Reading::Cjk => cjk += 1,
                        Reading::Other => other += 1,
                        Reading::Space => {}
                        Reading::Unrated(s) => {
                            unrated.get_or_insert(s);
                        }
                    }
                }
                if let Some(script) = unrated {
                    if !blocked.iter().any(|b| b["item"] == json!(item)) {
                        blocked.push(json!({"code": "film.script_unrated", "ids": [item], "item": item,
                            "script": script, "why": format!("`{item}` shows {script}, a script with no stated reading rate")}));
                    }
                    continue;
                }
                let need = hold.needed(cjk, other, cards.contains(item));
                let (held, first) = match run {
                    Some(r) => (r.frames as f64 * seconds(played.frame), r.first),
                    None => (0.0, played.first_shown(item).unwrap_or(0)),
                };
                out.push(HoldOf {
                    item: item.clone(),
                    rendition,
                    need,
                    held,
                    t: played.t(first),
                });
            }
        }
        (out, blocked)
    }

    /// The film audit on one document for the check input `input`, under the claim's brief.
    pub(crate) fn film_audit(
        &mut self,
        drawn: &Value,
        input: &Value,
        brief: Option<&Value>,
    ) -> Audited {
        let mut a = Audited::default();
        let (holds, blocked) = self.holds(drawn, input);
        a.blocked.extend(blocked);
        for h in holds.iter().filter(|h| h.held + 1e-9 < h.need) {
            let mut i = issue("film.hold_short", &[&h.item], h.t,
                format!("`{}` reads for {:.3} s from {:.3} s {}, short of the {:.3} s its graphemes need", h.item, h.held, seconds(h.t),
                    h.rendition.replace('_', " "), h.need),
                "hold the text, still and readable inside the safe area, at least as long as its graphemes need");
            i["item"] = json!(h.item);
            i["need"] = json!(h.need);
            i["held"] = json!(h.held);
            i["rendition"] = json!(h.rendition);
            a.issues.push(i);
        }
        let played = self.film_played(drawn, false);
        if let Some(p) = &played {
            a.issues.extend(line_limits(drawn, p));
            a.issues.extend(self.boundaries(drawn, input, p));
            a.issues.extend(cursor_crossings(input, p));
        }
        match self.caption_issues(drawn) {
            Ok(found) => a.issues.extend(found),
            Err(b) => a.blocked.push(b),
        }
        let sources: Vec<(String, String)> = brief
            .and_then(|b| b.get("sources"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|s| {
                Some((
                    s.get("id")?.as_str()?.to_string(),
                    s.get("text")?.as_str()?.to_string(),
                ))
            })
            .collect();
        if sources.is_empty() {
            a.not_run.push("claims");
        } else {
            let empty_passes = self.planted(Planted::CitesEmptyPasses);
            a.issues
                .extend(claims(drawn, &sources, played.as_ref(), empty_passes));
        }
        a
    }

    /// Captions held to their profile, never to the hold rule: each caption past a limit is an
    /// error naming it; a locale no profile covers is BLOCKED.
    fn caption_issues(&mut self, drawn: &Value) -> Result<Vec<Value>, Value> {
        if drawn.get("script").is_none() {
            return Ok(Vec::new());
        }
        let (p, q) = drawn
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let frame = deep_canvas::time::frame_length(p, q).unwrap_or(FLICKS / 60);
        let laid = match self.captions_of(drawn, frame, None) {
            Ok(Some(l)) => l,
            Ok(None) => return Ok(Vec::new()),
            Err(v) if v["state"] == "BLOCKED" => return Err(v),
            Err(v) => {
                return Ok(vec![
                    json!({"check": audit::FILM_AUDIT, "code": "film.caption", "severity": "error",
                    "ids": [], "actual": v, "what": "the captions can't be laid out"}),
                ])
            }
        };
        let found = deep_canvas_media::captions::check(
            &laid.captions,
            &laid.limits,
            &crate::narration::graphemes,
        );
        Ok(found
            .into_iter()
            .map(|v| {
                let c = laid.captions.iter().find(|c| c.id == v.caption);
                let mut i = issue(
                    "film.caption",
                    &[&v.caption],
                    c.map_or(0, |c| c.start),
                    v.what.clone(),
                    "shorten the caption's words or give it longer on screen, within its profile",
                );
                i["caption"] = json!(v.caption);
                i["line"] = json!(c.map(|c| c.line.clone()));
                i["limit"] = json!(v.limit);
                i["profile"] = json!(laid.profile.name);
                i
            })
            .collect())
    }

    /// Each item a cut carries whose state at the cut differs from its state the frame before,
    /// beyond the motion it made the frame before that; a cut the input lists in `except` is
    /// declared and lets its items change.
    fn boundaries(&mut self, drawn: &Value, input: &Value, p: &Played) -> Vec<Value> {
        let declared: Vec<&str> = input["except"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let mut cuts: Vec<(String, i64, Vec<String>)> = Vec::new();
        let session = self.evaluated(drawn, 0);
        let program = crate::film::program_of(&self.sched, &session);
        let Some(plan) = program.as_deref().and_then(|p| p.shots.as_deref()) else {
            return Vec::new();
        };
        for tr in &plan.transitions {
            if !matches!(tr.kind, deep_canvas_motion::shots::Kind::Cut)
                || declared.contains(&tr.id.as_str())
            {
                continue;
            }
            let carry: Vec<String> = drawn
                .pointer(&format!("/transitions/{}/carry", tr.id))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            cuts.push((tr.id.clone(), tr.cut, carry));
        }
        let mut out = Vec::new();
        for (id, cut, carry) in cuts {
            let k = ((cut - p.start) / p.frame) as usize;
            let (Some(at), Some(before)) = (
                p.frames.get(k),
                k.checked_sub(1).and_then(|j| p.frames.get(j)),
            ) else {
                continue;
            };
            let earlier = k.checked_sub(2).and_then(|j| p.frames.get(j));
            for item in &carry {
                let (Some(a), Some(b)) = (at.extents.get(item), before.extents.get(item)) else {
                    continue;
                };
                let moved = |x: &[f64; 4], y: &[f64; 4]| {
                    (0..4).map(|i| (x[i] - y[i]).abs()).fold(0.0, f64::max)
                };
                let drift = earlier
                    .and_then(|e| e.extents.get(item))
                    .map_or(0.0, |e| moved(b, e));
                let jump = moved(a, b);
                if jump > drift + 0.5 {
                    let mut i = issue(
                        "film.boundary",
                        &[item],
                        cut,
                        format!(
                            "`{item}`, carried across the cut `{id}`, moves {jump:.1} px at it"
                        ),
                        "keep the carried item's state across the cut, or declare the cut",
                    );
                    i["item"] = json!(item);
                    i["transition"] = json!(id);
                    out.push(i);
                }
            }
        }
        out
    }

    /// film.audit on each requirement of the claim that names it, on every deliverable's current
    /// revision: requirement ID → what it found.
    pub(crate) fn film_audit_runs(&mut self, c: &Claim) -> BTreeMap<String, Audited> {
        let mut out = BTreeMap::new();
        for r in c
            .requirements
            .iter()
            .filter(|r| r.check["kind"] == audit::FILM_AUDIT)
        {
            let mut all = Audited::default();
            for doc in &c.deliverables {
                let Some(revision) = self.query_revision(doc, None) else {
                    continue;
                };
                let mut found = self.film_audit(&revision.drawn, &r.check, c.brief.as_ref());
                if self.planted(Planted::VerdictCountsNewIssues) {
                    // Planted: only the issues the last patch brought count.
                    let had = self.last_good_issues(doc);
                    found.issues.retain(|i| {
                        !had.iter()
                            .any(|h| h.code == i["code"] && json!(h.ids) == i["ids"])
                    });
                }
                for mut i in found.issues {
                    i["doc"] = json!(doc);
                    all.issues.push(i);
                }
                all.blocked.extend(found.blocked);
                for n in found.not_run {
                    if !all.not_run.contains(&n) {
                        all.not_run.push(n);
                    }
                }
            }
            out.insert(r.id.clone(), all);
        }
        out
    }

    /// The issues a shared document's revision before its current one held.
    fn last_good_issues(&self, doc: &str) -> Vec<Issue> {
        self.shared
            .get(doc)
            .and_then(|s| {
                s.revs
                    .len()
                    .checked_sub(2)
                    .map(|k| (*s.revs[k].issues).clone())
            })
            .unwrap_or_default()
    }

    /// The rows a claim's brief adds: one per moment, reading hold and cue it lists, each PASS
    /// when every deliverable has it, else FAIL naming what is missing.
    pub(crate) fn brief_rows(&mut self, claim: &str, c: &Claim) -> Vec<Value> {
        let Some(brief) = c.brief.as_ref() else {
            return Vec::new();
        };
        let list = |k: &str| -> Vec<String> {
            brief[k]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        };
        let input = json!({"kind": audit::FILM_AUDIT});
        let mut docs = Vec::new();
        for doc in &c.deliverables {
            if let Some(r) = self.query_revision(doc, None) {
                let (holds, _) = self.holds(&r.drawn, &input);
                let session = self.evaluated(&r.drawn, 0);
                let windows: Vec<(i64, i64)> = crate::film::program_of(&self.sched, &session)
                    .as_deref()
                    .and_then(|p| {
                        p.shots
                            .as_deref()
                            .map(|plan| plan.transitions.iter().map(|t| (t.start, t.end)).collect())
                    })
                    .unwrap_or_default();
                docs.push((doc.clone(), r.drawn, holds, windows));
            }
        }
        let mut rows = Vec::new();
        let row = |kind: &str, id: &str, issues: Vec<Value>| {
            let result = if issues.is_empty() { "PASS" } else { "FAIL" };
            json!({"id": format!("{claim}#brief/{kind}/{id}"), "kind": audit::FILM_AUDIT, "result": result,
                   "machines": "any", "determinism": "exact", "issues": issues, "from": {kind: id}})
        };
        let marker = |drawn: &Value, id: &str, kind: &str| -> Option<i64> {
            let m = drawn.pointer(&format!("/markers/{id}"))?;
            (m["kind"] == kind).then_some(())?;
            time_of(drawn, m.get("t"))
        };
        for id in list("moments") {
            let mut issues = Vec::new();
            for (doc, drawn, _, windows) in &docs {
                match marker(drawn, &id, "moment") {
                    Some(t) if !windows.iter().any(|(a, b)| *a <= t && t < *b) => {}
                    found => {
                        let mut i = issue(
                            "film.moment_missing",
                            &[&id],
                            found.unwrap_or(0),
                            format!("the brief's moment `{id}` isn't shown outside a transition"),
                            "show the moment the brief names",
                        );
                        i["doc"] = json!(doc);
                        issues.push(i);
                    }
                }
            }
            rows.push(row("moment", &id, issues));
        }
        for id in list("holds") {
            let mut issues = Vec::new();
            for (doc, _, holds, _) in &docs {
                let mine: Vec<&HoldOf> = holds.iter().filter(|h| h.item == id).collect();
                if mine.is_empty() {
                    let mut i = issue(
                        "film.hold_short",
                        &[&id],
                        0,
                        format!("the brief's reading hold `{id}` is never shown"),
                        "show the text the brief names",
                    );
                    i["item"] = json!(id);
                    i["held"] = json!(0.0);
                    i["doc"] = json!(doc);
                    issues.push(i);
                }
                for h in mine.into_iter().filter(|h| h.held + 1e-9 < h.need) {
                    let mut i = issue(
                        "film.hold_short",
                        &[&id],
                        h.t,
                        format!("`{id}` reads for {:.3} s, short of {:.3} s", h.held, h.need),
                        "hold the text at least as long as its graphemes need",
                    );
                    i["item"] = json!(id);
                    i["need"] = json!(h.need);
                    i["held"] = json!(h.held);
                    i["rendition"] = json!(h.rendition);
                    i["doc"] = json!(doc);
                    issues.push(i);
                }
            }
            rows.push(row("hold", &id, issues));
        }
        for id in list("cues") {
            let mut issues = Vec::new();
            for (doc, drawn, _, _) in &docs {
                if marker(drawn, &id, "cue").is_none() {
                    let mut i = issue(
                        "film.cue_missing",
                        &[&id],
                        0,
                        format!("the brief's cue `{id}` isn't in the film"),
                        "place the cue the brief names",
                    );
                    i["doc"] = json!(doc);
                    issues.push(i);
                }
            }
            rows.push(row("cue", &id, issues));
        }
        rows
    }

    /// The flicker check on each requirement of the claim that names it, on every deliverable,
    /// in both renditions: requirement ID → its issues, or why it couldn't run, beside its
    /// counters per deliverable and rendition (#1399): the frames it judged and those it analyzed
    /// from their own raster, its count of real evaluations. A frame judged on another frame's
    /// analysis fails the check, naming the counter.
    pub(crate) fn film_flicker_runs(&mut self, c: &Claim) -> BTreeMap<String, Flickered> {
        let count = if self.planted(Planted::FlickerCountsSingleChanges) {
            Count::Singles
        } else if self.planted(Planted::FlickerWholeViewMean) {
            Count::Mean
        } else {
            Count::Pairs
        };
        let mut out = BTreeMap::new();
        for r in c
            .requirements
            .iter()
            .filter(|r| r.check["kind"] == audit::FILM_FLICKER)
        {
            let f = Flicker::from_input(&r.check);
            let mut issues = Vec::new();
            let mut counters = Vec::new();
            let mut failed = None;
            for doc in &c.deliverables {
                let Some(revision) = self.query_revision(doc, None) else {
                    continue;
                };
                for (rendition, reduced) in RENDITIONS {
                    let Some(Lit {
                        frames,
                        per_second,
                        frame,
                        start,
                        analyzed,
                    }) = self.film_luminance(&revision.drawn, reduced)
                    else {
                        failed =
                            Some(json!({"code": "not_drawn", "doc": doc, "rendition": rendition}));
                        continue;
                    };
                    counters.push(json!({"doc": doc, "rendition": rendition, "frames": frames.len(), "analyzed": analyzed}));
                    if analyzed < frames.len() {
                        issues.push(json!({"check": audit::FILM_FLICKER, "code": "film.unanalyzed", "severity": "error", "ids": [],
                            "doc": doc, "t": start, "rendition": rendition, "counter": "analyzed", "frames": frames.len(), "analyzed": analyzed,
                            "what": format!("{analyzed} of {} frames were analyzed from their own raster", frames.len()),
                            "fix": "analyze every frame the check judges; a result served to other frames isn't theirs"}));
                    }
                    for found in audit::flashes(&frames, per_second, &f, count) {
                        let t = start + found.first as i64 * frame;
                        let mut i = json!({"check": audit::FILM_FLICKER, "code": "film.flash", "severity": "error", "ids": [],
                            "doc": doc, "t": t, "rendition": rendition, "flashes": found.flashes, "changes": found.changes,
                            "window": [start + found.window[0] as i64 * frame, start + found.window[1] as i64 * frame],
                            "what": format!("{} flashes in the second from {:.3} s, over {}", found.flashes, seconds(t), f.max_flashes),
                            "fix": "slow the change to three flashes a second or fewer, shrink it under a quarter of the view, or keep its darker frame light"});
                        if reduced {
                            i["rendition"] = json!(rendition);
                        }
                        issues.push(i);
                    }
                }
            }
            out.insert(r.id.clone(), (failed.map_or(Ok(issues), Err), counters));
        }
        out
    }

    /// `drawn` played through every frame of its span in one rendition, each frame rastered on the
    /// CPU at [`FLICKER_WIDTH`] under the document's own look and read as relative luminance in
    /// linear light; with the frames a second, flicks a frame, the first frame's time and how
    /// many frames were analyzed from their own raster.
    fn film_luminance(&mut self, drawn: &Value, reduced: bool) -> Option<Lit> {
        let (p, q) = drawn
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let frame = deep_canvas::time::frame_length(p, q).ok()?;
        let span = time_of(drawn, drawn.pointer("/transport/span")).unwrap_or(0);
        let start = time_of(drawn, drawn.pointer("/transport/start")).unwrap_or(0);
        let count = (span / frame).max(1) as usize;
        let w = drawn["size"][0].as_f64().unwrap_or(1.0).max(1.0);
        let h = drawn["size"][1].as_f64().unwrap_or(1.0).max(1.0);
        let k = (FLICKER_WIDTH / w).min(1.0);
        let px = [
            ((w * k).round().max(1.0)) as u16,
            ((h * k).round().max(1.0)) as u16,
        ];
        // The document's own look, as a show of it draws it.
        let kept = self.with_look_of(drawn);
        let mut session = self.evaluated(drawn, start);
        let mut view = deep_canvas::schedule::default_view(drawn);
        view[deep_canvas::schedule::REDUCED_MOTION] = Value::Bool(reduced);
        let program = crate::film::program_of(&self.sched, &session);
        let mut out: Vec<Vec<f32>> = Vec::with_capacity(count);
        let mut ok = true;
        let once = self.planted(Planted::FlickerAnalyzesOnce);
        let mut analyzed = 0;
        for n in 0..count {
            // Planted (#1399): one analysis served to every frame.
            if once && n > 0 {
                out.push(out[0].clone());
                continue;
            }
            let t = start + n as i64 * frame;
            session.frame(&mut self.sched, t, &view);
            let Some(painted) = crate::frames::drawing_of(&self.sched, &session) else {
                ok = false;
                break;
            };
            let sides = program
                .as_deref()
                .and_then(|p| crate::film::sides(p, drawn, t, reduced));
            let rgba = match &sides {
                Some(s) => self
                    .film_rgba(&painted, Some(px), s, drawn, true)
                    .map(|r| r.0),
                None => self.canonical_rgba(&painted, Some(px), true).map(|r| r.0),
            };
            let Ok(rgba) = rgba else {
                ok = false;
                break;
            };
            out.push(
                rgba.as_chunks::<4>()
                    .0
                    .iter()
                    .map(|c| audit::luminance(c[0], c[1], c[2]))
                    .collect(),
            );
            analyzed += 1;
        }
        if let Some((look, def)) = kept {
            self.look = look;
            self.look_def = def;
        }
        let per_second = (FLICKS as f64 / frame as f64).round().max(1.0) as usize;
        ok.then_some(Lit {
            frames: out,
            per_second,
            frame,
            start,
            analyzed,
        })
    }

    /// Show-time admission's film audit (#407): a film a claim's definition audits gets the film
    /// audit's issues on each revision, so a stricter rule's issues its last good revision had
    /// too come back carried and never refuse it. None for any other document.
    pub(crate) fn admission_issues(
        &mut self,
        doc_id: &str,
        document: &Value,
    ) -> Option<Vec<Issue>> {
        let claims = self.scenario.claims.clone();
        let (claim, input) = claims.iter().find_map(|(_, c)| {
            if !c.deliverables.iter().any(|d| d == doc_id) {
                return None;
            }
            let r = c
                .requirements
                .iter()
                .find(|r| r.check["kind"] == audit::FILM_AUDIT)?;
            Some((c, r.check.clone()))
        })?;
        let (drawn, _) = self.drawn_of(document);
        let found = self.film_audit(&drawn, &input, claim.brief.as_ref());
        Some(
            found
                .issues
                .iter()
                .filter_map(|i| {
                    let code = CODES.iter().find(|c| i["code"] == **c)?;
                    let ids: Vec<String> = i["ids"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect();
                    let mut actual = i.clone();
                    if let Some(m) = actual.as_object_mut() {
                        for k in ["check", "code", "severity", "ids", "what", "fix"] {
                            m.remove(k);
                        }
                    }
                    let mut x = Issue::error(
                        code,
                        ids.first().map_or("", String::as_str),
                        format!("items/{}", ids.first().map_or("", String::as_str)),
                        actual,
                        i["what"].as_str().unwrap_or_default(),
                    );
                    x.ids = ids;
                    x.fix = i["fix"].as_str().unwrap_or_default().to_string();
                    Some(x)
                })
                .collect(),
        )
    }
}

impl Hub<'_> {
    /// For each deliverable that is a film, the time each item first shows in, as made: what an
    /// honest-numbers issue on it names as its frame.
    pub(crate) fn first_shown_by_doc(
        &mut self,
        c: &Claim,
    ) -> BTreeMap<String, BTreeMap<String, i64>> {
        let mut out = BTreeMap::new();
        if !c
            .requirements
            .iter()
            .any(|r| r.check["kind"] == "honest_numbers")
        {
            return out;
        }
        for doc in &c.deliverables {
            let Some(revision) = self.query_revision(doc, None) else {
                continue;
            };
            if revision.drawn.pointer("/transport/span").is_none() {
                continue;
            }
            let Some(p) = self.film_played(&revision.drawn, false) else {
                continue;
            };
            let mut times = BTreeMap::new();
            for (k, f) in p.frames.iter().enumerate() {
                for x in &f.texts {
                    if x.opacity.iter().any(|o| *o > 0.0) {
                        times.entry(x.item.clone()).or_insert(p.t(k));
                    }
                }
            }
            out.insert(doc.clone(), times);
        }
        out
    }
}

/// Whether `code` is one the film audit raises at show-time admission.
pub(crate) fn audit_code(code: &str) -> bool {
    CODES.contains(&code)
}

/// The width frames are rastered at for the flicker check: a share of the view is all it reads.
const FLICKER_WIDTH: f64 = 192.0;

/// A flicker check's issues, or why it couldn't run, beside its counters (#1399).
pub(crate) type Flickered = (Result<Vec<Value>, Value>, Vec<Value>);

/// A rendition's frames as relative luminance, with what the flicker check reads them by.
struct Lit {
    frames: Vec<Vec<f32>>,
    per_second: usize,
    /// Flicks a frame, and the first frame's time.
    frame: i64,
    start: i64,
    /// #1399: the frames analyzed from their own raster.
    analyzed: usize,
}

impl Hub<'_> {
    /// Sets the hub's look to the one `drawn` names by asset, as a show of it does; the look it
    /// replaced, to put back.
    fn with_look_of(
        &mut self,
        drawn: &Value,
    ) -> Option<(deep_canvas_marks::look::Look, Option<Value>)> {
        let look = self.look_of(drawn)?;
        let def = self.look_def_of(drawn);
        let was = std::mem::replace(&mut self.look, look);
        let was_def = std::mem::replace(&mut self.look_def, def);
        Some((was, was_def))
    }
}

/// The texts each a title card: the one item a shot keeps, when it is a text.
fn title_cards(drawn: &Value) -> Vec<String> {
    drawn["shots"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, s)| {
            let keep = s.pointer("/frame/keep")?.as_array()?;
            let [only] = keep.as_slice() else { return None };
            let id = only.as_str()?;
            (drawn.pointer(&format!("/items/{id}/kind")) == Some(&json!("text@1")))
                .then(|| id.to_string())
        })
        .collect()
}

/// Every text and item extent a frame's draw list holds, in the frame's pixels through `view`,
/// each glyph's opacity times `share` and its reveal's.
fn frame_of(
    d: &deep_canvas_marks::modules::Drawing,
    view: Affine,
    share: f64,
    params: &BTreeMap<String, Map<String, Value>>,
    outlines: &mut crate::film_layout::Outlines,
    shaper: &mut Option<deep_text::Shaper>,
) -> FrameAt {
    let scale = view.as_coeffs()[0].hypot(view.as_coeffs()[1]);
    let place = |b: [f64; 4]| -> [f64; 4] {
        let c = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]
            .map(|p| view * Point::new(p[0], p[1]));
        [
            c.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            c.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            c.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            c.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
        ]
    };
    // Solid fills drawn so far, topmost last, in the frame's pixels.
    let mut fills: Vec<([f64; 4], [u8; 3])> = Vec::new();
    let mut out = FrameAt::default();
    for drawn in d.frame.layers.iter().flat_map(|l| (&l.marks).into_iter()) {
        let alpha: f64 = drawn
            .scopes
            .iter()
            .filter_map(|s| match s {
                Scope::Opacity { alpha, .. } => Some(*alpha),
                _ => None,
            })
            .product();
        let base = drawn
            .mark
            .item()
            .split('#')
            .next()
            .unwrap_or_default()
            .to_string();
        if alpha > 0.0 {
            let [x, y, w, h] = drawn.extent();
            let e = place([x, y, x + w, y + h]);
            out.extents
                .entry(base.clone())
                .and_modify(|b| {
                    *b = [
                        b[0].min(e[0]),
                        b[1].min(e[1]),
                        b[2].max(e[2]),
                        b[3].max(e[3]),
                    ]
                })
                .or_insert(e);
        }
        match &drawn.mark {
            Mark::Rect { bounds, fill, .. } if alpha >= 0.999 => {
                if let Some(c) = solid(fill) {
                    let [x, y, w, h] = *bounds;
                    fills.push((place([x, y, x + w, y + h]), c));
                }
            }
            Mark::Text {
                item,
                spec,
                origin,
                color,
                ..
            } => {
                let shaped = match d.runs.get(item).filter(|r| r.spec == *spec) {
                    Some(r) => r.shaped.clone(),
                    None => {
                        let Some(s) = spec.shaper_spec() else {
                            continue;
                        };
                        shaper.get_or_insert_with(deep_text::Shaper::new).shape(&s)
                    }
                };
                let units = d.animated.get(item);
                let revealed = params.get(item).and_then(|p| {
                    deep_canvas_marks::animator::reveal_opacity(p, &shaped, item)
                        .ok()
                        .flatten()
                });
                let own = crate::film_layout::each_glyph_box(&shaped, *origin, outlines);
                let mut boxes = Vec::with_capacity(own.len());
                let mut opacity = Vec::with_capacity(own.len());
                // Glyphs with no outline (spaces) draw nothing and aren't read.
                for (k, b) in own.iter().enumerate() {
                    let Some(b) = b else { continue };
                    let [lift, o] = units.and_then(|u| u.get(k)).copied().unwrap_or([0.0, 1.0]);
                    let r = revealed
                        .as_ref()
                        .and_then(|r| r.get(k))
                        .copied()
                        .unwrap_or(1.0);
                    boxes.push(place([b[0], b[1] + lift, b[2], b[3] + lift]));
                    opacity.push(o.clamp(0.0, 1.0) * r * alpha * share);
                }
                let n = boxes.len().max(1) as f64;
                let cx = boxes.iter().map(|b| (b[0] + b[2]) / 2.0).sum::<f64>() / n;
                let cy = boxes.iter().map(|b| (b[1] + b[3]) / 2.0).sum::<f64>() / n;
                let ground = fills
                    .iter()
                    .rev()
                    .find(|(r, _)| r[0] <= cx && cx <= r[2] && r[1] <= cy && cy <= r[3])
                    .map_or(d.frame.ground, |(_, c)| *c);
                out.texts.push(TextAt {
                    item: base,
                    text: spec.text.clone(),
                    boxes,
                    opacity,
                    color: *color,
                    ground,
                    size: spec.size * scale,
                });
            }
            _ => {}
        }
    }
    out
}

/// Whether `text` reads at this frame, given where its glyphs were the frame before: every glyph
/// still, opaque, in contrast, big enough and wholly inside the safe area.
fn readable(
    text: &TextAt,
    before: Option<&TextAt>,
    limits: &Readable,
    size: [f64; 2],
    safe: f64,
) -> bool {
    if text.boxes.is_empty() {
        return false;
    }
    let inside = text
        .boxes
        .iter()
        .all(|b| b[0] >= safe && b[1] >= safe && b[2] <= size[0] - safe && b[3] <= size[1] - safe);
    let opaque = text.opacity.iter().all(|o| *o >= limits.min_opacity);
    let contrast =
        deep_canvas_marks::look::contrast(text.color, text.ground) >= limits.min_contrast;
    let big = text.size >= limits.min_size;
    let still = match before {
        Some(b) if b.boxes.len() == text.boxes.len() && b.text == text.text => {
            text.boxes.iter().zip(&b.boxes).all(|(x, y)| {
                let dx = (x[0] + x[2] - y[0] - y[2]) / 2.0;
                let dy = (x[1] + x[3] - y[1] - y[3]) / 2.0;
                dx.hypot(dy) < limits.max_motion
            })
        }
        _ => true,
    };
    inside && opaque && contrast && big && still
}

/// Each item's reading over a played film: per frame, whether it reads and what it shows.
fn seen_by_item(played: &Played, limits: &Readable) -> BTreeMap<String, Vec<Seen>> {
    let mut out: BTreeMap<String, Vec<Seen>> = BTreeMap::new();
    let n = played.frames.len();
    for (k, f) in played.frames.iter().enumerate() {
        for text in &f.texts {
            let before = k
                .checked_sub(1)
                .and_then(|j| played.frames[j].texts.iter().find(|x| x.item == text.item));
            let entry = out.entry(text.item.clone()).or_insert_with(|| {
                vec![
                    Seen {
                        readable: false,
                        text: String::new()
                    };
                    n
                ]
            });
            entry[k] = Seen {
                readable: readable(text, before, limits, played.size, played.safe),
                text: text.text.clone(),
            };
        }
    }
    out
}

/// Each text@1 with a copy key and a line limit whose copy in some locale wraps past it, checked
/// at its box's width: an error naming the copy's locale, at the first frame the text shows.
fn line_limits(drawn: &Value, p: &Played) -> Vec<Value> {
    let mut out = Vec::new();
    let mut shaper: Option<deep_text::Shaper> = None;
    for (id, item) in drawn["items"].as_object().into_iter().flatten() {
        let (Some(key), Some(max)) = (
            item.pointer("/params/copy").and_then(Value::as_str),
            item.pointer("/params/max_lines").and_then(Value::as_u64),
        ) else {
            continue;
        };
        let Some(params) = item.get("params").and_then(Value::as_object) else {
            continue;
        };
        for (locale, table) in drawn
            .pointer("/data/copy")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(words) = table.get(key).and_then(Value::as_str) else {
                continue;
            };
            let mut p2 = params.clone();
            p2.insert("text".into(), json!(words));
            p2.remove("max_lines");
            let Ok(spec) = deep_canvas_marks::scene::text_spec(id, &p2, None) else {
                continue;
            };
            let Some(s) = spec.shaper_spec() else {
                continue;
            };
            let lines = shaper
                .get_or_insert_with(deep_text::Shaper::new)
                .shape(&s)
                .lines;
            if lines as u64 > max {
                let first = p.first_shown(id).unwrap_or(0);
                let mut i = issue(
                    "film.line_limit",
                    &[id],
                    p.t(first),
                    format!(
                        "`{id}`'s {locale} copy wraps to {lines} lines, past its limit of {max}"
                    ),
                    "shorten the copy, widen its box or lower its size",
                );
                i["item"] = json!(id);
                i["locale"] = json!(locale);
                i["copy"] = json!(key);
                i["lines"] = json!(lines);
                out.push(i);
            }
        }
    }
    out
}

/// A cursor path that crosses a text it doesn't press: an error naming the text, at the first
/// frame the cursor's extent meets a glyph of it.
fn cursor_crossings(input: &Value, p: &Played) -> Vec<Value> {
    let Some(cursor) = input.pointer("/cursor_path/item").and_then(Value::as_str) else {
        return Vec::new();
    };
    let presses: Vec<&str> = input
        .pointer("/cursor_path/presses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for (k, f) in p.frames.iter().enumerate() {
        let Some(c) = f.extents.get(cursor) else {
            continue;
        };
        for text in &f.texts {
            if text.item == cursor
                || presses.contains(&text.item.as_str())
                || seen.contains(&text.item)
            {
                continue;
            }
            let meets = text.boxes.iter().zip(&text.opacity).any(|(b, o)| {
                *o > 0.0 && b[0] <= c[2] && c[0] <= b[2] && b[1] <= c[3] && c[1] <= b[3]
            });
            if meets {
                seen.push(text.item.clone());
                let mut i = issue(
                    "film.cursor_crossing",
                    &[&text.item, cursor],
                    p.t(k),
                    format!(
                        "the cursor `{cursor}` crosses `{}`, a text it doesn't press",
                        text.item
                    ),
                    "route the cursor round the text, or list the text among those it presses",
                );
                i["text"] = json!(text.item);
                i["cursor"] = json!(cursor);
                out.push(i);
            }
        }
    }
    out
}

/// The claim check: each narration line and each on-screen sentence (a text@1 that isn't a
/// title card, a heading or a bound value) cites the brief's sources, each quote is found word
/// for word in its source, and each number it shows is in a quote.
fn claims(
    drawn: &Value,
    sources: &[(String, String)],
    played: Option<&Played>,
    empty_passes: bool,
) -> Vec<Value> {
    let mut out = Vec::new();
    let check = |cites: Option<&Value>,
                 words: &str,
                 name: &dyn Fn(&mut Value),
                 t: i64,
                 ids: &[&str],
                 out: &mut Vec<Value>| {
        let list: Vec<&Value> = cites
            .and_then(Value::as_array)
            .map(|l| l.iter().collect())
            .unwrap_or_default();
        let cited = match cites {
            Some(Value::Array(l)) => !l.is_empty() || empty_passes,
            _ => false,
        };
        if !cited {
            let mut i = issue(
                "film.uncited",
                ids,
                t,
                format!("`{words}` states a fact with no citation"),
                "cite a source the brief lists, with a quote from it",
            );
            name(&mut i);
            out.push(i);
            return;
        }
        let mut quotes = Vec::new();
        for c in list {
            let source = c.get("source").and_then(Value::as_str).unwrap_or_default();
            let quote = c.get("quote").and_then(Value::as_str).unwrap_or_default();
            let found = sources
                .iter()
                .find(|(id, _)| id == source)
                .is_some_and(|(_, text)| audit::quoted(text, quote));
            if !found {
                let mut i = issue(
                    "film.quote_missing",
                    ids,
                    t,
                    format!("the quote `{quote}` isn't found word for word in `{source}`"),
                    "quote the source word for word",
                );
                i["source"] = json!(source);
                i["quote"] = json!(quote);
                name(&mut i);
                out.push(i);
            } else {
                quotes.push(quote);
            }
        }
        if quotes.is_empty() {
            return;
        }
        let quoted = quotes.join(" ");
        let missing = audit::unquoted_numbers(words, &quoted);
        if !missing.is_empty() {
            let mut i = issue(
                "film.number_mismatch",
                ids,
                t,
                format!(
                    "`{words}` shows {} that its quote doesn't",
                    missing.join(", ")
                ),
                "show the number its quote gives",
            );
            i["numbers"] = json!(missing);
            name(&mut i);
            out.push(i);
        }
    };
    for (id, line) in drawn
        .pointer("/script/lines")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(words) = line.get("text").and_then(Value::as_str) else {
            continue;
        };
        // A line that fills in bound values traces to their paths.
        if words.contains('{') {
            continue;
        }
        let t = time_of(drawn, line.get("t")).unwrap_or(0);
        let name = |i: &mut Value| {
            i["line"] = json!(id);
            i["path"] = json!(format!("script/lines/{id}"));
        };
        check(line.get("cites"), words, &name, t, &[id], &mut out);
    }
    let cards = title_cards(drawn);
    let stages: Vec<(i64, String)> = {
        let mut s: Vec<(i64, String)> = drawn["markers"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, m)| m["kind"] == "stage")
            .filter_map(|(id, m)| Some((time_of(drawn, m.get("t"))?, id.clone())))
            .collect();
        s.sort();
        s
    };
    for (id, item) in drawn["items"].as_object().into_iter().flatten() {
        if item["kind"] != "text@1" || cards.contains(id) {
            continue;
        }
        let params = &item["params"];
        let Some(words) = params.get("text").and_then(Value::as_str) else {
            continue;
        };
        let heading = matches!(
            params.get("font").and_then(Value::as_str),
            Some("title" | "heading" | "display")
        );
        if heading || audit::sentences(words).is_empty() {
            continue;
        }
        let first = played.and_then(|p| p.first_shown(id).map(|k| p.t(k)));
        let t = first.unwrap_or(0);
        let stage = stages
            .iter()
            .rev()
            .find(|(at, _)| *at <= t)
            .map(|(_, s)| s.clone());
        let name = |i: &mut Value| {
            i["item"] = json!(id);
            if let Some(s) = &stage {
                i["stage"] = json!(s);
            }
        };
        check(params.get("cites"), words, &name, t, &[id], &mut out);
    }
    out
}
