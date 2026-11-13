//! #1183, drawn larger than real (Honest numbers: "Lengths follow the same rule"). A driver that
//! writes a part's position, length or scale from a measured value with a length unit, a logic
//! output its `writes` gives a unit or a value a bound value fills, maps it at a ratio its closed
//! form fixes. Read at two values of the measured value, that ratio must match the part's
//! assembly's `shown_at`, or that times the driver's declared `exaggerate` factor, within 1e-6
//! relative; any other is refused, naming the part and both ratios. A measured value with no
//! unit, and any mapping the check can't read, is listed unchecked and never passed.

use deep_canvas::expr::{Expr, Scope};
use deep_canvas::grammar::{UnitContext, UnitLiteral};
use deep_canvas::lengths::{exaggerate, moved, shown_at, MAPPERS};
use serde_json::{json, Map, Value};

use crate::program::DRIVER_OPS;

/// The planted check that reads a mapping's ratio at one value, `f(1) ÷ 1`.
pub const ONE_VALUE: &str = "length_ratio_one_value";

/// How near a ratio comes to a declared one to match it, relative.
pub const WITHIN: f64 = 1e-6;

/// The two values of the measured value, in its own unit, the ratio is read between.
pub const AT: [f64; 2] = [1.0, 2.0];

/// What the check found of one mapping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Drawn at its assembly's `shown_at`.
    Shown,
    /// Drawn at `shown_at` × its declared factor.
    Exaggerated,
    /// At a ratio the document doesn't declare: refused.
    Undeclared,
    /// Outside the check, with why: never passed.
    Unchecked(&'static str),
}

/// One mapping of a measured length onto a part: a driver and the var it reads it through.
#[derive(Clone, Debug, PartialEq)]
pub struct Mapping {
    /// `drivers/<id>` or `channels/<id>`.
    pub mapping: String,
    pub var: Option<String>,
    /// What the var reads: a logic output `<logic>.<name>` or a `data/<name>` a bound value fills.
    pub reads: Option<String>,
    pub unit: Option<String>,
    pub target: String,
    pub item: String,
    pub assembly: Option<String>,
    pub shown_at: f64,
    pub exaggerate: Option<(f64, String)>,
    pub ratio: Option<f64>,
    pub outcome: Outcome,
}

impl Mapping {
    /// The ratios the document declares for it: its `shown_at`, and that times its factor.
    pub fn expected(&self) -> Vec<f64> {
        let mut out = vec![self.shown_at];
        out.extend(self.exaggerate.as_ref().map(|(f, _)| self.shown_at * f));
        out
    }

    /// Its entry in the check's record, its keys in one order.
    pub fn to_json(&self) -> Value {
        let mut out = Map::new();
        out.insert("mapping".into(), json!(self.mapping));
        out.insert("var".into(), json!(self.var));
        out.insert("reads".into(), json!(self.reads));
        out.insert("unit".into(), json!(self.unit));
        out.insert("target".into(), json!(self.target));
        out.insert("item".into(), json!(self.item));
        out.insert("assembly".into(), json!(self.assembly));
        out.insert("shown_at".into(), json!(self.shown_at));
        let exaggerate = self
            .exaggerate
            .as_ref()
            .map(|(f, d)| json!({"factor": f, "disclose": d}));
        out.insert("exaggerate".into(), exaggerate.unwrap_or(Value::Null));
        let (result, why) = match self.outcome {
            Outcome::Shown | Outcome::Exaggerated => ("pass", None),
            Outcome::Undeclared => ("refused", None),
            Outcome::Unchecked(why) => ("unchecked", Some(why)),
        };
        out.insert("checked".into(), json!(why.is_none()));
        if why.is_none() {
            out.insert("at".into(), json!(AT));
            out.insert("ratio".into(), json!(self.ratio));
            out.insert("expected".into(), json!(self.expected()));
        }
        out.insert("result".into(), json!(result));
        if let Some(why) = why {
            out.insert("why".into(), json!(why));
        }
        Value::Object(out)
    }
}

