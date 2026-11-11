//! `deep-physics`: physics.world@1 on Rapier 0.36.1 over JSON lines, one reply a line, on stdin and stdout
//! (`deep_physics_rapier::runner` answers each line). `--planted <name>` runs one criterion's wrong program.

use std::io::{BufRead, Write};

use deep_physics_rapier::runner::{Run, BAD_INPUT, PLANTED};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let run = match args.as_slice() {
        [] => Run::new(None),
        [flag, name] if flag == "--planted" && PLANTED.contains(&name.as_str()) => {
            Run::new(Some(name))
        }
        _ => None,
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
