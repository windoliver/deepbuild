//! The cells canvas module (technical design: Canvas modules, the module table's `cells` row,
//! "Depends on text"; canvas primitives: Cell grid `cells@1`), registered through the registry
//! and seal (#305): its manifest, the check over a grid's fields, and the operator that lays each
//! grid's frame out as rows of styled text for the one shaper, which deep-show's render-back
//! draws. A build without it (core, r1) refuses a document that requires it with
//! `module_missing`, naming `cells`.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Raised, Range, Registrar, Semver};
use deep_canvas::schedule::{OpError, Val, View};

use crate::palette::resolve_in;
use crate::recording;
use serde_json::{json, Value};

/// The grid's drawing: each row of the frame as one line of text in the mono face, its cells'
/// foreground color by run, and each cell's background where it isn't the grid's own; and every
/// cell as drawn, with the cursor, which a comparison reads (#1967).
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    /// The grid's top left and cell size, in u.
    pub origin: [f64; 2],
    pub cell: [f64; 2],
    pub font_size: f64,
    pub bg: [u8; 3],
    pub rows: Vec<Row>,
    pub cols: usize,
    /// Every cell, row-major, as drawn.
    pub cells: Vec<Drawn>,
    pub cursor: Cursor,
    /// For a grid that plays a recording, the source time it shows; never part of its value.
    pub source: Option<i64>,
}

impl deep_canvas::schedule::Canonical for Grid {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                (&self.origin, &self.cell, &self.font_size, &self.bg),
                &self.rows,
                (&self.cols, &self.cells, &self.cursor),
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

/// One cell as drawn: its grapheme (`""` for a blank cell), its colors after the palette, its
/// attribute bits in [`crate::emulator::ATTRS`] order and its link ID, 0 for none.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub g: String,
    pub fg: [u8; 3],
    pub bg: [u8; 3],
    pub attrs: u16,
    pub link: u32,
}

impl deep_canvas::schedule::Canonical for Drawn {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &((&self.g, &self.fg, &self.bg), (&self.attrs, &self.link)),
            out,
        );
    }
}

/// The cursor as the frame gives it (Cell grid: `cursor`).
#[derive(Clone, Debug, PartialEq)]
pub struct Cursor {
    pub x: u64,
    pub y: u64,
    pub shape: String,
    pub visible: bool,
    pub blink: bool,
}

