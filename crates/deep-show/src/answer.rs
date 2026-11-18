use super::*;

pub(super) fn answer(command: &str, startup: &Startup, line: &str) -> Value {
    let Some((input, mut scenario)) = read_line(line) else {
        return bad_input();
    };
    if scenario.planted.is_none() {
        scenario.planted = startup.run_planted;
    }
    // #2085: a scenario under effects' planted check runs on a set sealed with that check.
    let resealed;
    let startup = if scenario.planted == Some(Planted::TrustsWriteIndex)
        && startup.run_planted != scenario.planted
    {
        let planted = Some(StartPlanted::Run(Planted::TrustsWriteIndex));
        match seal(planted, startup.sealed.costs.clone()) {
            Ok(s) => {
                resealed = Startup {
                    cache: startup.cache.clone(),
                    ..s
                };
                &resealed
            }
            Err(_) => return bad_input(),
        }
    } else {
        startup
    };
    match command {
        "run" => {
            let replies = jobs::around(&scenario, startup, |background| {
                let mut hub = hub::Hub::new(&scenario, startup);
                hub.background = background;
                hub.run_calls()
            });
            json!({"ok": true, "replies": replies})
        }
        "screen" => {
            let (Some(out), Some(_)) = (input.get("out").and_then(Value::as_str), scenario.window)
            else {
                return bad_input();
            };
            // The time the window shows (a time or flicks, 0 by default) and its scale (#1162).
            let t = match input.get("t") {
                None => 0,
                Some(Value::String(text)) => match hub::flicks(text) {
                    Some(t) => t,
                    None => return bad_input(),
                },
                Some(v) => match v.as_i64() {
                    Some(t) => t,
                    None => return bad_input(),
                },
            };
            let scale = input.get("scale").and_then(Value::as_f64).unwrap_or(1.0);
            if !(1.0..=4.0).contains(&scale) {
                return bad_input();
            }
            screen(&scenario, startup, out, t, scale)
        }
        _ => bad_input(),
    }
}
