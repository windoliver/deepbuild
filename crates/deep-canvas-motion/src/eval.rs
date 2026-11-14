//! One evaluation: the document at a flick (canvas primitives: One clock, pure evaluation). The
//! transport's loop gives the timeline's position, placements give their clips' local times, then
//! channels and placements write their items' fields; the frame's `valid_until` is the earliest
//! time anything it shows changes next.

use std::collections::BTreeSet;

use deep_canvas::grammar::FLICKS_PER_SECOND;
use serde_json::{json, Map, Value};

use crate::curve::Sample;
use crate::doc::{Blending, Extend, Motion, Placement, Policy, Repeat, DOCUMENT};
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
        // #157: each odd pass plays the span backwards.
        Some(span) if tr.ping_pong => {
            let (d, pass) = (
                (t - tr.start).rem_euclid(span),
                (t - tr.start).div_euclid(span),
            );
            (tr.start + if pass % 2 == 0 { d } else { span - d }, pass)
        }
        _ => (t, 0),
    }
}

impl Placement {
    fn clip_span(&self, motion: &Motion) -> i64 {
        motion.clip(&self.clip).map_or(1, |c| c.span)
    }

    /// The flicks the clip's repeats run for in local time.
    fn total(&self, clip_span: i64) -> i64 {
        clip_span * i64::from(self.count)
    }

    /// How long it's active, given its clip's span: its own `span`, or what the local time left
    /// after `in` takes at its rate.
    pub fn active_for(&self, clip_span: i64) -> i64 {
        let t = &self.timing;
        t.span.unwrap_or_else(|| {
            let left = i128::from((self.total(clip_span) - t.trim).max(0));
            let (num, den) = (i128::from(t.rate.0), i128::from(t.rate.1));
            ((left * den + num - 1).div_euclid(num)) as i64
        })
    }

    pub fn active_span(&self, motion: &Motion) -> i64 {
        self.active_for(self.clip_span(motion))
    }

