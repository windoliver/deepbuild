# Acceptance tests for #1459: the tree names what a person sees

Written first and blind, at base commit `dd83ac2f`, from issue #1459 (updatedAt 2026-11-09T00:11:36Z: its problem, Scope, nine
acceptance criteria and Proof), the design and the base, before any implementation. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion, so no
`TASTE.json`.

## What was read

- Issue #1459, and epic #1453 for context. #1454's suite, which this one is modelled on.
- `docs/technical-design.md`: Replica; Needs-you view; States people see; Panels and devices (trusted ring); the DeepBuild app
  row; Dogfooding and "Tests written first".
- At the base: `crates/deep-replica/src/{snapshot,main,live,kit,lib,deep_drive}.rs`, `crates/deep-replica/src/drive/{mod,locate,plant}.rs`,
  `crates/deep-replica/headless.rs` (`replica_equals_live_tree`, the `needs-you@1` cases), `crates/deep-app/src/{lib,views,events,record,states,text}.rs`
  (the rows, `deepbuild.needs_you`, the chart), `crates/deep-app/panels/338-*`, `packages/hub/src/panels.ts`,
  `scripts/known-failures.json`, `scripts/proof-change.mjs` (criterion IDs), and the suites `1454`, `1172`, `124`, `26`, `16`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), cargo and Xcode's
command line tools (`swiftc`), on macOS, in a logged-in, unlocked session:

```sh
caffeinate -di npx vitest run --root tests/acceptance/1459 --no-file-parallelism   # every file; one window at a time
npx vitest run --root tests/acceptance/1459 judges                                 # the judges alone, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/1459/tsconfig.json
```

- **Permissions.** `panel`, `identifier` and the real-app half of `voiceover` read the real window from outside its process: the
  process running the tests needs Accessibility and Screen Recording (System Settings, Privacy & Security). Without them those
  tests fail `BLOCKED: …`, never pass. `parity` opens a real window too (`deep-live`), read in its own process, which needs neither.
