//! Issue #1966: what a code item draws per line, and the lines a list shares with it (canvas
//! primitives: Text `text@1`: code, and `list`). Lines number from `first_line` in a gutter left
//! of the text, which also marks added, removed and changed lines in the look's diff roles; a
//! highlight dims the other lines to 40% opacity, or bands or boxes its own; and each line is the
//! anchor `#line:n` and each token `#tok:k`, boxes read from the one shaped run.

use std::ops::Range;

use serde_json::{Map, Value};

use crate::scene::{refuse, Fill, Line, Mark, Palette, Refused, Rgb, TextRun, TextSpec, Type};

/// The opacity a highlight that dims leaves the other lines at.
pub const DIMMED: f64 = 0.4;

/// What a highlight does (`treatment: dim_others | band | box`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Treatment {
    DimOthers,
    Band,
    Boxed,
}

/// A code item's `numbers`, `first_line`, `gutter` and `highlight`, each line as its display
/// line's index (0 for `first_line`).
#[derive(Clone, Debug, PartialEq)]
pub struct Lines {
    pub numbers: bool,
    pub first: usize,
    pub gutter: Vec<(usize, &'static str)>,
    pub highlight: Vec<(Range<usize>, Treatment)>,
}

/// The marks a gutter takes, and the roles of the look's `diff` they draw in.
pub const MARKS: [&str; 3] = ["added", "removed", "changed"];

/// A code item's lines as its `code` gives them for `count` display lines, each field held at
/// its path: a line a gutter mark or a highlight names must be one of the item's.
pub fn read(params: &Map<String, Value>, count: usize, path: &str) -> Result<Lines, Refused> {
    let code = params.get("code").and_then(Value::as_object);
    let field = |k: &str| code.and_then(|c| c.get(k));
    let at = |rest: String| format!("{path}/params/code/{rest}");
    let numbers = match field("numbers") {
        None => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => return refuse("bad_doc", at("numbers".into())),
    };
    let first = match field("first_line") {
        None => 1,
        Some(v) => match v.as_u64().filter(|n| *n <= u64::from(u32::MAX)) {
            Some(n) => n as usize,
            None => return refuse("bad_doc", at("first_line".into())),
        },
    };
    // A line as numbered, as its display line's index.
    let line = |v: Option<&Value>, rest: String| -> Result<usize, Refused> {
        let Some(n) = v.and_then(Value::as_u64) else {
            return refuse("bad_doc", at(rest));
        };
        match (n as usize).checked_sub(first).filter(|k| *k < count) {
            Some(k) => Ok(k),
            None => refuse("out_of_range", at(rest)),
        }
    };
    let list = |k: &str| match field(k) {
        None => Ok(&[][..]),
        Some(Value::Array(l)) => Ok(l.as_slice()),
        Some(_) => refuse("bad_doc", at(k.into())),
    };
    let mut gutter = Vec::new();
    for (i, g) in list("gutter")?.iter().enumerate() {
        let k = line(g.get("line"), format!("gutter/{i}/line"))?;
        let mark = g.get("mark").and_then(Value::as_str);
        let Some(mark) = MARKS.iter().find(|m| Some(**m) == mark) else {
            return refuse("bad_doc", at(format!("gutter/{i}/mark")));
        };
        gutter.push((k, *mark));
    }
    let mut highlight = Vec::new();
    for (i, h) in list("highlight")?.iter().enumerate() {
        let ends = h.get("lines").and_then(Value::as_array);
        let (Some(a), Some(b)) = (ends.and_then(|e| e.first()), ends.and_then(|e| e.get(1))) else {
            return refuse("bad_doc", at(format!("highlight/{i}/lines")));
        };
        let (a, b) = (
            line(Some(a), format!("highlight/{i}/lines"))?,
            line(Some(b), format!("highlight/{i}/lines"))?,
        );
        if a > b {
            return refuse("out_of_range", at(format!("highlight/{i}/lines")));
        }
        let treatment = match h.get("treatment").and_then(Value::as_str) {
            None if h.get("treatment").is_none() => Treatment::DimOthers,
            Some("dim_others") => Treatment::DimOthers,
            Some("band") => Treatment::Band,
            Some("box") => Treatment::Boxed,
            _ => return refuse("bad_doc", at(format!("highlight/{i}/treatment"))),
        };
        highlight.push((a..b + 1, treatment));
    }
    Ok(Lines {
        numbers,
        first,
        gutter,
        highlight,
    })
}

/// Each display line of `text` as the graphemes it holds, its line end left out.
pub fn spans(text: &str) -> Vec<Range<usize>> {
    let starts = deep_text::unicode::grapheme_starts(text);
    let index = |byte: usize| starts.partition_point(|&s| s < byte);
    let mut at = 0;
    text.split('\n')
        .map(|line| {
            let span = index(at)..index(at + line.len());
            at += line.len() + 1;
            span
        })
        .collect()
}

/// A shaped run's line height, and the rows each of its text's display lines takes: a line that
/// wraps takes several, and one with no glyph one. A row's top is its index times the line height,
/// plus the run's gap after each line before it ([`top`]).
pub fn rows(shaped: &deep_text::Shaped) -> (f64, Vec<Range<usize>>) {
    let height = match shaped.line_height {
        h if h > 0.0 => f64::from(h),
        _ => f64::from(shaped.height) / shaped.lines.max(1) as f64,
    };
    let spans = spans(&shaped.shown);
    let mut seen: Vec<Option<(usize, usize)>> = vec![None; spans.len()];
    for g in &shaped.glyphs {
        let k = spans.partition_point(|s| s.end <= g.grapheme);
        if spans.get(k).is_some_and(|s| s.contains(&g.grapheme)) {
            let y = f64::from(g.y) - k as f64 * f64::from(shaped.gap);
            let row = (y / height).floor().max(0.0) as usize;
            seen[k] = Some(seen[k].map_or((row, row), |(a, b)| (a.min(row), b.max(row))));
        }
    }
    let mut next = 0;
    let rows = seen
        .into_iter()
        .map(|s| {
            let (a, b) = s.unwrap_or((next, next));
            next = b + 1;
            a..b + 1
        })
        .collect();
    (height, rows)
}

/// The top of display line `k`'s rows `row` in a shaped run of line height `height`.
pub fn top(shaped: &deep_text::Shaped, height: f64, k: usize, row: &Range<usize>) -> f64 {
    row.start as f64 * height + k as f64 * f64::from(shaped.gap)
}

/// The box `[x, y, w, h]` of graphemes `span` of a shaped run, from its origin: as wide as their
/// glyphs advance and as high as the rows they sit on. `None` for a span that draws no glyph.
pub fn span_box(shaped: &deep_text::Shaped, span: &Range<usize>, height: f64) -> Option<[f64; 4]> {
    let (mut x, mut rows) = ((f64::MAX, f64::MIN), (f64::MAX, f64::MIN));
    for g in shaped.glyphs.iter().filter(|g| span.contains(&g.grapheme)) {
        let row = (f64::from(g.y) / height).floor();
        x = (x.0.min(f64::from(g.x)), x.1.max(f64::from(g.x + g.advance)));
        rows = (rows.0.min(row), rows.1.max(row));
    }
    (x.0 <= x.1).then_some([
        x.0,
        rows.0 * height,
        x.1 - x.0,
        (rows.1 - rows.0 + 1.0) * height,
    ])
}

/// The box of a text's read-only anchor `part`, from its shaped run's origin: `line:n`, the line
/// a code item numbers n from its `first_line` (a list's item n, from 1), as wide as its glyphs
/// and as high as its rows, empty at the line's start when it has none; or a code item's
/// `tok:k`, the token `tokens` lists k-th. `None` for any other part, and for a line or a token
/// the text lacks.
pub fn anchor_box(
    params: &Map<String, Value>,
    shaped: &deep_text::Shaped,
    part: &str,
) -> Option<[f64; 4]> {
    let (kind, n) = part.split_once(':')?;
    let n: usize = n.parse().ok()?;
    let (height, rows) = rows(shaped);
    match kind {
        "line" => {
            let first = params
                .get("code")
                .and_then(|c| c.get("first_line"))
                .and_then(Value::as_u64)
                .map_or(1, |f| f as usize);
            let k = n.checked_sub(first)?;
            let row = rows.get(k)?;
            let span = spans(&shaped.shown).swap_remove(k);
            let x = span_box(shaped, &span, height).map_or([0.0, 0.0], |b| [b[0], b[2]]);
            let high = (row.end - row.start) as f64 * height;
            Some([x[0], top(shaped, height, k, row), x[1], high])
        }
        "tok" => {
            let d = crate::code::read(params, "").ok()??;
            span_box(shaped, &crate::code::anchor(params, &d, part)?, height)
        }
        _ => None,
    }
}

/// What a code item draws beside its text: the highlights' bands under it, its line numbers,
/// gutter marks and highlight boxes over it, each a part of the item `<id>#…`, and the
/// graphemes of its text that a highlight dims, with the parts it dims and their opacity.
pub struct Gutter {
    pub under: Vec<Mark>,
    pub over: Vec<Mark>,
    pub dim: Vec<Range<usize>>,
    pub fades: Vec<(String, f64)>,
    /// How far the gutter reaches left of the text's origin.
    pub reach: f64,
}

/// The gutter and highlights of the code item `id`, whose text `spec` is shaped as `shaped` at
/// `origin` in the item's paint `(role, color)`, in a look's palette and type: numbers in the
/// look's comment role right-aligned one cell left of the text, each gutter mark a bar in its
/// diff role between them, a band in the accent role at 12% under its lines, a box in it around
/// them. A gutter mark the look gives no role is refused naming it.
pub fn gutter(
    id: &str,
    (spec, shaped, origin): (&TextSpec, &deep_text::Shaped, [f64; 2]),
    lines: &Lines,
    (palette, ty): (&Palette, &Type),
    (role, color): (Option<&str>, Rgb),
) -> Result<Gutter, Refused> {
    let (height, rows) = rows(shaped);
    let spans = spans(&shaped.shown);
    let count = spans.len();
    let cell = spec
        .family
        .and_then(deep_text::shape::advance_em)
        .map_or(0.6, f64::from)
        * spec.size;
    let [ox, oy] = origin;
    let gap = cell;
    let mut out = Gutter {
        under: Vec::new(),
        over: Vec::new(),
        dim: Vec::new(),
        fades: Vec::new(),
        reach: gap,
    };
    // A line no highlight that dims holds is dimmed, once any highlight dims.
    let dims: Vec<&Range<usize>> = lines
        .highlight
        .iter()
        .filter(|(_, t)| *t == Treatment::DimOthers)
        .map(|(l, _)| l)
        .collect();
    let dimmed = |k: usize| !dims.is_empty() && !dims.iter().any(|l| l.contains(&k));
    out.dim = (0..count)
        .filter(|k| dimmed(*k))
        .map(|k| spans[k].clone())
        .filter(|s| !s.is_empty())
        .collect();
    let rows_of = |l: &Range<usize>| {
        let (a, b) = (rows[l.start].start, rows[l.end - 1].end);
        let y = top(shaped, height, l.start, &rows[l.start]);
        (oy + y, (b - a) as f64 * height)
    };
    let accent = palette.get("accent").copied().unwrap_or(color);
    let right = spec.width.unwrap_or(0.0).max(f64::from(shaped.width));
    for (i, (l, treatment)) in lines.highlight.iter().enumerate() {
        let (y, h) = rows_of(l);
        let rect = [ox - cell / 4.0, y, right + cell / 2.0, h];
        match treatment {
            Treatment::DimOthers => {}
            Treatment::Band => out.under.push(Mark::Shape {
                item: format!("{id}#band:{i}"),
                verbs: crate::outline::rect(rect, 0.0),
                fill: Some((Fill::Solid(accent), 0.12)),
                stroke: None,
            }),
            Treatment::Boxed => out.over.push(Mark::Shape {
                item: format!("{id}#box:{i}"),
                verbs: crate::outline::rect(rect, 0.0),
                fill: None,
                stroke: Some(Line {
                    width: (spec.size / 12.0).max(1.0),
                    paint: Fill::Solid(accent),
                    opacity: 1.0,
                    dashes: None,
                    profile: None,
                }),
            }),
        }
    }
    for (k, mark) in &lines.gutter {
        let Some(c) = ty.diff.get(*mark).and_then(|r| palette.get(r)) else {
            return refuse("role_unresolved", format!("look/diff/{mark}"));
        };
        let part = format!("{id}#gutter:{}", lines.first + k);
        let (y, h) = rows_of(&(*k..k + 1));
        out.over.push(Mark::Rect {
            item: part.clone(),
            bounds: [ox - gap * 0.625, y, gap / 4.0, h],
            radius: 0.0,
            fill: Fill::Solid(*c),
        });
        if dimmed(*k) {
            out.fades.push((part, DIMMED));
        }
    }
    if lines.numbers && count > 0 {
        let digits = (lines.first + count - 1).to_string().len();
        let width = digits as f64 * cell;
        let (name, c) = match ty
            .code
            .get("comment")
            .and_then(|r| Some((r, palette.get(r)?)))
        {
            Some((r, c)) => (r.clone(), *c),
            None => (role.unwrap_or_default().to_string(), color),
        };
        // One number a line, on its first row: a line that wraps leaves its other rows blank.
        let mut text = String::new();
        let mut runs = Vec::new();
        let mut grapheme = 0;
        for (k, row) in rows.iter().enumerate() {
            if k > 0 {
                text.push('\n');
                grapheme += 1;
            }
            let number = (lines.first + k).to_string();
            if dimmed(k) {
                runs.push(TextRun {
                    from: grapheme,
                    to: grapheme + number.len(),
                    role: name.clone(),
                    color: c,
                    opacity: DIMMED,
                });
            }
            grapheme += number.len();
            text.push_str(&number);
            for _ in 1..row.len() {
                text.push('\n');
                grapheme += 1;
            }
        }
        out.reach = gap + width;
        out.over.push(Mark::Text {
            item: format!("{id}#numbers"),
            spec: TextSpec {
                text,
                width: Some(width),
                max_lines: None,
                mask: false,
                bound: false,
                align: crate::scene::Align::End,
                spans: Vec::new(),
                gap: 0.0,
                indent: 0.0,
                ..spec.clone()
            },
            origin: [ox - gap - width, oy],
            role: Some(name),
            color: c,
            runs,
        });
    }
    Ok(out)
}

/// A text's `runs` with the graphemes of `dim` drawn at [`DIMMED`]: each run cut at their ends,
/// and the graphemes of `dim` no run holds given a run in the item's paint `(role, color)`.
pub fn dimmed(
    runs: Vec<TextRun>,
    dim: &[Range<usize>],
    (role, color): (&str, Rgb),
) -> Vec<TextRun> {
    if dim.is_empty() {
        return runs;
    }
    let mut all = runs.clone();
    for d in dim {
        let mut at = d.start;
        for r in runs.iter().filter(|r| r.to > d.start && r.from < d.end) {
            if r.from > at {
                all.push(plain(at..r.from, role, color));
            }
            at = at.max(r.to);
        }
        if at < d.end {
            all.push(plain(at..d.end, role, color));
        }
    }
    all.sort_by_key(|r| r.from);
    let mut out = Vec::with_capacity(all.len() + dim.len());
    for r in all {
        let mut from = r.from;
        for d in dim.iter().filter(|d| d.end > r.from && d.start < r.to) {
            if d.start > from {
                out.push(TextRun {
                    from,
                    to: d.start,
                    ..r.clone()
                });
            }
            let to = d.end.min(r.to);
            out.push(TextRun {
                from: from.max(d.start),
                to,
                opacity: DIMMED,
                ..r.clone()
            });
            from = to;
        }
        if from < r.to {
            out.push(TextRun { from, ..r });
        }
    }
    out
}

fn plain(span: Range<usize>, role: &str, color: Rgb) -> TextRun {
    TextRun {
        from: span.start,
        to: span.end,
        role: role.to_string(),
        color,
        opacity: 1.0,
    }
}

/// What marks each item of a list (`marker: bullet | number | none`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Marker {
    Bullet,
    Number,
    None,
}

