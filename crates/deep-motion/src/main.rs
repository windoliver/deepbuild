//! `deep-motion <eval|insert|run>`: JSON lines in, one JSON line out per input line, in order,
//! exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value
//! answers `{"ok":false,"code":"bad_input"}`. The surface is the #391 acceptance README's,
//! `eval`'s `look`, `track`, `cameras` and `hash` the #417 one's, and its `input`, `view`,
//! `unwrap`, `timing`, `order` and `constraints` the #489 one's.

use std::io::{self, BufRead, Write};

use deep_canvas::canon::revision_hash;
use deep_canvas::document::DocShape;
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas_motion::clock::{run, Mode};
use deep_canvas_motion::curve::Ease;
use deep_canvas::expr::Scope;
use deep_canvas_motion::doc::{feel_of, Feel, Refused};
use deep_canvas_motion::eval::{frame_with, position, Validity};
use deep_canvas_motion::follow::Source;
use deep_canvas_motion::input::Entry;
use deep_canvas_motion::insert::insert;
use deep_canvas_motion::program::{track_hash, Boxes, Layout, Options, Planted, Program};
use serde_json::{json, Map, Value};

/// #491: the canvas's auto layout (deep-canvas-marks, through its one shaper), which a frame's
/// layout glide reads.
fn solve_layout(doc: &Value) -> Result<Boxes, (String, String)> {
    thread_local! {
        static SHAPER: std::cell::RefCell<deep_text::Shaper> = std::cell::RefCell::new(deep_text::Shaper::new());
    }
    SHAPER
        .with(|s| deep_canvas_marks::layout::solve(doc, &mut s.borrow_mut()))
        .map_err(|r| (r.code.to_string(), r.item))
}

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refusal(r: Refused) -> Value {
    let mut out = json!({"ok": false, "code": r.code, "path": r.path});
    if let Some(Value::Object(detail)) = r.detail.map(|d| *d) {
        for (k, v) in detail {
            out[k] = v;
        }
    }
    out
}

fn flicks(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_i64)
}

/// The eval line's planted program (the #489 acceptance README: Planted programs).
fn planted_of(v: Option<&Value>) -> Option<Planted> {
    Some(match v {
        None => Planted::None,
        Some(Value::String(p)) => match p.as_str() {
            "follow_steps_from_previous_frame" => Planted::FollowStepsFromPreviousFrame,
            "schedules_whole_items" => Planted::SchedulesWholeItems,
            "spring_drops_velocity" => Planted::SpringDropsVelocity,
            "per_loop_rounds_period_to_flick" => Planted::PerLoopRoundsPeriod,
            "transition_restarts_from_old_target" => Planted::TransitionRestarts,
            "table_form_samples_8" => Planted::TableFormSamples8,
            "pulse_leaves_residue" => Planted::PulseLeavesResidue,
            "back_ignores_params" => Planted::BackIgnoresParams,
            "beat_grid_f32_seconds" => Planted::BeatGridF32,
            "placement_f32_seconds" => Planted::PlacementF32Seconds,
            "replay_at_rate_1" => Planted::ReplayAtRate1,
            "blend_per_component" => Planted::BlendPerComponent,
            "slerp_long_arc" => Planted::SlerpLongArc,
            "unkeyed_resets_to_base" => Planted::UnkeyedResetsToBase,
            "ramp_sums_per_frame" => Planted::RampSumsPerFrame,
            "hitstop_matches_parent_time" => Planted::HitstopMatchesParentTime,
            _ => return None,
        },
        Some(_) => return None,
    })
}

/// A request's input track (#417 `track`, #489 `input`), or `None` for an entry that isn't
/// `{t, seq, control, value}`; #489's entries also carry their `writer`.
fn track_of(value: Option<&Value>) -> Option<Vec<Entry>> {
    let Some(value) = value else {
        return Some(Vec::new());
    };
    value
        .as_array()?
        .iter()
        .map(|e| {
            Some(Entry {
                t: flicks(e.get("t"))?,
                seq: e.get("seq").and_then(Value::as_i64)?,
                control: e.get("control").and_then(Value::as_str)?.to_string(),
                value: e.get("value")?.clone(),
            })
        })
        .collect()
}

