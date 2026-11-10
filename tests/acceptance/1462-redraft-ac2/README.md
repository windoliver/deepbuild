# Acceptance test for #1462, criterion 2 redrafted: two asks, a session opened and paused, the Map and back, by keys alone

A blind redraft (design: Dogfooding; Tests written first, by a job that never sees the code) of AC2's real-app test, by
the job that wrote `tests/acceptance/1462/`, from the same inputs, at base `d51be2c3` plus that suite (`a7dee168`). No
implementation of #1462, diff, other worktree, branch or PR was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof).

**It supersedes** the AC2 test in `tests/acceptance/1462/real.test.ts` (`describe` "AC2 #1462.61a5fe15 …", its
`noPointerProblems`), which read the pause as `subject === "session:<id>"` with the session's UUID, hyphens and all. No
event the base's contracts accept can carry that subject: every schema that names a session in its subject allows only
`session:` and letters and digits. That test could never pass, whatever the app did. The first suite's other tests
stand.

## What was read

- Issue #1462 as it reads now (`gh issue view 1462 --repo windoliver/deepbuild`): its Scope, 22 criteria and Proof.
- `docs/technical-design.md`: Keymap, placement, window; Needs-you view; the `view` row of First-party extensions
  ("Pause makes the PreToolUse hook deny the session's next tool calls with your reason until you resume it"); Replica;
  States people see; Dogfooding; Tests written first.
- At the base: `packages/contracts/schemas` (`session.state@1`, `session.attention@1/@2`, `session.continued@1`,
  `session.archived@1`, `session.end@2`, `ask.answered@1`–`@5`, `ask.later@1`; the 16 schemas whose subject is exactly
  `^session:[0-9A-Za-z]+$`, and all 182 whose subject pattern can name a session, each allowing only letters and digits
  after `session:`); `packages/record/src/index.ts` (`append` refuses a kind with no schema; `toEvent`, the
  envelope's `session`); `packages/record/src/projections.ts` (`sessionOf`, "A handle holds a session's ID by its letters
  and digits"); `packages/hub/src/core.ts` (`letters`, and each session event it appends with
  `subject: session:${letters(id)}` and the session's ID in the connection); `packages/asks/src/index.ts` (`ask.answered`'s
  subject and `via`); `crates/deep-app/src/{commands,address,open,views,card,question,words}.rs`.
- This job's first suite: `tests/acceptance/1462/` README (Pinned, Disputes), `helpers.ts`, `probe.swift`,
  `real.test.ts`, `BASE-FAILURE.txt`; and `scripts/proof-change.mjs` (criterionId).

## How to run

With Node 24 first on `PATH`, the workspaces built (`npm ci --ignore-scripts && npm run build --workspaces`), cargo first on
`PATH` (`$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`), Xcode's command line tools (`swiftc`), on macOS, in a
logged-in, unlocked session whose test process has Accessibility and Screen Recording:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/1462-redraft-ac2 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1462-redraft-ac2/tsconfig.json
rm -rf tests/acceptance/1462-redraft-ac2/node_modules/.vite
```

`../1462/helpers.ts` and `../1462/probe.swift` are used by import as they stand: they build `deep-app` with
`--features test-confirm` (and the plain one after it) and `deep-hook`, copy the app out under its own name, compile the
probe, start #26's hub and agent stand-in in a `/tmp/dh26-…` home, and stop only what they started, by PID. Nothing touches
the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`. Without Accessibility, Screen Recording or an unlocked
screen the test fails `BLOCKED: …`, never passes. `scripts/lanes.mjs` needs `tests/acceptance/1462-redraft-ac2/` in its
`alone` list, in a macOS, logged-in lane; the implementer makes that edit.

## The surface

