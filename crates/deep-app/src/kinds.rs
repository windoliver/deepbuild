//! Issue #327: what the question card shows for one ask, by its kind, read from the record alone. Seven card
//! kinds: a batched authority (its plan's steps, the diff, whether the target is public, whether each step can be
//! undone, default no), a taste call (the reference, a sheet of options, your past calls
//! on the same screen and journey step from the decisions table), a step only you can take (proven by a check),
//! a stalled claim (split, fund or accept, with costs), a choice, an exception (what it would waive or change,
//! default no change) and an early question about what done means (default: leave the requirement out). Every
//! card shows its question, every option's label, its deadline, its default and when it applies.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{copy, states};

/// The seven card kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    BatchedAuthority,
    Taste,
    Unblock,
    StalledClaim,
    Choice,
    Exception,
    Definition,
}

impl Kind {
    /// The kind's name as its usage rows write it: a code, drawn only by a planted card.
    pub fn name(self) -> &'static str {
        match self {
            Kind::BatchedAuthority => "batched authority", // copy-exception: a kind's code
            Kind::Taste => "taste",
            Kind::Unblock => "unblock",
            Kind::StalledClaim => "stalled claim", // copy-exception: a kind's code
            Kind::Choice => "choice",
            Kind::Exception => "exception",
            Kind::Definition => "early question about done", // copy-exception: a kind's code
        }
    }

    /// The card's first line (#1455) in the language shown (#2403): in English the kind's plain word from
    /// contracts/plain-words.json (#1348), capitalised, never the name the usage rows keep.
    pub fn plain(self) -> String {
        copy::text(self.plain_key()).to_owned()
    }

    fn plain_key(self) -> &'static str {
        match self {
            Kind::BatchedAuthority => "kinds.plain_batched_authority",
            Kind::Taste => "kinds.plain_taste",
            Kind::Unblock => "kinds.plain_unblock",
            Kind::StalledClaim => "kinds.plain_stalled_claim",
            Kind::Choice => "kinds.plain_choice",
            Kind::Exception => "kinds.plain_exception",
            Kind::Definition => "kinds.plain_definition",
        }
    }

    /// The card kind of an ask: its `data.kind`, with a choice about a stalled claim (split, fund or accept) its
    /// own card and every authority ask a batched one, since a batch of one is a batch.
    pub fn of(ask: &Value) -> Kind {
        let options = ask["data"]["options"].as_array();
        let has = |id: &str| {
            options.is_some_and(|options| options.iter().any(|option| option["id"] == id))
        };
        match ask["data"]["kind"].as_str().unwrap_or_default() {
            "authority" => Kind::BatchedAuthority,
            "taste" => Kind::Taste,
            "unblock" => Kind::Unblock,
            "choice" if has("split") && has("fund") && has("accept") => Kind::StalledClaim,
            "choice" => Kind::Choice,
            "exception" => Kind::Exception,
            _ => Kind::Definition,
        }
    }
}

/// One option as the card draws it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub id: String,
    pub label: String,
    /// `allow | deny | none`, which the shell copies into the answer.
    pub decision: String,
    pub recommended: bool,
    /// The option's cost, where the ask names one for it.
    pub cost: Option<String>,
}

/// One step of a batched approval's plan, with its switch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    /// The batch member whose plan the step is from, by index in the batch.
    pub member: usize,
    pub does: String,
    pub public: bool,
    pub undoable: bool,
    /// Whether the approval runs it. The core runs or skips a whole member, so a step is on with its member: on
    /// once all the member's steps can be undone or you switch it on.
    pub on: bool,
}

/// A past call of yours on the same screen and journey step, from the decisions table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PastCall {
    /// The answer's label on that call's card (its ID where the call no longer names it).
    pub answer: String,
    pub question: String,
}

/// What an answer that will be saved as a decision says before the card arms: the scope in words and how many
/// open asks it also answers, both fixed when the card is presented.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scope {
    pub words: String,
    pub also: usize,
}

/// What Send back does to a call's change (#1345): reverts it when it landed, else starts another attempt. Each is
/// its key in the app's table (#2403).
pub const REVERTS: &str = "kinds.reverts";
pub const ATTEMPTS: &str = "kinds.attempts";