/// The look's time feel: a look@1, or a shipped look's ID; at its defaults with no look.
fn look_feel(look: Option<&Value>, frame_rate: (u32, u32)) -> Result<Feel, Value> {
    let def = match look {
        None => return Ok(Feel::default()),
        Some(Value::String(id)) => deep_canvas_marks::look::shipped(id).ok_or_else(|| {
            refusal(Refused {
                code: "ref_unresolved",
                path: "look".into(), detail: None })
        })?,
        Some(def @ Value::Object(_)) => def.clone(),
        Some(_) => return Err(bad_input()),
    };
    let Value::Object(def) = def else {
        return Err(bad_input());
    };
    feel_of(&def, frame_rate).map_err(refusal)
}

fn eval_line(input: &Map<String, Value>) -> Value {
    let (Some(Value::Object(doc)), Some(Value::Array(times))) =
        (input.get("doc"), input.get("times"))
    else {
        return bad_input();
    };
    let Some(times) = times
        .iter()
        .map(|t| flicks(Some(t)))
        .collect::<Option<Vec<_>>>()
    else {
        return bad_input();
    };
    let flag = |k: &str| input.get(k).and_then(Value::as_bool);
    let reduced_motion = match input.get("view") {
        None => false,
        Some(v) => match v.get("reduced_motion") {
            None => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return bad_input(),
        },
    };
    // The planted twin (#417 AC10) reads time.state's ease as linear; #489's plants are motion's.
    let linear = input.get("planted").and_then(Value::as_str) == Some("state_ease_linear");
    let planted = if linear { Some(Planted::None) } else { planted_of(input.get("planted")) };
    let (Some(planted), Some(track), Some(entries)) = (planted, track_of(input.get("track")), track_of(input.get("input"))) else {
        return bad_input();
    };
    // #490: the function tables and ease tables a pinned pack would give the document, each
    // checked once; a broken one refuses the document, naming it.
    let scope = match input.get("packs") {
        None => Scope::default(),
        Some(Value::Array(packs)) => match Scope::of_packs(packs) {
            Ok(scope) => scope,
            Err(e) => {
                let mut detail = e.refusal.to_json(&e.name);
                detail["ok"] = json!(false);
                detail["code"] = json!("bad_table");
                detail["path"] = json!(format!("packs/{}: {}", e.name, e.refusal));
                return detail;
            }
        },
        Some(_) => return bad_input(),
    };
    let options = Options {
        input: entries,
        reduced_motion,
        planted,
        unwrap: flag("unwrap").unwrap_or(false),
        scope,
        layout: Some(Layout(solve_layout)),
    };
    let program = match Program::compile_with(doc, options) {
        Ok(p) => p,
        Err(r) => return refusal(r),
    };
    let mut feel = match look_feel(input.get("look"), program.motion.frame_rate) {
        Ok(feel) => feel,
        Err(answer) => return answer,
    };
    if linear {
        feel.ease = Ease::Linear;
    }
    let Some(program) = program.with_inputs(feel, &track) else {
        return bad_input();
    };
    // The document's own revision hash: the look, the track and the times never enter it.
    let value = Value::Object(doc.clone());
    let hash = match revision_hash(
        &value,
        &DocShape::new(&value, &deep_canvas::kinds::registry()),
    ) {
        Ok(hash) => hash,
        Err(e) => return json!({"ok": false, "code": "out_of_range", "path": e.path}),
    };
    let motion = &program.motion;
    let mut state = program.state();
    if flag("timing") == Some(true) {
        // Each frame's own evaluation, the document compiled before the first.
        let frames: Vec<Value> = times
            .iter()
            .map(|&t| {
                let started = std::time::Instant::now();
                program.evaluate(t, Validity::Full, &mut state);
                let ms = started.elapsed().as_secs_f64() * 1e3;
                json!({"t": t, "eval_ms": ms})
            })
            .collect();
        return json!({"ok": true, "frames": frames});
    }
    let track = input.contains_key("input").then(|| {
        json!({"hash": track_hash(&program.options.input), "entries": program.options.input.len()})
    });
    let mut frames = Vec::with_capacity(times.len());
    let mut degenerate: Vec<Value> = Vec::new();
    let mut previous: Option<i64> = None;
    for &t in &times {
        let f = frame_with(doc, &program, t, Validity::Full, &mut state);
        let passes = previous.map_or(0, |p| {
            let (_, before) = position(motion, p);
            (f.pass - before).max(0)
        });
        let channels: Map<String, Value> = f
            .channels
            .iter()
            .enumerate()
            .map(|(c, (id, s))| {
                let value = match s.value.as_slice() {
                    [one] => json!(one),
                    many => json!(many),
                };
                let mut out = json!({"value": value, "iterations": s.iterations});
                // #417's follows come after the channels in the frame; only #489's report more.
                let spec = motion.channels.get(c).and_then(|ch| ch.follow.as_ref());
                if let (Some(spec), Some(Some(follow))) = (spec, program.channel_follows.get(c)) {
                    let o = state.follow[c];
                    if spec.rate {
                        out["rate"] = json!(o.rate);
                    }
                    if spec.integral {
                        out["integral"] = json!(o.integral);
                    }
                    if matches!(spec.source, Source::Control(_)) {
                        // Built once per input track: every segment is solved before the first frame.
                        out["segments"] = json!(follow.segments.len());
                        out["solves"] = json!(follow.segments.len());
                    }
                }
                (id.clone(), out)
            })
            .collect();
        let ids = motion.limits.iter().map(|l| &l.id).chain(motion.constraints.iter().map(|c| &c.id));
        let constraints: Map<String, Value> = ids
            .zip(&state.reports)
            .map(|(id, (ops, scale))| {
                let mut r = json!({"ops": ops});
                if scale.is_finite() {
                    r["scale"] = json!(scale);
                }
                (id.clone(), r)
            })
            .collect();
        let placements: Map<String, Value> = motion
            .placements
            .iter()
            .zip(&f.placements)
            .enumerate()
            .map(|(i, (p, (id, local)))| {
                let wraps =
                    previous.map_or(0, |prev| p.wraps(motion, position(motion, prev).0, f.doc_t));
                let rates: Map<String, Value> = program
                    .placement_rates(i, f.doc_t)
                    .into_iter()
                    .map(|(channel, rate)| {
                        (channel, match rate.as_slice() {
                            [one] => json!(one),
                            many => json!(many),
                        })
                    })
                    .collect();
                (
                    id.clone(),
                    json!({
                        "iteration": local.map(|l| l.iteration),
                        "local": local.map(|l| l.local),
                        "passes": wraps,
                        "rates": rates,
                    }),
                )
            })
            .collect();
        let remaps: Map<String, Value> = motion
            .remaps
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let parent = program.remap_parent(i, f.doc_t);
                let child = r.child(parent);
                let reading = json!({"child": child, "rate": r.rate(parent), "active": f64::from(u8::from(r.active(parent))), "progress": r.progress(parent)});
                (r.id.clone(), reading)
            })
            .collect();
        let mut frame = json!({
            "t": f.t,
            "frame": program.frame_index(f.doc_t),
            "doc_t": f.doc_t,
            "pass": f.pass,
            "passes": passes,
            "items": f.items,
            "channels": channels,
            "constraints": constraints,
            "placements": placements,
            "cameras": f.cameras.iter().map(|(id, target)| (id.clone(), json!({"target": target}))).collect::<Map<String, Value>>(),
            "valid_until": f.valid_until,
        });
        if let Some(track) = &track {
            frame["input"] = track.clone();
        }
        if !remaps.is_empty() {
            frame["remaps"] = Value::Object(remaps);
        }
        let aimless: Vec<&str> = motion.constraints.iter().zip(&state.degenerate).filter(|(_, d)| **d).map(|(c, _)| c.id.as_str()).collect();
        for id in aimless {
            let notice = json!({"code": "look_at_degenerate", "constraint": id, "t": f.t});
            frame["notices"].as_array_mut().map(|n| n.push(notice.clone())).unwrap_or_else(|| frame["notices"] = json!([notice.clone()]));
            degenerate.push(notice);
        }
        // #491: each laid-out item's box at this time, where the document lays any out.
        if let Some(boxes) = program.boxes(f.doc_t).filter(|b| !b.is_empty()) {
            frame["boxes"] = json!(boxes);
        }
        frames.push(frame);
        previous = Some(t);
    }
    let markers: Map<String, Value> = motion
        .markers
        .iter()
        .map(|m| {
            (
                m.id.clone(),
                json!({"kind": m.kind, "t": m.start, "end": m.end}),
            )
        })
        .collect();
    let cuts: Vec<Value> = motion
        .cuts
        .iter()
        .map(|c| json!({"id": c.id, "from": c.from, "to": c.to, "t": c.at}))
        .collect();
    let mut answer = json!({"ok": true, "order": program.order_names, "frames": frames, "markers": markers, "cuts": cuts, "hash": hash});
    // #491: the notices the check raised, such as literal_time_with_tempo_map.
    if !motion.notices.is_empty() || !degenerate.is_empty() {
        answer["notices"] = json!(motion.notices.iter().chain(&degenerate).collect::<Vec<_>>());
    }
    // #490: each channel's and driver's bound, the one the hard-range check reads.
    if flag("bounds") == Some(true) {
        let bound = |b: Option<(f64, f64)>| match b {
            Some((lo, hi)) => json!({"lo": lo, "hi": hi}),
            None => json!({"lo": null, "hi": null, "estimate": true}),
        };
        let (channels, drivers) = program.bounds();
        let group = |list: Vec<(String, Option<(f64, f64)>)>| {
            list.into_iter().map(|(id, b)| (id, bound(b))).collect::<Map<String, Value>>()
        };
        answer["bounds"] = json!({"channels": group(channels), "drivers": group(drivers)});
    }
    answer
}

