//! #326, criterion group "panels": the app's half of AC4 (Needs you and a session's page reflect
//! the same `log_pos` after each frame, both fed by the one record reader), and AC5, AC6 and AC7
//! (panel packages refused at install by `panel@1`, with what each fixture panel tried to do
//! observed by the test itself: connections to a listener, a marker file, the window's focus, and
//! window captures compared bit for bit). The record-reader guard, AC4's other half, is
//! `guard.test.mjs`. The wrong programs the criteria name run in `planted.rs`.
//!
//! The surface these tests reach (README, The surface): `deep_replica::kit::panel`,
//! `deep_replica::shell::open_with_card`, `deep_app::record::{install, poll}` and
//! `deep_app::mount_panel`, beside what the base already has.
//!
//! Wired into deep-replica by one `[[test]]` entry, and run from the checkout with:
//!     cargo test --locked -p deep-replica --test acceptance_326_panels

#[path = "common.rs"]
mod common;
#[cfg(target_os = "macos")]
#[path = "hub.rs"]
mod hub;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_326_panels: INCONCLUSIVE; window captures need macOS, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::{
        path::{Path, PathBuf},
        time::{Duration, Instant},
    };

    use deep_app::views::Layout;
    use deep_replica::{shell::open_shell, snapshot::from_observed};
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::*;
    use serde_json::Value;

    use super::common::*;
    use super::hub::*;

    // ---- AC4: one record reader feeds every view.

    /// The ask handles Needs you lists, top to bottom: its nodes named `ask:<id>`, as at the base.
    fn needs_you_rows(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> Vec<String> {
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            from_observed(window)
        })
        .unwrap()
        .flatten()
        .into_iter()
        .filter_map(|node| node.name.clone())
        .filter(|name| name.starts_with("ask:"))
        .collect()
    }

    /// The count the session page's readout shows: its session's open asks, as at the base.
    fn session_count(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> usize {
        cx.update_window(handle, |_, window, cx| {
            deep_app::canvas::clear_items();
            window.render_frame(cx);
        })
        .unwrap();
        let items = deep_app::canvas::items();
        let (_, readout) = items
            .iter()
            .find(|(id, _)| id == "session-readout")
            .unwrap_or_else(|| panic!("the session page drew no session-readout item: {items:?}"));
        readout["text"]
            .as_str()
            .and_then(|text| text.parse().ok())
            .unwrap_or_else(|| panic!("the session readout is not a count: {readout}"))
    }

    fn needs_you_and_session_page_share_each_log_pos() {
        let hub = Hub::start();
        let mut cx = deep_replica::headless_context();
        let reader = deep_app::record::RecordReader::open(&hub.socket, &hub.token_file)
            .unwrap_or_else(|error| panic!("the record reader can't open the test hub: {error:?}"));
        deep_app::record::install(reader);
        let (needs_you, _) =
            cx.update(|cx| open_shell(&Layout::shipped("needs-you"), cx, |_, _| {}));
        let (session, _) = cx.update(|cx| open_shell(&Layout::shipped("session"), cx, |_, _| {}));

        // Six asks created, then the first one answered: seven frames.
        let mut frames: Vec<Value> = (1..=6).map(ask_created).collect();
        frames.push(ask_answered(7, &handle_of(&frames[0])));
        let mut open: Vec<String> = Vec::new();
        for frame in frames {
            let at = frame["log_pos"].as_u64().unwrap();
            if frame["kind"] == "ask.created" {
                open.push(handle_of(&frame));
            } else {
                open.retain(|handle| *handle != frame["subject"]);
            }
            hub.append(frame);
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                deep_app::record::poll(Duration::from_millis(100))
                    .unwrap_or_else(|error| panic!("polling the record reader failed: {error:?}"));
                let rows = needs_you_rows(&mut cx, needs_you);
                let count = session_count(&mut cx, session);
                assert_eq!(
                    rows.len(),
                    count,
                    "after the frame at log_pos {at}, Needs you lists {} open asks and the session's page counts {count}: the two views show different log positions",
                    rows.len()
                );
                if rows == open {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "10 s after the frame at log_pos {at}, Needs you lists {rows:?}, not {open:?}"
                );
            }
        }
        // Both views were fed by the one reader: the hub saw one subscription for the two of them.
        assert_eq!(
            hub.subscriptions(),
            1,
            "the app subscribed to the stream more than once"
        );
    }

    // ---- AC5: a package with a Git dependency.

    fn shell_home() -> PathBuf {
        PathBuf::from(
            std::env::var_os("GPUI_SHELL_HOME").expect("GPUI_SHELL_HOME is set for this run"),
        )
    }

    fn git_dependency_refused_at_install_and_never_fetched() {
        let scratch = Scratch::new();
        let listener = Listener::new();
        let dir = copy_fixture(
            "fetched-dependency",
            &scratch,
            &[("__PORT__", &listener.port.to_string())],
        );
        let verdict = deep_replica::kit::panel(&dir);
        assert!(
            !verdict.pass,
            "panel@1 installed a package whose manifest lists a Git dependency"
        );
        let message = verdict.names.unwrap_or_default();
        assert!(
            message.contains("pad-326"),
            "the refusal doesn't name the dependency pad-326: {message:?}"
        );
        assert_eq!(
            listener.connections(),
            0,
            "installing the package reached the dependency's host"
        );

        // Loading it, past install, through the app's loader.
        let mut cx = deep_replica::headless_context();
        let runtime = deep_app::new_runtime().expect("the panel runtime");
        cx.update(|cx| {
            gpui_kit::open_window(deep_replica::shell::window_options(), cx, |window, cx| {
                let _ = deep_app::mount_panel(&runtime, &dir, window, cx);
                cx.new(|_| Blank)
            })
            .expect("a window opens")
        });
        cx.run_until_parked();
        assert_eq!(
            listener.connections(),
            0,
            "loading the package made a network request"
        );
        assert!(
            !shell_home().join("cache").exists(),
            "loading the package started gpui-shell's dependency fetch: {} exists",
            shell_home().join("cache").display()
        );
    }

    struct Blank;
    impl Render for Blank {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }

    // ---- The card and the shell.

    struct Shell {
        cx: HeadlessAppContext,
        handle: AnyWindowHandle,
        slot: Bounds<Pixels>,
    }

    fn open_card(card: Bounds<Pixels>, panel: Option<&Path>) -> Shell {
        let mut cx = deep_replica::headless_context();
        let (handle, slot) = cx.update(|cx| deep_replica::shell::open_with_card(cx, card, panel));
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
        Shell { cx, handle, slot }
    }

    /// The shell's render of the card alone at `CARD`: no panel, the shipped sidebar in its slot.
    fn card_alone(ms: u64) -> (Capture, Bounds<Pixels>) {
        let mut shell = open_card(card_bounds(), None);
        settle(&mut shell.cx, shell.handle, ms);
        (capture(&mut shell.cx, shell.handle), shell.slot)
    }

    /// The card is drawn where it is presented: moved 200 points right, the pixels inside its first
    /// rect change. Without this, a shell that drew no card would pass AC7 by drawing nothing.
    fn the_card_is_drawn_at_its_rect() {
        let (alone, slot) = card_alone(100);
        assert_eq!(
            (alone.width, alone.height),
            ((WINDOW.0 * SCALE) as u32, (WINDOW.1 * SCALE) as u32),
            "the shell opens the reference window at 2x"
        );
        assert!(
            f32::from(slot.size.width) >= 100.
                && f32::from(slot.origin.x) + f32::from(slot.size.width) <= CARD.0,
            "the panel's slot {slot:?} is the sidebar, left of the card at x = {}",
            CARD.0
        );
        let moved = Bounds {
            origin: point(px(CARD.0 + 200.), px(CARD.1)),
            size: size(px(CARD.2 - 200.), px(CARD.3)),
        };
        let mut shell = open_card(moved, None);
        settle(&mut shell.cx, shell.handle, 100);
        let elsewhere = capture(&mut shell.cx, shell.handle);
        let [x, y, _, h] = card_device();
        assert!(
            first_interior_difference(&alone, &elsewhere, [x, y, 400, h]).is_some(),
            "the card's first 200 points look the same with the card moved away from them"
        );
    }

    // ---- AC6: the four faults.

    fn four_faults_refused_each_with_its_own_message() {
        let (reference, _) = card_alone(500);
        let mut runs = Vec::new();
        for fault in FAULTS {
            let scratch = Scratch::new();
            let listener = Listener::new();
            let marker = scratch.0.join("program-ran");
            let dir = copy_fixture(
                &format!("faults/{fault}"),
                &scratch,
                &[
                    ("__PORT__", &listener.port.to_string()),
                    ("__MARKER__", &marker.display().to_string()),
                ],
            );
            let verdict = deep_replica::kit::panel(&dir);
            let refusal = (!verdict.pass).then(|| verdict.names.clone().unwrap_or_default());
            // What the panel does in the app's shell, mounted past install.
            let mut shell = open_card(card_bounds(), Some(&dir));
            let before = shell
                .cx
                .update_window(shell.handle, |_, window, cx| window.focused(cx))
                .unwrap();
            settle(&mut shell.cx, shell.handle, 500);
            let after = shell
                .cx
                .update_window(shell.handle, |_, window, cx| window.focused(cx))
                .unwrap();
            let shot = capture(&mut shell.cx, shell.handle);
            let happened = observed(
                fault,
                &listener,
                &marker,
                before != after,
                &shot,
                &reference,
                shell.slot,
            );
            println!("  {fault}: refused {refusal:?}; happened {happened:?}");
            runs.push(FaultRun {
                fault,
                refusal,
                happened,
            });
        }
        if let Err(failure) = judge_faults(&runs) {
            panic!("panel@1 and the shell let a fault through:\n{failure}");
        }
    }

    // ---- AC7: over the card's slot.

    fn nothing_covers_the_card() {
        let (alone, _) = card_alone(1_500);
        let mut runs = Vec::new();
        for component in COMPONENTS {
            let scratch = Scratch::new();
            let dir = copy_fixture(&format!("components/{}", component.dir), &scratch, &[]);
            let verdict = deep_replica::kit::panel(&dir);
            let refusal = (!verdict.pass).then(|| verdict.names.clone().unwrap_or_default());
            let mut shell = open_card(card_bounds(), Some(&dir));
            open(&mut shell.cx, shell.handle, component.open, shell.slot);
            let shot = capture(&mut shell.cx, shell.handle);
            let difference = first_interior_difference(&shot, &alone, card_device());
            println!(
                "  {}: refused {refusal:?}; card interior differs at {difference:?}",
                component.name
            );
            runs.push(CardRun {
                component,
                refusal,
                difference,
            });
        }
        if let Err(failure) = judge_cards(&runs) {
            panic!("a panel covered the question card or went unrefused:\n{failure}");
        }
    }

    pub fn run() -> i32 {
        // gpui-shell keeps fetched dependencies under GPUI_SHELL_HOME; AC5 reads that nothing lands there.
        let home = Scratch::new();
        // SAFETY: set once, before any thread that reads the environment starts.
        unsafe { std::env::set_var("GPUI_SHELL_HOME", &home.0) };
        deep_app::views::set_state(deep_replica::load_state());
        let code = super::common::run(&[
            (
                "git_dependency_refused_at_install_and_never_fetched",
                git_dependency_refused_at_install_and_never_fetched,
            ),
            (
                "four_faults_refused_each_with_its_own_message",
                four_faults_refused_each_with_its_own_message,
            ),
            (
                "the_card_is_drawn_at_its_rect",
                the_card_is_drawn_at_its_rect,
            ),
            ("nothing_covers_the_card", nothing_covers_the_card),
            // Last: it installs the one record reader, which then feeds every view in this process.
            (
                "needs_you_and_session_page_share_each_log_pos",
                needs_you_and_session_page_share_each_log_pos,
            ),
        ]);
        drop(home);
        code
    }
}
