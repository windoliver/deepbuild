//! Issue #327: the OS confirming you, for an input the card can't trust by itself: a synthetic event, or an
//! accessibility action from a client the platform can't name (Voice Control, Switch Control, VoiceOver). It is
//! asked after the option is chosen, its prompt names the question and the option, and each confirmation
//! answers one card once: nothing is cached or reused. On macOS it is LocalAuthentication's prompt, Touch ID or
//! your password, which the shell raises for the reason the card hands it.

/// What the prompt says: the question and the option, so you confirm one answer, never a blank yes.
pub fn reason(question: &str, option: &str) -> String {
    let short = |text: &str, at: usize| text.chars().take(at).collect::<String>();
    format!(
        "answer “{}” with “{}”",
        short(question, 120),
        short(option, 80)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_reason_names_the_question_and_the_option() {
        assert_eq!(
            reason("Push to main?", "Allow"),
            "answer “Push to main?” with “Allow”"
        );
    }
}
