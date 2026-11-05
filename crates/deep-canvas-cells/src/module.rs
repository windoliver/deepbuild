//! The cells canvas module (technical design: Canvas modules, the module table's `cells` row,
//! "Depends on text"; canvas primitives: Cell grid `cells@1`), registered through the registry
//! and seal (#305): its manifest, the check over a grid's fields, and the operator that lays each
//! grid's frame out as rows of styled text for the one shaper, which deep-show's render-back
//! draws. A build without it (core, r1) refuses a document that requires it with
//! `module_missing`, naming `cells`.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Raised, Range, Registrar, Semver};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

/// The grid's drawing: each row of the frame as one line of text in the mono face, its cells'
/// foreground color by run, and each cell's background where it isn't the grid's own.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    /// The grid's top left and cell size, in u.
    pub origin: [f64; 2],
    pub cell: [f64; 2],
    pub font_size: f64,
    pub bg: [u8; 3],
    pub rows: Vec<Row>,
}

impl deep_canvas::schedule::Canonical for Grid {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                &self.origin,
                &self.cell,
                &self.font_size,
                &self.bg,
                &self.rows,
            ),
            out,
        );
    }
}

/// One row: its text and the color of each run of cells that share one.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub text: String,
    pub runs: Vec<(usize, usize, [u8; 3])>,
    pub fills: Vec<(usize, usize, [u8; 3])>,
}

impl deep_canvas::schedule::Canonical for Row {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.text, &self.runs, &self.fills), out);
    }
}

fn manifest() -> Manifest {
    Manifest {
        name: "cells".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [(
            "text".to_string(),
            Dependency {
                range: Range::parse("^1").expect("a range"),
                optional: false,
            },
        )]
        .into_iter()
        .collect(),
        feature: "cells".into(),
        license: "Apache-2.0".into(),
        implements: "cells@1".into(),
        implementation: deep_canvas::registry::Implementation::reference("cells", deep_canvas::registry::Semver::parse("1.0.0").expect("a version")),
    }
}

/// The cells module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

/// The cell grid's params (Cell grid: Fields), each read by the module's own check and operator.
const PARAMS: [&str; 10] = [
    "size", "font", "palette", "frame", "patch", "title", "cwd", "progress", "bell", "play",
];

fn kind() -> Entry {
    Entry {
        family: "",
        name: "cells",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: PARAMS
                .iter()
                .map(|name| Param {
                    name,
                    ty: ParamType::Json,
                    unit: "",
                    default: Value::Null,
                    min: None,
                    max: None,
                    minor: 0,
                    module: "",
                    operator: "",
                })
                .collect(),
        }],
        migrations: Vec::new(),
    }
}

fn register(r: &mut Registrar) {
    // The kind keeps the module's name, as the design writes it.
    r.kind(kind(), &[], "");
    r.array("cells.grid", "grid", "item", "geometry", "items");
    r.operator("grid", "items", &["self", "look"], &["cells.grid"])
        .applies(is_grid)
        .run(grid);
    r.rule("cells", fields_rule);
    r.fixture("grid", board(), None).sidecar(json!({
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": [],
    }));
}

fn is_grid(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("cells@1")
}

const STATUS_ROLES: [&str; 9] = [
    "pass",
    "fail",
    "invalid",
    "blocked",
    "inconclusive",
    "running",
    "needs_you",
    "stale",
    "idle",
];

fn issue(id: &str, field: &str, what: String) -> Raised {
    Raised {
        code: "out_of_range",
        severity: "error",
        path: format!("items/{id}/params/{field}"),
        what,
        fix_ops: None,
    }
}