- **Builds.** The helpers run them, each once, with #1172's build environment (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`),
  so one target folder serves both suites, and copy each binary out of the target folder under its own name into
  `$TMPDIR/dd1459-bin-<uid>`: `deep-drive`, `deep-replica` and `deep-live` from `crates/deep-replica`, plain and with each plant
  (`--features deep-app/<plant>`), the plain build after each plant's, so the checkout's `target/debug` never holds a plant.
  `parity` runs `cargo test -p deep-replica --test headless replica_equals_live_tree`. #1172's world builds `deep-app`, `deep-show`
  and `deep-hook` itself. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes and outputs are under `/tmp` (#16's `tempDir`; a socket path must fit 104 bytes). Nothing touches
  the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID.
- **Real windows.** `panel`, `identifier`, `voiceover` and `parity` open real windows and bring the app forward; nothing clicks.
- **`--root` cache.** Vitest writes `tests/acceptance/1459/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1459/` in its `alone` list, in a macOS, logged-in lane; the implementer makes
  that edit.

## The surface (my choice where the issue names none)

The replica is the real `deep-drive` (#124), driven over its stdin as the hub's `deep_drive` tool drives it, launched on this suite's
fixture record with `launch.fixture`; `deep-replica --view` and `deep-live --view` for the shipped pages; and the real `deep-app`
against a real hub, read from outside its process by `probe.swift` as an assistive client reads it (AXTitle, AXDescription, AXValue,
AXIdentifier) and by Vision on the window's pixels. No label, reply or log line credits a criterion about what a person sees.

### Pinned here: the implementation must provide these

1. **One snapshot shape, with `id`.** Every snapshot is `{window, tree, items}` and every node `{role, name, value, id, bounds,
   children}`: `deep_drive`'s `see`, `deep-replica --view`'s `snapshots/<view>.json`, `deep-live`'s capture and the stored live trees
   in `docs/spikes/338/out/live/`. `id` is the element's author ID as a string, or `null` for a node with none; a node without the
   key is missing evidence, as #338 has it for `name` and `value`.
2. **Row IDs from the record.** A Needs you row's `id` is its ask's handle, `ask:<ULID>`, exactly, so `{id}` and `{handle}` name the
   same row. A sidebar row's `id` comes from its session's ID. Neither changes when another row comes or goes. A Needs you row's name
   starts with its ask's question; a sidebar row is a `button` whose name holds its task's title, once.
3. **Locators.** `deep_drive` locates by `{id: "<id>"}`, the one element with that `id`, and `{handle: "ask:…"}`, the row whose `id` is
   that handle, strictly, as its other forms do; `see` with `scope: "locator"` answers that row as its root, and `expect` counts it.
4. **`deepbuild.needs_you()` gives `asks`.** Beside `rows`, which stays, an `asks` list: the open asks oldest first, in `rows`' order,
   each `{handle, question}`, so a view draws the question and keys its row by the handle without drawing it. In the real app it
   reads the record the app reads from the hub, with no fixture; a panel whose `render` calls it gets the hub's open asks once the app
   has read them.
5. **The view kit: `deep-replica --view-kit needs-you@1 <dir>`.** Runs `needs-you@1` on the view in `<dir>` as `deep install` would for
   a view replacing Needs you: mounted as #338's fixture views are (the panel registers `needs-you` with `DockArea.register_panel`,
   as `crates/deep-app/panels/338-needs-you` does), in the replica, over the kit's fixture record
   (`docs/spikes/338/fixtures/needs-you.events.jsonl`), reading each row's element ID, in the order drawn, against the inbox
   projection's list. It prints one JSON line, kit.rs's `Verdict` as `--panel-kit` prints `panel@1`'s: `{"result": "pass"}` and exit 0,
   or `{"result": "fail", "names": "<the handle of the first ask that differs>"}` and exit 1.
6. **The journey lint: `deep-replica --journey-lint <file>`.** Reads a stored journey, a JSON array of `deep_drive` calls with a launch
   first (its `launch.fixture` may be a placeholder), without running it. A locator that locates by a word a person reads (`name`,
   `text` or `label`), wherever a locator goes (a call's `locator`, `act.to`, a screenshot's or recording's masks and highlights),
   fails it. One JSON line: `{"result": "pass"}` and exit 0, or `{"result": "fail", "names": "<the first such word>"}` and exit 1.
   `{id}` passes.
7. **The chart.** On a session's page (`launch.center: "deepbuild/session"`), the chart's canvas text items keep #390's value shape
   (`text`, `bound`, `at` and `box` in points); its readout is the item with `bound: true`, its caption the other. A node whose bounds
   overlap where the readout is drawn names or values the readout's text; the caption's words are in exactly one node's name in the
   whole tree.
8. **The real window.** A Needs you row is an accessibility element whose label (AXTitle, else AXDescription) starts with its question,
   and its `accessibilityIdentifier` (AXIdentifier) is its snapshot `id`. A sidebar row is an `AXButton` whose label holds its task's
   title, once, and reads, in order, its title, its state word and what it waits on, as before (`fixtures/voiceover-before.json`), with no
   status-map code (such as `needs_you`) or ID in it. `deep-app --panel <dir>` (#1172's) mounts the panel in the window.
9. **Plants: Cargo features of `deep-app`**, in no shipped build, added to `crates/deep-app/Cargo.toml` by the implementer (this job
   commits only this folder), built into the replica as `cargo build -p deep-replica --bin deep-drive --features deep-app/<plant>`:
   - `plant-row-index-ids`: Needs you rows' ids are their place in the list, as `("ask", index)` was, otherwise right.
   - `plant-chart-label-beside`: the chart's text is in the tree as the fix puts it, and the base's hand-written label,
     `Hours to each deadline: N points`, stays beside the chart.
   - `plant-row-title-only`: a sidebar row's accessible name is its task's title alone, otherwise right.
   - `plant-handle-rows`: #1172's, as it is.
10. **`scripts/known-failures.json`** no longer names `replica_equals_live_tree`, in any of its lists.

### Merged surfaces, used as they are

`deep-drive --out <dir>` and its calls (`launch` with `from: fixture | record_copy`, `fixture` and `center`; `see`; `expect`; `act`;
`close`); `deep-replica --view <view> --out <dir>`; `deep-live --view <view> --out <file>`; `cargo test -p deep-replica --test headless
replica_equals_live_tree`; `deep-app --panel <dir>`; #1172's `makeWorld` and plain `appBinary`; #16's temp folders and PID cleanup.

### The fixture

`fixtures/record.events.jsonl`, in `deep-drive`'s fixture form: four sessions with tasks `Cart totals` (three open asks), `Release notes`
(one), `Search index` (a claim sent back, round 1) and `Docs refresh` (a claim, no verdict yet); four `deep_ask.taste` asks with their own
questions, `ask:01KB1459AK…01` the oldest. `helpers.ts`, `variant`, writes a copy with the oldest ask answered from the card, and one with
every question reworded (`REWORDED`). `fixtures/views`: the replacement Needs you view and its planted twin that hides the oldest ask.
`fixtures/panels/asks`: a panel that calls `needs_you()` and draws what it got. `fixtures/journeys`: the stored journey (`by-id.json`) and
two planted ones, by a row's name and by drawn text. `fixtures/voiceover-before.json`: the base's sidebar names over the fixture, read
from the base's own `deep-drive`. The real-app tests use #1172's world: a real hub, sessions `Cart totals` and `Release notes`, three
open asks.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1459.7cddc858` | `ids.test.ts`: every row has an id, none shared; after the oldest ask closes each other ask row and each session row keeps its id | the base (no `id`); `plant-row-index-ids`, naming the row below; `judges.test.ts`: no id, shared ids, a close that closed nothing, a moved session row |
| AC2 | `#1459.ed7429c5` | `handle.test.ts`: `see` scoped to `{handle}` gives the row named by its question; `expect` counts one; no `{text}` run, name or value holds a handle | the base (`{handle}` finds nothing); `plant-handle-rows`, naming the ask |
| AC3 | `#1459.8eb65c2f` | `journey.test.ts`: the stored journey passes on the fixture and on the reworded one, whose rows keep their ids; its locators hold no word the screen shows; the lint passes it | the base (`{id}` isn't a locator; no lint); `by-word.json` and `by-text.json`, each naming its word |
| AC4 | `#1459.7f466ddb` | `kit.test.ts`: the replacement view passes `needs-you@1` | the base (no view kit); `views/hides-oldest`, naming the oldest open ask |
| AC5 | `#1459.6759f060` | `panel.test.ts`: in the real app, the panel reads `Panel reads 3 open asks` and each question, on the window's pixels | the base: `no fixture record is loaded` |
| AC6 | `#1459.cd8e77fe` | `parity.test.ts`: cargo's `replica_equals_live_tree` passes; `known-failures.json` names it nowhere; each shipped page, replica beside a fresh live capture, equal node for node with ids, Needs you's rows keyed by their handles, the stored live trees with ids | the base (its known failure is still listed; no node carries an `id`) |
| AC7 | `#1459.73dd3590` | `identifier.test.ts`: each Needs you row's AXIdentifier in the real app equals its `id` in the replica's snapshot of the same hub's record | the base (no `id`; no identifier) |
| AC8 | `#1459.83780a4b` | `chart.test.ts`: the readout named where it's drawn, the caption named once | the base (the readout is drawn only); `plant-chart-label-beside`, naming the caption; `judges.test.ts` |
| AC9 | `#1459.f979c200` | `voiceover.test.ts`: in the replica, each sidebar row reads as before; in the real app, what VoiceOver reads of each session's row is its title, then `needs you` | `plant-row-title-only`, naming the row; `judges.test.ts`: a title alone, words out of order, a code, an ID |

Three criterion-tagged tests pass at the base on purpose (`BASE-FAILURE.txt`): AC9's first and third, since AC9 guards against a
regression and before is the base; AC6's cargo run, since `replica_equals_live_tree` already passes at `dd83ac2f` on this Mac while
`known-failures.json` still lists it (AC6's second test fails on that); and AC2's wrong-program test, since #1172's plant exists at
the base and the judge already catches it.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: `session.row@1` reading IDs; a node's `value` carrying the status-map entry; the
menu bar's title, focus and the card's arming state in the snapshot; agent-written text marked as the agent's; `see` and the replica's
`Snapshot` merging beyond their shared node keys; a chart's name generated from its items, past its caption and readout.

## Disputes and assumptions a redraft may revisit

1. **The row's `id` is the handle itself** (Pinned 2). The issue says the ID "comes from" the handle; AC2 and AC7 read cleanest when they
   are equal. An implementation keying rows `row:<handle>` fails `parity`'s handle check and nothing else.
2. **Which kit lints journeys.** "The kit's lint" names no kit; I pinned it on the replica's kit module, beside `--panel-kit`, as a CLI on
   a stored file. A lint inside `deep_drive` or a script would serve as well, and is a new surface either way.
3. **`asks` beside `rows`** (Pinned 4). A view that draws no handle needs each ask's question, which `needs_you()` doesn't give at the
   base. Changing `rows` to objects instead would break #338's fixture views.
4. **"The same as before" is the base's name.** `fixtures/voiceover-before.json` is the base's own reading over this fixture. The real-app
   half has no recorded base reading for #1172's world (no assistive client ran on the base app here before this job), so it holds the
   rows to the base's composition, `<title> · needs you`. VoiceOver's AXValue is not judged: the issue puts the status-map entry in the
   node's value, and whether AppKit speaks a button's value is the implementer's to settle; a redraft may judge it.
5. **The chart's caption "named once"** reads "isn't repeated beside it" as: the caption's words in one node's name in the whole tree.
   A chart node named `Hours to each deadline, …` with a child caption node would fail; I read that as a repetition too.
6. **The shipped pages are the base's three** (`needs-you`, `sidebar`, `session`). If #1461's pages land first, `parity` needs their names.
7. **`deep-live` here.** A fresh live capture on this Mac stands for the live tree; its bounds matched the stored reference-Mac trees at
   the base for Needs you, but a different display could move them.

## Files

- `helpers.ts`: builds, the fixture and its variants, the replica driver, the kit and lint runs, the real app from outside, the judges.
  Reuses `../1172/helpers.ts` (world, app build) and `../16/helpers.ts` (temp folders, PIDs). `probe.swift`: the assistive client.
- `ids.test.ts` (AC1), `handle.test.ts` (AC2), `journey.test.ts` (AC3), `kit.test.ts` (AC4), `panel.test.ts` (AC5), `parity.test.ts` (AC6),
  `identifier.test.ts` (AC7), `chart.test.ts` (AC8), `voiceover.test.ts` (AC9); `judges.test.ts`, no app and no criterion tag, passes at
  the base.
- `fixtures/`, `tsconfig.json`, `BASE-FAILURE.txt`.
