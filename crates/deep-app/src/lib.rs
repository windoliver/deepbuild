//! Issue #337, the gpui-kit spike: a window with a 1,000-row session list and the count of
//! sessions waiting on you, beside one extension panel run by gpui-shell.
//!
//! The panel runs under an empty gpui-shell policy plus DeepBuild's one module, `deepbuild`,
//! which serves recorded quotes. It has no network, files, programs or storage.

use std::{path::Path, rc::Rc};

use gpui_kit::{prelude::FluentBuilder as _, *};
use gpui_shell::{anyhow, policy::Policy, HostModule, HostValue, ScriptView, ShellRuntime};

pub const SESSION_COUNT: usize = 1_000;

const QUOTES: &str = include_str!("../fixtures/quotes.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionState {
    Running,
    Waiting,
    Done,
}

#[derive(Clone, Debug)]
pub struct Session {
    pub id: usize,
    pub title: SharedString,
    pub state: SessionState,
}

/// A deterministic list: every seventh session waits on you, every third is done.
pub fn sessions() -> Vec<Session> {
    (0..SESSION_COUNT)
        .map(|id| Session {
            id,
            title: format!("Session {:04}", id + 1).into(),
            state: if id % 7 == 3 {
                SessionState::Waiting
            } else if id % 3 == 0 {
                SessionState::Done
            } else {
                SessionState::Running
            },
        })
        .collect()
}

/// The one number the menu bar shows: sessions that need a person.
pub fn waiting_count(sessions: &[Session]) -> usize {
    sessions
        .iter()
        .filter(|session| session.state == SessionState::Waiting)
        .count()
}

/// One recorded stock: its symbol, name and prices, one per tick.
#[derive(Clone, Debug, PartialEq)]
pub struct Stock {
    pub symbol: String,
    pub name: String,
    pub prices: Vec<f64>,
}

/// The recording grouped by symbol, in the order the symbols first appear.
pub fn stocks() -> Vec<Stock> {
    let raw: serde_json::Value =
        serde_json::from_str(QUOTES).expect("the recorded quotes are valid JSON");
    let mut stocks: Vec<Stock> = Vec::new();
    for row in raw["quotes"].as_array().expect("a quotes array") {
        let symbol = row["symbol"].as_str().expect("a symbol");
        let price = row["price"].as_f64().expect("a price");
        match stocks.iter_mut().find(|stock| stock.symbol == symbol) {
            Some(stock) => stock.prices.push(price),
            None => stocks.push(Stock {
                symbol: symbol.to_owned(),
                name: row["name"].as_str().unwrap_or(symbol).to_owned(),
                prices: vec![price],
            }),
        }
    }
    stocks
}

/// The menu-bar item's title: the count alone.
pub fn menu_bar_title(sessions: &[Session]) -> String {
    waiting_count(sessions).to_string()
}

/// DeepBuild's module for panels: the recorded quotes, as plain data.
pub fn deepbuild_module() -> HostModule {
    HostModule::new("deepbuild").function("quotes", |_| {
        let interval: serde_json::Value = serde_json::from_str(QUOTES).expect("valid JSON");
        let symbols = stocks()
            .into_iter()
            .map(|stock| {
                HostValue::Object(vec![
                    ("symbol".into(), HostValue::Str(stock.symbol)),
                    ("name".into(), HostValue::Str(stock.name)),
                    (
                        "prices".into(),
                        HostValue::Array(stock.prices.into_iter().map(HostValue::Number).collect()),
                    ),
                ])
            })
            .collect();
        Ok(HostValue::Object(vec![
            ("interval_s".into(), json_to_host(&interval["interval_s"])),
            ("symbols".into(), HostValue::Array(symbols)),
        ]))
    })
}

fn json_to_host(value: &serde_json::Value) -> HostValue {
    use serde_json::Value;
    match value {
        Value::Null => HostValue::Null,
        Value::Bool(value) => HostValue::Bool(*value),
        Value::Number(value) => HostValue::Number(value.as_f64().unwrap_or_default()),
        Value::String(value) => HostValue::Str(value.clone()),
        Value::Array(values) => HostValue::Array(values.iter().map(json_to_host).collect()),
        Value::Object(fields) => HostValue::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), json_to_host(value)))
                .collect(),
        ),
    }
}

/// Registers gpui-shell's component catalog and DeepBuild's empty-policy default.
pub fn init(cx: &mut App) {
    gpui_shell::components::init(cx);
    gpui_shell::policy::set_default(
        Policy::new()
            .with_application("deepbuild-panel")
            .with_host_module(deepbuild_module())
            .expect("`deepbuild` is not a reserved module name"),
    );
}

