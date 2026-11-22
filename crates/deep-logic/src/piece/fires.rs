//! A logic item's `fires: {world ID → [input ID]}` (#194, #1834; canvas primitives: Logic
//! `logic@1`, its fire region).
//! Each fired input takes, in declaration order, a slot in the fire region at the exported global
//! `fires_at`: an i32 count, then one f64 for each number field its kind takes. The logic module
//! clears every count before a step, as it clears each emitted kind's; a step that leaves a count
//! above 0 fires its input once, with those fields as its data. The host that knows the world's
//! input kinds writes each input's fields (`{world: {input: [field]}}`); a list of input IDs alone
//! fires each with no data.

use serde_json::{json, Map, Value};

use super::Item;
use crate::world::Record;

/// One input an item may fire: its world, its ID and its number fields, in its slot's order.
#[derive(Clone, Debug, PartialEq)]
pub struct Fire {
    pub world: String,
    pub input: String,
    pub fields: Vec<String>,
}

impl Fire {
    /// Its slot's bytes: the count and each field.
    pub fn size(&self) -> u32 {
        4 + 8 * self.fields.len() as u32
    }
}

/// The inputs an item's `fires` lists, or why it can't be read.
pub fn declared(v: Option<&Value>) -> Result<Vec<Fire>, String> {
    let bad = || "fires maps each world ID to the IDs of the inputs it may fire".to_string();
    let Some(v) = v else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (world, inputs) in v.as_object().ok_or_else(bad)? {
        let fire = |input: &str, fields: Vec<String>| Fire {
            world: world.clone(),
            input: input.into(),
            fields,
        };
        match inputs {
            Value::Array(list) => {
                for i in list {
                    out.push(fire(i.as_str().ok_or_else(bad)?, Vec::new()));
                }
            }
            Value::Object(o) => {
                for (input, fields) in o {
                    let fields = fields
                        .as_array()
                        .and_then(|f| f.iter().map(|n| n.as_str().map(str::to_string)).collect())
                        .ok_or_else(bad)?;
                    out.push(fire(input, fields));
                }
            }
            _ => return Err(bad()),
        }
    }
    Ok(out)
}

/// The fire region's size.
pub fn size(fires: &[Fire]) -> u32 {
    fires.iter().map(Fire::size).sum()
}

/// Clears every count an item's step may set, its emitted kinds' and its fires', noting the pages.
pub(crate) fn clear(item: &Item, memory: &mut [u8], touched: &mut Vec<u64>, page: u64) {
    let mut at = item.emits_at as usize;
    for e in &item.emits {
        memory[at..at + 4].fill(0);
        touched.push(at as u64 / page);
        at += e.size() as usize;
    }
    let mut at = item.fires_at as usize;
    for f in &item.fires {
        memory[at..at + 4].fill(0);
        touched.push(at as u64 / page);
        at += f.size() as usize;
    }
}

/// What a step fired: each input whose count it left above 0, with its fields as its data.
pub(crate) fn fired(item: &Item, memory: &[u8]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut at = item.fires_at as usize;
    for f in &item.fires {
        let count = i32::from_le_bytes(memory[at..at + 4].try_into().expect("4 bytes"));
        if count > 0 {
            let data: Map<String, Value> = f
                .fields
                .iter()
                .enumerate()
                .map(|(j, name)| {
                    let b = &memory[at + 4 + 8 * j..][..8];
                    (
                        name.clone(),
                        json!(f64::from_le_bytes(b.try_into().expect("8 bytes"))),
                    )
                })
                .collect();
            out.push(json!({"world": f.world, "input": f.input, "data": data}));
        }
        at += f.size() as usize;
    }
    out
}

/// Keeps a step's fires in its row as `<item ID>.fires`, beside its arrays' hashes.
pub(crate) fn record(rec: &mut Record, item: &Item, k: i64, fires: Vec<Value>) {
    if !fires.is_empty() {
        let (_, arrays) = rec.steps.entry(k).or_default();
        arrays.insert(format!("{}.fires", item.id), Value::Array(fires));
    }
}

/// Every fire of a bake, in step order: `{item, step, t, world, input, data}`, `t` in flicks.
pub fn of(rec: &Record, items: &[Item]) -> Vec<Value> {
    let mut out = Vec::new();
    for item in items.iter().filter(|i| !i.fires.is_empty()) {
        let name = format!("{}.fires", item.id);
        for (k, (_, arrays)) in &rec.steps {
            for f in arrays
                .get(&name)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let mut row = json!({"item": item.id, "step": k, "t": k * item.step});
                if let (Some(o), Some(fire)) = (row.as_object_mut(), f.as_object()) {
                    o.extend(fire.clone());
                }
                out.push(row);
            }
        }
    }
    out.sort_by_key(|r| (r["t"].as_i64(), r["item"].as_str().map(str::to_string)));
    out
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use serde_json::json;

    use crate::piece::{check, History};
    use crate::world::{track_of, Record, World};

    /// A program that marks a fire of `lab.jump` at step 3 with a height of 1.5, and at no other.
    const FIRES_AT_3: &str = r#"(module (memory (export "memory") 1 1)
        (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
        (global (export "fires_at") i32 (i32.const 2048))
        (func (export "init") (param $seed i64))
        (func (export "step") (param $k i64)
          (if (i64.eq (local.get $k) (i64.const 3))
            (then (i32.store (i32.const 2048) (i32.const 1)) (f64.store (i32.const 2052) (f64.const 1.5))))))"#;

    #[test]
    fn a_step_that_leaves_a_count_fires_its_input_once_with_its_fields() {
        let bytes = wat::parse_str(FIRES_AT_3).expect("the program assembles");
        let sha = deep_canvas_sandbox::rewrite::hash(&bytes);
        let params =
            json!({"program": sha, "step_rate": 60, "fires": {"lab": {"jump": ["height"]}}});
        let piece = json!({"seed": 194, "items": {"rules": {"kind": "logic@1", "params": params}},
                           "assets": {&sha: B64.encode(&bytes)}});
        let piece = std::rc::Rc::new(
            check(&piece, &Default::default(), &mut History::new()).expect("it checks"),
        );
        let mut rec = Record::default();
        let mut w = World::new(
            piece.clone(),
            track_of(&[]),
            false,
            Default::default(),
            &mut rec,
            None,
        )
        .expect("a world");
        w.run(10, &mut rec, &mut |_, _| {});
        let fires = super::of(&rec, &piece.items);
        let len = piece.items[0].step;
        assert_eq!(
            fires,
            vec![
                json!({"item": "rules", "step": 3, "t": 3 * len, "world": "lab", "input": "jump", "data": {"height": 1.5}})
            ]
        );
    }

    #[test]
    fn an_item_that_fires_and_exports_no_fires_at_is_refused() {
        let bytes = wat::parse_str(
            &FIRES_AT_3.replace(r#"(global (export "fires_at") i32 (i32.const 2048))"#, ""),
        )
        .expect("it assembles");
        let sha = deep_canvas_sandbox::rewrite::hash(&bytes);
        let params = json!({"program": sha, "fires": {"lab": ["jump"]}});
        let piece = json!({"seed": 194, "items": {"rules": {"kind": "logic@1", "params": params}},
                           "assets": {&sha: B64.encode(&bytes)}});
        let refused = check(&piece, &Default::default(), &mut History::new()).expect_err("refused");
        assert!(refused.0.to_string().contains("fires_at"), "{}", refused.0);
    }
}
