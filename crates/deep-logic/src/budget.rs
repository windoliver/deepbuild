//! logic.budget (canvas primitives: Check input: logic kinds, Logic: work across steps; #532):
//! from the bake's fuel per step, it fails a step that used more than `fuel_share` of its fuel or
//! passed the step ceiling on a host in `on`, and a frame whose steps can't fit the class's frame
//! CPU. A step costs its fuel and also a fixed cost fuel doesn't see: entering the program,
//! filling its read region and copying its writes out, which this host measures with an empty
//! step at 1, 100 and 1,000 items, so many small items that spend 0 fuel still miss the frame.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::OnceLock;

use serde_json::{json, Value};

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
const BURN: &str = r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64))
  (func (export "step") (param i64) (local i32)
    (local.set 1 (i32.const 100000))
    (loop (br_if 0 (local.tee 1 (i32.sub (local.get 1) (i32.const 1)))))))"#;

/// One calibration program as a checked item with `fuel`.
fn item(wat: &str, fuel: i64) -> Item {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let bytes = wat::parse_str(wat).expect("a calibration program");
    let sha = deep_canvas_sandbox::rewrite::hash(&bytes);
    let p = json!({"seed": 0, "assets": {&sha: B64.encode(&bytes)},
        "items": {"e": {"kind": "logic@1", "params": {"program": sha, "budget": {"fuel": fuel}}}}});
    let mut history = History::new();
    piece::check(&p, &Planted::default(), &mut history)
        .expect("a calibration program checks")
        .items
        .remove(0)
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
        controls: Default::default(),
        sources: Default::default(),
        tour: None,
        items,
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

/// This host's measurements: an empty step's CPU time at 1, 100 and 1,000 items, its fixed cost
/// per item per step (the 1,000 items' time over 1,000), and its ns per fuel unit.
pub struct Host {
    pub at: [(usize, f64); 3],
    pub per_item_ns: f64,
    pub ns_per_fuel: f64,
}

pub fn app() -> &'static Host {
    static HOST: OnceLock<Host> = OnceLock::new();
    HOST.get_or_init(|| {
        let empty = item(EMPTY, 1_000_000);
        let at = [1, 100, 1000].map(|n| (n, frame_ns(&empty, n, 20)));
        let burn = item(BURN, 10_000_000);
        let mut rec = Record::default();
        let p = Rc::new(Piece {
            seed: 0,
            controls: Default::default(),
            sources: Default::default(),
            tour: None,
            items: vec![burn.clone()],
        });
        World::new(
            p,
            BTreeMap::new(),
            false,
            Planted::default(),
            &mut rec,
            None,
        )
        .expect("the burn program instantiates")
        .run(1, &mut rec, &mut |_, _| {});
        let fuel = rec
            .fuel
            .get(&0)
            .and_then(|f| f.first())
            .map_or(1, |x| x.1.max(1)) as f64;
        let ns_per_fuel = ((frame_ns(&burn, 1, 10) - at[0].1) / fuel).max(f64::MIN_POSITIVE);
        Host {
            at,
            per_item_ns: at[2].1 / 1000.0,
            ns_per_fuel,
        }
    })
}

/// The step ceiling: ⌊frame CPU × 3/4 ÷ ⌈step_rate ÷ 60⌉ ÷ ns per fuel unit⌋.
pub fn ceiling(item: &Item, ns_per_fuel: f64) -> i64 {
    let per_frame = (FRAME as f64 / item.step as f64).ceil().max(1.0);
    (FRAME_NS * 0.75 / per_frame / ns_per_fuel).floor() as i64
}

/// logic.budget over a bake's record (the #532 acceptance README: logic.budget): `{ok, kind,
/// verdict, failures, report}`. A busiest step's share is stated to 4 decimal places.
pub fn budget(
    piece: &Piece,
    rec: &Record,
    fuel_share: f64,
    on: &[String],
    planted: Planted,
) -> Value {
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
        items.insert(
            item.id.clone(),
            json!({"step": k, "fuel": fuel, "share": (share * 1e4).round() / 1e4}),
        );
        if share > fuel_share {
            failures.push(json!({"rule": "fuel_share", "item": item.id, "step": k, "fuel": fuel, "share": share}));
        }
    }
    let mut fixed = serde_json::Map::new();
    let mut blocked = Vec::new();
    for host in on {
        if host != "app" {
            blocked.push(json!({"host": host, "ask": format!("logic.budget on {host} plays the bake in the web player in headless Chrome on the reference Mac; it hasn't run")}));
            continue;
        }
        let h = app();
        for (i, item) in piece.items.iter().enumerate() {
            let c = ceiling(item, h.ns_per_fuel);
            if let Some(&(k, _)) = rec.fuel.get(&i).into_iter().flatten().find(|(_, f)| *f > c) {
                failures.push(json!({"rule": "ceiling", "item": item.id, "step": k, "host": host, "ceiling": c}));
            }
        }
        let per_item = if planted.budget_sums_only_fuel {
            0.0
        } else {
            h.per_item_ns
        };
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
            .map(|(f, (n, fuel))| (*f, *n as f64 * per_item + *fuel as f64 * h.ns_per_fuel))
            .find(|(_, ns)| *ns > FRAME_NS)
        {
            failures.push(json!({"rule": "frame", "host": host, "frame": frame, "ns": ns}));
        }
        let n = piece.items.len();
        if n as f64 * per_item > FRAME_NS {
            failures.push(json!({"rule": "fixed_cost", "host": host, "items": n, "per_item_ns": h.per_item_ns}));
        }
        fixed.insert(host.clone(), json!({
            "at": {"1": h.at[0].1, "100": h.at[1].1, "1000": h.at[2].1}, "per_item_ns": h.per_item_ns, "ns_per_fuel": h.ns_per_fuel,
        }));
    }
    let verdict = if !failures.is_empty() {
        "FAIL"
    } else if !blocked.is_empty() {
        "BLOCKED"
    } else {
        "PASS"
    };
    json!({"ok": true, "kind": "logic.budget", "verdict": verdict, "failures": failures, "blocked": blocked,
        "report": {"items": items, "fixed": fixed, "frame_ns": FRAME_NS}})
}
