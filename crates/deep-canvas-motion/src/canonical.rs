//! The compiled program's canonical bytes (issue #855): every field in declared order, enums by a
//! tag byte then their fields, so `motion.program`'s digest never reads Debug text.

use deep_canvas::schedule::Canonical;

use crate::curve::{Curve, Interp, Key};
use crate::ease::Ease;
use crate::follow;
use crate::modifier::{Kind as ModKind, Modifier, Rate, Shape};
use crate::doc::{
    Binding, Channel, Clip, Constraint, Cut, Driver, Kind, Extend, Limit, Marker, Motion, Placement, Target,
    Transport, ValueType,
};
use crate::program::{Field, Op, Program, Write};

impl Canonical for Interp {
    fn encode(&self, out: &mut Vec<u8>) {
        match *self {
            Interp::Hold => out.push(0),
            Interp::Linear => out.push(1),
            Interp::Bezier { x1, y1, x2, y2 } => {
                out.push(2);
                [x1, y1, x2, y2].encode(out);
            }
            Interp::Spring(s) => {
                out.push(3);
                (s.w0, s.zeta).encode(out);
            }
            Interp::Ease(e) => {
                out.push(4);
                e.encode(out);
            }
            Interp::Auto { clamp, smoothness } => {
                out.push(5);
                (clamp, smoothness).encode(out);
            }
            Interp::CatmullRom => out.push(6),
        }
    }
}

impl Canonical for Ease {
    fn encode(&self, out: &mut Vec<u8>) {
        let (tag, param) = match *self {
            Ease::Penner(f, side) => (16 * f as u8 + side as u8, 0.0),
            Ease::Smoothstep => (200, 0.0),
            Ease::Smootherstep => (201, 0.0),
            Ease::Sigmoid(k) => (202, k),
            Ease::RushIn(k) => (203, k),
            Ease::RushOut(k) => (204, k),
            Ease::DoubleSigmoid(k) => (205, k),
            Ease::RunningStart(p) => (206, p),
            Ease::ExpDecay(t) => (207, t),
        };
        (tag, param).encode(out);
    }
}

impl Canonical for Modifier {
    fn encode(&self, out: &mut Vec<u8>) {
        let rate = |r: &Rate, out: &mut Vec<u8>| match *r {
            Rate::Hz(hz) => (0u8, hz).encode(out),
            Rate::PerLoop { n, span } => (1u8, u64::from(n), span).encode(out),
            Rate::Period(p) => (2u8, 0u64, p).encode(out),
        };
        self.influence.encode(out);
        match &self.kind {
            ModKind::Wave { amplitude, rate: r, phase, offset } => {
                (0u8, *amplitude, *phase, *offset).encode(out);
                rate(r, out);
            }
            ModKind::Noise { amplitude, rate: r, seed } => {
                (1u8, *amplitude, *seed).encode(out);
                rate(r, out);
            }
            ModKind::Pulse { at, span, amount, shape, ease } => {
                (2u8, *at, *span, *amount).encode(out);
                match *shape {
                    Shape::ThereAndBack => (0u8, 0.0).encode(out),
                    Shape::Pause(v) => (1u8, v).encode(out),
                    Shape::Wiggle(v) => (2u8, v).encode(out),
                }
                ease.encode(out);
            }
            ModKind::Limits { min, max } => (3u8, *min, *max).encode(out),
        }
    }
}

impl Canonical for follow::Spec {
    fn encode(&self, out: &mut Vec<u8>) {
        match &self.source {
            follow::Source::Keys(k) => (0u8, k).encode(out),
            follow::Source::Control(c) => (1u8, c).encode(out),
        }
        match self.model {
            follow::Model::FirstOrder { tau_up, tau_down } => (0u8, tau_up, tau_down).encode(out),
            follow::Model::Spring(s) => (1u8, s.w0, s.zeta).encode(out),
            follow::Model::RateLimit { max } => (2u8, max, 0.0).encode(out),
            follow::Model::Transition { span, along } => {
                (3u8, span, 0.0).encode(out);
                match along {
                    follow::Along::Linear => out.push(0),
                    follow::Along::Ease(e) => {
                        out.push(1);
                        e.encode(out);
                    }
                    follow::Along::Bezier(b) => {
                        out.push(2);
                        [b.x1, b.y1, b.x2, b.y2].encode(out);
                    }
                }
            }
        }
        (self.rate, self.integral).encode(out);
    }
}

