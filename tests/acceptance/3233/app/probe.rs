//! #3233, what only Rust reaches: the pack check (`panel@1`'s install check, `deep_replica::kit::panel`), the app's
//! load path (`deep_app::mount_panel`, the loader the app, the replica and the panel host use) and a panel driven by
//! key in a headless replica. Written blind (../README.md).
//!
//! This file is a probe, not a judge. It runs each fixture panel through the real program and writes what the program
//! gave, word for word, as one JSON object; `../panels.test.ts` holds the judges (`../judges.ts`), under each
//! criterion's ID. So nothing here knows a code, a color or a count that is right.
//!
//! Every panel is loaded from a copy of its fixture under the system's temporary folder, as the hub and the app load
//! an installed panel from a copy, and the copy is removed after. A copy holds `main.js` and, where the probe says so,
//! `panel-kit.json`, the installer's record of the kit revision the panel was installed against (README, The surface).
//!
//! The two planted hosts the criteria name are here, whole, as test code (README, Planted things):
//! - `keys-planted`: the replica's key delivery with one change, an activation key's press completes on its
//!   key down and again on its key up, so the press under focus runs at both;
//! - `installed-at-1-planted`: a host that drops the record of an earlier install before it loads the panel, so the
//!   loader holds it to the kit's current revision.
//!
//! Wired into deep-replica by one `[[test]]` entry (no harness: AppKit wants the main thread; `test = false`: it
//! judges nothing, so a workspace run leaves it), and run from the checkout with:
//!     cargo test --locked -p deep-replica --test acceptance_3233 -- --out <file> [<a probe's name> ...]

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(probe::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_3233: INCONCLUSIVE; the replica draws on macOS only, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod probe {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::*;
    use gpui_shell::ScriptView;
    use serde_json::{json, Map, Value};

    /// The installer's record of the kit revision a panel was installed against, beside `main.js` in its copy.
    const RECORD: &str = "panel-kit.json";
    /// The text the press fixtures draw before their count.
    const COUNT: &str = "Refreshed ";
    /// How many times Tab is pressed before the press counts as out of its reach.
    const TABS: usize = 4;

    /// One probe: a fixture, the revision its copy's record names (none: no record), and what is run on it.
    struct Probe {
        name: &'static str,
        fixture: &'static str,
        installed_at: Option<u32>,
        run: Run,
    }

    enum Run {
        /// The pack check, then a load in light or in dark.
        PackAndLoad { dark: bool },
        /// The pack check alone.
        Pack,
        /// A load alone.
        Load,
        /// A key drive in a replica, through the real key delivery or the planted one.
        Keys { planted: bool },
    }

    const PROBES: [Probe; 12] = [
        Probe {
            name: "nameless-press",
            fixture: "nameless-press",
            installed_at: None,
            run: Run::PackAndLoad { dark: false },
        },
        Probe {
            name: "named-press",
            fixture: "named-press",
            installed_at: None,
            run: Run::PackAndLoad { dark: false },
        },
        Probe {
            name: "button-label",
            fixture: "button-label",
            installed_at: None,
            run: Run::PackAndLoad { dark: false },
        },
        Probe {
            name: "faint-text",
            fixture: "faint-text",
            installed_at: None,
            run: Run::PackAndLoad { dark: false },
        },
        Probe {
            name: "clear-text",
            fixture: "clear-text",
            installed_at: None,
            run: Run::PackAndLoad { dark: false },
        },
        // Loaded with the replica drawing dark: its text fails on the look's light fills, whatever is drawn now.
        Probe {
            name: "text-color-only",
            fixture: "text-color-only",
            installed_at: None,
            run: Run::PackAndLoad { dark: true },
        },
        Probe {
            name: "pointer-only",
            fixture: "pointer-only",
            installed_at: None,
            run: Run::PackAndLoad { dark: false },
        },
        Probe {
            name: "keys",
            fixture: "named-press",
            installed_at: None,
            run: Run::Keys { planted: false },
        },
        Probe {
            name: "keys-planted",
            fixture: "named-press",
            installed_at: None,
            run: Run::Keys { planted: true },
        },
        // The nameless press as a panel installed against revision 1: its copy carries the record.
        Probe {
            name: "installed-at-1",
            fixture: "nameless-press",
            installed_at: Some(1),
            run: Run::PackAndLoad { dark: false },
        },
        // The planted host: it drops the record before it loads the same panel.
        Probe {
            name: "installed-at-1-planted",
            fixture: "nameless-press",
            installed_at: None,
            run: Run::Load,
        },
        // An update of that panel, its node unchanged: the same script as a new package, which no record comes with.
        Probe {
            name: "update-of-installed",
            fixture: "nameless-press",
            installed_at: None,
            run: Run::Pack,
        },
    ];

    pub fn run() -> i32 {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let out = args
            .iter()
            .position(|arg| arg == "--out")
            .and_then(|at| args.get(at + 1))
            .cloned();
        let only: Vec<&String> = args
            .iter()
            .enumerate()
            .filter(|(at, arg)| {
                !arg.starts_with('-') && (*at == 0 || args[*at - 1] != "--out")
            })
            .map(|(_, arg)| arg)
            .collect();
        let mut probed = Map::new();
        for probe in &PROBES {
            if !only.is_empty() && !only.iter().any(|name| name.as_str() == probe.name) {
                continue;
            }
            let found = catch_unwind(AssertUnwindSafe(|| one(probe))).unwrap_or_else(|panic| {
                let why = panic
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
                    .or_else(|| panic.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "a panic with no message".to_owned());
                json!({ "panicked": why })
            });
            println!("acceptance_3233 probed {}", probe.name);
            probed.insert(probe.name.to_owned(), found);
        }
        let report = json!({ "suite": 3233, "probes": probed }).to_string();
        match out {
            Some(path) => match std::fs::write(&path, report) {
                Ok(()) => 0,
                Err(error) => {
                    println!("acceptance_3233: BLOCKED; can't write {path}: {error}");
                    1
                }
            },
            None => {
                println!("acceptance_3233 report {report}");
                0
            }
        }
    }

    fn one(probe: &Probe) -> Value {
        let dir = match copy(probe.fixture, probe.installed_at) {
            Ok(dir) => dir,
            Err(why) => return json!({ "panicked": format!("the fixture couldn't be copied: {why}") }),
        };
        let found = match probe.run {
            Run::PackAndLoad { dark } => json!({ "pack": pack(&dir), "load": load(&dir, dark) }),
            Run::Pack => json!({ "pack": pack(&dir) }),
            Run::Load => json!({ "load": load(&dir, false) }),
            Run::Keys { planted } => keys(&dir, planted),
        };
        let _ = std::fs::remove_dir_all(&dir);
        found
    }

    /// A copy of a fixture's script in a folder of its own, with the installer's record where `installed_at` names a
    /// revision.
    fn copy(fixture: &str, installed_at: Option<u32>) -> Result<PathBuf, String> {
        static MADE: AtomicUsize = AtomicUsize::new(0);
        let from = deep_replica::repo_root()
            .join("tests/acceptance/3233/fixtures")
            .join(fixture)
            .join("main.js");
        let dir = std::env::temp_dir().join(format!(
            "deep-3233-{}-{}-{fixture}",
            std::process::id(),
            MADE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        std::fs::copy(&from, dir.join("main.js"))
            .map_err(|error| format!("{}: {error}", from.display()))?;
        if let Some(revision) = installed_at {
            let record = json!({ "slot": "panel@1", "revision": revision });
            std::fs::write(dir.join(RECORD), record.to_string())
                .map_err(|error| error.to_string())?;
        }
        Ok(dir)
    }

    /// The pack check's verdict: whether it passed, what it names, and the line `deep-replica --panel-kit` prints of it.
    fn pack(dir: &Path) -> Value {
        let verdict = deep_replica::kit::panel(dir);
        json!({ "pass": verdict.pass, "names": verdict.names, "line": verdict.to_json().to_string() })
    }

    struct Held(Option<AnyView>);
    impl Render for Held {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().children(self.0.clone())
        }
    }

    /// A panel mounted through the app's loader in a fresh headless replica.
    struct Mounted {
        cx: HeadlessAppContext,
        window: AnyWindowHandle,
        view: Entity<ScriptView>,
    }

    impl Mounted {
        fn open(dir: &Path) -> Result<Self, String> {
            let mut cx = deep_replica::headless_context();
            let runtime = deep_app::new_runtime()
                .map_err(|error| format!("no panel runtime: {error:#}"))?;
            let mut mounted: Result<Entity<ScriptView>, String> = Err(String::new());
            let (window, _) = cx.update(|cx| {
                open_window(deep_replica::shell::window_options(), cx, |window, cx| {
                    mounted = deep_app::mount_panel(&runtime, dir, window, cx)
                        .map_err(|error| format!("{error:#}"));
                    cx.new(|_| Held(mounted.clone().ok().map(AnyView::from)))
                })
                .expect("a window opens")
            });
            // The runtime outlives the window, as the app's does.
            std::mem::forget(runtime);
            let view = mounted?;
            let mut mounted = Mounted { cx, window, view };
            mounted.frame()?;
            Ok(mounted)
        }

        /// One frame, and whatever it deferred.
        fn frame(&mut self) -> Result<(), String> {
            self.cx
                .update_window(self.window, |_, window, cx| window.render_frame(cx))
                .map_err(|error| error.to_string())?;
            self.cx.run_until_parked();
            Ok(())
        }

        /// The tree the script last built, or why it built none.
        fn tree(&mut self) -> Result<String, String> {
            let view = self.view.clone();
            self.cx.update(|cx| {
                let view = view.read(cx);
                match (view.build_error(), view.snapshot()) {
                    (None, Some(snapshot)) => Ok(snapshot.debug_tree()),
                    (error, _) => Err(format!(
                        "built: {}",
                        error.unwrap_or("the script built nothing")
                    )),
                }
            })
        }

        /// One key event to the window, as the OS would send it, and the frames that follow it.
        fn key(&mut self, key: &str, down: bool) -> Result<(), String> {
            let keystroke = Keystroke::parse(key).map_err(|error| format!("{error:?}"))?;
            let event = if down {
                PlatformInput::KeyDown(KeyDownEvent {
                    keystroke,
                    is_held: false,
                    prefer_character_input: false,
                })
            } else {
                PlatformInput::KeyUp(KeyUpEvent { keystroke })
            };
            self.cx
                .update_window(self.window, |_, window, cx| {
                    window.dispatch_event(event, cx);
                })
                .map_err(|error| error.to_string())?;
            self.cx.run_until_parked();
            self.frame()?;
            self.frame()
        }

        /// One press of a key: its down, then its up. The planted host completes an activation key's press on its
        /// key down and again on its key up, which reaches the window as two presses where a real host sends one.
        fn press(&mut self, key: &str, planted: bool) -> Result<(), String> {
            self.key(key, true)?;
            if planted {
                self.key(key, false)?;
                self.key(key, true)?;
            }
            self.key(key, false)
        }

        /// The count the panel draws, where it draws one.
        fn count(&mut self) -> Option<u64> {
            let tree = self.tree().ok()?;
            let rest = &tree[tree.find(COUNT)? + COUNT.len()..];
            rest.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse()
                .ok()
        }
    }

    /// One load through the app's loader, in light or dark, drawn once: the panel's tree, or the refusal.
    fn load(dir: &Path, dark: bool) -> Value {
        deep_app::chrome::force_dark(Some(dark));
        let tree = Mounted::open(dir).and_then(|mut mounted| mounted.tree());
        deep_app::chrome::force_dark(None);
        match tree {
            Ok(tree) => json!({ "ok": true, "error": null, "tree": tree }),
            Err(why) => json!({ "ok": false, "error": why, "tree": null }),
        }
    }

    /// The panel driven by key alone, no pointer: Tab, then Enter, until Enter moves the count or Tab has been pressed
    /// `TABS` times (the replica's window may hold a stop of its own before the panel), then Space once. It answers
    /// the count the panel draws at the start, after the last Tab, after the Enter that followed it and after Space.
    fn keys(dir: &Path, planted: bool) -> Value {
        let mut mounted = match Mounted::open(dir) {
            Ok(mounted) => mounted,
            Err(why) => return json!({ "error": format!("the panel didn't load: {why}") }),
        };
        let sent = |key: &str, why: String| json!({ "error": format!("{key} couldn't be sent: {why}") });
        let start = mounted.count();
        let (mut after_tab, mut after_enter, mut tabs) = (start, start, 0);
        while tabs < TABS {
            if let Err(why) = mounted.press("tab", false) {
                return sent("tab", why);
            }
            tabs += 1;
            after_tab = mounted.count();
            if let Err(why) = mounted.press("enter", planted) {
                return sent("enter", why);
            }
            after_enter = mounted.count();
            if after_enter != after_tab {
                break;
            }
        }
        if let Err(why) = mounted.press("space", planted) {
            return sent("space", why);
        }
        let after_space = mounted.count();
        json!({ "start": start, "afterTab": after_tab, "afterEnter": after_enter, "afterSpace": after_space, "tabs": tabs })
    }
}
