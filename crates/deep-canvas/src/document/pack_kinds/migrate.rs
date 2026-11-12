//! Pack: migrations as data (canvas primitives: Pack: migrations as data; Migration; #1956).
//!
//! A pack kind's `migrate: {from_major → {rename: {old → new}, set: {param → expression}, drop:
//! [param]}}` is data the core applies, so no pack code runs. At the pack check [`read`] reads
//! the steps: one major a step and every step from major 1, each expression from the closed
//! function list over the old params, written `old.<param>`, and each name one the major on its
//! side declares. [`corpus_faults`] then runs each corpus document of an earlier major through
//! the chain and holds what comes out to the kind's inputs. Every fault is named with its reason,
//! never only the first. At load, before the check, [`at_load`] migrates each instance saved at
//! an earlier major of its pinned pack's kind on the check's copy, one `migrated` notice a step,
//! so the stored document changes only when its writer next patches it.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::super::packs::{
    input_fault, rule_number, Input, Pack, PackId, Packs, Resolved, RuleScope,
};
use super::super::{kind_text, Issue, Notice};
use super::PackKind;
use crate::expr::Expr;
use crate::registry::Sealed;
use crate::show::{stamp, Writer, WriterKind};

/// What `old.<param>` reads as once compiled: a name no migration may write itself.
const OLD: &str = "__old_";
/// A migration expression's cap: a driver's 64 ops (The closed function list).
const OPS: usize = 64;

/// One step of a kind's migration, from its major to the next: rename, then set, then drop.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Step {
    pub rename: Vec<(String, String)>,
    /// Each param it sets, its expression and the old params the expression reads, in order.
    pub set: Vec<(String, Expr, Vec<String>)>,
    pub drop: Vec<String>,
}

/// A corpus record (Pack: migrations as data): the major its document was saved at, its sha256,
/// the document, and the values its expansion recorded, `{derived ID → {kind, params, at}}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Case {
    pub major: u64,
    pub sha: String,
    pub doc: Value,
    pub values: Map<String, Value>,
}

fn fault(path: String, actual: Value, what: String) -> Issue {
    Issue::envelope("out_of_range", path, actual, &what)
}

