//! Issue #467: the terrain recipe `tiles.terrain@1` (canvas primitives: Mark set: atlas tiles;
//! Mark set: hex grid). It expands at check into one `marks@1` image set on the atlas: each cell
//! takes a tile whose labels match what its neighbors give it, and among equal candidates the one
//! a hash of the seed and the cell's own key picks, so adding a cell never reseeds another. An
//! edge, side or corner with no neighbor expects the cell's own terrain.

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::scene::{num, Refused};

/// The recipe's kind.
pub const KIND: &str = "tiles.terrain@1";

fn bad(path: String) -> Refused {
    Refused {
        code: "bad_doc",
        path,
    }
}

/// The neighbor offsets a rule reads, in the order a tile lists its labels.
fn neighbors(shape: &str, hex: &Map<String, Value>, rules: &str, cx: i64, cy: i64) -> Vec<[i64; 2]> {
    if shape == "hex" {
        let flat = hex.get("orient").and_then(Value::as_str) == Some("flat");
        let odd = hex.get("offset").and_then(Value::as_str) != Some("even");
        // Offset coordinates: rows shift on a pointy grid, columns on a flat one.
        let line = if flat { cx } else { cy };
        let shifted = (line.rem_euclid(2) == 1) == odd;
        let s = i64::from(shifted);
        return if flat {
            vec![[1, s - 1], [0, -1], [-1, s - 1], [-1, s], [0, 1], [1, s]]
        } else {
            vec![[1, 0], [s, -1], [s - 1, -1], [-1, 0], [s - 1, 1], [s, 1]]
        };
    }
    let sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let corners = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    match rules {
        "sides" => sides.to_vec(),
        "corners" => corners.to_vec(),
        _ => vec![sides[0], corners[0], sides[1], corners[1], sides[2], corners[2], sides[3], corners[3]],
    }
}

/// The candidate a cell takes among `n`: hash(seed, cell key), the cell's own.
fn pick(seed: &Value, cx: i64, cy: i64, n: usize) -> usize {
    let digest = Sha256::digest(format!("{}:{cx},{cy}", seed).as_bytes());
    let mut word = [0u8; 8];
    word.copy_from_slice(&digest[..8]);
    (u64::from_le_bytes(word) % n as u64) as usize
}

