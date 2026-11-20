//! Issue #194: a catalog's probe into `table.layout@1` (canvas primitives: Asset: tables: catalogs
//! `table.layout@1`), run in the decode worker as its `catalog` job and alone by `deep-catalog
//! pack`. The bytes follow the layout's doc in `deep-canvas-sandbox`'s layouts, so its validator
//! reads them as they are. On top of the doc: tables lie in the directory in the order of their name
//! hashes, and each table's columns in the order of theirs; a table's ID column is packed as an i32
//! column of its own name holding each row's ID hash, which the rows are sorted by, unsigned, so a
//! reader finds a row by a binary search on it; the inherit column isn't packed; each column's
//! values follow the directory with no padding, in directory order, and the `refs` pool comes last.
//! The record beside the bytes names what the hashes stand for: each table's IDs in packed order,
//! each column's type, unit, range and copy table, and every reference to an ID no row holds.

pub mod cells;
pub mod read;

use cells::Raw;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub const MAGIC: [u8; 4] = *b"TBLE";
pub const VERSION: u32 = 1;
/// The layout's own caps (its doc: at most 256 tables, 256 columns a table; 64 MiB an asset).
pub const MAX_TABLES: usize = 256;
pub const MAX_COLUMNS: usize = 256;
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
/// A `ref` to an ID no row holds, and an empty `ref`.
pub const NONE: u32 = 0xFFFF_FFFF;
/// The size of the header and of a table's and a column's directory entries.
pub const HEADER: usize = 20;
pub const TABLE_ENTRY: usize = 12;
pub const COLUMN_ENTRY: usize = 16;

/// 32-bit FNV-1a over a text's UTF-8 bytes: the hash of every ID, table name and column name.
pub fn fnv1a(text: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in text.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// A table file's format, read from its path's extension.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    Csv,
    Jsonl,
}

impl Format {
    pub fn of_path(path: &str) -> Option<Format> {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".csv") {
            Some(Format::Csv)
        } else if lower.ends_with(".jsonl") {
            Some(Format::Jsonl)
        } else {
            None
        }
    }
}

/// The planted packers' names, each a wrong program the criteria name.
pub const PLANTED: [&str; 3] = [
    "catalog_rows_not_columns",
    "catalog_copy_key_hashed",
    "catalog_jsonl_file_order",
];

/// The planted packers.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Planted {
    #[default]
    None,
    /// Each table's values written row after row in place of column after column.
    RowsNotColumns,
    /// A copy column's key written as the FNV-1a hash of its text in place of its value.
    CopyKeyHashed,
    /// A JSON lines table's rows kept in the file's order instead of sorted by ID hash.
    JsonlFileOrder,
}

impl Planted {
    pub fn parse(name: &str) -> Option<Planted> {
        Some(match name {
            "catalog_rows_not_columns" => Planted::RowsNotColumns,
            "catalog_copy_key_hashed" => Planted::CopyKeyHashed,
            "catalog_jsonl_file_order" => Planted::JsonlFileOrder,
            _ => return None,
        })
    }
}

/// A column's type, as the schema writes it: `i32`, `f64`, `bool`, `ref <table>`, `refs <table>`
/// or `copy <copy table>`.
#[derive(Clone, Debug, PartialEq)]
pub enum Ty {
    I32,
    F64,
    Bool,
    Ref(String),
    Refs(String),
    Copy(String),
}

impl Ty {
    fn parse(text: &str) -> Option<Ty> {
        let mut words = text.split_whitespace();
        let (head, arg) = (words.next()?, words.next());
        if words.next().is_some() {
            return None;
        }
        Some(match (head, arg) {
            ("i32", None) => Ty::I32,
            ("f64", None) => Ty::F64,
            ("bool", None) => Ty::Bool,
            ("ref", Some(t)) => Ty::Ref(t.into()),
            ("refs", Some(t)) => Ty::Refs(t.into()),
            ("copy", Some(t)) => Ty::Copy(t.into()),
            _ => return None,
        })
    }
    /// Its code in the directory (the layout's doc: 0 i32, 1 f64, 2 bool, 3 ref, 4 refs, 5 copy).
    pub fn code(&self) -> u32 {
        match self {
            Ty::I32 => 0,
            Ty::F64 => 1,
            Ty::Bool => 2,
            Ty::Ref(_) => 3,
            Ty::Refs(_) => 4,
            Ty::Copy(_) => 5,
        }
    }
    /// The bytes one row's value takes.
    pub fn width(&self) -> usize {
        match self {
            Ty::F64 | Ty::Refs(_) => 8,
            Ty::Bool => 1,
            _ => 4,
        }
    }
    fn word(&self) -> &'static str {
        match self {
            Ty::I32 => "i32",
            Ty::F64 => "f64",
            Ty::Bool => "bool",
            Ty::Ref(_) => "ref",
            Ty::Refs(_) => "refs",
            Ty::Copy(_) => "copy",
        }
    }
}

