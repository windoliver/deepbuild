//! `deep-motion <eval|insert|run>`: JSON lines in, one JSON line out per input line, in order,
//! exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value
//! answers `{"ok":false,"code":"bad_input"}`. The surface is the #391 acceptance README's,
//! `eval`'s `look`, `track`, `cameras` and `hash` the #417 one's, and its `input`, `view`,
//! `unwrap`, `timing`, `order` and `constraints` the #489 one's, and `run`'s `view` and `pans`
//! the #1487 one's.

use std::io::{self, BufRead, Write};

use deep_canvas::canon::revision_hash;
use deep_canvas::document::DocShape;
use deep_canvas::expr::Scope;
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas_motion::clock::{meets, run, Mode, Rect, View};
use deep_canvas_motion::curve::Ease;
use deep_canvas_motion::doc::{feel_of, Feel, Refused};
use deep_canvas_motion::eval::{frame_with, position, shown_doc, Validity};
use deep_canvas_motion::follow::Source;
use deep_canvas_motion::input::Entry;
use deep_canvas_motion::insert::insert;
use deep_canvas_motion::program::{track_hash, Boxes, Layout, Options, Planted, Program, State};
use deep_canvas_motion::shots::{bounds_at, project, At};
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
            "cells_seeded_from_t" => Planted::CellsSeededFromT,
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
            "log_zoom_eases_width" => Planted::LogZoomEasesWidth,
            "framer_samples_30hz" => Planted::FramerSamples30Hz,
            "framer_fits_samples" => Planted::FramerFitsSamples,
            "lens_zoom_eases_fov_degrees" => Planted::LensZoomEasesFovDegrees,
            "lens_zoom_dollies" => Planted::LensZoomDollies,
            "whip_eases_halves" => Planted::WhipEasesHalves,
            "shake_fresh_per_frame" => Planted::ShakeFreshPerFrame,
            "shot_writes_roll_0" => Planted::ShotWritesRoll0,
            "pan_ignores_angle" => Planted::PanIgnoresAngle,
            "match_framer_ignores_match" => Planted::MatchFramerIgnoresMatch,
            "kick_fresh_per_frame" => Planted::KickFreshPerFrame,
            "stage_glide_moves_target_only" => Planted::StageGlideMovesTargetOnly,
            "take_apart_all_at_once" => Planted::TakeApartAllAtOnce,
            "framer_ignores_apart" => Planted::FramerIgnoresApart,
            "readout_reads_document" => Planted::ReadoutReadsDocument,
            "assembly_value_from_previous_frame" => Planted::AssemblyValueFromPreviousFrame,
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
            let player = match e.get("player") {
                None => 1,
                Some(p) => p.as_i64().filter(|p| (1..=8).contains(p))?,
            };
            Some(Entry {
                t: flicks(e.get("t"))?,
                seq: e.get("seq").and_then(Value::as_i64)?,
                control: e.get("control").and_then(Value::as_str)?.to_string(),
                value: e.get("value")?.clone(),
                player,
            })
        })
        .collect()
}

/// #497: when each entry of `input` reaches the track, in the order listed: its `arrives`, or
/// before the first frame (`i64::MIN`) without one.
fn arrivals_of(value: Option<&Value>) -> Option<Vec<i64>> {
    let Some(Value::Array(list)) = value else {
        return Some(Vec::new());
    };
    list.iter()
        .map(|e| match e.get("arrives") {
            None => Some(i64::MIN),
            Some(a) => a.as_i64(),
        })
        .collect()
}

/// #497's planted tracks: one that keeps entries where they arrived, and one that forks at a
/// late entry, dropping the entries stamped after it.
#[derive(Clone, Copy, PartialEq)]
enum TrackPlant {
    None,
    OrdersByArrival,
    ForksAtLateEntry,
}

