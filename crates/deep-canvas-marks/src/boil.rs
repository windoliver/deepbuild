//! The look's boil (canvas primitives: Look `look@1`, `time.boil`; #466): a drawn line's points
//! move by up to `amount_px` from a seed that is the drawing's index, ⌊t × hz⌋, and with
//! `cycle: n` that index mod n, so n drawings repeat. The boil is a function of time and IDs only,
//! never of playback, as the flicker check's `reseed` rule holds it.

use serde_json::Value;

use crate::path::Verb;
use crate::scene::Mark;

/// A look's boil.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Boil {
    pub hz: f64,
    pub amount_px: f64,
    /// How many drawings repeat; 0 for none.
    pub cycle: u32,
    /// The look's seed, or the document's.
    pub seed: u64,
}

/// The boil a look defines under `time.boil`, or `None`; a field out of its range is refused,
/// naming it.
pub fn read(look: &Value, document_seed: u64) -> Result<Option<Boil>, String> {
    let Some(b) = look.pointer("/time/boil").filter(|b| !b.is_null()) else {
        return Ok(None);
    };
    let Some(b) = b.as_object() else {
        return Err("time/boil".into());
    };
    let num = |k: &str, default: f64| -> Result<f64, String> {
        match b.get(k) {
            None => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|v| *v >= 0.0)
                .ok_or(format!("time/boil/{k}")),
        }
    };
    let hz = num("hz", 0.0)?;
    let amount_px = num("amount_px", 0.0)?;
    let cycle = match b.get("cycle") {
        None => 0,
        Some(v) => v
            .as_u64()
            .filter(|n| *n <= u64::from(u8::MAX))
            .ok_or("time/boil/cycle")? as u32,
    };
    match b.get("while").and_then(Value::as_str) {
        None | Some("always") => {}
        Some(_) => return Err("time/boil/while".into()),
    }
    // `item` seeds each line from its item alone; `document` adds the document's seed.
    let seed = match b.get("seed") {
        None => document_seed,
        Some(Value::String(s)) if s == "document" => document_seed,
        Some(Value::String(s)) if s == "item" => 0,
        Some(v) => v.as_u64().ok_or("time/boil/seed")?,
    };
    Ok(Some(Boil {
        hz,
        amount_px,
        cycle,
        seed,
    }))
}

impl Boil {
    /// The drawing shown at `t` (flicks): ⌊t × hz⌋, mod the cycle when it has one; 0 when held
    /// still under reduced motion.
    pub fn drawing(&self, t: i64, held: bool) -> u32 {
        let k = crate::print::step(t, self.hz, held);
        if self.cycle > 0 {
            k % self.cycle
        } else {
            k
        }
    }

    /// Each stroked line among `marks` moved for drawing `k`: every point by up to `amount_px`
    /// on each axis, from a hash of the seed, its item, the point's index and `k`.
    pub fn apply(&self, marks: &mut [Mark], k: u32) {
        for (m, mark) in marks.iter_mut().enumerate() {
            self.apply_one(mark, m as u32, k);
        }
    }

    /// Every layer of `frame` with its stroked lines moved for drawing `k`.
    pub fn frame(&self, frame: &mut crate::scene::Frame, k: u32) {
        let mut m = 0u32;
        for layer in &mut frame.layers {
            let list: Vec<std::sync::Arc<crate::scene::Drawn>> =
                layer.marks.iter().cloned().collect();
            for (at, drawn) in list.into_iter().enumerate() {
                let mut d = (*drawn).clone();
                if self.apply_one(&mut d.mark, m, k) {
                    layer.marks.set(at, std::sync::Arc::new(d));
                }
                m += 1;
            }
        }
    }

    /// Mark `m` moved for drawing `k` when it's a path or a stroked line; whether it was.
    fn apply_one(&self, mark: &mut Mark, m: u32, k: u32) -> bool {
        if self.amount_px <= 0.0 {
            return false;
        }
        match mark {
            Mark::Shape {
                item,
                verbs,
                fill: None,
                stroke: Some(_),
            } => self.nudge(item, verbs, m, k),
            // A path's outline, stroked or filled: its line is what boils; its `d` follows,
            // since a tessellation is keyed by it.
            Mark::Path {
                item, geometry, d, ..
            } => {
                self.nudge(item, &mut geometry.verbs, m, k);
                *d = svg(&geometry.verbs);
            }
            _ => return false,
        }
        true
    }

    /// Each point of `verbs` moved for drawing `k` of mark `m` of `item`.
    fn nudge(&self, item: &str, verbs: &mut [Verb], m: u32, k: u32) {
        let mut i = 0u32;
        let mut nudge = |p: &mut [f64; 2]| {
            for (axis, v) in p.iter_mut().enumerate() {
                let at = m.wrapping_mul(7919) ^ (i << 1) ^ axis as u32;
                *v += self.amount_px * (2.0 * jitter(self.seed, item, at, k) - 1.0);
            }
            i += 1;
        };
        for v in verbs.iter_mut() {
            match v {
                Verb::Move(p) | Verb::Line(p) => nudge(p),
                Verb::Quad(a, b) => {
                    nudge(a);
                    nudge(b);
                }
                Verb::Cubic(a, b, c) => {
                    nudge(a);
                    nudge(b);
                    nudge(c);
                }
                Verb::Close => {}
            }
        }
    }
}

/// `verbs` as an SVG path's text.
fn svg(verbs: &[Verb]) -> String {
    let mut out = String::new();
    for v in verbs {
        let part = match v {
            Verb::Move([x, y]) => format!("M {x} {y} "),
            Verb::Line([x, y]) => format!("L {x} {y} "),
            Verb::Quad([a, b], [x, y]) => format!("Q {a} {b} {x} {y} "),
            Verb::Cubic([a, b], [c, d], [x, y]) => format!("C {a} {b} {c} {d} {x} {y} "),
            Verb::Close => "Z ".to_string(),
        };
        out.push_str(&part);
    }
    out.trim_end().to_string()
}

/// A seeded fraction in [0, 1) of the boil's seed, an item, a point and a drawing.
fn jitter(seed: u64, item: &str, at: u32, drawing: u32) -> f64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64 ^ seed;
    for b in item
        .bytes()
        .chain(at.to_le_bytes())
        .chain(drawing.to_le_bytes())
    {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (h >> 11) as f64 / (1u64 << 53) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: i64 = deep_canvas::grammar::FLICKS_PER_SECOND;

    #[test]
    fn a_cycle_of_three_at_twelve_hz_repeats_every_quarter_second() {
        let b = Boil {
            hz: 12.0,
            amount_px: 1.0,
            cycle: 3,
            seed: 0,
        };
        for k in 0..48 {
            let t = k * SECOND / 48;
            assert_eq!(b.drawing(t, false), b.drawing(t + SECOND / 4, false));
        }
        // Three drawings, not one.
        let seen: std::collections::BTreeSet<u32> =
            (0..12).map(|k| b.drawing(k * SECOND / 12, false)).collect();
        assert_eq!(seen.len(), 3);
    }
}