fn insert_line(input: &Map<String, Value>) -> Value {
    let (Some(doc), Some(Value::String(channel)), Some(t)) = (
        input.get("doc"),
        input.get("channel"),
        flicks(input.get("t")),
    ) else {
        return bad_input();
    };
    match insert(doc, channel, t) {
        Ok((doc, key)) => json!({"ok": true, "doc": doc, "key": key}),
        Err(r) => refusal(r),
    }
}

fn run_line(input: &Map<String, Value>) -> Value {
    let (Some(Value::Object(doc)), Some(to)) = (input.get("doc"), flicks(input.get("to"))) else {
        return bad_input();
    };
    let mode = match input.get("mode").and_then(Value::as_str) {
        Some("armed") => Mode::Armed,
        Some("every_vsync") => Mode::EveryVsync,
        _ => return bad_input(),
    };
    let validity = match input.get("planted") {
        None => Validity::Full,
        Some(Value::String(p)) if p == "valid_until_ignores_placements" => {
            Validity::IgnorePlacements
        }
        Some(_) => return bad_input(),
    };
    let hz = match input.get("refresh_hz") {
        None => 60,
        Some(v) => match v.as_i64() {
            Some(hz) if hz > 0 => hz,
            _ => return bad_input(),
        },
    };
    // A display rate whose frame isn't a whole number of flicks is not a valid rate.
    if FLICKS_PER_SECOND % hz != 0 || to < 0 {
        return bad_input();
    }
    let program = match Program::compile(doc) {
        Ok(p) => p,
        Err(r) => return refusal(r),
    };
    let mut vsyncs = Vec::new();
    run(
        doc,
        &program,
        to,
        FLICKS_PER_SECOND / hz,
        mode,
        validity,
        |v| {
            vsyncs.push(json!({
                "t": v.t,
                "presented": v.presented,
                "valid_until": v.shown.valid_until,
                "items": v.shown.items,
            }));
        },
    );
    json!({"ok": true, "vsyncs": vsyncs})
}

fn answer(command: &str, line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    match command {
        "eval" => eval_line(&input),
        "insert" => insert_line(&input),
        "run" => run_line(&input),
        _ => bad_input(),
    }
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    let [command] = command.as_slice() else {
        eprintln!("deep-motion: usage: deep-motion eval | insert | run");
        std::process::exit(2);
    };
    if !["eval", "insert", "run"].contains(&command.as_str()) {
        eprintln!("deep-motion: usage: deep-motion eval | insert | run");
        std::process::exit(2);
    }
    let mut out = io::stdout().lock();
    for buf in io::stdin().lock().split(b'\n') {
        let Ok(buf) = buf else { break };
        let answer = match std::str::from_utf8(&buf) {
            Ok(text) => answer(command, text.trim_end_matches(['\n', '\r'])),
            Err(_) => bad_input(),
        };
        let text = serde_json::to_string(&answer).unwrap_or_else(|_| bad_input().to_string());
        if writeln!(out, "{text}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}
