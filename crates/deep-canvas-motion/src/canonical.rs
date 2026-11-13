//! The compiled program's canonical bytes (issue #855): every field in declared order, enums by a
//! tag byte then their fields, so `motion.program`'s digest never reads Debug text.

use deep_canvas::schedule::Canonical;

use crate::assembly::Assembly;
use crate::curve::{Curve, Ease, Interp, Key};
use crate::doc::{
    AddFrom, Along, Binding, Blending, Channel, Clip, Constraint, Control, Cut, Driver,
    DriverInput, Extend, Follow, Influence, Kind, Limit, Marker, Motion, Placement, Shot, Stagger,
    Target, Timing, Transport, ValueType,
};
use crate::follow;
use crate::input::{Change, Inputs, Moves, Staged};
use crate::modifier::{Kind as ModKind, Modifier, Rate, Shape};
use crate::program::{Field, Op, Program, Write};
use crate::remap::{Piece, Remap};

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
            Interp::Table => out.push(7),
            Interp::Quantize { n, jump } => {
                out.push(8);
                (u64::from(n), jump as u8).encode(out);
            }
        }
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
            ModKind::Wave {
                amplitude,
                rate: r,
                phase,
                offset,
            } => {
                (0u8, *amplitude, *phase, *offset).encode(out);
                rate(r, out);
            }
            ModKind::Noise {
                amplitude,
                rate: r,
                seed,
            } => {
                (1u8, *amplitude, *seed).encode(out);
                rate(r, out);
            }
            ModKind::Pulse {
                at,
                span,
                amount,
                shape,
                ease,
            } => {
                (2u8, *at, *span, *amount).encode(out);
                match *shape {
                    Shape::ThereAndBack => (0u8, 0.0).encode(out),
                    Shape::Pause(v) => (1u8, v).encode(out),
                    // #490: the wiggle turned at twice its intended frequency under tag 2; at its
                    // frequency now, it keys apart, so no cache serves the old frames.
                    Shape::Wiggle(v) => (3u8, v).encode(out),
                }
                ease.encode(out);
            }
            ModKind::Limits { min, max } => (3u8, *min, *max).encode(out),
            ModKind::Quantize { hz, jump } => (4u8, *hz, *jump as u8).encode(out),
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
        // #504: a stage without a shot as u64::MAX, so every stage with one keys as it did; the
        // same 8 bytes on every target, where a usize's MAX is narrower on wasm32 (#2144).
        self.shots
            .iter()
            .map(|s| s.map_or(u64::MAX, |s| s as u64))
            .collect::<Vec<u64>>()
            .encode(out);
    }
}
impl Canonical for Stagger {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.id, &self.spec, &self.targets).encode(out);
        (self.lag, self.reverse_on_close).encode(out);
    }
}
impl Canonical for Assembly {
    fn encode(&self, out: &mut Vec<u8>) {
        (
            &self.id,
            &self.parent,
            &self.at,
            (self.value, &self.apart, self.order, self.slot),
        )
            .encode(out);
        if let Some(j) = &self.joint {
            (j.kind as u8, j.axis, j.pivot, j.range.map(|r| [r.0, r.1])).encode(out);
        }
    }
}
impl Canonical for Staged {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.t, &self.shot, &self.span).encode(out);
        self.ease.encode(out);
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
        // #504's stage shots, only where a camera has one, so every earlier program keys as it did.
        if self.staged.iter().any(|s| !s.is_empty()) {
            self.staged.encode(out);
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
        // #494: a key's travel, only on a key that has one.
        if let Some(t) = &self.travel {
            format!("{:?}", t.travel).encode(out);
            (&t.dim, &t.subs).encode(out);
        }
        // A pack's ease table: its name and its knots, so another table keys another program.
        if let Some((name, table)) = &self.table {
            name.encode(out);
            if let Some(t) = table {
                (&t.table.x, &t.table.y).encode(out);
            }
        }
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
            &(
                &self.id,
                &self.target,
                &self.ty,
                &self.curve,
                &self.modifiers,
            ),
            out,
        );
        deep_canvas::schedule::Canonical::encode(&(&self.follow, &self.range), out);
        // #491's layout glide, only on a channel that has one.
        if let Some(glide) = &self.glide {
            glide.encode(out);
        }
        // #494: a path channel's structure and strictness.
        if let Some(p) = &self.path {
            p.strict.encode(out);
            for (n, closed) in &p.structure {
                (n, closed).encode(out);
            }
        }
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
        // #492's fields, only where a placement sets one, so every earlier placement keys as it
        // did.
        let (t, b) = (&self.timing, &self.blending);
        if *t != Timing::default() || *b != Blending::default() || self.rank != Default::default() {
            (t.trim, t.span, t.rate.0, t.rate.1).encode(out);
            (
                t.repeat as u8,
                t.hold_at,
                t.quantize.map(|q| (u64::from(q.0), u64::from(q.1))),
            )
                .encode(out);
            t.remap.map(|r| r as u64).encode(out);
            if let Some(s) = &t.start_on {
                (&s.on.list, &s.on.kinds, (&s.on.a, &s.on.b)).encode(out);
                (&s.on.tags, &s.on.where_, s.change, s.policy as u8).encode(out);
            }
            t.runs.encode(out);
            (b.blend as u8, b.fade_in, b.fade_out).encode(out);
            match &b.influence {
                Influence::Value(v) => (0u8, *v).encode(out),
                Influence::Keys(c) => (1u8, c).encode(out),
                Influence::Control(c) => (2u8, c).encode(out),
            }
            match b.add_from {
                AddFrom::First => (0u8, 0i64).encode(out),
                AddFrom::Bind => (1u8, 0i64).encode(out),
                AddFrom::At(t) => (2u8, t).encode(out),
            }
            self.rank.encode(out);
            if let Some(s) = &b.switch {
                (&s.control, s.case.to_string(), s.span).encode(out);
                (
                    s.first.to_string(),
                    s.changes
                        .iter()
                        .map(|c| (c.0, c.1.to_string()))
                        .collect::<Vec<_>>(),
                )
                    .encode(out);
                match s.along {
                    Along::Ease(e) => {
                        (0u8, s.sync).encode(out);
                        e.encode(out);
                    }
                    Along::Spring(spring) => (1u8, s.sync, spring.w0, spring.zeta).encode(out),
                }
            }
            if let Some(reach) = t.reach {
                (
                    reach,
                    t.closes.iter().map(|c| u8::from(*c)).collect::<Vec<_>>(),
                )
                    .encode(out);
            }
        }
    }
}
impl deep_canvas::schedule::Canonical for Remap {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.id, &self.target, self.clamp).encode(out);
        for s in &self.segs {
            (s.t, s.c, s.active.map(|a| (a.0, a.1))).encode(out);
            match &s.piece {
                Piece::Line(r) => (0u8, r.0, r.1).encode(out),
                Piece::Ramp {
                    from,
                    to,
                    over,
                    ease,
                } => {
                    (1u8, *from, *to, *over).encode(out);
                    ease.encode(out);
                }
                Piece::Map(c) => (2u8, c).encode(out),
            }
        }
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
        // #491's tags and payload, only where a marker has them, so every earlier marker keys as
        // it did.
        if !self.tags.is_empty() || !self.payload.is_null() {
            (&self.tags, self.payload.to_string()).encode(out);
        }
    }
}
impl deep_canvas::schedule::Canonical for Transport {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.start,
                &self.span,
                (&self.wrap, &self.ping_pong),
                &self.holds,
                &self.reduce_holds,
            ),
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
        // #490's driver inputs and hard range, only where a driver has them, so every earlier
        // driver keys as it did.
        if !self.inputs.is_empty() || self.range.is_some() {
            for (name, input) in &self.inputs {
                name.encode(out);
                match input {
                    DriverInput::Time => out.push(0),
                    DriverInput::Control(c) => (1u8, c).encode(out),
                    DriverInput::Rate(c) => (3u8, c).encode(out),
                    DriverInput::Remap(r, progress) => (4u8, r, *progress).encode(out),
                    DriverInput::Array(a) => (5u8, a).encode(out),
                    DriverInput::List(f) => {
                        (2u8, &f.list, &f.kinds, (&f.a, &f.b)).encode(out);
                        (&f.tags, &f.where_).encode(out);
                    }
                }
            }
            self.range.encode(out);
        }
        // #491's fallback, likewise only where a driver has one.
        if let Some(fallback) = self.fallback {
            fallback.encode(out);
        }
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
            Kind::FollowPath {
                points,
                fraction,
                orient,
                offset,
            } => (1u8, points, *fraction, *orient, offset).encode(out),
            Kind::LookAt { target } => (2u8, target).encode(out),
            Kind::Copy { what, target } => (3u8, *what as u8, target).encode(out),
            Kind::Reach2 {
                chain,
                target,
                bend,
                cartoon,
            } => (4u8, chain, target, *bend, *cartoon).encode(out),
            Kind::FollowTip {
                item,
                offset,
                rotate,
            } => (5u8, item, offset, *rotate).encode(out),
            Kind::Distance { target, min, max } => (6u8, target, *min, *max).encode(out),
            Kind::SpringChain {
                bones,
                hz,
                damping_ratio,
                max_swing,
            } => (7u8, bones, (*hz, *damping_ratio, *max_swing)).encode(out),
            Kind::RestOn {
                ground,
                bottom,
                offset,
                max_drop,
                on,
            } => {
                (8u8, (*ground, *bottom), (*offset, *max_drop)).encode(out);
                // A rest on the ground plane keeps the key it had before `on` landed (#2013).
                if let Some(r) = on {
                    (&r.on, r.axis, r.align, r.bounds).encode(out);
                }
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
                (&self.constraints, &self.control_defaults),
            ),
            out,
        );
        deep_canvas::schedule::Canonical::encode(
            &(&self.follows, &self.controls, &self.shots, &self.cameras),
            out,
        );
        // A document without time remaps keeps the key it had before they landed (#429).
        if !self.remaps.is_empty() {
            deep_canvas::schedule::Canonical::encode(&self.remaps, out);
        }
        for (id, inputs) in &self.worlds {
            (id, *inputs).encode(out);
        }
        // #504's take-aparts, only where a document has one.
        if !self.staggers.is_empty() {
            self.staggers.encode(out);
        }
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
        // #494: a path field's structure, only on a path field.
        for (n, closed) in self.shape.iter().flatten() {
            (n, closed).encode(out);
        }
        // Only a keyed data value holds one, so every other field keeps its key.
        if let Some(name) = &self.data {
            name.encode(out);
        }
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
            Op::Core(c) => {
                out.push(6);
                c.encode(out);
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
        // #504's assemblies and their parts, only where a document has them.
        if !self.assemblies.is_empty() {
            (&self.assemblies, &self.members).encode(out);
        }
    }
}
