//! One evaluation: the document at a flick (canvas primitives: One clock, pure evaluation). The
//! transport's loop gives the timeline's position, placements give their clips' local times, then
//! channels and placements write their items' fields; the frame's `valid_until` is the earliest
//! time anything it shows changes next.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use crate::curve::Sample;
use crate::doc::{Extend, Motion, Placement};
use crate::program::{Program, State, TRANSFORM};

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
    pub(crate) fn local_after(&self, motion: &Motion, p: i64, delay: i64) -> Option<Local> {
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
    /// Camera ID → its target at `t` (#417).
    pub cameras: Vec<(String, [f64; 3])>,
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

/// The item's `at` as an object, whatever the item wrote.
fn at_object(item: &mut Map<String, Value>) -> &mut Map<String, Value> {
    let at = item
        .entry("at")
        .or_insert_with(|| Value::Object(Map::new()));
    if !at.is_object() {
        *at = Value::Object(Map::new());
    }
    at.as_object_mut().expect("an object")
}

/// Writes `value` at `field` inside `item`, making objects and growing arrays on the way. A
/// step under `params/ops/<i>` reaches through the op's one key, its kind (Path `path@1`: ops),
/// so `ops/0/angle` writes the twist's angle.
fn write(item: &mut Value, field: &[String], value: Value) {
    let Some((last, rest)) = field.split_last() else {
        *item = value;
        return;
    };
    let mut at = item;
    for (depth, name) in rest.iter().enumerate() {
        if depth == 3 && rest[0] == "params" && rest[1] == "ops" {
            at = through_op(at);
        }
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
    if rest.len() == 3 && rest[0] == "params" && rest[1] == "ops" {
        at = through_op(at);
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

/// A path op's params: the value under its one key, made an object when it isn't one.
fn through_op(op: &mut Value) -> &mut Value {
    let one = matches!(op, Value::Object(map) if map.len() == 1);
    if !one {
        return op;
    }
    let Value::Object(map) = op else {
        unreachable!("checked above")
    };
    let inner = map.values_mut().next().expect("one key");
    if !inner.is_object() {
        *inner = Value::Object(Map::new());
    }
    inner
}

/// The frame's `valid_until`: the earliest `t` at which anything it shows changes next.
pub(crate) fn valid_until(motion: &Motion, t: i64, doc_t: i64, validity: Validity) -> Option<i64> {
    let channels = motion.channels.iter().filter_map(|c| {
        // A modified channel may change at every flick, and so may a remapped one, whose
        // child time runs other than the timeline.
        if c.modifiers.is_empty() && !motion.remapped(&c.target.owner) {
            c.curve.next_change(doc_t)
        } else {
            Some(doc_t + 1)
        }
    });
    let placements = motion
        .placements
        .iter()
        .filter(|_| validity == Validity::Full)
        .filter_map(|p| p.next_change(motion, doc_t));
    let next = channels.chain(placements).min();
    let tr = motion.transport;
    match tr.span {
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
    }
}

/// The evaluated items of `doc` from a program's state: each item as authored, with `at.pos`,
/// `at.rot` and `at.scale` as three numbers from its slots, and each field a channel writes.
pub fn items(doc: &Map<String, Value>, program: &Program, state: &State) -> Map<String, Value> {
    let items = match doc.get("items") {
        Some(Value::Object(items)) => items.clone(),
        _ => Map::new(),
    };
    evaluated(items, program, state)
}

/// [`items`] of only the items a field names, each as [`items`] gives it: every other evaluated
/// item is the document's own with `at` from its slots, which a reader can take from the state
/// without copying the item.
pub fn written(doc: &Map<String, Value>, program: &Program, state: &State) -> Map<String, Value> {
    let named: BTreeSet<&str> = program
        .fields
        .iter()
        .filter_map(|f| program.items.get(f.item?))
        .map(String::as_str)
        .chain(program.rows.iter().map(|r| r.item.as_str()))
        .collect();
    let items = match doc.get("items") {
        Some(Value::Object(items)) => items
            .iter()
            .filter(|(id, item)| named.contains(id.as_str()) || reads_data(item))
            .map(|(id, item)| (id.clone(), item.clone()))
            .collect(),
        _ => Map::new(),
    };
    evaluated(items, program, state)
}

/// `items` with each one's slots and fields written, as [`items`] evaluates them.
fn evaluated(
    mut items: Map<String, Value>,
    program: &Program,
    state: &State,
) -> Map<String, Value> {
    for (i, id) in program.items.iter().enumerate() {
        let Some(item) = items.get_mut(id).and_then(Value::as_object_mut) else {
            continue;
        };
        let slots = &state.slots[i * TRANSFORM..(i + 1) * TRANSFORM];
        let at = at_object(item);
        at.insert("pos".into(), json!(slots[0..3]));
        at.insert("rot".into(), json!(slots[3..6]));
        at.insert("scale".into(), json!(slots[6..9]));
    }
    for field in &program.fields {
        let Some(item) = field
            .item
            .and_then(|i| program.items.get(i))
            .and_then(|id| items.get_mut(id))
        else {
            continue;
        };
        let run = &state.slots[field.slot..field.slot + field.width];
        let value = match run {
            [one] if field.boolean => json!(*one >= 0.5),
            [one] if field.enumerated => json!(program.label(*one)),
            [one] => json!(one),
            many => json!(many),
        };
        write(item, &field.path, value);
    }
    for rows in &program.rows {
        if let Some(item) = items.get_mut(&rows.item) {
            rows.write(item, state.t);
        }
    }
    // A counter on a driver of a data value reads that value at t on the evaluated item, as a
    // template's keyed data value does (`params/data/<name>`).
    let data = || {
        let held = program.fields.iter();
        held.filter_map(|f| Some((f.data.as_ref()?, state.slots[f.slot])))
    };
    for item in items.values_mut().filter(|i| reads_data(i)) {
        for (name, value) in data() {
            write(item, &["params".into(), "data".into(), name.clone()], json!(value));
        }
    }
    items
}

/// Whether an item shows a counter, which may read a driver's data value.
fn reads_data(item: &Value) -> bool {
    item.pointer("/params/text/counter").is_some()
}

/// Evaluates `doc`, compiled as `program`, at `t`.
pub fn frame(doc: &Map<String, Value>, program: &Program, t: i64, validity: Validity) -> Frame {
    frame_with(doc, program, t, validity, &mut program.state())
}

/// [`frame`] into a state kept across a line's frames, which only the planted follow stepper
/// reads from; every real evaluation overwrites what it reads.
pub fn frame_with(
    doc: &Map<String, Value>,
    program: &Program,
    t: i64,
    validity: Validity,
    state: &mut State,
) -> Frame {
    program.evaluate(t, validity, state);
    let state = &*state;
    let motion = &program.motion;
    let mut at = 0;
    let mut channels: Vec<(String, Sample)> = motion
        .channels
        .iter()
        .zip(&state.iterations)
        .map(|(c, &iterations)| {
            let width = c.curve.keys.first().map_or(1, |k| k.value.len());
            let value = state.values[at..at + width].to_vec();
            at += width;
            (c.id.clone(), Sample { value, iterations })
        })
        .collect();
    // Follow channels report as keyed ones do, every channel in ID order.
    if !motion.follows.is_empty() {
        let follows = motion.follows.iter().enumerate().map(|(f, follow)| {
            let value = vec![state.values[program.values_len + f]];
            (
                follow.id.clone(),
                Sample {
                    value,
                    iterations: 0,
                },
            )
        });
        channels.extend(follows);
        channels.sort_by(|a, b| a.0.cmp(&b.0));
    }
    let cameras = motion
        .cameras
        .iter()
        .zip(&state.cameras)
        .map(|((id, _), target)| (id.clone(), *target))
        .collect();
    let placements = motion
        .placements
        .iter()
        .zip(&state.locals)
        .map(|(p, l)| (p.id.clone(), *l))
        .collect();
    Frame {
        t,
        doc_t: state.doc_t,
        pass: state.pass,
        items: items(doc, program, state),
        channels,
        placements,
        cameras,
        valid_until: state.valid_until,
    }
}
