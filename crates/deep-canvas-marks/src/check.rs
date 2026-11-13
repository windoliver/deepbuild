//! The marks2d module's check over a document the core check passed, in a look: everything the
//! draw list refuses becomes an issue naming its item (a star past 200 vertices, a fifth mask, a
//! mark set's repeated key), and wherever status can show, an adjust that brings a role its item
//! uses within the status distance is refused, naming the role (Item and kind: adjust).
//!
//! Issue #417: wherever status can show, a look role within the status distance of a status color
//! is refused, naming the role and the state (The status-color rule); and a text a grapheme of
//! which neither its font nor any of the look's fallback fonts can draw is refused with
//! `text.glyph_missing`, naming the item and the grapheme (Text `text@1`).

use serde_json::{json, Map, Value};

use deep_canvas::document::Issue;

use crate::look::{self, Look};
use crate::paint::Adjust;
use crate::scene::{self, object_or_empty, Palette, Planted, Record, Rgb, Type};

/// render.contrast's default minimum: the WCAG ratio a text keeps on what is under its glyphs.
pub const CONTRAST_MIN: f64 = 4.5;

/// #1653: a text whose halos, laid outside in over the ground, leave its ink under
/// [`CONTRAST_MIN`] in either theme is refused, naming the item (Text `text@1`: halo). Under the
/// glyphs every halo covers the run, so the ground is what they make there; offset and blur, which
/// thin a halo only at its edge, are left out.
fn halo_contrast(items: &Map<String, Value>, look: &Look) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in items {
        let kind = item.get("kind").and_then(Value::as_str);
        let params = object_or_empty(item.get("params"));
        let texts = kind == Some("text@1")
            || (kind == Some("marks@1")
                && params.get("mark").and_then(Value::as_str) == Some("text"));
        if !texts || params.get("halo").is_none() {
            continue;
        }
        let path = format!("items/{id}/params/halo");
        for (theme, palette) in [("light", &look.light), ("dark", &look.dark)] {
            let Ok(halos) = crate::fx::halos(palette, params.get("halo"), &path) else {
                continue;
            };
            let ink_role = params
                .get("paint")
                .and_then(|p| p.pointer("/fill/role"))
                .and_then(Value::as_str)
                .unwrap_or("ink");
            let (Some(&ink), Some(&ground)) = (palette.get(ink_role), palette.get("ground")) else {
                continue;
            };
            let under = halos.iter().fold(ground, |base, h| {
                let t = h.opacity.clamp(0.0, 1.0);
                std::array::from_fn(|i| {
                    (f64::from(base[i]) * (1.0 - t) + f64::from(h.color[i]) * t).round() as u8
                })
            });
            let ratio = look::contrast(ink, under);
            if ratio < CONTRAST_MIN {
                out.push(Issue {
                    fix: "Give the halo a role that keeps the text's ink apart, or drop it.".into(),
                    ..Issue::error(
                        "halo_contrast",
                        id,
                        path.clone(),
                        json!({"theme": theme, "ratio": ratio, "min": CONTRAST_MIN}),
                        "its halos bring the text under render.contrast's minimum",
                    )
                });
                break;
            }
        }
    }
    out
}

/// Every look role an item's paint names, sorted and once each.
fn roles(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                match (k.as_str(), v) {
                    ("role", Value::String(r)) if !out.contains(r) => out.push(r.clone()),
                    _ => roles(v, out),
                }
            }
        }
        Value::Array(list) => list.iter().for_each(|v| roles(v, out)),
        _ => {}
    }
}

/// An adjust's issues in one theme: the first role it brings within the status distance.
fn adjust_issue(
    id: &str,
    item: &Value,
    adjust: &Adjust,
    palette: &Palette,
    theme: &'static str,
    status: &look::Status,
) -> Option<Issue> {
    let mut used = Vec::new();
    if let Some(paint) = item.get("params").and_then(|p| p.get("paint")) {
        roles(paint, &mut used);
    }
    used.sort();
    for role in used {
        let Some(color) = palette.get(&role) else {
            continue;
        };
        let shown: Rgb = adjust.rgb(*color);
        let near = status
            .colors
            .iter()
            .find(|(_, s)| look::distance(shown, **s) < status.min_distance);
        if let Some((state, _)) = near {
            return Some(Issue {
                fix:
                    "Change the adjust, or the role, so the item's colors keep the status distance."
                        .into(),
                ..Issue::error(
                    "status_distance",
                    id,
                    format!("items/{id}/adjust"),
                    json!({"role": role, "state": state, "theme": theme}),
                    &format!("the adjust brings `{role}` within the status distance of {state}"),
                )
            });
        }
    }
    None
}