The real `deep-app` (`test-confirm` build, `DEEP_APP_TEST_CONFIRM` holding `confirmed`: #1454's stand-in for the OS
confirming you, the first suite's Pinned 9) on #26's real hub, its record seeded before the hub starts with three sessions
of project `shop` (`Cart totals` with a taste call, `Release notes` with a choice, `Search index`). Its keys are posted to
its PID alone by `probe key` and `probe type`; nothing clicks. What the app did is read from the record through
`events.read`; where the window is and what holds the keyboard are read as an assistive client reads them: the page
node's identifier is its address (#1460), `AXFocusedUIElement`'s identifier is the row or control with the keyboard, rows
are `session:<id>` and the project's heading `project:<project id>`, the card is `question-card` with its value and its
options `card-option:<option id>` (the first suite's Pinned 7, 8, 19, used as they stand). Back is ⌘[, the base's own
chord for it (`crates/deep-app/src/commands.rs`, #1460), which the issue says never moves to another action.

### Pinned here: the implementation must provide these

1. **Pause's record.** Pause on a session is recorded as one `session.paused` event about it, read the way the base's
   contracts let a hub write a session: its `subject` is `session:` and the session's handle, its ID with every character
   but letters and digits removed (`^session:[0-9A-Za-z]+$`, as in `session.state@1`, `session.attention@2`,
   `session.continued@1` and the rest; `core.ts` writes `session:${letters(id)}`), a `#part` after it ignored as
   `projections.ts`'s `sessionOf` ignores it; an event with no subject is about the session its envelope's `session`
   names. The kind needs its schema in `packages/contracts/schemas`, since the record refuses an uncatalogued kind.
   This replaces the first suite's Pinned 18 (`subject: session:<id>`); the kind's name is unchanged.
2. **Running an action by keys** (Next ask, Pause) is what the menu bar teaches: the key the real app's menu bar shows
   beside the item whose name starts with the action's name, any case (Go's "Next ask" and the Session menu's "Pause",
   the issue's Scope), read by `probe menubar` without opening a menu (the first suite's Pinned 5); where it shows none,
   ⌘K, the name, Return. The action table's file isn't read.
3. **Return on a card** goes to the option that holds the keyboard. Before it, F6 is pressed until the keyboard is on a
   `card-option:` control, at most three times (F6 moves between the list, the page and the box), then the card must read
   `armed` within 10 s.
4. **Pause with your reason.** If Pause records nothing in 5 s and has put the keyboard in a text field (`AXTextField`,
   `AXTextArea`, `AXComboBox` or `AXSearchField`) other than the box (`box-draft`), the test types a reason and Return, as
   the design's Pause "with your reason" reads, then waits 20 s more.

## Criterion to test

| Criterion | ID | Test | Each step, and what it's read from |
|---|---|---|---|
| AC2 | `#1462.61a5fe15` | `ac2-real.test.ts` | 1–2: two asks answered: when the window isn't on an open ask's page (`ask/<ULID>`), Next ask (Pinned 2) must bring it to one within 10 s; F6 to the card (3); the card reads `armed`; Return; the record holds `ask.answered` with that ask's handle as subject and `via: "card"` within 20 s. 3: F6 and the arrows put the keyboard on the row `session:<id>` of `Search index`; Return; the window's address is `session/<id>` within 10 s. 4: Pause (Pinned 2, 4) on that page; the record holds `session.paused` about the session (Pinned 1) within 25 s. 5: F6 and the arrows put the keyboard on the heading `project:shop`; Return; the address is `project/shop` within 10 s. 6: ⌘[; the address is the one shown before the project's page opened (the session's page) within 10 s |

The ID is `scripts/proof-change.mjs`'s criterionId, recomputed from the issue as it reads now: the first 8 hex of the
SHA-256 of the criterion's text, trimmed, white space collapsed. It equals the first suite's, since the text is
unchanged. **Wrong programs it fails on:** the base (no Next ask, no F6, no Pause, no project page; `BASE-FAILURE.txt`
holds one run, BLOCKED by a locked screen); a Pause that records nothing, or records it about another session; a list Return or ⌘[ that opens
the wrong page; an answer recorded anywhere but the card.

## Disputes and assumptions a redraft may revisit

1. **The kind's name.** `session.paused` is still this job's name for what the hub records; nothing at the base pauses a
   session. A later redraft may read another kind once the issue or the design names one, as long as it reads the
   record and the session as the contracts write it.
2. **The reason.** The design gives Pause your reason; the issue says no more. Pinned 4 types one only when Pause asks
   for it by focusing a field; a Pause that asks some other way, or opens a dialog the probe can't see, fails here.
3. **Keys from the menu bar** (Pinned 2), not from `crates/deep-app/src/actions.json`: AC1 makes the two the same, and the
   menu bar is the surface a person learns the key from.
4. **"Returns"** is Back to the page shown before the project's opened, the session's page; returning to the list by
   Escape would read as a failure here.

## Files

- `ac2-real.test.ts`: the test.
- `tsconfig.json`, `BASE-FAILURE.txt` (the one run at `a7dee168`: BLOCKED by a locked screen before any key reached the
  app, so the base's failure on the test's own assertion is still to be recorded on an unlocked screen).