/// A text's `list: {marker = none, indent: u = 1.2 × size, gap: u = 0}`: each line after `\n`
/// an item, its text `indent` in from the item's origin with its marker before it, and `gap`
/// between items; the item's one shaped run sets both.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct List {
    pub marker: Marker,
    pub indent: f64,
    pub gap: f64,
}

/// A text's `list` at `size`, each field held at its path; `None` for a text that isn't one.
pub fn list(params: &Map<String, Value>, size: f64, path: &str) -> Result<Option<List>, Refused> {
    let at = |k: &str| format!("{path}/params/list/{k}");
    let l = match params.get("list") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Object(l)) => l,
        Some(_) => return refuse("bad_doc", format!("{path}/params/list")),
    };
    let marker = match l.get("marker").map(Value::as_str) {
        None | Some(Some("none")) => Marker::None,
        Some(Some("bullet")) => Marker::Bullet,
        Some(Some("number")) => Marker::Number,
        Some(_) => return refuse("bad_doc", at("marker")),
    };
    let length = |k: &str, default: f64| match l.get(k) {
        None => Ok(default),
        Some(v) => match v.as_f64().filter(|u| u.is_finite() && *u >= 0.0) {
            Some(u) => Ok(u),
            None => refuse("out_of_range", at(k)),
        },
    };
    Ok(Some(List {
        marker,
        indent: length("indent", 1.2 * size)?,
        gap: length("gap", 0.0)?,
    }))
}

