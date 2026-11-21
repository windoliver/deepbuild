//! The net check kinds (canvas primitives: Check input: net kinds), each running copies in one
//! process over the test relay, with no network. With `window` 0, net.rollback holds messages
//! back by up to the delay plus a seeded jitter and fails a copy that ran a step before it held
//! every player's message, naming the first step it ran early; net.budget measures the busiest
//! single match step against the class's frame time and counts no rollback ring; net.desync
//! (#550) plants a one-ulp change in one field of one copy's state at a seeded step, made again
//! whenever that copy runs the step, and passes only when the match stops within one hash
//! interval of it, every copy naming that step and field. A window above 0 runs net.rollback and
//! net.budget as crate::window does (#551).

use serde_json::{json, Value};

use crate::card::Card;
use crate::copy::{Change, Defect, End, Stepper};
use crate::kind::Config;
use crate::play::{play, Ask, Fate, Faults, Played};

/// The jitter net.rollback adds to the delay, in match steps.
const JITTER: i64 = 2;

/// A check that can't run yet: BLOCKED, naming what it waits for.
pub fn blocked(kind: &str, why: &str) -> Value {
    json!({"kind": kind, "verdict": "BLOCKED", "failures": [], "blocked": [{"what": why}]})
}

/// A copy whose match ended faulted: a check run that traps can't pass (#550).
fn faulted<S: Stepper>(played: &Played<S>) -> Vec<Value> {
    let ended = played
        .copies
        .iter()
        .filter(|c| c.end() == Some(End::Faulted));
    ended
        .map(|c| {
            let fault = &c.report()["fault"];
            json!({"copy": c.me, "step": fault["step"], "fault": fault,
                   "what": format!("copy {}'s match ended faulted: net.fault {fault}", c.me)})
        })
        .collect()
}

/// #277: in a piece whose rules play a changed seat, net.rollback and net.desync play their
/// matches with seeded leaves and absences unless the ask names its own fates: one copy of three
/// or more killed right after a seeded step before `before`, and, with `absent`, another hidden
/// for twice the timeout, back well before `before`. `spare` is a copy no fate befalls.
fn seat_fates(cfg: &Config, ask: &Ask, spare: u8, before: i64, absent: bool) -> Ask {
    if !cfg.seats || !ask.faults.fates.is_empty() || cfg.players < 3 || before < 40 {
        return ask.clone();
    }
    let seed = ask.faults.seed;
    let others: Vec<u8> = (1..=cfg.players).filter(|p| *p != spare).collect();
    let pick = |n: u64| others[(mix(seed, n) % others.len() as u64) as usize];
    let killed = pick(11);
    let mut fates = vec![Fate::Kill {
        player: killed,
        step: before / 2 + (mix(seed, 12) % (before / 4) as u64) as i64,
    }];
    let len = 2 * cfg.timeout;
    let span = len / cfg.step() + 4 * cfg.window + 4 * cfg.delay + 10;
    let hidden = others.iter().copied().find(|p| *p != killed);
    if let (true, Some(player), true) = (absent, hidden, before / 2 > span) {
        fates.push(Fate::Hide {
            player,
            step: (mix(seed, 13) % (before / 2 - span) as u64) as i64,
            len,
        });
    }
    let mut ask = ask.clone();
    ask.faults.fates = fates;
    ask
}

/// The relay of a run with every message on time: none of the ask's faults but its fates (#277).
pub(crate) fn on_time(ask: &Ask) -> Faults {
    Faults {
        fates: ask.faults.fates.clone(),
        ..Faults::default()
    }
}

/// The copies a fate killed: none of them reports past it.
pub(crate) fn killed(ask: &Ask) -> Vec<u8> {
    let fates = ask.faults.fates.iter();
    fates
        .filter_map(|f| match f {
            Fate::Kill { player, .. } => Some(*player),
            _ => None,
        })
        .collect()
}

fn report(kind: &str, failures: Vec<Value>) -> Value {
    let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
    json!({"kind": kind, "verdict": verdict, "failures": failures})
}

