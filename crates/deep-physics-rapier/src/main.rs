//! `deep-physics`: physics.world@1 on Rapier 0.36.1 over JSON lines, one reply a line, on stdin and stdout
//! (`deep_physics_rapier::runner` answers each line). `--planted <name>` runs one criterion's wrong program.

use std::io::{BufRead, Write};

use deep_physics_rapier::runner::{kit, vehicle, walk, Run, BAD_INPUT, PLANTED};

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
                        || walk::PLANTED.contains(&name.as_str())) =>
            {
                planted = Some(name.as_str())
            }
            [flag, name] if flag == "--backend" && backend.is_none() => {
                backend = Some(name.as_str())
            }
            _ => bad = true,
        }
    }
    let run = (!bad).then(|| Run::new(planted)).flatten();
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
