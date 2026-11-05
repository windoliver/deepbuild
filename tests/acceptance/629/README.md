# Acceptance tests for #629: bound values from a run, a failed assertion's expected and received numbers

Written first, from issue #629 (its scope, its Bound value fields, its six acceptance criteria and its proof line: "The
fixture runs' reports and their record entries, the two bound values' resolved state at each frame, and the refused
figure's issue. A resolver that parses the agent's text, or that turns an unparsable value into 0, must fail"), the
design sections it links and those they lean on, and base commit `e2e6e1cc` ("Merge pull request #1211 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Handles (`<scheme>:<id>[#<fragment>]`; a writer resolves only what it may read), The
  status-color rule (a status color only through a binding to a verdict, a run or an open ask; a return card is a view
  of the record), Honest numbers (every number on screen computed or a bound value with its source and as-of time),
  Bound value (`source: run:`, `select: expected | received`, `format.unit`, `missing: dash`; "A run handle may name one
  assertion its check names, `run:<id>#<assertion>` … read the two values the tool's report recorded for that assertion
  where it failed, as the raw bytes it printed, parsed as a number in the unit `format` declares … A run whose report
  holds no such value … reads missing with `not_reported`, naming the run and the assertion"; resolved from a record
  state pinned to the frame, so a replay shows the same; Lands: "R2 in panels and a run's assertion values"), Status
  binding, and Honest numbers under What holds a document to its rules (an unsourced number fails, naming the item).
- `docs/technical-design.md`: How runs become one of five verdicts (each failed test records where it failed, read
  from the tool's report; "Failing on an assertion"), Bound value and status binding, Panels and devices: Bound value
  in panels ("The same bound value in a panel's UI"), the return card (`return.card@1`, R2), the reference window
  (1512 × 982 points at 2×), Dogfooding and Tests written first; AGENTS.md (an agent's word is never evidence).
- At the base: `tests/acceptance/392/` (bound values and status bindings in `deep-canvas-render`), `30/` (command
  checks: counts and failures come from the report file the runner asked the tool for, never printed output), `401/`
  (`deep-show run`'s plug-in panels and `drawn`, whose conventions this suite extends), `406/` and `382/` (honest numbers
  in `check`, the return card through `deep-gpu`'s `host`), `670/`, `262/`, `1174/` and `1002/` (screenshots and the
  recorded taste call); `crates/deep-show/src/ring.rs` (`drawn`, a panel's bound values drawn through the canvas's
  bound-value text), `crates/deep-replica/src/{main,lib,replica}.rs` and `crates/deep-app/src/views.rs` (the session
  view's return card), `packages/checks-command/src/` (how a run's report is read), Vitest 5.0.5's JSON reporter.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/629 --no-file-parallelism
npx tsc -p tests/acceptance/629/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit (exits 0)
```

Each file first runs `cargo build --locked --bin <bin>` in the checkout for what it uses (`deep-show`;
`deep-canvas-render` for `honest.test.ts`; `deep-replica` for `screens.test.ts`, on macOS only) and copies the binary
out of `target/debug`; a test whose build failed fails with cargo's error. The files build cargo binaries, so they run
one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/629/'` in its `alone` list, as #401's and #406's READMEs
say for their own. This README is the instruction; the implementer makes that edit. Node built-ins and vitest only;
each test's temporary folder (under the OS temp folder) is deleted after it; `screens.test.ts` writes its screenshots
to `target/acceptance/629/` (ignored). A run with `--root` leaves Vitest's cache in
`tests/acceptance/629/node_modules/.vite`; delete it.

`values.test.ts`, `playwright.test.ts`, `summary.test.ts` and `honest.test.ts` are deterministic and run on every
platform (the hub's virtual clock; the document check needs no GPU). `screens.test.ts` draws the app headless at the
reference window, which only macOS does: off macOS, and on macOS until the taste call is recorded, it fails with a
message that starts `INCONCLUSIVE:`; it never passes there.

`BASE-FAILURE.txt` is the run at the base (home paths redacted): all 8 tests fail, each for missing behavior, with the
control that shows the world itself is sound.

## The surfaces under test

The issue names no code API. Panels and the return card are where it lands in R2, so these tests extend the surfaces
earlier suites drew bound values and documents through, with the smallest fields they need. No new binary.

### `deep-show run` (#393's, #400's and #401's JSON-lines scenario, unchanged except as below)

One scenario per stdin line, one JSON object out, exit 0; `{"ok": true, "replies": [Reply]}` one per call in order; a
line that isn't JSON, lacks a required field or names an unknown `planted` value answers `{"ok": false, "code":
"bad_input"}`. The world is #401's (`evidence`, `sessions`, `processes`, `clock`, the displays A and B, `window`,
`panels: {cart: {rect}}`), with #401's `install` of one plug-in, `cart-figure`, whose panel `cart` holds text elements
with a `bind`. Times are flicks. Added:

- **`{"call": "run", "at", "run": "run:<ULID>", "check": string, "tool": "vitest" | "playwright", "report": path,
  "ended": flicks, "summary"?: path}`**: at `at` the hub records a run of `check` that ended at `ended`, whose tool
  wrote the report file at `report` (Vitest's `--reporter=json --outputFile` file, Playwright's JSON reporter's file:
  the file the runner asked the tool for). `summary` is the agent's words about the run, as its session said them (a
  plain-text file): the record keeps them as the agent's, never as evidence. Reply:

  ```json
  {"recorded": {"run": "run:<ULID>", "ended": flicks,
                "assertions": [{"assertion": string, "outcome": "passed" | "failed", "expected": string | null, "received": string | null}],
                …any other fields of the implementer's}}
  ```

  the run's record entry. `assertions` holds one entry per test the report names (`assertion` its name, here `cart
  total`, the test's full name as the report gives it); for a failed one, `expected` and `received` are the raw bytes
  the tool's report printed for the two values (`18.01` and `18` from Vitest's `expected 18 to be 18.01`; `"$18.01"` and
  `"$18.00"` or the same without quotes from Playwright's `Expected:`/`Received:` lines; `N/A`), null where it printed
  none. The tests read the numbers in those strings, or that they contain the printed text, not their exact quoting.
- **`"record"?: [entry]`** on the scenario: a replay. The scenario starts from these record entries, each exactly as an
  earlier scenario's `run` reply gave it (the whole `recorded` object, the implementer's fields included), with no
  `run` call; the report and summary files are gone by then.
- **A bound value on a run.** A `bind`'s `source` may be `run:<ULID>#<assertion>`, where the assertion is the name the
  record entry lists (it may hold spaces: `run:01JB6290000000000000000001#cart total`), with `select: "expected"` or
  `"received"` and optionally `format: {"unit": "USD"}`. The plug-in declares no grant or use for it, and installs.
- **`drawn`** (#401's) adds two fields to each bound entry: `"value": number | null`, the number the frame shows, and
  `"missing": {"cause": "not_reported", …} | null`, which names the run (its ULID appears in it) and the assertion
  (`cart total` appears in it). For a run handle, `source` is the bind's handle (it starts with `run:<ULID>`), `as_of`
  the run's `ended`, `stale` false (no `stale_after`), and `text` what is drawn: the one number as the report printed
  it (`18.01`, `18`, `18.00`: the raw bytes' precision, never more), with its unit (`$` or `USD`) when `format.unit`
  is given; a missing value draws the dash (`missing: dash`), no digit.
- **`planted`** (README of #401: each reachable only through this field, only to prove a test fails on it):

  | Name | The wrong program | Test |
  |---|---|---|
  | `resolver_reads_summary` | a run's expected and received are read from its `summary` (the numbers after the words expected and received) instead of its report | AC5 |
  | `unparsable_reads_zero` | an expected or received value that doesn't parse as a number reads 0, not missing | AC3 |

### `deep-canvas-render check` (#389's, #392's and #406's surface, unchanged)

`{"doc", "look": "clean"}` in, `{ok, issues: [{check, code, severity, ids, path, actual, what, fix}], …}` out. The
document grammar must take a bound value whose `source` is `run:<ULID>#cart total` with `select: "expected"`: at the
base it is refused `bad_handle` (a fragment of `[A-Za-z0-9_.-]` only).

### `deep-replica --view session --out <dir> --appearance light --bound <file>` (macOS; the base's replica, one flag added)

The app's session view headless at the reference window, as `deep-replica --view session` draws it (#882), over the
fixture record plus the runs in `<file>`:

```json
{"runs": [{"run": "run:<ULID>", "check": string, "tool": "vitest" | "playwright", "report": path}],
 "card":  [{"id": string, "bind": Bind}],
 "panel": [{"id": string, "bind": Bind}]}
```

`runs` are recorded from their reports as `deep-show`'s `run` call records them (their end the implementer's, on the
replica's clock); `card` are bound values shown on the session's return card; `panel` the same bound values in a panel
in the window (`Bind` as above). It writes `screens/session.png` (the window at 2×, 3024 × 1964 px) and, beside the
existing snapshot, `<dir>/bound.json`: `{"bound": [{"surface": "card" | "panel", "id", "text", "missing": {…} | null,
"bounds": [x, y, w, h]}]}`, one per bound value drawn, `bounds` in the PNG's pixels, `text` and `missing` as `drawn`'s.

### The taste call: `tests/acceptance/629/TASTE.json`

```json
{"issue": 629, "criterion": "AC6", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "screenshots": {"bound-present.png": sha256, "bound-missing.png": sha256}, "note"?: string}
```

The one file anyone adds to this folder after this commit, and only to record the owner's answer, as #1174's
`TASTE.json` is. No file, a call naming nobody, or one on other screenshots (other SHA-256s) is INCONCLUSIVE;
`looks_wrong` fails; `looks_right` on exactly this run's screenshots passes. No other test reads the pictures or the
call; `screens.test.ts` reads the replica's `bound.json` listing, never a pixel, and the PNG only for its size and
digest.

## Fixtures

Written by this job before any implementation ran. No path or name in them is personal: absolute paths read `/work/shop`.

- `fixtures/vitest-cart-failed.json`, `fixtures/vitest-cart-passed.json`: Vitest 5.0.5's JSON reporter's files, made
  by running the repo's Vitest (`vitest run --reporter=json --outputFile=…`) on `fixtures/vitest-cart/` (the test,
  `src/cart.test.ts.fixture`: `test('cart total', …)` with `const total = totalOf([6, 6.01, 6]); expect(total).toBe(18.01)`;
  `cart.failing.ts.fixture`, whose total drops the cents, so 18 is received; `cart.passing.ts.fixture`, which adds in
  cents), with only the run's paths rewritten to `/work/shop`. The failure message is Vitest's own: `AssertionError:
  expected 18 to be 18.01 // Object.is equality` with its stack, so the received value comes first.
- `fixtures/playwright-cart-failed.json`, `fixtures/playwright-cart-na.json`: Playwright's JSON reporter's shape
  (`config`, `suites[].specs[].tests[].results[]` with `error` and `errors`, `stats`), for spec `cart total` in
  `cart.spec.ts` running `await expect(page.getByTestId('cart-total')).toHaveText('$18.01')`; received `$18.00`, and
  `N/A`. Playwright isn't installed in this repo, so they were written by hand to the reporter's shape, with its
  message as it prints it, ANSI color codes included (`Expected: "$18.01"`, `Received: "$18.00"` and the call log
  naming `$18.00` again).
- `fixtures/agent-summary.txt`: the agent's summary of the Vitest run, which disagrees with the report: "cart total
  expected 18.01, received 18.10". The report holds no 18.1 anywhere.

## Criteria to tests

Each test's name starts with its criterion's ID and names the wrong program it fails on. The checks are written as
failures naming what failed (`bound value received: …`), and the planted programs are run against the same checks.

| ID | Criterion (the issue's text, short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 | Vitest's `cart total` fails at `expect(total).toBe(18.01)` with 18 received: `select: expected` shows 18.01, `select: received` 18, each with the run as source and the run's end as as-of | `values.test.ts` "AC1 the run recorded from Vitest's JSON report …": the `run` call's record entry lists `cart total`, failed, expected `18.01`, received `18`, ended 10 s; in the panel's frames at 13, 20 and 75 s, `expected` shows 18.01 alone and `received` 18 alone, values 18.01 and 18, not missing, source `run:<id>#cart total`, as-of 10 s (the run's end; it was recorded at 12 s). Fails on: a resolver that takes Vitest's first number as the expected one (swapped values); one that stamps the as-of when the hub recorded the run; one that shows nothing |
| AC2 | Replayed from the record, the same two values at the same frame; a run that passed reads missing with `not_reported`, naming the run and the assertion | `values.test.ts` "AC2 replayed from the record entry alone …": the live run's entry, passed back as `record` with the report deleted, draws the same vsyncs, texts, values, as-of times and sources at 13, 20 and 75 s, and AC1's check passes on it. Fails on: a replay that re-reads the report (it's gone); one whose as-of is when the record was loaded. "AC2 a bound value on a run that passed …": the passing report's entry lists `cart total` passed with expected and received null, and both bound values read missing, cause `not_reported`, naming the ULID and `cart total`, with no value and no digit in the text. Fails on: a resolver that shows the assertion's literal `18.01` from a passing test, or 0 |
| AC3 | Playwright `toHaveText` received "$18.00" against "$18.01", `format.unit: USD`: 18.01 and 18.00; a received "N/A" reads missing with `not_reported`, never 0 | `playwright.test.ts` "AC3 received "$18.00" …": the entry holds `$18.01` and `$18.00`; the bound values show 18.01 and 18.00 (the cents as printed) in dollars, values 18.01 and 18. Fails on: one that drops the printed precision ("$18"), or shows no unit. "AC3 a received value "N/A" …": the entry's received holds `N/A`; `received` reads missing `not_reported` naming the run and the assertion, no value, no digit, while `expected` still shows 18.01; `planted: unparsable_reads_zero` fails the same check, every failure naming `bound value received`, one saying it has the value 0 |
| AC4 | A figure typing 18.01 beside a status binding to the same run is refused by honest numbers, naming the item; with the bound value it passes | `honest.test.ts`: the figure (label, `gate` with its fill bound to `run:<id>`, text `expected-total`) typing "18.01": `ok` false and an error `number_unsourced` whose `ids` hold `expected-total`; the same figure with `expected-total`'s text bound to `run:<id>#cart total`, `select: expected`: no error, `ok`. Fails on: a check that skips texts beside a run's status; one that refuses a run assertion's bound value (the base: `bad_handle`) |
| AC5 | A planted resolver that reads the agent's summary instead of the tool's report shows a value the report doesn't hold and fails, naming the bound value | `summary.test.ts`: with the summary given beside the report, the bound values show 18.01 and 18; `planted: resolver_reads_summary` shows 18.10 (value 18.1) at every frame, which the report doesn't hold, and the same check fails, every failure naming `bound value received` |
| AC6 | Screenshots of expected 18.01 and received 18 on the return card and in a panel, and the missing case, from the app at the reference window; one taste call, recorded; else INCONCLUSIVE, never PASS; no criterion reads a picture | `screens.test.ts`: on macOS, `deep-replica --view session --bound` over the failing Vitest run and over the N/A Playwright run; its `bound.json` lists, on `card` and on `panel`, expected 18.01 and received 18 (the first), expected 18.01 and received missing `not_reported` naming the run (the second), each inside the window; each `session.png` is 3024 × 1964; they are written to `target/acceptance/629/bound-present.png` and `bound-missing.png` with their SHA-256s printed; then `TASTE.json` as above. Off macOS: `INCONCLUSIVE:` |

"Attached to the PR and shown to you in the session" is not something a test can see: the implementing agent attaches
the two files the run wrote and shows them; the taste call names them by digest.

## Readings where the issue and design leave a choice

- **Where it lands.** The issue lands it "in panels and on the return card in R2". Panels are `deep-show run`'s
  (#401's panels on the hub's virtual clock, every platform); the return card is the app's, in the session view, which
  only `deep-replica` draws headless (macOS). AC1 to AC5 read panels, so they run on every platform; AC6 reads both.
  `deep-gpu`'s `host` `return_card` (#382, #406) draws a 3D film inside a card and has no record of runs, so it isn't
  used.
- **The run's record entry.** The proof names "the fixture runs' reports and their record entries", and a replay must
  show the same values with no report, so the hub reads the report once, when it records the run, into an entry that
  holds each assertion's raw expected and received bytes. The `run` call stands in for the command check closing a
  run (#30 reads failures from the same report file); it takes the report file itself, so the fixtures are the tools'
  own reports and no tool runs in these tests.
- **"Replayed from the record"** is a second scenario that starts from the first one's record entry, verbatim, with
  the report deleted, drawing at the same frame times. A run binding has no `stale_after`, so a replay on another host
  clock would draw the same; the as-of is checked against the run's end so a load-time stamp fails.
- **"Naming one assertion the run's check names"**: the fragment is the test's name as the report gives it (`cart
  total`, Vitest's `fullName`, Playwright's spec title). It holds a space, as the issue writes it; the base's fragment
  grammar refuses that, so the grammar widens for run assertions (or the implementer encodes the name; the tests send
  `#cart total`).
- **"Shows 18.01 … shows 18"** is the drawn text holding exactly one number, written as the report printed it, and
  `value` that number. "18.00" keeps the printed cents: the precision is no more than the source carries, and the
  source is the raw bytes. The unit, given `format.unit: USD`, is shown as `$` or `USD`.
- **"The run as its source"** is `source` starting with `run:<ULID>` (the handle with the assertion is what the tests
  send back); **"the run's end as its as-of time"** is `as_of` equal to the `run` call's `ended`.
- **"Naming the run and the assertion"** is the `missing` object holding the run's ULID and `cart total` somewhere in
  it; its exact fields are the implementer's. **"Never 0"** is no value and no digit in the drawn text.
- **The agent's summary** reaches the hub as the `run` call's `summary`, the agent's words about the run, so a resolver
  could read it; the real one must not (an agent's word is never evidence). The planted resolver reads the numbers that
  follow "expected" and "received" in it.
- **AC4's "beside a status binding to the same run"** is a status binding whose source is `run:<ULID>` (no fragment)
  on a rect's fill in the same figure; the bound value's source is the same run with its assertion.
- **The taste call's record** follows #1174's `TASTE.json`, bound to the screenshots by digest (it assumes the replica
  draws the same bytes run to run on one Mac, as #1002's reading 5 says).

## Not tested, and why

- The canvas's R1 rules for a run's values (a record state pinned to the frame, the as-of on hover, no typing over):
  the issue lists them under scope with no criterion of their own, and #392's suite already holds bound values to them
  on the canvas. `show.source`, `show.as_of` and the hover are not read.
- Reports of other tools (Jest, pytest, `go test`, node:test), a report that omits the test altogether (the passing
  run stands for "holds no such value"), units other than USD, notations, and grants for reading a run from a plug-in.
- Whether the return card and the panel draw the values well: that is the taste call, read by no criterion.
