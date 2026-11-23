//! Waiting, seeing and asserting (#124): `wait_for`, `expect`, `see` and `menus`, and the text snapshot they read.

use super::*;

impl Replica {
    // ---- Waiting, seeing and asserting.

    pub(super) fn wait_for(&mut self, call: &Value) -> Result<Value, Fail> {
        let wait = &call["wait_for"];
        let timeout_ms = Self::timeout(call);
        let deadline = self.clock.t + timeout_ms * FLICKS / 1000;
        if let Some(t) = wait["t"].as_u64() {
            // With step_ms the virtual clock runs a frame each step_ms, the last shorter, so hours take thousands of
            // frames, not a frame each 60th (#2028).
            let step = match &wait["step_ms"] {
                Value::Null => None,
                ms => match ms.as_u64() {
                    Some(ms) if ms > 0 && self.clock.real.is_none() && self.motion.is_none() => Some(ms * FLICKS / 1000),
                    Some(ms) if ms > 0 => return Err(fail("refused", "step_ms runs the virtual clock, and this replica's clock is real or recording motion")),
                    _ => return Err(fail("refused", format!("step_ms is a whole number of ms above 0, not {ms}"))),
                },
            };
            while self.clock.t < t {
                if self.clock.t >= deadline {
                    return Err(fail(
                        "timeout",
                        format!("t {t} is past the {timeout_ms} ms timeout"),
                    )
                    .with("timeout_ms", json!(timeout_ms)));
                }
                self.tick_by(step.map(|step| step.min(t - self.clock.t)));
            }
            return Ok(if step.is_some() {
                json!({"step_ms": wait["step_ms"]})
            } else {
                json!({})
            });
        }
        let state = wait["state"].as_str().map(str::to_owned);
        let event = wait["event"].as_str().map(str::to_owned);
        let locator = call["locator"].clone();
        let mut previous: Option<Vec<Target>> = None;
        loop {
            let frame = self.frame();
            let done = match (state.as_deref(), &event) {
                (_, Some(kind)) => self.events.iter().any(|e| e["kind"] == kind.as_str()),
                (Some("settled"), _) => {
                    let now = frame.elements.clone();
                    let still = previous.as_ref() == Some(&now);
                    previous = Some(now);
                    still
                }
                (Some(state @ ("visible" | "hidden" | "enabled" | "text" | "value")), _) => {
                    let found = frame.all(&locator).map_err(|why| fail("refused", why))?;
                    match state {
                        "hidden" => found.is_empty(),
                        _ if found.len() > 1 => return Err(ambiguous(&locator, found)),
                        "visible" => found.len() == 1,
                        "enabled" => found.first().is_some_and(|t| t.enabled),
                        "text" => found.first().is_some_and(|t| Some(text_of(&frame, t)) == wait["value"].as_str().map(str::to_owned)),
                        _ => found.first().is_some_and(|t| Some(value_of(&frame, t)) == wait["value"].as_str().map(str::to_owned)),
                    }
                }
                (other, None) => {
                    return Err(fail(
                        "refused",
                        format!("wait_for takes a state (visible, hidden, enabled, text, value, settled), an event or a t, not {other:?}"),
                    ))
                }
            };
            if done {
                return Ok(json!({}));
            }
            if self.clock.t >= deadline {
                return Err(fail(
                    "timeout",
                    format!("{wait} didn't come within {timeout_ms} ms"),
                )
                .with("timeout_ms", json!(timeout_ms)));
            }
            self.tick();
        }
    }

    pub(super) fn expect(&mut self, call: &Value, index: usize) -> Result<Value, Fail> {
        let expect = &call["expect"];
        let name = expect["name"]
            .as_str()
            .map_or_else(|| format!("step {index}"), str::to_owned);
        let assert = expect["assert"].as_str().unwrap_or_default().to_owned();
        let locator = &call["locator"];
        let expected = match assert.as_str() {
            "visible" => json!(true),
            "count" => expect["count"].clone(),
            "state" => expect["state"].clone(),
            "text" | "value" => expect["value"].clone(),
            other => {
                return Err(fail(
                    "refused",
                    format!("expect asserts visible, text, value, count or state, not {other:?}"),
                ))
            }
        };
        let timeout_ms = Self::timeout(call);
        let deadline = self.clock.t + timeout_ms * FLICKS / 1000;
        // An assertion waits for what it expects, up to the timeout, as an action waits for its target.
        let (passed, actual) = loop {
            let frame = self.frame();
            let found = frame.all(locator).map_err(|why| fail("refused", why))?;
            let actual = match (assert.as_str(), found.as_slice()) {
                ("count", _) => json!(found.len()),
                (_, []) => json!("nothing matches"),
                (_, [target]) => match assert.as_str() {
                    "visible" => json!(target.visible),
                    "text" => json!(text_of(&frame, target)),
                    "value" => json!(value_of(&frame, target)),
                    _ => json!(state_of(target, expected.as_str().unwrap_or_default())),
                },
                (_, many) => json!(format!("{} matches", many.len())),
            };
            let passed = actual == expected;
            if passed || self.clock.t >= deadline {
                break (passed, actual);
            }
            self.tick();
        };
        self.assertions += 1;
        if !passed {
            let message = format!("expected {expected}, got {actual}");
            self.failures.push(json!({
                "test": name, "message": message, "cause": name, "frames": [], "covers": [],
                "case": format!("{name}: {message}"),
            }));
        }
        Ok(
            json!({"assertion": {"name": name, "assert": assert, "passed": passed, "expected": expected, "actual": actual}}),
        )
    }

