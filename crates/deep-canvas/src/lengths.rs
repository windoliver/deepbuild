//! #1183, drawn larger than real (Honest numbers: "Lengths follow the same rule"). An assembly
//! records the scale it is drawn at, `shown_at` (drawn ÷ real, 1 unset); a driver or a channel
//! that maps a measured length at another ratio declares `exaggerate {factor, disclose}`, the
//! factor and the overlay that discloses it; and that overlay's template shows `{factor}` and
//! `{shown_at}` from the document, never typed. The motion module reads each mapping's ratio
//! (`deep_canvas_motion::lengths`); this holds the fields the core, the text and that check share.

use serde_json::Value;

use crate::document::{kind_text, member, Issue};

/// The sections whose entries may declare an exaggeration.
pub const MAPPERS: [&str; 2] = ["drivers", "channels"];

/// The slots a disclosure's template fills from its exaggeration.
pub const SLOTS: [&str; 2] = ["factor", "shown_at"];

/// An entry's declared exaggeration, when well formed: its factor and the overlay that discloses it.
pub fn exaggerate(entry: &Value) -> Option<(f64, &str)> {
    let e = member(entry, "exaggerate")?;
    let factor = member(e, "factor")?
        .as_f64()
        .filter(|f| f.is_finite() && *f > 0.0 && *f != 1.0)?;
    Some((factor, member(e, "disclose")?.as_str()?))
}

/// The item or assembly a write target moves: `items/<id>/…` or `assemblies/<id>/…`.
pub fn moved(target: &str) -> Option<&str> {
    let rest = target
        .strip_prefix("items/")
        .or_else(|| target.strip_prefix("assemblies/"))?;
    rest.split(['/', '#']).next().filter(|id| !id.is_empty())
}

/// The scale `id` (an item or an assembly) is drawn at: the nearest assembly up its parents that
/// declares `shown_at`, with that ratio; else the first assembly it is in, at 1.
pub fn shown_at(doc: &Value, id: &str) -> (Option<String>, f64) {
    let (items, assemblies) = (member(doc, "items"), member(doc, "assemblies"));
    let (mut at, mut first) = (id.to_string(), None);
    // An item's parents and an assembly's nest only so deep (the core refuses cycles).
    for _ in 0..64 {
        let assembly = assemblies.and_then(|a| member(a, &at));
        if let Some(a) = assembly {
            if let Some(r) = member(a, "shown_at").and_then(Value::as_f64) {
                return (Some(at), r);
            }
            first.get_or_insert_with(|| at.clone());
        }
        let entry = assembly.or_else(|| items.and_then(|i| member(i, &at)));
        match entry
            .and_then(|e| member(e, "parent"))
            .and_then(Value::as_str)
        {
            Some(p) => at = p.to_string(),
            None => break,
        }
    }
    (first, 1.0)
}

/// Each exaggeration's entry with the overlay it names, in section and ID order.
fn exaggerations(doc: &Value) -> impl Iterator<Item = (&Value, f64, &str)> {
    MAPPERS
        .into_iter()
        .filter_map(|s| member(doc, s).and_then(Value::as_object))
        .flat_map(|m| m.values())
        .filter_map(|e| exaggerate(e).map(|(f, d)| (e, f, d)))
}

/// Every overlay an exaggeration names as its disclosure.
pub fn disclosures(doc: &Value) -> impl Iterator<Item = &str> {
    exaggerations(doc).map(|(_, _, d)| d)
}

/// What a disclosure's bare slot shows: `factor`, the factor of each exaggeration `overlay`
/// discloses, or `shown_at`, the scale the parts they move are drawn at. `None` when it
/// discloses none, the name is neither, or they disagree.
pub fn slot(doc: &Value, overlay: &str, name: &str) -> Option<f64> {
    let mut found = None;
    for (entry, factor, _) in exaggerations(doc).filter(|(_, _, d)| *d == overlay) {
        let v = match name {
            "factor" => factor,
            "shown_at" => shown_at(doc, moved(member(entry, "target")?.as_str()?)?).1,
            _ => return None,
        };
        if found.is_some_and(|f| f != v) {
            return None;
        }
        found = Some(v);
    }
    found
}

