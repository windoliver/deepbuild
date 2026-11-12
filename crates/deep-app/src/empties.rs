//! Issue #1461: the three empties, from one table. Nothing here, not read yet and couldn't read are drawn
//! differently, in words and in mark, so a failed read never looks calm (#1453 rule 11, invariant 2). Each line is on
//! the safety list.

/// What the hub says when it can't be read.
pub const HUB_DOWN: &str = "The hub isn't answering";
/// Where a count or a row isn't read yet: never 0.
pub const READING: &str = "reading";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Empty {
    /// Read, and nothing's there.
    Nothing,
    /// Not read yet.
    Reading,
    /// The hub isn't answering, since when it went down.
    Unreachable { since: Option<u64> },
}

impl Empty {
    /// Which empty a place is in: a hub said down wins, then a record not read yet, else it's read.
    pub fn of(hub_down: bool, since: Option<u64>, read: bool) -> Self {
        match (hub_down, read) {
            (true, _) => Empty::Unreachable { since },
            (false, false) => Empty::Reading,
            (false, true) => Empty::Nothing,
        }
    }

    /// Its words: `nothing`, the place's own short line, for the first; the table's for the others.
    pub fn words(self, nothing: &str, now: u64) -> String {
        match self {
            Empty::Nothing => nothing.to_owned(),
            Empty::Reading => READING.to_owned(),
            Empty::Unreachable { since: Some(since) } => {
                format!("{HUB_DOWN} since {}", crate::states::moment(since, now))
            }
            Empty::Unreachable { since: None } => HUB_DOWN.to_owned(),
        }
    }

    /// The status-map entry its mark draws: none for nothing here, which alone reads calm.
    pub fn entry(self) -> Option<&'static str> {
        match self {
            Empty::Nothing => None,
            Empty::Reading => Some("running"),
            Empty::Unreachable { .. } => Some("blocked"),
        }
    }

    /// Its value in the tree.
    pub fn value(self) -> &'static str {
        match self {
            Empty::Nothing => "nothing",
            Empty::Reading => "reading",
            Empty::Unreachable { .. } => "unreachable",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_empties_differ_in_words_and_mark_and_a_down_hub_never_reads_0() {
        let all = [
            Empty::of(false, None, true),
            Empty::of(false, None, false),
            Empty::of(true, Some(0), false),
        ];
        let words: Vec<String> = all
            .iter()
            .map(|e| e.words("Nothing needs you", 0))
            .collect();
        assert_eq!(words[0], "Nothing needs you");
        assert_eq!(words[1], "reading");
        assert!(words[2].starts_with("The hub isn't answering since "));
        let marks: Vec<_> = all.iter().map(|e| e.entry()).collect();
        assert_eq!(marks, [None, Some("running"), Some("blocked")]);
        assert_eq!(
            Empty::of(true, None, true),
            Empty::Unreachable { since: None }
        );
        assert!(words
            .iter()
            .all(|w| !w.contains('0') || w.contains("since")));
    }
}
