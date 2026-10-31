//! Issue #327: what the question card shows for one ask, by its kind, read from the record alone. Seven card
//! kinds: a batched authority (its plan's steps, the diff, whether the target is public, whether each step can be
//! undone, default no), a taste call (the reference beside the live render, a sheet of options, your past calls
//! on the same screen and journey step from the decisions table), a step only you can take (proven by a check),
//! a stalled claim (split, fund or accept, with costs), a choice, an exception (what it would waive or change,
//! default no change) and an early question about what done means (default: leave the requirement out). Every
//! card shows its question, every option's label, its deadline, its default and when it applies.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::states;

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
    /// The kind's name as the card and its usage rows write it.
    pub fn name(self) -> &'static str {
        match self {
            Kind::BatchedAuthority => "batched authority",
            Kind::Taste => "taste",
            Kind::Unblock => "unblock",
            Kind::StalledClaim => "stalled claim",
            Kind::Choice => "choice",
            Kind::Exception => "exception",
            Kind::Definition => "early question about done",
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

/// The ask.created event of `handle`.
pub fn find<'a>(events: &'a [Value], handle: &str) -> Option<&'a Value> {
    events
        .iter()
        .find(|event| event["kind"] == "ask.created" && states::handle(event) == handle)
}

/// The asks shown together with `handle` in a batch of several, in batch order: the latest `ask.batched` the core
/// wrote listing it, the one whose order an approval's `steps` index (an agent's batch is never one).
fn batch_of(events: &[Value], handle: &str) -> Vec<String> {
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
        let applies = format!("in {}", states::span_until(deadline, now));
        let mut fields = Vec::new();
        let mut steps = Vec::new();
        let mut plan_hash = None;
        let mut own_member = 0;
        let mut batch = Vec::new();
        let field = |fields: &mut Vec<(String, String)>, name: &str, value: &Value| {
            if !value.is_null() {
                fields.push((name.to_owned(), text(value)));
            }
        };
        match kind {
            Kind::BatchedAuthority => {
                let subject = &data["subject"];
                field(&mut fields, "effect", &subject["effect"]);
                field(&mut fields, "target", &subject["target"]["ref"]);
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
                if !diffs.is_empty() {
                    fields.push(("diff".into(), diffs.join(", ")));
                }
                let public = steps.iter().any(|step| step.public)
                    || subject["target"]["public"].as_bool().unwrap_or(false);
                fields.push(("public".into(), yes_no(public)));
                let undoable = !steps.is_empty() && steps.iter().all(|step| step.undoable);
                fields.push(("undoable".into(), yes_no(undoable)));
            }
            Kind::Taste => {
                let subject = &data["subject"];
                field(&mut fields, "screen", &subject["screen"]);
                field(&mut fields, "element", &subject["element"]);
                // The reference draws beside the live render: the one the call names, or the agent's own.
                let reference = match data["reference"].as_str() {
                    Some(reference) => format!("{reference}, beside the live render"),
                    None => "the agent's, beside the live render".to_owned(),
                };
                fields.push(("reference".into(), reference));
                // What DeepBuild saw beside what the agent shows: the checks on the commit the call is pinned to.
                if let Some((passed, ran, look)) = checks_on(events, ask) {
                    fields.push(("checks".into(), format!("{passed} of {ran} passed")));
                    if let Some(look) = look {
                        fields.push(("look at".into(), look));
                    }
                }
                field(&mut fields, "live", &data["live"]);
                field(&mut fields, "sheet", &data["sheet"]);
            }
            Kind::Unblock => {
                let steps_named = data["steps"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(text)
                    .collect::<Vec<_>>()
                    .join("; ");
                fields.push(("steps".into(), steps_named));
                field(&mut fields, "where", &data["where"]);
                field(&mut fields, "why", &data["why"]);
                field(&mut fields, "proves", &data["proves"]);
                if let Some(cost) = usd(&data["cost_usd"]) {
                    fields.push(("cost".into(), cost));
                }
            }
            Kind::StalledClaim => {
                field(&mut fields, "claim", &data["claim"]);
                field(&mut fields, "proven", &data["proven"]);
                field(&mut fields, "open", &data["open"]);
                for option in &options {
                    if let Some(cost) = &option.cost {
                        fields.push((format!("{} cost", option.id), cost.clone()));
                    }
                }
            }
            Kind::Choice | Kind::Definition => {
                field(&mut fields, "point", &data["subject"]["point"]);
                field(&mut fields, "requirement", &data["requirement"]);
                if let Some((from, to, checks)) = moved(events, ask) {
                    fields.push(("moved".into(), format!("changed since {from}: now at {to}")));
                    fields.push((format!("checks on {to}"), checks));
                }
            }
            Kind::Exception => {
                field(&mut fields, "waives", &data["waives"]);
                field(&mut fields, "changes", &data["changes"]);
            }
        }
        let past = match kind {
            Kind::Taste => past_calls(events, ask),
            _ => Vec::new(),
        };
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
        Some(format!(
            "Approve: runs {runs} of {} steps · {irreversible} can't be undone",
            self.steps.len()
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

fn yes_no(value: bool) -> String {
    if value { "yes" } else { "no" }.to_owned()
}

/// The default's words where it isn't one of the options, by kind (Decided: Ask deadlines and defaults).
fn default_words(kind: Kind, id: &str) -> String {
    let words: &str = match kind {
        Kind::BatchedAuthority => "no",
        Kind::Unblock => "stays blocked",
        Kind::Exception => "no change",
        Kind::Definition => "leave the requirement out",
        Kind::Taste | Kind::Choice | Kind::StalledClaim => "the recommended option",
    };
    if id.is_empty() || id == "hold" {
        words.to_owned()
    } else {
        format!("{words} ({id})")
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
        .map(|(check, finished)| {
            let outcome = finished
                .map(|finished| text(&finished["data"]["outcome"]))
                .unwrap_or_else(|| "running".to_owned());
            format!("{check} {outcome}")
        })
        .collect();
    let checks = if checks.is_empty() {
        "none ran".to_owned()
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
                .map(|(check, _)| format!("{check}, still running"))
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
        Some(repo) => format!("Saved for this repo ({repo})"),
        None => "Saved for this session".to_owned(),
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
mod tests {
    use super::*;
    use serde_json::json;

    fn ask(id: &str, kind: &str, extra: Value) -> Value {
        let mut data = json!({
            "kind": kind, "question": format!("{kind} {id}?"),
            "options": [{"id": "yes", "label": "Yes", "decision": "allow"}, {"id": "no", "label": "No", "decision": "deny"}],
            "recommended": "no", "deadline": 2_000_000, "fallback": "no", "default": "no", "provisional": false,
            "owner": "you", "key": format!("k-{kind}"), "pinned_to": {"kind": "commit", "ref": "0".repeat(40)},
        });
        for (name, value) in extra.as_object().into_iter().flatten() {
            data[name] = value.clone();
        }
        json!({"v": 4, "id": id, "kind": "ask.created", "log_pos": 1, "session": "s1", "data": data})
    }

    #[test]
    fn the_card_shows_the_plan_the_core_binds_never_a_later_one() {
        let proposal = |id: &str, writer: &str, log_pos: u64, hash: char, does: &str| {
            json!({"kind": "plan.proposed", "id": id, "writer": writer, "log_pos": log_pos, "data": {"ask": "ask:A", "diff": "d".repeat(64), "hash": hash.to_string().repeat(64), "steps": [
                {"does": does, "changes": [], "undo": "force-push back", "public": true, "cost": 0},
            ]}})
        };
        let events = vec![
            ask(
                "A",
                "authority",
                json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}}),
            ),
            proposal("P0", "mcp:s1", 2, 'b', "push main --force"),
            proposal("P1", "core", 3, 'a', "push main"),
            proposal("P2", "core", 4, 'c', "push main and delete the tag"),
        ];
        let model = Model::read(&events, "ask:A", 1_000_000).unwrap();
        assert_eq!(
            model.plan_hash,
            Some("a".repeat(64)),
            "the approval binds the first plan the core proposed"
        );
        let shown: Vec<&str> = model.steps.iter().map(|step| step.does.as_str()).collect();
        assert_eq!(
            shown,
            ["push main"],
            "the card shows that plan's steps, not a later one's"
        );
    }

    #[test]
    fn the_card_shows_the_batch_the_core_wrote_never_an_agents() {
        let push = json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}});
        let batched = |id: &str, writer: &str, log_pos: u64, asks: &[&str]| {
            json!({"kind": "ask.batched", "id": id, "writer": writer, "log_pos": log_pos, "data": {
                "batch": "b", "asks": asks.iter().map(|ask| json!({"ask": ask, "plan_hash": null})).collect::<Vec<_>>(),
            }})
        };
        let events = vec![
            ask("A", "authority", push.clone()),
            ask("B", "authority", push.clone()),
            ask("C", "authority", push),
            batched("K", "core", 4, &["ask:A", "ask:B"]),
            batched("X", "mcp:s1", 5, &["ask:A", "ask:C"]),
        ];
        let model = Model::read(&events, "ask:A", 1_000_000).unwrap();
        let members: Vec<&str> = model.batch.iter().map(|(ask, _)| ask.as_str()).collect();
        assert_eq!(
            members,
            ["ask:A", "ask:B"],
            "the card's batch is the core's, whose order steps index"
        );
    }

    #[test]
    fn a_lone_approval_runs_its_whole_plan_and_says_so_on_its_button() {
        let events = vec![
            ask(
                "A",
                "authority",
                json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}}),
            ),
            json!({"kind": "plan.proposed", "id": "P", "writer": "core", "log_pos": 2, "data": {"ask": "ask:A", "diff": "d".repeat(64), "hash": "h".repeat(64), "steps": [
                {"does": "push", "changes": [], "undo": "force-push back", "public": true, "cost": 0},
                {"does": "tag", "changes": [], "undo": "delete the tag", "public": true, "cost": 0},
                {"does": "release", "changes": [], "undo": "none", "public": true, "cost": 0},
                {"does": "notify", "changes": [], "undo": "say so", "public": false, "cost": 0},
            ]}}),
        ];
        let mut model = Model::read(&events, "ask:A", 1_000_000).unwrap();
        assert_eq!(model.kind, Kind::BatchedAuthority);
        // Alone outside a batch the core runs the whole plan or none of it: the plan starts off, so the card
        // holds the approval back until you switch its step that can't be undone on.
        assert_eq!(
            model.approve_label().unwrap(),
            "Approve: runs 0 of 4 steps · 1 can't be undone"
        );
        assert!(!model.own_on());
        model.switch(2, true);
        assert_eq!(
            model.approve_label().unwrap(),
            "Approve: runs 4 of 4 steps · 1 can't be undone"
        );
        assert!(model.own_on());
        assert_eq!(model.runs(), [0]);
        assert_eq!(model.default, "No");
        assert!(model.fields.contains(&("public".into(), "yes".into())));
        assert!(model.fields.contains(&("undoable".into(), "no".into())));
        assert_eq!(
            model.options[0].id, "no",
            "the recommended option draws first"
        );
    }

    #[test]
    fn a_moved_choice_lists_each_run_on_the_new_commit_as_the_record_takes_it() {
        let new = "1".repeat(40);
        let mut choice = ask("C", "choice", json!({"provisional": true}));
        choice["session"] = json!("s1");
        let start = |run: &str, check: &str, writer: &str, commit: &str| json!({"kind": "run.started", "writer": writer, "data": {"run": run, "check": check, "claim": "c", "commit": commit}});
        let finish = |run: &str, writer: &str, outcome: &str| json!({"kind": "run.finished", "writer": writer, "data": {"run": run, "check": "x", "outcome": outcome, "points_to": null, "findings": []}});
        let events = vec![
            choice,
            json!({"kind": "commit.made", "session": "s1", "log_pos": 2, "data": {"sha": new}}),
            start("r1", "unit", "core", &new),
            start("r1", "unit", "core", &new),
            finish("r1", "hook", "passed"),
            finish("r1", "core", "failed"),
            // A hook names the new commit for a run the core started on another.
            start("r2", "lint", "core", &"2".repeat(40)),
            start("r2", "lint", "hook", &new),
            start("r3", "e2e", "hook", &new),
        ];
        let model = Model::read(&events, "ask:C", 0).unwrap();
        let checks = model
            .fields
            .iter()
            .find(|(name, _)| name.starts_with("checks on"))
            .map(|(_, value)| value.as_str());
        assert_eq!(checks, Some("unit failed, e2e running"));
    }

    #[test]
    fn a_batch_member_runs_or_skips_whole_and_starts_off_with_a_step_that_cant_be_undone() {
        let push = json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}});
        let plan = |ask: &str, steps: Value| {
            json!({"kind": "plan.proposed", "id": format!("P{ask}"), "writer": "core", "log_pos": 2, "data": {
                "ask": format!("ask:{ask}"), "diff": "d".repeat(64), "hash": ask.repeat(64), "steps": steps}})
        };
        let step = |does: &str, undo: &str| json!({"does": does, "changes": [], "undo": undo, "public": false, "cost": 0});
        let events = vec![
            ask("A", "authority", push.clone()),
            ask("B", "authority", push),
            plan("A", json!([step("delete", "none")])),
            plan(
                "B",
                json!([step("push", "force-push back"), step("release", "none")]),
            ),
            json!({"kind": "ask.batched", "id": "K", "writer": "core", "log_pos": 4, "data": {
                "batch": "b", "asks": [{"ask": "ask:A", "plan_hash": null}, {"ask": "ask:B", "plan_hash": null}]}}),
        ];
        let mut model = Model::read(&events, "ask:B", 1_000_000).unwrap();
        let on: Vec<bool> = model.steps.iter().map(|step| step.on).collect();
        assert_eq!(
            on,
            [false, false, false],
            "each member has a step that can't be undone, so each starts off"
        );
        assert!(
            !model.own_on(),
            "B's own steps are off: the card holds its approval"
        );
        model.switch(2, true);
        let on: Vec<bool> = model.steps.iter().map(|step| step.on).collect();
        assert_eq!(
            on,
            [false, true, true],
            "B's switch is B's: both its steps run"
        );
        assert!(model.own_on());
        assert_eq!(model.runs(), [1]);
        model.switch(0, true);
        assert_eq!(model.runs(), [0, 1]);
    }

    #[test]
    fn an_ask_batched_with_no_plan_of_its_own_is_still_among_the_steps_it_approves() {
        let push = json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}});
        let events = vec![
            ask("A", "authority", push.clone()),
            ask("B", "authority", push),
            json!({"kind": "plan.proposed", "id": "PB", "writer": "core", "log_pos": 2, "data": {"ask": "ask:B", "diff": "d".repeat(64), "hash": "b".repeat(64), "steps": [
                {"does": "push", "changes": [], "undo": "force-push back", "public": false, "cost": 0}]}}),
            json!({"kind": "ask.batched", "id": "K", "writer": "core", "log_pos": 4, "data": {
                "batch": "b", "asks": [{"ask": "ask:A", "plan_hash": null}, {"ask": "ask:B", "plan_hash": null}]}}),
        ];
        let model = Model::read(&events, "ask:A", 1_000_000).unwrap();
        assert!(model.own_on());
        assert_eq!(model.runs(), [0, 1]);

        // B was superseded before the approval: the core drops it, so the card neither draws nor counts its steps.
        let mut closed = events.clone();
        closed.push(
            json!({"kind": "ask.superseded", "writer": "core", "subject": "ask:B", "data": {}}),
        );
        let model = Model::read(&closed, "ask:A", 1_000_000).unwrap();
        assert!(model.steps.is_empty());
        assert_eq!(model.runs(), [0]);
    }

    #[test]
    fn the_receipt_lists_only_the_asks_the_card_counted() {
        let session = |id: &str| json!({"kind": "session.start", "session": id, "data": {}});
        let mut other = ask("C", "choice", json!({}));
        other["session"] = json!("s2");
        let events = vec![
            session("s1"),
            session("s2"),
            ask("A", "choice", json!({})),
            ask("B", "choice", json!({})),
            other,
        ];
        let model = Model::read(&events, "ask:A", 1_000_000).unwrap();
        let scope = model.scope.clone().unwrap();
        assert_eq!(
            (scope.words.as_str(), scope.also),
            ("Saved for this session", 1)
        );
        let also: Vec<String> = model
            .also_answers(&events)
            .into_iter()
            .map(|(ask, _)| ask)
            .collect();
        assert_eq!(
            also,
            ["ask:B"],
            "a session-scoped answer answers nothing in another session"
        );
    }

    #[test]
    fn a_stalled_claim_is_a_choice_of_split_fund_or_accept_with_costs() {
        let events = vec![ask(
            "S",
            "choice",
            json!({
                "options": [{"id": "split", "label": "Split", "decision": "none"}, {"id": "fund", "label": "Fund", "decision": "none"}, {"id": "accept", "label": "Accept", "decision": "none"}],
                "recommended": "accept", "default": "accept", "costs": {"fund": 12.5},
            }),
        )];
        let model = Model::read(&events, "ask:S", 0).unwrap();
        assert_eq!(model.kind, Kind::StalledClaim);
        assert_eq!(
            model.options[0].id, "accept",
            "the recommended option draws first"
        );
        let fund = model
            .options
            .iter()
            .find(|option| option.id == "fund")
            .unwrap();
        assert_eq!(fund.cost.as_deref(), Some("$12.50"));
    }

    #[test]
    fn a_taste_call_lists_past_calls_on_the_same_screen() {
        let events = vec![
            ask(
                "T1",
                "taste",
                json!({"subject": {"screen": "checkout", "element": "total"}}),
            ),
            json!({"kind": "decision.created", "id": "D1", "log_pos": 2, "data": {"key": "k", "scope": "all", "answer": "yes", "ask": "ask:T1"}}),
            ask(
                "T2",
                "taste",
                json!({"subject": {"screen": "cart", "element": "total"}}),
            ),
            json!({"kind": "decision.created", "id": "D2", "log_pos": 4, "data": {"key": "k", "scope": "all", "answer": "no", "ask": "ask:T2"}}),
            ask(
                "T3",
                "taste",
                json!({"subject": {"screen": "checkout", "element": "button"}}),
            ),
        ];
        let model = Model::read(&events, "ask:T3", 0).unwrap();
        assert_eq!(model.past.len(), 1);
        for (gone, revoke) in [
            (
                true,
                json!({"kind": "decision.revoked", "writer": "core", "data": {"decision": "decision:D1"}}),
            ),
            (
                true,
                json!({"kind": "decision.overruled", "writer": "core", "data": {"decision": "decision:D1"}}),
            ),
            (
                true,
                json!({"kind": "decision.judged", "writer": "core", "data": {"decision": "decision:D1", "state": "revoked"}}),
            ),
            (
                false,
                json!({"kind": "decision.overruled", "writer": "core", "data": {"decision": "decision:D1", "at": "repo:shop"}}),
            ),
            (
                false,
                json!({"kind": "decision.judged", "writer": "core", "data": {"decision": "decision:D1", "state": "frozen"}}),
            ),
            (
                false,
                json!({"kind": "decision.revoked", "writer": "mcp:agent", "data": {"decision": "decision:D1"}}),
            ),
        ] {
            let mut later = events.clone();
            later.push(revoke.clone());
            let past = Model::read(&later, "ask:T3", 0).unwrap().past.len();
            assert_eq!(past, usize::from(!gone), "{revoke}");
        }
        assert_eq!(model.past[0].question, "taste T1?");
        assert_eq!(
            model.past[0].answer, "Yes",
            "the past call shows the answer's label"
        );
    }

    #[test]
    fn a_taste_call_says_how_many_checks_passed_on_its_commit_and_what_to_look_at() {
        let pinned = "a".repeat(40);
        let run = |id: &str, check: &str, commit: &str, outcome: &str, points_to: Value| {
            [
                json!({"kind": "run.started", "writer": "core", "data": {"run": id, "check": check, "claim": "c", "commit": commit}}),
                json!({"kind": "run.finished", "writer": "core", "data": {"run": id, "check": check, "outcome": outcome, "points_to": points_to}}),
            ]
        };
        let mut events = vec![ask(
            "T",
            "taste",
            json!({"subject": {"screen": "checkout", "element": "total"}, "pinned_to": {"kind": "commit", "ref": pinned}}),
        )];
        events.extend(run("r1", "unit", &pinned, "passed", Value::Null));
        // The contrast check failed first and passed on its rerun: its latest run counts.
        events.extend(run("r2", "contrast", &pinned, "failed", json!("old")));
        events.extend(run("r3", "contrast", &pinned, "passed", Value::Null));
        events.extend(run(
            "r4",
            "layout",
            &pinned,
            "failed",
            json!("checkout.tsx:42"),
        ));
        // A check on another commit isn't this call's.
        events.extend(run("r5", "e2e", &"b".repeat(40), "failed", Value::Null));
        let quiet = vec![events[0].clone()];
        let model = Model::read(&events, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(get("checks"), Some("2 of 3 passed"));
        assert_eq!(get("look at"), Some("checkout.tsx:42"));

        // A rerun of the unit check that hasn't finished: its passed run before it no longer counts.
        events.push(json!({"kind": "run.started", "data": {"run": "r6", "check": "unit", "claim": "c", "commit": pinned}}));
        let model = Model::read(&events, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(get("checks"), Some("1 of 3 passed"));
        assert_eq!(get("look at"), Some("checkout.tsx:42"));

        // A start or finish not from the core gives way to the core's, as the record takes a run.
        let mut forged = vec![events[0].clone()];
        forged.push(json!({"kind": "run.started", "writer": "mcp:x", "data": {"run": "r9", "check": "layout", "claim": "c", "commit": "c".repeat(40)}}));
        forged.push(json!({"kind": "run.finished", "writer": "mcp:x", "data": {"run": "r9", "check": "layout", "outcome": "passed"}}));
        forged.extend(run(
            "r9",
            "layout",
            &pinned,
            "failed",
            json!("checkout.tsx:42"),
        ));
        let model = Model::read(&forged, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(
            (get("checks"), get("look at")),
            (Some("0 of 1 passed"), Some("checkout.tsx:42"))
        );

        // Two core finishes of one run: the last is its result, as the record keeps it.
        let mut twice = vec![events[0].clone()];
        twice.extend(run(
            "r10",
            "layout",
            &pinned,
            "failed",
            json!("checkout.tsx:42"),
        ));
        twice.push(json!({"kind": "run.finished", "writer": "core", "data": {"run": "r10", "check": "layout", "outcome": "passed"}}));
        let model = Model::read(&twice, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(
            (get("checks"), get("look at")),
            (Some("1 of 1 passed"), None)
        );

        // A run first started by another writer is placed by the core's start when it lands: r11 is the latest.
        let mut placed = vec![events[0].clone()];
        placed.push(json!({"kind": "run.started", "writer": "mcp:x", "data": {"run": "r11", "check": "layout", "claim": "c", "commit": pinned}}));
        placed.extend(run("r12", "layout", &pinned, "failed", json!("old")));
        placed.extend(run("r11", "layout", &pinned, "passed", Value::Null));
        let model = Model::read(&placed, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(
            (get("checks"), get("look at")),
            (Some("1 of 1 passed"), None)
        );

        // A rerun started before a check failed: the failure, named by its check when it points nowhere, comes first.
        let mut later = vec![events[0].clone()];
        later.push(json!({"kind": "run.started", "data": {"run": "r7", "check": "unit", "claim": "c", "commit": pinned}}));
        later.extend(run("r8", "layout", &pinned, "failed", Value::Null));
        let model = Model::read(&later, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(
            (get("checks"), get("look at")),
            (Some("0 of 2 passed"), Some("layout"))
        );
        // A run the core finished says why in its findings, never where it points.
        let mut stopped = vec![events[0].clone()];
        stopped.push(json!({"kind": "run.started", "writer": "core", "data": {"run": "r13", "check": "e2e", "claim": "c", "commit": pinned}}));
        stopped.push(json!({"kind": "run.finished", "writer": "core", "data": {"run": "r13", "check": "e2e", "outcome": "missing", "points_to": null, "findings": ["its stack never came up: db"]}}));
        let model = Model::read(&stopped, "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(get("look at"), Some("e2e: its stack never came up: db"));
        // Where a run points wins over its findings; pointing at nothing ("") is pointing nowhere.
        for (points_to, look) in [
            (json!("src/db.rs:4"), "src/db.rs:4"),
            (json!(""), "e2e: its stack never came up: db"),
        ] {
            stopped[2]["data"]["points_to"] = points_to;
            let model = Model::read(&stopped, "ask:T", 0).unwrap();
            let got = model
                .fields
                .iter()
                .find(|(field, _)| field == "look at")
                .map(|(_, value)| value.clone());
            assert_eq!(got.as_deref(), Some(look));
        }

        // Only a run still going: that is the thing to look at.
        let model = Model::read(&later[..2], "ask:T", 0).unwrap();
        let get = |name: &str| {
            model
                .fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(
            (get("checks"), get("look at")),
            (Some("0 of 1 passed"), Some("unit, still running"))
        );

        let model = Model::read(&quiet, "ask:T", 0).unwrap();
        assert!(
            model.fields.iter().all(|(field, _)| field != "checks"),
            "no checks ran: the card says nothing about them"
        );
    }

    #[test]
    fn a_repo_scoped_answer_counts_only_the_asks_of_that_project() {
        // As the hub sends them: the session's project rides on the event, apart from its worktree.
        let start = |id: &str, worktree: &str, project: Value| json!({"kind": "session.start", "session": id, "project": project, "data": {"worktree": worktree}});
        let in_session = |id: &str, session: &str| {
            let mut event = ask(id, "taste", json!({"key": "same"}));
            event["session"] = json!(session);
            event
        };
        let events = vec![
            start("s1", "~/src/shop", json!("my-shop")),
            start("s2", "~/src/shop-2", json!("myshop")),
            start("s3", "~/src/shop", json!("docs")),
            start("s4", "~/src/shop", Value::Null),
            start("s5", "~/src/shop", Value::Null),
            in_session("A", "s1"),
            in_session("B", "s2"),
            in_session("C", "s3"),
            in_session("D", "s4"),
            in_session("E", "s5"),
        ];
        let model = Model::read(&events, "ask:A", 0).unwrap();
        let scope = model.scope.clone().unwrap();
        assert_eq!(
            (scope.words.as_str(), scope.also),
            ("Saved for this repo (my-shop)", 1)
        );
        let also: Vec<String> = model
            .also_answers(&events)
            .into_iter()
            .map(|(ask, _)| ask)
            .collect();
        assert_eq!(
            also,
            ["ask:B"],
            "the same project by its letters, never another project or none"
        );

        // Another's unblock with the key, in the same project: the decision never answers it.
        let mut with_theirs = events.clone();
        let mut unblock = ask("U", "unblock", json!({"key": "same", "owner": "someone"}));
        unblock["session"] = json!("s2");
        unblock["actor"] = json!("you");
        with_theirs.push(unblock);
        let model = Model::read(&with_theirs, "ask:A", 0).unwrap();
        assert_eq!(
            model.scope.clone().unwrap().also,
            1,
            "another's unblock isn't counted"
        );

        // A session that starts again in another project is scoped by its latest start, as the core keeps it.
        let mut moved = events.clone();
        moved.insert(5, start("s1", "~/src/docs", json!("docs")));
        let model = Model::read(&moved, "ask:A", 0).unwrap();
        let scope = model.scope.clone().unwrap();
        assert_eq!(
            (scope.words.as_str(), scope.also),
            ("Saved for this repo (docs)", 1)
        );

        // The fold exception the core raised for a thread: no decision is saved from it, and it is never counted.
        let fold_key = format!("{:x}", Sha256::digest(b"asks.fold:t1"));
        let mut folding = events.clone();
        folding[0]["data"]["thread"] = json!("t1");
        let mut fold = ask("X", "exception", json!({"key": fold_key}));
        fold["session"] = json!("s1");
        fold["writer"] = json!("core");
        let mut fold_too = fold.clone();
        fold_too["id"] = json!("Y");
        folding.extend([fold, fold_too]);
        assert!(
            Model::read(&folding, "ask:X", 0).unwrap().scope.is_none(),
            "a fold saves no decision"
        );
        let mut agent = folding.clone();
        agent[folding.len() - 2]["writer"] = json!("hook");
        let scope = Model::read(&agent, "ask:X", 0).unwrap().scope.unwrap();
        assert_eq!(
            scope.also, 0,
            "only the core raises a fold, and a decision never answers the fold"
        );

        // The session moves to another thread after the fold was raised: it stays a fold, keyed on the old thread.
        let mut resumed = folding.clone();
        resumed.push(json!({"kind": "session.start", "session": "s1", "project": "my-shop", "data": {"thread": "t2"}}));
        assert!(
            Model::read(&resumed, "ask:X", 0).unwrap().scope.is_none(),
            "a fold stays one after its session moves"
        );

        // Another's unblock on its own card: the core saves no decision for it.
        assert!(Model::read(&with_theirs, "ask:U", 0)
            .unwrap()
            .scope
            .is_none());

        // A project with no letters is none; an ask in no session saves nothing.
        let mut odd = events.clone();
        odd.push(start("s6", "~/src/x", json!("--")));
        odd.push(in_session("F", "s6"));
        odd.push(in_session("G", ""));
        let model = Model::read(&odd, "ask:F", 0).unwrap();
        assert_eq!(model.scope.clone().unwrap().words, "Saved for this session");
        assert!(Model::read(&odd, "ask:G", 0).unwrap().scope.is_none());

        // No project: the core saves for the session alone, though the worktree has a name.
        let model = Model::read(&events, "ask:D", 0).unwrap();
        let scope = model.scope.clone().unwrap();
        assert_eq!(
            (scope.words.as_str(), scope.also),
            ("Saved for this session", 0)
        );

        // The core knows a session by its letters: "s-4" is s4.
        let mut spelled = events.clone();
        spelled.push(in_session("H", "s-4"));
        assert_eq!(
            Model::read(&spelled, "ask:D", 0)
                .unwrap()
                .scope
                .unwrap()
                .also,
            1
        );

        // B's default applied, then the core undid it: B is open again, and the answer closes it.
        let mut undone = events.clone();
        undone.push(
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:B", "data": {}}),
        );
        assert_eq!(
            Model::read(&undone, "ask:A", 0)
                .unwrap()
                .scope
                .unwrap()
                .also,
            0
        );
        undone.push(json!({"kind": "default.undone", "writer": "core", "subject": "ask:B", "data": {"deadline": 7_200_000}}));
        assert_eq!(
            Model::read(&undone, "ask:A", 0)
                .unwrap()
                .scope
                .unwrap()
                .also,
            1
        );
        assert_eq!(
            Model::read(&undone, "ask:B", 0).unwrap().applies,
            "in 2 h",
            "its default applies at the undo's deadline"
        );
    }

    #[test]
    fn the_scope_counts_the_other_open_asks_with_the_same_key() {
        let events = vec![
            ask("X", "choice", json!({"key": "same"})),
            ask("Y", "choice", json!({"key": "same"})),
            ask("Z", "choice", json!({"key": "other"})),
        ];
        let model = Model::read(&events, "ask:X", 0).unwrap();
        assert_eq!(model.scope.as_ref().unwrap().also, 1);
        assert_eq!(
            model.scope.as_ref().unwrap().words,
            "Saved for this session"
        );
    }
}