/// Whether `ratio` is one the document declares.
pub fn declared(ratio: f64, shown_at: f64, factor: Option<f64>) -> Outcome {
    let near = |want: f64| (ratio - want).abs() <= WITHIN * want.abs();
    if near(shown_at) {
        Outcome::Shown
    } else if factor.is_some_and(|f| near(shown_at * f)) {
        Outcome::Exaggerated
    } else {
        Outcome::Undeclared
    }
}

/// What a driver's write target is, when it is a length: a position along an axis, a scale, a
/// slide's travel or a param, each drawn in metres.
fn written(doc: &Value, target: &str) -> bool {
    let parts: Vec<&str> = target.split('/').collect();
    match parts.as_slice() {
        ["items", _, "at", "pos" | "scale", _] | ["items", _, "params", ..] => true,
        ["assemblies", id, "value"] => {
            doc.pointer(&format!("/assemblies/{id}/motion/kind")) == Some(&json!("slide"))
        }
        _ => false,
    }
}

/// The measured value a var's path reads and its unit (`None` with no unit), or `None` when it
/// reads no measured value: a logic item's write, or `data/<name>` a bound value fills.
fn measured<'d>(doc: &'d Value, path: &str) -> Option<Option<&'d str>> {
    let unit = |v: &'d Value, at: &str| v.pointer(at).and_then(Value::as_str);
    if let Some((logic, name)) = path.split_once('.').filter(|_| !path.contains('/')) {
        let item = doc.get("items")?.get(logic)?;
        (item.get("kind")? == "logic@1").then_some(())?;
        return Some(unit(
            item.pointer(&format!("/params/writes/{name}"))?,
            "/unit",
        ));
    }
    let filled = doc.get("bound_values")?.as_object()?.values();
    filled
        .into_iter()
        .find(|b| b.get("target").and_then(Value::as_str) == Some(path))
        .map(|b| unit(b, "/format/unit"))
}

/// Metres in one of `unit`, or why it isn't a length: `None` for another quantity.
fn metres(unit: &str) -> Option<Result<f64, &'static str>> {
    let Ok(one) = UnitLiteral::parse(&format!("1{unit}")) else {
        return Some(Err("unit_unknown"));
    };
    one.convert("m", &UnitContext::default())
        .ok()
        .map(|r| Ok(r.to_f64()))
}

/// The value the document states for a var that doesn't measure the mapped length.
fn stated(doc: &Value, path: &str) -> Option<f64> {
    let number = |v: &Value| v.as_f64().or_else(|| v.get("value")?.as_f64());
    if path == "time" {
        return Some(0.0);
    }
    if let Some(id) = path
        .strip_prefix("controls/")
        .and_then(|p| p.strip_suffix("/value"))
    {
        let c = doc.get("controls")?.get(id)?;
        return c
            .get("default")
            .or_else(|| c.get("range")?.get(0))
            .and_then(Value::as_f64);
    }
    if let Some(name) = path.strip_prefix("data/") {
        return number(doc.get("data")?.get(name)?);
    }
    let id = path.strip_prefix("assemblies/")?.strip_suffix("/value")?;
    Some(
        doc.get("assemblies")?
            .get(id)?
            .get("value")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    )
}

