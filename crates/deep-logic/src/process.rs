//! process@1's kind rules (#980; canvas primitives: Logic: library interfaces): a run of a logic
//! item with `process` read step by step from the arrays its library writes, so the rules hold any
//! library under the interface, a planted one included. `process.conserve`: at every step, each
//! kind's entities made equal those held (at a station or packed on a live carrier) plus those
//! out. `process.busy`: at every step, each resource busy exactly while held and never past its
//! capacity. `process.little`: over the window past the warm-up at the last step, each station's
//! (and the system's) mean work in progress equals its throughput times its mean time there,
//! within the tolerance.

use serde_json::{json, Value};

use crate::piece::Item;

/// The first fails a rule reports.
const SHOWN: usize = 16;

/// An array the rules read: its byte offset in the write region and its element count.
#[derive(Clone, Copy)]
struct At(usize, usize);

/// Each step's cumulative counts process.little reads: now, and per station then the system,
/// area, departures and time there.
struct Counts {
    now: f64,
    area: Vec<f64>,
    left: Vec<f64>,
    dwell: Vec<f64>,
}

/// The judge's reading of one item's run, step by step.
pub struct Judge {
    kinds: Vec<String>,
    tolerance: f64,
    kind: At,
    at: At,
    batch: At,
    holds: At,
    made_n: At,
    out_n: At,
    busy: At,
    cap: At,
    left: At,
    area: At,
    dwell: At,
    clock: At,
    steps: i64,
    last: i64,
    conserve: (bool, Vec<Value>),
    busy_rule: (bool, Vec<Value>),
    counts: Vec<Counts>,
    window: (f64, f64),
}

