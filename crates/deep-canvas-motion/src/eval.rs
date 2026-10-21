//! One evaluation: the document at a flick (canvas primitives: One clock, pure evaluation). The
//! transport's loop gives the timeline's position, placements give their clips' local times, then
//! channels and placements write their items' fields; the frame's `valid_until` is the earliest
//! time anything it shows changes next.

use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::curve::Sample;
use crate::doc::{Channel, Extend, Motion, Placement, Target};

/// Where a placement is at a timeline position: the pass the time falls in and the local time
/// within it, or nothing where it writes nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Local {
    pub iteration: u32,
    pub local: i64,
}

/// The timeline's position at `t` and the loop's pass.
pub fn position(motion: &Motion, t: i64) -> (i64, i64) {
    let tr = motion.transport;
    match tr.span {
        Some(span) if tr.wrap => {
            let d = t - tr.start;
            (tr.start + d.rem_euclid(span), d.div_euclid(span))
        }
        _ => (t, 0),
    }
}

impl Placement {
    fn span(&self, motion: &Motion) -> i64 {
        motion.clip(&self.clip).map_or(1, |c| c.span)
    }

    /// The stagger delay of the placement's first target, which its reported pass and local
    /// time follow.
    fn first_delay(&self) -> i64 {
        self.bindings.first().map_or(0, |b| b.delay)
    }

    /// The pass and local time of the first target at timeline position `p`.
    pub fn local(&self, motion: &Motion, p: i64) -> Option<Local> {
        self.local_after(motion, p, self.first_delay())
    }

    /// The pass and local time of a target `delay` after the start, at timeline position `p`:
    /// active on [start, end) with local time 0 at each wrap (right-continuous); before the start
    /// or from the end on, what `extend` holds.
    fn local_after(&self, motion: &Motion, p: i64, delay: i64) -> Option<Local> {
        let span = self.span(motion);
        let start = self.start + delay;
        if p < start {
            return (self.before == Extend::Hold).then_some(Local {
                iteration: 0,
                local: 0,
            });
        }
        if p >= start + i64::from(self.count) * span {
            return (self.after == Extend::Hold).then_some(Local {
                iteration: self.count - 1,
                local: span,
            });
        }
        let d = p - start;
        Some(Local {
            iteration: u32::try_from(d / span).unwrap_or(u32::MAX),
            local: d % span,
        })
    }

    /// The first target's wraps in (`from`, `to`]: each start of a pass after the first; the end
    /// of the final pass is not a wrap.
    pub fn wraps(&self, motion: &Motion, from: i64, to: i64) -> u32 {
        if to <= from {
            return 0;
        }
        let span = self.span(motion);
        let start = self.start + self.first_delay();
        // Wrap k sits at start + k × span, k in 1..count.
        let count_upto = |p: i64| -> i64 {
            if p < start + span {
                0
            } else {
                ((p - start) / span).min(i64::from(self.count) - 1)
            }
        };
        u32::try_from(count_upto(to) - count_upto(from)).unwrap_or(0)
    }

    /// The earliest timeline position after `p` at which what any of its targets shows may change.
    fn next_change(&self, motion: &Motion, p: i64) -> Option<i64> {
        let clip = motion.clip(&self.clip)?;
        self.bindings
            .iter()
            .map(|b| b.delay)
            .chain(self.bindings.is_empty().then_some(0))
            .filter_map(|delay| {
                let start = self.start + delay;
                if p < start {
                    return Some(start);
                }
                if p >= start + i64::from(self.count) * clip.span {
                    return None;
                }
                let local = self.local_after(motion, p, delay)?;
                let pass_start = start + i64::from(local.iteration) * clip.span;
                let inside = clip
                    .channels
                    .iter()
                    .filter_map(|c| c.curve.next_change(local.local))
                    .min()
                    .filter(|&l| l < clip.span)
                    .map(|l| pass_start + l);
                let boundary = pass_start + clip.span;
                Some(inside.map_or(boundary, |i| i.min(boundary)))
            })
            .min()
    }
}