/// The grid's fields (Cell grid: Fields): its size in u16 cells; a palette of the grid's roles
/// with 16 ANSI roles and never a status role, since a cell can never draw a status color; and a
/// frame of exactly cols × rows cells.
fn fields_rule(_: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let p = &item["params"];
    let mut out = Vec::new();
    let size = &p["size"];
    let dim = |k: &str| {
        size[k]
            .as_u64()
            .filter(|n| (1..=u64::from(u16::MAX)).contains(n))
    };
    for k in ["cols", "rows"] {
        if dim(k).is_none() {
            out.push(issue(
                id,
                &format!("size/{k}"),
                format!("{k} is a count of cells from 1 to 65,535 (u16)"),
            ));
        }
    }
    let palette = &p["palette"];
    let ansi = palette["ansi"].as_array();
    if ansi.is_none_or(|a| a.len() != 16 || a.iter().any(|r| !r.is_string())) {
        out.push(issue(
            id,
            "palette/ansi",
            "the palette's ansi list holds exactly 16 roles".into(),
        ));
    }
    let roles = ["fg", "bg"]
        .into_iter()
        .map(|k| (format!("palette/{k}"), palette[k].as_str()))
        .chain(
            ansi.into_iter()
                .flatten()
                .enumerate()
                .map(|(i, r)| (format!("palette/ansi/{i}"), r.as_str())),
        );
    for (path, role) in roles {
        if let Some(role) = role.filter(|r| STATUS_ROLES.contains(r)) {
            out.push(issue(
                id,
                &path,
                format!("the status role {role} is reachable only through a status binding; a cell can never draw it"),
            ));
        }
    }
    if let (Some(cols), Some(rows), Some(cells)) =
        (dim("cols"), dim("rows"), p["frame"]["cells"].as_array())
    {
        if cells.len() as u64 != cols * rows {
            out.push(issue(
                id,
                "frame/cells",
                format!(
                    "a frame holds cols × rows = {} cells, row-major; this one holds {}",
                    cols * rows,
                    cells.len()
                ),
            ));
        }
    }
    out
}

fn hex(v: &Value) -> Option<[u8; 3]> {
    let s = v.as_str()?.strip_prefix('#')?;
    if s.len() != 6 {
        return None;
    }
    let b = |i: usize| u8::from_str_radix(s.get(i..i + 2)?, 16).ok();
    Some([b(0)?, b(2)?, b(4)?])
}

/// The look's color of `role`, as the session's tokens give it.
fn role(v: &mut View<'_>, role: &str) -> Result<Option<[u8; 3]>, OpError> {
    let tokens = v.look()?;
    Ok(tokens.get(role).and_then(|c| {
        let c: Vec<u8> = c
            .as_array()?
            .iter()
            .filter_map(|x| x.as_u64().and_then(|x| u8::try_from(x).ok()))
            .collect();
        <[u8; 3]>::try_from(c.as_slice()).ok()
    }))
}

