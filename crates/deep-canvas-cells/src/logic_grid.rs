//! Issue #538: the logic grid (Cell grid `cells@1`: logic grid). A grid shows a logic item's i32
//! array of cols × rows values, read through the core's column view as the logic module gives
//! it at t, so the cells module never depends on logic. Each value packs a glyph index (bits 0 to
//! 11), a foreground and a background role index (12 to 15, 16 to 19) and the grid's attribute
//! bits (20 to 27); bits 28 to 31 are zero. A value whose index passes its list, or whose top
//! bits are set, draws a blank cell in the grid's background and raises `grid.out_of_range`; it
//! never wraps into the lists.

use deep_canvas::columns::{mapped, source, Read};
use deep_canvas::document::Issue;
use deep_canvas::registry::lists::SealedEntry;
use serde_json::{json, Value};

use crate::emulator::ATTRS;

/// Most glyphs and roles a grid lists.
pub const MAX_GLYPHS: usize = 4_096;
pub const MAX_ROLES: usize = 16;

/// The code a cell whose value indexes past its lists raises.
pub const OUT_OF_RANGE: &str = "grid.out_of_range";

/// A grid's `grid` field, read.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec<'a> {
    pub array: &'a str,
    pub cols: usize,
    pub rows: usize,
    pub glyphs: Vec<&'a str>,
    pub roles: Vec<&'a str>,
    /// Each attribute bit's place in [`ATTRS`], in the grid's `attrs` order.
    pub attrs: Vec<u16>,
}

/// One cell's value unpacked: indexes into the grid's lists and its attribute bits as drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cell {
    pub glyph: usize,
    pub fg: usize,
    pub bg: usize,
    pub attrs: u16,
}

/// The grid's `grid` field of `params`, `None` where it has none; or the field it fails at and
/// why.
pub fn spec(params: &Value) -> Result<Option<Spec<'_>>, (String, String)> {
    let Some(g) = params.get("grid").filter(|g| !g.is_null()) else {
        return Ok(None);
    };
    let bad = |f: &str, what: &str| Err((format!("grid/{f}"), what.to_string()));
    let Some(array) = g["array"].as_str().filter(|a| a.contains('.')) else {
        return bad("array", "a logic grid reads a logic item's array, <logic>.<name>");
    };
    let side = |i: usize| {
        g["size"][i]
            .as_u64()
            .filter(|n| (1..=u64::from(u16::MAX)).contains(n))
            .map(|n| n as usize)
    };
    let (Some(cols), Some(rows)) = (side(0), side(1)) else {
        return bad("size", "a logic grid's size is [cols, rows], each from 1 to 65,535 (u16)");
    };
    let list = |k: &str, most: usize| -> Option<Vec<&str>> {
        let l = g[k].as_array().filter(|l| !l.is_empty() && l.len() <= most)?;
        l.iter().map(Value::as_str).collect()
    };
    let Some(glyphs) = list("glyphs", MAX_GLYPHS) else {
        return bad("glyphs", "a logic grid lists 1 to 4,096 glyphs, each a grapheme");
    };
    let Some(roles) = list("roles", MAX_ROLES) else {
        return bad("roles", "a logic grid lists 1 to 16 roles");
    };
    let attrs = match g.get("attrs").filter(|a| !a.is_null()) {
        None => (0..ATTRS.len() as u16).collect(),
        Some(a) => {
            let names = a.as_array().filter(|l| l.len() <= 8);
            let places: Option<Vec<u16>> = names.into_iter().flatten().map(|n| {
                ATTRS.iter().position(|x| Some(*x) == n.as_str()).map(|p| p as u16)
            }).collect();
            match places.filter(|_| names.is_some()) {
                Some(p) => p,
                None => return bad("attrs", "a logic grid's attrs name at most eight of the cell attributes"),
            }
        }
    };
    Ok(Some(Spec { array, cols, rows, glyphs, roles, attrs }))
}

