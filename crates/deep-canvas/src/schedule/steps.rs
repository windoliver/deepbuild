//! Simulate's steps (canvas primitives: Phase, simulate). Every stepping operator steps at every
//! multiple of its step length, in time order. At one time, a step whose values another reads
//! at its own step's time runs first: that order is the plan's, which the seal derived from the
//! at-time reads, and two that read each other at one time are a cycle the seal refused. Steps
//! that read nothing of each other's at one time keep the plan's tie order (canvas-module name,
//! or a shuffle), which no result depends on. A step reads another's array as earlier steps left
//! it through `earlier(…)`. What the steps write is carried state: a frame steps on from where
//! the last frame stopped, and a frame before it starts again from the timeline's start.

use std::collections::BTreeMap;

use super::view::StepCtx;
use super::{Mode, Report, Run, Scheduler, Session, StepLog, Val};
use crate::registry::Sealed;

/// The stepping operators' carried state: what each array held after the last step, and the
/// time the session last stepped to.
#[derive(Clone, Debug, Default)]
pub(super) struct Steps {
    at: Option<i64>,
    values: BTreeMap<String, Val>,
    /// The frame the steps last ran in, so they run once a frame for every stepping operator.
    frame: u64,
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
        if self.mode == Mode::Clean || self.steps.at.is_some_and(|at| at > to) {
            self.steps.at = None;
            self.steps.values.clear();
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
                let (out, err, noted) = self.call(s, *n, Some(ctx), report);
                if err.is_some() {
                    continue;
                }
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
        }
        self.steps.at = from.or(self.steps.at);
    }
}
