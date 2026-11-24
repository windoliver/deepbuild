//! The question card's planted wrong programs (moved out of question.rs whole, #3292).

/// The wrong programs the criteria name, each a switch (design: Dogfooding, planted twins). All off in the app.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Faults {
    /// AC1: a card that shows no scope.
    pub no_scope: bool,
    /// AC1: a count that follows the record while the card shows.
    pub count_follows_record: bool,
    /// AC2: the click mapped to the record's option order, not the drawn one.
    pub click_by_record_index: bool,
    /// AC3: a notification action that writes the default as an answer.
    pub notification_action_answers: bool,
    /// AC6: a card that leaves out the default.
    pub no_default: bool,
    /// AC9: the diff since the pin shown only once answered.
    pub diff_after_answer: bool,
    /// AC10: a shell that answers with the default on exit.
    pub answers_on_exit: bool,
    /// AC11: the first passed confirmation reused for the next card.
    pub reuses_confirmation: bool,
    /// AC13: an app that records only answers.
    pub records_only_answers: bool,
    /// AC15: the words answer every open ask with the key.
    pub answers_second_from_words: bool,
    /// AC16: a typed "yes" read as the allow option.
    pub typed_yes_allows: bool,
}
