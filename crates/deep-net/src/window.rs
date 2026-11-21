//! #551: net.rollback and net.budget for a match with a rollback window (canvas primitives: Check
//! input: net kinds). net.rollback plays the match once with every message on time and again
//! under 8 seeded schedules that hold each frame back by up to the window and one that holds
//! every frame exactly the window, and passes only when each copy reaches the on-time run's
//! full-state hash at every confirmed step, keeps the same occurrences, step hashes and
//! checkpoints, and records the same track, naming the first step that differs. net.budget
//! steps the piece's match with a full window rolled back and stepped again each frame, five
//! times, and fails when one frame's worst case can't fit the class's frame time, naming the
//! canvas module that costs most; it counts the snapshot bytes the rollback rings write a second
//! and reports, for each host, the largest window whose worst frame fits.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::card::Card;
use crate::copy::{End, Stepper};
use crate::kind::Config;
use crate::play::{play, Ask, Faults, Held, Played};

/// The most a window may be (Net `net@1`).
pub const MOST: i64 = 16;

/// splitmix64 of a seed: each schedule's own.
fn mix(seed: u64, n: u64) -> u64 {
    let mut z = seed.wrapping_add(n.wrapping_mul(0x9e37_79b9_7f4a_7c15));
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// What one copy left that a held-back run must match: its full-state hash at each confirmed
/// step, what its modules made at each step, its record's track and how its match ended.
struct Left {
    hashes: BTreeMap<i64, u64>,
    made: BTreeMap<i64, Value>,
    track: Vec<Value>,
    end: Option<End>,
    ran: i64,
}

fn left<S: Stepper>(played: &mut Played<S>) -> Vec<Left> {
    played
        .copies
        .iter_mut()
        .map(|c| {
            let settled = c.settled();
            Left {
                hashes: c
                    .hashes()
                    .into_iter()
                    .filter(|(k, _)| *k < settled)
                    .collect(),
                made: c
                    .sim_mut()
                    .made()
                    .into_iter()
                    .filter(|(k, _)| *k < settled)
                    .collect(),
                track: c.record()["track"].as_array().cloned().unwrap_or_default(),
                end: c.end(),
                ran: c.ran(),
            }
        })
        .collect()
}

/// The first key at which two maps differ, over the keys both reach.
fn first_apart<V: PartialEq>(a: &BTreeMap<i64, V>, b: &BTreeMap<i64, V>) -> Option<i64> {
    let upto = a.keys().max().copied().min(b.keys().max().copied())?;
    a.keys()
        .chain(b.keys())
        .filter(|k| **k <= upto)
        .copied()
        .filter(|k| a.get(k) != b.get(k))
        .min()
}

/// The first step at which two tracks differ, by the entries' times.
fn track_apart(a: &[Value], b: &[Value], len: i64) -> Option<i64> {
    let key = |e: &Value| json!([e["t"], e["player"], e["seq"], e["control"], e["value"]]);
    let n = a.len().min(b.len());
    let at = (0..n)
        .find(|i| key(&a[*i]) != key(&b[*i]))
        .or((a.len() != b.len()).then_some(n))?;
    let t = |e: Option<&Value>| e.and_then(|e| e["t"].as_i64()).unwrap_or(i64::MAX);
    Some(t(a.get(at)).min(t(b.get(at))) / len)
}

/// net.rollback with a window above 0. It gives the last held-back run and the report.
pub fn rollback<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
) -> Result<(Played<S>, Value), Value> {
    // Every confirmed step's full-state hash, not only every `hash_every`.
    let every = Config {
        hash_every: 1,
        ..cfg.clone()
    };
    let quiet = Ask {
        faults: crate::checks::on_time(ask),
        shows: Vec::new(),
        ..ask.clone()
    };
    // #277: a copy a seeded leave killed stops where it was killed, in either run.
    let gone = crate::checks::killed(ask);
    let mut on_time = play(&every, card, &quiet, make)?;
    let base = left(&mut on_time);
    // The schedule the ask gives, or the design's own: 8 seeded ones that hold each frame back by
    // up to the window, and one that holds every frame exactly the window.
    let given = ask.faults.held.is_some() || !ask.faults.deliver.is_empty();
    let schedules: Vec<(Value, Faults)> = if given {
        let named = match ask.faults.held {
            Some(Held::UpTo(n)) => json!({"up_to": n}),
            Some(Held::Exactly(n)) => json!({"exactly": n}),
            None => json!({}),
        };
        let mut named = named;
        if !ask.faults.deliver.is_empty() {
            let d: Vec<Value> = ask
                .faults
                .deliver
                .iter()
                .map(|d| json!({"player": d.player, "step": d.step, "to": d.to, "at": d.at}))
                .collect();
            named["deliver"] = json!(d);
        }
        vec![(named, ask.faults.clone())]
    } else {
        let seeded = (1..=8).map(|i| {
            let seed = mix(ask.faults.seed, i);
            let faults = Faults {
                seed,
                held: Some(Held::UpTo(cfg.window)),
                ..ask.faults.clone()
            };
            (json!({"seed": seed, "up_to": cfg.window}), faults)
        });
        let exact = Faults {
            held: Some(Held::Exactly(cfg.window)),
            ..ask.faults.clone()
        };
        seeded
            .chain([(json!({"exactly": cfg.window}), exact)])
            .collect()
    };
    let mut failures = Vec::new();
    let mut runs = Vec::new();
    let mut first_run = None;
    for (name, faults) in schedules {
        let mut held = play(
            &every,
            card,
            &Ask {
                faults,
                ..ask.clone()
            },
            make,
        )?;
        let got = left(&mut held);
        let mut fail = |copy: u8, step: Option<i64>, what: String| {
            failures.push(json!({"schedule": name, "copy": copy, "step": step, "what": what}));
        };
        for ((c, a), b) in held.copies.iter().zip(&got).zip(&base) {
            let me = c.me;
            if gone.contains(&me) {
                continue;
            }
            if let Some(f) = c.report().get("fault").filter(|f| !f.is_null()) {
                fail(
                    me,
                    f["step"].as_i64(),
                    format!("copy {me}'s match ended faulted: net.fault {f}"),
                );
            }
            if let Some((at, to)) = c.rolled().iter().find(|(at, to)| at - to > cfg.window) {
                fail(
                    me,
                    Some(*to),
                    format!(
                        "copy {me} rolled back from step {at} to {to}, past its window of {}",
                        cfg.window
                    ),
                );
            }
            if let Some(step) = first_apart(&a.hashes, &b.hashes) {
                fail(
                    me,
                    Some(step),
                    format!(
                        "copy {me}'s full-state hash at match step {step} isn't the on-time run's"
                    ),
                );
            }
            if let Some(step) = first_apart(&a.made, &b.made) {
                fail(me, Some(step), format!("copy {me} keeps an occurrence, a step hash or a checkpoint at step {step} that the on-time run doesn't"));
            }
            if let Some(step) = track_apart(&a.track, &b.track, cfg.step()) {
                fail(me, Some(step), format!("copy {me} records another merged track than the on-time run from match step {step}"));
            }
            if a.end != b.end || a.ran < b.ran {
                let ended = |e: Option<End>| e.map_or("running", End::name);
                fail(me, Some(a.ran), format!("copy {me} ran {} steps and ended {}, where the on-time run ran {} and ended {}", a.ran, ended(a.end), b.ran, ended(b.end)));
            }
        }
        let mut run = name;
        run["rollbacks"] = json!(held
            .copies
            .iter()
            .map(|c| c.rolled().len())
            .collect::<Vec<_>>());
        runs.push(run);
        if first_run.is_none() {
            first_run = Some(held);
        }
    }
    let first = failures.iter().filter_map(|f| f["step"].as_i64()).min();
    let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
    let report = json!({"kind": "net.rollback", "verdict": verdict, "failures": failures,
                        "first_step": first, "window": cfg.window, "schedules": runs});
    Ok((first_run.expect("a schedule"), report))
}

