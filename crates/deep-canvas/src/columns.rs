//! The core's column view (issue #397; canvas primitives: Array and table: column view): a reader
//! names a column by its source's form, never a module, and the view resolves the form through the
//! entries canvas modules fill in `column.source@1`, narrowing each row by one rule.
//!
//! - A column `{source: form, as: dtype, part, range}` whose form no entry in the build fills
//!   belongs to a document that needs a missing module: refused `module_missing`.
//! - An `as` the source's type can't narrow to is refused at check, naming the column.
//! - A value outside `as`'s range or the column's `range`, a NaN or an infinity hides its row and
//!   raises `column.out_of_range {reader, column, row, value, step}`; it never wraps, clamps or
//!   rounds a value into range, and f64 to f32 rounds to nearest, ties to even.
//!
//! #535 (Mark set: logic columns): a column `{array: <logic>.<name>, as, part, range}` and a set's
//! `alive: {array, as: bool}` read a logic item's array, which the host bakes into the document's
//! `arrays` at check, each step's changes with the index ranges the logic module hands over. The
//! set's row count is the array's; [`map`] folds those steps at a frame's t, from the frame
//! before only the rows the steps since hand over, and a row that can't narrow, or whose `alive`
//! is false, hides; `column.out_of_range` is raised at the step a row's excursion begins.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use crate::document::Issue;
use crate::registry::lists::SealedEntry;
use crate::schedule::Canonical;

/// The registry the core declares for column sources.
pub const REGISTRY: &str = "column.source@1";

/// The canvas module whose arrays an `array` column reads, named when the build lacks it.
const ARRAY_MODULE: &str = "logic";

/// The value `v` of a `from` source read as `as_`, `Some(None)` where it can't narrow (its row
/// hides), and `None` where `as_` isn't a type `from` narrows to.
pub fn narrow(v: f64, from: &str, as_: &str) -> Option<Option<f64>> {
    let within = |lo: f64, hi: f64| {
        Some((v.is_finite() && v.fract() == 0.0 && v >= lo && v <= hi).then_some(v))
    };
    match (from, as_) {
        ("i32", "i32") => within(i32::MIN.into(), i32::MAX.into()),
        ("i32", "u32") => within(0.0, u32::MAX.into()),
        ("i32", "u16") => within(0.0, u16::MAX.into()),
        ("i32" | "bool", "u8") => within(0.0, u8::MAX.into()),
        ("i32" | "bool", "bool") => within(0.0, 1.0),
        ("f64", "f64") => Some(v.is_finite().then_some(v)),
        ("f64", "f32") => {
            let f = v as f32;
            Some(f.is_finite().then_some(f64::from(f)))
        }
        _ => None,
    }
}

/// The entry that fills `form` and the source's name in it: an entry's form names the source
/// with `<name>`, as `test.column.<name>` does. An array's form also names the item that writes
/// it in angle brackets, `<logic>.<name>`, and only an array column resolves through one.
fn resolve<'e>(
    form: &str,
    entries: &'e [SealedEntry],
    array: bool,
) -> Option<(&'e SealedEntry, String)> {
    entries.iter().find_map(|e| {
        let pattern = e.value["form"].as_str()?;
        let (head, tail) = pattern.split_once("<name>")?;
        let rest = match head.strip_prefix('<').and_then(|h| h.split_once('>')) {
            Some((_, after)) if array => {
                let at = form.find(after).filter(|at| *at > 0 && !after.is_empty())?;
                &form[at + after.len()..]
            }
            Some(_) => return None,
            None => form.strip_prefix(head)?,
        };
        let name = rest.strip_suffix(tail)?;
        (!name.is_empty()).then(|| (e, name.to_string()))
    })
}

/// Numbers an element of a source type takes: one for a scalar, two to four for a vector.
fn width(ty: &str) -> Option<usize> {
    Some(match ty {
        "i32" | "bool" | "f64" => 1,
        "vec2" => 2,
        "vec3" => 3,
        "quat" => 4,
        _ => return None,
    })
}

