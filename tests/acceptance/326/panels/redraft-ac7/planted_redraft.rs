//! #326 AC7 (`#326.b3443ee3`), blind redraft of the two planted hosts in `../planted.rs`:
//! `clip_only_host_fails_on_the_dialog` and `unclipped_layouts_paint_outside_their_slot`.
//!
//! A planted host is a wrong program built for the test, so it is built from gpui-kit and
//! gpui-shell alone and loads each fixture through gpui-shell's own loader
//! (`ShellRuntime::load_application`, then `mount_application`), never through the app's
//! (`deep_app::init`, `deep_app::new_runtime`, `deep_app::mount_panel`). The design's Panel
//! section has a panel import only `@deepbuild/panel` and the app refuse one that imports a
//! toolkit module, at pack check and again at load. The fixtures import `gpui-kit`, `gpui-base`
//! and `gpui-component`, so a host on the app's loader may stop loading them once that lands,
//! while gpui-shell's loader loads them today and under that design.
//!
//! The judges, the fixtures, the card's rect and the input that opens each component are the
//! suite's, from `../common.rs`, unchanged.
//!
//!     cargo test --locked -p deep-replica --test acceptance_326_panels_planted_redraft

#[path = "../common.rs"]
mod common;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!(
            "acceptance_326_panels_planted_redraft: INCONCLUSIVE; window captures need macOS, so nothing ran"
        );
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::{path::Path, rc::Rc, sync::Arc};

    use gpui_kit::prelude::FluentBuilder as _;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::*;
    use gpui_shell::{policy::Policy, ScriptView, ShellRuntime};

    use super::common::*;

    /// The planted host's root: the panel in a slot at the window's left, 260 x 862 points, and
    /// the question card painted after it at `CARD`. With `clip`, the slot clips its children:
    /// ordinary paints stay in it, and nothing else is kept off the card.
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

    /// The reference window, 1512 x 982 points, hidden and unfocused.
    fn window_options() -> WindowOptions {
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Point::default(),
                size: size(px(WINDOW.0), px(WINDOW.1)),
            })),
            titlebar: None,
            focus: false,
            show: false,
            ..Default::default()
        }
    }

    /// A headless app with gpui-shell's component catalog and an empty policy, and nothing of the
    /// app's: no `deep_app::init`, so no policy, module or loader of DeepBuild's.
    fn headless() -> HeadlessAppContext {
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(gpui_kit::assets::Assets),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_shell::components::init(cx);
            gpui_shell::policy::set_default(Policy::new());
        });
        cx
    }

    struct Opened {
        cx: HeadlessAppContext,
        handle: AnyWindowHandle,
        _runtime: Rc<ShellRuntime>,
    }

    /// Opens the planted host, with the package in `panel` loaded and mounted in its slot by
    /// gpui-shell's loader over gpui-shell's catalog. A package that doesn't load fails the test.
    fn open_planted(panel: Option<&Path>, clip: bool) -> Opened {
        let mut cx = headless();
        let runtime =
            gpui_shell::components::new_isolated_runtime().expect("gpui-shell's runtime starts");
        let handle = cx.update(|cx| {
            gpui_kit::open_window(window_options(), cx, |window, cx| {
                let panel = panel.map(|dir| {
                    runtime
                        .load_application(dir, "main.js")
                        .and_then(|loaded| runtime.mount_application(&loaded, window, cx))
                        .unwrap_or_else(|error| {
                            panic!("{} failed to load: {error:#}", dir.display())
                        })
                });
                cx.new(|_| Host { panel, clip })
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

    /// The host with no panel: the card alone at its rect.
    fn alone(clip: bool) -> Capture {
        let mut opened = open_planted(None, clip);
        settle(&mut opened.cx, opened.handle, 200);
        let shot = capture(&mut opened.cx, opened.handle);
        assert_eq!(
            (shot.width, shot.height),
            ((WINDOW.0 * SCALE) as u32, (WINDOW.1 * SCALE) as u32),
            "the planted window is the reference window at 2x"
        );
        shot
    }

    /// AC7's wrong program: a host that clips only ordinary paints. It clips the panel's slot and
    /// refuses every component, naming it, so only the card's pixels can fail it. The judge must
    /// fail it on the dialog, the first component, naming it.
    fn clip_only_host_fails_on_the_dialog() {
        let reference = alone(true);
        let mut runs = Vec::new();
        for component in COMPONENTS {
            let scratch = Scratch::new();
            let dir = copy_fixture(&format!("components/{}", component.dir), &scratch, &[]);
            let mut opened = open_planted(Some(&dir), true);
            let mounted = capture(&mut opened.cx, opened.handle);
            open(&mut opened.cx, opened.handle, component.open, slot());
            let shot = capture(&mut opened.cx, opened.handle);
            // The host really shows the fixture: it drew, and the input a person gives opened it.
            assert_ne!(
                shot.rgba, reference.rgba,
                "{}: the planted host drew nothing of it",
                component.name
            );
            if component.open != Open::Itself {
                assert_ne!(
                    shot.rgba, mounted.rgba,
                    "{}: the input ({:?}) changed nothing in the planted host",
                    component.name, component.open
                );
            }
            let difference = first_interior_difference(&shot, &reference, card_device());
            println!(
                "  planted clip-only host, {}: card interior {}, magenta {} the card",
                component.name,
                match difference {
                    Some((x, y)) => format!("differs at ({x}, {y})"),
                    None => "equal".to_owned(),
                },
                if shot.has_magenta(Some(card_device())) {
                    "inside"
                } else {
                    "not inside"
                }
            );
            runs.push(CardRun {
                component,
                refusal: Some(format!("refused: {}", component.words[0])),
                difference,
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
        // Clipping is what this host does: the two layouts, ordinary paints, stay in their slot.
        for run in runs
            .iter()
            .filter(|run| run.component.words == ["outside its panel"])
        {
            assert_eq!(
                run.difference, None,
                "{}: the clipping host let an ordinary paint reach the card",
                run.component.name
            );
        }
    }

    /// The fixtures the clipping host keeps in their slot are real: in the same host with no clip,
    /// the command palette and both layouts paint outside their slot.
    fn unclipped_layouts_paint_outside_their_slot() {
        let reference = alone(false);
        let shown: Vec<Component> = COMPONENTS
            .into_iter()
            .filter(|component| component.open == Open::Itself && component.dir != "popover")
            .collect();
        assert_eq!(
            shown
                .iter()
                .map(|component| component.dir)
                .collect::<Vec<_>>(),
            ["command-palette", "twice-slot", "grows"],
            "the fixtures this test shows"
        );
        for component in shown {
            let scratch = Scratch::new();
            let dir = copy_fixture(&format!("components/{}", component.dir), &scratch, &[]);
            let mut opened = open_planted(Some(&dir), false);
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

    pub fn run() -> i32 {
        // gpui-shell keeps fetched dependencies under GPUI_SHELL_HOME; keep this run's out of ~.
        let home = Scratch::new();
        // SAFETY: set once, before any thread that reads the environment starts.
        unsafe { std::env::set_var("GPUI_SHELL_HOME", &home.0) };
        let code = super::common::run(&[
            (
                "clip_only_host_fails_on_the_dialog",
                clip_only_host_fails_on_the_dialog,
            ),
            (
                "unclipped_layouts_paint_outside_their_slot",
                unclipped_layouts_paint_outside_their_slot,
            ),
        ]);
        drop(home);
        code
    }
}