/// One measured run: each frame's CPU time by canvas module, and each step's own.
struct Measured {
    /// Per frame: the live match step with its checkpoints, then the window restored and
    /// stepped again, each by module, in ns.
    frames: Vec<(BTreeMap<String, u64>, BTreeMap<String, u64>)>,
}

fn add(to: &mut BTreeMap<String, u64>, timed: Vec<(String, u64)>) {
    for (m, ns) in timed {
        *to.entry(m).or_default() += ns;
    }
}

/// Steps one stepper through the recorded track's `steps` match steps; after each, with a window
/// of `w`, it restores the checkpoint `w` steps back and steps them again, as a rollback of the
/// full window each frame would.
fn measure<S: Stepper>(
    s: &mut S,
    track: &[Value],
    steps: i64,
    len: i64,
    w: i64,
) -> Result<Measured, Value> {
    if w > 0 {
        s.hold(w as usize + 1);
    }
    let mut at = 0;
    let mut frames = Vec::new();
    s.timed();
    for k in 0..steps {
        let mut live = BTreeMap::new();
        if w > 0 {
            s.keep(k);
        }
        while let Some(e) = track
            .get(at)
            .filter(|e| e["t"].as_i64().is_some_and(|t| t < (k + 1) * len))
        {
            s.enter(e)?;
            at += 1;
        }
        s.run(k, (k + 1) * len)?;
        add(&mut live, s.timed());
        let mut again = BTreeMap::new();
        if w > 0 && k + 1 >= w {
            let from = k + 1 - w;
            // The entries from `from` on are dropped with the steps and join again as they run.
            s.back(from, from * len)?;
            let redo: Vec<&Value> = track
                .iter()
                .filter(|e| {
                    e["t"]
                        .as_i64()
                        .is_some_and(|t| t >= from * len && t < (k + 1) * len)
                })
                .collect();
            let mut i = 0;
            for j in from..=k {
                s.keep(j);
                while let Some(e) = redo
                    .get(i)
                    .filter(|e| e["t"].as_i64().is_some_and(|t| t < (j + 1) * len))
                {
                    s.enter(e)?;
                    i += 1;
                }
                s.run(j, (j + 1) * len)?;
            }
            add(&mut again, s.timed());
        }
        frames.push((live, again));
    }
    Ok(Measured { frames })
}

