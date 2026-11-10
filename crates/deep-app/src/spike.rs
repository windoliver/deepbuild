//! Issue #337, the gpui-kit spike: a window with a 1,000-row session list and the count of sessions waiting on you,
//! beside one extension panel run by gpui-shell. Issue #1172 took it out of the shipped binary: it builds only under
//! the `spike` feature, for the suites that keep #337's and #79's proof and for the planted build that opens it.

use std::rc::Rc;

use gpui_kit::{prelude::FluentBuilder as _, *};
use gpui_shell::ScriptView;

use crate::{chrome, stocks, views};

pub const SESSION_COUNT: usize = 1_000;

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

/// The menu-bar item's title: the count alone.
pub fn menu_bar_title(sessions: &[Session]) -> String {
    waiting_count(sessions).to_string()
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
    /// The welcome pane, once drawn: where a panel would be until one is mounted.
    welcome: Option<AnyView>,
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
            welcome: None,
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
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = *chrome::of(window);
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
                        crate::views::observed(("session", index))
                            .h(px(28.)) // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                            .px_2() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                            .flex()
                            .items_center()
                            .gap_2() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                            .when(selected == Some(index), |row| row.bg(chrome.selected))
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

        let count = crate::notify::reach().count(format!("{} waiting on you", self.waiting()));
        let content = match &self.panel {
            Some(panel) => div()
                .flex_1()
                .h_full()
                .child(panel.clone())
                .into_any_element(),
            None => div()
                .flex_1()
                .h_full()
                .child(
                    self.welcome
                        .get_or_insert_with(|| views::shipped(views::Kind::Welcome, cx))
                        .clone(),
                )
                .into_any_element(),
        };
        div()
            .id("spike")
            .size_full()
            .flex()
            .flex_col()
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .text_sm() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
            .child(views::title_bar(window))
            .child(
                div()
                    .flex_1()
                    .w_full()
                    .min_h_0()
                    .flex()
                    .child(
                        div()
                            .w(px(260.)) // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                            .h_full()
                            .flex()
                            .flex_col()
                            .border_r_1() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                            .border_color(chrome.divider)
                            .child(
                                div()
                                    .p_2() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                                    .flex()
                                    .justify_between()
                                    .child(
                                        crate::views::observed("count")
                                            // The label is the drawn text, so a test can read the count back.
                                            .aria_label(count.clone())
                                            .child(count),
                                    )
                                    .child(
                                        crate::views::observed("open-report")
                                            .px_2() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                                            .rounded_md() // size-literal-exception: the #337 spike window, in no shipped build (#1172); review 2027-04-30
                                            .bg(chrome.raised)
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
