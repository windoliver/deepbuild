//! Issue #337, the gpui-kit spike: a window with a 1,000-row session list and the count of
//! sessions waiting on you, beside one extension panel run by gpui-shell.
//!
//! The panel runs under an empty gpui-shell policy plus DeepBuild's one module, `deepbuild`,
//! which serves recorded quotes. It has no network, files, programs or storage.
//!
//! Issue #338 adds the app's shell with its shipped views as dock panels ([`views`]), the fixture
//! record and inbox projection they draw ([`events`]), the canvas as a registered component
//! ([`canvas`]), and `needs_you` in the `deepbuild` module for the fixture panels.

pub mod answer;
pub mod arming;
pub mod canvas;
pub mod card;
pub mod confirm;
pub mod events;
pub mod gpu_view;
pub mod hub;
pub mod kinds;
pub mod notify;
#[cfg(feature = "panel-check")]
pub mod panel_check;
pub mod panel_tree;
pub mod question;
pub mod record;
pub mod setup;
pub mod states;
pub mod text;
pub mod views;

use std::{path::Path, rc::Rc};

use gpui_kit::component::TitleBar;
use gpui_kit::{prelude::FluentBuilder as _, *};
use gpui_shell::{
    anyhow, policy::Policy, FrozenComponentRegistry, HostError, HostModule, HostValue,
    RegistryError, ScriptView, ShellRuntime,
};

pub mod trusted_input;

pub mod brand;

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

