//! Issue #327: the question card's controller, one per presentation. It reads the card's content once from the
//! record ([`kinds::Model`]), runs the arming machine on the platform's timestamps ([`arming::Machine`]), takes
//! your words and an image, keeps the keyboard focus, turns a batch's switches, decides what each press does, and
//! writes two things the shell sends on: the `ask.answer` params ([`Controller::take_answers`]) and the usage rows
//! ([`Controller::take_usage`]). Nothing here reads a clock or talks to the hub: the shell feeds it timestamps and
//! the record, so the replica drives it on a virtual clock with recorded input.
//!
//! An input that isn't hardware answers only after the OS confirms you; the controller says what to ask
//! ([`Did::NeedsConfirmation`]) and takes the OS's answer ([`Controller::confirmed`]). One confirmation answers
//! one card once. The planted wrong programs the issue's criteria name are [`Faults`], each a switch the replica
//! builds the app with; every one is off in the app.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    answer::Answer,
    arming::{Machine, Outcome, Press, Slot, Source, State, HOLD_STILL},
    confirm,
    kinds::{Kind, Model},
};

/// The card's measured size, in window points, tall enough for a batch of four with its switches: a slot smaller
/// than this never arms.
pub const CARD_SIZE: [i64; 2] = [480, 480];
/// What a card says before it arms when words or an image are set and no option is chosen: the answer is this
/// ask's alone, never a decision for the key.
pub const ANSWERS_THIS_ASK_ONLY: &str = "Answers this ask only";
/// The same on an authority card: words never run the plan.
pub const WONT_RUN: &str = "Sends your words as the reason; this won't run";

/// Presentations are numbered across the process, so a card presented again after a relaunch gets a new `seq`.
static NEXT_SEQ: AtomicU64 = AtomicU64::new(0);
/// Whether an OS confirmation ever passed in this process: only the planted reuse reads it.
static PASSED_ONCE: AtomicBool = AtomicBool::new(false);

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

/// What a press lands on, by the card's draw order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Option(usize),
    Send,
    Undo,
    Step(usize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Down,
    Up,
    Repeat,
}

/// One press as the platform delivered it: its own timestamp, its source, where it landed and which half.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Input {
    pub t: u64,
    pub source: Source,
    pub target: Target,
    pub phase: Phase,
}

/// What the card says when you approve with the ask's own steps switched off.
pub const SWITCH_FIRST: &str = "Switch on this ask's steps to approve it";

/// What the card did with an input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Did {
    Nothing,
    /// A press before the card armed, or on a slot that never arms: a refused click, recorded.
    Refused,
    /// An answer was written for the shell to send.
    Answered,
    /// The press came from an input that isn't hardware: the OS must confirm you, with this reason.
    NeedsConfirmation(String),
    Undone,
    Switched,
}

/// One row the card draws: a line of text, or a control with its label.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Row {
    Text(String),
    Option {
        index: usize,
        label: String,
        focused: bool,
    },
    Step {
        index: usize,
        label: String,
        on: bool,
    },
    Send,
    Undo,
}

impl Row {
    /// The row's words, what an assistive client reads.
    pub fn label(&self) -> &str {
        match self {
            Row::Text(text) => text,
            Row::Option { label, .. } | Row::Step { label, .. } => label,
            Row::Send => "Send",
            Row::Undo => "Undo",
        }
    }
}

/// The answered card's one-line receipt, kept in the slot with Undo.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Receipt {
    says: String,
    /// The other open asks the answer also answered, as the record stood then: handle and question.
    also: Vec<(String, String)>,
}

/// An answer through Send from an input that isn't hardware, waiting for the OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SendWaiting {
    seq: u64,
}

