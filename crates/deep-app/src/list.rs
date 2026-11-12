//! Issue #1461: the window's one list. First the heading Needs you with the one count and a row per open ask, oldest
//! first; then a heading per project with its sessions, quiet ones folded into one row per project. Two levels, one
//! row anatomy: mark, title, then the state word and a time at the right edge.
//!
//! [`build`] is the list as the record stands. [`Kept`] is the list as it's drawn, by the one rule for when rows
//! move: a new state shows in place at once, a row that left its state keeps its slot while you're in the list and
//! for 2 s after, a new row lands at once, and a row that just changed place takes no press.

use std::collections::{HashMap, HashSet};

use crate::address::{Address, Place};

/// How long a row that left its state keeps its slot once you've left the list, in ms.
pub const HOLD: u64 = 2_000;
/// How long after a row changes place a press on it is dropped, in ms.
pub const STILL: u64 = 300;

/// An open ask as the list reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Ask {
    /// Its handle, `ask:<ULID>`.
    pub handle: String,
    pub question: String,
    /// Its kind in a plain word, such as Approval or Pick one.
    pub kind: String,
    /// How it waits: `open`, `folded`, `later` or `held`.
    pub status: String,
    /// When its default applies, in ms.
    pub applies: Option<u64>,
}

/// A session as the list reads it: the hub's row (#1463).
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub project: Option<String>,
    /// The state word, and the status-map entry its mark draws.
    pub word: String,
    pub entry: &'static str,
    /// Since when it's been in its state, in ms.
    pub since: Option<u64>,
    pub unread: bool,
    /// Why it reads as it does, as the hub's row says it (#2018): whom it waits for and what it needs.
    pub why: String,
    /// What its turn is doing now, as the hub's row says it (#2021).
    pub doing: Option<Doing>,
    /// How many events its hooks have sent, and when the newest came (#2021).
    pub hooks: (u64, Option<u64>),
    /// Its one flag beside its word, as the hub's row carries it (#2019).
    pub flag: Option<Flag>,
}

/// A session row's flag (#2019): never a state, at most one, in the right slot beside its word.
#[derive(Clone, Debug, PartialEq)]
pub struct Flag {
    /// interrupted, retrying, repeating, watch-only or unpushed.
    pub code: String,
    /// The one line its slot shows, from record facts.
    pub text: String,
    /// What clears it, where something you can do does; empty otherwise.
    pub fix: String,
}

/// What a working session's turn is doing now (#2021): its latest tool event's words, when that event came, and
/// whether the step is over, so its time reads "2 min ago" rather than how long it has run.
#[derive(Clone, Debug, PartialEq)]
pub struct Doing {
    pub words: String,
    pub at: u64,
    pub ago: bool,
}

impl Doing {
    /// The line as every surface says it at `now`: "Running npm · 40 s", "Edited cart/total.ts · 2 min ago". It
    /// changes with its events and its time alone.
    pub fn line(&self, now: u64) -> String {
        let age = now.saturating_sub(self.at);
        crate::states::changes_after(crate::states::changes_in(age));
        let ago = if self.ago { " ago" } else { "" };
        format!("{} · {}{ago}", self.words, crate::states::span(age))
    }
}

/// What `session`'s turn is doing now, from its hub row `row` (#2021), with the planted wrong lines of #2021's suite in
/// a build with `env-plants`: none reads anything but the row's hook facts as shipped.
pub fn doing_of(
    view: &crate::record::View,
    row: &serde_json::Value,
    session: &str,
    now: u64,
) -> Option<Doing> {
    let given = &row["doing"];
    let mut doing = Doing {
        words: crate::question::visible(given["words"].as_str()?),
        at: given["at"].as_u64()?,
        ago: given["ago"].as_bool().unwrap_or(false),
    };
    let newest = |kind: &str| {
        view.events
            .iter()
            .rev()
            .find(|e| e["kind"] == kind && of_session(e, session))
    };
    if crate::plain::planted("line-reads-message") {
        if let Some(said) = newest("session.activity").and_then(|e| e["data"]["activity"].as_str())
        {
            doing.words = said.to_owned();
        }
    }
    if crate::plain::planted("line-keeps-running") {
        if let Some(object) = doing.words.strip_prefix("Couldn't run ") {
            (doing.words, doing.ago) = (format!("Running {object}"), false);
        }
    }
    if crate::plain::planted("line-whole-command") {
        if let Some(command) = newest("tool.before").and_then(|e| e["data"]["command"].as_str()) {
            doing.words = format!("Running {command}");
        }
    }
    if crate::plain::planted("line-stalls-on-timer") && stalled(view, session, now) {
        doing.words = "stalled".to_owned();
    }
    Some(doing)
}

