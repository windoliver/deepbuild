//! How a `write:` or `read:` entry reads the paths a call writes or reads: by a file tool, a patch, the shell or an MCP
//! call's arguments (#1848), each path and each glob as written and as its links and `..` resolve.

use std::path::Path;

use super::{command_of, glob_path, Call, Hit};
use crate::shell::{lexical, real, same_name};

impl Call {
    /// A hit when a path this call writes (`kind` is `write`) or reads matches one of `rest`'s globs and none of its
    /// `!` exceptions, naming the path and how the call names it.
    pub(super) fn names_path(&self, kind: &str, rest: &str) -> Option<Hit> {
        let (but, globs): (Vec<&str>, Vec<&str>) =
            rest.split_whitespace().partition(|g| g.starts_with('!'));
        let (paths, by, verb) = if kind == "write" {
            (&self.writes, &self.by.0, "writes")
        } else {
            (&self.reads, &self.by.1, "reads")
        };
        if paths.is_empty() {
            return None;
        }
        // Each glob and each path is spelled out once, its links resolved, not once per pair
        // of them; the exceptions only once some glob matches.
        let globs: Vec<Vec<String>> = globs.iter().map(|g| self.glob_spellings(g)).collect();
        let mut excepted: Option<Vec<Vec<String>>> = None;
        let any = |globs: &[Vec<String>], forms: &[String]| {
            globs.iter().any(|g| {
                forms
                    .iter()
                    .any(|text| g.iter().any(|p| glob_path(p.as_bytes(), text.as_bytes())))
            })
        };
        let k = paths.iter().position(|w| {
            let forms = self.path_spellings(w);
            any(&globs, &forms)
                && !any(
                    excepted.get_or_insert_with(|| {
                        but.iter().map(|g| self.glob_spellings(&g[1..])).collect()
                    }),
                    &forms,
                )
        })?;
        // A redirection isn't one of its run's words, so the call's own line names it.
        let ran = match (by[k], &self.command, self.args.get(k)) {
            (Some((_, true)), Some(line), _) => format!(" It runs: {line}"),
            (Some((r, _)), _, _) => format!(" It runs: {}", command_of(&self.runs[r])),
            // An MCP call's path leads its lists: the argument that names it, as it names it (#1848).
            (None, _, Some((arg, value))) => format!(" Its argument {arg} names it: {value}"),
            _ => String::new(),
        };
        Some(Hit {
            detail: Some(format!("It {verb} {}.{ran}", real(&paths[k]).display())),
        })
    }

    /// A path glob as it is matched whole: as written and, when anchored, with its literal part's
    /// links resolved; one that isn't anchored matches under any folder.
    fn glob_spellings(&self, pattern: &str) -> Vec<String> {
        let pattern = match pattern.strip_prefix("~/") {
            Some(rest) => format!("{}/{rest}", self.home.display()),
            None if pattern == "~" => self.home.display().to_string(),
            None => pattern.to_string(),
        };
        let anchored = pattern.starts_with('/');
        let mut patterns = vec![pattern.clone()];
        // The file a config path links to is guarded as the config is: the glob's literal part, resolved.
        if anchored {
            let cut = pattern.find(['*', '?', '[']).unwrap_or(pattern.len());
            let (literal, tail) = pattern.split_at(cut);
            let resolved = real(Path::new(literal.trim_end_matches('/')));
            let joined = if literal.ends_with('/') {
                format!("{}/{tail}", resolved.display())
            } else {
                format!("{}{tail}", resolved.display())
            };
            patterns.push(joined);
        }
        // The planted twin matches the path only as written, against each glob only as written.
        if cfg!(feature = "plant-paths-as-written") {
            patterns.truncate(1);
        }
        patterns
            .iter()
            .map(|p| {
                let p = same_name(p);
                if anchored {
                    p
                } else {
                    format!("*/{p}")
                }
            })
            .collect()
    }

    /// A path as a glob is matched against it: as written and as its links resolve.
    fn path_spellings(&self, written: &Path) -> Vec<String> {
        // The planted twin matches the path only as written.
        let forms = if cfg!(feature = "plant-paths-as-written") {
            vec![lexical(written)]
        } else {
            vec![lexical(written), real(written)]
        };
        forms
            .iter()
            .map(|form| same_name(&form.to_string_lossy()))
            .collect()
    }
}
