//! PROPOSAL for #1620, not wired anywhere and replacing nothing until a maintainer approves.
//!
//! Redraft of `tests/acceptance/326/panels/planted.rs › base_loader_reaches_the_network`
//! (#326 AC5, `#326.0a9b47e1`: "A panel package whose gpui-shell manifest lists a git dependency
//! is refused at install, naming the dependency, and loading it makes no network request").
//!
//! Why: that planted test's wrong program is "the base's `deep_app::mount_panel`". Since #326 that
//! function refuses the dependency before gpui-shell reads it (`admit`, `fetched_dependency`), so
//! the wrong program no longer exists in the product and the test fails its "the base loader
//! reached no host" assertion. A planted wrong program must not be the product's own loader. This
//! one is built from gpui-kit and gpui-shell alone, as `redraft-ac7/planted_redraft.rs` does for
//! AC7: gpui-shell's `ShellRuntime::load_application`, with none of DeepBuild's checks.
//!
//! The judge below states exactly what `panels.rs › git_dependency_refused_at_install_and_never_fetched`
//! asserts about a load (refused naming the dependency; zero connections to its host), so a wrong
//! loader is rejected by the same words. The app itself is judged by `panels.rs`, unchanged; it
//! is not repeated here.
//!
//! Wrong programs and the assertion that rejects each:
//!   1. `bare_gpui_shell_loader_is_rejected`: gpui-shell's loader, no admission check. It fetches
//!      the dependency. Rejected by "the load reached the dependency's host" (and, with no refusal,
//!      "no refusal naming pad-326").
//!   2. `refuse_after_fetching_loader_is_rejected`: loads first, then refuses naming `pad-326`.
//!      The refusal is right but the request was already made. Rejected only by "the load reached
//!      the dependency's host".
//!   3. `refuse_without_naming_loader_is_rejected`: refuses before loading, naming nothing.
//!      Rejected only by "no refusal naming pad-326".
//!
//! Proposed wiring (a maintainer's edit to crates/deep-replica/Cargo.toml, not made here):
//!     [[test]]
//!     name = "acceptance_1620_planted_loader"
//!     path = "../../tests/acceptance/1620/planted_loader_proposal.rs"
//!     harness = false
//! Run:
//!     cargo test --locked -p deep-replica --test acceptance_1620_planted_loader
//! Needs macOS (the window is hosted by gpui-kit's offscreen renderer); elsewhere it prints
//! INCONCLUSIVE and exits 1, never PASS. NOT RUN by the author: no tool here can build or run it.

#[path = "../326/panels/common.rs"]
mod common;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_1620_planted_loader: INCONCLUSIVE; the window needs macOS, so nothing ran");
        std::process::exit(1);
    }
}

