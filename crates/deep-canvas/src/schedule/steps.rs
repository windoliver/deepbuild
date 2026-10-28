//! Simulate's steps (canvas primitives: Phase, simulate). Every stepping operator steps at every
//! multiple of its step length, in time order. At one time, a step whose values another reads
//! at its own step's time runs first: that order is the plan's, which the seal derived from the
//! at-time reads, and two that read each other at one time are a cycle the seal refused. Steps
//! that read nothing of each other's at one time keep the plan's tie order (canvas-module name,
//! or a shuffle), which no result depends on. A step reads another's array as earlier steps left
//! it through `earlier(…)`. What the steps write is carried state: a frame steps on from where
//! the last frame stopped. A frame before it is a seek (issue #488; Carried state, Logic:
//! checkpoints and bake): where a stepping module declares `checkpoint` carried state the
//! session keeps a checkpoint of every stepping array at every multiple of the input track's
//! spacing, each holding the state as of its flick, and the seek restores the last one at or
//! before the frame's time and steps forward from it, so seeking equals playing; without
//! checkpoints it starts again from the timeline's start.

use std::collections::BTreeMap;

use super::view::StepCtx;
use super::{Mode, Report, Run, Scheduler, Session, StepLog, Val};
use crate::registry::Sealed;
use crate::time::CHECKPOINT_EVERY;

/// The stepping operators' carried state: what each array held after the last step, the time
/// the session last stepped to, and the checkpoints taken so far.
#[derive(Clone, Debug, Default)]
pub(super) struct Steps {
    at: Option<i64>,
    values: BTreeMap<String, Val>,
    /// The frame the steps last ran in, so they run once a frame for every stepping operator.
    frame: u64,
    /// Each checkpoint by its flick: the stepping arrays as of that flick.
    checkpoints: BTreeMap<i64, BTreeMap<String, Val>>,
    /// The last checkpoint flick taken, so the next frame takes the ones after it.
    checkpointed: Option<i64>,
}

impl Steps {
    /// Takes the checkpoint at every multiple of the spacing in (checkpointed, upto] from the
    /// state as it stands: the steps at or before each such flick have all run.
    fn checkpoint_through(&mut self, upto: i64) {
        let mut c = match self.checkpointed {
            None => 0,
            Some(last) => last + CHECKPOINT_EVERY,
        };
        while c <= upto {
            self.checkpoints.insert(c, self.values.clone());
            self.checkpointed = Some(c);
            c += CHECKPOINT_EVERY;
        }
    }

    /// The checkpoint a seek to `to` restores: the last at or before `to`; planted, the nearest
    /// by distance, the earlier of two equally near.
    fn restore_point(&self, to: i64, nearest: bool) -> Option<i64> {
        if nearest {
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

impl Session {
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
            self.settle(s, n, key, out, None, run, frame, report);
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
                    steppers.push((n, step, sop.module.clone()));
                }
            }
        }
        if steppers.is_empty() {
            return;
        }
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
        if self.mode == Mode::Clean {
            // A clean evaluation steps from the start; the frame stays, since it is the guard
            // that runs the steps once a frame for every stepping operator.
            self.steps = Steps {
                frame: self.steps.frame,
                ..Steps::default()
            };
        } else if self.steps.at.is_some_and(|at| at > to) {
            // A seek: restore the checkpoint and step forward from it, or start again.
            match self
                .steps
                .restore_point(to, s.options.planted.checkpoint_nearest)
                .filter(|_| checkpoints)
            {
                Some(c) => {
                    self.steps.values = self.steps.checkpoints[&c].clone();
                    self.steps.at = Some(c);
                    self.steps.checkpointed = Some(c);
                }
                None => {
                    self.steps.at = None;
                    self.steps.values.clear();
                    self.steps.checkpoints.clear();
                    self.steps.checkpointed = None;
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
                self.steps.checkpoint_through(time - 1);
            }
            let earlier = self.steps.values.clone();
            for (n, step, module) in &steppers {
                if time % step != 0 {
                    continue;
                }
                let current = self.steps.values.clone();
                let ctx = StepCtx {
                    time,
                    current: &current,
                    earlier: &earlier,
                };
                let (out, err, noted, tails) = self.call(s, *n, Some(ctx), report);
                if err.is_some() {
                    continue;
                }
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
                self.steps.checkpoint_through(time);
            }
        }
        if checkpoints {
            self.steps.checkpoint_through(to);
        }
        self.steps.at = from.or(self.steps.at);
    }
}
