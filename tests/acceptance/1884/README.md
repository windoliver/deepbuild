# Acceptance tests for #1884: one coverage rule, the hub's, read by the doctor and the hook map

Written first, blind, by a job that never saw an implementation of #1884; none existed. Written from the issue (its
body, Scope, the three acceptance criteria, Proof and Depends on), `docs/technical-design.md` and the base commit
`dcb63a0a0` (origin/main, 2026-11-20). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

Each test's name carries its criterion's ID (`#1884.` and the first 8 hex digits of SHA-256 of the criterion's text,
as `scripts/proof-change.mjs`'s `readIssue` reads it; checked by running `readIssue` on the issue body):

| ID | Criterion | Test |
| --- | --- | --- |
| `#1884.ae94b96f` | AC1: facts list 1.0.0 and 1.2.0, 1.1.0 installed: `deep doctor` reports `version_uncovered` and a session's hooks are watch-only; on the base the doctor reads healthy | `covered.test.ts` |
| `#1884.158e699a` | AC2: a listed version installed, both read covered | `covered.test.ts` (1.0.0 and 1.2.0) |
| `#1884.1f89e40b` | AC3: `doctor.ts` holds no version comparison of its own; a planted second rule fails a test that reads the source | `source.test.ts` |

## What was read

- Issue #1884 (2026-11-20). `AGENTS.md`. In `docs/technical-design.md`: the agent table's Claude Code row, Health
  reads the agent's side (the doctor's binary item, "the binary's path and version against the versions its facts
  cover") and Facts as data (a version the facts don't cover: recorded unverified, holds and every block but the
  floor watch-only), Dogfooding.
