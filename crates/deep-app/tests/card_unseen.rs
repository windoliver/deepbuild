//! A question card in a window nobody can see, or whose window changed: it counts as shown only once it's on screen and
//! arms again when its window was covered, resized, or came forward (#327; the Question card's `rearm_on`), and a picture
//! a taste call judges counts only while it's on screen (#3234). The ask's own page stands in a window that is hidden and
//! shown, or behind a locked screen, and is drawn as macOS draws it: at a frame a display asks for, and none is asked of a
//! hidden window. Time passes by the app's tick.

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use deep_app::arming::{Client, Source, ARM_AFTER};
use deep_app::question::{Controller, Did, Input, Phase, Target};
use deep_app::shown::{force_seen, Seen};
use deep_app::{card, open, record, views};
use gpui_kit::base::dock::DockArea;
use gpui_kit::{
    px, size, AnyWindowHandle, AppContext as _, Bounds, Empty, HeadlessAppContext, NoopTextSystem,
    Point, WindowBounds, WindowOptions, WindowVisibility,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const NOW: u64 = 1_800_000_000_000;
/// The app's tick (`record::TICK`).
const TICK: u64 = 250;
const ON_SCREEN: Seen = Seen {
    visible: true,
    minimized: false,
    display_awake: true,
    session_locked: false,
};
/// The card's two options, as it draws them.
const YES: Target = Target::Option(0);
const NO: Target = Target::Option(1);

/// The test's own home, with an evidence store.
fn home() -> &'static PathBuf {
    static HOME: OnceLock<PathBuf> = OnceLock::new();
    HOME.get_or_init(|| {
        let home = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("card-unseen-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        home
    })
}

/// Keeps `bytes` in the evidence store; their hash.
fn stored(bytes: &[u8]) -> String {
    let hash = format!("{:x}", Sha256::digest(bytes));
    let dir = home().join(".deepbuild/evidence").join(&hash[..2]);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(&hash[2..]), bytes).unwrap();
    hash
}

/// A taste call that judges one 100 by 100 picture.
fn judging_a_picture() -> Value {
    let mut png = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(100, 100, image::Rgba([200, 40, 40, 255]))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let picture = json!({"sha256": stored(png.get_ref()), "size": [100, 100]});
    let manifest = stored(json!({"pictures": [picture]}).to_string().as_bytes());
    ask(json!({"kind": "evidence", "ref": manifest}))
}

/// An open taste call, its first option recommended.
fn ask(pinned_to: Value) -> Value {
    json!({"kind": "ask.created", "id": "T", "session": "S", "log_pos": 1, "data": {
        "kind": "taste", "question": "Keep it?", "recommended": "yes", "default": "yes", "key": "k",
        "deadline": NOW + 86_400_000, "pinned_to": pinned_to,
        "options": [{"id": "yes", "label": "Keep it", "decision": "none"}, {"id": "no", "label": "Send back", "decision": "none"}],
    }})
}

fn commit() -> Value {
    json!({"kind": "commit", "ref": "abc"})
}

/// The app's window on the ask's page.
struct Page {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    /// Another window, for the keyboard to be in.
    other: AnyWindowHandle,
    now: u64,
}

