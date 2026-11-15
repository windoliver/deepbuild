//! #538: the forms the live-game-state tasks (#186: #535, #536, #537, #538) added inside a kind's
//! params, listed by `deep_kinds` as fields of that kind in the listing's one shape: a dotted
//! name, its type, unit, range, whether it takes a list, its default, and the forms it's written
//! in, printed from its declaration in the form language (#1973). Each list's bound comes from
//! the module that parses it, so the listing can't drift from the reader.

use serde_json::{json, Value};

fn field(name: &str, ty: &str, default: Value, form: &str) -> Value {
    json!({
        "name": name, "type": ty, "unit": Value::Null, "range": Value::Null,
        "list": form.starts_with('['), "default": default,
        "grammar": "form", "forms": crate::kinds::declared_forms(form),
    })
}

/// The array-reading column forms a mark set's and an instancer's columns take (#535, #537).
fn array_column(at: &str) -> [Value; 4] {
    [
        field(
            &format!("{at}.array"),
            "string",
            Value::Null,
            "<logic>.<name>",
        ),
        field(
            &format!("{at}.as"),
            "string",
            Value::Null,
            "`bool` | `u8` | `u16` | `u32` | `i32` | `f32` | `f64` (the array's type by default)",
        ),
        field(
            &format!("{at}.part"),
            "string",
            Value::Null,
            "x | y | z | w (a vector's part)",
        ),
        field(
            &format!("{at}.range"),
            "json",
            Value::Null,
            "[min, max] (a row outside it hides)",
        ),
    ]
}

/// The fields `kind` holds past its params, in the listing's shape; none for any other kind.
pub fn of(kind: &str) -> Vec<Value> {
    let glyphs = format!("[grapheme] ≤ {}", deep_canvas_cells::logic_grid::MAX_GLYPHS);
    let grid_roles = format!("[role] ≤ {}", deep_canvas_cells::logic_grid::MAX_ROLES);
    let args = format!(
        "[path | {{path, widest: string}} | {{copy: text (<table>[<array path>])}}] ≤ {}",
        deep_canvas_marks::copy::MAX_ARGS
    );
    let overlay_roles = format!("[role | none] ≤ {}", deep_canvas_scene3d::tints::MAX_ROLES);
    let mut out = Vec::new();
    match kind {
        // #538: the logic grid, in place of `frame`, `patch` and `play`.
        "cells@1" => out.extend([
            field("grid.array", "string", Value::Null, "<logic>.<name> (i32, cols × rows values, row-major)"),
            field("grid.size", "json", Value::Null, "[cols, rows: u16]"),
            field("grid.glyphs", "json", Value::Null, &glyphs),
            field("grid.roles", "json", Value::Null, &grid_roles),
            field("grid.attrs", "json", json!(deep_canvas_cells::emulator::ATTRS), "[name] ≤ 8 (bits 20 to 27, in order)"),
        ]),
        // #535's logic columns and alive, #536's hex grid and its terrain rules, #538's copy column.
        "marks@1" => {
            out.extend(array_column("columns.<name>"));
            out.extend([
                field("alive.array", "string", Value::Null, "<logic>.<name> (bool)"),
                field("grid.shape", "string", json!("square"), "square | isometric | hex"),
                field("grid.hex.orient", "string", json!("pointy"), "flat | pointy"),
                field("grid.hex.offset", "string", json!("odd"), "odd | even"),
                // #1974: its reader's default is the grid's (corners_and_sides, or edges_6 on a hex grid),
                // so the line prints none, and the form says which.
                field("recipe.rules", "string", Value::Null, "corners_and_sides | corners | sides | edges_6 (corners_and_sides by default; edges_6 on a hex grid, and its default there)"),
                field("recipe.precedence", "json", Value::Null, "[<terrain>] (edges_6: an edge takes the neighbour's terrain where it comes first)"),
                field("columns.<name>.copy", "string", Value::Null, "<table> (a text column: each row's string by its key)"),
                field("columns.<name>.key", "string", Value::Null, "<column> (an i32 column, looked up by value)"),
                field("columns.<name>.args", "json", Value::Null, &format!("[column] ≤ {}", deep_canvas_marks::copy::MAX_ARGS)),
            ]);
        }
        // #538: keyed copy, and the copy tables it reads.
        "text@1" => out.extend([
            field("text.copy", "string", Value::Null, "text (<table>[<array path>], in place of a string; in a template, a slot {copy: …})"),
            field("text.args", "json", Value::Null, &args),
            field("data.copy.<locale>.<table>.<key>", "json", Value::Null, "string | {zero, one, two, few, many, other: string} (key an i32; other required in a plural entry)"),
            field("data.copy.<locale>.<table>.missing", "string", json!(""), "string (shown for a key the table lacks)"),
        ]),
        // #538: flip by array, beside the flips by keys and by occurrence list.
        "group@1" => out.extend([
            field("flip.keys", "json", Value::Null, "[{t: time, show: child ID | none}]"),
            field("flip.from", "string", Value::Null, "occurrence list"),
            field("flip.array", "string", Value::Null, "text (<logic>.<name>[index], i32)"),
            field("flip.map", "json", Value::Null, "{value → child ID} (an unmapped value shows none)"),
        ]),
        // #537: a terrain plate's overlays.
        "plate@1" => out.extend([
            field("overlays[].grid", "string", Value::Null, "<logic>.<name> (i32, cols × rows values)"),
            field("overlays[].size", "json", Value::Null, "[cols, rows: u16]"),
            field("overlays[].origin", "json", Value::Null, "[m, m] (the plate's corner by default)"),
            field("overlays[].cell", "number", Value::Null, "m (the plate's spacing by default)"),
            field("overlays[].roles", "json", Value::Null, &overlay_roles),
            field("overlays[].opacity", "number", json!(1), "0..1"),
        ]),
        // #537: an instancer fed by logic.
        "instance@1" => {
            for c in ["pos", "rot", "yaw", "scale", "proto", "attrs.<name>"] {
                out.extend(array_column(c));
            }
            out.extend([
                field("hidden.array", "string", Value::Null, "<logic>.<name> (bool, one value a slot)"),
                field("live.array", "string", Value::Null, "<logic>.<name> (bool)"),
                field("gen.array", "string", Value::Null, "<logic>.<name> (u32)"),
            ]);
        }
        _ => {}
    }
    out
}