/// One row of the batched taste card (#1345, #2030): a taste ask shown in the batch, what its Send back does here,
/// and when its recommended answer applies.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallRow {
    pub ask: String,
    pub question: String,
    /// The recommended option's label, and Send back's.
    pub yes: String,
    pub back: String,
    /// [`REVERTS`] or [`ATTEMPTS`]: the key of its words.
    pub sends: &'static str,
    pub applies: String,
    /// The pictures its evidence lists (#3234), which its row arms on.
    pub pictures: Vec<crate::pictures::Listed>,
}
/// What proves an agent's sign-in task (#1349), after the agent's id: its own sign-in probe, as the asks core names it.
const SIGN_IN_PROBE: &str = " sign-in probe"; // copy-exception: a check's name, matched

/// The card's content for one ask.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Model {
    pub ask: String,
    pub kind: Kind,
    /// The ask's own `kind` as the record writes it (`authority`, `taste`, …): what usage rows carry.
    pub data_kind: String,
    /// The option IDs in the record's order, which the card never answers by.
    pub record_order: Vec<String>,
    /// The asks of the batch this ask showed in, in batch order, each with its plan's hash; the ask alone outside one.
    pub batch: Vec<(String, Option<String>)>,
    pub question: String,
    /// The recommended option first, then the rest in the ask's order.
    pub options: Vec<Choice>,
    /// The default's label, and when it applies.
    pub default: String,
    pub applies: String,
    /// The kind's own fields, named, in the order the card draws them.
    pub fields: Vec<(String, String)>,
    pub steps: Vec<Step>,
    /// The ask's own member in the batch, by index. The core can't approve the ask without it, so while it is
    /// off the card holds the approval back.
    pub own_member: usize,
    /// The plan's digest an authority ask binds, if one was proposed.
    pub plan_hash: Option<String>,
    pub past: Vec<PastCall>,
    pub scope: Option<Scope>,
    /// On a taste ask shown with other taste asks, every one of them still open, in batch order: a row each (#1345).
    pub calls: Vec<CallRow>,
    /// On an agent's sign-in task (#1349): its steps, the plan line among them, under its one button.
    pub sign_in: Option<Vec<String>>,
    /// On an agent's sign-in task (#1349): its maker's price page, from the app's own facts, which the plan line opens.
    pub price_page: Option<String>,
    /// On a taste call (#3234): the pictures its evidence lists by hash, which its accepting option arms on.
    pub pictures: Vec<crate::pictures::Listed>,
}

/// Whether a plan step can be undone: its `undo` names how, unless it says it can't.
pub fn undoable(step: &Value) -> bool {
    let undo = step["undo"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    !(undo.is_empty()
        || undo == "none"
        || undo == "no"
        || undo.starts_with("can't")
        || undo.starts_with("cannot")
        || undo.starts_with("not ")
        || undo.starts_with("irreversible"))
}

/// How long an approved step that can't be undone waits before it starts (#1101): the hub keeps the hold, and the
/// card's receipt counts it down with Undo.
pub const HOLD_MS: u64 = 10_000;

/// Where the hub's hold of your answered yes to a step that can't be undone stands for `handle`, as the core recorded
/// it (#1101).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    /// Held: its steps start at this time, in ms since the epoch.
    Waiting(u64),
    /// The hold ran out and its steps started: they can't be taken back.
    Ran,
    /// Withdrawn before its steps started, by Undo or the hub starting again during it: the ask is open again.
    Withdrawn,
}

/// The newest hold the core recorded on `handle`, and how it ended; `None` for an ask no yes of yours held.
pub fn hold(events: &[Value], handle: &str) -> Option<Hold> {
    let mut hold = None;
    for event in events {
        if event["subject"] != handle || event["writer"] != "core" {
            continue;
        }
        hold = match (event["kind"].as_str(), hold) {
            (Some("approval.held"), _) => event["data"]["until"].as_u64().map(Hold::Waiting),
            (Some("approval.started"), Some(Hold::Waiting(_))) => Some(Hold::Ran),
            (Some("approval.withdrawn"), Some(Hold::Waiting(_))) => Some(Hold::Withdrawn),
            (_, hold) => hold,
        };
    }
    hold
}

