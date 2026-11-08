//! #1425 AC3, blind redraft (criterion #1425.229fbfbb): "A panel using a component off the catalog is refused,
//! naming the component and the closest catalog name. Every catalog name renders in a replica in light and
//! dark". README.md here says what was read and how the criterion is read.
//!
//! Wired into deep-replica by one `[[test]]` entry with no harness (AppKit wants the main thread), and run from
//! the checkout with:
//!     cargo test --locked -p deep-replica --test acceptance_1425_ac3

#[path = "component_js.rs"]
mod component_js;
#[cfg(target_os = "macos")]
#[path = "replica.rs"]
mod replica;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_1425_ac3: INCONCLUSIVE; the headless app needs macOS, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        path::PathBuf,
    };

    use super::{component_js, replica};

    /// The one module a panel imports.
    const MODULE: &str = "@deepbuild/panel";

    const REFUSED: &str = "a panel using a component off the catalog is refused at pack check and at load, naming the component and the closest catalog name #1425.229fbfbb";
    const RENDERS: &str =
        "every catalog name renders in a replica in light and dark #1425.229fbfbb";

    pub fn run() -> i32 {
        let tests: [(&str, fn()); 2] = [(REFUSED, refused), (RENDERS, renders)];
        let mut failed = 0;
        for (name, test) in tests {
            match catch_unwind(AssertUnwindSafe(test)) {
                Ok(()) => println!("test {name} ... ok"),
                Err(_) => {
                    failed += 1;
                    println!("test {name} ... FAILED");
                }
            }
        }
        println!(
            "\ntest result: {}. {} passed; {failed} failed",
            if failed == 0 { "ok" } else { "FAILED" },
            tests.len() - failed
        );
        i32::from(failed != 0)
    }

    /// The catalog's component names, from `crates/deep-app/panel-catalog.json`: its `components`, a list of
    /// entries that each carry a `name`, or an object keyed by name.
    fn catalog() -> Vec<String> {
        let path = deep_replica::repo_root().join("crates/deep-app/panel-catalog.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("no catalog at {}: {error}", path.display()));
        let catalog: serde_json::Value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("{} doesn't parse: {error}", path.display()));
        let names: Vec<String> = match &catalog["components"] {
            serde_json::Value::Array(entries) => entries
                .iter()
                .map(|entry| {
                    entry["name"]
                        .as_str()
                        .unwrap_or_else(|| panic!("a catalog entry has no name: {entry}"))
                        .to_owned()
                })
                .collect(),
            serde_json::Value::Object(entries) => entries.keys().cloned().collect(),
            other => panic!("the catalog's `components` is neither a list nor an object: {other}"),
        };
        assert!(!names.is_empty(), "the catalog lists no component");
        names
    }

    fn scratch(name: &str) -> PathBuf {
        PathBuf::from(format!("/tmp/da1425ac3-{}/{name}", std::process::id()))
    }

    /// Whether `word` stands in `text` as a whole name: no letter, digit or `_` either side.
    fn names(text: &str, word: &str) -> bool {
        let part = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        text.match_indices(word).any(|(at, _)| {
            !part(text[..at].chars().next_back()) && !part(text[at + word.len()..].chars().next())
        })
    }

    fn levenshtein(a: &str, b: &str) -> usize {
        let b: Vec<char> = b.chars().collect();
        let mut row: Vec<usize> = (0..=b.len()).collect();
        for (i, ca) in a.chars().enumerate() {
            let mut diagonal = row[0];
            row[0] = i + 1;
            for (j, cb) in b.iter().enumerate() {
                let next = (row[j + 1] + 1)
                    .min(row[j] + 1)
                    .min(diagonal + usize::from(ca != *cb));
                diagonal = row[j + 1];
                row[j + 1] = next;
            }
        }
        row[b.len()]
    }

    /// A catalog name and a typo of it off the catalog, its last letter doubled, that is nearer to it than to
    /// any other catalog name by edit distance. A common component first, so the control panel is plain.
    fn typo(
        catalog: &[String],
        registry: &gpui_shell::FrozenComponentRegistry,
    ) -> (String, String) {
        let common = ["Button", "Badge", "Label", "Kbd", "Tag", "Text"];
        let ordered = common
            .iter()
            .filter(|name| catalog.iter().any(|entry| entry == *name))
            .map(|name| name.to_string())
            .chain(catalog.iter().cloned());
        for name in ordered {
            let Some(last) = name.chars().last() else {
                continue;
            };
            let off = format!("{name}{last}");
            let distance = levenshtein(&off, &name);
            let unique = !catalog.contains(&off)
                && catalog
                    .iter()
                    .filter(|other| **other != name)
                    .all(|other| levenshtein(&off, other) > distance + 1);
            if unique && component_js::build(registry, &name).is_ok() {
                return (name, off);
            }
        }
        panic!("no catalog name has a typo nearer to it than to every other catalog name");
    }

    /// AC3, first sentence: the same panel, once with a catalog name and once with a typo of it, at pack check
    /// (`panel@1`'s install check) and at load (`mount_panel`). The catalog name passes both, so the refusal is
    /// the typo's; the typo is refused at each, and the refusal names the typo and the catalog name.
    fn refused() {
        let catalog = catalog();
        let registry = deep_app::components().expect("the app's components register");
        let (name, off) = typo(&catalog, &registry);

        let built = component_js::build(&registry, &name).expect("the catalog name builds");
        let control = scratch("control");
        replica::write_panel(&control, &component_js::panel_js(MODULE, MODULE, &built));
        let mut planted_build =
            component_js::build(&registry, &name).expect("the catalog name builds");
        planted_build.imports[0] = off.clone();
        planted_build.expr =
            planted_build
                .expr
                .replacen(&format!("new {name}("), &format!("new {off}("), 1);
        let planted = scratch("planted");
        replica::write_panel(
            &planted,
            &component_js::panel_js(MODULE, MODULE, &planted_build),
        );

        let mut failures = Vec::new();
        let control_check = deep_replica::kit::panel(&control);
        if !control_check.pass {
            failures.push(format!(
                "pack check refused the control panel, which uses the catalog's {name}: {:?}",
                control_check.names
            ));
        }
        let check = deep_replica::kit::panel(&planted);
        match (&check.pass, &check.names) {
            (true, _) => failures.push(format!(
                "pack check passed a panel using {off}, which is off the catalog"
            )),
            (false, said) => {
                let said = said.clone().unwrap_or_default();
                if !names(&said, &off) || !names(&said, &name) {
                    failures.push(format!(
                        "pack check's refusal of {off} doesn't name both {off} and the closest catalog name {name}: {said:?}"
                    ));
                }
            }
        }

        let mut cx = deep_replica::headless_context();
        let runtime = deep_app::new_runtime().expect("a panel runtime");
        let loaded = replica::draw(&mut cx, &runtime, &control, false);
        if loaded.refused.is_some() || loaded.build_error.is_some() {
            failures.push(format!(
                "the control panel, which uses the catalog's {name}, didn't load: {:?}",
                loaded.refused.or(loaded.build_error)
            ));
        }
        let load = replica::draw(&mut cx, &runtime, &planted, false);
        match load.refused {
            None => failures.push(format!(
                "mount_panel loaded a panel using {off}, which is off the catalog (its build error: {:?})",
                load.build_error
            )),
            Some(said) if !names(&said, &off) || !names(&said, &name) => failures.push(format!(
                "the load's refusal of {off} doesn't name both {off} and the closest catalog name {name}: {said:?}"
            )),
            Some(_) => {}
        }
        let _ = std::fs::remove_dir_all(scratch(""));
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// AC3, second sentence: each catalog name, built in a panel that imports only `@deepbuild/panel`, loads
    /// through `mount_panel` in a replica window in light and again in dark, and renders: the script builds,
    /// its tree has the component's node, and the window shows something other than gpui-shell's
    /// "Failed to render <component>" stand-in (`replica::renders`).
    fn renders() {
        let catalog = catalog();
        let registry = deep_app::components().expect("the app's components register");
        let mut failures = Vec::new();
        for dark in [false, true] {
            let theme = if dark { "dark" } else { "light" };
            let mut cx = deep_replica::headless_context();
            let runtime = deep_app::new_runtime().expect("a panel runtime");
            for name in &catalog {
                let judged = component_js::build(&registry, name).and_then(|built| {
                    let dir = scratch(&format!("{theme}-{name}"));
                    replica::renders(&mut cx, &runtime, &dir, MODULE, MODULE, &built, dark)
                });
                if let Err(why) = judged {
                    failures.push(format!("{name} in {theme}: {why}"));
                }
            }
        }
        let _ = std::fs::remove_dir_all(scratch(""));
        assert!(
            failures.is_empty(),
            "{} of {} draws (the catalog's names, in light and in dark) don't render:\n{}",
            failures.len(),
            catalog.len() * 2,
            failures.join("\n")
        );
    }
}
