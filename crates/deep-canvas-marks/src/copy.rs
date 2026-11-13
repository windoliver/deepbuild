//! Issue #538: keyed copy (Text `text@1`: keyed copy). A text, a template slot or a mark set's
//! text column shows the string a copy table holds for the key a logic array picks, read through
//! the core's column view, with up to four arguments and CLDR's plural forms. Keys are looked up
//! by value, never by position; a key the table lacks shows the table's `missing` string and
//! raises `copy.missing`.
//!
//! Copy tables: `data.copy[locale][table]: {"<i32>": string | {zero, one, two, few, many,
//! other}, missing: string = ""}`.

use deep_canvas::columns::{element_at, element_path, element_steps};
use deep_canvas::document::Issue;
use serde_json::{json, Map, Value};

use crate::plural::{Operands, Table};

/// Most arguments a lookup takes (`{0}` to `{3}`).
pub const MAX_ARGS: usize = 4;

/// One argument of a lookup.
#[derive(Clone, Debug, PartialEq)]
pub enum Arg<'a> {
    /// A number path: a logic array (`<logic>.<name>[index]`) or a template's slot path, with the
    /// widest text it may show.
    Number { path: &'a str, widest: Option<&'a str> },
    /// A nested lookup `{copy: <table>[<array path>]}`, one level deep, with no arguments.
    Lookup { table: &'a str, key: &'a str },
}

/// A lookup: a table, the path of its key (an array path, or for a mark set a column's name)
/// and its arguments.
#[derive(Clone, Debug, PartialEq)]
pub struct Lookup<'a> {
    pub table: &'a str,
    pub key: &'a str,
    pub args: Vec<Arg<'a>>,
}

/// `<table>[<path>]`, the path itself holding at most one `[index]`.
pub fn keyed(text: &str) -> Option<(&str, &str)> {
    let (table, rest) = text.trim().split_once('[')?;
    let key = rest.strip_suffix(']')?;
    (!table.is_empty() && !key.is_empty()).then_some((table.trim(), key.trim()))
}

/// The lookup `v` writes (`{copy: "<table>[<path>]", args}`), or the field it fails at.
pub fn lookup(v: &Value) -> Result<Lookup<'_>, String> {
    let (table, key) = v["copy"].as_str().and_then(keyed).ok_or("copy")?;
    let args = args(v)?;
    Ok(Lookup { table, key, args })
}

/// A mark set's text column `{copy: <table>, key: <column>, args: [<column>]}`.
pub fn column(v: &Value) -> Result<Lookup<'_>, String> {
    let table = v["copy"].as_str().filter(|t| !t.is_empty()).ok_or("copy")?;
    let key = v["key"].as_str().filter(|k| !k.is_empty()).ok_or("key")?;
    let args = args(v)?;
    Ok(Lookup { table, key, args })
}

fn args(v: &Value) -> Result<Vec<Arg<'_>>, String> {
    let list = match v.get("args") {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(l)) if l.len() <= MAX_ARGS => l,
        Some(_) => return Err("args".into()),
    };
    list.iter()
        .enumerate()
        .map(|(i, a)| {
            let bad = || format!("args/{i}");
            match a {
                Value::String(path) => Ok(Arg::Number { path, widest: None }),
                Value::Object(o) if o.contains_key("copy") => {
                    // A nested lookup takes no arguments of its own: one level deep.
                    let (table, key) = o["copy"].as_str().and_then(keyed).ok_or_else(bad)?;
                    if o.contains_key("args") {
                        return Err(format!("args/{i}/args"));
                    }
                    Ok(Arg::Lookup { table, key })
                }
                Value::Object(o) => {
                    let path = o.get("path").and_then(Value::as_str).ok_or_else(bad)?;
                    let widest = match o.get("widest") {
                        None | Some(Value::Null) => None,
                        Some(w) => Some(w.as_str().ok_or_else(|| format!("args/{i}/widest"))?),
                    };
                    Ok(Arg::Number { path, widest })
                }
                _ => Err(bad()),
            }
        })
        .collect()
}

/// Whether a table key is an i32 written plainly, as a copy table's keys are.
fn is_key(k: &str) -> bool {
    k.parse::<i32>().is_ok_and(|n| n.to_string() == k)
}