/// The ratio `text` draws the var `var` at, drawn metres per real metre, read at the two values
/// [`AT`] of it in its unit (`metres` each), every other var at the value the document states;
/// with `one_value`, the planted reading `f(1) ÷ 1`.
pub fn ratio(
    text: &str,
    var: &str,
    metres: f64,
    other: impl Fn(&str) -> Option<f64>,
    one_value: bool,
) -> Result<f64, &'static str> {
    let expr = Expr::compile(text, &Scope::default(), DRIVER_OPS).map_err(|_| "not_closed_form")?;
    let mut vals = Vec::with_capacity(expr.vars.len());
    for name in &expr.vars {
        vals.push(if name == var {
            0.0
        } else {
            other(name).ok_or("var_unstated")?
        });
    }
    let at = expr
        .vars
        .iter()
        .position(|n| n == var)
        .ok_or("var_unread")?;
    let mut f = |x: f64| {
        vals[at] = x;
        expr.eval_num(&vals)
    };
    let drawn = if one_value {
        f(AT[0])
    } else {
        f(AT[1]) - f(AT[0])
    };
    let real = if one_value { AT[0] } else { AT[1] - AT[0] } * metres;
    let r = (drawn / real).abs();
    if r.is_finite() {
        Ok(r)
    } else {
        Err("not_finite")
    }
}

