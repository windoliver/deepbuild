//! The compiled program's canonical bytes (issue #855): every field in declared order, enums by a
//! tag byte then their fields, so `motion.program`'s digest never reads Debug text.

use deep_canvas::schedule::Canonical;

use crate::curve::{Curve, Ease, Interp, Key};
use crate::doc::{
    Binding, Channel, Clip, Control, Cut, Driver, Extend, Follow, Limit, Marker, Motion, Placement,
    Shot, Target, Transport, ValueType,
};
use crate::input::{Change, Inputs, Moves};
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
            Interp::Spring {
                freq_hz,
                damping_ratio,
            } => {
                out.push(3);
                (freq_hz, damping_ratio).encode(out);
            }
        }
    }
}

impl Canonical for Ease {
    fn encode(&self, out: &mut Vec<u8>) {
        match *self {
            Ease::Linear => out.push(0),
            Ease::InCubic => out.push(1),
            Ease::OutCubic => out.push(2),
            Ease::InOutCubic => out.push(3),
            Ease::Bezier(b) => {
                out.push(4);
                [b.x1, b.y1, b.x2, b.y2].encode(out);
            }
        }
    }
}
impl Canonical for Control {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.id, self.kind, &self.options, &self.default).encode(out);
        self.shots.encode(out);
    }
}
impl Canonical for Follow {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.id, &self.target, &self.control, &self.values).encode(out);
        (&self.span, &self.ease).encode(out);
    }
}
impl Canonical for Shot {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.id, &self.camera, &self.target, &self.glide).encode(out);
        self.ease.encode(out);
    }
}
impl Canonical for Change {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.t, &self.from, &self.to, &self.span).encode(out);
        self.ease.encode(out);
    }
}
impl Canonical for Moves {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.start, &self.changes).encode(out);
    }
}
impl Canonical for Inputs {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.follows, &self.cameras).encode(out);
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
            &(&self.id, &self.t, &self.value, &self.interp),
            out,
        );
    }
}
impl deep_canvas::schedule::Canonical for Curve {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&self.keys, out);
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
            &(&self.id, &self.target, &self.ty, &self.curve),
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
            &(&self.start, &self.span, &self.wrap, &self.holds),
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
            ),
            out,
        );
        deep_canvas::schedule::Canonical::encode(
            &(&self.follows, &self.controls, &self.shots, &self.cameras),
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
        deep_canvas::schedule::Canonical::encode(&(&self.follows, &self.inputs), out);
    }
}
