//! Issue #3232: the window says what changed. One polite live region in the window's tree, which draws nothing: its
//! value is the last line said, and its rows the last five, newest first, each with its time, so a person who missed a
//! line can walk back to it. A line is said only for a change on a closed list, read from the record's events and the
//! card's own state table: an ask that opened while its session's page is open in the key window, which the notifier
//! posts nothing for; the state word of the session on the open page; a presented card whose content changed; a hold
//! before a step that can't be undone, when it starts and when it ran or was withdrawn; a default applied to the ask
//! on the open page; the hub not answering, and answering again. Never what a working session is doing, a time that
//! ticks, hover, an unread mark or a row that moved. Changes within [`TOGETHER`] of each other are one line with their
//! count. Every word is the copy table's, and a line about an ask starts with needs you and ends with the key that
//! opens its card.

use std::collections::VecDeque;

use gpui_kit::*;
use serde_json::Value;

use crate::address::{Address, Place};
use crate::plain::planted;
use crate::{copy, record, states};

/// The region's node in the tree.
pub const REGION: &str = "live-region";
/// How many lines the region keeps as rows.
pub const KEPT: usize = 5;
/// Changes that land this close together are one line, in ms.
pub const TOGETHER: u64 = 2_000;

/// One line the window said: which, when on the views' clock in ms, and its words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Line {
    pub seq: u64,
    pub at: u64,
    pub text: String,
}

/// One change a line says. A change with the `key` of one the line already holds takes its place.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Change {
    key: String,
    /// It is about an open ask: its line starts with needs you and ends with the key that opens its card.
    ask: bool,
    words: String,
    /// What #3232's planted line starts with: what the ask's session was doing.
    first: Option<String>,
}

fn change(key: &str, words: String) -> Change {
    Change {
        key: key.to_owned(),
        ask: false,
        words,
        first: None,
    }
}

struct Entry {
    line: Line,
    /// Until when a change still joins it.
    open_until: u64,
    changes: Vec<Change>,
}

/// What the window last read of what it says: the record's place, the page shown with its session's state word and
/// what it was doing, the hub, the asks in sight, the asks whose yes the hub holds or held, and the planted
/// receipt's countdown.
#[derive(Clone, Default, PartialEq)]
struct Read {
    to: Option<u64>,
    page: Option<(String, Option<String>, Option<String>)>,
    hub_down: bool,
    /// #3232's planted line: the session on the open page, with what its row was last doing.
    did: Option<(String, String)>,
    sight: Vec<String>,
    /// The ask answered on the open page, whose hold the record says next, and the asks whose hold was said.
    answered: Option<String>,
    held: Vec<String>,
    counting: Option<(u64, u64)>,
}

#[derive(Default)]
struct Said {
    /// The lines kept, newest first.
    lines: VecDeque<Entry>,
    seq: u64,
    read: Read,
    /// The asks said as they opened: the notifier posts nothing for one, and none is said again when it comes due.
    asked: Vec<String>,
    told: VecDeque<String>,
    view: Option<Entity<Region>>,
}

impl Global for Said {}

/// The lines the region keeps, newest first.
pub fn lines(cx: &App) -> Vec<Line> {
    cx.try_global::<Said>()
        .map(|said| said.lines.iter().map(|entry| entry.line.clone()).collect())
        .unwrap_or_default()
}

/// The asks said as they opened since this was last asked: the notifier posts nothing for them.
pub fn take_asked(cx: &mut App) -> Vec<String> {
    if cx
        .try_global::<Said>()
        .is_none_or(|said| said.asked.is_empty())
    {
        return Vec::new();
    }
    std::mem::take(&mut cx.default_global::<Said>().asked)
}

/// A line's words: needs you first and the open key last when it holds an ask, the count of its changes when it
/// holds several, the one count of asks, then each change. `asks` is how many asks need you.
fn text(changes: &[Change], asks: usize) -> String {
    let ask = changes.iter().any(|change| change.ask);
    let mut parts: Vec<String> = changes.iter().filter_map(|c| c.first.clone()).collect();
    if ask {
        parts.push(copy::text("states.needs_you").to_owned());
    }
    if changes.len() > 1 {
        parts.push(copy::count("said.changes", changes.len() as u64, &[]));
    }
    if ask {
        parts.push(crate::views::asks_need_you(asks));
    }
    parts.extend(changes.iter().map(|change| change.words.clone()));
    // copy-exception: an action's identity, never drawn
    if let Some(key) = crate::actions::key("Next ask").filter(|_| ask) {
        parts.push(crate::actions::glyphs(&key));
    }
    parts.join(" · ")
}

