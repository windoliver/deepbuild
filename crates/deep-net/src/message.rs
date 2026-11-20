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

/// One player's message for one match step: its entries, a full-state hash it confirmed, how its
/// copy ended the match when it did, and, once a desync stopped it, what its locator found.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Message {
    pub(crate) entries: Vec<(String, Value)>,
    pub(crate) hash: Option<Hashed>,
    pub(crate) end: Option<(String, Value)>,
    /// One part of what its locator found (`Found::parts`).
    pub(crate) found: Option<Value>,
    pub(crate) fields: Vec<(i64, Vec<(String, String, u64)>)>,
}

pub(crate) fn hex(h: u64) -> String {
    format!("{h:016x}")
}

fn unhex(v: &Value) -> Option<u64> {
    u64::from_str_radix(v.as_str()?, 16).ok()
}

/// A message's first byte names what follows: a full-state hash, then any of the rest.
const HASHED: u8 = 1;
const REST: u8 = 2;

impl Message {
    /// Empty when it holds nothing. Else a byte naming what it holds; a full-state hash as its
    /// step (u32) and its state and track hashes (u64 each), little-endian, so the track hash adds
    /// 8 B; then one JSON object with only what else it holds: entries, how its copy ended, and
    /// what its locator found. No state crosses.
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut m = Map::new();
        if !self.entries.is_empty() {
            m.insert("e".into(), json!(self.entries));
        }
        if let Some((end, detail)) = &self.end {
            m.insert("x".into(), json!([end, detail]));
        }
        if let Some(f) = &self.found {
            m.insert("l".into(), f.clone());
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
        if m.is_empty() && self.hash.is_none() {
            return Vec::new();
        }
        let flags =
            if self.hash.is_some() { HASHED } else { 0 } | if m.is_empty() { 0 } else { REST };
        let mut out = vec![flags];
        if let Some(h) = self.hash {
            out.extend((h.step as u32).to_le_bytes());
            out.extend(h.state.to_le_bytes());
            out.extend(h.track.to_le_bytes());
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
        if flags & REST == 0 {
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
        if let Some(x) = v.get("x") {
            m.end = Some((x.get(0)?.as_str()?.to_string(), x.get(1)?.clone()));
        }
        if let Some(l) = v.get("l") {
            m.found = Some(l.clone());
        }
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
