//! A document compiled once per revision into flat, typed arrays (canvas primitives: Array and
//! table; Operator and read set): every item's transform and every field a channel writes is a
//! run of `f64` slots, each channel and placement write resolves at compile time to a slot, and a
//! frame evaluates into a [`State`] the program sized up front. After the first frame, evaluating
//! allocates nothing: no map, string or vector is made per frame.

use serde_json::{Map, Value};

use crate::doc::{self, Motion, Refused, Target};
use crate::eval::{Local, Validity};

/// Slots each item's transform takes: pos, rot and scale, three each.
pub const TRANSFORM: usize = 9;

/// One item's evaluated transform (pos, rot and scale) and the fields a channel writes on it,
/// each with its path in the item.
pub type ItemValues = ([f64; TRANSFORM], Vec<(Vec<String>, Value)>);

/// A field outside the transform that a channel writes, with its run of slots.
#[derive(Clone, Debug, PartialEq)]
pub struct Field {
    /// The item, or `None` for a target naming no item, whose slots nothing reads.
    pub item: Option<usize>,
    pub path: Vec<String>,
    pub slot: usize,
    pub width: usize,
    /// A bool channel's field, written as `true` or `false`.
    pub boolean: bool,
}

/// A placement's write: one clip channel into one bound item's slots, after its target's delay.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Write {
    channel: usize,
    delay: i64,
    slot: usize,
    width: usize,
}

/// The compiled document.
#[derive(Clone, Debug, PartialEq)]
pub struct Program {
    pub motion: Motion,
    /// Item IDs in document order; item `i`'s transform is slots `9i..9i + 9`.
    pub items: Vec<String>,
    pub fields: Vec<Field>,
    base: Vec<f64>,
    /// Each document channel's slot and width, in channel order.
    channels: Vec<(usize, usize)>,
    /// Each channel's run in [`State::values`], and the runs' total length.
    values: Vec<usize>,
    values_len: usize,
    placements: Vec<Vec<Write>>,
    parents: Vec<(usize, usize)>,
}

/// What one evaluation fills, sized by [`Program::state`] and reused frame after frame.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub t: i64,
    pub doc_t: i64,
    pub pass: i64,
    pub slots: Vec<f64>,
    /// Each document channel's value, before it is stored in its target.
    pub values: Vec<f64>,
    pub iterations: Vec<u32>,
    pub locals: Vec<Option<Local>>,
    pub valid_until: Option<i64>,
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// The authored value at `path` inside `item`, `width` components wide.
fn authored(item: &Value, path: &[String], width: usize, out: &mut [f64]) {
    let mut at = Some(item);
    for name in path {
        at = at.and_then(|v| match v {
            Value::Array(list) => name.parse::<usize>().ok().and_then(|i| list.get(i)),
            other => other.get(name),
        });
    }
    match at {
        Some(Value::Array(list)) => {
            for (o, v) in out.iter_mut().zip(list).take(width) {
                *o = number(Some(v)).unwrap_or(0.0);
            }
        }
        Some(Value::Bool(b)) => out[0] = if *b { 1.0 } else { 0.0 },
        v => {
            if let Some(n) = number(v) {
                out[0] = n;
            }
        }
    }
}

