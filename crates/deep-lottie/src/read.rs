//! Reading Lottie 1.0.1's values: an animated property's static value or its keys, a Bézier
//! shape, and the slots a property may name by `sid`. An expression (`x`) is never read as code:
//! the reader keeps the property's own `k` and reports that one was there.

use serde_json::{Map, Value};

pub type Obj = Map<String, Value>;

/// A key's ease handle for each dimension: `x` and `y` as Lottie writes them, one per dimension
/// or one for all.
#[derive(Clone, Debug, PartialEq)]
pub struct Handle {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
}

impl Handle {
    /// The handle's `(x, y)` for dimension `d`, the last one given when the list is shorter.
    pub fn at(&self, d: usize) -> Option<(f64, f64)> {
        let pick = |v: &[f64]| v.get(d).or(v.last()).copied();
        Some((pick(&self.x)?, pick(&self.y)?))
    }

    /// Whether every dimension shares one handle.
    pub fn uniform(&self) -> bool {
        let same = |v: &[f64]| v.windows(2).all(|w| w[0] == w[1]);
        same(&self.x) && same(&self.y)
    }
}

/// One key of an animated property, at a time in its layer's frames.
#[derive(Clone, Debug, PartialEq)]
pub struct Key<T> {
    pub t: f64,
    pub s: T,
    pub hold: bool,
    /// The ease of the segment to the next key: its out handle and the next key's in handle.
    pub o: Option<Handle>,
    pub i: Option<Handle>,
    /// A position's spatial tangents, relative to this key's value and to the next key's.
    pub to: Vec<f64>,
    pub ti: Vec<f64>,
}

/// A numeric property: one value, or its keys in time order.
#[derive(Clone, Debug, PartialEq)]
pub enum Prop {
    Fixed(Vec<f64>),
    Keys(Vec<Key<Vec<f64>>>),
}

impl Prop {
    /// The value at the first key, or the fixed value.
    pub fn first(&self) -> &[f64] {
        match self {
            Prop::Fixed(v) => v,
            Prop::Keys(k) => k.first().map_or(&[][..], |k| &k.s),
        }
    }

    pub fn keyed(&self) -> bool {
        matches!(self, Prop::Keys(k) if k.len() > 1)
    }

    /// Dimension `d` of the first value, or `or` when there is none.
    pub fn at(&self, d: usize, or: f64) -> f64 {
        self.first().get(d).copied().unwrap_or(or)
    }

    /// The property with each value mapped by `f`, keys and eases kept.
    pub fn map(&self, f: impl Fn(&[f64]) -> Vec<f64>) -> Prop {
        match self {
            Prop::Fixed(v) => Prop::Fixed(f(v)),
            Prop::Keys(keys) => Prop::Keys(
                keys.iter()
                    .map(|k| Key {
                        s: f(&k.s),
                        ..k.clone()
                    })
                    .collect(),
            ),
        }
    }

    /// One key, or no keys, reads as its one value.
    fn settled(self) -> Prop {
        match self {
            Prop::Keys(k) if k.len() == 1 => {
                Prop::Fixed(k.into_iter().next().map(|k| k.s).unwrap_or_default())
            }
            other => other,
        }
    }
}

/// One sub-path of a Bézier shape: its vertices and their in and out tangents, relative to each
/// vertex as Lottie writes them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Bez {
    pub v: Vec<[f64; 2]>,
    pub i: Vec<[f64; 2]>,
    pub o: Vec<[f64; 2]>,
    pub closed: bool,
}

/// A shape property: one shape, or its keys.
#[derive(Clone, Debug, PartialEq)]
pub enum ShapeProp {
    Fixed(Bez),
    Keys(Vec<Key<Bez>>),
}

/// What reading a property found besides its value: an expression, which is never kept.
#[derive(Default)]
pub struct Found {
    pub expressions: Vec<String>,
    /// A property that names a slot the file doesn't hold.
    pub missing_slots: Vec<String>,
}

/// The file's slots (Lottie 1.0.1: a property with `sid` takes the slot's `p`).
pub struct Reader<'a> {
    pub slots: Option<&'a Obj>,
    pub found: Found,
}

pub fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn nums(v: &Value) -> Option<Vec<f64>> {
    match v {
        Value::Number(_) => Some(vec![num(Some(v))?]),
        Value::Array(a) => a.iter().map(|x| num(Some(x))).collect(),
        _ => None,
    }
}

