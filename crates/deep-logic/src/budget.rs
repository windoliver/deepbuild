//! logic.budget (canvas primitives: Check input: logic kinds, Logic: work across steps; #532):
//! from the bake's fuel per step, it fails a step that used more than `fuel_share` of its fuel or
//! passed the step ceiling on a host in `on`, and a frame whose steps can't fit the class's frame
//! CPU. A step costs its fuel and also a fixed cost fuel doesn't see: entering the program,
//! filling its read region and copying its writes out, which the reference Mac measured with an
//! empty step at 1, 100 and 1,000 items, so many small items that spend 0 fuel still miss the
//! frame. Every number it judges by is the metering record's, so it times nothing itself.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::OnceLock;

use serde_json::{json, Value};

use deep_canvas::budget::Class;

use crate::piece::{self, History, Item, Piece};
use crate::world::{Record, World};
use crate::Planted;

/// The figure class's frame CPU (Budget classes), in ns.
pub const FRAME_NS: f64 = 4_000_000.0;
/// One frame at 60 fps, in flicks.
const FRAME: i64 = 705_600_000 / 60;

const EMPTY: &str = r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64)) (func (export "step") (param i64)))"#;
/// The metering benchmark (Logic: work across steps): the slowest a fuel unit runs in ordinary
/// compiled code. Each iteration's load from 2 MiB of memory, 64-bit divide, square root and f64
/// divide feed the next, so neither engine can overlap them; ITER iterations a step, and its
/// one-iteration twin takes away a step's fixed cost.
const METER: &str = r#"(module (memory (export "memory") 32 32)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64))
  (func (export "step") (param i64) (local $n i32) (local $p i32) (local $q i64) (local $x f64)
    (local.set $n (i32.const ITER)) (local.set $x (f64.const 2))
    (loop $l
      (local.set $q (i64.add (i64.add (i64.mul (local.get $q) (i64.const 6364136223846793005))
        (i64.load (local.get $p))) (i64.const 1442695040888963407)))
      (local.set $x (f64.div (f64.sqrt (f64.add (f64.mul (local.get $x) (local.get $x))
        (f64.convert_i64_u (i64.div_u (local.get $q)
          (i64.or (i64.shr_u (local.get $q) (i64.const 60)) (i64.const 3))))))
        (f64.const 1.0000001)))
      (i64.store (local.tee $p (i32.and (i32.wrap_i64 (i64.shr_u
        (i64.reinterpret_f64 (local.get $x)) (i64.const 8))) (i32.const 0x1ffff8))) (local.get $q))
      (br_if $l (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))))"#;
/// The benchmark's iterations a step: about 4.8M fuel, under the 10M fuel budget.
const METER_ITER: u32 = 120_000;

/// One calibration program as a piece of one item `e` with `fuel`.
fn calibration(wat: &str, fuel: i64) -> Value {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let bytes = wat::parse_str(wat).expect("a calibration program");
    let sha = deep_canvas_sandbox::rewrite::hash(&bytes);
    json!({"seed": 0, "assets": {&sha: B64.encode(&bytes)},
        "items": {"e": {"kind": "logic@1", "params": {"program": sha, "budget": {"fuel": fuel}}}}})
}

/// The metering benchmark's piece and its one-iteration twin's.
pub fn meter() -> [Value; 2] {
    [METER_ITER, 1].map(|n| calibration(&METER.replace("ITER", &n.to_string()), 10_000_000))
}

/// One calibration piece's item, checked.
fn item(p: &Value) -> Item {
    let mut history = History::new();
    piece::check(p, &Planted::default(), &mut history)
        .expect("a calibration program checks")
        .items
        .remove(0)
}

/// The fuel one step of `item` uses.
fn fuel_of(item: &Item) -> i64 {
    let mut rec = Record::default();
    let p = Rc::new(Piece {
        seed: 0,
        class: Class::Figure,
        controls: Default::default(),
        tour: None,
        items: vec![item.clone()],
        machine: Vec::new(),
        document: String::new(),
    });
    World::new(
        p,
        BTreeMap::new(),
        false,
        Planted::default(),
        &mut rec,
        None,
    )
    .expect("a calibration program instantiates")
    .run(1, &mut rec, &mut |_, _| {});
    rec.fuel.get(&0).and_then(|f| f.first()).map_or(0, |x| x.1)
}

/// One reading of the app's ns per fuel unit: the benchmark's least step CPU time less its twin's,
/// over the fuel between them; with each one's fuel a step.
pub fn metered() -> (f64, [i64; 2]) {
    let [bench, twin] = meter().map(|p| item(&p));
    let fuel = [fuel_of(&bench), fuel_of(&twin)];
    let ns = frame_ns(&bench, 1, 10) - frame_ns(&twin, 1, 10);
    (ns / (fuel[0] - fuel[1]) as f64, fuel)
}

