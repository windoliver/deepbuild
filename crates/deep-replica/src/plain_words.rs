//! Issue #1348: the `plain words` lane. Draws its fixture run in the app's shell, headless on the virtual clock: the
//! page (the sidebar's rows, Needs you and the line), one click on each row and what that click opens, the card one
//! click on the open ask opens, and every notification the notifier posts as the run's events arrive, the run's end
//! notice among them. Every string a person sees there is read from the drawn window's text snapshot or the
//! notification as posted, and judged against `contracts/plain-words.json`: a listed word or a stack trace on the
//! card, the page, a notification or the end notice fails it, one line per string, naming the string and the plain
//! word or the trace. What a row opens, a session's page, keeps the real names. With `DEEP_PLAIN_WORDS_DUMP=<file>`
//! it writes every string it read there, by surface, and the page's rows with each one's problem.
//!
//! `deep-plain-words`: exit 0 when nothing fails, 1 when a string does, 2 when the run can't be drawn.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(lane::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("BLOCKED plain words: the replica draws on macOS only");
        std::process::exit(2);
    }
}

#[cfg(target_os = "macos")]
mod lane {
    use deep_app::{
        events::{inbox, Fixture},
        notify::Notifier,
        plain,
        record::View,
        views::{self, AppState, Layout},
    };
    use deep_replica::{
        shell::open_shell,
        snapshot::{from_observed, Node, Snapshot},
    };
    use gpui_kit::{test::TestWindowExt as _, *};
    use serde_json::{json, Value};

    /// The surfaces that use only plain words.
    const PLAIN: [&str; 4] = ["card", "page", "notification", "end_notice"];

    struct Shown {
        surface: &'static str,
        text: String,
        row: Option<String>,
    }