/// Puts `change` at `now` in the newest line when that one is still open, else in a line of its own, the newest.
/// `alone` joins nothing and nothing joins it. Whether a line was started.
fn put(
    lines: &mut VecDeque<Entry>,
    seq: &mut u64,
    new: Change,
    alone: bool,
    now: u64,
    asks: usize,
) {
    match lines.front_mut() {
        Some(entry) if !alone && now < entry.open_until => {
            entry.changes.retain(|held| held.key != new.key);
            entry.changes.push(new);
            entry.open_until = now + TOGETHER;
            entry.line.text = text(&entry.changes, asks);
        }
        _ => {
            *seq += 1;
            lines.push_front(Entry {
                line: Line {
                    seq: *seq,
                    at: now,
                    text: text(std::slice::from_ref(&new), asks),
                },
                open_until: if alone { 0 } else { now + TOGETHER },
                changes: vec![new],
            });
            lines.truncate(KEPT);
        }
    }
}

/// Says `change` at `now`. #3232's planted window joins no two changes.
fn say(change: Change, alone: bool, now: u64, cx: &mut App) {
    let asks = record::with_view(|view| states::count(&view.table()));
    let alone = alone || planted("announces-each-change");
    let said = cx.default_global::<Said>();
    put(
        &mut said.lines,
        &mut said.seq,
        change,
        alone,
        now,
        asks.unwrap_or(0),
    );
    if let Some(view) = said.view.clone() {
        view.update(cx, |_, cx| cx.notify());
    }
}

/// An open ask's change: its question, and in the planted window what its session was last doing.
fn asking(ask: &Value, did: Option<&(String, String)>) -> Change {
    let did = did.filter(|(session, _)| ask["session"] == session.as_str());
    Change {
        key: states::handle(ask),
        ask: true,
        words: crate::question::visible(ask["data"]["question"].as_str().unwrap_or_default()),
        first: did.map(|(_, doing)| doing.clone()),
    }
}

/// The asks that came due and posted no notification: said here instead while the window is the key one, each once.
pub fn asks(handles: &[String], now: u64, cx: &mut App) {
    if handles.is_empty() || !crate::open::is_key(cx) {
        return;
    }
    let said = cx.default_global::<Said>();
    let (told, did) = (&said.told, said.read.did.clone());
    let new: Vec<&String> = handles.iter().filter(|h| !told.contains(h)).collect();
    let changes = record::with_view(|view| {
        let table = view.table();
        let open = table.open_asks(None);
        let found = |handle: &String| open.iter().find(|ask| states::handle(ask) == *handle);
        new.iter()
            .filter_map(|handle| found(handle).map(|ask| asking(ask, did.as_ref())))
            .collect::<Vec<_>>()
    });
    for change in changes.unwrap_or_default() {
        tell(&change.key, cx);
        say(change, false, now, cx);
    }
}

/// Remembers that `ask` was said, among the newest few.
fn tell(ask: &str, cx: &mut App) {
    let told = &mut cx.default_global::<Said>().told;
    told.push_back(ask.to_owned());
    if told.len() > 64 {
        told.pop_front();
    }
}

/// The presented card's content changed and it was presented again, unarmed: its question is said as changed.
pub(crate) fn question_changed(ask: &str, question: &str, cx: &mut App) {
    let question = crate::question::visible(question);
    let words = [copy::text("said.question_changed"), question.as_str()];
    let mut new = change(ask, words.join(" · "));
    new.ask = true;
    say(new, false, crate::views::now(), cx);
}

/// A session's state line: its name, its new word, and whom it waits for and why, as its row says them.
fn state(row: &Value) -> String {
    let field = |key: &str| row[key].as_str().unwrap_or_default();
    let why = copy::hub(field("why"));
    let waits = match row["waits_on"].as_str() {
        Some("you") => copy::fill("hub.waits_for_you", &[&why]),
        Some(who) => copy::fill("hub.waits_for", &[&who, &why]),
        None => why,
    };
    let parts = [
        crate::question::visible(field("title")),
        states::shown(field("word")).to_owned(),
        waits,
    ];
    parts.join(" · ")
}

