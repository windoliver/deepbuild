# Acceptance tests for #2144: the canvas lint passes on main

Written first, blind, from issue #2144 ("The canvas lint passes on main: 30 findings no known-failures entry records":
its 30 quoted lines, Scope, two acceptance criteria and Proof) as the brief quoted it, the design and base commit
`53c0e72a3` ("Merge pull request #2356 …"), by a job that never saw an implementation; none existed, and no other
branch, worktree or pull request was read, nor the live issue. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion,
the plants the second names inside its test.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2144.35365960` | `lint-on-main.test.mjs` (1): the lint on this checkout, keyed against `scripts/known-failures.json` |
| AC2 | `#2144.ad4aea4d` | `plants.test.mjs` (1): one planted workspace: three static items, one std float call, three unlisted dependencies |

IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over each criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so they aren't checked against it. Each test's name
starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: "Seeded and replayable" (the lint, its scope, its listing and its planted
  set, "each in a crate outside the canvas prefix") and Dogfooding (the edit guard's "Each known failure the preflight
  sets apart names an open issue and the date it was added"); "Known failures are waivers".
- At the base: `scripts/canvas-lint.mjs` (scope, `checkList`, the text scan, the clippy run and its output),
  `lint/canvas/clippy.toml` and `lint/canvas/crates.json`, `tests/canvas-lint.test.mjs` (how a crate is planted under
  a temporary workspace, with vendored registry crates, and linted with `--root`), `scripts/known-failures.json`,
  `scripts/affected.mjs` (`lintFindings`: a lint line's key is its text with `:line:col` dropped; `classify`: a key
  printed more times than the `lint` section's count is new), `scripts/known-failures-check.mjs` (the `(#<issue>,
  added <date>)` suffix it asks of `failures` entries), `scripts/lanes.mjs` (the lint lane runs the canvas lint), and
  the source lines main's findings name. Suites `2324/`, `1399/` and `1114/` for the house format.

## Readings where the issue leaves a choice

- **"exits 0 on main"**: `node scripts/canvas-lint.mjs` with no `--root`, so it lints the checkout the test sits in;
  on the work that is the work's tree. Exit 0 needs its `PASS canvas-lint:` line.
- **"every line left is one `scripts/known-failures.json` records"**: read as the lint lane reads it. The test keys the
  lint's stdout with `affected.mjs`'s own `lintFindings` and judges it with its own `classify` against the file, so a
  line is recorded when the lane would print it `KNOWN`, and a key printed more times than its entry counts is not. A
  `BLOCKED`, `INVALID` or `INCONCLUSIVE` line is never recorded, and a non-zero exit that prints no line fails. Since
  both functions are imported, a new layout for the `lint` section works here as soon as `classify` reads it.
- **"with its issue"**: each recorded line's entry names an issue as `#<n>`. The layout is the implementer's: the test
  accepts a property named by the line's key whose value holds `#<n>` (`"<key>": { "count": 1, "reason": "… (#n …)" }`,
  or a separate section keyed the same way), or an object holding the key as one value and `#<n>` in another (the
  `skips` shape). Which issue, whether it is open and the date are not read: the criterion names only the issue.
  This applies to every line left, so the base's entries that record a lint line by count alone (`deep-text`'s
  `cache.rs`, `deep-canvas-marks`' `scene.rs`, `deep-canvas`'s `check.rs` and `schedule/tests.rs`) need an issue too
  if their lines are still printed, as the design asks of every known failure the preflight sets apart.
