//! A document compiled once per revision into flat, typed arrays (canvas primitives: Array and
//! table; Operator and read set): every item's transform and every field a channel writes is a
//! run of `f64` slots, each channel and placement write resolves at compile time to a slot, and a
//! frame evaluates into a [`State`] the program sized up front. After the first frame, evaluating
//! allocates nothing: no map, string or vector is made per frame.

use serde_json::{Map, Value};

use deep_canvas::schedule::core_ops::Datum;

use crate::doc::{self, Motion, Refused, Target};
use crate::eval::{Local, Validity};

/// Slots each item's transform takes: pos, rot and scale, three each.
pub const TRANSFORM: usize = 9;

/// One item's evaluated transform (pos, rot and scale) and the fields a channel writes on it,
/// each with its path in the item.
pub type ItemValues = ([f64; TRANSFORM], Vec<(Vec<String>, Datum)>);

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
    /// Something writes it; a field only a driver reads is never written back.
    pub written: bool,
}

/// One step of a driver's compiled expression, over the program's slots.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Num(f64),
    Var(usize),
    Neg,
    /// `+ - * / %` as its byte.
    Bin(u8),
    /// A function of the closed list (`min max floor ceil round abs` as 0 to 5), with its
    /// argument count.
    Call(u8, usize),
}

/// A driver's ops at most (Driver: "≤ 64 ops"), and so its stack's depth.
pub const DRIVER_OPS: usize = 64;

/// What a traced evaluation saw write one slot: the document entry, its value after the write,
/// and each document path it read on the way, nearest first, with its value.
#[derive(Clone, Debug, PartialEq)]
pub struct Traced {
    pub entry: String,
    /// Motion's operator that ran it.
    pub operator: &'static str,
    pub value: f64,
    pub limit: bool,
    pub reads: Vec<(String, f64)>,
}

/// One write the evaluation made, as [`Program::run`] reports it to a tracer.
enum Event {
    Channel(usize),
    /// A placement's write, with the slots it wrote.
    Placement(usize, std::ops::Range<usize>),
    Driver(usize),
    Limit(usize, usize),
}

/// A placement's write: one clip channel into one bound item's slots, after its target's delay.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Write {
    pub(crate) channel: usize,
    pub(crate) delay: i64,
    pub(crate) slot: usize,
    pub(crate) width: usize,
}