/// The copy tables `doc` carries in `locale`: `data.copy[locale][table]` objects alone (a string
/// there is #407's flat copy).
pub fn table<'a>(doc: &'a Map<String, Value>, locale: &str, name: &str) -> Option<&'a Map<String, Value>> {
    doc.get("data")?.get("copy")?.get(locale)?.get(name)?.as_object()
}

/// The locales the document's copy tables are in, in byte order.
pub fn locales(doc: &Map<String, Value>) -> Vec<&str> {
    let copy = doc.get("data").and_then(|d| d.get("copy")).and_then(Value::as_object);
    let mut out: Vec<&str> = copy.into_iter().flatten().map(|(l, _)| l.as_str()).collect();
    out.sort_unstable();
    out
}

/// The locale a view in `asked` reads `name` in: that tag where the document carries the table
/// in it, else the document's `locale` (`en` by default).
pub fn locale_for<'a>(doc: &'a Map<String, Value>, asked: &'a str, name: &str) -> &'a str {
    if table(doc, asked, name).is_some() {
        return asked;
    }
    doc.get("locale").and_then(Value::as_str).unwrap_or("en")
}

/// Each key a table holds, by value.
pub fn keys(t: &Map<String, Value>) -> Vec<i32> {
    t.keys().filter(|k| is_key(k)).filter_map(|k| k.parse().ok()).collect()
}

/// The table's string for `key`, its plural form picked by `rules` applied to the first
/// argument as shown; `None` where the table lacks the key. Looked up by value.
pub fn pick<'a>(t: &'a Map<String, Value>, key: i64, plural: impl Fn() -> &'static str) -> Option<&'a str> {
    match t.get(&key.to_string())? {
        Value::String(s) => Some(s),
        Value::Object(forms) => forms
            .get(plural())
            .or_else(|| forms.get("other"))
            .and_then(Value::as_str),
        _ => None,
    }
}

/// The table's `missing` string (empty by default).
pub fn missing(t: Option<&Map<String, Value>>) -> &str {
    t.and_then(|t| t.get("missing")).and_then(Value::as_str).unwrap_or("")
}

