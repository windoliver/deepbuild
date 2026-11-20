//! #551: net.rollback over a real logic piece, the gallery's two-player rally, with a window of
//! 8: held-back runs roll back to the on-time run's hashes; a ring that keeps each step's pages
//! as the step left them, and a copy that applies a late entry where it arrived, both fail it.
#![cfg(feature = "net")]

use serde_json::{json, Value};

fn b64(bytes: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = c
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= c.len() {
                A[(n >> (18 - 6 * i) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    out
}

fn rally(window: i64) -> (Value, Value) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../deep-show/gallery/");
    let mut doc: Value =
        serde_json::from_slice(&std::fs::read(format!("{dir}net-rally.json")).unwrap()).unwrap();
    doc["items"]["match"]["params"]["window"] = json!(window);
    let wasm = std::fs::read(format!("{dir}net-rally.wasm")).unwrap();
    let sha = doc["assets"]["rally_program"]["sha256"]
        .as_str()
        .unwrap()
        .to_string();
    (
        doc,
        json!({"assets": {sha: b64(&wasm)}, "steps": 400, "seed": 551}),
    )
}

fn verdict(doc: &Value, input: &Value) -> Value {
    let r = (deep_play::net::RUNS.rollback)(doc, input);
    assert!(r.blocked.is_empty(), "{:?}", r.blocked);
    r.results[0].clone()
}

#[test]
fn late_entries_roll_the_rally_back_to_the_on_time_runs_hashes() {
    let (doc, input) = rally(8);
    let r = verdict(&doc, &input);
    assert_eq!(
        (&r["verdict"], &r["failures"]),
        (&json!("PASS"), &json!([])),
        "{r}"
    );
    let rolled: u64 = r["schedules"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|s| s["rollbacks"].as_array().unwrap().iter())
        .map(|n| n.as_u64().unwrap())
        .sum();
    assert!(rolled > 50, "{r}");
    for planted in ["net_ring_keeps_after", "net_applies_at_arrival"] {
        let mut twin = input.clone();
        twin["planted"] = json!(planted);
        let r = verdict(&doc, &twin);
        assert_eq!(r["verdict"], json!("FAIL"), "{planted}");
        assert!(r["first_step"].as_i64().is_some(), "{planted}: {r}");
    }
}
