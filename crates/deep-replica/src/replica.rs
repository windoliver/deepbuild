//! Issue #326: the app headless on gpui's virtual clock, as one or more paired devices of one hub. Each device is
//! its own app with its window on a session's page, its notifier and its menu bar; all of them read the one record
//! through the app's one reader and share one clock. A test appends events, moves the clock, and reads back what
//! each surface showed and what each device posted.
//!
//! Issue #327: the question card on a device. A test presents an ask's card, feeds it presses with their own
//! platform timestamps and sources, keys, words and an image, answers the OS confirmations the card raises (the
//! LocalAuthentication stub at that boundary), and reads back the card as an assistive client would, the
//! `ask.answer` params the app sent and the usage rows it wrote. Killing a replica keeps the record and the clock
//! and drops the app's state; relaunching it opens the app again on them.

use std::{path::Path, time::Duration};

use deep_app::{
    arming,
    card::{self, Card},
    events::{Fixture, Inbox},
    notify::{self, Notifier, Sound, NOTIFY_AFTER},
    question::{Controller, Did, Faults, Target},
    record, states,
    views::{set_state, AppState, Layout},
};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    base::test_support::snapshots, AnyWindowHandle, ElementId, Entity, HeadlessAppContext,
};
use serde_json::Value;

use crate::{
    shell::open_shell,
    snapshot::{from_observed, Snapshot},
    NOW, WINDOW,
};

/// One notification as a device posted it.
#[derive(Clone, Debug)]
pub struct Posted {
    pub device: usize,
    pub ask: Option<String>,
    pub session: String,
    /// When it was posted, ms since the epoch on the virtual clock.
    pub at: u64,
    pub text: String,
    pub sound: Option<Sound>,
}

/// What one surface showed for the record's one session: its words, and the status mark it drew.
#[derive(Clone, Debug)]
pub struct Seen {
    pub surface: String,
    pub text: String,
    pub entry: String,
    pub glyph: String,
}

/// The slot a view reserves for the card: its rect in window points, and how far it is scrolled outside the
/// view's area (0 when wholly inside).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Slot {
    pub rect: [i64; 4],
    pub scrolled_out: i64,
}

/// Where a press came from, as the platform names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    Hid,
    Synthetic { pid: i64 },
    Accessibility { client: Client },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Client {
    VoiceOver,
    Unknown,
}

/// What a press lands on, by the card's draw order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum On {
    Option(usize),
    Send,
    Undo,
    Step(usize),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Phase {
    Down,
    Up,
    Repeat,
}

/// One press as the platform delivered it: `at` is its own timestamp on the virtual clock.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    pub at: u64,
    pub source: Source,
    pub on: On,
    pub phase: Phase,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub does: String,
    pub on: bool,
    pub undoable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Approve {
    pub runs: usize,
    pub cannot_undo: usize,
}

/// The card as read back from a device's window: its state and its text snapshot, what assistive clients read.
#[derive(Clone, Debug)]
pub struct CardSeen {
    pub ask: String,
    /// The ask's kind as the record writes it.
    pub kind: String,
    pub seq: u64,
    pub state: String,
    pub text: String,
    /// The option labels in draw order.
    pub options: Vec<String>,
    pub focused: Option<usize>,
    pub steps: Vec<Step>,
    pub approve: Option<Approve>,
    pub rect: [i64; 4],
}

/// One OS confirmation the card raised, at the LocalAuthentication stub.
#[derive(Clone, Debug)]
pub struct Confirmation {
    pub prompt: String,
    pub answered: Option<bool>,
    device: usize,
}

/// A killed replica: what the dying app sent, and what survives it (the record and the clock).
pub struct Killed {
    pub sent: Vec<Value>,
    events: Vec<Value>,
    log_pos: u64,
    now: u64,
    faults: Faults,
}

/// The wrong programs the criteria name, built into the app for planted.rs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    NoScope,
    CountFollowsRecord,
    ClickByRecordIndex,
    NotificationActionAnswers,
    NoDefault,
    DiffAfterAnswer,
    AnswersOnExit,
    ReusesConfirmation,
    RecordsOnlyAnswers,
    AnswersSecondFromWords,
    TypedYesAllows,
}