/// `text` with `{0}` to `{3}` replaced by the arguments as shown.
pub fn fill(text: &str, args: &[String]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('{') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let slot = tail[1..].find('}').map(|e| &tail[1..1 + e]);
        match slot.and_then(|s| s.parse::<usize>().ok().filter(|i| *i < MAX_ARGS).map(|i| (s, i))) {
            Some((s, i)) => {
                out.push_str(args.get(i).map_or("", String::as_str));
                rest = &tail[s.len() + 2..];
            }
            None => {
                out.push('{');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// A number as a template writes it (`12`, `0.5`).
pub fn number(v: f64) -> String {
    format!("{v}")
}

/// What a lookup reads at a frame: each array's value at `t`.
pub struct Frame<'a> {
    pub doc: &'a Map<String, Value>,
    pub t: i64,
    pub locale: &'a str,
    pub plurals: &'a Table,
}

/// A key a frame found missing: the table, the key, the array and the step.
#[derive(Clone, Debug, PartialEq)]
pub struct Missing {
    pub table: String,
    pub key: i64,
    pub array: String,
    pub step: i64,
}

impl Frame<'_> {
    /// An array path's value at the frame, with its step; `None` where the document bakes no
    /// such array.
    pub fn array(&self, path: &str) -> Option<(f64, i64)> {
        let (form, index) = element_path(path)?;
        element_at(self.doc.get("arrays")?.get(form)?, index, self.t)
    }

    /// A number argument's value as shown: an array's at t, else a template's slot.
    fn number_arg(&self, path: &str) -> String {
        if let Some((v, _)) = self.array(path) {
            return number(v);
        }
        let data = json!({"data": self.doc.get("data"), "controls": self.doc.get("controls")});
        deep_canvas::template::value(&data, path).map(|s| s.text).unwrap_or_default()
    }

    /// The string `name` holds for `key`, its arguments already shown; and the key it missed.
    pub fn string(&self, name: &str, key: Option<(f64, i64)>, key_path: &str, args: &[String]) -> (String, Option<Missing>) {
        let locale = locale_for(self.doc, self.locale, name);
        let t = table(self.doc, locale, name);
        let rules = || self.plurals.of(locale);
        let first = args.first().and_then(|a| Operands::parse(a));
        let plural = || first.as_ref().map_or("other", |n| rules().category(n));
        let (value, step) = key.unwrap_or((f64::NAN, 0));
        let k = (value.fract() == 0.0 && value.is_finite()).then_some(value as i64);
        match k.and_then(|k| t.and_then(|t| pick(t, k, plural))) {
            Some(s) => (fill(s, args), None),
            None => {
                let m = Missing {
                    table: name.into(),
                    key: k.unwrap_or(i64::MIN),
                    array: key_path.into(),
                    step,
                };
                (fill(missing(t), args), Some(m))
            }
        }
    }

    /// What `lookup` (a text's or a template slot's) shows at the frame, and the keys it missed.
    pub fn show(&self, lookup: &Lookup<'_>) -> (String, Vec<Missing>) {
        let mut missed = Vec::new();
        let args: Vec<String> = lookup
            .args
            .iter()
            .map(|a| match a {
                Arg::Number { path, .. } => self.number_arg(path),
                Arg::Lookup { table, key } => {
                    let (s, m) = self.string(table, self.array(key), key, &[]);
                    missed.extend(m);
                    s
                }
            })
            .collect();
        let (s, m) = self.string(lookup.table, self.array(lookup.key), lookup.key, &args);
        missed.extend(m);
        (s, missed)
    }
}

/// `copy.missing {table, key, array, step}` for the reader `id` at `path`; for a mark set, `row`
/// names the row whose key the table lacks.
pub fn missing_issue(id: &str, path: &str, m: &Missing, row: Option<usize>) -> Issue {
    let mut actual = json!({"table": m.table, "key": m.key, "array": m.array, "step": m.step});
    if let Some(r) = row {
        actual["row"] = json!(r);
    }
    Issue {
        severity: "warning",
        ..Issue::error(
            "copy.missing",
            id,
            path.to_string(),
            actual,
            "the copy table lacks the key the array picks; the text shows the table's missing string while it lasts",
        )
    }
}

/// The steps an array path's key begins to be missing from the table `name` in `locale`, by the
/// baked steps alone: `(step, key)`.
pub fn missing_steps(doc: &Map<String, Value>, locale: &str, name: &str, path: &str) -> Vec<(i64, f64)> {
    let Some((form, index)) = element_path(path) else {
        return Vec::new();
    };
    let Some(array) = doc.get("arrays").and_then(|a| a.get(form)) else {
        return Vec::new();
    };
    let t = table(doc, locale_for(doc, locale, name), name);
    let has = |v: f64| {
        v.fract() == 0.0 && v.is_finite() && t.is_some_and(|t| pick(t, v as i64, || "other").is_some())
    };
    let mut was = true;
    let mut out = Vec::new();
    for (step, v) in element_steps(array, index) {
        let now = has(v);
        if !now && was {
            out.push((step, v));
        }
        was = now;
    }
    out
}

/// The code the fit check fails a key with, and the one it refuses an argument with no widest.
pub const FIT: &str = "copy.fit";
pub const NO_WIDEST: &str = "copy.widest_missing";

/// The widest text a number argument at `path` may show: its `widest`, else the wider end of
/// the range its source declares (a control's); `None` where it has neither.
fn widest_of(doc: &Map<String, Value>, path: &str, widest: Option<&str>) -> Option<String> {
    if let Some(w) = widest {
        return Some(w.to_string());
    }
    let id = path.strip_prefix("controls/")?.strip_suffix("/value")?;
    let range = doc.get("controls")?.get(id)?.get("range")?.as_array()?;
    let ends: Vec<String> = range.iter().filter_map(Value::as_f64).map(number).collect();
    ends.into_iter().max_by_key(|s| s.chars().count())
}

/// The lookups a text holds: its `text: {copy, args}`, and each `{copy: …}` slot of its template.
pub fn lookups_of(item: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if let Some(t) = item.pointer("/params/text").filter(|t| t.get("copy").is_some()) {
        out.push(("text".to_string(), t.clone()));
    }
    let template = item.pointer("/params/template").and_then(Value::as_str);
    for part in template.and_then(|t| deep_canvas::template::parts(t).ok()).into_iter().flatten() {
        if let deep_canvas::template::Part::Slot(s) = part {
            if let Some(slot) = slot(s) {
                out.push(("template".to_string(), slot));
            }
        }
    }
    out
}

/// A template slot `{copy: <table>[<path>]}` as the lookup it writes (no arguments: a slot holds
/// no nested braces).
pub fn slot(s: &str) -> Option<Value> {
    let key = s.trim().strip_prefix("copy:")?.trim();
    keyed(key)?;
    Some(json!({"copy": key}))
}

/// The fit check over every text's lookups (Text `text@1`: keyed copy): every key each table
/// holds, in every locale the document carries, each argument at its widest, so even a key no
/// step has picked is checked. A string that shows an argument and doesn't fit the item's box
/// and line limit fails, naming the key, the locale and the width it shapes to; a number argument
/// with no widest and no range its source declares is refused, naming it.
pub fn fit_issues(doc: &Map<String, Value>, ty: &crate::scene::Type, issues: &mut Vec<Issue>) {
    // One shaper for the check, made only when a text holds a lookup.
    let mut shaper: Option<deep_text::Shaper> = None;
    let items = doc.get("items").and_then(Value::as_object).into_iter().flatten();
    for (id, item) in items.filter(|(_, i)| i["kind"] == "text@1") {
        let params = item.get("params").and_then(Value::as_object).cloned().unwrap_or_default();
        for (field, v) in lookups_of(item) {
            let at = format!("items/{id}/params/{field}");
            let Ok(l) = lookup(&v) else { continue };
            let s = shaper.get_or_insert_with(deep_text::Shaper::new);
            fit_one(doc, (id, &at, &params), &l, ty, s, issues);
        }
    }
}

fn fit_one(
    doc: &Map<String, Value>,
    (id, at, params): (&str, &str, &Map<String, Value>),
    l: &Lookup<'_>,
    ty: &crate::scene::Type,
    shaper: &mut deep_text::Shaper,
    issues: &mut Vec<Issue>,
) {
    let mut widest = Vec::with_capacity(l.args.len());
    for (i, a) in l.args.iter().enumerate() {
        match a {
            Arg::Number { path, widest: w } => match widest_of(doc, path, *w) {
                Some(w) => widest.push(Some(w)),
                None => {
                    let what = "a number argument names neither a widest nor a range its source declares, so the fit check can't size it";
                    issues.push(Issue::error(NO_WIDEST, id, format!("{at}/args/{i}"), json!({"arg": i, "path": path}), what));
                    return;
                }
            },
            // A nested lookup is sized per locale, by its table's widest string.
            Arg::Lookup { .. } => widest.push(None),
        }
    }
    // The item's spec read once, in its box and on one unbounded line; each string only swaps the text.
    let spec_of = |boxed: bool| {
        let mut p = params.clone();
        if !boxed {
            p.remove("box");
            p.remove("max_lines");
        }
        let shown = crate::scene::Shown { bound: "copy".into(), text: String::new(), stale: false, age: None, changes_at: None };
        crate::scene::text_spec_in(id, &p, Some(&shown), ty).ok()
    };
    let mut specs = [spec_of(true), spec_of(false)];
    let mut shape_width = |shaper: &mut deep_text::Shaper, text: &str, boxed: bool| -> Option<(bool, f32)> {
        let spec = specs[usize::from(!boxed)].as_mut()?;
        spec.text = text.to_string();
        let f = shaper.fit(&spec.shaper_spec()?, None);
        Some((f.fits, f.width))
    };
    for locale in locales(doc) {
        let Some(t) = table(doc, locale, l.table) else { continue };
        let mut args: Vec<String> = Vec::with_capacity(widest.len());
        for (a, w) in l.args.iter().zip(&widest) {
            args.push(match (a, w) {
                (_, Some(w)) => w.clone(),
                (Arg::Lookup { table: nested, .. }, None) => {
                    let strings = table(doc, locale, nested).map(strings).unwrap_or_default();
                    let widths = strings.into_iter().filter_map(|s| shape_width(shaper, s, false).map(|(_, w)| (w, s)));
                    widths.max_by(|a, b| a.0.total_cmp(&b.0)).map_or(String::new(), |(_, s)| s.to_string())
                }
                _ => String::new(),
            });
        }
        // Every plural form is checked: any count may pick it.
        for key in keys(t) {
            for s in entry_strings(&t[&key.to_string()]) {
                // A string with no argument may ellipsize as the item's overflow says.
                if !(0..args.len()).any(|i| s.contains(&format!("{{{i}}}"))) {
                    continue;
                }
                let text = fill(s, &args);
                if shape_width(shaper, &text, true).is_none_or(|(fits, _)| fits) {
                    continue;
                }
                let width = shape_width(shaper, &text, false).map_or(0.0, |(_, w)| f64::from(w));
                let what = "a key's string, its arguments at their widest, doesn't fit the text's box; a number is never cut";
                let actual = json!({"table": l.table, "key": key, "locale": locale, "width": width, "box": params.get("box").and_then(|b| b.get("w"))});
                issues.push(Issue::error(FIT, id, at.to_string(), actual, what));
            }
        }
    }
}

/// Every string a table holds, each plural form of an entry among them.
fn strings(t: &Map<String, Value>) -> Vec<&str> {
    t.iter()
        .filter(|(k, _)| is_key(k))
        .flat_map(|(_, v)| entry_strings(v))
        .collect()
}

/// An entry's strings: its one string, or each of its plural forms.
fn entry_strings(v: &Value) -> Vec<&str> {
    match v {
        Value::String(s) => vec![s],
        Value::Object(forms) => forms.values().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

/// The planted plural rule that picks French's form by English's cardinal rule (#538 criterion 2).
pub const PLURAL_EN_FOR_FR: &str = "plural_en_rule_for_fr";
/// The planted text module that keeps each mark-set row's string from the first locale it
/// showed it in (#538 criterion 5).
pub const KEEPS_FIRST_LOCALE: &str = "labels_keep_first_locale";
/// The planted lookup that keeps each key's position from the table's first revision; deep-show
/// holds it, since only a session sees revisions (#538 criterion 3).
pub const KEEPS_FIRST_POSITION: &str = "copy_keeps_first_position";
/// #538's planted programs in the text module, each reachable only through a proof surface.
pub const PLANTED: [&str; 3] = [PLURAL_EN_FOR_FR, KEEPS_FIRST_LOCALE, KEEPS_FIRST_POSITION];

/// The text module's keyed copy: CLDR's plural rules as a table built once, and the operator
/// that shows each keyed text's string at the frame's t in the view's locale (`text.copy`),
/// which the counter passes on. It alone reads t, so a text with no lookup gains no work per
/// frame.
pub(crate) fn register(r: &mut deep_canvas::registry::Registrar) {
    r.built_table("text.plurals", plurals);
    r.array("text.copy", "shown", "item", "text", "items");
    r.operator(
        "copy",
        "items",
        &["core.fields", "refs", "t", "view(locale)", "table:text.plurals"],
        &["text.copy"],
    )
    .applies(is_keyed)
    .run(copy);
    // A mark set's copy columns, rewritten as the str columns they show at t.
    r.contribution("text.columns", "fields", "item", "geometry", "items", "core.fields");
    r.operator(
        "copy_columns",
        "items",
        &["self", "refs", "t", "view(locale)", "table:text.plurals"],
        &["text.columns"],
    )
    .applies(has_copy_column)
    .run(copy_columns_op);
}

fn copy_columns_op(v: &mut deep_canvas::schedule::View<'_>) -> Result<(), deep_canvas::schedule::OpError> {
    use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
    use deep_canvas::schedule::Val;
    if v.planted() == Some(KEEPS_FIRST_LOCALE) {
        if let Some(last) = v.last("text.columns") {
            return v.write("text.columns", last);
        }
    }
    let item = v.item()?;
    let doc = v.document()?;
    let t = v.t()?;
    let locale = v.locale()?;
    let plurals = v.table::<Table>("text.plurals")?;
    let empty = Map::new();
    let frame = Frame { doc: doc.as_object().unwrap_or(&empty), t, locale, plurals: &plurals };
    let edits = frame
        .columns(item)
        .into_iter()
        .map(|(name, column, _)| Edit {
            add: false,
            path: vec!["params".into(), "columns".into(), name],
            value: Datum::Typed(Val::json(column)),
        })
        .collect();
    v.write("text.columns", Val::typed(Edits(edits)))
}

fn plurals() -> deep_canvas::registry::TableValue {
    std::sync::Arc::new(Table::pinned())
}

/// A text holding a lookup: `text: {copy, args}` or a template with a `{copy: …}` slot.
pub fn is_keyed(_: &Value, _: &str, item: &Value) -> bool {
    item["kind"] == "text@1" && !lookups_of(item).is_empty()
}

fn copy(v: &mut deep_canvas::schedule::View<'_>) -> Result<(), deep_canvas::schedule::OpError> {
    use deep_canvas::schedule::{core_ops::Fields, OpError, Val};
    let item = v.typed::<Fields>("core.fields")?.ok_or_else(|| OpError::new("input_missing", v.path()))?.to_json();
    let doc = v.document()?;
    let t = v.t()?;
    let locale = v.locale()?;
    let planted = v.planted();
    let pinned = v.table::<Table>("text.plurals")?;
    let english = (planted == Some(PLURAL_EN_FOR_FR)).then(Table::english_everywhere);
    let id = v.id().unwrap_or_default().to_string();
    let empty = Map::new();
    let doc = doc.as_object().unwrap_or(&empty);
    let frame = Frame { doc, t, locale, plurals: english.as_ref().unwrap_or(&pinned) };
    let shown = frame.text(&id, &item).map_err(|r| OpError::new(r.code, r.path))?;
    v.write("text.copy", Val::typed(shown))
}

impl Frame<'_> {
    /// What a keyed text shows at the frame: its lookup's string, or its template with each
    /// `{copy: …}` slot filled and every other slot as a template fills it.
    pub fn text(&self, id: &str, item: &Value) -> Result<Option<crate::scene::Shown>, crate::scene::Refused> {
        let shown = |text: String| crate::scene::Shown { bound: "copy".into(), text, stale: false, age: None, changes_at: None };
        if let Some(t) = item.pointer("/params/text").filter(|t| t.get("copy").is_some()) {
            let l = lookup(t).map_err(|f| crate::scene::Refused { code: "bad_doc", path: format!("items/{id}/params/text/{f}") })?;
            return Ok(Some(shown(self.show(&l).0)));
        }
        let Some(template) = item.pointer("/params/template").and_then(Value::as_str) else {
            return Ok(None);
        };
        let parts = deep_canvas::template::parts(template)
            .map_err(|_| crate::scene::Refused { code: "ref_unresolved", path: format!("items/{id}/params/template") })?;
        let mut filled = String::new();
        for part in parts {
            match part {
                deep_canvas::template::Part::Words(w) => filled.push_str(w),
                deep_canvas::template::Part::Slot(s) => match slot(s).as_ref().and_then(|l| lookup(l).ok()) {
                    // A string holds no slot of its own.
                    Some(l) => filled.push_str(&self.show(&l).0.replace(['{', '}'], "")),
                    None => {
                        filled.push('{');
                        filled.push_str(s);
                        filled.push('}');
                    }
                },
            }
        }
        let mut rest = item.clone();
        rest["params"]["template"] = json!(filled);
        let text = crate::scene::bound_text(self.doc, id, &rest, &crate::scene::Record::default(), self.locale)?;
        Ok(Some(shown(text.map_or(filled, |s| s.text))))
    }
}

/// Each keyed text's `copy.missing` a frame at `t` in `locale` raises: each lookup whose key
/// begins to be missing at the frame's step; every one at check (`t` none).
pub fn raised_at(doc: &Map<String, Value>, t: Option<i64>, locale: &str) -> Vec<Issue> {
    let mut out = Vec::new();
    let items = doc.get("items").and_then(Value::as_object).into_iter().flatten();
    for (id, item) in items.filter(|(_, i)| i["kind"] == "text@1") {
        for (field, v) in lookups_of(item) {
            let Ok(l) = lookup(&v) else { continue };
            let mut keys = vec![(l.table, l.key)];
            keys.extend(l.args.iter().filter_map(|a| match a {
                Arg::Lookup { table, key } => Some((*table, *key)),
                Arg::Number { .. } => None,
            }));
            for (name, key) in keys {
                let every = element_path(key)
                    .and_then(|(form, _)| doc.get("arrays")?.get(form)?["every"].as_i64())
                    .unwrap_or(1)
                    .max(1);
                for (step, value) in missing_steps(doc, locale, name, key) {
                    if t.is_none_or(|t| t.div_euclid(every) == step) {
                        let m = Missing { table: name.into(), key: value as i64, array: key.into(), step };
                        out.push(missing_issue(id, &format!("items/{id}/params/{field}"), &m, None));
                    }
                }
            }
        }
    }
    out
}

/// A mark set's copy column, `{copy, key, args}`.
pub fn is_copy_column(c: &Value) -> bool {
    c.get("copy").is_some() && c.get("key").is_some()
}

/// The set's copy columns, by name.
fn copy_columns(set: &Value) -> Vec<(&str, &Value)> {
    let columns = set.pointer("/params/columns").and_then(Value::as_object);
    columns.into_iter().flatten().filter(|(_, c)| is_copy_column(c)).map(|(n, c)| (n.as_str(), c)).collect()
}

/// A mark set holding a copy column.
pub fn has_copy_column(_: &Value, _: &str, item: &Value) -> bool {
    item["kind"] == "marks@1" && !copy_columns(item).is_empty()
}

impl Frame<'_> {
    /// Column `name` of `set` as numbers at the frame, with its step and the array it reads:
    /// an array column folded at t through the core's view, else a data column as written.
    fn numbers(&self, set: &Value, name: &str, n: usize) -> Option<(Vec<f64>, i64, String)> {
        let c = set.pointer("/params/columns")?.get(name)?;
        if c.get("steps").is_some() {
            let m = deep_canvas::columns::map(c, self.t, None, false)?;
            let form = c["array"].as_str().unwrap_or(name).to_string();
            return Some((m.values, m.step, form));
        }
        let col = crate::data::column_of(c, n, "").ok()?;
        Some(((0..n).map(|i| col.number(i).unwrap_or(f64::NAN)).collect(), 0, name.to_string()))
    }

    /// Each copy column of `set` as the str column it shows at the frame: each row's string
    /// looked up by its key column's value; and the rows whose key the table lacks.
    pub fn columns(&self, set: &Value) -> Vec<(String, Value, Vec<(usize, Missing)>)> {
        let mut out = Vec::new();
        for (name, c) in copy_columns(set) {
            let Ok(l) = column(c) else { continue };
            let key = set.pointer("/params/columns").and_then(|c| c.get(l.key));
            let count = |k: &str| key.and_then(|c| c.get(k)).and_then(Value::as_u64);
            let n = set.pointer("/params/n").and_then(Value::as_u64).or_else(|| count("len")).or_else(|| count("count"));
            let Some(n) = n.map(|n| n as usize) else { continue };
            let Some((keys, step, array)) = self.numbers(set, l.key, n) else { continue };
            let args: Vec<Vec<f64>> = l.args.iter().filter_map(|a| match a {
                Arg::Number { path, .. } => Some(self.numbers(set, path, n).map_or(vec![f64::NAN; n], |v| v.0)),
                Arg::Lookup { .. } => None,
            }).collect();
            let mut data = Vec::with_capacity(n);
            let mut missed = Vec::new();
            for (row, key) in keys.iter().enumerate().take(n) {
                let shown: Vec<String> = args.iter().map(|a| a.get(row).map_or(String::new(), |v| number(*v))).collect();
                let (s, m) = self.string(l.table, Some((*key, step)), &array, &shown);
                data.push(s);
                missed.extend(m.map(|m| (row, m)));
            }
            out.push((name.to_string(), json!({"dtype": "str", "len": n, "data": data}), missed));
        }
        out
    }
}

/// `items` with each keyed text's string and each copy column's rows as a frame at `t` in
/// `locale` shows them, for a reader that draws from items as written (the check, a render);
/// `None` where no item holds copy a key picks.
pub fn apply(doc: &Map<String, Value>, items: &Map<String, Value>, t: i64, locale: &str) -> Option<Map<String, Value>> {
    let keyed = |i: &Value| is_keyed(&Value::Null, "", i) || has_copy_column(&Value::Null, "", i);
    if !items.values().any(keyed) {
        return None;
    }
    let plurals = Table::pinned();
    let frame = Frame { doc, t, locale, plurals: &plurals };
    let mut out = items.clone();
    for (id, item) in out.iter_mut().filter(|(_, i)| keyed(i)) {
        if let Ok(Some(shown)) = frame.text(id, item) {
            item["params"]["text"] = json!(shown.text);
            if let Some(p) = item["params"].as_object_mut() {
                p.remove("template");
            }
        }
        for (name, column, _) in frame.columns(item) {
            item["params"]["columns"][name] = column;
        }
    }
    Some(out)
}

/// Each copy column's `copy.missing` a frame at `t` (every one at check, `t` none) in `locale`
/// raises, row by row: a row whose key the table lacks, at the step its key begins to be missing.
pub fn column_missing(doc: &Map<String, Value>, t: Option<i64>, locale: &str) -> Vec<Issue> {
    let plurals = Table::default();
    let mut out = Vec::new();
    let items = doc.get("items").and_then(Value::as_object).into_iter().flatten();
    for (id, set) in items.filter(|(_, i)| has_copy_column(&Value::Null, "", i)) {
        for (name, c) in copy_columns(set) {
            let Ok(l) = column(c) else { continue };
            let Some(key) = set.pointer("/params/columns").and_then(|c| c.get(l.key)).filter(|k| k.get("steps").is_some()) else {
                let frame = Frame { doc, t: t.unwrap_or(0), locale, plurals: &plurals };
                for (_, _, missed) in frame.columns(set).into_iter().filter(|c| c.0 == name) {
                    out.extend(missed.iter().map(|(r, m)| missing_issue(id, &format!("items/{id}/params/columns/{name}"), m, Some(*r))));
                }
                continue;
            };
            let every = key["every"].as_i64().unwrap_or(1).max(1);
            let rows = key["count"].as_u64().unwrap_or(0) as usize;
            let array = key["array"].as_str().unwrap_or(l.key);
            let doc_t = table(doc, locale_for(doc, locale, l.table), l.table);
            let has = |v: f64| v.fract() == 0.0 && v.is_finite() && doc_t.is_some_and(|tb| pick(tb, v as i64, || "other").is_some());
            for row in 0..rows {
                let mut was = true;
                for (step, v) in element_steps(key, row) {
                    let now = has(v);
                    if !now && was && t.is_none_or(|t| t.div_euclid(every) == step) {
                        let m = Missing { table: l.table.into(), key: v as i64, array: array.into(), step };
                        out.push(missing_issue(id, &format!("items/{id}/params/columns/{name}"), &m, Some(row)));
                    }
                    was = now;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(keys: Value) -> Map<String, Value> {
        let every = 705_600_000 / 10;
        json!({
            "locale": "en",
            "data": {"copy": {
                "en": {"loot": keys, "other": {"1": "x"}},
                "fr": {"loot": {"17": {"one": "Vous trouvez {0} pièce d'or", "other": "Vous trouvez {0} pièces d'or"}}},
            }},
            "arrays": {
                "rules.item": {"type": "i32", "count": 1, "every": every, "linear": false, "steps": [{"step": 0, "changed": [[0, 1]], "values": [[0, [17]]]}, {"step": 2, "changed": [[0, 1]], "values": [[0, [99]]]}]},
                "rules.count": {"type": "i32", "count": 1, "every": every, "linear": false, "steps": [{"step": 0, "changed": [[0, 1]], "values": [[0, [0]]]}, {"step": 1, "changed": [[0, 1]], "values": [[0, [1]]]}]},
            },
        })
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn a_key_shows_its_plural_form_by_value_in_each_locale_and_a_missing_one_raises() {
        let en = json!({"4": "four", "17": {"one": "You found {0} gold coin", "other": "You found {0} gold coins"}, "9": "nine"});
        let d = doc(en);
        let plurals = Table::pinned();
        let every = 705_600_000 / 10;
        let v = json!({"copy": "loot[rules.item]", "args": [{"path": "rules.count", "widest": "999"}]});
        let l = lookup(&v).unwrap();
        let at = |t: i64, locale: &str| Frame { doc: &d, t, locale, plurals: &plurals }.show(&l);
        assert_eq!(at(0, "en").0, "You found 0 gold coins");
        assert_eq!(at(0, "fr").0, "Vous trouvez 0 pièce d'or");
        assert_eq!(at(every, "en").0, "You found 1 gold coin");
        let (shown, missed) = at(2 * every, "en");
        assert_eq!(shown, "");
        assert_eq!(missed, [Missing { table: "loot".into(), key: 99, array: "rules.item".into(), step: 2 }]);
        assert_eq!(missing_steps(&d, "en", "loot", "rules.item"), [(2, 99.0)]);
        // Sorting the table again changes nothing: a key is found by its value.
        let sorted = doc(json!({"4": "four", "9": "nine", "17": "seventeen"}));
        let f = Frame { doc: &sorted, t: 0, locale: "en", plurals: &plurals };
        assert_eq!(f.show(&l).0, "seventeen");
    }

    #[test]
    fn placeholders_fill_by_index_and_leave_other_braces() {
        assert_eq!(fill("{1} and {0}, {x} {9}", &["a".into(), "b".into()]), "b and a, {x} {9}");
        assert!(lookup(&json!({"copy": "t[a.b]", "args": [{"copy": "u[c.d]", "args": []}]})).is_err());
        assert_eq!(keyed("names[units.kind[3]]"), Some(("names", "units.kind[3]")));
    }
}
