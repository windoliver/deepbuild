use super::*;

pub(super) fn blending_of(
    p: &Map<String, Value>,
    ctx: &Ctx,
    path: &str,
) -> Result<Blending, Refused> {
    let blend = match p.get("blend").and_then(Value::as_str) {
        None | Some("replace") => Blend::Replace,
        Some("add") => Blend::Add,
        Some("multiply") => Blend::Multiply,
        Some("mix") => Blend::Mix,
        Some(_) => return refuse("bad_doc", format!("{path}/blend")),
    };
    let ipath = format!("{path}/influence");
    let influence = match p.get("influence") {
        None => Influence::Value(1.0),
        Some(Value::Number(n)) => Influence::Value(n.as_f64().unwrap_or(1.0)),
        Some(Value::String(s)) => match s
            .strip_prefix("controls/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            Some(control) => Influence::Control(control.to_string()),
            None => return refuse("bad_path", ipath),
        },
        Some(Value::Object(c)) => {
            let Some(Value::Object(keys)) = c.get("keys") else {
                return refuse("bad_doc", ipath);
            };
            let mut list = Vec::new();
            for (id, key) in keys {
                let kpath = format!("{ipath}/keys/{id}");
                let t = time_of(key.get("t"), ctx, &format!("{kpath}/t"))?;
                let value = number(key.get("value"), &format!("{kpath}/value"))?;
                list.push(Key::new(
                    id,
                    t,
                    vec![value],
                    interp_of(key.get("interp"), &format!("{kpath}/interp"))?,
                ));
            }
            Influence::Keys(Curve::new(list))
        }
        Some(_) => return refuse("bad_doc", ipath),
    };
    let add_from = match p.get("add_from") {
        None => AddFrom::First,
        Some(Value::String(s)) if s == "first" => AddFrom::First,
        Some(Value::String(s)) if s == "bind" => AddFrom::Bind,
        Some(Value::Object(o)) if o.contains_key("t") => {
            AddFrom::At(time_of(o.get("t"), ctx, &format!("{path}/add_from/t"))?)
        }
        Some(_) => return refuse("bad_doc", format!("{path}/add_from")),
    };
    let fade = |key: &str| match p.get(key) {
        None => Ok(0),
        v => time_of(v, ctx, &format!("{path}/{key}")),
    };
    let switch = match p.get("switch") {
        None => None,
        Some(Value::Object(s)) => Some(switch_of(s, ctx, &format!("{path}/switch"))?),
        Some(_) => return refuse("bad_doc", format!("{path}/switch")),
    };
    Ok(Blending {
        blend,
        influence,
        add_from,
        fade_in: fade("fade_in")?,
        fade_out: fade("fade_out")?,
        switch,
    })
}