impl deep_canvas::schedule::Canonical for Cursor {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(
                (&self.x, &self.y),
                &self.shape,
                (&self.visible, &self.blink),
            ),
            out,
        );
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
        implementation: deep_canvas::registry::Implementation::reference(
            "cells",
            deep_canvas::registry::Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// The cells module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

/// The cell grid's params (Cell grid: Fields), each read by the module's own check and operator,
/// with the forms they take (#1973).
const PARAMS: [(&str, &str); 11] = [
    ("size", "{cols: u16, rows: u16, cell: [px, px]}"),
    ("font", "{family: font, size: px, fallback: [font], ligatures: bool}"),
    ("palette", "{fg: role, bg: role, ansi: [role] (16), truecolor: bool}"),
    (
        "frame",
        "{revision: u64, base: u64, cells: [{g: grapheme, fg, bg, attrs: u16, link}], attrs: [name], cursor: {x, y, shape, visible, blink}, scroll, links, images: [sha256], modes}",
    ),
    ("patch", "{revision: u64, base: u64, rows: [{y: u16, x: u16, cells}], cursor: {x, y}}"),
    ("title", "text"),
    ("cwd", "path"),
    ("progress", "0..1"),
    ("bell", "u32"),
    ("play", "{asset: sha256, start: time | flick, in: flick, rate: number | text (p/q) | [p, q]}"),
    (
        "grid",
        "{array: <logic>.<name>, size: [cols, rows: u16], glyphs: [grapheme] ≤ 4096, roles: [role] ≤ 16, attrs: [name] ≤ 8}",
    ),
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
                .map(|&(name, form)| Param {
                    name,
                    ty: ParamType::Json(form),
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
    // #1967: a grid that plays a recording names it in `play.asset`, which the decode worker
    // probes and converts when the document is checked.
    r.kind(kind(), &[], "").probes("play/asset");
    r.array("cells.grid", "grid", "item", "geometry", "items");
    // #1967: a grid that plays a recording reads the time and the recording as the decode
    // worker converted it, which the host holds outside the document.
    // #538: a logic grid reads its array, baked into the document, through the core's view.
    r.operator(
        "grid",
        "items",
        &["self", "look", "t", "reading", "refs"],
        &["cells.grid"],
    )
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
    // #538: a logic grid in place of a frame: its own size and lists, never a status role.
    match crate::logic_grid::spec(p) {
        Err((field, what)) => return vec![issue(id, &field, what)],
        Ok(Some(s)) => {
            let roles = s
                .roles
                .iter()
                .enumerate()
                .map(|(i, r)| (format!("grid/roles/{i}"), Some(*r)));
            let palette = ["fg", "bg"].map(|k| (format!("palette/{k}"), p["palette"][k].as_str()));
            for (path, role) in roles.chain(palette) {
                if let Some(role) = role.filter(|r| STATUS_ROLES.contains(r)) {
                    out.push(issue(id, &path, format!("the status role {role} is reachable only through a status binding; a cell can never draw it")));
                }
            }
            return out;
        }
        Ok(None) => {}
    }
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

/// A time field in flicks: a whole number of flicks, or a time literal such as `"1.5s"`.
fn time_of(v: &Value) -> Option<i64> {
    match v {
        Value::Null => Some(0),
        Value::Number(n) => n.as_i64(),
        Value::String(s)
            if s.trim_start_matches(['0', '.'])
                .trim_end_matches(['s', 'f'])
                .is_empty() =>
        {
            Some(0)
        }
        t => deep_canvas::document::duration(&Value::Null, t).ok(),
    }
}

/// The frame a grid that plays a recording shows at the session's time (Cell grid: `play`):
/// the conversion's keyframe at or before the source time plus the patches up to it.
fn played(v: &mut View<'_>, play: &Value, path: &str) -> Result<(Value, i64), OpError> {
    let bad = |f: &str| OpError::new("bad_doc", format!("{path}/play/{f}"));
    let sha = play["asset"].as_str().ok_or_else(|| bad("asset"))?;
    let start = time_of(&play["start"]).ok_or_else(|| bad("start"))?;
    let t = v.t()?;
    let source = recording::source_time(play, start, t).ok_or_else(|| bad("rate"))?;
    let planted = v.planted();
    // A session that doesn't hold the conversion, as a document's check doesn't, draws the
    // grid blank; the host's probe names a recording it can't read.
    let Some(converted) = v.outside()?.readings.get(&format!("terminal:{sha}")) else {
        return Ok((json!({"cells": []}), source));
    };
    let shown = match planted {
        // Planted: every patch of the recording, whatever t.
        Some("cells_play_every_patch") => i64::MAX,
        // Planted: a seek (the session's first frame, or one earlier than the last) shows the
        // keyframe at or before the source time and none of the patches after it.
        Some("cells_seek_skips_patches") => {
            let last = v.last("cells.grid").and_then(|g| g.as_typed::<Grid>());
            let seek = last.and_then(|g| g.source).is_none_or(|was| source < was);
            let keyframes = converted["keyframes"].as_array().map_or(1, Vec::len).max(1) as i64;
            let key = source
                .div_euclid(recording::KEYFRAME_EVERY)
                .clamp(0, keyframes - 1);
            match seek {
                true => key * recording::KEYFRAME_EVERY,
                false => source,
            }
        }
        _ => source,
    };
    let frame = recording::frame_at(converted, shown).ok_or_else(|| bad("asset"))?;
    Ok((frame, source))
}

/// Each row of the frame as text, its runs of one foreground color and its fills; and every
/// cell as drawn. A cell's colors are the palette's defaults, one of its 16 ANSI roles (or the
/// 256-color cube) by index, or a color the program sent, drawn as sent.
fn grid(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v.item()?;
    let path = format!("items/{}/params", v.id().unwrap_or_default());
    let bad = |f: &str| OpError::new("bad_doc", format!("{path}/{f}"));
    let p = &fields["params"];
    if let Some(s) = crate::logic_grid::spec(p).map_err(|(f, _)| bad(&f))? {
        return logic_grid(v, fields, &s);
    }
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
    let mut ansi = crate::palette::ANSI;
    for (i, r) in p["palette"]["ansi"]
        .as_array()
        .into_iter()
        .flatten()
        .take(16)
        .enumerate()
    {
        if let Some(c) = r.as_str().map(|r| role(v, r)).transpose()?.flatten() {
            ansi[i] = c;
        }
    }
    let (frame, source) = match p.get("play").filter(|x| !x.is_null()) {
        Some(play) => {
            let (frame, source) = played(v, play, &path)?;
            (std::borrow::Cow::Owned(frame), Some(source))
        }
        None => (std::borrow::Cow::Borrowed(&p["frame"]), None),
    };
    let cells = frame["cells"]
        .as_array()
        .ok_or_else(|| bad("frame/cells"))?;
    let mut out = Vec::with_capacity(rows);
    let mut drawn = Vec::with_capacity(cols * rows);
    for r in 0..rows {
        let mut row = Row {
            text: String::new(),
            runs: Vec::new(),
            fills: Vec::new(),
        };
        for c in 0..cols {
            let cell = cells.get(r * cols + c).map(recording::cell_of);
            let g = cell.as_ref().map(|x| x.g.text()).unwrap_or_default();
            row.text.push_str(if g.is_empty() { " " } else { &g });
            let f = cell.as_ref().map_or(fg, |x| resolve_in(x.fg, fg, &ansi));
            let b = cell.as_ref().map_or(bg, |x| resolve_in(x.bg, bg, &ansi));
            match row.runs.last_mut() {
                Some(last) if last.2 == f && last.1 == c => last.1 = c + 1,
                _ => row.runs.push((c, c + 1, f)),
            }
            if b != bg {
                row.fills.push((c, c + 1, b));
            }
            drawn.push(Drawn {
                g,
                fg: f,
                bg: b,
                attrs: cell.as_ref().map_or(0, |x| x.attrs),
                link: cell.as_ref().map_or(0, |x| x.link),
            });
        }
        out.push(row);
    }
    let k = &frame["cursor"];
    let cursor = Cursor {
        x: k["x"].as_u64().unwrap_or(0),
        y: k["y"].as_u64().unwrap_or(0),
        shape: k["shape"].as_str().unwrap_or("block").to_string(),
        visible: k["visible"].as_bool().unwrap_or(true),
        blink: k["blink"].as_bool().unwrap_or(false),
    };
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
        cols,
        cells: drawn,
        cursor,
        source,
    };
    v.write("cells.grid", Val::typed(grid))
}

/// #538: the planted unpacking that wraps each index into its list rather than drawing blank.
pub const GRID_WRAPS_INDEX: &str = "grid_wraps_index";

/// #538: a logic grid's cells at the session's t, each value unpacked into a glyph from its list
/// and its roles' colors; a value past its lists draws a blank cell in the grid's background.
fn logic_grid(
    v: &mut View<'_>,
    fields: &Value,
    s: &crate::logic_grid::Spec<'_>,
) -> Result<(), OpError> {
    let p = &fields["params"];
    let t = v.t()?;
    let wraps = v.planted() == Some(GRID_WRAPS_INDEX);
    let doc = v.document()?;
    let cells = crate::logic_grid::cells(
        s,
        doc.pointer("/arrays").and_then(|a| a.get(s.array)),
        t,
        wraps,
    );
    let bg = role(v, p["palette"]["bg"].as_str().unwrap_or("ground"))?.unwrap_or([0, 0, 0]);
    let fg = role(v, p["palette"]["fg"].as_str().unwrap_or("ink"))?.unwrap_or([255, 255, 255]);
    let mut colors = Vec::with_capacity(s.roles.len());
    for r in &s.roles {
        colors.push(role(v, r)?.unwrap_or(fg));
    }
    let mut rows = Vec::with_capacity(s.rows);
    let mut drawn = Vec::with_capacity(s.cols * s.rows);
    for r in 0..s.rows {
        let mut row = Row {
            text: String::new(),
            runs: Vec::new(),
            fills: Vec::new(),
        };
        for c in 0..s.cols {
            let cell = cells[r * s.cols + c];
            let g = cell.map_or("", |x| s.glyphs[x.glyph]);
            row.text.push_str(if g.is_empty() { " " } else { g });
            let f = cell.map_or(fg, |x| colors[x.fg]);
            let b = cell.map_or(bg, |x| colors[x.bg]);
            match row.runs.last_mut() {
                Some(last) if last.2 == f && last.1 == c => last.1 = c + 1,
                _ => row.runs.push((c, c + 1, f)),
            }
            if b != bg {
                row.fills.push((c, c + 1, b));
            }
            drawn.push(Drawn {
                g: g.to_string(),
                fg: f,
                bg: b,
                attrs: cell.map_or(0, |x| x.attrs),
                link: 0,
            });
        }
        rows.push(row);
    }
    let pos = &fields["at"]["pos"];
    let grid = Grid {
        origin: [
            pos[0].as_f64().unwrap_or(0.0),
            pos[1].as_f64().unwrap_or(0.0),
        ],
        cell: [
            p["size"]["cell"][0].as_f64().unwrap_or(8.0),
            p["size"]["cell"][1].as_f64().unwrap_or(16.0),
        ],
        font_size: p["font"]["size"].as_f64().unwrap_or(13.0),
        bg,
        rows,
        cols: s.cols,
        cells: drawn,
        // A logic grid has no cursor.
        cursor: Cursor {
            x: 0,
            y: 0,
            shape: "block".into(),
            visible: false,
            blink: false,
        },
        source: None,
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
