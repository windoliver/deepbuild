# Blind redraft of #667 AC3, AC4 and AC5: the authority ask's answers, the defaults at the deadlines, and the fold

Written blind at base `531da1ef0` (Merge pull request #2910, `origin/main`) from issue #667 (body last edited
2026-10-22T17:11:09Z: its summary, Scope, five criteria, Proof and Depends on; its comments not read),
`docs/technical-design.md` and the base, by a fresh run of the blind acceptance-test job (AGENTS.md, Proof; design,
Dogfooding) for three criteria. It never saw an implementation plan, a session, a diff or a dispute. It edits no file
outside this folder; the earlier #667 suite (`../`) is an input it imports from and doesn't change.

## The criteria

- AC3 `#667.a91c9ea1`: "The authority ask answered from a process inside the asking session's process tree is refused
  and stays open; answered by the person with the OS confirmation, it counts; with the confirmation cancelled, it saves
  no decision and stays open"
- AC4 `#667.47e397e9`: "With the clock moved past the choice ask's deadline and no answer, it takes its default,
  announced on the stream and recorded as defaulted, and an undo opens it again; the authority ask past its deadline
  takes no, recorded as defaulted"
- AC5 `#667.b9deefc5`: "The sixth open ask from one session lands inside one "this session keeps asking" exception in
  `deep inbox`, and answering that exception in bulk closes all six; a hub that lets the deadline pass with the ask
  still open fails this test, naming the ask"

And the Proof's two wrong programs: "A planted hub that skips the default at the deadline and a planted inbox that
counts an answer from inside the session's process tree must each fail, naming the criterion."

### Criterion IDs

Computed here as `criterionId` in `scripts/proof-change.mjs` does: the first 8 hex digits of the SHA-256 of each
criterion's text after `- [ ] `, trimmed, with white space collapsed, from the body `gh issue view 667` serves today.
They match the IDs this job was given. Every test name and every failure message starts `AC<n> #667.<id>`; the earlier
suite's `AC` map (`../helpers.ts`) holds older IDs and isn't used for names.

## What was read

- AGENTS.md; issue #667's body (`gh issue view 667 --json body`).
- `docs/technical-design.md`: An ask, and your answer getting back ("Every ask ends", the fold, "Where they reach you",
  `deep inbox answer` counting once the OS confirms you); Lifecycles; Ask; Decision and rule; Socket roles and contract
  versions (the peer check, "The trusted path is a device you paired", the exit-code table); the threat rows "Injected
  answers" and "Agents driving other agents' terminals"; the App API's live stream; States people see (`deep inbox`
  puts the question first and the handle last); Dogfooding.
- At the base: `packages/hub/src/inbox.ts` (`deep inbox`, `answer`, `undo`, `--json`), `trusted-actions.ts` (the
  peer check before the OS confirmation), `confirm.ts` (`DEEP_HUB_TEST_CONFIRM`), `human-answers.ts` (`inbox.read`,
  `ask.undo`), `rows.ts` (the list's ask rows), `server.ts` and `core.ts` (`DEEP_HUB_TEST_CLOCK`,
  `DEEP_HUB_TEST_CLOCK_STEPS` and `test.clock`, the asks beat), `plant.ts` (the plants `answer-inside-session` and
  `skip-default-at-deadline`), `packages/asks/src/index.ts` (raise, the fold and its `together`, `settle`'s defaults,
  `inbox()`), `packages/asks/sources.json` (the fold's row); `scripts/proof-change.mjs`; the earlier suite's README,
  `helpers.ts`, `scenarios.ts`, `fixtures/agent.mjs`, `BASE-FAILURE.txt`, and `redraft-1463/` for the layout.

## How to run

Node 24.22 first on `PATH`, macOS, from the checkout's root, after `npm ci && npm run build --workspaces` (the tests
run the built CLI, `packages/cli/dist/main.js`, and the hub it starts):

```sh
node scripts/throttle.mjs test -- npx vitest run tests/acceptance/667/redraft-2047 --testTimeout=600000 --silent=false
npx tsc -p tests/acceptance/667/redraft-2047   # type-check
```