/// How a column reads its source's elements: which part of a vector, as which dtype, within
/// which range.
#[derive(Clone, Debug, PartialEq)]
pub struct Read {
    from: &'static str,
    as_: String,
    part: usize,
    range: [f64; 2],
    wraps: bool,
}

impl Read {
    /// How `column` reads a source of type `ty`, or `None` where its `as` can't narrow from it:
    /// a vector without `part`, a scalar with one, or an `as` the type doesn't take.
    pub fn of(column: &Value, ty: &str) -> Option<Read> {
        let part = match column.get("part") {
            None | Some(Value::Null) => None,
            Some(p) => Some(
                ["x", "y", "z", "w"]
                    .iter()
                    .position(|x| Some(*x) == p.as_str())?,
            ),
        };
        let w = width(ty)?;
        if (w > 1) != part.is_some() || part.is_some_and(|p| p >= w) {
            return None;
        }
        let from = match ty {
            "i32" => "i32",
            "bool" => "bool",
            _ => "f64",
        };
        let as_ = column
            .get("as")
            .and_then(Value::as_str)
            .unwrap_or(from)
            .to_string();
        narrow(0.0, from, &as_)?;
        let bound = |i: usize, d: f64| {
            column
                .pointer(&format!("/range/{i}"))
                .and_then(Value::as_f64)
                .unwrap_or(d)
        };
        Some(Read {
            from,
            as_,
            part: part.unwrap_or(0),
            range: [bound(0, f64::NEG_INFINITY), bound(1, f64::INFINITY)],
            wraps: false,
        })
    }

    /// The planted narrowing that wraps an integer into `as`'s range rather than hiding its row.
    pub fn wrapping(self) -> Read {
        Read {
            wraps: true,
            ..self
        }
    }

    /// An element's read value, `None` where its row hides.
    pub fn row(&self, element: &[f64]) -> Option<f64> {
        let v = self.scalar(element);
        let narrowed = narrow(v, self.from, &self.as_)?;
        let kept = narrowed.filter(|x| *x >= self.range[0] && *x <= self.range[1]);
        if kept.is_some() || !self.wraps || !v.is_finite() || v.fract() != 0.0 {
            return kept;
        }
        let modulus = match self.as_.as_str() {
            "bool" => 2.0,
            "u8" => 256.0,
            "u16" => 65_536.0,
            "u32" => 4_294_967_296.0,
            _ => return kept,
        };
        Some(v.rem_euclid(modulus))
    }

    /// The number of an element this column reads: its part of a vector, or the scalar.
    fn scalar(&self, element: &[f64]) -> f64 {
        element.get(self.part).copied().unwrap_or(f64::NAN)
    }
}

/// An element as numbers: a bool as 0 or 1, a vector by component, and null (a NaN or an
/// infinity, as JSON writes them) as NaN.
fn numbers(v: &Value, out: &mut [f64]) {
    let one = |v: &Value| match v {
        Value::Bool(b) => f64::from(u8::from(*b)),
        v => v.as_f64().unwrap_or(f64::NAN),
    };
    match v {
        Value::Array(l) => out.iter_mut().zip(l).for_each(|(o, v)| *o = one(v)),
        v => out[0] = one(v),
    }
}

/// A linear array's element at α between its value before the step and after it, as the logic
/// module draws it (Logic: interpolated writes): lerp, and a quat by nlerp along the shorter arc.
fn blend(ty: &str, from: &[f64], to: &[f64], a: f64) -> Vec<f64> {
    let flip = ty == "quat" && from.iter().zip(to).map(|(x, y)| x * y).sum::<f64>() < 0.0;
    let mut v: Vec<f64> = from
        .iter()
        .zip(to)
        .map(|(x, y)| {
            let y = if flip { -y } else { *y };
            x + a * (y - x)
        })
        .collect();
    let len = crate::ops::sqrt(v.iter().map(|x| x * x).sum::<f64>());
    if ty == "quat" && len > 0.0 {
        v.iter_mut().for_each(|x| *x /= len);
    }
    v
}