    /// Whether its time is the timeline's from its start, as a plain placement's is.
    fn plain(&self) -> bool {
        let t = &self.timing;
        t.trim == 0
            && t.rate == (1, 1)
            && t.span.is_none()
            && t.repeat == Repeat::Wrap
            && t.hold_at.is_none()
            && t.quantize.is_none()
            && t.remap.is_none()
            && t.start_on.is_none()
            && self.blending == Blending::default()
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

    /// The run in force at `p` for a target `delay` after the start, as that run's start with the
    /// target's delay in it: a run a close started turns the stagger around (`reverse_on_close`).
    pub(crate) fn run_start(&self, p: i64, delay: i64) -> Option<i64> {
        let t = &self.timing;
        if t.start_on.is_none() {
            return Some(self.start + delay);
        }
        let of = |i: usize| t.runs[i] + self.run_delay(i, delay);
        (0..t.runs.len()).rev().map(of).find(|start| *start <= p)
    }

    /// A target's delay in run `i`.
    fn run_delay(&self, i: usize, delay: i64) -> i64 {
        let t = &self.timing;
        match t.reach {
            Some(reach) if t.closes.get(i) == Some(&true) => reach - delay,
            _ => delay,
        }
    }

    /// With `policy: overlap`, the starts of every run still going at `p`, oldest first, each a
    /// write of its own; none for any other placement.
    pub(crate) fn overlapping<'a>(
        &'a self,
        motion: &Motion,
        p: i64,
        delay: i64,
    ) -> impl Iterator<Item = i64> + 'a {
        let t = &self.timing;
        let overlaps = t
            .start_on
            .as_ref()
            .is_some_and(|s| s.policy == Policy::Overlap);
        let active = self.active_span(motion);
        (0..if overlaps { t.runs.len() } else { 0 })
            .map(move |i| t.runs[i] + self.run_delay(i, delay))
            .filter(move |start| *start <= p && p < start + active)
    }

    /// Local time at `p` in the run that starts at `start`.
    pub(crate) fn local_in_run(&self, motion: &Motion, p: i64, start: i64) -> Local {
        self.at_offset(motion, self.clip_span(motion), p - start)
    }

    /// Local time `d` flicks into the run: `in`, then the rate, floored, then a remap, then
    /// repeat, hold and quantize, in that order (Placement).
    fn at_offset(&self, motion: &Motion, clip_span: i64, d: i64) -> Local {
        let t = &self.timing;
        let parent = t.trim + floor_rate(d, t.rate);
        let child = match t.remap {
            Some(r) if motion.remaps[r].clamp => motion.remaps[r].child(parent).max(0),
            Some(r) => motion.remaps[r].child(parent),
            None => parent,
        };
        let last = i64::from(self.count) - 1;
        let (iteration, local) = if child >= self.total(clip_span) {
            let at_start = t.repeat == Repeat::PingPong && self.count.is_multiple_of(2);
            (last, if at_start { 0 } else { clip_span })
        } else {
            let (k, into) = (child.div_euclid(clip_span), child.rem_euclid(clip_span));
            let back = t.repeat == Repeat::PingPong && k % 2 == 1;
            (k, if back { clip_span - into } else { into })
        };
        let held = t.hold_at.map_or(local, |h| local.min(h));
        let local = t.quantize.map_or(held, |rate| grid(held, rate));
        Local {
            iteration: u32::try_from(iteration).unwrap_or(u32::MAX),
            local,
        }
    }

    /// The pass and local time of a target `delay` after the start, at timeline position `p`:
    /// active on [start, end) with local time 0 at each wrap (right-continuous); before the start
    /// or from the end on, what `extend` holds.
    pub(crate) fn local_after(&self, motion: &Motion, p: i64, delay: i64) -> Option<Local> {
        let clip_span = self.clip_span(motion);
        let active = self.active_for(clip_span);
        let Some(start) = self.run_start(p, delay) else {
            return (self.before == Extend::Hold).then(|| self.at_offset(motion, clip_span, 0));
        };
        if p < start {
            return (self.before == Extend::Hold).then(|| self.at_offset(motion, clip_span, 0));
        }
        if p >= start + active {
            return (self.after == Extend::Hold).then(|| self.at_offset(motion, clip_span, active));
        }
        Some(self.at_offset(motion, clip_span, p - start))
    }

    /// The first target's local time at `p` before any remap: what its remap reads as parent time.
    pub fn parent_time(&self, motion: &Motion, p: i64) -> i64 {
        let start = self.run_start(p, self.first_delay()).unwrap_or(self.start);
        let d = (p - start).clamp(0, self.active_span(motion));
        self.timing.trim + floor_rate(d, self.timing.rate)
    }

    /// What a target's clip time gains per second of timeline at `p`: its rate times the remap's
    /// derivative, turned by ping-pong, 0 while something holds it.
    pub(crate) fn rate_after(&self, motion: &Motion, p: i64, delay: i64) -> f64 {
        let t = &self.timing;
        let clip_span = self.clip_span(motion);
        let start = self.run_start(p, delay).unwrap_or(self.start + delay);
        let d = p - start;
        if d < 0 || d >= self.active_for(clip_span) {
            return 0.0;
        }
        let rate = t.rate.0 as f64 / t.rate.1 as f64;
        let parent = t.trim + floor_rate(d, t.rate);
        let (scale, child) = match t.remap {
            Some(r) => (
                motion.remaps[r].rate(parent),
                motion.remaps[r].child(parent).max(0),
            ),
            None => (1.0, parent),
        };
        if child >= self.total(clip_span) || t.quantize.is_some() {
            return 0.0;
        }
        let local = self.at_offset(motion, clip_span, d).local;
        if t.hold_at.is_some_and(|h| local >= h) {
            return 0.0;
        }
        let back = t.repeat == Repeat::PingPong && child.div_euclid(clip_span) % 2 == 1;
        rate * scale * if back { -1.0 } else { 1.0 }
    }

    /// The first target's wraps in (`from`, `to`]: each start of a pass after the first; the end
    /// of the final pass is not a wrap.
    pub fn wraps(&self, motion: &Motion, from: i64, to: i64) -> u32 {
        if to <= from {
            return 0;
        }
        let clip_span = self.clip_span(motion);
        let start = self.start + self.first_delay();
        let active = self.active_for(clip_span);
        // Wrap k falls where local time reaches k × span, k in 1..count.
        let count_upto = |p: i64| -> i64 {
            if p < start {
                return 0;
            }
            let local = self.timing.trim + floor_rate((p - start).min(active), self.timing.rate);
            (local / clip_span).min(i64::from(self.count) - 1)
        };
        u32::try_from(count_upto(to) - count_upto(from)).unwrap_or(0)
    }

    /// The earliest timeline position after `p` at which what any of its targets shows may change.
    fn next_change(&self, motion: &Motion, p: i64) -> Option<i64> {
        let clip = motion.clip(&self.clip)?;
        let active = self.active_for(clip.span);
        self.bindings
            .iter()
            .map(|b| b.delay)
            .chain(self.bindings.is_empty().then_some(0))
            .filter_map(|delay| {
                if !self.timing.runs.is_empty() || self.timing.start_on.is_some() {
                    return self.next_run_change(p, delay, active);
                }
                let start = self.start + delay;
                if p < start {
                    return Some(start);
                }
                if p >= start + active {
                    return None;
                }
                if !self.plain() {
                    return Some(p + 1);
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

    /// [`Placement::next_change`] for `start_on`: every flick of a run, then the next run.
    fn next_run_change(&self, p: i64, delay: i64, active: i64) -> Option<i64> {
        let running = self
            .run_start(p, delay)
            .is_some_and(|start| p < start + active);
        if running {
            return Some(p + 1);
        }
        let runs = &self.timing.runs;
        (0..runs.len())
            .map(|i| runs[i] + self.run_delay(i, delay))
            .filter(|r| *r > p)
            .min()
    }
}

/// `d` flicks at a whole-number rate, floored.
fn floor_rate(d: i64, (num, den): (i64, i64)) -> i64 {
    (i128::from(d) * i128::from(num)).div_euclid(i128::from(den)) as i64
}

/// The first flick after `t` on that grid.
pub(crate) fn next_grid(t: i64, (num, den): (u32, u32)) -> i64 {
    let (n, d) = (i128::from(num), i128::from(den));
    let second = i128::from(FLICKS_PER_SECOND);
    let k = (i128::from(t) * n).div_euclid(second * d) + 1;
    ((k * second * d) / n) as i64
}

/// `t` stepped down to the frame grid of `num/den` frames a second, on whole flicks.
pub(crate) fn grid(t: i64, (num, den): (u32, u32)) -> i64 {
    let (num, den) = (i128::from(num), i128::from(den));
    let second = i128::from(FLICKS_PER_SECOND);
    let k = (i128::from(t) * num).div_euclid(second * den);
    ((k * second * den) / num) as i64
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

/// Which channels and placements a frame's `valid_until` counts, by index: `None` counts all.
#[derive(Clone, Copy, Default)]
pub(crate) struct Counts<'a> {
    pub channels: Option<&'a [bool]>,
    pub placements: Option<&'a [bool]>,
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
        // `ops/<i>/end` reaches through the op's one key; `ops/<i>/trim/end` names it (#222).
        let named = at
            .as_object()
            .is_some_and(|m| m.contains_key(name.as_str()));
        if depth == 3 && rest[0] == "params" && rest[1] == "ops" && !named {
            at = through_op(at);
        }
        // #222: an index into a list the item doesn't hold yet starts that list.
        if at.is_null() && name.parse::<usize>().is_ok() {
            *at = Value::Array(Vec::new());
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

/// The frame's `valid_until`: the earliest `t` at which anything it shows changes next, over the
/// channels and placements `counts` keeps (#1487: those a view shows; every one otherwise).
/// `follows` holds each channel's #489 follow, which it takes in place of its curve.
pub(crate) fn valid_until(
    motion: &Motion,
    follows: &[Option<crate::follow::Follow>],
    t: i64,
    doc_t: i64,
    validity: Validity,
    counts: Counts<'_>,
) -> Option<i64> {
    // A document remap moves every read off the timeline's own clock.
    if motion.remaps.iter().any(|r| r.target == DOCUMENT) {
        return Some(t + 1);
    }
    let kept = |list: Option<&[bool]>, i: usize| list.is_none_or(|l| l[i]);
    let channels = motion.channels.iter().enumerate();
    let channels = channels.filter(|(i, _)| kept(counts.channels, *i));
    let channels = channels.filter_map(|(i, c)| {
        // A modified channel may change at every flick, and so may a remapped one, whose
        // child time runs other than the timeline.
        if !c.modifiers.is_empty() || motion.remapped(&c.target.owner) {
            return Some(doc_t + 1);
        }
        match follows.get(i).and_then(Option::as_ref) {
            Some(follow) => follow.next_change(doc_t),
            None => c.curve.next_change(doc_t),
        }
    });
    let placements = motion
        .placements
        .iter()
        .enumerate()
        .filter(|(i, _)| validity == Validity::Full && kept(counts.placements, *i))
        .filter_map(|(_, p)| p.next_change(motion, doc_t));
    let next = channels.chain(placements).min();
    // Whether anything counted moves at all: a wrap changes only what moved.
    let none_counted = (0..motion.channels.len()).all(|i| !kept(counts.channels, i))
        && (0..motion.placements.len()).all(|i| !kept(counts.placements, i));
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
                None if none_counted => None,
                None => Some(wrap_at + offset),
            }
        }
        // #157: a backwards pass may change at every flick.
        Some(_) if tr.ping_pong && !(none_counted && next.is_none()) => Some(t + 1),
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
    let mut items = evaluated(items, program, state);
    crate::held::apply(doc, program, state, &mut items);
    // #450: a 2D path's trail, drawn from its source evaluated at earlier times.
    crate::trail::flat(doc, program, state, &mut items);
    items
}

/// [`items`] of only the items `keep` takes, each as [`items`] gives it: a view that leaves out
/// what it can't see copies and evaluates none of it (#1486).
pub fn items_where(
    doc: &Map<String, Value>,
    program: &Program,
    state: &State,
    keep: impl Fn(&str) -> bool,
) -> Map<String, Value> {
    let items = match doc.get("items") {
        Some(Value::Object(items)) => items
            .iter()
            .filter(|(id, _)| keep(id))
            .map(|(id, item)| (id.clone(), item.clone()))
            .collect(),
        _ => Map::new(),
    };
    let mut items = evaluated(items, program, state);
    crate::held::apply(doc, program, state, &mut items);
    // #450: a 2D path's trail, drawn from its source evaluated at earlier times.
    crate::trail::flat(doc, program, state, &mut items);
    items
}

/// [`items`] of only the items a field names, each as [`items`] gives it: every other evaluated
/// item is the document's own with `at` from its slots, which a reader can take from the state
/// without copying the item.
pub fn written(doc: &Map<String, Value>, program: &Program, state: &State) -> Map<String, Value> {
    written_with(doc, program, state, |_| false)
}

/// [`written`] with the items `also` takes too, each as [`items`] gives it: #462's motifs move
/// the items a scene binds, so a 3D frame reads them as evaluated copies.
pub fn written_with(
    doc: &Map<String, Value>,
    program: &Program,
    state: &State,
    also: impl Fn(&str) -> bool,
) -> Map<String, Value> {
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
            .filter(|(id, item)| named.contains(id.as_str()) || reads_data(item) || also(id))
            .map(|(id, item)| (id.clone(), item.clone()))
            .collect(),
        _ => Map::new(),
    };
    evaluated(items, program, state)
}

/// `items` with each one's slots and fields written, as [`items`] evaluates them.
pub(crate) fn evaluated(
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
            run if field.shape.is_some() => {
                let shape = crate::morph::unflat(run, field.shape.as_ref().expect("a shape"));
                // An item's own `path` is what it draws: a vector import's outline, or a path's
                // `d`, in place of its columns.
                if field.path == ["path"] {
                    if let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) {
                        let d = json!(crate::morph::d_of(&shape));
                        if let Some(outline) =
                            params.get_mut("outline").and_then(Value::as_object_mut)
                        {
                            outline.insert("d".into(), d);
                            outline.remove("svg");
                        } else {
                            params.remove("verbs");
                            params.remove("pts");
                            params.insert("d".into(), d);
                        }
                    }
                    continue;
                }
                crate::morph::value_of(&shape)
            }
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
            write(
                item,
                &["params".into(), "data".into(), name.clone()],
                json!(value),
            );
        }
    }
    items
}