struct ColSpec {
    name: String,
    ty: Ty,
    unit: Value,
    range: Value,
}

struct TableSpec {
    name: String,
    id: String,
    inherit: Option<String>,
    columns: Vec<ColSpec>,
}

/// One table's file: its name in the schema, its format and its bytes.
pub struct Source {
    pub name: String,
    pub format: Format,
    pub bytes: Vec<u8>,
}

/// A packed catalog: its bytes, their SHA-256 and the record that names what the hashes stand for.
#[derive(Debug)]
pub struct Packed {
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub record: Value,
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A refusal: `{ok: false, code, what}` and the fields that name what was refused.
fn refused(code: &str, what: String, extra: Value) -> Value {
    let mut v = json!({"ok": false, "code": code, "what": what});
    if let (Some(o), Value::Object(e)) = (v.as_object_mut(), extra) {
        o.extend(e);
    }
    v
}

fn schema_of(schema: &Value) -> Result<Vec<TableSpec>, Value> {
    let bad = |what: String| refused("bad_schema", what, json!({}));
    let tables = schema
        .as_object()
        .ok_or_else(|| bad("the schema is an object of tables".into()))?;
    let mut out = Vec::new();
    for (name, t) in tables {
        let t = t
            .as_object()
            .ok_or_else(|| bad(format!("table `{name}` is an object")))?;
        let id = t
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| bad(format!("table `{name}` names its ID column in `id`")))?;
        let inherit = match t.get("inherit") {
            None | Some(Value::Null) => None,
            Some(Value::String(c)) => Some(c.clone()),
            Some(_) => return Err(bad(format!("table `{name}`'s `inherit` names a column"))),
        };
        let mut columns = Vec::new();
        let cols = match t.get("columns") {
            None => Map::new(),
            Some(Value::Object(c)) => c.clone(),
            Some(_) => return Err(bad(format!("table `{name}`'s `columns` is an object"))),
        };
        for (c, spec) in &cols {
            let ty = spec
                .get("type")
                .and_then(Value::as_str)
                .and_then(Ty::parse)
                .ok_or_else(|| {
                    bad(format!(
                        "column `{name}.{c}`'s type is one of i32, f64, bool, ref <table>, refs <table>, copy <table>"
                    ))
                })?;
            if c == id || Some(c) == inherit.as_ref() {
                return Err(bad(format!(
                    "column `{name}.{c}` is the table's ID or inherit column"
                )));
            }
            let range = spec.get("range").cloned().unwrap_or(Value::Null);
            let range_ok = range.is_null()
                || range
                    .as_array()
                    .is_some_and(|r| r.len() == 2 && r.iter().all(Value::is_number));
            if !range_ok {
                return Err(bad(format!("column `{name}.{c}`'s range is [min, max]")));
            }
            columns.push(ColSpec {
                name: c.clone(),
                ty,
                unit: spec.get("unit").cloned().unwrap_or(Value::Null),
                range,
            });
        }
        out.push(TableSpec {
            name: name.clone(),
            id: id.into(),
            inherit,
            columns,
        });
    }
    for t in &out {
        for c in &t.columns {
            if let Ty::Ref(target) | Ty::Refs(target) = &c.ty {
                if !out.iter().any(|o| &o.name == target) {
                    return Err(bad(format!(
                        "column `{}.{}` refers to table `{target}`, which the schema doesn't hold",
                        t.name, c.name
                    )));
                }
            }
        }
    }
    if out.len() > MAX_TABLES {
        return Err(bad(format!("a catalog holds at most {MAX_TABLES} tables")));
    }
    Ok(out)
}

/// One typed cell.
#[derive(Clone, Debug)]
enum Val {
    I32(i32),
    F64(f64),
    Bool(bool),
    Ref(String),
    Refs(Vec<String>),
    /// A copy key's value and its text as written.
    Copy(i32, String),
}