fn total(m: &BTreeMap<String, u64>) -> u64 {
    m.values().sum()
}

/// The largest window, 0 to 16, whose worst frame fits `frame_ns`, estimated from a run measured
/// with a window of `w`: each step's own time, and the restore's time a step of window.
fn largest(m: &Measured, w: i64, frame_ns: f64) -> i64 {
    let live = m.frames.iter().map(|(l, _)| total(l)).max().unwrap_or(0) as f64;
    let again = m.frames.iter().map(|(_, a)| total(a)).max().unwrap_or(0) as f64;
    // Restoring and stepping one step again, at worst: from the measured window, or in lockstep
    // about a step's own time.
    let per = if w > 0 { again / w as f64 } else { live };
    (0..=MOST)
        .rev()
        .find(|n| live + per * *n as f64 <= frame_ns)
        .unwrap_or(0)
}

/// net.budget: five runs of the match's stepping, each frame the live match step with its
/// checkpoints and, with a window, the full window restored and stepped again with a checkpoint at
/// each re-run step; the five-run rule over each run's worst frame.
pub fn budget<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
    frame_ms: f64,
    on: &[String],
) -> Result<(Played<S>, Value), Value> {
    let quiet = Ask {
        faults: Faults::default(),
        shows: Vec::new(),
        ..ask.clone()
    };
    let played = play(cfg, card, &quiet, make)?;
    let Some(first) = played.copies.first() else {
        return Err(json!({"what": "the match has no copy"}));
    };
    if let Some(f) = first
        .report()
        .get("fault")
        .filter(|f| !f.is_null())
        .cloned()
    {
        let me = first.me;
        let r = json!({"kind": "net.budget", "verdict": "FAIL", "failures": [{"copy": me, "step": f["step"], "fault": f,
            "what": format!("copy {me}'s match ended faulted: net.fault {f}")}], "runs": [], "frame_ms": frame_ms});
        return Ok((played, r));
    }
    let track = first.record()["track"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let (len, steps, w) = (cfg.step(), first.ran(), cfg.window);
    // The snapshot bytes the rings write a second, from a straight run that keeps them.
    let mut bytes = Map::new();
    if w > 0 {
        let mut plain = make(1)?;
        plain.hold(w as usize + 1);
        let mut at = 0;
        for k in 0..steps {
            plain.keep(k);
            while let Some(e) = track
                .get(at)
                .filter(|e| e["t"].as_i64().is_some_and(|t| t < (k + 1) * len))
            {
                plain.enter(e)?;
                at += 1;
            }
            plain.run(k, (k + 1) * len)?;
        }
        // The checkpoint after the last step takes that step's pages: one a match step.
        plain.keep(steps);
        let seconds = steps as f64 / cfg.step_rate as f64;
        for (m, b) in plain.written() {
            bytes.insert(m, json!((b as f64 / seconds).round()));
        }
    }
    let ms = |ns: u64| ns as f64 / 1e6;
    // A warm-up run, then five.
    measure(&mut make(1)?, &track, steps, len, w)?;
    let mut runs = Vec::new();
    let mut worst: Option<(f64, i64, BTreeMap<String, u64>)> = None;
    let mut busiest: Option<(i64, f64)> = None;
    let mut measured = None;
    for _ in 0..5 {
        let m = measure(&mut make(1)?, &track, steps, len, w)?;
        let frame = |(l, a): &(BTreeMap<String, u64>, BTreeMap<String, u64>)| total(l) + total(a);
        let Some((k, f)) = m.frames.iter().enumerate().max_by_key(|(_, f)| frame(f)) else {
            return Ok((
                played,
                json!({"kind": "net.budget", "verdict": "INCONCLUSIVE", "failures": [],
                "blocked": [{"what": "no match step was timed"}], "runs": [], "frame_ms": frame_ms}),
            ));
        };
        let (step_ms, window_ms) = (ms(total(&f.0)), ms(total(&f.1)));
        runs.push(json!({"step": k, "step_ms": step_ms, "window_ms": window_ms}));
        let sum = step_ms + window_ms;
        if worst.as_ref().is_none_or(|(x, _, _)| sum > *x) {
            let mut both = f.0.clone();
            for (name, ns) in &f.1 {
                *both.entry(name.clone()).or_default() += ns;
            }
            worst = Some((sum, k as i64, both));
        }
        if let Some((k, l)) = m
            .frames
            .iter()
            .enumerate()
            .max_by_key(|(_, (l, _))| total(l))
        {
            if busiest.is_none_or(|(_, b)| ms(total(&l.0)) > b) {
                busiest = Some((k as i64, ms(total(&l.0))));
            }
        }
        measured = Some(m);
    }
    let measured = measured.expect("five runs");
    let (worst_ms, worst_step, modules) = worst.expect("five runs");
    // The five-run rule: within on all five passes, over on all five by more than the margin (the
    // larger of 5% and the five runs' spread) fails, and anything else is INCONCLUSIVE.
    let sums: Vec<f64> = runs
        .iter()
        .map(|r| r["step_ms"].as_f64().unwrap_or(0.0) + r["window_ms"].as_f64().unwrap_or(0.0))
        .collect();
    let (lo, hi) = sums
        .iter()
        .fold((f64::MAX, 0f64), |(a, b), x| (a.min(*x), b.max(*x)));
    let margin = (0.05 * frame_ms).max(hi - lo);
    let app = if sums.iter().all(|x| *x <= frame_ms) {
        "PASS"
    } else if sums.iter().all(|x| *x > frame_ms + margin) {
        "FAIL"
    } else {
        "INCONCLUSIVE"
    };
    let costliest = modules
        .iter()
        .max_by_key(|(_, ns)| **ns)
        .map(|(m, _)| m.clone());
    let named = costliest.as_deref().unwrap_or("none");
    let mut failures = Vec::new();
    if app == "FAIL" {
        let what = match w {
            0 => format!("match step {worst_step} took {worst_ms:.3} ms, past the class's {frame_ms} ms frame time; {named} costs most"),
            _ => format!("the frame at match step {worst_step} took {worst_ms:.3} ms with its window of {w} restored and stepped again, past the class's {frame_ms} ms frame time; {named} costs most"),
        };
        failures
            .push(json!({"step": worst_step, "ms": worst_ms, "module": costliest, "what": what}));
    }
    let by_module: Map<String, Value> = modules
        .iter()
        .map(|(m, ns)| (m.clone(), json!(ms(*ns))))
        .collect();
    let mut windows = Map::new();
    let mut blocked = Vec::new();
    for host in on {
        if host == "web" {
            blocked.push(json!({"host": host, "ask": "Run net.budget's web part in the web player in headless Chrome on the reference Mac.",
                "what": "net.budget's web part hasn't run in headless Chrome"}));
            continue;
        }
        windows.insert(host.clone(), json!(largest(&measured, w, frame_ms * 1e6)));
    }
    // An undecided reading of the app's runs is no host left unrun: it reads apart.
    let inconclusive: Vec<Value> = (app == "INCONCLUSIVE")
        .then(|| json!({"host": "app", "what": "the five runs neither all fit nor all miss the frame time"}))
        .into_iter()
        .collect();
    let verdict = match app {
        "FAIL" => "FAIL",
        _ if blocked.iter().any(|b| b.get("host").is_some()) => "BLOCKED",
        v => v,
    };
    let mut out = json!({"kind": "net.budget", "verdict": verdict, "failures": failures, "blocked": blocked, "inconclusive": inconclusive,
        "frame_ms": frame_ms, "window": w, "runs": runs,
        "worst": {"step": worst_step, "ms": worst_ms, "modules": by_module, "module": costliest},
        "busiest": busiest.map(|(step, ms)| json!({"step": step, "ms": ms})),
        "windows": windows, "snapshot_bytes_per_s": bytes});
    if w == 0 {
        // Lockstep keeps no rollback ring.
        out["rollback_snapshot_bytes"] = json!(0);
    }
    Ok((played, out))
}