/// This thread's CPU time, in ns: what a step costs the logic module, which other processes'
/// load doesn't stretch.
pub fn cpu_ns() -> u64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: clock_gettime writes the timespec it's given and reads nothing else.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}

/// The least CPU time, of `frames` frames, a world of `n` copies of `base` takes to run one step.
fn frame_ns(base: &Item, n: usize, frames: i64) -> f64 {
    let items = (0..n)
        .map(|i| Item {
            id: format!("e{i}"),
            ..base.clone()
        })
        .collect();
    let p = Rc::new(Piece {
        seed: 0,
        class: Class::Figure,
        controls: Default::default(),
        tour: None,
        items,
        machine: Vec::new(),
        document: String::new(),
    });
    let mut rec = Record::default();
    let mut w = World::new(
        p,
        BTreeMap::new(),
        false,
        Planted::default(),
        &mut rec,
        None,
    )
    .expect("calibration items instantiate");
    let mut best = u64::MAX;
    for k in 0..frames {
        let t = cpu_ns();
        w.run(k + 1, &mut rec, &mut |_, _| {});
        best = best.min(cpu_ns() - t);
    }
    best as f64
}

/// This host's fixed cost of a step, measured now: an empty step's CPU time at 1, 100 and 1,000
/// items, and per item per step (the 1,000 items' time over 1,000).
pub fn fixed_now() -> Value {
    let empty = item(&calibration(EMPTY, 1_000_000));
    let at = [1, 100, 1000].map(|n| frame_ns(&empty, n, 20));
    json!({"at": {"1": at[0], "100": at[1], "1000": at[2]}, "per_item_ns": at[2] / 1000.0})
}

/// The metering benchmark's record on the reference Mac (benchmarks/logic.mjs --write): every
/// step ceiling and the app's fixed cost of a step come from it, so logic.budget times nothing
/// and every machine fails the same steps.
pub const METERING: &str = include_str!("../metering.json");

fn record() -> &'static Value {
    static RECORD: OnceLock<Value> = OnceLock::new();
    RECORD.get_or_init(|| serde_json::from_str(METERING).expect("metering.json is JSON"))
}

/// The ns per fuel unit the metering benchmark measured on `host`: app or web.
pub fn ns_per_fuel(host: &str) -> f64 {
    record()["ns_per_fuel"][host]
        .as_f64()
        .expect("metering.json has app's and web's ns per fuel unit")
}

/// The fuel budget's cap (Logic `logic@1`): a class with no frame CPU, export, has it as its
/// step ceiling.
pub const FUEL_CAP: i64 = 10_000_000;
/// The step rates the table publishes, in Hz.
pub const RATES: [i64; 3] = [30, 60, 120];

/// The step ceiling of `class` for a step of `step` flicks on `host`: ⌊the class's frame CPU ×
/// 3/4 ÷ ⌈step_rate ÷ 60⌉ ÷ the host's ns per fuel unit⌋.
pub fn ceiling(class: Class, step: i64, host: &str) -> i64 {
    let Some(ms) = class.limits().cpu_ms else {
        return FUEL_CAP;
    };
    let per_frame = ((FRAME + step - 1) / step).max(1) as f64;
    (ms * 1e6 * 0.75 / per_frame / ns_per_fuel(host)).floor() as i64
}

/// Whether an item runs pipelined (Logic: work across steps): it steps at 30 Hz or slower on a
/// fixed clock, so its step k + 1 runs on the logic thread across the frames that draw k − 1 to
/// k, a linear write drawing one step late. Every write is linear or hold, the only two
/// `interpolate` takes; a turn clock's steps run only when asked, so they stay on the frame.
pub fn pipelined(item: &Item) -> bool {
    // A preview reads the state the render worker draws, so an item with one steps there (#548).
    item.step >= 2 * FRAME && !item.turn && item.preview.is_none()
}

/// What an item's steps are held to on `host`: its class's ceiling, twice the 60 Hz one when it
/// runs pipelined.
pub fn held(class: Class, item: &Item, host: &str) -> i64 {
    if pipelined(item) {
        2 * ceiling(class, FRAME, host)
    } else {
        ceiling(class, item.step, host)
    }
}

/// The step ceilings deep_kinds publishes: `{rate → {class → {app, web}}}`; the planted table
/// publishes the fuel budget's cap as every one.
pub fn ceilings(cap: bool) -> Value {
    let table: serde_json::Map<String, Value> = RATES
        .iter()
        .map(|hz| {
            let step = 705_600_000 / hz;
            let classes: serde_json::Map<String, Value> = deep_canvas::budget::CLASSES
                .iter()
                .map(|c| {
                    let at = |host| {
                        if cap {
                            FUEL_CAP
                        } else {
                            ceiling(*c, step, host)
                        }
                    };
                    (
                        c.name().to_string(),
                        json!({"app": at("app"), "web": at("web")}),
                    )
                })
                .collect();
            (hz.to_string(), Value::Object(classes))
        })
        .collect();
    Value::Object(table)
}