fn typed(ty: &Ty, raw: &Raw) -> Option<Val> {
    let int = |t: &str| t.trim().parse::<i32>().ok();
    match raw {
        Raw::Text(t) => Some(match ty {
            Ty::I32 => Val::I32(int(t)?),
            Ty::F64 => Val::F64(t.trim().parse::<f64>().ok().filter(|v| v.is_finite())?),
            Ty::Bool => Val::Bool(match t.trim() {
                "true" => true,
                "false" => false,
                _ => return None,
            }),
            Ty::Ref(_) => Val::Ref(t.trim().to_string()),
            Ty::Refs(_) => Val::Refs(
                t.split(';')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect(),
            ),
            Ty::Copy(_) => Val::Copy(int(t)?, t.trim().to_string()),
        }),
        Raw::Json(v) => Some(match ty {
            Ty::I32 => Val::I32(i32::try_from(v.as_i64()?).ok()?),
            Ty::F64 => Val::F64(v.as_f64().filter(|v| v.is_finite())?),
            Ty::Bool => Val::Bool(v.as_bool()?),
            Ty::Ref(_) => Val::Ref(v.as_str()?.to_string()),
            Ty::Refs(_) => Val::Refs(
                v.as_array()?
                    .iter()
                    .map(|s| s.as_str().map(str::to_string))
                    .collect::<Option<_>>()?,
            ),
            Ty::Copy(_) => {
                let k = i32::try_from(v.as_i64()?).ok()?;
                Val::Copy(k, k.to_string())
            }
        }),
    }
}

/// A table's rows, resolved: each row's ID and one value a column, in file order.
struct Rows {
    ids: Vec<String>,
    values: Vec<Vec<Option<Val>>>,
}

fn raw_text(raw: &Raw) -> Option<String> {
    match raw {
        Raw::Text(t) => Some(t.trim().to_string()),
        Raw::Json(Value::String(s)) => Some(s.clone()),
        Raw::Json(_) => None,
    }
}

