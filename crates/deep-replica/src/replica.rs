//! Issue #326: the app headless on gpui's virtual clock, as one or more paired devices of one hub. Each device is
//! its own app with its window on a session's page, its notifier and its menu bar; all of them read the one record
//! through the app's one reader and share one clock. A test appends events, moves the clock, and reads back what
//! each surface showed and what each device posted.

use std::{path::Path, time::Duration};

use deep_app::{
    events::{Fixture, Inbox},
    notify::{self, Notifier, Sound, NOTIFY_AFTER},
    record, states,
    views::{set_state, AppState, Layout},
};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{base::test_support::snapshots, AnyWindowHandle, ElementId, HeadlessAppContext};
use serde_json::Value;

use crate::{
    shell::open_shell,
    snapshot::{from_observed, Snapshot},
    NOW,
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

struct Device {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    notifier: Notifier,
    /// The session whose page is open in this device's focused window.
    looking_at: Option<String>,
    /// The ask whose question card is open.
    card: Option<String>,
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
}

impl Replica {
    pub fn open(fixture: &Path) -> Replica {
        Replica::build(fixture, 1, Notifier::new(NOTIFY_AFTER))
    }

    pub fn open_devices(fixture: &Path, devices: usize) -> Replica {
        Replica::build(fixture, devices, Notifier::new(NOTIFY_AFTER))
    }

    pub fn with_notifier(fixture: &Path, notifier: Notifier) -> Replica {
        Replica::build(fixture, 1, notifier)
    }

    fn build(fixture: &Path, devices: usize, first: Notifier) -> Replica {
        let fixture = Fixture::load(fixture).unwrap_or_else(|error| panic!("the fixture: {error}"));
        record::install_local(fixture.events());
        let mut replica = Replica {
            devices: Vec::new(),
            now: NOW,
            log_pos: fixture.last_log_pos(),
            last_used: 0,
            posted: Vec::new(),
            asks: Vec::new(),
            focus: Vec::new(),
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
                card: None,
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
    }

    fn run_due(&mut self) {
        let events = Replica::events();
        for (index, device) in self.devices.iter_mut().enumerate() {
            let due = device.notifier.due(
                &events,
                self.now,
                device.looking_at.as_deref(),
                index == self.last_used,
            );
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
        self.devices[posted.device].card = posted.ask.clone();
    }

    pub fn card(&self, device: usize) -> Option<String> {
        self.devices[device].card.clone()
    }

    /// The menu-bar item's title on a device: the count alone.
    pub fn menu_bar(&mut self, device: usize) -> String {
        let _ = &self.devices[device];
        states::count(&Replica::events()).to_string()
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
