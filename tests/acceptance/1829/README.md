# Acceptance tests for #1829: a BLOCKED promised check asks you (`promise.blocked` gets its row in the ask sources)

Written first, blind, from issue #1829 (its body as of November 14, 2026: the two Scope bullets, the two acceptance
criteria, the Proof line and Depends on #120), the design sections it leans on ("An ask, and your answer getting
back", whose closing sentences fix `ask.sources@1`: every place that raises an ask has one row, and a source with no
row can't raise one; "Criteria to tests, both ways"; "Dogfooding"), `AGENTS.md`, the #120 suite this reuses
(`tests/acceptance/120/`: README, `helpers.ts`, `wakeup.test.ts`), #318's `sources.test.ts`, the repo-guard
convention of `scripts/blocking-call-guard.mjs`, and the base code's public entries the surfaces build on
(`packages/asks/src/index.ts` and `packages/asks/sources.json`; the hub's raise call sites under `packages/hub/src`
and `packages/extension-host/src`), at base commit `c740dede7193` (main, "Merge pull request #2559"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

At the base, a promise set a fourth time is BLOCKED in the record (`ask: null`) and the inbox is empty, because the
asks core refuses `promise.blocked` (no row) and the hub drops the refusal; and no ask-source check exists. So every
test fails there, at its criterion's assertion (BASE-FAILURE.txt).

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built (`cargo build -p deep-hook`):

```sh
npx vitest run --root tests/acceptance/1829 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1829/tsconfig.json
```

- About 20 s in all on a quiet machine (80 s at load 200); the #120 fixture run (AC1's first test) is most of it. A fixture that stalls before the fourth set fails BLOCKED, not at the criterion.
- Temp folders are `/tmp/dh1829-*` (a socket path must fit in 104 bytes), removed after the run. Every process a test
  starts gets `HOME` set to a temp folder; the hub fixture is #120's, with its rules (stand-ins first on `PATH`, no
  billing key, `CLAUDE*` or `DEEP_*` variable inherited, processes stopped by PID or by the groups its stand-in made).
- With `--root` here, Vitest writes its cache to `tests/acceptance/1829/node_modules/.vite/`; delete it before committing.
- The merge base is `git merge-base HEAD origin/main`; its `packages/` comes from `git archive` into a temp folder
  (no build needed: the check reads source).

## The surface under test

### Merged surfaces, used as their suites define them