    /// The text snapshot, in #338's one shape (#1459): roles, names, values, ids and bounds of every element with a
    /// role, the strings drawn that no element already names, and the canvas items with their values.
    pub(super) fn tree(&mut self) -> (Value, Frame) {
        match &self.dirty {
            Some(dirty) => dirty.drawn(),
            None => self.live_tree(),
        }
    }

    /// The snapshot of what the window holds now.
    pub(super) fn live_tree(&mut self) -> (Value, Frame) {
        let glyphs = self.glyphs.clone();
        let frame = self
            .cx
            .update_window(self.window, |_, window, _| Frame::read(window, &glyphs))
            .expect("the replica's window is open");
        let mut snapshot = self
            .cx
            .update_window(self.window, |_, window, _| from_observed(window))
            .expect("the replica's window is open");
        for run in frame.runs.iter().filter(|r| r.visible) {
            add_text(&mut snapshot.tree, run.text.clone(), run.bounds);
        }
        let mut json = snapshot.to_json();
        // The status item's menu under the count (#1462): a line per session, as the real app's status item lists them.
        json["menu_bar"]["items"] = json!(deep_app::record::with_view(|view| {
            deep_app::states::menu(&view.table(), deep_app::views::now())
        })
        .unwrap_or_default());
        // #1458: each string drawn with its size and face, and where each shipped view was laid out.
        json["runs"] = frame
            .runs
            .iter()
            .filter(|r| r.visible)
            .map(|r| json!({"text": r.text, "bounds": r.bounds, "size": r.size, "face": r.face, "cut": r.cut, "weight": r.weight}))
            .collect();
        let scale = frame.scale;
        let device = |v: gpui_kit::Pixels| (f32::from(v) * scale).round() as i64;
        json["views"] = deep_app::views::drawn_views()
            .into_iter()
            .map(|(name, b)| {
                let bounds = [b.origin.x, b.origin.y, b.size.width, b.size.height].map(device);
                json!({"name": name, "bounds": bounds})
            })
            .collect();
        // #1592: each icon the frame drew, named as in the kit's set, with its bounds and the size it was laid out at in
        // points. The brand's artwork and the status marks are SVGs too, and no icons.
        json["icons"] = frame
            .svgs
            .iter()
            .filter(|svg| svg.visible)
            .filter_map(|svg| {
                let icon = match deep_app::icons::drawing(&svg.path) {
                    Some(deep_app::icons::Drawing::Icon(name, _)) => name.to_owned(),
                    Some(_) => return None,
                    None => (svg.path.strip_prefix("icons/"))
                        .and_then(|file| file.strip_suffix(".svg"))
                        .unwrap_or(&svg.path)
                        .to_owned(),
                };
                let size = svg.size[0].max(svg.size[1]) as f32 / scale;
                Some(json!({"icon": icon, "bounds": svg.bounds, "size": size}))
            })
            .collect();
        (json, frame)
    }

    /// `menus` (#1462): the menu bar the app set, as it sets it on the real app, in order, separators left out, each
    /// item with its key as the macOS menu bar draws it, in the table's form.
    pub(super) fn menus(&mut self) -> Value {
        fn items(list: &[OwnedMenuItem], cx: &App) -> Vec<Value> {
            list.iter()
                .filter_map(|item| match item {
                    OwnedMenuItem::Separator => None,
                    OwnedMenuItem::Submenu(menu) => Some(json!({
                        "name": menu.name.to_string(), "key": null, "enabled": !menu.disabled,
                        "items": items(&menu.items, cx),
                    })),
                    OwnedMenuItem::SystemMenu(menu) => {
                        Some(json!({"name": menu.name.to_string(), "key": null, "enabled": true}))
                    }
                    OwnedMenuItem::Action {
                        name,
                        action,
                        disabled,
                        ..
                    } => Some(json!({
                        "name": name, "key": deep_app::actions::menu_key(action.as_ref(), cx),
                        "enabled": !disabled,
                    })),
                })
                .collect()
        }
        let menus: Vec<Value> = self.cx.update(|cx| {
            cx.get_menus()
                .unwrap_or_default()
                .iter()
                .map(|menu| json!({"name": menu.name.to_string(), "items": items(&menu.items, cx)}))
                .collect()
        });
        json!({"menus": menus})
    }

