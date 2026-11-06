//! Light receivers, casters and distributions at check (#446; canvas primitives: Light:
//! receivers, Light: casters, Light: IES distribution): each distinct set of collections takes a
//! bit, every solid carries the bits of the sets it belongs to, and each light the bit of its own,
//! so the light loop skips a light with one AND and a shadow pass culls by one test.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use deep_canvas::budget::Class;
use serde_json::{Map, Value};

use crate::ies::{self, Distribution};
use crate::light::{
    Contact, LampTable, Light, LightKind, Shadowing, Soft, MOST_POINTS, MOST_SPOTS,
};
use crate::scene::{num, Assets, Layer3, Refused};

const DEFAULT_LUMENS: f64 = 800.0;

/// `budget.receiver_sets` and `budget.caster_sets`' ceiling per document.
pub const MOST_SETS: u64 = 32;

fn refused<T>(code: &'static str, path: String) -> Result<T, Refused> {
    Err(Refused { code, path })
}

/// A `receivers` or `casters` field: `collection | [collection] | all`, sorted, empty for all.
fn names(v: Option<&Value>, path: &str) -> Result<Vec<String>, Refused> {
    let mut out: Vec<String> = match v {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::String(s)) if s == "all" => Vec::new(),
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .map(|n| n.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or(Refused {
                code: "out_of_range",
                path: path.to_string(),
            })?,
        Some(_) => return refused("out_of_range", path.to_string()),
    };
    out.sort();
    out.dedup();
    Ok(out)
}

/// A light's `receivers`, `casters`, `distribution`, `distribution_rotation` and `power:
/// from_file`, read into `light`; `tables` gathers the document's distributions, one per hash.
pub fn read_light(
    light: Option<&mut Light>,
    params: &Value,
    path: &str,
    doc: &Map<String, Value>,
    tables: &mut Vec<Arc<Distribution>>,
    assets: Option<Assets<'_>>,
) -> Result<(), Refused> {
    let Some(l) = light else { return Ok(()) };
    let field = |k: &str| format!("{path}/{k}");
    l.receivers = names(params.get("receivers"), &field("receivers"))?;
    l.casters = names(params.get("casters"), &field("casters"))?;
    let from_file = params.get("power").and_then(Value::as_str) == Some("from_file");
    let Some(sha) = params.get("distribution").filter(|d| !d.is_null()) else {
        return match from_file {
            true => refused("out_of_range", field("power")),
            false => Ok(()),
        };
    };
    // Never a URL or a path: a distribution comes by its hash from the document's assets.
    let sha = sha
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or(Refused {
            code: "out_of_range",
            path: field("distribution"),
        })?;
    if l.kind == LightKind::Sun {
        return refused("out_of_range", field("distribution"));
    }
    let layer = match tables.iter().position(|t| t.sha == sha) {
        Some(i) => i,
        None => {
            let Some(bytes) = assets.and_then(|a| a(sha)) else {
                return refused("asset_missing", field("distribution"));
            };
            let table = parsed(sha, &bytes).or(refused("out_of_range", field("distribution")))?;
            let cap = doc
                .get("budget")
                .and_then(|b| b.get("distributions"))
                .and_then(Value::as_u64)
                .unwrap_or(ies::MOST as u64);
            if tables.len() as u64 >= cap.min(ies::MOST as u64) {
                return refused("out_of_range", "budget/distributions".to_string());
            }
            tables.push(table);
            tables.len() - 1
        }
    };
    let table = &tables[layer];
    if from_file {
        // The reader took the default's 800 lm; the range follows the lumens the file states.
        l.intensity *= table.lumens / DEFAULT_LUMENS;
        if params.get("range").is_none() {
            l.range *= (table.lumens / DEFAULT_LUMENS).sqrt();
        }
    }
    // A spot clips the table to its cone and keeps its flux inside it; an area's face sends its
    // flux as Lambert does, which the table reshapes.
    let share = match l.kind {
        LightKind::Spot => table.share(l.cone[0]).max(1e-6),
        LightKind::Area => table.over_face().max(1e-6),
        _ => 1.0,
    };
    l.distribution = Some(LampTable {
        layer: layer as u32,
        scale: 1.0 / share,
        clipped: if l.kind == LightKind::Spot {
            1.0 - share
        } else {
            0.0
        },
    });
    // Its rotation turns the frame the table is read in, about the light's axis.
    let turn = num(params.get("distribution_rotation"))
        .unwrap_or(0.0)
        .to_radians();
    let (c, s) = (turn.cos(), turn.sin());
    let [x, y] = l.axes;
    l.axes = [
        std::array::from_fn(|k| c * x[k] + s * y[k]),
        std::array::from_fn(|k| c * y[k] - s * x[k]),
    ];
    Ok(())
}

