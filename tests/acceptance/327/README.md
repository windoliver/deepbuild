# Acceptance tests for #327: the question card

Written blind at base commit `5a6d09a4` ("Merge pull request #785 …"), from the issue, the design docs and the
base alone, before any implementation. Nobody edits these; a dispute goes to a blind redraft.

## What was read

- Issue #327: its Scope, Fields and the sixteen acceptance criteria (IDs below are
  `#327.<first 8 hex of SHA-256(criterion text, whitespace collapsed)>`, as scripts/proof-change.mjs computes them).
- docs/canvas-primitives.md: Question card (its fields, `arm_after` 500 ms, `rearm_on`, a press counts only if its
  platform timestamp is 500 ms or more after the later of presentation and re-arm, down and up on the armed option,
  key repeat never answers, "Answers this ask only", "Sends your words as the reason; this won't run"); Band; the
  input router (`hid | synthetic(pid) | accessibility(client: voiceover | unknown)`); window placement.
- docs/technical-design.md: Decided ("Clicks on the question card", "Answers from the terminal", "Ask deadlines and
  defaults", "Question matching", "Open asks per session"), the asks section (every ask ends; a card says its scope
  and count fixed when presented; an ask matching while shown is decided for you and listed on the receipt; delivery
  outcomes), stalled claims, batched approvals (the step that can't be undone starts switched off; the approve button
  says how many it runs and how many can't be undone), the usage recording's rows, States people see.
- The base's surfaces: crates/deep-replica (Replica, Posted, Seen, kit, snapshot, shell), crates/deep-app (card.rs,
  notify.rs, trusted_input.rs, states.rs), crates/deep-show (#400's `run` scenario and card state machine),
  packages/asks (Card, Delivery, Asks.answer and its `ANSWER_FIELDS`, ask.answered@2, decisions and reconsult),
  packages/hub (ask.answer, stop hold, delivery.outcome), packages/contracts/schemas, and the prior blind suites of
  #326 (surfaces, panels), #400, #34, #23, #25 and #16, whose helpers these tests reuse.

## The surfaces

The issue names the replica, the hub's `ask.answer`, the arming state machine on a virtual clock, text snapshots,
usage rows, a LocalAuthentication stub and notifications with the window hidden. Where it names none, the smallest
real surface was chosen:

1. **The asks core in process** (`scope.test.ts`, `answers.test.ts` AC7/AC15/AC16): `openRecord` + `openAsks` +
   `resolverDecisions` on a virtual clock, as #23 did, through `helpers.ts`'s `World`. Reads the base's `Card` and
   `Delivery`, extended by this issue with (new names): `Card.saves: {scope: string, also: number} | null` (what the
   card says before it arms, fixed when presented), `Card.receipt: {answer, also: string[]} | null` (the answered
   card's receipt), `Delivery.image: sha256 | null`, the `image` answer field (a SHA-256 hex, refused at the base as
   "an answer has no field image"), and `ask.answered@2`'s data gaining `words` and `image` (the base writes neither;
   the tests accept `answer` holding the words for a words-only answer).
2. **A real hub** (`answers.test.ts` AC2): #34's `startHub`, a paired device, a Stop hook held for the open ask (the
   agent's next input, #25's stop hold) and a signed `ask.answer {option: 'c'}`; the reply and `delivery.outcome`
   are read from the record. Nothing new is needed of the hub.
3. **`deep-show run`** (`arming.test.ts` AC14): #400's scenario on the hub's virtual display clock, which already
   presents and arms the scenario's `card`. New: the `press` call
   `{call: "press", at, t, phase: "down" | "up" | "repeat", option, source: "hid"}` (`t` the platform stamp, `at`
   its delivery, both flicks), the `rearm` call `{call: "rearm", at, on: "content" | …}`, the `card` reply's
   `card.answer` (null or `{option, t}`) and the state `"answered"`, and two planted names, `arms_from_delivery` and
   `never_rearms`.
