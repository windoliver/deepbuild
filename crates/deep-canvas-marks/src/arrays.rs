//! #535 (canvas primitives: Mark set: logic columns): the data module's operator that maps each
//! mark-set column, and `alive`, reading an array the core's column view baked, at a frame's t,
//! from the session's frame before by the ranges the steps since handed over, as edits on the
//! set's fields; and #535's planted programs.

use std::collections::BTreeMap;

use deep_canvas::columns::{data_of, hidden_rows, map, match_me, unseen_rows, Mapped};
use deep_canvas::registry::Registrar;
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

/// The data module's `columns` operator, its contribution to the core's fields and its mapping.
pub(crate) fn register(r: &mut Registrar) {
    r.contribution(
        "data.columns",
        "fields",
        "item",
        "geometry",
        "items",
        "core.fields",
    );
    r.private_array("data.mapped", "mapped", "item", "geometry", "items");
    r.operator(
        "columns",
        "items",
        &["self", "t"],
        &["data.columns", "data.mapped"],
    )
    .applies(reads_array)
    .run(columns);
    // #269: each grid image's grid, mapped as the columns are.
    crate::grid_image::register(r);
}

/// #2363: `points` with a column read from a baked array at frame zero, and a follower on a
/// vector field's stream, so `columns`, `vector_field` and `follow_stream` have nodes.
pub(crate) fn fixture(r: &mut Registrar, mut columns: Value) {
    let values = &mut columns["items"]["dots"]["params"]["columns"]["v"];
    values["type"] = json!("f64");
    values["count"] = json!(2);
    values["every"] = json!(705_600_000);
    values["steps"] = json!([
        {"step": 0, "changed": [[0, 2]], "values": [[0, [2.0, 5.0]]]},
        {"step": 1, "changed": [[0, 1]], "values": [[0, [3.0]]]},
    ]);
    columns["transport"] = json!({"span": "1s"});
    columns["items"]["swirl"] = json!({"id": "swirl", "kind": "vector_field@1", "name": "Swirl", "order": "a3",
        "params": {"fn": {"x": "-y", "y": "x"},
                   "streams": {"starts": [[1, 0]], "step": 0.1, "time": 1}}});
    columns["items"]["follower"] = json!({"id": "follower", "kind": "circle@1", "name": "Follower", "order": "a4",
        "params": {"center": [0, 0], "r": 4}});
    columns["constraints"] = json!({"follow": {"owner": "follower", "kind": "follow_stream",
        "vector_field": "swirl", "from": [1, 0]}});
    r.fixture("columns", columns, None).sidecar(json!({
        "checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["unknown_kind"],
    }));
}

/// The data module's planted narrowing that wraps a value into its column's range.
pub const NARROWING_WRAPS: &str = "narrowing_wraps";
/// The data module's planted mapping that keeps its rows across a seek back.
pub const KEEPS_ROWS_ACROSS_SEEK: &str = "keeps_rows_across_seek";
/// #503's planted mapping: a spectrum's bands, on a frame right after the frame one frame before
/// it, read that earlier frame's row, so playing lags seeking by a row.
pub const SPECTRUM_ROW_LATE: &str = "spectrum_plays_a_row_late";
/// #535's planted programs, each reachable only through a proof surface: the data module's two
/// here, and deep-show's hand-over, index of dead rows and renderer turning rows about a corner;
/// and #503's spectrum read a row late.
pub const PLANTED: [&str; 6] = [
    "hand_over_drops_last_range",
    NARROWING_WRAPS,
    "dead_rows_hidden_from_drawing_only",
    KEEPS_ROWS_ACROSS_SEEK,
    "turns_about_corner",
    SPECTRUM_ROW_LATE,
];

/// A mark set whose columns, `alive` or `seen` read an array, which the column view baked.
fn reads_array(_: &Value, _: &str, item: &Value) -> bool {
    let p = item.get("params");
    ["alive", "seen"].iter().any(|k| {
        p.and_then(|p| p.get(k))
            .is_some_and(|a| a.get("steps").is_some())
    }) || p
        .and_then(|p| p.get("columns"))
        .and_then(Value::as_object)
        .is_some_and(|c| c.values().any(|c| c.get("steps").is_some()))
}

/// The set's array columns at t (`data.columns`), each as its values and hidden rows, and their
/// mappings (`data.mapped`), from the session's last frame unless t is before it.
fn columns(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let item = v.item()?;
    let last = v.last("data.mapped");
    let last = last
        .as_ref()
        .and_then(|l| l.as_typed::<BTreeMap<String, Mapped>>());
    let planted = v.planted();
    let wraps = planted == Some(NARROWING_WRAPS);
    let p = &item["params"];
    let mut readers: Vec<(Vec<String>, &Value)> = p["columns"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("steps").is_some())
        .map(|(n, c)| (vec!["params".into(), "columns".into(), n.clone()], c))
        .collect();
    for k in ["alive", "seen"] {
        if p[k].get("steps").is_some() {
            readers.push((vec!["params".into(), k.into()], &p[k]));
        }
    }
    // #552: this copy's player, which the core's column view stamps on the set's `seen` column
    // from the form's `match.me`: the set's content key holds it, so each player's frames cache
    // apart.
    let me = match_me(&p["seen"]["me"]);
    let mut edits = Vec::new();
    let mut mapped = BTreeMap::new();
    for (path, column) in readers {
        let key = path.join("/");
        let before = last.as_ref().and_then(|l| l.get(&key)).map(|m| {
            let mut m = m.clone();
            if planted == Some(KEEPS_ROWS_ACROSS_SEEK) {
                // The planted mapping: a seek back keeps the rows the later frame mapped.
                m.step = m
                    .step
                    .min(t.div_euclid(column["every"].as_i64().unwrap_or(1).max(1)));
            }
            m
        });
        let every = column["every"].as_i64().unwrap_or(1).max(1);
        let late = planted == Some(SPECTRUM_ROW_LATE)
            && column["array"]
                .as_str()
                .is_some_and(|a| a.starts_with("spectrum."))
            && before
                .as_ref()
                .is_some_and(|b| b.step == t.div_euclid(every) - 1);
        // The planted mapping: a frame right after the frame before it reads that frame's row.
        let read = if late {
            map(column, t - every, None, wraps).map(|mut m| {
                m.step += 1;
                m
            })
        } else {
            map(column, t, before.as_ref(), wraps)
        };
        let Some(m) = read else {
            continue;
        };
        let at = |leaf: &str| [path.clone(), vec![leaf.to_string()]].concat();
        let leaf = path.last().map(String::as_str);
        let hide = match leaf {
            Some("seen") => unseen_rows(&m, me),
            _ => hidden_rows(&m, leaf == Some("alive")),
        };
        edits.push(Edit {
            add: false,
            path: at("data"),
            value: Datum::Text(data_of(&m)),
        });
        edits.push(Edit {
            add: false,
            path: at("hide"),
            value: Datum::Nums(hide.into_iter().map(|r| r as f64).collect()),
        });
        mapped.insert(key, m);
    }
    v.write("data.columns", Val::typed(Edits(edits)))?;
    v.write("data.mapped", Val::typed(mapped))
}
