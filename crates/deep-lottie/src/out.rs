//! The document as the import builds it: its items, channels, constraints and data values, the
//! IDs each section has taken, the colors and the issues. A property is written once: its first
//! value into the item, and, when it is keyed, a channel whose keys keep Lottie's own times,
//! holds and Bézier eases. A property whose ease differs by dimension splits into one channel a
//! dimension.

use serde_json::{json, Map, Value};

use crate::colors::Colors;
use crate::ids::Ids;
use crate::read::{Key, Prop};

const FLICKS: f64 = 705_600_000.0;

/// What the document can't hold, or what the import left out, naming the layer.
#[derive(Clone, Debug, PartialEq)]
pub struct Issue {
    pub code: &'static str,
    pub layer: String,
    pub property: Option<String>,
    pub what: String,
}

impl Issue {
    pub fn to_json(&self) -> Value {
        let mut v = json!({"code": self.code, "layer": self.layer, "what": self.what});
        if let Some(p) = &self.property {
            v["property"] = json!(p);
        }
        v
    }
}

/// How a layer's own frames land on the root composition's: `offset + scale × t`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Time {
    pub offset: f64,
    pub scale: f64,
}

impl Time {
    pub const ROOT: Time = Time {
        offset: 0.0,
        scale: 1.0,
    };

    pub fn at(&self, t: f64) -> f64 {
        self.offset + self.scale * t
    }

    /// The time inside a layer that starts at `st` and stretches by `sr`.
    pub fn within(&self, st: f64, sr: f64) -> Time {
        Time {
            offset: self.at(st),
            scale: self.scale * sr,
        }
    }
}

/// A channel's type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ty {
    F32,
    Vec2,
}

pub struct Out {
    pub items: Map<String, Value>,
    pub channels: Map<String, Value>,
    pub constraints: Map<String, Value>,
    pub data: Map<String, Value>,
    pub collections: Map<String, Value>,
    pub markers: Map<String, Value>,
    pub issues: Vec<Issue>,
    pub ids: Ids,
    /// Channel, constraint and data names.
    pub names: Ids,
    pub colors: Colors,
    /// The file's frame rate, frames a second.
    pub fr: f64,
}

/// Sets `path` of `v` to `value`, making each object on the way.
pub fn put(v: &mut Value, path: &[&str], value: Value) {
    let Some((last, head)) = path.split_last() else {
        *v = value;
        return;
    };
    let mut at = v;
    for k in head {
        if !at.get(*k).is_some_and(Value::is_object) {
            at[*k] = json!({});
        }
        at = &mut at[*k];
    }
    at[*last] = value;
}

