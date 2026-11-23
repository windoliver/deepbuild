//! #550: one player's message for one match step, as relay@1's frames carry it: its entries, the
//! full-state hash it confirmed with the merged track's hash beside it, how its copy ended the
//! match, and what its locator found. No state crosses.

use serde_json::{json, Map, Value};

/// A full-state hash a copy confirmed: its step, the hash of its whole carried state and the hash
/// of the merged input track up to that step (#550: entries first).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Hashed {
    pub step: i64,
    pub state: u64,
    pub track: u64,
}

/// A step's field hashes, `(module, field, hash)` in canonical order (#550: Net: desync and replay).
pub(crate) type Fields = Vec<(String, String, u64)>;

/// One player's message for one match step: its entries, a full-state hash it confirmed, how its
/// copy ended the match when it did, and, once a desync stopped it, what its locator found.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Message {
    pub(crate) entries: Vec<(String, Value)>,
    pub(crate) hash: Option<Hashed>,
    pub(crate) end: Option<(String, Value)>,
    /// One part of what its locator found (`Found::parts`).
    pub(crate) found: Option<Value>,
    pub(crate) fields: Vec<(i64, Fields)>,
    /// #552's planted net module puts its copy's `match.me` here; a message never holds it.
    pub(crate) me: Option<u8>,
}

/// #552: every message a relay@1 frame carries, as the relay's log reads them back.
pub(crate) fn read_frame(bytes: &[u8]) -> Vec<Value> {
    let Ok(f) = deep_relay::wire::Frame::decode(bytes) else {
        return Vec::new();
    };
    let game = deep_relay::wire::hex(&f.game);
    f.steps
        .iter()
        .enumerate()
        .filter_map(|(i, b)| {
            let m = Message::decode(b)?;
            Some(m.to_json(&game, f.player + 1, f.first as i64 + i as i64))
        })
        .collect()
}

pub(crate) fn hex(h: u64) -> String {
    format!("{h:016x}")
}

fn unhex(v: &Value) -> Option<u64> {
    u64::from_str_radix(v.as_str()?, 16).ok()
}

/// A message's first byte names what follows: a full-state hash, draws, then any of the rest.
const HASHED: u8 = 1;
const REST: u8 = 2;
/// #553: draw entries in their compact form.
const DRAWS: u8 = 4;
const COMMIT: u8 = 1;
const REVEAL: u8 = 2;

/// #553: a draw entry as its message carries it: its place among the entries, its kind, its step
/// (u32) and the commitment's 32 bytes or the bits (u64) and the match ID's 16 bytes,
/// little-endian; `None` where the value wouldn't read back the same, which then goes as JSON.
fn compact(at: usize, control: &str, v: &Value) -> Option<Vec<u8>> {
    let step = u32::try_from(v.get("step")?.as_u64()?).ok()?;
    let mut out = vec![u8::try_from(at).ok()?];
    match control {
        crate::draw::COMMIT => {
            out.push(COMMIT);
            out.extend(step.to_le_bytes());
            out.extend(bytes_of(v.get("hash")?.as_str()?, 32)?);
        }
        crate::draw::REVEAL => {
            out.push(REVEAL);
            out.extend(step.to_le_bytes());
            out.extend(crate::draw::bits_of(&v["bits"])?.to_le_bytes());
            out.extend(bytes_of(v.get("match")?.as_str()?, 16)?);
        }
        _ => return None,
    }
    let back = uncompact(&out).map(|(_, c, w, _)| (c, w));
    (back == Some((control.to_string(), v.clone()))).then_some(out)
}

/// A compact draw entry at the start of `b`: its place, control and value, and its length.
fn uncompact(b: &[u8]) -> Option<(usize, String, Value, usize)> {
    let (&at, rest) = b.split_first()?;
    let (&kind, rest) = rest.split_first()?;
    let step = u32::from_le_bytes(rest.get(..4)?.try_into().ok()?);
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    match kind {
        COMMIT => {
            let hash = hex(rest.get(4..36)?);
            let v = json!({"step": step, "hash": hash});
            Some((at as usize, crate::draw::COMMIT.to_string(), v, 38))
        }
        REVEAL => {
            let bits = u64::from_le_bytes(rest.get(4..12)?.try_into().ok()?);
            let v = json!({"step": step, "bits": crate::draw::bits_hex(bits), "match": hex(rest.get(12..28)?)});
            Some((at as usize, crate::draw::REVEAL.to_string(), v, 30))
        }
        _ => None,
    }
}

/// `n` bytes from `2n` lower-case hex digits.
fn bytes_of(text: &str, n: usize) -> Option<Vec<u8>> {
    if text.len() != 2 * n {
        return None;
    }
    (0..n)
        .map(|i| u8::from_str_radix(text.get(2 * i..2 * i + 2)?, 16).ok())
        .collect()
}

