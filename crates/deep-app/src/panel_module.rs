//! Issue #1425: `@deepbuild/panel`, the one module a panel imports, so a panel never names the toolkit under it.
//!
//! The names it serves are the checked-in catalog's (`panel-catalog.json`): the module's core (a view, an element, the
//! layout helpers, the dock, DeepBuild's canvas), the toolkit components on the catalog, and the data the app serves.
//! gpui-shell resolves the module: a panel's bare `@deepbuild/panel` is a file under its own root, which [`serve`]
//! writes there before each load, re-exporting each name from the toolkit module the catalog says serves it.
//!
//! [`check`] runs at pack check (`panel@1`) and again at load. It refuses a panel that imports a toolkit module, naming
//! the file and line; one that uses a name off the catalog, naming the closest name on it; and one that uses a
//! component whose script runs per frame, naming the component.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The specifier a panel imports.
pub const MODULE: &str = "@deepbuild/panel";

/// The toolkit's modules, which a panel never imports.
const TOOLKIT: [&str; 6] = [
    "gpui-kit",
    "gpui",
    "gpui-base",
    "gpui-shell",
    "gpui-component",
    "gpui-fps",
];

/// Where [`serve`] writes the module, under a panel's root: where gpui-shell resolves the bare specifier.
const SERVED: &str = "@deepbuild/panel.js";

/// The entry `mount_page` writes beside a panel's `main.js`; DeepBuild's, not the panel's.
pub(crate) const PAGE_ENTRY: &str = ".deepbuild-page.js";

/// A panel's scripts are read up to this many files, so a package can't make the check walk forever.
const MAX_SCRIPTS: usize = 256;

struct Catalog {
    /// Each name a panel may import, with the module that serves it (`deepbuild` for the app's data).
    offered: BTreeMap<String, String>,
    /// Each toolkit name not offered, with its reason and, for one whose script runs per frame, the module serving it.
    not_offered: BTreeMap<String, (String, Option<String>)>,
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let value: serde_json::Value = serde_json::from_str(include_str!("../panel-catalog.json"))
            .expect("the panel catalog is valid JSON");
        let text = |entry: &serde_json::Value, key: &str| entry[key].as_str().map(str::to_owned);
        let mut offered = BTreeMap::new();
        for entry in value["core"]
            .as_array()
            .into_iter()
            .chain(value["components"].as_array())
            .flatten()
        {
            let name = text(entry, "name").expect("a catalog name");
            offered.insert(name, text(entry, "from").expect("the module serving it"));
        }
        for name in data() {
            offered.insert(name.to_owned(), "deepbuild".to_owned());
        }
        let not_offered = value["not_offered"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|entry| {
                let per_frame = entry["per_frame"].as_bool() == Some(true);
                (
                    text(entry, "name").expect("a not_offered name"),
                    (
                        text(entry, "reason").unwrap_or_default(),
                        per_frame.then(|| text(entry, "from").expect("the module serving it")),
                    ),
                )
            })
            .collect();
        Catalog {
            offered,
            not_offered,
        }
    })
}

/// The data DeepBuild's `deepbuild` host module serves a panel, as plain values.
fn data() -> Vec<&'static str> {
    #[allow(unused_mut)]
    let mut names = vec!["needs_you", "quotes"];
    #[cfg(feature = "panel-check")]
    names.extend(["rebuild_count", "fold"]);
    names
}

/// Whether a test build runs the named wrong program (#1408's plants): never outside a build with `env-plants`.
pub(crate) fn planted(plant: &str) -> bool {
    #[cfg(feature = "env-plants")]
    return std::env::var("DEEP_HUB_PLANT").as_deref() == Ok(plant);
    #[cfg(not(feature = "env-plants"))]
    {
        let _ = plant;
        false
    }
}

/// The module's source: each name on the catalog re-exported from the toolkit module that serves it. A panel that
/// imports the module whole gets those names and no others. Only #1425's planted pack check, which lets a component
/// whose script runs per frame through, is served those components too.
fn source() -> &'static str {
    static SOURCE: OnceLock<String> = OnceLock::new();
    static PLANTED: OnceLock<String> = OnceLock::new();
    if planted("panel-per-frame-unchecked") {
        PLANTED.get_or_init(|| write_source(true))
    } else {
        SOURCE.get_or_init(|| write_source(false))
    }
}

