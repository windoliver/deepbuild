//! The text control (canvas primitives: Control: text): what you type, carried to a piece's
//! logic as bytes. The field is viewer state while you edit it: its text, the candidate an input
//! method is composing and an undo stack of its own, the stack gone at the commit. A commit writes
//! one entry, the field's whole content as UTF-8 exactly as typed, never normalized, with line
//! ends as LF. Typing stops at `max_bytes`, and a paste that would pass it is refused whole.
//! Leaving the field commits an edit, and only Esc discards one, back to the last commit.

/// The wrong programs of the text control, chosen only by a proof scenario's `planted`: a field
/// that normalizes its text to NFC at the commit, and one that commits on the Enter that
/// confirms an input method's candidate.
pub const PLANTED: [&str; 2] = ["text_normalizes_nfc", "text_commits_on_ime_confirm"];

/// The most bytes a text control may take.
pub const MOST: u32 = 16_384;

/// A text control's fields: `max_bytes` and whether Enter adds a line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spec {
    pub max_bytes: u32,
    pub many: bool,
}

impl Spec {
    /// The control's `text` fields, with the design's defaults; `None` past the cap or with an
    /// unknown `lines`.
    pub fn of(control: &serde_json::Value) -> Option<Spec> {
        let t = control.get("text");
        let max_bytes = match t.and_then(|t| t.get("max_bytes")) {
            None => 256,
            Some(v) => v.as_u64().filter(|n| *n <= MOST as u64)? as u32,
        };
        let many = match t.and_then(|t| t.get("lines")).map(|l| l.as_str()) {
            None | Some(Some("one")) => false,
            Some(Some("many")) => true,
            _ => return None,
        };
        Some(Spec { max_bytes, many })
    }
}

/// What an input to the field did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Did {
    /// Nothing the track or a notice sees.
    Edited,
    /// A commit: the bytes of the one entry it writes.
    Commit(String),
    /// Esc: the edit is discarded and writes nothing.
    Discarded,
    /// A paste refused whole, with the notice that names the cap.
    Refused(String),
}

/// A field: its text, the candidate being composed, its undo stack, and what the last commit
/// held, which Esc goes back to.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Field {
    pub text: String,
    /// The candidate an input method is composing, not yet in `text`.
    pub composing: Option<String>,
    undo: Vec<String>,
    redo: Vec<String>,
    kept: String,
}

impl Field {
    /// Line ends as LF: a CR LF or a lone CR becomes LF.
    pub fn lf(s: &str) -> String {
        s.replace("\r\n", "\n").replace('\r', "\n")
    }

    fn fits(&self, spec: Spec, more: &str) -> bool {
        self.text.len() + more.len() <= spec.max_bytes as usize
    }

    /// One undo step: `s` added.
    fn push(&mut self, s: &str) {
        if s.is_empty() {
            return;
        }
        self.undo.push(self.text.clone());
        self.redo.clear();
        self.text.push_str(s);
    }

    /// Whether the field holds an edit since its last commit.
    pub fn edited(&self) -> bool {
        self.text != self.kept
    }

    /// Typed text, one undo step: each character that fits goes in, and typing stops at the cap.
    pub fn typed(&mut self, spec: Spec, s: &str) -> Did {
        let mut took = String::new();
        for c in Field::lf(s).chars() {
            if c == '\n' && !spec.many {
                continue;
            }
            if self.text.len() + took.len() + c.len_utf8() > spec.max_bytes as usize {
                break;
            }
            took.push(c);
        }
        self.push(&took);
        Did::Edited
    }

    /// A paste: its line ends as LF, refused whole past the cap or, in a one-line field, with a
    /// line end in it.
    pub fn paste(&mut self, spec: Spec, s: &str) -> Did {
        let s = Field::lf(s);
        if !spec.many && s.contains('\n') {
            return Did::Refused("a one-line field takes no line end".into());
        }
        if !self.fits(spec, &s) {
            return Did::Refused(format!(
                "the paste of {} bytes would pass the field's cap of {} bytes",
                s.len(),
                spec.max_bytes
            ));
        }
        self.push(&s);
        Did::Edited
    }

    /// An input method's candidate, composed but not confirmed.
    pub fn compose(&mut self, s: &str) -> Did {
        self.composing = (!s.is_empty()).then(|| s.to_string());
        Did::Edited
    }

    /// The last character typed, taken back.
    pub fn backspace(&mut self) -> Did {
        if let Some(c) = &mut self.composing {
            c.pop();
            if c.is_empty() {
                self.composing = None;
            }
            return Did::Edited;
        }
        if !self.text.is_empty() {
            self.undo.push(self.text.clone());
            self.redo.clear();
            self.text.pop();
        }
        Did::Edited
    }

