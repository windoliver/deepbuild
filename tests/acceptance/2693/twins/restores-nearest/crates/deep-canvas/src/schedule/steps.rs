//! Simulate's steps (canvas primitives: Phase, simulate). Every stepping operator steps at every
//! multiple of its step length, in time order. At one time, a step whose values another reads
//! at its own step's time runs first: that order is the plan's, which the seal derived from the
//! at-time reads, and two that read each other at one time are a cycle the seal refused. Steps
//! that read nothing of each other's at one time keep the plan's tie order (canvas-module name,
//! or a shuffle), which no result depends on. A step reads another's array as earlier steps left
//! it through `earlier(…)`. What the steps write is carried state: a frame steps on from where
//! the last frame stopped. A frame before it is a seek (issue #488; Carried state, Logic:
//! checkpoints and bake): where a stepping module declares `checkpoint` carried state the
//! session keeps a checkpoint of every stepping array at every multiple of the ring's spacing,
//! each holding the state as of its flick, and the seek restores the last one at or before the
//! frame's time and steps forward from it, so seeking equals playing; without checkpoints it
//! starts again from the timeline's start.
//!
//! The checkpoints are a ring with a byte budget (#2693; Checkpoint ring): what each stepping
//! module declares for its `checkpoint` state, or 16 MiB for one that declares none, summed. The
//! spacing starts at the input track's 0.5 s; when the ring passes its budget it lets go of
//! every second checkpoint and the spacing doubles, as often as it takes. The checkpoint at
//! the timeline's start is always kept, and every multiple of the spacing up to the newest is
//! held, so a seek to any time at or after the start steps forward at most one spacing's steps.
//! A ring whose two checkpoints alone pass the budget holds only the start's and the newest
//! and says so (`over_budget`): never refused, never unbounded, though a seek between them
//! steps from the start's.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::view::StepCtx;
use super::{Bound, Key, Mode, OpError, Planted, Report, Run, Scheduler, Session, StepLog, Val};
use crate::registry::Sealed;
use crate::time::CHECKPOINT_EVERY;

/// The ring's budget where no stepping module declares one (Checkpoint ring: `budget`).
const RING_BUDGET: u64 = 16 << 20;

/// The stepping operators' carried state: what each array held after the last step, the time
/// the session last stepped to, and the checkpoint ring.
#[derive(Clone, Debug)]
pub(super) struct Steps {
    at: Option<i64>,
    values: BTreeMap<String, Val>,
    /// The frame the steps last ran in, so they run once a frame for every stepping operator.
    frame: u64,
    /// Each checkpoint by its flick: the stepping arrays as of that flick.
    checkpoints: BTreeMap<i64, BTreeMap<String, Val>>,
    /// The last checkpoint flick taken, so the next frame takes the ones after it.
    checkpointed: Option<i64>,
    /// The revision the steps ran on: its document's key and the keys of the tables they read.
    inputs: Vec<Key>,
    /// Each stepping node's error from its last step, which its node reports until a step of
    /// its own succeeds or the steps start again.
    failed: BTreeMap<usize, OpError>,
    /// `failed` as of each checkpoint, which a seek onto it restores with the arrays.
    failed_at: BTreeMap<i64, BTreeMap<usize, OpError>>,
    /// Each checkpoint's bytes, as the ring counts them against its budget, and their sum.
    bytes: BTreeMap<i64, u64>,
    total: u64,
    /// The ring's spacing: the input track's, doubled each time the ring passed its budget.
    spacing: i64,
    /// Whether the start's checkpoint and one more alone pass the budget, so the ring holds
    /// only those two from then until the steps start again.
    over_budget: bool,
}

impl Default for Steps {
    fn default() -> Steps {
        Steps {
            at: None,
            values: BTreeMap::new(),
            frame: 0,
            checkpoints: BTreeMap::new(),
            checkpointed: None,
            inputs: Vec::new(),
            failed: BTreeMap::new(),
            failed_at: BTreeMap::new(),
            bytes: BTreeMap::new(),
            total: 0,
            spacing: CHECKPOINT_EVERY,
            over_budget: false,
        }
    }
}

impl Steps {
    /// Takes the checkpoint at every multiple of the spacing in (checkpointed, upto] from the
    /// state as it stands: the steps at or before each such flick have all run.
    fn checkpoint_through(&mut self, upto: i64, budget: u64, planted: &Planted) {
        let mut c = match self.checkpointed {
            None => 0,
            Some(last) => (last.div_euclid(self.spacing) + 1) * self.spacing,
        };
        while c <= upto {
            self.take(c, budget, planted);
            self.checkpointed = Some(c);
            c = (c.div_euclid(self.spacing) + 1) * self.spacing;
        }
    }

