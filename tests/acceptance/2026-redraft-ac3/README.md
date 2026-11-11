# Acceptance test for #2026, criterion 3 redrafted: a reader that keeps its place by event ID

A blind redraft (design: Dogfooding) of AC3's test, `#2026.8e76ad64`, from the same inputs as the first draft: issue
#2026 as it reads now, the design and base commit `6e55e5841` (here at `33b9dc48c`, the base plus the first draft's suite
`tests/acceptance/2026/`; no implementation of #2026). No implementation, diff, other branch, worktree or PR was read.
The implementing agent doesn't edit these files (AGENTS.md, Proof).

The criterion's text is unchanged, so its ID is too (recomputed from the live issue as `scripts/proof-change.mjs` does).

## What was read

- **The issue**, with `gh issue view 2026`: Scope ("an ask spooled while the hub was down shows after its replay"),
  Reads under #1453, the five open criteria, Proof.
- **AGENTS.md** and **`docs/technical-design.md`**: Dogfooding; the hook protocol (line 341: the spool keeps each
  request byte for byte, a replayed event keeps its ID and `seq`, the hub appends each ID once, each append takes the
  next `log_pos`, "a replayed event reaches every consumer that resumes after the last `log_pos` it holds, however old
  its ID and `seq`: a permission request spooled while the hub was down still becomes an ask you see"); the App API row
  (one record reader in the app, which resumes from `log_pos`, ignores a frame whose `log_pos` it has and refetches a gap
  from its last `log_pos`); Decided, "Where a consumer resumes".
- **The first draft**: `../2026/README.md`, `helpers.ts` (imported unchanged), `replay.test.ts`, `BASE-FAILURE.txt`.
- **The base**, for how a replay and an ask are written: `packages/hub/src/spool.ts` (each spooled line goes through the
  core's hook path, `replay`), `packages/hub/src/core.ts` (`handleHook`: a replayed line whose ID the record already
  holds changes nothing, read by `WHERE id = ?`; `permission`; `replayLate`, the 2 s pass), `packages/hub/src/plant.ts`
  (`plantOf` refuses a name it doesn't know), `packages/asks/src/index.ts` (`raise` mints the ask's ID as `ulid(now)`;
  `fill` refuses an ask whose kind has no deadline or default in `settingsFor`, your `config.json`'s asks block;
  `DRAFTED` and `draftAskSettings`, what setup writes there), `packages/hub/src/setup.ts` (calls `draftAskSettings(root)`),
  `crates/deep-app/src/record.rs` (the app's reader, by `log_pos`) and `plain.rs` (`planted`), and
  `tests/acceptance/16/helpers.ts` (`startHub`, which passes `plant` to the hub as `DEEP_HUB_PLANT`).

## The dispute, and this reading

The first draft's wrong program is the app's one record reader keeping its place by the newest event ID it applied,
and its test requires that app to fail with "Needs you never showed the ask `ask:<ULID>`". Under the design it can't.
The replay appends A's request at a new `log_pos` with its old ID; the asks core in the hub then raises the ask as a new
event, `ask.created`, with an ID minted when it is raised (`ulid(now)` in the base's asks core) and the next `log_pos`.
An app that skips a frame whose ID sorts at or before the newest it holds skips only the replayed `permission.request`
frame, which Needs you doesn't draw; it applies `ask.created` and the list's row after it and shows the ask. The same
holds for any reader that meets only what follows the request: the hub's inbox projection and its list-row projection
meet the ask by its new ID, and a stream that served frames by ID would drop only the request's frame, whose `log_pos`
gap the app refetches by `log_pos`.

The readers that can fail are those that meet **the replayed request itself**, and under the design both live in the
hub, between the spool and the ask:

1. **The replay's "is it recorded already?"** The hub appends each ID once (design 341); a spooled line whose live
   copy reached the record changes nothing. Asked by the request's own ID, A's request isn't there and is appended.
   Asked by place, "does the record hold an event at or past this ID?", B's 20 newer events say yes, and A's request is
   skipped as already recorded.
2. **The reader that turns a permission request into an ask.** The request reaches every consumer that resumes after
   the last `log_pos` it holds (design 341, 478, 2866). One that resumes from the newest event ID it has read has read
   B's 20 events, takes A's older request as already read and raises no ask.

Either way the record never holds the ask, Needs you never shows it, and it reaches its default unseen, as the
criterion says. The test now names that missing ask by the spooled request.

**A deviation to weigh.** The criterion's words are "An app that keeps its place by event ID". This redraft reads "the
app" as the program behind Needs you, the hub's asks core and replay included, since the hub raises the ask the app
shows; the surface is still the app's Needs you, and the app runs plain. If the owner reads "an app" strictly as the
Mac app's record reader, no test can make that program fail under the design, and the criterion's last sentence needs
the owner's edit rather than a test.

## What changed from the first draft, and why

| Change | Why |
|---|---|
| The plant `reader-keeps-place-by-id` (the app's reader, selected in the `env-plants` app build) is dropped. | It can't fail under the design (above): its test could only fail at its premise or pass the wrong program as "caught" by accident. |
| Two plants in the hub are added: `replay-keeps-place-by-id` and `asks-keep-place-by-id` (Plants, below), passed to the hub alone through #16's `startHub({ home, plant })`, in both of its starts; `helpers.ts` `hubOf` takes no plant. | They are the readers that meet the replayed request, so they are where keeping one's place by event ID fails this scenario. The app is always the plain build, so a pass or a failure is the hub's. |
| The home now declares the ask settings setup drafts: the test calls `draftAskSettings(<home>/.deepbuild)`, the function `deep setup` calls (`packages/hub/src/setup.ts`), so the hub's `config.json` holds `DRAFTED`'s asks block (a deadline, a default and a notice for every kind, the fold, the batch). | Every ask needs its kind's deadline and default declared (invariant 2: nothing missing passes; design, the done.yaml asks block), and the asks core refuses one with none as `BLOCKED` (`fill`, from `settingsFor`). `makeHome()` writes only `setup-finished.json`, so with no `asks.deadline.authority` no correct hub could raise the replayed request's ask, and the clean test could pass on no program. It is the home a finished setup leaves, which `setup-finished.json` already claims. |
| Every way the ask fails to show now fails with one sentence: ``Needs you never showed an ask for the permission request <ID> of session <session> (`npm publish --tag next`), spooled while the hub was down: <why>``, where *why* is one of: still in the spool; taken up but nothing recorded under its ID; replayed at `log_pos` N but no ask raised; its ask `ask:<ULID>` raised but never listed. | The first draft named the ask only when it was raised and not drawn; a wrong program that keeps its place by ID stops earlier, so its failure has to name the ask by the request that should have raised it. Each plant's test requires that sentence with the spooled request's ID. |

Kept as the first draft has it, since it is sound: the scenario and its numbers (A's request spooled by the real
deep-hook with the hub stopped; the spool held aside, byte for byte, while the hub starts; B's 20 hooks, ten Bash calls
each a PreToolUse and a PostToolUse, on the hook wire, each newer by ID and `seq`, checked from the record; the app's
frames at the 20th's `log_pos`; the spool put back for the hub's pass for a spool that lands while it runs); the replay's
moment (a cli subscriber on the hub's stream gets the request's event by its ID); the ask (the `ask.created` of A's
session after B's 20 events); the surface (`deep-live --view needs-you --watch`, a frame's rows listing `ask:<ULID>`);
the 1 s from the replay to that frame, over it INCONCLUSIVE through `timingProblem`/`inconclusive` off a fit, quiet
reference Mac; and the first draft's Disputes 3, 4 and 5.

## Plants

Selected with `DEEP_HUB_PLANT=<name>` on the hub (`packages/hub/src/plant.ts`, the core's `this.options.plant`); the
implementer adds each name to `Plant` and `PLANTS`. The app is never given the variable.

- `replay-keeps-place-by-id`: the spool replay takes a spooled request as already recorded when the record holds any
  event whose ID sorts at or after the request's own (the newest ID as its place), not when it holds the request's ID,
  so A's request, older than B's 20 events, is never appended and never raises an ask.
- `asks-keep-place-by-id`: what raises an ask from a permission request reads hook events from the newest event ID it
  has read, not from `log_pos`, so the replayed request is in the record at its new `log_pos`, and on the stream, but is
  taken as already read and raises no ask.

Each plant's test first holds the clean run to the same judge (a clean run that fails can't make a plant look caught),
then requires the planted run to fail naming the missing ask by the spooled request's ID. A plant the build ignores
passes the scenario and fails its test ("wasn't caught"); a name the hub doesn't know stops its start `BLOCKED`.

## Still pinned (from the first draft's README)

- Pinned 1: `deep-live --watch` frame lines carry `snapshot`, the window in the replica's shape (`shownIn`).
- Pinned 2: once the hub replays a Claude Code `PermissionRequest` deep-hook spooled, the record holds an `ask.created`
  whose `session` is that request's, and Needs you lists it as `ask:<ULID>` of that event's ID.
- Pinned 5's `reader-keeps-place-by-id` is no longer needed by AC3; its other plants are other criteria's.

## Run it

With Node 24.22 and cargo 1.99.1 first on `PATH`, on macOS, in a logged-in session whose display is unlocked (the test
shows the real window through `deep-live --watch`, and stops `BLOCKED` at its ready line on a locked display):

```sh
npm ci && npm run build --workspaces
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
# optional, to build ahead under the machine's throttle; the helpers build what's missing themselves
node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-hook --bin deep-hook
node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-replica --features env-plants --bin deep-replica --bin deep-live
node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-replica --bin deep-replica --bin deep-live
npx vitest run --root tests/acceptance/2026-redraft-ac3 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2026-redraft-ac3/tsconfig.json
rm -rf tests/acceptance/2026-redraft-ac3/node_modules/.vite
```

`appBins()` builds the `env-plants` app too, unused here, since the helpers build both. It copies each binary over its
last copy in `$TMPDIR/da2026-bin-<uid>/` in place, and macOS kills a signed binary rewritten in place once it has run:
`deep-live` then dies at exec with SIGKILL and nothing on stderr, and the test stops `BLOCKED` at its ready line (this
run's first try, BASE-FAILURE.txt). So the test removes those four copies before it builds, and its copies are new
files. The defect is in `../2026/helpers.ts` (`appBins`), which this redraft imports unchanged; it hits the first
draft's AC3 and AC5 files the same way on any second run after a rebuild. That folder is also one per user, not per
checkout, so two worktrees running these helpers at once overwrite each other's app binaries: run one at a time.
Homes are under `/tmp/da2026-*`;
nothing touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`; only what the test started is stopped,
by PID. **`scripts/lanes.mjs` needs `'tests/acceptance/2026-redraft-ac3/'` in its one-at-a-time list**, in a macOS,
logged-in lane where a window can show; the implementer makes that edit.

## What this supersedes

With the owner's approval, `tests/acceptance/2026/replay.test.ts` is deleted once this lands, and the first draft's
README rows for AC3 and its Pinned 5 entry for `reader-keeps-place-by-id` read as superseded here. `helpers.ts`'s
`PLANT.byId` stays as data no test reads.

## Not covered

As in the first draft: the ask an ID-keyed program misses reaching its default unseen (the criterion's aside, which no
reading here asserts), and a real start's replay, which runs before the hub answers, so only a spool that lands late
reaches the order the criterion names.

## Files

`replay.test.ts` (the clean test and one test per plant), `tsconfig.json` (as the first draft's), `BASE-FAILURE.txt`
(the run at `33b9dc48c`).
