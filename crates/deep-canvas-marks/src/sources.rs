use serde_json::{json, Map, Value};

use deep_canvas::document::Issue;

use crate::scene::{object_or_empty, Align, Mark, Palette, Refused, TextSpec};

pub const KIND: &str = "sources@1";
pub const CHECK: &str = "data.sources";
pub const FIELDS: [&str; 10] = [
    "title",
    "publisher",
    "edition",
    "license",
    "credit",
    "url",
    "fetched",
    "sha256",
    "bytes",
    "used_by",
];
const PARAMS: [&str; 3] = ["of", "fields", "group"];
const GROUPS: [&str; 2] = ["none", "publisher"];
const MISSING: &str = "–";
const BETWEEN: &str = " · ";
const SIZE: f64 = 12.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    LeavesOutUncredited,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        (name == "sources_leaves_out_uncredited").then_some(Planted::LeavesOutUncredited)
    }
}

pub struct Row {
    pub file: Value,
    pub group: Option<String>,
    pub fields: Vec<(String, String)>,
}

pub type Drawn = Vec<(String, Vec<Row>)>;

struct Used {
    file: Value,
    by: Vec<String>,
}

fn files_of<'a>(items: &'a Map<String, Value>, table: &str) -> Option<&'a Vec<Value>> {
    let columns = items
        .values()
        .filter_map(|item| item.pointer("/params/columns")?.as_object())
        .flat_map(Map::values);
    columns
        .map(|column| &column["trace"])
        .find(|trace| trace["table"] == table)?["files"]
        .as_array()
}

fn used(items: &Map<String, Value>, shown: &[Value], of: Option<&[&str]>) -> Vec<Used> {
    let mut out: Vec<Used> = Vec::new();
    for number in shown {
        let (Some(item), Some(table)) =
            (number["item"].as_str(), number["source"]["table"].as_str())
        else {
            continue;
        };
        if of.is_some_and(|ids| !ids.contains(&item)) {
            continue;
        }
        for file in files_of(items, table).into_iter().flatten() {
            let at = out.iter().position(|u| u.file["sha256"] == file["sha256"]);
            let at = at.unwrap_or_else(|| {
                out.push(Used {
                    file: file.clone(),
                    by: Vec::new(),
                });
                out.len() - 1
            });
            if !out[at].by.iter().any(|by| by == item) {
                out[at].by.push(item.to_string());
            }
        }
    }
    out
}

fn host(url: &str) -> Option<&str> {
    let authority = url.split("://").nth(1)?.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    match host.strip_prefix('[') {
        Some(rest) => rest.split(']').next(),
        None => host.split(':').next(),
    }
}

