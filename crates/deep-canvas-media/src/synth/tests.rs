use deep_canvas::ops;
use serde_json::json;

use super::check::{self, SWEEP_RATE};
use super::preset::{Preset, BLOCK, RULE_COST, RULE_CYCLE, RULE_EDGE, RULE_NODE, RULE_PARAM};
use super::voice::{sine, Twists, Voice};
use super::*;

/// The tone passes the kit, and each planted preset breaks its own rule alone, in the kit's order.
#[test]
fn each_planted_preset_breaks_one_rule() {
    let def = registry();
    assert!(
        def.run_kit("tone", &tone()).pass(),
        "{:?}",
        def.run_kit("tone", &tone()).failed()
    );
    let rules = [RULE_NODE, RULE_EDGE, RULE_CYCLE, RULE_PARAM, RULE_COST];
    for (p, rule) in def.planted.iter().zip(rules) {
        assert_eq!(
            def.run_kit(&p.name, &p.value).failed(),
            vec![rule],
            "{}",
            p.name
        );
    }
}

#[test]
fn the_polynomial_sine_is_the_sine() {
    let mut worst = 0.0f64;
    for k in 0..100_000u64 {
        let phase = k.wrapping_mul(0x9e37_79b9_7f4a_7c15);
        let p = phase as f64 / 18_446_744_073_709_551_616.0;
        worst = worst.max((sine(phase) - ops::sin(2.0 * ops::PI * p)).abs());
    }
    assert!(worst < 1e-10, "{worst}");
}

fn sweep_tone() -> Preset {
    Preset::compile(&json!({
        "nodes": {"osc": {"kind": "osc", "hz": "hz"}},
        "out": "osc",
        "params": {"hz": {"unit": "Hz", "range": [0, 1000], "default": 60}},
        "cost": 4
    }))
    .unwrap()
}

/// A frequency rising linearly, read once per block and ramped across it, gives the sine of the
/// frequency's exact integral; held per block without the ramp it drifts far off.
#[test]
fn a_ramped_sweep_follows_the_integral_of_its_frequency() {
    let p = sweep_tone();
    let rate = 48_000.0;
    let f = |t: f64| 60.0 + 30.0 * t;
    let render = |ramp: bool| {
        let mut v = Voice::new(&p, 48_000, 0, u64::MAX, Twists::default());
        let mut worst = 0.0f64;
        let mut out = [0.0; BLOCK];
        for k in 0..(4 * 48_000 / BLOCK) {
            let t0 = (k * BLOCK) as f64 / rate;
            let a = [f(t0)];
            let b = if ramp {
                [f(t0 + BLOCK as f64 / rate)]
            } else {
                a
            };
            v.render(&p, &a, &b, 0, &mut out);
            for (i, x) in out.iter().enumerate() {
                let t = (k * BLOCK + i) as f64 / rate;
                let want = ops::sin(2.0 * ops::PI * (60.0 * t + 15.0 * t * t));
                worst = worst.max((x - want).abs());
            }
        }
        worst
    };
    assert!(render(true) < 1e-4, "{}", render(true));
    assert!(render(false) > 1e-3, "{}", render(false));
}

fn one(kind: serde_json::Value) -> Preset {
    Preset::compile(&json!({"nodes": {"n": kind}, "out": "n", "cost": 100})).unwrap()
}

/// Every node that isn't a source writes exactly 0 for 1 s of silence from its reset state; the
/// planted shaper's bias doesn't.
#[test]
fn silence_in_is_silence_out() {
    let nodes = [
        json!({"kind": "biquad", "type": "peaking", "freq": 1000, "q": 2, "gain": 6}),
        json!({"kind": "shaper"}),
        json!({"kind": "crush", "bits": 4, "hold_hz": 8000}),
        json!({"kind": "delay", "time": 0.25, "feedback": 0.5, "mix": 0.5}),
        json!({"kind": "gain", "gain": 2}),
        json!({"kind": "mix"}),
        json!({"kind": "modes", "ratios": [1, 2.7], "t60s": [0.5, 0.2], "hz": 300}),
        json!({"kind": "string", "hz": 220, "damping": 0.2}),
    ];
    for n in nodes {
        let p = one(n.clone());
        let mut v = Voice::new(&p, 48_000, 0, u64::MAX, Twists::default());
        let mut out = [0.0; BLOCK];
        for _ in 0..48_000 / BLOCK {
            v.render(&p, &[], &[], 0, &mut out);
            assert!(out.iter().all(|x| *x == 0.0), "{n}");
        }
    }
    let p = one(json!({"kind": "shaper"}));
    let mut v = Voice::new(
        &p,
        48_000,
        0,
        u64::MAX,
        Twists {
            shaper_bias: true,
            ..Twists::default()
        },
    );
    let mut out = [0.0; BLOCK];
    v.render(&p, &[], &[], 0, &mut out);
    assert!(out[0] != 0.0);
}

