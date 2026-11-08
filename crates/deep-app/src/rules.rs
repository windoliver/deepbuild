//! Issue #344: the rules page as the app shows it. The hub writes `~/.deepbuild/wiki/rules.md` (`deep rules sync`):
//! per rule file a `deep:rule-file` line with its total in tokens, then one claim line per rule, carrying its file,
//! its scope, what enforces it (a guard by name, or text only) and its size. The app reads that page and nothing else.

use std::path::Path;

use serde_json::Value;

/// One rule file of the page, with its rules in the page's order.
#[derive(Clone, Debug, PartialEq)]
pub struct File {
    pub file: String,
    pub tokens: u64,
    pub rules: Vec<Rule>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub text: String,
    pub scope: String,
    /// `guard <name>`, `check <name>`, `requirement <name>` or `text only`.
    pub enforcer: String,
    pub tokens: u64,
    /// A rule you typed, rather than one a file holds.
    pub yours: bool,
    /// Held: an agent's edit took its line out, and the rule stays in force until you apply the proposal.
    pub held: bool,
}

/// The page's rule files, as the hub last wrote them; none when there is no page.
pub fn read(path: &Path) -> Vec<File> {
    std::fs::read_to_string(path)
        .map(|text| parse(&text))
        .unwrap_or_default()
}

fn marked<'a>(line: &'a str, mark: &str) -> Option<(&'a str, Value)> {
    let rest = line.strip_prefix("- ")?.strip_suffix(" -->")?;
    let (text, json) = rest.split_once(&format!(" <!-- {mark} "))?;
    Some((text, serde_json::from_str(json).ok()?))
}

pub fn parse(text: &str) -> Vec<File> {
    let mut files: Vec<File> = Vec::new();
    for line in text.lines() {
        if let Some((_, j)) = marked(line, "deep:rule-file") {
            files.push(File {
                file: j["file"].as_str().unwrap_or_default().to_owned(),
                tokens: j["tokens"].as_u64().unwrap_or(0),
                rules: Vec::new(),
            });
        } else if let Some((text, j)) = marked(line, "deep:claim") {
            // A claim line of the wiki's own, with no rule file before it, is no rule of this page.
            let (Some(file), Some(scope)) = (files.last_mut(), j["scope"].as_str()) else {
                continue;
            };
            let enforcer = &j["enforcer"];
            let kind = enforcer["kind"].as_str().unwrap_or("text");
            file.rules.push(Rule {
                text: text.to_owned(),
                scope: scope.to_owned(),
                enforcer: match (kind, enforcer["name"].as_str()) {
                    ("text", _) | (_, None) => "text only".to_owned(),
                    (kind, Some(name)) => format!("{kind} {name}"),
                },
                tokens: j["tokens"].as_u64().unwrap_or(0),
                yours: j["known"] == "you",
                held: j.get("held").is_some(),
            });
        }
    }
    // Root files first, then nested folders, then `.github`, then your home's: the order a repo reads in.
    files.sort_by_key(|f| match f.file.as_str() {
        p if p.starts_with('~') => 3,
        p if p.starts_with(".github") => 2,
        p if p.contains('/') => 1,
        _ => 0,
    });
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_each_file_and_each_rule_with_its_enforcer() {
        let page = r#"# rules

- .github/copilot-instructions.md <!-- deep:rule-file {"file":".github/copilot-instructions.md","tokens":5} -->
- Prefer named exports <!-- deep:claim {"id":"d","known":"repo","scope":"all","enforcer":{"kind":"text"},"tokens":4} -->
- AGENTS.md <!-- deep:rule-file {"file":"AGENTS.md","tokens":12} -->
- never force-push <!-- deep:claim {"id":"a","known":"repo","scope":"all","enforcer":{"kind":"guard","name":"no-force-push"},"tokens":4} -->
- Run the linter <!-- deep:claim {"id":"b","known":"repo","scope":"all","enforcer":{"kind":"text"},"tokens":3,"held":"doc:x"} -->
- a wiki claim <!-- deep:claim {"id":"c","known":"you"} -->
"#;
        let files = parse(page);
        assert_eq!(files.len(), 2);
        assert_eq!(
            files[0].file, "AGENTS.md",
            "the root file comes before .github's"
        );
        assert_eq!(files[0].tokens, 12);
        assert_eq!(
            files[0].rules.len(),
            2,
            "the wiki's own claim, with no scope, is no rule"
        );
        assert_eq!(files[0].rules[0].enforcer, "guard no-force-push");
        assert_eq!(files[0].rules[1].enforcer, "text only");
        assert!(files[0].rules[1].held);
    }
}