/// A hold's line as its event says it (#1101): how long it holds and the key that undoes it, that its steps ran, or
/// that it was withdrawn.
fn hold(event: &Value) -> Option<Change> {
    let kind = event["kind"].as_str()?;
    let words = match kind {
        "approval.held" => {
            let length = event["data"]["until"]
                .as_u64()?
                .saturating_sub(event["ts"].as_u64()?);
            let mut parts = vec![
                copy::count("question.starts_in", (length + 500) / 1000, &[]),
                copy::text("question.undo").to_owned(),
            ];
            // copy-exception: an action's identity, never drawn
            let undo = crate::actions::key("Undo answer");
            parts.extend(undo.map(|key| crate::actions::glyphs(&key)));
            parts.join(" · ")
        }
        "approval.started" => copy::text("question.ran_for_good").to_owned(),
        _ => copy::text("said.withdrawn").to_owned(),
    };
    Some(change(kind, words))
}

/// A default applied to the ask on the open page: the default, and that it can be undone.
fn defaulted(handle: &str, now: u64) -> Change {
    let default = crate::kinds::Model::read(&record::history(), handle, now).map(|ask| ask.default);
    let mut parts = vec![copy::text("codes.ask.outcome.defaulted").to_owned()];
    parts.extend(default);
    parts.push(copy::text("said.can_be_undone").to_owned());
    change(handle, parts.join(" · "))
}

/// Time passed, in the window `key` says is the key one: what the record brought since the last tick is said, each
/// change against the page that was open when it landed. The first tick says nothing: it reads where things stand.
pub(crate) fn tick(now: u64, key: bool, cx: &mut App) {
    let here = crate::open::current(cx);
    let was = cx
        .try_global::<Said>()
        .map(|said| said.read.clone())
        .unwrap_or_default();
    let session = here.as_ref().filter(|a| a.place == Place::Session);
    let mut changes: Vec<(Change, bool)> = Vec::new();
    let (mut opened, mut asked, mut defaults) = (Vec::new(), Vec::new(), Vec::new());
    let mut next = was.clone();
    let read = record::with_view(|view| {
        let table = view.table();
        // The events since the last tick, read back from the newest: an idle tick reads none.
        let from = was.to.unwrap_or(u64::MAX);
        let newest = view.events.iter().rev();
        let mut new: Vec<&Value> = newest
            .take_while(|event| event["log_pos"].as_u64() > Some(from))
            .collect();
        new.reverse();
        let mut opens = was.to.is_none();
        let on_page = |ask: &str| {
            let page = was.page.as_ref().map(|page| page.0.as_str());
            page == Some(Address::ask(ask).to_string().as_str())
                || page.is_some_and(|page| {
                    table
                        .batch(ask)
                        .iter()
                        .any(|a| Address::ask(a).to_string() == page)
                })
        };
        for event in new {
            let core = event["writer"] == "core";
            let subject = event["subject"].as_str().unwrap_or_default();
            opens |= crate::notify::reads(event);
            match event["kind"].as_str().unwrap_or_default() {
                "ask.answered" if core && on_page(subject) => {
                    next.answered = Some(subject.to_owned())
                }
                "ask.defaulted" if core && on_page(subject) => defaults.push(subject.to_owned()),
                "approval.held"
                    if core && (on_page(subject) || next.answered.as_deref() == Some(subject)) =>
                {
                    next.held.push(subject.to_owned());
                    next.counting = event["data"]["until"].as_u64().map(|until| (until, 0));
                    changes.extend(hold(event).map(|change| (change, false)));
                }
                "approval.started" | "approval.withdrawn"
                    if core && next.held.iter().any(|h| h == subject) =>
                {
                    next.held.retain(|held| held != subject);
                    next.counting = None;
                    changes.extend(hold(event).map(|change| (change, false)));
                }
                _ => {}
            }
        }
        // An ask is said as it comes in sight, where its notification would post (#22): one waiting for its batch
        // once the core shows it and the hub's list takes it in. The asks in sight are read at the first tick and
        // on one with an event the notifier reads too.
        if opens {
            let sight = view.needs_you();
            let sight = sight.iter().filter_map(|row| row["ask"].as_str());
            next.sight = sight.map(str::to_owned).collect();
            let open = table.open_asks(None);
            for handle in next.sight.iter().filter(|ask| !was.sight.contains(ask)) {
                let Some(ask) = open.iter().find(|ask| states::handle(ask) == *handle) else {
                    continue;
                };
                let looking = key && session.is_some_and(|s| ask["session"] == s.id.as_str());
                if looking || planted("announces-every-ask") {
                    opened.push(asking(ask, next.did.as_ref()));
                }
                if looking {
                    asked.push(handle.clone());
                }
            }
        }
        // The session on the open page: its state word, never what it is doing.
        let row = session.and_then(|s| table.row_of(&format!("session:{}", s.id)));
        let word = row.and_then(|row| row["word"].as_str()).map(str::to_owned);
        let doing = row.and_then(|row| row["doing"]["words"].as_str());
        // #3232's planted line starts with what the open page's session was last doing.
        let last = doing.filter(|_| planted("ask-line-starts-with-doing"));
        if let (Some(s), Some(doing)) = (session, last) {
            next.did = Some((s.id.clone(), doing.to_owned()));
        }
        if let (Some(row), Some(s), Some((address, before, did))) =
            (row, session, was.page.as_ref())
        {
            // An ask of its own opening is said as the ask.
            let asks =
                word.as_deref() == Some("needs you") && !table.open_asks(Some(&s.id)).is_empty(); // copy-exception: a state code
            if *address == s.to_string() && before.is_some() && *before != word && !asks {
                changes.push((change("state", state(row)), false));
            }
            let planted = planted("announces-doing-line") && *address == s.to_string();
            if let Some(doing) = doing.filter(|doing| planted && did.as_deref() != Some(doing)) {
                changes.push((change("doing", doing.to_owned()), true));
            }
        }
        (view.log_pos, word, doing.map(str::to_owned))
    });
    let Some((log_pos, word, doing)) = read else {
        return;
    };
    // The default's words are read from the record's history, once the reader is free again.
    changes.extend(defaults.iter().map(|ask| (defaulted(ask, now), false)));
    next.to = Some(log_pos);
    next.page = here.map(|address| (address.to_string(), word, doing));
    next.hub_down = crate::notify::reach().hub_down;
    if next.hub_down != was.hub_down {
        let words = if next.hub_down {
            "empties.hub_down"
        } else {
            "said.hub_back"
        };
        changes.push((change("hub", copy::text(words).to_owned()), false));
    }
    // #3232's planted receipt says each value its countdown shows, a second apart.
    if let Some((until, told)) = next
        .counting
        .filter(|_| planted("receipt-announces-each-second"))
    {
        let into = (now.saturating_sub(until.saturating_sub(crate::kinds::HOLD_MS)) / 1000).min(9);
        for second in told + 1..=into {
            let left = copy::count("question.starts_in", 10 - second, &[]);
            changes.push((change("counting", left), true));
        }
        next.counting = Some((until, into.max(told)));
    }
    if next == was && opened.is_empty() {
        return;
    }
    let first = was.to.is_none();
    let said = cx.default_global::<Said>();
    said.read = next;
    if first {
        return;
    }
    // An ask is said once, however many events open or show it.
    opened.retain(|ask| !said.told.contains(&ask.key));
    asked.retain(|ask| opened.iter().any(|new| new.key == *ask));
    said.asked.extend(asked);
    for ask in &opened {
        tell(&ask.key, cx);
    }
    changes.splice(0..0, opened.into_iter().map(|ask| (ask, false)));
    for (change, alone) in changes {
        say(change, alone, now, cx);
    }
}