/// A list's markers, each a part `<id>#marker:n` of its item n (from 1) before the item's first
/// row: a bullet, or the item's number and a point, in the item's paint, set as its text and
/// right-aligned to 0.4 × size short of where its text starts, `indent` in from the list's
/// `origin`.
pub fn markers(
    id: &str,
    (spec, shaped, origin): (&TextSpec, &deep_text::Shaped, [f64; 2]),
    list: List,
    (role, color): (Option<&str>, Rgb),
) -> Vec<Mark> {
    let (height, rows) = rows(shaped);
    let width = (list.indent - 0.4 * spec.size).max(0.0);
    rows.iter()
        .enumerate()
        .filter_map(|(k, row)| {
            let text = match list.marker {
                Marker::Bullet => "\u{2022}".to_string(),
                Marker::Number => format!("{}.", k + 1),
                Marker::None => return None,
            };
            Some(Mark::Text {
                item: format!("{id}#marker:{}", k + 1),
                spec: TextSpec {
                    text,
                    width: Some(width),
                    max_lines: None,
                    mask: false,
                    bound: false,
                    align: crate::scene::Align::End,
                    spans: Vec::new(),
                    gap: 0.0,
                    indent: 0.0,
                    ..spec.clone()
                },
                origin: [origin[0], origin[1] + top(shaped, height, k, row)],
                role: role.map(str::to_string),
                color,
                runs: Vec::new(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use crate::scene::{frame_planted, Fill, Mark, Palette, Planted, Record, Refused, Type};

    /// The marks of one text@1 `c` at (100, 20), in a look whose comment role is grey and whose
    /// diff roles are green, red and amber.
    fn drawn(params: Value) -> Result<Vec<Mark>, Refused> {
        let doc = json!({"size": [400, 300], "layers": {"main": {"order": "a0"}}, "items": {"c": {
            "kind": "text@1", "layer": "main", "at": {"pos": [100, 20, 0]}, "params": params}}});
        let doc = doc.as_object().unwrap();
        let roles = [
            ("ground", [255; 3]),
            ("ink", [0; 3]),
            ("accent", [0, 0, 200]),
            ("grey", [128; 3]),
        ];
        let diff = [
            ("green", [0, 160, 0]),
            ("red", [200, 0, 0]),
            ("amber", [200, 150, 0]),
        ];
        let palette: Palette = roles
            .into_iter()
            .chain(diff)
            .map(|(r, c)| (r.into(), c))
            .collect();
        let named = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(k, r)| (k.to_string(), r.to_string()))
                .collect()
        };
        let ty = Type {
            code: named(&[("comment", "grey")]),
            diff: named(&[("added", "green"), ("removed", "red"), ("changed", "amber")]),
            ..Type::default()
        };
        let items = doc["items"].as_object().unwrap();
        let f = frame_planted(
            doc,
            items,
            (&palette, &ty),
            &Record::default(),
            1.0,
            Planted::None,
        )?;
        Ok(f.layers[0].marks.iter().map(|d| d.mark.clone()).collect())
    }

    fn named<'a>(marks: &'a [Mark], item: &str) -> (usize, &'a Mark) {
        let k = marks.iter().position(|m| m.item() == item);
        (
            k.unwrap_or_else(|| panic!("a mark {item}")),
            &marks[k.unwrap()],
        )
    }

    #[test]
    fn code_lines_number_mark_and_highlight_beside_the_text_and_a_list_spaces_its_numbered_items() {
        // Size 10 in the mono face: a 6 u cell and a 13 u line.
        let code = |gutter: Value| {
            json!({"raw": "a\nbb\nccc\n", "size": 10, "code": {"language": "text", "first_line": 9,
                "gutter": gutter, "highlight": [{"lines": [9, 9], "treatment": "band"},
                    {"lines": [11, 11], "treatment": "box"}]}})
        };
        let marks = drawn(code(json!([{"line": 10, "mark": "added"}]))).unwrap();
        let (text, _) = named(&marks, "c");
        // Numbers 9 to 11 right-aligned one cell left of the text, in the comment role.
        let Mark::Text {
            spec, origin, role, ..
        } = named(&marks, "c#numbers").1
        else {
            panic!()
        };
        let r = |v: f64| (v * 1000.0).round() / 1000.0;
        let at = (spec.width.map(r), origin.map(r));
        assert_eq!(
            (spec.text.as_str(), at),
            ("9\n10\n11", (Some(12.0), [82.0, 20.0]))
        );
        assert_eq!(role.as_deref(), Some("grey"));
        // Line 10's mark in the added role, on its row; the band under the text, the box over it.
        let Mark::Rect { bounds, fill, .. } = named(&marks, "c#gutter:10").1 else {
            panic!()
        };
        assert_eq!(
            (bounds[1], bounds[3], fill),
            (33.0, 13.0, &Fill::Solid([0, 160, 0]))
        );
        let (band, Mark::Shape { fill: Some(_), .. }) = named(&marks, "c#band:0") else {
            panic!()
        };
        let (
            boxed,
            Mark::Shape {
                stroke: Some(_),
                verbs,
                ..
            },
        ) = named(&marks, "c#box:1")
        else {
            panic!()
        };
        assert!(band < text && text < boxed);
        assert_eq!(crate::scene::bounds_of(verbs)[1], 46.0);
        // A mark on a line the code lacks is refused, naming it.
        let r = drawn(code(json!([{"line": 12, "mark": "added"}]))).unwrap_err();
        assert_eq!(
            (r.code, r.path.as_str()),
            ("out_of_range", "items/c/params/code/gutter/0/line")
        );

        // A numbered list's second item starts a line and its 5 u gap down, its marker beside it.
        let list = json!({"text": "a\nb", "size": 10, "list": {"marker": "number", "gap": 5}});
        let marks = drawn(list).unwrap();
        let tops: Vec<(String, f64)> = ["c#marker:1", "c#marker:2"]
            .iter()
            .map(|id| match named(&marks, id).1 {
                Mark::Text { spec, origin, .. } => (spec.text.clone(), origin[1]),
                _ => panic!(),
            })
            .collect();
        assert_eq!(tops, [("1.".to_string(), 20.0), ("2.".to_string(), 38.0)]);
    }
}
