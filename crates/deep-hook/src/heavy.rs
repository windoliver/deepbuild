//! Heavy commands (#1015): a shell call that runs a full build or test suite is matched here, at PreToolUse, against
//! `heavy.command@1` entries, so the hub can run it under `deep lease`. The entries are data: DeepBuild's own
//! (heavy.json, compiled in) and the repo's, the `heavy_commands` list of its `.deepbuild/done.yaml`. Matching is one
//! of deep-hook's fast rules: it reads two small files and the call's command line, and never waits on the hub.
//!
//! An entry matches a program the line runs by its argument prefix alone: the program and its words start with
//! `argv_prefix`. DeepBuild's own entries name whole runs, so they also need every word after the prefix to be an
//! option: a word that isn't one names what to build or test, such as one test file or `-p` with one crate, and that
//! focused run matches no shipped entry. A repo's entry matches every command its prefix starts.
//! A line already under `deep lease`, or under the repo's own `scripts/lease`, matches nothing.

use std::fs;
use std::path::Path;

use deep_contracts::{parse, Value};
use deep_hook::shell;

/// DeepBuild's own entries.
const SHIPPED: &str = include_str!("heavy.json");
/// The largest done.yaml read.
const DONE_YAML: u64 = 64 * 1024;

/// One heavy.command@1 entry, as far as matching reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub argv_prefix: Vec<String>,
    pub kinds: Vec<String>,
    /// How it takes jobs (#1016): `jobserver`, `n` (a worker count set by `jobs_flag`), `none` or a fixed number.
    pub jobs: String,
    pub jobs_flag: Option<String>,
    /// Whether it names a whole run, as DeepBuild's own do: a word after its prefix that isn't an option focuses it.
    pub whole: bool,
}

/// The entry a call matched: what the hub leases it by.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub name: String,
    pub kinds: Vec<String>,
    pub jobs: String,
    pub jobs_flag: Option<String>,
}

fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| match v {
                Value::String(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn shipped() -> Vec<Entry> {
    let Ok(Value::Array(items)) = parse(SHIPPED) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let Value::Object(members) = item else {
                return None;
            };
            let get = |key: &str| members.iter().find(|(k, _)| k == key).map(|(_, v)| v);
            let Some(Value::String(name)) = get("name") else {
                return None;
            };
            let text = |key: &str| match get(key) {
                Some(Value::String(s)) => Some(s.clone()),
                _ => None,
            };
            Some(Entry {
                name: name.clone(),
                argv_prefix: strings(get("argv_prefix")),
                kinds: strings(get("kinds")),
                jobs: text("jobs").unwrap_or_else(|| "none".to_string()),
                jobs_flag: text("jobs_flag"),
                whole: true,
            })
        })
        .collect()
}

/// A YAML scalar as written: its comment and quotes taken off.
fn scalar(text: &str) -> String {
    let text = match text.find(" #") {
        Some(at) if !text.starts_with(['"', '\'']) => &text[..at],
        _ => text,
    }
    .trim();
    let quoted = text.len() >= 2
        && ((text.starts_with('"') && text.ends_with('"'))
            || (text.starts_with('\'') && text.ends_with('\'')));
    if quoted {
        text[1..text.len() - 1].to_string()
    } else {
        text.to_string()
    }
}
/// A flow list, `[a, b]`, as its scalars.
fn flow(text: &str) -> Option<Vec<String>> {
    let inner = text.trim().strip_prefix('[')?.strip_suffix(']')?;
    Some(
        inner
            .split(',')
            .map(scalar)
            .filter(|s| !s.is_empty())
            .collect(),
    )
}