impl Planted {
    fn faults(self) -> Faults {
        let mut faults = Faults::default();
        match self {
            Planted::NoScope => faults.no_scope = true,
            Planted::CountFollowsRecord => faults.count_follows_record = true,
            Planted::ClickByRecordIndex => faults.click_by_record_index = true,
            Planted::NotificationActionAnswers => faults.notification_action_answers = true,
            Planted::NoDefault => faults.no_default = true,
            Planted::DiffAfterAnswer => faults.diff_after_answer = true,
            Planted::AnswersOnExit => faults.answers_on_exit = true,
            Planted::ReusesConfirmation => faults.reuses_confirmation = true,
            Planted::RecordsOnlyAnswers => faults.records_only_answers = true,
            Planted::AnswersSecondFromWords => faults.answers_second_from_words = true,
            Planted::TypedYesAllows => faults.typed_yes_allows = true,
        }
        faults
    }
}

struct Device {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    notifier: Notifier,
    /// The session whose page is open in this device's focused window.
    looking_at: Option<String>,
    /// Whether the window is hidden: then nothing is being looked at.
    hidden: bool,
    /// The ask whose question card is open, and its view.
    card: Option<String>,
    shown: Option<Entity<Card>>,
}

pub struct Replica {
    devices: Vec<Device>,
    now: u64,
    log_pos: u64,
    /// The device you used last: the one that plays sounds.
    last_used: usize,
    posted: Vec<Posted>,
    /// When each ask showed and, once it did, closed: `(handle, session, shown, closed)`.
    pub(crate) asks: Vec<(String, String, u64, Option<u64>)>,
    /// Each focus change: `(at, device, session)`.
    pub(crate) focus: Vec<(u64, usize, Option<String>)>,
    faults: Faults,
    confirmations: Vec<Confirmation>,
    /// Every `ask.answer` the app sent, as its params, and every usage row it wrote, in order.
    sent: Vec<Value>,
    usage: Vec<Value>,
}

impl Replica {
    pub fn open(fixture: &Path) -> Replica {
        Replica::build(fixture, 1, Notifier::new(NOTIFY_AFTER), Faults::default())
    }

    pub fn open_devices(fixture: &Path, devices: usize) -> Replica {
        Replica::build(
            fixture,
            devices,
            Notifier::new(NOTIFY_AFTER),
            Faults::default(),
        )
    }

    pub fn with_notifier(fixture: &Path, notifier: Notifier) -> Replica {
        Replica::build(fixture, 1, notifier, Faults::default())
    }

    /// The app built with one of the wrong programs the criteria name.
    pub fn planted(fixture: &Path, planted: Planted) -> Replica {
        Replica::build(fixture, 1, Notifier::new(NOTIFY_AFTER), planted.faults())
    }

    fn build(fixture: &Path, devices: usize, first: Notifier, faults: Faults) -> Replica {
        let fixture = Fixture::load(fixture).unwrap_or_else(|error| panic!("the fixture: {error}"));
        let log_pos = fixture.last_log_pos();
        Replica::build_from(fixture.events(), log_pos, NOW, devices, first, faults)
    }

    fn build_from(
        events: Vec<Value>,
        log_pos: u64,
        now: u64,
        devices: usize,
        first: Notifier,
        faults: Faults,
    ) -> Replica {
        record::install_local(events);
        let mut replica = Replica {
            devices: Vec::new(),
            now,
            log_pos,
            last_used: 0,
            posted: Vec::new(),
            asks: Vec::new(),
            focus: Vec::new(),
            faults,
            confirmations: Vec::new(),
            sent: Vec::new(),
            usage: Vec::new(),
        };
        replica.publish_clock();
        let mut first = Some(first);
        for _ in 0..devices {
            let mut cx = crate::headless_context();
            let (window, _) =
                cx.update(|cx| open_shell(&Layout::shipped("session"), cx, |_, _| {}));
            let notifier = first.take().unwrap_or_else(|| Notifier::new(NOTIFY_AFTER));
            replica.devices.push(Device {
                cx,
                window,
                notifier,
                looking_at: None,
                hidden: false,
                card: None,
                shown: None,
            });
        }
        replica
    }

