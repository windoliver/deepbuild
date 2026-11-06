//! Acceptance tests for #1312, criteria 1 and 2: the shipped `particles.sparks@1` operator, run by the effects crate's
//! CPU reference (`deep_canvas_effects::interp`) at seed 7, keeps a particle born inside `emit.span` alive until its
//! life ends, on its own generation's path. Written blind from the issue, the design and the base (README.md).
//!
//! The operator is read and checked as the base's own unit test `positions()` (crates/deep-canvas-effects/src/shipped.rs)
//! runs it; that pattern is copied here, not imported. Its instance columns are `PARTICLE_FLOATS` floats per slot:
//! position x, y, z, then w = age ÷ life (−1 when dead), then velocity x, y, z. Every parameter the criteria don't
//! name is the operator's default (`interp::inputs` fills them).

use std::collections::BTreeMap;

use deep_canvas_effects::interp::{self, Env};
use deep_canvas_effects::shipped::{self, PARTICLE_FLOATS};
use serde_json::{json, Value};

/// The criteria's tolerance.
const TOL: f64 = 1e-4;
/// Slots the operator runs over: more than either criterion's count, one workgroup.
const ELEMENTS: usize = 64;
const AC1: &str = "AC1 #1312.326099bf";
const AC2: &str = "AC2 #1312.73432a75";

/// One slot's instance columns at t.
#[derive(Clone, Copy, Debug)]
struct Slot {
    pos: [f64; 3],
    w: f64,
    vel: [f64; 3],
}

/// The shipped operator over its first `ELEMENTS` slots at t, seed 7, with `params` (paths `particles.*`) over its
/// defaults.
fn run(params: &[(&str, Value)], t: f64) -> Vec<Slot> {
    let mut op = shipped::particles();
    op["elements"] = json!(ELEMENTS);
    let c = deep_canvas_effects::check::read_and_check(&op)
        .unwrap_or_else(|e| panic!("the shipped particles.sparks@1 operator checks: {e:?}"));
    let params: BTreeMap<String, Value> = params
        .iter()
        .map(|(k, v)| (format!("particles.{k}"), v.clone()))
        .collect();
    let env = Env {
        t,
        seed: 7,
        clip: [0.0; 16],
        inverse_clip: [0.0; 16],
        eye: [0.0; 4],
        inputs: interp::inputs(&c, &params, &BTreeMap::new()),
        textures: BTreeMap::new(),
        normals: [[0.0; 3]; 3],
    };
    let out = interp::compute(&c, &env, BTreeMap::new())
        .unwrap_or_else(|e| panic!("the CPU reference runs the operator at t = {t}: {e}"));
    let inst = &out["inst"];
    let n = PARTICLE_FLOATS as usize;
    assert!(
        inst.len() >= ELEMENTS * n,
        "the operator writes {n} floats for each of {ELEMENTS} slots; inst holds {}",
        inst.len()
    );
    (0..ELEMENTS)
        .map(|i| {
            let f = &inst[i * n..i * n + n];
            Slot {
                pos: [f[0], f[1], f[2]],
                w: f[3],
                vel: [f[4], f[5], f[6]],
            }
        })
        .collect()
}

/// Records a mismatch when `got` isn't within the tolerance of `want`.
fn near(fails: &mut Vec<String>, what: String, want: f64, got: f64) {
    if !(got.is_finite() && (got - want).abs() <= TOL) {
        fails.push(format!("{what}: expected {want:.6}, got {got:.6}"));
    }
}

fn verdict(fails: &[String], what: &str) {
    assert!(
        fails.is_empty(),
        "{what}: {} value(s) off by more than {TOL}:\n  {}",
        fails.len(),
        fails.join("\n  ")
    );
}

/// Criterion 1's emitter: count 2, rate 2 (period 1 s), life 1.5 s, the span given.
fn two_slots(span: f64) -> Vec<(&'static str, Value)> {
    vec![
        ("count", json!(2)),
        ("rate", json!(2.0)),
        ("span", json!(span)),
        ("life_min", json!(1.5)),
        ("life_max", json!(1.5)),
    ]
}

