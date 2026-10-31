//! The compiled program's canonical bytes (issue #855): every field in declared order, enums by a
//! tag byte then their fields, so `motion.program`'s digest never reads Debug text.

use deep_canvas::schedule::Canonical;

use crate::curve::{Curve, Interp, Key};
use crate::doc::{
    Binding, Channel, Clip, Cut, Extend, Marker, Motion, Placement, Target, Transport, ValueType,
};
use crate::program::{Field, Program, Write};

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
        deep_canvas::schedule::Canonical::encode(&(&self.cuts, &self.frame_rate), out);
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
    }
}