/// The `marks@1` set an instance `id` of the recipe expands into, as `<id>.tiles`.
pub fn expand(id: &str, item: &Value) -> Result<(String, Value), Refused> {
    let path = format!("items/{id}/params");
    let params = item
        .get("params")
        .and_then(Value::as_object)
        .ok_or_else(|| bad(path.clone()))?;
    let grid = params.get("grid").and_then(Value::as_object).ok_or_else(|| bad(format!("{path}/grid")))?;
    let shape = grid.get("shape").and_then(Value::as_str).unwrap_or("square");
    let hex = grid.get("hex").and_then(Value::as_object).cloned().unwrap_or_default();
    let rules = params.get("rules").and_then(Value::as_str).unwrap_or("corners_and_sides");
    let seed = params.get("seed").cloned().unwrap_or(Value::Null);
    if seed.is_null() {
        // Only a seeded hash fixes a choice (Mark set: atlas tiles: never an unseeded generator).
        return Err(bad(format!("{path}/seed")));
    }
    // Each tile: its index in the atlas, its terrain and its labels in the rule's order.
    let mut tiles = Vec::new();
    for (i, t) in params
        .get("tiles")
        .and_then(Value::as_array)
        .ok_or_else(|| bad(format!("{path}/tiles")))?
        .iter()
        .enumerate()
    {
        let at = format!("{path}/tiles/{i}");
        let tile = t.get("tile").and_then(Value::as_u64).ok_or_else(|| bad(format!("{at}/tile")))?;
        let terrain = t.get("terrain").and_then(Value::as_str).unwrap_or("").to_string();
        let labels: Vec<String> = t
            .get("edges")
            .or_else(|| t.get("labels"))
            .and_then(Value::as_array)
            .map(|l| l.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default();
        tiles.push((tile, terrain, labels));
    }
    if tiles.is_empty() {
        return Err(bad(format!("{path}/tiles")));
    }
    let mut cells = std::collections::BTreeMap::new();
    for (i, c) in params
        .get("cells")
        .and_then(Value::as_array)
        .ok_or_else(|| bad(format!("{path}/cells")))?
        .iter()
        .enumerate()
    {
        let at = format!("{path}/cells/{i}");
        let l = c.as_array().filter(|l| l.len() == 3).ok_or_else(|| bad(at.clone()))?;
        let (Some(cx), Some(cy), Some(terrain)) = (
            num(l.first()).map(|v| v as i64),
            num(l.get(1)).map(|v| v as i64),
            l.get(2).and_then(Value::as_str),
        ) else {
            return Err(bad(at));
        };
        cells.insert((cx, cy), terrain.to_string());
    }
    let (mut xs, mut ys, mut picked) = (Vec::new(), Vec::new(), Vec::new());
    for (&(cx, cy), own) in &cells {
        let want: Vec<&str> = neighbors(shape, &hex, rules, cx, cy)
            .iter()
            .map(|[dx, dy]| cells.get(&(cx + dx, cy + dy)).map_or(own.as_str(), String::as_str))
            .collect();
        let mut candidates: Vec<u64> = tiles
            .iter()
            .filter(|(_, t, labels)| t == own && labels.iter().map(String::as_str).eq(want.iter().copied()))
            .map(|(tile, ..)| *tile)
            .collect();
        if candidates.is_empty() {
            candidates = tiles.iter().filter(|(_, t, _)| t == own).map(|(tile, ..)| *tile).collect();
        }
        if candidates.is_empty() {
            return Err(Refused {
                code: "ref_unresolved",
                path: format!("{path}/cells"),
            });
        }
        xs.push(cx);
        ys.push(cy);
        picked.push(candidates[pick(&seed, cx, cy, candidates.len())]);
    }
    let mut set = Map::new();
    set.insert("mark".into(), json!("image"));
    for key in ["atlas", "grid"] {
        if let Some(v) = params.get(key) {
            set.insert(key.into(), v.clone());
        }
    }
    set.insert("n".into(), json!(xs.len()));
    set.insert("columns".into(), json!({"cx": xs, "cy": ys, "tile": picked}));
    let mut derived = json!({"kind": "marks@1", "params": set});
    for key in ["layer", "order", "parent", "at"] {
        if let Some(v) = item.get(key) {
            derived[key] = v.clone();
        }
    }
    Ok((format!("{id}.tiles"), derived))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floor(cells: &[[i64; 2]]) -> Value {
        let cells: Vec<Value> = cells.iter().map(|[x, y]| json!([x, y, "grass"])).collect();
        json!({"kind": KIND, "params": {
            "grid": {"shape": "hex", "cell": [32, 28]}, "rules": "edges_6", "seed": 7,
            "tiles": (0..4).map(|t| json!({"tile": t, "terrain": "grass", "edges": vec!["grass"; 6]})).collect::<Vec<_>>(),
            "cells": cells,
        }})
    }

    #[test]
    fn a_cell_keeps_its_tile_when_another_is_added() {
        let tile_of = |v: &Value, x: i64, y: i64| {
            let c = &v["params"]["columns"];
            let i = (0..c["cx"].as_array().unwrap().len())
                .find(|i| c["cx"][i] == x && c["cy"][i] == y)
                .unwrap();
            c["tile"][i].clone()
        };
        let (_, before) = expand("floor", &floor(&[[0, 0], [1, 0], [0, 1]])).unwrap();
        let (_, after) = expand("floor", &floor(&[[5, 5], [0, 0], [1, 0], [0, 1]])).unwrap();
        for [x, y] in [[0, 0], [1, 0], [0, 1]] {
            assert_eq!(tile_of(&before, x, y), tile_of(&after, x, y));
        }
    }
}
