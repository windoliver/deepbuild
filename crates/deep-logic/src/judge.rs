//! `judge` (#981, #980, #1255): a piece's run read by an interface's kind rules, for each logic
//! item with `lanes` (lanes@1's), with `process` (process@1's) or with `separation`
//! (separation@1's).

use std::rc::Rc;

use serde_json::{json, Map, Value};

use crate::piece::Item;
use crate::world::{track_of, Record, World};
use crate::{bad, bake, first_party, lanes, process, separation, track, world, Logic};

/// A first-party interface's default for a rule's param, as its pack gives it.
fn default_of(interface: &str, rule: &str, param: &str) -> Option<f64> {
    first_party::packs()
        .iter()
        .find_map(|p| p.pointer(&format!("/interfaces/{interface}/rules/{rule}/{param}")))
        .and_then(Value::as_f64)
}

/// separation@1's rules on an item's arrays as the run's last step left them (#1255):
/// separation.clear over the span the call's `rules` give it, BLOCKED without one, and
/// separation.exact within the call's tolerance or its pack's.
fn separated(
    item: &Item,
    t: &separation::Table,
    last: &Map<String, Value>,
    rules: &Value,
) -> Result<Value, Value> {
    let array = |name: &str| {
        let numbers = |v: &Value| match v {
            Value::Array(xs) => xs.iter().filter_map(Value::as_f64).collect(),
            v => v.as_f64().into_iter().collect::<Vec<f64>>(),
        };
        Some(
            last.get(&format!("{}.{name}", item.id))?
                .as_array()?
                .iter()
                .flat_map(numbers)
                .collect(),
        )
    };
    let flown = separation::flown(t, &array).ok_or_else(|| {
        bad("an item with separation writes fix_count, fix_ref, fix_pos, fix_speed, fix_time, delay_s and delay_fix, and is judged on at least one step")
    })?;
    let rule = |fails: Vec<Value>| json!({"verdict": if fails.is_empty() { "PASS" } else { "FAIL" }, "fails": fails});
    let span = rules
        .pointer("/separation.clear/span")
        .and_then(Value::as_array)
        .and_then(|s| match s.as_slice() {
            [a, b] => Some([a.as_f64()?, b.as_f64()?]),
            _ => None,
        });
    let clear = match span {
        Some(span) => rule(t.clear(&flown, span)),
        None => {
            json!({"verdict": "BLOCKED", "fails": [], "why": "separation.clear reads the span the call's rules give it: {\"separation.clear\": {\"span\": [s, s]}}"})
        }
    };
    let tolerance = rules
        .pointer("/separation.exact/tolerance")
        .and_then(Value::as_f64)
        .or_else(|| default_of("separation@1", "separation.exact", "tolerance"))
        .unwrap_or(0.5);
    Ok(
        json!({"rules": {"separation.clear": clear, "separation.exact": rule(t.exact(&flown, tolerance))}}),
    )
}

impl Logic {
    /// `judge` (#981, #980): the piece's run, steps 0 to n − 1 as a bake runs them, read by
    /// lanes@1's kind rules for each logic item with `lanes` (lanes.clear, and lanes.stuck at its
    /// pack's `max_wait`), with the geometry audit's measure of a centre off its graph, and by
    /// process@1's for each with `process` (process.conserve, process.busy, and process.little at
    /// its pack's tolerance); each with the item's arrays at the last step. And by separation@1's
    /// for each with `separation` (#1255), each rule's params from the call's `rules`.
    pub(crate) fn judge(&mut self, line: &Value) -> Result<Value, Value> {
        let piece = Rc::new(self.check(line)?);
        let steps = line
            .get("steps")
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0)
            .ok_or_else(|| bad("steps"))?;
        let entries = track(&piece, line, steps, &self.planted).ok_or_else(|| bad("track"))?;
        let mut rec = Record::default();
        World::new(
            piece.clone(),
            track_of(&entries),
            true,
            self.planted,
            &mut rec,
            None,
        )?
        .run(steps, &mut rec, &mut |_, _| {});
        // The interface's pack gives each rule's params their defaults.
        let max_wait = default_of("lanes@1", "lanes.stuck", "max_wait").unwrap_or(60.0);
        let tolerance = default_of("process@1", "process.little", "tolerance").unwrap_or(0.02);
        let mut out = Map::new();
        let strip = |item: &crate::piece::Item, last: Map<String, Value>| -> Value {
            let prefix = format!("{}.", item.id);
            last.into_iter()
                .map(|(k, v)| (k.strip_prefix(&prefix).unwrap_or(&k).to_string(), v))
                .collect::<Map<_, _>>()
                .into()
        };
        for item in &piece.items {
            if let Some(t) = &item.separation {
                let last = bake::Player::new(&rec, item)
                    .at(steps - 1)
                    .map(|b| world::arrays_json(item, b))
                    .unwrap_or_default();
                let rules = line.get("rules").unwrap_or(&Value::Null);
                out.insert(item.id.clone(), separated(item, t, &last, rules)?);
                continue;
            }
            // #980: process@1's rules read the arrays its library writes, step by step.
            if let Some(kinds) = &item.process {
                let mut judge = process::Judge::new(item, kinds, tolerance).map_err(|e| bad(&e))?;
                let mut player = bake::Player::new(&rec, item);
                let mut last = Map::new();
                for k in 0..steps {
                    let Some(b) = player.at(k) else { continue };
                    judge.step(k, b);
                    if k == steps - 1 {
                        last = world::arrays_json(item, b);
                    }
                }
                let mut judged = judge.result();
                judged["last"] = strip(item, last);
                out.insert(item.id.clone(), judged);
                continue;
            }
            let Some(g) = &item.lanes else { continue };
            let at = |name: &str, ty: &str| {
                item.write(name)
                    .filter(|e| e.ty == ty)
                    .map(|e| (e.offset as usize, e.size as usize))
            };
            let (Some(pos), Some(heading), Some(state)) =
                (at("pos", "vec2"), at("heading", "f64"), at("state", "i32"))
            else {
                return Err(bad(
                    "an item with lanes writes pos (vec2), heading (f64) and state (i32)",
                ));
            };
            let n = (pos.1 / 16).min(heading.1 / 8).min(state.1 / 4);
            let f64_at = |b: &[u8], o: usize| f64::from_le_bytes(b[o..o + 8].try_into().unwrap());
            let mut judge = lanes::Judge::new(g, item.step, max_wait);
            let mut player = bake::Player::new(&rec, item);
            let mut last = Map::new();
            for k in 0..steps {
                let Some(b) = player.at(k) else { continue };
                let p: Vec<[f64; 2]> = (0..n)
                    .map(|v| [f64_at(b, pos.0 + 16 * v), f64_at(b, pos.0 + 16 * v + 8)])
                    .collect();
                let h: Vec<f64> = (0..n).map(|v| f64_at(b, heading.0 + 8 * v)).collect();
                let s: Vec<i32> = (0..n)
                    .map(|v| i32::from_le_bytes(b[state.0 + 4 * v..][..4].try_into().unwrap()))
                    .collect();
                judge.step(k, &p, &h, &s);
                if k == steps - 1 {
                    last = world::arrays_json(item, b);
                }
            }
            let mut judged = judge.result();
            judged["last"] = strip(item, last);
            out.insert(item.id.clone(), judged);
        }
        Ok(json!({"ok": true, "items": out}))
    }
}