impl Program {
    /// Compiles `doc`: reads its motion, then gives every target its slots.
    pub fn compile(doc: &Value) -> Result<Program, Refused> {
        let motion = doc::read(doc)?;
        let empty = Map::new();
        let items_json = doc
            .get("items")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let items: Vec<String> = items_json.keys().cloned().collect();
        let mut base = vec![0.0; items.len() * TRANSFORM];
        for (i, id) in items.iter().enumerate() {
            for (k, (name, fill)) in [("pos", 0.0), ("rot", 0.0), ("scale", 1.0)]
                .iter()
                .enumerate()
            {
                let run = &mut base[i * TRANSFORM + 3 * k..i * TRANSFORM + 3 * k + 3];
                run.fill(*fill);
                authored(&items_json[id], &["at".into(), (*name).into()], 3, run);
            }
        }
        let mut program = Program {
            items,
            fields: Vec::new(),
            base,
            channels: Vec::new(),
            values: Vec::new(),
            values_len: 0,
            placements: Vec::new(),
            parents: Vec::new(),
            motion: motion.clone(),
        };
        let mut values = 0;
        for channel in &motion.channels {
            let width = channel.curve.keys.first().map_or(1, |k| k.value.len());
            let slot = program.slot(items_json, &channel.target.owner, &channel.target, width);
            program.mark_bool(slot, channel.ty);
            program.channels.push((slot, width));
            program.values.push(values);
            values += width;
        }
        program.values_len = values;
        for placement in &motion.placements {
            let mut writes = Vec::new();
            if let Some(clip) = motion.clip(&placement.clip) {
                for binding in &placement.bindings {
                    for (c, channel) in clip.channels.iter().enumerate() {
                        if channel.target.owner != binding.slot {
                            continue;
                        }
                        let width = channel.curve.keys.first().map_or(1, |k| k.value.len());
                        let slot = program.slot(items_json, &binding.item, &channel.target, width);
                        program.mark_bool(slot, channel.ty);
                        writes.push(Write {
                            channel: c,
                            delay: binding.delay,
                            slot,
                            width,
                        });
                    }
                }
            }
            program.placements.push(writes);
        }
        let index = |id: &str| program.items.iter().position(|i| i == id);
        program.parents = motion
            .parents
            .iter()
            .filter_map(|(child, parent)| Some((index(child)?, index(parent)?)))
            .collect();
        Ok(program)
    }

    /// Marks the field at `slot` as a bool channel's, so it is written as a bool.
    fn mark_bool(&mut self, slot: usize, ty: doc::ValueType) {
        if ty == doc::ValueType::Bool {
            if let Some(f) = self.fields.iter_mut().find(|f| f.slot == slot) {
                f.boolean = true;
            }
        }
    }

    /// The slots a target names in `owner`: its transform's, or a field's of its own, made once.
    /// A target in an item the document lacks writes to a slot no item reads.
    fn slot(
        &mut self,
        items: &Map<String, Value>,
        owner: &str,
        target: &Target,
        width: usize,
    ) -> usize {
        let item = self.items.iter().position(|i| i == owner);
        if let (Some(i), [at, name, k]) = (item, target.field.as_slice()) {
            let group = ["pos", "rot", "scale"].iter().position(|n| n == name);
            if let (true, Some(g), Ok(k)) = (at == "at", group, k.parse::<usize>()) {
                if k < 3 && width == 1 {
                    return i * TRANSFORM + 3 * g + k;
                }
            }
        }
        if let Some(f) = self
            .fields
            .iter()
            .find(|f| f.item == item && f.path == target.field)
        {
            return f.slot;
        }
        let slot = self.base.len();
        self.base.resize(slot + width, 0.0);
        if let Some(id) = item.map(|i| &self.items[i]) {
            authored(
                &items[id],
                &target.field,
                width,
                &mut self.base[slot..slot + width],
            );
        }
        self.fields.push(Field {
            item,
            path: target.field.clone(),
            slot,
            width,
            boolean: false,
        });
        slot
    }

    /// A state sized for this program, the one allocation a session makes for its frames.
    pub fn state(&self) -> State {
        State {
            t: 0,
            doc_t: 0,
            pass: 0,
            slots: self.base.clone(),
            values: vec![0.0; self.values_len],
            iterations: vec![0; self.channels.len()],
            locals: vec![None; self.motion.placements.len()],
            valid_until: None,
        }
    }

    /// Evaluates the document at `t` into `state`, allocating nothing.
    pub fn evaluate(&self, t: i64, validity: Validity, state: &mut State) {
        self.evaluate_local(t, validity, state);
        for &(child, parent) in &self.parents {
            parent_to(&mut state.slots, child, parent);
        }
    }

