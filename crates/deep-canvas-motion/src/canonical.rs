//! The compiled program's canonical bytes (issue #855): every field in declared order, enums by a
//! tag byte then their fields, so `motion.program`'s digest never reads Debug text.

use deep_canvas::canonical_fields;
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

canonical_fields!(Key {
    id,
    t,
    value,
    interp
});
canonical_fields!(Curve { keys });
canonical_fields!(Target { owner, field });
canonical_fields!(Channel {
    id,
    target,
    ty,
    curve
});
canonical_fields!(Clip { id, span, channels });
canonical_fields!(Binding { slot, item, delay });
canonical_fields!(Placement {
    id,
    clip,
    bindings,
    start,
    count,
    before,
    after
});
canonical_fields!(Cut { id, from, to, at });
canonical_fields!(Marker {
    id,
    kind,
    start,
    end
});
canonical_fields!(Transport {
    start,
    span,
    wrap,
    holds
});
canonical_fields!(Motion {
    transport,
    channels,
    clips,
    placements,
    markers,
    parents,
    cuts,
    frame_rate
});
canonical_fields!(Field {
    item,
    path,
    slot,
    width,
    boolean
});
canonical_fields!(Write {
    channel,
    delay,
    slot,
    width
});
canonical_fields!(Program {
    motion,
    items,
    fields,
    base,
    channels,
    values,
    values_len,
    placements,
    parents
});