/// Every number the document's mark sets and axes show, with what each traces to (Honest numbers,
/// the check), and the issues tracing finds: a table's cell whose kept bytes differ from the
/// file's (`table_cell_changed`, naming its row), and a table an agent wrote or a template's story
/// number shown where a status or a reading is bound (`number_unsourced`: story numbers).
pub fn numbers(doc: &Map<String, Value>) -> (Vec<Value>, Vec<Issue>) {
    let items = object_or_empty(doc.get("items"));
    let binds = ["status_bindings", "bound_values"].iter().any(|k| {
        doc.get(*k)
            .and_then(Value::as_object)
            .is_some_and(|b| !b.is_empty())
    });
    let (mut shown, mut issues) = (Vec::new(), Vec::new());
    for (id, item) in items {
        let found = crate::data::numbers(id, item, items);
        let mut named = Vec::new();
        for n in &found {
            let name = match n["row"].as_str() {
                Some(row) => format!("{id}#{row}"),
                None => id.clone(),
            };
            if binds && n["source"]["origin"] == "agent" && !named.contains(&name) {
                issues.push(Issue::error(
                    "number_unsourced",
                    &name,
                    format!("items/{id}/params"),
                    n["text"].clone(),
                    "shows a number from a table an agent wrote, a story number, where a status or a reading is bound; read it from a fetched table or bind it to a reading",
                ));
                named.push(name);
            }
        }
        shown.extend(found);
        shown.extend(text_numbers(doc, id, item));
        // A story number a template shows is unsourced where a status or a reading is bound.
        if let (true, Some(Value::String(t))) = (binds, item.pointer("/params/template")) {
            let whole = Value::Object(doc.clone());
            if item.get("kind").and_then(Value::as_str) == Some("text@1")
                && item.pointer("/params/name") != Some(&Value::Bool(true))
            {
                deep_canvas::document::story_issues(&whole, id, t, &mut issues);
            }
        }
        issues.extend(changed_cells(id, item));
    }
    (shown, issues)
}

/// What a text item's numbers trace to, beyond a bound value (#406): each story number a
/// template shows, and each digit run a quote holds, which is quotation, with its raw bytes.
fn text_numbers(doc: &Map<String, Value>, id: &str, item: &Value) -> Vec<Value> {
    if item.get("kind").and_then(Value::as_str) != Some("text@1") {
        return Vec::new();
    }
    let p = object_or_empty(item.get("params"));
    let items = object_or_empty(doc.get("items"));
    let on_anchor = |path: &str| {
        let source = crate::data::anchor_source(path, items)?;
        Some(json!({"item": id, "text": path, "source": source}))
    };
    if let Some(Value::String(source)) = item.pointer("/params/text/counter/source") {
        return on_anchor(source).into_iter().collect();
    }
    if let Some(Value::String(t)) = p.get("template") {
        let slots = deep_canvas::template::parts(t).unwrap_or_default();
        let anchors = slots.iter().filter_map(|part| match part {
            deep_canvas::template::Part::Slot(slot) => on_anchor(slot),
            deep_canvas::template::Part::Words(_) => None,
        });
        let anchors: Vec<Value> = anchors.collect();
        let doc = Value::Object(doc.clone());
        return deep_canvas::template::story_numbers(&doc, t)
            .into_iter()
            .map(|(slot, text)| json!({"item": id, "text": text, "source": {"story": slot}}))
            .chain(anchors)
            .collect();
    }
    let raw = crate::code::raw(p).filter(|r| r.len() <= crate::code::RAW_CAP);
    let (Some(quote), Some(raw)) = (p.get("quote"), raw) else {
        return Vec::new();
    };
    crate::code::digits(&crate::code::display(raw, crate::code::tab(p)))
        .into_iter()
        .map(|(text, bytes)| {
            json!({"item": id, "text": text,
                   "source": {"quotation": quote, "raw": [bytes.start, bytes.end]}})
        })
        .collect()
}