/// The track once `entry` arrives at `at`: it joins at its own place, dropping nothing; planted,
/// at its arrival, or after dropping every entry stamped after it.
fn take(track: &mut Vec<Entry>, mut entry: Entry, at: i64, plant: TrackPlant) {
    match plant {
        TrackPlant::None => {}
        TrackPlant::OrdersByArrival => entry.t = entry.t.max(at),
        TrackPlant::ForksAtLateEntry => track.retain(|e| e.t <= entry.t),
    }
    track.push(entry);
}

/// The look's time feel: a look@1, or a shipped look's ID; at its defaults with no look.
fn look_feel(look: Option<&Value>, frame_rate: (u32, u32)) -> Result<Feel, Value> {
    let def = match look {
        None => return Ok(Feel::default()),
        Some(Value::String(id)) => deep_canvas_marks::look::shipped(id).ok_or_else(|| {
            refusal(Refused {
                code: "ref_unresolved",
                path: "look".into(),
                detail: None,
            })
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
    let plant = match input.get("planted").and_then(Value::as_str) {
        Some("track_orders_by_arrival") => TrackPlant::OrdersByArrival,
        Some("track_forks_at_late_entry") => TrackPlant::ForksAtLateEntry,
        _ => TrackPlant::None,
    };
    let planted = if linear || plant != TrackPlant::None {
        Some(Planted::None)
    } else {
        planted_of(input.get("planted"))
    };
    let (Some(planted), Some(track), Some(listed), Some(arrives)) = (
        planted,
        track_of(input.get("track")),
        track_of(input.get("input")),
        arrivals_of(input.get("input")),
    ) else {
        return bad_input();
    };
    // #504: without an `input`, the `track` is the program's input track too, so its sliders'
    // entries move the drivers that read them.
    let (listed, arrives) = if input.contains_key("input") {
        (listed, arrives)
    } else {
        (track.clone(), vec![i64::MIN; track.len()])
    };
    // #497: the entries that arrive later than the first frame wait; the rest are on the track.
    let first = times.first().copied().unwrap_or(i64::MIN);
    let mut waiting: Vec<(i64, Entry)> = Vec::new();
    let mut entries: Vec<Entry> = Vec::new();
    for (entry, at) in listed.into_iter().zip(arrives) {
        if at <= first {
            take(&mut entries, entry, at, plant);
        } else {
            waiting.push((at, entry));
        }
    }
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
        input: Vec::new(),
        reduced_motion,
        planted,
        unwrap: flag("unwrap").unwrap_or(false),
        scope,
        layout: Some(Layout(solve_layout)),
    };
    // The document compiled over the track as it stands, again whenever an entry arrives.
    let build = |entries: &[Entry]| -> Result<Program, Value> {
        let options = Options {
            input: entries.to_vec(),
            ..options.clone()
        };
        let program = Program::compile_with(doc, options).map_err(refusal)?;
        let mut feel = look_feel(input.get("look"), program.motion.frame_rate)?;
        if linear {
            feel.ease = Ease::Linear;
        }
        // #504: without a #417 `track`, the program's own track (`input`, or the document's
        // inline one) moves its toggles and stages under the look's feel.
        let moves = if input.contains_key("track") {
            track.clone()
        } else {
            program.options.input.clone()
        };
        program.with_inputs(feel, &moves).ok_or_else(bad_input)
    };
    let mut program = match build(&entries) {
        Ok(p) => p,
        Err(answer) => return answer,
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
    let shows_track = input.contains_key("input");
    let film = match film_of(input, &program) {
        Some(film) => film,
        None => return bad_input(),
    };
    let mut frames = Vec::with_capacity(times.len());
    let mut degenerate: Vec<Value> = Vec::new();
    let mut previous: Option<i64> = None;
    for &t in &times {
        // #497: the entries that have arrived by this frame join the track, each at its place.
        if waiting.iter().any(|(at, _)| *at <= t) {
            for (at, entry) in std::mem::take(&mut waiting) {
                if at <= t {
                    take(&mut entries, entry, at, plant);
                } else {
                    waiting.push((at, entry));
                }
            }
            program = match build(&entries) {
                Ok(p) => p,
                Err(answer) => return answer,
            };
            state = program.state();
        }
        let motion = &program.motion;
        let track = shows_track.then(|| {
            json!({"hash": track_hash(&program.options.input), "entries": program.options.input.len()})
        });
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
                // #494: a path channel's value as path@1's columns.
                let path = motion.channels.get(c).and_then(|ch| ch.path.as_ref());
                let value = match (path, s.value.as_slice()) {
                    (Some(p), run) => deep_canvas_motion::morph::value_of(
                        &deep_canvas_motion::morph::unflat(run, &p.structure),
                    ),
                    (None, [one]) => json!(one),
                    (None, many) => json!(many),
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
        let ids = motion
            .limits
            .iter()
            .map(|l| &l.id)
            .chain(motion.constraints.iter().map(|c| &c.id));
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
                        (
                            channel,
                            match rate.as_slice() {
                                [one] => json!(one),
                                many => json!(many),
                            },
                        )
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
            "cameras": cameras_json(&program, &state, &f.cameras, f.doc_t, &film),
            "valid_until": f.valid_until,
        });
        if let Some(track) = &track {
            frame["input"] = track.clone();
        }
        if !remaps.is_empty() {
            frame["remaps"] = Value::Object(remaps);
        }
        let aimless: Vec<&str> = motion
            .constraints
            .iter()
            .zip(&state.degenerate)
            .filter(|(_, d)| **d)
            .map(|(c, _)| c.id.as_str())
            .collect();
        for id in aimless {
            let notice = json!({"code": "look_at_degenerate", "constraint": id, "t": f.t});
            frame["notices"]
                .as_array_mut()
                .map(|n| n.push(notice.clone()))
                .unwrap_or_else(|| frame["notices"] = json!([notice.clone()]));
            degenerate.push(notice);
        }
        if !film.project.is_empty() {
            frame["projected"] = projected_json(doc, &program, &state, f.doc_t, &film);
        }
        // #491: each laid-out item's box at this time, where the document lays any out.
        if let Some(boxes) = program.boxes(f.doc_t).filter(|b| !b.is_empty()) {
            frame["boxes"] = json!(boxes);
        }
        let readouts = readouts_json(doc, &program, &state);
        if !readouts.is_empty() {
            frame["readouts"] = Value::Object(readouts);
        }
        frames.push(frame);
        previous = Some(t);
    }
    let motion = &program.motion;
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
    // #493: each shot's one framed pose and the kept items' union it fit; #504 a stage's shots too.
    if let Some(plan) = program
        .shots
        .as_ref()
        .filter(|p| !p.shots.is_empty() || p.stage.iter().any(Option::is_some))
    {
        answer["shots"] = plan
            .shots
            .iter()
            .chain(plan.stage.iter().flatten())
            .map(|s| {
                let union = s
                    .union
                    .map_or(Value::Null, |u| json!({"lo": u[0], "hi": u[1]}));
                (
                    s.id.clone(),
                    json!({"framed": s.framed.to_json(Some(&s.id)), "union": union}),
                )
            })
            .collect::<Map<String, Value>>()
            .into();
    }
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
            list.into_iter()
                .map(|(id, b)| (id, bound(b)))
                .collect::<Map<String, Value>>()
        };
        answer["bounds"] = json!({"channels": group(channels), "drivers": group(drivers)});
    }
    answer
}