/// One frame's evaluation.
pub struct Frame {
    pub t: i64,
    pub doc_t: i64,
    pub pass: i64,
    /// Item ID → its evaluated item, in document order.
    pub items: Map<String, Value>,
    /// Channel ID → its value at the timeline position.
    pub channels: Vec<(String, Sample)>,
    pub placements: Vec<(String, Option<Local>)>,
    /// The earliest `t` at which anything this frame shows changes next, or never.
    pub valid_until: Option<i64>,
}

/// Which parts of the document the frame's `valid_until` takes into account. The planted twin
/// leaves placements out (#391 AC5): reachable only through `deep-motion run`'s `planted` field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Validity {
    Full,
    IgnorePlacements,
}

fn number_value(sample: &Sample) -> Value {
    match sample.value.as_slice() {
        [one] => json!(one),
        many => json!(many),
    }
}

/// `at` with `pos`, `rot` and `scale` as three numbers each, whatever the item wrote.
fn normalize_at(item: &mut Map<String, Value>) {
    let at = item
        .entry("at")
        .or_insert_with(|| Value::Object(Map::new()));
    if !at.is_object() {
        *at = Value::Object(Map::new());
    }
    let at = at.as_object_mut().into_iter().next();
    if let Some(at) = at {
        for (name, fill) in [("pos", 0.0), ("rot", 0.0), ("scale", 1.0)] {
            let mut parts: Vec<Value> = match at.get(name) {
                Some(Value::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            parts.truncate(3);
            while parts.len() < 3 {
                parts.push(json!(fill));
            }
            at.insert(name.into(), Value::Array(parts));
        }
    }
}

/// Writes `value` at `field` inside `item`, making objects and growing arrays on the way.
fn write(item: &mut Value, field: &[String], value: Value) {
    let Some((last, rest)) = field.split_last() else {
        *item = value;
        return;
    };
    let mut at = item;
    for name in rest {
        at = match at {
            Value::Array(list) => match name.parse::<usize>() {
                Ok(i) => {
                    while list.len() <= i {
                        list.push(Value::Null);
                    }
                    &mut list[i]
                }
                Err(_) => return,
            },
            other => {
                if !other.is_object() {
                    *other = Value::Object(Map::new());
                }
                match other.as_object_mut() {
                    Some(map) => map.entry(name.clone()).or_insert(Value::Null),
                    None => return,
                }
            }
        };
    }
    match at {
        Value::Array(list) => {
            if let Ok(i) = last.parse::<usize>() {
                while list.len() <= i {
                    list.push(json!(0.0));
                }
                list[i] = value;
            }
        }
        other => {
            if !other.is_object() {
                *other = Value::Object(Map::new());
            }
            if let Some(map) = other.as_object_mut() {
                map.insert(last.clone(), value);
            }
        }
    }
}

fn apply(items: &mut Map<String, Value>, owner: &str, target: &Target, sample: &Sample) {
    if let Some(item) = items.get_mut(owner) {
        write(item, &target.field, number_value(sample));
    }
}

fn channel_write(items: &mut Map<String, Value>, channel: &Channel, sample: &Sample) {
    apply(items, &channel.target.owner, &channel.target, sample);
}

fn triple(item: &Value, name: &str) -> [f64; 3] {
    let mut out = [0.0; 3];
    if let Some(Value::Array(parts)) = item.get("at").and_then(|a| a.get(name)) {
        for (slot, part) in out.iter_mut().zip(parts) {
            *slot = part.as_f64().unwrap_or(0.0);
        }
    }
    out
}

/// Child-of parenting (canvas primitives: Constraint, R1 `child_of`): the child's evaluated
/// transform, scaled, then turned about z by the parent's and moved by its position, so the child
/// rides its parent. Rotation and scale compose, as the transform order says.
fn parent_to(items: &mut Map<String, Value>, child: &str, parent: &str) {
    let Some(p) = items.get(parent) else { return };
    let (p_pos, p_rot, p_scale) = (triple(p, "pos"), triple(p, "rot"), triple(p, "scale"));
    let Some(c) = items.get_mut(child) else {
        return;
    };
    let (c_pos, c_rot, c_scale) = (triple(c, "pos"), triple(c, "rot"), triple(c, "scale"));
    let (x, y) = (c_pos[0] * p_scale[0], c_pos[1] * p_scale[1]);
    let a = ops::rad(p_rot[2]);
    let (cos, sin) = if p_rot[2] == 0.0 {
        (1.0, 0.0)
    } else {
        (ops::cos(a), ops::sin(a))
    };
    let pos = [
        p_pos[0] + x * cos - y * sin,
        p_pos[1] + x * sin + y * cos,
        p_pos[2] + c_pos[2] * p_scale[2],
    ];
    let rot = [
        p_rot[0] + c_rot[0],
        p_rot[1] + c_rot[1],
        p_rot[2] + c_rot[2],
    ];
    let scale = [
        p_scale[0] * c_scale[0],
        p_scale[1] * c_scale[1],
        p_scale[2] * c_scale[2],
    ];
    if let Some(at) = c.get_mut("at").and_then(Value::as_object_mut) {
        at.insert("pos".into(), json!(pos));
        at.insert("rot".into(), json!(rot));
        at.insert("scale".into(), json!(scale));
    }
}

/// Evaluates `doc` (whose motion is `motion`) at `t`.
pub fn frame(doc: &Map<String, Value>, motion: &Motion, t: i64, validity: Validity) -> Frame {
    let (doc_t, pass) = position(motion, t);
    let mut items = match doc.get("items") {
        Some(Value::Object(items)) => items.clone(),
        _ => Map::new(),
    };
    for item in items.values_mut() {
        if let Some(map) = item.as_object_mut() {
            normalize_at(map);
        }
    }
    let mut channels = Vec::with_capacity(motion.channels.len());
    for channel in &motion.channels {
        let sample = channel.curve.sample(doc_t);
        channel_write(&mut items, channel, &sample);
        channels.push((channel.id.clone(), sample));
    }
    let mut placements = Vec::with_capacity(motion.placements.len());
    for placement in &motion.placements {
        if let Some(clip) = motion.clip(&placement.clip) {
            for binding in &placement.bindings {
                let Some(l) = placement.local_after(motion, doc_t, binding.delay) else {
                    continue;
                };
                for channel in clip
                    .channels
                    .iter()
                    .filter(|c| c.target.owner == binding.slot)
                {
                    let sample = channel.curve.sample(l.local);
                    apply(&mut items, &binding.item, &channel.target, &sample);
                }
            }
        }
        let local = placement.local(motion, doc_t);
        placements.push((placement.id.clone(), local));
    }

    for (child, parent) in &motion.parents {
        parent_to(&mut items, child, parent);
    }

    // The earliest change, in timeline positions, then back on the clock.
    let mut next: Option<i64> = None;
    let mut take = |c: Option<i64>| {
        if let Some(c) = c {
            next = Some(next.map_or(c, |n: i64| n.min(c)));
        }
    };
    for channel in &motion.channels {
        take(channel.curve.next_change(doc_t));
    }
    if validity == Validity::Full {
        for placement in &motion.placements {
            take(placement.next_change(motion, doc_t));
        }
    }
    let tr = motion.transport;
    let valid_until = match tr.span {
        Some(span) if tr.wrap => {
            let wrap_at = tr.start + span;
            // Anything that changes within the pass changes on the clock by the same offset; at
            // the wrap the timeline jumps back to its start, which changes whatever moved.
            let offset = t - doc_t;
            match next {
                Some(n) if n < wrap_at => Some(n + offset),
                Some(_) => Some(wrap_at + offset),
                None if motion.channels.is_empty() && motion.placements.is_empty() => None,
                None => Some(wrap_at + offset),
            }
        }
        _ => next,
    };
    Frame {
        t,
        doc_t,
        pass,
        items,
        channels,
        placements,
        valid_until,
    }
}