- **The #120 wake-up fixture** (tests/acceptance/120, imported, never edited): `deep hub run` with its test clock,
  `deep setup`, the Claude Code stand-in and its waiter, `moveOn` to move time, `events.read`, `inbox.read`. The
  promise is the agent's last words, "I'll check the deploy again in 20 minutes."; it is set again in each woken
  turn; the fourth set is BLOCKED (#120's AC3). The record's BLOCKED event is #120's: an event of the session whose
  data says `BLOCKED` about the deploy, naming its owner (`service` or `you`). Only the home's folder differs:
  `makeHome` here lays the home out exactly as #120's does, under `/tmp/dh1829-*`.
- **ask.sources@1** (#318): `packages/asks/sources.json`, an array of rows each with a `source`.

### Defined here, where the issue and the design leave a surface open

1. **The check** is a repo guard in the shape of `scripts/blocking-call-guard.mjs`:

   ```sh
   node scripts/ask-sources-guard.mjs [--root <checkout>]
   ```

   - It reads every TypeScript source file under `<checkout>/packages/` that isn't a test (not under a `test/`
     folder, not `*.test.ts`, never `dist/` or `node_modules/`), and the rows of
     `<checkout>/packages/asks/sources.json`. Without `--root` it checks the checkout it sits in.
   - For each call of a function named `raise` (`asks.raise(...)`, `this.asks.raise(...)`, `this.o.asks().raise(...)`,
     and the hub's wrappers whose first argument is the source, `this.d.raise('library.fetch', ...)`,
     `this.o.raise('host.change', ...)`) whose source it reads, and whose source has no row, it prints one line:

     ```
     FAIL ask source: <path>:<line>[:<column>]: <source> ...
     ```

     `<path>` relative to the checkout with `/`, `<line>` the line of the `raise` call (the line holding the call's
     source argument on a call that spans lines is also accepted; the plants put each call on one line), `<source>` the
     source as written. The rest of the line is the check's own words.
   - With no finding it prints one `PASS ask source: ...` line. Exit 1 on a finding, 0 on none. A `--root` with no
     folder is the check's to refuse (blocking-call-guard prints a `BLOCKED` line and exits 2); not tested.
   - **How a source reaches `raise`**, all of which it reads: a string literal (`'job.send'`); a named constant in
     the same file (`const ROTATE_SOURCE = 'secret.pasted'`, then `raise(CORE, ROTATE_SOURCE, ...)`), reported as the
     constant's value at the call's line; a wrapper's `raise` whose source is its first argument.
   - **A template** (`` `deep_ask.${kind}` ``) is a pattern: its static parts as written, each `${...}` any non-empty
     text. It has its row when at least one row matches the pattern (`deep_ask.${kind}` matches `deep_ask.choice`,
     `deep_ask.taste`, `deep_ask.unblock`, so it passes); a template no row matches fails, its FAIL line naming the
     template as written (`` planted_template.${kind} ``). The asks core still refuses, at run time, a value the
     template makes that has no row (#318); a static check can't know every value, so this is the line that keeps a
     wholly unknown family of sources from passing.
   - A source it can't read as any of these (a parameter forwarded by a wrapper, such as `core.ts`'s
     `raise: (source, ...) => this.asks.raise(..., source, ...)`) is the implementation's to handle; the wrapper's
     callers are where the source is written, and those it reads. The test that this checkout passes holds it to no
     false finding on the real tree.
2. **The planted sources file** (AC1's second sentence): a scratch copy of this checkout's `packages/` (the working
   tree's tracked and untracked files git doesn't ignore, so the change under test is in it) with
   `packages/asks/sources.json` rewritten without the `promise.blocked` row, run through the check with `--root`: it
   exits 1, and every FAIL line (only that row is gone) names `promise.blocked` at a line that raises it. The real
   tree is never edited. The hub on such a tree would raise nothing and drop the refusal, which is exactly the base's
   behaviour that AC1's first test fails on (zero asks); a second #120 fixture run to show it again was left out to
   keep the suite to one.
3. **The ask** (AC1): read with `inbox.read` after the fourth set. "Exactly one ask" is exactly one open ask whose
   content mentions the deploy (or carries the quote). "Naming its owner" is the ask's content naming, as a word, the
   owner the record's BLOCKED event names (its `owner` field, else `service` or `you` in its data): for the deploy,
   `service`.
4. **The plants** (AC2), in the scratch copy: `packages/hub/src/planted-1829.ts` raises, one call per line, with no
   rows: `'planted_literal.go'` (literal), `PLANTED_CONSTANT` = `'planted_constant.go'` (same-file constant),
   `this.d.raise('planted_wrapper.fetch', ...)` and `this.o.raise('planted_other.change', ...)` (wrappers),
   `this.o.asks().raise(..., 'planted_chained.go', ...)` (chained), `` `planted_template.${kind}` `` (template); and,
   with rows, `'job.send'`, `this.d.raise('library.fetch', ...)`, `` `deep_ask.${kind}` ``.
   `packages/extension-host/src/planted-1829.ts` raises `PLANTED_HOST_SOURCE` = `'planted_host.send'` (no row) and
   `COVERED_HOST_SOURCE` = `'action.send'` (a row). Each row-less raise must get exactly one FAIL line naming its
   `path:line` and its source; no FAIL line names a covered raise; no other FAIL line appears (this checkout passes).
5. **On the merge base** (AC2): the check of this checkout run with `--root` on the base's `packages/`; a FAIL line
   names `promise.blocked` and every `path:line` where the base passes `'promise.blocked'` to `raise` (at
   `c740dede7193`, `packages/hub/src/answer-delivery.ts:291`; the issue's `core.ts:2251` is where it was when the
   issue was written).

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#1829.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (verbatim) | Surface | Test | Fails at the base, and on |
|---|---|---|---|---|
| AC1 `#1829.4f01565f` | A promise set a fourth time raises exactly one ask naming its owner, and it shows in the inbox. A planted sources file without the row fails, naming `promise.blocked` | #120's fixture; `inbox.read`; the record's BLOCKED; the check with `--root` on a planted copy | `ask.test.ts`: (1) set four times, BLOCKED naming `service`, the inbox holds exactly one ask about the deploy naming `service`; (2) the planted copy without the row: exit 1, every FAIL line names `promise.blocked` at its raise; this checkout's file has the row | the base: the inbox is empty and the BLOCKED record says `ask: null` (1); no check (2). A hub that drops the refusal, or a sources file without the row, fails (1) |
| AC2 `#1829.a7d207ff` | A check fails any source string passed to `raise` in `packages/` that has no row in `packages/asks/sources.json`, naming the source and the call site; on the merge base it names `promise.blocked` | `node scripts/ask-sources-guard.mjs [--root <checkout>]`, its FAIL/PASS lines and exit code | `check.test.ts`: (1) this checkout: PASS, exit 0; (2) the merge base's `packages/`: exit 1, `promise.blocked` at each of its raise sites; (3) plants by literal, constant, wrapper, chained call, template, in the hub and the extension host, each named once with its site; covered raises not named; nothing else named | the base: the check doesn't exist ("exits 0" / "exits 1" with exit null) |

Every test fails on the base at the assertion named, not at load (BASE-FAILURE.txt).

## Files

- `helpers.ts`: the criterion IDs, a home under `/tmp/dh1829-*` laid out as #120's, the check as a process and its
  lines, scratch trees (a copy of this checkout's `packages/`, the merge base's from `git archive`).
- `ask.test.ts` (AC1), `check.test.ts` (AC2), `tsconfig.json`.
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