/// Each quoting item whose quoted bytes differ from its source's lines, line ends included
/// (`quote_mismatch`, naming the first line and byte that differ), or whose source `bytes` can't
/// read by its sha256 (`asset_missing`): a code item's raw (Text `text@1`: code), or a formula's
/// `alt` (#1963, Vector and formula `vector@1`: quote). The source is an evidence file,
/// `ev:<sha256>`, or an asset's sha256. The display text never decides it.
pub fn quotes(doc: &Map<String, Value>, bytes: impl Fn(&str) -> Option<Vec<u8>>) -> Vec<Issue> {
    let mut issues = Vec::new();
    for (id, item) in object_or_empty(doc.get("items")) {
        let p = object_or_empty(item.get("params"));
        let Some(quote) = p.get("quote") else {
            continue;
        };
        let field = match item.get("kind").and_then(Value::as_str) {
            Some("vector@1") => "alt",
            _ => "raw",
        };
        let raw = match field {
            "raw" => crate::code::raw(p),
            _ => p
                .get(field)
                .and_then(Value::as_str)
                .map(|alt| alt.as_bytes().into()),
        }
        .unwrap_or_default();
        let source = quote.get("source").and_then(Value::as_str).unwrap_or("");
        let Some(found) = bytes(source.strip_prefix("ev:").unwrap_or(source)) else {
            issues.push(Issue::error(
                "asset_missing",
                id,
                format!("items/{id}/params/quote/source"),
                json!(source),
                "no stored evidence or asset has this sha256",
            ));
            continue;
        };
        let line = |k: usize| {
            quote
                .get("lines")
                .and_then(|l| l.get(k))
                .and_then(Value::as_u64)
                .map_or(1, |n| n as usize)
        };
        if let Some((line, byte)) = crate::code::mismatch(&raw, &found, [line(0), line(1)]) {
            issues.push(Issue {
                fix: "Quote the source's bytes exactly, line ends included, or don't quote it."
                    .into(),
                ..Issue::error(
                    "quote_mismatch",
                    id,
                    format!("items/{id}/params/{field}"),
                    json!({"line": line, "byte": byte}),
                    &format!(
                        "its {field} differs from the source's bytes at line {line}, byte {byte}"
                    ),
                )
            });
        }
    }
    issues
}