/// #2021's planted timer: two minutes after a session's last event.
fn stalled(view: &crate::record::View, session: &str, now: u64) -> bool {
    view.table()
        .hooks(session)
        .1
        .is_some_and(|heard| now.saturating_sub(heard) >= 120_000)
}

/// Whether `event` is `session`'s: by its session, or by its subject's letters.
fn of_session(event: &serde_json::Value, session: &str) -> bool {
    event["session"] == session
        || event["subject"].as_str().is_some_and(|s| {
            s.trim_start_matches("session:")
                == session
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .collect::<String>()
        })
}

/// What a row's time slot shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Time {
    /// How long it's been in its state.
    Since(u64),
    /// When an ask's default applies.
    At(u64),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    /// Its id in the tree: an ask's handle, `session:<id>`, or `quiet:<project>`.
    pub id: String,
    pub address: Address,
    pub title: String,
    /// The word in the right slot, and the node's value: an ask's kind or how it waits, a session's state.
    pub word: String,
    pub value: String,
    /// The status-map entry its mark draws.
    pub entry: &'static str,
    pub time: Option<Time>,
    /// Unread or asking: its title is medium. Otherwise it's settled, regular in the secondary ink.
    pub loud: bool,
    /// It left its state and keeps its slot for now.
    pub left: bool,
    /// A session's why, as the hub's row says it (#2018); empty for any other row.
    pub why: String,
    /// What a working session's turn is doing now (#2021); none for any other row.
    pub doing: Option<Doing>,
    /// How many events a session's hooks have sent and when the newest came (#2021): its working mark's step, and its
    /// time under reduce motion.
    pub hooks: (u64, Option<u64>),
    /// A session's flag beside its word (#2019).
    pub flag: Option<Flag>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Item {
    /// A heading: Needs you, with the one count, or a project.
    Heading {
        id: String,
        title: String,
        count: Option<usize>,
    },
    Row(Row),
}

impl Item {
    pub fn id(&self) -> &str {
        match self {
            Item::Heading { id, .. } => id,
            Item::Row(row) => &row.id,
        }
    }

    /// Its height in the list, in steps of the look's space: a heading has 8 above it.
    pub fn tall(&self, row: f32, above: f32) -> f32 {
        match self {
            Item::Heading { .. } => row + above,
            Item::Row(_) => row,
        }
    }
}

/// The heading Needs you's id; a project's is `heading:<project>`.
pub const HEADING: &str = "heading:needs-you";
/// What a project with no name is listed under.
pub const NO_PROJECT: &str = "No project";

/// A project's id in an address: its name, with anything an address can't hold made a dash.
pub fn project_id(project: Option<&str>) -> String {
    let name = project.unwrap_or("none");
    let id: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '-'
            }
        })
        .collect();
    if id.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        id
    } else {
        format!("p{id}")
    }
}