/// Each row of the frame as text, its runs of one foreground color and its fills.
fn grid(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v.item()?;
    let path = format!("items/{}/params", v.id().unwrap_or_default());
    let bad = |f: &str| OpError::new("bad_doc", format!("{path}/{f}"));
    let p = &fields["params"];
    let n = |v: &Value| v.as_u64().and_then(|n| usize::try_from(n).ok());
    let cols = n(&p["size"]["cols"]).ok_or_else(|| bad("size/cols"))?;
    let rows = n(&p["size"]["rows"]).ok_or_else(|| bad("size/rows"))?;
    let cell = [
        p["size"]["cell"][0].as_f64().unwrap_or(8.0),
        p["size"]["cell"][1].as_f64().unwrap_or(16.0),
    ];
    let fg_role = p["palette"]["fg"].as_str().unwrap_or("ink").to_string();
    let bg_role = p["palette"]["bg"].as_str().unwrap_or("ground").to_string();
    let fg = role(v, &fg_role)?.ok_or_else(|| bad("palette/fg"))?;
    let bg = role(v, &bg_role)?.ok_or_else(|| bad("palette/bg"))?;
    let cells = p["frame"]["cells"]
        .as_array()
        .ok_or_else(|| bad("frame/cells"))?;
    let mut out = Vec::with_capacity(rows);
    for r in 0..rows {
        let mut row = Row {
            text: String::new(),
            runs: Vec::new(),
            fills: Vec::new(),
        };
        for c in 0..cols {
            let cell = cells.get(r * cols + c);
            let g = cell.and_then(|x| x["g"].as_str()).filter(|g| !g.is_empty());
            row.text.push_str(g.unwrap_or(" "));
            let f = cell.and_then(|x| hex(&x["fg"])).unwrap_or(fg);
            match row.runs.last_mut() {
                Some(last) if last.2 == f && last.1 == c => last.1 = c + 1,
                _ => row.runs.push((c, c + 1, f)),
            }
            if let Some(b) = cell.and_then(|x| hex(&x["bg"])).filter(|b| *b != bg) {
                row.fills.push((c, c + 1, b));
            }
        }
        out.push(row);
    }
    let pos = &fields["at"]["pos"];
    let grid = Grid {
        origin: [
            pos[0].as_f64().unwrap_or(0.0),
            pos[1].as_f64().unwrap_or(0.0),
        ],
        cell,
        font_size: p["font"]["size"].as_f64().unwrap_or(13.0),
        bg,
        rows: out,
    };
    v.write("cells.grid", Val::typed(grid))
}

fn board() -> Value {
    let text = ["$ deep status", "1 claim, 2 checks"];
    let (cols, rows) = (20usize, 2usize);
    let cells: Vec<Value> = (0..cols * rows)
        .map(|i| {
            let g = text[i / cols]
                .chars()
                .nth(i % cols)
                .map_or(String::new(), String::from);
            json!({"g": g, "fg": "#e8e8e8", "bg": "#101010", "attrs": 0, "link": 0})
        })
        .collect();
    let ansi = vec!["ink"; 16];
    json!({
        "format": 1, "profile": "board", "seed": 402, "title": "Cells",
        "description": "A terminal's two rows in a cell grid: the cells module's fixture.",
        "size": [320, 200],
        "requires": {"modules": {"cells": "^1"}},
        "items": {
            "term": {"id": "term", "kind": "cells@1", "name": "Terminal", "order": "a0",
                     "at": {"pos": [16, 16, 0]},
                     "params": {"size": {"cols": cols, "rows": rows, "cell": [8, 16]},
                                "font": {"family": "mono", "size": 13, "fallback": [], "ligatures": false},
                                "palette": {"fg": "ink", "bg": "ground", "ansi": ansi, "truecolor": true},
                                "frame": {"revision": 1, "base": null, "cells": cells, "attrs": crate::emulator::ATTRS,
                                          "cursor": {"x": 0, "y": 1, "shape": "block", "visible": true, "blink": false},
                                          "scroll": {"history": 0, "offset": 0}, "links": {}, "images": [],
                                          "modes": {"alt_screen": false, "bracketed_paste": false, "app_cursor": false,
                                                    "focus_events": false, "mouse": "none"}}}}
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fields_rule_names_each_field_it_refuses() {
        let doc = board();
        let mut item = doc["items"]["term"].clone();
        assert!(fields_rule(&doc, "term", &item).is_empty());
        item["params"]["size"]["cols"] = json!(70_000);
        item["params"]["palette"]["ansi"] = json!(vec!["ink"; 15]);
        item["params"]["palette"]["fg"] = json!("fail");
        let paths: Vec<String> = fields_rule(&doc, "term", &item)
            .into_iter()
            .map(|r| r.path)
            .collect();
        assert_eq!(
            paths,
            [
                "items/term/params/size/cols",
                "items/term/params/palette/ansi",
                "items/term/params/palette/fg"
            ]
        );
        let mut short = doc["items"]["term"].clone();
        short["params"]["frame"]["cells"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert_eq!(
            fields_rule(&doc, "term", &short)[0].path,
            "items/term/params/frame/cells"
        );
    }
}
