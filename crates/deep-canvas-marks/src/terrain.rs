//! Issue #467: the terrain recipe `tiles.terrain@1` (canvas primitives: Mark set: atlas tiles;
//! Mark set: hex grid). It expands at check into one `marks@1` image set on the atlas: each cell
//! takes a tile whose labels match what its neighbors give it, and among equal candidates the one
//! a hash of the seed and the cell's own key picks, so adding a cell never reseeds another. An
//! edge, side or corner with no neighbor expects the cell's own terrain.
//!
//! #536: on a hex grid the rules are `edges_6`. Edge i of a cell of terrain T expects its
//! neighbor's terrain N where N comes before T in `precedence`, and T otherwise; square rules are
//! refused, naming the rule, and a cell no tile matches is refused, naming the cell and the six
//! labels it wanted. The cells are fixed at check, so cells that read a logic array are refused.

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::atlas::Grid;
use crate::scene::{num, Planted, Refused};

/// The recipe's kind.
pub const KIND: &str = "tiles.terrain@1";

/// Why a recipe can't expand: its code and path, and for the check's issue what was found and a
/// message naming it.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub actual: Box<Value>,
    pub message: String,
}

impl From<Refusal> for Refused {
    fn from(r: Refusal) -> Refused {
        Refused {
            code: r.code,
            path: r.path,
        }
    }
}

fn bad(path: String) -> Refusal {
    Refusal {
        code: "bad_doc",
        path,
        actual: Box::new(Value::Null),
        message: "the terrain recipe can't expand as its params say".into(),
    }
}

/// The square rules, which a hex grid refuses.
const SQUARE_RULES: [&str; 3] = ["corners_and_sides", "corners", "sides"];