/// The list as the record stands: Needs you and its asks, oldest first as given, then each project by name, its
/// sessions in the hub's order with the quiet ones folded into one row. With no ask and no session it's empty.
pub fn build(asks: &[Ask], sessions: &[Session]) -> Vec<Item> {
    let mut items = Vec::new();
    if asks.is_empty() && sessions.is_empty() {
        return items;
    }
    items.push(Item::Heading {
        id: HEADING.to_owned(),
        title: "Needs you".to_owned(),
        count: Some(asks.len()),
    });
    for ask in asks {
        let waits = match ask.status.as_str() {
            // #1461's planted list tells them apart by ink alone, as the base drew them.
            _ if crate::plain::planted("wait-by-ink") => None,
            "folded" => Some("folded"),
            "later" => Some("set for later"),
            "held" => Some("held"),
            _ => None,
        };
        // #1461's planted list draws every ask's word alike.
        let kind = if crate::plain::planted("ask-words-alike") {
            "needs you".to_owned()
        } else {
            ask.kind.clone()
        };
        items.push(Item::Row(Row {
            id: ask.handle.clone(),
            address: Address::ask(&ask.handle),
            title: ask.question.clone(),
            word: waits.map_or(kind, str::to_owned),
            value: waits
                .map_or("needs_you", |_| ask.status.as_str())
                .to_owned(),
            entry: "needs_you",
            time: ask.applies.map(Time::At),
            loud: waits.is_none()
                && ask.status != "folded"
                && ask.status != "later"
                && ask.status != "held",
            left: false,
            why: String::new(),
            doing: None,
            hooks: (0, None),
            flag: None,
        }));
    }
    let mut projects: Vec<Option<&str>> = Vec::new();
    for s in sessions {
        if !projects.contains(&s.project.as_deref()) {
            projects.push(s.project.as_deref());
        }
    }
    // By name, the unnamed last, so a heading never moves because a state changed.
    projects.sort_by_key(|p| (p.is_none(), p.map(str::to_lowercase)));
    for project in projects {
        let id = project_id(project);
        items.push(Item::Heading {
            id: format!("heading:{}", project.unwrap_or("none")),
            title: project.unwrap_or(NO_PROJECT).to_owned(),
            count: None,
        });
        let mine = sessions.iter().filter(|s| s.project.as_deref() == project);
        let (quiet, awake): (Vec<&Session>, Vec<&Session>) = mine.partition(|s| s.word == "quiet");
        for s in awake {
            items.push(Item::Row(Row {
                id: format!("session:{}", s.id),
                address: Address::session(&s.id),
                title: s.title.clone(),
                word: s.word.clone(),
                value: s.entry.to_owned(),
                entry: s.entry,
                time: s.since.map(Time::Since),
                loud: s.unread || s.entry == "needs_you",
                left: false,
                why: s.why.clone(),
                doing: s.doing.clone(),
                hooks: s.hooks,
                flag: s.flag.clone(),
            }));
        }
        if !quiet.is_empty() {
            let last = quiet.iter().filter_map(|s| s.since).max();
            items.push(Item::Row(Row {
                id: format!("quiet:{id}"),
                address: Address::new(Place::Project, &id),
                title: match quiet.len() {
                    1 => "1 quiet session".to_owned(),
                    n => format!("{n} quiet sessions"),
                },
                word: "quiet".to_owned(),
                value: "idle".to_owned(),
                entry: "idle",
                time: last.map(Time::Since),
                loud: quiet.iter().any(|s| s.unread),
                left: false,
                why: String::new(),
                doing: None,
                hooks: (0, None),
                flag: None,
            }));
        }
    }
    items
}

/// What the window opens on: the first open ask, else the project whose sessions changed last.
pub fn opens_on(asks: &[Ask], sessions: &[Session]) -> Option<Address> {
    if let Some(ask) = asks.first() {
        return Some(Address::ask(&ask.handle));
    }
    sessions
        .iter()
        .max_by_key(|s| s.since.unwrap_or(0))
        .map(|s| Address::new(Place::Project, &project_id(s.project.as_deref())))
}

thread_local! {
    /// The last reading of the record, by its `log_pos`, the second it was read at and whether the record before the
    /// reads was folded (#2026): a frame reads it once.
    #[allow(clippy::type_complexity)]
    static READ: std::cell::RefCell<Option<((u64, u64, bool), std::rc::Rc<(Vec<Ask>, Vec<Session>)>)>> =
        const { std::cell::RefCell::new(None) };
}

/// The asks and sessions the list reads from the one record reader at `now` (#1461), read once per change of the
/// record and second, so a frame over 700 rows costs what it draws. Empty with no record.
pub fn read_now(now: u64) -> std::rc::Rc<(Vec<Ask>, Vec<Session>)> {
    let folded = crate::record::folded();
    crate::record::with_view(|view| {
        let key = (view.log_pos, now / 1000, folded);
        READ.with(|cell| {
            let mut cell = cell.borrow_mut();
            match cell.as_ref() {
                Some((at, read)) if *at == key => read.clone(),
                _ => {
                    let fresh = std::rc::Rc::new(read(view, now));
                    *cell = Some((key, fresh.clone()));
                    fresh
                }
            }
        })
    })
    .unwrap_or_default()
}

/// How many of the list's rows are unread: what #2028's planted counts add to the asks.
pub fn unread_rows() -> usize {
    crate::record::with_view(|view| {
        view.table()
            .list()
            .into_iter()
            .filter(|row| row["unread"].as_bool() == Some(true))
            .count()
    })
    .unwrap_or(0)
}

