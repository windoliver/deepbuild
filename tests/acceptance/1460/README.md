# Acceptance tests for #1460: one address for every page

Written first and blind, at base commit `96b462a6` (Merge pull request #2051; the brief named it `0c4a4ec7`, its SHA before
main's history was rewritten), from issue #1460 (updatedAt 2026-11-10T05:43:41Z: its problem, Scope, eight acceptance
criteria, Proof, and the owner's settled comment that a claim gets no address of its own and opens as its session's page at
that claim), the design and the base, before any implementation. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion, so no
`TASTE.json`. The #83 goldens this issue moves are redrafted in `tests/acceptance/83/redraft-1460/`.

## What was read

- Issue #1460 and its comments; epic #1453; #83 (the verdict line), #886 (`deepbuild://` links) and #1465 (pages and their
  parameters), for the forms they share with this issue.
- `docs/technical-design.md`: Keymap, placement, window (the Address line and its neighbours); `deep open` in the CLI row;
  "Where they reach you" (`deepbuild://`); the verdict line in the chat; Replica; Dogfooding and "Tests written first".
- At the base: `crates/deep-app/src/{views,commands,card,notify,record,question,arming,cells}.rs` and `Cargo.toml` (the plant
  features), `crates/deep-replica/src/drive/{mod,frames,locate}.rs` and `snapshot.rs`, `packages/cli/src/main.ts`,
  `packages/verdicts/src/line.ts`, `packages/hub/src/{core,plant,drive,channels}.ts`, `scripts/render-lint.mjs`,
  `scripts/known-failures.json`, `scripts/proof-change.mjs` (criterion IDs), and the suites `1459`, `1454`, `1172`, `83`,
  `16` and `34/redraft-1579`.

## How to run

With Node 24 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), cargo on `PATH`
(`$HOME/.cargo/bin`, or rustup's proxies), Xcode's command line tools (`swiftc`), on macOS, in a logged-in, unlocked session:

```sh
caffeinate -di npx vitest run --root tests/acceptance/1460 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1460/tsconfig.json
```

- **Headless first.** `doors`, `history`, `card` and `lint` need no window: the replica is the real `deep-drive` on GPUI's
  test platform. Only `cli.test.ts` opens a real window, the real `deep-app`, because `deep open` reaches the running app and
  the record it must leave alone is the hub's. It is read from outside its process by #1459's `probe.swift`, so the process
  running the tests needs Accessibility and Screen Recording (System Settings, Privacy & Security); without them its tests
  fail `BLOCKED: …`, never pass. Nothing clicks or types in the real window.
- **Builds.** The helpers build each binary once, with #1172's build environment (`CARGO_INCREMENTAL=0`,
  `CARGO_PROFILE_DEV_DEBUG=0`), and copy it out of the target folder under its own name into `$TMPDIR/dd1460-bin-<uid>`:
  `deep-drive` from `crates/deep-replica`, plain and with `--features deep-app/plant-row-skips-open`; `deep-app`, plain and with
  `--features plant-open-writes-event`; the plain build after each plant's, so `target/debug` never holds a plant. `deep-hook`
  is built where #83's world runs it from. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes and sockets are under `/tmp` short paths (#16's and #83's temp folders; the lint's copies
  under `/tmp/dd1460-lint-*`), removed after. Nothing touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`.
  Only what a test started is stopped, by PID.
- **`--root` cache.** Vitest writes `tests/acceptance/1460/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1460/` in its `alone` list, in a macOS, logged-in lane; the implementer
  makes that edit.

## The surface (my choice where the issue names none)

The replica is the real `deep-drive` (#124), driven over its stdin as the hub's `deep_drive` tool drives it, launched with
`launch.fixture` on this suite's fixture; `see`, `act`, `feed` and the snapshot's `focus` are used as #1459 left them. The
real app is the real `deep-app` on #83's world, read from outside as an assistive client reads it. No label, reply or log line
credits a criterion: every check reads a page's address off the tree, what the tree shows, or the hub's record.

### Pinned here: the implementation must provide these

1. **Address strings.** `ask/<ULID>` (the ask's handle without `ask:`), `session/<session ID>` (the record's session ID, a
   UUID), `project/<id>` and `page/<name>[/<parameter>]`. A claim's page is its session's page at
   that claim: `session/<session ID>/<claim ULID>` (the claim's handle without `claim:`). Every door takes the same strings.
2. **Reading the address and the page.** The page region is one node, in the replica's snapshot and in the real tree, whose
   `id` is the full address it shows, parameter included; it reaches the live tree as the accessibilityIdentifier (#1459), and
   is never drawn or spoken. A window shows exactly one node whose `id` matches `^(ask|session|project|page)/\S+$`. A test
   reads the page's snapshot with `see` scoped to it: `{"call": "see", "locator": {"id": "<address>"}, "see": {"scope":
   "locator"}}`. A page at a claim holds a node whose `id` is the claim's handle, `claim:<ULID>`. Rows keep #1459's ids
   (`session:<id>`, `ask:<ULID>`); the card keeps `question-card`, its value `presented` until it arms.
3. **The doors, each a call of the app's one `open`.** In the replica:
   - row click: `act click` on `{"id": "session:<id>"}`, the sidebar's row;
   - ⌘K: `act press "cmd-k"`, `act type "<the session's task title>"`, `act press "enter"`. ⌘K is the app's in every replica,
     with or without `launch.view`, and lists each session by its task's title;
   - notification click: a new call, `{"call": "notification", "notification": {"click": <n>}}`, clicks the `n`th
     notification the replica posted (0-based, the order of the trace's `notifications`) and replies `{"notification": {t,
     ask, session, text}}`. It calls the same app function the macOS notification-click handler calls. A `notice.sent` in a
     session's record posts that session's notification at the next tick, as the base's notifier already does; the test
     lets a tenth of a second of the replica's clock pass (`wait_for {t}`) before it clicks;
   - `deepbuild://` link: `{"call": "open", "open": {"url": "deepbuild://session/<id>"}}`, which calls the same app function
     the macOS URL handler calls;
   - deep_drive's open: `{"call": "open", "open": {"address": "<address>"}}`, answering `ok: true` once the window draws it.
   - `deep open <address>`: see 4. A pop-out's page has the same address (not tested here; no criterion names it).