/// `bytes` parsed once per hash, however many frames read them.
fn parsed(sha: &str, bytes: &[u8]) -> Result<Arc<Distribution>, &'static str> {
    static SEEN: Mutex<BTreeMap<String, Arc<Distribution>>> = Mutex::new(BTreeMap::new());
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = seen.get(sha) {
        return Ok(t.clone());
    }
    let table = Arc::new(ies::parse(sha, &String::from_utf8_lossy(bytes))?);
    seen.insert(sha.to_string(), table.clone());
    Ok(table)
}

/// The ids a list of collections holds; an unknown name is `ref_unresolved` at `path`.
fn members<'a>(
    doc: &'a Map<String, Value>,
    list: &[String],
    path: &str,
) -> Result<BTreeSet<&'a str>, Refused> {
    let mut out = BTreeSet::new();
    for name in list {
        let Some(m) = doc
            .get("collections")
            .and_then(|c| c.get(name))
            .and_then(|c| c.get("members"))
            .and_then(Value::as_array)
        else {
            return refused("ref_unresolved", path.to_string());
        };
        out.extend(m.iter().filter_map(Value::as_str));
    }
    Ok(out)
}

/// Whether `id`, the item it's a part of or any of that item's parents is in `set`.
fn holds(items: Option<&Map<String, Value>>, set: &BTreeSet<&str>, id: &str) -> bool {
    let mut at = id.split('#').next();
    let mut steps = 0;
    while let Some(i) = at {
        if set.contains(i) {
            return true;
        }
        steps += 1;
        at = items
            .and_then(|m| m.get(i))
            .and_then(|item| item.get("parent"))
            .and_then(Value::as_str)
            .filter(|_| steps < 4096);
    }
    false
}

/// Each light's bit by its index, and the distinct lists the bits stand for.
type Bits = (BTreeMap<usize, u32>, Vec<Vec<String>>);

