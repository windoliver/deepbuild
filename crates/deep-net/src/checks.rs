//! The net check kinds (canvas primitives: Check input: net kinds), each running copies in one
//! process over the test relay, with no network. With `window` 0, net.rollback holds messages
//! back by up to the delay plus a seeded jitter and fails a copy that ran a step before it held
//! every player's message, naming the first step it ran early; net.budget measures the busiest
//! single match step against the class's frame time and counts no rollback ring. A window above
//! 0 (rollback, #551) and net.desync's planted change and locator (#550) aren't here: each
//! answers BLOCKED, never PASS.

use serde_json::{json, Value};

use crate::card::Card;
use crate::copy::Stepper;
use crate::kind::Config;
use crate::play::{play, Ask, Faults, Played};

/// The jitter net.rollback adds to the delay, in match steps.
const JITTER: i64 = 2;

/// A check that can't run yet: BLOCKED, naming what it waits for.
pub fn blocked(kind: &str, why: &str) -> Value {
    json!({"kind": kind, "verdict": "BLOCKED", "failures": [], "blocked": [{"what": why}]})
}

fn report(kind: &str, failures: Vec<Value>) -> Value {
    let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
    json!({"kind": kind, "verdict": verdict, "failures": failures})
}

const ROLLBACK_WINDOW: &str =
    "this match declares a rollback window; rolling back lands with #551, and until then a copy plays in lockstep";

/// net.rollback with `window` 0: the match once with every message on time and once with each
/// frame held back by up to the delay plus a seeded jitter. It gives the held-back run and its
/// report.
pub fn rollback<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
) -> Result<(Played<S>, Value), Value> {
    if cfg.window > 0 {
        return Ok((
            play(cfg, card, ask, make)?,
            blocked("net.rollback", ROLLBACK_WINDOW),
        ));
    }
    let on_time = play(
        cfg,
        card,
        &Ask {
            faults: Faults::default(),
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
    let mut failures = Vec::new();
    for (c, base) in held.copies.iter().zip(&on_time.copies) {
        if let Some(step) = c.ran_early().first() {
            failures.push(json!({"copy": c.me, "step": step,
                "what": format!("copy {} ran match step {step} before it held every player's message for it", c.me)}));
        }
        let theirs: std::collections::BTreeMap<i64, u64> = base.hashes().iter().copied().collect();
        let parted = c
            .hashes()
            .iter()
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

/// net.budget with `window` 0: the busiest single match step any copy ran, against the class's
/// frame time `frame_ms`, with no rollback ring to count.
pub fn budget<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
    frame_ms: f64,
    busiest: &dyn Fn(&S) -> Option<(i64, f64)>,
) -> Result<(Played<S>, Value), Value> {
    let played = play(cfg, card, ask, make)?;
    if cfg.window > 0 {
        return Ok((played, blocked("net.budget", ROLLBACK_WINDOW)));
    }
    let worst = played
        .copies
        .iter()
        .filter_map(|c| busiest(c.sim()).map(|(step, ms)| (c.me, step, ms)))
        .max_by(|a, b| a.2.total_cmp(&b.2));
    let mut out = match worst {
        // A step nobody timed is no measurement.
        None => json!({"kind": "net.budget", "verdict": "INCONCLUSIVE", "failures": [],
                       "blocked": [{"what": "no match step was timed"}]}),
        Some((copy, step, ms)) => {
            let failures = if ms > frame_ms {
                vec![
                    json!({"copy": copy, "step": step, "ms": ms, "module": "logic",
                    "what": format!("match step {step} took {ms:.3} ms on copy {copy}, past the class's {frame_ms} ms frame time")}),
                ]
            } else {
                Vec::new()
            };
            let mut r = report("net.budget", failures);
            r["busiest"] = json!({"copy": copy, "step": step, "ms": ms});
            r
        }
    };
    out["frame_ms"] = json!(frame_ms);
    out["window"] = json!(0);
    // Lockstep keeps no rollback ring.
    out["rollback_snapshot_bytes"] = json!(0);
    Ok((played, out))
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
        }
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
    fn a_window_above_zero_is_blocked_and_net_budget_counts_no_rollback_ring() {
        let make = &mut |_: u8| -> Result<Word, Value> { Ok(Word::default()) };
        let window = Config {
            window: 8,
            ..cfg(4, 1)
        };
        let (_, r) = rollback(&window, &Card::default(), &ask(Planted::None), make).unwrap();
        assert_eq!(r["verdict"], json!("BLOCKED"));
        let timed = |_: &Word| Some((7, 0.5));
        let (_, r) = budget(
            &cfg(4, 1),
            &Card::default(),
            &ask(Planted::None),
            make,
            4.0,
            &timed,
        )
        .unwrap();
        assert_eq!(
            (&r["verdict"], &r["rollback_snapshot_bytes"]),
            (&json!("PASS"), &json!(0))
        );
        let (_, r) = budget(
            &cfg(4, 1),
            &Card::default(),
            &ask(Planted::None),
            make,
            0.25,
            &timed,
        )
        .unwrap();
        assert_eq!(
            (&r["verdict"], &r["failures"][0]["step"]),
            (&json!("FAIL"), &json!(7))
        );
        let (_, r) = budget(
            &cfg(4, 1),
            &Card::default(),
            &ask(Planted::None),
            make,
            4.0,
            &|_| None,
        )
        .unwrap();
        assert_eq!(r["verdict"], json!("INCONCLUSIVE"));
    }
}