pub struct Controller {
    model: Model,
    machine: Machine,
    faults: Faults,
    slot: Slot,
    words: String,
    /// The attached image, by its SHA-256 in the evidence store.
    image: Option<String>,
    focused: Option<usize>,
    /// The source of the press held down on Send, until its release.
    send_down: Option<Source>,
    send_waiting: Option<SendWaiting>,
    /// What the card says after a refused press, until it arms.
    holding: Option<&'static str>,
    /// An approval was held back because the ask's own steps are off.
    switch_first: bool,
    receipt: Option<Receipt>,
    answers: Vec<Value>,
    usage: Vec<Value>,
}

impl Controller {
    /// Presents the card for `ask` at `now` in `slot`, its content read from the record once: a new `seq`, the
    /// interval started, the presentation recorded. `None` when the record holds no such ask.
    pub fn present(
        events: &[Value],
        ask: &str,
        now: u64,
        slot: Slot,
        faults: Faults,
    ) -> Option<Controller> {
        let model = Model::read(events, ask, now)?;
        let mut machine = Machine::numbered(CARD_SIZE, NEXT_SEQ.fetch_add(1, Ordering::SeqCst));
        machine.present(now, slot);
        let mut controller = Controller {
            model,
            machine,
            faults,
            slot,
            words: String::new(),
            image: None,
            focused: None,
            send_down: None,
            send_waiting: None,
            holding: None,
            switch_first: false,
            receipt: None,
            answers: Vec::new(),
            usage: Vec::new(),
        };
        controller.record("presented", now);
        Some(controller)
    }

    pub fn model(&self) -> &Model {
        &self.model
    }

    pub fn seq(&self) -> u64 {
        self.machine.seq()
    }

    pub fn slot(&self) -> Slot {
        self.slot
    }

    pub fn focused(&self) -> Option<usize> {
        self.focused
    }