/// net.rollback with `window` 0: the match once with every message on time and once with each
/// frame held back by up to the delay plus a seeded jitter. It gives the held-back run and its
/// report.
pub fn rollback<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
) -> Result<(Played<S>, Value), Value> {
    // #277: with a seeded leave in a piece whose rules play a changed seat.
    let ask = &seat_fates(cfg, ask, 1, ask.steps, false);
    if cfg.window > 0 {
        return crate::window::rollback(cfg, card, ask, make);
    }
    let on_time = play(
        cfg,
        card,
        &Ask {
            faults: on_time(ask),
            shows: Vec::new(),
            ..ask.clone()
        },
        make,
    )?;
    let back = Faults {
        back: (cfg.delay + JITTER) * cfg.step(),
        ..ask.faults.clone()
    };
    let held = play(
        cfg,
        card,
        &Ask {
            faults: back,
            ..ask.clone()
        },
        make,
    )?;
    let mut failures = faulted(&held);
    for (c, base) in held.copies.iter().zip(&on_time.copies) {
        if let Some(step) = c.ran_early().first() {
            failures.push(json!({"copy": c.me, "step": step,
                "what": format!("copy {} ran match step {step} before it held every player's message for it", c.me)}));
        }
        let theirs: std::collections::BTreeMap<i64, u64> = base.hashes().into_iter().collect();
        let parted = c
            .hashes()
            .into_iter()
            .find(|(step, hash)| theirs.get(step).is_some_and(|h| h != hash));
        if let Some((step, _)) = parted {
            failures.push(json!({"copy": c.me, "step": step,
                "what": format!("copy {}'s full-state hash at match step {step} isn't the on-time run's", c.me)}));
        }
        let ran = c.ran().min(base.ran());
        let upto = |track: &Value| -> Vec<Value> {
            let before = ran * cfg.step();
            let entries = track.as_array().into_iter().flatten();
            entries
                .filter(|e| e["t"].as_i64().is_some_and(|t| t < before))
                .map(|e| json!([e["t"], e["player"], e["seq"], e["control"], e["value"]]))
                .collect()
        };
        if upto(&c.record()["track"]) != upto(&base.record()["track"]) {
            failures.push(json!({"copy": c.me,
                "what": format!("copy {} records another merged track than the on-time run", c.me)}));
        }
        if c.ran() < ask.steps && c.end().is_none() {
            failures.push(json!({"copy": c.me, "step": c.ran(),
                "what": format!("copy {} stopped at match step {} of {}", c.me, c.ran(), ask.steps)}));
        }
    }
    Ok((held, report("net.rollback", failures)))
}

/// splitmix64 of the check's seed: where its planted change lands.
fn mix(seed: u64, n: u64) -> u64 {
    let mut z = seed.wrapping_add(n.wrapping_mul(0x9e37_79b9_7f4a_7c15));
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// net.desync `{seed}`: the match with a one-ulp change planted, by the seed, in one field of one
/// copy's state at one step, a byte for logic memory no step need read; it passes only when the
/// match stops on every copy within one `hash_every` interval of it, each naming that step and
/// field. The report gives the planted copy, step, module and field, and what each copy named.
pub fn desync<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
    seed: u64,
) -> Result<(Played<S>, Value), Value> {
    let every = cfg.hash_every;
    // The planted step needs a hash after it, and that hash's message time to arrive.
    let room = ask.steps - every - cfg.delay - 2;
    let mut probe = make(1)?;
    let fields: Vec<(String, String)> = probe
        .fields()
        .into_iter()
        .filter(|(_, f, _)| !f.ends_with(".globals"))
        .map(|(m, f, _)| (m, f))
        .collect();
    if room < 1 || fields.is_empty() {
        let why = if fields.is_empty() {
            "the piece carries no field to plant a change in".to_string()
        } else {
            format!(
                "{} match steps leave no hash interval of {every} after a planted step",
                ask.steps
            )
        };
        let played = play(cfg, card, ask, make)?;
        return Ok((
            played,
            json!({"kind": "net.desync", "verdict": "INCONCLUSIVE", "failures": [], "blocked": [{"what": why}]}),
        ));
    }
    let copy = (mix(seed, 1) % cfg.players as u64) as u8 + 1;
    let step = 1 + (mix(seed, 2) % room as u64) as i64;
    let (module, field) = fields[(mix(seed, 3) % fields.len() as u64) as usize].clone();
    // An array's lowest bit, one ulp of a float; a byte near the top of memory, which no step
    // need read.
    let (at, change) = if field.ends_with(".memory") {
        (
            Some(65_535 - (mix(seed, 4) % 4096) as u32),
            Change::Add(1.0),
        )
    } else {
        (None, Change::Flip(0))
    };
    let defect = Defect {
        step,
        field: field.clone(),
        at,
        change,
    };
    // #277: with a seeded leave and absence before the planted step, in a piece whose rules play
    // a changed seat.
    let planted = Ask {
        defect: Some((copy, defect)),
        ..seat_fates(cfg, ask, copy, step, true)
    };
    let gone = killed(&planted);
    let played = play(cfg, card, &planted, make)?;
    let by = step + every - step.rem_euclid(every);
    let mut failures = faulted(&played);
    let mut named = Vec::new();
    for c in played.copies.iter().filter(|c| !gone.contains(&c.me)) {
        let d = c.desync().cloned().unwrap_or(Value::Null);
        named.push(json!({"copy": c.me, "end": c.end().map(End::name), "net.desync": d}));
        let what = if c.end() == Some(End::Faulted) {
            None
        } else if c.end() != Some(End::Desync) {
            Some(format!(
                "copy {} played on past the planted change at match step {step}",
                c.me
            ))
        } else if d["at"].as_i64().is_none_or(|at| at > by) {
            Some(format!(
                "copy {} stopped at the hash for step {}, past the first hash after step {step}, {by}",
                c.me, d["at"]
            ))
        } else if d["first_step"] != json!(step) || d["field"] != json!(field) {
            Some(format!(
                "copy {} named step {} and field {}, not the planted step {step} and field {field}",
                c.me, d["first_step"], d["field"]
            ))
        } else {
            None
        };
        if let Some(what) = what {
            failures.push(json!({"copy": c.me, "step": step, "field": field, "what": what}));
        }
    }
    let mut r = report("net.desync", failures);
    r["planted"] = json!({"copy": copy, "step": step, "module": module, "field": field, "at": at,
                          "change": match change { Change::Add(n) => json!({"add": n}), Change::Flip(b) => json!({"flip": b}) }});
    r["desync"] = played
        .copies
        .first()
        .and_then(|c| c.desync().cloned())
        .unwrap_or(Value::Null);
    r["copies"] = json!(named);
    Ok((played, r))
}

