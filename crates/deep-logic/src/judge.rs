//! `judge` (#981): a piece's run read by lanes@1's kind rules for each logic item with `lanes`.

use std::rc::Rc;

use serde_json::{json, Map, Value};

use crate::world::{track_of, Record, World};
use crate::{bad, bake, first_party, lanes, track, world, Logic};

impl Logic {
    /// `judge` (#981): the piece's run, steps 0 to n − 1 as a bake runs them, read by lanes@1's
    /// kind rules for each logic item with `lanes` (lanes.clear, and lanes.stuck at its pack's
    /// `max_wait`), with the geometry audit's measure of a centre off its graph and the item's
    /// arrays at the last step.
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
        let max_wait = first_party::packs()
            .iter()
            .find_map(|p| p.pointer("/interfaces/lanes@1/rules/lanes.stuck/max_wait"))
            .and_then(Value::as_f64)
            .unwrap_or(60.0);
        let mut out = Map::new();
        for item in &piece.items {
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
            let prefix = format!("{}.", item.id);
            judged["last"] = last
                .into_iter()
                .map(|(k, v)| (k.strip_prefix(&prefix).unwrap_or(&k).to_string(), v))
                .collect::<Map<_, _>>()
                .into();
            out.insert(item.id.clone(), judged);
        }
        Ok(json!({"ok": true, "items": out}))
    }
}
