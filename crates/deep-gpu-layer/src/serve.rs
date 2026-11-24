//! The scenario loop on stdin (moved out of main.rs whole, #3292).

use std::io::{BufRead, Write};

use serde_json::{json, Value};

/// Answers each scenario line on stdin with one line, each call through `call`.
pub(super) fn serve(mut call: impl FnMut(&str, &Value) -> Value) {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(sc) if sc["calls"].is_array() && sc["out"].is_string() => {
                let out = sc["out"].as_str().unwrap_or_default().to_string();
                let replies: Vec<Value> = sc["calls"]
                    .as_array()
                    .expect("checked above")
                    .iter()
                    .map(|c| call(&out, c))
                    .collect();
                deep_gpu::device::flush_suppressed();
                json!({"ok": true, "replies": replies})
            }
            _ => json!({"ok": false, "code": "bad_input"}),
        };
        let _ = writeln!(stdout, "{answer}");
        let _ = stdout.flush();
    }
}