/// logic.budget over a bake's record (the #532 acceptance README: logic.budget): `{ok, kind,
/// verdict, failures, blocked, report}`. A busiest step's share is stated to 4 decimal places.
/// Every step whose fuel passes its item's ceiling on a host in `on` fails, from the bake's fuel
/// alone; with `web` and nothing failed it's BLOCKED until the web player's timed run.
pub fn budget(
    piece: &Piece,
    rec: &Record,
    fuel_share: f64,
    on: &[String],
    planted: Planted,
) -> Value {
    let frame_ns = piece.class.limits().cpu_ms.map(|ms| ms * 1e6);
    let mut failures = Vec::new();
    let mut items = serde_json::Map::new();
    for (i, item) in piece.items.iter().enumerate() {
        let steps = rec.fuel.get(&i).map_or(&[][..], Vec::as_slice);
        let Some(&(k, fuel)) = steps
            .iter()
            .fold(None, |best: Option<&(i64, i64)>, x| match best {
                Some(b) if b.1 >= x.1 => Some(b),
                _ => Some(x),
            })
        else {
            continue;
        };
        let share = fuel as f64 / item.fuel as f64;
        let held: serde_json::Map<String, Value> = on
            .iter()
            .map(|h| (h.clone(), json!(held(piece.class, item, h))))
            .collect();
        items.insert(
            item.id.clone(),
            json!({"step": k, "fuel": fuel, "share": (share * 1e4).round() / 1e4, "ceiling": held, "pipelined": pipelined(item)}),
        );
        if share > fuel_share {
            failures.push(json!({"rule": "fuel_share", "item": item.id, "step": k, "fuel": fuel, "share": share}));
        }
    }
    let mut fixed = serde_json::Map::new();
    let mut blocked = Vec::new();
    for host in on {
        for (i, item) in piece.items.iter().enumerate() {
            let c = if planted.budget_holds_steps_to_fuel_budget {
                item.fuel
            } else {
                held(piece.class, item, host)
            };
            for &(k, fuel) in rec
                .fuel
                .get(&i)
                .into_iter()
                .flatten()
                .filter(|(_, f)| *f > c)
            {
                failures.push(json!({"rule": "ceiling", "item": item.id, "step": k, "host": host, "ceiling": c, "fuel": fuel}));
            }
        }
        if host != "app" {
            if !planted.budget_web_passes_from_fuel {
                blocked.push(json!({"host": host, "ask": format!("logic.budget on {host} plays the bake in the web player in headless Chrome on the reference Mac; it hasn't run")}));
            }
            continue;
        }
        let fixed_app = &record()["fixed"];
        let per_item_ns = fixed_app["per_item_ns"]
            .as_f64()
            .expect("metering.json has the app's fixed cost of a step");
        let per_item = if planted.budget_sums_only_fuel {
            0.0
        } else {
            per_item_ns
        };
        let ns_per_fuel = ns_per_fuel(host);
        if let Some(frame_ns) = frame_ns.filter(|_| !planted.budget_holds_steps_to_fuel_budget) {
            let mut frames: BTreeMap<i64, (usize, i64)> = BTreeMap::new();
            for (i, item) in piece.items.iter().enumerate() {
                for &(k, fuel) in rec.fuel.get(&i).into_iter().flatten() {
                    let f = frames.entry(k * item.step / FRAME).or_default();
                    f.0 += 1;
                    f.1 += fuel;
                }
            }
            if let Some((frame, ns)) = frames
                .iter()
                .map(|(f, (n, fuel))| (*f, *n as f64 * per_item + *fuel as f64 * ns_per_fuel))
                .find(|(_, ns)| *ns > frame_ns)
            {
                failures.push(json!({"rule": "frame", "host": host, "frame": frame, "ns": ns}));
            }
            let n = piece.items.len();
            if n as f64 * per_item > frame_ns {
                failures.push(json!({"rule": "fixed_cost", "host": host, "items": n, "per_item_ns": per_item_ns}));
            }
        }
        fixed.insert(
            host.clone(),
            json!({
                "at": fixed_app["at"], "per_item_ns": per_item_ns, "ns_per_fuel": ns_per_fuel,
            }),
        );
    }
    let verdict = if !failures.is_empty() {
        "FAIL"
    } else if !blocked.is_empty() {
        "BLOCKED"
    } else {
        "PASS"
    };
    json!({"ok": true, "kind": "logic.budget", "verdict": verdict, "failures": failures, "blocked": blocked,
        "report": {"items": items, "class": piece.class.name(), "fixed": fixed, "frame_ns": frame_ns}})
}