/// A column read from an array as a frame maps it: each row's value (0 where it hides) and
/// whether it hides, at the frame's step, with how many rows this frame mapped again.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mapped {
    /// The step whose values these are: the frame's, ⌊t ÷ the step length⌋.
    pub step: i64,
    raw: Vec<f64>,
    before: Vec<f64>,
    pub values: Vec<f64>,
    pub hidden: Vec<bool>,
    /// For each step this frame applied, the rows it mapped for that step, those the step handed
    /// over: from nothing, one entry of every row. A proof reading, not part of the frame.
    pub remaps: Vec<(i64, usize)>,
}

impl Canonical for Mapped {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.step, &self.values, &self.hidden).encode(out);
    }
}

/// The steps' index ranges as rows.
fn rows_of(ranges: &Value, into: &mut BTreeSet<usize>) {
    for r in ranges.as_array().into_iter().flatten() {
        if let (Some(s), Some(e)) = (r[0].as_u64(), r[1].as_u64()) {
            into.extend(s as usize..e as usize);
        }
    }
}

/// `column`, an array column [`view`] baked, as a frame at `t` maps it, or `None` where it isn't
/// one. From `last`, the same column at an earlier step of this session, only the rows the
/// steps since handed over (and a linear array's rows in the last two steps' ranges) map again;
/// without it, or from a later step (a seek back), every row does. `wraps`: the planted
/// narrowing.
pub fn map(column: &Value, t: i64, last: Option<&Mapped>, wraps: bool) -> Option<Mapped> {
    let ty = column["type"].as_str()?;
    let mut read = Read::of(column, ty)?;
    if wraps {
        read = read.wrapping();
    }
    let w = width(ty)?;
    let n = column["count"].as_u64()? as usize;
    let every = column["every"].as_i64()?.max(1);
    let linear = column["linear"].as_bool() == Some(true);
    let steps = column["steps"].as_array()?;
    let k = t.div_euclid(every);
    let at = |step: i64| steps.iter().find(|s| s["step"].as_i64() == Some(step));
    let mut rows = BTreeSet::new();
    let (mut m, from) = match last.filter(|l| l.step <= k && l.raw.len() == n * w) {
        Some(l) => {
            if linear && l.step < k {
                // The rows that blended into step l.step settle on its value.
                rows_of(
                    at(l.step).map_or(&Value::Null, |s| &s["changed"]),
                    &mut rows,
                );
            }
            let mut m = l.clone();
            m.remaps = (l.step + 1..=k).map(|s| (s, 0)).collect();
            (m, Some(l.step))
        }
        None => {
            let zero = vec![0.0; n * w];
            rows.extend(0..n);
            let m = Mapped {
                step: k,
                raw: zero.clone(),
                before: zero,
                values: vec![0.0; n],
                hidden: vec![false; n],
                remaps: vec![(k, n)],
            };
            (m, None)
        }
    };
    for s in steps {
        let Some(step) = s["step"]
            .as_i64()
            .filter(|s| *s <= k && from.is_none_or(|f| *s > f))
        else {
            continue;
        };
        let mut handed = BTreeSet::new();
        rows_of(&s["changed"], &mut handed);
        for run in s["values"].as_array().into_iter().flatten() {
            let start = run[0].as_u64().unwrap_or(0) as usize;
            for (j, v) in run[1].as_array().into_iter().flatten().enumerate() {
                let row = start + j;
                if row >= n || (from.is_some() && !handed.contains(&row)) {
                    continue;
                }
                let e = row * w..(row + 1) * w;
                if step == k {
                    let (raw, before) = (&m.raw, &mut m.before);
                    before[e.clone()].copy_from_slice(&raw[e.clone()]);
                }
                numbers(v, &mut m.raw[e]);
            }
        }
        if from.is_some() {
            let handed: Vec<usize> = handed.into_iter().filter(|r| *r < n).collect();
            if let Some(e) = m.remaps.iter_mut().find(|e| e.0 == step) {
                e.1 = handed.len();
            }
            rows.extend(handed);
        }
    }
    // A linear array's rows that step k changed blend every frame of its step, from their value
    // before it: a frame reads a linear write one step late.
    let mut blending = BTreeSet::new();
    if linear {
        rows_of(at(k).map_or(&Value::Null, |s| &s["changed"]), &mut blending);
    }
    let a = (t - k * every) as f64 / every as f64;
    m.step = k;
    let mapped: BTreeSet<usize> = rows.union(&blending).copied().filter(|r| *r < n).collect();
    for &row in &mapped {
        let e = row * w..(row + 1) * w;
        let element = if blending.contains(&row) {
            blend(ty, &m.before[e.clone()], &m.raw[e], a)
        } else {
            m.raw[e].to_vec()
        };
        let read = read.row(&element);
        m.values[row] = read.unwrap_or(0.0);
        m.hidden[row] = read.is_none();
    }
    Some(m)
}

