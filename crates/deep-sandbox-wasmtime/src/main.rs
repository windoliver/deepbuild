//! `deep-sandbox` (#238): the sandbox module's check, rewrite, check-time runner and sandbox@1's kit
//! as JSON lines, one reply per line, on this host's wasmtime. `--planted <name>` runs one planted
//! twin (the #238 acceptance README: Planted twins).

use std::io::{BufRead, Write};

use deep_sandbox_wasmtime::service::{Planted, Sandbox};
use serde_json::{json, Value};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let planted = match args.as_slice() {
        [] => Planted::default(),
        [flag, name] if flag == "--planted" => match Planted::named(name) {
            Some(p) => p,
            None => refuse(),
        },
        _ => refuse(),
    };
    let sandbox = Sandbox { planted };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(v) => sandbox.handle(&v),
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