/// The ask.created event of `handle`.
pub fn find<'a>(events: &'a [Value], handle: &str) -> Option<&'a Value> {
    events
        .iter()
        .find(|event| event["kind"] == "ask.created" && states::handle(event) == handle)
}

/// The asks shown together with `handle` in a batch of several, in batch order: the latest `ask.batched` the core
/// wrote listing it, the one whose order an approval's `steps` index (an agent's batch is never one).
pub(crate) fn batch_of(events: &[Value], handle: &str) -> Vec<String> {
    events
        .iter()
        .rev()
        .filter(|event| event["kind"] == "ask.batched" && event["writer"] == "core")
        .map(|event| {
            event["data"]["asks"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item["ask"].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .find(|asks| asks.len() > 1 && asks.iter().any(|ask| ask == handle))
        .unwrap_or_default()
}

/// Whether a card field is the moved pin's or the checks on its new commit, as the language shown names them (#2403):
/// what the planted card that shows the diff only once answered leaves off.
pub(crate) fn is_moved(name: &str) -> bool {
    let checks_on = copy::text("kinds.field_checks_on");
    let (before, after) = checks_on.split_once("{0}").unwrap_or((checks_on, ""));
    name == copy::text("kinds.field_moved")
        || (name.len() > before.len() + after.len()
            && name.starts_with(before)
            && name.ends_with(after))
}

/// The plan the ask shows, as the core binds it: the first one the core proposed for the ask. A later proposal, or
/// one from another writer, is never what an approval runs, so the card never shows it.
fn plan<'a>(events: &'a [Value], handle: &str) -> Option<&'a Value> {
    events.iter().find(|event| {
        event["kind"] == "plan.proposed"
            && event["writer"] == "core"
            && event["data"]["ask"] == handle
    })
}

fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn usd(value: &Value) -> Option<String> {
    value.as_f64().map(|cost| format!("${cost:.2}"))
}

impl Model {
    /// The card for `handle` as the record stands, at `now`.
    pub fn read(events: &[Value], handle: &str, now: u64) -> Option<Model> {
        let ask = find(events, handle)?;
        let data = &ask["data"];
        let kind = Kind::of(ask);
        let recommended = data["recommended"].as_str();
        let costs = &data["costs"];
        let mut options: Vec<Choice> = data["options"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|option| {
                let id = text(&option["id"]);
                Choice {
                    cost: usd(&costs[&id]).or_else(|| usd(&option["cost_usd"])),
                    recommended: recommended == Some(id.as_str()),
                    label: text(&option["label"]),
                    decision: text(&option["decision"]),
                    id,
                }
            })
            .collect();
        if let Some(first) = options.iter().position(|option| option.recommended) {
            let recommended = options.remove(first);
            options.insert(0, recommended);
        }
        let default_id = text(&data["default"]);
        let default = options
            .iter()
            .find(|option| option.id == default_id)
            .map_or_else(
                || default_words(kind, &default_id),
                |option| option.label.clone(),
            );
        let deadline = states::deadline(events, ask).unwrap_or(now);
        let applies = states::moment(deadline, now);
        let mut fields = Vec::new();
        let mut steps = Vec::new();
        let mut plan_hash = None;
        let mut own_member = 0;
        let mut batch = Vec::new();
        let field = |fields: &mut Vec<(String, String)>, name: &'static str, value: &Value| {
            if !value.is_null() {
                fields.push((copy::text(name).to_owned(), text(value)));
            }
        };
        match kind {
            Kind::BatchedAuthority => {
                let subject = &data["subject"];
                field(&mut fields, "kinds.field_effect", &subject["effect"]);
                field(&mut fields, "kinds.field_target", &subject["target"]["ref"]);
                // A batch of several shows every member's plan, one step each, in batch order; the ask's own
                // plan alone outside one. A batch of one is a batch.
                let members = batch_of(events, handle);
                let members: Vec<&str> = if members.is_empty() {
                    vec![handle]
                } else {
                    members.iter().map(String::as_str).collect()
                };
                let mut diffs: Vec<String> = Vec::new();
                for (index, member) in members.into_iter().enumerate() {
                    let plan = plan(events, member);
                    let hash =
                        plan.and_then(|plan| plan["data"]["hash"].as_str().map(str::to_owned));
                    if member == handle {
                        plan_hash = hash.clone();
                        own_member = index;
                    }
                    batch.push((member.to_owned(), hash));
                    if member != handle && !states::is_open(events, member) {
                        continue;
                    }
                    let Some(plan) = plan else { continue };
                    // The diff's digest, short, as a commit is named.
                    diffs.push(text(&plan["data"]["diff"]).chars().take(12).collect());
                    steps.extend(plan["data"]["steps"].as_array().into_iter().flatten().map(
                        |step| Step {
                            member: index,
                            does: text(&step["does"]),
                            public: step["public"].as_bool().unwrap_or(false),
                            undoable: undoable(step),
                            on: true,
                        },
                    ));
                }
                for index in 0..steps.len() {
                    let member = steps[index].member;
                    steps[index].on = steps
                        .iter()
                        .filter(|step| step.member == member)
                        .all(|step| step.undoable);
                }
                // A card with one step has no switch (#1101): Allow is the switch, and the hub's hold with Undo is
                // the guard. Switches stay on a card of two steps or more.
                // #1101's planted card keeps the switch, so a yes takes two presses.
                if let [one] = steps.as_mut_slice() {
                    one.on = one.on || !crate::plain::planted("single-step-switch");
                }
                if !diffs.is_empty() {
                    fields.push((copy::text("kinds.field_diff").to_owned(), diffs.join(", ")));
                }
                let public = steps.iter().any(|step| step.public)
                    || subject["target"]["public"].as_bool().unwrap_or(false);
                fields.push((copy::text("kinds.field_public").to_owned(), yes_no(public)));
                let undoable = !steps.is_empty() && steps.iter().all(|step| step.undoable);
                fields.push((
                    copy::text("kinds.field_undoable").to_owned(),
                    yes_no(undoable),
                ));
            }
            Kind::Taste => {
                let subject = &data["subject"];
                field(&mut fields, "kinds.field_screen", &subject["screen"]);
                field(&mut fields, "kinds.field_element", &subject["element"]);
                // The reference the call names, or the agent's own. The card draws no image, so its text claims none
                // beside the live render (#1455).
                let reference = data["reference"]
                    .as_str()
                    .unwrap_or_else(|| copy::text("kinds.reference_agents"))
                    .to_owned();
                fields.push((copy::text("kinds.field_reference").to_owned(), reference));
                // What DeepBuild saw beside what the agent shows: the checks on the commit the call is pinned to.
                if let Some((passed, ran, look)) = checks_on(events, ask) {
                    fields.push((
                        copy::text("kinds.field_checks").to_owned(),
                        copy::count("kinds.passed_of_ran", ran as u64, &[&passed]),
                    ));
                    if let Some(look) = look {
                        fields.push((copy::text("kinds.field_look_at").to_owned(), look));
                    }
                }
                field(&mut fields, "kinds.field_live", &data["live"]);
                field(&mut fields, "kinds.field_sheet", &data["sheet"]);
            }
            Kind::Unblock => {
                let steps_named = data["steps"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(text)
                    .collect::<Vec<_>>()
                    .join("; ");
                fields.push((copy::text("kinds.field_steps").to_owned(), steps_named));
                field(&mut fields, "kinds.field_where", &data["where"]);
                field(&mut fields, "kinds.field_why", &data["why"]);
                field(&mut fields, "kinds.field_proves", &data["proves"]);
                if let Some(cost) = usd(&data["cost_usd"]) {
                    fields.push((copy::text("kinds.field_cost").to_owned(), cost));
                }
            }
            Kind::StalledClaim => {
                field(&mut fields, "kinds.field_claim", &data["claim"]);
                field(&mut fields, "kinds.field_proven", &data["proven"]);
                field(&mut fields, "kinds.field_open", &data["open"]);
                for option in &options {
                    if let Some(cost) = &option.cost {
                        fields.push((
                            copy::fill("kinds.field_option_cost", &[&option.id]),
                            cost.clone(),
                        ));
                    }
                }
            }
            Kind::Choice | Kind::Definition => {
                field(&mut fields, "kinds.field_point", &data["subject"]["point"]);
                field(&mut fields, "kinds.field_requirement", &data["requirement"]);
                if let Some((from, to, checks)) = moved(events, ask) {
                    fields.push((
                        copy::text("kinds.field_moved").to_owned(),
                        copy::fill("kinds.changed_since", &[&from, &to]),
                    ));
                    fields.push((copy::fill("kinds.field_checks_on", &[&to]), checks));
                }
            }
            Kind::Exception => {
                field(&mut fields, "kinds.field_waives", &data["waives"]);
                field(&mut fields, "kinds.field_changes", &data["changes"]);
            }
        }
        let past = match kind {
            Kind::Taste => past_calls(events, ask),
            _ => Vec::new(),
        };
        let calls = match kind {
            Kind::Taste => calls(events, handle, now),
            _ => Vec::new(),
        };
        let agent = matches!(kind, Kind::Unblock)
            .then(|| text(&data["proves"]))
            .and_then(|proves| proves.strip_suffix(SIGN_IN_PROBE).map(str::to_owned))
            .filter(|agent| {
                !agent.is_empty()
                    && agent
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            });
        let price_page = agent.as_deref().and_then(crate::setup::price_page);
        let sign_in = agent.map(|_| {
            data["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .map(text)
                .collect()
        });
        Some(Model {
            ask: handle.to_owned(),
            kind,
            data_kind: text(&data["kind"]),
            record_order: data["options"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|option| text(&option["id"]))
                .collect(),
            batch,
            question: text(&data["question"]),
            options,
            default,
            applies,
            fields,
            steps,
            own_member,
            plan_hash,
            past,
            scope: scope(events, ask),
            calls,
            sign_in,
            price_page,
            pictures: crate::pictures::of(events, ask),
        })
    }

    /// The other open asks the answer also answers, by key, as the record stands now: their handles and questions.
    pub fn also_answers(&self, events: &[Value]) -> Vec<(String, String)> {
        let Some(ask) = find(events, &self.ask) else {
            return Vec::new();
        };
        same_scope(events, ask)
            .map(|(_, open)| open)
            .unwrap_or_default()
            .into_iter()
            .map(|open| (states::handle(open), text(&open["data"]["question"])))
            .collect()
    }

    /// How many steps a batched approval runs, and how many of the batch can't be undone.
    pub(crate) fn approve(&self) -> Option<(usize, usize)> {
        if self.kind != Kind::BatchedAuthority || self.steps.is_empty() {
            return None;
        }
        let runs = self.steps.iter().filter(|step| step.on).count();
        let irreversible = self.steps.iter().filter(|step| !step.undoable).count();
        Some((runs, irreversible))
    }

    /// The approve button's words on a batched approval: how many steps it runs and how many can't be undone.
    pub fn approve_label(&self) -> Option<String> {
        let (runs, irreversible) = self.approve()?;
        Some(copy::count(
            "kinds.approve_runs",
            self.steps.len() as u64,
            &[&runs, &irreversible],
        ))
    }

    /// Turns a step's switch, which is its member's: the core runs or skips a whole member.
    pub fn switch(&mut self, step: usize, on: bool) {
        let Some(member) = self.steps.get(step).map(|step| step.member) else {
            return;
        };
        for step in self.steps.iter_mut().filter(|step| step.member == member) {
            step.on = on;
        }
    }

    /// Whether the approval may go: the ask's own steps are all switched on (or it has none).
    pub fn own_on(&self) -> bool {
        self.steps
            .iter()
            .filter(|step| step.member == self.own_member)
            .all(|step| step.on)
    }

    /// The batch members the approval runs, by index in the batch, as the core reads an approval's `steps`: the
    /// ask's own, and every other with its steps switched on.
    pub fn runs(&self) -> Vec<usize> {
        let mut members: Vec<usize> = self
            .steps
            .iter()
            .filter(|step| step.on)
            .map(|step| step.member)
            .chain([self.own_member])
            .collect();
        members.sort_unstable();
        members.dedup();
        members
    }
}

/// The batched taste card's rows (#1345): each taste ask shown beside `handle` in its batch of several and still open,
/// in batch order, `handle` among them. Send back reverts a change the core landed at the commit the ask is pinned
/// to, and starts another attempt on any other.
fn calls(events: &[Value], handle: &str, now: u64) -> Vec<CallRow> {
    let members = batch_of(events, handle);
    let rows: Vec<CallRow> = members
        .iter()
        .filter_map(|member| {
            let ask = find(events, member)?;
            if Kind::of(ask) != Kind::Taste || !states::is_open(events, member) {
                return None;
            }
            let data = &ask["data"];
            let label = |id: &Value| {
                data["options"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|option| option["id"] == *id)
                    .map(|option| text(&option["label"]))
            };
            let recommended = &data["recommended"];
            let back = data["options"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|option| option["id"] != *recommended)
                .map(|option| text(&option["label"]))
                .unwrap_or_default();
            let pinned = &data["pinned_to"]["ref"];
            let landed = events.iter().any(|event| {
                event["kind"] == "landing.made"
                    && event["writer"] == "core"
                    && event["data"]["step"] == "landed"
                    && !pinned.is_null()
                    && event["data"]["head"] == *pinned
            });
            Some(CallRow {
                ask: member.clone(),
                question: text(&data["question"]),
                yes: label(recommended).unwrap_or_default(),
                back,
                sends: if landed { REVERTS } else { ATTEMPTS },
                applies: states::moment(states::deadline(events, ask).unwrap_or(now), now),
                pictures: crate::pictures::of(events, ask),
            })
        })
        .collect();
    if rows.len() > 1 {
        rows
    } else {
        Vec::new()
    }
}

fn yes_no(value: bool) -> String {
    copy::text(if value { "kinds.yes" } else { "kinds.no" }).to_owned()
}

/// The default's words where it isn't one of the options, by kind (Decided: Ask deadlines and defaults).
fn default_words(kind: Kind, id: &str) -> String {
    let words = match kind {
        Kind::BatchedAuthority => "kinds.default_no",
        Kind::Unblock => "kinds.default_stays_blocked",
        Kind::Exception => "kinds.default_no_change",
        Kind::Definition => "kinds.default_requirement_out",
        Kind::Taste | Kind::Choice | Kind::StalledClaim => "kinds.default_recommended",
    };
    if id.is_empty() || id == "hold" {
        copy::text(words).to_owned()
    } else {
        copy::fill("kinds.default_with_id", &[&copy::text(words), &id])
    }
}

/// Your past calls on the same screen and journey step: each decision saved from a taste ask whose subject names
/// the same screen, from the decisions table, newest first.
fn past_calls(events: &[Value], ask: &Value) -> Vec<PastCall> {
    let screen = &ask["data"]["subject"]["screen"];
    if screen.is_null() {
        return Vec::new();
    }
    // Revoked, overruled everywhere (not at one scope) or judged revoked, by the core.
    let revoked: Vec<&str> = events
        .iter()
        .filter(|event| event["writer"] == "core")
        .filter(|event| match event["kind"].as_str() {
            Some("decision.revoked") => true,
            Some("decision.overruled") => !event["data"]["at"].is_string(),
            Some("decision.judged") => event["data"]["state"] == "revoked",
            _ => false,
        })
        .filter_map(|event| event["data"]["decision"].as_str())
        .map(|decision| decision.trim_start_matches("decision:"))
        .collect();
    events
        .iter()
        .rev()
        .filter(|event| event["kind"] == "decision.created")
        .filter(|event| !revoked.contains(&text(&event["id"]).as_str()))
        .filter_map(|decision| {
            let about = find(events, decision["data"]["ask"].as_str()?)?;
            let answer = text(&decision["data"]["answer"]);
            let label = about["data"]["options"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|option| option["id"] == answer.as_str())
                .map(|option| text(&option["label"]))
                .unwrap_or_else(|| answer.clone());
            (about["data"]["kind"] == "taste"
                && &about["data"]["subject"]["screen"] == screen
                && states::handle(about) != states::handle(ask))
            .then(|| PastCall {
                answer: label,
                question: text(&about["data"]["question"]),
            })
        })
        .collect()
}

/// For a provisional choice whose pinned commit has moved: the pin and the session's latest commit since, both short,
/// and the checks that ran on that commit with their outcomes; `None` while the pin stands.
fn moved(events: &[Value], ask: &Value) -> Option<(String, String, String)> {
    let pin = &ask["data"]["pinned_to"];
    if pin["kind"] != "commit" {
        return None;
    }
    let pinned = text(&pin["ref"]);
    let pos = ask["log_pos"].as_u64().unwrap_or(0);
    let session = &ask["session"];
    let latest = events
        .iter()
        .rev()
        .find(|event| {
            event["kind"] == "commit.made"
                && &event["session"] == session
                && event["log_pos"].as_u64().unwrap_or(0) > pos
        })
        .map(|commit| text(&commit["data"]["sha"]))
        .filter(|sha| *sha != pinned)?;
    let short = |sha: &str| sha.chars().take(7).collect::<String>();
    let checks: Vec<String> = runs_on(events, &latest)
        .into_iter()
        .map(|(check, finished)| match finished {
            Some(finished) => format!("{check} {}", text(&finished["data"]["outcome"])),
            None => copy::fill("kinds.check_running", &[&check]),
        })
        .collect();
    let checks = if checks.is_empty() {
        copy::text("kinds.none_ran").to_owned()
    } else {
        checks.join(", ")
    };
    Some((short(&pinned), short(&latest), checks))
}

/// The checks run on the commit an ask is pinned to, each by its latest run: how many passed, how many ran, and the
/// one thing to look at, the first that failed (where it points, else its first finding, else its name), else the
/// first still running, which
/// hasn't passed; `None` when none ran.
fn checks_on(events: &[Value], ask: &Value) -> Option<(usize, usize, Option<String>)> {
    let pin = &ask["data"]["pinned_to"];
    if pin["kind"] != "commit" {
        return None;
    }
    let mut latest: Vec<(String, Option<&Value>)> = Vec::new();
    for (check, finished) in runs_on(events, &text(&pin["ref"])) {
        latest.retain(|(seen, _)| *seen != check);
        latest.push((check, finished));
    }
    if latest.is_empty() {
        return None;
    }
    let passed = latest
        .iter()
        .filter(|(_, finished)| finished.is_some_and(|f| f["data"]["outcome"] == "passed"))
        .count();
    // A check that failed comes before one still running.
    let look = latest
        .iter()
        .find_map(|(check, finished)| {
            finished
                .filter(|f| f["data"]["outcome"] != "passed")
                .map(|f| {
                    // Where it points, else its first finding (the core's own runs say why there), else its name.
                    let points_to = f["data"]["points_to"]
                        .as_str()
                        .filter(|to| !to.is_empty())
                        .map(str::to_owned);
                    let finding = f["data"]["findings"][0]
                        .as_str()
                        .map(|finding| format!("{check}: {finding}"));
                    points_to.or(finding).unwrap_or_else(|| check.clone())
                })
        })
        .or_else(|| {
            latest
                .iter()
                .find(|(_, finished)| finished.is_none())
                .map(|(check, _)| copy::fill("kinds.check_still_running", &[check]))
        });
    Some((passed, latest.len(), look))
}

/// The runs on `commit`, each once, in the order of its start as the record takes it, with its check and its finish.
fn runs_on<'a>(events: &'a [Value], commit: &str) -> Vec<(String, Option<&'a Value>)> {
    let mut runs: Vec<&Value> = Vec::new();
    for event in events.iter().filter(|event| event["kind"] == "run.started") {
        if !runs.contains(&&event["data"]["run"]) {
            runs.push(&event["data"]["run"]);
        }
    }
    let mut starts: Vec<(usize, &Value, &Value)> = runs
        .into_iter()
        .filter_map(|run| {
            let started = run_event(events, "run.started", run)?;
            let at = events
                .iter()
                .position(|event| std::ptr::eq(event, started))?;
            Some((at, run, started))
        })
        .filter(|(_, _, started)| started["data"]["commit"] == commit)
        .collect();
    starts.sort_by_key(|(at, _, _)| *at);
    starts
        .into_iter()
        .map(|(_, run, started)| {
            (
                text(&started["data"]["check"]),
                run_event(events, "run.finished", run),
            )
        })
        .collect()
}

/// A run's start or finish as the record takes it: the core's whenever it lands, until then the first.
fn run_event<'a>(events: &'a [Value], kind: &str, run: &Value) -> Option<&'a Value> {
    let of_run = |event: &&Value| event["kind"] == kind && &event["data"]["run"] == run;
    events
        .iter()
        .rfind(|event| of_run(event) && event["writer"] == "core")
        .or_else(|| events.iter().find(of_run))
}

