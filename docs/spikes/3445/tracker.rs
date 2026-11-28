//! Spike #3445, the page tracker's reading: ns per fuel unit of the metering benchmark and of a
//! twin that mostly writes, each rewritten as a plain program (`Mode::Plain`: no tracker) and as a
//! logic item's (`Mode::Logic`: a call to the tracker after every store), on the shipped rewrite
//! and the shipped engine settings (`deep_sandbox_wasmtime::Runner`). Never shipped: `measure.mjs`
//! copies this file into a scratch copy of the tree as an example of `deep-logic`, whose
//! dependencies it uses and whose code it doesn't change.
//!
//! A reading is taken as `deep_logic::budget::metered` takes the record's: the least CPU time of
//! ten steps of the program, less the least of ten of its one-iteration twin, over the fuel between
//! them. Here a step is one call of `step` on a fresh instance after `init`; the benchmark's is a
//! world's step, whose own work both sides share, so the difference is the same quantity.
//! Prints one JSON object.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas_sandbox::check::{self, Limits};
use deep_canvas_sandbox::rewrite::{self, rewrite_as, Mode, FUEL};
use deep_logic::budget::{cpu_ns, meter};
use deep_sandbox_wasmtime::{Call, Faults, Runner, Val};
use serde_json::{json, Value};

/// The readings a program gets: one more than is kept, as benchmarks/logic.mjs asks `metering`
/// one more time than it reads.
const RUNS: usize = 6;
/// The steps a reading takes the least of, as `metered` does.
const STEPS: i64 = 10;
/// The stores of one iteration of the twin that mostly writes.
const STORES: u32 = 64;
/// Its iterations a step: about the benchmark's 4.8M fuel.
const ITER: u32 = 23_600;
/// The iterations a step of the twin with its marks written inline: each store's mark is ten more
/// instructions of the program's own, 843 an iteration, so a quarter as many fit the same fuel.
const ITER_MARKED: u32 = 5_900;

/// The twin that mostly writes: each iteration stores an i64 at 64 addresses 8 bytes apart, two
/// instructions before each store (the address and the value), then moves 512 bytes on through
/// the first MiB of its 2 MiB: 64 stores in 203 instructions. `mark` writes, after each store, the
/// page mark the tracker makes, inline and for a memory of one bitmap word, as the program's own
/// instructions, which is what an inlined tracker would run.
fn writer(iterations: u32, mark: bool) -> String {
    let mut stores = String::new();
    for j in 0..STORES {
        let offset = 8 * j;
        stores.push_str(&format!(
            "      (i64.store offset={offset} (local.get $p) (local.get $q))\n"
        ));
        if mark {
            stores.push_str(&format!(
                "      (global.set $pages (i64.or (global.get $pages) (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shr_u (i32.add (local.get $p) (i32.const {offset})) (i32.const 16))))))\n"
            ));
        }
    }
    let pages = if mark {
        "(global $pages (mut i64) (i64.const 0))"
    } else {
        ""
    };
    format!(
        r#"(module (memory (export "memory") 32 32)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  {pages}
  (func (export "init") (param i64))
  (func (export "step") (param i64) (local $n i32) (local $p i32) (local $q i64)
    (local.set $n (i32.const {iterations})) (local.set $q (i64.const 0x0123456789abcdef))
    (loop $l
{stores}      (local.set $p (i32.and (i32.add (local.get $p) (i32.const {moved})) (i32.const 0xffff8)))
      (br_if $l (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))))"#,
        moved = 8 * STORES
    )
}

/// The benchmark's program and its one-iteration twin, as `deep_logic::budget::meter` builds them.
fn metering() -> [Vec<u8>; 2] {
    meter().map(|piece| {
        let assets = piece["assets"].as_object().expect("the piece's assets");
        let program = assets.values().next().and_then(Value::as_str);
        B64.decode(program.expect("the benchmark's program"))
            .expect("base64")
    })
}

/// One fresh instance's least CPU time of `STEPS` steps, and the fuel a step used.
fn least(bytes: &[u8]) -> (u64, i64) {
    const GIVEN: i64 = 10_000_000;
    let mut runner = Runner::new(bytes, Faults::default(), true).expect("the program instantiates");
    let mut call = Call {
        export: "init".into(),
        args: vec![Val::I64(0)],
        fuel: GIVEN,
        stack: 1 << 20,
        deadline: None,
    };
    let out = runner.call(&call).expect("init runs");
    assert!(out.trap.is_none(), "init trapped: {:?}", out.trap);
    call.export = "step".into();
    let mut best = u64::MAX;
    let mut fuel = 0;
    for k in 0..STEPS {
        call.args = vec![Val::I64(k)];
        let t = cpu_ns();
        let out = runner.call(&call).expect("a step runs");
        best = best.min(cpu_ns() - t);
        assert!(out.trap.is_none(), "step {k} trapped: {:?}", out.trap);
        let Some(Val::I64(left)) = runner.global(FUEL) else {
            panic!("the rewritten program has no fuel counter")
        };
        fuel = GIVEN - left;
    }
    (best, fuel)
}

/// A program and its one-iteration twin under one rewrite: its fuel, and `RUNS` readings.
fn read(name: &str, mode: Mode, [bench, twin]: &[Vec<u8>; 2]) -> Value {
    let rewritten = [bench, twin].map(|bytes| {
        check::check(bytes, &Limits::default()).expect("the subset admits the program");
        rewrite_as(bytes, rewrite::Faults::default(), mode).expect("the rewrite")
    });
    let mut runs = Vec::new();
    let mut fuel = [0, 0];
    for _ in 0..RUNS {
        let (bench_ns, bench_fuel) = least(&rewritten[0].bytes);
        let (twin_ns, twin_fuel) = least(&rewritten[1].bytes);
        fuel = [bench_fuel, twin_fuel];
        runs.push(json!({
            "bench_ns": bench_ns, "twin_ns": twin_ns,
            "ns_per_fuel": (bench_ns as f64 - twin_ns as f64) / (bench_fuel - twin_fuel) as f64,
        }));
    }
    json!({
        "program": name,
        "rewrite": match mode { Mode::Plain => "plain", Mode::Logic => "logic", Mode::Counted => "counted" },
        "sha256": {"bench": rewrite::hash(bench), "twin": rewrite::hash(twin)},
        "rewritten": {"bench": rewritten[0].hash, "twin": rewritten[1].hash,
            "bench_bytes": rewritten[0].bytes.len()},
        "fuel": {"bench": fuel[0], "twin": fuel[1]},
        "steps": STEPS,
        "runs": runs,
    })
}

fn main() {
    let assemble = |iterations: u32, mark: bool| {
        [iterations, 1].map(|n| wat::parse_str(writer(n, mark)).expect("the twin assembles"))
    };
    let (benchmark, writes, marked) = (
        metering(),
        assemble(ITER, false),
        assemble(ITER_MARKED, true),
    );
    let rows = vec![
        read("metering", Mode::Logic, &benchmark),
        read("metering", Mode::Plain, &benchmark),
        read("writes", Mode::Logic, &writes),
        read("writes", Mode::Plain, &writes),
        read("writes-marked-inline", Mode::Plain, &marked),
    ];
    let out = json!({
        "engine": format!("wasmtime {}", deep_sandbox_wasmtime::WASMTIME),
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        "writes": {"stores": STORES, "iterations": ITER, "instructions": 3 * STORES + 11,
            "marked": {"iterations": ITER_MARKED, "instructions": 13 * STORES + 11}},
        "rows": rows,
    });
    println!("{out}");
}