impl Page {
    /// The window, on screen, with no card yet.
    fn open(ask: Value) -> Page {
        home();
        let mut cx = HeadlessAppContext::new(Arc::new(NoopTextSystem::new()));
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        record::install_local([ask]);
        views::set_state(views::AppState {
            inbox: Default::default(),
            now: NOW,
            sessions: Vec::new(),
            held: None,
        });
        force_seen(Some(ON_SCREEN));
        let bounds = Bounds::new(Point::default(), size(px(1512.), px(982.)));
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            focus: false,
            show: false,
            // Every frame asked for is drawn, however close by the machine's own clock.
            inactive_frame_interval: None,
            ..Default::default()
        };
        let window = cx
            .update(|cx| cx.open_window(options, |_, cx| cx.new(card::AskPage::new)))
            .unwrap()
            .into();
        let other = cx
            .open_window(size(px(100.), px(100.)), |_, cx| cx.new(|_| Empty))
            .unwrap()
            .into();
        cx.draw_on_request();
        cx.update_window(window, |_, window, cx| {
            let dock = cx.new(|cx| DockArea::new("deepbuild", None, window, cx));
            open::set_shell(&dock, window.window_handle(), cx);
        })
        .unwrap();
        Page {
            cx,
            window,
            other,
            now: NOW,
        }
    }

    /// The keyboard goes to this window, or to the other one.
    fn active(&mut self, active: bool) {
        let window = if active { self.window } else { self.other };
        self.cx
            .update_window(window, |_, window, _| window.activate_window())
            .unwrap();
        self.frames();
    }

    fn visible(&mut self) -> bool {
        self.cx
            .update_window(self.window, |_, window, _| window.is_visible())
            .unwrap()
    }

    /// The frames a display asks for until nothing is new: none of a hidden window.
    fn frames(&mut self) {
        self.cx.run_until_parked();
        while self.visible() && self.cx.request_frame(self.window) {
            self.cx.run_until_parked();
        }
    }

    /// The ask's card presented and drawn, as `open` presents it.
    fn present(&mut self) {
        self.cx
            .update_window(self.window, |_, window, cx| {
                card::present_ask("ask:T", window, cx);
                window.refresh();
            })
            .unwrap();
        self.frames();
    }

    /// `by` ms pass, the app's tick at their end.
    fn pass(&mut self, by: u64) {
        self.now += by;
        let now = self.now;
        views::set_clock(now);
        self.cx.update(|cx| views::tick(now, cx));
        self.frames();
    }

    /// `by` ms pass with no tick.
    fn pass_unticked(&mut self, by: u64) {
        self.now += by;
        views::set_clock(self.now);
    }

    fn becomes(&mut self, visibility: WindowVisibility) {
        self.cx.simulate_visibility_change(self.window, visibility);
        self.frames();
    }

    fn card<R>(&mut self, read: impl FnOnce(&mut Controller) -> R) -> R {
        let (_, shown) = card::shown().expect("the page's card");
        self.cx.update(|cx| {
            shown.update(cx, |card, _| {
                read(card.controller_mut().expect("the ask's card"))
            })
        })
    }

    fn state(&mut self) -> &'static str {
        self.card(|card| card.state_name())
    }

    /// One half of a press on `target`, now.
    fn half(&mut self, target: Target, phase: Phase, source: Source) -> Did {
        let (t, events) = (self.now, record::history());
        self.card(|card| {
            let input = Input {
                t,
                source,
                target,
                phase,
            };
            card.press(input, &events, t)
        })
    }

    /// A whole press on `target`, now.
    fn press(&mut self, target: Target, source: Source) -> Did {
        match self.half(target, Phase::Down, source) {
            Did::Nothing => self.half(target, Phase::Up, source),
            other => other,
        }
    }
}

#[test]
fn a_card_hidden_inside_its_interval_arms_only_a_whole_one_after_it_is_shown() {
    let mut page = Page::open(ask(commit()));
    page.present();
    page.pass(400);
    page.becomes(WindowVisibility::Hidden);
    let mut states = vec![page.state()];
    for by in [TICK, TICK, 2_000] {
        page.pass(by);
        states.push(page.state());
    }
    page.becomes(WindowVisibility::Visible);
    for by in [0, ARM_AFTER - 1, 1] {
        page.pass(by);
        states.push(page.state());
    }
    assert_eq!(
        states,
        [
            "presented",
            "presented",
            "presented",
            "presented",
            "presented",
            "presented",
            "armed"
        ],
        "hidden at 400 ms for 2.5 s, then shown for 0, 499 and 500 ms"
    );
}

