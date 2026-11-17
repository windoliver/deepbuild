use super::*;

pub(super) fn control_of(
    id: &str,
    c: &Value,
    extra: &[(&str, Behavior)],
) -> Result<Option<Control>, Refused> {
    let Some(kind) = c.get("kind").and_then(Value::as_str) else {
        return Ok(None);
    };
    // #542: a scroll control's steps are `scrolls`'; a text control takes no pointer here.
    if matches!(kind, "scroll" | "text") {
        return Ok(None);
    }
    let Some(behavior) = KINDS
        .iter()
        .chain(extra.iter())
        .find(|(n, _)| *n == kind)
        .map(|(_, b)| *b)
    else {
        return Err(refused("out_of_range", format!("controls/{id}/kind")));
    };
    let class = match c.get("class").and_then(Value::as_str) {
        Some("view") | Some("viewer") => Class::View,
        Some(_) => Class::Document,
        None if behavior == Behavior::Hover => Class::View,
        None => Class::Document,
    };
    let range = c.get("range").and_then(Value::as_array);
    let r = |k: usize, d: f64| {
        range
            .and_then(|a| a.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(d)
    };
    let top = if behavior == Behavior::Turn {
        360.0
    } else {
        1.0
    };
    let (min, max) = (r(0, 0.0), r(1, top));
    // A value is clamped into the range, which panics on a range that runs high to low.
    if min > max {
        return Err(refused("out_of_range", format!("controls/{id}/range")));
    }
    let options: Vec<String> = c
        .get("options")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|o| o.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let stages: Vec<(String, Vec<String>)> = c
        .get("stages")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(sid, s)| {
                    let keys = s
                        .get("keys")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter_map(|k| k.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    (sid.clone(), keys)
                })
                .collect()
        })
        .unwrap_or_default();
    let default = match c.get("default") {
        Some(d) => d.clone(),
        None => match behavior {
            Behavior::Number | Behavior::Turn | Behavior::Path | Behavior::Hover => json!(min),
            Behavior::Toggle => json!(false),
            Behavior::Stages => stages.first().map_or(Value::Null, |s| json!(s.0)),
            _ => Value::Null,
        },
    };
    let handle = match c.get("handle") {
        Some(h) => {
            let item = h
                .get("item")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let along = match h.get("along") {
                Some(Value::String(a)) => {
                    let travel = num(h.get("travel")).unwrap_or(100.0);
                    Along::Axis(if a == "y" { 1 } else { 0 }, travel)
                }
                Some(Value::Object(o)) => {
                    let points: Vec<[f64; 2]> = o
                        .get("polyline")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|p| pair(Some(p))).collect())
                        .unwrap_or_default();
                    if points.len() < 2 {
                        return Err(refused(
                            "out_of_range",
                            format!("controls/{id}/handle/along"),
                        ));
                    }
                    Along::Path(points)
                }
                _ => {
                    return Err(refused(
                        "out_of_range",
                        format!("controls/{id}/handle/along"),
                    ))
                }
            };
            Some((item, along))
        }
        None => None,
    };
    let targets = c
        .get("targets")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let smoothing = match c.get("smoothing") {
        Some(Value::Object(o)) => match o.get("follow") {
            Some(model) => {
                let mut f = Map::new();
                f.insert("source".into(), json!(format!("controls/{id}/value")));
                f.insert("model".into(), model.clone());
                let spec = deep_canvas_motion::doc::follow_spec(
                    &f,
                    &format!("controls/{id}/smoothing/follow"),
                )
                .map_err(|r| refused(r.code, r.path))?;
                Some(spec.model)
            }
            None => None,
        },
        _ => None,
    };
    Ok(Some(Control {
        id: id.into(),
        behavior,
        class,
        min,
        max,
        default,
        increment: num(c.get("increment")),
        options,
        stages,
        keys: c
            .get("keys")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        handle,
        targets,
        smoothing,
    }))
}
