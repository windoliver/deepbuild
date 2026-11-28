mod common;

use std::collections::BTreeMap;

use common::{first_party_pass, none, shown};
use deep_canvas_effects::check::{read_and_check, CheckOptions};
use deep_canvas_effects::interp::{self, Env, Image};
use deep_canvas_effects::values::{transfer, transfer_with, Fact, Lane};
use serde_json::{json, Value};

const SIDE: u32 = 100;
const SETS: usize = 10;
const ROWS_PER_SET: u32 = SIDE / SETS as u32;

type Iv = [f64; 2];

const ANY: &[Iv] = &[
    [-1.0, 1.0],
    [0.0, 1.0],
    [0.5, 2.0],
    [-3.0, -0.25],
    [-100.0, 100.0],
    [1e-6, 1e3],
    [-2.0, 0.0],
    [0.0, 0.0],
    [-0.5, 0.5],
    [2.0, 8.0],
    [-7.0, 3.0],
    [-1e4, 1e4],
];
const NON_NEGATIVE: &[Iv] = &[[0.0, 1.0], [0.5, 2.0], [1e-6, 1e3], [0.0, 0.0], [2.0, 8.0], [0.0, 4.0]];
const LOWS: &[Iv] = &[[-2.0, -1.0], [-1.0, 0.0], [-0.5, -0.5], [0.0, 0.0], [0.0, 0.25]];
const HIGHS: &[Iv] = &[[0.5, 1.0], [1.0, 2.0], [0.25, 0.25], [3.0, 5.0]];
const STRICT_HIGHS: &[Iv] = &[[0.5, 1.0], [1.0, 2.0], [3.0, 5.0]];

struct Step {
    op: &'static str,
    ports: &'static [(&'static str, &'static [Iv])],
    lanes: u8,
    out: u8,
    signed_zero: bool,
}

const fn unary(op: &'static str) -> Step {
    Step { op, ports: &[("x", ANY)], lanes: 1, out: 1, signed_zero: true }
}
const fn binary(op: &'static str) -> Step {
    Step { op, ports: &[("a", ANY), ("b", ANY)], lanes: 1, out: 1, signed_zero: true }
}

const STEPS: &[Step] = &[
    unary("abs@1"),
    unary("acos@1"),
    unary("asin@1"),
    unary("atan@1"),
    unary("ceil@1"),
    unary("cos@1"),
    unary("exp@1"),
    unary("exp2@1"),
    unary("floor@1"),
    unary("fract@1"),
    unary("inverse_sqrt@1"),
    unary("log@1"),
    unary("log2@1"),
    unary("neg@1"),
    unary("round@1"),
    unary("sign@1"),
    unary("sin@1"),
    unary("sqrt@1"),
    unary("tan@1"),
    unary("trunc@1"),
    binary("add@1"),
    binary("sub@1"),
    binary("mul@1"),
    binary("div@1"),
    binary("min@1"),
    binary("max@1"),
    binary("mod@1"),
    Step { op: "pow@1", ports: &[("a", NON_NEGATIVE), ("b", ANY)], lanes: 1, out: 1, signed_zero: false },
    Step { op: "atan2@1", ports: &[("y", ANY), ("x", ANY)], lanes: 1, out: 1, signed_zero: true },
    Step { op: "clamp@1", ports: &[("x", ANY), ("lo", LOWS), ("hi", HIGHS)], lanes: 1, out: 1, signed_zero: true },
    Step { op: "mix@1", ports: &[("a", ANY), ("b", ANY), ("t", ANY)], lanes: 1, out: 1, signed_zero: true },
    Step { op: "smoothstep@1", ports: &[("lo", LOWS), ("hi", STRICT_HIGHS), ("x", ANY)], lanes: 1, out: 1, signed_zero: true },
    Step { op: "length@1", ports: &[("x", ANY)], lanes: 3, out: 1, signed_zero: true },
    Step { op: "normalize@1", ports: &[("x", ANY)], lanes: 3, out: 3, signed_zero: true },
    Step { op: "dot@1", ports: &[("a", ANY), ("b", ANY)], lanes: 3, out: 1, signed_zero: true },
    Step { op: "distance@1", ports: &[("a", ANY), ("b", ANY)], lanes: 3, out: 1, signed_zero: true },
    Step { op: "cross@1", ports: &[("a", ANY), ("b", ANY)], lanes: 3, out: 3, signed_zero: true },
];