    /// Takes the checkpoint at `c`, then keeps the ring within its budget: past it, every second
    /// checkpoint goes and the spacing doubles, until it fits or holds only two.
    fn take(&mut self, c: i64, budget: u64, planted: &Planted) {
        let bytes = checkpoint_bytes(&self.values, &self.failed);
        self.total = self.total - self.bytes.insert(c, bytes).unwrap_or(0) + bytes;
        self.checkpoints.insert(c, self.values.clone());
        self.failed_at.insert(c, self.failed.clone());
        if planted.ring_newest_only {
            self.keep(|t| t == c);
            return;
        }
        if self.over_budget {
            self.keep(|t| t == 0 || t == c);
            return;
        }
        while self.total > budget {
            if self.checkpoints.len() <= 2 {
                self.over_budget = true;
                self.keep(|t| t == 0 || t == c);
                return;
            }
            let spacing = self.spacing * 2;
            let drops_start = planted.ring_drops_start;
            self.keep(|t| t.rem_euclid(spacing) == 0 && !(drops_start && t == 0));
            self.spacing = spacing;
        }
    }

    /// Lets go of every checkpoint but those `held` keeps.
    fn keep(&mut self, held: impl Fn(i64) -> bool) {
        self.checkpoints.retain(|t, _| held(*t));
        self.failed_at.retain(|t, _| held(*t));
        self.bytes.retain(|t, _| held(*t));
        self.total = self.bytes.values().sum();
    }

    /// The checkpoint a seek to `to` restores: the last at or before `to`; planted, the nearest
    /// by distance, the earlier of two equally near, or, for a ring that let go of the start's,
    /// the earliest it holds when none is at or before `to`.
    fn restore_point(&self, to: i64, planted: &Planted) -> Option<i64> {
        if planted.ring_drops_start {
            let before = self.checkpoints.range(..=to).next_back();
            return before
                .or_else(|| self.checkpoints.iter().next())
                .map(|(c, _)| *c);
        }
        if !planted.checkpoint_nearest {
            let before = self.checkpoints.range(..=to).next_back().map(|(c, _)| *c);
            let after = self.checkpoints.range(to + 1..).next().map(|(c, _)| *c);
            return match (before, after) {
                (Some(b), Some(a)) if a - to < to - b => Some(a),
                (Some(b), _) => Some(b),
                (None, a) => a,
            };
        }
        self.checkpoints.range(..=to).next_back().map(|(c, _)| *c)
    }
}

/// The bytes the ring counts for a checkpoint: its state's (Checkpoint ring: `state: bytes`),
/// each stepping array's canonical bytes, a JSON value's by its tree in memory, and each failed
/// step's error by its path, at least one byte, so a ring of empty states is bounded too. A
/// value two checkpoints share counts in each; the maps that index them are the ring's.
fn checkpoint_bytes(values: &BTreeMap<String, Val>, failed: &BTreeMap<usize, OpError>) -> u64 {
    let values: u64 = (values.values())
        .map(|v| match v {
            Val::None => 0,
            Val::Json(j) => json_bytes(j),
            Val::Typed(_) => v.bytes().len() as u64,
        })
        .sum();
    let failed: u64 = failed.values().map(|e| e.path.len() as u64 + 1).sum();
    (values + failed).max(1)
}

/// A JSON value's bytes in memory: each node, each string's bytes and each member's key.
fn json_bytes(v: &Value) -> u64 {
    let node = std::mem::size_of::<Value>() as u64;
    node + match v {
        Value::String(s) => s.len() as u64,
        Value::Array(a) => a.iter().map(json_bytes).sum(),
        Value::Object(m) => (m.iter())
            .map(|(k, v)| k.len() as u64 + json_bytes(v))
            .sum(),
        _ => 0,
    }
}

/// The ring's budget for these stepping modules, whose arrays it holds: what each declares for
/// its `checkpoint` carried state, or 16 MiB for one that declares none.
fn ring_budget<'a>(sealed: &Sealed, modules: impl Iterator<Item = &'a str>) -> u64 {
    let modules: BTreeSet<&str> = modules.collect();
    (sealed.modules.iter())
        .filter(|m| modules.contains(m.name.as_str()))
        .map(|m| {
            let declared = (m.shapes.carried.iter())
                .filter(|c| c.kind == "checkpoint")
                .map(|c| c.bytes)
                .fold(0, u64::saturating_add);
            if declared == 0 {
                RING_BUDGET
            } else {
                declared
            }
        })
        .fold(0, u64::saturating_add)
}

/// One row of the core's carried-state list as a session holds it now (Carried state; #169):
/// the canvas module that declared it, the row's kind and key, and the hash of what it carries.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CarriedState {
    pub module: String,
    pub kind: String,
    pub key: String,
    pub hash: String,
}