    /// The card's state as the surfaces name it.
    pub fn state_name(&self) -> &'static str {
        match self.machine.state() {
            State::Hidden => "hidden",
            State::Presented { .. } => "presented",
            State::Armed { .. } => "armed",
            State::Answered { .. } => "answered",
        }
    }

    /// Time passed to `now`: the card arms once its interval ran, and stops saying to hold still.
    pub fn tick(&mut self, now: u64) {
        self.machine.tick(now);
        if matches!(self.machine.state(), State::Armed { .. }) {
            self.holding = None;
        }
    }

    /// The record changed while the card shows. The card doesn't follow it: its scope and count are fixed at
    /// presentation. The planted twin re-reads them.
    pub fn record_changed(&mut self, events: &[Value], now: u64) {
        if self.faults.count_follows_record {
            if let Some(fresh) = Model::read(events, &self.model.ask, now) {
                self.model.scope = fresh.scope;
            }
        }
    }

    /// The `ask.answer` params written since last taken, in order, for the shell to sign and send.
    pub fn take_answers(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.answers)
    }

    /// The usage rows written since last taken, in order.
    pub fn take_usage(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.usage)
    }

    /// Everything the card draws, in reading order.
    pub fn rows(&self) -> Vec<Row> {
        let mut rows = vec![
            Row::Text(self.model.kind.name().to_owned()),
            Row::Text(self.model.question.clone()),
        ];
        if let Some(receipt) = &self.receipt {
            rows.push(Row::Text(format!("Answered: {}", receipt.says)));
            rows.push(Row::Undo);
            for (_, question) in &receipt.also {
                rows.push(Row::Text(format!("Also answered: {question}")));
            }
            return rows;
        }
        for (index, option) in self.model.options.iter().enumerate() {
            let mut label = option.label.clone();
            if option.recommended {
                label.push_str(" (recommended)");
            }
            if let Some(cost) = &option.cost {
                label.push_str(&format!(" · {cost}"));
            }
            rows.push(Row::Option {
                index,
                label,
                focused: self.focused == Some(index),
            });
        }
        if !self.faults.no_default {
            rows.push(Row::Text(format!(
                "Default: {} · applies {}",
                self.model.default, self.model.applies
            )));
        }
        for (name, value) in &self.model.fields {
            if self.faults.diff_after_answer && (name == "moved" || name.starts_with("checks on")) {
                continue;
            }
            rows.push(Row::Text(format!("{name}: {value}")));
        }
        for (index, step) in self.model.steps.iter().enumerate() {
            let label = format!(
                "{} · {} · {}",
                step.does,
                if step.undoable {
                    "can be undone"
                } else {
                    "can't be undone"
                },
                if step.on { "on" } else { "off" }
            );
            rows.push(Row::Step {
                index,
                label,
                on: step.on,
            });
        }
        if let Some(label) = self.model.approve_label() {
            rows.push(Row::Text(label));
        }
        for call in &self.model.past {
            rows.push(Row::Text(format!(
                "Past call: {} · {}",
                call.question, call.answer
            )));
        }
        if let Some(scope) = self.model.scope.as_ref().filter(|_| !self.faults.no_scope) {
            rows.push(Row::Text(scope.words.clone()));
            if scope.also > 0 {
                rows.push(Row::Text(format!("Answers {} more", scope.also)));
            }
        }
        if !self.words.is_empty() {
            rows.push(Row::Text(format!("Your words: {}", self.words)));
        }
        if let Some(image) = &self.image {
            rows.push(Row::Text(format!("Your image: {}", &image[..12])));
        }
        if !self.words.is_empty() || self.image.is_some() {
            rows.push(Row::Text(
                if self.allow_option().is_some() {
                    WONT_RUN
                } else {
                    ANSWERS_THIS_ASK_ONLY
                }
                .to_owned(),
            ));
        }
        rows.push(Row::Send);
        if self.switch_first && !self.model.own_on() {
            rows.push(Row::Text(SWITCH_FIRST.to_owned()));
        }
        if let Some(holding) = self.holding {
            rows.push(Row::Text(holding.to_owned()));
        }
        rows
    }

    /// The card's text snapshot: every row's words, in reading order.
    pub fn lines(&self) -> Vec<String> {
        self.rows()
            .iter()
            .map(|row| row.label().to_owned())
            .collect()
    }

    /// The option labels in draw order.
    pub fn option_labels(&self) -> Vec<String> {
        self.model
            .options
            .iter()
            .map(|option| option.label.clone())
            .collect()
    }

    /// How many steps the approval runs, and how many of the batch can't be undone, on a batched approval.
    pub fn approve(&self) -> Option<(usize, usize)> {
        if self.model.kind != Kind::BatchedAuthority || self.model.steps.is_empty() {
            return None;
        }
        Some((
            self.model.steps.iter().filter(|step| step.on).count(),
            self.model
                .steps
                .iter()
                .filter(|step| !step.undoable)
                .count(),
        ))
    }

    /// A press, down or up, at its own timestamp; `now` is when it was delivered, which the usage rows carry.
    pub fn press(&mut self, input: Input, events: &[Value], now: u64) -> Did {
        let Input {
            t,
            source,
            target,
            phase,
        } = input;
        // While the OS asks about one press, no other input the card can't trust counts: the prompt is modal, and
        // one confirmation answers one press.
        if !source.trusted() && (self.machine.confirming().is_some() || self.send_waiting.is_some())
        {
            return Did::Nothing;
        }
        let shown = matches!(
            self.machine.state(),
            State::Presented { .. } | State::Armed { .. }
        );
        match target {
            // An approval whose own steps are off runs nothing the core would take: the card holds it back.
            Target::Option(index) if self.is_allow(index) && !self.model.own_on() => {
                self.switch_first = true;
                Did::Nothing
            }
            Target::Option(index) => {
                let press = Press {
                    t,
                    source,
                    option: Some(index),
                    repeat: phase == Phase::Repeat,
                };
                let outcome = match phase {
                    Phase::Up => self.machine.press_up(press),
                    Phase::Down | Phase::Repeat => self.machine.press_down(press),
                };
                self.took(outcome, t, events, now)
            }
            Target::Send => match phase {
                Phase::Repeat => Did::Nothing,
                Phase::Down => {
                    if !shown {
                        return Did::Nothing;
                    }
                    self.machine.tick(t);
                    if self.machine.accepts(t) {
                        self.send_down = Some(source);
                        Did::Nothing
                    } else {
                        self.refuse(now)
                    }
                }
                Phase::Up => {
                    self.machine.tick(t);
                    let Some(down) = self.send_down.take() else {
                        return Did::Nothing;
                    };
                    if !self.machine.accepts(t) || (self.words.is_empty() && self.image.is_none()) {
                        return Did::Nothing;
                    }
                    if down.trusted() && source.trusted() {
                        self.answer_words(t, events, now);
                        Did::Answered
                    } else {
                        self.send_waiting = Some(SendWaiting {
                            seq: self.machine.seq(),
                        });
                        Did::NeedsConfirmation(confirm::reason(&self.model.question, "Send"))
                    }
                }
            },
            // The receipt's Undo and a step's switch change what the card does next, so only hardware works them.
            Target::Undo => {
                if phase != Phase::Up || !source.trusted() || self.receipt.is_none() {
                    return Did::Nothing;
                }
                self.receipt = None;
                self.send_waiting = None;
                self.machine.undo(t);
                self.record("undone", now);
                Did::Undone
            }
            Target::Step(index) => {
                if phase != Phase::Up || !source.trusted() || !shown {
                    return Did::Nothing;
                }
                self.toggle_step(index);
                Did::Switched
            }
        }
    }

    /// A key from the keyboard, Full Keyboard Access included: Tab moves the focus to the next option, Space
    /// presses the focused one.
    pub fn key(&mut self, key: &str, t: u64, source: Source, events: &[Value], now: u64) -> Did {
        match key {
            "tab" => {
                let count = self.model.options.len();
                if count > 0 {
                    self.focused = Some(self.focused.map_or(0, |index| (index + 1) % count));
                }
                Did::Nothing
            }
            "space" => {
                let Some(index) = self.focused else {
                    return Did::Nothing;
                };
                let target = Target::Option(index);
                match self.press(
                    Input {
                        t,
                        source,
                        target,
                        phase: Phase::Down,
                    },
                    events,
                    now,
                ) {
                    Did::Nothing => self.press(
                        Input {
                            t,
                            source,
                            target,
                            phase: Phase::Up,
                        },
                        events,
                        now,
                    ),
                    other => other,
                }
            }
            _ => Did::Nothing,
        }
    }

    pub fn type_words(&mut self, words: &str) {
        self.words = words.to_owned();
    }

    /// Attaches an image: it is kept by its SHA-256, which the answer carries.
    pub fn attach_image(&mut self, bytes: &[u8]) -> String {
        let digest = format!("{:x}", Sha256::digest(bytes));
        self.image = Some(digest.clone());
        digest
    }

    /// Turns a step's switch; a step that can't be undone runs only once its own switch is on.
    pub fn toggle_step(&mut self, index: usize) {
        if let Some(step) = self.model.steps.get(index) {
            let on = !step.on;
            self.model.switch(index, on);
        }
    }

    /// The OS answered its prompt for the waiting press: confirmed, that press answers, once; cancelled, the ask
    /// stays open and the card armed.
    pub fn confirmed(&mut self, confirmed: bool, events: &[Value], now: u64) -> Did {
        if confirmed {
            PASSED_ONCE.store(true, Ordering::SeqCst);
        }
        // The ask's own steps were switched off while the OS asked: the approval waits for its switch again.
        if let Some((_, option)) = self.machine.confirming() {
            if self.is_allow(option) && !self.model.own_on() {
                self.machine.confirmed(false);
                self.send_waiting = None;
                self.switch_first = true;
                return Did::Nothing;
            }
        }
        if self.machine.confirming().is_some() {
            // An option's prompt came after the Send's: the Send's answers nothing now.
            self.send_waiting = None;
            let outcome = self.machine.confirmed(confirmed);
            return self.took(outcome, now, events, now);
        }
        if let Some(waiting) = self.send_waiting.take() {
            if confirmed && waiting.seq == self.machine.seq() && self.machine.accepts(now) {
                self.answer_words(now, events, now);
                return Did::Answered;
            }
        }
        Did::Nothing
    }

    /// The app is leaving with the card up: nothing is written. The planted shell answers with the default.
    pub fn exit(&mut self, events: &[Value], now: u64) {
        if self.faults.answers_on_exit {
            self.answer_default(events, now);
        }
    }

    /// A notification's action: it opens the card and answers nothing. The planted one answers with the default.
    pub fn notification_action(&mut self, events: &[Value], now: u64) {
        if self.faults.notification_action_answers {
            self.answer_default(events, now);
        }
    }

    fn took(&mut self, outcome: Outcome, t: u64, events: &[Value], now: u64) -> Did {
        match outcome {
            Outcome::Ignored => Did::Nothing,
            Outcome::Refused { .. } => self.refuse(now),
            Outcome::Answered { option, .. } => {
                self.send_waiting = None;
                self.answer_option(option, t, events, now);
                Did::Answered
            }
            Outcome::NeedsConfirmation { option, .. } => {
                self.send_waiting = None;
                if self.faults.reuses_confirmation && PASSED_ONCE.load(Ordering::SeqCst) {
                    let outcome = self.machine.confirmed(true);
                    return self.took(outcome, t, events, now);
                }
                let label = self
                    .model
                    .options
                    .get(option)
                    .map(|option| option.label.as_str())
                    .unwrap_or_default();
                Did::NeedsConfirmation(confirm::reason(&self.model.question, label))
            }
        }
    }

    fn refuse(&mut self, now: u64) -> Did {
        self.holding = Some(HOLD_STILL);
        self.record("refused", now);
        Did::Refused
    }

    /// Whether the option at `index`, in draw order, allows.
    fn is_allow(&self, index: usize) -> bool {
        self.model
            .options
            .get(index)
            .is_some_and(|option| option.decision == "allow")
    }

    /// The index, in draw order, of the option whose decision is `allow`.
    fn allow_option(&self) -> Option<usize> {
        self.model
            .options
            .iter()
            .position(|option| option.decision == "allow")
    }

    /// The answer by option `index` in draw order: the option's ID, your words and image beside it, the plan's
    /// hash and the click's token for an approval, and the switched-on steps for a batch.
    fn answer_option(&mut self, index: usize, t: u64, events: &[Value], now: u64) {
        let id = if self.faults.click_by_record_index {
            self.model.record_order.get(index).cloned()
        } else {
            self.model
                .options
                .get(index)
                .map(|option| option.id.clone())
        };
        let Some(id) = id else { return };
        let option = self.model.options.iter().find(|option| option.id == id);
        let allow = option.is_some_and(|option| option.decision == "allow");
        let label = option
            .map(|option| option.label.clone())
            .unwrap_or_else(|| id.clone());
        let answer = Answer {
            option: Some(id),
            words: (!self.words.is_empty()).then(|| self.words.clone()),
            image: self.image.clone(),
            plan_hash: allow.then(|| self.model.plan_hash.clone()).flatten(),
            token: allow.then(|| token(&self.model.ask, self.machine.seq(), t)),
            steps: (allow && self.model.batch.len() > 1).then(|| self.model.runs()),
        };
        self.answers
            .push(Value::Object(answer.params(&self.model.ask)));
        self.record("answered", now);
        self.receipt = Some(Receipt {
            says: label,
            also: self.model.also_answers(events),
        });
    }

    /// The answer through Send with no option: your words and image alone, this ask's only, never a decision
    /// and never the plan.
    fn answer_words(&mut self, t: u64, events: &[Value], now: u64) {
        if self.faults.typed_yes_allows && self.words.trim().eq_ignore_ascii_case("yes") {
            if let Some(index) = self.allow_option() {
                self.machine.answered();
                self.answer_option(index, t, events, now);
                return;
            }
        }
        self.machine.answered();
        let answer = Answer {
            option: None,
            words: (!self.words.is_empty()).then(|| self.words.clone()),
            image: self.image.clone(),
            plan_hash: None,
            token: None,
            steps: None,
        };
        self.answers
            .push(Value::Object(answer.params(&self.model.ask)));
        if self.faults.answers_second_from_words {
            for (other, _) in self.model.also_answers(events) {
                self.answers.push(Value::Object(answer.params(&other)));
            }
        }
        self.record("answered", now);
        let says = match (&answer.words, &answer.image) {
            (Some(words), _) => format!("your words, “{words}”"),
            (None, Some(_)) => "your image".to_owned(),
            (None, None) => "nothing".to_owned(),
        };
        self.receipt = Some(Receipt {
            says,
            also: Vec::new(),
        });
    }

    fn answer_default(&mut self, events: &[Value], now: u64) {
        let default = self.model.default.clone();
        if let Some(index) = self
            .model
            .options
            .iter()
            .position(|option| option.label == default)
        {
            self.machine.answered();
            self.answer_option(index, now, events, now);
        }
    }

    fn record(&mut self, row: &str, now: u64) {
        if self.faults.records_only_answers && row != "answered" {
            return;
        }
        self.usage.push(json!({
            "row": row,
            "seq": self.machine.seq(),
            "ask": self.model.ask,
            "kind": self.model.data_kind,
            "at": now,
        }));
    }
}