/// #504: the values a figure's readouts show at the state's time, the one source a card's and a
/// text's template slots read: `{data: {name: value}, assemblies: {id: value}, controls: {id:
/// value}}`, each data value something writes, each assembly's value held to its range, and each
/// control's value at t, its last input-track entry at or before t, else its default (a slider's
/// range's low end where it names none).
pub fn shown_values(doc: &Map<String, Value>, program: &Program, state: &State) -> Value {
    let data: Map<String, Value> = program
        .fields
        .iter()
        .filter(|f| f.written)
        .filter_map(|f| Some((f.data.clone()?, json!(state.slots[f.slot]))))
        .collect();
    let assemblies: Map<String, Value> = program
        .assemblies
        .iter()
        .map(|a| (a.id.clone(), json!(a.held(state.slots[a.slot]))))
        .collect();
    let mut entries: Vec<&crate::input::Entry> = program
        .options
        .input
        .iter()
        .filter(|e| e.t <= state.t)
        .collect();
    entries.sort_by_key(|e| e.key());
    let controls: Map<String, Value> = doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(id, c)| {
            let last = entries
                .iter()
                .rev()
                .find(|e| e.control == *id)
                .map(|e| e.value.clone());
            let default = || c.get("default").or_else(|| c.pointer("/range/0")).cloned();
            (id.clone(), last.or_else(default).unwrap_or(Value::Null))
        })
        .collect();
    json!({"data": data, "assemblies": assemblies, "controls": controls})
}

/// `doc` with [`shown_values`] written where a template's slots read them (`data/<name>`,
/// `assemblies/<id>/value`, `controls/<id>/value`): what a readout fills from, the same for the
/// card the frame draws and the readout `see` hears (#504).
pub fn shown_doc(doc: &Map<String, Value>, program: &Program, state: &State) -> Value {
    if program.options.planted == crate::program::Planted::ReadoutReadsDocument {
        return Value::Object(doc.clone());
    }
    let shown = shown_values(doc, program, state);
    let mut out = Value::Object(doc.clone());
    for (name, v) in shown["data"].as_object().into_iter().flatten() {
        match out.pointer_mut(&format!("/data/{name}")) {
            Some(Value::Object(entry)) => {
                entry.insert("value".into(), v.clone());
            }
            Some(bare) => *bare = v.clone(),
            None => {}
        }
    }
    for section in ["assemblies", "controls"] {
        for (id, v) in shown[section].as_object().into_iter().flatten() {
            if let Some(Value::Object(entry)) = out.get_mut(section).and_then(|s| s.get_mut(id)) {
                entry.insert("value".into(), v.clone());
            }
        }
    }
    out
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
