use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn expand_one(
    items: &mut Map<String, Value>,
    id: &str,
    item: Value,
    (pack, recipe): (&Pack, &Recipe),
    resolved: &Resolved<'_>,
    chain: &[String],
    planted: Planted,
    order: &mut u64,
    issues: &mut Vec<Issue>,
) -> Option<Expansion> {
    let at = |field: &str| format!("items/{id}/{field}");
    let layer = member(&item, "layer").cloned().unwrap_or(Value::Null);
    // A derived item sits in the instance's layer at its order, and its position is from the
    // instance's origin.
    let order_key = member(&item, "order").cloned().unwrap_or(Value::Null);
    let origin: Option<Vec<f64>> = member(&item, "at")
        .and_then(|a| member(a, "pos"))
        .and_then(Value::as_array)
        .map(|p| p.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect());
    // The inputs: each param checked against its input, defaults filled.
    let mut inputs: Map<String, Value> = Map::new();
    let params = match member(&item, "params") {
        None => Map::new(),
        Some(Value::Object(p)) => p.clone(),
        Some(other) => {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at("params"),
                other.clone(),
                "not an object",
            ));
            return None;
        }
    };
    // The instance's own stroke slot beside its inputs: each part it builds draws it (#173).
    let stroke = params
        .get("paint")
        .filter(|_| !recipe.inputs.contains_key("paint"))
        .filter(|p| {
            p.as_object()
                .is_some_and(|o| o.keys().all(|k| k == "stroke"))
        })
        .and_then(|p| p.get("stroke"))
        .cloned();
    let mut ok = true;
    for (name, value) in &params {
        if name == "paint" && stroke.is_some() {
            continue;
        }
        let Some(input) = recipe.inputs.get(name) else {
            if let Some(fix) = recipe.refuses.get(name) {
                issues.push(refused::refusal(id, &recipe.id, name, value, fix));
                ok = false;
                continue;
            }
            issues.push(Issue::error(
                "unknown_field",
                id,
                at(&format!("params/{name}")),
                value.clone(),
                &format!("not an input of {}", recipe.id),
            ));
            ok = false;
            continue;
        };
        if let Some(what) = input_fault(input, value) {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at(&format!("params/{name}")),
                value.clone(),
                &format!("{what}: {}'s input `{name}`", recipe.id),
            ));
            ok = false;
        }
    }
    for (name, input) in &recipe.inputs {
        let value = params
            .get(name)
            .cloned()
            .unwrap_or_else(|| input.default.clone());
        if value.is_null() {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at(&format!("params/{name}")),
                Value::Null,
                "required, and absent",
            ));
            ok = false;
        }
        inputs.insert(name.clone(), value);
    }
    if let Some(walk) = planted.walk_inputs {
        // Planted (#202): the inputs walked in another order than the recipe's.
        inputs = walk(inputs);
    }
    // Broken-out items this version no longer derives (#1961): each stays the writer's own.
    let mut orphaned = Vec::new();
    // The planted loaders' orphans (#1961): dropped, or handed to the new expansion.
    let mut handed = Vec::new();
    let broken_out: Vec<String> = match member(&item, "broken_out") {
        None => Vec::new(),
        Some(Value::Array(list)) => {
            let mut out = Vec::new();
            for (i, v) in list.iter().enumerate() {
                match v.as_str() {
                    // Broken out under an earlier version that derived it: the writer holds it,
                    // it stays listed so a later version that derives it again never writes it.
                    Some(s)
                        if !derives(recipe, id, s)
                            && items.contains_key(s)
                            && s.strip_prefix(id).is_some_and(|r| r.starts_with('.')) =>
                    {
                        if planted.orphan_drops {
                            items.shift_remove(s);
                        } else if planted.orphan_hands_id {
                            handed.push(s.to_string());
                        } else {
                            out.push(s.to_string());
                            orphaned.push((i, s.to_string()));
                        }
                    }
                    Some(s) if derives(recipe, id, s) => {
                        // Broken out, so the writer holds it: a list entry with no item behind
                        // it would make the recipe's output vanish.
                        if items.contains_key(s) {
                            out.push(s.to_string());
                        } else {
                            issues.push(Issue::error(
                                "ref_unresolved",
                                id,
                                at(&format!("broken_out/{i}")),
                                v.clone(),
                                "broken out, but no item of the document holds it",
                            ));
                            ok = false;
                        }
                    }
                    _ => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("broken_out/{i}")),
                            v.clone(),
                            "not a derived ID of this instance",
                        ));
                        ok = false;
                    }
                }
            }
            out.sort();
            out
        }
        Some(other) => {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at("broken_out"),
                other.clone(),
                "not a list",
            ));
            ok = false;
            Vec::new()
        }
    };
    if !ok {
        return None;
    }
    // Its rules are the core's `kind_rules` check's, once per instance after expansion (#202).
    if let Some(fields) = items.get_mut(id).and_then(Value::as_object_mut) {
        fields.insert("params".into(), Value::Object(inputs.clone()));
    }
    let mut key = Hasher::v1("recipe.key");
    key.text(&pack.id.text())
        .text(&format!("{}@{}.{}", recipe.id, recipe.major, recipe.minor))
        .bytes(&canonical(&Value::Object(inputs.clone())))
        .bytes(&canonical(&json!(broken_out)));
    if let Some(s) = &stroke {
        key.bytes(&canonical(s));
    }
    let key = key.finish().hex();
    // The instance's own ID first, so a film recipe's shots, transitions and cue list can name
    // the items it derives (#142); an input of that name shadows it.
    let [fw, fh] = resolved.frame;
    let scope = [
        ("instance", json!(id)),
        ("fw", json!(fw)),
        ("fh", json!(fh)),
    ];
    let mut env: Vec<(String, Value)> = (scope.into_iter().map(|(k, v)| (k.to_string(), v)))
        .chain(inputs.iter().map(|(k, v)| (k.clone(), v.clone())))
        .chain(inputs::named(recipe, &inputs, items))
        .collect();
    for (name, expr) in &recipe.lets {
        match expr.eval(&env) {
            Ok(v) => env.push((name.clone(), v)),
            Err(what) => {
                issues.push(Issue::error(
                    "out_of_range",
                    id,
                    at(&format!("params/{name}")),
                    expr.source().clone(),
                    &format!("let `{name}`: {what}"),
                ));
                return None;
            }
        }
    }
    let mut derived = Vec::new();
    let mut placed = Vec::new();
    let mut derived_items = Map::new();
    // Each step's derived IDs, which the recipe's channels target, and the channels.
    let mut ids_of: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut channels = Map::new();
    // A film recipe's entries of the document's maps (shots, markers, strips, transitions), by
    // map, then ID (#142).
    let mut sections = Map::new();
    // One scope for every derived item: the inputs and lets, then each item's own names.
    let base = env.len();
    let mut scope = env;
    for step in recipe.steps.iter().filter(|s| s.op != "cue") {
        // A repeat along a curve: its points, and its count from the spacing when it has one.
        let curve = match &step.along {
            None => None,
            Some((path, _)) => {
                let named = match path.source() {
                    Value::String(n) => inputs.get(n).cloned().unwrap_or(Value::Null),
                    v => v.clone(),
                };
                match curve_points(items, &named) {
                    Some(points) => Some(points),
                    None => {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            id,
                            at(&format!("steps/{}/repeat/along", step.id)),
                            named,
                            "names no curve@1 item with two or more points, nor two or more points",
                        ));
                        return None;
                    }
                }
            }
        };
        let spaced = match (&step.along, &curve) {
            (Some((_, Some(spacing))), Some(points)) => {
                let gap = spacing.eval(&scope[..base]).ok().and_then(|v| v.as_f64());
                match gap.filter(|g| *g > 0.0) {
                    Some(g) => Some((((polyline_length(points) / g).floor() + 1.0).min(1e9), g)),
                    None => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/repeat/spacing", step.id)),
                            spacing.source().clone(),
                            "a repeat's spacing is a length above zero",
                        ));
                        return None;
                    }
                }
            }
            _ => None,
        };
        // A repeat over a builder's part: its elements, counted from the built item at check.
        let elements = match &step.each {
            None => None,
            Some(each) => {
                let held = inputs.get(&each.input).cloned().unwrap_or(Value::Null);
                let path = at(&format!("steps/{}/repeat/each", step.id));
                let builder = held
                    .as_str()
                    .and_then(|b| items.get(b).map(|item| (b, item)));
                let hook = builder
                    .and_then(|(_, item)| super::super::kind_text(item))
                    .and_then(|k| k.rsplit_once('@'))
                    .and_then(|(full, _)| resolved.elements.get(full));
                let (Some((b, item)), Some(hook)) = (builder, hook) else {
                    issues.push(Issue::error(
                        "ref_unresolved",
                        id,
                        path,
                        held,
                        &format!(
                            "step `{}` repeats over `{}`, which holds no builder item of the document",
                            step.id, each.input
                        ),
                    ));
                    return None;
                };
                let doc = json!({ "items": Value::Object(items.clone()) });
                let plant = planted
                    .each_per_triangle
                    .then_some("each_face_per_triangle");
                match hook(&doc, b, item, &each.part, &each.domain, plant) {
                    Ok(list) if list.len() as u64 <= MAX_REPEAT => Some(list),
                    Ok(list) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            path,
                            json!(list.len()),
                            &format!(
                                "step `{}` repeats over at most {MAX_REPEAT} elements",
                                step.id
                            ),
                        ));
                        return None;
                    }
                    Err(why) => {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            id,
                            path,
                            json!(format!("{b}#{}", each.part)),
                            &format!(
                                "step `{}` repeats over the {}s of `{b}#{}`: {why}",
                                step.id, each.domain, each.part
                            ),
                        ));
                        return None;
                    }
                }
            }
        };
        // A repeat over a list (#142): its elements, fixed by the inputs and lets.
        let listed = match &step.over {
            None => None,
            Some(list) => match list.eval(&scope[..base]) {
                Ok(Value::Array(a)) if a.len() as u64 <= MAX_REPEAT => Some(a),
                Ok(other) => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/repeat/over", step.id)),
                        other,
                        &format!("a repeat runs over a list of at most {MAX_REPEAT} elements"),
                    ));
                    return None;
                }
                Err(what) => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/repeat/over", step.id)),
                        list.source().clone(),
                        &what,
                    ));
                    return None;
                }
            },
        };
        let count: Option<u64> = match &step.repeat {
            None => None,
            Some(_) if listed.is_some() => listed.as_ref().map(|e| e.len() as u64),
            Some(_) if elements.is_some() => elements.as_ref().map(|e| e.len() as u64),
            Some(_) if spaced.is_some() => match spaced {
                Some((n, _)) if n <= MAX_REPEAT as f64 => Some(n as u64),
                _ => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/repeat", step.id)),
                        json!(spaced.map(|s| s.0)),
                        &format!("a repeat count is a whole number from 0 to {MAX_REPEAT}"),
                    ));
                    return None;
                }
            },
            Some((count, _)) => match count.eval(&scope[..base]) {
                Ok(v) => match v.as_f64() {
                    Some(n) if n.fract() == 0.0 && (0.0..=MAX_REPEAT as f64).contains(&n) => {
                        Some(n as u64)
                    }
                    _ => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/repeat", step.id)),
                            v,
                            &format!("a repeat count is a whole number from 0 to {MAX_REPEAT}"),
                        ));
                        return None;
                    }
                },
                Err(what) => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/repeat", step.id)),
                        count.source().clone(),
                        &what,
                    ));
                    return None;
                }
            },
        };
        // A condition false at check leaves the step out: it derives nothing. Over a list, it is
        // read once per element instead.
        if let Some(when) = step.when.as_ref().filter(|_| listed.is_none()) {
            match when.eval(&scope[..base]) {
                Ok(v) if !truthy(&v) => continue,
                Ok(_) => {}
                Err(what) => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/when", step.id)),
                        when.source().clone(),
                        &what,
                    ));
                    return None;
                }
            }
        }
        let n = count.unwrap_or(1);
        for index in 0..n {
            let derived_id = match count {
                None => format!("{id}.{}", step.id),
                Some(_) => format!("{id}.{}.{index}", step.id),
            };
            if let Some(why) = crate::grammar::id_fault(&derived_id) {
                issues.push(Issue::error(
                    "bad_id",
                    id,
                    format!("items/{derived_id}"),
                    json!(derived_id),
                    &format!("`{derived_id}`: {why}"),
                ));
                return None;
            }
            let seed = if planted.seed_by_order {
                *order += 1;
                *order
            } else if planted.each_by_count && elements.is_some() {
                seed_of(id, &step.id, Some(index)) ^ n.wrapping_mul(0x9e37_79b9_7f4a_7c15)
            } else {
                seed_of(id, &step.id, count.map(|_| index))
            };
            derived.push(Derived {
                id: derived_id.clone(),
                seed,
            });
            if broken_out.contains(&derived_id) && !planted.overwrite_broken_out {
                continue;
            }
            scope.truncate(base);
            if let Some((_, as_)) = &step.repeat {
                // Over elements, the name reads the element: `e.i`, `e.center` and the rest.
                let value = match (&elements, &listed) {
                    (Some(list), _) | (None, Some(list)) => list[index as usize].clone(),
                    (None, None) => json!(index),
                };
                scope.push((as_.clone(), value));
                if listed.is_some() {
                    scope.push(("i".into(), json!(index)));
                }
            }
            // Over a list, the condition reads the element: false leaves that element out.
            if let (Some(when), Some(_)) = (&step.when, &listed) {
                match when.eval(&scope) {
                    Ok(v) if !truthy(&v) => {
                        derived.retain(|d| d.id != derived_id);
                        continue;
                    }
                    Ok(_) => {}
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/when", step.id)),
                            when.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            scope.push(("seed".into(), json!(seed)));
            for (name, expr) in &step.lets {
                match expr.eval(&scope) {
                    Ok(v) => scope.push((name.clone(), v)),
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/let/{name}", step.id)),
                            expr.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            let mut params = Map::new();
            for (k, v) in &step.params {
                match v.eval(&scope) {
                    Ok(v) => {
                        params.insert(k.clone(), v);
                    }
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/params/{k}", step.id)),
                            v.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            // A film recipe's shot, marker, strip or transition: an entry of that map, its params
            // its fields, at the derived ID.
            if let Some(section) = section_of(&step.op) {
                let held = sections
                    .entry(section.to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                if let Some(map) = held.as_object_mut() {
                    map.insert(derived_id.clone(), Value::Object(params));
                }
                // An entry, not a derived item.
                derived.retain(|d| d.id != derived_id);
                continue;
            }
            // #233: an item the document holds, placed by relation or parent: no derived item.
            if step.op == "place" {
                let (target, item) = place::apply(items, id, &step.id, &params, issues)?;
                derived_items.insert(target.clone(), item);
                placed.push(target);
                derived.retain(|d| d.id != derived_id);
                continue;
            }
            if items.contains_key(&derived_id) && !broken_out.contains(&derived_id) {
                issues.push(Issue::error(
                    "bad_id",
                    id,
                    format!("items/{derived_id}"),
                    json!(derived_id),
                    &format!(
                        "the document holds an item at the ID `{}` expands to",
                        recipe.id
                    ),
                ));
                return None;
            }
            let mut fields = Map::new();
            fields.insert("id".into(), json!(derived_id));
            fields.insert("kind".into(), json!(step.kind));
            fields.insert("layer".into(), layer.clone());
            fields.insert("name".into(), json!(derived_id));
            fields.insert("order".into(), order_key.clone());
            // A derived item hides, picks and hangs as its instance does, and wears the
            // material it names (#433).
            for key in ["visible", "pickable", "parent", "adjust", "material"] {
                if let Some(v) = member(&item, key) {
                    fields.insert(key.into(), v.clone());
                }
            }
            let mut params = params;
            if let Some(s) = &stroke {
                if let Some(p) = params
                    .entry("paint")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                {
                    p.insert("stroke".into(), s.clone());
                }
            }
            fields.insert("params".into(), Value::Object(params));
            // Its own parent and adjustments over the instance's (#142).
            for (key, t) in [("parent", &step.parent), ("adjust", &step.adjust)] {
                let Some(t) = t else { continue };
                match t.eval(&scope) {
                    Ok(v) => {
                        fields.insert(key.into(), v);
                    }
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/{key}", step.id)),
                            t.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            if let Some(m) = &step.material {
                fields.insert("material".into(), m.clone());
            }
            // Without an `at` of its own, an item stands at the instance's origin.
            if let (None, None, Some(o)) = (&step.at, &curve, &origin) {
                let pos: Vec<Value> = o.iter().map(|v| number(*v)).collect();
                fields.insert("at".into(), json!({ "pos": pos }));
            }
            if let Some(at) = &step.at {
                match at.eval(&scope) {
                    Ok(mut v) => {
                        if let (Some(origin), Some(pos)) = (
                            &origin,
                            v.as_object_mut()
                                .and_then(|a| a.get_mut("pos"))
                                .and_then(Value::as_array_mut),
                        ) {
                            for (p, o) in pos.iter_mut().zip(origin) {
                                if let Some(n) = p.as_f64() {
                                    *p = number(n + o);
                                }
                            }
                        }
                        fields.insert("at".into(), v);
                    }
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at_path(id, &step.id),
                            at.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            // Along a curve: the copy stands at its arc length, turned to the curve's direction.
            if let Some(points) = &curve {
                let length = polyline_length(points);
                let s = match spaced {
                    Some((_, gap)) => gap * index as f64,
                    None if n > 1 => length * index as f64 / (n - 1) as f64,
                    None => 0.0,
                };
                let (p, yaw) = along_at(points, s);
                let at = fields
                    .entry("at")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .map(std::mem::take)
                    .unwrap_or_default();
                let three = |key: &str, base: [f64; 3]| -> [f64; 3] {
                    let mut out = base;
                    if let Some(list) = at.get(key).and_then(Value::as_array) {
                        for (o, v) in out.iter_mut().zip(list) {
                            *o += v.as_f64().unwrap_or(0.0);
                        }
                    }
                    out
                };
                // Without an `at` of its own, the copy starts at the instance's origin.
                let origin3 = if step.at.is_some() {
                    [0.0; 3]
                } else {
                    let o = origin.clone().unwrap_or_default();
                    [0, 1, 2].map(|k| o.get(k).copied().unwrap_or(0.0))
                };
                let pos = three(
                    "pos",
                    [p[0] + origin3[0], p[1] + origin3[1], p[2] + origin3[2]],
                );
                let rot = three("rot", [0.0, yaw, 0.0]);
                let mut placed = at.clone();
                placed.insert("pos".into(), json!(pos.map(number)));
                placed.insert("rot".into(), json!(rot.map(number)));
                fields.insert("at".into(), Value::Object(placed));
            }
            // A recipe step nests: its item is an instance of the recipe it names, expanded here
            // with its own derived items under its ID, at most MAX_DEPTH recipes down.
            if step.op == "recipe" {
                let Some((child_pack, child)) = resolved.recipe(&step.kind) else {
                    issues.push(Issue::error(
                        "ref_unresolved",
                        id,
                        at(&format!("steps/{}/kind", step.id)),
                        json!(step.kind),
                        "names no recipe of a pack the document names",
                    ));
                    return None;
                };
                if chain.contains(&child.id) {
                    issues.push(Issue::error(
                        "cycle",
                        id,
                        at(&format!("steps/{}/kind", step.id)),
                        json!(chain.iter().chain([&child.id]).collect::<Vec<_>>()),
                        &format!("recipe `{}` nests itself", child.id),
                    ));
                    return None;
                }
                if chain.len() >= MAX_DEPTH {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/kind", step.id)),
                        json!(chain.len() + 1),
                        &format!("recipes nest at most {MAX_DEPTH} deep"),
                    ));
                    return None;
                }
                let nested = Value::Object(fields);
                // The document's items, which the nested recipe's curves and IDs are read from.
                let mut scratch = items.clone();
                scratch.insert(derived_id.clone(), nested.clone());
                let mut deeper = chain.to_vec();
                deeper.push(child.id.clone());
                let inner = expand_one(
                    &mut scratch,
                    &derived_id,
                    nested,
                    (child_pack, child),
                    resolved,
                    &deeper,
                    planted,
                    order,
                    issues,
                )?;
                let instance = scratch.remove(&derived_id).unwrap_or(Value::Null);
                derived_items.insert(derived_id.clone(), instance);
                for (k, v) in inner.derived {
                    if items.contains_key(&k) {
                        issues.push(Issue::error(
                            "bad_id",
                            id,
                            format!("items/{k}"),
                            json!(k),
                            &format!(
                                "the document holds an item at the ID `{}` expands to",
                                recipe.id
                            ),
                        ));
                        return None;
                    }
                    derived_items.insert(k, v);
                }
                derived.extend(inner.items);
                channels.extend(inner.channels);
                for (section, entries) in inner.sections {
                    let held = sections
                        .entry(section)
                        .or_insert_with(|| Value::Object(Map::new()));
                    if let (Some(map), Value::Object(entries)) = (held.as_object_mut(), entries) {
                        map.extend(entries);
                    }
                }
                ids_of.entry(step.id.clone()).or_default().push(derived_id);
                continue;
            }
            ids_of
                .entry(step.id.clone())
                .or_default()
                .push(derived_id.clone());
            // The step's own channels, each on this item's field.
            for (name, c) in &step.channels {
                let field = member(c, "target")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let mut out = c.clone();
                out["target"] = json!(format!("items/{derived_id}/{field}"));
                channels.insert(format!("{derived_id}.{name}"), out);
            }
            derived_items.insert(derived_id, Value::Object(fields));
        }
    }
    // The recipe's channels, one per item of the step each targets.
    for (name, c) in &recipe.channels {
        let target = member(c, "target")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some((step, rest)) = target.strip_prefix("step:").and_then(|t| t.split_once('/'))
        else {
            continue;
        };
        let targets = ids_of.get(step).cloned().unwrap_or_default();
        let many = targets.len() > 1;
        for (k, derived_id) in targets.iter().enumerate() {
            let mut out = c.clone();
            out["target"] = json!(format!("items/{derived_id}/{rest}"));
            let cid = if many {
                format!("{id}.{name}.{k}")
            } else {
                format!("{id}.{name}")
            };
            channels.insert(cid, out);
        }
    }
    // Planted (#1961): each orphaned ID goes to the new derived item at its index, in the
    // writer's item's place.
    for orphan in handed {
        let index = orphan.rsplit_once('.').map_or("", |(_, i)| i);
        let heir = derived_items
            .iter()
            .find(|(d, _)| d.rsplit_once('.').is_some_and(|(_, i)| i == index))
            .map(|(_, fields)| fields.clone());
        if let Some(mut fields) = heir {
            fields["id"] = json!(orphan);
            fields["name"] = json!(orphan);
            derived_items.insert(orphan, fields);
        }
    }
    // Written only once the whole expansion went through: a refused instance writes nothing.
    for (derived_id, fields) in &derived_items {
        items.insert(derived_id.clone(), fields.clone());
    }
    Some(Expansion {
        instance: id.to_string(),
        kind: super::super::kind_text(&item)
            .unwrap_or_default()
            .to_string(),
        pack: pack.id.text(),
        key,
        items: derived,
        derived: derived_items,
        broken_out,
        orphaned,
        channels,
        sections,
        placed,
    })
}
