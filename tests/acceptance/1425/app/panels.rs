//! #1425, the criteria only Rust reaches: the pack check (`panel@1`'s install check, `deep_replica::kit::panel`) and the
//! app's load path (`deep_app::mount_panel`, the loader the app and the panel host both use), in a headless replica.
//! Written blind (README). Each test's name carries its criterion's ID.
//!
//! - AC1 `#1425.3d839088`: the view each `338-*` panel registers in the app's dock (its slot), drawn in the replica's
//!   shell over the fixture record, is byte-equal to the merge base's (`base-trees/<panel>.<slot>.txt`). The panels' own
//!   trees, from the panel host, are imports.test.ts's.
//! - AC2 `#1425.782e7a69`: a panel importing "gpui-kit" is refused at pack check and at load, naming the module and its
//!   line; a planted loader that skips the load check (`DEEP_HUB_PLANT=panel-load-unchecked`) loads it, and the load
//!   judge fails it, naming the panel.
//! - AC3 `#1425.229fbfbb`: a panel using a name off the catalog is refused at pack check and at load, naming that name
//!   and the closest catalog name; every catalog component, drawn from its `example`, renders in a replica in light
//!   and dark.
//! - AC5 `#1425.30ab78a9`: the load path's time with the module check and without it (the planted loader), written to
//!   `$DEEP_1425_OUT/load.json` for `budgets.test.ts` to judge on a reference Mac.
//! - AC7 `#1425.711d0cb9`: a panel whose list runs script per frame is refused at pack check, naming the component; a
//!   planted pack check that skips that check (`DEEP_HUB_PLANT=panel-per-frame-unchecked`) passes it, and the judge
//!   fails it, naming the panel.
//!
//! A plant is read from `DEEP_HUB_PLANT` when the check runs, in this test binary, where deep-app is built with its
//! `env-plants` feature (deep-replica's dev-dependency). Wired into deep-replica by one `[[test]]` entry (no harness:
//! AppKit wants the main thread), and run from the checkout with:
//!     cargo test --locked -p deep-replica --test acceptance_1425 [-- <part of a name>]

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_1425: INCONCLUSIVE; the replica draws on macOS only, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::path::{Path, PathBuf};
    use std::time::Instant;

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::*;
    use gpui_shell::ScriptView;
    use serde_json::{json, Value};

    const AC1_SLOTS: &str = "#1425.3d839088 the view each panel registers in a slot draws the merge base's tree, byte for byte";
    const AC2_PACK: &str = "#1425.782e7a69 a panel importing \"gpui-kit\" is refused at pack check, naming the module and line";
    const AC2_LOAD: &str = "#1425.782e7a69 a panel importing \"gpui-kit\" is refused at load, naming the module and line";
    const AC2_PLANT: &str = "#1425.782e7a69 planted: a host that skips the load check loads the gpui-kit panel, and the load judge fails it naming the panel";
    const AC3_OFF: &str = "#1425.229fbfbb a panel using a name off the catalog is refused at pack check and at load, naming it and the closest catalog name";
    const AC3_RENDERS: &str =
        "#1425.229fbfbb every catalog name renders in a replica in light and dark";
    const AC5_LOAD: &str = "#1425.30ab78a9 the load path timed with the module check and without it, for each of the 12 panels";
    const AC7_PACK: &str = "#1425.711d0cb9 a panel whose list runs script per frame is refused at pack check, naming the component";
    const AC7_PLANT: &str = "#1425.711d0cb9 planted: a pack check that skips the per-frame check passes the panel, and the judge fails it naming the panel";

    /// The checked-in catalog (README, The surface).
    const CATALOG: &str = "crates/deep-app/panel-catalog.json";
    const MODULE: &str = "@deepbuild/panel";
    const PLANT: &str = "DEEP_HUB_PLANT";
    const LOAD_UNCHECKED: &str = "panel-load-unchecked";
    const PER_FRAME_UNCHECKED: &str = "panel-per-frame-unchecked";
    /// The toolkit fixture's import of "gpui-kit" is on this line of its main.js.
    const TOOLKIT_LINE: usize = 3;
    /// The per-frame fixtures and the component each one's refusal must name.
    const PER_FRAME: [(&str, &str); 2] =
        [("scripted-cells", "DataTable"), ("scripted-rows", "list")];
    const PANELS: [&str; 12] = [
        "338-canvas",
        "338-cap20",
        "338-drop-folded",
        "338-hide-newest",
        "338-home",
        "338-line",
        "338-list-superseded",
        "338-needs-you",
        "338-sidebar",
        "338-tab",
        "claude-code",
        "codex",
    ];
    /// The slot each `338-*` panel registers its view under (`DockArea.register_panel`), as the base's panels do.
    const SLOTS: [(&str, &str); 10] = [
        ("338-canvas", "canvas"),
        ("338-cap20", "needs-you"),
        ("338-drop-folded", "needs-you"),
        ("338-hide-newest", "needs-you"),
        ("338-home", "home"),
        ("338-line", "line"),
        ("338-list-superseded", "needs-you"),
        ("338-needs-you", "needs-you"),
        ("338-sidebar", "sidebar"),
        ("338-tab", "tab"),
    ];
    /// AC5's sampling: five runs, each the median of this many loads a side, alternated.
    const RUNS: usize = 5;
    const LOADS: usize = 15;

    type Check = fn() -> Result<(), String>;

    pub fn run() -> i32 {
        let tests: [(&str, Check); 9] = [
            (AC1_SLOTS, ac1_slots),
            (AC2_PACK, ac2_pack),
            (AC2_LOAD, ac2_load),
            (AC2_PLANT, ac2_plant),
            (AC3_OFF, ac3_off_catalog),
            (AC3_RENDERS, ac3_renders),
            (AC5_LOAD, ac5_load_path),
            (AC7_PACK, ac7_pack),
            (AC7_PLANT, ac7_plant),
        ];
        let filters: Vec<String> = std::env::args()
            .skip(1)
            .filter(|a| !a.starts_with('-'))
            .collect();
        let chosen: Vec<_> = tests
            .iter()
            .filter(|(name, _)| {
                filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str()))
            })
            .collect();
        println!("\nrunning {} tests", chosen.len());
        let mut failed = 0;
        for (name, check) in &chosen {
            std::env::remove_var(PLANT);
            let verdict = check();
            std::env::remove_var(PLANT);
            match verdict {
                Ok(()) => println!("test {name} ... ok"),
                Err(message) => {
                    failed += 1;
                    println!("test {name} ... FAILED\n\n---- {name} ----\n{message}\n");
                }
            }
        }
        let word = if failed == 0 { "ok" } else { "FAILED" };
        println!(
            "test result: {word}. {} passed; {failed} failed\n",
            chosen.len() - failed
        );
        i32::from(failed > 0)
    }

    fn repo() -> PathBuf {
        deep_replica::repo_root()
    }

    fn fixture(name: &str) -> PathBuf {
        repo().join("tests/acceptance/1425/fixtures").join(name)
    }

    fn panel(name: &str) -> PathBuf {
        repo().join("crates/deep-app/panels").join(name)
    }

    /// Runs `f` with the plant named, or with none, and clears it after.
    fn planted<T>(plant: Option<&str>, f: impl FnOnce() -> T) -> T {
        match plant {
            Some(plant) => std::env::set_var(PLANT, plant),
            None => std::env::remove_var(PLANT),
        }
        let out = f();
        std::env::remove_var(PLANT);
        out
    }

    /// The pack check: `Ok(())` when `panel@1` passes the package, `Err(its refusal)` when it refuses.
    fn pack(dir: &Path) -> Result<(), String> {
        let verdict = deep_replica::kit::panel(dir);
        if verdict.pass {
            Ok(())
        } else {
            Err(verdict
                .names
                .unwrap_or_else(|| "(a refusal that names nothing)".into()))
        }
    }

    struct Probe(Option<AnyView>);
    impl Render for Probe {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().children(self.0.clone())
        }
    }

    /// One load through the app's loader in a fresh headless replica, in light or dark, drawn once: `Ok(the panel's
    /// tree)` or `Err(the refusal)`. A panel that loads but fails to build is an error too, prefixed `built:`.
    fn load(dir: &Path, dark: bool) -> Result<String, String> {
        deep_app::chrome::force_dark(Some(dark));
        let mut cx = deep_replica::headless_context();
        let runtime =
            deep_app::new_runtime().map_err(|error| format!("no panel runtime: {error:#}"))?;
        let mut mounted: Result<Entity<ScriptView>, String> = Err(String::new());
        let (handle, _) = cx.update(|cx| {
            open_window(deep_replica::shell::window_options(), cx, |window, cx| {
                mounted = deep_app::mount_panel(&runtime, dir, window, cx)
                    .map_err(|error| format!("{error:#}"));
                cx.new(|_| Probe(mounted.clone().ok().map(AnyView::from)))
            })
            .expect("a window opens")
        });
        let view = mounted?;
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .map_err(|e| e.to_string())?;
        cx.run_until_parked();
        let tree = cx.update(|cx| {
            let view = view.read(cx);
            match (view.build_error(), view.snapshot()) {
                (None, Some(snapshot)) => Ok(snapshot.debug_tree()),
                (error, _) => Err(format!(
                    "built: {}",
                    error.unwrap_or("the script built nothing")
                )),
            }
        });
        deep_app::chrome::force_dark(None);
        tree
    }

    /// Whether `text` holds `word` with no letter, digit or `_` on either side.
    fn names(text: &str, word: &str) -> bool {
        let edge = |c: Option<char>| !c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        text.match_indices(word).any(|(at, _)| {
            edge(text[..at].chars().next_back()) && edge(text[at + word.len()..].chars().next())
        })
    }

    /// Whether a refusal names line `line` of the panel's `main.js`: `main.js:3` or `line 3`, the number whole.
    fn names_line(text: &str, line: usize) -> bool {
        [format!("main.js:{line}"), format!("line {line}")]
            .iter()
            .any(|form| {
                text.match_indices(form.as_str()).any(|(at, _)| {
                    !text[at + form.len()..].starts_with(|c: char| c.is_ascii_digit())
                })
            })
    }

    /// The toolkit refusal's judge: refused, naming "gpui-kit" and line 3. A failure names the panel.
    fn judge_toolkit(panel: &str, at: &str, result: Result<(), String>) -> Result<(), String> {
        match result {
            Ok(()) => Err(format!("{panel}: {at} took a panel that imports \"gpui-kit\" on line {TOOLKIT_LINE}")),
            Err(why) if names(&why, "gpui-kit") && names_line(&why, TOOLKIT_LINE) => Ok(()),
            Err(why) => Err(format!(
                "{panel}: {at} refused it without naming the module \"gpui-kit\" and line {TOOLKIT_LINE} (main.js:{TOOLKIT_LINE} or line {TOOLKIT_LINE}): {why}"
            )),
        }
    }

    /// The view `panel` registers under `slot`, drawn in the replica's shell (the slot's view in the center) over the
    /// fixture record, as #338's suite opens it: gpui-shell's text of its snapshot.
    fn slot_tree(panel_name: &str, slot: &str) -> Result<String, String> {
        use deep_app::views::Layout;
        use deep_replica::shell::{open_shell, script_panel};
        deep_app::views::set_state(deep_replica::load_state());
        let name = format!("shell:deepbuild-panel/{slot}");
        let layout = Layout {
            center: vec![name.clone()],
            active: 0,
            ..Layout::shipped("needs-you")
        };
        let mut cx = deep_replica::headless_context();
        let runtime =
            deep_app::new_runtime().map_err(|error| format!("no panel runtime: {error:#}"))?;
        let dir = panel(panel_name);
        let mut mounted: Result<Entity<ScriptView>, String> = Err(String::new());
        let (handle, shell) = cx.update(|cx| {
            open_shell(&layout, cx, |window, cx| {
                mounted = deep_app::mount_panel(&runtime, &dir, window, cx)
                    .map_err(|error| format!("{error:#}"));
            })
        });
        let _mounted = mounted?;
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            deep_app::canvas::clear_items();
            window.render_frame(cx);
        })
        .map_err(|e| e.to_string())?;
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let found = script_panel(shell.read(cx).dock.read(cx), &name, cx)
                .ok_or(format!("no script panel {name} in the dock"))?;
            let view = found.read(cx).view().read(cx);
            match (view.build_error(), view.snapshot()) {
                (None, Some(snapshot)) => Ok(snapshot.debug_tree()),
                (error, _) => Err(format!(
                    "built: {}",
                    error.unwrap_or("the script built nothing")
                )),
            }
        })
        .map_err(|e| e.to_string())?
    }

    /// Each slot view's tree against the merge base's; with `$DEEP_1425_OUT` set, each tree is written to
    /// `$DEEP_1425_OUT/trees/<panel>.<slot>.txt` too (how base-trees/ was captured at the base).
    fn ac1_slots() -> Result<(), String> {
        let out = std::env::var_os("DEEP_1425_OUT").map(|out| PathBuf::from(out).join("trees"));
        let mut problems = Vec::new();
        for (panel_name, slot) in SLOTS {
            let file = format!("{panel_name}.{slot}.txt");
            let tree = match slot_tree(panel_name, slot) {
                Ok(tree) => tree,
                Err(why) => {
                    problems.push(format!("{panel_name}: its {slot} view didn't draw: {why}"));
                    continue;
                }
            };
            if let Some(out) = &out {
                std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
                std::fs::write(out.join(&file), &tree).map_err(|e| e.to_string())?;
            }
            let base = std::fs::read_to_string(
                repo().join("tests/acceptance/1425/base-trees").join(&file),
            )
            .unwrap_or_default();
            if tree != base {
                let (a, b): (Vec<&str>, Vec<&str>) =
                    (base.lines().collect(), tree.lines().collect());
                let at = (0..a.len().max(b.len()))
                    .find(|&i| a.get(i) != b.get(i))
                    .unwrap_or(0);
                problems.push(format!(
                    "{panel_name}: its {slot} view differs from the merge base's at line {}:\n  base: {:?}\n  now:  {:?}",
                    at + 1, a.get(at), b.get(at)
                ));
            }
        }
        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems.join("\n"))
        }
    }

    fn ac2_pack() -> Result<(), String> {
        judge_toolkit(
            "imports-gpui-kit",
            "the pack check",
            pack(&fixture("imports-gpui-kit")),
        )
    }

    fn ac2_load() -> Result<(), String> {
        judge_toolkit(
            "imports-gpui-kit",
            "the load",
            load(&fixture("imports-gpui-kit"), false).map(drop),
        )
    }

    /// The same load judge on the real loader (which must pass it) and on the planted one (which must load the panel
    /// and so fail the judge, naming the panel).
    fn ac2_plant() -> Result<(), String> {
        let dir = fixture("imports-gpui-kit");
        let real = planted(None, || load(&dir, false).map(drop));
        judge_toolkit("imports-gpui-kit", "the load", real).map_err(|why| {
            format!("the real loader must refuse the panel before its plant means anything: {why}")
        })?;
        planted(Some(LOAD_UNCHECKED), || load(&dir, false)).map_err(|why| {
            format!("BLOCKED: {PLANT}={LOAD_UNCHECKED} didn't load the panel, so it isn't a loader that skips the load check in this build: {why}")
        })?;
        match judge_toolkit("imports-gpui-kit", "the planted load", Ok(())) {
            Err(failure) if failure.contains("imports-gpui-kit") => Ok(()),
            other => Err(format!(
                "the judge didn't fail the planted loader naming the panel: {other:?}"
            )),
        }
    }

    struct Catalog {
        components: Vec<(String, String)>,
    }

    /// The catalog's components, each with its example; anything malformed is the error.
    fn catalog() -> Result<Catalog, String> {
        let path = repo().join(CATALOG);
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("no catalog at {CATALOG}: {e}"))?;
        let value: Value =
            serde_json::from_str(&text).map_err(|e| format!("{CATALOG} isn't JSON: {e}"))?;
        if value["module"] != MODULE {
            return Err(format!(
                "{CATALOG}: module is {}, not {MODULE:?}",
                value["module"]
            ));
        }
        let entries = value["components"]
            .as_array()
            .filter(|a| !a.is_empty())
            .ok_or(format!("{CATALOG}: no components"))?;
        let mut components = Vec::new();
        for entry in entries {
            let name = entry["name"]
                .as_str()
                .filter(|n| !n.is_empty())
                .ok_or(format!("{CATALOG}: a component with no name: {entry}"))?;
            if !entry["props"].is_object() {
                return Err(format!("{CATALOG}: {name} has no props object"));
            }
            let example = entry["example"]
                .as_str()
                .filter(|e| !e.trim().is_empty())
                .ok_or(format!("{CATALOG}: {name} has no example"))?;
            components.push((name.to_owned(), example.to_owned()));
        }
        Ok(Catalog { components })
    }

    fn distance(a: &str, b: &str) -> usize {
        let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
        let mut row: Vec<usize> = (0..=b.len()).collect();
        for (i, ca) in a.iter().enumerate() {
            let mut prev = row[0];
            row[0] = i + 1;
            for (j, cb) in b.iter().enumerate() {
                let next = (prev + usize::from(ca != cb))
                    .min(row[j] + 1)
                    .min(row[j + 1] + 1);
                prev = row[j + 1];
                row[j + 1] = next;
            }
        }
        row[b.len()]
    }

    /// A name one letter off a catalog component, closer to it than to any other catalog name and not itself one:
    /// the component's middle letter changed, so the name never holds the component's as a word.
    fn near_miss(catalog: &Catalog) -> Option<(String, String)> {
        let mut names: Vec<&str> = catalog.components.iter().map(|(n, _)| n.as_str()).collect();
        names.sort();
        names
            .iter()
            .filter(|n| n.chars().count() >= 4 && n.starts_with(|c: char| c.is_ascii_uppercase()))
            .find_map(|name| {
                let mut chars: Vec<char> = name.chars().collect();
                let at = chars.len() / 2;
                chars[at] = if chars[at] == 'q' { 'z' } else { 'q' };
                let miss: String = chars.into_iter().collect();
                let unique = names
                    .iter()
                    .all(|other| other == name || distance(&miss, other) > 1);
                (unique && !names.contains(&miss.as_str())).then(|| (miss, (*name).to_owned()))
            })
    }

    fn scratch(name: &str, script: &str) -> Result<PathBuf, String> {
        let dir = std::env::temp_dir().join(format!("deep-1425-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("main.js"), script).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    fn ac3_off_catalog() -> Result<(), String> {
        let catalog = catalog()?;
        let (miss, closest) =
            near_miss(&catalog).ok_or("no catalog component has a near miss to plant")?;
        let dir = scratch(
            "off-catalog",
            &format!(
                "// #1425 AC3: {miss} is one letter off {closest}, a name on the catalog.\nimport {{ View, div, {miss} }} from \"{MODULE}\";\n\nexport default class OffCatalog extends View {{\n  render() {{\n    return div().child({miss}.new());\n  }}\n}}\n"
            ),
        )?;
        let mut problems = Vec::new();
        for (at, result) in [
            ("the pack check", pack(&dir)),
            ("the load", load(&dir, false).map(drop)),
        ] {
            match result {
                Ok(()) => problems.push(format!("{at} took a panel that uses {miss}, a name off the catalog")),
                Err(why) if names(&why, &miss) && names(&why, &closest) => {}
                Err(why) => problems.push(format!("{at} refused it without naming both {miss} and the closest catalog name {closest}: {why}")),
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems.join("\n"))
        }
    }

    /// Each component's example, drawn in a panel of its own: it loads, builds and draws a node of that name, in
    /// light and in dark.
    fn ac3_renders() -> Result<(), String> {
        let catalog = catalog()?;
        let all: Vec<&str> = catalog.components.iter().map(|(n, _)| n.as_str()).collect();
        let mut problems = Vec::new();
        for (name, example) in &catalog.components {
            let mut imports = vec!["View", "div"];
            for other in &all {
                if (other == name || names(example, other)) && !imports.contains(other) {
                    imports.push(other);
                }
            }
            let script = format!(
                "import {{ {} }} from \"{MODULE}\";\n\nexport default class Example extends View {{\n  render(cx) {{\n    return div().size_full().child({example});\n  }}\n}}\n",
                imports.join(", ")
            );
            let dir = scratch(&format!("renders-{name}"), &script)?;
            for (look, dark) in [("light", false), ("dark", true)] {
                match load(&dir, dark) {
                    Ok(tree)
                        if tree.lines().any(|line| {
                            line.trim_start().split(' ').next() == Some(name.as_str())
                        }) => {}
                    Ok(tree) => problems.push(format!(
                        "{name} in {look}: its tree holds no {name} node:\n{tree}"
                    )),
                    Err(why) => problems.push(format!("{name} in {look}: {why}")),
                }
            }
            let _ = std::fs::remove_dir_all(&dir);
        }
        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems.join("\n"))
        }
    }

    fn median(mut samples: Vec<f64>) -> f64 {
        samples.sort_by(f64::total_cmp);
        samples[samples.len() / 2]
    }

    /// Times `mount_panel` alone, in one replica window, with the plant set or not; each load is a fresh mount.
    fn timed_loads(dir: &Path) -> Result<(Vec<f64>, Vec<f64>), String> {
        let mut cx = deep_replica::headless_context();
        let runtime =
            deep_app::new_runtime().map_err(|error| format!("no panel runtime: {error:#}"))?;
        let (handle, _) = cx.update(|cx| {
            open_window(deep_replica::shell::window_options(), cx, |_, cx| {
                cx.new(|_| Probe(None))
            })
            .expect("a window opens")
        });
        let mut once = |plant: Option<&str>| -> Result<f64, String> {
            planted(plant, || {
                cx.update_window(handle, |_, window, cx| {
                    let started = Instant::now();
                    let mounted = deep_app::mount_panel(&runtime, dir, window, cx);
                    let ms = started.elapsed().as_secs_f64() * 1000.;
                    mounted.map(|_| ms).map_err(|error| format!("{error:#}"))
                })
                .map_err(|e| e.to_string())?
            })
        };
        // One untimed load a side first.
        once(None)?;
        once(Some(LOAD_UNCHECKED))?;
        let (mut checked, mut unchecked) = (Vec::new(), Vec::new());
        for _ in 0..RUNS {
            let (mut with, mut without) = (Vec::new(), Vec::new());
            for _ in 0..LOADS {
                with.push(once(None)?);
                without.push(once(Some(LOAD_UNCHECKED))?);
            }
            checked.push(median(with));
            unchecked.push(median(without));
        }
        Ok((checked, unchecked))
    }

    /// The plant must be real (the toolkit panel refused without it and loaded with it), every panel must load both
    /// ways, and the readings go to `$DEEP_1425_OUT/load.json` as { panel: { checkedMs: [5], uncheckedMs: [5] } }.
    fn ac5_load_path() -> Result<(), String> {
        let toolkit = fixture("imports-gpui-kit");
        if planted(None, || load(&toolkit, false)).is_ok() {
            return Err(
                "the load path has no module check to time: the panel importing \"gpui-kit\" loads"
                    .into(),
            );
        }
        planted(Some(LOAD_UNCHECKED), || load(&toolkit, false))
            .map_err(|why| format!("BLOCKED: {PLANT}={LOAD_UNCHECKED} isn't a loader without the check in this build: {why}"))?;
        let mut readings = serde_json::Map::new();
        for name in PANELS {
            let (checked, unchecked) =
                timed_loads(&panel(name)).map_err(|why| format!("{name}: {why}"))?;
            readings.insert(
                name.into(),
                json!({ "checkedMs": checked, "uncheckedMs": unchecked }),
            );
        }
        if let Some(out) = std::env::var_os("DEEP_1425_OUT") {
            let out = PathBuf::from(out);
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            std::fs::write(out.join("load.json"), Value::Object(readings).to_string())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Whether a refusal names a component as code: `DataTable` as a whole word, and `list`, an everyday word too,
    /// only quoted (`list`, "list", 'list') or as its call, `list(`.
    fn names_component(text: &str, component: &str) -> bool {
        if component.starts_with(|c: char| c.is_ascii_uppercase()) {
            return names(text, component);
        }
        let call = format!("{component}(");
        let word_start = |at: usize| {
            !text[..at]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_')
        };
        ['`', '"', '\'']
            .iter()
            .any(|q| text.contains(&format!("{q}{component}{q}")))
            || text
                .match_indices(call.as_str())
                .any(|(at, _)| word_start(at))
    }

    fn judge_per_frame(
        panel: &str,
        component: &str,
        result: Result<(), String>,
    ) -> Result<(), String> {
        match result {
            Ok(()) => Err(format!(
                "{panel}: the pack check passed a panel whose {component} runs script per frame"
            )),
            Err(why) if names_component(&why, component) => Ok(()),
            Err(why) => Err(format!(
                "{panel}: the pack check refused it without naming {component}: {why}"
            )),
        }
    }

    fn ac7_pack() -> Result<(), String> {
        let problems: Vec<String> = PER_FRAME
            .iter()
            .filter_map(|(panel, component)| {
                judge_per_frame(panel, component, pack(&fixture(panel))).err()
            })
            .collect();
        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems.join("\n"))
        }
    }

    fn ac7_plant() -> Result<(), String> {
        let mut problems = Vec::new();
        for (panel, component) in PER_FRAME {
            let dir = fixture(panel);
            if let Err(why) = judge_per_frame(panel, component, planted(None, || pack(&dir))) {
                problems.push(format!(
                    "the real pack check must refuse it before its plant means anything: {why}"
                ));
                continue;
            }
            match judge_per_frame(panel, component, planted(Some(PER_FRAME_UNCHECKED), || pack(&dir))) {
                Err(failure) if failure.contains(panel) => {}
                Err(failure) => problems.push(format!("the judge failed the planted pack check without naming {panel}: {failure}")),
                Ok(()) => problems.push(format!(
                    "BLOCKED: under {PLANT}={PER_FRAME_UNCHECKED} the pack check still refused {panel} naming {component}, so the plant skips nothing in this build"
                )),
            }
        }
        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems.join("\n"))
        }
    }
}