impl Spec<'_> {
    /// A value unpacked, `None` where it draws a blank cell: an index past its list, top bits
    /// set, or a value no i32 holds. `wraps`: the planted unpacking that wraps each index into
    /// its list.
    pub fn unpack(&self, value: f64, wraps: bool) -> Option<Cell> {
        if !(value.fract() == 0.0 && (f64::from(i32::MIN)..=f64::from(i32::MAX)).contains(&value)) {
            return None;
        }
        let bits = value as i32 as u32;
        let glyph = (bits & 0xFFF) as usize;
        let fg = (bits >> 12 & 0xF) as usize;
        let bg = (bits >> 16 & 0xF) as usize;
        let attr_bits = (bits >> 20 & 0xFF) as u16;
        let attrs = self
            .attrs
            .iter()
            .enumerate()
            .filter(|(k, _)| attr_bits >> k & 1 == 1)
            .fold(0u16, |a, (_, place)| a | 1 << place);
        if wraps {
            let (g, r) = (self.glyphs.len(), self.roles.len());
            return Some(Cell { glyph: glyph % g, fg: fg % r, bg: bg % r, attrs });
        }
        let fits = bits >> 28 == 0
            && glyph < self.glyphs.len()
            && fg < self.roles.len()
            && bg < self.roles.len();
        fits.then_some(Cell { glyph, fg, bg, attrs })
    }
}

/// The grid's `grid` field as an issue's path.
fn path(id: &str, f: &str) -> String {
    format!("items/{id}/params/grid/{f}")
}

fn grids(form: &Value) -> impl Iterator<Item = (&String, &Value)> {
    form.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i["kind"] == "cells@1" && i.pointer("/params/grid").is_some_and(|g| !g.is_null()))
}

/// The baked array `s` reads, or the refusal: through the core's view (`module_missing` naming
/// logic in a build without it, `ref_unresolved` where nothing writes it), an i32 array of
/// exactly cols × rows values.
fn array<'a>(form: &'a Value, entries: &[SealedEntry], id: &str, s: &Spec<'_>) -> Result<&'a Value, Box<Issue>> {
    let at = path(id, "array");
    let worlds = form.get("worlds").unwrap_or(&Value::Null);
    let a = source((&form["arrays"], worlds), entries, id, &at, s.array)?;
    let ty = a["type"].as_str().unwrap_or_default();
    if ty != "i32" {
        let what = "a logic grid reads an i32 array";
        return Err(Box::new(Issue::error("bad_column", id, at, json!({"array": s.array, "type": ty}), what)));
    }
    let count = a["count"].as_u64().unwrap_or(0);
    if count != (s.cols * s.rows) as u64 {
        let what = "a logic grid's array holds cols × rows values, row-major";
        let actual = json!({"array": s.array, "count": count, "cells": s.cols * s.rows, "size": [s.cols, s.rows]});
        return Err(Box::new(Issue::error("out_of_range", id, path(id, "size"), actual, what)));
    }
    Ok(a)
}

/// Every step at which a cell of the grid begins to draw blank, by the baked steps alone: every
/// cell at step 0, then the cells each later step wrote: `(step, cell, value)`.
fn excursions(s: &Spec<'_>, a: &Value) -> Vec<(i64, usize, f64)> {
    let n = s.cols * s.rows;
    let mut raw = vec![0.0; n];
    let mut blank = vec![false; n];
    let mut out = Vec::new();
    let steps = a["steps"].as_array().map_or(&[][..], Vec::as_slice);
    let mut checks: Vec<(i64, Option<&Value>)> = Vec::new();
    if steps.first().and_then(|s| s["step"].as_i64()) != Some(0) {
        checks.push((0, None));
    }
    checks.extend(steps.iter().map(|s| (s["step"].as_i64().unwrap_or(0), Some(s))));
    for (step, st) in checks {
        let mut touched = Vec::new();
        for run in st.and_then(|s| s["values"].as_array()).into_iter().flatten() {
            let start = run[0].as_u64().unwrap_or(0) as usize;
            for (j, v) in run[1].as_array().into_iter().flatten().enumerate() {
                if start + j < n {
                    raw[start + j] = v.as_f64().unwrap_or(f64::NAN);
                    touched.push(start + j);
                }
            }
        }
        if step == 0 {
            touched = (0..n).collect();
        }
        touched.sort_unstable();
        touched.dedup();
        for c in touched {
            let is_blank = s.unpack(raw[c], false).is_none();
            if is_blank && !blank[c] {
                out.push((step, c, raw[c]));
            }
            blank[c] = is_blank;
        }
    }
    out
}

fn out_of_range(id: &str, s: &Spec<'_>, (step, c, value): (i64, usize, f64)) -> Issue {
    let actual = json!({"array": s.array, "cell": [c % s.cols, c / s.cols], "value": value as i64, "step": step});
    Issue {
        severity: "warning",
        ..Issue::error(
            OUT_OF_RANGE,
            id,
            path(id, "array"),
            actual,
            "a cell's value indexes past the grid's glyphs or roles, or sets a top bit; it draws blank while it lasts",
        )
    }
}