impl Canonical for ValueType {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(*self as u8);
    }
}

impl Canonical for Extend {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(*self as u8);
    }
}

impl deep_canvas::schedule::Canonical for Key {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.id,
                &self.t,
                &self.value,
                &self.interp,
                &self.velocity,
                &self.slopes,
            ),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Curve {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.keys, self.before as u8, self.after as u8),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Target {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.owner, &self.field), out);
    }
}
impl deep_canvas::schedule::Canonical for Channel {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.id, &self.target, &self.ty, &self.curve, &self.modifiers),
            out,
        );
        deep_canvas::schedule::Canonical::encode(&(&self.follow, &self.range),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Clip {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.id, &self.span, &self.channels), out);
    }
}
impl deep_canvas::schedule::Canonical for Binding {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.slot, &self.item, &self.delay), out);
    }
}
impl deep_canvas::schedule::Canonical for Placement {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.id,
                &self.clip,
                &self.bindings,
                &self.start,
                &self.count,
                &self.before,
            ),
            out,
        );
        deep_canvas::schedule::Canonical::encode(&self.after, out);
    }
}
impl deep_canvas::schedule::Canonical for Cut {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.id, &self.from, &self.to, &self.at), out);
    }
}
impl deep_canvas::schedule::Canonical for Marker {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.id, &self.kind, &self.start, &self.end),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Transport {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.start, &self.span, &self.wrap, &self.holds, &self.reduce_holds),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Driver {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.id, &self.target, &self.text, &self.vars),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Limit {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.id, &self.owner, self.group, &self.bounds),
            out,
        );
    }
}
impl Canonical for Constraint {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.id, &self.owner, self.influence).encode(out);
        match &self.kind {
            Kind::ChildOf { parent } => (0u8, parent).encode(out),
            Kind::FollowPath { points, fraction, orient, offset } => {
                (1u8, points, *fraction, *orient, offset).encode(out)
            }
            Kind::LookAt { target } => (2u8, target).encode(out),
            Kind::Copy { what, target } => (3u8, *what as u8, target).encode(out),
            Kind::Reach2 { chain, target, bend, cartoon } => {
                (4u8, chain, target, *bend, *cartoon).encode(out)
            }
            Kind::FollowTip { item, offset, rotate } => (5u8, item, offset, *rotate).encode(out),
            Kind::Distance { target, min, max } => (6u8, target, *min, *max).encode(out),
            Kind::SpringChain { bones, hz, damping_ratio, max_swing } => {
                (7u8, bones, (*hz, *damping_ratio, *max_swing)).encode(out)
            }
            Kind::RestOn { ground, bottom, offset, max_drop } => {
                (8u8, (*ground, *bottom), (*offset, *max_drop)).encode(out)
            }
        }
    }
}
impl deep_canvas::schedule::Canonical for Motion {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.transport,
                &self.channels,
                &self.clips,
                &self.placements,
                &self.markers,
                &self.parents,
            ),
            out,
        );
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.cuts,
                &self.frame_rate,
                &self.drivers,
                &self.limits,
                &self.labels,
                (&self.constraints, &self.controls),
            ),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Field {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.item,
                &self.path,
                &self.slot,
                &self.width,
                &self.boolean,
            ),
            out,
        );
        self.written.encode(out);
        self.enumerated.encode(out);
    }
}
impl Canonical for Op {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Op::Num(n) => {
                out.push(0);
                n.encode(out);
            }
            Op::Var(slot) => {
                out.push(1);
                slot.encode(out);
            }
            Op::Neg => out.push(2),
            Op::Bin(op) => {
                out.push(3);
                op.encode(out);
            }
            Op::Call(f, n) => {
                out.push(4);
                f.encode(out);
                n.encode(out);
            }
            Op::World(i, k) => {
                out.push(5);
                (i, k).encode(out);
            }
        }
    }
}
impl deep_canvas::schedule::Canonical for Write {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.channel, &self.delay, &self.slot, &self.width),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Program {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.motion,
                &self.items,
                &self.fields,
                &self.base,
                &self.channels,
                &self.values,
            ),
            out,
        );
        deep_canvas::schedule::Canonical::encode(
            &(&self.values_len, &self.placements, &self.parents),
            out,
        );
        deep_canvas::schedule::Canonical::encode(&(&self.drivers, &self.limits), out);
    }
}
