//! #326, criterion group "panels": the wrong programs the criteria name, run through the same
//! judges as the app's suite (`panels.rs`), to show each judge fails them, naming what the issue
//! says. They use only what the base commit already has (gpui-kit, gpui-shell, `deep_app::init`,
//! `deep_app::new_runtime`, `deep_app::mount_panel`), so they run and pass at the base: they test
//! the tests, not #326.
//!
//! - AC6's "host that blocks only the network": gpui-shell's runtime with a policy that grants
//!   every program and blocks the network, nothing watching focus or paint, refusing only the
//!   network panel. The judge fails it naming program, focus and draw, and each of those three
//!   fixtures is seen doing its fault.
//! - AC7's "host that clips only ordinary paints": a window rooted at gpui-base's `Root`, the
//!   panel in a 260-point slot that clips its children, the card painted after it, and a refusal
//!   naming every component. Overlays paint above it, so the judge fails on the dialog first,
//!   naming it.
//! - AC5's load half: the base's `deep_app::mount_panel` fetches the manifest's dependency, which
//!   the listener sees.
//!
//! Wired into deep-replica by one `[[test]]` entry (README, How to run):
//!     cargo test --locked -p deep-replica --test acceptance_326_panels_planted

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
        println!("acceptance_326_panels_planted: INCONCLUSIVE; window captures need macOS, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::{path::Path, rc::Rc};

    use gpui_kit::prelude::FluentBuilder as _;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::*;
    use gpui_shell::{Capabilities, ExecuteGrant, ScriptView, ShellRuntime};

    use super::common::*;

    /// The planted host's root: the panel in a slot at the window's left, 260 x 862 points, and
    /// the question card painted after it at `CARD`.
    struct Host {
        panel: Option<Entity<ScriptView>>,
        clip: bool,
    }

    impl Render for Host {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .relative()
                .bg(rgb(0xffffff))
                .child(
                    div()
                        .id("planted-slot")
                        .absolute()
                        .left(px(0.))
                        .top(px(0.))
                        .w(px(260.))
                        .h(px(862.))
                        .when(self.clip, |slot| slot.overflow_hidden())
                        .children(self.panel.clone()),
                )
                .child(
                    div()
                        .absolute()
                        .left(px(CARD.0))
                        .top(px(CARD.1))
                        .w(px(CARD.2))
                        .h(px(CARD.3))
                        .bg(rgb(0x1f6f5c))
                        .border_2()
                        .border_color(rgb(0x0b3d2e))
                        .text_color(rgb(0xffffff))
                        .p_4()
                        .child("Question card (planted host)"),
                )
        }
    }

    fn slot() -> Bounds<Pixels> {
        Bounds {
            origin: point(px(0.), px(0.)),
            size: size(px(260.), px(862.)),
        }
    }

    struct Opened {
        cx: HeadlessAppContext,
        handle: AnyWindowHandle,
        _runtime: Rc<ShellRuntime>,
    }

    fn open_planted(panel: Option<&Path>, clip: bool, capabilities: Capabilities) -> Opened {
        let mut cx = deep_replica::headless_context();
        // `deep_app::init` installed the app's empty policy; the planted host widens it.
        gpui_shell::policy::update_default(|policy| policy.with_capabilities(capabilities));
        let runtime = deep_app::new_runtime().expect("the panel runtime");
        let handle = cx.update(|cx| {
            gpui_kit::open_window(deep_replica::shell::window_options(), cx, |window, cx| {
                let panel = panel.map(|dir| {
                    deep_app::mount_panel(&runtime, dir, window, cx).unwrap_or_else(|error| {
                        panic!("{} failed to load: {error:#}", dir.display())
                    })
                });
                let host = cx.new(|_| Host { panel, clip });
                cx.new(|cx| gpui_kit::base::Root::new(host, window, cx))
            })
            .expect("the planted window opens")
            .0
        });
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
        Opened {
            cx,
            handle,
            _runtime: runtime,
        }
    }

    fn alone(clip: bool) -> Capture {
        let mut opened = open_planted(None, clip, Capabilities::new());
        settle(&mut opened.cx, opened.handle, 200);
        capture(&mut opened.cx, opened.handle)
    }

    /// AC6: the four fixtures in a host that blocks only the network.
    fn network_only_host_fails_naming_the_other_three() {
        let reference = alone(false);
        let mut runs = Vec::new();
        for fault in FAULTS {
            let scratch = Scratch::new();
            let listener = Listener::new();
            let marker = scratch.0.join("program-ran");
            let port = listener.port.to_string();
            let dir = copy_fixture(
                &format!("faults/{fault}"),
                &scratch,
                &[
                    ("__PORT__", &port),
                    ("__MARKER__", &marker.display().to_string()),
                ],
            );
            let mut opened = open_planted(
                Some(&dir),
                false,
                Capabilities::new().execute(ExecuteGrant::Unrestricted),
            );
            let before = opened
                .cx
                .update_window(opened.handle, |_, window, cx| window.focused(cx))
                .unwrap();
            settle(&mut opened.cx, opened.handle, 500);
            let after = opened
                .cx
                .update_window(opened.handle, |_, window, cx| window.focused(cx))
                .unwrap();
            let shot = capture(&mut opened.cx, opened.handle);
            let happened = observed(
                fault,
                &listener,
                &marker,
                before != after,
                &shot,
                &reference,
                slot(),
            );
            // The host blocks the network by policy and refuses that panel; it checks nothing else.
            let refusal = (fault == "network").then(|| "reaches the network".to_owned());
            runs.push(FaultRun {
                fault,
                refusal,
                happened,
            });
        }
        for run in &runs {
            println!(
                "  planted network-only host, {}: {:?}",
                run.fault, run.happened
            );
        }
        // The fixtures are real: in this host each of the other three did its fault, and the
        // network one reached nothing.
        for run in &runs {
            assert_eq!(
                run.happened.is_some(),
                run.fault != "network",
                "{}: the fixture's fault {} in a host that blocks only the network",
                run.fault,
                if run.happened.is_some() {
                    "happened"
                } else {
                    "never happened"
                }
            );
        }
        let failure =
            judge_faults(&runs).expect_err("the judge passed a host that blocks only the network");
        println!("  judge: {}", failure.replace('\n', "\n         "));
        let named: Vec<&str> = failure
            .lines()
            .map(|line| line.split(':').next().unwrap())
            .collect();
        assert_eq!(
            named,
            ["program", "focus", "draw"],
            "the judge names the other three: {failure}"
        );
    }

    /// The network fixture is real: in a host that grants 127.0.0.1, its request arrives.
    fn network_fixture_connects_when_granted() {
        let scratch = Scratch::new();
        let listener = Listener::new();
        let dir = copy_fixture(
            "faults/network",
            &scratch,
            &[("__PORT__", &listener.port.to_string())],
        );
        let mut opened = open_planted(
            Some(&dir),
            false,
            Capabilities::new().network_hosts(["127.0.0.1".to_owned()]),
        );
        settle(&mut opened.cx, opened.handle, 500);
        // fetch runs on the background executor; give it real time too.
        for _ in 0..20 {
            if listener.connections() > 0 {
                break;
            }
            settle(&mut opened.cx, opened.handle, 50);
        }
        assert!(
            listener.connections() > 0,
            "the network fixture never reached the listener"
        );
    }

    /// AC7: the nine panels in a host that clips only ordinary paints.
    fn clip_only_host_fails_on_the_dialog() {
        let reference = alone(true);
        let mut runs = Vec::new();
        for component in COMPONENTS {
            let scratch = Scratch::new();
            let dir = copy_fixture(&format!("components/{}", component.dir), &scratch, &[]);
            let mut opened = open_planted(Some(&dir), true, Capabilities::new());
            open(&mut opened.cx, opened.handle, component.open, slot());
            let shot = capture(&mut opened.cx, opened.handle);
            println!(
                "  planted clip-only host, {}: magenta {} the card",
                component.name,
                if shot.has_magenta(Some(card_device())) {
                    "inside"
                } else {
                    "not inside"
                }
            );
            runs.push(CardRun {
                component,
                // It names every component it is shown, so only the pixels can fail it.
                refusal: Some(format!("refused: {}", component.words[0])),
                difference: first_interior_difference(&shot, &reference, card_device()),
            });
        }
        let failure = judge_cards(&runs)
            .expect_err("the judge passed a host that clips only ordinary paints");
        println!("  judge: {}", failure.replace('\n', "\n         "));
        let first = failure.lines().next().unwrap();
        assert!(
            first.starts_with("dialog: the card's interior differs"),
            "the judge fails on the dialog first, naming it: {failure}"
        );
        // Clipping is what this host does: the two layouts stay in their slot.
        for run in runs
            .iter()
            .filter(|run| run.component.words == ["outside its panel"])
        {
            assert_eq!(
                run.difference, None,
                "{}: the clipping host let it reach the card",
                run.component.name
            );
        }
    }

    /// The fixtures the clipping host keeps in their slot are real: in a host that clips nothing,
    /// the command palette and both layouts paint outside their slot.
    fn unclipped_layouts_paint_outside_their_slot() {
        let reference = alone(false);
        for component in COMPONENTS
            .iter()
            .filter(|component| component.open == Open::Itself && component.dir != "popover")
        {
            let scratch = Scratch::new();
            let dir = copy_fixture(&format!("components/{}", component.dir), &scratch, &[]);
            let mut opened = open_planted(Some(&dir), false, Capabilities::new());
            open(&mut opened.cx, opened.handle, component.open, slot());
            let shot = capture(&mut opened.cx, opened.handle);
            let outside = first_difference_outside(&shot, &reference, device(slot()));
            println!(
                "  unclipped host, {}: outside its slot at {outside:?}",
                component.name
            );
            assert!(
                outside.is_some(),
                "{}: the fixture never painted outside its slot",
                component.name
            );
        }
    }

    /// AC4's wrong app: a view that subscribes for itself. Needs you and the session page each hold
    /// a base `RecordReader` of their own; after a frame reaches one before the other, the two
    /// show different log positions, and the hub sees two subscriptions. This is also the test
    /// hub serving the base's reader, so a failure in `panels.rs` is the app's, not the hub's.
    fn a_view_with_its_own_subscription_disagrees() {
        use super::hub::*;
        use deep_app::record::RecordReader;
        let hub = Hub::start();
        let mut needs_you = RecordReader::open(&hub.socket, &hub.token_file)
            .expect("a reader opens on the test hub");
        let mut session =
            RecordReader::open(&hub.socket, &hub.token_file).expect("a second reader opens");
        let open_asks = |reader: &RecordReader| {
            reader
                .view()
                .inbox
                .iter()
                .filter(|row| row["status"] != "closed")
                .count()
        };
        hub.append(ask_created(1));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while open_asks(&needs_you) < 1 {
            needs_you
                .poll(std::time::Duration::from_millis(100))
                .expect("the reader polls");
            assert!(
                std::time::Instant::now() < deadline,
                "the base reader never saw the frame"
            );
        }
        assert_eq!(
            needs_you.view().log_pos,
            1,
            "the base reader moved to the frame's log_pos"
        );
        // The session page's own reader hasn't been polled since the frame: it lags.
        assert_ne!(
            open_asks(&needs_you),
            open_asks(&session),
            "two readers polled apart agreed, so this wrong app can't fail the same-log_pos check"
        );
        assert_eq!(
            hub.subscriptions(),
            2,
            "two views that subscribe for themselves make two subscriptions"
        );
        session
            .poll(std::time::Duration::from_millis(100))
            .expect("the reader polls");
    }

    /// AC5's load half: the base's loader fetches a manifest's dependency, so the load check fails
    /// on it.
    fn base_loader_reaches_the_network() {
        let scratch = Scratch::new();
        let listener = Listener::new();
        let dir = copy_fixture(
            "fetched-dependency",
            &scratch,
            &[("__PORT__", &listener.port.to_string())],
        );
        let mut cx = deep_replica::headless_context();
        let runtime = deep_app::new_runtime().expect("the panel runtime");
        let loaded = cx.update(|cx| {
            gpui_kit::open_window(deep_replica::shell::window_options(), cx, |window, cx| {
                let result = deep_app::mount_panel(&runtime, &dir, window, cx).map(|_| ());
                cx.new(|_| Loaded(result.map_err(|error| format!("{error:#}"))))
            })
            .unwrap()
        });
        let outcome = cx.update(|cx| loaded.1.read(cx).0.clone());
        println!("  base loader: {outcome:?}");
        assert!(
            listener.connections() > 0,
            "the base loader reached no host, so this wrong program can't fail the load check"
        );
    }

    struct Loaded(Result<(), String>);
    impl Render for Loaded {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }

    pub fn run() -> i32 {
        // gpui-shell keeps fetched dependencies under GPUI_SHELL_HOME; keep this run's out of ~.
        let home = Scratch::new();
        // SAFETY: set once, before any thread that reads the environment starts.
        unsafe { std::env::set_var("GPUI_SHELL_HOME", &home.0) };
        let code = super::common::run(&[
            (
                "network_only_host_fails_naming_the_other_three",
                network_only_host_fails_naming_the_other_three,
            ),
            (
                "network_fixture_connects_when_granted",
                network_fixture_connects_when_granted,
            ),
            (
                "clip_only_host_fails_on_the_dialog",
                clip_only_host_fails_on_the_dialog,
            ),
            (
                "unclipped_layouts_paint_outside_their_slot",
                unclipped_layouts_paint_outside_their_slot,
            ),
            (
                "base_loader_reaches_the_network",
                base_loader_reaches_the_network,
            ),
            (
                "a_view_with_its_own_subscription_disagrees",
                a_view_with_its_own_subscription_disagrees,
            ),
        ]);
        drop(home);
        code
    }
}