fn write_source(per_frame: bool) -> String {
    let catalog = catalog();
    let mut by_module: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let per_frame = catalog
        .not_offered
        .iter()
        .filter(|_| per_frame)
        .filter_map(|(name, (_, from))| Some((name, from.as_ref()?)));
    for (name, from) in catalog.offered.iter().chain(per_frame) {
        by_module.entry(from).or_default().push(name);
    }
    let mut source = String::from(
        "// Written by DeepBuild each time it loads this panel (#1425): @deepbuild/panel, the one module a panel imports.\n",
    );
    for (module, names) in by_module {
        source.push_str(&format!(
            "export {{ {} }} from \"{module}\";\n",
            names.join(", ")
        ));
    }
    source
}

/// Writes the module under `dir`, where gpui-shell resolves `@deepbuild/panel`, unless it's there already.
pub fn serve(dir: &Path) -> std::io::Result<()> {
    let path = dir.join(SERVED);
    let source = source();
    if std::fs::read_to_string(&path).is_ok_and(|text| text == source) {
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().expect("the module's folder"))?;
    std::fs::write(path, source)
}

/// Checks a panel's scripts: `Err` names the file and line of the first import no panel may make, and why.
pub fn check(dir: &Path) -> Result<(), String> {
    let per_frame_checked = !planted("panel-per-frame-unchecked");
    for path in scripts(dir) {
        let file = path
            .strip_prefix(dir)
            .unwrap_or(&path)
            .display()
            .to_string();
        let source = std::fs::read_to_string(&path).map_err(|error| format!("{file}: {error}"))?;
        for import in imports(&source) {
            let at = format!("{file}:{}", import.line);
            let specifier = import.specifier.as_str();
            if TOOLKIT.contains(&specifier) {
                return Err(format!(
                    "{at} imports \"{specifier}\", the toolkit under DeepBuild's module; a panel imports only \"{MODULE}\""
                ));
            }
            if specifier != MODULE {
                continue;
            }
            // A panel that takes the module whole gets only what it serves, the catalog's names.
            for name in import.names.unwrap_or_default() {
                refuse_name(&at, &name, per_frame_checked)?;
            }
        }
    }
    Ok(())
}

/// A name a panel imports from the module: `Err` unless it's on the catalog.
fn refuse_name(at: &str, name: &str, per_frame_checked: bool) -> Result<(), String> {
    let catalog = catalog();
    if catalog.offered.contains_key(name) {
        return Ok(());
    }
    match catalog.not_offered.get(name) {
        Some((reason, Some(_))) if per_frame_checked => Err(format!(
            "{at} uses `{name}`, whose script runs per frame, so it is not offered: {reason}"
        )),
        Some((_, Some(_))) => Ok(()),
        not_offered => {
            let closest = catalog
                .offered
                .keys()
                .min_by_key(|offered| distance(name, offered))
                .expect("the catalog offers names");
            let why = not_offered
                .map(|(reason, _)| format!(" {reason}"))
                .unwrap_or_default();
            Err(format!(
                "{at} uses `{name}`, which is not on the panel catalog.{why} The closest name on it is `{closest}`"
            ))
        }
    }
}

