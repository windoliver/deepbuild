use super::*;

/// The params resolved: each one the item gives, the schema's default for the rest.
pub fn resolved(spec: &Spec, params: &Value, geometry: bool, planted: Option<&str>) -> Value {
    let mut out = Map::new();
    for ((path, class), q) in dirty(spec, planted).into_iter().zip(&spec.params) {
        if (class == G) != geometry {
            continue;
        }
        let v = params
            .get(&path["params/".len()..])
            .cloned()
            .unwrap_or_else(|| q.default.clone());
        let v = match q.name {
            "overlays" => crate::tints::resolved(v),
            _ => v,
        };
        out.insert(q.name.to_string(), v);
    }
    Value::Object(out)
}

/// The `kinds` call's row of a spec.
pub fn row(spec: &Spec, planted: Option<&str>) -> Value {
    let params: Map<String, Value> = spec
        .params
        .iter()
        .map(|q| {
            let mut v = json!({"type": q.ty, "unit": q.unit, "default": q.default,
                               "live": q.ty == "m" || q.ty == "deg" || q.ty == "f32",
                               "cost": if q.class == G { "rebuild" } else { "transform" }});
            if let (Some(min), Some(max)) = (q.min, q.max) {
                v["min"] = json!(min);
                v["max"] = json!(max);
            }
            (q.name.to_string(), v)
        })
        .collect();
    let dirty: Map<String, Value> = dirty(spec, planted)
        .into_iter()
        .map(|(k, c)| (k, json!(c)))
        .collect();
    let sweep: Map<String, Value> = spec
        .params
        .iter()
        .map(|q| (format!("params/{}", q.name), json!([q.sweep.0, q.sweep.1])))
        .collect();
    let mut items = Map::new();
    items.insert(
        "cam".into(),
        json!({"kind": "camera@1", "params": {"projection": "perspective", "position": [6, 5, 8], "target": [0, 0.5, 0], "fov": 40}}),
    );
    if let Some(fx) = spec.fixture.as_object() {
        items.extend(fx.clone());
    }
    for (k, (id, v)) in items.iter_mut().enumerate() {
        v["id"] = json!(id);
        v["name"] = json!(id);
        v["order"] = json!(format!("a{k:03}"));
    }
    let modules = if spec.module == "building" {
        json!({"scene3d": "^1", "building": "^1"})
    } else {
        json!({"scene3d": "^1"})
    };
    let document = json!({
        "format": 1, "profile": "scene", "title": format!("The {} fixture", spec.kind),
        "description": format!("One {} for the sweep of its paths.", spec.kind),
        "size": [480, 360], "camera": "cam", "requires": {"modules": modules}, "items": items,
    });
    let mut out = json!({"kind": spec.kind, "module": spec.module, "params": params, "dirty": dirty,
                         "fixture": {"document": document, "item": "it"}, "sweep": sweep});
    if let Some(reads) = spec.reads {
        out["reads"] = json!(reads);
    }
    out
}