impl Session {
    /// The scheduler's checkpoint ring as this session holds it after its last frame (#2693):
    /// its budget, its spacing in flicks, its bytes, whether it is over budget (holding only the
    /// start's checkpoint and the newest), and each checkpoint it holds by its flick and bytes.
    pub fn checkpoint_ring(&self, s: &Scheduler<'_>) -> Value {
        let modules: Vec<&str> = self.loaded.as_ref().map_or_else(Vec::new, |l| {
            // The stepping modules the steps run, as `run_steps` finds them.
            (l.groups.iter())
                .filter(|g| !g.nodes.is_empty())
                .map(|g| &s.sealed.ops[g.op])
                .filter(|o| o.op.step.is_some())
                .map(|o| o.module.as_str())
                .collect()
        });
        let held: Vec<Value> = (self.steps.bytes.iter())
            .map(|(t, b)| json!({"t": t, "bytes": b}))
            .collect();
        json!({
            "budget": ring_budget(s.sealed, modules.into_iter()),
            "spacing": self.steps.spacing,
            "bytes": self.steps.bytes.values().sum::<u64>(),
            "over_budget": self.steps.over_budget,
            "held": held,
        })
    }

    /// Every row of carried state the sealed modules declare, as this session holds it after
    /// its last frame, read through the core and never by module (#169): a `checkpoint` row
    /// hashes its module's stepping arrays as the last step left them, a `tail` row the tail
    /// under its key, and a `bake` row, which no session holds, nothing. Only values are hashed,
    /// never the time stepped to or the checkpoints taken, so two sessions that carry the same
    /// state hash equal whatever clock brought them there. Sorted by module, kind and key.
    pub fn carried(&self, s: &Scheduler<'_>) -> Vec<CarriedState> {
        let sealed: &Sealed = s.sealed;
        let mut out = Vec::new();
        for m in &sealed.modules {
            for c in &m.shapes.carried {
                let values: Vec<Val> = match c.kind.as_str() {
                    "checkpoint" => (sealed.ops.iter())
                        .filter(|o| o.module == m.name && o.op.step.is_some())
                        .flat_map(|o| &o.op.writes)
                        .map(|w| self.steps.values.get(w).cloned().unwrap_or(Val::None))
                        .collect(),
                    "tail" => vec![self.tails.get(&c.key).cloned().unwrap_or(Val::None)],
                    _ => Vec::new(),
                };
                out.push(CarriedState {
                    module: m.name.clone(),
                    kind: c.kind.clone(),
                    key: c.key.clone(),
                    hash: super::result_digest(self.hash, &values, None),
                });
            }
        }
        out.sort();
        out
    }

    /// Runs every step up to the frame's time once, then gives each stepping node its result.
    pub(super) fn visit_steps(
        &mut self,
        s: &mut Scheduler<'_>,
        g: usize,
        frame: u64,
        report: &mut Report,
    ) {
        if self.steps.frame != frame {
            self.steps.frame = frame;
            self.run_steps(s, report);
        }
        let sealed: &Sealed = s.sealed;
        let nodes = self.loaded.as_ref().expect("loaded").groups[g]
            .nodes
            .clone();
        for n in nodes {
            let key = self.key_of(s, n);
            let op = self.loaded.as_ref().expect("loaded").nodes[n].op;
            let out: Vec<Val> = sealed.ops[op]
                .op
                .writes
                .iter()
                .map(|w| self.steps.values.get(w).cloned().unwrap_or(Val::None))
                .collect();
            let node = &self.loaded.as_ref().expect("loaded").nodes[n];
            let run = if self.mode == Mode::Live && node.has_run && node.key == key {
                Run::Kept
            } else {
                Run::Ran
            };
            if run == Run::Ran {
                report.ran += 1;
            }
            let err = self.steps.failed.get(&n).cloned();
            self.settle(s, n, key, out, err, run, frame, report);
        }
    }