- At the base, for surfaces only: `packages/hub/src/doctor.ts` (`facts`, `compare`, `covered`, `claudeItems`),
  `hookmap.ts` (`coveredBy`, `versionOf`, how a PreToolUse with a matched entry reads the session's version),
  `socket-adapters.ts` and `rule-load.ts` (`DEEP_HUB_TEST_FACTS`), `server.ts` (`reply`: a watch-only session's matched
  block is recorded, not blocked), `paths.ts` (`deepHook`), `mods.ts` (`DEEP_HUB_TEST_MANAGED_SETTINGS`),
  `packages/adapters/src/facts.ts` (`readFacts`), `packages/cli/src/main.ts` (`deep doctor`), `scripts/proof-change.mjs`
  (criterion IDs). The suites `tests/acceptance/18/session` (watch-only on an uncovered version, widened facts),
  `1033` (`deep doctor --json` with a stand-in `claude`), `159` (a hook request sent over the socket as deep-hook
  sends it) and `1330` for their form.

## The test's facts, and how the doctor and the hub both read them

The issue's facts list exactly 1.0.0 and 1.2.0. Both readers must read those same facts.

- On the base the hub can be given test facts through `DEEP_HUB_TEST_FACTS` (a folder of facts files), but the
  doctor can't: it reads `adapters/claude-code.facts.json` through `readFacts`, which resolves the file relative to
  the built `@deepbuild/adapters` module, with no test variable. Giving only the hub the test facts would leave the base
  doctor reading the shipped facts (2.1.x), where 1.1.0 is below the range: it would report `version_uncovered` on the
  base for the wrong reason, and the criterion's "on the merge base the doctor reads healthy" couldn't be shown.
- So each test file makes **a copy of this checkout's built tree** (`factsCopy` in `helpers.ts`): `package.json`,
  `adapters/`, `contracts/`, `packs/` and `packages/` (each package's `test/` left out), a link to this checkout's
  `target/`, and a `node_modules` whose `@deepbuild/*` links point into the copy's packages (every other dependency
  links to this checkout's). In the copy, `adapters/claude-code.facts.json` is the shipped file with `versions` set to
  `["1.0.0", "1.2.0"]` and `events.versions` holding those two keys, each with the newest shipped version's payload
  schema; everything else is unchanged. `deep doctor` and `deep hub run` both run from the copy
  (`<copy>/packages/cli/dist/main.js`), so both read these facts as their shipped facts. `DEEP_HUB_TEST_FACTS` is not
  set.
- What an implementation must honor: the doctor and the hook map both get Claude Code's covered versions from the
  shipped facts file as the built packages find it (`adapters/` beside `packages/`), or from anything that reads the
  same file. A rule that reads facts from somewhere else (a bundled copy, a cache outside the tree) would not see the
  test's facts. Rebuild (`npm run build --workspaces`) before running: the copy takes the built `dist/`.

## The doctor's reading

`deep doctor --json` (one item per line) with HOME a fresh temporary home, `DEEP_HUB_TEST_MANAGED_SETTINGS` naming a
missing file (as `1033` does), and PATH starting with a folder holding the stand-in `claude`: a shell script that
prints `<version> (Claude Code)` for `--version` and exits 1 for anything else. The reading is the `claude.binary`
item: AC1 wants code `version_uncovered` (and a level other than ok); AC2 wants `healthy` at level `ok`. Other items
(hub unreachable, sign-in and so on) are not read.

## The hook

One PreToolUse from a Claude Code session, sent over the running hub's socket as deep-hook sends it (`hook.request@3`
after the hub's hello, as `159` does), with `matched` naming one guard entry in `<home>/.deepbuild/rules.json`: block
mode, `fail_closed: false`, scope `all_repos`. The session's transcript, where Claude Code keeps it under
`<home>/.claude/projects/`, has the prompt and the Bash call written before the hook, every entry stamped with the
session's version, so the hub reads the version from it (hookmap `versionOf`). A gated session's call is blocked
(exit 2 or a deny); a watch-only session's call is let through, since watch-only blocks only the floor's
`fail_closed` entries (design: Facts as data). AC1 wants it let through at 1.1.0; AC2 wants it blocked at 1.0.0 and
1.2.0.

deep-hook itself is not run by the tests (the hook request stands in for it), but the hub runs it at start to prove
its own guard entries (`paths.ts` `deepHook`), so a hub needs `target/{release,debug}/deep-hook` built
(`cargo build --locked -p deep-hook`); without one the hub tests read BLOCKED, never pass.

## What counts as a comparison of its own (AC3)

`source.test.ts` reads `packages/hub/src/doctor.ts` with its comments taken out and fails on any of: a comparator
over version strings (a function or constant named `compare*`, `cmp*`, `semver*`, `newer*`, `older*`,
`versionCompare*`; a split on dots, `/[.-]/` or `/\./`; a `localeCompare` with `numeric`), or a test on a facts
`versions` list (`includes`, `indexOf`, `lastIndexOf`, `some`, `every`, `find`, `findIndex`, `has`), directly on
`.versions` or through a name bound to it, including passing an element of that name to a compare or an ordering
operator. A copy of the hub's own membership rule inside doctor.ts counts: the issue's scope is one rule in one place.
Reading the list only to show it (its length, `range[0]` in the evidence text, a join) does not count. The test first
runs the detector on four planted second rules (the base's range rule, a list copy, a list copy through a bound name, a
numeric collation) and fails if it misses any, so it can't pass by finding nothing anywhere.

Left open by the issue, and not guessed: where the one rule lives (the test doesn't require any name or module, only
that doctor.ts holds none of its own), and the wording of the doctor's evidence and fix.

## Run them

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
npm run build --workspaces                       # the copy takes each package's dist/
cargo build --locked -p deep-hook                # the hub proves its guard entries through it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1884 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1884/tsconfig.json
```

Temp folders are made under `/tmp/dk1884-*` and removed after; each copy is about 80 MB. Processes are stopped by PID.
No model is called and nothing leaves the machine.

## What the base does

`BASE-FAILURE.txt` has the run. AC1 fails at the doctor's assertion (the base doctor reads 1.1.0 as covered by the
range 1.0.0 to 1.2.0); AC3 fails at the source assertion (the base's `compare` and range rule). AC2 read BLOCKED in
that run because this checkout had no deep-hook built; a scratch check beside the run, with a deep-hook from an
identical `crates/deep-hook` linked in, showed AC2's readings already hold on the base and that the base hub already
holds the 1.1.0 session watch-only.