/// One kind of set: its distinct lists, each a bit by first use, capped by `budget/<key>`.
fn bits(
    doc: &Map<String, Value>,
    key: &str,
    lists: impl Iterator<Item = (usize, Vec<String>)>,
) -> Result<Bits, Refused> {
    let cap = doc
        .get("budget")
        .and_then(|b| b.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(MOST_SETS);
    if cap > MOST_SETS {
        return refused("out_of_range", format!("budget/{key}"));
    }
    let (mut of, mut sets) = (BTreeMap::new(), Vec::<Vec<String>>::new());
    for (light, list) in lists.filter(|(_, l)| !l.is_empty()) {
        let k = match sets.iter().position(|s| *s == list) {
            Some(k) => k,
            None => {
                sets.push(list);
                sets.len() - 1
            }
        };
        if sets.len() as u64 > cap {
            return refused("out_of_range", format!("budget/{key}"));
        }
        of.insert(light, 1u32 << k);
    }
    Ok((of, sets))
}

/// Gives each light its sets' bits and each solid the bits of the sets it belongs to.
pub fn compile(
    doc: &Map<String, Value>,
    lights: &mut [Light],
    layers: &mut [Layer3],
) -> Result<(), Refused> {
    let list = |f: fn(&Light) -> &Vec<String>, lights: &[Light]| {
        lights
            .iter()
            .enumerate()
            .map(|(i, l)| (i, f(l).clone()))
            .collect::<Vec<_>>()
    };
    let (receive, receive_sets) = bits(
        doc,
        "receiver_sets",
        list(|l| &l.receivers, lights).into_iter(),
    )?;
    let (cast, cast_sets) = bits(doc, "caster_sets", list(|l| &l.casters, lights).into_iter())?;
    if receive_sets.is_empty() && cast_sets.is_empty() {
        return Ok(());
    }
    for (i, l) in lights.iter_mut().enumerate() {
        l.receiver_bit = receive.get(&i).copied().unwrap_or(0);
        l.caster_bit = cast.get(&i).copied().unwrap_or(0);
    }
    let items = doc.get("items").and_then(Value::as_object);
    let resolve = |sets: &[Vec<String>], key: &str| {
        sets.iter()
            .map(|s| members(doc, s, &format!("items/{key}")))
            .collect::<Result<Vec<_>, _>>()
    };
    let receive_sets = resolve(&receive_sets, "receivers")?;
    let cast_sets = resolve(&cast_sets, "casters")?;
    let word = |sets: &[BTreeSet<&str>], id: &str| {
        sets.iter()
            .enumerate()
            .filter(|(_, s)| holds(items, s, id))
            .fold(0u32, |w, (k, _)| w | 1 << k)
    };
    for s in layers.iter_mut().flat_map(|l| &mut l.solids) {
        s.receiver_sets = word(&receive_sets, &s.id);
        s.caster_sets = word(&cast_sets, &s.id);
    }
    Ok(())
}

/// The document's light policy (`light_policy`): its soft shadows, contact shadows and local
/// shadows, each refused at its field.
pub fn policy(doc: &Map<String, Value>) -> Result<Shadowing, Refused> {
    let Some(p) = doc.get("light_policy") else {
        return Ok(Shadowing::default());
    };
    let mut out = Shadowing::named();
    let bad = |k: &str| Refused {
        code: "out_of_range",
        path: format!("light_policy/{k}"),
    };
    // A field by its path under the policy, read from the object holding it.
    let uint = |o: &Value, k: &str, d: u64, most: u64| -> Result<u64, Refused> {
        match o.get(k.rsplit('/').next().unwrap_or(k)) {
            None => Ok(d),
            Some(v) => v.as_u64().filter(|n| *n <= most).ok_or(bad(k)),
        }
    };
    if let Some(s) = p.get("soft").filter(|s| s.is_object()) {
        let pcss = match s.get("method").and_then(Value::as_str) {
            None | Some("pcss") => true,
            Some("pcf") => false,
            Some(_) => return Err(bad("soft/method")),
        };
        let filter_taps = uint(s, "soft/filter_taps", 16, 32)? as u32;
        if filter_taps != 16 && filter_taps != 32 {
            return Err(bad("soft/filter_taps"));
        }
        out.soft = Some(Soft {
            pcss,
            blocker_taps: uint(s, "soft/blocker_taps", 16, 255)?.max(1) as u32,
            filter_taps,
            max_penumbra: num(s.get("max_penumbra")).unwrap_or(32.0).max(1.0),
        });
    }
    if let Some(c) = p.get("contact").filter(|c| c.is_object()) {
        out.contact = Some(Contact {
            length: num(c.get("length")).filter(|l| *l > 0.0).unwrap_or(0.3),
            samples: uint(c, "contact/samples", 16, 255)?.max(1) as u32,
        });
    }
    if let Some(s) = p.get("shadowed") {
        if uint(s, "shadowed/sun", 1, 1)? != 1 {
            return Err(bad("shadowed/sun"));
        }
        out.spots = uint(s, "shadowed/spots", 2, MOST_SPOTS as u64)? as usize;
        out.points = uint(s, "shadowed/points", 0, MOST_POINTS as u64)? as usize;
    }
    // The classes the Cost lines name: soft shadows from a figure up, local maps from a work
    // product up. A class below them keeps the tent, and its shadows are reported as dropped.
    let class = doc
        .get("budget")
        .and_then(|b| b.get("class"))
        .and_then(Value::as_str)
        .and_then(Class::parse);
    if matches!(class, Some(Class::CoreView | Class::DataView)) {
        out.soft = None;
        out.contact = None;
    }
    if matches!(
        class,
        Some(Class::CoreView | Class::DataView | Class::Figure)
    ) {
        out.spots = 0;
        out.points = 0;
    }
    out.local_map = uint(p, "local_map", 512, 4096)?.max(16) as u32;
    out.cache = match p.get("cache").and_then(Value::as_str) {
        None | Some("static") => true,
        Some("none") => false,
        Some(_) => return Err(bad("cache")),
    };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(v: Value) -> Map<String, Value> {
        v.as_object().expect("an object").clone()
    }

    fn lamp(receivers: Value) -> Light {
        let axes = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let params = json!({"receivers": receivers});
        let mut l = crate::light::light(
            "l",
            "light.point@1",
            &params,
            [0.0; 3],
            [0.0, -1.0, 0.0],
            axes,
            1.0,
        )
        .expect("a light");
        let doc = Map::new();
        read_light(
            Some(&mut l),
            &params,
            "items/l/params",
            &doc,
            &mut Vec::new(),
            None,
        )
        .expect("its sets");
        l
    }

    #[test]
    fn the_same_sets_share_a_bit_and_a_document_can_hold_32() {
        let doc = map(json!({"collections": {
            "a": {"members": ["x"]}, "b": {"members": ["y"]},
        }}));
        let mut lights = vec![
            lamp(json!("a")),
            lamp(json!(["a"])),
            lamp(json!(["b", "a"])),
        ];
        compile(&doc, &mut lights, &mut []).expect("three lights, two sets");
        assert_eq!(lights[0].receiver_bit, lights[1].receiver_bit);
        assert_ne!(lights[0].receiver_bit, lights[2].receiver_bit);

        let doc = map(json!({"budget": {"receiver_sets": 1}, "collections": {
            "a": {"members": ["x"]}, "b": {"members": ["y"]},
        }}));
        let mut lights = vec![lamp(json!("a")), lamp(json!("b"))];
        let over = compile(&doc, &mut lights, &mut []).unwrap_err();
        assert_eq!(over.path, "budget/receiver_sets");

        let doc = map(json!({"budget": {"caster_sets": 33}}));
        let over = compile(&doc, &mut [], &mut []).unwrap_err();
        assert_eq!(over.path, "budget/caster_sets");
    }

    #[test]
    fn an_unknown_collection_and_a_path_for_a_table_are_refused() {
        let doc = map(json!({"collections": {}}));
        let mut lights = vec![lamp(json!("nothing"))];
        let refused = compile(&doc, &mut lights, &mut []).unwrap_err();
        assert_eq!(refused.code, "ref_unresolved");

        let mut l = lamp(json!("all"));
        let params = json!({"distribution": "/etc/lamp.ies"});
        let got = read_light(
            Some(&mut l),
            &params,
            "p",
            &Map::new(),
            &mut Vec::new(),
            None,
        );
        assert_eq!(got.unwrap_err().path, "p/distribution");
    }

    #[test]
    fn a_policy_takes_the_design_defaults_and_a_class_caps_it() {
        let none = policy(&Map::new()).expect("a document without one");
        assert_eq!(none, Shadowing::default());
        let named = policy(&map(json!({"light_policy": {}}))).expect("an empty policy");
        assert_eq!((named.soft.map(|s| s.pcss), named.spots), (Some(true), 2));
        let figure = map(json!({"budget": {"class": "figure"},
            "light_policy": {"shadowed": {"spots": 2, "points": 1}}}));
        let capped = policy(&figure).expect("a figure");
        assert!(capped.soft.is_some());
        assert_eq!((capped.spots, capped.points), (0, 0));
        let over = map(json!({"light_policy": {"shadowed": {"points": 5}}}));
        assert_eq!(
            policy(&over).unwrap_err().path,
            "light_policy/shadowed/points"
        );
    }
}