/// The asks and sessions the list reads from `view` at `now`: the hub's rows (#1463) where the record holds them, else
/// the app's own reading of a record from before them.
pub fn read(view: &crate::record::View, now: u64) -> (Vec<Ask>, Vec<Session>) {
    use serde_json::Value;
    let table = view.table();
    let text = |row: &Value, key: &str| row[key].as_str().unwrap_or_default().to_owned();
    let created: HashMap<String, &Value> = table
        .open_asks(None)
        .into_iter()
        .map(|ask| (crate::states::handle(ask), ask))
        .collect();
    let held = crate::held();
    let status = |handle: &str| {
        if held.as_deref() == Some(handle) {
            return "held".to_owned();
        }
        let row = view.inbox.iter().find(|ask| ask["ask"] == handle);
        let status = row
            .and_then(|ask| ask["status"].as_str())
            .unwrap_or("open")
            .to_owned();
        // Put off with Later, an ask waits until an hour before its default applies (#1462), then shows again.
        match row.and_then(|ask| ask["until"].as_u64()) {
            Some(until) if status == "later" && until <= now => "shown".to_owned(),
            Some(until) if status == "later" => {
                crate::states::changes_after(until - now);
                status
            }
            _ => status,
        }
    };
    let ask = |handle: String, question: &str| {
        let made = created.get(&handle);
        Ask {
            kind: made.map_or_else(String::new, |a| crate::kinds::Kind::of(a).plain()),
            applies: made.and_then(|a| table.deadline(a)),
            status: status(&handle),
            question: crate::question::visible(question),
            handle,
        }
    };
    if table.listed() {
        let rows = table.list();
        let mut asks: Vec<Ask> = rows
            .iter()
            .filter(|row| text(row, "id").starts_with("ask:"))
            .map(|row| ask(text(row, "id"), &text(row, "title")))
            .collect();
        // An ask put off with Later goes below the others until it comes back (#1462).
        asks.sort_by_key(|ask| ask.status == "later");
        // A running job's row (#1925) is drawn under the sessions, not as one.
        let sessions = rows
            .iter()
            .filter(|row| text(row, "id").starts_with("session:"))
            .map(|row| {
                let session = text(row, "session");
                // #2028's planted app marks every row whose state changed in the last day, read or not.
                let whole_day = crate::plain::planted("marks-whole-day")
                    && row["since"]
                        .as_u64()
                        .is_some_and(|since| now.saturating_sub(since) < 86_400_000);
                // #1461's planted app marks a session unread when its agent says anything.
                let spoke = crate::plain::planted("unread-on-message")
                    && view.events.iter().any(|e| {
                        e["kind"] == "session.activity"
                            && e["subject"].as_str().is_some_and(|s| {
                                s.trim_start_matches("session:")
                                    == session
                                        .chars()
                                        .filter(char::is_ascii_alphanumeric)
                                        .collect::<String>()
                            })
                    });
                let mut word = text(row, "word");
                let mut entry = crate::states::entry_of(row["entry"].as_str().unwrap_or_default());
                // The planted app reads a session waiting on you as working, in a build with the env-plants feature only.
                if crate::plain::planted("waiting-as-working") && word == "needs you" {
                    (word, entry) = ("working".to_owned(), "running");
                }
                // #2021's planted row says stalled two minutes after its session's last event.
                if crate::plain::planted("line-stalls-on-timer") && stalled(view, &session, now) {
                    word = "stalled".to_owned();
                }
                Session {
                    doing: doing_of(view, row, &session, now),
                    hooks: table.hooks(&session),
                    id: text(row, "session"),
                    title: crate::question::visible(&text(row, "title")),
                    project: row["project"].as_str().map(str::to_owned),
                    word,
                    entry,
                    since: row["since"].as_u64(),
                    unread: row["unread"].as_bool().unwrap_or(false) || spoke || whole_day,
                    why: crate::question::visible(&text(row, "why")),
                    flag: row["flag"]["code"].as_str().map(|code| Flag {
                        code: code.to_owned(),
                        text: crate::question::visible(&text(&row["flag"], "text")),
                        fix: crate::question::visible(&text(&row["flag"], "fix")),
                    }),
                }
            })
            .collect();
        return (asks, sessions);
    }
    let mut asks: Vec<Ask> = view
        .inbox
        .iter()
        .filter(|row| row["status"] != "closed")
        .map(|row| ask(text(row, "ask"), &text(row, "question")))
        .collect();
    asks.sort_by_key(|ask| ask.status == "later");
    let sessions = table
        .every_session()
        .into_iter()
        .map(|(id, title, _)| {
            let (word, entry) = table.row(&id, now);
            Session {
                hooks: table.hooks(&id),
                id,
                title,
                project: None,
                word,
                entry,
                since: None,
                unread: false,
                why: String::new(),
                doing: None,
                flag: None,
            }
        })
        .collect();
    (asks, sessions)
}