fn rows_of(spec: &TableSpec, source: &Source) -> Result<Rows, Value> {
    let read = match source.format {
        Format::Csv => cells::csv(&source.bytes),
        Format::Jsonl => cells::jsonl(&source.bytes),
    }
    .map_err(|why| {
        refused(
            "table_unreadable",
            format!("table `{}` can't be read: {why}", spec.name),
            json!({"table": spec.name}),
        )
    })?;
    let has = |c: &str| read.columns.iter().any(|h| h == c);
    let needed = std::iter::once(&spec.id)
        .chain(&spec.inherit)
        .chain(spec.columns.iter().map(|c| &c.name));
    if source.format == Format::Csv || read.rows.is_empty() {
        if let Some(c) = needed.clone().find(|c| !has(c)) {
            return Err(refused(
                "column_missing",
                format!("table `{}` has no column `{c}`", spec.name),
                json!({"table": spec.name, "column": c}),
            ));
        }
    }
    let mut ids = Vec::new();
    let mut parents = Vec::new();
    let mut values = Vec::new();
    for (r, row) in read.rows.iter().enumerate() {
        let cell = |c: &str| {
            row.iter()
                .find(|(k, _)| k == c)
                .and_then(|(_, v)| v.as_ref())
        };
        let id = cell(&spec.id)
            .and_then(raw_text)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                refused(
                    "bad_cell",
                    format!("row {} of table `{}` has no ID", r + 1, spec.name),
                    json!({"table": spec.name, "row": r + 1, "column": spec.id}),
                )
            })?;
        let parent = match &spec.inherit {
            None => None,
            Some(c) => match cell(c) {
                None => None,
                Some(raw) => Some(raw_text(raw).filter(|s| !s.is_empty()).ok_or_else(|| {
                    refused(
                        "bad_cell",
                        format!("row `{id}` of table `{}`: `{c}` names a row", spec.name),
                        json!({"table": spec.name, "id": id, "column": c}),
                    )
                })?),
            },
        };
        let mut vals = Vec::new();
        for c in &spec.columns {
            vals.push(match cell(&c.name) {
                None => None,
                Some(raw) => Some(typed(&c.ty, raw).ok_or_else(|| {
                    refused(
                        "bad_cell",
                        format!(
                            "row `{id}` of table `{}`: `{}` isn't a {}",
                            spec.name,
                            c.name,
                            c.ty.word()
                        ),
                        json!({"table": spec.name, "id": id, "column": c.name}),
                    )
                })?),
            });
        }
        ids.push(id);
        parents.push(parent);
        values.push(vals);
    }
    let mut seen = std::collections::HashMap::new();
    for (i, id) in ids.iter().enumerate() {
        if let Some(first) = seen.insert(id.as_str(), i) {
            let _ = first;
            return Err(refused(
                "duplicate_id",
                format!("table `{}` holds the ID `{id}` twice", spec.name),
                json!({"table": spec.name, "id": id}),
            ));
        }
    }
    // Inheritance resolves first: a row takes its parent's value for every column it leaves
    // empty, its parent resolved before it; a cycle is refused, naming its rows.
    let index: std::collections::HashMap<&str, usize> = ids
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();
    let mut resolved: Vec<Option<Vec<Option<Val>>>> = vec![None; ids.len()];
    for start in 0..ids.len() {
        let mut chain = Vec::new();
        let mut at = start;
        while resolved[at].is_none() {
            if let Some(k) = chain.iter().position(|c| *c == at) {
                let rows: Vec<&String> = chain[k..].iter().map(|i| &ids[*i]).collect();
                return Err(refused(
                    "inherit_cycle",
                    format!(
                        "rows {} of table `{}` inherit from each other",
                        rows.iter()
                            .map(|r| format!("`{r}`"))
                            .collect::<Vec<_>>()
                            .join(", "),
                        spec.name
                    ),
                    json!({"table": spec.name, "rows": rows}),
                ));
            }
            chain.push(at);
            match &parents[at] {
                None => break,
                Some(p) => match index.get(p.as_str()) {
                    Some(&q) => at = q,
                    None => {
                        return Err(refused(
                            "inherit_missing",
                            format!(
                                "row `{}` of table `{}` inherits from `{p}`, which no row holds",
                                ids[at], spec.name
                            ),
                            json!({"table": spec.name, "id": ids[at], "inherit": p}),
                        ))
                    }
                },
            }
        }
        // Resolve the chain from its root down.
        for &row in chain.iter().rev() {
            if resolved[row].is_some() {
                continue;
            }
            let own = values[row].clone();
            let merged = match parents[row].as_ref().and_then(|p| index.get(p.as_str())) {
                None => own,
                Some(&q) => {
                    let base = resolved[q].clone().unwrap_or_default();
                    own.into_iter().zip(base).map(|(o, b)| o.or(b)).collect()
                }
            };
            resolved[row] = Some(merged);
        }
    }
    Ok(Rows {
        ids,
        values: resolved
            .into_iter()
            .map(Option::unwrap_or_default)
            .collect(),
    })
}

/// Two names whose hashes collide, refused naming both.
fn collisions<'a>(
    names: impl Iterator<Item = &'a str>,
    code_of: &str,
    table: Option<&str>,
) -> Result<(), Value> {
    let mut by_hash: std::collections::BTreeMap<u32, &str> = Default::default();
    for n in names {
        let h = fnv1a(n);
        if let Some(other) = by_hash.insert(h, n) {
            if other != n {
                let mut both = [other, n];
                both.sort();
                let field = match code_of {
                    "tables" => "tables",
                    "columns" => "columns",
                    _ => "ids",
                };
                let mut extra = json!({field: both, "hash": h});
                if let Some(t) = table {
                    extra["table"] = json!(t);
                }
                let place = table.map_or(String::new(), |t| format!(" of table `{t}`"));
                return Err(refused(
                    "hash_collision",
                    format!(
                        "`{}` and `{}`{place} share the FNV-1a hash {h:#010x}",
                        both[0], both[1]
                    ),
                    extra,
                ));
            }
        }
    }
    Ok(())
}

/// One column as packed: its name, type, values and record entry.
struct Packing<'a> {
    name: &'a str,
    ty: Ty,
    spec: Option<&'a ColSpec>,
    at: usize,
}

