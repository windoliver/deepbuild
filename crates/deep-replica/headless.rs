//! Issue #338: the replica's checks. Every test here runs the app headless on GPUI's virtual
//! clock, draws over the fixture record, and writes what it saw under `$DEEP_338_OUT` (a temp
//! directory when unset). AppKit needs the main thread for the offscreen Metal renderer, so
//! this target runs without the libtest harness and prints libtest's result lines.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS the suite is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!("headless: INCONCLUSIVE; the replica renders pixels on macOS only, so none of the #338 checks ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::{
        path::{Path, PathBuf},
        process::Command,
        rc::Rc,
        sync::Arc,
        time::Instant,
    };

    use deep_app::views::{Layout, LINE, NEEDS_YOU, SHIPPED_VIEWS, SIDEBAR};
    use deep_replica::{
        kit, panel_dir, repo_root,
        shell::{open_shell, panel_names, rows_of, script_panel, script_tree},
        snapshot::{first_difference, from_observed, Snapshot},
        SCALE, WINDOW,
    };
    use gpui_kit::base::dock::DockPlacement;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        assets::Assets, AnyWindowHandle, AppContext as _, HeadlessAppContext, TestAppContext,
        TestDispatcher,
    };
    use gpui_shell::{ScriptView, ShellRuntime};
    use serde_json::{json, Value};

    const SCRIPT: &str = "shell:deepbuild-panel/";
    const PLANTED: [&str; 4] = ["cap20", "drop-folded", "list-superseded", "hide-newest"];

    fn out() -> PathBuf {
        let out = std::env::var_os("DEEP_338_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!("deep-338-{}", std::process::id()))
            });
        std::fs::create_dir_all(&out).expect("the output directory");
        out
    }

    fn write_json(path: &Path, value: &Value) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("the output directory");
        }
        std::fs::write(path, serde_json::to_string_pretty(value).expect("JSON"))
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    }

    fn read_json(path: &Path) -> Value {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| json!({}))
    }

    /// Adds `value` at `keys` inside the JSON file at `path`, keeping what is there.
    fn merge_json(path: &Path, keys: &[&str], value: Value) {
        let mut root = read_json(path);
        let mut slot = &mut root;
        for key in keys {
            if !slot.is_object() {
                *slot = json!({});
            }
            slot = slot
                .as_object_mut()
                .expect("an object")
                .entry(*key)
                .or_insert(json!({}));
        }
        *slot = value;
        write_json(path, &root);
    }

    fn expected_rows() -> Vec<String> {
        deep_replica::load_state().inbox.rows()
    }

    // The replica binary.

    /// Runs the replica for `view` into `out`; answers the ms from spawn to its first drawn frame.
    fn replica(view: &str, out: &Path) -> f64 {
        use std::io::BufRead as _;
        let start = Instant::now();
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-replica"))
            .args(["--view", view, "--out"])
            .arg(out)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("deep-replica spawns");
        let mut stdout = std::io::BufReader::new(child.stdout.take().expect("a piped stdout"));
        let mut line = String::new();
        let mut first_frame = None;
        while stdout.read_line(&mut line).expect("stdout reads") > 0 {
            if line.trim_end() == deep_replica::FIRST_FRAME {
                first_frame = Some(start.elapsed().as_secs_f64() * 1000.);
            }
            print!("{line}");
            line.clear();
        }
        let status = child.wait().expect("deep-replica exits");
        assert!(status.success(), "deep-replica {view} exited with {status}");
        first_frame.unwrap_or_else(|| panic!("deep-replica {view} never reported its first frame"))
    }

    fn replica_launch_under_two_seconds() {
        let scratch = std::env::temp_dir().join(format!("deep-338-launch-{}", std::process::id()));
        // One warm-up pays for paging the freshly linked debug binary in; the five measured
        // launches each start a new process.
        replica("needs-you", &scratch);
        let launches: Vec<f64> = (0..5)
            .map(|_| (replica("needs-you", &scratch) * 10.).round() / 10.)
            .collect();
        let _ = std::fs::remove_dir_all(&scratch);
        write_json(&out().join("launch-ms.json"), &json!(launches));
        for ms in &launches {
            assert!(*ms < 2000., "a launch took {ms} ms: {launches:?}");
        }
    }

    fn png_size(path: &Path) -> (u32, u32) {
        let bytes =
            std::fs::read(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert!(
            bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "{} is not a PNG",
            path.display()
        );
        let be = |at: usize| {
            u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
        };
        (be(16), be(20))
    }

    fn view_snapshot(view: &str) -> Snapshot {
        let out = out();
        replica(view, &out);
        let snapshot = Snapshot::read(&out.join("snapshots").join(format!("{view}.json")))
            .expect("the replica wrote a snapshot");
        assert_eq!(snapshot.size, [WINDOW.0 as u32, WINDOW.1 as u32]);
        assert_eq!(snapshot.scale, SCALE as u32);
        let device = [(WINDOW.0 * SCALE) as i64, (WINDOW.1 * SCALE) as i64];
        for node in snapshot.flatten() {
            let [x, y, w, h] = node.bounds;
            assert!(
                x >= 0 && y >= 0 && w >= 0 && h >= 0 && x + w <= device[0] && y + h <= device[1],
                "{view}: {} {:?} lies outside the window: {:?}",
                node.role,
                node.name,
                node.bounds
            );
        }
        assert!(
            snapshot.flatten().iter().any(|node| node.role == "label"),
            "{view}: the tree has no labelled node"
        );
        let (width, height) = png_size(&out.join("screens").join(format!("{view}.png")));
        assert_eq!(
            (width, height),
            (device[0] as u32, device[1] as u32),
            "{view}: screenshot size"
        );
        snapshot
    }

    fn needs_you_view_snapshot() {
        let snapshot = view_snapshot("needs-you");
        let labels: Vec<&str> = snapshot
            .flatten()
            .into_iter()
            .filter_map(|node| node.name.as_deref())
            .filter(|name| name.starts_with("ask:"))
            .collect();
        assert_eq!(
            labels,
            expected_rows(),
            "the Needs you view lists the projection's rows"
        );
    }

    fn sidebar_view_snapshot() {
        let snapshot = view_snapshot("sidebar");
        let buttons = snapshot
            .flatten()
            .into_iter()
            .filter(|node| node.role == "button")
            .count();
        assert_eq!(
            buttons,
            deep_replica::load_state().sessions.len(),
            "one button per session"
        );
    }

    fn session_view_snapshot() {
        let snapshot = view_snapshot("session");
        assert!(
            snapshot
                .items
                .iter()
                .any(|(id, value)| id == "session-line" && value.is_array()),
            "the session page's canvas drew its line: {:?}",
            snapshot.items
        );
    }

    // Script panels in the shell.

    fn context() -> HeadlessAppContext {
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(Assets),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        cx
    }

    struct Opened {
        cx: HeadlessAppContext,
        handle: AnyWindowHandle,
        shell: gpui_kit::Entity<deep_app::views::Shell>,
        /// The runtime and the mounted applications outlive the window, as in the app; a
        /// mounted application that drops releases the retained state its panels made.
        _runtime: Rc<ShellRuntime>,
        _mounted: Vec<gpui_kit::Entity<ScriptView>>,
    }

    /// Opens the shell on `layout` with the script panels under `panels` registered first.
    fn open_with(panels: &[&str], layout: &Layout) -> Opened {
        let mut cx = context();
        let runtime = deep_app::new_runtime().expect("the panel runtime");
        let dirs: Vec<PathBuf> = panels.iter().map(|panel| panel_dir(panel)).collect();
        let mut mounted = Vec::new();
        let (handle, shell) = cx.update(|cx| {
            open_shell(layout, cx, |window, cx| {
                for dir in &dirs {
                    mounted.push(
                        deep_app::mount_panel(&runtime, dir, window, cx).unwrap_or_else(|error| {
                            panic!("{} failed to load: {error:#}", dir.display())
                        }),
                    );
                }
            })
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            deep_app::canvas::clear_items();
            window.render_frame(cx);
        })
        .unwrap();
        Opened {
            cx,
            handle,
            shell,
            _runtime: runtime,
            _mounted: mounted,
        }
    }

    fn names(opened: &mut Opened, placement: DockPlacement) -> Vec<&'static str> {
        let shell = opened.shell.clone();
        opened
            .cx
            .update(|cx| panel_names(shell.read(cx).dock.read(cx), placement, cx))
    }

    fn tree_of(opened: &mut Opened, name: &str) -> String {
        let shell = opened.shell.clone();
        opened
            .cx
            .update_window(opened.handle, |_, window, cx| {
                window.render_frame(cx);
                let panel = script_panel(shell.read(cx).dock.read(cx), name, cx)
                    .unwrap_or_else(|| panic!("{name} is not a script panel in the dock"));
                script_tree(panel.read(cx).view().read(cx))
            })
            .unwrap()
    }

    fn script(slot: &str) -> String {
        format!("{SCRIPT}{slot}")
    }

    fn needs_you_layout() -> Layout {
        Layout {
            sidebar: SIDEBAR.into(),
            center: vec![script("needs-you")],
            active: 0,
            line: LINE.into(),
        }
    }

    /// The rows a Needs you panel from `dir` draws in the shell's center.
    fn panel_rows(dir: &str) -> Vec<String> {
        let mut opened = open_with(&[dir], &needs_you_layout());
        rows_of(&tree_of(&mut opened, &script("needs-you")))
    }

    fn fixture_panel_rows_match_projection() {
        let rows = panel_rows("338-needs-you");
        write_json(&out().join("needs-you/rows.json"), &json!(rows));
        assert_eq!(rows, expected_rows());
    }

    fn fixture_panel_passes_needs_you_kit() {
        let expected = expected_rows();
        let out = out();
        let fixture = kit::needs_you(&panel_rows("338-needs-you"), &expected);
        let mut planted = serde_json::Map::new();
        for id in PLANTED {
            let rows = panel_rows(&format!("338-{id}"));
            write_json(
                &out.join(format!("needs-you/planted/{id}.rows.json")),
                &json!(rows),
            );
            planted.insert(id.into(), kit::needs_you(&rows, &expected).to_json());
        }
        write_json(
            &out.join("needs-you/kit.json"),
            &json!({ "fixture": fixture.to_json(), "planted": planted }),
        );
        assert!(
            fixture.pass,
            "the fixture panel failed the kit: {fixture:?}"
        );
    }

    fn planted_fails(id: &str, names: &str) {
        let verdict = kit::needs_you(&panel_rows(&format!("338-{id}")), &expected_rows());
        assert!(!verdict.pass, "{id}: the kit passed a planted fault");
        assert_eq!(
            verdict.names.as_deref(),
            Some(names),
            "{id}: the kit named the wrong ask"
        );
    }

    fn planted_cap20_fails_kit() {
        let expected = expected_rows();
        planted_fails("cap20", &expected[20]);
    }

    fn planted_drop_folded_fails_kit() {
        let state = deep_replica::load_state();
        let first_folded = state
            .inbox
            .rows()
            .into_iter()
            .find(|row| state.inbox.folded.contains(row))
            .expect("a folded ask");
        planted_fails("drop-folded", &first_folded);
    }

    fn planted_list_superseded_fails_kit() {
        let state = deep_replica::load_state();
        planted_fails("list-superseded", &state.inbox.superseded[0]);
    }

    fn planted_hide_newest_fails_kit() {
        let expected = expected_rows();
        planted_fails("hide-newest", expected.last().expect("a row"));
    }

    // Parity with the live tree.

    fn replica_snapshot(view: &str) -> Snapshot {
        let path = out().join("snapshots").join(format!("{view}.json"));
        if !path.exists() {
            replica(view, &out());
        }
        Snapshot::read(&path).expect("the replica's snapshot")
    }

    fn replica_equals_live_tree() {
        let out = out();
        let mut failures = Vec::new();
        for view in SHIPPED_VIEWS {
            let live_path = repo_root().join(format!("docs/spikes/338/out/live/{view}.json"));
            let live = Snapshot::read(&live_path).unwrap_or_else(|error| {
                panic!("the live tree for {view} is missing; run deep-live on the reference Mac: {error}")
            });
            let replica = replica_snapshot(view);
            let verdict = match first_difference(&replica, &live) {
                None if replica.items != live.items => {
                    let why = format!(
                        "the canvas items differ: replica {:?} vs live {:?}",
                        replica.items, live.items
                    );
                    failures.push(format!("{view}: {why}"));
                    json!({ "result": "fail", "why": why })
                }
                None => json!({ "result": "pass" }),
                Some((index, why)) => {
                    failures.push(format!("{view}: {why}"));
                    json!({ "result": "fail", "firstNode": { "index": index }, "why": why })
                }
            };
            merge_json(&out.join("parity.json"), &[view], verdict);
        }
        assert!(
            failures.is_empty(),
            "the replica differs from the live tree:\n{}",
            failures.join("\n")
        );
    }

    fn scale1_snapshot(view: &str) -> Snapshot {
        let mut cx = TestAppContext::build(TestDispatcher::new(0), None);
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        let layout = Layout::shipped(view);
        let (handle, _) = cx.update(|cx| open_shell(&layout, cx, |_, _| {}));
        cx.simulate_window_scale_factor_change(handle, 1.0);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            deep_app::canvas::clear_items();
            window.render_frame(cx);
            from_observed(window)
        })
        .unwrap()
    }

    fn scale1_replica_differs_at_first_node() {
        let out = out();
        for view in SHIPPED_VIEWS {
            let scale1 = scale1_snapshot(view);
            assert_eq!(scale1.scale, 1, "{view}: the window is at scale 1");
            write_json(
                &out.join("snapshots").join(format!("{view}.scale1.json")),
                &scale1.to_json(),
            );
            let replica = replica_snapshot(view);
            let (index, why) = first_difference(&replica, &scale1)
                .unwrap_or_else(|| panic!("{view}: the scale-1 tree equals the 2x tree"));
            merge_json(
                &out.join("parity.json"),
                &["scale1", view],
                json!({ "result": "fail", "firstNode": { "index": index }, "why": why }),
            );
            assert_eq!(
                index, 0,
                "{view}: the first node differs, as the window's bounds do"
            );
        }
    }

    // The registry against the app's slots.

    fn slot_sidebar_from_registry() {
        let layout = Layout {
            sidebar: script("sidebar"),
            ..Layout::shipped("needs-you")
        };
        let mut opened = open_with(&["338-sidebar"], &layout);
        assert_eq!(names(&mut opened, DockPlacement::Left), [script("sidebar")]);
        assert_eq!(names(&mut opened, DockPlacement::Center), [NEEDS_YOU]);
        let tree = tree_of(&mut opened, &script("sidebar"));
        assert!(tree.contains("\"script sidebar\""), "{tree}");
    }

    fn slot_home_from_registry() {
        let layout = Layout {
            center: vec![script("home")],
            ..Layout::shipped("home")
        };
        let mut opened = open_with(&["338-home"], &layout);
        assert_eq!(names(&mut opened, DockPlacement::Center), [script("home")]);
        let tree = tree_of(&mut opened, &script("home"));
        assert!(tree.contains("\"script home\""), "{tree}");
    }

    fn slot_tab_from_registry() {
        let layout = Layout {
            center: vec![NEEDS_YOU.into(), script("tab")],
            active: 1,
            ..Layout::shipped("needs-you")
        };
        let mut opened = open_with(&["338-tab"], &layout);
        assert_eq!(
            names(&mut opened, DockPlacement::Center),
            [NEEDS_YOU.to_owned(), script("tab")]
        );
        let tree = tree_of(&mut opened, &script("tab"));
        assert!(tree.contains("\"script tab\""), "{tree}");
    }

    fn slot_line_from_registry() {
        let layout = Layout {
            line: script("line"),
            ..Layout::shipped("needs-you")
        };
        let mut opened = open_with(&["338-line"], &layout);
        assert_eq!(names(&mut opened, DockPlacement::Bottom), [script("line")]);
        let tree = tree_of(&mut opened, &script("line"));
        assert!(tree.contains("\"script line\""), "{tree}");
    }

    fn slot_replace_needs_you_from_registry() {
        let mut opened = open_with(&["338-needs-you"], &needs_you_layout());
        assert_eq!(
            names(&mut opened, DockPlacement::Center),
            [script("needs-you")]
        );
        assert_eq!(names(&mut opened, DockPlacement::Left), [SIDEBAR]);
        assert_eq!(names(&mut opened, DockPlacement::Bottom), [LINE]);
        let rows = rows_of(&tree_of(&mut opened, &script("needs-you")));
        assert_eq!(
            rows,
            expected_rows(),
            "the replacement draws the projection's rows"
        );
    }

    // The canvas.

    fn canvas_component_in_registry() {
        let registry = deep_app::components().expect("the component registry");
        let described = deep_app::canvas::describe(&registry).expect("Canvas is registered");
        write_json(&out().join("canvas.json"), &described);
        let arguments: Vec<&str> = described["arguments"]
            .as_array()
            .expect("arguments")
            .iter()
            .map(|argument| argument["name"].as_str().expect("a name"))
            .collect();
        assert_eq!(arguments, ["scene", "color"]);
        assert_eq!(described["retainedState"], json!(true));

        let layout = Layout {
            center: vec![script("canvas")],
            ..Layout::shipped("home")
        };
        let mut opened = open_with(&["338-canvas"], &layout);
        let tree = tree_of(&mut opened, &script("canvas"));
        assert!(tree.contains("Canvas"), "{tree}");
        let items = deep_app::canvas::items();
        assert!(
            items
                .iter()
                .any(|(id, value)| id == "script-line" && *value == json!([3., 1., 4., 1., 5.])),
            "the script's canvas drew its line: {items:?}"
        );
    }

    pub fn run() -> i32 {
        deep_app::views::set_state(deep_replica::load_state());
        let cases: [(&str, fn()); 17] = [
            (
                "replica_launch_under_two_seconds",
                replica_launch_under_two_seconds,
            ),
            ("needs_you_view_snapshot", needs_you_view_snapshot),
            ("sidebar_view_snapshot", sidebar_view_snapshot),
            ("session_view_snapshot", session_view_snapshot),
            (
                "fixture_panel_rows_match_projection",
                fixture_panel_rows_match_projection,
            ),
            (
                "fixture_panel_passes_needs_you_kit",
                fixture_panel_passes_needs_you_kit,
            ),
            ("planted_cap20_fails_kit", planted_cap20_fails_kit),
            (
                "planted_drop_folded_fails_kit",
                planted_drop_folded_fails_kit,
            ),
            (
                "planted_list_superseded_fails_kit",
                planted_list_superseded_fails_kit,
            ),
            (
                "planted_hide_newest_fails_kit",
                planted_hide_newest_fails_kit,
            ),
            ("replica_equals_live_tree", replica_equals_live_tree),
            (
                "scale1_replica_differs_at_first_node",
                scale1_replica_differs_at_first_node,
            ),
            ("slot_sidebar_from_registry", slot_sidebar_from_registry),
            ("slot_home_from_registry", slot_home_from_registry),
            ("slot_tab_from_registry", slot_tab_from_registry),
            ("slot_line_from_registry", slot_line_from_registry),
            (
                "slot_replace_needs_you_from_registry",
                slot_replace_needs_you_from_registry,
            ),
        ];
        let canvas: (&str, fn()) = ("canvas_component_in_registry", canvas_component_in_registry);
        // As libtest does, a positional argument narrows the run to the tests it names a part of.
        let filter = std::env::args().nth(1).filter(|arg| !arg.starts_with('-'));
        let cases: Vec<(&str, fn())> = cases
            .iter()
            .copied()
            .chain(std::iter::once(canvas))
            .filter(|(name, _)| filter.as_deref().is_none_or(|filter| name.contains(filter)))
            .collect();
        let total = cases.len();
        println!("\nrunning {total} tests");
        let mut failed = 0;
        for (name, case) in cases {
            let ok = std::panic::catch_unwind(case).is_ok();
            println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
            failed += usize::from(!ok);
        }
        println!(
            "\ntest result: {}. {} passed; {failed} failed",
            if failed == 0 { "ok" } else { "FAILED" },
            total - failed
        );
        i32::from(failed > 0)
    }
}