fn written(file: &Value, field: &str) -> Option<String> {
    match &file[field] {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn text_of(file: &Value, field: &str, used_by: usize) -> String {
    if field == "used_by" {
        return used_by.to_string();
    }
    written(file, field).unwrap_or_else(|| MISSING.to_string())
}

fn named(file: &Value) -> String {
    written(file, "title")
        .or_else(|| file["url"].as_str().and_then(host).map(str::to_string))
        .unwrap_or_else(|| MISSING.to_string())
}

fn scope(params: &Map<String, Value>) -> Option<Vec<&str>> {
    let ids = params.get("of")?.as_array()?;
    Some(ids.iter().filter_map(Value::as_str).collect())
}

pub fn rows(
    items: &Map<String, Value>,
    shown: &[Value],
    item: &Value,
    planted: Planted,
) -> Vec<Row> {
    let params = object_or_empty(item.get("params"));
    let fields = params.get("fields").and_then(Value::as_array);
    let fields: Vec<&str> = fields
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|field| FIELDS.contains(field))
        .collect();
    let grouped = params.get("group").and_then(Value::as_str) == Some("publisher");
    let mut rows: Vec<Row> = used(items, shown, scope(params).as_deref())
        .into_iter()
        .filter(|u| planted != Planted::LeavesOutUncredited || u.file["credit"].is_string())
        .map(|u| Row {
            group: grouped.then(|| {
                written(&u.file, "publisher")
                    .or_else(|| u.file["url"].as_str().and_then(host).map(str::to_string))
                    .unwrap_or_else(|| MISSING.to_string())
            }),
            fields: fields
                .iter()
                .map(|field| (field.to_string(), text_of(&u.file, field, u.by.len())))
                .collect(),
            file: u.file,
        })
        .collect();
    if grouped {
        let mut headings: Vec<Option<String>> = Vec::new();
        for row in &rows {
            if !headings.contains(&row.group) {
                headings.push(row.group.clone());
            }
        }
        rows.sort_by_key(|row| headings.iter().position(|heading| *heading == row.group));
    }
    rows
}

pub fn drawn(doc: &Map<String, Value>, shown: &[Value], planted: Planted) -> Drawn {
    let items = object_or_empty(doc.get("items"));
    let lists = items
        .iter()
        .filter(|(_, item)| item.get("kind").and_then(Value::as_str) == Some(KIND));
    lists
        .map(|(id, item)| (id.clone(), rows(items, shown, item, planted)))
        .collect()
}

fn answer(drawn: &Drawn) -> Value {
    let row = |row: &Row| {
        let fields: Map<String, Value> = row
            .fields
            .iter()
            .map(|(field, text)| (field.clone(), json!(text)))
            .collect();
        json!({"group": row.group, "fields": fields})
    };
    let lists = drawn
        .iter()
        .map(|(id, rows)| json!({"item": id, "rows": rows.iter().map(row).collect::<Vec<_>>()}));
    Value::Array(lists.collect())
}

fn refused(id: &str, path: String, actual: Value, what: &str, fix: &str) -> Issue {
    Issue {
        fix: fix.to_string(),
        ..Issue::error(CHECK, id, path, actual, what)
    }
}

fn typed(id: &str, item: &Value, items: &Map<String, Value>) -> Vec<Issue> {
    let params = object_or_empty(item.get("params"));
    let at = |field: &str| format!("items/{id}/params/{field}");
    let records = "Take the field out: the list writes its rows from the fetched files' records.";
    let mut issues: Vec<Issue> = params
        .keys()
        .filter(|key| !PARAMS.contains(&key.as_str()))
        .map(|key| {
            let what = format!("a sources list takes `of`, `fields` and `group`, and its rows are never typed; `{key}` is none of them");
            refused(id, at(key), json!(key), &what, records)
        })
        .collect();
    let listed = params.get("fields").and_then(Value::as_array);
    for (i, field) in listed.into_iter().flatten().enumerate() {
        if !field.as_str().is_some_and(|f| FIELDS.contains(&f)) {
            let what = format!(
                "a sources list shows {}; {field} is none of them",
                FIELDS.join(", ")
            );
            let fix = "Name a field of the list.";
            issues.push(refused(
                id,
                at(&format!("fields/{i}")),
                field.clone(),
                &what,
                fix,
            ));
        }
    }
    if listed.is_none_or(Vec::is_empty) {
        let what = "a sources list names the fields its rows show";
        let actual = params.get("fields").cloned().unwrap_or(Value::Null);
        issues.push(refused(
            id,
            at("fields"),
            actual,
            what,
            "Name at least one field of the list.",
        ));
    }
    match params.get("of") {
        None => {}
        Some(Value::String(of)) if of == "document" => {}
        Some(Value::Array(ids)) => {
            for (i, of) in ids.iter().enumerate() {
                if !of.as_str().is_some_and(|of| items.contains_key(of)) {
                    let what = "a sources list's `of` names items of its document";
                    let fix = "Name an item the document holds, or `document`.";
                    issues.push(refused(id, at(&format!("of/{i}")), of.clone(), what, fix));
                }
            }
        }
        Some(of) => {
            let what = "a sources list's `of` is `document` or a list of item IDs";
            issues.push(refused(
                id,
                at("of"),
                of.clone(),
                what,
                "Give `document` or item IDs.",
            ));
        }
    }
    let group = params.get("group");
    if group.is_some_and(|g| !g.as_str().is_some_and(|g| GROUPS.contains(&g))) {
        let what = "a sources list groups by `none` or `publisher`";
        let actual = group.cloned().unwrap_or(Value::Null);
        issues.push(refused(
            id,
            at("group"),
            actual,
            what,
            "Give `none` or `publisher`.",
        ));
    }
    issues
}

pub fn issues(doc: &Map<String, Value>, shown: &[Value], drawn: &Drawn) -> Vec<Issue> {
    let items = object_or_empty(doc.get("items"));
    if drawn.is_empty() {
        return Vec::new();
    }
    let mut issues = Vec::new();
    for (id, _) in drawn {
        issues.extend(typed(id, &items[id.as_str()], items));
    }
    let traced = used(items, shown, None);
    let names = |file: &Value| json!({"title": file["title"], "url": file["url"], "sha256": file["sha256"]});
    let lists = |file: &Value| {
        let rows = drawn.iter().flat_map(|(_, rows)| rows);
        rows.into_iter()
            .any(|row| row.file["sha256"] == file["sha256"])
    };
    for u in traced.iter().filter(|u| !lists(&u.file)) {
        let what = format!(
            "shows a number from {}, a fetched file no sources list holds",
            named(&u.file)
        );
        let fix = "Widen a sources list's `of` to this item, or to the document.";
        issues.push(Issue {
            ids: u.by.clone(),
            ..refused(
                &u.by[0],
                format!("items/{}", u.by[0]),
                names(&u.file),
                &what,
                fix,
            )
        });
    }
    for (id, rows) in drawn {
        for row in rows {
            let record = traced
                .iter()
                .find(|u| u.file["sha256"] == row.file["sha256"]);
            let differs = |(field, text): &(String, String)| {
                field != "used_by" && record.is_some_and(|u| *text != text_of(&u.file, field, 0))
            };
            if record.is_none() || row.fields.iter().any(differs) {
                let what = format!(
                    "its row of {} isn't that file's record, byte for byte, or no shown number traces to it",
                    named(&row.file)
                );
                let fix = "Let the list write the row from the record.";
                issues.push(refused(
                    id,
                    format!("items/{id}"),
                    names(&row.file),
                    &what,
                    fix,
                ));
            }
        }
    }
    issues
}

fn planted_in(input: &Map<String, Value>) -> Option<Planted> {
    input.get("planted")?.as_str().and_then(Planted::named)
}

pub fn planted(input: &Map<String, Value>) -> bool {
    planted_in(input).is_some()
}

pub fn judge(checked: &mut Value, doc: &Map<String, Value>, input: &Map<String, Value>) {
    let planted = planted_in(input).unwrap_or_default();
    let shown = crate::check::traced(doc).0;
    let drawn = drawn(doc, &shown, planted);
    checked["sources"] = answer(&drawn);
    if planted == Planted::None {
        return;
    }
    let found = issues(doc, &shown, &drawn);
    if let (false, Some(list)) = (found.is_empty(), checked["issues"].as_array_mut()) {
        list.extend(found.iter().map(Issue::to_json));
        checked["ok"] = json!(false);
    }
}

fn shows_source(item: &Value, items: &Map<String, Value>) -> Option<Value> {
    let params = object_or_empty(item.get("params"));
    let text = params.get("mark").and_then(Value::as_str) == Some("text");
    if item.get("kind").and_then(Value::as_str) != Some("marks@1") || !text {
        return None;
    }
    let read = crate::story::rows_of(item).and_then(|of| items.get(of));
    let rows = read.map_or(params, |set| object_or_empty(set.get("params")));
    let column = params
        .get("encode")
        .and_then(|e| e.get("text")?.get("column")?.as_str());
    let trace = rows
        .get("columns")?
        .get(column.unwrap_or("text"))?
        .get("trace")?;
    (trace["show"]["source"] == true).then(|| trace.clone())
}

pub fn line(trace: &Value, row: usize, key: &str) -> String {
    let files = trace["files"].as_array().into_iter().flatten();
    let files: Vec<String> = files
        .map(|file| format!("{}, {}", named(file), text_of(file, "edition", 0)))
        .collect();
    let column = trace["column"].as_str().unwrap_or_default();
    let column = match trace["unit"].as_str() {
        Some(unit) => format!("{column} ({unit})"),
        None => column.to_string(),
    };
    let wrote = trace["cells"][row]["wrote"].as_str().unwrap_or_default();
    let parts = [files.join("; "), column, key.to_string(), wrote.to_string()];
    let parts: Vec<String> = parts.into_iter().filter(|part| !part.is_empty()).collect();
    parts.join(BETWEEN)
}

pub fn lines(item: &Value, items: &Map<String, Value>, found: &mut [Value]) {
    let Some(trace) = shows_source(item, items) else {
        return;
    };
    for number in found {
        if let Some(row) = number["source"]["row"].as_u64() {
            let key = number["row"].as_str().unwrap_or_default().to_string();
            number["line"] = json!(line(&trace, row as usize, &key));
        }
    }
}

pub fn quoted(doc: &Map<String, Value>, shown: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    for (id, rows) in drawn(doc, shown, Planted::None) {
        for row in rows {
            for (field, text) in &row.fields {
                let display = crate::code::display(text.as_bytes(), 1);
                for (digits, bytes) in crate::code::digits(&display) {
                    let record = json!({"record": row.file["sha256"], "field": field});
                    out.push(
                        json!({"item": id, "row": row.file["sha256"], "text": digits,
                        "source": {"quotation": record, "raw": [bytes.start, bytes.end]}}),
                    );
                }
            }
        }
    }
    out
}

pub struct Line {
    pub text: String,
    pub heading: bool,
}

pub fn listing(doc: &Map<String, Value>, item: &Value) -> Vec<Line> {
    let items = object_or_empty(doc.get("items"));
    let shown = crate::check::traced(doc).0;
    let mut out: Vec<Line> = Vec::new();
    let mut heading: Option<String> = None;
    for row in rows(items, &shown, item, Planted::None) {
        if row.group.is_some() && row.group != heading {
            heading.clone_from(&row.group);
            out.push(Line {
                text: row.group.clone().unwrap_or_default(),
                heading: true,
            });
        }
        let texts: Vec<&str> = row.fields.iter().map(|(_, text)| text.as_str()).collect();
        out.push(Line {
            text: texts.join(BETWEEN),
            heading: false,
        });
    }
    out
}

pub fn hover_lines(doc: &Map<String, Value>) -> Vec<(String, String)> {
    let shown = crate::check::traced(doc).0;
    let lined = shown.iter().filter_map(|number| {
        let mark = format!("{}#{}", number["item"].as_str()?, number["row"].as_str()?);
        Some((mark, number["line"].as_str()?.to_string()))
    });
    let mut out: Vec<(String, String)> = Vec::new();
    for (mark, line) in lined {
        if !out.iter().any(|(named, _)| *named == mark) {
            out.push((mark, line));
        }
    }
    out
}

pub fn marks(
    id: &str,
    item: &Value,
    doc: &Map<String, Value>,
    palette: &Palette,
    pos: [f64; 2],
) -> Result<Vec<Mark>, Refused> {
    let color = palette.get("ink").copied().ok_or_else(|| Refused {
        code: "role_unresolved",
        path: format!("items/{id}: ink"),
    })?;
    let lines: Vec<String> = listing(doc, item).into_iter().map(|l| l.text).collect();
    if lines.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![Mark::Text {
        item: id.to_string(),
        spec: TextSpec {
            text: lines.join("\n"),
            font: "body".into(),
            family: Some(deep_text::Role::Body.family()),
            fallback: Vec::new(),
            lang: None,
            size: SIZE,
            weight: 400,
            width: None,
            max_lines: None,
            mask: false,
            align: Align::Start,
            bound: false,
            spans: Vec::new(),
            gap: 0.0,
            indent: 0.0,
            flow: deep_text::Flow::Horizontal,
            line_height: None,
        },
        origin: pos,
        role: None,
        color,
        runs: Vec::new(),
    }])
}

#[cfg(test)]
mod tests {
    use super::{drawn, host, issues, Planted};
    use serde_json::json;

    #[test]
    fn a_list_that_names_no_field_of_the_list_no_item_of_the_document_or_no_group_is_refused_at_each(
    ) {
        let params = json!({"fields": ["titel"], "of": ["gone"], "group": "host"});
        let doc = json!({"items": {"list": {"kind": "sources@1", "params": params}}});
        let doc = doc.as_object().unwrap();
        let found = issues(doc, &[], &drawn(doc, &[], Planted::None));
        let paths: Vec<&str> = found.iter().map(|issue| issue.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "items/list/params/fields/0",
                "items/list/params/of/0",
                "items/list/params/group"
            ]
        );
    }

    #[test]
    fn a_file_with_no_publisher_lists_under_its_urls_host_without_its_port_or_its_login() {
        assert_eq!(host("https://127.0.0.1:8443/a/b.csv"), Some("127.0.0.1"));
        assert_eq!(
            host("https://me@data.example.test/a?x=1"),
            Some("data.example.test")
        );
        assert_eq!(host("https://[::1]:8443/a"), Some("::1"));
        assert_eq!(host("no scheme"), None);
    }
}