Six tests, each on a world of its own, with no model and no network. Each world is `../helpers.ts`'s: a fresh
`/tmp/dh667-*` home (socket paths stay under 104 bytes), every hub and `deep` process run with `HOME` there, so
nothing touches your `~/.deepbuild`; every hub run with `DEEP_HUB_TEST_CONFIRM` naming the test's stub file, so no real
Touch ID prompt can appear; every process the tests started stopped by PID (`cleanup`), never by name or port. The
unit lane already runs `tests/acceptance/667/` alone (`scripts/lanes.mjs`), which covers this folder. Each test prints
its proof when it ends (`Proof`, shown with `--silent=false`): `deep inbox`'s output at each step, the stream's frames
with their log positions, and the record's ask, answer and decision rows.

## The surface

- **`deep inbox`, `deep inbox answer <ask> <option>` and `deep inbox undo <ask>`**, run as child processes: by you (a
  child of the test process), or by the agent stand-in through its own shell (inside its process tree). `deep inbox`
  is read for what a person sees, not its words: an ask is listed when a line names its ULID (its handle or its
  `deepbuild://ask/` link) other than a "decided for you" line; an item is a line at the margin with the indented
  lines under it.
- **`deep hub run`** with its test settings: `DEEP_HUB_TEST_CONFIRM` (#24's file stub, read at each confirmation:
  `confirmed` is the OS confirming you, anything else a cancelled prompt), `DEEP_HUB_TEST_CLOCK_STEPS=1` (the socket's
  `test.clock` steps the hub's clock forward while it runs) and `DEEP_HUB_PLANT`.
- **The socket**, as a `cli` connection holding the control token: `events.read` (the record's rows), `inbox.read`
  (#34's inbox read: each ask's status and outcome, and the log_pos it reflects), `stream.subscribe` (#34's live
  stream, framed by log_pos) and `test.clock`.
- **The agent stand-in** (`../fixtures/agent.mjs`): its hooks establish its session; its own `deep mcp` raises the
  choice and taste asks with `deep_ask` into the hub's asks core (`world.ts`, `ask`: the call may return at once, as
  a provisional taste call or choice does, and the ask is read from the record); it runs `deep` commands through its
  shell.
- **`~/.deepbuild/config.json`'s `asks` block** (#319), as `../helpers.ts` writes it: choice `4h`, authority `1d`,
  taste `3d`, defaults recommended and no, the fold at 5, no batch.
- **The record and asks core**, only to raise the authority ask before the hub starts (`seedAuthority`), as #24's
  tests do: no surface raises one into a running hub from a test (deep_ask writes no `allow` option).

### Wrong programs

Both exist at the base (`packages/hub/src/plant.ts`), selected with `DEEP_HUB_PLANT` on `deep hub run`:

| Name | What it does | Criterion | How the scenario fails on it |
|---|---|---|---|
| `answer-inside-session` | counts a `cli` answer from a process inside an agent session's process tree, as if you had answered (the OS still asked) | AC3 | `AC3 #667.a91c9ea1: ask ask:… (the authority ask), answered from inside session …'s process tree with the OS confirming, counted: it must be refused, save no decision and stay open` |
| `skip-default-at-deadline` | never takes an ask's default: past its deadline the ask stays open | AC4, AC5 | `AC4 #667.47e397e9: ask ask:… (the choice ask) is still open N s past its deadline …`; `AC5 #667.b9deefc5: ask ask:… (the sixth ask, folded into the exception) is still open N s past its deadline …` |

## Criterion to tests

| Criterion | Test | What counts as failure |
|---|---|---|
| AC3 `#667.a91c9ea1` | `criteria.test.ts`, AC3; `plants.test.ts`, AC3 on `answer-inside-session` | the seeded ask isn't an authority ask with a 1-day deadline and the default no; the answer run in the agent's shell with the OS confirming exits 0, closes the ask or saves a decision, or the ask leaves `deep inbox`; your answer with the confirmation cancelled exits 0, closes it or saves a decision, or it leaves `deep inbox`; your answer with the OS confirming exits non-zero, isn't one `ask.answered` `decline`, saves no decision (or more than one), or leaves the ask in `deep inbox` |
| AC4 `#667.47e397e9` | `criteria.test.ts`, AC4; `plants.test.ts`, AC4 on `skip-default-at-deadline` | the choice ask isn't a choice with a 4-hour deadline and the default `sqlite`, or the authority ask a 1-day one with the default no; with the hub's clock 1 s past the choice's deadline it is still open after a minute (naming the ask), or closes other than by one `ask.defaulted` `sqlite`, before its deadline, without `inbox.read` holding it `closed`/`defaulted`, or without the stream framing that event at its log_pos within 30 s; `deep inbox undo` exits non-zero, the ask isn't back in `deep inbox`, `inbox.read` doesn't hold it open and unanswered, or your answer `files` then doesn't count once; with the clock past the authority deadline it is still open after a minute (naming the ask), or closes other than by one `ask.defaulted` `decline` with decision `deny`, before its deadline, or without `inbox.read` holding it `closed`/`defaulted` |
| AC5 `#667.b9deefc5` | `criteria.test.ts`, AC5; `plants.test.ts`, AC5 on `skip-default-at-deadline` | the sixth ask raises no exception that says "keeps asking"; `deep inbox` shows no exception item saying "keeps asking", or more than one, or one without the exception's handle; it shows the sixth ask as an item of its own outside the exception; it doesn't list each of the first five on an item of its own; `inbox.read` doesn't hold the sixth `folded`, or holds one of the first five folded; the bulk answer exits non-zero, or any of the six isn't answered once with its recommended option, or any is left in `deep inbox`; in the second round, the sixth ask (a 4-hour choice, held `folded`) is still open a minute after the hub's clock passed its deadline (naming the ask), or closes other than by its own default `files`, or before its deadline |

A reading only load could have spoiled is INCONCLUSIVE: an ask still open a minute past its deadline while a read of
the record took over 10 s is skipped with that reading and the load, never passed. AC5 collects its failures and
throws them together, so its outcome shows every part; an INCONCLUSIVE deadline there skips the test only when nothing
else failed.

## Readings where the issue leaves a choice

1. **Moving the hub's clock.** The hub runs with `DEEP_HUB_TEST_CLOCK_STEPS=1`, and the test steps its clock with
   `test.clock` to 1 s past a deadline while it keeps running, then reads only the record (`events.read`: no inbox
   read and no answer, which could close an overdue ask on the way) until the ask closes. The earlier suite restarted
   the hub with `DEEP_HUB_TEST_CLOCK` just before the deadline; the step keeps one hub, one stream and no start time
   to race under load.
2. **"Past its deadline … takes its default"**, and AC5's "lets the deadline pass with the ask still open": the default
   must be on the record within a minute of real time after the step (the hub's clock moves with real time from
   there), and never stamped before the deadline. The minute isn't a budget the design states; it is generous for a
   machine at load ~100 to 250. An ask still open then fails, naming the ask, unless the hub was too slow to answer a
   read (over 10 s), which is INCONCLUSIVE.
3. **"Announced on the stream"** is the stream framing the ask's `ask.defaulted` at the log_pos the record holds it
   at; **"recorded as defaulted"** is that event and `inbox.read` holding the ask `closed` with the outcome
   `defaulted`.
4. **"An undo opens it again"** is `deep inbox undo <ask>`, the person's one surface (the design: a default "can be
   undone from Needs you"; the base CLI has `undo`), run with the OS confirming you. Open again means `deep inbox`
   lists it, `inbox.read` holds it with a status other than `closed` and the outcome `unanswered`, and your answer to
   it then counts.
5. **"Takes no"** is the authority ask's option whose decision is `deny`, `decline` (the design: an authority ask
   defaults to no); its default is recorded with the decision `deny`.