    /// The views draw at the virtual clock's time.
    fn publish_clock(&self) {
        set_state(AppState {
            inbox: Inbox::default(),
            now: self.now,
            sessions: Vec::new(),
            held: None,
        });
    }

    fn events() -> Vec<Value> {
        record::with_view(|view| view.events.clone()).unwrap_or_default()
    }

    /// Delivers one event to every device through the one reader, at the clock's now, at the next `log_pos`.
    pub fn append(&mut self, session_id: &str, mut event: Value) {
        self.log_pos += 1;
        event["log_pos"] = self.log_pos.into();
        event["session"] = session_id.into();
        record::feed(event.clone());
        if event["kind"] == "ask.created" {
            self.asks.push((
                states::handle(&event),
                session_id.to_owned(),
                self.now,
                None,
            ));
        } else if let Some(ask) = self
            .asks
            .iter_mut()
            .find(|(handle, ..)| states::closes(&event, handle))
        {
            ask.3.get_or_insert(self.now);
        }
        for device in &mut self.devices {
            device.notifier.saw(&event, self.now);
        }
        let events = Replica::events();
        let now = self.now;
        for device in 0..self.devices.len() {
            let gone = self.with_card(device, |controller| {
                controller.record_changed(&events, now);
                controller.state_name() == "hidden"
            });
            // Its ask closed elsewhere: the card leaves the window.
            if gone == Some(true) {
                self.dismiss(device);
            }
        }
        self.run_due();
    }

    /// Moves the virtual clock forward, running what comes due on the way at its due time.
    pub fn advance(&mut self, by: Duration) {
        let until = self.now + by.as_millis() as u64;
        loop {
            let next = self
                .devices
                .iter()
                .filter_map(|device| device.notifier.next_due())
                .map(|due| due.max(self.now))
                .min()
                .filter(|due| *due <= until)
                .unwrap_or(until);
            self.step_to(next);
            self.run_due();
            if next == until {
                return;
            }
        }
    }

    fn step_to(&mut self, at: u64) {
        let by = Duration::from_millis(at - self.now);
        for device in &mut self.devices {
            device.cx.advance_clock(by);
            device.cx.run_until_parked();
        }
        self.now = at;
        self.publish_clock();
        for device in 0..self.devices.len() {
            self.with_card(device, |controller| controller.tick(at));
        }
    }

    fn run_due(&mut self) {
        let events = Replica::events();
        for (index, device) in self.devices.iter_mut().enumerate() {
            let looking_at = if device.hidden {
                None
            } else {
                device.looking_at.as_deref()
            };
            let due = device
                .notifier
                .due(&events, self.now, looking_at, index == self.last_used);
            self.posted
                .extend(due.into_iter().map(|notification| Posted {
                    device: index,
                    ask: notification.ask,
                    session: notification.session,
                    at: self.now,
                    text: notification.text,
                    sound: notification.sound,
                }));
        }
    }

    pub fn now(&self) -> u64 {
        self.now
    }

    /// How many paired devices the replica holds.
    pub fn devices(&self) -> usize {
        self.devices.len()
    }

    /// That device's focused window shows `session`'s page, or no session's; it becomes the device you used last.
    pub fn focus(&mut self, device: usize, session: Option<&str>) {
        self.devices[device].looking_at = session.map(str::to_owned);
        self.last_used = device;
        self.focus
            .push((self.now, device, session.map(str::to_owned)));
    }

    pub fn notifications(&self) -> Vec<Posted> {
        self.posted.clone()
    }

    /// Clicks a notification on its device: it opens the ask's card there and answers nothing.
    pub fn click(&mut self, posted: &Posted) {
        let Some(ask) = posted.ask.clone() else {
            self.devices[posted.device].card = None;
            return;
        };
        self.present(posted.device, &ask);
        let events = Replica::events();
        let now = self.now;
        self.with_card(posted.device, |controller| {
            controller.notification_action(&events, now)
        });
        self.collect();
    }

    pub fn card(&self, device: usize) -> Option<String> {
        self.devices[device].card.clone()
    }

    /// The menu-bar item's title on a device: the count alone.
    pub fn menu_bar(&mut self, device: usize) -> String {
        let _ = &self.devices[device];
        states::count(&Replica::events()).to_string()
    }