/// DeepBuild's module for panels: the recorded quotes and the Needs you inbox, as plain data.
pub fn deepbuild_module() -> HostModule {
    HostModule::new("deepbuild")
        .function("needs_you", |_| needs_you())
        .function("quotes", |_| {
            let interval: serde_json::Value = serde_json::from_str(QUOTES).expect("valid JSON");
            let symbols = stocks()
                .into_iter()
                .map(|stock| {
                    HostValue::Object(vec![
                        ("symbol".into(), HostValue::Str(stock.symbol)),
                        ("name".into(), HostValue::Str(stock.name)),
                        (
                            "prices".into(),
                            HostValue::Array(
                                stock.prices.into_iter().map(HostValue::Number).collect(),
                            ),
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

/// The inbox projection's list for Needs you, as the fixture panels read it: the rows oldest
/// first, which of them are folded or in Later, and the asks that left the list.
fn needs_you() -> Result<HostValue, HostError> {
    let state = views::current_state().ok_or_else(|| {
        HostError::new("no fixture record is loaded; the host sets one before a panel draws")
    })?;
    let handles = |handles: &[String]| {
        HostValue::Array(handles.iter().cloned().map(HostValue::Str).collect())
    };
    Ok(HostValue::Object(vec![
        ("now".into(), HostValue::Number(state.now as f64)),
        (
            "log_pos".into(),
            HostValue::Number(state.inbox.log_pos as f64),
        ),
        ("rows".into(), handles(&state.inbox.rows())),
        ("folded".into(), handles(&state.inbox.folded)),
        ("later".into(), handles(&state.inbox.later)),
        ("superseded".into(), handles(&state.inbox.superseded)),
        ("moot".into(), handles(&state.inbox.moot)),
        (
            "held".into(),
            state
                .held
                .clone()
                .map(HostValue::Str)
                .unwrap_or(HostValue::Null),
        ),
    ]))
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

/// gpui-shell's component catalog with DeepBuild's canvas beside it.
pub fn components() -> Result<FrozenComponentRegistry, RegistryError> {
    let mut registry = gpui_shell::components::registry()?;
    canvas::register(&mut registry)?;
    registry.freeze()
}

/// An isolated script runtime over [`components`].
pub fn new_runtime() -> anyhow::Result<Rc<ShellRuntime>> {
    ShellRuntime::new_isolated_with_components(components()?)
}

/// Registers gpui-shell's component catalog, the shipped views and DeepBuild's empty-policy
/// default.
pub fn init(cx: &mut App) {
    gpui_shell::components::init(cx);
    views::register_views(cx);
    card::init(cx);
    gpui_shell::policy::set_default(
        Policy::new()
            .with_application("deepbuild-panel")
            .with_host_module(deepbuild_module())
            .expect("`deepbuild` is not a reserved module name"),
    );
}

/// Loads a panel directory's `main.js` and mounts its view. A panel loads nothing from the network: one whose
/// gpui-shell manifest lists a Git dependency is refused before gpui-shell reads it, so nothing is fetched (#326).
pub fn mount_panel(
    runtime: &Rc<ShellRuntime>,
    dir: &Path,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<Entity<ScriptView>> {
    if let Some(dependency) = fetched_dependency(dir) {
        anyhow::bail!("{}", fetch_refusal(&dependency));
    }
    let loaded = runtime.load_application(dir, "main.js")?;
    runtime.mount_application(&loaded, window, cx)
}

/// The first dependency a panel's gpui-shell manifest fetches from a repository, by name.
pub fn fetched_dependency(dir: &Path) -> Option<String> {
    // #358: a package's own manifest is read as well; what it asks for is never granted either way.
    ["gpui-shell.json", "package.json"].iter().find_map(|file| {
        let text = std::fs::read_to_string(dir.join(file)).ok()?;
        let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
        manifest["dependencies"]
            .as_object()?
            .iter()
            .find(|(_, dependency)| dependency.get("git").is_some())
            .map(|(name, _)| name.clone())
    })
}

/// Why a panel whose manifest fetches a dependency is refused.
pub fn fetch_refusal(dependency: &str) -> String {
    format!("its manifest lists the Git dependency {dependency}; a panel loads nothing from the network")
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

/// The welcome screen, shown where a panel would be until one is mounted: the kit's stacked
/// lockup in Ink on Paper, an approved pairing, with the D at `brand::WELCOME_D_PX`. On the first
/// launch it holds the one Set up button (#326), and after the click, the line it said.
fn welcome(cx: &mut Context<Spike>, said: Option<&str>) -> impl IntoElement {
    let button = (said.is_none() && setup::needed()).then(|| {
        div()
            .id("set-up")
            .test_support()
            .role(Role::Button)
            .aria_label("Set up")
            .px_4()
            .py_1()
            .rounded_md()
            .bg(rgb(brand::INK))
            .text_color(rgb(brand::PAPER))
            .on_click(cx.listener(|this, _, _, cx| {
                this.set_up = Some(setup::set_up().map_or_else(|error| error, str::to_owned));
                cx.notify();
            }))
            .child("Set up")
    });
    div()
        .id("welcome")
        .test_support()
        .flex_1()
        .h_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_6()
        .bg(rgb(brand::PAPER))
        .text_color(rgb(brand::INK))
        .child(
            svg()
                .data(brand::WELCOME_LOCKUP)
                .w(px(brand::WELCOME_LOCKUP_WIDTH_PX))
                .h(px(brand::WELCOME_LOCKUP_HEIGHT_PX))
                .text_color(rgb(brand::INK)),
        )
        .child(div().text_sm().child("Where your agents show, not tell."))
        .children(button)
        .children(said.map(|line| div().text_sm().child(line.to_owned())))
}

/// The title bar with the mark: the small cut, drawn 24 px with the D at 18 px, in Ink on the
/// light bar.
fn title_bar() -> TitleBar {
    TitleBar::new().child(
        div()
            .id("title-bar-mark")
            .test_support()
            .flex()
            .items_center()
            .child(
                svg()
                    .data(brand::TITLE_BAR_MARK)
                    .size(px(brand::TITLE_BAR_MARK_PX))
                    .text_color(rgb(brand::INK)),
            ),
    )
}

pub struct Spike {
    sessions: Rc<Vec<Session>>,
    selected: Option<usize>,
    panel: Option<Entity<ScriptView>>,
    panel_name: Option<String>,
    report: Option<String>,
    /// What the Set up click said, once clicked.
    set_up: Option<String>,
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
            set_up: None,
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

        let count = format!("{} waiting on you", self.waiting());
        let content = match &self.panel {
            Some(panel) => div()
                .flex_1()
                .h_full()
                .child(panel.clone())
                .into_any_element(),
            None => welcome(cx, self.set_up.as_deref()).into_any_element(),
        };
        div()
            .id("spike")
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(0xffffff))
            .text_color(rgb(0x111111))
            .text_sm()
            .child(title_bar())
            .child(
                div()
                    .flex_1()
                    .w_full()
                    .min_h_0()
                    .flex()
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
                                            // The label is the drawn text, so a test can read the count back.
                                            .aria_label(count.clone())
                                            .child(count),
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
                                                    Err(error) => {
                                                        eprintln!("deep-app: report: {error}")
                                                    }
                                                }
                                                cx.notify();
                                            }))
                                            .child("Report"),
                                    ),
                            )
                            .child(list),
                    )
                    .child(content),
            )
    }
}