/// A number as JSON: a whole one as an integer, so a document reads as an author writes it.
pub fn n(x: f64) -> Value {
    let x = if x == 0.0 { 0.0 } else { x };
    if x.fract() == 0.0 && x.abs() < 9.0e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

pub fn ns(v: &[f64]) -> Value {
    Value::Array(v.iter().map(|x| n(*x)).collect())
}

/// A key's interp for dimension `d`: hold, linear, or Lottie's out and in handles as a Bézier;
/// `None` for linear, which a key leaves out.
pub fn interp<T>(k: &Key<T>, d: usize) -> Option<Value> {
    if k.hold {
        return Some(json!("hold"));
    }
    let (Some((x1, y1)), Some((x2, y2))) = (
        k.o.as_ref().and_then(|h| h.at(d)),
        k.i.as_ref().and_then(|h| h.at(d)),
    ) else {
        return None;
    };
    if (x1, y1, x2, y2) == (0.0, 0.0, 1.0, 1.0) {
        return None;
    }
    Some(
        json!({"bezier": {"x1": n(x1.clamp(0.0, 1.0)), "y1": n(y1), "x2": n(x2.clamp(0.0, 1.0)), "y2": n(y2)}}),
    )
}

/// Whether some key's ease differs between dimensions.
pub fn split<T>(keys: &[Key<T>]) -> bool {
    keys.iter().rev().skip(1).any(|k| {
        !k.hold
            && (k.o.as_ref().is_some_and(|h| !h.uniform())
                || k.i.as_ref().is_some_and(|h| !h.uniform()))
    })
}

fn key_id(i: usize, n: usize) -> String {
    let width = n.to_string().len().max(4);
    format!("k{i:0width$}")
}

impl Out {
    /// Flicks of a time in root frames, to the nearest flick.
    pub fn flicks(&self, frames: f64) -> i64 {
        (frames * FLICKS / self.fr).round() as i64
    }

    pub fn issue(
        &mut self,
        code: &'static str,
        layer: &str,
        property: Option<&str>,
        what: impl Into<String>,
    ) {
        let issue = Issue {
            code,
            layer: layer.to_string(),
            property: property.map(str::to_string),
            what: what.into(),
        };
        if !self.issues.contains(&issue) {
            self.issues.push(issue);
        }
    }

    pub fn item(&mut self, id: &str) -> &mut Value {
        self.items
            .entry(id.to_string())
            .or_insert_with(|| json!({}))
    }

    /// A channel named after `hint` on `target`, with `keys` as `{t, value, interp}` each.
    pub fn channel(
        &mut self,
        hint: &str,
        target: String,
        ty: &str,
        keys: Vec<(i64, Value, Option<Value>)>,
    ) {
        let id = self.names.take(hint, "channel");
        let count = keys.len();
        let keys: Map<String, Value> = keys
            .into_iter()
            .enumerate()
            .map(|(i, (t, value, interp))| {
                let mut k = json!({"t": t, "value": value});
                if let Some(interp) = interp {
                    k["interp"] = interp;
                }
                (key_id(i, count), k)
            })
            .collect();
        self.channels
            .insert(id, json!({"target": target, "type": ty, "keys": keys}));
    }

    /// Writes `prop` at `field` of item `id`: its first value into the item, and its keys as a
    /// channel of type `ty` (a vec2 whose ease differs by dimension as two f32 channels), at the
    /// times `time` puts its layer's frames.
    pub fn write(&mut self, id: &str, field: &[&str], ty: Ty, prop: &Prop, time: Time) {
        let first = prop.first().to_vec();
        let value = match ty {
            Ty::F32 => n(first.first().copied().unwrap_or(0.0)),
            Ty::Vec2 => ns(&first[..first.len().min(2)]),
        };
        put(self.item(id), field, value);
        self.keys(id, &field.join("/"), ty, prop, time);
    }

    /// One f32 channel a dimension of `prop`, dimension `d` on `<field>/<base + d>`: the parts
    /// of a list param, such as a rect's box.
    pub fn parts(&mut self, id: &str, field: &str, base: usize, prop: &Prop, time: Time) {
        let Prop::Keys(keys) = prop else { return };
        let dims = keys.first().map_or(0, |k| k.s.len());
        for d in 0..dims {
            let list = keys
                .iter()
                .map(|k| {
                    (
                        self.flicks(time.at(k.t)),
                        n(k.s.get(d).copied().unwrap_or(0.0)),
                        interp(k, d),
                    )
                })
                .collect();
            self.channel(
                &format!(
                    "{id}.{}.{}",
                    field.rsplit('/').next().unwrap_or("value"),
                    base + d
                ),
                format!("items/{id}/{field}/{}", base + d),
                "f32",
                list,
            );
        }
    }

    /// `prop`'s keys alone as a channel on `<field>` of item `id`, when it is keyed.
    pub fn keys(&mut self, id: &str, field: &str, ty: Ty, prop: &Prop, time: Time) {
        let Prop::Keys(keys) = prop else { return };
        let target = format!("items/{id}/{field}");
        let hint = format!(
            "{id}.{}",
            field
                .rsplit('/')
                .find(|p| p.parse::<usize>().is_err())
                .unwrap_or("value")
        );
        let at = |o: &Out, k: &Key<Vec<f64>>| o.flicks(time.at(k.t));
        match ty {
            Ty::F32 => {
                let list = keys
                    .iter()
                    .map(|k| {
                        (
                            at(self, k),
                            n(k.s.first().copied().unwrap_or(0.0)),
                            interp(k, 0),
                        )
                    })
                    .collect();
                self.channel(&hint, target, "f32", list);
            }
            Ty::Vec2 if split(keys) => {
                for d in 0..2 {
                    let list = keys
                        .iter()
                        .map(|k| {
                            (
                                at(self, k),
                                n(k.s.get(d).copied().unwrap_or(0.0)),
                                interp(k, d),
                            )
                        })
                        .collect();
                    self.channel(&format!("{hint}.{d}"), format!("{target}/{d}"), "f32", list);
                }
            }
            Ty::Vec2 => {
                let list = keys
                    .iter()
                    .map(|k| {
                        let v = [
                            k.s.first().copied().unwrap_or(0.0),
                            k.s.get(1).copied().unwrap_or(0.0),
                        ];
                        (at(self, k), ns(&v), interp(k, 0))
                    })
                    .collect();
                self.channel(&hint, target, "vec2", list);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::read::Handle;

    fn key(t: f64, s: Vec<f64>, o: (Vec<f64>, Vec<f64>), i: (Vec<f64>, Vec<f64>)) -> Key<Vec<f64>> {
        Key {
            t,
            s,
            hold: false,
            o: Some(Handle { x: o.0, y: o.1 }),
            i: Some(Handle { x: i.0, y: i.1 }),
            to: vec![],
            ti: vec![],
        }
    }

    #[test]
    fn an_ease_given_per_dimension_splits_the_channel_and_a_shared_one_does_not() {
        let shared = vec![
            key(
                0.0,
                vec![0.0, 0.0],
                (vec![0.4, 0.4], vec![0.0, 0.0]),
                (vec![0.6, 0.6], vec![1.0, 1.0]),
            ),
            key(10.0, vec![5.0, 6.0], (vec![], vec![]), (vec![], vec![])),
        ];
        assert!(!split(&shared));
        let apart = vec![
            key(
                0.0,
                vec![0.0, 0.0],
                (vec![0.4, 0.1], vec![0.0, 0.0]),
                (vec![0.6, 0.6], vec![1.0, 1.0]),
            ),
            key(10.0, vec![5.0, 6.0], (vec![], vec![]), (vec![], vec![])),
        ];
        assert!(split(&apart));
        assert_eq!(
            interp(&apart[0], 1),
            Some(json!({"bezier": {"x1": 0.1, "y1": 0, "x2": 0.6, "y2": 1}}))
        );
    }
}