/// The panel's scripts: every `.js` and `.mjs` file under its root but the ones DeepBuild writes there.
fn scripts(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut open = vec![dir.to_path_buf()];
    while let Some(folder) = open.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        let mut entries: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                open.push(path);
            } else if matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("js" | "mjs")
            ) && path != dir.join(SERVED)
                && path != dir.join(PAGE_ENTRY)
                && found.len() < MAX_SCRIPTS
            {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// One import a script makes: its specifier, its line, and for a statement the names it takes, or `None` when it
/// takes the module whole (a namespace, `export *` or a dynamic import).
#[derive(Debug, PartialEq)]
struct Import {
    specifier: String,
    line: usize,
    names: Option<Vec<String>>,
}

/// Every import in `source`: `import … from`, `export … from`, `import "…"`, `import("…")` and `require("…")`.
fn imports(source: &str) -> Vec<Import> {
    let (code, strings) = blank(source);
    let mut found = Vec::new();
    for (start, end) in strings {
        let before = code[..start].trim_end();
        let specifier = source[start + 1..end - 1].to_owned();
        let line = 1 + source[..start].matches('\n').count();
        let names = if let Some(head) = keyword_end(before, "from") {
            let Some(statement) = ["import", "export"]
                .iter()
                .filter_map(|keyword| keyword_start(head, keyword).map(|at| (at, keyword.len())))
                .max()
            else {
                continue;
            };
            named(&head[statement.0 + statement.1..])
        } else if keyword_end(before, "import").is_some() {
            Some(Vec::new())
        } else if let Some(call) = before.strip_suffix('(') {
            let call = call.trim_end();
            if keyword_end(call, "import").is_none() && keyword_end(call, "require").is_none() {
                continue;
            }
            None
        } else {
            continue;
        };
        found.push(Import {
            specifier,
            line,
            names,
        });
    }
    found
}

/// The names an import clause takes by name (`{ A, B as C }` gives A and B), or `None` when it takes more.
fn named(clause: &str) -> Option<Vec<String>> {
    let clause = clause.trim();
    let inner = clause.strip_prefix('{')?.strip_suffix('}')?;
    Some(
        inner
            .split(',')
            .filter_map(|name| name.split_whitespace().next().map(str::to_owned))
            .collect(),
    )
}

/// `text` with its comments blanked (newlines kept), and where each string literal starts and ends.
fn blank(source: &str) -> (String, Vec<(usize, usize)>) {
    let bytes = source.as_bytes();
    let mut code = bytes.to_vec();
    let mut strings = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'/' if bytes.get(at + 1) == Some(&b'/') => {
                while at < bytes.len() && bytes[at] != b'\n' {
                    code[at] = b' ';
                    at += 1;
                }
            }
            b'/' if bytes.get(at + 1) == Some(&b'*') => {
                let end = source[at + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |end| at + 2 + end + 2);
                for byte in &mut code[at..end] {
                    if *byte != b'\n' {
                        *byte = b' ';
                    }
                }
                at = end;
            }
            quote @ (b'"' | b'\'' | b'`') => {
                let start = at;
                at += 1;
                while at < bytes.len() && bytes[at] != quote {
                    at += if bytes[at] == b'\\' { 2 } else { 1 };
                }
                let end = (at + 1).min(bytes.len());
                for byte in &mut code[start..end] {
                    if *byte != b'\n' {
                        *byte = b' ';
                    }
                }
                if quote != b'`' && at < bytes.len() {
                    strings.push((start, end));
                }
                at = end;
            }
            _ => at += 1,
        }
    }
    (
        String::from_utf8(code).expect("blanking keeps UTF-8"),
        strings,
    )
}

fn ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// When `text` ends with `word` as a whole word, what comes before it.
fn keyword_end<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    let head = text.strip_suffix(word)?;
    (!head.chars().next_back().is_some_and(ident)).then_some(head)
}

/// Where the last `word` in `text` starts as a whole word.
fn keyword_start(text: &str, word: &str) -> Option<usize> {
    text.rmatch_indices(word).map(|(at, _)| at).find(|&at| {
        !text[..at].chars().next_back().is_some_and(ident)
            && !text[at + word.len()..].chars().next().is_some_and(ident)
    })
}

/// Edit distance, to name the catalog name a misspelt one is closest to.
fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let next = (diagonal + usize::from(ca != *cb))
                .min(row[j] + 1)
                .min(row[j + 1] + 1);
            diagonal = row[j + 1];
            row[j + 1] = next;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_are_read_with_their_lines_and_names() {
        let source = "// import { x } from \"gpui-kit\";\nimport { View, div as d } from \"@deepbuild/panel\";\n/* \"gpui-base\" */ import * as P from 'gpui-base';\nconst s = \"from 'gpui-shell'\";\nimport \"./side.js\";\nexport { a } from \"./a.js\";\nconst m = await import(\"gpui-fps\");\n";
        let found = imports(source);
        let seen: Vec<(&str, usize, Option<Vec<String>>)> = found
            .iter()
            .map(|i| (i.specifier.as_str(), i.line, i.names.clone()))
            .collect();
        assert_eq!(
            seen,
            vec![
                (
                    "@deepbuild/panel",
                    2,
                    Some(vec!["View".to_owned(), "div".to_owned()])
                ),
                ("gpui-base", 3, None),
                ("./side.js", 5, Some(vec![])),
                ("./a.js", 6, Some(vec!["a".to_owned()])),
                ("gpui-fps", 7, None),
            ]
        );
    }

    #[test]
    fn the_served_module_holds_every_catalog_name_once() {
        let source = source();
        for name in catalog().offered.keys() {
            assert_eq!(
                source.matches(&format!(" {name},")).count()
                    + source.matches(&format!(" {name} }}")).count(),
                1,
                "{name} in {source}"
            );
        }
        // A panel importing the module whole reaches nothing off the catalog.
        for name in catalog()
            .not_offered
            .keys()
            .filter(|name| !catalog().offered.contains_key(*name))
        {
            assert!(
                !source.contains(&format!(" {name},")) && !source.contains(&format!(" {name} }}")),
                "{name} in {source}"
            );
        }
    }
}
