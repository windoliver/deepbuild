# Acceptance tests for #2029: words for what the record says, and receipts read from the call's own records

Written first and blind, at base commit `04f44a4ba`, from issue #2029 (its Scope, its "Reads under #1453, Nov 9"
paragraph, both acceptance criteria and Proof), the design and the base, before any implementation. The implementing
agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- **The issue**: Scope (every closed-set code the core records, ask outcomes, stop causes and verdict reasons, has words
  in each view that shows it, checked by a test against the contracts, and a code a view doesn't know shows the core's
  text, never a blank or the raw code; an answered authority card's receipt says what the approved step did once it ran,
  read from the call's own records, PostToolUse, PostToolUseFailure or a plug-in action's `action.reported`, never from
  the agent's text, in its four forms, and a plan of several steps says how many ran and how many failed), Reads under
  #1453 (Decided for you is the Decided page; a receipt stays on its answered row while Undo is live, #1807), the two
  criteria and Proof. For context only: #328 (parent), #1461, #2026, #1807, #1453.
- **The design**, `docs/technical-design.md`: First-party extensions that ship on by default (the `view` row: Needs you,
  what was decided for you, the return card's plug-in actions from `action.entered` and `action.reported`); Decided;
  Composition and Socket roles (every closed set says in its closure whether it is exhaustive or extensible, with an
  `unknown` member a reader takes for any member it doesn't know); the hook protocol; Blocks for plug-ins that do real
  work (`action.entered`, `action.reported`); Plans before acting (the step drawn from the call, the hold before what
  can't be undone and its receipt, Undo); An ask, and your answer getting back (the outcomes' closed set, batches and
  the approve button, the trusted path); Before each command (the push, PR and merge defaults); Tasks close themselves
  (a call with no recorded end, "outcome unknown").
- **The base**, for its surfaces only: `packages/contracts` (the schemas `answer.refused@1`, `agent.stop@5`,
  `verdict.made@1`, `verdict.outcome@1`, `ask.machine@1`, `ask.answered@5`, `ask.batched@1`, `tool.after@3`,
  `plan.proposed@2`, `adapter.facts@5`, and `listSchemas`/`getSchema`); `packages/hub/src/{server,core,holds,hookmap,
  trusted,named,plant}.ts`; `packages/asks/src/index.ts` (the card and its receipt, answers with `steps`, batches and
  your visits); `crates/deep-app/src/{question,open,record,answer,states,plain,views,words}.rs`;
  `crates/deep-replica/src/{main,lib}.rs` and `drive/{mod,frames}.rs`; `crates/deep-hook/default-rules.json`;
  `adapters/claude-code.facts.json` and its corpus's PostToolUseFailure; the suites `2026`, `1461`, `1523`, `16`, `26`,
  `34`, `65/redraft-1579` and `327`.

## How to run

With Node 24.22 first on `PATH`, cargo (1.99.1) on `PATH`, on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
npx vitest run --root tests/acceptance/2029 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2029/tsconfig.json
```

- **Builds.** In one grant of `scripts/throttle.mjs build --wait 60`, with #1172's build environment
  (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`), the helpers build `deep-hook` into the checkout's target, where
  the hub looks for it, then `deep-drive` with `-p deep-replica --features env-plants`, then `deep-drive` and
  `deep-replica` plain, copying each replica out of the target folder into `$TMPDIR/da2029-bin-<uid>-<checkout>/`, so a
  planted build never stands in for the plain one and another checkout's never stands in for this one's. When every
  copy and `deep-hook` is newer than every file the Rust build reads (`crates`, `vendor`, `contracts`, `brand`,
  `adapters`, the contract schemas, the Cargo and toolchain files), the build is skipped, so a run doesn't queue for a
  build with nothing to do. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents` (the build throttle keeps its own lock table, as every lane's builds do). Only
  what a test started is stopped, by PID. No network, no model: the hub's runner finds no agent CLI on its login path.
- **Windows.** Nothing opens a window: `deep-replica` and `deep-drive` draw headless.
- **Lanes.** The files start hubs and draw, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list in a macOS
  lane; the implementer makes that edit.
- Vitest writes `tests/acceptance/2029/node_modules/.vite/` under `--root`; delete it before committing.

## The surfaces (my choice where the issue names none)

### AC1: the sets, and each view's words

**The sets** (`helpers.ts` `codeSets`) are read from `@deepbuild/contracts`' published schemas through its public entry
(`listSchemas`, `getSchema`), never copied into the test:

- **Ask outcomes**: the enum of a published `ask.outcome@<n>` when there is one (as `verdict.outcome@1` is the five
  verdicts'), else the newest `answer.refused`'s `data.outcome`, the one schema that holds the design's closed set
  (answered, decided for you, escalated, defaulted, unanswerable, cancelled, superseded, moot) with unanswered.
- **Stop causes**: a published `stop.cause@<n>`, else every `cause` the newest `agent.stop`'s `data` allows (its
  `unknown` member included, which a reader takes for any cause it doesn't know).
- **Verdict reasons**: a published `verdict.reason@<n>`, else the closed members of the newest `verdict.made`'s
  `reasons` (a string enum, or the enum of each reason's `code`). At the base the reasons are free text, so this set
  doesn't exist yet and the test fails naming it.

**Each view's words** come from the real app code through the replica, `deep-replica --words` (Pinned 1). The issue
names no surface; a view can be shown a code only through a record that carries it, and no record can carry a planted
code, so the views are asked for each code directly, through the same function each one draws that code with. The test
hands each code the core's text, a sentence no view could have for it, so a view that doesn't know the code draws that
text and is caught.

### AC2: the receipt

**The record** is a real hub's (`deep hub run` in a temp HOME, `helpers.ts` `world`): the shipped default guards
(`rules.json` from `crates/deep-hook/default-rules.json`), your ask settings, a git repository `shop` with one commit
on `main`, the OS confirming you (`DEEP_HUB_TEST_CONFIRM`). A Claude Code session (`helpers.ts` `Agent`, its agent's
process a `sleep`) sends its hooks on the hook wire as deep-hook sends them (#16's `sendHook`), its transcript beside
them as Claude Code writes it. You typed "Fix the login bug in src/auth.js.", which names no push, so each `git push` is
held by `push-needs-ask` with an authority ask: the base's own path (`holds.ts`).

**Allowed on its card**: the card's allow option is sent as the app's card sends it (`crates/deep-app/src/answer.rs`):
`ask.answer {ask, option, plan_hash, token, steps?}` on an app connection, signed by a device paired with the hub for
this hub (#1579's format), bound to the plan the card showed (`ask.card`) and a click's token. The replica can't press
the card for a real hub: it stands in for the hub and keeps what the app sends (#1461, Pinned 5). Then the agent runs
the same call again, as the hold told it to, and it goes through.

**The receipt is read where a person reads it**: the answered ask's page, `ask/<ULID>` (#1460's address), in the app's
views drawn headless by the real `deep-drive` (#124) over a copy of that hub's record (`launch.from: "record_copy"`,
then `open`, then `see`). That page is where Decided for you opens an answered ask (#1807: each opens its card in its
closed state) and where Needs you keeps the card you just answered; the Decided page and the answered row's Undo window
are #1807's and aren't built at the base. The receipt's words are judged as they read: each expected piece must be one
of the page's strings (a node's name or value, the drawn text runs among them), or within them joined, whitespace
collapsed.

### Merged surfaces, used as they are

`deep hub run`; the hook wire (#16's `sendHook`, `hookRequest`); `events.read`, `ask.card`, `device.pair` and
`ask.answer` on the hub's socket; the shipped guards `push-needs-ask` and `authority-push`, which deep-hook meets on a
`git push` and names in `matched`; the asks core's batches (`asks.batch` in config.json, `ask.batched`) and its answer
with `steps` (#327); Claude Code's PostToolUseFailure payload (`error`: "Exit code 1\n…", the adapter corpus's shape);
`deep-drive`'s `launch`, `open` and `see`; `deep_app::plain::planted` and the `env-plants` feature.

### Pinned here: the implementation must provide these

1. **`deep-replica --words`** (AC1). On stdin, one JSON array of `{"set", "code", "core"}`, `set` one of `ask.outcome`,
   `stop.cause` or `verdict.reason`, `core` the core's text for that code. On stdout, one JSON array with an answer per
   item, in order: `{"set", "code", "views": [{"view", "shows"}]}`, one entry for each of the app's views that shows
   codes of that set (named as the app names it), `shows` the text that view draws for this code, through the same
   function it draws it with when the record holds it: its own words for a code it knows, the core's text for one it
   doesn't. Exit 0. Every set must be shown by at least one view.
2. **The receipt on the answered ask's page** (AC2). Once an authority ask is answered, the page `ask/<ULID>` shows its
   card's receipt in the issue's words: "Allowed · it failed: <the target's first error line> · the agent was told",
   "Allowed · outcome unknown", and for a batch "<n> ran · <m> failed" with the failed step's error line.
3. **The call's records carry what the receipt needs.** The error line comes from the PostToolUseFailure's `error`, which
   the base doesn't record (`tool.after@3` keeps the outcome, the exit code and a signature, not the line): the hub must
   keep the target's first error line, clamped and scrubbed, where the app can read it.

### Plants

Each is selected by `DEEP_HUB_PLANT=<name>` and read through `deep_app::plain::planted`, in `deep-drive`'s `env-plants`
build only (`-p deep-replica --features env-plants`; a release build refuses it). The hub is given the variable too only
when `packages/hub/src/plant.ts` lists the name (`helpers.ts` `hubLists`), for a receipt the hub makes: the hub refuses a
plant it doesn't list, so a hub-side plant must be listed there, and an app-side one needs no listing.

- `receipt-stays-allowed` (AC2): the receipt of an allowed step reads "Allowed" and nothing more, whatever the call's
  records say. It must fail, naming the ask.
- `receipt-from-agent-text` (AC2): the receipt takes what the step did from the agent's next message ("Pushed main to
  origin.", in its transcript and its Stop's `last_assistant_message`), not from the call's records. It must fail,
  naming the ask.

The planted outcome (AC1) needs no plant in the project: it is the contracts' ask outcome set with one member more,
`planted_outcome`, judged by the same judge, which must fail naming it.

A plant's test holds the clean run to the same judge first, so a program that already fails the criterion can't make
its plant look caught, and a plant the build ignores fails ("wasn't caught").

### The fixtures

- **AC1**: the three sets as read; each code's core's text is `The core recorded <set> <10 hex of SHA-256(set:code)>.`
- **AC2, one push**: session A pushes `git push origin main`, held; allowed on its card; run again, it fails with
  Claude Code's `error` `Exit code 1\n ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to
  'github.com:acme/shop.git'\nhint: …`; the agent then says "Pushed main to origin." and its turn ends (Stop). Session B
  pushes `git push origin release`, held; allowed on its card; run again, its PreToolUse goes through and no
  PostToolUse or PostToolUseFailure ever comes; its turn ends.
- **AC2, a batch**: your visits come every 2 minutes (`asks.batch.every: "2m"`). Inside one window, one session's
  `git push origin main`, `git push origin v2.0.0` and `git push origin release` are held; after the next visit's time
  the agent's turn ends waiting on your answer ("The three pushes wait for your answer."), and the hub, reading the
  asks again at that stop, shows the three as one batch (`ask.batched`). The batch is approved on its first step's card
  with all three steps. The agent runs them in the batch's order: the second is rejected (`! [rejected] <ref> -> <ref>
  (already exists)` for the tag, `(fetch first)` for a branch), the others go through (PostToolUse).

## Criterion to tests

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 a test reads the ask outcome, stop cause and verdict reason sets from @deepbuild/contracts and fails, naming each code a view has no words for | `#2029.9136787a` | `words.test.ts` (1): the three sets read from the contracts; each code asked of every view that shows its set; a view drawing a blank, the raw code or the core's text for a code fails, naming the view and the code; a set no view shows fails, naming its codes; a set the contracts don't close fails, naming it | the base (no closed verdict reasons; no view gives words: `deep-replica --words` isn't there); a view with no words for one code; a view that shows `decided_for_you` or `plan_window_spent` as is |
| AC1 a planted outcome added with no words fails, naming it | `#2029.9136787a` | `words.test.ts` (2): the clean sets pass first; the ask outcome set with `planted_outcome` added fails, naming `planted_outcome` and nothing else | a view that writes made-up words for any code it doesn't know (then the plant isn't caught) |
| AC2 a push allowed on its card whose `git push` fails reads "Allowed · it failed: ! [rejected] main -> main (fetch first) · the agent was told" | `#2029.af116b92` | `receipt.test.ts` (1) | the base (the page says how the ask closed, no receipt); a receipt that names Claude Code's "Exit code 1" line, or the hint |
| AC2 one whose PostToolUse never arrives reads "Allowed · outcome unknown" | `#2029.af116b92` | `receipt.test.ts` (2) | the base; a receipt that reads "ran" or "not run yet" once the call started |
| AC2 a batch of three allowed steps where the second fails reads "3 ran · 1 failed" with that step's error | `#2029.af116b92` | `batch.test.ts` | the base; a receipt that counts only the answered card's own step |
| AC2 a receipt that stays "Allowed" fails, naming the ask | `#2029.af116b92` | `receipt.test.ts` (3): clean first, then `receipt-stays-allowed` must fail naming the ask | `receipt-stays-allowed` |
| AC2 a receipt that takes "pushed" from the agent's next message fails, naming the ask | `#2029.af116b92` | `receipt.test.ts` (4): clean first, then `receipt-from-agent-text` must fail naming the ask; any receipt line holding "pushed" fails | `receipt-from-agent-text` |

No test passes when its surface is missing: a missing build, binary, hub, ask, record or page stops it `BLOCKED: …` or
fails naming what's missing.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: "Allowed · ran" and "Allowed · not run yet"; a plug-in action's
receipt from `action.reported`; the receipt on the answered row in Needs you while Undo is live and on the Decided page
(#1807); what "clamped and scrubbed" does to a long or secret error line; the words `deep`, `deep inbox`, `deep status`
and the channels use for codes (they aren't the app's views); which views show which set.

## Disputes and assumptions a redraft may revisit

1. **AC1 reads each view's words through a seam** (`deep-replica --words`), not from drawn pages, since a record can't
   hold a planted code and the criterion's test is against the contracts. A redraft could draw pages once a record
   carries every code of a set.
2. **The ask outcome set** is `answer.refused`'s `outcome` until an `ask.outcome@<n>` is published; **the stop causes**
   are `agent.stop`'s, `unknown` included. **The verdict reasons** need a closed set the base doesn't have; where the
   implementation puts it (its own schema, or an enum on `verdict.made`'s reasons) is read either way.
3. **The raw code** is the code as recorded: a view drawing exactly the code, or drawing a code that holds `_`
   anywhere in its text. A one-word code drawn capitalized ("Moot") isn't caught as raw.
4. **The core's text** for a code is handed in by the test; a view that doesn't know a code draws that text (Scope).
   A view that draws its own made-up words for any unknown code passes AC1's first test and fails the planted one.
5. **The receipt's place** is the answered ask's page, as Reads under #1453 and #1807 put Decided for you's cards; the
   Needs you row while Undo is live would need #1807 and #1101.
6. **The error line** is fed as the criterion writes it, single-spaced (git pads its status column; collapsing that
   isn't asked), after Claude Code's own `Exit code 1` line, which is no line of the target's. The receipt must quote
   the `! [rejected]` line as it reads, git's leading space trimmed.
7. **"PostToolUse never arrives"**: the allowed push's PreToolUse goes through, so the call started, and neither a
   PostToolUse nor a PostToolUseFailure comes before its turn ends.
8. **"A batch of three allowed steps"** is three held pushes your next visit shows as one batch, approved on one card
   with every step switched on; "the second" is the second in the batch's order; the receipt read is the answered
   card's, the first step's page. At the base the hub reads the asks again only when a stop or a verdict lands or a
   deadline passes (core.ts, the asks beat), not at a visit's time, so the agent's turn ends after that time; a hub
   that also reads them at the visit shows the same batch.
9. **The agent's next message** is "Pushed main to origin.", in the transcript and the Stop's `last_assistant_message`;
   any receipt line holding "pushed" fails. The batch's agent also says it pushed, which a receipt must not repeat.
10. **The session's hooks go on the hook wire**, not through deep-hook: on this loaded Mac deep-hook often misses its
    50 ms and lets a call through as with the hub down, which would let a push run with no ask. The entries deep-hook
    meets on `git push` (`authority-push`, `push-needs-ask`) go in `matched` as it sends them.

## Files

- `helpers.ts`: IDs, plants and the pinned words; builds; the contracts' sets and the AC1 judge; the hub world, the
  session, the hold, the card's answer and the run; the replica's page reads and the AC2 judge. Reuses
  `../16/helpers.ts`.
- `words.test.ts` (AC1), `receipt.test.ts` (AC2: one push, outcome unknown, both plants), `batch.test.ts` (AC2: the
  batch).
- `tsconfig.json`: as #2026's. `BASE-FAILURE.txt`: the run at the base.