/// The neighbor offsets a square rule reads, in the order a tile lists its labels.
fn square_neighbors(rules: &str) -> Vec<[i64; 2]> {
    let sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let corners = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    match rules {
        "sides" => sides.to_vec(),
        "corners" => corners.to_vec(),
        _ => vec![
            sides[0], corners[0], sides[1], corners[1], sides[2], corners[2], sides[3], corners[3],
        ],
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
/// `planted` may read a square grid's four sides as a hex cell's neighbours (#536 AC2's twin).
pub fn expand(id: &str, item: &Value, planted: Planted) -> Result<(String, Value), Refusal> {
    let path = format!("items/{id}/params");
    let params = item
        .get("params")
        .and_then(Value::as_object)
        .ok_or_else(|| bad(path.clone()))?;
    let grid = params
        .get("grid")
        .and_then(Value::as_object)
        .ok_or_else(|| bad(format!("{path}/grid")))?;
    let on_hex = grid.get("shape").and_then(Value::as_str) == Some("hex");
    // #536: a hex grid's layout gives each cell's six neighbours (Mark set: hex grid).
    let hex = match on_hex {
        true => Some(Grid::read(params, &path).map_err(|r| Refusal {
            code: r.code,
            ..bad(r.path)
        })?),
        false => None,
    };
    let rules = params
        .get("rules")
        .and_then(Value::as_str)
        .unwrap_or(if on_hex {
            "edges_6"
        } else {
            "corners_and_sides"
        });
    if on_hex && rules != "edges_6" {
        return Err(Refusal {
            code: "bad_doc",
            path: format!("{path}/rules"),
            actual: Box::new(json!(rules)),
            message: if SQUARE_RULES.contains(&rules) {
                format!("{rules} is a square grid's rule; a hex grid takes edges_6")
            } else {
                format!("{rules} isn't a rule a hex grid takes; it takes edges_6")
            },
        });
    }
    // #536: the terrains in the order an edge takes its neighbor's, first wins; a terrain it
    // doesn't list comes before none.
    let precedence: Vec<&str> = match params.get("precedence") {
        None => Vec::new(),
        Some(Value::Array(l)) if l.iter().all(Value::is_string) => {
            l.iter().filter_map(Value::as_str).collect()
        }
        Some(_) => return Err(bad(format!("{path}/precedence"))),
    };
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
        let tile = t
            .get("tile")
            .and_then(Value::as_u64)
            .ok_or_else(|| bad(format!("{at}/tile")))?;
        let terrain = t
            .get("terrain")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let labels: Vec<String> = t
            .get("edges")
            .or_else(|| t.get("labels"))
            .and_then(Value::as_array)
            .map(|l| {
                l.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        tiles.push((tile, terrain, labels));
    }
    if tiles.is_empty() {
        return Err(bad(format!("{path}/tiles")));
    }
    let mut cells = std::collections::BTreeMap::new();
    let cells_at = format!("{path}/cells");
    let Some(list) = params.get("cells").and_then(Value::as_array) else {
        return Err(Refusal {
            message: "the terrain recipe's cells are a list of [cx, cy, terrain] fixed at check; \
                      they can't read a logic array or anything else that changes at run time"
                .into(),
            ..bad(cells_at)
        });
    };
    for (i, c) in list.iter().enumerate() {
        let at = format!("{cells_at}/{i}");
        let l = c
            .as_array()
            .filter(|l| l.len() == 3)
            .ok_or_else(|| bad(at.clone()))?;
        let (Some(cx), Some(cy), Some(terrain)) = (
            num(l.first()).map(|v| v as i64),
            num(l.get(1)).map(|v| v as i64),
            l.get(2).and_then(Value::as_str),
        ) else {
            return Err(bad(at));
        };
        cells.insert((cx, cy), terrain.to_string());
    }
    let rank = |t: &str| precedence.iter().position(|p| *p == t);
    let (mut xs, mut ys, mut picked) = (Vec::new(), Vec::new(), Vec::new());
    for (&(cx, cy), own) in &cells {
        let around: Vec<[i64; 2]> = match hex.and_then(|g| g.neighbours([cx, cy])) {
            Some(_) if planted == Planted::TerrainSquareSides => {
                let [r, u, l, d] = [[cx + 1, cy], [cx, cy - 1], [cx - 1, cy], [cx, cy + 1]];
                vec![r, u, u, l, d, d]
            }
            Some(six) => six.to_vec(),
            None => square_neighbors(rules)
                .iter()
                .map(|[dx, dy]| [cx + dx, cy + dy])
                .collect(),
        };
        let want: Vec<&str> = around
            .iter()
            .map(|[nx, ny]| match cells.get(&(*nx, *ny)) {
                None => own.as_str(),
                // #536: a neighbor's terrain only where it comes before the cell's own.
                Some(n) if on_hex => match (rank(n), rank(own)) {
                    (Some(a), Some(b)) if a < b => n.as_str(),
                    _ => own.as_str(),
                },
                Some(n) => n.as_str(),
            })
            .collect();
        let mut candidates: Vec<u64> = tiles
            .iter()
            .filter(|(_, t, labels)| {
                t == own && labels.iter().map(String::as_str).eq(want.iter().copied())
            })
            .map(|(tile, ..)| *tile)
            .collect();
        if candidates.is_empty() && on_hex {
            return Err(Refusal {
                code: "ref_unresolved",
                path: cells_at,
                actual: Box::new(json!({"cell": [cx, cy], "terrain": own, "labels": want})),
                message: format!(
                    "no tile matches cell ({cx}, {cy}): it wants terrain {own} with edges [{}]",
                    want.join(", ")
                ),
            });
        }
        if candidates.is_empty() {
            candidates = tiles
                .iter()
                .filter(|(_, t, _)| t == own)
                .map(|(tile, ..)| *tile)
                .collect();
        }
        if candidates.is_empty() {
            return Err(Refusal {
                code: "ref_unresolved",
                actual: Box::new(json!({"cell": [cx, cy], "terrain": own})),
                message: format!("no tile has cell ({cx}, {cy})'s terrain {own}"),
                ..bad(cells_at)
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
    set.insert(
        "columns".into(),
        json!({"cx": xs, "cy": ys, "tile": picked}),
    );
    let mut derived = json!({"kind": "marks@1", "params": set});
    for key in ["layer", "order", "parent", "at"] {
        if let Some(v) = item.get(key) {
            derived[key] = v.clone();
        }
    }
    Ok((format!("{id}.tiles"), derived))
}

/// The set [`expand`] gives, as a frame draws it (#1653): its columns as f64 data.
pub fn drawn(id: &str, item: &Value) -> Result<(String, Value), Refused> {
    let (name, mut set) = expand(id, item, Planted::None).map_err(Refused::from)?;
    if let Some(Value::Object(columns)) = set.pointer_mut("/params/columns") {
        for column in columns.values_mut() {
            let values: Vec<f64> = column
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_f64)
                .collect();
            let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
            *column = json!({"dtype": "f64", "len": values.len(), "data": deep_canvas::base64::encode(&bytes)});
        }
    }
    Ok((name, set))
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
        let (_, before) =
            expand("floor", &floor(&[[0, 0], [1, 0], [0, 1]]), Planted::None).unwrap();
        let (_, after) = expand(
            "floor",
            &floor(&[[5, 5], [0, 0], [1, 0], [0, 1]]),
            Planted::None,
        )
        .unwrap();
        for [x, y] in [[0, 0], [1, 0], [0, 1]] {
            assert_eq!(tile_of(&before, x, y), tile_of(&after, x, y));
        }
    }
}