    // ---- Issue #327: the question card.

    /// Presents `ask`'s card on a device in the window's centre, wholly inside it.
    pub fn present(&mut self, device: usize, ask: &str) -> CardSeen {
        let [w, h] = card::SIZE;
        let rect = [(WINDOW.0 as i64 - w) / 2, (WINDOW.1 as i64 - h) / 2, w, h];
        self.present_in(
            device,
            ask,
            Slot {
                rect,
                scrolled_out: 0,
            },
        )
    }

    /// Presents `ask`'s card on a device in the slot a view reserved: a card already up there leaves first,
    /// unanswered.
    pub fn present_in(&mut self, device: usize, ask: &str, slot: Slot) -> CardSeen {
        self.dismiss(device);
        let [x, y, w, h] = slot.rect;
        // The visible area the slot must lie in: the window, less what the view scrolled the slot out of, which
        // starts the view's scroll area that many points below the slot's top.
        let visible = [
            0,
            y + slot.scrolled_out,
            WINDOW.0 as i64,
            WINDOW.1 as i64 - y - slot.scrolled_out,
        ];
        let armed_slot = arming::Slot {
            rect: [x, y, w, h],
            visible,
        };
        let controller =
            Controller::present(&Replica::events(), ask, self.now, armed_slot, self.faults)
                .unwrap_or_else(|| panic!("{ask}: the record holds no such ask"));
        let target = &mut self.devices[device];
        let shown = target
            .cx
            .update_window(target.window, |_, window, cx| {
                card::present_question(controller, window, cx)
            })
            .expect("the window takes the card");
        target.shown = Some(shown);
        target.card = Some(ask.to_owned());
        self.collect();
        self.card_seen(device).expect("the card was presented")
    }

    fn dismiss(&mut self, device: usize) {
        self.collect();
        // A prompt the leaving card raised answers nothing now: it is a cancelled one.
        self.cancel_prompts(device);
        let target = &mut self.devices[device];
        if let Some(shown) = target.shown.take() {
            target
                .cx
                .update(|cx| shown.update(cx, |card, cx| card.dismiss(cx)));
            target.cx.run_until_parked();
        }
        target.card = None;
    }

    fn with_card<R>(
        &mut self,
        device: usize,
        read: impl FnOnce(&mut Controller) -> R,
    ) -> Option<R> {
        let target = &mut self.devices[device];
        let shown = target.shown.clone()?;
        target.cx.update(|cx| {
            shown.update(cx, |card, cx| {
                let out = card.controller_mut().map(read);
                cx.notify();
                out
            })
        })
    }

    /// Takes what every device's card wrote since last time into the replica's own lists.
    fn collect(&mut self) {
        for device in 0..self.devices.len() {
            if let Some((answers, usage)) = self.with_card(device, |controller| {
                (controller.take_answers(), controller.take_usage())
            }) {
                self.sent.extend(answers);
                self.usage.extend(usage);
            }
        }
    }

    /// The card on a device as an assistive client reads it, at the clock's now.
    pub fn card_seen(&mut self, device: usize) -> Option<CardSeen> {
        let now = self.now;
        let (ask, kind, seq, state, lines, options, focused, steps, approve, rect) = self
            .with_card(device, |controller| {
                controller.tick(now);
                let model = controller.model();
                (
                    model.ask.clone(),
                    model.data_kind.clone(),
                    controller.seq(),
                    controller.state_name().to_owned(),
                    controller.lines(),
                    controller.option_labels(),
                    controller.focused(),
                    model
                        .steps
                        .iter()
                        .map(|step| Step {
                            does: step.does.clone(),
                            on: step.on,
                            undoable: step.undoable,
                        })
                        .collect::<Vec<_>>(),
                    controller
                        .approve()
                        .map(|(runs, cannot_undo)| Approve { runs, cannot_undo }),
                    controller.slot().rect,
                )
            })?;
        // The text snapshot: the card's rows in reading order, each only as the window drew it as a node with a
        // name (what an assistive client reads); a row the view leaves out is left out here too.
        let target = &mut self.devices[device];
        let card_id: ElementId = card::CARD_ID.into();
        let drawn = target
            .cx
            .update_window(target.window, |_, window, cx| {
                window.render_frame(cx);
                snapshots(window)
                    .into_iter()
                    .filter(|element| element.visible() && element.path().contains(&card_id))
                    .filter_map(|element| element.label().map(str::to_owned))
                    .collect::<Vec<_>>()
            })
            .expect("the window draws");
        let text = lines
            .into_iter()
            .filter(|line| drawn.contains(line))
            .collect::<Vec<_>>()
            .join("\n");
        Some(CardSeen {
            ask,
            kind,
            seq,
            state,
            text,
            options,
            focused,
            steps,
            approve,
            rect,
        })
    }