/// Packs a catalog's tables under its schema into `table.layout@1`, or refuses it.
pub fn pack(sources: &[Source], schema: &Value, planted: Planted) -> Result<Packed, Value> {
    let specs = schema_of(schema)?;
    collisions(specs.iter().map(|t| t.name.as_str()), "tables", None)?;
    let mut tables = Vec::new();
    for spec in &specs {
        let source = sources
            .iter()
            .find(|s| s.name == spec.name)
            .ok_or_else(|| {
                refused(
                    "table_missing",
                    format!("the schema's table `{}` has no file", spec.name),
                    json!({"table": spec.name}),
                )
            })?;
        if spec.columns.len() + 1 > MAX_COLUMNS {
            return Err(refused(
                "bad_schema",
                format!("table `{}` has more than {MAX_COLUMNS} columns", spec.name),
                json!({"table": spec.name}),
            ));
        }
        let rows = rows_of(spec, source)?;
        collisions(
            std::iter::once(spec.id.as_str()).chain(spec.columns.iter().map(|c| c.name.as_str())),
            "columns",
            Some(&spec.name),
        )?;
        collisions(rows.ids.iter().map(String::as_str), "ids", Some(&spec.name))?;
        // Rows sorted by the u32 hash of their ID (the planted JSON reader keeps the file's order).
        let mut order: Vec<usize> = (0..rows.ids.len()).collect();
        let keep = planted == Planted::JsonlFileOrder && source.format == Format::Jsonl;
        if !keep {
            order.sort_by_key(|&i| fnv1a(&rows.ids[i]));
        }
        tables.push((spec, rows, order));
    }
    // The directory: tables by name hash, each table's columns by name hash, its ID column one of
    // them.
    tables.sort_by_key(|(spec, _, _)| fnv1a(&spec.name));
    let table_index = |name: &str| tables.iter().position(|(s, _, _)| s.name == name);
    let row_index: Vec<std::collections::HashMap<&str, u32>> = tables
        .iter()
        .map(|(_, rows, order)| {
            order
                .iter()
                .enumerate()
                .map(|(k, &i)| (rows.ids[i].as_str(), k as u32))
                .collect()
        })
        .collect();
    let mut layout: Vec<Vec<Packing>> = Vec::new();
    for (spec, _, _) in &tables {
        let mut cols = vec![Packing {
            name: &spec.id,
            ty: Ty::I32,
            spec: None,
            at: 0,
        }];
        for c in &spec.columns {
            cols.push(Packing {
                name: &c.name,
                ty: c.ty.clone(),
                spec: Some(c),
                at: 0,
            });
        }
        cols.sort_by_key(|c| fnv1a(c.name));
        layout.push(cols);
    }
    let directory: usize = HEADER
        + layout
            .iter()
            .map(|c| TABLE_ENTRY + COLUMN_ENTRY * c.len())
            .sum::<usize>();
    let mut at = directory;
    for (t, cols) in layout.iter_mut().enumerate() {
        let n = tables[t].2.len();
        for c in cols.iter_mut() {
            c.at = at;
            at += c.ty.width() * n;
        }
    }
    let pool_at = at;
    // The values, column by column, and the pool; every ref resolved to its row in its target.
    let mut values = vec![0u8; pool_at - directory];
    let mut pool: Vec<u32> = Vec::new();
    let mut missing = Vec::new();
    for (t, cols) in layout.iter().enumerate() {
        let (spec, rows, order) = &tables[t];
        for c in cols {
            let column = c
                .spec
                .and_then(|s| spec.columns.iter().position(|o| o.name == s.name));
            for (k, &i) in order.iter().enumerate() {
                let off = c.at - directory + k * c.ty.width();
                let value = column.and_then(|ci| rows.values[i][ci].clone());
                let mut put = |bytes: &[u8]| values[off..off + bytes.len()].copy_from_slice(bytes);
                let resolve = |target: &str, id: &str| -> Option<u32> {
                    table_index(target).and_then(|ti| row_index[ti].get(id).copied())
                };
                match (&c.ty, value) {
                    (Ty::I32, _) if column.is_none() => put(&fnv1a(&rows.ids[i]).to_le_bytes()),
                    (Ty::I32, Some(Val::I32(v))) => put(&v.to_le_bytes()),
                    (Ty::F64, Some(Val::F64(v))) => put(&v.to_le_bytes()),
                    (Ty::Bool, Some(Val::Bool(v))) => put(&[u8::from(v)]),
                    (Ty::Copy(_), Some(Val::Copy(v, text))) => {
                        let v = match planted {
                            Planted::CopyKeyHashed => fnv1a(&text) as i32,
                            _ => v,
                        };
                        put(&v.to_le_bytes())
                    }
                    (Ty::Ref(target), v) => {
                        let row = match v {
                            Some(Val::Ref(id)) => resolve(target, &id).unwrap_or_else(|| {
                                missing.push(json!({"table": spec.name, "id": rows.ids[i], "column": c.name, "ref": id}));
                                NONE
                            }),
                            _ => NONE,
                        };
                        put(&row.to_le_bytes())
                    }
                    (Ty::Refs(target), v) => {
                        let list = match v {
                            Some(Val::Refs(l)) => l,
                            _ => Vec::new(),
                        };
                        let start = pool.len() as u32;
                        for id in &list {
                            pool.push(resolve(target, id).unwrap_or_else(|| {
                                missing.push(json!({"table": spec.name, "id": rows.ids[i], "column": c.name, "ref": id}));
                                NONE
                            }));
                        }
                        let mut b = start.to_le_bytes().to_vec();
                        b.extend((list.len() as u32).to_le_bytes());
                        put(&b)
                    }
                    // An empty cell no row it inherits from fills: 0, 0.0, false, key 0.
                    _ => {}
                }
            }
        }
    }
    if planted == Planted::RowsNotColumns {
        values = rows_not_columns(&layout, &tables, directory, values);
    }
    let mut bytes = Vec::with_capacity(pool_at + 4 * pool.len());
    bytes.extend(MAGIC);
    for v in [
        VERSION,
        tables.len() as u32,
        pool_at as u32,
        pool.len() as u32,
    ] {
        bytes.extend(v.to_le_bytes());
    }
    for (t, cols) in layout.iter().enumerate() {
        let (spec, _, order) = &tables[t];
        for v in [fnv1a(&spec.name), order.len() as u32, cols.len() as u32] {
            bytes.extend(v.to_le_bytes());
        }
        for c in cols {
            let target = match &c.ty {
                Ty::Ref(t) | Ty::Refs(t) => table_index(t).unwrap_or(0) as u32,
                _ => 0,
            };
            for v in [fnv1a(c.name), c.ty.code(), c.at as u32, target] {
                bytes.extend(v.to_le_bytes());
            }
        }
    }
    bytes.extend(values);
    for p in &pool {
        bytes.extend(p.to_le_bytes());
    }
    if bytes.len() > MAX_BYTES {
        return Err(refused(
            "over_cap",
            format!("the packed catalog passes {MAX_BYTES} bytes"),
            json!({"cap": "max_bytes", "limit": MAX_BYTES}),
        ));
    }
    let sha = sha256(&bytes);
    let record_tables: Vec<Value> = layout
        .iter()
        .enumerate()
        .map(|(t, cols)| {
            let (spec, rows, order) = &tables[t];
            let columns: Vec<Value> = cols
                .iter()
                .map(|c| {
                    let mut v = json!({"name": c.name, "hash": fnv1a(c.name), "type": c.ty.word(), "at": c.at});
                    match &c.ty {
                        Ty::Ref(t) | Ty::Refs(t) => v["target"] = json!(t),
                        Ty::Copy(t) => v["copy"] = json!(t),
                        _ => {}
                    }
                    match c.spec {
                        None => v["id"] = json!(true),
                        Some(s) => {
                            v["unit"] = s.unit.clone();
                            v["range"] = s.range.clone();
                        }
                    }
                    v
                })
                .collect();
            json!({"name": spec.name, "hash": fnv1a(&spec.name), "id": spec.id,
                   "rows": order.len(), "ids": order.iter().map(|&i| &rows.ids[i]).collect::<Vec<_>>(),
                   "columns": columns})
        })
        .collect();
    let record = json!({"layout": "table.layout@1", "sha256": sha, "size": bytes.len(),
                        "tables": record_tables, "missing": missing});
    Ok(Packed {
        bytes,
        sha256: sha,
        record,
    })
}

/// The planted packer's values: each table's span written row after row, every column's value
/// for row 0, then row 1, while the directory still says column after column.
fn rows_not_columns(
    layout: &[Vec<Packing>],
    tables: &[(&TableSpec, Rows, Vec<usize>)],
    directory: usize,
    values: Vec<u8>,
) -> Vec<u8> {
    let mut out = values.clone();
    for (t, cols) in layout.iter().enumerate() {
        let n = tables[t].2.len();
        let Some(first) = cols.first() else { continue };
        let mut w = first.at - directory;
        for k in 0..n {
            for c in cols {
                let width = c.ty.width();
                let from = c.at - directory + k * width;
                out[w..w + width].copy_from_slice(&values[from..from + width]);
                w += width;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
