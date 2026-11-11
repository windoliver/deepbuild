//! The first-launch page (#326, #1100): one button, Set up, and above it what setup will do on this machine, from the
//! one list `deep setup` runs (crate::setup): a row per agent it found, with a mark per step of its, and at most three
//! lines saying what it changes, what it never does and how to take it back. No tagline and no box until setup
//! finishes (#1461).
//!
//! The click runs setup off the UI thread (#1556). While it runs the button reads Setting up and takes no second press,
//! and each step's mark says done as it ends. A setup that stops keeps the button in the same window, with one line
//! saying what stopped it and what to do; its output is one press away, never on the page. A setup that works leaves
//! its one line as a notice, and the window opens on what it opens on (#1461). The click is also when macOS asks
//! whether DeepBuild may notify you (crate::notify::ask).

use std::{sync::mpsc::TryRecvError, time::Duration};

use gpui_kit::{prelude::FluentBuilder as _, *};

use crate::chrome::{self, sizes, Typed as _};
use crate::plain::planted;
use crate::setup::{self, Stopped};
use crate::views::{control, label, observed, Control, Shipped};
use crate::{brand, notice};

/// How often the window looks for what setup said while it runs.
const TICK: Duration = Duration::from_millis(50);

/// What the button reads while setup runs.
pub const SETTING_UP: &str = "Setting up";

/// The first-launch page's state.
#[derive(Default)]
pub(crate) struct Welcome {
    /// The wait for what setup says, while it runs (#1556).
    running: Option<Task<()>>,
    /// How the last Set up in this window stopped.
    stopped: Option<Stopped>,
    /// Whether that stop's output is open.
    output: bool,
}

/// The Set up click. A second press while it runs starts nothing.
fn start(this: &mut Shipped, cx: &mut Context<Shipped>) {
    // #1100's planted app starts setup again on a second press.
    if this.welcome.running.is_some() && !planted("set-up-starts-twice") {
        return;
    }
    // #1100's planted app asks for notifications only when the first one posts.
    if !planted("notifications-asked-at-first-post") {
        crate::notify::ask();
    }
    let heard = setup::start();
    this.welcome.stopped = None;
    this.welcome.output = false;
    this.welcome.running = Some(cx.spawn(async move |this, cx| loop {
        cx.background_executor().timer(TICK).await;
        let said = match heard.try_recv() {
            Ok(said) => said,
            Err(TryRecvError::Empty) => {
                // Each step's mark says done as it ends.
                if setup::refresh() {
                    let _ = this.update(cx, |_, cx| cx.notify());
                }
                continue;
            }
            Err(TryRecvError::Disconnected) => Err(Stopped {
                line: Some("Set up stopped before it said why. Press Set up to try again.".into()),
                output: String::new(),
            }),
        };
        let _ = this.update(cx, |this, cx| {
            setup::refresh();
            this.welcome.running = None;
            match said {
                Ok(line) => notice::show(line, cx),
                Err(stopped) => this.welcome.stopped = Some(stopped),
            }
            cx.notify();
        });
        return;
    }));
    cx.notify();
}

/// A line of the page: one label named by its words, centred, wrapping inside the reading lane it sits in.
fn line(id: impl Into<ElementId>, words: String) -> impl IntoElement {
    observed(id)
        .role(Role::Label)
        .aria_label(words.clone())
        .w_full()
        .text_center()
        .child(words)
}

