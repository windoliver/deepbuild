use super::*;

/// A constraint kind the design gives a module other than motion (#225: `follow_stream`, the
/// data module's) in a build that left that module out is refused with `module_missing` at
/// `constraints/<id>/kind`, naming the module.
pub(super) fn check_constraints(doc: &Value, sealed: &Sealed, issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "constraints").and_then(Value::as_object) else {
        return;
    };
    for (key, entry) in entries {
        let Some(kind) = entry.get("kind").and_then(Value::as_str) else {
            continue;
        };
        let Some(module) = registry::core_lists::constraint_owner(kind) else {
            continue;
        };
        if sealed.lacks(module) {
            issues.push(Issue::error(
                "module_missing",
                key,
                format!("constraints/{key}/kind"),
                json!(kind),
                &format!(
                    "constraint kind `{kind}` is the {module} module's, which this build lacks"
                ),
            ));
        }
    }
}

/// Every control carries a role, so a screen reader can say what it is (Rules every primitive
/// follows: Accessible; Control: `role`, an ARIA role). A control without one is refused, naming
/// the control and the field; the section and its keys are [`check_id_maps`]'s.
/// A control `kind` is an entry of the input module's `control@1` (#308), so a build whose set
/// holds the input module and that left it out refuses one with `module_missing`, naming it.
pub(super) fn check_controls(doc: &Value, sealed: &Sealed, issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "controls").and_then(Value::as_object) else {
        return;
    };
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("controls/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        if let Some(kind) = fields.get("kind").and_then(Value::as_str) {
            if sealed.lacks("input") {
                issues.push(Issue::error(
                    "module_missing",
                    key,
                    format!("controls/{key}/kind"),
                    json!(kind),
                    &format!("control kind `{kind}` is the input module's, which this build lacks"),
                ));
            }
        }
        let what = match fields.get("role") {
            None => "required, and absent",
            Some(Value::String(role)) if !role.is_empty() => continue,
            Some(Value::String(_)) => "required, and empty",
            Some(_) => "not a string",
        };
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("controls/{key}/role"),
            fields.get("role").cloned().unwrap_or(Value::Null),
            what,
        ));
    }
}

/// A figure's card (Overlay: a figure's card is a fixed overlay set, #504): its fields, each text
/// line a template whose slots resolve, so every number the card shows is a value the document
/// computes, and its legend a list of `{tone, label, role}`.
pub(super) fn check_card(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(card) = member(doc, "card") else {
        return;
    };
    let Some(fields) = card.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "card".into(),
            card.clone(),
            "not an object",
        ));
        return;
    };
    for (field, v) in fields {
        let path = format!("card/{field}");
        if field == "legend" {
            let ok = v.as_array().is_some_and(|l| {
                l.iter().all(|e| {
                    e.as_object().is_some_and(|e| {
                        e.keys()
                            .all(|k| ["tone", "label", "role"].contains(&k.as_str()))
                    })
                })
            });
            if !ok {
                issues.push(Issue::envelope(
                    "out_of_range",
                    path,
                    v.clone(),
                    "not a list of {tone, label, role}",
                ));
            }
            continue;
        }
        if !crate::template::CARD_LINES.contains(&field.as_str()) {
            issues.push(Issue::envelope(
                "unknown_field",
                path,
                v.clone(),
                "not a field of a card",
            ));
            continue;
        }
        let Some(text) = v.as_str() else {
            issues.push(Issue::envelope(
                "out_of_range",
                path,
                v.clone(),
                "not a string",
            ));
            continue;
        };
        match crate::template::parts(text) {
            Err(_) => issues.push(Issue::envelope(
                "out_of_range",
                path,
                v.clone(),
                "a brace that opens no slot or closes none",
            )),
            Ok(parts) => {
                for part in parts {
                    if let crate::template::Part::Slot(slot) = part {
                        if crate::template::value(doc, slot).is_none() {
                            let what = "the slot's path names no value this build shows";
                            issues.push(Issue::envelope(
                                "ref_unresolved",
                                path.clone(),
                                json!(slot),
                                what,
                            ));
                        }
                    }
                }
            }
        }
    }
}

