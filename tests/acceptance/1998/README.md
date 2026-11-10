# Acceptance tests for #1998: the box, every change in words as a proposed change you approve, no Settings page

Written first and blind, at base commit `96b462a6`, from issue #1998 (updatedAt 2026-11-10T05:45:50Z: Scope, four acceptance
criteria, Proof), the design and the base, before any implementation. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1998, with its Scope, criteria and Proof.
- `docs/technical-design.md`: First-party extensions that ship on by default (spec-draft, view, the `done.yaml` example and
  `config.json`), Add anything and Starting a session from the app (the box), Panels and devices (⌘K, pages, Needs-you view,
  Replica), An ask and your answer getting back (Every ask ends, Asks stay current, Where they reach you), How it installs
  (Setup: no Settings page; "remove DeepBuild from Codex"; `deep setup --undo`), How we know version 0 works (Criteria to
  tests, both ways; Criteria in a checked shape; Wrong programs; The edit guard; Dogfooding).
- `AGENTS.md`.
- At the base, read only: `packages/hub/src/{server,core,setup,codex-settings,agents,inbox,plant,paths}.ts`,
  `packages/asks/src/index.ts`, `crates/deep-app/src/{commands,installed,notify,views}.rs`,
  `crates/deep-replica/src/drive/{mod,plant,locate}.rs`, `crates/deep-replica/src/snapshot.rs`, `scripts/proof-change.mjs`.
- For conventions: `tests/acceptance/41/setup/`, `19/setup/`, `148/`, `366/`, `1454/`, `1002/`, `1455/helpers.ts`.

## How to run

macOS (setup is stood in for launchd; the replica renders with Metal), Node 24.22 or newer first on `PATH`, cargo on `PATH`,
outside the Bash tool's sandbox:

```sh
npm ci                                   # once, if node_modules is missing (better-sqlite3 needs its native build)
npm run build --workspaces               # if packages/*/dist is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -p deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -p deep-replica --bin deep-drive
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1998 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1998/tsconfig.json
```

- **Runs alone.** Every file but `codex.test.ts`'s modelled tests runs the real `deep setup` (a hub per home, under the launchd
  stand-in) or `deep-drive` replicas. The implementer adds `'tests/acceptance/1998/'` to `alone` in `scripts/lanes.mjs`; this job
  doesn't edit it.
- **Builds.** The helpers run those two cargo builds once per file (a no-op when current); a machine that can't build fails the
  tests `BLOCKED`.
- **Folders and processes.** Homes are `/tmp/dh1998-*`, replicas' homes, outputs and panel copies `/tmp/dh1998{home,drive,panel}-*`,
  removed after each file. Every process
  gets `HOME` a temp folder, none of this process's `DEEP_*`, `CLAUDE*`, `CODEX*`, `GIT_*`, `GH_*`, `XDG_*` or billing variables, and
  is stopped by PID (the launchd stand-in records each PID it starts). Nothing touches the real `~/.deepbuild`, `~/.claude`,
  `~/.codex` or `~/Library`.
- **No model, no network.** `claude` and `codex` on PATH are stubs that log and exit 0 (`fixtures/stub-bin.sh`); `gh` logs and exits
  0; the OS confirmation is `DEEP_HUB_TEST_CONFIRM`'s file holding `confirmed`, as #19 and #41 do.
- **Vitest cache.** `--root` leaves `tests/acceptance/1998/node_modules/.vite/`; delete it before committing.

## The surfaces

Merged surfaces used as they are: `deep setup`, `deep setup --undo`, `deep inbox answer <ask> <option>` (the OS confirming you),
the hub's `inbox.read` over its socket as the `cli` role with the control token, the `deep-drive` replica (`launch` from `fixture`
or `record_copy`, with `panel` and `view`; `act`, `see` by `id` locator, `wait_for`, `close` and its trace's `notifications`), and
`DEEP_HUB_PLANT` with the hub's closed plant list.

### Pinned here: the implementation must provide these

The issue and design name the box, its question card in Needs you, ⌘K and the replica, but no method or element. These are this
job's names, the narrowest the base's conventions allow.

