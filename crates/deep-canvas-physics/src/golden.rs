//! Step hashes, the golden comparator and where a golden stands across machines (Golden; Checkpoint
//! ring: `hash`). A hash takes each float by its IEEE bits, little-endian, in canonical ID order,
//! and never rounds; the comparator names the first body and field that differ with both values and
//! their distance in f32 ulps.

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Value};

use crate::backend::{Canonical, JointState, PARTICLE_FIELDS};

/// A u64 hash as 16 hex: the first 8 bytes of the SHA-256 of `bytes`.
fn h64(bytes: &[u8]) -> String {
    sha256_hex(bytes)[..16].to_string()
}

/// The step hash of a state: each body's ID, then its pose and velocity, by bits; then each
/// joint's ID, its whole turns and its steps past `breaks_at` (#523: Joint); then each soft body's
/// particles, their positions and velocities (#524), in the Checkpoint ring's order.
pub fn step_hash(state: &[Canonical], joints: &[JointState]) -> String {
    let mut bytes = Vec::new();
    let particle = |b: &&Canonical| b.values.len() == PARTICLE_FIELDS.len();
    let mut take = |b: &Canonical| {
        bytes.extend_from_slice(&(b.id.len() as u64).to_le_bytes());
        bytes.extend_from_slice(b.id.as_bytes());
        for v in &b.values {
            bytes.extend_from_slice(&v.to_bits().to_le_bytes());
        }
    };
    state.iter().filter(|b| !particle(b)).for_each(&mut take);
    let mut joint_bytes = Vec::new();
    for j in joints {
        joint_bytes.extend_from_slice(&(j.id.len() as u64).to_le_bytes());
        joint_bytes.extend_from_slice(j.id.as_bytes());
        joint_bytes.extend_from_slice(&j.turns.to_le_bytes());
        joint_bytes.extend_from_slice(&j.past.to_le_bytes());
    }
    let mut tail = Vec::new();
    for b in state.iter().filter(particle) {
        tail.extend_from_slice(&(b.id.len() as u64).to_le_bytes());
        tail.extend_from_slice(b.id.as_bytes());
        for v in &b.values {
            tail.extend_from_slice(&v.to_bits().to_le_bytes());
        }
    }
    bytes.extend(joint_bytes);
    bytes.extend(tail);
    h64(&bytes)
}

/// A checkpoint's deep hash: its whole-world state's bytes.
pub fn deep_hash(state: &[u8]) -> String {
    h64(state)
}

/// How many f32 values lie between `a` and `b`.
pub fn ulp_distance(a: f32, b: f32) -> u64 {
    let ordered = |x: f32| {
        let bits = x.to_bits();
        if bits >> 31 == 1 {
            -i64::from(bits & 0x7fff_ffff)
        } else {
            i64::from(bits)
        }
    };
    ordered(a).abs_diff(ordered(b))
}

/// The first body and field, in canonical order, whose value in `recorded` differs from `mine`,
/// as the report's `field`: `{id, field, values: [recorded, mine], ulp_distance}`. Both states are
/// one world's, so their bodies are the same IDs in the same order.
pub fn first_field(recorded: &[Canonical], mine: &[Canonical]) -> Option<Value> {
    recorded.iter().zip(mine).find_map(|(a, b)| {
        let i = (0..a.values.len())
            .find(|&i| b.values.get(i).map(|y| y.to_bits()) != Some(a.values[i].to_bits()))?;
        let (x, y) = (a.values[i], b.values.get(i).copied().unwrap_or(f32::NAN));
        Some(
            json!({"id": a.id, "field": a.fields()[i], "values": [f64::from(x), f64::from(y)],
                    "ulp_distance": ulp_distance(x, y)}),
        )
    })
}

/// Whether a run on `machine` was on the golden's recording architecture (`same`) or another
/// (`different`), the only thing that makes a run count across machines (Golden: a Linux VM on the
/// reference Mac reads `machines: same`); `null` when either names no architecture.
pub fn machines(golden: &Value, machine: &Value) -> Value {
    match (
        golden.pointer("/machine/arch").and_then(Value::as_str),
        machine.get("arch").and_then(Value::as_str),
    ) {
        (Some(a), Some(b)) if a == b => json!("same"),
        (Some(_), Some(_)) => json!("different"),
        _ => Value::Null,
    }
}

/// Where `golden` stands across machines, given the second machines configured (`{name,
/// target}`) and the `golden_verify` runs made: for each target it verifies on, a run from that
/// target on another architecture than the recording machine's decides; else a configured machine
/// with that target leaves it `PENDING`; else it is `BLOCKED` with one unblock ask naming the target.
/// A run on the recording architecture never counts, and there is no `PASS` without a run.
/// `None` when the golden names no target or no recording architecture.
pub fn cross(golden: &Value, machines: &[Value], runs: &[Value]) -> Option<Value> {
    let arch = golden.pointer("/machine/arch")?.as_str()?;
    let targets: Vec<&str> = golden
        .get("verify_on")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    if targets.is_empty() {
        return None;
    }
    let mut verdicts = Vec::new();
    let mut asks = Vec::new();
    for t in targets {
        let run = runs.iter().find(|r| {
            r.get("target").and_then(Value::as_str) == Some(t)
                && r.pointer("/machine/arch")
                    .and_then(Value::as_str)
                    .is_some_and(|a| a != arch)
        });
        verdicts.push(match run {
            Some(r) if r.get("verdict").and_then(Value::as_str) == Some("PASS") => "PASS",
            Some(_) => "FAIL",
            None if machines
                .iter()
                .any(|m| m.get("target").and_then(Value::as_str) == Some(t)) =>
            {
                "PENDING"
            }
            None => {
                asks.push(json!({"kind": "unblock", "target": t,
                    "what": format!("No second machine runs {t}: configure one in the hosts block and run this golden's golden_verify there; until it has run, the golden is BLOCKED.")}));
                "BLOCKED"
            }
        });
    }
    let verdict = ["FAIL", "BLOCKED", "PENDING", "PASS"]
        .into_iter()
        .find(|v| verdicts.contains(v))
        .unwrap_or("BLOCKED");
    Some(json!({"ok": true, "verdict": verdict, "asks": asks}))
}