/// What a load of the fetched-dependency fixture must look like. Mirrors AC5's two observations.
fn judge_load(dependency: &str, refusal: Option<&str>, connections: usize) -> Result<(), String> {
    let mut failures = Vec::new();
    match refusal {
        Some(message) if message.contains(dependency) => {}
        Some(message) => failures.push(format!(
            "the refusal doesn't name the dependency {dependency}: {message:?}"
        )),
        None => failures.push(format!("no refusal naming {dependency}: the package loaded")),
    }
    if connections > 0 {
        failures.push(format!(
            "the load reached the dependency's host ({connections} connection(s))"
        ));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::{path::Path, rc::Rc, sync::Arc};

    use gpui_kit::*;
    use gpui_shell::{policy::Policy, ShellRuntime};

    use super::common::*;
    use super::judge_load;

    const DEPENDENCY: &str = "pad-326";

    /// How the planted loader treats the package.
    #[derive(Clone, Copy)]
    enum Loader {
        /// gpui-shell's loader and nothing else.
        Bare,
        /// Loads, then refuses naming the dependency.
        RefusesAfterFetching,
        /// Refuses before loading, saying nothing of the dependency.
        RefusesWithoutNaming,
    }

    struct Blank;
    impl Render for Blank {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }

    /// A headless app with gpui-shell's catalog and an empty policy; nothing of DeepBuild's (no
    /// `deep_app::init`, no `deep_app::mount_panel`).
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

    /// Loads `dir` through the planted loader; answers its refusal, if any.
    fn load(loader: Loader, runtime: &Rc<ShellRuntime>, dir: &Path, cx: &mut HeadlessAppContext) -> Option<String> {
        // The toolkit alone serves @deepbuild/panel, as redraft-ac7 does, so the fixture's first
        // import resolves and only the dependency is in question.
        std::fs::create_dir_all(dir.join("@deepbuild")).unwrap();
        std::fs::write(
            dir.join("@deepbuild/panel.js"),
            "export { View, div } from \"gpui-kit\";\n",
        )
        .unwrap();
        if let Loader::RefusesWithoutNaming = loader {
            return Some("refused: a panel may not do that".to_owned());
        }
        let outcome = cx.update(|cx| {
            let mut outcome = None;
            gpui_kit::open_window(window_options(), cx, |window, cx| {
                // gpui-shell reads the manifest, and fetches its Git dependencies, here.
                outcome = Some(
                    runtime
                        .load_application(dir, "main.js")
                        .and_then(|loaded| runtime.mount_application(&loaded, window, cx))
                        .map(|_| ())
                        .map_err(|error| format!("{error:#}")),
                );
                cx.new(|_| Blank)
            })
            .expect("the planted window opens");
            outcome.unwrap()
        });
        cx.run_until_parked();
        match loader {
            Loader::Bare => None, // admits the package; a load error is gpui-shell's, not a refusal
            Loader::RefusesAfterFetching => Some(format!(
                "refused: its manifest lists the Git dependency {DEPENDENCY} (after a load that said {outcome:?})"
            )),
            Loader::RefusesWithoutNaming => unreachable!(),
        }
    }

    fn judged(loader: Loader) -> Result<(), String> {
        let scratch = Scratch::new();
        let listener = Listener::new();
        let dir = copy_fixture(
            "fetched-dependency",
            &scratch,
            &[("__PORT__", &listener.port.to_string())],
        );
        let mut cx = headless();
        let runtime = gpui_shell::components::new_isolated_runtime().expect("gpui-shell's runtime starts");
        let refusal = load(loader, &runtime, &dir, &mut cx);
        let connections = listener.connections();
        println!("  planted loader: refusal {refusal:?}, {connections} connection(s)");
        judge_load(DEPENDENCY, refusal.as_deref(), connections)
    }

    fn bare_gpui_shell_loader_is_rejected() {
        let failure = judged(Loader::Bare).expect_err("the judge passed a loader that fetches the dependency");
        println!("  judge: {}", failure.replace('\n', "\n         "));
        // The fixture is real: the wrong loader did reach the host. Without this the rejection
        // would rest on the missing refusal alone.
        assert!(
            failure.contains("the load reached the dependency's host"),
            "the bare loader never reached the host, so the fixture doesn't show the fault: {failure}"
        );
        assert!(
            failure.contains(&format!("no refusal naming {DEPENDENCY}")),
            "the judge didn't also name the missing refusal: {failure}"
        );
    }

    fn refuse_after_fetching_loader_is_rejected() {
        let failure = judged(Loader::RefusesAfterFetching)
            .expect_err("the judge passed a loader that refuses only after fetching");
        println!("  judge: {}", failure.replace('\n', "\n         "));
        assert_eq!(
            failure.lines().collect::<Vec<_>>().len(),
            1,
            "the refusal names the dependency, so only the request fails it: {failure}"
        );
        assert!(failure.contains("the load reached the dependency's host"), "{failure}");
    }

    fn refuse_without_naming_loader_is_rejected() {
        let failure = judged(Loader::RefusesWithoutNaming)
            .expect_err("the judge passed a refusal that names no dependency");
        println!("  judge: {}", failure.replace('\n', "\n         "));
        assert!(failure.contains("doesn't name the dependency pad-326"), "{failure}");
        assert!(
            !failure.contains("reached the dependency's host"),
            "this loader loads nothing, so no request: {failure}"
        );
    }

    pub fn run() -> i32 {
        // gpui-shell keeps fetched dependencies under GPUI_SHELL_HOME; keep this run's out of ~.
        let home = Scratch::new();
        // SAFETY: set once, before any thread that reads the environment starts.
        unsafe { std::env::set_var("GPUI_SHELL_HOME", &home.0) };
        let code = super::common::run(&[
            ("bare_gpui_shell_loader_is_rejected", bare_gpui_shell_loader_is_rejected),
            ("refuse_after_fetching_loader_is_rejected", refuse_after_fetching_loader_is_rejected),
            ("refuse_without_naming_loader_is_rejected", refuse_without_naming_loader_is_rejected),
        ]);
        drop(home);
        code
    }
}
