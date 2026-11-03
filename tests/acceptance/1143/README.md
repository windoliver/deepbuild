# Acceptance tests for #1143: preflight's lint and test failures on main

Home paths in base-failure records, unlisted dependencies, a missing card, the envelope test, and a large `Err` variant.

Written first, blind, on November 3, 2026, by a job that never saw an implementation of #1143. Its sources:

- **Issue #1143**, its text as of 2026-11-03T10:03:23Z (`updatedAt`): Scope, the 3 checkbox criteria, and Proof.
- **`docs/technical-design.md`**: How we know version 0 works (with its Dogfooding bullet), and Privacy.
- **`AGENTS.md`**: Proof, and Machine and safety (no personal data in code, fixtures, logs or evidence).
- **The base commit `69803b946abf4881f818485c5898865949a2a871`** (`origin/main`, with no implementation of #1143).
  These were read for their public surfaces only, meaning the lines each command prints and how a test is run:
  - `scripts/repo-rules.mjs` and `scripts/repo-rules.json`;
  - `scripts/proof-change.mjs`, for how a criterion's ID is made;
  - `scripts/lanes.mjs`;
  - `vitest.config.ts`;
  - `packages/contracts/test/events.test.ts`;
  - `packages/contracts/src` (`schemas.ts` and `catalogue.ts`), and the schema `note.closed@1`.
- **Sibling suites, for their conventions**: tests/acceptance/1098, 1106 and 882.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job.

## Run

Use Node 24.22 (`.node-version`) and the pinned Rust toolchain (`rust-toolchain.toml`, 1.99.1 with clippy), both first on `PATH`. From the checkout's root:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # once in a fresh worktree; the plant copies need each workspace's dist/
npx vitest run tests/acceptance/1143 --testTimeout=6000000
node node_modules/typescript/bin/tsc -p tests/acceptance/1143/tsconfig.json
```

Run times and side effects:

- **`criteria.test.ts`** runs the three commands on this checkout and judges what they print. Only cargo writes anything, and only its own build cache under `target/`.
  - The clippy run takes about a minute with a warm `target/`.
  - From cold it can take many minutes, so the test's own timeout is 100 minutes.
  - Since it is long, the implementer may add `tests/acceptance/1143/` to `scripts/lanes.mjs`'s `alone` list.
- **`plants.test.ts`** makes one throwaway copy of the checkout under the system's temporary folder (`da1143-copy-*`) and removes it afterwards. It never plants anything in the checkout itself.
  - The copy holds every file `git ls-files --cached --others --exclude-standard` lists, as the working tree has them, so uncommitted work is included.
  - `node_modules/` and each `packages/*/dist/` are copied whole with `cp -a`, never linked.
  - The copy gets a fresh `git init`.
  - The whole file takes a few seconds.

The tests start no process but `node`, `git`, `cp` and `cargo`, and stop none.

## Verdicts other than PASS and FAIL

Nothing missing or unrun passes. A test that can't judge its criterion throws an error whose message starts with `BLOCKED:` or `INCONCLUSIVE:`. The test then fails, and the message says why.

- **AC1** is `BLOCKED` when repo-rules prints no `PASS` line for `secrets`, `deps` or `cards`, as when a check reads `INVALID` or `BLOCKED`. No FAIL line alone isn't a pass.
- **AC2** is `BLOCKED` when Vitest writes no report, as when its config can't load.
- **AC3** runs the criterion's command with two additions:
  - `--message-format=json`, so each message's lint and crate can be read;
  - `--keep-going`, so a crate that can't build on this platform doesn't stop cargo before it lints `deep-canvas`. On Linux that crate is `deep-app`, whose `image` dependency is macOS-only.

  Neither addition changes what clippy reports for `deep-canvas`. The test reads which targets `deep-canvas` has from `cargo metadata`. Each of them must be linted for a PASS. A target counts as linted when:
  - clippy finished it, which for the library means both its check build and its test build; or
  - every error it reported there is a `clippy::` lint, so the lint pass ran over it.

  If clippy never reached a target, or stopped on a compile error there, the test is `INCONCLUSIVE` and names the target. Any `clippy::result_large_err` in `crates/deep-canvas` is a FAIL whatever else happened.

## Criteria, tests and wrong programs

Each ID is the first 8 hex digits of the SHA-256 of the criterion's text, made as follows:

- drop the leading `- [ ] `;
- trim it and collapse its white space (`scripts/proof-change.mjs`, `criterionId`).

Each test name carries its ID.

| # | ID | Test | What it proves | On the base |
|---|---|---|---|---|
| AC1 | `#1143.daea5590` | `criteria.test.ts` AC1 | `node scripts/repo-rules.mjs` on the checkout prints no `FAIL secrets:`, `FAIL deps:` or `FAIL cards:` line, and prints a `PASS` line for each of the three | fails: 66 home-path and 2 API-key `FAIL secrets` lines, 4 `FAIL deps` lines (`packages/gate`'s two, `deep-canvas-seams` → `deep-canvas`, `deep-scene3d-render`'s `serde_json`) and `FAIL cards: crates/deep-panel-host has no README.md card` |
| AC1 | `#1143.daea5590` | `plants.test.ts` AC1 | In the copy, a new `tests/acceptance/1143-plant/BASE-FAILURE.txt` holds a macOS home path (`/Users/` and a name) on line 2. repo-rules must print exactly one `FAIL secrets: tests/acceptance/1143-plant/BASE-FAILURE.txt:2:…: home path` line and exit non-zero. This catches a fix that silences the check, or skips BASE-FAILURE files, instead of redacting | passes, since the base already detects home paths |
| AC2 | `#1143.f4bcaafd` | `criteria.test.ts` AC2 | `vitest run packages/contracts/test/events.test.ts` on the checkout runs its tests, every one passes, and it exits 0 | fails: "every kind shares one envelope" fails on `composition.reopened@1`, whose `x-since` is R2 |
| AC2 | `#1143.f4bcaafd` | `plants.test.ts` AC2, two tests | In the copy, a new event kind is planted beside the published ones. It is `note.closed@1` copied, with its own `kind` and `title`, and its envelope differs from the others in a field that isn't history. The first test adds an envelope property `via`; the second sets the root's `additionalProperties: true`. events.test.ts must fail, with a failing test whose message names the planted schema (`plant.envelope@1`, `plant.open@1`) | fails: the run fails on the hand-kept count ("to have a length of 158 but got 159"), naming no schema |
| AC2 (scope) | `#1143.f4bcaafd` | `plants.test.ts` AC2, two tests | The same plant, differing only in its history: first `x-since: R2` (the issue's R2 kinds), then all five of `x-since`, `x-stability`, `x-tracking`, `x-deprecated_since` and `x-replaced_by`. events.test.ts must pass whole. This catches the scope's bug (history compared) and its hand-bumped count | fails: the count, and the history comparison |
| AC3 | `#1143.fb243546` | `criteria.test.ts` AC3 | The workspace clippy (above) reports no `clippy::result_large_err` in `crates/deep-canvas` and lints every `deep-canvas` target | fails: 15 `result_large_err` messages for `SealError`, in `src/registry/mod.rs` and `src/registry/lists.rs` (lib and lib test) |

The criteria name no wrong program for AC3. The base is AC3's wrong program, and it fails the test.

## Readings where the issue leaves a choice

- **"On a clean checkout of main".** The tests run on the checkout they sit in, meaning the fixing branch's working tree before merge, or main after it. repo-rules reads the working tree and every file git doesn't ignore, as preflight does, so a stray untracked file with a home path fails AC1. That is how the check itself reads a tree.
- **"A planted event schema".** The plant is a new schema file, since a kind that lands is how the envelope test meets new envelopes. The plant also checks that the test's count isn't hand-kept: with the base's fixed 158, a planted 159th kind fails on the count without naming the schema, which the criterion forbids.
- **What isn't tested, since no criterion names it**:
  - whether each home path was redacted, rather than allowed in `allowedFindings`. The scope says redact, but the criterion reads only repo-rules' output;
  - the reasons written for the listed dependencies;
  - the content of `crates/deep-panel-host`'s card, beyond what repo-rules' `cards` check reads;
  - clippy lints in `deep-canvas` other than `result_large_err`. At the base, clippy 1.99.1 also reports `clippy::cloned_ref_to_slice_refs` in `deep-canvas`'s library. While any such error remains, `-D warnings` stops the library's build, so its `bin` and `cli` test targets go unlinted, and AC3 reads INCONCLUSIVE for those targets even with no `result_large_err` left.

## Files

- `helpers.ts` holds:
  - the criterion IDs;
  - the three command runners;
  - clippy's JSON judge;
  - the checkout copy.
- `criteria.test.ts`: the three commands on the checkout.
- `plants.test.ts`: the planted home path and the four planted schemas, in a throwaway copy.
- `BASE-FAILURE.txt`: the run on the base, with home paths shown as `~`.