6. **AC3's order.** One authority ask: from inside the agent's process tree first, with the OS stub confirming, so only
   where the command runs can refuse it (a hub that leans on the confirmation alone counts it); then by you with the
   stub `cancelled`; then by you with it `confirmed`. "Refused" is a non-zero exit with nothing counted: no closing
   event and no decision on the record, checked before the exit code, so the planted inbox fails naming the
   criterion. "Stays open" includes `deep inbox` still listing it. "It counts" is exit 0, one `ask.answered` with your
   option, one decision saved from it (the cancelled case's "saves no decision" says the counted one saves one), and
   the ask leaving `deep inbox`.
7. **AC5's six.** Five taste calls (3-day deadlines, recommended `green`) and then a choice (4 hours, recommended
   `files`), all by `deep_ask` from one session, so the sixth is the one that folds. "Lands inside one exception in
   `deep inbox`": exactly one `deep inbox` item says "keeps asking" and carries the exception's handle; the sixth isn't
   an item of its own outside it (it may show within the exception's item, on a line of its own that names the
   exception or says `folded`, or not at all); each of the first five is an item of its own; and `inbox.read` holds the
   sixth `folded` and none of the five (the design: "the inbox's queued, shown, folded and held are views of an open
   ask").
8. **"In bulk"** is the exception's option that answers its asks together (`together`, #319's "answer them together",
   found by its ID or label), and "closes all six" is one `ask.answered` for each, with its recommended option, and
   none left in `deep inbox`.
