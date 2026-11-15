//! The input track a piece's logic items step on (Input track entries): each entry's value, and
//! the track by control in the track's order.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::point::Point;

/// An entry's value: a number, the row a pick wrote (Control: picks on rows and grid focus):
/// its set's index in `rows` and its key, an integer key column's value and 0, a grid's
/// `(cx, cy)` or a fed instancer's `(slot, gen)`, or a point control's press, move or release
/// (Control: point), or a text control's committed bytes (Control: text). A scroll control's
/// position is a number (Control: scroll).
#[derive(Clone, Debug, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum Given {
    Number(f64),
    Pick { set: u32, key: [i64; 2] },
    Point(Point),
    Text(String),
}

impl From<f64> for Given {
    fn from(n: f64) -> Given {
        Given::Number(n)
    }
}

impl Given {
    fn parse(v: &Value) -> Option<Given> {
        if let Some(n) = v.as_f64() {
            return Some(Given::Number(n));
        }
        if v.get("phase").is_some() {
            return Point::parse(v).map(Given::Point);
        }
        if let Some(t) = v.as_str() {
            return Some(Given::Text(t.to_string()));
        }
        let set = v.get("set")?.as_u64().filter(|s| *s < 8)? as u32;
        match v.get("key")?.as_array()?.as_slice() {
            [a, b] => Some(Given::Pick {
                set,
                key: [a.as_i64()?, b.as_i64()?],
            }),
            _ => None,
        }
    }
    pub fn to_json(&self) -> Value {
        match self {
            Given::Number(n) => json!(n),
            Given::Pick { set, key } => json!({"set": set, "key": key}),
            Given::Point(p) => p.to_json(),
            Given::Text(t) => json!(t),
        }
    }
    /// The value as its control's read region lays it out: an f64 (8 B), a pick's `u32 set,
    /// 4 zero bytes, i64 key[0], i64 key[1]` (24 B), a point's record (248 B), or a text
    /// commit's `u32` length and its bytes.
    pub fn bytes(&self) -> Vec<u8> {
        match self {
            Given::Number(n) => n.to_le_bytes().to_vec(),
            Given::Pick { set, key } => {
                let mut b = set.to_le_bytes().to_vec();
                b.extend([0; 4]);
                b.extend(key[0].to_le_bytes());
                b.extend(key[1].to_le_bytes());
                b
            }
            Given::Point(p) => p.bytes().to_vec(),
            Given::Text(t) => {
                let mut b = (t.len() as u32).to_le_bytes().to_vec();
                b.extend(t.as_bytes());
                b
            }
        }
    }
}

/// An entry on the input track (Input track entries).
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub t: i64,
    pub seq: u32,
    pub control: String,
    pub value: Given,
    pub writer: String,
    pub player: u32,
    /// A reading's as-of time, in microseconds: then `control` is the reading, `reading:<source>`
    /// (Logic: readings).
    pub as_of: Option<i64>,
    /// Its place in the order entries reached the track, which no read follows but a planted one.
    pub arrived: u64,
}

impl Entry {
    pub fn parse(v: &Value) -> Option<Entry> {
        let reading = v.get("reading").and_then(Value::as_str);
        Some(Entry {
            t: v.get("t")?.as_i64()?,
            seq: v.get("seq").map_or(Some(0), Value::as_u64)? as u32,
            control: reading
                .or(v.get("control").and_then(Value::as_str))?
                .to_string(),
            // A reading's value is a number.
            value: match reading {
                Some(_) => v.get("value")?.as_f64()?.into(),
                None => Given::parse(v.get("value")?)?,
            },
            writer: v
                .get("writer")
                .map_or(Some("you"), Value::as_str)?
                .to_string(),
            player: v.get("player").map_or(Some(1), Value::as_u64)? as u32,
            as_of: match reading {
                Some(_) => Some(v.get("as_of")?.as_i64()?),
                None => None,
            },
            arrived: 0,
        })
    }
    pub fn to_json(&self) -> Value {
        let value = self.value.to_json();
        match self.as_of {
            None => {
                json!({"t": self.t, "seq": self.seq, "control": self.control, "value": value, "writer": self.writer, "player": self.player})
            }
            Some(as_of) => {
                json!({"t": self.t, "seq": self.seq, "reading": self.control, "value": value, "as_of": as_of, "writer": self.writer, "player": self.player})
            }
        }
    }
}

/// The input track by control or reading, each in the track's order: by time, player and seq.
pub type Track = BTreeMap<String, Vec<Entry>>;

/// The track of `entries`, each arriving in the order given.
pub fn track_of(entries: &[Entry]) -> Track {
    let mut out: Track = BTreeMap::new();
    for (n, e) in entries.iter().enumerate() {
        let e = Entry {
            arrived: n as u64,
            ..e.clone()
        };
        out.entry(e.control.clone()).or_default().push(e);
    }
    for list in out.values_mut() {
        list.sort_by_key(|e| (e.t, e.player, e.seq));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #539: a pick entry's value is `u32 set, 4 zero bytes, i64 key[0], i64 key[1]`, read back
    /// from its track form; a number stays an f64.
    #[test]
    fn a_pick_value_lays_out_as_24_bytes() {
        let e =
            Entry::parse(&json!({"t": 0, "control": "place", "value": {"set": 1, "key": [-7, 3]}}))
                .expect("a pick entry");
        let mut want = 1u32.to_le_bytes().to_vec();
        want.extend([0; 4]);
        want.extend((-7i64).to_le_bytes());
        want.extend(3i64.to_le_bytes());
        assert_eq!(e.value.bytes(), want);
        assert_eq!(Entry::parse(&e.to_json()), Some(e));
        assert_eq!(Given::from(0.5).bytes(), 0.5f64.to_le_bytes().to_vec());
        assert_eq!(
            Entry::parse(&json!({"t": 0, "control": "place", "value": {"set": 8, "key": [0, 0]}})),
            None
        );
    }
}
