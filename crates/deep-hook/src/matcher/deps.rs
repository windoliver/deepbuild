//! What a run adds as a dependency (#1509; design: Before each command): the packages a command names to add; the
//! packages a registry runner (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`) or a tool runner (`uvx`, `uv tool run`, `pipx`,
//! `python -m pip install`) fetches to run straight away, unless the repo's lockfile holds that version; and a bare
//! install (`npm install`, `npm ci`, `pnpm install`, `yarn`, `pip install -r`), which the hub reads through the
//! manifest's diff since the base, so one that adds no name is no decision.
//!
//! The hit's note says what was read, for the hub to ask about:
//! `dependency manager=<tool> registry=<npm|pypi|none> form=<run|add|manifest> <item>…`, each item a package as
//! `name` or `name@version`, or a manifest's absolute path, with `%` and spaces escaped.

use std::fs;
use std::path::{Path, PathBuf};

use crate::shell::{lexical, Run};

/// What a run adds: the tool that adds it, the registry it comes from, how, and the packages or manifests.
pub struct Added {
    manager: String,
    registry: &'static str,
    form: &'static str,
    items: Vec<String>,
}

impl Added {
    /// The hit's note, for the hub.
    pub fn note(&self) -> String {
        let mut note = format!(
            "dependency manager={} registry={} form={}",
            self.manager, self.registry, self.form
        );
        for item in &self.items {
            note.push(' ');
            note.push_str(&item.replace('%', "%25").replace(' ', "%20"));
        }
        note
    }
}

/// pip's options that take the next word as their value, which is no package.
const PIP_VALUED: &[&str] = &[
    "-r",
    "--requirement",
    "-c",
    "--constraint",
    "-e",
    "--editable",
    "-i",
    "--index-url",
    "-t",
    "--target",
];
/// The JS package managers' options that take the next word as their value.
const JS_VALUED: &[&str] = &[
    "--registry",
    "--prefix",
    "-C",
    "-w",
    "--workspace",
    "--filter",
    "--tag",
    "--cwd",
];
/// uvx's and pipx's options that take the next word as their value; `--from`, `--with` and `--spec` name packages.
const TOOL_VALUED: &[&str] = &[
    "--from",
    "--with",
    "-w",
    "--spec",
    "-p",
    "--python",
    "--index",
    "--index-url",
];