/// A kind's `migrate` at major `major` over its recipe's `inputs`: its steps by the major each
/// starts from, with a fault in `faults` for everything that refuses it.
pub(in crate::document) fn read(
    kind: &str,
    major: u64,
    spec: Option<&Value>,
    inputs: &BTreeMap<String, Input>,
    sealed: &Sealed,
    faults: &mut Vec<Issue>,
) -> BTreeMap<u64, Step> {
    let path = format!("kinds/{kind}/migrate");
    let mut raw: BTreeMap<u64, &Map<String, Value>> = BTreeMap::new();
    let mut named = BTreeSet::new();
    match spec {
        None => {}
        Some(Value::Object(map)) => {
            for (key, step) in map {
                let from = key.parse::<u64>().ok().filter(|f| *f >= 1 && *f < major);
                let fields = step.as_object().filter(|s| {
                    s.keys()
                        .all(|k| ["rename", "set", "drop"].contains(&k.as_str()))
                });
                match (from, fields) {
                    (Some(f), Some(s)) => {
                        raw.insert(f, s);
                    }
                    _ => faults.push(fault(
                        path.clone(),
                        json!({"kind": kind, "field": "migrate", "from": key}),
                        format!("`{key}` is no step of `{kind}`: a step is `<major>: {{rename, set, drop}}`, from a major before {major} to the next"),
                    )),
                }
                if let Some(f) = from {
                    named.insert(f);
                }
            }
        }
        Some(other) => faults.push(fault(
            path.clone(),
            json!({"kind": kind, "field": "migrate", "actual": other}),
            "a kind's migrate is {<major>: {rename, set, drop}}".into(),
        )),
    }
    for from in (1..major).filter(|f| !named.contains(f)) {
        faults.push(fault(
            path.clone(),
            json!({"kind": kind, "field": "migrate", "from": from, "to": from + 1}),
            format!(
                "`{kind}` is at major {major} and ships no step from major {from} to {}: a pack version keeps every step its earlier versions shipped",
                from + 1
            ),
        ));
    }
    // What each major declares: the kind's inputs at its own, and each earlier major's taken back
    // through the step after it.
    let mut names: BTreeMap<u64, BTreeSet<String>> = BTreeMap::new();
    names.insert(major, inputs.keys().cloned().collect());
    for from in (1..major).rev() {
        let mut was = names[&(from + 1)].clone();
        if let Some(step) = raw.get(&from) {
            for (old, new) in step
                .get("rename")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                if let Some(new) = new.as_str() {
                    was.remove(new);
                }
                was.insert(old.clone());
            }
            let drops = step.get("drop").and_then(Value::as_array);
            was.extend(
                drops
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string),
            );
        }
        names.insert(from, was);
    }
    let mut steps = BTreeMap::new();
    for (from, spec) in raw {
        let to = from + 1;
        let at = format!("{path}/{from}");
        let (old, new) = (&names[&from], &names[&to]);
        let mut step = Step::default();
        let why = |part: &str, param: &str, why: String| {
            fault(
                format!("{at}/{part}/{param}"),
                json!({"kind": kind, "from": from, "to": to, "param": param, "why": why}),
                format!("`{kind}`'s step from major {from} {why}"),
            )
        };
        for (o, n) in spec
            .get("rename")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            match n.as_str() {
                Some(n) if new.contains(n) => step.rename.push((o.clone(), n.to_string())),
                Some(n) => faults.push(why(
                    "rename",
                    o,
                    format!("renames `{o}` to `{n}`, which major {to} doesn't declare"),
                )),
                None => faults.push(why("rename", o, format!("renames `{o}` to no name"))),
            }
        }
        for (param, text) in spec
            .get("set")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let mut good = new.contains(param);
            if !good {
                faults.push(why(
                    "set",
                    param,
                    format!("sets `{param}`, which major {to} doesn't declare"),
                ));
            }
            let compiled = match text.as_str() {
                Some(text) => compile(text, sealed),
                None => Err("is no expression".to_string()),
            };
            match compiled {
                Ok((expr, reads)) => {
                    for r in reads.iter().filter(|r| !old.contains(*r)) {
                        good = false;
                        faults.push(why(
                            "set",
                            param,
                            format!(
                                "sets `{param}` from `old.{r}`, which major {from} doesn't declare"
                            ),
                        ));
                    }
                    if good {
                        step.set.push((param.clone(), expr, reads));
                    }
                }
                Err(reason) => faults.push(why(
                    "set",
                    param,
                    format!(
                        "sets `{param}` with `{text}`: {reason}",
                        text = text.as_str().unwrap_or_default()
                    ),
                )),
            }
        }
        for p in spec
            .get("drop")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match p.as_str() {
                Some(p) => step.drop.push(p.to_string()),
                None => faults.push(why("drop", "", format!("drops `{p}`, which is no name"))),
            }
        }
        steps.insert(from, step);
    }
    steps
}

/// `text` with each `old.<param>` read as one var, compiled from the closed function list: the
/// expression and the old params it reads, or why it is refused.
fn compile(text: &str, sealed: &Sealed) -> Result<(Expr, Vec<String>), String> {
    let chars: Vec<char> = text.chars().collect();
    let word = |c: char| c.is_alphanumeric() || c == '_';
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if !word(chars[i]) {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && word(chars[i]) {
            i += 1;
        }
        let name: String = chars[start..i].iter().collect();
        if name.starts_with(OLD) {
            return Err(format!("`{name}` is no name a migration reads"));
        }
        let swizzle = start > 0 && chars[start - 1] == '.';
        let param_at = i + 1;
        let mut end = param_at;
        while end < chars.len() && word(chars[end]) {
            end += 1;
        }
        let reads_old = !swizzle
            && name == "old"
            && chars.get(i) == Some(&'.')
            && end > param_at
            && !chars[param_at].is_ascii_digit();
        if reads_old {
            out.push_str(OLD);
            out.extend(&chars[param_at..end]);
            i = end;
        } else {
            out.push_str(&name);
        }
    }
    let plain = |s: String| s.replace(OLD, "old.");
    let expr = Expr::compile(&out, &RuleScope(sealed), OPS).map_err(|e| plain(e.to_string()))?;
    let mut reads = Vec::new();
    for v in &expr.vars {
        match v.strip_prefix(OLD) {
            Some(p) => reads.push(p.to_string()),
            None => {
                return Err(format!(
                    "reads `{v}`, and a migration reads only the old params, written old.<param>"
                ))
            }
        }
    }
    Ok((expr, reads))
}