/// The compiled document.
#[derive(Clone, Debug, PartialEq)]
pub struct Program {
    pub motion: Motion,
    /// Item IDs in document order; item `i`'s transform is slots `9i..9i + 9`.
    pub items: Vec<String>,
    pub fields: Vec<Field>,
    pub(crate) base: Vec<f64>,
    /// Each document channel's slot and width, in channel order.
    pub(crate) channels: Vec<(usize, usize)>,
    /// Each channel's run in [`State::values`], and the runs' total length.
    pub(crate) values: Vec<usize>,
    pub(crate) values_len: usize,
    pub(crate) placements: Vec<Vec<Write>>,
    pub(crate) parents: Vec<(usize, usize)>,
    /// Each driver's target slot and compiled expression, in driver order.
    pub(crate) drivers: Vec<(usize, Vec<Op>)>,
    /// Each limit's first slot (its transform group's) and per-axis bounds, in constraint order.
    pub(crate) limits: Vec<(usize, doc::Bounds)>,
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
    pub fn compile(doc: &Map<String, Value>) -> Result<Program, Refused> {
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
            drivers: Vec::new(),
            limits: Vec::new(),
            motion: motion.clone(),
        };
        let mut values = 0;
        for channel in &motion.channels {
            let width = channel.curve.keys.first().map_or(1, |k| k.value.len());
            let slot = program.slot(items_json, &channel.target.owner, &channel.target, width);
            program.mark_bool(slot, channel.ty);
            program.mark_written(slot);
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
                        program.mark_written(slot);
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
        for (d, driver) in motion.drivers.iter().enumerate() {
            let path = format!("drivers/{}", driver.id);
            let mut vars = Vec::new();
            for (name, target) in &driver.vars {
                let slot = program.slot(items_json, &target.owner, target, 1);
                vars.push((name.as_str(), slot));
            }
            let slot = program.slot(items_json, &driver.target.owner, &driver.target, 1);
            program.mark_written(slot);
            let ops = compile_ops(&driver.expr, &vars).ok_or_else(|| Refused {
                code: "bad_doc",
                path: format!("{path}/expr"),
            })?;
            debug_assert_eq!(program.drivers.len(), d);
            program.drivers.push((slot, ops));
        }
        for limit in &motion.limits {
            let Some(i) = program.items.iter().position(|x| *x == limit.owner) else {
                return Err(Refused {
                    code: "ref_unresolved",
                    path: format!("constraints/{}/owner", limit.id),
                });
            };
            let group = ["pos", "rot", "scale"]
                .iter()
                .position(|g| *g == limit.group)
                .unwrap_or(0);
            program
                .limits
                .push((i * TRANSFORM + 3 * group, limit.bounds));
        }
        let mut at = std::collections::BTreeMap::new();
        for (i, id) in program.items.iter().enumerate() {
            at.entry(id.as_str()).or_insert(i);
        }
        let index = |id: &str| at.get(id).copied();
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

    /// Marks the field at `slot` as one something writes.
    fn mark_written(&mut self, slot: usize) {
        if let Some(f) = self.fields.iter_mut().find(|f| f.slot == slot) {
            f.written = true;
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
            written: false,
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
        self.run(t, validity, state, |_, _, _| {});
    }

    /// [`Program::evaluate_local`], telling `note` of each write with the slots after it.
    fn run(
        &self,
        t: i64,
        validity: Validity,
        state: &mut State,
        mut note: impl FnMut(&Event, &[f64], &[f64]),
    ) {
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
            note(&Event::Channel(c), &[], &state.slots);
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
                note(
                    &Event::Placement(p, w.slot..w.slot + run.len()),
                    &[],
                    &state.slots,
                );
            }
        }
        // Drivers after the channels, then limits after both (Driver; Constraint).
        for (d, (slot, ops)) in self.drivers.iter().enumerate() {
            let value = evaluate_ops(ops, &state.slots);
            if value.is_finite() {
                let before = [state.slots[*slot]];
                state.slots[*slot] = value;
                note(&Event::Driver(d), &before, &state.slots);
            }
        }
        for (l, (first, bounds)) in self.limits.iter().enumerate() {
            for (k, b) in bounds.iter().enumerate() {
                let Some((lo, hi)) = b else { continue };
                let v = state.slots[first + k];
                let held = v.clamp(*lo, *hi);
                if held != v {
                    state.slots[first + k] = held;
                    note(&Event::Limit(l, k), &[v], &state.slots);
                }
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
            .filter(|f| f.item == Some(i) && f.written)
            .map(|f| {
                let run = &state.slots[f.slot..f.slot + f.width];
                let value = match run {
                    [one] if f.boolean => Datum::Bool(*one >= 0.5),
                    [one] => Datum::Num(*one),
                    many => Datum::Nums(many.to_vec()),
                };
                (f.path.clone(), value)
            })
            .collect();
        Some((transform, fields))
    }
}

impl Program {
    /// The slot the field `field` of item `owner` takes, if anything in the program reads or
    /// writes it: its transform's for `at/pos|rot|scale/k`, or a field's of its own.
    pub fn slot_of(&self, owner: &str, field: &[String]) -> Option<usize> {
        let i = self.items.iter().position(|x| x == owner)?;
        if let [at, name, k] = field {
            let group = ["pos", "rot", "scale"].iter().position(|n| n == name);
            if let (true, Some(g), Ok(k)) = (at == "at", group, k.parse::<usize>()) {
                return (k < 3).then_some(i * TRANSFORM + 3 * g + k);
            }
        }
        self.fields
            .iter()
            .find(|f| f.item == Some(i) && f.path == field)
            .map(|f| f.slot)
    }

    /// Every write motion makes to `slot` at `t`, in evaluation order: the document entry that
    /// made it, its value after it, and what it read (the why's writes, #411).
    pub fn trace(&self, t: i64, slot: usize) -> Vec<Traced> {
        let mut state = self.state();
        let mut out = Vec::new();
        let (doc_t, _) = crate::eval::position(&self.motion, t);
        self.run(t, Validity::Full, &mut state, |event, before, slots| {
            let traced = match event {
                Event::Channel(c)
                    if (self.channels[*c].0..self.channels[*c].0 + self.channels[*c].1)
                        .contains(&slot) =>
                {
                    let channel = &self.motion.channels[*c];
                    let path = format!("channels/{}", channel.id);
                    let owner = channel.curve.owner(doc_t).unwrap_or(0);
                    // The component of the key's value this slot takes; a number's is the value.
                    let (start, width) = self.channels[*c];
                    let i = slot - start;
                    let at = if width > 1 {
                        format!("/{i}")
                    } else {
                        String::new()
                    };
                    let mut reads = Vec::new();
                    for k in [Some(owner), channel.curve.next(doc_t)]
                        .into_iter()
                        .flatten()
                    {
                        let key = &channel.curve.keys[k];
                        let v = key.value.get(i).copied().unwrap_or(0.0);
                        reads.push((format!("{path}/keys/{}/value{at}", key.id), v));
                    }
                    let key = &channel.curve.keys[owner];
                    Traced {
                        entry: format!("{path}/keys/{}", key.id),
                        operator: "channels",
                        value: slots[slot],
                        limit: false,
                        reads,
                    }
                }
                Event::Placement(p, written) if written.contains(&slot) => Traced {
                    entry: format!("placements/{}", self.motion.placements[*p].id),
                    operator: "channels",
                    value: slots[slot],
                    limit: false,
                    reads: Vec::new(),
                },
                Event::Driver(d) if self.drivers[*d].0 == slot => {
                    let driver = &self.motion.drivers[*d];
                    let reads = driver
                        .vars
                        .iter()
                        .filter_map(|(_, target)| {
                            let s = self.slot_of(&target.owner, &target.field)?;
                            let path = format!("items/{}/{}", target.owner, target.field.join("/"));
                            Some((path, slots[s]))
                        })
                        .collect();
                    Traced {
                        entry: format!("drivers/{}", driver.id),
                        operator: "channels",
                        value: slots[slot],
                        limit: false,
                        reads,
                    }
                }
                Event::Limit(l, k) if self.limits[*l].0 + k == slot => {
                    let limit = &self.motion.limits[*l];
                    let (lo, hi) = limit.bounds[*k].unwrap_or_default();
                    let end = if before.first().is_some_and(|v| *v < lo) {
                        0
                    } else {
                        1
                    };
                    let path = format!("constraints/{}", limit.id);
                    Traced {
                        entry: path.clone(),
                        operator: "channels",
                        value: slots[slot],
                        limit: true,
                        reads: vec![(
                            format!("{path}/bounds/{k}/{end}"),
                            if end == 0 { lo } else { hi },
                        )],
                    }
                }
                _ => return,
            };
            out.push(traced);
        });
        out
    }
}

/// A driver's postfix steps as ops over slots: each name its var's slot. `None` past
/// [`DRIVER_OPS`] steps, for a function outside the closed list, or for a stack that doesn't
/// end with one value.
fn compile_ops(
    steps: &[deep_canvas::document::packs::ExprStep],
    vars: &[(&str, usize)],
) -> Option<Vec<Op>> {
    use deep_canvas::document::packs::ExprStep;
    if steps.len() > DRIVER_OPS {
        return None;
    }
    let mut depth: isize = 0;
    let mut ops = Vec::with_capacity(steps.len());
    for step in steps {
        let (op, delta) = match step {
            ExprStep::Num(n) => (Op::Num(*n), 1),
            ExprStep::Name(n) => (Op::Var(vars.iter().find(|(v, _)| v == n)?.1), 1),
            ExprStep::Neg => (Op::Neg, 0),
            ExprStep::Bin(c) => (Op::Bin(*c as u8), -1),
            ExprStep::Call(name, n) => {
                let f = ["min", "max", "floor", "ceil", "round", "abs"]
                    .iter()
                    .position(|x| x == name)?;
                let arity = if f < 2 { 2 } else { 1 };
                if *n != arity {
                    return None;
                }
                (Op::Call(f as u8, *n), 1 - *n as isize)
            }
        };
        depth += delta;
        if depth < 1 {
            return None;
        }
        ops.push(op);
    }
    (depth == 1).then_some(ops)
}

/// A driver's value over the slots, with a fixed stack and no allocation; NaN on `/` or `%` by 0.
fn evaluate_ops(ops: &[Op], slots: &[f64]) -> f64 {
    let mut stack = [0.0f64; DRIVER_OPS];
    let mut n = 0;
    for op in ops {
        match *op {
            Op::Num(v) => {
                stack[n] = v;
                n += 1;
            }
            Op::Var(s) => {
                stack[n] = slots[s];
                n += 1;
            }
            Op::Neg => stack[n - 1] = -stack[n - 1],
            Op::Bin(c) => {
                let (a, b) = (stack[n - 2], stack[n - 1]);
                n -= 1;
                stack[n - 1] = match c {
                    b'+' => a + b,
                    b'-' => a - b,
                    b'*' => a * b,
                    _ if b == 0.0 => f64::NAN,
                    b'/' => a / b,
                    _ => a % b,
                };
            }
            Op::Call(f, args) => {
                let a = stack[n - args];
                let v = match f {
                    0 => a.min(stack[n - 1]),
                    1 => a.max(stack[n - 1]),
                    2 => a.floor(),
                    3 => a.ceil(),
                    4 => a.round(),
                    _ => a.abs(),
                };
                n -= args;
                stack[n] = v;
                n += 1;
            }
        }
    }
    stack[0]
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