/// The list as it's drawn, and what the one rule for when rows move remembers.
#[derive(Clone, Debug, Default)]
pub struct Kept {
    drawn: Vec<Item>,
    /// When each row that left its state left, by id.
    left_at: HashMap<String, u64>,
    /// When each row last changed place, by id.
    moved_at: HashMap<String, u64>,
    /// Until when you were in the list: the pointer over it or focus in it.
    attended_until: Option<u64>,
}

impl Kept {
    /// Lets a row that left its state go at once, its slot with it: the row the list's keyboard is on, which the
    /// keyboard leaves for the row now in its place (#1462).
    pub fn release(&mut self, id: &str) {
        self.drawn.retain(|item| item.id() != id);
        self.left_at.remove(id);
    }

    /// The list as drawn after the record gave `fresh` at `now`, with `attended` saying whether you're in the list.
    pub fn settle(&mut self, fresh: Vec<Item>, attended: bool, now: u64) -> &[Item] {
        // #1461's planted list closes a gap at once, under a resting pointer or not.
        if crate::plain::planted("list-closes-gap") {
            self.drawn = fresh;
            return &self.drawn;
        }
        if attended {
            self.attended_until = Some(now);
        }
        let fresh_ids: HashSet<&str> = fresh.iter().map(Item::id).collect();
        for item in &self.drawn {
            if !fresh_ids.contains(item.id()) {
                self.left_at.entry(item.id().to_owned()).or_insert(now);
            }
        }
        self.left_at
            .retain(|id, _| !fresh_ids.contains(id.as_str()));
        let away_since = if attended {
            None
        } else {
            Some(self.attended_until.unwrap_or(0))
        };
        // Each row that left stays until 2 s after both it left and you left the list.
        let due = |left: u64| away_since.is_some_and(|away| now >= left.max(away) + HOLD);
        self.left_at.retain(|_, left| !due(*left));
        let next = if self.left_at.is_empty()
            && !attended
            && away_since.is_some_and(|a| now >= a + HOLD)
        {
            fresh
        } else if self.drawn.is_empty() {
            fresh
        } else {
            self.frozen(fresh)
        };
        let before = offsets(&self.drawn);
        let after = offsets(&next);
        for (id, at) in &after {
            if before.get(id).is_some_and(|was| was != at) {
                self.moved_at.insert(id.clone(), now);
            }
        }
        self.moved_at.retain(|_, at| now < *at + STILL);
        self.drawn = next;
        &self.drawn
    }

    /// The drawn order kept: each row still listed updated in place, each that left kept and drawn as left, and
    /// each new one added after the row it follows in `fresh`.
    fn frozen(&self, fresh: Vec<Item>) -> Vec<Item> {
        let fresh_at: HashMap<String, usize> = fresh
            .iter()
            .enumerate()
            .map(|(i, item)| (item.id().to_owned(), i))
            .collect();
        let mut next: Vec<Item> = self
            .drawn
            .iter()
            .filter_map(|item| match fresh_at.get(item.id()) {
                Some(&i) => Some(fresh[i].clone()),
                None if self.left_at.contains_key(item.id()) => {
                    let mut kept = item.clone();
                    if let Item::Row(row) = &mut kept {
                        row.left = true;
                        row.loud = false;
                        // An ask's row that left is drawn answered, in its slot, until it goes.
                        if row.id.starts_with("ask:") {
                            row.word = "answered".to_owned();
                            row.value = "answered".to_owned();
                        }
                    }
                    Some(kept)
                }
                None => None,
            })
            .collect();
        let mut held: HashSet<String> = next.iter().map(|n| n.id().to_owned()).collect();
        for (i, item) in fresh.iter().enumerate() {
            if held.contains(item.id()) {
                continue;
            }
            held.insert(item.id().to_owned());
            let after = fresh[..i]
                .iter()
                .rev()
                .find_map(|prev| next.iter().position(|n| n.id() == prev.id()));
            let at = after.map_or(0, |p| {
                // After the row it follows and any rows that left kept under that one.
                let mut at = p + 1;
                while next
                    .get(at)
                    .is_some_and(|n| matches!(n, Item::Row(r) if r.left))
                {
                    at += 1;
                }
                at
            });
            next.insert(at, item.clone());
        }
        next
    }