/// A number as a param holds it: a whole one as an integer.
fn number(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < 9.0e15 {
        json!(v as i64)
    } else {
        json!(v)
    }
}

/// One step on an instance's params: rename, then set from the old params, then drop. A renamed
/// param the instance leaves out stays out and a 0 stays 0, and a set whose expression reads a
/// param the instance leaves out is left to the new major's default. Returns the params it set.
fn apply<'a>(step: &'a Step, params: &mut Map<String, Value>) -> Vec<&'a str> {
    let old = params.clone();
    for (from, to) in &step.rename {
        if !params.contains_key(to) {
            if let Some(v) = params.shift_remove(from) {
                params.insert(to.clone(), v);
            }
        }
    }
    let mut set = Vec::new();
    for (param, expr, reads) in &step.set {
        if reads.iter().all(|r| old.contains_key(r)) {
            let vars: Vec<f64> = reads.iter().map(|r| rule_number(old.get(r))).collect();
            params.insert(param.clone(), number(expr.eval_num(&vars)));
            set.push(param.as_str());
        }
    }
    for p in &step.drop {
        params.shift_remove(p);
    }
    set
}

/// The pack's `corpus: {major → [sha256]}`, each an asset holding a record `{document, values}`.
pub(in crate::document) fn corpus(
    spec: Option<&Value>,
    assets: &[Value],
    issues: &mut Vec<Issue>,
) -> Vec<Case> {
    let mut out = Vec::new();
    let Some(spec) = spec else {
        return out;
    };
    let Some(map) = spec.as_object() else {
        issues.push(fault(
            "corpus".into(),
            spec.clone(),
            "a pack's corpus is {<major>: [sha256]}".into(),
        ));
        return out;
    };
    for (key, list) in map {
        let major = key.parse::<u64>().ok().filter(|m| *m >= 1);
        let (Some(major), Some(list)) = (major, list.as_array()) else {
            issues.push(fault(
                format!("corpus/{key}"),
                list.clone(),
                format!("`{key}` is no major with a list of documents"),
            ));
            continue;
        };
        for (i, sha) in list.iter().enumerate() {
            let s = sha.as_str().unwrap_or_default();
            let record = super::asset_doc(assets, s).map(|(r, _)| r);
            let doc = record.as_ref().and_then(|r| r.get("document"));
            let values = record.as_ref().and_then(|r| r.get("values")?.as_object());
            match (doc, values) {
                (Some(doc), Some(values)) if doc.get("items").is_some_and(Value::is_object) => out
                    .push(Case {
                        major,
                        sha: s.to_string(),
                        doc: doc.clone(),
                        values: values.clone(),
                    }),
                _ => issues.push(fault(
                    format!("corpus/{key}/{i}"),
                    sha.clone(),
                    format!(
                        "`{s}` is none of the pack's assets, or no record {{document, values}}"
                    ),
                )),
            }
        }
    }
    out
}

/// The items of `doc` of the kind `full` at `major`, by ID.
fn items_of<'a>(
    doc: &'a Value,
    full: &'a str,
    major: u64,
) -> impl Iterator<Item = (&'a String, &'a Value)> + 'a {
    let kind = format!("{full}@{major}");
    doc.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(move |(_, item)| kind_text(item) == Some(kind.as_str()))
}