/// The region: one node that draws nothing, marked polite, its value the last line and its rows the lines kept, each
/// named by its line with its clock time as its value. Nothing is in the tree until a line was said.
pub struct Region;

impl Render for Region {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut lines = lines(cx);
        let Some(last) = lines.first().map(|line| line.text.clone()) else {
            return Empty.into_any_element();
        };
        // #3232's planted window keeps only its last line.
        if planted("region-keeps-last-line") {
            lines.truncate(1);
        }
        let tall = crate::chrome::sizes().hairline;
        let rows = lines.into_iter().map(|line| {
            use chrono::TimeZone as _;
            let at = chrono::Local.timestamp_millis_opt(line.at as i64).single();
            let clock = at.map(|at| at.format("%H:%M").to_string());
            crate::views::observed(ElementId::Name(format!("said:{}", line.seq).into()))
                .role(Role::Label)
                .aria_label(line.text)
                .aria_value(clock.unwrap_or_default())
                .w(px(0.))
                .h(tall)
        });
        let region = crate::views::observed(REGION)
            .role(Role::Group)
            .aria_value(last)
            .absolute()
            .top_0()
            .left_0()
            .w(px(0.))
            .flex()
            .flex_col()
            .children(rows);
        Polite(region).into_any_element()
    }
}

/// `beside`, and the region after it: what the window's root draws over its views.
pub(crate) fn with(beside: impl IntoElement, cx: &mut App) -> [AnyElement; 2] {
    let view = match cx.try_global::<Said>().and_then(|said| said.view.clone()) {
        Some(view) => view,
        None => {
            let view = cx.new(|_| Region);
            cx.default_global::<Said>().view = Some(view.clone());
            view
        }
    };
    [beside.into_any_element(), view.into_any_element()]
}