/// net.budget, as crate::window measures it: in lockstep the busiest single match step against the
/// class's frame time `frame_ms`, with no rollback ring to count; with a window, the live step and
/// the full window restored and stepped again each frame (#551).
pub fn budget<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
    frame_ms: f64,
    on: &[String],
    web: Option<crate::window::Web<'_>>,
) -> Result<(Played<S>, Value), Value> {
    crate::window::budget(cfg, card, ask, make, frame_ms, on, web)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copy::tests::{cfg, Word};
    use crate::copy::Planted;
    use crate::play::Play;

    fn ask(planted: Planted) -> Ask {
        let plays = (1..=2u8)
            .map(|p| {
                let list = (0..396)
                    .map(|g| Play {
                        step: g,
                        control: "push".into(),
                        value: json!(g % 5),
                        to: None,
                    })
                    .collect();
                (p, list)
            })
            .collect();
        Ask {
            steps: 400,
            plays,
            faults: Faults {
                seed: 549,
                ..Faults::default()
            },
            planted,
            shows: Vec::new(),
            ..Ask::default()
        }
    }

    #[test]
    fn with_seats_net_rollback_runs_a_seeded_leave_and_net_desync_an_absence_too() {
        let make = &mut |_: u8| -> Result<Word, Value> { Ok(Word::default()) };
        let four = Config {
            players: 4,
            window: 8,
            seats: true,
            ..cfg(2, 20)
        };
        let mut a = ask(Planted::None);
        for p in 3..=4u8 {
            let theirs = a.plays[&1].clone();
            a.plays.insert(p, theirs);
        }
        let (held, r) = rollback(&four, &Card::default(), &a, make).unwrap();
        assert_eq!(
            (&r["verdict"], &r["failures"]),
            (&json!("PASS"), &json!([])),
            "{r}"
        );
        let left = held.copies[0].report()["seats"].clone();
        assert_eq!(left.as_array().map(Vec::len), Some(1), "{left}");
        let fated = seat_fates(&four, &a, 1, 1000, true);
        assert!(matches!(
            fated.faults.fates[..],
            [Fate::Kill { .. }, Fate::Hide { .. }]
        ));
    }

    #[test]
    fn net_rollback_passes_lockstep_and_names_the_first_step_a_planted_copy_ran_early() {
        let make = &mut |_: u8| -> Result<Word, Value> { Ok(Word::default()) };
        let (held, r) = rollback(&cfg(4, 1), &Card::default(), &ask(Planted::None), make).unwrap();
        assert_eq!(
            (&r["verdict"], &r["failures"]),
            (&json!("PASS"), &json!([]))
        );
        assert!(held
            .log
            .iter()
            .any(|c| c.delivered.is_some_and(|d| d > c.at)));
        assert!(held
            .copies
            .iter()
            .all(|c| !c.report()["waits"].as_array().unwrap().is_empty()));
        let (twin, r) = rollback(
            &cfg(4, 1),
            &Card::default(),
            &ask(Planted::RunsStepEarly),
            make,
        )
        .unwrap();
        assert_eq!(r["verdict"], json!("FAIL"));
        let first = twin
            .copies
            .iter()
            .filter_map(|c| c.ran_early().first())
            .min()
            .unwrap();
        let named = r["failures"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|f| f["step"].as_i64())
            .min();
        assert_eq!(named, Some(*first));
    }

    #[test]
    fn a_window_above_zero_rolls_back_and_a_late_entry_applied_where_it_arrived_fails() {
        let make = &mut |_: u8| -> Result<Word, Value> { Ok(Word::default()) };
        let window = Config {
            window: 8,
            ..cfg(4, 1)
        };
        let (held, r) = rollback(&window, &Card::default(), &ask(Planted::None), make).unwrap();
        assert_eq!(
            (&r["verdict"], &r["failures"]),
            (&json!("PASS"), &json!([]))
        );
        assert!(held.copies.iter().all(|c| !c.rolled().is_empty()));
        let (_, r) = rollback(
            &window,
            &Card::default(),
            &ask(Planted::AppliesLateAtArrival),
            make,
        )
        .unwrap();
        assert_eq!(r["verdict"], json!("FAIL"));
    }
}