/// Each corpus item of `kind` saved at an earlier major, run through `steps` to `major`: a fault
/// for each param that comes out outside the kind's inputs, naming the param, the item and the
/// document, and one for each earlier major the corpus holds no document of. Returns the kind's
/// corpus cases, which its kit's migration part expands.
pub(in crate::document) fn corpus_faults(
    kind: &str,
    major: u64,
    steps: &BTreeMap<u64, Step>,
    inputs: &BTreeMap<String, Input>,
    corpus: &[Case],
    faults: &mut Vec<Issue>,
) -> Vec<Case> {
    let full = kind.rsplit_once('@').map_or(kind, |(f, _)| f);
    let mut mine = Vec::new();
    for from in 1..major {
        let cases: Vec<&Case> = corpus
            .iter()
            .filter(|c| c.major == from && items_of(&c.doc, full, from).next().is_some())
            .collect();
        if cases.is_empty() {
            faults.push(fault(
                "corpus".into(),
                json!({"kind": kind, "major": from}),
                format!("`{kind}` is at major {major} and the pack's corpus holds no document of its major {from}"),
            ));
        }
        let chain: Option<Vec<&Step>> = (from..major).map(|f| steps.get(&f)).collect();
        for case in cases {
            mine.push(case.clone());
            for (id, item) in items_of(&case.doc, full, from) {
                // A document saved at a major no chain leaves can't open at this one.
                let Some(chain) = &chain else {
                    let mut issue = fault(
                        format!("kinds/{kind}/migrate"),
                        json!({"kind": kind, "item": id, "corpus": case.sha, "from": from, "to": major}),
                        format!("corpus item `{id}` (document `{}`) is saved at `{full}@{from}`, and `{kind}` carries no chain of steps from major {from} to {major}", case.sha),
                    );
                    issue.ids = vec![id.clone()];
                    issue.fix = format!("Keep every step an earlier version of the pack shipped, from major {from} up, so a document saved at `{full}@{from}` still opens at major {major}.");
                    faults.push(issue);
                    continue;
                };
                let mut params = item
                    .get("params")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                // Which step set each param, by the name it ends under.
                let mut origin: BTreeMap<String, (u64, String)> = BTreeMap::new();
                for (f, step) in (from..).zip(chain) {
                    for (a, b) in &step.rename {
                        if let Some(o) = origin.remove(a) {
                            origin.insert(b.clone(), o);
                        }
                    }
                    for p in apply(step, &mut params) {
                        origin.insert(p.to_string(), (f, p.to_string()));
                    }
                }
                for (p, v) in &params {
                    let why = match inputs.get(p) {
                        None => Some(format!("isn't an input of major {major}")),
                        Some(input) => input_fault(input, v),
                    };
                    let Some(why) = why else {
                        continue;
                    };
                    let (path, by) = match origin.get(p) {
                        Some((f, set)) => (
                            format!("kinds/{kind}/migrate/{f}/set/{set}"),
                            format!(", set by the step from major {f}"),
                        ),
                        None => (format!("kinds/{kind}/migrate"), String::new()),
                    };
                    let mut issue = fault(
                        path,
                        json!({"kind": kind, "item": id, "corpus": case.sha, "from": from, "param": p, "value": v, "why": why}),
                        format!("corpus item `{id}` of `{kind}`, saved at major {from}, migrates to `{p}` = {v}{by}: {why}"),
                    );
                    issue.ids = vec![id.clone()];
                    faults.push(issue);
                }
            }
        }
    }
    mine
}

/// A corpus document as the kit opens it: pinned to the version `pack` in place of the one it was
/// saved with, and, saved as its writer presented it, stamped as the hub stamps a shown revision.
pub(in crate::document) fn opened(doc: &Value, pack: &PackId) -> Value {
    let mut doc = doc.clone();
    for entry in doc
        .get_mut("packs")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        let named = entry.as_str().and_then(|e| e.rsplit_once('@'));
        if named.is_some_and(|(id, _)| id == pack.id) {
            *entry = json!(pack.text());
        }
    }
    if doc.get("layers").is_none() {
        let you = Writer {
            kind: WriterKind::You,
            id: "you".into(),
        };
        if let Ok(stamped) = stamp(doc.clone(), "corpus", &you, "Corpus") {
            return stamped;
        }
    }
    doc
}

/// The pack's kind of the name `full`, at its highest major.
fn current<'a>(pack: &'a Pack, full: &str) -> Option<(u64, &'a PackKind)> {
    pack.kinds
        .iter()
        .filter_map(|(name, kind)| {
            let (f, m) = name.rsplit_once('@')?;
            (f == full).then_some(())?;
            Some((m.parse::<u64>().ok()?, kind))
        })
        .max_by_key(|(m, _)| *m)
}

