//! The sheet canvas module (technical design: Canvas modules, the module table's `sheet` row;
//! issue #388 lays R1's canvas out as canvas modules): each `sheet@1` item placed beside the
//! question card's slot, every cell at its exact size with room for its highlights' marks, and
//! its captions, one node per item.

use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::{captions, place, Cell};

/// The sheet module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
            name: "sheet".into(),
            version: Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: Range::parse("*").expect("a range"),
            depends_on: [(
                "marks2d".to_string(),
                Dependency {
                    range: Range::parse("^1").expect("a range"),
                    optional: false,
                },
            )]
            .into_iter()
            .collect(),
            feature: "sheet".into(),
            license: "Apache-2.0".into(),
            implements: "sheet@1".into(),
        },
        register,
    }
}

fn register(r: &mut Registrar) {
    r.array("sheet.placed", "placed", "item", "geometry", "items");
    r.operator("place", "items", &["core.fields"], &["sheet.placed"])
        .applies(is_sheet)
        .run(placed);
    r.code(
        "sheet.does_not_fit",
        "A sheet that doesn't fit beside the question card's slot at its cells' exact sizes.",
        "Show fewer cells or smaller ones; a cell never scales.",
        false,
    );
    r.code(
        "sheet.highlight_outside",
        "A highlight that reaches outside its cell.",
        "Keep each highlight inside its cell's size.",
        false,
    );
    r.fixture("variants", board(), None).sidecar(json!({
        // It draws nothing yet, so its fixture is checked, not compared as pixels.
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["unknown_kind"],
    }));
}

fn is_sheet(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("sheet@1")
}

fn px(v: &Value) -> Option<u32> {
    v.as_u64().and_then(|n| u32::try_from(n).ok())
}

fn size(v: &Value) -> Option<[u32; 2]> {
    Some([px(v.get(0)?)?, px(v.get(1)?)?])
}

/// The sheet's card slot, its box, each cell's rect and highlight marks, and its captions.
fn placed(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v
        .json("core.fields")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    let path = format!("items/{}/params", v.id().unwrap_or_default());
    let bad = || OpError::new("bad_doc", path.clone());
    let p = &fields["params"];
    let read = |c: &Value| -> Option<(Cell, String)> {
        let id = c.get("id")?.as_str()?.to_string();
        let highlights = match c.get("highlights") {
            None => Vec::new(),
            Some(h) => h
                .as_array()?
                .iter()
                .map(|r| {
                    Some([
                        px(r.get(0)?)?,
                        px(r.get(1)?)?,
                        px(r.get(2)?)?,
                        px(r.get(3)?)?,
                    ])
                })
                .collect::<Option<_>>()?,
        };
        let label = c
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(&id)
            .to_string();
        let cell = Cell {
            size: size(c.get("size")?)?,
            names_option: None,
            look: c.get("look").and_then(Value::as_str).map(str::to_string),
            highlights,
            id,
        };
        Some((cell, label))
    };
    let (cells, labels): (Vec<Cell>, Vec<String>) = p["cells"]
        .as_array()
        .ok_or_else(bad)?
        .iter()
        .map(read)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(bad)?
        .into_iter()
        .unzip();
    let view = size(&p["view"]).ok_or_else(bad)?;
    let card = size(&p["card"]).ok_or_else(bad)?;
    let columns = match p.get("columns") {
        None => None,
        Some(c) => Some(
            c.as_u64()
                .and_then(|c| usize::try_from(c).ok())
                .ok_or_else(bad)?,
        ),
    };
    let gap = match p.get("gap") {
        None => 8,
        Some(g) => px(g).ok_or_else(bad)?,
    };
    let placed =
        place(view, card, &cells, columns, gap).map_err(|code| OpError::new(code, path.clone()))?;
    v.write(
        "sheet.placed",
        Val::json(
            json!({"card": placed.card, "sheet": placed.sheet, "cells": placed.cells,
                         "marks": placed.marks, "captions": captions(&cells, &labels)}),
        ),
    )
}

fn board() -> Value {
    let cell = |id: &str, look: &str| json!({"id": id, "size": [160, 90], "look": look});
    json!({
        "format": 1, "profile": "board", "seed": 388, "title": "Variants",
        "description": "Three candidate stills on a variant sheet beside the question card's slot: the sheet module's fixture.",
        "size": [800, 400],
        "items": {
            "sheet": {"id": "sheet", "kind": "sheet@1", "name": "Variants", "order": "a0",
                      "params": {"view": [800, 400], "card": [240, 160], "gap": 8,
                                 "cells": [cell("a", "clean"), cell("b", "clean"), cell("c", "print")]}},
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a1",
                    "params": {"text": "Variants", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
                    "at": {"pos": [16, 360, 0]}}
        }
    })
}