/// The deepest chain of assemblies (Assembly: it can never nest more than 4 deep).
pub(super) const ASSEMBLY_DEPTH: usize = 4;

/// Each assembly (Assembly, #504): its fields, its one parent another assembly with no cycle and
/// no chain deeper than four, a slide or a turn with an axis, a pivot and an ordered range, its
/// apart offset and its place in the take-apart. A `repeat` or a motion along a path isn't in
/// this build, so both are refused, named.
pub(super) fn check_assemblies(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "assemblies").and_then(Value::as_object) else {
        return;
    };
    let items = member(doc, "items").and_then(Value::as_object);
    let parent_of = |id: &str| {
        entries
            .get(id)
            .and_then(|a| member(a, "parent"))
            .and_then(Value::as_str)
    };
    let vec3 = |v: &Value| {
        v.as_array()
            .is_some_and(|a| a.len() == 3 && a.iter().all(Value::is_number))
    };
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            let path = format!("assemblies/{key}");
            issues.push(Issue::error(
                "out_of_range",
                key,
                path,
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        if items.is_some_and(|i| i.contains_key(key)) {
            let what = "an item of the document has the same ID";
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("assemblies/{key}"),
                entry.clone(),
                what,
            ));
        }
        let mut bad = |code, field: &str, actual: Value, what: &str| {
            let path = format!("assemblies/{key}/{field}");
            issues.push(Issue::error(code, key, path, actual, what));
        };
        for field in fields.keys() {
            match field.as_str() {
                "parent" | "at" | "motion" | "value" | "apart" | "order" | "shown_at" => {}
                "repeat" => bad(
                    "out_of_range",
                    field,
                    fields[field].clone(),
                    "not in this build",
                ),
                _ => bad(
                    "unknown_field",
                    field,
                    fields[field].clone(),
                    "not a field of an assembly",
                ),
            }
        }
        match fields.get("parent") {
            None | Some(Value::Null) => {}
            Some(Value::String(p)) if entries.contains_key(p) => {
                // Up the chain from this assembly: back to it is a cycle, past four is too deep.
                let (mut at, mut depth) = (p.as_str(), 1);
                loop {
                    if at == key {
                        bad(
                            "cycle",
                            "parent",
                            json!(p),
                            "the parents lead back to the assembly",
                        );
                        break;
                    }
                    depth += 1;
                    if depth > ASSEMBLY_DEPTH {
                        bad("out_of_range", "parent", json!(p), "nests more than 4 deep");
                        break;
                    }
                    match parent_of(at) {
                        Some(next) if entries.contains_key(next) => at = next,
                        _ => break,
                    }
                }
            }
            Some(Value::String(p)) => bad(
                "ref_unresolved",
                "parent",
                json!(p),
                "names no assembly of the document",
            ),
            Some(other) => bad(
                "out_of_range",
                "parent",
                other.clone(),
                "not one assembly ID or null",
            ),
        }
        if fields.get("at").is_some_and(|a| !a.is_object()) {
            bad(
                "out_of_range",
                "at",
                fields["at"].clone(),
                "not a transform",
            );
        }
        if fields.get("value").is_some_and(|v| !v.is_number()) {
            bad(
                "out_of_range",
                "value",
                fields["value"].clone(),
                "not a number",
            );
        }
        if fields.get("apart").is_some_and(|v| !vec3(v)) {
            bad(
                "out_of_range",
                "apart",
                fields["apart"].clone(),
                "not three numbers, in m",
            );
        }
        if fields
            .get("order")
            .is_some_and(|v| !v.as_u64().is_some_and(|n| n <= u64::from(u16::MAX)))
        {
            bad(
                "out_of_range",
                "order",
                fields["order"].clone(),
                "not a u16",
            );
        }
        let Some(motion) = fields.get("motion") else {
            continue;
        };
        let Some(m) = motion.as_object() else {
            bad("out_of_range", "motion", motion.clone(), "not an object");
            continue;
        };
        for field in m.keys() {
            if !["kind", "axis", "pivot", "range", "path"].contains(&field.as_str()) {
                bad(
                    "unknown_field",
                    &format!("motion/{field}"),
                    m[field].clone(),
                    "not a field of a motion",
                );
            }
        }
        match m.get("kind").and_then(Value::as_str) {
            Some("slide" | "turn") => {}
            Some("path") => bad(
                "out_of_range",
                "motion/kind",
                json!("path"),
                "not in this build",
            ),
            _ => bad(
                "out_of_range",
                "motion/kind",
                m.get("kind").cloned().unwrap_or(Value::Null),
                "one of slide or turn",
            ),
        }
        let axis = m.get("axis");
        let zero = axis
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().all(|x| x.as_f64() == Some(0.0)));
        if !axis.is_some_and(vec3) || zero {
            bad(
                "out_of_range",
                "motion/axis",
                axis.cloned().unwrap_or(Value::Null),
                "three numbers, not all zero",
            );
        }
        if m.get("pivot").is_some_and(|p| !vec3(p)) {
            bad(
                "out_of_range",
                "motion/pivot",
                m["pivot"].clone(),
                "not three numbers, in m",
            );
        }
        if let Some(range) = m.get("range") {
            let ends = range
                .as_array()
                .filter(|r| r.len() == 2)
                .and_then(|r| Some((r[0].as_f64()?, r[1].as_f64()?)));
            if !ends.is_some_and(|(lo, hi)| lo <= hi) {
                bad(
                    "out_of_range",
                    "motion/range",
                    range.clone(),
                    "not [min, max] with min ≤ max",
                );
            }
        }
    }
}

