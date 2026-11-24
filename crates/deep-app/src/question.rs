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

#[cfg(test)]
use crate::arming::HOLD_STILL;
use crate::{
    answer::Answer,
    arming::{Machine, Outcome, Press, Slot, Source, State},
    confirm, copy,
    kinds::{self, Hold, Model},
    states,
};

mod faults;
pub use faults::Faults;
mod look;

/// The card's least size, in window points, tall enough for a batch of four with its switches (it draws about 525
/// tall): a slot smaller than this, or than the card as drawn, never arms.
pub const CARD_SIZE: [i64; 2] = [480, 560];
/// What a card says before it arms when words or an image are set and no option is chosen: the answer is this
/// ask's alone, never a decision for the key. Each line's key in the app's table (#2403).
pub const ANSWERS_THIS_ASK_ONLY: &str = "question.answers_this_ask_only";
/// The same on an authority card: words never run the plan.
pub const WONT_RUN: &str = "question.wont_run";
/// The options a card shows before it folds the rest behind a count: about nine a level (#394, #1808).
pub const SHOWN_OPTIONS: usize = 9;
/// What a card says on a press while options folded behind its count were never shown (#1808).
pub const OPEN_THE_FOLD: &str = "question.open_the_fold";
/// What a long card says on a press while its end was never shown (#1808).
pub const READ_TO_THE_END: &str = "question.read_to_the_end";
/// What a taste call's accepting option says while pictures it judges weren't shown yet (#3234).
pub const PICTURES_LEFT: &str = "question.pictures_left";
/// What a press on it is told then.
pub const LOOK_FIRST: &str = "question.look_first";

/// Presentations are numbered across the process, so a card presented again after a relaunch gets a new `seq`.
static NEXT_SEQ: AtomicU64 = AtomicU64::new(0);
/// Whether an OS confirmation ever passed in this process: only the planted reuse reads it.
static PASSED_ONCE: AtomicBool = AtomicBool::new(false);

/// What a press lands on, by the card's draw order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Option(usize),
    Send,
    Undo,
    Step(usize),
    /// A sign-in task's one button (#1349).
    SignIn,
    /// A sign-in task's plan line, which opens the maker's price page (#1349).
    Page,
    /// The count the options past the ninth fold behind, which shows them (#1808).
    Fold,
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
pub const SWITCH_FIRST: &str = "question.switch_first";

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
    /// Sign in was pressed on an agent's sign-in task (#1349), named by its handle: the shell starts that agent's sign-in,
    /// which answers nothing.
    SignIn(String),
    /// The plan line was pressed (#1349): the shell opens the maker's price page, from the app's own facts.
    Page(String),
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
    /// A row of the batched taste card (#1345): its ask, its lines, and the lines as one label; armed once the card
    /// is and each picture its own evidence lists was shown (#3234).
    Call {
        ask: String,
        label: String,
        lines: Vec<String>,
        armed: bool,
    },
    /// A sign-in task's one button (#1349).
    SignIn,
    /// A sign-in task's plan line (#1349), which opens the maker's price page.
    Page(String),
    /// The options past the ninth, folded behind their count until it's pressed (#1808).
    Fold {
        hidden: usize,
        label: String,
    },
}

impl Row {
    /// The row's words, what an assistive client reads.
    pub fn label(&self) -> &str {
        match self {
            Row::Text(text) | Row::Page(text) => text,
            Row::Option { label, .. }
            | Row::Step { label, .. }
            | Row::Call { label, .. }
            | Row::Fold { label, .. } => label,
            Row::Send => copy::text("question.send"),
            Row::Undo => copy::text("question.undo"),
            Row::SignIn => copy::text("question.sign_in"),
        }
    }

    /// The row with its words through [`visible`].
    fn marked(self) -> Row {
        match self {
            Row::Text(text) => Row::Text(visible(&text)),
            Row::Page(text) => Row::Page(visible(&text)),
            Row::Option {
                index,
                label,
                focused,
            } => Row::Option {
                index,
                label: visible(&label),
                focused,
            },
            Row::Step { index, label, on } => Row::Step {
                index,
                label: visible(&label),
                on,
            },
            Row::Call {
                ask,
                label,
                lines,
                armed,
            } => Row::Call {
                ask,
                label: visible(&label),
                lines: lines.iter().map(|line| visible(line)).collect(),
                armed,
            },
            row => row,
        }
    }
}