/// The click token an approval binds: the ask, the presentation and the armed press's own timestamp, digested.
fn token(ask: &str, seq: u64, t: u64) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{ask}:{seq}:{t}").as_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arming::ARM_AFTER;

    const SLOT: Slot = Slot {
        rect: [100, 100, 480, 480],
        visible: [0, 0, 1512, 982],
    };
    const NOW: u64 = 1_800_000_000_000;

    fn ask(id: &str, kind: &str, options: Value, extra: Value) -> Value {
        let mut data = json!({
            "kind": kind, "question": format!("Question {id}?"), "options": options, "recommended": null,
            "deadline": NOW + 3 * 86_400_000, "default": options[0]["id"], "key": "k",
            "pinned_to": {"kind": "commit", "ref": "abc"},
        });
        if let Some(extra) = extra.as_object() {
            for (name, value) in extra {
                data[name] = value.clone();
            }
        }
        json!({"kind": "ask.created", "id": id, "session": "S", "log_pos": 1, "data": data})
    }

    fn taste(id: &str) -> Value {
        ask(
            id,
            "taste",
            json!([{"id": "blue", "label": "Blue", "decision": "none"}, {"id": "green", "label": "Green", "decision": "none"}]),
            json!({}),
        )
    }

    fn hardware(t: u64, target: Target, phase: Phase) -> Input {
        Input {
            t,
            source: Source::Hardware,
            target,
            phase,
        }
    }

    fn click(controller: &mut Controller, events: &[Value], t: u64, target: Target) -> Did {
        match controller.press(hardware(t, target, Phase::Down), events, t) {
            Did::Nothing => controller.press(hardware(t + 30, target, Phase::Up), events, t + 30),
            other => other,
        }
    }

    #[test]
    fn a_click_before_the_interval_is_refused_and_recorded_once_and_one_after_answers_the_drawn_option(
    ) {
        let events = vec![taste("A")];
        let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER - 1, Target::Option(1)),
            Did::Refused
        );
        assert!(card.lines().contains(&HOLD_STILL.to_owned()));
        assert!(card.take_answers().is_empty());
        card.tick(NOW + ARM_AFTER);
        assert!(
            !card.lines().contains(&HOLD_STILL.to_owned()),
            "armed, it no longer says to hold still"
        );
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER, Target::Option(1)),
            Did::Answered
        );
        let answers = card.take_answers();
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0]["option"], "green");
        assert_eq!(answers[0]["ask"], "ask:A");
        assert!(
            answers[0].get("token").is_none(),
            "a taste answer carries no click token"
        );
        let rows: Vec<String> = card
            .take_usage()
            .iter()
            .map(|row| row["row"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(rows, ["presented", "refused", "answered"]);
        assert_eq!(card.state_name(), "answered");
        assert!(card.lines().contains(&"Undo".to_owned()));
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER + 100, Target::Undo),
            Did::Undone
        );
        assert_eq!(card.state_name(), "presented");
        assert_eq!(card.take_usage()[0]["row"], "undone");
    }

    #[test]
    fn an_approval_whose_own_step_cant_be_undone_waits_for_its_switch() {
        let delete = ask(
            "D",
            "authority",
            json!([{"id": "approve", "label": "Allow", "decision": "allow"}, {"id": "decline", "label": "Decline", "decision": "deny"}]),
            json!({"default": "decline", "subject": {"effect": "push", "target": {"ref": "origin/x"}}}),
        );
        let events = vec![
            delete,
            json!({"kind": "plan.proposed", "id": "p", "writer": "core", "session": "S", "log_pos": 2, "data": {"ask": "ask:D", "steps": [{"does": "delete the branch", "undo": "none", "public": true}], "diff": "d", "hash": "h"}}),
        ];
        let mut card = Controller::present(&events, "ask:D", NOW, SLOT, Faults::default()).unwrap();
        assert_eq!(card.approve(), Some((0, 1)));
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER, Target::Option(0)),
            Did::Nothing
        );
        assert!(
            card.take_answers().is_empty(),
            "the core would run the delete: nothing is sent"
        );
        assert!(card.lines().contains(&SWITCH_FIRST.to_owned()));
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER + 100, Target::Step(0)),
            Did::Switched
        );
        assert!(!card.lines().contains(&SWITCH_FIRST.to_owned()));
        assert_eq!(card.approve(), Some((1, 1)));
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER + 200, Target::Option(0)),
            Did::Answered
        );
        assert_eq!(card.take_answers()[0]["option"], "approve");
    }

    #[test]
    fn switching_the_asks_own_steps_off_while_the_os_asks_sends_nothing() {
        let push = ask(
            "P",
            "authority",
            json!([{"id": "approve", "label": "Allow", "decision": "allow"}, {"id": "decline", "label": "Decline", "decision": "deny"}]),
            json!({"default": "decline", "subject": {"effect": "push", "target": {"ref": "origin/x"}}}),
        );
        let events = vec![
            push,
            json!({"kind": "plan.proposed", "id": "p", "writer": "core", "session": "S", "log_pos": 2, "data": {"ask": "ask:P", "steps": [{"does": "push the branch", "undo": "force back", "public": true}], "diff": "d", "hash": "h"}}),
        ];
        let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
        let t = NOW + ARM_AFTER;
        let source = Source::Synthetic { pid: Some(4242) };
        for (dt, phase) in [(0, Phase::Down), (30, Phase::Up)] {
            let input = Input {
                t: t + dt,
                source,
                target: Target::Option(0),
                phase,
            };
            card.press(input, &events, t + dt);
        }
        assert!(
            card.machine.confirming().is_some(),
            "the OS asks about the approval"
        );
        assert_eq!(
            click(&mut card, &events, t + 100, Target::Step(0)),
            Did::Switched
        );
        assert_eq!(card.confirmed(true, &events, t + 200), Did::Nothing);
        assert!(
            card.take_answers().is_empty(),
            "the step was switched off: nothing is sent"
        );
        assert!(card.lines().contains(&SWITCH_FIRST.to_owned()));
    }

    #[test]
    fn words_alone_answer_this_ask_only_and_a_typed_yes_never_runs_the_plan() {
        let push = ask(
            "P",
            "authority",
            json!([{"id": "approve", "label": "Allow", "decision": "allow"}, {"id": "decline", "label": "Decline", "decision": "deny"}]),
            json!({"default": "decline", "subject": {"effect": "push", "target": {"ref": "origin/x"}}}),
        );
        let events = vec![
            push,
            taste("B"),
            json!({"kind": "plan.proposed", "id": "p", "writer": "core", "session": "S", "log_pos": 2, "data": {"ask": "ask:P", "steps": [{"does": "git push", "undo": "force back", "public": true}], "diff": "d", "hash": "h"}}),
        ];
        let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
        card.type_words("yes");
        assert!(card.lines().contains(&WONT_RUN.to_owned()));
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER, Target::Send),
            Did::Answered
        );
        let answers = card.take_answers();
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0]["words"], "yes");
        assert!(answers[0].get("option").is_none() && answers[0].get("plan_hash").is_none());

        let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER, Target::Option(0)),
            Did::Answered
        );
        let answers = card.take_answers();
        assert_eq!(answers[0]["option"], "approve");
        assert_eq!(answers[0]["plan_hash"], "h");
        assert!(answers[0]["token"]
            .as_str()
            .is_some_and(|token| token.len() == 64));

        let mut card = Controller::present(&events, "ask:B", NOW, SLOT, Faults::default()).unwrap();
        card.type_words("darker");
        assert!(card.lines().contains(&ANSWERS_THIS_ASK_ONLY.to_owned()));
        assert_eq!(
            click(&mut card, &events, NOW + ARM_AFTER, Target::Send),
            Did::Answered
        );
        assert_eq!(
            card.take_answers().len(),
            1,
            "the words answer this ask alone, never the other open ask with the key"
        );
    }

    #[test]
    fn an_untrusted_press_waits_for_the_os_and_a_cancelled_prompt_leaves_the_card_armed() {
        let events = vec![taste("A")];
        let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
        let t = NOW + ARM_AFTER;
        let source = Source::Synthetic { pid: Some(4242) };
        card.press(
            Input {
                t,
                source,
                target: Target::Option(1),
                phase: Phase::Down,
            },
            &events,
            t,
        );
        let did = card.press(
            Input {
                t: t + 30,
                source,
                target: Target::Option(1),
                phase: Phase::Up,
            },
            &events,
            t + 30,
        );
        let Did::NeedsConfirmation(reason) = did else {
            panic!("{did:?}")
        };
        assert!(
            reason.contains("Question A?") && reason.contains("Green"),
            "{reason}"
        );
        assert_eq!(card.confirmed(false, &events, t + 40), Did::Nothing);
        assert_eq!(card.state_name(), "armed");
        assert!(card.take_answers().is_empty());
        card.press(
            Input {
                t: t + 50,
                source,
                target: Target::Option(1),
                phase: Phase::Down,
            },
            &events,
            t + 50,
        );
        card.press(
            Input {
                t: t + 80,
                source,
                target: Target::Option(1),
                phase: Phase::Up,
            },
            &events,
            t + 80,
        );
        assert_eq!(card.confirmed(true, &events, t + 90), Did::Answered);
        assert_eq!(card.take_answers()[0]["option"], "green");
    }

    #[test]
    fn tab_reaches_each_option_and_space_presses_the_focused_one() {
        let events = vec![taste("A")];
        let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
        card.key("tab", NOW, Source::Hardware, &events, NOW);
        assert_eq!(card.focused(), Some(0));
        card.key("tab", NOW, Source::Hardware, &events, NOW);
        assert_eq!(card.focused(), Some(1));
        assert_eq!(
            card.key("space", NOW + 10, Source::Hardware, &events, NOW + 10),
            Did::Refused
        );
        assert_eq!(
            card.key(
                "space",
                NOW + ARM_AFTER,
                Source::Hardware,
                &events,
                NOW + ARM_AFTER
            ),
            Did::Answered
        );
        assert_eq!(card.take_answers()[0]["option"], "green");
    }
}
