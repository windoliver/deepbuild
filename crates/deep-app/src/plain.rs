//! Issue #1348: one set of plain words for everyone. The card, the page, notifications and the run's end notice use
//! only the plain words of `contracts/plain-words.json`, the one list in the repo; a session's page and whatever a row
//! opens keep the real names. A problem on those surfaces reads as what happened and what happens next, never its
//! code, path or stack trace, which stay one click away. The `plain words` lane judges what they draw with
//! [`listed`] and [`trace`].

use std::sync::OnceLock;

use serde_json::Value;

use crate::states::{State, Table, SEND_BACKS};

/// The word list: each internal word with its plain word, longest first, so "pull request" is named before "PR".
pub fn words() -> &'static [(String, String)] {
    static WORDS: OnceLock<Vec<(String, String)>> = OnceLock::new();
    WORDS.get_or_init(|| {
        let list: Value = serde_json::from_str(include_str!("../../../contracts/plain-words.json"))
            .expect("contracts/plain-words.json is JSON");
        let mut words: Vec<(String, String)> = list["words"]
            .as_object()
            .expect("contracts/plain-words.json holds a words object")
            .iter()
            .map(|(word, plain)| (word.clone(), plain.as_str().unwrap_or_default().to_owned()))
            .collect();
        words.sort_by_key(|(word, _)| std::cmp::Reverse(word.len()));
        words
    })
}

/// The listed words `text` holds, each with its plain word: as a whole word, in any case, or with a plural ending.
pub fn listed(text: &str) -> Vec<(&'static str, &'static str)> {
    words()
        .iter()
        .filter(|(word, _)| holds(text, word))
        .map(|(word, plain)| (word.as_str(), plain.as_str()))
        .collect()
}

fn holds(text: &str, word: &str) -> bool {
    let (text, word) = (text.to_lowercase(), word.to_lowercase());
    let joins = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
    text.match_indices(&word).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let rest = &text[at + word.len()..];
        let rest = rest
            .strip_prefix("es")
            .filter(|after| !joins(after.chars().next()))
            .or_else(|| {
                rest.strip_prefix('s')
                    .filter(|after| !joins(after.chars().next()))
            })
            .unwrap_or(rest);
        !joins(before) && !joins(rest.chars().next())
    })
}

/// The lines of `text` that are a stack trace's: an error's heading, a frame with its file and line, or a
/// traceback's banner, in JavaScript, Python, Rust, Go and the JVM's forms.
pub fn trace(text: &str) -> Vec<&str> {
    text.lines().filter(|line| traced(line.trim())).collect()
}

fn traced(line: &str) -> bool {
    let frame = line.strip_prefix("at ").is_some_and(has_place);
    let heading = line.split_once(':').is_some_and(|(name, _)| {
        !name.contains(' ') && (name.ends_with("Error") || name.ends_with("Exception"))
    });
    let python = line.starts_with("Traceback (most recent call last)")
        || (line.starts_with("File \"") && line.contains("\", line "));
    let rust =
        line.starts_with("thread '") && line.contains("panicked at") || line == "stack backtrace:";
    let go = line.starts_with("goroutine ") && line.ends_with(':');
    frame || heading || python || rust || go
}

/// Whether `text` names a place in a file: `name.ext:line`, with a column or without.
fn has_place(text: &str) -> bool {
    text.split(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .any(|part| {
            let mut pieces = part.rsplitn(3, ':');
            let (last, mid) = (pieces.next(), pieces.next());
            let number = |piece: Option<&str>| {
                piece.is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
            };
            match (number(last), number(mid), pieces.next()) {
                (true, true, Some(file)) => file.contains('.'),
                (true, false, _) => mid.is_some_and(|file| file.contains('.')),
                _ => false,
            }
        })
}

/// A session's problem as its page row tells it, in plain words: what happened, then what happens next. Only a
/// session whose newest run failed has one; what failed, its output and its trace are on the session's page.
pub fn problem(table: &Table, session: &str) -> Option<(String, String)> {
    let failure = table.failure(session)?;
    let happened = if trace(failure).is_empty() {
        "A check didn't get what it expected."
    } else {
        "A check stopped with an error."
    };
    let next = match table.state(session) {
        State::SentBack { round } => {
            format!("The agent is fixing it, try {round} of {SEND_BACKS}.")
        }
        State::NeedsYou => "It waits for your answer.".to_owned(),
        State::Blocked => "It waits until what blocks it is cleared.".to_owned(),
        _ => "The agent looks at it next.".to_owned(),
    };
    Some((happened.to_owned(), next))
}

/// Whether the test build was asked to plant `name` (`DEEP_HUB_PLANT`); never in a build without `env-plants`.
pub fn planted(name: &str) -> bool {
    #[cfg(feature = "env-plants")]
    return std::env::var("DEEP_HUB_PLANT").as_deref() == Ok(name);
    #[cfg(not(feature = "env-plants"))]
    {
        let _ = name;
        false
    }
}

/// `card-line-pr`'s planted card line, and `session-page-line-pr`'s on a session's page.
pub const PLANTED_PR_LINE: &str = "PR #12 is ready for review";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listed_word_is_found_whole_in_any_case_and_plural_and_named_with_its_plain_word() {
        assert_eq!(listed("PR #12 is ready"), [("PR", "change to look at")]);
        assert_eq!(listed("two Issues left"), [("issue", "task")]);
        assert_eq!(listed("three branches"), [("branch", "draft")]);
        assert!(listed("a print preview of the repository").contains(&("repository", "project")));
        assert_eq!(listed("a print preview, approved"), []);
        assert_eq!(listed("Cart totals · needs you"), []);
    }

    #[test]
    fn a_trace_is_found_by_its_lines_and_a_plain_line_is_not_one() {
        let js = "TypeError: Cannot read properties of undefined (reading 'total')\n    at sumCart (/srv/shop/src/cart.ts:41:17)\n    at /srv/x.js:3:1";
        assert_eq!(trace(js).len(), 3);
        assert_eq!(
            trace("thread 'main' panicked at src/main.rs:4:5:\nboom").len(),
            1
        );
        assert_eq!(
            trace("Traceback (most recent call last):\n  File \"a.py\", line 3, in f").len(),
            2
        );
        assert_eq!(
            trace("A check stopped with an error. It waits for your answer, at 14:20."),
            Vec::<&str>::new()
        );
        assert_eq!(
            trace("Error: a sentence with spaces before the colon"),
            ["Error: a sentence with spaces before the colon"]
        );
        assert_eq!(
            trace("Default: Stop · applies at 14:20"),
            Vec::<&str>::new()
        );
    }
}