9. **AC5's "the deadline"** is the folded sixth ask's own deadline (the design: "A folded ask … keeps its own deadline
   and default"). Since the bulk answer closes all six, the deadline runs on a second round of six from the same
   session on the same hub: the clock moves 1 s past the second sixth's 4-hour deadline, and it must take its own
   default, `files`.
10. **One test per criterion.** Each criterion's test runs on a world of its own; the two plants run the same scenarios
    (`world.ts`), so a planted run fails at the criterion's own check.

## Outcome on the base

Run at `531da1ef0` on 2026-11-20 at 03:23 on this Mac (load average 13 / 19 / 30 at the end), Node 24.22.0. The world
wasn't built in this checkout, since the build-grant queue stalled for hours: the coordinator copied byte-equal
`packages/*/dist` from another worktree cut from the same main (identical package sources, root `package.json`,
lockfile and `tsconfig.json`; built there by `npm run build --workspaces`, 22:49 to 23:41; `diff -rq` over
`packages/` shows no difference), and `target/debug/deep-hook` (sha1 `1e3b23f775766e69e3bab2e4a9ed86803a2951d1`)
from another worktree's plain `cargo build -p deep-hook`, whose `crates/deep-hook`, `crates/deep-contracts` and
`Cargo.lock` match this checkout's.

```
npx tsc -p tests/acceptance/667/redraft-2047        # exit 0, no errors
node scripts/throttle.mjs test --wait 600 -- npx vitest run tests/acceptance/667/redraft-2047 --testTimeout=600000 --silent=false
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 5 passed (6)
   Duration  134.46s
```

| Test | Outcome |
|---|---|
| AC3 `#667.a91c9ea1` | PASS. From the agent's shell, the OS confirming: exit 3, "stays open: this deep command runs inside agent session …'s process tree, so it acts as that session, and no agent answers an ask", nothing on the record, still in `deep inbox`. Cancelled: exit 3, "stays open: the OS didn't confirm you (the prompt was cancelled)", nothing on the record, still listed. Confirmed: exit 0, one `ask.answered` `decline` (via inbox, verified), one `decision.created`, gone from `deep inbox`. |
| AC4 `#667.47e397e9` | PASS. The choice ask took `sqlite` by `ask.defaulted` once the hub's clock passed its 4-hour deadline, stamped after it, held `closed`/`defaulted` by `inbox.read` and framed on the stream at its log_pos; `deep inbox undo` exited 0 ("is open again, its default undone"), a `default.undone` followed, `deep inbox` listed it, `inbox.read` held it open and unanswered, and `files` then counted once. Past the 1-day deadline the authority ask took `decline` with decision `deny`, `closed`/`defaulted`. |
| AC5 `#667.b9deefc5` | FAIL, at one check: `AC5 #667.b9deefc5: deep inbox shows the sixth ask ask:01M7WB4NFXC4AF0GY047R3DF6Q inside the exception ask:01M7WB4NFXCDBAP6W0K6S4YX8B, not as an item of its own: ["Keep the bulk store on SQLite or plain files?  choice  no repo  430f5d2f-…  0s  If you don't answer: Plain files, at 07:23  ask:01M7WB4NFXC4AF0GY047R3DF6Q"]: expected [ Array(1) ] to deeply equal []`. Everything else held: one exception item "This session keeps asking: …" with its handle, the first five each on an item of its own, `inbox.read` holding only the sixth `folded`, the bulk answer `together` closing all six with their recommended options and leaving none in `deep inbox`, and in round two the folded sixth taking `files` by `ask.defaulted` at its own deadline. |
| AC3 on `answer-inside-session` | PASS (the scenario fails naming the criterion): `AC3 #667.a91c9ea1: ask ask:01M7WB497ZH92Z4YQDDAK7JNB8 (the authority ask), answered from inside session b082b82b-…'s process tree with the OS confirming, counted: it must be refused, save no decision and stay open` |
| AC4 on `skip-default-at-deadline` | PASS (the scenario fails naming the criterion and the ask): `AC4 #667.47e397e9: ask ask:01M7WB4EQ0A45N3S68MYYCJSPG (the choice ask) is still open 61 s past its deadline 2026-11-20T15:23:12.480Z on the hub's clock, though the hub answered every read within 4 ms (load 15 21 31)` |
| AC5 on `skip-default-at-deadline` | PASS (the scenario fails naming the criterion and the ask): `AC5 #667.b9deefc5: ask ask:01M7WB6G9YDWH8BJTCV1027T65 (the sixth ask, folded into the exception) is still open 61 s past its deadline 2026-11-20T15:24:19.646Z on the hub's clock, though the hub answered every read within 15 ms (load 13 19 30)`, after the same `deep inbox` failure as the real hub's |

AC5 fails on the base because `deep inbox` prints every open ask's row on a line of its own, question first and
handle last with no status (#1463's layout), so the folded sixth ask reads as one more item beside the exception, and
the count says "7 asks need you": the base's `deep inbox` before the bulk answer, trimmed:

```
Which header colour on the search page (bulk)?  taste  no repo  430f5d2f-…  0s  If you don't answer: Green header, on Mon 23 Nov at 03:23  ask:…
    answer with blue (Blue header), green (Green header)
Keep the bulk store on SQLite or plain files?  choice  no repo  430f5d2f-…  0s  If you don't answer: Plain files, at 07:23  ask:01M7WB4NFXC4AF0GY047R3DF6Q
    answer with sqlite, files (Plain files)
This session keeps asking: answer its asks together, pause it, or leave them to their defaults?  exception  no repo  430f5d2f-…  0s  If you don't answer: Leave them to their defaults, at 07:23  ask:01M7WB4NFXCDBAP6W0K6S4YX8B
    answer with together (Answer them together), pause (Pause the session), defaults (Leave them to their defaults)
7 asks need you
```

Two corrections to this folder's own code came before this run, both found on the base: `../helpers.ts`'s `raise`
throws BLOCKED when `deep_ask` returns before its poll sees the `ask.created`, and at the base a taste call or a
choice returns at once as `provisional` (the design: it "proceeds on the recommended option at once"), so `world.ts`
raises through its own `ask`, which keeps reading the record after the call returns; and the AC5 message and the plant
runs now print the line and the failure they name. No INCONCLUSIVE reading.

While this run went on, someone else edited files outside this folder in this checkout: `scripts/lanes.mjs` at 03:19,
`packages/asks/src/index.ts` and `packages/hub/src/inbox.ts` at 03:24. This job saw their diff in `git status` only
after the run, with this folder's test code already final (03:22:59), and commits none of it. The run still tested
`531da1ef0`'s code: the hub and the CLI ran from `packages/*/dist`, built before any of those edits and without them,
and the test files had loaded `packages/asks/src` at 03:23, before its edit.

## Files

- `world.ts`: the IDs; the hub with its clock steps; `test.clock`; `deep_ask` read from the record; the deadline wait; `deep inbox` read for what a
  person sees; the AC3, AC4 and AC5 scenarios, shared with the plants.
- `criteria.test.ts`: AC3, AC4, AC5 on the real hub.
- `plants.test.ts`: AC3 on `answer-inside-session`, AC4 and AC5 on `skip-default-at-deadline`.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
