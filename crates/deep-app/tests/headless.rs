//! Issue #337: every screen rendered and clicked with gpui-kit's test support, no display.
//!
//! The panels under `panels/` were written by Claude Code and by Codex from
//! `docs/spikes/337/panel-brief.md` and gpui-shell's docs. The expected values come from the
//! same recording the panel reads, computed here.

use std::path::{Path, PathBuf};

use deep_app::{sessions, stocks, waiting_count, Spike, SESSION_COUNT};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    px, size, AnyWindowHandle, AppContext as _, Bounds, ElementId, Entity, Point, TestAppContext,
    WindowBounds, WindowOptions,
};
use gpui_shell::ScriptView;

fn panel_dir(agent: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("panels")
        .join(agent)
}

fn open(
    cx: &mut TestAppContext,
    panel: Option<&str>,
) -> (AnyWindowHandle, Entity<Spike>, Option<Entity<ScriptView>>) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    let runtime = gpui_shell::components::new_isolated_runtime().expect("panel runtime");
    let mut mounted = None;
    let (window, spike) = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(960.), px(640.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| {
                let panel = panel.map(|agent| {
                    let view = deep_app::mount_panel(&runtime, &panel_dir(agent), window, cx)
                        .unwrap_or_else(|error| panic!("{agent} panel failed to load: {error:#}"));
                    mounted = Some(view.clone());
                    (agent.to_owned(), view)
                });
                cx.new(|_| Spike::new(panel))
            },
        )
        .expect("open window")
    });
    (window, spike, mounted)
}

fn tree(cx: &mut TestAppContext, window: AnyWindowHandle, panel: &Entity<ScriptView>) -> String {
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let view = panel.read(cx);
        assert_eq!(view.build_error(), None, "the panel failed to build");
        view.snapshot().expect("panel snapshot").debug_tree()
    })
    .unwrap()
}

fn click(cx: &mut TestAppContext, window: AnyWindowHandle, id: &str) {
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click(ElementId::Name(id.to_owned().into()), cx);
    })
    .unwrap();
    cx.run_until_parked();
}

fn assert_has(tree: &str, text: &str) {
    assert!(
        tree.contains(text),
        "missing {text:?} in the panel tree:\n{tree}"
    );
}

#[gpui_kit::test]
fn session_list_count_and_report(cx: &mut TestAppContext) {
    let (window, spike, _) = open(cx, None);
    let expected = waiting_count(&sessions());
    assert_eq!(sessions().len(), SESSION_COUNT);
    assert_eq!(expected, 143);

    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("count").visible());
        // The list is virtualized: the first rows are drawn and the 1,000th is not yet.
        assert!(window.try_find(("session", 0usize)).is_some());
        assert!(window.try_find(("session", SESSION_COUNT - 1)).is_none());
        window.click(("session", 3usize), cx);
        window.click("open-report", cx);
    })
    .unwrap();
    cx.update(|cx| {
        let spike = spike.read(cx);
        assert_eq!(spike.waiting(), expected);
        assert_eq!(spike.selected(), Some(3));
        let report = spike.report().expect("the report was written");
        let html = std::fs::read_to_string(report.trim_start_matches("file://")).unwrap();
        assert!(html.contains(&format!(
            "{SESSION_COUNT} sessions, {expected} waiting on you"
        )));
    });
    assert_eq!(
        cx.opened_url().as_deref(),
        spike
            .read_with(cx, |spike, _| spike.report().map(str::to_owned))
            .as_deref(),
        "the report opens in the browser"
    );
}

fn stocks_panel(agent: &str, cx: &mut TestAppContext) {
    let quotes: Vec<_> = stocks()
        .into_iter()
        .map(|stock| (stock.symbol, stock.prices))
        .collect();
    let (window, _, panel) = open(cx, Some(agent));
    let panel = panel.unwrap();
    let percent = |prices: &[f64], tick: usize| {
        let change = (prices[tick] / prices[0] - 1.0) * 100.0;
        format!("{}{change:.2}%", if change >= 0.0 { "+" } else { "" })
    };

    let first = tree(cx, window, &panel);
    assert_has(&first, "Tick 0");
    for (symbol, prices) in &quotes {
        assert_has(&first, symbol);
        assert_has(&first, &format!("{:.2}", prices[0]));
    }
    assert_has(&first, &format!("Selected: {}", quotes[0].0));

    // Time moves only on `next`.
    click(cx, window, "next");
    click(cx, window, "next");
    let later = tree(cx, window, &panel);
    assert_has(&later, "Tick 2");
    for (_, prices) in &quotes {
        assert_has(&later, &format!("{:.2}", prices[2]));
        assert_has(&later, &percent(prices, 2));
    }

    // Select the stock whose replay first crosses +0.1% after tick 2, then arm and cross.
    let (symbol, prices, crossing) = quotes
        .iter()
        .filter_map(|(symbol, prices)| {
            let target = prices[2] * 1.001;
            let at = (3..prices.len()).find(|&tick| prices[tick] >= target)?;
            Some((symbol, prices, at))
        })
        .min_by_key(|(_, _, at)| *at)
        .expect("some stock crosses its target in the recording");
    click(cx, window, &format!("row-{symbol}"));
    assert_has(&tree(cx, window, &panel), &format!("Selected: {symbol}"));
    click(cx, window, "alert-above");
    let target = prices[2] * 1.001;
    let armed = tree(cx, window, &panel);
    assert_has(&armed, &format!("Target {symbol} {target:.2}"));
    assert!(
        !armed.contains("Alert:"),
        "an alert fired before a crossing:\n{armed}"
    );

    for _ in 2..crossing - 1 {
        click(cx, window, "next");
    }
    assert!(
        !tree(cx, window, &panel).contains("Alert:"),
        "the alert fired a tick early"
    );
    click(cx, window, "next");
    let alert = format!("Alert: {symbol} crossed {target:.2}");
    assert_has(&tree(cx, window, &panel), &alert);
    click(cx, window, "next");
    assert_has(&tree(cx, window, &panel), &alert);

    // Time stops at the last tick.
    let last = prices.len() - 1;
    for _ in crossing + 1..=last + 1 {
        click(cx, window, "next");
    }
    let end = tree(cx, window, &panel);
    assert_has(&end, &format!("Tick {last}"));
    assert_has(&end, &format!("{:.2}", prices[last]));
}

#[gpui_kit::test]
fn claude_code_stocks_panel(cx: &mut TestAppContext) {
    stocks_panel("claude-code", cx);
}

#[gpui_kit::test]
fn codex_stocks_panel(cx: &mut TestAppContext) {
    stocks_panel("codex", cx);
}