/// The page.
pub(crate) fn page(
    this: &Shipped,
    chrome: &chrome::Chrome,
    cx: &mut Context<Shipped>,
) -> impl IntoElement {
    let s = sizes();
    let welcome = &this.welcome;
    let running = welcome.running.is_some();
    let offered = running || setup::needed();
    // #1100's planted app hides the button while setup runs and says so in a line, as the merge base drew it.
    let hidden = running && planted("set-up-hides-button");
    let button = (offered && !hidden).then(|| {
        control(
            "set-up",
            Control::Main,
            if running { SETTING_UP } else { "Set up" },
            chrome,
        )
        .on_click(cx.listener(|this, _, _, cx| start(this, cx)))
    });
    // #1100's planted second option, which runs setup too.
    let second = (offered && !running && planted("first-launch-second-option")).then(|| {
        control(
            "set-up-without-history",
            Control::Plain,
            "Set up without history",
            chrome,
        )
        .on_click(cx.listener(|this, _, _, cx| start(this, cx)))
    });
    // What stopped the last Set up, and what to do: setup's own reason and fix, or its own plain line.
    let reason = (!running && offered)
        .then(|| {
            welcome
                .stopped
                .as_ref()
                .and_then(|stopped| stopped.line.clone())
                .or_else(setup::reason)
        })
        .flatten();
    let output = welcome
        .stopped
        .as_ref()
        .map(|stopped| stopped.output.trim().to_owned())
        .filter(|output| !output.is_empty());
    // #1100's planted screen prints setup's output, every line of it.
    let printed = output.clone().filter(|_| planted("set-up-prints-output"));
    let screen = setup::screen();
    observed("welcome")
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(s.space(4))
        .bg(chrome.ground)
        .typed(s.body)
        .text_color(chrome.ink_primary)
        .child(
            svg()
                .data(brand::WELCOME_LOCKUP)
                .w(px(brand::WELCOME_LOCKUP_WIDTH_PX)) // size-literal-exception: the kit's artwork at brand/surfaces.json's size (#79); review 2027-04-30
                .h(px(brand::WELCOME_LOCKUP_HEIGHT_PX)) // size-literal-exception: the kit's artwork at brand/surfaces.json's size (#79); review 2027-04-30
                .text_color(chrome.ink_primary),
        )
        .when(offered, |page| {
            page.child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(s.space(1))
                    .children(screen.agents.iter().map(|(agent, name, steps)| {
                        let done = steps.iter().all(|(_, done)| *done);
                        // A mark per step, filled once it's done.
                        let marks = steps.iter().map(|(step, done)| {
                            observed(ElementId::Name(format!("setup-step:{step}").into()))
                                .role(Role::Image)
                                .aria_value(if *done { "done" } else { "not yet" })
                                .size(s.space(1))
                                .rounded(s.radius)
                                .bg(if *done {
                                    chrome.ink_primary
                                } else {
                                    chrome.divider
                                })
                        });
                        observed(ElementId::Name(format!("setup-agent:{agent}").into()))
                            .role(Role::Label)
                            .aria_label(name.clone())
                            .when(done, |row| row.aria_value("done"))
                            .flex()
                            .items_center()
                            .gap(s.space(1))
                            .children(marks)
                            .child(name.clone())
                    })),
            )
            .child(
                div()
                    .w_full()
                    .max_w(s.lane)
                    .px(s.space(4))
                    .flex()
                    .flex_col()
                    .gap(s.space(1))
                    .children(screen.lines.iter().map(|(id, words)| {
                        line(
                            ElementId::Name(format!("setup-line:{id}").into()),
                            words.clone(),
                        )
                    })),
            )
        })
        .children(button)
        .children(second)
        .children(hidden.then(|| label("set-up-working", format!("{SETTING_UP}…"))))
        // #1461's planted first-launch page draws the box beside Set up.
        .children(
            planted("box-on-first-launch")
                .then(crate::views::words_box)
                .flatten(),
        )
        // A long path in the reason wraps inside the lane, so its fix stays in view.
        .children(reason.map(|reason| {
            div()
                .w_full()
                .max_w(s.lane)
                .px(s.space(4))
                .child(line("set-up-reason", reason))
        }))
        .children(printed.map(|output| {
            div()
                .w_full()
                .max_w(s.lane)
                .px(s.space(4))
                .children(output.lines().enumerate().map(|(n, words)| {
                    line(
                        ElementId::Name(format!("set-up-printed:{n}").into()),
                        words.to_owned(),
                    )
                }))
        }))
        .children(
            output
                .filter(|_| !planted("set-up-prints-output"))
                .map(|output| {
                    let open = welcome.output;
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .child(
                            control(
                                "set-up-show-output",
                                Control::Plain,
                                if open { "Hide output" } else { "Show output" },
                                chrome,
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.welcome.output = !this.welcome.output;
                                cx.notify();
                            })),
                        )
                        .children(open.then(|| {
                            div()
                                .w_full()
                                .max_w(s.lane)
                                .px(s.space(4))
                                .text_color(chrome.ink_secondary)
                                .child(line("set-up-output", output))
                        }))
                }),
        )
}
