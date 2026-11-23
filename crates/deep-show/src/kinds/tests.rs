use super::*;

/// #1973: every structured field of the full build declares forms the form language reads,
/// its line prints at least one, and its own default is one of them; so does every scene3d
/// spec param for its default, both its sweep values and its fixture's, which its reader
/// takes.
#[test]
fn every_structured_field_prints_forms_that_take_its_own_values() {
    let full = crate::BuildSet::Full;
    let sealed = crate::assemble(full, crate::modules(full))
        .seal()
        .expect("the shipped set seals");
    let mut bad = Vec::new();
    let mut held = |name: String, declared: &str, values: &[&Value]| match deep_canvas::form::parse(
        declared,
    ) {
        Err(u) => bad.push(format!("{name}: `{declared}` doesn't read: {}", u.why)),
        Ok(f) => {
            for v in values {
                if let Some(got) = f.miss(v) {
                    bad.push(format!("{name}: `{}` refuses {v}: got {got}", f.print()));
                }
            }
        }
    };
    for entry in sealed.kinds().entries() {
        for v in &entry.versions {
            for p in &v.params {
                if let Some(declared) = p.ty.form() {
                    let name = format!("{}@{}.{}", entry.full_name(), v.major, p.name);
                    held(name, declared, &[&p.default]);
                }
            }
        }
    }
    for spec in deep_canvas_scene3d::spec::all() {
        // The params its fixture's items of its kind set.
        let fixture: Vec<&Map<String, Value>> = spec
            .fixture
            .as_object()
            .into_iter()
            .flat_map(Map::values)
            .filter(|i| i["kind"] == spec.kind)
            .filter_map(|i| i["params"].as_object())
            .collect();
        for q in &spec.params {
            let name = format!("{}.{} (spec)", spec.kind, q.name);
            let mut values = vec![&q.default, &q.sweep.0, &q.sweep.1];
            values.extend(fixture.iter().filter_map(|p| p.get(q.name)));
            held(name, q.declared(), &values);
        }
    }
    for row in kind_rows(&sealed, None) {
        for f in row.entry["fields"].as_array().into_iter().flatten() {
            let printed = f["forms"].as_array().map_or(0, Vec::len);
            if f["type"] == "json" && printed == 0 {
                bad.push(format!(
                    "{}.{}: prints no form",
                    row.entry["name"], f["name"]
                ));
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// #182: deep_kinds lists the character body with its fields and defaults, through the physics
/// module's tool entries; the defaults are the issue's.
#[test]
fn lists_the_character_body_from_the_physics_module() {
    let full = crate::BuildSet::Full;
    let sealed = crate::assemble(full, crate::modules(full))
        .seal()
        .expect("the shipped set seals");
    let header = listing(&sealed, None, json!({"registries": []}), &[]).header;
    let mut physics = header["modules"].as_array().into_iter().flatten();
    let physics = physics
        .find(|m| m["name"] == "physics")
        .expect("physics is listed");
    let mut lists = physics["lists"].as_array().into_iter().flatten();
    let body = lists.find(|e| e["name"] == "body@1.character");
    let body = body.expect("physics lists body@1.character");
    let want = [
        ("slope_limit", "deg = 45"),
        ("step.height", "m = 0.3"),
        ("step.width", "m = the capsule's radius"),
        ("snap", "m = 0.2"),
        ("offset", "m = 0.01"),
        ("jump.height", "m = 1"),
    ];
    for (field, default) in want {
        let got = &body["fields"][format!("character.{field}")];
        assert_eq!(got, default, "character.{field} in {body}");
    }
}