/// The `heavy_commands` list of a done.yaml: block mappings whose lists are flow (`[npx, vitest, run]`) or block
/// lists. An entry with no name or no prefix is left out.
pub fn repo_entries(text: &str) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut inside = false;
    let mut list: Option<&'static str> = None;
    for raw in text.lines() {
        let line = raw.trim_end();
        let body = line.trim_start();
        if body.is_empty() || body.starts_with('#') {
            continue;
        }
        let indent = line.len() - body.len();
        if indent == 0 && !body.starts_with('-') {
            inside = body == "heavy_commands:" || body.starts_with("heavy_commands: ");
            list = None;
            continue;
        }
        if !inside {
            continue;
        }
        let (body, item) = match body.strip_prefix("- ") {
            Some(rest) => (rest.trim_start(), true),
            None if body == "-" => ("", true),
            None => (body, false),
        };
        if item && list.is_some() && !body.contains(':') {
            let value = scalar(body);
            if let Some(e) = entries.last_mut() {
                match list {
                    Some("argv_prefix") => e.argv_prefix.push(value),
                    Some("kinds") => e.kinds.push(value),
                    _ => {}
                }
            }
            continue;
        }
        if item {
            entries.push(Entry {
                name: String::new(),
                argv_prefix: Vec::new(),
                kinds: Vec::new(),
                jobs: "none".to_string(),
                jobs_flag: None,
                whole: false,
            });
            list = None;
        }
        let Some((key, value)) = body.split_once(':') else {
            continue;
        };
        let Some(e) = entries.last_mut() else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        list = None;
        match key {
            "name" => e.name = scalar(value),
            "jobs" => e.jobs = scalar(value),
            "jobs_flag" => e.jobs_flag = Some(scalar(value)).filter(|f| !f.is_empty()),
            "argv_prefix" | "kinds" => {
                let items = if value.is_empty() {
                    list = Some(if key == "kinds" {
                        "kinds"
                    } else {
                        "argv_prefix"
                    });
                    Vec::new()
                } else {
                    flow(value).unwrap_or_default()
                };
                if key == "kinds" {
                    e.kinds = items;
                } else {
                    e.argv_prefix = items;
                }
            }
            _ => {}
        }
    }
    entries.retain(|e| !e.name.is_empty() && !e.argv_prefix.is_empty());
    entries
}

/// The repo's entries: the done.yaml of the nearest folder from `cwd` up that has one, stopping at the worktree's
/// root (the folder with `.git`).
fn repo(cwd: &Path) -> Vec<Entry> {
    for dir in cwd.ancestors() {
        let file = dir.join(".deepbuild/done.yaml");
        if let Ok(meta) = fs::metadata(&file) {
            if meta.len() <= DONE_YAML {
                return fs::read_to_string(&file)
                    .map(|t| repo_entries(&t))
                    .unwrap_or_default();
            }
        }
        if dir.join(".git").exists() {
            break;
        }
    }
    Vec::new()
}

/// Whether a program's words, its name first, start with the entry's prefix, adding only options after a whole run's.
fn covers(e: &Entry, words: &[&str]) -> bool {
    let prefix = &e.argv_prefix;
    !prefix.is_empty()
        && words.len() >= prefix.len()
        && prefix.iter().zip(words).all(|(p, w)| p == w)
        && (!e.whole || words[prefix.len()..].iter().all(|w| w.starts_with('-')))
}

/// The `deep lease` form of a matched command: word for word when it is one plain command, else through `sh -c`.
pub fn form(command: &str, kinds: &[String]) -> String {
    let typed = command.trim();
    let word = |c: char| c.is_ascii_alphanumeric() || "_./=:,+@%^-".contains(c);
    let plain = !typed.is_empty() && typed.chars().all(|c| word(c) || c == ' ' || c == '\t');
    let kinds: String = kinds.iter().map(|k| format!("{k} ")).collect();
    if plain {
        format!("deep lease {kinds}-- {typed}")
    } else {
        format!(
            "deep lease {kinds}-- /bin/sh -c '{}'",
            typed.replace('\'', "'\\''")
        )
    }
}

/// The deny an agent whose calls can't be rewritten gets once: the leased command to run instead, in backticks.
pub fn denial(command: &str, form: &str, entry: &str) -> String {
    format!("DeepBuild runs heavy commands under one lease, so builds and test suites share the machine: `{}` is one (heavy command {entry}). Run `{form}` instead; it waits for a free slot and runs at a lower priority.", command.trim())
}

/// The entry the line's first heavy program matches, or none.
pub fn matched(command: &str, cwd: Option<&Path>, home: &Path, plant: Option<&str>) -> Option<Hit> {
    matched_in(&shell::runs(command, cwd, home), command, cwd, plant)
}

