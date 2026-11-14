//! Look `look@1`: motifs (#462). A motif is a small motion a look adds to the items a scene binds
//! to its slot (`motif_slots: {slot → collection}` on the document), as a modifier that reads time:
//! periodic, or stepped and seeded from item IDs, so seeking equals playing and the document never
//! changes. It writes only the evaluated items a frame draws.
//!
//! An unbound slot does nothing. A rate in beats reads the tempo map, so it stays on the beat when
//! the tempo changes; `alternate` swings neighbours in turn; `hold_on` freezes it inside markers of
//! those kinds, and a text item also freezes inside a reading hold (a marker of kind `hold`): the
//! motif's clock skips those spans, so it neither moves inside one nor jumps when it ends. With
//! `desync`, each item's cycle starts at an offset seeded from its ID (or, with `seed: document`,
//! from the document's seed and its place in the slot). Under reduced motion nothing moves.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::doc::{Ctx, Refused};
use crate::program::Program;
use crate::tempo::Tempo;

/// The motions (Look `look@1`: motifs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion {
    /// Wanders on an ellipse `amount` u wide.
    Drift,
    /// Circles `amount` u about where it stands.
    Swirl,
    /// Scales by 1 ± `amount`.
    Pulse,
    /// Turns ± `amount` degrees about its own origin.
    Sway,
    /// Its opacity eases down by up to `amount` and back.
    Shimmer,
    /// Its opacity drops by a seeded share of `amount`, held for each cycle.
    Flicker,
    /// Jitters up to `amount` u, a seeded offset held for each cycle.
    Boil,
}

impl Motion {
    fn of(name: &str) -> Option<Motion> {
        Some(match name {
            "drift" => Motion::Drift,
            "swirl" => Motion::Swirl,
            "pulse" => Motion::Pulse,
            "sway" => Motion::Sway,
            "shimmer" => Motion::Shimmer,
            "flicker" => Motion::Flicker,
            "boil" => Motion::Boil,
            _ => return None,
        })
    }
}

/// How a motif counts its cycles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rate {
    Hz(f64),
    /// One cycle every so many beats of the tempo map.
    Beats(f64),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Motif {
    pub slot: String,
    pub motion: Motion,
    pub amount: f64,
    pub rate: Rate,
    pub alternate: bool,
    pub hold_on: Vec<String>,
    pub desync: bool,
    /// `seed: item` (the default) rather than `document`.
    pub by_item: bool,
}

/// A motif with its slot's members, in the collection's order, and the spans it holds still in.
#[derive(Clone, Debug)]
struct Bound {
    motif: Motif,
    members: Vec<String>,
    frozen: Vec<(i64, i64)>,
}

/// A look's motifs bound to a document.
#[derive(Clone, Debug, Default)]
pub struct Motifs {
    bound: Vec<Bound>,
    /// The reading holds, which a text item's motif skips.
    holds: Vec<(i64, i64)>,
    tempo: Option<Tempo>,
    doc_seed: u64,
}

fn refused<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
        detail: None,
    })
}

fn finite(v: Option<&Value>, path: &str) -> Result<Option<f64>, Refused> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64().filter(|x| x.is_finite()) {
            Some(x) => Ok(Some(x)),
            None => refused("out_of_range", path),
        },
    }
}

/// A look's `motifs`, in slot order; none when it has none.
pub fn parse(look: &Value) -> Result<Vec<Motif>, Refused> {
    let Some(all) = look.get("motifs") else {
        return Ok(Vec::new());
    };
    let Some(all) = all.as_object() else {
        return refused("bad_doc", "motifs");
    };
    let mut out = Vec::new();
    for (slot, m) in all {
        let path = format!("motifs/{slot}");
        let Some(m) = m.as_object() else {
            return refused("bad_doc", path);
        };
        let Some(motion) = m.get("motion").and_then(Value::as_str).and_then(Motion::of) else {
            return refused("bad_doc", format!("{path}/motion"));
        };
        let amount = finite(m.get("amount"), &format!("{path}/amount"))?.unwrap_or(0.0);
        let rate = match (m.get("hz"), m.get("rate")) {
            (Some(_), Some(_)) => return refused("bad_doc", format!("{path}/rate")),
            (_, Some(r)) => match finite(r.get("beats"), &format!("{path}/rate/beats"))? {
                Some(b) if b > 0.0 => Rate::Beats(b),
                _ => return refused("out_of_range", format!("{path}/rate/beats")),
            },
            (hz, None) => match finite(hz, &format!("{path}/hz"))? {
                Some(h) if h >= 0.0 => Rate::Hz(h),
                None => Rate::Hz(1.0),
                Some(_) => return refused("out_of_range", format!("{path}/hz")),
            },
        };
        let alternate = match m.get("phase").and_then(Value::as_str) {
            None | Some("free") => false,
            Some("alternate") => true,
            Some(_) => return refused("bad_doc", format!("{path}/phase")),
        };
        let hold_on = match m.get("hold_on") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(kinds)) => kinds
                .iter()
                .map(|k| k.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .map_or_else(|| refused("bad_doc", format!("{path}/hold_on")), Ok)?,
            Some(_) => return refused("bad_doc", format!("{path}/hold_on")),
        };
        let by_item = match m.get("seed").and_then(Value::as_str) {
            None | Some("item") => true,
            Some("document") => false,
            Some(_) => return refused("bad_doc", format!("{path}/seed")),
        };
        out.push(Motif {
            slot: slot.clone(),
            motion,
            amount,
            rate,
            alternate,
            hold_on,
            desync: m.get("desync").and_then(Value::as_bool).unwrap_or(true),
            by_item,
        });
    }
    Ok(out)
}