#[test]
fn a_card_opened_in_a_hidden_window_arms_only_once_shown_and_says_why_it_takes_no_press() {
    let mut page = Page::open(ask(commit()));
    page.becomes(WindowVisibility::Hidden);
    page.present();
    page.pass(2_000);
    let hidden = page.state();
    // An assistive client can press what nobody can see.
    let client = Source::Accessibility {
        client: Client::Unknown,
    };
    let pressed = page.press(NO, client);
    let said = page.card(|card| card.lines()).pop();
    page.becomes(WindowVisibility::Visible);
    page.pass(ARM_AFTER - 1);
    let (before, said_then) = (page.state(), page.card(|card| card.lines()).pop());
    page.pass(1);
    assert_eq!(
        (hidden, pressed, before, page.state()),
        ("presented", Did::Refused, "presented", "armed")
    );
    assert_eq!(said.as_deref(), Some("Show the window first"));
    assert_eq!(said_then.as_deref(), Some("Hold still"));
}

#[test]
fn an_armed_card_hidden_and_shown_between_two_ticks_refuses_a_press_inside_a_new_interval() {
    let mut page = Page::open(ask(commit()));
    page.present();
    page.pass(ARM_AFTER);
    assert_eq!(page.state(), "armed");
    page.pass_unticked(100);
    page.becomes(WindowVisibility::Hidden);
    let hidden = page.state();
    page.pass_unticked(100);
    page.becomes(WindowVisibility::Visible);
    let shown = page.state();
    let at_once = page.press(NO, Source::Hardware);
    page.pass(ARM_AFTER - 1);
    let late = page.press(NO, Source::Hardware);
    page.pass(1);
    assert_eq!(
        (hidden, shown, at_once, late, page.state()),
        (
            "presented",
            "presented",
            Did::Refused,
            Did::Refused,
            "armed"
        )
    );
}

#[test]
fn a_press_begun_before_the_window_was_hidden_answers_nothing_after() {
    let mut page = Page::open(ask(commit()));
    page.present();
    page.pass(ARM_AFTER);
    page.card(|card| card.type_words("darker"));
    // Its downs land on the armed card, on an option and on Send; one more waits on the OS.
    let client = Source::Accessibility {
        client: Client::Unknown,
    };
    let downs = [NO, Target::Send].map(|target| page.half(target, Phase::Down, Source::Hardware));
    page.becomes(WindowVisibility::Hidden);
    page.becomes(WindowVisibility::Visible);
    page.pass(ARM_AFTER);
    let ups = [NO, Target::Send].map(|target| page.half(target, Phase::Up, Source::Hardware));
    assert_eq!(
        (downs, ups, page.state()),
        (
            [Did::Nothing, Did::Nothing],
            [Did::Nothing, Did::Nothing],
            "armed"
        )
    );
    let waits = page.press(Target::Send, client);
    assert!(matches!(waits, Did::NeedsConfirmation(_)), "{waits:?}");
    page.becomes(WindowVisibility::Hidden);
    page.becomes(WindowVisibility::Visible);
    page.pass(ARM_AFTER);
    let (events, now) = (record::history(), page.now);
    let confirmed = page.card(|card| card.confirmed(true, &events, now));
    assert_eq!((confirmed, page.state()), (Did::Nothing, "armed"));
}

#[test]
fn a_card_behind_a_lock_or_on_a_display_asleep_is_not_armed_until_shown_for_its_interval() {
    let mut page = Page::open(ask(commit()));
    page.present();
    page.pass(ARM_AFTER);
    for unseen in [
        Seen {
            session_locked: true,
            ..ON_SCREEN
        },
        Seen {
            display_awake: false,
            ..ON_SCREEN
        },
    ] {
        assert_eq!(page.state(), "armed");
        force_seen(Some(unseen));
        page.pass(TICK);
        let mut states = vec![page.state()];
        page.pass(2_000);
        states.push(page.state());
        force_seen(Some(ON_SCREEN));
        for by in [TICK, ARM_AFTER - 1, 1] {
            page.pass(by);
            states.push(page.state());
        }
        assert_eq!(
            states,
            ["presented", "presented", "presented", "presented", "armed"],
            "{unseen:?} for 2,250 ms, then shown at a tick, 499 and 500 ms after it"
        );
    }
}