/// Each time remap (Time remap): its target a recipe instance the check expanded, a placement or
/// the document, and its map `reverse`, a preset or a channel of keys, whose fields the motion
/// module reads. A reverse over anything but a placement runs over the document's span.
pub(super) fn check_time_remaps(doc: &Value, expansions: &[Expansion], issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "time_remaps").and_then(Value::as_object) else {
        return;
    };
    let span = member(doc, "transport").and_then(|t| member(t, "span"));
    let placements = member(doc, "placements").and_then(Value::as_object);
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("time_remaps/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        let mut bad = |code, field: &str, what: &str| {
            let actual = fields.get(field).cloned().unwrap_or(Value::Null);
            let path = format!("time_remaps/{key}/{field}");
            issues.push(Issue::error(code, key, path, actual, what));
        };
        for field in fields.keys() {
            if !["target", "map", "clamp"].contains(&field.as_str()) {
                bad("unknown_field", field, "not a field of a time remap");
            }
        }
        let target = fields.get("target").and_then(Value::as_str);
        let placed = target.is_some_and(|t| placements.is_some_and(|p| p.contains_key(t)));
        let known =
            target.is_some_and(|t| t == "document" || expansions.iter().any(|e| e.instance == t));
        if !known && !placed {
            bad(
                "ref_unresolved",
                "target",
                "names no recipe instance or placement of the document",
            );
        }
        let map = fields.get("map");
        if !map.is_some_and(|m| m.as_str() == Some("reverse") || m.is_object()) {
            bad(
                "out_of_range",
                "map",
                "a time remap's map is `reverse`, a preset or a channel of keys",
            );
        }
        let reverses = map.and_then(Value::as_str) == Some("reverse");
        if reverses && !placed && span.is_none_or(|s| s == "auto" || s == "open") {
            bad(
                "out_of_range",
                "map",
                "a reverse map runs over the document's span, which it doesn't give",
            );
        }
    }
}