    /// The menu bar as `see` gives it (#1461): each menu's title and its items', in order, separators left out.
    fn see_menus(&mut self) -> Vec<Value> {
        self.cx.update(|cx| {
            cx.get_menus()
                .unwrap_or_default()
                .iter()
                .map(|menu| {
                    let items: Vec<Value> = menu
                        .items
                        .iter()
                        .filter_map(|item| match item {
                            OwnedMenuItem::Action { name, disabled, .. } => {
                                Some(json!({"title": name, "enabled": !disabled}))
                            }
                            OwnedMenuItem::Submenu(sub) => Some(
                                json!({"title": sub.name.to_string(), "enabled": !sub.disabled}),
                            ),
                            _ => None,
                        })
                        .collect();
                    json!({"title": menu.name.to_string(), "items": items})
                })
                .collect()
        })
    }

    pub(super) fn see(&mut self, call: &Value) -> Result<Value, Fail> {
        let see = &call["see"];
        let include: Vec<&str> = match see["include"].as_array() {
            Some(list) => list.iter().filter_map(Value::as_str).collect(),
            None => vec!["roles", "names", "values", "bounds", "items"],
        };
        let (mut snapshot, frame) = self.tree();
        let scope = see["scope"].as_str().unwrap_or("window");
        let root = match scope {
            "window" => None,
            "panel" => Some(json!({
                "role": "pane", "name": null, "value": null, "id": null,
                "bounds": panel_bounds(frame.scale)?,
            })),
            "locator" => match frame.one(&call["locator"]) {
                Ok(t) => Some(json!({
                    "role": t.role, "name": t.name, "value": t.value,
                    "id": crate::snapshot::author_id(&t.path), "bounds": t.bounds,
                })),
                Err(Miss::Bad(why)) => return Err(fail("refused", why)),
                Err(Miss::None) => {
                    return Err(fail(
                        "locate.none",
                        format!("nothing matches {}", call["locator"]),
                    ))
                }
                Err(Miss::Ambiguous(all)) => return Err(ambiguous(&call["locator"], all)),
            },
            other => {
                return Err(fail(
                    "refused",
                    format!("see.scope is window, panel or locator, not {other:?}"),
                ))
            }
        };
        if let Some(mut root) = root {
            let bounds = bounds_of(&root["bounds"]);
            let mut inside = Vec::new();
            collect_inside(&snapshot["tree"], bounds, &mut inside);
            // The located node is the root: what it holds stays, under the root (#1460).
            let inside: Vec<Value> = inside
                .into_iter()
                .flat_map(|n| {
                    if n["role"] == root["role"]
                        && n["name"] == root["name"]
                        && n["bounds"] == root["bounds"]
                    {
                        n["children"].as_array().cloned().unwrap_or_default()
                    } else {
                        vec![n]
                    }
                })
                .collect();
            root["children"] = Value::Array(inside);
            snapshot["tree"] = root;
        }
        if !include.contains(&"items") {
            snapshot["items"] = json!([]);
        }
        keep(&mut snapshot["tree"], &include);
        let hash = sha256(snapshot.to_string().as_bytes());
        // The list's rows the window draws (#1463), in its order, and the record position they were built at: what
        // deep status --json holds at that log_pos.
        let (log_pos, rows) = deep_app::record::with_view(|view| {
            let rows: Vec<Value> = view
                .table()
                .list()
                .into_iter()
                .map(|row| {
                    let mut row = row.clone();
                    if let Some(fields) = row.as_object_mut() {
                        fields.remove("listed");
                        fields.remove("order");
                    }
                    row
                })
                .collect();
            (view.log_pos, rows)
        })
        .unwrap_or_default();
        // The address the window shows (#1460), beside the snapshot so stored snapshots keep their bytes.
        let address = self
            .cx
            .update(|cx| deep_app::open::current(cx).map(|address| address.to_string()));
        // What the app sent its hub since launch, which the replica's copy of the hub took (#1462), and the menu bar
        // as the app set it (#1461).
        let hub = self.hub_copy.calls();
        let menus = self.see_menus();
        Ok(
            json!({"snapshot": snapshot, "sha256": hash, "rows": rows, "log_pos": log_pos, "address": address, "hub": hub, "menus": menus,
                "notifications": {"setting": self.notifier.reach(false).setting.name()}}),
        )
    }
}

/// The word `state` names, if the target is in it; else the state it is in.
fn state_of(target: &Target, state: &str) -> String {
    let holds = match state {
        "enabled" => Some(target.enabled),
        "disabled" => Some(!target.enabled),
        "visible" => Some(target.visible),
        "hidden" => Some(!target.visible),
        "checked" => target.checked,
        "unchecked" => target.checked.map(|c| !c),
        _ => None,
    };
    match holds {
        Some(true) => state.to_owned(),
        Some(false) => match state {
            "enabled" => "disabled",
            "disabled" => "enabled",
            "visible" => "hidden",
            "hidden" => "visible",
            "checked" => "unchecked",
            _ => "checked",
        }
        .to_owned(),
        None => format!("unknown: a replica reads enabled, disabled, visible, hidden, checked and unchecked, not {state:?}"),
    }
}