/// Migrates each instance saved at an earlier major of its pinned pack's kind, on the check's
/// copy and before expansion: one major a step, one `migrated` notice a step (Migration).
pub fn at_load(
    items: &mut Map<String, Value>,
    resolved: &Resolved,
    notices: &mut Vec<Notice>,
) {
    for (key, item) in items.iter_mut() {
        migrate_item(key, item, resolved, notices);
    }
}

/// Stores the migrations of the pack-kind items in `layer`, the writer's, in place, and returns
/// each item it migrated as it was before, as `store_migrations` does for canvas modules' kinds:
/// another writer's items stay as saved (Migration).
pub fn store_migrations(doc: &mut Value, layer: &str, packs: &Packs) -> Vec<(String, Value)> {
    let resolved = super::super::packs::resolve(doc, packs, None, &mut Vec::new());
    let mut out = Vec::new();
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return out;
    };
    for (key, item) in items.iter_mut() {
        if item.get("layer").and_then(Value::as_str) == Some(layer) {
            let was = item.clone();
            if migrate_item(key, item, &resolved, &mut Vec::new()) {
                out.push((key.clone(), was));
            }
        }
    }
    out
}

/// One item through its pinned pack's chain, if it is saved at an earlier major of the pack's
/// kind; whether it moved.
fn migrate_item(
    key: &str,
    item: &mut Value,
    resolved: &Resolved,
    notices: &mut Vec<Notice>,
) -> bool {
    let Some(text) = kind_text(item).map(str::to_string) else {
        return false;
    };
    let Some((full, saved)) = text.rsplit_once('@') else {
        return false;
    };
    let (Some(saved), Some((family, _))) = (saved.parse::<u64>().ok(), full.split_once('.')) else {
        return false;
    };
    let Some((major, kind)) = resolved
        .by_name
        .get(family)
        .and_then(|pack| current(pack, full))
        .filter(|(m, _)| saved < *m)
    else {
        return false;
    };
    // The pack check holds every step from major 1, so an admitted pack carries the chain.
    let Some(chain) = (saved..major)
        .map(|f| kind.migrate.get(&f))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    let Some(fields) = item.as_object_mut() else {
        return false;
    };
    let mut params = fields
        .get("params")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (from, step) in (saved..).zip(chain) {
        apply(step, &mut params);
        let major = |m: u64| u32::try_from(m).unwrap_or(u32::MAX);
        notices.push(Notice {
            code: "migrated",
            ids: vec![key.to_string()],
            path: format!("items/{key}/kind"),
            actual: json!(text),
            what: format!("migrated {full} from major {from} to {}", from + 1),
            migration: Some((full.to_string(), major(from), major(from + 1))),
            replaced_by: None,
            close: Vec::new(),
        });
    }
    fields.insert("kind".into(), json!(format!("{full}@{major}")));
    if fields.contains_key("params") || !params.is_empty() {
        fields.insert("params".into(), Value::Object(params));
    }
    true
}

/// The first recorded value an expansion's derived items miss: the derived ID and the field
/// (`kind`, `params` or `at`) that differs, or an ID one side lacks. Numbers compare as numbers.
pub(in crate::document) fn differs(
    derived: &Map<String, Value>,
    recorded: &Map<String, Value>,
) -> Option<(String, String)> {
    for (id, want) in recorded {
        let Some(got) = derived.get(id) else {
            return Some((
                id.clone(),
                "the item, which the expansion doesn't write".into(),
            ));
        };
        for field in ["kind", "params", "at"] {
            if !same(got.get(field), want.get(field)) {
                return Some((id.clone(), field.to_string()));
            }
        }
    }
    let extra = derived.keys().find(|id| !recorded.contains_key(*id))?;
    Some((
        extra.clone(),
        "the item, which the record doesn't hold".into(),
    ))
}

fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::Array(x)), Some(Value::Array(y))) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(Some(x), Some(y)))
        }
        (Some(Value::Object(x)), Some(Value::Object(y))) => {
            x.len() == y.len() && x.iter().all(|(k, v)| same(Some(v), y.get(k)))
        }
        _ => a == b,
    }
}