    /// Delivers one press to the card on a device, with its own platform timestamp and source.
    pub fn press(&mut self, device: usize, input: Input) {
        let press = deep_app::question::Input {
            t: input.at,
            source: source(&input.source),
            target: target(&input.on),
            phase: match input.phase {
                Phase::Down => deep_app::question::Phase::Down,
                Phase::Up => deep_app::question::Phase::Up,
                Phase::Repeat => deep_app::question::Phase::Repeat,
            },
        };
        let events = Replica::events();
        let now = self.now;
        let did = self.with_card(device, |controller| controller.press(press, &events, now));
        self.took(device, did);
    }

    /// A key on a device: `tab` moves the focus to the next option, `space` presses the focused one.
    pub fn key(&mut self, device: usize, key: &str, at: u64, source: Source) {
        let events = Replica::events();
        let now = self.now;
        let source = self::source(&source);
        let did = self.with_card(device, |controller| {
            controller.key(key, at, source, &events, now)
        });
        self.took(device, did);
    }

    fn took(&mut self, device: usize, did: Option<Did>) {
        match did {
            Some(Did::NeedsConfirmation(prompt)) => self.confirmations.push(Confirmation {
                prompt,
                answered: None,
                device,
            }),
            // The card moved on: a prompt still open for an earlier press is a cancelled one.
            Some(Did::Answered | Did::Undone) => self.cancel_prompts(device),
            _ => {}
        }
        self.collect();
    }

    fn cancel_prompts(&mut self, device: usize) {
        for prompt in &mut self.confirmations {
            if prompt.device == device && prompt.answered.is_none() {
                prompt.answered = Some(false);
            }
        }
    }

    pub fn type_words(&mut self, device: usize, words: &str) {
        self.with_card(device, |controller| controller.type_words(words));
    }

    /// Attaches an image to the card; answers its SHA-256.
    pub fn attach_image(&mut self, device: usize, bytes: &[u8]) -> String {
        self.with_card(device, |controller| controller.attach_image(bytes))
            .expect("a card is up")
    }

    pub fn toggle_step(&mut self, device: usize, step: usize) {
        self.with_card(device, |controller| controller.toggle_step(step));
    }

    /// Every OS confirmation the cards raised, oldest first.
    pub fn confirmations(&self) -> Vec<Confirmation> {
        self.confirmations.clone()
    }

    /// The OS answers the oldest open confirmation: confirmed, or cancelled.
    pub fn confirm(&mut self, confirmed: bool) {
        let Some(index) = self
            .confirmations
            .iter()
            .position(|prompt| prompt.answered.is_none())
        else {
            return;
        };
        self.confirmations[index].answered = Some(confirmed);
        let device = self.confirmations[index].device;
        let events = Replica::events();
        let now = self.now;
        self.with_card(device, |controller| {
            controller.confirmed(confirmed, &events, now)
        });
        self.collect();
    }

    /// Every `ask.answer` the app sent, as its params, in order.
    pub fn answers(&self) -> Vec<Value> {
        self.sent.clone()
    }

    /// The usage rows the app wrote, in order.
    pub fn usage(&self) -> Vec<Value> {
        self.usage.clone()
    }

    pub fn hide_window(&mut self, device: usize) {
        self.devices[device].hidden = true;
    }

    pub fn show_window(&mut self, device: usize) {
        self.devices[device].hidden = false;
    }

    /// The asks open in the record now.
    pub fn open_asks(&self) -> Vec<String> {
        states::open_asks(&Replica::events(), None)
            .into_iter()
            .map(states::handle)
            .collect()
    }