/// The rows a mapped column hides: those that can't narrow, and for `alive` those whose value is
/// false.
pub fn hidden_rows(m: &Mapped, alive: bool) -> Vec<usize> {
    (0..m.values.len())
        .filter(|r| m.hidden[*r] || (alive && m.values[*r] == 0.0))
        .collect()
}

/// A mapped column's values as a data column's bytes: f64 little-endian, base64.
pub fn data_of(m: &Mapped) -> String {
    let mut bytes = Vec::with_capacity(m.values.len() * 8);
    for v in &m.values {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    crate::base64::encode(&bytes)
}

/// Every step at which a row of `column` (baked) begins to hide, by the rule alone, with its
/// value: `(step, row, value)`.
fn excursions(column: &Value) -> Vec<(i64, usize, f64)> {
    let (Some(ty), Some(n)) = (column["type"].as_str(), column["count"].as_u64()) else {
        return Vec::new();
    };
    let (Some(read), Some(w)) = (Read::of(column, ty), width(ty)) else {
        return Vec::new();
    };
    let n = n as usize;
    let mut raw = vec![0.0; n * w];
    let mut hidden = vec![false; n];
    let mut out = Vec::new();
    let steps = column["steps"].as_array().cloned().unwrap_or_default();
    // Every row is read at step 0, whether or not step 0 wrote it; after it, the rows a step wrote.
    let mut checks = Vec::new();
    if steps.first().and_then(|s| s["step"].as_i64()) != Some(0) {
        checks.push((0, Value::Null));
    }
    checks.extend(
        steps
            .into_iter()
            .map(|s| (s["step"].as_i64().unwrap_or(0), s)),
    );
    for (step, s) in checks {
        let mut touched = BTreeSet::new();
        for run in s["values"].as_array().into_iter().flatten() {
            let start = run[0].as_u64().unwrap_or(0) as usize;
            for (j, v) in run[1].as_array().into_iter().flatten().enumerate() {
                let row = start + j;
                if row < n {
                    numbers(v, &mut raw[row * w..(row + 1) * w]);
                    touched.insert(row);
                }
            }
        }
        let rows: Vec<usize> = if step == 0 {
            (0..n).collect()
        } else {
            touched.into_iter().collect()
        };
        for row in rows {
            let element = &raw[row * w..(row + 1) * w];
            let hides = read.row(element).is_none();
            if hides && !hidden[row] {
                out.push((step, row, read.scalar(element)));
            }
            hidden[row] = hides;
        }
    }
    out
}

/// Every mark set column of `doc` that reads a column source, resolved through `entries` (the
/// build's `column.source@1`) and narrowed at the frame's time `t`: written in place as the
/// narrowed values with the rows it hides (`hide`), and the issues the view raised. A column that
/// reads an array also keeps what [`map`] folds at each frame, and its set takes the array's
/// count as `n`.
pub fn view(doc: &mut Value, entries: &[SealedEntry], t: i64) -> Vec<Issue> {
    let mut issues = Vec::new();
    // A source column's step is a 60 fps frame: 11,760,000 flicks.
    let step = t.max(0) as u64 / 11_760_000;
    let arrays = doc.get("arrays").cloned().unwrap_or(Value::Null);
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return issues;
    };
    for (id, item) in items.iter_mut() {
        if let Some(Value::Object(params)) = item.get_mut("params") {
            issues.extend(arrays_of(id, params, entries, &arrays, t));
        }
        let Some(Value::Object(columns)) = item.pointer_mut("/params/columns") else {
            continue;
        };
        for (name, column) in columns.iter_mut() {
            let Some(form) = column
                .get("source")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            let path = format!("items/{id}/params/columns/{name}");
            let Some((entry, source)) = resolve(&form, entries, false) else {
                issues.push(Issue::error(
                    "module_missing",
                    id,
                    format!("{path}/source"),
                    json!(form),
                    "no canvas module in this build fills this column source",
                ));
                continue;
            };
            let filled = &entry.value["sources"][&source];
            let from = filled["dtype"].as_str().unwrap_or_default();
            let as_ = column
                .get("as")
                .and_then(Value::as_str)
                .unwrap_or(from)
                .to_string();
            let range = column.get("range").and_then(Value::as_array).cloned();
            let mut values = Vec::new();
            let mut hide = Vec::new();
            for (row, v) in filled["rows"].as_array().into_iter().flatten().enumerate() {
                let v = v.as_f64().unwrap_or(f64::NAN);
                let Some(narrowed) = narrow(v, from, &as_) else {
                    issues.push(Issue::error(
                        "bad_column",
                        id,
                        format!("{path}/as"),
                        json!({"from": from, "as": as_}),
                        "the column source's type can't narrow to this `as`",
                    ));
                    break;
                };
                let in_range = |x: f64| match range.as_deref() {
                    Some([lo, hi]) => {
                        lo.as_f64().is_none_or(|lo| x >= lo) && hi.as_f64().is_none_or(|hi| x <= hi)
                    }
                    _ => true,
                };
                match narrowed.filter(|x| in_range(*x)) {
                    Some(x) => values.push(x),
                    None => {
                        values.push(0.0);
                        hide.push(row);
                        issues.push(out_of_range(id, name, &path, row, v, step as i64));
                    }
                }
            }
            let mut bytes = Vec::with_capacity(values.len() * 8);
            for v in &values {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            let mut out = Map::new();
            out.insert("dtype".into(), json!("f64"));
            out.insert("len".into(), json!(values.len()));
            out.insert("data".into(), json!(crate::base64::encode(&bytes)));
            out.insert("hide".into(), json!(hide));
            *column = Value::Object(out);
        }
    }
    issues
}

/// The `column.out_of_range` issues a frame at `t` of `doc` (its columns baked by [`view`])
/// raises: each row whose excursion out of range begins at the frame's step.
pub fn raised_at(doc: &Value, t: i64) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let p = &item["params"];
        let columns = p["columns"].as_object().into_iter().flatten();
        let alive = p
            .get("alive")
            .map(|a| ("alive", a, format!("items/{id}/params/alive")));
        let readers = columns
            .map(|(n, c)| (n.as_str(), c, format!("items/{id}/params/columns/{n}")))
            .chain(alive)
            .filter(|(_, c, _)| c.get("steps").is_some());
        for (name, column, path) in readers {
            let k = t.div_euclid(column["every"].as_i64().unwrap_or(1).max(1));
            for (step, row, value) in excursions(column).into_iter().filter(|e| e.0 == k) {
                out.push(out_of_range(id, name, &path, row, value, step));
            }
        }
    }
    out
}