/// The scope an option's answer is saved at, in words, and how many other open asks share the ask's key, so
/// the same decision answers them too; `None` for an ask whose answer saves no decision.
fn scope(events: &[Value], ask: &Value) -> Option<Scope> {
    let (words, also) = same_scope(events, ask)?;
    Some(Scope {
        words,
        also: also.len(),
    })
}

/// The scope's words and the other open asks the same decision answers: same key, in the ask's repo when one is
/// known, else in its session.
fn same_scope<'a>(events: &'a [Value], ask: &Value) -> Option<(String, Vec<&'a Value>)> {
    let data = &ask["data"];
    if data["options"].as_array().is_none_or(Vec::is_empty) || is_fold(events, ask) {
        return None;
    }
    let key = data["key"].as_str()?;
    let session = text(&ask["session"]);
    // As the core: an ask raised in no session, or another's unblock, saves no decision.
    if session.is_empty() || theirs(ask) {
        return None;
    }
    let repo = project_of(events, &session);
    let words = match repo {
        Some(repo) => copy::fill("kinds.saves_for_project", &[&repo]),
        None => copy::text("kinds.saves_for_task").to_owned(),
    };
    let also = states::open_asks(events, None)
        .into_iter()
        .filter(|open| states::handle(open) != states::handle(ask))
        .filter(|open| open["data"]["key"] == key)
        // Nor does a decision answer another's unblock or an exception that holds asks.
        .filter(|open| !theirs(open) && !is_fold(events, open))
        .filter(|open| match repo {
            // A repo-scoped decision answers the asks of that repo's sessions only, as the core's resolver does.
            Some(repo) => project_of(events, &text(&open["session"]))
                .is_some_and(|other| letters(other) == letters(repo)),
            None => letters(&text(&open["session"])) == letters(&session),
        })
        .collect();
    Some((words, also))
}