/// A table cell quoted by a mark set whose bytes, as the table keeps them, differ from the file's
/// bytes at its range: the trace compares raw bytes, never a normalized form.
fn changed_cells(id: &str, item: &Value) -> Vec<Issue> {
    let p = object_or_empty(item.get("params"));
    let columns = object_or_empty(p.get("columns"));
    let keys = p
        .get("key")
        .and_then(Value::as_str)
        .and_then(|k| columns.get(k));
    let key_of = |row: usize| -> String {
        let cell = keys.and_then(|k| k.get("data")).and_then(|d| d.get(row));
        match (cell, keys.and_then(|k| k.get("trace"))) {
            (Some(Value::String(s)), _) => s.clone(),
            (_, Some(t)) => t["cells"][row]["text"]
                .as_str()
                .map_or(row.to_string(), str::to_string),
            _ => row.to_string(),
        }
    };
    let mut out = Vec::new();
    for (name, c) in columns {
        let Some(cells) = c
            .get("trace")
            .and_then(|t| t.get("cells"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for (row, cell) in cells.iter().enumerate() {
            if cell.get("raw") != cell.get("file") {
                out.push(Issue::error(
                    "table_cell_changed",
                    &format!("{id}#{}", key_of(row)),
                    format!("items/{id}/params/columns/{name}"),
                    json!({"row": row, "bytes": cell.get("bytes")}),
                    "the table keeps this cell's bytes changed from the file's; probe the file again so each cell keeps its raw bytes",
                ));
            }
        }
    }
    out
}

/// Categories a chart tells apart by color alone keep the look's data distance as seen and under
/// simulated protanopia, deuteranopia and tritanopia, unless their marks also differ by shape,
/// dash or a direct label (Scale and encode). Refused naming the pair.
fn roles_apart(items: &Map<String, Value>, look: &Look) -> Vec<Issue> {
    let mut out = Vec::new();
    for (scale_id, scale) in items {
        let p = object_or_empty(scale.get("params"));
        if scale.get("kind").and_then(Value::as_str) != Some("scale@1")
            || p.get("type").and_then(Value::as_str) != Some("ordinal")
        {
            continue;
        }
        let (Some(domain), Some(range)) = (
            p.get("domain").and_then(Value::as_array),
            p.get("range").and_then(Value::as_array),
        ) else {
            continue;
        };
        // Each role's marks, by how they look apart from color: mark type, dash, shape, label.
        let mut styles: Vec<(String, Vec<Value>)> = Vec::new();
        for item in items.values() {
            let mp = object_or_empty(item.get("params"));
            let enc = mp.get("encode").and_then(|e| e.get("role"));
            if enc.and_then(|e| e.get("scale")).and_then(Value::as_str) != Some(scale_id) {
                continue;
            }
            let column = enc.and_then(|e| e.get("column")).and_then(Value::as_str);
            let Some(category) = column
                .and_then(|c| mp.get("columns").and_then(|cs| cs.get(c)))
                .and_then(|c| c.get("const"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(i) = domain.iter().position(|d| d == category) else {
                continue;
            };
            let Some(role) = range.get(i % range.len()).and_then(Value::as_str) else {
                continue;
            };
            let params = item.get("params").unwrap_or(&Value::Null);
            let style = json!([
                mp.get("mark"),
                params.pointer("/paint/stroke/dash"),
                params.pointer("/encode/shape"),
                mp.get("label")
            ]);
            match styles.iter_mut().find(|(r, _)| r == role) {
                Some((_, list)) => list.push(style),
                None => styles.push((role.to_string(), vec![style])),
            }
        }
        'pairs: for (a, (ra, sa)) in styles.iter().enumerate() {
            for (rb, sb) in &styles[a + 1..] {
                if sa.iter().all(|s| !sb.contains(s)) {
                    continue;
                }
                for (theme, palette) in [("light", &look.light), ("dark", &look.dark)] {
                    let (Some(ca), Some(cb)) = (palette.get(ra), palette.get(rb)) else {
                        continue;
                    };
                    let (vision, distance) = look::nearest_vision(*ca, *cb);
                    if distance < look.data_distance {
                        out.push(Issue::error(
                            "roles_too_close",
                            scale_id,
                            format!("items/{scale_id}/params/range"),
                            json!({"roles": [ra, rb], "vision": vision, "theme": theme, "distance": distance}),
                            "two categories told apart by color alone come closer than the look's data distance; give one other roles, or a dash, a shape or a direct label",
                        ));
                        break 'pairs;
                    }
                }
            }
        }
    }
    out
}

/// The look's issue where status can show (#417): the first role within the status distance (`min`,
/// or the look's own) of a status color.
fn distance_issue(look: &Look, min: Option<f64>) -> Option<Issue> {
    let look::Refusal::Distance {
        theme,
        role,
        state,
        distance,
    } = look::clash_of(look, min)?
    else {
        return None;
    };
    Some(Issue {
        fix: "Move the role's color away from the status color, or show the document where no status binds.".into(),
        ..Issue::envelope(
            "status_distance",
            format!("look/roles/{role}"),
            json!({"role": role, "state": state, "theme": theme, "distance": distance}),
            &format!("the role `{role}` sits within the status distance of {state}"),
        )
    })
}

/// Each text's graphemes no face can draw in a theme's type (#417): its font's, then the look's
/// fallback faces in order, shaped by `shaper`, the host's. (Keyed copy, whose every key in every
/// locale this would read, lands with the logic module.)
fn glyph_issues(
    items: &Map<String, Value>,
    ty: &Type,
    shaper: &mut deep_text::Shaper,
    issues: &mut Vec<Issue>,
) {
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("text@1") {
            continue;
        }
        let params = object_or_empty(item.get("params"));
        let Ok(spec) = scene::text_spec_in(id, params, None, ty) else {
            continue;
        };
        let Some(shaper_spec) = spec.shaper_spec() else {
            continue;
        };
        let missing = shaper.missing(&shaper_spec, &spec.text);
        for grapheme in missing {
            let found = |i: &Issue| {
                i.code == "text.glyph_missing"
                    && i.actual["grapheme"] == grapheme.as_str()
                    && i.ids.iter().any(|x| x == id)
            };
            if issues.iter().any(found) {
                continue;
            }
            issues.push(Issue {
                fix: "Add a bundled face that has it to the look's fallback list, or change the text.".into(),
                ..Issue::error(
                    "text.glyph_missing",
                    id,
                    format!("items/{id}/params/text"),
                    json!({"item": id, "grapheme": grapheme}),
                    &format!("no face in the look draws `{grapheme}`"),
                )
            });
        }
    }
}

/// The most characters a text written as text holds (Text `text@1`: `text`); a code item's
/// display text is held to the cap on its raw bytes instead ([`crate::code::RAW_CAP`]).
const TEXT_CAP: usize = 4_096;

/// #1965: each text@1 whose own text runs past text@1's cap, named with its size and the cap.
/// The check holds the cap and the shaper doesn't: #856 shapes one text of 10,000 glyphs.
fn text_cap_issues(items: &Map<String, Value>) -> Vec<Issue> {
    let mut issues = Vec::new();
    for (id, item) in items {
        let text = item.get("params").and_then(|p| p.get("text"));
        let (Some("text@1"), Some(text)) = (
            item.get("kind").and_then(Value::as_str),
            text.and_then(Value::as_str),
        ) else {
            continue;
        };
        let chars = text.chars().count();
        if chars > TEXT_CAP {
            let what =
                format!("its text runs to {chars} characters, past text@1's cap of {TEXT_CAP}");
            let actual = json!({"chars": chars, "cap": TEXT_CAP});
            let path = format!("items/{id}/params/text");
            issues.push(Issue {
                fix: "Shorten the text, or split it between items.".into(),
                ..Issue::error("out_of_range", id, path, actual, &what)
            });
        }
    }
    issues
}

/// #1965: a code item's refusal that names what it holds to: its raw past the code's cap, with
/// its size and the cap, and a token's class outside the list (Text `text@1`: code). `None` for
/// any other refusal.
fn text_refusal(items: &Map<String, Value>, id: &str, r: &scene::Refused) -> Option<Issue> {
    let params = object_or_empty(items.get(id)?.get("params"));
    let field = r.path.strip_prefix(&format!("items/{id}/params/"))?;
    if r.code != "out_of_range" {
        return None;
    }
    let (actual, what, fix) = match field {
        "raw" => {
            let (bytes, cap) = (crate::code::raw(params)?.len(), crate::code::RAW_CAP);
            (
                json!({"bytes": bytes, "cap": cap}),
                format!(
                    "its raw holds {bytes} bytes, past a code item's cap of 256 KiB ({cap} bytes)"
                ),
                "Quote only the lines the film shows.",
            )
        }
        _ => {
            let (_, class) = field.strip_prefix("code/tokens/")?.split_once("/class: ")?;
            let classes = crate::code::CLASSES;
            (
                json!({"class": class, "classes": classes}),
                format!(
                    "a token's class is one of {}; `{class}` is none of them",
                    classes.join(", ")
                ),
                "Give the token a class of the list.",
            )
        }
    };
    Some(Issue {
        fix: fix.into(),
        ..Issue::error(r.code, id, r.path.clone(), actual, &what)
    })
}

/// Each mark set's transforms read at check, standing ranked among them, and every row a log
/// scale can't place, each named.
fn story_issues(items: &Map<String, Value>) -> Vec<Issue> {
    let mut out = Vec::new();
    let refused = |id: &str, r: scene::Refused| {
        Issue::error(
            r.code,
            id,
            r.path.clone(),
            json!(r.path),
            "the document's data doesn't reach this mark set or scale as it says",
        )
    };
    for (id, item) in items {
        match item.get("kind").and_then(Value::as_str) {
            Some("marks@1") => {
                if let Err(r) = crate::data::rows(id, item, items, &Default::default()) {
                    out.push(refused(id, r));
                }
            }
            Some("scale@1") if item.pointer("/params/type") == Some(&json!("log")) => {
                match crate::data::log_rows(id, items) {
                    Ok(rows) => out.extend(rows.into_iter().map(|row| {
                        Issue::error(
                            "log_domain",
                            &row,
                            format!("items/{id}/params/type"),
                            json!(row),
                            "a value at or below 0 has no place on a log scale; use a symlog scale, or filter the row out",
                        )
                    })),
                    Err(r) => out.push(refused(id, r)),
                }
            }
            _ => {}
        }
    }
    out
}

/// The module's issues for `doc`, which the core check passed, in `look`; `min` stands in for the
/// look's status distance (#417 AC9's planted wrong check). Its texts are shaped by `shaper`, the
/// host's, whose run cache keeps them for its frames.
pub fn check(
    doc: &Map<String, Value>,
    look: &Look,
    min: Option<f64>,
    shaper: &mut deep_text::Shaper,
) -> Vec<Issue> {
    let items = object_or_empty(doc.get("items"));
    let mut issues = roles_apart(items, look);
    issues.extend(numbers(doc).1);
    issues.extend(story_issues(items));
    issues.extend(text_cap_issues(items));
    // Status can show wherever a status binding is.
    let status_shows = doc
        .get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty());
    if status_shows {
        issues.extend(distance_issue(look, min));
    }
    if let (true, Some(status)) = (status_shows, &look.status) {
        for (id, item) in items {
            for (theme, palette) in [("light", &look.light), ("dark", &look.dark)] {
                let Ok(adjust) = Adjust::read(item, palette, id) else {
                    continue;
                };
                if adjust.is_identity() {
                    continue;
                }
                if let Some(issue) = adjust_issue(id, item, &adjust, palette, theme, status) {
                    issues.push(issue);
                    break;
                }
            }
        }
    }
    for (palette, ty) in [
        (&look.light, &look.light_type),
        (&look.dark, &look.dark_type),
    ] {
        let built = scene::frame_planted(
            doc,
            items,
            (palette, ty),
            &Record::default(),
            1.0,
            Planted::None,
        );
        if let Err(r) = built {
            // `items/<id>/…`, or `items/<id>: …` for a pair.
            let id = r
                .path
                .strip_prefix("items/")
                .and_then(|rest| rest.split(['/', ':']).next())
                .unwrap_or("");
            if let Some(issue) = text_refusal(items, id, &r) {
                issues.push(issue);
                break;
            }
            // A segment budget names the count the ops declared (#160).
            let actual = if r.code == "segment_budget" {
                scene::declared_of(items, id).map_or(
                    Value::Null,
                    |n| json!({"segments": n, "limit": crate::pathops::MAX_PATH_SEGMENTS}),
                )
            } else {
                Value::Null
            };
            issues.push(Issue {
                fix: "Change the item so the 2D marks module can draw it.".into(),
                ..Issue::error(r.code, id, r.path.clone(), actual, "marks2d refuses it")
            });
            break;
        }
    }
    // #160: a child whose own z would lift it out of the isolated group it draws inside, as a
    // notice (Frame and group: draw order).
    for (id, group) in scene::lifted(items) {
        issues.push(Issue {
            fix: "Give the child the group's z, or draw it outside the isolated group.".into(),
            ..Issue {
                severity: "notice",
                ..Issue::error(
                    "z_inside_isolated",
                    &id,
                    format!("items/{id}/params/z"),
                    json!({"item": id, "group": group}),
                    "its z orders it only inside the isolated group, which draws as one unit at its own z",
                )
            }
        });
    }
    // #467: a looping document's parallax bands travel whole repeats.
    issues.extend(crate::fields::loop_issues(doc, true));
    issues.extend(halo_contrast(items, look));
    // #1653: no repeated status, and no status badge a y sort can slide under.
    issues.extend(crate::fields::status_issues(doc));
    glyph_issues(items, &look.light_type, shaper, &mut issues);
    if look.dark_type != look.light_type {
        glyph_issues(items, &look.dark_type, shaper, &mut issues);
    }
    issues
}
