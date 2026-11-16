# Acceptance tests for #2176: `deep kinds` says in one line that no canvas core is built, as `deep export` does

Written first, blind, from issue #2176 (its report, Scope, three acceptance criteria and Proof) as the brief quoted it,
the design and base commit `72fe11a11` ("Merge pull request #2523 …"), by a job that never saw an implementation; none
existed, and no other branch, worktree or pull request was read, nor the live issue. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion, in one file.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2176.86da3dfd` | `kinds-no-core.test.mjs` (1): `deep kinds --dump <folder>` in a copy of the built CLI with no canvas core |
| AC2 | `#2176.60aad2b6` | `kinds-no-core.test.mjs` (1): `deep kinds --diff <a> <b>` in the same copy |
| AC3 | `#2176.7d36198e` | `kinds-no-core.test.mjs` (1): both, in this checkout with its core built, against the core run directly |

IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over each criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so they aren't checked against it. Each test's name
starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: The canvas core (the issue's design link) and Dogfooding.
- At the base: `packages/hub/src/canvas.ts` (`canvasCore`, `kindsCommand`, `exportCommand`), `packages/cli/src/main.ts`
  (the `kinds` branch, and that `kinds` isn't one of the commands that set a home up), `packages/hub/package.json` and
  `packages/cli/package.json`, `node_modules/@deepbuild/` (links into `packages/`), `scripts/proof-change.mjs`
  (`criterionId`), `scripts/lanes.mjs` and `scripts/affected.mjs` (how `tests/acceptance/` files are picked up).
  Suites `2497/`, `2067/` and `412/` (its `dump.test.ts` and helpers) for the house format and what a dump prints.

## The surface, and the copy

Every test runs the built CLI, `node packages/cli/dist/main.js kinds …`, as a subprocess and reads its stdout, stderr
and exit status. Nothing is imported from production code.

The base finds the canvas core from the hub module's own folder: `deep-show` beside it, else
`target/release/deep-show` or `target/debug/deep-show` three folders up. So AC1 and AC2 run a copy, as the issue's
Proof says: under an `os.tmpdir()` folder, every workspace package (its `test/` and `node_modules/` left out) at
`packages/<name>`, linked from the copy's `node_modules/@deepbuild/` as the checkout links them, and every other
dependency linked to the checkout's `node_modules`. The copy has no `target/`. Before the tests, the copy must load
`@deepbuild/hub` from itself; in each test, none of the three places may hold a core. Either failing is a setup
failure, not the issue's. The folder is removed afterwards. These two tests read the same whether or not the checkout
has a core. `packages/*/dist` must be built and `node_modules` installed.

## Expected values and readings where the issue leaves a choice

- **"the status of a core that can't start"**: **3**. `kindsCommand` at the base answers 3 when the core can't be
  spawned (`child.on('error', () => done(3))`, and `done(code ?? 3)` for an exit with no code). The issue gives no
  number; it says today's is 1, so the expected one differs. `exportCommand`'s 1 is its own "still can't be drawn"
  status, not this command's.
- **"stderr is one line"**: stderr, less its final newline, has no other newline.
- **The line**: it matches `/No canvas core is built under .+ run cargo build --bin deep-show first/`. The issue's "…"
  is left open (the base's words there are the target folder and "; "), and so is anything before or after on that
  line (`deep export` prefixes its command's name; a final full stop).
- **"with no stack trace"**: no line of stderr is a stack frame (`    at …`), a `file.js:line` header, a caret line,
  Node's version line, or names `node:internal`.
- **"prints one line"**: stdout is empty, so the line is all that's printed. Whether `--dump`'s folder is made isn't
  read.
- **AC2, "reads the same"**: the same assertions for `deep kinds --diff <a> <b>`, with two small JSON files that exist.
- **AC3, "both print what they print today"**: today the command hands its arguments to `deep-show kinds` with the
  terminal's own stdout and stderr and exits with its status. So for each of three calls the CLI's stdout, stderr and
  exit status equal, byte for byte, those of this checkout's core run directly with the same arguments (the newer of
  `target/release/deep-show` and `target/debug/deep-show`, as the base picks). The calls, with what the core printed at
  the base: `--dump <folder>` (exit 0, one JSON line with `path` and `module_set`, the dump written under its digest's
  name, and the bytes the CLI's run wrote equal the core's); `--diff` of two copies of that dump (exit 0, one JSON
  line, nothing on stderr); `--diff` of two missing files (exit 2, the design's "2 on bad input"). The statuses and
  shapes are asserted too, so a core that printed nothing doesn't pass.
- **AC3 without a core**: it fails with a message starting `BLOCKED:`; it never passes or skips. Build one with
  `cargo build --bin deep-show --locked` (4 min 5 s here, a 1.4 GB debug binary at `target/debug/deep-show`).

## Run them

```sh
cargo build --bin deep-show --locked     # AC3 needs it; AC1 and AC2 don't
node --test --test-reporter=spec tests/acceptance/2176/kinds-no-core.test.mjs
```

Node built-ins only; about 2.5 s. `scripts/lanes.mjs`'s unit lane leaves `tests/acceptance/`'s node suites to hand
runs, as #2497's README found; run the file by hand as above.

## Base results

`BASE-FAILURE.txt` is the run at the base with the core built (3 tests: 2 fail, 1 passes), whole, with the checkout's
path replaced, and AC3's result from the same command before the core was built.

- **AC1 fails**, for the issue's reason: exit status 1, and stderr opens with a source line of the copy's
  `packages/hub/dist/wire.js:33` and holds `Refused [Error]: No canvas core is built under <copy>/target; run cargo
  build --bin deep-show first.` with a trace. The trace has six frames at this base, not the issue's four (`refuse`,
  `canvasCore`, the promise's function, `new Promise`, `kindsCommand`, `main.js`); nothing asserts the count.
- **AC2 fails** the same way.
- **AC3 passes** with the core built at the base; before it was built it failed `BLOCKED:`.

## Not tested, because no criterion reaches it

`deep export`'s own line; a core that exists and can't be spawned (already 3 at the base); an installed copy with
`deep-show` beside the hub; a diff between two different module sets (#412's suite).