4. **The replica** (`card.rs`, `planted.rs`, `common.rs`): deep-replica, the app headless on gpui's virtual clock,
   as #326 used it; two `[[test]]` targets added to crates/deep-replica/Cargo.toml (`acceptance_327_card`,
   `acceptance_327_planted`). New surface on `deep_replica::Replica` (unavoidable: the base has no card to press):
   - `present(device, ask) -> CardSeen`, `present_in(device, ask, Slot {rect: [i64; 4], scrolled_out: i64})`,
     `card_seen(device) -> Option<CardSeen>`;
   - `CardSeen {ask, kind, seq: u64, state: "hidden" | "presented" | "armed" | "answered" | "expired", text, options:
     Vec<String> (labels in draw order), focused: Option<usize>, steps: Vec<Step {does, on, undoable}>, approve:
     Option<Approve {runs, cannot_undo}>, rect}`; `text` is the card's text snapshot, what assistive clients read;
   - `press(device, Input {at: u64 (platform stamp, ms on the virtual clock), source: Source, on: On, phase: Phase})`
     with `Source::{Hid, Synthetic {pid}, Accessibility {client: Client::{VoiceOver, Unknown}}}`,
     `On::{Option(index in draw order), Send, Undo, Step(index)}`, `Phase::{Down, Up, Repeat}`;
   - `key(device, "tab" | "space", at, source)` (Full Keyboard Access), `type_words(device, &str)`,
     `attach_image(device, &[u8])`, `toggle_step(device, index)`;
   - `confirmations() -> Vec<Confirmation {prompt: String, answered: Option<bool>}>` and `confirm(bool)` (answers the
     oldest open prompt): the LocalAuthentication stub at that boundary, never a real Touch ID prompt;
   - `answers() -> Vec<serde_json::Value>`: every `ask.answer` the app sent, as its params (`ask`, `option`, `words`,
     `image`, `plan_hash`, `token`, `steps`);
   - `usage() -> Vec<Value>`: the usage rows `{row: "presented" | "refused" | "answered" | "undone", seq, ask, kind, at}`;
   - `hide_window(device)`, `show_window(device)`; `open_asks() -> Vec<String>`;
   - `kill(self) -> Killed {sent: Vec<Value>, …}` and `Replica::relaunch(Killed) -> Replica` (the record survives,
     the app's state doesn't);
   - `Replica::planted(fixture, Planted::{NoScope, CountFollowsRecord, ClickByRecordIndex, NotificationActionAnswers,
     NoDefault, DiffAfterAnswer, AnswersOnExit, ReusesConfirmation, RecordsOnlyAnswers, AnswersSecondFromWords,
     TypedYesAllows})`: the wrong programs the criteria name, built into the app for planted.rs.
   The base's `Replica::{open, advance, now, append, notifications, click, card}` and `Posted` are used as they are.

Needs a person (BLOCKED, never PASS): VoiceOver, Voice Control and Switch Control (AC5). `card.rs` prints each as
`BLOCKED` with the exact manual step; the suite's exit is non-zero until a person records the result in
BASE-FAILURE.txt's manual section.

## How to run

From the checkout, Node 24 and the workspaces built (`npm run build --workspaces`):

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/327/tsconfig.json
node node_modules/vitest/vitest.mjs run --root tests/acceptance/327 --no-file-parallelism
cargo test --locked -p deep-replica --test acceptance_327_card
cargo test --locked -p deep-replica --test acceptance_327_planted
```

`arming.test.ts` builds `deep-show` itself (`cargo build --locked --bin deep-show`); don't run it beside a cargo
build. `answers.test.ts`'s AC2 starts a hub under a fresh `/tmp/dh16-*` home (the #16 helpers' temp home; nothing
touches `~/.deepbuild`). The implementer adds `tests/acceptance/327/` to scripts/lanes.mjs's `alone` list (that edit
needs a signed tag, so this job didn't make it). The fixtures are checked with:

```sh
node --input-type=module -e "
import { readFileSync, readdirSync, statSync } from 'node:fs';
const { validate } = await import('./packages/contracts/dist/index.js');
let bad = 0, n = 0;
const walk = (d) => { for (const f of readdirSync(d)) { const p = d + '/' + f; if (statSync(p).isDirectory()) { walk(p); continue; }
  const text = readFileSync(p, 'utf8');
  const events = f === 'live.json' ? Object.values(JSON.parse(text)) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l).event);
  for (const e of events) { n++; const r = validate(e.kind + '@' + e.v, e); if (!r.ok) { bad++; console.log(p, e.kind, JSON.stringify(r.issues)); } } } };