/// Each mapping of a measured length onto a part in `doc`, in the document's order: each var of a
/// driver that reads one, and each driver or channel that declares an exaggeration it can't be
/// read through.
pub fn mappings(doc: &Value, one_value: bool) -> Vec<Mapping> {
    let mut out = Vec::new();
    for section in MAPPERS {
        for (id, entry) in doc
            .get(section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(target) = entry.get("target").and_then(Value::as_str) else {
                continue;
            };
            let Some(item) = moved(target).filter(|_| written(doc, target)) else {
                continue;
            };
            let (assembly, at) = shown_at(doc, item);
            let declared_as = exaggerate(entry).map(|(f, d)| (f, d.to_string()));
            let base = Mapping {
                mapping: format!("{section}/{id}"),
                var: None,
                reads: None,
                unit: None,
                target: target.to_string(),
                item: item.to_string(),
                assembly,
                shown_at: at,
                exaggerate: declared_as.clone(),
                ratio: None,
                outcome: Outcome::Unchecked("reads_no_measured_value"),
            };
            let vars = entry
                .get("vars")
                .and_then(Value::as_object)
                .filter(|_| section == "drivers");
            let text = entry
                .get("expr")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let paths: Map<String, Value> = vars.cloned().unwrap_or_default();
            let path_of = |name: &str| paths.get(name).and_then(Value::as_str);
            let mut found = false;
            for (name, path) in paths.iter().filter_map(|(n, p)| Some((n, p.as_str()?))) {
                let Some(unit) = measured(doc, path) else {
                    continue;
                };
                let per_unit = match unit.map(metres) {
                    None => Err("no_unit"),
                    Some(None) => continue,
                    Some(Some(m)) => m,
                };
                found = true;
                let other = |n: &str| {
                    path_of(n)
                        .filter(|p| measured(doc, p).is_none())
                        .and_then(|p| stated(doc, p))
                };
                let read = per_unit.and_then(|m| ratio(text, name, m, other, one_value));
                let outcome = match read {
                    Ok(r) => declared(r, at, declared_as.as_ref().map(|(f, _)| *f)),
                    Err(why) => Outcome::Unchecked(why),
                };
                out.push(Mapping {
                    var: Some(name.clone()),
                    reads: Some(path.to_string()),
                    unit: unit.map(str::to_string),
                    ratio: read.ok(),
                    outcome,
                    ..base.clone()
                });
            }
            if !found && declared_as.is_some() {
                out.push(base);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(expr: &str, shown_at: f64, exaggerate: Option<f64>, unit: Option<&str>) -> Value {
        let mut writes = json!({"type": "f64"});
        if let Some(u) = unit {
            writes["unit"] = json!(u);
        }
        let mut d = json!({
            "assemblies": {"lab": {"shown_at": shown_at}},
            "items": {
                "pilot": {"kind": "logic@1", "params": {"writes": {"swing": writes}}},
                "dot": {"kind": "mark.sphere@1", "parent": "lab"},
                "note": {"kind": "overlay.text@1", "params": {"template": "drawn {factor}× larger than real"}}
            },
            "drivers": {"move": {"target": "items/dot/at/pos/0", "expr": expr, "vars": {"x": "pilot.swing", "t": "time"}}}
        });
        if let Some(f) = exaggerate {
            d["drivers"]["move"]["exaggerate"] = json!({"factor": f, "disclose": "note"});
        }
        d
    }

    fn one(d: &Value, one_value: bool) -> Mapping {
        let mut found = mappings(d, one_value);
        assert_eq!(found.len(), 1, "{found:?}");
        found.remove(0)
    }

    #[test]
    fn a_ratio_is_read_from_the_closed_form_at_two_values() {
        let near = |r: Result<f64, &str>, want: f64| r.is_ok_and(|r| (r - want).abs() < 1e-12);
        assert!(near(
            ratio("0.25 * x + 0.05", "x", 1.0, |_| None, false),
            0.25
        ));
        assert!(near(
            ratio("0.25 * x + 0.05", "x", 1.0, |_| None, true),
            0.3
        ));
        assert_eq!(
            ratio("x * k", "x", 0.5, |n| (n == "k").then_some(2.0), false),
            Ok(4.0)
        );
        assert_eq!(
            ratio("x * k", "x", 1.0, |_| None, false),
            Err("var_unstated")
        );
        assert_eq!(
            ratio("lag(x, 1)", "x", 1.0, |_| None, false),
            Err("not_closed_form")
        );
        let m = one(&doc("200000 * x", 1.0, Some(200000.0), Some("m")), false);
        assert_eq!((m.ratio, m.outcome), (Some(200000.0), Outcome::Exaggerated));
    }

    #[test]
    fn an_undeclared_ratio_is_refused_and_a_declared_one_passes() {
        let m = one(&doc("200000 * x", 1.0, None, Some("m")), false);
        assert_eq!((m.outcome, m.expected()), (Outcome::Undeclared, vec![1.0]));
        assert_eq!(
            one(&doc("0.25 * x", 0.25, None, Some("m")), false).outcome,
            Outcome::Shown
        );
        assert_eq!(
            one(&doc("x", 0.25, None, Some("m")), false).outcome,
            Outcome::Undeclared
        );
        assert_eq!(
            one(&doc("0.25 * x + 0.05", 0.25, None, Some("m")), false).outcome,
            Outcome::Shown
        );
        assert_eq!(
            one(&doc("0.25 * x + 0.05", 0.25, None, Some("m")), true).outcome,
            Outcome::Undeclared
        );
        // A unit converts: an output in mm drawn at 0.25 m per m is 0.00025 per mm.
        assert_eq!(
            one(&doc("0.00025 * x", 0.25, None, Some("mm")), false).outcome,
            Outcome::Shown
        );
    }

    #[test]
    fn the_match_is_within_one_millionth_relative() {
        assert_eq!(declared(0.25 * (1.0 + 0.9e-6), 0.25, None), Outcome::Shown);
        assert_eq!(
            declared(0.25 * (1.0 + 1.1e-6), 0.25, None),
            Outcome::Undeclared
        );
        assert_eq!(
            declared(200000.0 * (1.0 - 0.9e-6), 1.0, Some(200000.0)),
            Outcome::Exaggerated
        );
    }

    #[test]
    fn a_value_with_no_unit_is_unchecked_and_another_quantity_is_outside() {
        let m = one(&doc("200000 * x", 1.0, None, None), false);
        assert_eq!(
            (m.outcome, m.to_json()["checked"].clone()),
            (Outcome::Unchecked("no_unit"), json!(false))
        );
        assert_eq!(m.mapping, "drivers/move");
        assert!(mappings(&doc("x", 1.0, None, Some("s")), false).is_empty());
        assert_eq!(
            one(&doc("x", 1.0, None, Some("furlong")), false).outcome,
            Outcome::Unchecked("unit_unknown")
        );
    }
}