struct Seeded(u64);

impl Seeded {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn pick<'a>(&mut self, from: &'a [Iv]) -> &'a Iv {
        &from[(self.next() % from.len() as u64) as usize]
    }
}

fn input_lane(iv: &Iv, signed_zero: bool) -> Lane {
    Lane {
        lo: iv[0],
        hi: iv[1],
        may_nan: false,
        may_pos_inf: false,
        may_neg_inf: false,
        may_neg_zero: signed_zero && iv[0] <= 0.0 && iv[1] >= 0.0,
    }
}

fn sample(rng: &mut Seeded, iv: &Iv, signed_zero: bool) -> f64 {
    let [lo, hi] = *iv;
    let holds_zero = lo <= 0.0 && hi >= 0.0;
    match rng.next() % 16 {
        0 => lo,
        1 => hi,
        2 if holds_zero => 0.0,
        3 if holds_zero && signed_zero => -0.0,
        _ => {
            let x = lo + rng.unit() * (hi - lo);
            let r = f64::from(x as f32);
            if (lo..=hi).contains(&r) { r } else { x }
        }
    }
}

fn probe(step: &Step) -> Value {
    let pick = if step.lanes == 1 { "x" } else { "xyz" };
    let mut steps = json!({
        "p": {"op": "pixel@1", "args": {}},
        "ixy": {"op": "convert@1", "args": {"x": "p", "to": "vec2<i32>"}}
    });
    let mut inputs = json!({});
    let mut args = json!({});
    for (k, (port, _)) in step.ports.iter().enumerate() {
        let tex = format!("t{k}");
        inputs[&tex] = json!({"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}});
        steps[format!("l{k}")] = json!({"op": "load@1", "args": {"tex": tex, "ixy": "ixy"}});
        steps[format!("a{k}")] = json!({"op": "split@1", "args": {"x": format!("l{k}"), "pick": pick}});
        args[*port] = json!(format!("a{k}"));
    }
    steps["r"] = json!({"op": step.op, "args": args});
    steps["out"] = if step.out == 1 {
        json!({"op": "compose@1", "args": {"x": "r", "y": "r", "z": "r", "w": "r"}})
    } else {
        json!({"op": "compose@1", "args": {"x": "r", "y": 0.0}})
    };
    first_party_pass("test.transfer_probe@1", inputs, steps, "out")
}

fn inside(v: f64, l: &Lane) -> bool {
    if v.is_nan() {
        l.may_nan
    } else if v == f64::INFINITY {
        l.may_pos_inf || l.hi == f64::INFINITY
    } else if v == f64::NEG_INFINITY {
        l.may_neg_inf || l.lo == f64::NEG_INFINITY
    } else if v == 0.0 && v.is_sign_negative() {
        l.may_neg_zero
    } else if v > f64::from(f32::MAX) {
        l.may_pos_inf || l.hi >= v
    } else if v < -f64::from(f32::MAX) {
        l.may_neg_inf || l.lo <= v
    } else {
        l.lo <= v && v <= l.hi
    }
}

fn lane_text(l: &Lane) -> String {
    format!(
        "[{}, {}] nan {} +inf {} -inf {} -0 {}",
        l.lo, l.hi, l.may_nan, l.may_pos_inf, l.may_neg_inf, l.may_neg_zero
    )
}

fn containment_failures(step: &Step, seed: u64, planted: Option<CheckOptions>) -> Vec<String> {
    let mut rng = Seeded(seed);
    let sets: Vec<Vec<Vec<Iv>>> = (0..SETS)
        .map(|_| {
            step.ports
                .iter()
                .map(|(_, pool)| (0..step.lanes).map(|_| *rng.pick(pool)).collect())
                .collect()
        })
        .collect();
    let facts: Vec<Fact> = sets
        .iter()
        .map(|set| {
            let args: Vec<Fact> = set
                .iter()
                .map(|lanes| Fact { lanes: lanes.iter().map(|iv| input_lane(iv, step.signed_zero)).collect() })
                .collect();
            match planted {
                Some(o) => transfer_with(step.op, &args, o),
                None => transfer(step.op, &args),
            }
        })
        .collect();
    for (k, f) in facts.iter().enumerate() {
        if f.lanes.len() != usize::from(step.out) {
            return vec![format!(
                "{}: its transfer gives {} lanes for set {k}, not {}",
                step.op,
                f.lanes.len(),
                step.out
            )];
        }
    }
    let mut images: Vec<Image> = step.ports.iter().map(|_| Image::new(SIDE, SIDE)).collect();
    let mut drawn: Vec<Vec<Vec<f64>>> = vec![Vec::new(); (SIDE * SIDE) as usize];
    for y in 0..SIDE {
        let set = &sets[(y / ROWS_PER_SET) as usize];
        for x in 0..SIDE {
            let i = (y * SIDE + x) as usize;
            for (k, lanes) in set.iter().enumerate() {
                let mut px = [0.0; 4];
                for (c, iv) in lanes.iter().enumerate() {
                    px[c] = sample(&mut rng, iv, step.signed_zero);
                }
                images[k].px[i] = px;
                drawn[i].push(px[..lanes.len()].to_vec());
            }
        }
    }
    let op = probe(step);
    let checked = match read_and_check(&op) {
        Ok(c) => c,
        Err(issues) => {
            return vec![format!(
                "{}: the CPU reference's probe (a first-party pass) doesn't check: {}",
                step.op,
                shown(&issues)
            )]
        }
    };
    let mut env = Env {
        t: 0.0,
        seed: 0,
        clip: [0.0; 16],
        inverse_clip: [0.0; 16],
        eye: [0.0; 4],
        inputs: interp::inputs(&checked, &BTreeMap::new(), &BTreeMap::new()),
        textures: BTreeMap::new(),
        normals: [[0.0; 3]; 3],
    };
    for (k, img) in images.iter().enumerate() {
        env.textures.insert(format!("t{k}"), img);
    }
    let out = match interp::pass(&checked, &env, [SIDE, SIDE]) {
        Ok(o) => o,
        Err(e) => return vec![format!("{}: the CPU reference doesn't run its probe: {e}", step.op)],
    };
    let mut failures = Vec::new();
    for (i, px) in out.px.iter().enumerate() {
        let k = i / (SIDE * ROWS_PER_SET) as usize;
        let fact = &facts[k];
        for (c, lane) in fact.lanes.iter().enumerate() {
            let v = px[c];
            if !inside(v, lane) {
                failures.push(format!(
                    "{}: inputs {:?} from {:?} give {v} on the CPU reference, outside its transfer lane {c} {}",
                    step.op,
                    drawn[i],
                    sets[k],
                    lane_text(lane)
                ));
            }
        }
        if failures.len() >= 8 {
            break;
        }
    }
    failures
}

fn seed_of(op: &str) -> u64 {
    op.bytes()
        .fold(0x1397_u64, |h, b| h.wrapping_mul(0x100_0000_01b3).wrapping_add(u64::from(b)))
}

#[test]
fn ac4_e6fb8ccf_10000_seeded_inputs_of_each_math_step_on_the_cpu_reference_lie_inside_its_transfer_interval() {
    let mut failures = Vec::new();
    for step in STEPS {
        failures.extend(containment_failures(step, seed_of(step.op), None));
    }
    none(&failures, "#1397.e6fb8ccf");
}

#[test]
fn ac4_e6fb8ccf_a_planted_mul_that_keeps_only_lo_lo_and_hi_hi_fails_naming_the_step() {
    let planted = CheckOptions {
        mul_two_corners: true,
        ..CheckOptions::default()
    };
    let mul = STEPS.iter().find(|s| s.op == "mul@1").expect("mul@1 is a math step");
    let failures = containment_failures(mul, seed_of(mul.op), Some(planted));
    assert!(
        !failures.is_empty(),
        "#1397.e6fb8ccf the planted mul (mul_two_corners) holds every CPU reference value; it must leave some outside"
    );
    assert!(
        failures.iter().all(|f| f.starts_with("mul@1:")),
        "#1397.e6fb8ccf each failure under the planted mul names mul@1:\n  {}",
        failures.join("\n  ")
    );
}