    pub fn run() -> i32 {
        let path =
            deep_replica::repo_root().join("crates/deep-replica/fixtures/plain-words.events.jsonl");
        let fixture = match Fixture::load(&path) {
            Ok(fixture) => fixture,
            Err(why) => {
                eprintln!("BLOCKED plain words: the fixture run doesn't load: {why}");
                return 2;
            }
        };
        let events = fixture.events();
        let now = events
            .iter()
            .filter_map(|e| e["ts"].as_u64())
            .max()
            .unwrap_or(0)
            + 60_000;
        let mut shown = notifications(&events);

        let mut cx = deep_replica::headless_context();
        deep_app::record::install_local(events.clone());
        views::set_state(AppState {
            inbox: inbox(&fixture, fixture.last_log_pos()),
            now,
            sessions: fixture.sessions(),
            held: None,
        });
        let mut view = View::default();
        for event in &events {
            view.apply(event.clone());
        }
        let table = view.table().into_owned();
        let layout = Layout {
            sidebar: views::SIDEBAR.into(),
            center: vec![views::NEEDS_YOU.into(), views::SESSION.into()],
            active: 0,
            line: views::LINE.into(),
        };

        // The card: one click on its ask's row in Needs you.
        let (handle, _) = cx.update(|cx| open_shell(&layout, cx, |_, _| {}));
        let page = draw(&mut cx, handle);
        let ask = table.open_asks(None).first().map(|ask| {
            ask["data"]["question"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        });
        let Some(card) = ask.and_then(|question| clicked(&mut cx, handle, &page, &question)) else {
            eprintln!(
                "BLOCKED plain words: the fixture run's page shows no ask whose card a click opens"
            );
            return 2;
        };
        shown.extend(card.into_iter().map(|text| Shown {
            surface: "card",
            text,
            row: None,
        }));

        // The page, then one click on each row and what it opens.
        let (handle, _) = cx.update(|cx| open_shell(&layout, cx, |_, _| {}));
        let page = draw(&mut cx, handle);
        let sessions = table.sessions().to_vec();
        let rows = rows(&page, &table, &sessions, now);
        for node in page.flatten() {
            let Some(text) = node.name.clone().filter(|text| !text.trim().is_empty()) else {
                continue;
            };
            let row = rows.iter().find(|(_, top, bottom, x)| {
                node.bounds[1] >= *top
                    && node.bounds[1] < *bottom
                    && node.bounds[0] >= *x
                    && node.bounds[0] < SIDEBAR_PX
            });
            shown.push(Shown {
                surface: "page",
                text,
                row: row.map(|(session, ..)| session.clone()),
            });
        }
        for (session, ..) in &rows {
            let title = format!("{} · ", table.title(session));
            let fresh = cx.update(|cx| open_shell(&layout, cx, |_, _| {})).0;
            let before = draw(&mut cx, fresh);
            let Some(detail) = clicked(&mut cx, fresh, &before, &title) else {
                eprintln!("BLOCKED plain words: no row on the page starts {title:?}");
                return 2;
            };
            for text in detail {
                shown.push(Shown {
                    surface: "session_page",
                    text: text.clone(),
                    row: None,
                });
                shown.push(Shown {
                    surface: "detail",
                    text,
                    row: Some(session.clone()),
                });
            }
        }

        let failed = judge(&shown);
        if let Ok(file) = std::env::var("DEEP_PLAIN_WORDS_DUMP") {
            let dump = json!({
                "shown": shown.iter().map(|item| {
                    let mut entry = json!({"surface": item.surface, "text": item.text});
                    if let Some(row) = &item.row { entry["row"] = json!(row); }
                    entry
                }).collect::<Vec<_>>(),
                "rows": rows.iter().map(|(session, ..)| json!({
                    "id": session,
                    "problem": plain::problem(&table, session).map(|(happened, next)| json!({"happened": happened, "next": next})),
                })).collect::<Vec<_>>(),
            });
            if let Err(why) =
                std::fs::write(&file, serde_json::to_string_pretty(&dump).expect("JSON"))
            {
                eprintln!("BLOCKED plain words: the dump can't be written to {file}: {why}");
                return 2;
            }
        }
        let plain_count = shown
            .iter()
            .filter(|item| PLAIN.contains(&item.surface))
            .count();
        println!(
            "plain words: {} strings read, {plain_count} on plain surfaces, {failed} failing",
            shown.len()
        );
        i32::from(failed > 0)
    }

    /// The sidebar's right edge in device pixels: a node that starts left of it is the sidebar's.
    const SIDEBAR_PX: i64 = (views::SIDEBAR_WIDTH * deep_replica::SCALE) as i64;
    /// The line's top edge in device pixels: the last row ends there.
    const LINE_TOP: i64 =
        ((deep_replica::WINDOW.1 - views::LINE_HEIGHT) * deep_replica::SCALE) as i64;

    /// One line per failing string on a plain surface: a listed word with its plain word, or the trace it shows.
    fn judge(shown: &[Shown]) -> usize {
        let mut failed = 0;
        for item in shown.iter().filter(|item| PLAIN.contains(&item.surface)) {
            for (word, plain) in plain::listed(&item.text) {
                println!("FAIL plain words: the {} shows \"{}\": \"{word}\" is \"{plain}\" in plain words", item.surface, item.text);
                failed += 1;
            }
            for line in plain::trace(&item.text) {
                println!("FAIL plain words: the {} shows a stack trace: \"{}\" belongs one click away, on the page it opens", item.surface, line.trim());
                failed += 1;
            }
        }
        failed
    }

    /// The fixture run's notifications as the notifier posts them while its events arrive, each event at its time:
    /// each one's title and its body, as Notification Center shows them. The run's end notice is the one posted for
    /// the run's ask.
    fn notifications(events: &[Value]) -> Vec<Shown> {
        let mut notifier = Notifier::new(deep_replica::NOTIFY_AFTER);
        let mut view = View::default();
        notifier.start(&view, Vec::new());
        let mut posted = Vec::new();
        for event in events {
            let at = event["ts"].as_u64().unwrap_or(0);
            view.apply(event.clone());
            notifier.saw(event, at);
            posted.extend(notifier.due(&view, at, None, false));
        }
        let last = events
            .iter()
            .filter_map(|e| e["ts"].as_u64())
            .max()
            .unwrap_or(0);
        posted.extend(notifier.due(&view, last + 2_000, None, false));
        let runs: Vec<String> = view
            .table()
            .ended_runs()
            .into_iter()
            .map(|(ask, _)| ask)
            .collect();
        let mut shown = Vec::new();
        for notification in posted {
            let surface = if notification.ask.is_none() && runs.contains(&notification.session) {
                "end_notice"
            } else {
                "notification"
            };
            let body = notification
                .text
                .split_once('\n')
                .map_or("", |(_, body)| body)
                .to_owned();
            for text in [notification.title, body] {
                shown.push(Shown {
                    surface,
                    text,
                    row: None,
                });
            }
        }
        shown
    }

    /// The window drawn, as its text snapshot.
    fn draw(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> Snapshot {
        cx.update_window(handle, |_, window, cx| {
            deep_app::canvas::clear_items();
            window.render_frame(cx);
            window.render_frame(cx);
            from_observed(window)
        })
        .expect("the window draws")
    }

    /// Each session's row on the page: its session, the top and bottom of what it draws, and its left edge, in device
    /// pixels. A row starts at the node named for its task and runs to the next row's.
    fn rows(
        page: &Snapshot,
        table: &deep_app::states::Table,
        sessions: &[String],
        now: u64,
    ) -> Vec<(String, i64, i64, i64)> {
        let nodes = page.flatten();
        let mut rows: Vec<(String, i64, i64, i64)> = sessions
            .iter()
            .filter_map(|session| {
                let name = format!("{} · {}", table.title(session), table.row(session, now).0);
                let node = nodes.iter().find(|node| {
                    node.name
                        .as_deref()
                        .is_some_and(|text| text.ends_with(name.as_str()))
                        && node.bounds[0] < SIDEBAR_PX
                })?;
                Some((session.clone(), node.bounds[1], LINE_TOP, node.bounds[0]))
            })
            .collect();
        rows.sort_by_key(|(_, top, ..)| *top);
        for index in 1..rows.len() {
            rows[index - 1].2 = rows[index].1;
        }
        rows
    }

    /// One click on the first node whose name holds `name`, then what the window shows that it didn't before.
    fn clicked(
        cx: &mut HeadlessAppContext,
        handle: AnyWindowHandle,
        before: &Snapshot,
        name: &str,
    ) -> Option<Vec<String>> {
        let target: &Node = before
            .flatten()
            .into_iter()
            .find(|node| node.name.as_deref().is_some_and(|text| text.contains(name)))?;
        let [x, y, width, height] = target.bounds;
        let scale = before.scale as f32;
        let position = point(
            px((x + width / 2) as f32 / scale),
            px((y + height / 2) as f32 / scale),
        );
        let modifiers = Modifiers::default();
        for event in [
            MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers,
            }
            .to_platform_input(),
            MouseDownEvent {
                button: MouseButton::Left,
                position,
                modifiers,
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            MouseUpEvent {
                button: MouseButton::Left,
                position,
                modifiers,
                click_count: 1,
            }
            .to_platform_input(),
        ] {
            cx.update_window(handle, |_, window, cx| {
                window.dispatch_event(event, cx);
            })
            .expect("the window takes the click");
        }
        cx.run_until_parked();
        let after = draw(cx, handle);
        let mut was: Vec<String> = before
            .flatten()
            .iter()
            .filter_map(|node| node.name.clone())
            .collect();
        let mut new = Vec::new();
        for text in after.flatten().iter().filter_map(|node| node.name.clone()) {
            match was.iter().position(|known| *known == text) {
                Some(at) => {
                    was.swap_remove(at);
                }
                None if !text.trim().is_empty() => new.push(text),
                None => {}
            }
        }
        Some(new)
    }
}