/// Issue #1510: text from the record as the card draws it. A question quotes the call, so the call chooses its
/// characters, and one such as U+202E reverses what follows it: what you read must be what is held. Each control
/// character, line separator, direction mark, embedding, override or isolate, and each character that shows as
/// nothing, is drawn as its escape (`\x1b`, `\u{202e}`) in the card's own font; the record keeps the characters. The
/// joiners U+200C and U+200D and the variation selectors stay: they shape emoji and scripts. `deep inbox` marks the
/// same set (packages/hub/src/visible.ts).
pub(crate) fn visible(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}' => {
                out.push_str(&format!("\\x{:02x}", c as u32))
            }
            '\u{61c}'
            | '\u{200b}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{2028}'..='\u{202e}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206f}'
            | '\u{feff}'
            | '\u{fff9}'..='\u{fffb}'
            | '\u{e0000}'..='\u{e007f}' => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// The answered card's one-line receipt, kept in the slot with Undo.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Receipt {
    says: String,
    /// The other open asks the answer also answered, as the record stood then: handle and question.
    also: Vec<(String, String)>,
    /// A yes to steps that can't be undone, which the hub holds before they start (#1101).
    held: Option<Held>,
}

/// The hub's hold on a yes, as the receipt counts it down (#1101): the asks whose steps wait, when they start, and
/// whether they did. Once they ran the receipt has no Undo.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Held {
    asks: Vec<String>,
    until: u64,
    ran: bool,
}

/// An answer through Send from an input that isn't hardware, waiting for the OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SendWaiting {
    seq: u64,
}

