# Acceptance tests for #2058: `requires.core` is compared with the build's core, for documents and packs

Written first, from issue #2058 (its Scope, its four acceptance criteria and its Proof line, "The document check's and
the pack check's output on the fixtures, shown failing first on the merge base, where each refused fixture checks
clean"), the design sections it links and base commit `c60215952` ("Merge pull request #3632 …", = origin/main), by a
job that never saw an implementation; none existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion. This suite is also the bug's reproduction on main, which the issue read from
the code and did not run: `BASE-FAILURE.txt` holds the base's raw answers.

## What was read

- The issue, from a verbatim copy handed to this job.
- `AGENTS.md`; `docs/technical-design.md` (Dogfooding).
- `docs/canvas-primitives.md`: Document envelope (`requires: {core: semver, …}`; "A document whose `requires.core` is
  above the build's core is refused with `out_of_range` at `requires/core`, naming the core the document needs and the
  build's core, and a `requires.core` that is text but no version is refused at the same path as not a version. A
  document with no `requires.core`, or one at or below the build's core, opens"), Pack, and What holds a document to
  its rules.
- At the base, only for how the surfaces are driven: `crates/deep-show/src/main.rs` (the scenario line, `packs: [{id,
  dir}]`, the `registry`, `packs` and `deep show` calls), `crates/deep-show/src/hub.rs` (`outcome`
  `presented`/`refused`; every reply's `core`), `crates/deep-show/src/packs.rs` (the `packs` rows),
  `crates/deep-canvas/src/document/mod.rs` (an issue's JSON), `crates/deep-canvas/src/document/check.rs` and
  `packs.rs` (the two places the issue names, and how a module the build lacks is refused at pack check and again at
  the load of a document that lists the pack), `crates/deep-canvas/src/registry/mod.rs` (`core@<version>`), and the
  suites `1957/`, `306/` and `305/` (README, helpers, conventions). Every expected value comes from the issue.

## Criteria to tests

Each test's name starts with its criterion's ID and nothing else is read by the lanes. All four are in
`requires-core.test.ts`, whose head quotes each criterion and says what its test asserts.

| ID | Criterion | What the test asserts | Fails at the base because |
|---|---|---|---|
| `#2058.e29d9bdc` | AC1: a document one patch above the build's core | `fixtures/documents/board.json` with `requires.core` one patch above the build's core: `outcome` `refused`; an error `out_of_range` at `requires/core`; its message holds the needed version and the build's core. Then the same document at the build's core: `presented`, no error | the newer-core document is `presented` (first assertion) |
| `#2058.3cf1dddc` | AC2: `soon`, and no `requires.core` | the board with `requires.core: "soon"`: `refused`; an error `out_of_range` at `requires/core`; its message says `not a version`. Then the board with no `requires.core`: `presented`, no error | the `soon` document is `presented` (first assertion) |
| `#2058.729deb44` | AC3: a pack whose range leaves out the build | `fixtures/packs/ahead-1.0.0` with `requires.core` `>=<one patch above>`: its `packs` row is `refused`; an error `out_of_range` at `requires/core`; its message holds `ahead`, the range and the build's core. Then the same pack with `>=<the build's core>`: `installed`, no error | the pack is `installed` (first assertion) |
| `#2058.d337dccb` | AC4: a document that lists that pack | `fixtures/documents/lists-pack.json`, shown to a store offered that pack with `>=<one patch above>`: `refused`; an error whose JSON holds `ahead` and the range | the document is `presented` (first assertion) |

**Wrong programs.** The merge base is one for every test. The criteria also name planted ones: a document check that
only asks that the value is text (AC1), one that reads text it can't parse as the lowest version (AC2), a pack check
that only parses the range (AC3) and a loader that compares a listed pack's `requires.modules` and not its core (AC4).
This job writes no twin and no product code; the implementer adds them (`twins.json` and `twins/<name>/lines.json`,
outside `tests/`). Each test is written so each of those fails it at its first `expect`, a plain comparison of the
`outcome` or the row's `state` read from the binary's output, whose message names the document or the pack, as the
criterion says ("fails, naming it"). No test uses `toThrow`.

## Run them

The file builds `deep-show`, so the folder runs alone (`lane.json`).

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2058 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2058/tsconfig.json
```

The file first runs `cargo build --locked --bin deep-show --no-default-features --features r1` (honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary to a
temporary folder and fails each test if the build failed. On a shared machine build first through the throttle
(`node scripts/throttle.mjs build -- cargo build --locked --bin deep-show --no-default-features --features r1`), so
the file's own build is a no-op. Each `deep-show run` is its own process with a fresh evidence folder; every temporary
folder is deleted. Node built-ins and vitest only; everything runs headless on the CPU, in seconds once built.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306 and #1957 left it. Nothing new is
invented: every call and field below is the base's.

- **The build's own core**: the `registry` call's `core`, `core@<major>.<minor>.<patch>` (`core@0.0.0` today). The
  tests read it there and work out "one patch above" (`0.0.1` today) and the pack's range (`>=0.0.1`); no version is
  written in a test. The fixture files hold today's values, and each test stamps the value it read over them: the
  board's `requires.core` in memory, the pack's in a copy of its folder in a temporary folder.
- **The document check and the load**: `deep show` (from your shell, `peer`) with `include: ["issues"]`. Its reply has
  `outcome` (`presented` or `refused`) and `issues` (`{code, severity, path, actual, what, …}`). "Checks clean" is
  `outcome` `presented` with no issue of severity `error`. "Refused on load" (AC4) is `outcome` `refused`.
- **The pack check**: the scenario's `packs: [{id, dir}]`, offered to the store before the first call, and the `packs`
  call (`{packs: [{pack, version, state, issues}]}`): `state` `refused` with the check's issues, or `installed`.
- **"The message"** is the issue's `what`, the text an issue carries today (a module at another version: "the document
  requires the … module at …; this build has …").

## Fixtures

| File | What it holds |
|---|---|
| `fixtures/documents/board.json` | a board with one `rect@1`, `requires: {core: "0.0.1", modules: {marks2d: ">=0.0.0"}}` |
| `fixtures/documents/lists-pack.json` | a board that lists `acme/ahead@1.0.0` and holds one `ahead.tile@1`; no `requires` |
| `fixtures/packs/ahead-1.0.0/` | `acme/ahead@1.0.0`, `requires: {core: ">=0.0.1", modules: {marks2d: ">=0.0.0"}}`, one recipe `ahead.tile@1` (a `rect@1`) |

No title or description in a fixture holds a version, a range or the pack's name where a refusal could echo it.

## Readings where the issue leaves a choice

- **"One patch above the build's own core" / "the build's own core"**: read from the binary (`registry`), so the suite
  holds when a release moves the core. A core with a pre-release tag would fail the suite's own reading of
  `core@<major>.<minor>.<patch>`, by name; none exists today.
- **"The message holds both versions"** (AC1): one error `out_of_range` at `requires/core` whose `what` holds each
  version as a whole (`0.0.1` is not held by `0.0.10`). Other errors may stand beside it; the issue's `actual` isn't
  read.
- **"Refused at `requires/core` as not a version"** (AC2): the Scope says "as a value that is no text is today", and
  today that is `out_of_range` at `requires/core` with the message `not a version`. The test asks for that code, that
  path and a message holding `not a version`, so a check that answers `soon` as a core too new (a message of two
  versions) fails too.
- **"Names the pack, the range and the build's core"** (AC3): the error's `what` holds `ahead` (which
  `acme/ahead@1.0.0` holds too), the range as written (`>=0.0.1`), and the build's core as a whole version outside the
  range's own text.
- **"Refused on load, naming the pack and its range"** (AC4): the criterion gives no code and no path and says no
  "message", so the test reads the whole error issue's JSON for `ahead` and the range; the range is nowhere in the
  document, so only a refusal that read the pack's `requires.core` holds it. The Scope's `out_of_range` at
  `requires/core` for the load is not asserted: at the base a pack's missing module reaches the document at
  `packs/<i>/…`, and the criterion leaves the path open.
- **The document of AC4 holds one instance of the pack's recipe**, so it uses the pack it lists. The pack is offered
  with the range that leaves out the build, as AC3's; whether the store keeps a refused version isn't read.
- **"Checks clean"**: `presented` with no error issue; notices and warnings aren't read.

## Not tested, because the criteria don't ask

A `requires.core` below the build's core (the Scope's "at or below"; no build has a lower core to name today); a pack
range in other forms (`^`, `<`); a pack range that is no range (the base's "not a version range"); the in-crate test in
`crates/deep-canvas/src/document/mod.rs` the Scope moves; the document that lists the pack opening once the pack's
range takes the build in; the three items the Scope leaves out of this task.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria (its oracle page), so these tests are their local proof.