#[test]
fn a_picture_counts_only_the_time_its_window_could_be_seen() {
    let mut page = Page::open(judging_a_picture());
    page.present();
    assert_eq!(page.card(|card| card.left()), Some((1, 1)));
    page.pass(300);
    page.becomes(WindowVisibility::Hidden);
    page.pass(TICK);
    page.pass(2_000);
    let hidden = page.card(|card| card.left());
    page.becomes(WindowVisibility::Visible);
    page.pass(ARM_AFTER - 1);
    let before = page.card(|card| card.left());
    page.pass(1);
    let after = page.card(|card| card.left());
    let did = page.press(YES, Source::Hardware);
    let ms = page.card(|card| card.take_answers())[0]["pictures"][0]["ms"].clone();
    assert_eq!(
        (hidden, before, after, did, ms),
        (
            Some((1, 1)),
            Some((1, 1)),
            Some((0, 1)),
            Did::Answered,
            json!(300 + ARM_AFTER)
        ),
        "drawn whole for 300 ms, hidden for 2,250 ms, then shown for 499 and 500 ms"
    );
}

#[test]
fn a_picture_drawn_behind_a_lock_was_not_shown() {
    let mut page = Page::open(judging_a_picture());
    force_seen(Some(Seen {
        session_locked: true,
        ..ON_SCREEN
    }));
    page.present();
    page.pass(TICK);
    page.pass(2_000);
    assert_eq!(page.card(|card| card.left()), Some((1, 1)));
    force_seen(Some(ON_SCREEN));
    page.pass(TICK);
    page.pass(ARM_AFTER);
    assert_eq!(page.card(|card| card.left()), Some((0, 1)));
}

/// A window made smaller has its card's slot outside it until its page is drawn again, which a busy app does late.
#[test]
fn a_press_before_a_smaller_window_is_drawn_answers_nothing() {
    let mut page = Page::open(ask(commit()));
    page.present();
    page.pass(ARM_AFTER);
    let (cx, window) = (&mut page.cx, page.window);
    cx.simulate_resize(window, size(px(700.), px(400.)));
    let at_once = page.state();
    page.pass_unticked(2 * ARM_AFTER);
    let pressed = page.press(NO, Source::Hardware);
    let said = page.card(|card| card.lines()).pop();
    page.frames();
    page.pass(ARM_AFTER);
    assert_eq!(
        (at_once, pressed, said.as_deref(), page.state()),
        (
            "presented",
            Did::Refused,
            Some("Make the window taller"),
            "armed"
        )
    );
}

/// An assistive client's press on `target`, the OS prompt it raises taking the keyboard from the window, and its yes: the
/// card while the prompt is up, and what the yes did.
fn prompted(target: Target, words: &str) -> (&'static str, Did) {
    let mut page = Page::open(ask(commit()));
    page.present();
    page.active(true);
    page.pass(ARM_AFTER);
    page.card(|card| card.type_words(words));
    let client = Source::Accessibility {
        client: Client::Unknown,
    };
    let waits = page.press(target, client);
    assert!(matches!(waits, Did::NeedsConfirmation(_)), "{waits:?}");
    page.active(false);
    let prompted = page.state();
    page.active(true);
    let (events, now) = (record::history(), page.now);
    (
        prompted,
        page.card(|card| card.confirmed(true, &events, now)),
    )
}

#[test]
fn an_os_prompt_takes_the_keyboard_from_the_window_and_its_yes_still_answers() {
    assert_eq!(prompted(NO, ""), ("presented", Did::Answered));
}

#[test]
fn an_os_prompt_for_a_send_takes_the_keyboard_and_its_yes_still_answers() {
    assert_eq!(
        prompted(Target::Send, "darker"),
        ("presented", Did::Answered)
    );
}