fn handle(v: Option<&Value>) -> Option<Handle> {
    let v = v?;
    Some(Handle {
        x: nums(v.get("x")?)?,
        y: nums(v.get("y")?)?,
    })
}

fn pair(v: &Value) -> Option<[f64; 2]> {
    let a = v.as_array()?;
    Some([num(a.first())?, num(a.get(1))?])
}

/// A Bézier shape's `{c, v, i, o}`; a list of one, as some writers wrap it, reads the same.
pub fn bez(v: &Value) -> Option<Bez> {
    let v = match v {
        Value::Array(a) if a.len() == 1 => &a[0],
        other => other,
    };
    let list =
        |k: &str| -> Option<Vec<[f64; 2]>> { v.get(k)?.as_array()?.iter().map(pair).collect() };
    let vs = list("v")?;
    let n = vs.len();
    let fill = |l: Option<Vec<[f64; 2]>>| {
        let mut l = l.unwrap_or_default();
        l.resize(n, [0.0, 0.0]);
        l
    };
    Some(Bez {
        i: fill(list("i")),
        o: fill(list("o")),
        v: vs,
        closed: v.get("c").and_then(Value::as_bool).unwrap_or(false),
    })
}

impl<'a> Reader<'a> {
    pub fn new(root: &'a Obj) -> Reader<'a> {
        Reader {
            slots: root.get("slots").and_then(Value::as_object),
            found: Found::default(),
        }
    }

    /// The property at `key` of `owner`, its slot resolved; `what` names it in any finding.
    fn raw<'v>(&mut self, owner: &'v Obj, key: &str, what: &str) -> Option<&'v Value>
    where
        'a: 'v,
    {
        let mut p = owner.get(key)?;
        if let Some(sid) = p.get("sid").and_then(Value::as_str) {
            match self.slots.and_then(|s| s.get(sid)).and_then(|s| s.get("p")) {
                Some(slot) => p = slot,
                None => {
                    self.found.missing_slots.push(what.to_string());
                    return None;
                }
            }
            // A slot's expression is reported by the property that reads it; its layer's own
            // are found by the layer's walk. Its text is never read.
            if p.get("x").is_some_and(Value::is_string) {
                self.found.expressions.push(format!("{what} (slot {sid})"));
            }
        }
        Some(p)
    }

    /// A numeric property, or `None` where the file has none.
    pub fn prop(&mut self, owner: &Obj, key: &str, what: &str) -> Option<Prop> {
        let p = self.raw(owner, key, what)?;
        let Some(k) = p.get("k") else {
            // A bare number or list, as some writers give a static value.
            return nums(p).map(Prop::Fixed);
        };
        let keyed = p.get("a").and_then(Value::as_f64) == Some(1.0)
            || k.as_array()
                .is_some_and(|a| a.first().is_some_and(Value::is_object));
        if !keyed {
            return nums(k).map(Prop::Fixed);
        }
        let list = k.as_array()?;
        let mut keys: Vec<Key<Vec<f64>>> = Vec::with_capacity(list.len());
        for (n, key) in list.iter().enumerate() {
            let t = num(key.get("t"))?;
            // Before 5.5 a key held its end value `e`, and the last key no `s`.
            let s = match key.get("s").and_then(nums) {
                Some(s) => s,
                None => match n
                    .checked_sub(1)
                    .and_then(|p| list[p].get("e"))
                    .and_then(nums)
                {
                    Some(e) => e,
                    None => keys.last().map(|k| k.s.clone())?,
                },
            };
            keys.push(Key {
                t,
                s,
                hold: key.get("h").and_then(Value::as_f64) == Some(1.0),
                o: handle(key.get("o")),
                i: handle(key.get("i")),
                to: key.get("to").and_then(nums).unwrap_or_default(),
                ti: key.get("ti").and_then(nums).unwrap_or_default(),
            });
        }
        keys.sort_by(|a, b| a.t.total_cmp(&b.t));
        Some(Prop::Keys(keys).settled())
    }