    /// ⌘Z: the field as it was before its last edit.
    pub fn undo(&mut self) -> Did {
        if let Some(t) = self.undo.pop() {
            self.redo.push(std::mem::replace(&mut self.text, t));
        }
        Did::Edited
    }

    /// ⇧⌘Z: the edit undone last, again.
    pub fn redo(&mut self) -> Did {
        if let Some(t) = self.redo.pop() {
            self.undo.push(std::mem::replace(&mut self.text, t));
        }
        Did::Edited
    }

    /// Enter: under an input method it confirms the candidate and commits nothing (planted: it
    /// commits too); in a one-line field it commits; in a many-line field it adds a line.
    pub fn enter(&mut self, spec: Spec, cmd: bool, planted_commit: bool) -> Did {
        if let Some(c) = self.composing.take() {
            if self.fits(spec, &c) {
                self.push(&c);
            }
            return if planted_commit {
                self.commit()
            } else {
                Did::Edited
            };
        }
        if spec.many && !cmd {
            if self.fits(spec, "\n") {
                self.push("\n");
            }
            return Did::Edited;
        }
        self.commit()
    }

    /// A commit: the field's bytes, which it keeps showing; its undo stack, viewer state, gone.
    pub fn commit(&mut self) -> Did {
        self.composing = None;
        self.undo.clear();
        self.redo.clear();
        self.kept = self.text.clone();
        Did::Commit(self.text.clone())
    }

    /// Leaving the field: a commit of an edit, and nothing for a field as it was committed.
    pub fn leave(&mut self) -> Did {
        if self.edited() {
            self.commit()
        } else {
            self.composing = None;
            Did::Edited
        }
    }

    /// Esc: the edit discarded, back to the last commit.
    pub fn escape(&mut self) -> Did {
        self.text = self.kept.clone();
        self.composing = None;
        self.undo.clear();
        self.redo.clear();
        Did::Discarded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANY: Spec = Spec {
        max_bytes: 16,
        many: true,
    };
    const ONE: Spec = Spec {
        max_bytes: 256,
        many: false,
    };

    #[test]
    fn a_paste_past_the_cap_is_refused_whole_and_the_field_keeps_its_text() {
        let mut f = Field::default();
        f.typed(MANY, "abc");
        let did = f.paste(MANY, &"x".repeat(14));
        assert!(matches!(did, Did::Refused(ref n) if n.contains("16")));
        assert_eq!(f.text, "abc");
        f.paste(MANY, "a\r\nb\rc");
        assert_eq!(f.text, "abca\nb\nc");
    }

    #[test]
    fn typing_stops_at_the_cap_and_keeps_bytes_as_typed() {
        let mut f = Field::default();
        for _ in 0..6 {
            f.typed(MANY, "e\u{301}");
        }
        assert_eq!(f.text.len(), 16);
        assert_eq!(f.commit(), Did::Commit("e\u{301}".repeat(5) + "e"));
    }

    #[test]
    fn the_enter_that_confirms_a_candidate_commits_nothing() {
        let mut f = Field::default();
        f.compose("にほん");
        assert_eq!(f.enter(ONE, false, false), Did::Edited);
        assert_eq!(f.enter(ONE, false, false), Did::Commit("にほん".into()));
        let mut planted = Field::default();
        planted.compose("にほん");
        assert_eq!(
            planted.enter(ONE, false, true),
            Did::Commit("にほん".into())
        );
    }

    #[test]
    fn undo_steps_a_stack_local_to_the_field_gone_at_the_commit() {
        let mut f = Field::default();
        for c in ["a", "b", "c"] {
            f.typed(ONE, c);
        }
        f.undo();
        f.undo();
        assert_eq!(f.text, "a");
        f.redo();
        assert_eq!(f.text, "ab");
        assert_eq!(f.enter(ONE, false, false), Did::Commit("ab".into()));
        f.undo();
        assert_eq!(f.text, "ab");
    }

    #[test]
    fn leaving_commits_an_edit_and_esc_goes_back_to_the_last_commit() {
        let mut f = Field::default();
        f.typed(ONE, "ab");
        assert_eq!(f.leave(), Did::Commit("ab".into()));
        assert_eq!(f.leave(), Did::Edited);
        f.typed(ONE, "c");
        assert_eq!(f.escape(), Did::Discarded);
        assert_eq!(f.text, "ab");
    }
}