    /// Steps every stepping operator from where the session last stepped to the frame's time.
    fn run_steps(&mut self, s: &mut Scheduler<'_>, report: &mut Report) {
        let sealed: &Sealed = s.sealed;
        let to = self.t;
        // The stepping nodes in the plan's order, which is the order at one time.
        let mut steppers: Vec<(usize, i64, String)> = Vec::new();
        if let Some(l) = &self.loaded {
            for g in &l.groups {
                let sop = &sealed.ops[g.op];
                if let (Some(step), Some(&n)) = (sop.op.step, g.nodes.first()) {
                    // A step the document sets (#497), which the check holds to whole flicks.
                    let step = sop
                        .op
                        .rate
                        .and_then(|rate| rate(&l.doc))
                        .filter(|s| *s > 0)
                        .unwrap_or(step);
                    steppers.push((n, step, sop.module.clone()));
                }
            }
        }
        if steppers.is_empty() {
            return;
        }
        let budget = ring_budget(sealed, steppers.iter().map(|(_, _, m)| m.as_str()));
        let planted = s.options.planted.clone();
        if s.options.planted.steps_by_name {
            steppers.sort_by(|a, b| a.2.cmp(&b.2));
        }
        // Checkpoints are kept where a stepping module declares them (Carried state).
        let checkpoints = steppers.iter().any(|(_, _, module)| {
            sealed
                .modules
                .iter()
                .find(|m| &m.name == module)
                .is_some_and(|m| m.shapes.carried.iter().any(|c| c.kind == "checkpoint"))
        });
        // The revision the steps run on: its document and each table a stepper reads. Never a
        // view or another array, which change from frame to frame without a new revision.
        let mut inputs: Vec<Key> = Vec::new();
        if let Some(l) = &self.loaded {
            inputs.push(l.doc_key);
            for (n, _, _) in &steppers {
                self.tables_of(s, *n);
                for b in &l.nodes[*n].reads {
                    if let Bound::Table(name) = b {
                        inputs.push(s.tables.get(name).map(|(_, k)| *k).unwrap_or_default());
                    }
                }
            }
        }
        if self.mode == Mode::Clean || self.steps.inputs != inputs {
            // A clean evaluation steps from the start, and so does a revision whose steps read
            // something else (design: Saves; anything not carried on restarts at step 0). The
            // frame stays, since it is the guard that runs the steps once a frame for every
            // stepping operator.
            self.steps = Steps {
                frame: self.steps.frame,
                inputs,
                ..Steps::default()
            };
        } else if self.steps.at.is_some_and(|at| at > to) {
            // A seek: restore the checkpoint and step forward from it, or start again.
            match (self.steps.restore_point(to, &planted)).filter(|_| checkpoints) {
                Some(c) => {
                    self.steps.failed = self.steps.failed_at[&c].clone();
                    self.steps.values = self.steps.checkpoints[&c].clone();
                    self.steps.at = Some(c);
                    self.steps.checkpointed = Some(c);
                }
                None => {
                    self.steps = Steps {
                        frame: self.steps.frame,
                        inputs: std::mem::take(&mut self.steps.inputs),
                        ..Steps::default()
                    };
                }
            }
        }
        let mut from = self.steps.at;
        loop {
            // The next time any stepper steps.
            let next = steppers
                .iter()
                .map(|(_, step, _)| match from {
                    None => 0,
                    Some(f) => (f.div_euclid(*step) + 1) * step,
                })
                .min();
            let Some(time) = next.filter(|t| *t <= to) else {
                break;
            };
            if checkpoints {
                self.steps.checkpoint_through(time - 1, budget, &planted);
            }
            let earlier = self.steps.values.clone();
            for (n, step, module) in &steppers {
                if time % step != 0 {
                    continue;
                }
                let ctx = StepCtx {
                    time,
                    current: &self.steps.values,
                    earlier: &earlier,
                };
                let (out, err, noted, tails) = self.call(s, *n, Some(ctx), report);
                if let Some(e) = err {
                    self.steps.failed.insert(*n, e);
                    continue;
                }
                self.steps.failed.remove(n);
                self.tails.extend(tails);
                let op = self.loaded.as_ref().expect("loaded").nodes[*n].op;
                for (w, v) in sealed.ops[op].op.writes.iter().zip(out) {
                    self.steps.values.insert(w.clone(), v);
                }
                let (count, read) = noted.unwrap_or((0, 0));
                report.steps.push(StepLog {
                    module: module.clone(),
                    t: time,
                    count,
                    read,
                });
            }
            from = Some(time);
            if checkpoints {
                self.steps.checkpoint_through(time, budget, &planted);
            }
        }
        if checkpoints {
            self.steps.checkpoint_through(to, budget, &planted);
        }
        self.steps.at = from.or(self.steps.at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stepper that writes nothing still takes a checkpoint every spacing: each counts at
    /// least a byte, so an hour of them stays within the budget, start's kept (#2693).
    #[test]
    fn a_ring_of_empty_states_stays_within_its_budget() {
        let mut steps = Steps::default();
        steps.checkpoint_through(3_600 * 2 * CHECKPOINT_EVERY, 64, &Planted::default());
        let held = steps.checkpoints.len();
        assert!(
            held <= 64,
            "an hour of empty checkpoints holds {held} against a budget of 64 bytes"
        );
        assert!(
            steps.checkpoints.contains_key(&0),
            "the start's checkpoint is kept"
        );
        assert_eq!(
            steps.total, held as u64,
            "each empty checkpoint counts one byte"
        );
    }
}