/// #493: what an eval line asks of its cameras: the items it projects, the look's motion blur
/// and indexed target, the view's reduced motion and the planted program.
struct Film {
    project: Vec<String>,
    blur: Option<(f64, u32)>,
    indexed: Option<f64>,
    reduced: bool,
    planted: Planted,
}

fn film_of(input: &Map<String, Value>, program: &Program) -> Option<Film> {
    let project = match input.get("project") {
        None => Vec::new(),
        Some(Value::Array(ids)) => ids
            .iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect::<Option<_>>()?,
        Some(_) => return None,
    };
    let look = input.get("look").filter(|l| l.is_object());
    let blur = look.and_then(|l| l.get("motion_blur")).map(|b| {
        (
            b.get("shutter_angle")
                .and_then(Value::as_f64)
                .unwrap_or(180.0),
            b.get("samples").and_then(Value::as_u64).unwrap_or(8) as u32,
        )
    });
    let indexed = look
        .and_then(|l| l.pointer("/basis/indexed/size/0"))
        .and_then(Value::as_f64);
    Some(Film {
        project,
        blur,
        indexed,
        reduced: program.options.reduced_motion,
        planted: program.options.planted,
    })
}

/// Each camera's pose at t, as the frame reports it (#493: the pose it is drawn through, its
/// kick applied), and the sub-samples motion blur averages inside a declared move. A camera no
/// timeline shot writes shows its stage shot's pose (#504), gliding from the pose shown; one
/// whose params aren't a pose reports its stage's target alone (#417).
fn cameras_json(
    program: &Program,
    state: &State,
    stage: &[(String, [f64; 3])],
    t: i64,
    film: &Film,
) -> Map<String, Value> {
    let Some(plan) = program.shots.as_ref() else {
        return stage
            .iter()
            .map(|(id, target)| (id.clone(), json!({"target": target})))
            .collect();
    };
    let keyed = |c: usize| plan.keyed_pose(c, program, state);
    let at = At {
        reduced: film.reduced,
        planted: film.planted,
        indexed: film.indexed,
        keyed: &keyed,
    };
    stage
        .iter()
        .map(|(id, target)| {
            let Some(c) = plan
                .camera(id)
                .filter(|&c| plan.cameras[c].own.is_some() || plan.shot_at(c, t).is_some())
            else {
                return (id.clone(), json!({"target": target}));
            };
            let shown = plan.shown(c, t, &at);
            let staged = shown
                .stage
                .and_then(|s| plan.stage[s].as_ref())
                .map(|s| s.id.as_str());
            let name = shown.shot.map(|s| plan.shots[s].id.as_str()).or(staged);
            let mut out = shown.pose.to_json(name);
            if let Some((angle, samples)) = film.blur {
                let subs = plan.blur(c, t, &at, angle, samples);
                if !subs.is_empty() {
                    out["blur"] = subs
                        .iter()
                        .map(|(ts, s, p)| {
                            let name = s.map(|s| plan.shots[s].id.as_str());
                            json!({"t": ts, "shot": name, "pose": p.to_json(name)})
                        })
                        .collect::<Vec<_>>()
                        .into();
                }
            }
            (id.clone(), out)
        })
        .collect()
}