/// A step's switch or the receipt's Undo pressed by an input that isn't hardware, waiting for the OS (#1462).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SwitchWaiting {
    Step(usize),
    Undo,
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
    switch_waiting: Option<SwitchWaiting>,
    /// What the card says after a refused press, until it arms.
    holding: Option<&'static str>,
    /// Whether the card, as laid out, showed its end: unmeasured, not yet, or once (#1808).
    end: Option<bool>,
    /// The options folded behind their count were shown (#1808).
    fold_open: bool,
    /// An approval was held back because the ask's own steps are off.
    switch_first: bool,
    receipt: Option<Receipt>,
    answers: Vec<Value>,
    /// The `ask.undo` params written since last taken: Undo inside the hub's hold (#1101).
    undos: Vec<Value>,
    usage: Vec<Value>,
    /// The clock as the shell last gave it: what a hold's countdown reads (#1101).
    now: u64,
    /// What the window drew of the pictures the card's taste calls judge (#3234).
    pictures: crate::pictures::Pictures,
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
        // An answered yes whose steps the hub still holds shows its receipt, counting down with Undo (#1101).
        let held = match kinds::hold(events, ask) {
            Some(Hold::Waiting(until)) if !states::is_open(events, ask) => Some(until),
            _ => None,
        };
        if !states::is_open(events, ask) && held.is_none() {
            return None;
        }
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
            switch_waiting: None,
            holding: None,
            end: None,
            fold_open: false,
            switch_first: false,
            receipt: None,
            answers: Vec::new(),
            undos: Vec::new(),
            usage: Vec::new(),
            now,
            pictures: Default::default(),
        };
        controller.pictures = crate::pictures::Pictures::new(&controller.listed());
        controller.machine.hold(controller.held(), now);
        controller.record("presented", now);
        if let Some(until) = held {
            controller.machine.answered();
            controller.receipt = Some(Receipt {
                says: String::new(),
                also: Vec::new(),
                held: Some(Held {
                    asks: vec![ask.to_owned()],
                    until,
                    ran: false,
                }),
            });
        }
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

    /// Time passed to `now`: the card arms once its interval ran, and stops saying to hold still. Whether that
    /// changed what the card shows (#1482): a tick that arms nothing draws nothing.
    pub fn tick(&mut self, now: u64) -> bool {
        let (state, holding, counted, left) = (
            self.machine.state(),
            self.holding,
            self.counted(),
            self.lefts(),
        );
        self.now = now;
        self.machine.tick(now);
        self.pictures.tick(now);
        if matches!(self.machine.state(), State::Armed { .. }) {
            self.holding = None;
        }
        (
            self.machine.state(),
            self.holding,
            self.counted(),
            self.lefts(),
        ) != (state, holding, counted, left)
    }

    /// The asks whose pictures the card judges (#3234): its own, then each batched row's.
    pub fn judged_asks(&self) -> Vec<String> {
        std::iter::once(self.model.ask.clone())
            .chain(self.model.calls.iter().map(|call| call.ask.clone()))
            .collect()
    }

    /// Every picture the card's taste calls judge (#3234): its own ask's, then each batched row's, each once.
    pub fn listed(&self) -> Vec<crate::pictures::Listed> {
        let mut listed = self.model.pictures.clone();
        for call in &self.model.calls {
            for picture in &call.pictures {
                if !listed.contains(picture) {
                    listed.push(picture.clone());
                }
            }
        }
        listed
    }

    /// How many of the ask's own pictures, and of each batched row's, aren't shown yet.
    fn lefts(&self) -> Vec<usize> {
        std::iter::once(&self.model.pictures)
            .chain(self.model.calls.iter().map(|call| &call.pictures))
            .map(|listed| self.pictures.left(listed))
            .collect()
    }

    /// What a frame drew of the pictures, by hash (#3234). Whether what the card says changed.
    pub fn drawn(
        &mut self,
        drawn: &std::collections::HashMap<String, crate::pictures::Drawn>,
        now: u64,
    ) -> bool {
        let left = self.lefts();
        // #3234's planted card counts a draw at any size.
        let half = if crate::plain::planted("counts-small-draw") {
            0.
        } else {
            crate::pictures::HALF
        };
        self.now = now;
        // A frame drawn while nobody can see the window shows you nothing.
        let none = Default::default();
        let drawn = if self.machine.seen() { drawn } else { &none };
        self.pictures.frame(drawn, half, now);
        self.lefts() != left
    }

    /// The ask's own pictures not shown yet, of all it judges; `None` on a card that judges none (#3234).
    pub fn left(&self) -> Option<(usize, usize)> {
        let all = self.model.pictures.len();
        (all > 0).then(|| (self.pictures.left(&self.model.pictures), all))
    }

    /// Why a press on option `index` can't answer though the card is armed (#3234): the taste call's accepting option,
    /// its recommended one, while pictures it judges weren't shown, with how many are left of how many. Send back needs
    /// none of that. #3234's planted cards arm it at presentation, or hold Send back too.
    pub fn picture_held(&self, index: usize) -> Option<(usize, usize)> {
        let (left, all) = self.left().filter(|(left, _)| *left > 0)?;
        let option = self.model.options.get(index)?;
        if crate::plain::planted("arms-at-presentation") {
            return None;
        }
        (option.recommended || crate::plain::planted("refuses-send-back")).then_some((left, all))
    }

    /// The option's state as the surfaces name it: `armed` when a press on it would answer.
    pub fn option_state(&self, index: usize) -> &'static str {
        match self.state_name() {
            "armed" if self.picture_held(index).is_some() => "presented",
            state => state,
        }
    }

    /// Whether a batched row is armed (#3234): the card is, and each picture its own evidence lists was shown. #3234's
    /// planted card arms every row once one is.
    pub fn row_armed(&self, ask: &str) -> bool {
        let armed = |call: &crate::kinds::CallRow| {
            matches!(self.machine.state(), State::Armed { .. })
                && self.pictures.left(&call.pictures) == 0
        };
        let calls = &self.model.calls;
        if crate::plain::planted("arms-every-row") && calls.iter().any(armed) {
            return matches!(self.machine.state(), State::Armed { .. });
        }
        calls.iter().any(|call| call.ask == ask && armed(call))
    }

    /// The whole seconds before a held yes's steps start, as the receipt says them (#1101); `None` with no hold
    /// counting down.
    fn counted(&self) -> Option<u64> {
        let held = self
            .receipt
            .as_ref()?
            .held
            .as_ref()
            .filter(|held| !held.ran)?;
        Some(held.until.saturating_sub(self.now).div_ceil(1000))
    }

    /// How many options are folded behind their count: those past the ninth, until it's pressed (#1808).
    pub fn folded(&self) -> usize {
        if self.fold_open {
            0
        } else {
            self.model.options.len().saturating_sub(SHOWN_OPTIONS)
        }
    }

    /// Why the card can't arm besides its interval and its slot (#1808): options never shown, or an end never shown.
    /// #1808's planted card arms with its fold never opened.
    fn held(&self) -> Option<&'static str> {
        if self.folded() > 0 && !crate::plain::planted("card-arms-folded") {
            Some(copy::text(OPEN_THE_FOLD))
        } else if self.end == Some(false) {
            Some(copy::text(READ_TO_THE_END))
        } else {
            None
        }
    }

    /// Tells the machine what holds the card now; the line a refused press left says the reason now, or leaves.
    fn rehold(&mut self, now: u64) {
        self.machine.hold(self.held(), now);
        if matches!(self.machine.state(), State::Armed { .. }) {
            self.holding = None;
        } else if self.holding.is_some() {
            self.holding = Some(self.machine.says());
        }
    }

    /// The card on its page, as laid out at `now`, showed its end (`true`), or its rows run past what shows and their
    /// end hasn't (#1808). An end once shown stays shown while the card shows the same thing.
    pub fn end_shown(&mut self, shown: bool, now: u64) {
        if self.end == Some(true) || self.end == Some(shown) {
            return;
        }
        self.end = Some(shown);
        self.rehold(now);
    }

    /// The record changed while the card shows. Its scope and count stay as presented (the planted twin re-reads
    /// them), and so does when its default applies, which reads the clock. Anything else can change (a check
    /// finishing, a batch member closing, the plan landing): the card shows it, each member still in the batch
    /// keeping its switch, and, as any change to what it shows, is presented again unarmed.
    pub fn record_changed(&mut self, events: &[Value], now: u64) {
        self.hold_changed(events, now);
        // Answered on another device, decided for you or defaulted: the core refuses any answer now.
        if !states::is_open(events, &self.model.ask) {
            self.machine.withdrawn();
            self.send_down = None;
            self.send_waiting = None;
            return;
        }
        let Some(mut fresh) = Model::read(events, &self.model.ask, now) else {
            return;
        };
        if self.faults.count_follows_record {
            self.model.scope = fresh.scope.clone();
        }
        fresh.scope = self.model.scope.clone();
        fresh.applies = self.model.applies.clone();
        for call in &mut fresh.calls {
            if let Some(was) = self.model.calls.iter().find(|was| was.ask == call.ask) {
                call.applies = was.applies.clone();
            }
        }
        let was = |member: usize| {
            let handle = &fresh.batch.get(member)?.0;
            let before = self.model.batch.iter().position(|(ask, _)| ask == handle)?;
            self.model
                .steps
                .iter()
                .find(|step| step.member == before)
                .map(|step| step.on)
        };
        let switches: Vec<Option<bool>> = fresh.steps.iter().map(|step| was(step.member)).collect();
        for (step, on) in fresh.steps.iter_mut().zip(switches) {
            step.on = on.unwrap_or(step.on);
        }
        if fresh != self.model
            && matches!(
                self.machine.state(),
                State::Presented { .. } | State::Armed { .. }
            )
        {
            self.model = fresh;
            // A picture replaced by a new hash counts as not shown again (#3234).
            let listed = self.listed();
            self.pictures.relist(&listed);
            self.switch_first = false;
            self.machine.present(now, self.slot);
            // What it shows changed: its end and its fold are to be shown again (#1808).
            self.end = None;
            self.fold_open = false;
            self.machine.hold(self.held(), now);
            self.send_down = None;
            self.send_waiting = None;
            self.holding = None;
            self.record("presented", now);
        }
    }

    /// Whether the receipt counts down a yes the hub holds, whose end the record will say (#1101).
    pub fn counting_down(&self) -> bool {
        self.counted().is_some()
    }

    /// The hub's hold, as the core recorded it (#1101): when the steps start, that they did, or that the yes was
    /// withdrawn (Undo on another device, or the hub starting again during it), when the ask is open here again.
    pub fn hold_changed(&mut self, events: &[Value], now: u64) {
        self.now = now;
        if let Some(held) = self
            .receipt
            .as_mut()
            .and_then(|receipt| receipt.held.as_mut())
        {
            let holds: Vec<Option<Hold>> = held
                .asks
                .iter()
                .map(|ask| kinds::hold(events, ask))
                .collect();
            if holds.contains(&Some(Hold::Withdrawn)) {
                self.receipt = None;
                self.machine.undo(now);
                self.record("undone", now);
            } else {
                if let Some(until) = holds.iter().find_map(|hold| match hold {
                    Some(Hold::Waiting(until)) => Some(*until),
                    _ => None,
                }) {
                    held.until = until;
                }
                held.ran = held.ran || holds.iter().all(|hold| *hold == Some(Hold::Ran));
            }
        }
    }

    /// The card as drawn measured `size` points: what its slot must hold to arm, never less than [`CARD_SIZE`].
    pub fn measured(&mut self, size: [i64; 2], now: u64) {
        let size = [size[0].max(CARD_SIZE[0]), size[1].max(CARD_SIZE[1])];
        self.machine.measured(size, now);
    }

    /// The card on its ask's page measured `size` points (#1808): its rows scroll inside the page, so it needs no more
    /// than the page, and no least size of its own.
    pub fn measured_on_page(&mut self, size: [i64; 2], now: u64) {
        self.machine.measured(size, now);
    }

    /// The `ask.answer` params written since last taken, in order, for the shell to sign and send.
    pub fn take_answers(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.answers)
    }

    /// The `ask.undo` params written since last taken, for the shell to sign and send: Undo inside the hub's hold
    /// reaches the hub's undo, the one `deep inbox undo` calls (#1101).
    pub fn take_undos(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.undos)
    }

    /// The usage rows written since last taken, in order.
    pub fn take_usage(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.usage)
    }

    /// Everything the card draws, in reading order, each row's words through [`visible`].
    pub fn rows(&self) -> Vec<Row> {
        self.unmarked_rows().into_iter().map(Row::marked).collect()
    }

    fn unmarked_rows(&self) -> Vec<Row> {
        let mut rows = vec![
            // Its plain word; the planted card shows the kind's name, as before #1455.
            Row::Text(if crate::plain::planted("card-shows-kind-name") {
                self.model.kind.name().to_owned()
            } else {
                self.model.kind.plain()
            }),
            Row::Text(self.model.question.clone()),
        ];
        // #1348's planted card line, in a test build only.
        if crate::plain::planted("card-line-pr") {
            rows.push(Row::Text(crate::plain::PLANTED_PR_LINE.to_owned()));
        }
        if let Some(receipt) = &self.receipt {
            // A yes the hub holds counts down with Undo; once its steps ran, they can't be taken back (#1101).
            match (&receipt.held, self.counted()) {
                (Some(held), _) if held.ran => {
                    rows.push(Row::Text(copy::text("question.ran_for_good").to_owned()));
                    // #1101's planted receipt still offers Undo once its steps ran.
                    if crate::plain::planted("receipt-keeps-undo") {
                        rows.push(Row::Undo);
                    }
                }
                (Some(_), Some(seconds)) => {
                    rows.push(Row::Text(copy::count("question.starts_in", seconds, &[])));
                    rows.push(Row::Undo);
                }
                _ => {
                    rows.push(Row::Text(copy::fill("question.answered", &[&receipt.says])));
                    rows.push(Row::Undo);
                }
            }
            for (_, question) in &receipt.also {
                rows.push(Row::Text(copy::fill("question.also_answered", &[question])));
            }
            return rows;
        }
        // An agent's sign-in task (#1349): one button, Sign in, then its steps, the plan line among them. Nothing on it
        // answers the task: only the agent's probe closes it.
        if let Some(steps) = &self.model.sign_in {
            rows.push(Row::SignIn);
            // The step naming the price page's host is the plan line, and opens that page: the address is the app's own,
            // from the facts it ships, never one the record carries.
            let host = self
                .model
                .price_page
                .as_deref()
                .and_then(|page| page.strip_prefix("https://"))
                .and_then(|rest| rest.split('/').next());
            rows.extend(steps.iter().cloned().map(|step| match host {
                Some(host) if step.contains(host) => Row::Page(step),
                _ => Row::Text(step),
            }));
            return rows;
        }
        let folded = self.folded();
        for (index, option) in self.model.options.iter().enumerate() {
            if folded > 0 && index >= SHOWN_OPTIONS {
                break;
            }
            let mut label = match (option.recommended, &option.cost) {
                (true, Some(cost)) => {
                    copy::fill("question.recommended_cost", &[&option.label, cost])
                }
                (true, None) => copy::fill("question.recommended", &[&option.label]),
                (false, Some(cost)) => format!("{} · {cost}", option.label),
                (false, None) => option.label.clone(),
            };
            // Until its pictures were shown it says how many are left, as a folded option does (#3234).
            if let Some((left, all)) = self.picture_held(index) {
                label = copy::fill("question.option_left", &[&label, &left, &all]);
            }
            rows.push(Row::Option {
                index,
                label,
                focused: self.focused == Some(index),
            });
        }
        if folded > 0 {
            rows.push(Row::Fold {
                hidden: folded,
                label: copy::count("question.more_options", folded as u64, &[]),
            });
        }
        if !self.faults.no_default {
            rows.push(Row::Text(copy::fill(
                "question.default_at",
                &[&self.model.default, &self.model.applies],
            )));
        }
        for (name, value) in &self.model.fields {
            if self.faults.diff_after_answer && crate::kinds::is_moved(name) {
                continue;
            }
            rows.push(Row::Text(copy::fill("question.field", &[name, value])));
        }
        // A step is a switch: its state is the node's value and its mark, never a word in its label (#1458).
        for (index, step) in self.model.steps.iter().enumerate() {
            let mut label = copy::fill(
                if step.undoable {
                    "question.step_undoable"
                } else {
                    "question.step_not_undoable"
                },
                &[&step.does],
            );
            // #1458's planted switch says its state as a word in its label.
            if crate::plain::planted("step-state-in-label") {
                let state = if step.on { " · on" } else { " · off" }; // copy-exception: planted
                label.push_str(state);
            }
            // One step has no switch (#1101): Allow is its switch. #1101's planted card keeps it.
            if self.model.steps.len() == 1 && !crate::plain::planted("single-step-switch") {
                rows.push(Row::Text(label));
            } else {
                rows.push(Row::Step {
                    index,
                    label,
                    on: step.on,
                });
            }
        }
        if let Some(label) = self.model.approve_label() {
            rows.push(Row::Text(label));
        }
        // The batched taste card's rows (#1345): one per call, with its two answers, what Send back does here before
        // it's pressed, and when its recommended answer applies. Its two planted twins leave the words off the first
        // row that reverts, and the time off the first row.
        let mut unannounced = crate::plain::planted("card-row-reverts-unannounced");
        let mut timeless = crate::plain::planted("card-row-without-time");
        for call in &self.model.calls {
            let mut lines = vec![
                call.question.clone(),
                copy::fill("question.recommended", &[&call.yes]),
            ];
            if unannounced && call.sends == crate::kinds::REVERTS {
                unannounced = false;
                lines.push(call.back.clone());
            } else {
                lines.push(copy::fill(
                    "question.back_sends",
                    &[&call.back, &copy::text(call.sends)],
                ));
            }
            if timeless {
                timeless = false;
            } else {
                lines.push(copy::fill(
                    "question.applies_at",
                    &[&call.yes, &call.applies],
                ));
            }
            let left = self.pictures.left(&call.pictures);
            if left > 0 {
                lines.push(copy::fill(PICTURES_LEFT, &[&left, &call.pictures.len()]));
            }
            rows.push(Row::Call {
                ask: call.ask.clone(),
                label: lines.join(" · "),
                armed: self.row_armed(&call.ask),
                lines,
            });
        }
        for call in &self.model.past {
            rows.push(Row::Text(copy::fill(
                "question.past_call",
                &[&call.question, &call.answer],
            )));
        }
        if let Some(scope) = self.model.scope.as_ref().filter(|_| !self.faults.no_scope) {
            rows.push(Row::Text(scope.words.clone()));
            if scope.also > 0 {
                rows.push(Row::Text(copy::count(
                    "question.answers_more",
                    scope.also as u64,
                    &[],
                )));
            }
        }
        if !self.words.is_empty() {
            rows.push(Row::Text(copy::fill("question.your_words", &[&self.words])));
        }
        if let Some(image) = &self.image {
            rows.push(Row::Text(copy::fill(
                "question.your_image",
                &[&&image[..12]],
            )));
        }
        if !self.words.is_empty() || self.image.is_some() {
            rows.push(Row::Text(
                copy::text(if self.allow_option().is_some() {
                    WONT_RUN
                } else {
                    ANSWERS_THIS_ASK_ONLY
                })
                .to_owned(),
            ));
        }
        rows.push(Row::Send);
        if self.switch_first && !self.model.own_on() {
            rows.push(Row::Text(copy::text(SWITCH_FIRST).to_owned()));
        }
        if let Some(holding) = self.holding {
            rows.push(Row::Text(holding.to_owned()));
        }
        rows
    }

    /// The card's rows on an ask's page (#1461), where the box under it holds your words, the lines that say what
    /// they do and the send control: every row but those.
    pub fn page_rows(&self) -> Vec<Row> {
        let words = (!self.words.is_empty())
            .then(|| visible(&copy::fill("question.your_words", &[&self.words])));
        self.rows()
            .into_iter()
            .filter(|row| match row {
                Row::Send => false,
                Row::Text(text) => {
                    words.as_ref() != Some(text)
                        && text != copy::text(WONT_RUN)
                        && text != copy::text(ANSWERS_THIS_ASK_ONLY)
                }
                _ => true,
            })
            .collect()
    }

    /// The card's rows on its page, split where it scrolls (#1808): the rows read above, which scroll, and its last
    /// block, which stays in view under them: its options and their count, its default, what it's saved as, the steps a
    /// yes runs, the line held back for a switch and what a press was told; on a receipt, its Undo; on a sign-in task,
    /// its button.
    pub fn page_parts(&self) -> (Vec<Row>, Vec<Row>) {
        let scope = self.model.scope.as_ref().filter(|_| !self.faults.no_scope);
        let last: Vec<String> = [
            (!self.faults.no_default).then(|| {
                copy::fill(
                    "question.default_at",
                    &[&self.model.default, &self.model.applies],
                )
            }),
            scope.map(|scope| scope.words.clone()),
            scope
                .filter(|scope| scope.also > 0)
                .map(|scope| copy::count("question.answers_more", scope.also as u64, &[])),
            self.model.approve_label(),
            self.switch_first
                .then(|| copy::text(SWITCH_FIRST).to_owned()),
            self.holding.map(str::to_owned),
        ]
        .into_iter()
        .flatten()
        .map(|text| visible(&text))
        .collect();
        self.page_rows().into_iter().partition(|row| match row {
            Row::Option { .. } | Row::Fold { .. } | Row::Undo | Row::SignIn => false,
            Row::Text(text) => !last.contains(text),
            _ => true,
        })
    }

    /// The box's send control on an ask's page (#1461), saying what the press does: Say no on an approval, whose words
    /// go as the reason, else Answer; and the lines above it once it holds words.
    pub fn words_send(&self) -> (&'static str, Vec<&'static str>) {
        let approval = self.allow_option().is_some();
        let label = copy::text(if approval {
            "question.say_no"
        } else {
            "question.answer"
        });
        let mut lines = Vec::new();
        if !self.words.is_empty() || self.image.is_some() {
            lines.push(copy::text(ANSWERS_THIS_ASK_ONLY));
            if approval {
                lines.push(copy::text(WONT_RUN));
            }
        }
        (label, lines)
    }

    /// The card was laid out in `slot` (#1461): a slot that moved, as when the window changed size, presents it
    /// again, unarmed, where it now is.
    pub fn placed(&mut self, slot: Slot, now: u64) {
        if slot == self.slot {
            return;
        }
        self.slot = slot;
        if matches!(
            self.machine.state(),
            State::Presented { .. } | State::Armed { .. }
        ) {
            self.machine.present(now, slot);
            self.send_down = None;
            self.holding = None;
        }
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
        self.model.approve()
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
        if !source.trusted()
            && (self.machine.confirming().is_some()
                || self.send_waiting.is_some()
                || self.switch_waiting.is_some())
        {
            return Did::Nothing;
        }
        let shown = matches!(
            self.machine.state(),
            State::Presented { .. } | State::Armed { .. }
        );
        match target {
            // Sign in starts the agent's own sign-in (#1349): it answers nothing, so it needs no arming or confirmation.
            Target::SignIn => match (&self.model.sign_in, phase) {
                (Some(_), Phase::Up) if shown => Did::SignIn(self.model.ask.clone()),
                _ => Did::Nothing,
            },
            Target::Page => match (&self.model.price_page, phase) {
                (Some(page), Phase::Up) if shown => Did::Page(page.clone()),
                _ => Did::Nothing,
            },
            // The count shows the options folded behind it (#1808): it answers nothing.
            Target::Fold => {
                if phase == Phase::Up && shown && !self.fold_open {
                    self.fold_open = true;
                    self.rehold(now);
                }
                Did::Nothing
            }
            // A taste call's accepting option waits for its pictures (#3234): a press on it changes nothing.
            Target::Option(index) if shown && self.picture_held(index).is_some() => {
                if phase == Phase::Down {
                    self.refuse(copy::text(LOOK_FIRST), now)
                } else {
                    Did::Nothing
                }
            }
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
                        let says = self.machine.says();
                        self.refuse(says, now)
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
                        Did::NeedsConfirmation(confirm::reason(
                            &self.model.question,
                            copy::text("question.send"),
                        ))
                    }
                }
            },
            // The receipt's Undo and a step's switch change what the card does next: hardware works them, and any
            // other press once the OS confirms you, as an option's does (#1462).
            Target::Undo => {
                if phase != Phase::Up || !self.undoable() {
                    return Did::Nothing;
                }
                if !source.trusted() {
                    self.switch_waiting = Some(SwitchWaiting::Undo);
                    return Did::NeedsConfirmation(confirm::reason(
                        &self.model.question,
                        copy::text("question.undo"),
                    ));
                }
                self.undo_answer(t, now)
            }
            Target::Step(index) => {
                if phase != Phase::Up || !shown {
                    return Did::Nothing;
                }
                if !source.trusted() {
                    // #1462's planted card takes hardware alone, as the merge base did.
                    if cfg!(feature = "plant-step-ignores-press") {
                        return Did::Nothing;
                    }
                    let does = self
                        .model
                        .steps
                        .get(index)
                        .map_or_else(String::new, |step| step.does.clone());
                    self.switch_waiting = Some(SwitchWaiting::Step(index));
                    return Did::NeedsConfirmation(confirm::reason(&self.model.question, &does));
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
        // A switch or Undo waits on the OS alone: confirmed, it works once; cancelled, nothing changes.
        if let Some(waiting) = self.switch_waiting.take() {
            return match (confirmed, waiting) {
                (false, _) => Did::Nothing,
                (true, SwitchWaiting::Step(index)) => {
                    self.toggle_step(index);
                    Did::Switched
                }
                (true, SwitchWaiting::Undo) if self.undoable() => self.undo_answer(now, now),
                (true, SwitchWaiting::Undo) => Did::Nothing,
            };
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
            if confirmed && self.machine.confirms(waiting.seq) {
                self.answer_words(now, events, now);
                return Did::Answered;
            }
        }
        Did::Nothing
    }

    /// Whether the receipt offers Undo: it shows, and no step it held has started (#1101).
    fn undoable(&self) -> bool {
        self.receipt.as_ref().is_some_and(|receipt| {
            !receipt.held.as_ref().is_some_and(|held| held.ran)
                || crate::plain::planted("receipt-keeps-undo")
        })
    }

    /// Takes back the answer the receipt shows. Inside the hub's hold it asks the hub to withdraw the yes (#1101).
    fn undo_answer(&mut self, t: u64, now: u64) -> Did {
        if self
            .receipt
            .as_ref()
            .is_some_and(|receipt| receipt.held.is_some())
        {
            self.undos.push(json!({ "ask": self.model.ask }));
        }
        self.receipt = None;
        self.send_waiting = None;
        self.machine.undo(t);
        self.record("undone", now);
        Did::Undone
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
            Outcome::Refused { says, .. } => self.refuse(says, now),
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

    fn refuse(&mut self, says: &'static str, now: u64) -> Did {
        self.holding = Some(says);
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
            pictures: self.answered_pictures(now),
        };
        self.answers
            .push(Value::Object(answer.params(&self.model.ask)));
        self.record("answered", now);
        // Every other ask it closed: those of its key in its scope, and the batch members the approval ran.
        let mut also = self.model.also_answers(events);
        if allow && self.model.batch.len() > 1 {
            for member in self.model.runs() {
                let handle = &self.model.batch[member].0;
                if *handle != self.model.ask && !also.iter().any(|(ask, _)| ask == handle) {
                    let question = Model::read(events, handle, now).map(|model| model.question);
                    also.push((handle.clone(), question.unwrap_or_default()));
                }
            }
        }
        // The steps a yes runs that can't be undone wait out the hub's hold first (#1101).
        let held = allow
            .then(|| self.held_by_yes())
            .filter(|asks| !asks.is_empty());
        self.receipt = Some(Receipt {
            says: label,
            also,
            held: held.map(|asks| Held {
                asks,
                until: now + crate::kinds::HOLD_MS,
                ran: false,
            }),
        });
    }

    /// The asks a yes on this card runs whose plans hold a public step that can't be undone, which the hub holds
    /// before it starts (#1101), as the asks core decides.
    fn held_by_yes(&self) -> Vec<String> {
        let runs = if self.model.batch.len() > 1 {
            self.model.runs()
        } else {
            vec![self.model.own_member]
        };
        runs.into_iter()
            .filter(|member| {
                self.model
                    .steps
                    .iter()
                    .any(|step| step.member == *member && !step.undoable && step.public)
            })
            .filter_map(|member| self.model.batch.get(member).map(|(ask, _)| ask.clone()))
            .collect()
    }

    /// The answer through Send with no option: your words and image alone, this ask's only, never a decision
    /// and never the plan.
    fn answer_words(&mut self, t: u64, events: &[Value], now: u64) {
        // #1461's planted page reads words that start with yes as the approval.
        let reads_yes = crate::plain::planted("words-read-yes")
            && self.words.trim().to_lowercase().starts_with("yes");
        if reads_yes
            || (self.faults.typed_yes_allows && self.words.trim().eq_ignore_ascii_case("yes"))
        {
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
            pictures: self.answered_pictures(now),
        };
        self.answers
            .push(Value::Object(answer.params(&self.model.ask)));
        if self.faults.answers_second_from_words {
            // The wrong program: every other open ask with this one's key, whatever its scope.
            let open = states::open_asks(events, None);
            let key = open
                .iter()
                .find(|ask| states::handle(ask) == self.model.ask)
                .map(|ask| ask["data"]["key"].clone());
            for other in open.iter().filter(|ask| {
                states::handle(ask) != self.model.ask && Some(&ask["data"]["key"]) == key.as_ref()
            }) {
                self.answers
                    .push(Value::Object(answer.params(&states::handle(other))));
            }
        }
        self.record("answered", now);
        let says = match (&answer.words, &answer.image) {
            (Some(words), _) => copy::fill("question.said_words", &[words]),
            (None, Some(_)) => copy::text("question.said_image").to_owned(),
            (None, None) => copy::text("question.said_nothing").to_owned(),
        };
        self.receipt = Some(Receipt {
            says,
            also: Vec::new(),
            held: None,
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

    /// What the answer records of the pictures the ask judges (#3234): for each, shown or not, the largest scale it was
    /// drawn whole at and how long it was drawn whole. #3234's planted recorder marks every one shown.
    fn answered_pictures(&self, now: u64) -> Option<Vec<Value>> {
        (!self.model.pictures.is_empty()).then(|| {
            self.pictures.record(
                &self.model.pictures,
                now,
                crate::plain::planted("marks-all-shown"),
            )
        })
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
mod tests;