/// What `run` adds as a dependency; None when it adds none.
pub fn added(run: &Run) -> Option<Added> {
    let cwd = run.cwd.as_deref();
    let words = run.words();
    let at = |k: usize| words.get(k).copied().unwrap_or("");
    let run_of = |manager: &str, registry: &'static str, items: Vec<String>| Added {
        manager: manager.to_string(),
        registry,
        form: "run",
        items,
    };
    // A registry runner fetches what the project didn't install at that version.
    if let Some(f) = &run.fetched {
        let manager = f.runner.split(' ').next().unwrap_or_default();
        let manager = if manager == "npx" {
            "npm"
        } else if manager == "bunx" {
            "bun"
        } else if manager == "pnpx" {
            "pnpm"
        } else {
            manager
        };
        let items = unlocked(&f.packages, cwd, Registry::Npm, f.local_first)?;
        return Some(run_of(manager, "npm", items));
    }
    // uvx, `uv tool run` and pipx fetch a tool from the registry to run in an environment of its own.
    let tool = if run.is("uvx") {
        Some(("uv", 0))
    } else if run.is("uv") && at(0) == "tool" && matches!(at(1), "run" | "install") {
        Some(("uv", 2))
    } else if run.is("pipx") && matches!(at(0), "run" | "install") {
        Some(("pipx", 1))
    } else {
        None
    };
    if let Some((manager, from)) = tool {
        let packages = tool_packages(&words[from.min(words.len())..]);
        let items = unlocked(&packages, cwd, Registry::Pypi, false)?;
        return Some(run_of(manager, "pypi", items));
    }
    // `python -m pip …` is pip, and `uv pip …` reads its words as pip does.
    let python = run.program.starts_with("python") && at(0) == "-m" && at(1) == "pip";
    let uv_pip = run.is("uv") && at(0) == "pip";
    let (program, rest): (&str, &[&str]) = if python {
        ("pip", &words[2..])
    } else if uv_pip {
        ("uv", &words[1..])
    } else {
        (run.program.as_str(), &words[..])
    };
    let registry = match program {
        "npm" | "pnpm" | "bun" | "yarn" => Registry::Npm,
        "pip" | "pip3" | "uv" => Registry::Pypi,
        _ => Registry::None,
    };
    let valued = if registry == Registry::Pypi {
        PIP_VALUED
    } else {
        JS_VALUED
    };
    // The words that aren't options, past each option's value, and the files `-r` names.
    let (mut plain, mut requirements) = (Vec::new(), Vec::new());
    let mut k = 0;
    while k < rest.len() {
        let w = rest[k];
        if valued.contains(&w) {
            if matches!(w, "-r" | "--requirement") && registry == Registry::Pypi {
                requirements.push(rest.get(k + 1).copied().unwrap_or_default());
            }
            k += 2;
            continue;
        }
        if let Some(file) = w
            .strip_prefix("--requirement=")
            .filter(|_| registry == Registry::Pypi)
        {
            requirements.push(file);
        } else if !w.starts_with('-') {
            plain.push(w);
        }
        k += 1;
    }
    let sub = plain.first().copied().unwrap_or("");
    let names: Vec<Option<String>> = plain.iter().skip(1).map(|n| Some(n.to_string())).collect();
    let asks_only = rest
        .iter()
        .any(|w| matches!(*w, "--version" | "-v" | "--help" | "-h"));
    let installs = match program {
        "npm" => matches!(sub, "install" | "i" | "add" | "ci"),
        "pnpm" | "bun" => matches!(sub, "install" | "i" | "add"),
        "yarn" => matches!(sub, "add" | "install") || (sub.is_empty() && !asks_only),
        "pip" | "pip3" | "gem" | "brew" => sub == "install",
        "uv" => sub == "add" || (uv_pip && sub == "install"),
        "cargo" => matches!(sub, "add" | "install"),
        "go" => matches!(sub, "get" | "install"),
        _ => false,
    };
    if !installs {
        return None;
    }
    let manager = if python { "pip" } else { program };
    let reg = registry.name();
    // A bare install installs what the manifest names: the hub reads which names it adds since the base.
    if names.is_empty() {
        let manifests: Vec<String> = match registry {
            Registry::Npm => vec![manifest(cwd, "package.json")],
            Registry::Pypi => requirements.iter().map(|r| path_in(cwd, r)).collect(),
            Registry::None => Vec::new(),
        };
        if manifests.is_empty() || (registry == Registry::Npm && sub == "add") {
            return None;
        }
        return Some(Added {
            manager: manager.to_string(),
            registry: reg,
            form: "manifest",
            items: manifests,
        });
    }
    let items = if registry == Registry::None {
        names.into_iter().flatten().collect()
    } else {
        unlocked(&names, cwd, registry, false)?
    };
    Some(Added {
        manager: manager.to_string(),
        registry: reg,
        form: "add",
        items,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Registry {
    Npm,
    Pypi,
    None,
}

impl Registry {
    fn name(self) -> &'static str {
        match self {
            Registry::Npm => "npm",
            Registry::Pypi => "pypi",
            Registry::None => "none",
        }
    }
}

/// The packages a tool runner fetches: the values of `--from`, `--with` and `--spec`, and its command's package when
/// no `--from` or `--spec` names it.
fn tool_packages(words: &[&str]) -> Vec<Option<String>> {
    let mut named = Vec::new();
    let mut command = None;
    let mut k = 0;
    while k < words.len() {
        let w = words[k];
        if TOOL_VALUED.contains(&w) {
            if matches!(w, "--from" | "--with" | "--spec" | "-w") {
                named.push((w, words.get(k + 1).map(|v| v.to_string())));
            }
            k += 2;
            continue;
        }
        if let Some((option, value)) = w
            .split_once('=')
            .filter(|(o, _)| matches!(*o, "--from" | "--with" | "--spec"))
        {
            named.push((option, Some(value.to_string())));
        } else if !w.starts_with('-') {
            command = Some(w.to_string());
            break;
        }
        k += 1;
    }
    let names_command = !named.iter().any(|(o, _)| matches!(*o, "--from" | "--spec"));
    let mut out: Vec<Option<String>> = named.into_iter().map(|(_, v)| v).collect();
    if names_command {
        out.extend(command.map(Some));
    }
    out
}

/// The packages the repo's lockfile doesn't hold at the version asked for, as `name` or `name@version`; None when it
/// holds them all. A package the line computes can't be held: it's named `?`.
fn unlocked(
    packages: &[Option<String>],
    cwd: Option<&Path>,
    registry: Registry,
    local_first: bool,
) -> Option<Vec<String>> {
    let mut locks: Option<Vec<(String, String)>> = None;
    let mut out = Vec::new();
    for package in packages {
        let Some(text) = package else {
            out.push("?".to_string());
            continue;
        };
        let name = name_of(text, registry);
        let asked = spec_text(text, registry);
        let locks =
            locks.get_or_insert_with(|| cwd.map(|c| lockfiles(c, registry)).unwrap_or_default());
        let held = locks.iter().any(|(file, body)| {
            let versions = locked(file, body, &name, registry);
            match &asked {
                // A runner that runs what the project installed runs the lockfile's version when none is asked for.
                None => local_first && !versions.is_empty(),
                // A tag or a range may be any version: only the exact one the lockfile holds is held.
                Some(v) => versions.iter().any(|l| l == v),
            }
        });
        if !held {
            out.push(match asked {
                Some(v) => format!("{name}@{v}"),
                None => name,
            });
        }
    }
    (!out.is_empty()).then_some(out)
}

/// What a package as written asks for past its name: a version, a tag or a range; None for no version.
fn spec_text(text: &str, registry: Registry) -> Option<String> {
    match registry {
        Registry::Pypi => {
            let cut = text.find(['=', '<', '>', '!', '~', '@', ';', ' '])?;
            let rest = text[cut..].trim();
            let rest = rest.split(';').next().unwrap_or("").trim();
            let exact_pin = rest
                .strip_prefix("===")
                .or_else(|| rest.strip_prefix("=="))
                .or_else(|| rest.strip_prefix('@'));
            Some(exact_pin.unwrap_or(rest).trim().to_string()).filter(|s| !s.is_empty())
        }
        _ => {
            // `@scope/name@version`: the version follows the last `@` past the first character.
            let at = text[1.min(text.len())..].rfind('@').map(|k| k + 1)?;
            Some(text[at + 1..].to_string()).filter(|s| !s.is_empty())
        }
    }
}

/// A package's name as written, past its version and, for PyPI, its extras.
fn name_of(text: &str, registry: Registry) -> String {
    match registry {
        Registry::Pypi => {
            let cut = text
                .find(['=', '<', '>', '!', '~', '@', ';', ' ', '['])
                .unwrap_or(text.len());
            text[..cut].trim().to_string()
        }
        _ => match text[1.min(text.len())..].rfind('@') {
            Some(k) => text[..k + 1].to_string(),
            None => text.to_string(),
        },
    }
}

/// A PyPI name as PEP 503 compares them: lowercase, with runs of `-`, `_` and `.` as one `-`.
fn pypi_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if matches!(c, '-' | '_' | '.') {
            if !out.ends_with('-') {
                out.push('-');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// The largest lockfile read: a bigger one is read as holding nothing.
const LOCK_MAX: u64 = 64 << 20;

/// The repo's lockfiles for a registry, by name with their text: the nearest folder from `cwd` up to its checkout's
/// root that holds one.
fn lockfiles(cwd: &Path, registry: Registry) -> Vec<(String, String)> {
    let names: &[&str] = match registry {
        Registry::Npm => &[
            "package-lock.json",
            "npm-shrinkwrap.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "bun.lock",
        ],
        Registry::Pypi => &["uv.lock", "poetry.lock", "pdm.lock"],
        Registry::None => &[],
    };
    let mut dir = Some(cwd);
    while let Some(at) = dir {
        let found: Vec<(String, String)> = names
            .iter()
            .filter_map(|n| {
                let path = at.join(n);
                let size = fs::metadata(&path).ok().filter(|m| m.is_file())?.len();
                (size <= LOCK_MAX)
                    .then(|| fs::read_to_string(&path).ok().map(|t| (n.to_string(), t)))?
            })
            .collect();
        if !found.is_empty() || at.join(".git").exists() {
            return found;
        }
        dir = at.parent();
    }
    Vec::new()
}

/// The value of `key` at the start of `text`, as `key: v`, `key = "v"` or `key "v"`; None for another key.
fn value_of(text: &str, key: &str) -> Option<String> {
    let rest = text.trim_start().strip_prefix(key)?;
    if !rest.starts_with([' ', '\t', ':', '=']) {
        return None;
    }
    let rest = rest.trim_start();
    let rest = rest.strip_prefix([':', '=']).unwrap_or(rest).trim_start();
    let value = match rest.strip_prefix(['"', '\'']) {
        Some(quoted) => &quoted[..quoted.find(['"', '\'']).unwrap_or(quoted.len())],
        None => rest.split([',', ' ', '\n', '\r']).next().unwrap_or(""),
    };
    Some(value.to_string()).filter(|v| !v.is_empty())
}

/// The versions a lockfile holds of `name`.
fn locked(file: &str, text: &str, name: &str, registry: Registry) -> Vec<String> {
    match file {
        // npm's lockfile v2 and v3: `"node_modules/<name>": { … "version": "<v>" … }`, at the top level only.
        "package-lock.json" | "npm-shrinkwrap.json" => {
            let key = format!("\"node_modules/{name}\"");
            text.match_indices(&key)
                .filter_map(|(k, _)| {
                    let after = &text[k + key.len()..];
                    let span = &after[..after.find("\"node_modules/").unwrap_or(after.len())];
                    let v = span.find("\"version\"")?;
                    value_of(&span[v..], "\"version\"")
                })
                .collect()
        }
        // `/name@1.2.3:`, `name@1.2.3:` or `'name@1.2.3(peer)':` keys under packages.
        "pnpm-lock.yaml" => text
            .lines()
            .filter_map(|line| {
                let key = line.trim().trim_start_matches(['\'', '"', '/']);
                let version = key.strip_prefix(name)?.strip_prefix('@')?;
                let end = version.find([':', '(', '\'', '"']).unwrap_or(version.len());
                Some(version[..end].to_string()).filter(|v| !v.is_empty())
            })
            .collect(),
        // An entry's header names its specs, `name@^1.0.0, "name@npm:^1.1.0":`, and its `version` line follows.
        "yarn.lock" => {
            let mut out = Vec::new();
            let mut ours = false;
            for line in text.lines() {
                if !line.starts_with([' ', '\t']) {
                    ours = line.trim_end_matches(':').split(", ").any(|entry| {
                        entry
                            .trim_matches('"')
                            .strip_prefix(name)
                            .is_some_and(|r| r.starts_with('@'))
                    });
                } else if ours {
                    if let Some(v) = value_of(line, "version") {
                        out.push(v);
                        ours = false;
                    }
                }
            }
            out
        }
        // `"name": ["name@1.2.3", …]`.
        "bun.lock" => {
            let key = format!("[\"{name}@");
            text.match_indices(&key)
                .filter_map(|(k, _)| {
                    let after = &text[k + key.len()..];
                    Some(after[..after.find('"')?].to_string())
                })
                .collect()
        }
        // `[[package]]` blocks: `name = "x"`, then `version = "1.2.3"`.
        _ if registry == Registry::Pypi => {
            let want = pypi_name(name);
            let mut out = Vec::new();
            let mut ours = false;
            for line in text.lines() {
                if line.starts_with("[[") {
                    ours = false;
                } else if let Some(n) = value_of(line, "name") {
                    ours = pypi_name(&n) == want;
                } else if let Some(v) = value_of(line, "version").filter(|_| ours) {
                    out.push(v);
                    ours = false;
                }
            }
            out
        }
        _ => Vec::new(),
    }
}

/// The manifest a bare install reads: the nearest `name` from `cwd` up to its checkout's root, else `cwd`'s.
fn manifest(cwd: Option<&Path>, name: &str) -> String {
    let Some(cwd) = cwd else {
        return name.to_string();
    };
    let mut dir = Some(cwd);
    while let Some(at) = dir {
        if at.join(name).is_file() {
            return at.join(name).display().to_string();
        }
        if at.join(".git").exists() {
            break;
        }
        dir = at.parent();
    }
    cwd.join(name).display().to_string()
}

/// `file` as the path it is in `cwd`.
fn path_in(cwd: Option<&Path>, file: &str) -> String {
    match cwd {
        Some(c) if !Path::new(file).is_absolute() => lexical(&c.join(file)).display().to_string(),
        _ => PathBuf::from(file).display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::super::{Call, Names};

    /// A checkout holding `files`, each `(name, text)`.
    fn repo(files: &[(&str, &str)]) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "dh1509u-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(dir.join(".git")).unwrap();
        for (name, text) in files {
            fs::write(dir.join(name), text).unwrap();
        }
        dir
    }

    /// The note deep-hook gives `line` run in `dir`; None when it adds no dependency.
    fn note(dir: &Path, line: &str) -> Option<String> {
        let home = Path::new("/h");
        Call::new(
            "Bash",
            Some(line),
            (&[], &[], Names::Writes),
            Some(dir),
            home,
            &home.join("hub.sock"),
        )
        .matches("effect:dependency")
        .and_then(|hit| hit.detail)
    }

    #[test]
    fn a_package_run_from_a_registry_is_held_only_at_the_version_its_lockfile_holds() {
        let lockfiles = [
            ("package-lock.json", "{\n  \"packages\": {\n    \"node_modules/vitest\": {\n      \"version\": \"5.0.5\"\n    }\n  }\n}\n", "npx"),
            ("pnpm-lock.yaml", "packages:\n\n  vitest@5.0.5:\n    resolution: {integrity: x}\n", "pnpm dlx"),
            ("yarn.lock", "vitest@^5.0.0:\n  version \"5.0.5\"\n", "yarn dlx"),
            ("yarn.lock", "\"vitest@npm:^5.0.0\":\n  version: 5.0.5\n", "yarn dlx"),
            ("bun.lock", "{\n  \"packages\": {\n    \"vitest\": [\"vitest@5.0.5\", \"\", {}, \"sha512-x\"],\n  }\n}\n", "bunx"),
            ("uv.lock", "version = 1\n\n[[package]]\nname = \"Vi_Test\"\nversion = \"5.0.5\"\n", "uvx"),
            ("poetry.lock", "[[package]]\nname = \"vitest\"\nversion = \"5.0.5\"\n", "pipx run"),
        ];
        for (file, text, runner) in lockfiles {
            let dir = repo(&[(file, text)]);
            let pin = if runner == "pipx run" { "==" } else { "@" };
            let name = if runner == "uvx" { "vi-test" } else { "vitest" };
            let held = note(&dir, &format!("{runner} {name}{pin}5.0.5"));
            assert_eq!(held, None, "{file} holds {name} 5.0.5");
            let other = note(&dir, &format!("{runner} {name}{pin}5.0.4")).unwrap_or_default();
            assert!(
                other.contains(&format!(" form=run {name}@5.0.4")),
                "{file} holds no 5.0.4: {other}"
            );
            if pin == "@" {
                let tag = note(&dir, &format!("{runner} {name}@latest")).unwrap_or_default();
                assert!(
                    tag.ends_with(&format!(" {name}@latest")),
                    "{file}: a tag may be any version: {tag}"
                );
            }
            // npx and bunx run what the project installed when no version is asked for; dlx and the tool runners fetch.
            let bare = note(&dir, &format!("{runner} {name}"));
            assert_eq!(
                bare.is_none(),
                matches!(runner, "npx" | "bunx"),
                "{runner} {name}: {bare:?}"
            );
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn each_form_names_what_it_adds_and_a_bare_install_its_manifest() {
        let dir = repo(&[
            ("requirements.txt", "requests==2.31.0\n"),
            ("package.json", "{}\n"),
        ]);
        let at = |file: &str| dir.join(file).display().to_string();
        let cases = [
            (
                "npx -y some-pkg@latest",
                Some("manager=npm registry=npm form=run some-pkg@latest".to_string()),
            ),
            ("pnpm exec vitest", None),
            (
                "uv tool run black",
                Some("manager=uv registry=pypi form=run black".to_string()),
            ),
            (
                "pipx install poetry==1.8.0",
                Some("manager=pipx registry=pypi form=run poetry@1.8.0".to_string()),
            ),
            (
                "python3 -m pip install requests",
                Some("manager=pip registry=pypi form=add requests".to_string()),
            ),
            (
                "pip install -r requirements.txt",
                Some(format!(
                    "manager=pip registry=pypi form=manifest {}",
                    at("requirements.txt")
                )),
            ),
            (
                "npm ci",
                Some(format!(
                    "manager=npm registry=npm form=manifest {}",
                    at("package.json")
                )),
            ),
            ("yarn --version", None),
            ("npm run build", None),
        ];
        for (line, want) in cases {
            assert_eq!(
                note(&dir, line),
                want.map(|w| format!("dependency {w}")),
                "{line}"
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