/// #504: each readout's text as the frame shows it: every `text@1` with a `template`, by its ID,
/// and the card's `readout` under `card`, each filled from the values the frame evaluates
/// (`eval::shown_doc`). A template a slot of which reads nothing shows nothing.
fn readouts_json(doc: &Map<String, Value>, program: &Program, state: &State) -> Map<String, Value> {
    let shown = shown_doc(doc, program, state);
    let texts = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(id, item)| {
            let text = item.get("kind").and_then(Value::as_str) == Some("text@1");
            Some((
                id.clone(),
                item.pointer("/params/template")?
                    .as_str()
                    .filter(|_| text)?,
            ))
        });
    let card = doc
        .get("card")
        .and_then(|c| c.get("readout"))
        .and_then(Value::as_str)
        .map(|t| ("card".to_string(), t));
    texts
        .chain(card)
        .filter_map(|(id, template)| {
            Some((
                id,
                json!(deep_canvas::template::expand(&shown, template).ok()?),
            ))
        })
        .collect()
}

/// #493: each item the line projects, through the document camera's pose at t: the projection
/// of its bounds' centre and the box of their corners, in px of the document's size.
fn projected_json(
    doc: &Map<String, Value>,
    program: &Program,
    state: &State,
    t: i64,
    film: &Film,
) -> Value {
    let Some(plan) = program.shots.as_ref() else {
        return json!({});
    };
    let Some(c) = doc
        .get("camera")
        .and_then(Value::as_str)
        .and_then(|id| plan.camera(id))
    else {
        return json!({});
    };
    let keyed = |c: usize| plan.keyed_pose(c, program, state);
    let at = At {
        reduced: film.reduced,
        planted: film.planted,
        indexed: film.indexed,
        keyed: &keyed,
    };
    let projector = plan.shown(c, t, &at).pose.projector(plan.size);
    film.project
        .iter()
        .filter_map(|id| {
            let b = bounds_at(program, doc, state, id)?;
            let (centre, bx) = project(&projector, &b, plan.size)?;
            Some((id.clone(), json!({"center": centre, "box": bx})))
        })
        .collect::<Map<String, Value>>()
        .into()
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

/// A view's region, `[x, y, w, h]` with a size above 0.
fn rect_of(v: &Value) -> Option<Rect> {
    match v.as_array()?.as_slice() {
        [x, y, w, h] => {
            let r = [x.as_f64()?, y.as_f64()?, w.as_f64()?, h.as_f64()?];
            (r.iter().all(|n| n.is_finite()) && r[2] > 0.0 && r[3] > 0.0).then_some(r)
        }
        _ => None,
    }
}

/// #1487 AC3's wrong program: an item meets a view only when its box's center lies in it.
fn meets_by_center(item: &Value, rect: &Rect) -> bool {
    let n = |p: &str| item.pointer(p).and_then(Value::as_f64);
    let Some(b) = item.pointer("/params/box").and_then(Value::as_array) else {
        return true;
    };
    let b = |i: usize| b.get(i).and_then(Value::as_f64).unwrap_or(0.0);
    let x = n("/at/pos/0").unwrap_or(0.0) + b(0) + b(2) / 2.0;
    let y = n("/at/pos/1").unwrap_or(0.0) + b(1) + b(3) / 2.0;
    x >= rect[0] && x <= rect[0] + rect[2] && y >= rect[1] && y <= rect[1] + rect[3]
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
    // #1487's twins of the view's rule: the merge base's, a center test, a stale return.
    let mut validity = Validity::Full;
    let mut test: fn(&Value, &Rect) -> bool = meets;
    let mut stale_return = false;
    match input.get("planted").map(|p| p.as_str()) {
        None => {}
        Some(Some("valid_until_ignores_placements")) => validity = Validity::IgnorePlacements,
        Some(Some("valid_until_ignores_view")) => test = |_, _| true,
        Some(Some("view_meets_by_center")) => test = meets_by_center,
        Some(Some("return_draws_stale_value")) => stale_return = true,
        Some(_) => return bad_input(),
    }
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
    let period = FLICKS_PER_SECOND / hz;
    let rect = match input.get("view") {
        None => None,
        Some(v) => match v.get("rect").and_then(rect_of) {
            Some(r) => Some(r),
            None => return bad_input(),
        },
    };
    let pans = match input.get("pans") {
        None => Vec::new(),
        Some(Value::Array(list)) => {
            let pans: Option<Vec<(i64, Rect)>> = list
                .iter()
                .map(|p| Some((flicks(p.get("at"))?, rect_of(p.get("rect")?)?)))
                .collect();
            match pans {
                // Each on a vsync, in order, after a view to pan.
                Some(p)
                    if rect.is_some()
                        && p.iter().all(|(at, _)| *at > 0 && at % period == 0)
                        && p.windows(2).all(|w| w[0].0 < w[1].0) =>
                {
                    p
                }
                _ => return bad_input(),
            }
        }
        Some(_) => return bad_input(),
    };
    let view = rect.map(|rect| View {
        rect,
        pans: &pans,
        meets: test,
        stale_return,
    });
    let program = match Program::compile(doc) {
        Ok(p) => p,
        Err(r) => return refusal(r),
    };
    let mut vsyncs = Vec::new();
    run(
        doc,
        &program,
        to,
        period,
        mode,
        validity,
        view.as_ref(),
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