fn i32_at(b: &[u8], o: usize) -> i32 {
    i32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn f64_at(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn fail(rule: &mut (bool, Vec<Value>), v: Value) {
    rule.0 = true;
    if rule.1.len() < SHOWN {
        rule.1.push(v);
    }
}

impl Judge {
    /// The rules over `item`'s arrays, or what it lacks: every array they read, by name and type.
    pub fn new(item: &Item, kinds: &[String], tolerance: f64) -> Result<Judge, String> {
        let need = |name: &str, ty: &str| {
            item.write(name)
                .filter(|e| e.ty == ty)
                .map(|e| {
                    let size = if ty == "f64" { 8 } else { 4 };
                    At(e.offset as usize, e.size as usize / size)
                })
                .ok_or_else(|| {
                    "an item with process writes kind, at, batch, holds, made_n, out_n, busy, cap and left (i32), and area, dwell and clock (f64)".to_string()
                })
        };
        Ok(Judge {
            kinds: kinds.to_vec(),
            tolerance,
            kind: need("kind", "i32")?,
            at: need("at", "i32")?,
            batch: need("batch", "i32")?,
            holds: need("holds", "i32")?,
            made_n: need("made_n", "i32")?,
            out_n: need("out_n", "i32")?,
            busy: need("busy", "i32")?,
            cap: need("cap", "i32")?,
            left: need("left", "i32")?,
            area: need("area", "f64")?,
            dwell: need("dwell", "f64")?,
            clock: need("clock", "f64")?,
            steps: 0,
            last: 0,
            conserve: (false, Vec::new()),
            busy_rule: (false, Vec::new()),
            counts: Vec::new(),
            window: (3600.0, 0.0),
        })
    }

    /// Step k's write region.
    pub fn step(&mut self, k: i64, b: &[u8]) {
        self.steps += 1;
        self.last = k;
        let e = self
            .kind
            .1
            .min(self.at.1)
            .min(self.batch.1)
            .min(self.holds.1);
        let n = self.left.1.saturating_sub(1);
        let row = |a: At, r: usize| i32_at(b, a.0 + 4 * r);
        let live = |r: i32| r >= 0 && (r as usize) < e && row(self.kind, r as usize) >= 0;
        let mut held = vec![0i64; self.made_n.1];
        let mut holders = vec![0i64; self.busy.1];
        for r in 0..e {
            let kind = row(self.kind, r);
            if kind < 0 {
                continue;
            }
            let at = row(self.at, r);
            if (at >= 0 && (at as usize) < n) || live(row(self.batch, r)) {
                if let Some(h) = held.get_mut(kind as usize) {
                    *h += 1;
                }
            }
            if let Some(h) = usize::try_from(row(self.holds, r))
                .ok()
                .and_then(|j| holders.get_mut(j))
            {
                *h += 1;
            }
        }
        for (i, held) in held.iter().enumerate() {
            let made = i32_at(b, self.made_n.0 + 4 * i) as i64;
            let out = i32_at(b, self.out_n.0 + 4 * i) as i64;
            let gap = made - held - out;
            if gap != 0 {
                let kind = self.kinds.get(i).map_or(json!(i), |k| json!(k));
                fail(
                    &mut self.conserve,
                    json!({"step": k, "kind": kind, "gap": gap, "made": made, "held": held, "out": out}),
                );
            }
        }
        for (j, holders) in holders.iter().enumerate() {
            let busy = i32_at(b, self.busy.0 + 4 * j) as i64;
            let cap = i32_at(b, self.cap.0 + 4 * j) as i64;
            if busy != *holders || busy > cap || *holders > cap {
                fail(
                    &mut self.busy_rule,
                    json!({"step": k, "resource": j, "busy": busy, "holders": holders, "capacity": cap}),
                );
            }
        }
        let series = |a: At| (0..a.1).map(|i| f64_at(b, a.0 + 8 * i)).collect::<Vec<_>>();
        let now = f64_at(b, self.clock.0);
        if self.clock.1 >= 3 {
            self.window = (f64_at(b, self.clock.0 + 8), f64_at(b, self.clock.0 + 16));
        }
        self.counts.push(Counts {
            now,
            area: series(self.area),
            left: (0..self.left.1)
                .map(|i| i32_at(b, self.left.0 + 4 * i) as f64)
                .collect(),
            dwell: series(self.dwell),
        });
    }

    /// process.little at the last step: each station's and the system's work in progress against
    /// its throughput times its time there, over the window from the last step at or before
    /// max(now − window, warm-up).
    fn little(&self) -> (bool, Vec<Value>, Vec<Value>) {
        let (mut failed, mut fails, mut values) = (false, Vec::new(), Vec::new());
        let Some(end) = self.counts.last() else {
            return (false, fails, values);
        };
        let bound = (end.now - self.window.0).max(self.window.1);
        let start = self.counts.iter().rev().find(|c| c.now <= bound);
        let dt = end.now - start.map_or(0.0, |c| c.now);
        let n = end.left.len();
        for s in 0..n {
            let d = |of: fn(&Counts) -> &Vec<f64>| of(end)[s] - start.map_or(0.0, |c| of(c)[s]);
            let (area, left, dwell) = (d(|c| &c.area), d(|c| &c.left), d(|c| &c.dwell));
            let (wip, rate) = if dt > 0.0 {
                (area / dt, left / dt)
            } else {
                (0.0, 0.0)
            };
            let time = if left > 0.0 { dwell / left } else { 0.0 };
            let station = if s + 1 == n { json!("all") } else { json!(s) };
            let v = json!({"step": self.last, "station": station, "wip": wip, "throughput": rate * 3600.0, "time": time});
            if (wip - rate * time).abs() > self.tolerance * wip.abs().max((rate * time).abs()) {
                failed = true;
                if fails.len() < SHOWN {
                    fails.push(v.clone());
                }
            }
            values.push(v);
        }
        (failed, fails, values)
    }

    /// The rules' verdicts.
    pub fn result(self) -> Value {
        let verdict = |failed: bool| if failed { "FAIL" } else { "PASS" };
        let (failed, fails, values) = self.little();
        json!({"rules": {
            "process.conserve": {"verdict": verdict(self.conserve.0), "steps": self.steps, "fails": self.conserve.1},
            "process.busy": {"verdict": verdict(self.busy_rule.0), "steps": self.steps, "fails": self.busy_rule.1},
            "process.little": {"verdict": verdict(failed), "steps": i64::from(self.steps > 0), "fails": fails, "values": values},
        }})
    }
}
