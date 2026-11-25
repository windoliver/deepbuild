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

/// The card's field `name`.
fn field<'a>(model: &'a Model, name: &str) -> Option<&'a str> {
    model
        .fields
        .iter()
        .find(|(field, _)| field == name)
        .map(|(_, value)| value.as_str())
}

/// An authority ask's subject: a push to main.
fn push() -> Value {
    json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}})
}

#[test]
fn the_card_shows_the_plan_the_core_binds_never_a_later_one() {
    let proposal = |id: &str, writer: &str, log_pos: u64, hash: char, does: &str| {
        json!({"kind": "plan.proposed", "id": id, "writer": writer, "log_pos": log_pos, "data": {"ask": "ask:A", "diff": "d".repeat(64), "hash": hash.to_string().repeat(64), "steps": [
            {"does": does, "changes": [], "undo": "force-push back", "public": true, "cost": 0},
        ]}})
    };
    let events = vec![
        ask("A", "authority", push()),
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
    let batched = |id: &str, writer: &str, log_pos: u64, asks: &[&str]| {
        json!({"kind": "ask.batched", "id": id, "writer": writer, "log_pos": log_pos, "data": {
            "batch": "b", "asks": asks.iter().map(|ask| json!({"ask": ask, "plan_hash": null})).collect::<Vec<_>>(),
        }})
    };
    let events = vec![
        ask("A", "authority", push()),
        ask("B", "authority", push()),
        ask("C", "authority", push()),
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
        ask("A", "authority", push()),
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
    let plan = |ask: &str, steps: Value| {
        json!({"kind": "plan.proposed", "id": format!("P{ask}"), "writer": "core", "log_pos": 2, "data": {
            "ask": format!("ask:{ask}"), "diff": "d".repeat(64), "hash": ask.repeat(64), "steps": steps}})
    };
    let step = |does: &str, undo: &str| json!({"does": does, "changes": [], "undo": undo, "public": false, "cost": 0});
    let events = vec![
        ask("A", "authority", push()),
        ask("B", "authority", push()),
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
    let events = vec![
        ask("A", "authority", push()),
        ask("B", "authority", push()),
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
    closed
        .push(json!({"kind": "ask.superseded", "writer": "core", "subject": "ask:B", "data": {}}));
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
        ("Answering saves it for this task", 1)
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
    let get = |name: &str| field(&model, name);
    assert_eq!(get("checks"), Some("2 of 3 passed"));
    assert_eq!(get("look at"), Some("checkout.tsx:42"));

    // A rerun of the unit check that hasn't finished: its passed run before it no longer counts.
    events.push(json!({"kind": "run.started", "data": {"run": "r6", "check": "unit", "claim": "c", "commit": pinned}}));
    let model = Model::read(&events, "ask:T", 0).unwrap();
    let get = |name: &str| field(&model, name);
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
    let get = |name: &str| field(&model, name);
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
    let get = |name: &str| field(&model, name);
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
    let get = |name: &str| field(&model, name);
    assert_eq!(
        (get("checks"), get("look at")),
        (Some("1 of 1 passed"), None)
    );

    // A rerun started before a check failed: the failure, named by its check when it points nowhere, comes first.
    let mut later = vec![events[0].clone()];
    later.push(json!({"kind": "run.started", "data": {"run": "r7", "check": "unit", "claim": "c", "commit": pinned}}));
    later.extend(run("r8", "layout", &pinned, "failed", Value::Null));
    let model = Model::read(&later, "ask:T", 0).unwrap();
    let get = |name: &str| field(&model, name);
    assert_eq!(
        (get("checks"), get("look at")),
        (Some("0 of 2 passed"), Some("layout"))
    );
    // A run the core finished says why in its findings, never where it points.
    let mut stopped = vec![events[0].clone()];
    stopped.push(json!({"kind": "run.started", "writer": "core", "data": {"run": "r13", "check": "e2e", "claim": "c", "commit": pinned}}));
    stopped.push(json!({"kind": "run.finished", "writer": "core", "data": {"run": "r13", "check": "e2e", "outcome": "missing", "points_to": null, "findings": ["its stack never came up: db"]}}));
    let model = Model::read(&stopped, "ask:T", 0).unwrap();
    let get = |name: &str| field(&model, name);
    assert_eq!(get("look at"), Some("e2e: its stack never came up: db"));
    // Where a run points wins over its findings; pointing at nothing ("") is pointing nowhere.
    for (points_to, look) in [
        (json!("src/db.rs:4"), "src/db.rs:4"),
        (json!(""), "e2e: its stack never came up: db"),
    ] {
        stopped[2]["data"]["points_to"] = points_to;
        let model = Model::read(&stopped, "ask:T", 0).unwrap();
        assert_eq!(field(&model, "look at"), Some(look));
    }

    // Only a run still going: that is the thing to look at.
    let model = Model::read(&later[..2], "ask:T", 0).unwrap();
    let get = |name: &str| field(&model, name);
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
        ("Answering saves it for this project (my-shop)", 1)
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
        ("Answering saves it for this project (docs)", 1)
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
    assert_eq!(
        model.scope.clone().unwrap().words,
        "Answering saves it for this task"
    );
    assert!(Model::read(&odd, "ask:G", 0).unwrap().scope.is_none());

    // No project: the core saves for the session alone, though the worktree has a name.
    let model = Model::read(&events, "ask:D", 0).unwrap();
    let scope = model.scope.clone().unwrap();
    assert_eq!(
        (scope.words.as_str(), scope.also),
        ("Answering saves it for this task", 0)
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
    undone.push(json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:B", "data": {}}));
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
        states::moment(7_200_000, 0),
        "its default applies at the undo's deadline"
    );
}

/// #2403: in English each kind's first line is still its plain word from contracts/plain-words.json (#1348),
/// capitalised, so the table never drifts from the one list.
#[test]
fn each_kinds_first_line_is_its_plain_word_from_the_one_list() {
    for kind in [
        Kind::BatchedAuthority,
        Kind::Taste,
        Kind::Unblock,
        Kind::StalledClaim,
        Kind::Choice,
        Kind::Exception,
        Kind::Definition,
    ] {
        let name = kind.name();
        let word = crate::plain::words()
            .iter()
            .find(|(word, _)| word == name)
            .map_or(name, |(_, plain)| plain.as_str());
        let mut chars = word.chars();
        let first: String = chars
            .next()
            .map(|first| first.to_uppercase().chain(chars).collect())
            .unwrap_or_default();
        assert_eq!(copy::english(kind.plain_key(), &[]), first, "{name}");
    }
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
        "Answering saves it for this task"
    );
}