/// An element as it is, and a polite live region to an assistive client: GPUI's elements have no such mark.
struct Polite<E>(E);

impl<E: Element> IntoElement for Polite<E> {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl<E: Element> Element for Polite<E> {
    type RequestLayoutState = E::RequestLayoutState;
    type PrepaintState = E::PrepaintState;

    fn id(&self) -> Option<ElementId> {
        self.0.id()
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        self.0.source_location()
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        self.0.request_layout(id, inspector, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.0.prepaint(id, inspector, bounds, layout, window, cx)
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.0
            .paint(id, inspector, bounds, layout, prepaint, window, cx)
    }

    fn a11y_role(&self) -> Option<Role> {
        self.0.a11y_role()
    }

    fn write_a11y_info(&self, node: &mut gpui_kit::accesskit::Node) {
        self.0.write_a11y_info(node);
        node.set_live(gpui_kit::accesskit::Live::Polite);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(key: &str, question: &str) -> Change {
        Change {
            ask: true,
            ..change(key, question.to_owned())
        }
    }

    fn texts(lines: &VecDeque<Entry>) -> Vec<(u64, &str)> {
        lines
            .iter()
            .map(|entry| (entry.line.at, entry.line.text.as_str()))
            .collect()
    }

    #[::core::prelude::v1::test]
    fn changes_within_two_seconds_are_one_line_with_their_count_and_a_later_one_its_own() {
        let (mut lines, mut seq) = (VecDeque::new(), 0);
        put(
            &mut lines,
            &mut seq,
            ask("ask:1", "First?"),
            false,
            1_000,
            1,
        );
        assert_eq!(
            texts(&lines),
            [(1_000, "needs you · 1 ask needs you · First? · ⌘J")]
        );
        // 300 ms later, and 300 ms after that: the same line, at its first time, with the count of its changes.
        put(
            &mut lines,
            &mut seq,
            ask("ask:2", "Second?"),
            false,
            1_300,
            2,
        );
        put(
            &mut lines,
            &mut seq,
            ask("ask:3", "Third?"),
            false,
            1_600,
            3,
        );
        let three = "needs you · 3 changes · 3 asks need you · First? · Second? · Third? · ⌘J";
        assert_eq!(texts(&lines), [(1_000, three)]);
        // The same change again takes its own place: no count grows.
        put(
            &mut lines,
            &mut seq,
            ask("ask:3", "Third?"),
            false,
            1_700,
            3,
        );
        assert_eq!(texts(&lines), [(1_000, three)]);
        // 2 s after the last change, the next is a line of its own, the newest.
        put(
            &mut lines,
            &mut seq,
            change("hub", "down".to_owned()),
            false,
            3_700,
            3,
        );
        assert_eq!(texts(&lines), [(3_700, "down"), (1_000, three)]);
        assert_eq!(seq, 2);
    }

    #[::core::prelude::v1::test]
    fn a_change_said_alone_joins_nothing_and_the_region_keeps_five_lines() {
        let (mut lines, mut seq) = (VecDeque::new(), 0);
        for n in 0..7 {
            put(
                &mut lines,
                &mut seq,
                change("doing", format!("step {n}")),
                true,
                1_000 + n,
                0,
            );
        }
        // A change that would join the newest line joins none said alone.
        put(
            &mut lines,
            &mut seq,
            change("hub", "down".to_owned()),
            false,
            1_010,
            0,
        );
        let kept: Vec<&str> = lines.iter().map(|entry| entry.line.text.as_str()).collect();
        assert_eq!(kept, ["down", "step 6", "step 5", "step 4", "step 3"]);
        assert_eq!(lines.front().map(|entry| entry.line.seq), Some(8));
    }

    #[::core::prelude::v1::test]
    fn a_line_with_no_ask_has_no_needs_you_and_no_key() {
        let (mut lines, mut seq) = (VecDeque::new(), 0);
        put(
            &mut lines,
            &mut seq,
            change("state", "Cart totals · sent back".to_owned()),
            false,
            0,
            2,
        );
        put(
            &mut lines,
            &mut seq,
            change("hub", "The hub isn't answering".to_owned()),
            false,
            10,
            2,
        );
        let two = "2 changes · Cart totals · sent back · The hub isn't answering";
        assert_eq!(texts(&lines), [(0, two)]);
    }
}