/// The entries of `channels` or `bound_values`; the section and its keys are [`check_id_maps`]'s.
pub(super) fn check_targets(
    doc: &Value,
    section: &str,
    with_source: bool,
    kinds: &crate::kinds::Registry,
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
) {
    let Some(entries) = member(doc, section).and_then(Value::as_object) else {
        return;
    };
    // A channel has the fields of Channel and key, whose values the motion module reads; a bound
    // value has the fields of Bound value; nothing else.
    let allowed: &[&str] = if with_source {
        BOUND_VALUE_FIELDS
    } else {
        CHANNEL_FIELDS
    };
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("{section}/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        for (field, value) in fields {
            if !allowed.contains(&field.as_str()) {
                issues.push(Issue::error(
                    "unknown_field",
                    key,
                    format!("{section}/{key}/{field}"),
                    value.clone(),
                    &format!("not a field of a {section} entry"),
                ));
            }
        }
        let target_path = format!("{section}/{key}/target");
        match member(entry, "target") {
            // #504: a take-apart's target: the share of each target assembly's `apart` its
            // follow's stagger writes (Assembly: "timed by the follow's stagger").
            Some(Value::String(text))
                if text == "assemblies/apart"
                    && entry.pointer("/follow/stagger/targets").is_some() => {}
            Some(Value::String(text)) => match Path::parse(text) {
                Ok(path) => {
                    if let Err(what) = resolve(doc, &path, kinds) {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            key,
                            target_path,
                            json!(text),
                            &what,
                        ));
                    } else if moves_a_dither(doc, &path) {
                        // Paint: dither fill: it can never vary with time or frame.
                        issues.push(Issue::error(
                            "out_of_range",
                            key,
                            target_path,
                            json!(text),
                            "a dither fill never varies with time, so nothing drives it",
                        ));
                    } else if let Some((module, missing)) =
                        left_out_param(doc, &path, kinds, sealed)
                    {
                        // A channel or bound value drives the param, so the document uses the
                        // feature its evaluator reads, as a written value would.
                        issues.push(Issue::error(
                            "module_missing",
                            key,
                            target_path,
                            json!(text),
                            &lacks(&path.fields()[1], module, &missing),
                        ));
                    }
                }
                Err(r) => {
                    let code = if r.code == "bad_id" {
                        "bad_id"
                    } else {
                        "bad_path"
                    };
                    issues.push(Issue::error(code, key, target_path, json!(text), &r.what));
                }
            },
            other => issues.push(Issue::error(
                "out_of_range",
                key,
                target_path,
                other.cloned().unwrap_or(Value::Null),
                "not a path",
            )),
        }
        if let Some(stale_after) = member(entry, "stale_after") {
            if let Err(what) = duration(doc, stale_after) {
                issues.push(Issue::error(
                    "bad_time",
                    key,
                    format!("{section}/{key}/stale_after"),
                    stale_after.clone(),
                    &what,
                ));
            }
        }
        if with_source {
            let source_path = format!("{section}/{key}/source");
            let refused = match member(entry, "source") {
                Some(Value::String(text)) => Handle::parse_source(text)
                    .err()
                    .map(|r| Issue::error("bad_handle", key, source_path, json!(text), &r.what)),
                other => Some(Issue::error(
                    "out_of_range",
                    key,
                    source_path,
                    other.cloned().unwrap_or(Value::Null),
                    "not a handle",
                )),
            };
            if let Some(mut issue) = refused {
                // The source is what the number on screen rests on, so its issue also names the
                // item, or the mark set's row, the value fills (picking's `<id>#<key>`).
                if let Some(path) = member(entry, "target")
                    .and_then(Value::as_str)
                    .and_then(|t| Path::parse(t).ok())
                    .filter(|p| p.section() == Section::Items)
                {
                    issue.ids.push(match path.sub() {
                        Some(sub) => format!("{}#{sub}", path.id().as_str()),
                        None => path.id().as_str().to_string(),
                    });
                }
                issues.push(issue);
            }
        }
    }
}

/// A channel's fields (Channel and key).
pub(super) const CHANNEL_FIELDS: &[&str] = &[
    "target",
    "type",
    "space",
    "mode",
    "keys",
    "extrapolate",
    "modifiers",
    "range",
    "morph",
    // Follow: a `mode: follow` channel's source, model, outputs and stagger.
    "follow",
    "exaggerate", // #1183: a measured length mapped at another ratio than its `shown_at`.
];
