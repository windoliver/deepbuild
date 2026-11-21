//! #552: fog beyond rows (Net: this copy's player). A logic item may declare `fog: {grid:
//! <logic>.<name>, size: [cols, rows], origin, cell}`, an i32 array of two bits a player (0
//! unseen, 1 radar, 2 seen) over cells of the ground, row-major. On each copy, every reader of
//! that item's occurrences (bursts, Spawn voices, trails, paint stamps and a grid image mark) sees
//! only the rows this copy's player sees at the occurrence's point at its step: the gate takes the
//! others out of the drawn form's occurrence lists, so no reader on this copy ever reads them. An
//! occurrence kind declared `always_visible: true` is never gated. It's a courtesy: the grid is
//! the same on every copy, and nothing it gates enters a hash.

use serde_json::{Map, Value};

use deep_canvas::columns::{element_at, fog_state, match_me, FOG_SEEN};

/// One item's fog grid: its array, its cells and where they lie on the ground.
struct Grid<'a> {
    array: &'a Value,
    size: [i64; 2],
    origin: [f64; 2],
    cell: f64,
}

fn grid_of<'a>(params: &Value, arrays: &'a Map<String, Value>) -> Option<Grid<'a>> {
    let f = params.get("fog")?;
    let array = arrays.get(f.get("grid")?.as_str()?)?;
    let size = f.get("size")?.as_array()?;
    let size = [size.first()?.as_i64()?, size.get(1)?.as_i64()?];
    let cell = f.get("cell").and_then(Value::as_f64).unwrap_or(1.0);
    let origin = match f.get("origin").and_then(Value::as_array) {
        Some(o) => [o.first()?.as_f64()?, o.get(1)?.as_f64()?],
        None => [
            -(size[0] as f64) * cell / 2.0,
            -(size[1] as f64) * cell / 2.0,
        ],
    };
    Some(Grid {
        array,
        size,
        origin,
        cell,
    })
}

/// A row's point on the ground, `(x, z)`: its kind's first vec3 field (x, z), else its first
/// vec2 field.
fn point(kind: &Value, row: &Value) -> Option<[f64; 2]> {
    let fields = kind.get("fields")?.as_object()?;
    let of = |ty: &str| fields.iter().find(|(_, t)| *t == ty).map(|(n, _)| n);
    let (name, z) = match of("vec3") {
        Some(n) => (n, 2),
        None => (of("vec2")?, 1),
    };
    let p = row.get(name)?.as_array()?;
    Some([p.first()?.as_f64()?, p.get(z)?.as_f64()?])
}

/// Each gated list's rows this copy's player doesn't see, taken out of `occurrences` (the drawn
/// form's lists by `<logic>.occurrences`), by list. `items` are the form's items, `arrays` its
/// baked arrays and `me` its `match.me` view value.
pub fn gate(
    items: &Value,
    arrays: &Map<String, Value>,
    occurrences: &mut Map<String, Value>,
    me: &Value,
) -> Map<String, Value> {
    let mut out = Map::new();
    let me = match_me(me);
    if me.is_none() {
        return out;
    }
    for (id, item) in items.as_object().into_iter().flatten() {
        let params = &item["params"];
        let Some(g) = grid_of(params, arrays) else {
            continue;
        };
        let list = format!("{id}.occurrences");
        let Some(Value::Array(rows)) = occurrences.get_mut(&list) else {
            continue;
        };
        let (kept, fogged): (Vec<Value>, Vec<Value>) = rows.drain(..).partition(|row| {
            let kind = &params["emits"][row["kind"].as_str().unwrap_or_default()];
            if kind.get("always_visible") == Some(&Value::Bool(true)) {
                return true;
            }
            let Some([x, z]) = point(kind, row) else {
                return true;
            };
            let cx = ((x - g.origin[0]) / g.cell).floor() as i64;
            let cz = ((z - g.origin[1]) / g.cell).floor() as i64;
            if !(0..g.size[0]).contains(&cx) || !(0..g.size[1]).contains(&cz) {
                return true;
            }
            let t = row["t"].as_i64().unwrap_or(0);
            let index = (cz * g.size[0] + cx) as usize;
            let value = element_at(g.array, index, t).map_or(0.0, |(v, _)| v);
            fog_state(value as i64, me) == FOG_SEEN
        });
        *rows = kept;
        if !fogged.is_empty() {
            out.insert(list, Value::Array(fogged));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_copy_reads_only_the_occurrences_its_player_sees_at_their_point() {
        // A 2 × 1 grid: player 1 sees cell 0 only, player 2 cell 1 only.
        let items = json!({"war": {"params": {
            "fog": {"grid": "war.fog", "size": [2, 1], "origin": [0, 0], "cell": 1},
            "emits": {"boom": {"fields": {"p": "vec3"}}, "flag": {"fields": {"p": "vec3"}, "always_visible": true}}}}});
        let fog = json!({"type": "i32", "count": 2, "every": 10, "linear": false,
                         "steps": [{"step": 0, "changed": [[0, 2]], "values": [[0, [2, 8]]]}]});
        let arrays: Map<String, Value> = [("war.fog".to_string(), fog)].into_iter().collect();
        let rows = json!([{"t": 0, "kind": "boom", "p": [0.5, 0, 0.5]}, {"t": 0, "kind": "boom", "p": [1.5, 0, 0.5]},
                          {"t": 0, "kind": "flag", "p": [1.5, 0, 0.5]}]);
        for (me, kept) in [(json!(1), 2), (json!(2), 2), (json!("none"), 3)] {
            let mut lists: Map<String, Value> = [("war.occurrences".to_string(), rows.clone())]
                .into_iter()
                .collect();
            let fogged = gate(&items, &arrays, &mut lists, &me);
            assert_eq!(
                lists["war.occurrences"].as_array().unwrap().len(),
                kept,
                "{me}"
            );
            assert_eq!(fogged.len(), usize::from(kept == 2), "{me}");
        }
    }
}
