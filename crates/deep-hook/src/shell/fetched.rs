//! What a registry runner (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`, …) fetches to run a program straight away (#1509).

use super::Val;

/// The packages a registry runner fetches to run a program straight away.
#[derive(Debug, Clone, Default)]
pub struct Fetched {
    /// The runner, as `npx` or `pnpm dlx`.
    pub runner: String,
    /// Whether it runs a package the project installed before fetching one, as npx and bunx do; dlx never does.
    pub local_first: bool,
    /// Each package as written, `name`, `name@version` or `@scope/name@tag`; None for one the line computes.
    pub packages: Vec<Option<String>>,
}

impl Fetched {
    /// What the runner `name` fetches, read from its words `rest`: the `at` words before the program it runs (its
    /// subcommand and options), then that program's word, which becomes the package's name past any scope and version,
    /// the program it runs. None for `pnpm exec`, `yarn exec` and `bun exec`, which run only what the project installed.
    pub(super) fn read(name: &str, rest: &mut [Val], at: usize) -> Option<Fetched> {
        let (before, word) = rest.split_at_mut(at.min(rest.len()));
        let word = word.first_mut();
        let text = |k: usize| before.get(k).and_then(|v| v.text.as_deref());
        let runner = match name {
            "npx" | "bunx" | "pnpx" => name.to_string(),
            _ => format!("{name} {}", text(0).unwrap_or_default()),
        };
        let mut packages = Vec::new();
        for k in 0..before.len() {
            match text(k) {
                Some("-p" | "--package") => packages.push(text(k + 1).map(str::to_string)),
                Some(t) if t.starts_with("--package=") => packages.push(Some(t[10..].to_string())),
                _ => {}
            }
        }
        if let Some(word) = word {
            if packages.is_empty() {
                packages.push(word.text.clone());
            }
            if let Some(t) = word.text.take() {
                let base = t.rsplit('/').next().unwrap_or(&t);
                word.text = Some(
                    base.split('@')
                        .find(|s| !s.is_empty())
                        .unwrap_or("")
                        .to_string(),
                );
            }
        }
        let local_first = !matches!(runner.as_str(), "pnpx" | "pnpm dlx" | "yarn dlx");
        (!runner.ends_with(" exec") || runner == "npm exec").then_some(Fetched {
            runner,
            local_first,
            packages,
        })
    }
}