walk('tests/acceptance/327/fixtures'); console.log(n + ' events, ' + bad + ' invalid'); process.exit(bad ? 1 : 0);"
```

## Fixtures

`fixtures/` (97 events, all valid against their schemas; generated deterministically, IDs `01MD327…`):

- `base.events.jsonl`: three sessions (S1, S2 in `~/src/shop`, S3 in `~/src/docs`) with a task each, nothing asked.
  The Rust cases raise live asks into it from `live.json`'s templates: `taste` (blue/green on checkout · total),
  `taste-abc` (options a, c, b in record order, b recommended), `push` (approve "Allow" / decline "Decline") with
  `plan.proposed`, and `ask.answered`.
- `kinds/*.events.jsonl`: one open ask per card kind. `batched`: four authority asks (push, merge, delete, send) each
  with a `plan.proposed` step and one `ask.batched`; the delete's step has `undo: "can't be undone"`. `taste` (with
  `dropped` and its subject), `unblock` (`cost_usd` 12.5), `stalled` (a `claim.made`, a `claim.stalled` and the
  choice it raises: split / fund / accept with costs in the labels, pinned by `subject.point` to the claim), `choice`,
  `exception` (default "Change nothing"), `definition` (the early question about done; default "Leave it out").
- `past.events.jsonl`: two answered taste calls on checkout · total with their `decision.created` rows (the decisions
  table), one on cart · badge, and the open one on checkout · total.
- `moved.events.jsonl`: a provisional choice pinned to commit A, a `commit.made` on B, and a unit run that passed on B.

## Criteria → tests → wrong programs

| ID | Criterion | Tests | Wrong programs |
|---|---|---|---|
| `#327.fab7d30b` | Before the card arms, an answer that will be saved as a decision shows its scope in words and how many open asks it will also answer: with two matching asks open, the card says it answers 2 more, and answering closes exactly those two as decided for you; a third that comes to match while the card shows doesn't change the card and is listed on its receipt. A card that shows no scope, or a count that changes while it shows, fails this test | `scope.test.ts` (Card.saves, the decision's scope and the asks it closes, Card.receipt); `card.rs` ac1_… (the words "repo … shop", "2 more", the receipt with Undo) | `scope.test.ts` plants "a card that shows no scope" and "a count that changes while it shows"; `planted.rs` ac1_… (`Planted::NoScope`, `Planted::CountFollowsRecord`) |
| `#327.da06e3b1` | A taste call with options A, B and C, B recommended and drawn first, answered by a hardware click on C, records option C in `ask.answered`, and the agent's next input holds C's ID and label, with `delivery.outcome` delivered and acknowledged; a card that maps the click to the record's index delivers B and fails, naming the option | `card.rs` ac2_… (draw order B, A, C; the click on C sends `option: c`); `answers.test.ts` AC2 (on the hub: `ask.answered` records c, the held Stop's reply holds c and "C: cobalt header", not B's label; `delivery.outcome` delivered) | `planted.rs` ac2_… (`Planted::ClickByRecordIndex`, fails naming the option) |
| `#327.f53f09db` | With the app's window closed or hidden, every ask that shows at once reaches you as a notification carrying its question, its default and when the default applies; clicking it opens that ask's card, and no notification action writes an answer | `ac3_redraft.rs` (redrafted blind after a dispute over the default's wording) | `planted.rs` ac3_… and `ac3_redraft.rs` (`Planted::NotificationActionAnswers`) |
| `#327.a3e67d66` | A click inside the arm interval never answers the question card, and a synthetic click answers it only after the OS confirms you | `card.rs` ac4_a_click_inside_the_arm_interval_never_answers, ac4_a_synthetic_click_answers_only_after_the_os_confirms_you | (none named) |
| `#327.d3f997a2` | An accessibility action whose client is unknown answers the question card only after the OS confirms you with Touch ID or your password, and a test client that can't pass that confirmation never answers it; with Voice Control and with Switch Control, every card kind can be answered through that confirmation; with Full Keyboard Access, Tab reaches each option of every card kind and Space answers it once the card arms; and VoiceOver reads each card's question, options, deadline and default | `card.rs` ac5_an_unknown_client_action_…, ac5_a_test_client_that_cant_pass_…, ac5_with_full_keyboard_access_… (all seven kinds); ac5_with_voice_control_…, ac5_with_switch_control_…, ac5_voiceover_… are BLOCKED with the manual step | (none named) |
| `#327.c4f81936` | Each of the seven card kinds (batched authority, taste, unblock, stalled claim, choice, exception, early question about done) renders from its fixture in a replica, and its text snapshot holds the question, every option's label, the deadline, the default and when it applies, and the fields this issue's Scope lists for that kind; a card that leaves out the default fails, naming the kind; a batched approval shows the diff, whether the target is public and whether it can be undone, and approving part of a batch runs only those; in a batch of four where one step can't be undone, the approve button runs three, and the fourth runs only after its own switch is turned on | `card.rs` ac6_each_kind_renders_…, ac6_a_batched_approval_… | `planted.rs` ac6_… (`Planted::NoDefault`, per kind, fails naming the kind) |
| `#327.b12554f8` | An ask answered in your own words or with a screenshot reaches the agent, and the answer is saved with the decision | `answers.test.ts` AC7 (words with an option, an image with an option, words alone) | (none named) |
| `#327.38aabe79` | A taste card lists your past calls on the same screen and journey step, from the decisions table | `card.rs` ac8_… | (none named) |
| `#327.78f6951b` | A provisional choice whose pinned commit has moved shows the diff since then, with the checks that ran on it, before its card arms; a card that shows the diff only after the answer fails this test | `card.rs` ac9_… | `planted.rs` ac9_… (`Planted::DiffAfterAnswer`) |
| `#327.089d44f5` | With a presented, armed card, killing the app leaves the ask open with no answer, no default and its deadline unchanged; on relaunch the card presents again unarmed and arms after its interval; a shell that writes an answer or a default on exit fails, naming the ask | `card.rs` ac10_… | `planted.rs` ac10_… (`Planted::AnswersOnExit`, fails naming the ask) |
| `#327.918e0cbc` | With LocalAuthentication stubbed at that boundary, one confirmation answers exactly one card: an unknown-client action on the next card 2 s later raises a new prompt naming that card's question and option, and a cancelled prompt leaves the ask open; a shell that reuses the first confirmation fails, naming the second ask | `card.rs` ac11_… | `planted.rs` ac11_… (`Planted::ReusesConfirmation`, fails naming the second ask) |
| `#327.ff421b1d` | A view that reserves a 1 × 1 px slot, or one scrolled 1 px outside its area, presents a card that never arms, and a press on it records a refused click | `card.rs` ac12_… | (none named) |
| `#327.fd4714c7` | In a replica session, three cards presented, one click refused before arming, one answer and one undo produce exactly those usage rows, with the card's `seq`, kind and host time; an app that records only answers fails, naming the missing row | `card.rs` ac13_… | `planted.rs` ac13_… (`Planted::RecordsOnlyAnswers`, fails naming the missing row) |
| `#327.74732631` | The card's arming, tested as a state machine on a virtual clock fed timestamped press events: a press stamped 499 ms after presentation answers nothing and one at 500 ms answers; a press down at 450 ms and up at 700 ms answers nothing; a key repeat never answers; and after a `rearm_on` change at 300 ms a press at 600 ms answers nothing and one at 800 ms answers; a card that times arming from event delivery, or never re-arms, fails this test, naming the trigger | `arming.test.ts` | `arming.test.ts` planted `arms_from_delivery`, `never_rearms` (fail naming the stamps and the trigger) |
| `#327.2459a9a6` | A taste card answered by typing "darker, and keep the total in view" and pressing Send, with no option chosen, keeps the words with that answer beside `decision: none` and reaches the agent once; before the card armed it said "Answers this ask only", and a second open ask with the same key stays open, since the resolver never answers it from those words; a card or resolver that answers the second ask from the first one's words fails this test, naming the ask | `answers.test.ts` AC15 (the record: decision none with the words, delivered once, the second ask open); `card.rs` ac15_… ("Answers this ask only", Send sends the words alone) | `answers.test.ts` plants a resolver answering the second ask from the words; `planted.rs` ac15_… (`Planted::AnswersSecondFromWords`) |
| `#327.f9d8bea9` | On a push's authority card, typing "yes" and pressing Send says before it arms "Sends your words as the reason; this won't run", records `decision: none` with the words, and the push is denied with them as its reason; only pressing the Allow option, once the card arms, runs the plan; a card that reads the typed "yes" as allow fails this test, naming the card | `answers.test.ts` AC16 (the record: decision none with "yes", `authorized()` null, the agent told with the words; Allow with the plan's hash and the token authorizes); `card.rs` ac16_… (the words before arming, Send sends words alone, Allow sends `approve` with `plan_hash` and `token`) | `answers.test.ts` plants a card reading "yes" as allow; `planted.rs` ac16_… (`Planted::TypedYesAllows`) |

## What the base has, and how each file fails there

See BASE-FAILURE.txt for the runs (vitest: 15 tests, 8 passed, 7 failed; both cargo targets don't compile). In
short: the base's `Card` has no `saves`/`receipt`, its `ask.answer` refuses the `image` field and drops the words of
an answer with an option, `deep-show run` answers a scenario with a `press` call `bad_input`, and deep-replica has
no card surface, so `card.rs` and `planted.rs` don't compile. The hub half of AC2 and the record halves of AC7
(words alone), AC15 and AC16 in `answers.test.ts` already hold at the base (#34's `ask.answer`, #25's stop hold, a
words-only answer is decision none and delivered once, a typed "yes" never authorizes): those `it`s pass there and
are kept as the regression protection the criteria name; the halves the criteria add fail in `card.rs`. Of
`scope.test.ts`'s two plants, "no scope" is caught at the base by the same failure as the app (every base card shows
no scope) and "a count that changes" isn't judged there (the scope fails first); both judge something only once a
right card exists.

## Assumptions a redraft may revisit

- The scope "in words": the card's text names the repo (`repo`, `shop`) and the count as "2 more"; the in-process
  `Card.saves.scope` is a sentence containing "repo" and the project's name.
- "When the default applies" is checked as the digit and unit of the time left ("3 d", "1 d", "4 h"), so "3 days"
  passes too; the default is named after the word "default".
- The stalled claim's card is a `choice` ask raised from `claim.stalled`, pinned by `subject.point` to the claim,
  with split / fund / accept options whose labels carry costs in USD; the base has no ask source for it.
- A plan step that can't be undone says so in `undo` ("can't be undone"); `plan.proposed@1` has no boolean for it.
- A batched approval is read from the first ask of the batch; the answer it sends carries `steps`, the indices run.
- The "diff since then" of AC9 is judged by the card naming both commits' short SHAs, the check that ran (`unit`)
  and its outcome; the replica can't run git.
- AC2's hub half uses the Stop hook the hub holds as "the agent's next input" (#25's route); "acknowledged" is read
  as the hook continuing with the answer (the held reply is returned) and `delivery.outcome` delivered.
- The usage row for an undo is `undone`; an answered card's receipt is reached by `On::Undo`.
- Screenshots are sent as their SHA-256 (`image`), as the Question card's `answer.image` field says.
- The `press` call's `t` is the platform stamp and `at` its delivery, 10 ms later; the ask of AC14 is placed 4 ms
  off the display's vsync grid so a card timing from delivery arms 4.3 ms early and the 499 ms press catches it.