fn busy() -> Preset {
    Preset::compile(&json!({
        "nodes": {
            "osc": {"kind": "osc", "wave": "saw", "hz": "hz"},
            "noise": {"kind": "noise", "color": "pink"},
            "sum": {"kind": "mix"},
            "lp": {"kind": "biquad", "type": "lowpass", "freq": 2000, "q": 0.9},
            "echo": {"kind": "delay", "time": 0.01, "feedback": 0.4},
            "fb": {"kind": "gain", "gain": 0.3},
            "env": {"kind": "env", "attack": 0.01, "decay": 0.2, "sustain": 0.6, "release": 0.3},
            "amp": {"kind": "gain", "gain": 0}
        },
        "edges": [["osc", "sum", "a"], ["noise", "sum", "b"], ["sum", "lp", "in"], ["lp", "echo", "in"],
                  ["echo", "fb", "in"], ["fb", "sum", "c"], ["lp", "amp", "in"], ["env", "amp", "gain"]],
        "out": "amp",
        "params": {"hz": {"unit": "Hz", "range": [20, 2000], "default": 110}},
        "cost": 40
    }))
    .unwrap()
}

/// A voice restored from a checkpoint renders what it rendered while playing, bit for bit; one whose
/// checkpoint keeps the osc's phase in f32 doesn't.
#[test]
fn a_restored_voice_plays_on_as_it_played() {
    let p = busy();
    assert!(
        p.nodes.iter().any(|n| n.breaks),
        "the echo breaks the cycle"
    );
    for twists in [
        Twists::default(),
        Twists {
            phase_f32: true,
            ..Twists::default()
        },
    ] {
        let mut v = Voice::new(&p, 48_000, 7, 30_000, twists);
        let mut out = [0.0; BLOCK];
        let hz = |k: usize| [110.0 + k as f64 * 0.37];
        for k in 0..200 {
            v.render(&p, &hz(k), &hz(k + 1), 0, &mut out);
        }
        let snap = v.snapshot();
        let mut played = Vec::new();
        for k in 200..400 {
            v.render(&p, &hz(k), &hz(k + 1), 0, &mut out);
            played.extend_from_slice(&out);
        }
        let mut w = Voice::new(&p, 48_000, 7, 30_000, twists);
        w.restore(&snap);
        let mut again = Vec::new();
        for k in 200..400 {
            w.render(&p, &hz(k), &hz(k + 1), 0, &mut out);
            again.extend_from_slice(&out);
        }
        assert_eq!(played == again, !twists.phase_f32);
    }
}

/// The crush at 8 bits is its law in f64; the planted one quantizes to 7 bits.
#[test]
fn crush_quantizes_to_its_bits() {
    let q = 1.0 / 128.0;
    for (twist, want_ok) in [(false, true), (true, false)] {
        let mut out = [0.0; BLOCK];
        let p2 = Preset::compile(&json!({
            "nodes": {"src": {"kind": "osc", "hz": 300}, "n": {"kind": "crush", "bits": 8}},
            "edges": [["src", "n", "in"]], "out": "n", "cost": 10
        }))
        .unwrap();
        let mut v = Voice::new(
            &p2,
            48_000,
            0,
            u64::MAX,
            Twists {
                crush_short_bit: twist,
                ..Twists::default()
            },
        );
        v.render(&p2, &[], &[], 0, &mut out);
        let mut osc = Voice::new(
            &one(json!({"kind": "osc", "hz": 300})),
            48_000,
            0,
            u64::MAX,
            Twists::default(),
        );
        let mut raw = [0.0; BLOCK];
        osc.render(
            &one(json!({"kind": "osc", "hz": 300})),
            &[],
            &[],
            0,
            &mut raw,
        );
        let ok = out.iter().zip(&raw).all(|(y, x)| *y == (x / q).round() * q);
        assert_eq!(ok, want_ok);
    }
}

