//! #537: scene3d's readers of a piece's logic arrays. An instancer's columns and a line's points
//! read an array through the core's column view (Array and table: column view), never naming
//! the logic module. A frame folds the array the host baked into the document's `arrays` at its
//! own t, from nothing, so it is a pure function of the document and t and seeking equals
//! playing; narrowing, hiding and `column.out_of_range` are the view's one rule. Only the records
//! a step changed upload, by the renderer's own comparison of each record with its last.

use deep_canvas::columns::{self, Mapped, Read};
use deep_canvas::document::Issue;
use deep_canvas::registry::lists::SealedEntry;
use serde_json::{json, Map, Value};

use crate::scene::Refused;

/// A column of a scene3d item that reads an array.
pub(crate) struct Reader {
    /// Its name in its issues: `pos`, `live`, `attrs.heat`, `points`.
    pub name: String,
    /// The path of its column.
    pub path: String,
    /// The column: `{array, as, part, range}`.
    pub column: Value,
}

impl Reader {
    /// The array's form, `<logic>.<name>`.
    pub(crate) fn form(&self) -> &str {
        self.column["array"].as_str().unwrap_or_default()
    }

    /// How it reads an array of type `ty`: a vector whole unless it names a part.
    fn read(&self, ty: &str) -> Option<Read> {
        if self.column.get("part").is_some_and(|p| !p.is_null()) {
            Read::of(&self.column, ty)
        } else {
            Read::whole(&self.column, ty)
        }
    }
}

/// Whether `v` is a column that reads an array.
pub(crate) fn is_array(v: &Value) -> bool {
    v.get("array").is_some_and(Value::is_string)
}

/// Every reader of item `id`, by its kind.
fn readers(id: &str, item: &Value) -> Vec<Reader> {
    match item["kind"].as_str() {
        Some("instance@1") => crate::slots::readers(id, &item["params"]),
        Some("mark.line@1") => crate::points::readers(id, &item["params"]),
        _ => Vec::new(),
    }
}

/// The baked array `r` reads, from the document's `arrays`.
fn baked<'d>(map: &'d Map<String, Value>, r: &Reader) -> Option<&'d Value> {
    map.get("arrays")?.get(r.form())
}

/// `r`'s values as a frame at `t` maps them, from nothing; refused at its column where the
/// document holds no such array or the reader can't take it (both refused at check first).
pub(crate) fn at(map: &Map<String, Value>, r: &Reader, t: i64) -> Result<Mapped, Refused> {
    let refused = |code| Refused {
        code,
        path: format!("{}/array", r.path),
    };
    let array = baked(map, r).ok_or_else(|| refused("ref_unresolved"))?;
    let read = r
        .read(array["type"].as_str().unwrap_or_default())
        .ok_or_else(|| refused("bad_column"))?;
    columns::mapped(&read, array, t, None).ok_or_else(|| refused("bad_column"))
}

/// The length of a step of the array `r` reads, in flicks.
pub(crate) fn every(map: &Map<String, Value>, r: &Reader) -> i64 {
    baked(map, r)
        .and_then(|a| a["every"].as_i64())
        .unwrap_or(1)
        .max(1)
}

/// The items of `doc`, by ID.
fn items(doc: &Value) -> impl Iterator<Item = (&String, &Value)> {
    doc.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
}

/// At check: each scene3d reader of `doc` resolved through `entries` (the build's
/// `column.source@1`) as the core's view resolves a mark set's, its `as` checked against the
/// array's type, every excursion its array makes raised as `column.out_of_range`; and each
/// kind's own rules over its readers' counts.
pub fn check(doc: &Value, entries: &[SealedEntry]) -> Vec<Issue> {
    let null = Value::Null;
    let arrays = doc.get("arrays").unwrap_or(&null);
    let worlds = doc.get("worlds").unwrap_or(&null);
    let mut issues = Vec::new();
    for (id, item) in items(doc) {
        let mut counts = Vec::new();
        for r in readers(id, item) {
            let path = format!("{}/array", r.path);
            let array = match columns::source((arrays, worlds), entries, id, &path, r.form()) {
                Ok(array) => array,
                Err(issue) => {
                    issues.push(issue);
                    continue;
                }
            };
            let ty = array["type"].as_str().unwrap_or_default();
            let Some(read) = r.read(ty) else {
                issues.push(Issue::error(
                    "bad_column",
                    id,
                    format!("{}/as", r.path),
                    json!({"array": r.form(), "type": ty, "as": r.column.get("as"), "part": r.column.get("part")}),
                    "the array's type can't narrow to this `as`",
                ));
                continue;
            };
            for (step, row, value) in columns::excursions(&read, array) {
                issues.push(columns::out_of_range(
                    id, &r.name, &r.path, row, value, step,
                ));
            }
            if item["kind"].as_str() == Some("mark.line@1") {
                issues.extend(crate::points::check(id, &item["params"], array));
            }
            counts.push((r, array["count"].as_u64().unwrap_or(0)));
        }
        if item["kind"].as_str() == Some("instance@1") {
            issues.extend(crate::slots::check(id, &item["params"], &counts));
        }
    }
    issues
}

/// The `column.out_of_range` issues a frame at `t` of `doc` raises: each row of a scene3d
/// reader whose excursion begins at the frame's step; and a plate overlay's
/// `terrain.overlay_range`.
pub fn raised_at(doc: &Value, t: i64) -> Vec<Issue> {
    let Some(map) = doc.as_object() else {
        return Vec::new();
    };
    let mut out = crate::tints::raised_at(doc, t);
    for (id, item) in items(doc) {
        for r in readers(id, item) {
            let Some(array) = baked(map, &r) else {
                continue;
            };
            let Some(read) = r.read(array["type"].as_str().unwrap_or_default()) else {
                continue;
            };
            let k = t.div_euclid(every(map, &r));
            for (step, row, value) in columns::excursions(&read, array) {
                if step == k {
                    out.push(columns::out_of_range(
                        id, &r.name, &r.path, row, value, step,
                    ));
                }
            }
        }
    }
    out
}