1. **`box.say`**, a hub method for the `app` and `cli` roles: `{ words: string, repo?: string }`, `repo` the absolute path of the
   checkout the words are about. It returns `{ ask: "ask:<id>" }`, the proposed change's ask, open in `inbox.read`, with an option
   `apply` that approves it (the convention of #148's syncs and `deep_propose`). Nothing it would change changes before that
   answer. `deep inbox answer <ask> apply` is the approval.
2. **No model for these words.** The box drafts "remove DeepBuild from Codex", "stop checking <check> in <repo>" (with `repo`),
   "turn sounds off" and what ⌘K drafts for "mute" by itself: the agents on PATH are stubs that answer nothing.
3. **A spec change applied** writes `.deepbuild/done.yaml` in the checkout `repo` names, for you to commit (spec-draft: "`deep`
   writes the files for you to commit"). "Stop checking lint" leaves `lint` out of every claim's `checks`.
4. **What moved, named.** A proposal approved after its spec's file changed at the branch head comes back as a new open ask (raised
   at the move or at the approval) whose question names that commit by its SHA, at least its first 7 hex digits. The second of two
   proposals drafted on one revision is refused naming the first by its handle `ask:<id>`, in what `deep inbox answer` prints or
   in the question of an ask raised since the two were drafted.
5. **The box in the window**: author ids (#1459) `box` for the box, `box-draft` for the change drafted in it, `box-current` for the
   current value shown beside it, each's words its value or its name. ⌘K works in a replica launched with no view.
6. **Sounds off reach the replica.** A replica over a copy of your record posts each notification with `sound: null` once you
   approved turning sounds off, as the app would. Before, an ask's notification has `sound: "question"`, as at the base.
7. **Plants** (names for `DEEP_HUB_PLANT`, added to `packages/hub/src/plant.ts`):
   - `box-applies-at-once`: the box applies a change in words when it drafts it, with no ask waiting.
   - `box-ignores-revision`: an approval applies what was drafted, whatever moved since.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`: the first 8 hex digits of SHA-256 of the criterion's text, trimmed, white space
collapsed. A test headed `(wrong program)` runs the wrong program and expects the criterion's judge to fail on it, naming what it
gets wrong.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 Remove DeepBuild from Codex, approved, leaves Codex as before install, as `deep setup --undo` | `#1998.97e49eef` | `codex.test.ts`: before approval Codex's files are setup's; after, `hooks.json` and `config.toml` byte-for-byte yours, still so 5 s later; `~/.codex` equal to what `deep setup --undo` leaves in a twin home; Claude Code keeps DeepBuild | the base (no `box.say`); modelled: `hooks.json` written again without DeepBuild's entries; `config.toml` keeping DeepBuild's MCP table |
| AC2 no Settings page; every change through the box as a proposed change | `#1998.c62f2117` | `settings.test.ts`: ⌘K "settings" lists entries, each of which drafts a change in the box in a fresh replica; three phrases (spec, Codex, sounds) each an open ask with `apply`, shop's spec and Codex's files unchanged 3 s later | the base (no ⌘K over the fixture, no box); `fixtures/settings-panel`, a view with a page named Settings; `box-applies-at-once` |
| AC3 stale spec approval applies nothing, redrafted naming the commit; second of two refused naming the first | `#1998.376621f1` | `spec.test.ts`: shop's stale approval leaves its head and spec at the moving commit, a redraft names it, approved it applies on that revision; cart's first applies, the second applies nothing and its refusal names the first | the base (no `box.say`); `box-ignores-revision` |
| AC4 "mute" in ⌘K drafts sounds off beside on; approving turns them off; names-only ⌘K returns nothing | `#1998.f21e951e` | `mute.test.ts`: replica over the home's record, ⌘K "mute", top entry: `box-draft` sounds off, `box-current` sounds on, its notification sounds; the draft to `box.say`, approved; a second replica's notification is silent | the base (names-only ⌘K, no box); the issue's names-only ⌘K, played in test code over every name the real ⌘K showed |

11 tests. At the base 8 fail and 3 pass: AC1's two modelled wrong programs and AC2's Settings-page twin, whose judges run on modelled
bytes or the base's own ⌘K (BASE-FAILURE.txt).

## Readings

- **AC1.** "Codex's settings" are `~/.codex/hooks.json` and `~/.codex/config.toml`, written by hand before setup. "As they were before
  install" is byte-for-byte. "The same as `deep setup --undo`" is the whole `~/.codex` tree, by path and digest, equal to what undo
  leaves in a twin home set up from the same files. "Once approved" holds both ways: Codex's files are setup's until you approve.
  "From Codex" means Codex only, so Claude Code's DeepBuild entries stay.
- **AC2.** "No Settings page" is read through ⌘K, which lists every page: no entry ⌘K gives for "settings" opens a page; each drafts a
  change in the box, as the Scope's preference words do. "Every change goes through the box" is sampled on three targets the Scope
  and Setup name, a repo's spec, an agent's settings and your own preferences, each a proposed change that changed nothing yet.
- **AC3.** "The spec's file changed at the branch head" is a commit on `main` editing `.deepbuild/done.yaml` after the proposal was
  drafted. "Applies nothing" is the head and the file as that commit left them. "Redrafted on the new revision" is a redraft that,
  approved, keeps the commit's change and makes the proposal's. "Refused, naming the first" is the second applying nothing and its
  refusal holding the first's ask handle.
- **AC4.** "Sounds being on" is setup's default. "Turns them off" is what the app does with sound: the replica's notification of an
  open ask plays none. "A ⌘K that matches names only" is the base's ranking (exact, prefix, word prefix, substring of a name); over
  every name the real ⌘K showed it must return nothing for "mute", so ⌘K answers it by meaning.

## Disputes and assumptions a redraft may revisit

1. **No model for the words** (Pinned 2). The design's box hands words to your agent for Add anything; these tests can't run one, so
   they need the issue's own phrases understood without it. An implementation that sends them to the agent fails here, not BLOCKED.
2. **"Forget my screenshot habit" and "learn again"** aren't exercised: their targets (a learned habit, a history to read) need
   fixtures this job would have to invent surfaces for.
3. **A notification for the box's own ask.** AC4's open ask is the box's proposal. If the app never notifies for a proposal with no
   session, the control fails before the criterion is judged; a redraft would raise the open ask another way.
4. **An entry named "Mute…"** would make the names-only twin return it, and AC4's wrong-program test fails: the criterion says a
   names-only ⌘K returns nothing, so the box's entry for "mute" must not be found by its name.
5. **The redraft's question** names the commit; a card that names it only in its diff and not in `inbox.read`'s question would fail.
6. **The replica's tests ran only on the base** (the box doesn't exist there), so the box ids and the second replica's silence are
   untried against any implementation.

## Files

`helpers.ts` (homes, setup, the hub's socket, `box.say`, repos, snapshots), `drive.ts` (deep-drive, ⌘K, the box, notifications),
`codex.test.ts` (AC1), `settings.test.ts` (AC2), `spec.test.ts` (AC3), `mute.test.ts` (AC4), `fixtures/launchd.mjs` and
`fixtures/stub-bin.sh` (copied from #41), `fixtures/settings-panel/` and `fixtures/settings-panel.view.json` (AC2's twin),
`tsconfig.json`, `BASE-FAILURE.txt`.
