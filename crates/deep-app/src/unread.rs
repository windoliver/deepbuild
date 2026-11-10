//! Issue #1461: unread, one rule. A row is unread from a change in its state until its page has been open in the
//! front window for a second while you're present: input in the last 2 minutes, the screen awake and unlocked (#329's
//! presence). A row drawn in the list doesn't clear it. The hub keeps the mark (`rows.seen`), so the app and
//! `deep status --json` read the same.

use crate::shown::Seen;

/// How long a page is open, while you're present, before its row reads as read, in ms.
pub const READ_AFTER: u64 = 1_000;
/// How recent your last input is for you to count as present, in ms.
pub const PRESENT_WITHIN: u64 = 120_000;

/// The unread row whose page is open, and since when it's been open while you're present.
#[derive(Debug, Default)]
pub struct Reader {
    open: Option<(String, u64)>,
}

/// Whether you're present: the window in front, the screen awake and unlocked, and input in the last 2 minutes.
pub fn present(front: bool, seen: Seen, last_input: Option<u64>, now: u64) -> bool {
    front
        && seen.visible
        && seen.display_awake
        && !seen.session_locked
        && last_input.is_some_and(|at| now.saturating_sub(at) < PRESENT_WITHIN)
}

impl Reader {
    /// At `now`, with `row` the unread row whose page is open (none for any other page): the row to mark read, once
    /// its page has been open a second while you were present the whole time.
    pub fn due(&mut self, row: Option<&str>, present: bool, now: u64) -> Option<String> {
        let Some(row) = row.filter(|_| present) else {
            self.open = None;
            return None;
        };
        match &self.open {
            Some((open, since)) if open == row => {
                if now >= since + READ_AFTER {
                    self.open = None;
                    return Some(row.to_owned());
                }
                None
            }
            _ => {
                self.open = Some((row.to_owned(), now));
                None
            }
        }
    }

    /// When the open page's row comes due, if one is waiting.
    pub fn next_change(&self) -> Option<u64> {
        self.open.as_ref().map(|(_, since)| since + READ_AFTER)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AWAKE: Seen = Seen {
        visible: true,
        minimized: false,
        display_awake: true,
        session_locked: false,
    };

    /// The row read, if any, when `row`'s page is open from 0 to `open` ms, ticking every 100 ms.
    fn read_after(open: u64, last_input: Option<u64>, base: u64) -> Option<String> {
        let mut reader = Reader::default();
        let mut read = None;
        for t in (0..=open).step_by(100) {
            let now = base + t;
            let here = present(true, AWAKE, last_input, now);
            read = read.or(reader.due(Some("session:a"), here, now));
        }
        // The page is closed: nothing more.
        read.or(reader.due(None, true, base + open + 100))
    }

    #[test]
    fn a_page_open_a_second_while_you_are_present_reads_its_row() {
        let t = 1_000_000;
        assert_eq!(
            read_after(1_000, Some(t - 10_000), t).as_deref(),
            Some("session:a")
        );
    }

    #[test]
    fn half_a_second_or_away_reads_nothing() {
        let t = 1_000_000;
        assert_eq!(read_after(500, Some(t - 10_000), t), None);
        // Five minutes without input: you're away, however long the page is open.
        assert_eq!(read_after(5_000, Some(t - 300_000), t), None);
        assert_eq!(read_after(5_000, None, t), None);
        let locked = Seen {
            session_locked: true,
            ..AWAKE
        };
        assert!(!present(true, locked, Some(t), t));
        assert!(!present(false, AWAKE, Some(t), t));
    }

    #[test]
    fn coming_back_starts_the_second_again() {
        let t = 1_000_000;
        let mut reader = Reader::default();
        assert_eq!(reader.due(Some("session:a"), false, t), None);
        assert_eq!(reader.due(Some("session:a"), true, t + 100), None);
        assert_eq!(reader.due(Some("session:a"), true, t + 1_000), None);
        assert_eq!(
            reader.due(Some("session:a"), true, t + 1_100).as_deref(),
            Some("session:a")
        );
    }
}
