//! #2243's planted wrong program for its second criterion, laid over the change by the proof lanes
//! (tests/acceptance/2243/twins.json): `deep-physics` whose wrapper lets a walker's approach move a
//! character body that wants no move, whatever it is started with. It is the shipped main with
//! `approach_moves_standing` planted when no program is named.

use std::io::{BufRead, Write};

use deep_physics_rapier::runner::{contact, kit, vehicle, walk, Run, BAD_INPUT, PLANTED};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // `--planted <name>` plants one criterion's wrong program; `--backend <name>` (#191, a
    // `test-backends` build only) runs a test backend in Rapier's place; either, both or neither.
    let (mut planted, mut backend, mut bad) = (None, None, false);
    for pair in args.chunks(2) {
        match pair {
            [flag, name]
                if flag == "--planted"
                    && planted.is_none()
                    && (PLANTED.contains(&name.as_str())
                        || kit::PLANTED.contains(&name.as_str())
                        || vehicle::PLANTED.contains(&name.as_str())
                        || walk::PLANTED.contains(&name.as_str())
                        || contact::PLANTED.contains(&name.as_str())) =>
            {
                planted = Some(name.as_str())
            }
            [flag, name] if flag == "--backend" && backend.is_none() => {
                backend = Some(name.as_str())
            }
            _ => bad = true,
        }
    }
    let run = (!bad)
        .then(|| Run::new(planted.or(Some("approach_moves_standing"))))
        .flatten();
    let run = match backend {
        Some(b) => run.and_then(|r| r.with_backend(b)),
        None => run,
    };
    let Some(run) = run else {
        println!("{BAD_INPUT}");
        std::process::exit(2);
    };
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if writeln!(out, "{}", run.line(&line)).is_err() {
            break;
        }
    }
}