/// The exception the core raises when a session's asks fold: written by the core, keyed on its thread.
fn is_fold(events: &[Value], ask: &Value) -> bool {
    let session = text(&ask["session"]);
    // The thread as it stood when the ask was raised: the core keys a fold then, and a later start can move it.
    let raised = events
        .iter()
        .position(|event| event["kind"] == "ask.created" && event["id"] == ask["id"])
        .unwrap_or(events.len());
    let thread = events[..raised]
        .iter()
        .rev()
        .find(|event| event["session"] == session.as_str() && event["kind"] == "session.start")
        .and_then(|start| start["data"]["thread"].as_str())
        .map_or(session.clone(), str::to_owned);
    let key = format!(
        "{:x}",
        Sha256::digest(format!("asks.fold:{thread}").as_bytes())
    );
    ask["writer"] == "core" && ask["data"]["key"] == key.as_str()
}

/// An unblock someone else owns: theirs to take, never answered for you.
fn theirs(ask: &Value) -> bool {
    ask["data"]["kind"] == "unblock" && ask["data"]["owner"] != ask["actor"]
}

/// The project a session started in, as its latest `session.start` carries it: the repo the core saves a decision for.
/// A session with none saves for itself alone, whatever its worktree is called.
fn project_of<'a>(events: &'a [Value], session: &str) -> Option<&'a str> {
    events
        .iter()
        .rev()
        .find(|event| event["session"] == session && event["kind"] == "session.start")
        .and_then(|start| start["project"].as_str())
        .filter(|project| !letters(project).is_empty())
}

/// A project as the core compares it: its letters and digits only.
fn letters(id: &str) -> String {
    id.chars().filter(char::is_ascii_alphanumeric).collect()
}

#[cfg(test)]
mod tests;