4. **`deep open <address>`** hands the address to the app running in the same HOME (through the hub), which opens it through
   its one `open`; it exits 0 once the app has it open, and non-zero, saying why, when no app runs or nothing takes the address.
   It takes a receipt's short form (9) as well as the full one.
5. **What an unresolved address shows.** An ask closed earlier opens its page with the ask's question, the word `answered` and
   the answer's option label. An address nothing matches opens a page with a node whose name starts `No match` and holds the
   address as given. Neither page is blank.
6. **A removed session** is one the record archives: a `session.archived` event (as the contract has it, `subject:
   session:<id>`), fed with deep_drive's `feed`. Its row leaves the list and its address leaves back and forward.
7. **The terminal tab focused.** A click on a session page's Terminal tab (`{"id": "session-terminal"}`) opens the tab and gives
   it the keyboard: the snapshot's `focus` (#1459) is `terminal`, whether the hub hosts a terminal for the session or not (in a
   replica none does, and the tab shows its words). ⌘[ pressed then leaves `focus` at `terminal` and the address unchanged.
   ⌘[ and ⌘] are `act press "cmd-["` and `"cmd-]"`, with focus anywhere else in the window.
8. **The lint: `node scripts/selection-lint.mjs [--root <checkout>]`.** It reads every `thread_local!` in
   `crates/deep-app/src` under the root (the checkout by default) and fails each static there that holds what the window has
   open: at least any named `OPENED`, `POPPED` or `DOCK`, and a view handed to a slot (`NEXT_EXTENSION` at the base). One
   `FAIL selection: <path from the root>:<line>: <what>` line per finding, or one `PASS selection` line; exit 1 on a finding,
   0 on none.
9. **The receipt.** Where the chat can't link, the verdict line's last part is the claim's page address with the session's
   ID cut to its first 8 characters, the app's own short name for a session (views.rs's `Session <first 8>`):
   `session/<first 8 of the session ID>/<claim ULID>`, 43 columns. `deep open` and every door take it and open the full
   address, `session/<session ID>/<claim ULID>`. Where it doesn't fit 80 columns with the other parts, it gives way, in #83's
   order: after the cause's floor. Why this form, below.