- **"still fails a planted static item, a planted `std` float call and an unlisted dependency"**: the lint exits 1 and
  prints a `FAIL` line for each plant, at its file and line, in the issue's wording ("a static item", "use of a
  disallowed method \`f64::sqrt\`", "depends on … which lint/canvas/crates.json doesn't list"). The plants take the
  shapes main's own lines take, so a fix that exempts one of those shapes, rather than the rule as a whole, fails too:
  - the planted crate `planted-closure` is a workspace member outside the canvas prefix, in scope only through the
    closure of `planted-check`, which registers a check kind (`[package.metadata.deep] check_kinds = ["planted"]`), as
    `deep-text` is reached from the canvas crates and as the design places the planted set;
  - static items: a top-level `static` holding a `Mutex`, a `thread_local!` holding a `RefCell` and a function-body
    `static` holding a `OnceLock` cache, the three forms of main's static lines;
  - the std float call: `x.sqrt()` on an `f64`, main's own `f64::sqrt` finding. `lint/canvas/clippy.toml` notes sqrt
    is correctly rounded, which makes dropping it the switch-off most within reach;
  - unlisted dependencies, with the issue's names and versions: `meshopt 0.7.0` directly, `float-cmp 0.10.0` under
    it, and `semver 1.0.28` under a `wasmparser 0.258.3` the planted tree's own listing names. They are stand-ins
    served offline from a vendor directory; listing the real crates in the repository's `lint/canvas/crates.json`
    leaves the plant failing (the lint reads the linted tree's listing), while an exemption by name, or reading only
    a crate's direct dependencies, doesn't.

## Run them

```sh
npm ci                                            # once: affected.mjs imports typescript
export PATH=/opt/homebrew/opt/rustup/bin:$PATH    # when cargo isn't on PATH
node scripts/throttle.mjs build --wait 60 -- env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node --test --test-concurrency=1 tests/acceptance/2144/lint-on-main.test.mjs tests/acceptance/2144/plants.test.mjs
```

The base run below didn't go through the throttle: its one build slot had been held by another session's build for
45 minutes with ten requests queued, so the queued request was stopped (nothing had run) and the same command ran as
`scripts/lease nice -n 10 env … node --test …`, the lease entrypoint at low priority (unleased here: no `deep` CLI).

AC1 runs cargo clippy over every scope crate of the checkout into its `target/` (a timeout of 90 minutes; see the
base run below for how long it took cold). AC2 builds a six-crate workspace in a temporary folder in about a second.
Both set `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless the environment sets them. Node built-ins and
`scripts/affected.mjs` only. The folder builds with cargo in the checkout, so `scripts/lanes.mjs` needs
`'tests/acceptance/2144/'` in its `alone` list; this README is the instruction, and the implementer makes that edit.

## Base results

`BASE-FAILURE.txt` is the one run at the base (2 tests: 1 fails, 1 passes, nothing BLOCKED); `BASE-LINT.txt` is the
lint's raw stdout from that same run, every line verbatim, with the base SHA and exit code at the top (the issue's
"before" proof). A preload outside the suite saved it; the suite itself writes nothing.

- **AC1 fails**, as it must: the lint exits 1 with 72 FAIL lines. Keyed as the lane keys them, 61 are new to
  `known-failures.json` and 11 are recorded under 5 keys whose entries are counts naming no issue. The 72 are the
  issue's 30 (all still there, at moved line numbers), the 11 recorded ones, and **31 that appeared after the audit**
  (`deep-canvas-cells`' `recording.rs`, `deep-canvas`' `craft.rs` with seven std float calls, `deep-canvas-motion`,
  `terrain.rs`, another static in `graph.rs`, another pointer width in `deep-text`'s `cache.rs`, twelve unlisted
  dependencies in the rayon, crossbeam, icu and postcard chains, and `embedded-io` resolved at two versions). The
  criterion reads every line left, so these count too.
- **AC2 passes**, as it may: the base lint already fails all seven plants. Its wrong programs are four mutants of the
  lint, each in a scratch copy (static scan off; `f64::sqrt` off the clippy list; only direct dependencies walked;
  meshopt, float-cmp and semver skipped by name). Each fails AC2 naming the plants its rule no longer fails
  (`BASE-FAILURE.txt`, last section).

AC1 took 47.5 s cold here (`target/` was created by the run; clippy checks, no codegen); AC2 about 3 s.

## Not tested, because no criterion reaches it here

Whether each `lint/canvas/crates.json` entry is a sound audit (its class and why); whether a line was fixed in its
crate or recorded (either passes AC1); the rest of the lint's planted set, which `tests/canvas-lint.test.mjs` already
covers; `scripts/known-failures-check.mjs`'s open-issue and 14-day rules for the `failures` section.