    /// [`Program::evaluate`] without child-of parenting: each item's own transform, as the
    /// scheduler's motion operator writes it and the core composes it with its parent's.
    pub fn evaluate_local(&self, t: i64, validity: Validity, state: &mut State) {
        let motion = &self.motion;
        let (doc_t, pass) = crate::eval::position(motion, t);
        state.t = t;
        state.doc_t = doc_t;
        state.pass = pass;
        state.slots.copy_from_slice(&self.base);
        for (c, channel) in motion.channels.iter().enumerate() {
            let (slot, width) = self.channels[c];
            let run = &mut state.values[self.values[c]..self.values[c] + width];
            state.iterations[c] = channel.curve.sample_into(doc_t, run);
            state.slots[slot..slot + width].copy_from_slice(run);
        }
        let mut scratch = [0.0; 3];
        for (p, placement) in motion.placements.iter().enumerate() {
            state.locals[p] = placement.local(motion, doc_t);
            let Some(clip) = motion.clip(&placement.clip) else {
                continue;
            };
            for w in &self.placements[p] {
                let Some(l) = placement.local_after(motion, doc_t, w.delay) else {
                    continue;
                };
                let run = &mut scratch[..w.width.min(3)];
                clip.channels[w.channel].curve.sample_into(l.local, run);
                state.slots[w.slot..w.slot + run.len()].copy_from_slice(run);
            }
        }
        state.valid_until = crate::eval::valid_until(motion, t, doc_t, validity);
    }

    /// The item `id`'s own transform (pos, rot and scale, three each) and every field a channel
    /// writes on it (its path in the item and its value), from an evaluated state.
    pub fn item_values(&self, state: &State, id: &str) -> Option<ItemValues> {
        let i = self.items.iter().position(|x| x == id)?;
        let mut transform = [0.0; TRANSFORM];
        transform.copy_from_slice(&state.slots[i * TRANSFORM..(i + 1) * TRANSFORM]);
        let fields = self
            .fields
            .iter()
            .filter(|f| f.item == Some(i))
            .map(|f| {
                let run = &state.slots[f.slot..f.slot + f.width];
                let value = match run {
                    [one] if f.boolean => Value::Bool(*one >= 0.5),
                    [one] => serde_json::json!(one),
                    many => serde_json::json!(many),
                };
                (f.path.clone(), value)
            })
            .collect();
        Some((transform, fields))
    }
}

/// Child-of parenting (canvas primitives: Constraint, R1 `child_of`): the child's transform,
/// scaled, then turned about z by the parent's and moved by its position, so the child rides its
/// parent. Rotation and scale compose, as the transform order says.
fn parent_to(slots: &mut [f64], child: usize, parent: usize) {
    let (p, c) = (parent * TRANSFORM, child * TRANSFORM);
    let mut pt = [0.0; TRANSFORM];
    pt.copy_from_slice(&slots[p..p + TRANSFORM]);
    let (p_pos, p_rot, p_scale) = (&pt[0..3], &pt[3..6], &pt[6..9]);
    let ch = &mut slots[c..c + TRANSFORM];
    let (x, y) = (ch[0] * p_scale[0], ch[1] * p_scale[1]);
    let (cos, sin) = if p_rot[2] == 0.0 {
        (1.0, 0.0)
    } else {
        let a = deep_canvas::ops::rad(p_rot[2]);
        (deep_canvas::ops::cos(a), deep_canvas::ops::sin(a))
    };
    ch[2] = p_pos[2] + ch[2] * p_scale[2];
    ch[0] = p_pos[0] + x * cos - y * sin;
    ch[1] = p_pos[1] + x * sin + y * cos;
    for k in 0..3 {
        ch[3 + k] += p_rot[k];
        ch[6 + k] *= p_scale[k];
    }
}