/// The fields' shapes: an assembly's `shown_at` a number above 0; an `exaggerate` only a factor
/// above 0 and not 1, and the overlay that discloses it, an item of an overlay kind.
pub(crate) fn check(doc: &Value, issues: &mut Vec<Issue>) {
    for (id, a) in member(doc, "assemblies")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if let Some(r) =
            member(a, "shown_at").filter(|r| !r.as_f64().is_some_and(|r| r.is_finite() && r > 0.0))
        {
            let path = format!("assemblies/{id}/shown_at");
            issues.push(Issue::error(
                "out_of_range",
                id,
                path,
                r.clone(),
                "drawn ÷ real: a number above 0",
            ));
        }
    }
    let items = member(doc, "items");
    for section in MAPPERS {
        for (id, entry) in member(doc, section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(e) = member(entry, "exaggerate") else {
                continue;
            };
            let path = |f: &str| format!("{section}/{id}/exaggerate{f}");
            let Some(fields) = e.as_object() else {
                issues.push(Issue::error(
                    "out_of_range",
                    id,
                    path(""),
                    e.clone(),
                    "not {factor, disclose}",
                ));
                continue;
            };
            for (f, v) in fields
                .iter()
                .filter(|(f, _)| !["factor", "disclose"].contains(&f.as_str()))
            {
                issues.push(Issue::error(
                    "unknown_field",
                    id,
                    path(&format!("/{f}")),
                    v.clone(),
                    "not a field of an exaggeration",
                ));
            }
            let factor = fields.get("factor").cloned().unwrap_or(Value::Null);
            if !factor
                .as_f64()
                .is_some_and(|f| f.is_finite() && f > 0.0 && f != 1.0)
            {
                issues.push(Issue::error(
                    "out_of_range",
                    id,
                    path("/factor"),
                    factor,
                    "a number above 0 and not 1",
                ));
            }
            let disclose = fields.get("disclose").cloned().unwrap_or(Value::Null);
            let overlay = disclose
                .as_str()
                .and_then(|d| items.and_then(|i| member(i, d)));
            if !overlay
                .and_then(kind_text)
                .is_some_and(|k| k.starts_with("overlay."))
            {
                issues.push(Issue::error(
                    "ref_unresolved",
                    id,
                    path("/disclose"),
                    disclose,
                    "names no overlay of the document",
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn doc() -> Value {
        json!({
            "assemblies": {"popup": {"shown_at": 0.25}, "inner": {"parent": "popup"}, "plain": {}},
            "items": {
                "dot": {"kind": "mark.sphere@1", "parent": "holder"},
                "holder": {"kind": "group@1", "parent": "inner"},
                "free": {"kind": "mark.sphere@1", "parent": "plain"},
                "note": {"kind": "overlay.text@1", "params": {"template": "drawn {factor}× larger than real"}}
            },
            "drivers": {"swing": {"target": "items/dot/at/pos/0", "expr": "x", "exaggerate": {"factor": 200000, "disclose": "note"}}}
        })
    }

    #[test]
    fn a_part_is_drawn_at_the_nearest_declared_scale_up_its_parents() {
        let d = doc();
        assert_eq!(shown_at(&d, "dot"), (Some("popup".into()), 0.25));
        assert_eq!(shown_at(&d, "inner"), (Some("popup".into()), 0.25));
        assert_eq!(shown_at(&d, "free"), (Some("plain".into()), 1.0));
        assert_eq!(shown_at(&d, "note"), (None, 1.0));
    }

    #[test]
    fn a_disclosure_reads_its_factor_and_scale_from_the_document() {
        let d = doc();
        assert_eq!(slot(&d, "note", "factor"), Some(200000.0));
        assert_eq!(slot(&d, "note", "shown_at"), Some(0.25));
        assert_eq!(slot(&d, "dot", "factor"), None);
        assert_eq!(slot(&d, "note", "ratio"), None);
    }

    #[test]
    fn a_bad_scale_or_exaggeration_is_refused_naming_its_field() {
        let mut d = doc();
        d["assemblies"]["popup"]["shown_at"] = json!(0);
        d["drivers"]["swing"]["exaggerate"] = json!({"factor": 1, "disclose": "dot", "why": "x"});
        let mut issues = Vec::new();
        check(&d, &mut issues);
        let found: Vec<(&str, &str)> = issues.iter().map(|i| (i.code, i.path.as_str())).collect();
        assert_eq!(
            found,
            [
                ("out_of_range", "assemblies/popup/shown_at"),
                ("unknown_field", "drivers/swing/exaggerate/why"),
                ("out_of_range", "drivers/swing/exaggerate/factor"),
                ("ref_unresolved", "drivers/swing/exaggerate/disclose"),
            ]
        );
        let mut issues = Vec::new();
        check(&doc(), &mut issues);
        assert!(issues.is_empty(), "{issues:?}");
    }
}