/// The check over `form`'s logic grids, their arrays baked into its `arrays`: each grid's
/// refusal, and every `grid.out_of_range` its array raises, each at the step it begins.
pub fn check(form: &Value, entries: &[SealedEntry]) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in grids(form) {
        let Ok(Some(s)) = spec(&item["params"]) else { continue };
        match array(form, entries, id, &s) {
            Err(issue) => out.push(*issue),
            Ok(a) => out.extend(excursions(&s, a).into_iter().map(|e| out_of_range(id, &s, e))),
        }
    }
    out
}

/// The `grid.out_of_range` issues a frame at `t` of `form` raises: each cell whose blank run
/// begins at the frame's step.
pub fn raised_at(form: &Value, t: i64) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in grids(form) {
        let Ok(Some(s)) = spec(&item["params"]) else { continue };
        let Some(a) = form["arrays"].get(s.array) else { continue };
        let k = t.div_euclid(a["every"].as_i64().unwrap_or(1).max(1));
        let begun = excursions(&s, a).into_iter().filter(|e| e.0 == k);
        out.extend(begun.map(|e| out_of_range(id, &s, e)));
    }
    out
}

/// Each cell of `s` at `t` from the baked `array`, `None` for a blank one; every cell blank
/// where the document bakes no such array.
pub fn cells(s: &Spec<'_>, array: Option<&Value>, t: i64, wraps: bool) -> Vec<Option<Cell>> {
    let n = s.cols * s.rows;
    let read = Read::of(&Value::Null, "i32");
    let m = array.zip(read).and_then(|(a, r)| mapped(&r, a, t, None)).filter(|m| m.values.len() == n);
    match m {
        Some(m) => m.values.iter().map(|v| s.unpack(*v, wraps)).collect(),
        None => vec![None; n],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_unpacks_by_its_bits_and_one_past_its_lists_draws_blank() {
        let params = json!({"grid": {"array": "dungeon.cells", "size": [40, 12], "glyphs": [".", "#", "@", "é"], "roles": ["ink", "accent"]}});
        let s = spec(&params).unwrap().unwrap();
        assert_eq!(s.unpack(f64::from(0x1002), false), Some(Cell { glyph: 2, fg: 1, bg: 0, attrs: 0 }));
        assert_eq!(s.unpack(7.0, false), None);
        assert_eq!(s.unpack(7.0, true).map(|c| c.glyph), Some(3));
        assert_eq!(s.unpack(f64::from(1 << 28), false), None);
        assert_eq!(s.unpack(-1.0, false), None);
        assert_eq!(s.unpack(f64::from(1 << 20 | 1), false), Some(Cell { glyph: 1, fg: 0, bg: 0, attrs: 1 }));
    }

    #[test]
    fn a_grid_raises_out_of_range_where_a_cell_begins_to_draw_blank() {
        let every = 1000;
        let mut values = vec![json!(0); 480];
        values[41] = json!(7);
        let form = json!({
            "items": {"g": {"kind": "cells@1", "params": {"grid": {"array": "d.cells", "size": [40, 12], "glyphs": [".", "#"], "roles": ["ink"]}}}},
            "arrays": {"d.cells": {"type": "i32", "count": 480, "every": every, "linear": false, "steps": [
                {"step": 0, "changed": [[0, 480]], "values": [[0, values]]},
                {"step": 5, "changed": [[2, 3]], "values": [[2, [7]]]},
            ]}},
        });
        let s = spec(&form["items"]["g"]["params"]).unwrap().unwrap();
        assert_eq!(excursions(&s, &form["arrays"]["d.cells"]), [(0, 41, 7.0), (5, 2, 7.0)]);
        let first = raised_at(&form, 0);
        assert_eq!(first[0].actual, json!({"array": "d.cells", "cell": [1, 1], "value": 7, "step": 0}));
        assert_eq!(raised_at(&form, 5 * every).len(), 1);
        assert!(raised_at(&form, 6 * every).is_empty());
        // In a build that fills no logic array, the grid is refused naming the logic module.
        assert_eq!(check(&form, &[])[0].code, "module_missing");
        let drawn = cells(&s, Some(&form["arrays"]["d.cells"]), 5 * every, false);
        assert_eq!((drawn[0], drawn[2], drawn[41]), (Some(Cell { glyph: 0, fg: 0, bg: 0, attrs: 0 }), None, None));
    }
}