    pub fn drawn(&self) -> &[Item] {
        &self.drawn
    }

    /// Whether a press on `id` at `t` counts: never within [`STILL`] of the row changing place, so a press meant for
    /// another row is dropped, not passed to the one now under the pointer.
    pub fn takes_press(&self, id: &str, t: u64) -> bool {
        // #1461's planted lists: one that passes every press through, one that drops every press.
        if crate::plain::planted("press-through-move") {
            return true;
        }
        if crate::plain::planted("list-drops-presses") {
            return false;
        }
        self.moved_at.get(id).is_none_or(|at| t >= at + STILL)
    }

    /// When the drawn list next changes with no new record: when a row that left may go, or a moved row takes a
    /// press again.
    pub fn next_change(&self, now: u64) -> Option<u64> {
        let away = self.attended_until.unwrap_or(0);
        let leaving = self.left_at.values().map(|left| (*left).max(away) + HOLD);
        let still = self.moved_at.values().map(|at| at + STILL);
        leaving.chain(still).filter(|t| *t > now).min()
    }
}

/// Each item's top in the list, in item heights (a heading counts two rows' worth of steps), by id.
fn offsets(items: &[Item]) -> HashMap<String, u32> {
    let mut top = 0;
    items
        .iter()
        .map(|item| {
            let at = top;
            top += match item {
                Item::Heading { .. } => 5,
                Item::Row(_) => 4,
            };
            (item.id().to_owned(), at)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(n: u8) -> Ask {
        Ask {
            handle: format!("ask:01ASK{n:021}"),
            question: format!("Question {n}?"),
            kind: "Approval".into(),
            status: "open".into(),
            applies: Some(1_000),
        }
    }

    fn session(id: &str, project: Option<&str>, word: &str) -> Session {
        Session {
            id: id.into(),
            title: format!("Task {id}"),
            project: project.map(str::to_owned),
            word: word.into(),
            entry: if word == "quiet" { "idle" } else { "running" },
            since: Some(10),
            unread: false,
            why: String::new(),
            doing: None,
            hooks: (0, None),
            flag: None,
        }
    }

    fn ids(items: &[Item]) -> Vec<&str> {
        items.iter().map(Item::id).collect()
    }

    #[test]
    fn needs_you_comes_first_then_each_project_with_its_quiet_sessions_folded() {
        let items = build(
            &[ask(1), ask(2)],
            &[
                session("a", Some("shop"), "working"),
                session("b", Some("api"), "quiet"),
                session("c", Some("shop"), "quiet"),
                session("d", Some("shop"), "quiet"),
                session("e", None, "working"),
            ],
        );
        assert_eq!(
            ids(&items),
            [
                "heading:needs-you",
                "ask:01ASK000000000000000000001",
                "ask:01ASK000000000000000000002",
                "heading:api",
                "quiet:api",
                "heading:shop",
                "session:a",
                "quiet:shop",
                "heading:none",
                "session:e",
            ]
        );
        assert!(matches!(&items[0], Item::Heading { count: Some(2), .. }));
        let Item::Row(folded) = &items[7] else {
            panic!()
        };
        assert_eq!(folded.title, "2 quiet sessions");
        assert_eq!(folded.address.to_string(), "project/shop");
    }

    #[test]
    fn an_ask_row_says_its_kind_or_how_it_waits_in_its_word_and_value() {
        let mut later = ask(2);
        later.status = "later".into();
        let mut held = ask(3);
        held.status = "held".into();
        held.kind = "Pick one".into();
        let items = build(&[ask(1), later, held], &[]);
        let rows: Vec<(&str, &str, bool)> = items
            .iter()
            .filter_map(|i| match i {
                Item::Row(r) => Some((r.word.as_str(), r.value.as_str(), r.loud)),
                _ => None,
            })
            .collect();
        assert_eq!(
            rows,
            [
                ("Approval", "needs_you", true),
                ("set for later", "later", false),
                ("held", "held", false)
            ]
        );
    }

    #[test]
    fn an_empty_record_lists_nothing_and_with_no_ask_the_window_opens_on_the_latest_project() {
        assert!(build(&[], &[]).is_empty());
        let mut late = session("b", Some("api"), "working");
        late.since = Some(99);
        let sessions = [session("a", Some("shop"), "working"), late];
        assert_eq!(opens_on(&[], &sessions).unwrap().to_string(), "project/api");
        assert_eq!(
            opens_on(&[ask(1)], &sessions).unwrap().to_string(),
            "ask/01ASK000000000000000000001"
        );
        let items = build(&[], &sessions);
        assert!(matches!(&items[0], Item::Heading { count: Some(0), .. }));
        assert_eq!(
            items
                .iter()
                .filter(|i| matches!(i, Item::Row(r) if r.id.starts_with("ask:")))
                .count(),
            0
        );
    }

    #[test]
    fn an_answered_ask_keeps_its_slot_while_you_are_in_the_list_and_for_2_s_after() {
        let sessions = [session("a", Some("shop"), "working")];
        let mut kept = Kept::default();
        kept.settle(build(&[ask(1), ask(2)], &sessions), true, 0);
        let before = offsets(kept.drawn());
        // The first ask is answered while the pointer rests in the list: nothing moves.
        let drawn = kept
            .settle(build(&[ask(2)], &sessions), true, 1_000)
            .to_vec();
        assert_eq!(offsets(&drawn), before, "no row moves");
        assert!(
            matches!(&drawn[1], Item::Row(r) if r.left),
            "drawn answered"
        );
        assert!(
            matches!(&drawn[0], Item::Heading { count: Some(1), .. }),
            "the count drops at once"
        );
        // You leave the list at 5 s; the row stays until 7 s.
        kept.settle(build(&[ask(2)], &sessions), true, 5_000);
        kept.settle(build(&[ask(2)], &sessions), false, 6_999);
        assert_eq!(kept.drawn().len(), 5);
        assert_eq!(kept.next_change(6_999), Some(7_000));
        kept.settle(build(&[ask(2)], &sessions), false, 7_000);
        assert_eq!(kept.drawn().len(), 4);
    }

    #[test]
    fn a_row_answered_elsewhere_waits_2_s_and_a_new_ask_lands_at_once() {
        let sessions = [session("a", Some("shop"), "working")];
        let mut kept = Kept::default();
        kept.settle(build(&[ask(1)], &sessions), false, 0);
        kept.settle(build(&[], &sessions), false, 10_000);
        assert!(
            kept.drawn().iter().any(|i| i.id().starts_with("ask:")),
            "waits"
        );
        kept.settle(build(&[], &sessions), false, 11_999);
        assert!(kept.drawn().iter().any(|i| i.id().starts_with("ask:")));
        kept.settle(build(&[], &sessions), false, 12_000);
        assert!(
            !kept.drawn().iter().any(|i| i.id().starts_with("ask:")),
            "gone at 2 s"
        );
        // A new ask arrives under a resting pointer: it's there at once, under the others.
        kept.settle(build(&[ask(1)], &sessions), true, 20_000);
        kept.settle(build(&[ask(1), ask(2)], &sessions), true, 21_000);
        assert_eq!(kept.drawn()[2].id(), "ask:01ASK000000000000000000002");
    }

    #[test]
    fn a_row_that_just_moved_drops_a_press_for_300_ms() {
        let sessions = [
            session("a", Some("shop"), "working"),
            session("b", Some("shop"), "working"),
            session("c", Some("shop"), "working"),
        ];
        let mut kept = Kept::default();
        kept.settle(build(&[], &sessions), true, 0);
        assert!(kept.takes_press("session:c", 0));
        kept.settle(build(&[ask(1)], &sessions), true, 1_000);
        assert!(
            !kept.takes_press("session:c", 1_100),
            "it slid under the pointer"
        );
        assert!(kept.takes_press("session:c", 1_400));
        assert!(
            kept.takes_press("heading:needs-you", 1_100),
            "the heading didn't move"
        );
    }

    #[test]
    fn a_state_that_changes_shows_in_place_at_once() {
        let mut kept = Kept::default();
        kept.settle(
            build(&[], &[session("a", Some("shop"), "working")]),
            true,
            0,
        );
        let mut done = session("a", Some("shop"), "finished");
        done.entry = "idle";
        kept.settle(build(&[], &[done]), true, 10);
        assert!(matches!(&kept.drawn()[2], Item::Row(r) if r.word == "finished"));
    }
}