    /// Kills the app: every device leaves with its card up. The record and the clock survive; nothing of the
    /// app's does. What the dying app sent is answered with it.
    pub fn kill(mut self) -> Killed {
        let events = Replica::events();
        let now = self.now;
        // What the dying app sends is only what its cards write on the way out.
        self.collect();
        self.sent.clear();
        for device in 0..self.devices.len() {
            self.with_card(device, |controller| controller.exit(&events, now));
        }
        self.collect();
        Killed {
            sent: std::mem::take(&mut self.sent),
            events,
            log_pos: self.log_pos,
            now,
            faults: self.faults,
        }
    }

    /// Opens the app again on the record and the clock a kill left.
    pub fn relaunch(killed: Killed) -> Replica {
        Replica::build_from(
            killed.events,
            killed.log_pos,
            killed.now,
            1,
            Notifier::new(NOTIFY_AFTER),
            killed.faults,
        )
    }

    /// What each surface of States people see shows for the record's one session: the sidebar row, the line and
    /// the return card as device 0's window drew them; the verdict line as sent to the chat; the menu bar's title
    /// and menu; and the notification the app posts in that state.
    pub fn surfaces(&mut self) -> Vec<Seen> {
        let events = Replica::events();
        let session = states::sessions(&events)
            .first()
            .cloned()
            .unwrap_or_default();
        let device = &mut self.devices[0];
        let drawn = device
            .cx
            .update_window(device.window, |_, window, cx| {
                window.render_frame(cx);
                let named = |id: &ElementId| {
                    snapshots(window)
                        .into_iter()
                        .find(|element| element.path().last() == Some(id))
                        .and_then(|element| element.label().map(str::to_owned))
                        .unwrap_or_default()
                };
                [
                    ("sidebar-row", named(&("sidebar-session", 0usize).into())),
                    ("line", named(&"line-status".into())),
                    ("return-card", named(&"return-card".into())),
                ]
            })
            .expect("the window draws");
        let menu = format!(
            "{}\n{}",
            states::count(&events),
            states::menu(&events, self.now).join("\n")
        );
        drawn
            .into_iter()
            .chain([
                (
                    "verdict-line",
                    states::verdict_line(&events, &session, self.now),
                ),
                ("menu-bar", menu),
                (
                    "notification",
                    notify::notification_text(&events, &session, self.now),
                ),
            ])
            .map(|(surface, text)| seen(surface, text))
            .collect()
    }

    /// Device 0's window as a text snapshot.
    pub fn window(&mut self) -> Snapshot {
        let device = &mut self.devices[0];
        device
            .cx
            .update_window(device.window, |_, window, cx| {
                deep_app::canvas::clear_items();
                window.render_frame(cx);
                from_observed(window)
            })
            .expect("the window draws")
    }
}

fn source(source: &Source) -> arming::Source {
    match source {
        Source::Hid => arming::Source::Hardware,
        Source::Synthetic { pid } => arming::Source::Synthetic { pid: Some(*pid) },
        Source::Accessibility { client } => arming::Source::Accessibility {
            client: match client {
                Client::VoiceOver => arming::Client::Voiceover,
                Client::Unknown => arming::Client::Unknown,
            },
        },
    }
}

fn target(on: &On) -> Target {
    match on {
        On::Option(index) => Target::Option(*index),
        On::Send => Target::Send,
        On::Undo => Target::Undo,
        On::Step(index) => Target::Step(*index),
    }
}

/// A surface's text read back: its status mark is the first glyph of the look's it shows.
fn seen(surface: &str, text: String) -> Seen {
    let glyph = text
        .split_whitespace()
        .find(|word| entry_of(word).is_some())
        .unwrap_or_default()
        .to_owned();
    Seen {
        surface: surface.to_owned(),
        entry: entry_of(&glyph).unwrap_or_default().to_owned(),
        glyph,
        text,
    }
}

/// The status-map entry whose glyph this is; the look gives each entry its own.
fn entry_of(glyph: &str) -> Option<&'static str> {
    states::TABLE
        .iter()
        .map(|(_, entry, _)| *entry)
        .find(|entry| states::glyph(entry) == glyph)
}