/// `column.out_of_range`, naming the set as its reader.
fn out_of_range(id: &str, column: &str, path: &str, row: usize, value: f64, step: i64) -> Issue {
    Issue {
        severity: "warning",
        ..Issue::error(
            "column.out_of_range",
            id,
            path.to_string(),
            json!({"reader": id, "set": id, "column": column, "row": row, "value": value, "step": step}),
            "a row's value is out of its reader's range; the row hides while it lasts",
        )
    }
}

/// A set's columns, and its `alive`, that read an array: each checked, baked from `arrays` (the
/// document's, which the host fills) and mapped at `t`, and the set's `n` the arrays' count.
fn arrays_of(
    id: &str,
    params: &mut Map<String, Value>,
    entries: &[SealedEntry],
    arrays: &Value,
    t: i64,
) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut readers: Vec<(String, String, &mut Value)> = Vec::new();
    let mut alive = None;
    for (k, v) in params.iter_mut() {
        match k.as_str() {
            "alive" if v.get("array").is_some() => alive = Some(v),
            "columns" => readers.extend(
                v.as_object_mut()
                    .into_iter()
                    .flatten()
                    .filter(|(_, c)| c.get("array").is_some())
                    .map(|(name, c)| {
                        (name.clone(), format!("items/{id}/params/columns/{name}"), c)
                    }),
            ),
            _ => {}
        }
    }
    if let Some(a) = alive {
        readers.push(("alive".into(), format!("items/{id}/params/alive"), a));
    }
    let mut counts: Vec<(String, String, u64)> = Vec::new();
    for (name, path, column) in readers {
        let form = column["array"].as_str().unwrap_or_default().to_string();
        if resolve(&form, entries, true).is_none() {
            issues.push(Issue::error(
                "module_missing",
                id,
                format!("{path}/array"),
                json!({"module": ARRAY_MODULE, "array": form}),
                &format!("this column reads an array the {ARRAY_MODULE} module fills, which this build lacks"),
            ));
            continue;
        }
        let Some(baked) = arrays.get(&form) else {
            issues.push(Issue::error(
                "ref_unresolved",
                id,
                format!("{path}/array"),
                json!(form),
                "no logic item in the document writes this array",
            ));
            continue;
        };
        let ty = baked["type"].as_str().unwrap_or_default();
        if Read::of(column, ty).is_none() {
            issues.push(Issue::error(
                "bad_column",
                id,
                format!("{path}/as"),
                json!({"array": form, "type": ty, "as": column.get("as"), "part": column.get("part")}),
                "the array's type can't narrow to this `as`; a vector's column names its `part`",
            ));
            continue;
        }
        if let Some(c) = column.as_object_mut() {
            for k in ["type", "count", "every", "linear", "steps"] {
                c.insert(k.into(), baked[k].clone());
            }
        }
        let alive = name == "alive";
        for (step, row, value) in excursions(column) {
            issues.push(out_of_range(id, &name, &path, row, value, step));
        }
        if let (Some(m), Some(c)) = (map(column, t, None, false), column.as_object_mut()) {
            c.insert("dtype".into(), json!("f64"));
            c.insert("len".into(), json!(m.values.len()));
            c.insert("data".into(), json!(data_of(&m)));
            c.insert("hide".into(), json!(hidden_rows(&m, alive)));
        }
        counts.push((name, path, baked["count"].as_u64().unwrap_or(0)));
    }
    if counts.iter().any(|c| c.2 != counts[0].2) {
        let named: Map<String, Value> = counts
            .iter()
            .map(|(n, _, c)| (n.clone(), json!(c)))
            .collect();
        for (_, path, _) in &counts {
            issues.push(Issue::error(
                "bad_column",
                id,
                path.clone(),
                Value::Object(named.clone()),
                "the set's array columns hold different counts; a set's row count is its arrays'",
            ));
        }
    } else if let Some((_, _, n)) = counts.first() {
        params.entry("n").or_insert(json!(n));
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One narrowing fixture per `as` (the registry's kit: "one narrowing fixture per `as`").
    #[test]
    fn each_as_narrows_by_the_one_rule_and_never_wraps_clamps_or_rounds() {
        let cases: &[(&str, &str, f64, Option<f64>)] = &[
            ("i32", "i32", -5.0, Some(-5.0)),
            ("i32", "u32", -1.0, None),
            ("i32", "u16", 70_000.0, None),
            ("i32", "u16", 65_535.0, Some(65_535.0)),
            ("i32", "u8", 256.0, None),
            ("i32", "bool", 2.0, None),
            ("bool", "u8", 1.0, Some(1.0)),
            ("f64", "f64", f64::NAN, None),
            ("f64", "f32", 1e39, None),
            ("f64", "f32", 0.1, Some(f64::from(0.1f32))),
        ];
        for (from, as_, v, want) in cases {
            assert_eq!(narrow(*v, from, as_), Some(*want), "{from} as {as_}: {v}");
        }
        assert_eq!(narrow(1.0, "f64", "u16"), None);
        // A vector reads by part, and never without one.
        let y = Read::of(&json!({"as": "f32", "part": "y"}), "vec2").expect("a read");
        assert_eq!(y.row(&[1.0, 2.5]), Some(2.5));
        assert_eq!(Read::of(&json!({"as": "f32"}), "vec2"), None);
        assert_eq!(Read::of(&json!({"as": "f32", "part": "x"}), "f64"), None);
    }

    /// A column of 200 rows where step 1 changes 100 single rows: the hand-over merges them into
    /// 64 ranges, and mapping from step 0 by them equals mapping from nothing; dropping a range
    /// leaves its row behind.
    #[test]
    fn a_forward_map_by_the_handed_ranges_equals_a_full_map() {
        let runs: Vec<Value> = (0..100).map(|i| json!([i * 2, [7]])).collect();
        let mut changed: Vec<Value> = (0..63).map(|i| json!([i * 2, i * 2 + 1])).collect();
        changed.push(json!([126, 199]));
        let column = |changed: Vec<Value>| {
            json!({"type": "i32", "count": 200, "every": 10, "linear": false, "as": "u16",
                   "steps": [{"step": 0, "changed": [[0, 200]], "values": [[0, vec![1; 200]]]},
                             {"step": 1, "changed": changed, "values": runs}]})
        };
        let full = map(&column(changed.clone()), 10, None, false).expect("a map");
        let before = map(&column(changed.clone()), 0, None, false).expect("a map");
        let forward = map(&column(changed.clone()), 10, Some(&before), false).expect("a map");
        assert_eq!(
            forward,
            Mapped {
                remaps: forward.remaps.clone(),
                ..full.clone()
            }
        );
        assert_eq!(
            (full.remaps.clone(), forward.remaps.clone()),
            (vec![(1, 200)], vec![(1, 63 + 73)])
        );
        changed.pop();
        let dropped = map(&column(changed), 10, Some(&before), false).expect("a map");
        assert_eq!((dropped.values[198], full.values[198]), (1.0, 7.0));
    }

    /// A linear array's row reads one step late, blended (Logic: interpolated writes): at step 1's
    /// first frame its value before step 1, halfway through it halfway to step 1's value; once
    /// step 2 starts, step 1's value, played or seeked.
    #[test]
    fn a_linear_row_blends_one_step_late() {
        let column = json!({"type": "f64", "count": 1, "every": 10, "linear": true, "as": "f64",
            "steps": [{"step": 1, "changed": [[0, 1]], "values": [[0, [8.0]]]}]});
        let at = |t: i64| map(&column, t, None, false).expect("a map").values[0];
        assert_eq!((at(10), at(15), at(20)), (0.0, 4.0, 8.0));
        let mid = map(&column, 15, None, false).expect("a map");
        let played = map(&column, 20, Some(&mid), false).expect("a map");
        assert_eq!(played.values[0], 8.0);
    }
}