/// [`matched`] for a line whose runs are read already, as a hook's call is: the reader reads it once.
pub fn matched_in(
    runs: &[shell::Run],
    command: &str,
    cwd: Option<&Path>,
    plant: Option<&str>,
) -> Option<Hit> {
    // Already leased: through `deep lease` or the repo's own lease script.
    let leased =
        |r: &shell::Run| (r.is("deep") && r.words().first() == Some(&"lease")) || r.is("lease");
    if runs.iter().any(leased) {
        return None;
    }
    let mut entries = cwd.map(repo).unwrap_or_default();
    entries.extend(shipped());
    // What each program runs as the reader reads it (through `sh -c`, `env` and wrappers such as `npx`), and each
    // simple command's words as typed, so a prefix that names the wrapper (`npx vitest run`) matches too.
    let read = runs.iter().filter(|r| !r.program.is_empty()).map(|r| {
        let mut words = vec![r.program.clone()];
        words.extend(r.words().into_iter().map(str::to_string));
        words
    });
    // Only a line with no quoting or expansion is read as typed: in one with them, a `;` may be inside a message.
    let plain = !command.contains(['\'', '"', '`', '$', '\\']);
    let typed = command
        .split([';', '&', '|', '\n', '(', ')'])
        .filter(|_| plain)
        .map(|segment| {
            segment
                .split_whitespace()
                .map(str::to_string)
                .skip_while(|w| w.contains('=') && !w.starts_with('-'))
                .collect::<Vec<_>>()
        });
    for words in read.chain(typed).filter(|w| !w.is_empty()) {
        let words: Vec<&str> = words.iter().map(String::as_str).collect();
        // The planted wrong program for #1015's AC3: every cargo call matches, a focused one too.
        if plant == Some("leases-every-cargo") && words[0] == "cargo" {
            return Some(Hit {
                name: "cargo".to_string(),
                kinds: Vec::new(),
                jobs: "jobserver".to_string(),
                jobs_flag: None,
            });
        }
        if let Some(e) = entries.iter().find(|e| covers(e, &words)) {
            return Some(Hit {
                name: e.name.clone(),
                kinds: e.kinds.clone(),
                jobs: e.jobs.clone(),
                jobs_flag: e.jobs_flag.clone(),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(command: &str) -> Option<String> {
        matched(command, None, Path::new("/nonexistent"), None).map(|h| h.name)
    }

    #[test]
    fn full_runs_match_and_focused_ones_do_not() {
        assert_eq!(hit("cargo test --workspace").as_deref(), Some("cargo test"));
        assert_eq!(hit("cd x && make -j8").as_deref(), Some("make"));
        assert_eq!(hit("cargo test -p cart"), None);
        assert_eq!(hit("npx vitest run src/cart.test.ts"), None);
        assert_eq!(hit("pytest tests/test_cart.py"), None);
        assert_eq!(hit("deep lease -- cargo test --workspace"), None);
        assert_eq!(hit("scripts/lease cargo test --workspace"), None);
        assert_eq!(
            hit("npx playwright test").as_deref(),
            Some("playwright test")
        );
        assert_eq!(hit("git commit -m 'fix; make'"), None);
        assert_eq!(
            form("cargo test --workspace", &[]),
            "deep lease -- cargo test --workspace"
        );
        assert_eq!(
            form("cd a && make", &["gpu:shared".into()]),
            "deep lease gpu:shared -- /bin/sh -c 'cd a && make'"
        );
    }

    #[test]
    fn a_repo_list_is_read_in_flow_and_block_forms() {
        let flow = repo_entries("asks:\n  x: 1\nheavy_commands:\n  - name: vitest run\n    argv_prefix: [npx, vitest, run]\n    kinds: []\n    jobs: none\n");
        assert_eq!(flow.len(), 1);
        assert_eq!(flow[0].argv_prefix, ["npx", "vitest", "run"]);
        assert!(covers(
            &flow[0],
            &["npx", "vitest", "run", "src/cart.test.ts"]
        ));
        let block = repo_entries("heavy_commands:\n- name: \"e2e\"\n  argv_prefix:\n    - npm\n    - run\n    - e2e\n  kinds: [browser]\n");
        assert_eq!(block[0].argv_prefix, ["npm", "run", "e2e"]);
        assert_eq!(block[0].kinds, ["browser"]);
        let runner = repo_entries("heavy_commands:\n  - name: npm test\n    argv_prefix: [npm, test]\n    kinds: []\n    jobs: n\n    jobs_flag: --maxWorkers\n");
        assert_eq!(runner[0].jobs, "n");
        assert_eq!(runner[0].jobs_flag.as_deref(), Some("--maxWorkers"));
    }
}