impl Message {
    /// Empty when it holds nothing. Else a byte naming what it holds; a full-state hash as its
    /// step (u32) and its state and track hashes (u64 each), little-endian, so the track hash adds
    /// 8 B; then one JSON object with only what else it holds: entries, how its copy ended, and
    /// what its locator found. No state crosses.
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut m = Map::new();
        // #553: draw entries go compact, beside the rest as JSON.
        let mut draws = Vec::new();
        let mut rest = Vec::new();
        for (at, (control, value)) in self.entries.iter().enumerate() {
            match compact(at, control, value).filter(|_| draws.len() < 255) {
                Some(b) => draws.push(b),
                None => rest.push((control, value)),
            }
        }
        if !rest.is_empty() {
            m.insert("e".into(), json!(rest));
        }
        if let Some((end, detail)) = &self.end {
            m.insert("x".into(), json!([end, detail]));
        }
        if let Some(f) = &self.found {
            m.insert("l".into(), f.clone());
        }
        if let Some(me) = self.me {
            m.insert("m".into(), json!(me));
        }
        if !self.fields.is_empty() {
            let at: Vec<Value> = self
                .fields
                .iter()
                .map(|(step, list)| {
                    let list: Vec<Value> = list
                        .iter()
                        .map(|(m, f, h)| json!([m, f, hex(*h)]))
                        .collect();
                    json!([step, list])
                })
                .collect();
            m.insert("f".into(), json!(at));
        }
        if m.is_empty() && self.hash.is_none() && draws.is_empty() {
            return Vec::new();
        }
        let flags = if self.hash.is_some() { HASHED } else { 0 }
            | if m.is_empty() { 0 } else { REST }
            | if draws.is_empty() { 0 } else { DRAWS };
        let mut out = vec![flags];
        if let Some(h) = self.hash {
            out.extend((h.step as u32).to_le_bytes());
            out.extend(h.state.to_le_bytes());
            out.extend(h.track.to_le_bytes());
        }
        if !draws.is_empty() {
            out.push(draws.len() as u8);
            out.extend(draws.concat());
        }
        if !m.is_empty() {
            out.extend(Value::Object(m).to_string().into_bytes());
        }
        out
    }

    pub(crate) fn decode(bytes: &[u8]) -> Option<Message> {
        let Some((&flags, mut rest)) = bytes.split_first() else {
            return Some(Message::default());
        };
        let mut m = Message::default();
        if flags & HASHED != 0 {
            let u64_at =
                |b: &[u8], at: usize| Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?));
            m.hash = Some(Hashed {
                step: u32::from_le_bytes(rest.get(..4)?.try_into().ok()?) as i64,
                state: u64_at(rest, 4)?,
                track: u64_at(rest, 12)?,
            });
            rest = rest.get(20..)?;
        }
        let mut draws = Vec::new();
        if flags & DRAWS != 0 {
            let (&n, mut b) = rest.split_first()?;
            for _ in 0..n {
                let (at, control, value, len) = uncompact(b)?;
                draws.push((at, (control, value)));
                b = b.get(len..)?;
            }
            rest = b;
        }
        // Each compact draw back at its place among the entries.
        let placed = |mut entries: Vec<(String, Value)>| {
            for (at, e) in draws {
                (at <= entries.len()).then(|| entries.insert(at, e))?;
            }
            Some(entries)
        };
        if flags & REST == 0 {
            m.entries = placed(Vec::new())?;
            return rest.is_empty().then_some(m);
        }
        let v: Value = serde_json::from_slice(rest).ok()?;
        if let Some(e) = v.get("e") {
            m.entries = e
                .as_array()?
                .iter()
                .map(|e| Some((e.get(0)?.as_str()?.to_string(), e.get(1)?.clone())))
                .collect::<Option<_>>()?;
        }
        m.entries = placed(std::mem::take(&mut m.entries))?;
        if let Some(x) = v.get("x") {
            m.end = Some((x.get(0)?.as_str()?.to_string(), x.get(1)?.clone()));
        }
        if let Some(l) = v.get("l") {
            m.found = Some(l.clone());
        }
        m.me = v.get("m").and_then(Value::as_u64).map(|p| p as u8);
        if let Some(f) = v.get("f") {
            m.fields = f
                .as_array()?
                .iter()
                .map(|at| {
                    let list = at
                        .get(1)?
                        .as_array()?
                        .iter()
                        .map(|x| {
                            Some((
                                x.get(0)?.as_str()?.to_string(),
                                x.get(1)?.as_str()?.to_string(),
                                unhex(x.get(2)?)?,
                            ))
                        })
                        .collect::<Option<_>>()?;
                    Some((at.get(0)?.as_i64()?, list))
                })
                .collect::<Option<_>>()?;
        }
        Some(m)
    }

    /// #552: the message as the relay's log reads it back, its members by name: the match, the
    /// player and the step it's for, its entries, the hash it confirmed, how its copy ended, and
    /// what its locator found; and anything else it holds, by its own name.
    pub(crate) fn to_json(&self, game: &str, player: u8, step: i64) -> Value {
        let mut out =
            json!({"match": game, "player": player, "step": step, "entries": self.entries});
        if let Some(h) = self.hash {
            out["hash"] = json!({"step": h.step, "state": hex(h.state), "track": hex(h.track)});
        }
        if let Some((end, detail)) = &self.end {
            out["end"] = json!({"end": end, "detail": detail});
        }
        if let Some(f) = &self.found {
            out["locate"] = f.clone();
        }
        if !self.fields.is_empty() {
            out["locate_fields"] = json!(self.fields.len());
        }
        if let Some(me) = self.me {
            out["me"] = json!(me);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_round_trips_and_its_track_hash_adds_eight_bytes() {
        let h = Hashed {
            step: 360,
            state: 7,
            track: 9,
        };
        let with = Message {
            hash: Some(h),
            ..Message::default()
        };
        assert_eq!(with.encode().len(), 21);
        assert_eq!(Message::decode(&with.encode()), Some(with.clone()));
        let full = Message {
            entries: vec![("push".into(), json!(3))],
            hash: Some(h),
            end: Some(("faulted".into(), json!({"step": 4}))),
            ..Message::default()
        };
        assert_eq!(Message::decode(&full.encode()), Some(full));
        assert_eq!(Message::default().encode(), Vec::<u8>::new());
        assert_eq!(Message::decode(&[]), Some(Message::default()));
    }
}
