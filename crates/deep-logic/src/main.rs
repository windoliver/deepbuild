//! `deep-logic` (#531): the logic module's check, steps, checkpoints, restores and reports as JSON
//! lines, one reply per line, on this host's wasmtime. `--planted <name>` runs one planted twin
//! (the #531 and #532 acceptance READMEs: Planted twins), and several names apply together.

use std::io::{BufRead, Write};

use deep_logic::{Logic, Planted};
use serde_json::{json, Value};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut planted = Planted::default();
    for pair in args.chunks(2) {
        planted = match pair {
            [flag, name] if flag == "--planted" => planted.and(name).unwrap_or_else(|| refuse()),
            _ => refuse(),
        };
    }
    let mut logic = Logic::new(planted);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(v) => logic.handle(&v),
            Err(_) => json!({"ok": false, "code": "bad_input"}),
        };
        writeln!(stdout, "{reply}").expect("stdout");
        stdout.flush().expect("stdout");
    }
}

fn refuse() -> ! {
    println!("{}", json!({"ok": false, "code": "bad_input"}));
    std::process::exit(2)
}