/// A struck resonator is under −120 dBFS by its derived tail after its input stops, and above it
/// at half that tail.
#[test]
fn the_tail_covers_the_ring() {
    let p = Preset::compile(&json!({
        "nodes": {
            "hit": {"kind": "noise"},
            "env": {"kind": "env", "attack": 0, "sustain": 1, "release": 0.01},
            "burst": {"kind": "gain", "gain": 0},
            "bar": {"kind": "modes", "ratios": [1, 2.76], "t60s": [0.4, 0.15], "hz": 440}
        },
        "edges": [["hit", "burst", "in"], ["env", "burst", "gain"], ["burst", "bar", "in"]],
        "out": "bar",
        "cost": 20
    }))
    .unwrap();
    let tail = check::tail(&p, false);
    assert!((tail - (0.01 + 0.8)).abs() < 1e-9, "{tail}");
    let span = 4_800u64;
    let mut v = Voice::new(&p, SWEEP_RATE, 3, span, Twists::default());
    let mut out = [0.0; BLOCK];
    let mut level = Vec::new();
    for _ in 0..(48_000 * 2 / BLOCK) {
        v.render(&p, &[], &[], 0, &mut out);
        level.extend(out.iter().map(|x| x.abs()));
    }
    let after = |t: f64| {
        level[(span as f64 + t * 48_000.0) as usize..]
            .iter()
            .copied()
            .fold(0.0, f64::max)
    };
    assert!(after(tail) < 1e-6, "{}", after(tail));
    assert!(after(tail / 2.0) > 1e-6, "{}", after(tail / 2.0));
}

/// A node may also be written as its kind holding its fields.
#[test]
fn a_node_reads_in_either_form() {
    let flat = Preset::compile(
        &json!({"nodes": {"o": {"kind": "osc", "wave": "saw", "hz": 220}}, "out": "o", "cost": 4}),
    )
    .unwrap();
    let nested = Preset::compile(
        &json!({"nodes": {"o": {"osc": {"wave": "saw", "hz": 220}}}, "out": "o", "cost": 4}),
    )
    .unwrap();
    assert_eq!(flat, nested);
    let odd = Preset::compile(
        &json!({"nodes": {"g": {"granular": {"size": 0.05}}}, "out": "g", "cost": 4}),
    )
    .unwrap_err();
    assert_eq!((odd.rule, odd.at.as_deref()), (RULE_NODE, Some("nodes/g")));
}

/// A feedback delay whose gain may reach 1.05 passes at its default and is refused at its maximum,
/// naming the param, the value and the first sample past 4.0; cut to 0.95 the sweep passes.
#[test]
fn the_sweep_refuses_a_runaway_at_its_maximum() {
    let preset = |hi: f64| {
        json!({
            "nodes": {
                "src": {"kind": "osc", "hz": 220},
                "env": {"kind": "env", "attack": 0, "sustain": 1, "release": 0},
                "amp": {"kind": "gain", "gain": 0},
                "echo": {"kind": "delay", "time": 0.01, "feedback": "fb", "mix": 0.5}
            },
            "edges": [["src", "amp", "in"], ["env", "amp", "gain"], ["amp", "echo", "in"]],
            "out": "echo",
            "params": {"fb": {"unit": "", "range": [0, hi], "default": 0.5}},
            "cost": 20
        })
    };
    let p = Preset::compile(&preset(1.05)).unwrap();
    let r = check::sweep(&p, "test.runaway@1", Twists::default()).expect("refused");
    assert_eq!((r.param.as_str(), r.value), ("fb", 1.05));
    assert!(r.level.abs() > 4.0 && r.sample > 0);
    assert!(check::render_bound(&p, &[0.5], Twists::default()).is_none());
    let p = Preset::compile(&preset(0.95)).unwrap();
    assert_eq!(check::sweep(&p, "test.runaway@1", Twists::default()), None);
    let manifest = json!({"name": "test", "presets": {"runaway@1": preset(1.05)}});
    let bad = presets_field(&manifest);
    assert_eq!(bad.len(), 1);
    assert!(
        bad[0].1.contains("test.runaway@1") && bad[0].1.contains("1.05"),
        "{}",
        bad[0].1
    );
}