// AC1 #1312.326099bf: A particle born inside the span lives out its life. With count 2, rate 2, span 1.2,
// life_min = life_max = 1.5 (period 1 s; slot 0 is born at 0 and 1, slot 1 at 0.5), w at 1.7 s is 0.7 ÷ 1.5 for slot 0
// and 1.2 ÷ 1.5 for slot 1; at 2.2 s 1.2 ÷ 1.5 for slot 0 and −1 for slot 1; at 2.6 s both −1; each within 1e-4.
// Wrong program: main, where slot 1 is −1 at 1.7 s and slot 0 at 2.2 s.
#[test]
fn ac1_a_particle_born_inside_the_span_lives_out_its_life() {
    let params = two_slots(1.2);
    let want: [(f64, [f64; 2]); 3] = [
        (1.7, [0.7 / 1.5, 1.2 / 1.5]),
        (2.2, [1.2 / 1.5, -1.0]),
        (2.6, [-1.0, -1.0]),
    ];
    let mut fails = Vec::new();
    for (t, ws) in want {
        let slots = run(&params, t);
        for (i, w) in ws.into_iter().enumerate() {
            near(&mut fails, format!("slot {i}, t = {t} s, w"), w, slots[i].w);
        }
    }
    verdict(
        &fails,
        &format!("{AC1} count 2, rate 2, span 1.2, life 1.5: each slot keeps its last generation born inside the span until its life ends"),
    );
}

// AC1 #1312.326099bf, its second clause: a slot whose first birth is after the span (slot 1 with span 0.4, born first
// at 0.5) is −1 at t = 0.45, 0.6 and 2.0. It holds on main; it rejects a fix that clamps the capped generation at 0
// and drops the born-inside-the-span test, so a slot first born after the span draws.
#[test]
fn ac1_a_slot_first_born_after_the_span_never_draws() {
    let params = two_slots(0.4);
    let mut fails = Vec::new();
    for t in [0.45, 0.6, 2.0] {
        let slots = run(&params, t);
        near(
            &mut fails,
            format!("slot 1, t = {t} s, w"),
            -1.0,
            slots[1].w,
        );
    }
    verdict(
        &fails,
        &format!("{AC1} count 2, rate 2, span 0.4, life 1.5: slot 1, first born at 0.5 s, after the span, never draws"),
    );
}

// AC2 #1312.73432a75: It keeps its own path across the span's end. With count 1, rate 1, span 0.5, life 10,
// v0_min = v0_max = 1, gravity [0, 0, 0], drag 0: the velocity at t = 1.0, 5.0 and 9.5 s equals the velocity at 0.4 s,
// and the position equals position(0.4) + velocity · (t − 0.4), each within 1e-4; w is t ÷ 10 at each of those times,
// and −1 at 10.5 s. Wrong programs: main (w is −1 from 1 s on); a fix that keeps the particle alive but hashes the
// uncapped generation (a different direction after 1 s; at the base the velocity written at t ≥ 1 s is exactly that
// program's, since with no gravity or drag it is the uncapped generation's v0 alone).
#[test]
fn ac2_it_keeps_its_own_path_across_the_spans_end() {
    let params = vec![
        ("count", json!(1)),
        ("rate", json!(1.0)),
        ("span", json!(0.5)),
        ("life_min", json!(10.0)),
        ("life_max", json!(10.0)),
        ("v0_min", json!(1.0)),
        ("v0_max", json!(1.0)),
        ("gravity", json!([0.0, 0.0, 0.0])),
        ("drag", json!(0.0)),
    ];
    let at = |t: f64| run(&params, t)[0];
    let start = at(0.4);
    let mut fails = Vec::new();
    // The reference itself: alive at 0.4 s with w 0.04, and moving at v0 = 1 m/s, so a direction can be told apart.
    near(&mut fails, "slot 0, t = 0.4 s, w".into(), 0.04, start.w);
    let speed = start.vel.iter().map(|v| v * v).sum::<f64>().sqrt();
    near(
        &mut fails,
        "slot 0, t = 0.4 s, |velocity| (v0 = 1)".into(),
        1.0,
        speed,
    );
    for t in [1.0, 5.0, 9.5] {
        let s = at(t);
        near(&mut fails, format!("slot 0, t = {t} s, w"), t / 10.0, s.w);
        for (k, axis) in ["x", "y", "z"].into_iter().enumerate() {
            near(
                &mut fails,
                format!("slot 0, t = {t} s, velocity {axis} (velocity at 0.4 s)"),
                start.vel[k],
                s.vel[k],
            );
            near(
                &mut fails,
                format!("slot 0, t = {t} s, position {axis} (position(0.4) + velocity(0.4) · (t − 0.4))"),
                start.pos[k] + start.vel[k] * (t - 0.4),
                s.pos[k],
            );
        }
    }
    near(&mut fails, "slot 0, t = 10.5 s, w".into(), -1.0, at(10.5).w);
    verdict(
        &fails,
        &format!("{AC2} count 1, rate 1, span 0.5, life 10, v0 1, no gravity or drag: the particle born at 0 carries on along its own path until 10 s"),
    );
}