/// Loads a panel directory's `main.js` and mounts its view.
pub fn mount_panel(
    runtime: &Rc<ShellRuntime>,
    dir: &Path,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<Entity<ScriptView>> {
    let loaded = runtime.load_application(dir, "main.js")?;
    runtime.mount_application(&loaded, window, cx)
}

/// The spike's report, a static page the browser opens. The app itself has no web view.
pub fn report_html(sessions: &[Session], panel: Option<&str>) -> String {
    let rows: String = stocks()
        .iter()
        .map(|stock| {
            format!(
                "<tr><td>{}</td><td>{}</td><td>{:.2}</td><td>{:.2}</td></tr>",
                stock.symbol,
                stock.name,
                stock.prices[0],
                stock.prices[stock.prices.len() - 1],
            )
        })
        .collect();
    format!(
        "<!doctype html><meta charset=utf-8><title>DeepBuild spike report</title>\
         <h1>DeepBuild spike report</h1><p>{} sessions, {} waiting on you.</p><p>Panel: {}</p>\
         <table><tr><th>Symbol<th>Name<th>First<th>Last</tr>{rows}</table>",
        sessions.len(),
        waiting_count(sessions),
        panel.unwrap_or("none"),
    )
}

/// Writes the report under the system temp directory and returns its file URL.
pub fn write_report(sessions: &[Session], panel: Option<&str>) -> std::io::Result<String> {
    let path = std::env::temp_dir().join(format!("deepbuild-report-{}.html", std::process::id()));
    std::fs::write(&path, report_html(sessions, panel))?;
    Ok(format!("file://{}", path.display()))
}

pub struct Spike {
    sessions: Rc<Vec<Session>>,
    selected: Option<usize>,
    panel: Option<Entity<ScriptView>>,
    panel_name: Option<String>,
    report: Option<String>,
}

impl Spike {
    pub fn new(panel: Option<(String, Entity<ScriptView>)>) -> Self {
        let (panel_name, panel) = panel.unzip();
        Self {
            sessions: Rc::new(sessions()),
            selected: None,
            panel,
            panel_name,
            report: None,
        }
    }

    /// The file URL of the last report opened, if any.
    pub fn report(&self) -> Option<&str> {
        self.report.as_deref()
    }

    pub fn selected(&self) -> Option<usize> {
        self.selected
    }

    pub fn waiting(&self) -> usize {
        waiting_count(&self.sessions)
    }
}

impl Render for Spike {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sessions = self.sessions.clone();
        let selected = self.selected;
        let list = uniform_list(
            "sessions",
            sessions.len(),
            cx.processor(move |_, range: std::ops::Range<usize>, _, cx| {
                range
                    .map(|index| {
                        let session = &sessions[index];
                        let mark = match session.state {
                            SessionState::Waiting => "●",
                            SessionState::Running => "○",
                            SessionState::Done => "✓",
                        };
                        div()
                            .id(("session", index))
                            .test_support()
                            .h(px(28.))
                            .px_2()
                            .flex()
                            .items_center()
                            .gap_2()
                            .when(selected == Some(index), |row| row.bg(rgb(0xdbeafe)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected = Some(index);
                                cx.notify();
                            }))
                            .child(mark)
                            .child(session.title.clone())
                    })
                    .collect()
            }),
        )
        .h_full();

        div()
            .id("spike")
            .size_full()
            .flex()
            .bg(rgb(0xffffff))
            .text_color(rgb(0x111111))
            .text_sm()
            .child(
                div()
                    .w(px(260.))
                    .h_full()
                    .flex()
                    .flex_col()
                    .border_r_1()
                    .border_color(rgb(0xe5e7eb))
                    .child(
                        div()
                            .p_2()
                            .flex()
                            .justify_between()
                            .child(
                                div()
                                    .id("count")
                                    .test_support()
                                    .child(format!("{} waiting on you", self.waiting())),
                            )
                            .child(
                                div()
                                    .id("open-report")
                                    .test_support()
                                    .px_2()
                                    .rounded_md()
                                    .bg(rgb(0xf3f4f6))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        match write_report(
                                            &this.sessions,
                                            this.panel_name.as_deref(),
                                        ) {
                                            Ok(url) => {
                                                cx.open_url(&url);
                                                this.report = Some(url);
                                            }
                                            Err(error) => eprintln!("deep-app: report: {error}"),
                                        }
                                        cx.notify();
                                    }))
                                    .child("Report"),
                            ),
                    )
                    .child(list),
            )
            .child(div().flex_1().h_full().children(self.panel.clone()))
    }
}