10. **`deep_drive`'s `open`** is on the replica only, with the addresses of 1; the hub's `deep_drive` tool passes it through.
11. **Plants: empty Cargo features of `deep-app`**, in no shipped build, added to `crates/deep-app/Cargo.toml` by the
    implementer (this job commits only this folder), never environment variables:
    - `plant-row-skips-open`: a sidebar row click opens its session's page without the one `open` (as `open_session` did:
      selection set directly), otherwise right. Built into the replica as `--features deep-app/plant-row-skips-open`.
    - `plant-open-writes-event`: `open` on an ask writes one event the hub keeps, through the app's hub connection (for
      instance the ask's default as an answer), otherwise right. Built as `cargo build -p deep-app --bin deep-app --features
      plant-open-writes-event`. A plant whose write the hub refuses proves nothing.
    - The planted `OPENED` is a copy of the source with the base's own declaration added (`lint.test.ts`); the planted line
      ending in a bare word is `#83`'s own `PASS 4/4 · next: you · receipt` (`cli.test.ts`). Neither is a feature.

### Why the receipt has that form

The issue says the receipt part is the address of the claim's page, and #83 AC11 (`LINE_WIDTH`, 80) says the line fits 80
columns. A full claim's page address, `session/<UUID>/<ULID>`, is 8 + 36 + 1 + 26 = 71 columns. The base's PASS line for four
requirements whose four checks ran is `PASS 4/4 · 4 tests · next: you · receipt` (#669 added the test count): 33 columns before
the receipt, so the receipt has 47. The full address can't fit any PASS line, and a claim part cut from the claim's ID would
no longer be a record ID. The form here keeps the claim's ID whole, which alone finds the claim, and its session, in the
record, and cuts the session's ID as the app already does for its short name; 43 columns fit a PASS line up to
`PASS 12/12 · 120 tests · next: you`. No form holding a record ID fits a BLOCKED, sent back or says done line with its other
parts as #83 states them (8 to 17 columns are left), so there the receipt gives way, as #83's order says. A redraft may revisit
this (Disputes, 1).

### Merged surfaces, used as they are

`deep-drive` and its calls (`launch` with `from: fixture`, `fixture` and `center`; `see` with `scope`; `act` click, press and
type; `feed`; `close`), its `{id}` locator and the snapshot's `focus` (#1459); #83's world (`makeHome`, `hubWithSetup`, the
Claude Code stand-in, `deep_claim`, `test.verdict`, `deep_ask`, `lineOf`, `allEvents`, `inbox.read`); #1459's `Drive`, `RealApp`
and `probe.swift`; #16's temp folders and PID cleanup.

### The fixture

`fixtures/record.events.jsonl`, in `deep-drive`'s fixture form: seven sessions with UUID IDs and tasks `Cart totals` (A),
`Release notes` (B), `Search index` (C), `Docs refresh` (D), `Billing page` (E), `Login flow` (F) and `Header colours` (G); in
G, one open `deep_ask.taste` ask (`ask:01KB1460AK…01`, "Which header colour on the login page?") and one answered from the card
(`ask:01KB1460AK…02`, "Which font for the printed receipt?", answered `Serif receipt`); a `notice.sent` in A, which posts A's
notification. The real-app world is #83's: a session whose claim got a planted PASS on four requirements and four runs, its
Stop's line read as the chat shows it, and a second session's open `deep_ask` choice.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1460.2a9c7aec` | `doors.test.ts`: in fresh replicas, B opened, then A by each door; each lands on `session/<A>`, ⌘[ goes back to B and ⌘] to A, and every door's page snapshot is equal. `cli.test.ts`: `deep open session/<id>` lands the real app on that address | the base (no `open`, no `deep open`, no page id); `plant-row-skips-open`, naming the row click |
| AC2 | `#1460.d705eebf` | `history.test.ts`: A to E opened; ⌘[ ×4 to A, ⌘] ×4 to E; C archived, then skipped both ways; from B, opening F leaves no forward step and ⌘[ returns to B | the base (no `open`) |
| AC3 | `#1460.e8743dab` | `card.test.ts`: open `ask/<id>` presents that ask's card reading `presented`, its row still in Needs you. `cli.test.ts`: `deep open ask/<id>` shows the card in the real app; the hub's record gains no event from the app, the CLI or about the ask in the next 3 s; the ask stays open | the base (no `open`, no `deep open`); `plant-open-writes-event`, naming the event's kind |
| AC4 | `#1460.e6caebd8` | `card.test.ts`: the closed ask's page says its question, `answered` and `Serif receipt`; `nonsense/what-is-this` shows `No match` with the address | the base (no `open`) |
| AC5 | `#1460.b224c18f` | `doors.test.ts`: deep_drive's open and a row click land on one address with equal page snapshots | the base (no `open`) |
| AC6 | `#1460.939ea70f` | `lint.test.ts`: the lint passes the app's source; it fails `OPENED` planted in views.rs and in commands.rs, and the base's `POPPED`, `DOCK` and slot view in a file of their own, each naming its file | the base (no lint; its views.rs holds all four) |
| AC7 | `#1460.4b8e8988` | `cli.test.ts`: the PASS line fits 80 columns and ends in `session/<first 8>/<claim>`; `deep open` with it lands the real app on `session/<session>/<claim>` with `claim:<ULID>` on it | the base's own line, which ends in `receipt`; the planted line, naming `receipt` |
| AC8 | `#1460.dea93c6a` | `history.test.ts`: rows A, B, C clicked; ⌘[ twice shows A; D's row leaves ⌘] nowhere and ⌘[ at A; with D's Terminal tab focused, ⌘[ leaves focus on `terminal` and D's page showing | the base (no page id) |

One criterion-tagged test passes at the base on purpose (`BASE-FAILURE.txt`): AC7's wrong-program test, a judge run on the
planted line, which the base's own line is; the base also fails AC7's first test for that reason.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: ⌘[ and ⌘] holding at most 50 addresses; a pop-out keeping its page's
address and a second open focusing that window; an editor keeping ⌘[ and ⌘]; `OPENED`'s and `POPPED`'s callers removed beyond
what the lint reads; a turn, an Index entry, a wiki page or a document as a page's parameter (#1465); `project/<id>`.

## Disputes and assumptions a redraft may revisit

1. **The receipt's form** (Pinned 9). It cuts the session's ID to 8 characters so the line fits; a redraft may pick another
   cut, or read "where the chat can't link" to exclude Claude Code's chat.
2. **"Removed" is `session.archived`** (Pinned 6). The base has no event that takes a session out of the list; archive is the
   design's (Archive on a row) and the contracts' only one.
3. **The terminal tab focused, with no terminal hosted** (Pinned 7). A replica has no hub terminal, so the tab must take the
   keyboard while it shows its words. A redraft could host a fixture terminal instead.
4. **"Shows what closed it"** (Pinned 5) is read as the word `answered` and the answer, beside the question; where and when
   (#886's "answered at 14:02 in the CLI") are not judged.
5. **What counts as an open's write** (`writtenByOpen`): events after the open written by the app or the CLI, or about the
   ask. An unrelated hub job writing as the core in those 3 s is not counted.
6. **The page node's `id` is the full address** (Pinned 2), so a receipt opens the same page, with the same id, as a click on
   that claim would.

## Files

- `helpers.ts`: builds, the fixture's IDs, addresses, the replica driver and its doors, the record and receipt judges. Reuses
  `../1459/helpers.ts` (the replica driver, snapshots, the real app reader) and, in `cli.test.ts`, `../83/helpers.ts`.
- `doors.test.ts` (AC1, AC5), `history.test.ts` (AC2, AC8), `card.test.ts` (AC3, AC4), `lint.test.ts` (AC6), `cli.test.ts`
  (AC1's `deep open`, AC3's record, AC7).
- `fixtures/record.events.jsonl`, `tsconfig.json`, `BASE-FAILURE.txt`.