    /// A shape property (a path's `ks`, a mask's `pt`).
    pub fn shape(&mut self, owner: &Obj, key: &str, what: &str) -> Option<ShapeProp> {
        let p = self.raw(owner, key, what)?;
        let k = p.get("k")?;
        let keyed = p.get("a").and_then(Value::as_f64) == Some(1.0)
            || k.as_array()
                .is_some_and(|a| a.first().is_some_and(|f| f.get("t").is_some()));
        if !keyed {
            return bez(k).map(ShapeProp::Fixed);
        }
        let list = k.as_array()?;
        let mut keys: Vec<Key<Bez>> = Vec::with_capacity(list.len());
        for (n, key) in list.iter().enumerate() {
            let t = num(key.get("t"))?;
            let s = match key.get("s").and_then(bez) {
                Some(s) => s,
                None => match n
                    .checked_sub(1)
                    .and_then(|p| list[p].get("e"))
                    .and_then(bez)
                {
                    Some(e) => e,
                    None => keys.last().map(|k| k.s.clone())?,
                },
            };
            keys.push(Key {
                t,
                s,
                hold: key.get("h").and_then(Value::as_f64) == Some(1.0),
                o: handle(key.get("o")),
                i: handle(key.get("i")),
                to: Vec::new(),
                ti: Vec::new(),
            });
        }
        keys.sort_by(|a, b| a.t.total_cmp(&b.t));
        // A key with no vertices draws nothing: it holds its neighbour's shape, the one before
        // it, or the first one after it.
        if let Some(first) = keys.iter().find(|k| !k.s.v.is_empty()).map(|k| k.s.clone()) {
            let mut last = first;
            for k in &mut keys {
                if k.s.v.is_empty() {
                    k.s = last.clone();
                } else {
                    last = k.s.clone();
                }
            }
        }
        match keys.len() {
            0 => None,
            1 => keys.pop().map(|k| ShapeProp::Fixed(k.s)),
            _ => Some(ShapeProp::Keys(keys)),
        }
    }

    /// A number property's first value, or `or`.
    pub fn number(&mut self, owner: &Obj, key: &str, what: &str, or: f64) -> f64 {
        self.prop(owner, key, what).map_or(or, |p| p.at(0, or))
    }
}

/// Whether `text` reads as script: what an expression is written in. A name a file gives is kept
/// only when it doesn't.
pub fn scriptlike(text: &str) -> bool {
    const WORDS: [&str; 7] = [
        "thisComp",
        "thisLayer",
        "thisProperty",
        "valueAtTime",
        "loopOut",
        "loopIn",
        "$bm_",
    ];
    text.contains([';', '{', '}', '=', '`'])
        || WORDS.iter().any(|w| text.contains(w))
        || text
            .as_bytes()
            .windows(2)
            .any(|w| (w[0].is_ascii_alphanumeric() || w[0] == b'_') && w[1] == b'(')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read(v: Value) -> (Option<Prop>, Found) {
        let root = Obj::new();
        let mut r = Reader::new(&root);
        let owner = json!({ "p": v });
        let p = r.prop(owner.as_object().unwrap(), "p", "p");
        (p, r.found)
    }

    #[test]
    fn an_expression_keeps_the_static_value_and_a_slots_is_reported_by_its_reader() {
        let (p, _) = read(json!({"a": 0, "k": [3, 4], "x": "wiggle(2, 10)"}));
        assert_eq!(p, Some(Prop::Fixed(vec![3.0, 4.0])));
        let root = json!({"slots": {"pos": {"p": {"a": 0, "k": [1, 2], "x": "time"}}}});
        let mut r = Reader::new(root.as_object().unwrap());
        let owner = json!({"p": {"sid": "pos"}});
        let p = r.prop(owner.as_object().unwrap(), "p", "transform/p");
        assert_eq!(
            (p, r.found.expressions),
            (
                Some(Prop::Fixed(vec![1.0, 2.0])),
                vec!["transform/p (slot pos)".to_string()]
            )
        );
    }

    #[test]
    fn old_keys_take_their_end_value_from_the_key_before() {
        let (p, _) = read(json!({"a": 1, "k": [{"t": 0, "s": [1], "e": [5]}, {"t": 10}]}));
        let Some(Prop::Keys(keys)) = p else {
            panic!("keys")
        };
        assert_eq!(keys[1].s, vec![5.0]);
    }

    #[test]
    fn script_reads_as_script_and_a_plain_name_does_not() {
        assert!(scriptlike("loopOut('cycle')"));
        assert!(scriptlike("var a = 1;"));
        assert!(!scriptlike("Shape Layer 1 (copy)"));
        assert!(!scriptlike("intro"));
    }
}