/// FNV-1a over `text`.
fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// A fixed hash of `(a, b)` → [0, 1).
fn unit(a: u64, b: u64) -> f64 {
    let mut z = a ^ b.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// `spans` merged, in start order.
fn merged(mut spans: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    spans.retain(|(a, b)| b > a);
    spans.sort_unstable();
    let mut out: Vec<(i64, i64)> = Vec::new();
    for (a, b) in spans {
        match out.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// `t` with the time inside `spans` (merged) left out: a clock that stands still inside them.
fn skipping(t: i64, spans: &[(i64, i64)]) -> i64 {
    t - spans
        .iter()
        .map(|&(a, b)| (t.min(b) - a).max(0))
        .sum::<i64>()
}

fn is_text(item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str).is_some_and(|k| {
        k.starts_with("text@") || k.starts_with("label@") || k.starts_with("mark.text@")
    })
}

impl Motifs {
    /// The look's motifs bound through the document's `motif_slots`, or `None` when nothing is
    /// bound. A slot bound to a collection the document lacks is refused at check.
    pub fn compile(
        look: &Value,
        doc: &Map<String, Value>,
        program: &Program,
    ) -> Result<Option<Motifs>, Refused> {
        Motifs::bind(parse(look)?, doc, program)
    }

    /// [`Motifs::compile`] of motifs [`parse`] read already: a 3D look keeps them parsed.
    pub fn bind(
        motifs: Vec<Motif>,
        doc: &Map<String, Value>,
        program: &Program,
    ) -> Result<Option<Motifs>, Refused> {
        let slots = doc.get("motif_slots").and_then(Value::as_object);
        if let Some(Value::Object(s)) = doc.get("motif_slots") {
            for (slot, c) in s {
                let Some(c) = c.as_str() else {
                    return refused("bad_doc", format!("motif_slots/{slot}"));
                };
                if doc.get("collections").and_then(|cs| cs.get(c)).is_none() {
                    return refused("ref_unresolved", format!("motif_slots/{slot}: {c}"));
                }
            }
        } else if doc.get("motif_slots").is_some_and(|s| !s.is_null()) {
            return refused("bad_doc", "motif_slots");
        }
        let markers = &program.motion.markers;
        let mut bound = Vec::new();
        for m in motifs {
            let Some(c) = slots.and_then(|s| s.get(&m.slot)).and_then(Value::as_str) else {
                continue;
            };
            let members: Vec<String> = doc
                .get("collections")
                .and_then(|cs| cs.pointer(&format!("/{c}/members")))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            let frozen = merged(
                markers
                    .iter()
                    .filter(|k| m.hold_on.contains(&k.kind))
                    .map(|k| (k.start, k.end))
                    .collect(),
            );
            bound.push(Bound {
                motif: m,
                members,
                frozen,
            });
        }
        if bound.is_empty() {
            return Ok(None);
        }
        let tempo = if bound.iter().any(|b| matches!(b.motif.rate, Rate::Beats(_))) {
            match Ctx::timeline(doc, program.motion.frame_rate)?.tempo {
                Some(t) => Some(t),
                None => return refused("tempo_map_missing", "motifs: a rate in beats"),
            }
        } else {
            None
        };
        let holds = merged(
            markers
                .iter()
                .filter(|k| k.kind == "hold")
                .map(|k| (k.start, k.end))
                .collect(),
        );
        Ok(Some(Motifs {
            bound,
            holds,
            tempo,
            doc_seed: doc.get("seed").and_then(Value::as_u64).unwrap_or(0),
        }))
    }

    /// Whether a slot binds `id`.
    pub fn binds(&self, id: &str) -> bool {
        self.bound.iter().any(|b| b.members.iter().any(|m| m == id))
    }

    /// Each bound item's motion at `t`, written into the evaluated `items`; nothing under
    /// reduced motion.
    pub fn apply(&self, items: &mut Map<String, Value>, t: i64, reduced: bool) {
        if reduced {
            return;
        }
        for Bound {
            motif: m,
            members,
            frozen,
        } in &self.bound
        {
            for (i, id) in members.iter().enumerate() {
                let Some(item) = items.get_mut(id) else {
                    continue;
                };
                let spans = if is_text(item) {
                    merged(frozen.iter().chain(&self.holds).copied().collect())
                } else {
                    frozen.clone()
                };
                let tau = skipping(t, &spans);
                let cycles = match m.rate {
                    Rate::Hz(hz) => hz * tau as f64 / FLICKS_PER_SECOND as f64,
                    Rate::Beats(b) => self.tempo.as_ref().map_or(0.0, |tm| tm.position_of(tau)) / b,
                };
                let seed = if m.by_item {
                    fnv(id)
                } else {
                    self.doc_seed ^ fnv(&m.slot) ^ (i as u64).wrapping_mul(0x9e37_79b9)
                };
                let mut phase = if m.desync { unit(seed, 1) } else { 0.0 };
                if m.alternate && i % 2 == 1 {
                    phase += 0.5;
                }
                move_item(item, m, cycles + phase, seed);
            }
        }
    }
}

fn num_at(v: &Value, k: usize, default: f64) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(default)
}

/// One item moved by its motif at `theta` cycles.
fn move_item(item: &mut Value, m: &Motif, theta: f64, seed: u64) {
    let turn = 2.0 * std::f64::consts::PI * theta;
    let a = m.amount;
    let cycle = theta.floor() as i64 as u64;
    let shift = |item: &mut Value, dx: f64, dy: f64| {
        let pos = item.pointer("/at/pos").cloned().unwrap_or(json!([0, 0, 0]));
        let at = &mut item["at"];
        at["pos"] = json!([
            num_at(&pos, 0, 0.0) + dx,
            num_at(&pos, 1, 0.0) + dy,
            num_at(&pos, 2, 0.0)
        ]);
    };
    let fade = |item: &mut Value, by: f64| {
        let paint = &mut item["params"]["paint"];
        let o = paint.get("opacity").and_then(Value::as_f64).unwrap_or(1.0);
        paint["opacity"] = json!((o * (1.0 - by)).clamp(0.0, 1.0));
    };
    match m.motion {
        Motion::Drift => shift(item, a * ops::sin(turn), 0.5 * a * ops::sin(2.0 * turn)),
        Motion::Swirl => shift(item, a * ops::sin(turn), a * (1.0 - ops::cos(turn))),
        Motion::Boil => shift(
            item,
            a * (2.0 * unit(seed ^ 0xb011, cycle) - 1.0),
            a * (2.0 * unit(seed ^ 0xb012, cycle) - 1.0),
        ),
        Motion::Sway => {
            let rot = item.pointer("/at/rot").cloned().unwrap_or(json!([0, 0, 0]));
            item["at"]["rot"] = json!([
                num_at(&rot, 0, 0.0),
                num_at(&rot, 1, 0.0),
                num_at(&rot, 2, 0.0) + a * ops::sin(turn)
            ]);
        }
        Motion::Pulse => {
            let s = item
                .pointer("/at/scale")
                .cloned()
                .unwrap_or(json!([1, 1, 1]));
            let k = 1.0 + a * ops::sin(turn);
            item["at"]["scale"] = json!([
                num_at(&s, 0, 1.0) * k,
                num_at(&s, 1, 1.0) * k,
                num_at(&s, 2, 1.0)
            ]);
        }
        Motion::Shimmer => fade(item, a * 0.5 * (1.0 - ops::cos(turn))),
        Motion::Flicker => fade(item, a * unit(seed ^ 0xf11c, cycle)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clock_stands_still_inside_a_hold_and_never_jumps() {
        let spans = [(10, 20)];
        assert_eq!(skipping(5, &spans), 5);
        assert_eq!(skipping(10, &spans), 10);
        assert_eq!(skipping(15, &spans), 10);
        assert_eq!(skipping(20, &spans), 10);
        assert_eq!(skipping(25, &spans), 15);
    }

    #[test]
    fn a_motif_moves_only_its_slots_members_and_never_under_reduced_motion() {
        let doc = json!({
            "format": 1, "size": [100, 100], "transport": {"span": "2s"},
            "items": {
                "a": {"kind": "rect@1", "params": {"box": [0, 0, 1, 1]}, "at": {"pos": [10, 10, 0]}},
                "b": {"kind": "rect@1", "params": {"box": [0, 0, 1, 1]}, "at": {"pos": [20, 20, 0]}}
            },
            "collections": {"c": {"members": ["a"]}},
            "motif_slots": {"s": "c"}
        });
        let doc = doc.as_object().unwrap();
        let look =
            json!({"motifs": {"s": {"motion": "sway", "amount": 10, "hz": 1, "desync": false}}});
        let program = Program::compile(doc).unwrap();
        let motifs = Motifs::compile(&look, doc, &program).unwrap().unwrap();
        let items = doc["items"].as_object().unwrap().clone();
        let quarter = FLICKS_PER_SECOND / 4;
        let mut moved = items.clone();
        motifs.apply(&mut moved, quarter, false);
        assert!((moved["a"]["at"]["rot"][2].as_f64().unwrap() - 10.0).abs() < 1e-9);
        assert_eq!(moved["b"], items["b"]);
        let mut still = items.clone();
        motifs.apply(&mut still, quarter, true);
        assert_eq!(still, items);
    }
}
