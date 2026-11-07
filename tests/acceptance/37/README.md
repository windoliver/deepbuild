# Acceptance tests for #37: journeys with Playwright, end-state checks, evidence and a feature list

Written first, blind, by a job that never saw an implementation of #37. On November 3, 2026, at the base commit
`69803b94` (origin/main), it read:

- issue #37: its Scope (14 bullets), its Fields block (the Check primitive), its 25 checkbox criteria, its Proof
  ("a sample app with a working and a broken build"), its References and Depends on, and its "Added Oct 9" bullets
  (the fixed defaults 1280×720, en-US, UTC, light theme, reduced motion, service workers off; secrets by name only;
  a step's ID and deadline; a run that dies keeps what it captured; the comparison with the last PASS step by step;
  saved journeys as plain Playwright scripts). The issue has no comments.
- `docs/technical-design.md`: the `journeys` row and the `env-local`, `checks-command`, `done-gate` and `github`
  rows of First-party extensions that ship on by default, and the `done.yaml` after them; How runs become one of
  five verdicts (Fail before pass after, Failing on an assertion, Evidence states, Pinned to a commit, The stack a
  check runs against, Proof depth, Where not just what); Evidence; Privacy; the Check primitive; the Extension API;
  Reading by reference (the quote rule a model reading uses); Dogfooding; Tests written first
- `AGENTS.md`
- the acceptance tests of #30, #331, #351 and #349, for their conventions (README, helpers, `wrong.ts`, `twins/`,
  fixture stacks env-local starts, BASE-FAILURE), `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`,
  `scripts/proof-runs.mjs` (how twins and plants are proved), `scripts/repo-rules.mjs` and `scripts/repo-rules.json`
- the public entries of the packages the surface stands on: `conformance` (check.kind@1 and its kit, with its
  planted runners `past-deadline`, `crashed-suite` and `type-error-as-assertion`), `env-local` (`upStack`,
  `downStack`, `envLocal`, the `environment` block of `.deepbuild/done.yaml`), `supervisor` (host@1), `evidence`
  (`openEvidenceStore`, `Redaction`, `Step`, `send` and its boundary), `gate` (`attributeStack`, `StackRecords`,
  `Trees`, `Served`), `verdicts` (`Run`, `JourneyStep`, `Depth`) and `checks-command` (the sibling check kind, the
  model of how a kind is shaped and registered)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

**The criterion count.** The issue has 25 checkbox criteria, AC1 to AC25 in the body's order; the request that
started this job said 24. Each is tested here.

## How to run

With the repo's Node (24.22.0) and Playwright's Chromium installed (`npx playwright install chromium`, once):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the supervisor's sandbox helper; the kit's suites
node node_modules/vitest/vitest.mjs run --root tests/acceptance/37 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/37/tsconfig.json   # needs packages/checks-journey
```

- **`--no-file-parallelism`:** every file starts real stacks through the supervisor on leased ports and drives a real
  browser; the kit spawns suites; the latency check only means something with nothing else running.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`. Playwright's browsers are read
  from wherever Playwright installed them; the tests never launch a browser themselves.
- **Temp folders:** every checkout, world, cache and home is under `/tmp/dh37-*`, a real path, removed after its
  file. Every stack a test starts goes through the supervisor and is torn down by run; what the app wrote a PID
  file for (`<checkout>/.pids/server.<pid>`) is stopped by that PID after the file, after checking it still runs this
  suite's app; nothing is stopped by name or port. No network beyond 127.0.0.1.
- **On Linux**, the supervisor's sandbox (bubblewrap, #70) sees only system folders and the login `PATH`, so run
  Vitest with a Node the sandbox can read (this box: `/var/tmp/deep40/node/bin/node`); `helpers.ts` writes that
  Node's path into each checkout's `done.yaml`.
- **Slow files:** `screens.test.ts` (each comparison renders the base twice and the head once, on three stacks),
  `latency.test.ts` (two sides, several runs each), `kind.test.ts` (the kit's suites), `motion.test.ts` (each check
  runs twice), `steps.test.ts` and `stack.test.ts`. The whole suite is minutes, not hours.
- **AC16 (`budgets.test.ts`) counts only on the reference Mac** in a fit state, gated by `environmentProblem()` as
  #348's and #331's budgets are; anywhere else it fails `BLOCKED`, naming why, since nothing unrun passes. Run it by
  hand on the Mac: `node node_modules/vitest/vitest.mjs run --root tests/acceptance/37 budgets.test.ts`.
- With `--root` here, Vitest writes its cache to `tests/acceptance/37/node_modules/.vite/`; delete that folder
  before committing.
- Nothing is skipped: at this base every test fails (BASE-FAILURE.txt).

## The surface under test

The issue and the design name the journey check kind (`journeys`, the first-party extension), `check.kind@1`,
`.deepbuild/features/` and `.deepbuild/journeys/`, env-local's stack from a check's checkout, the evidence store,
`attributeStack` and the five verdicts, but no package entry or function. This job defines the smallest surface
that reaches every criterion, shaped like `packages/checks-command` (#30), at a new first-party extension package
`packages/checks-journey/` with the public entry `packages/checks-journey/src/index.ts`. `playwright` 1.64.1 is its
dependency (add it to `scripts/repo-rules.json` with why). The tests reach the browser, the stack and every
comparison only through this entry.

### `packages/checks-journey/src/index.ts`

<!-- SURFACE:BEGIN -->
```ts
import type { CheckResult, CheckRunnerFill } from '@deepbuild/conformance';
import type { EvidenceStore, Redaction } from '@deepbuild/evidence';
import type { Served, Trees } from '@deepbuild/gate';
import type { Host } from '@deepbuild/supervisor';
import type { Depth } from '@deepbuild/verdicts';

/** The planted wrong programs the criteria name, selected per run; tests only. */
export type Plant = 'end-state-only' | 'response-as-end-state' | 'deadline-under-expect' | 'checkout-as-asked' | 'reading-as-pass' | 'raw-url'
  | 'every-replay-recorded' | 'tolerates-16-pixels' | 'unstable-base-as-difference';

/** A model an end-state check with oracle `model` reads with; the tests supply a fake. */
export interface Model { read(input: ModelInput): Promise<ModelReading> }
/** All the model gets: the requirement and the end step's redacted screen (the text snapshot, and a screenshot only when none of the run's is incomplete). */
export interface ModelInput { requirement: string; snapshot: string; screenshot: Uint8Array | null }
export interface ModelReading { answer: boolean; quote: string }

export interface JourneyRunOptions {
  host: Host;                          // host@1: the stack's processes start only through it (env-local's upStack)
  evidence: EvidenceStore;             // where screenshots, video, trace, script and recording go, by hash, as deepbuild/journey
  run: string;                         // run:<ULID>
  checkout: string;                    // the temporary checkout the stack starts from (its .deepbuild/done.yaml environment block)
  journey: string;                     // the journey file, relative to the checkout (.deepbuild/journeys/<id>.yaml)
  trees: Trees;                        // gate's Trees: the checkout, the live worktree, other checkouts; attributeStack places the stack's processes
  secrets?: Record<string, string>;    // by name, from leases: a step's `secret: NAME` types its value; scrubbed from everything recorded
  reducedMotion?: 'reduce' | 'no-preference';   // the fixed default is reduce
  model?: Model;
  stop?: AbortSignal;                  // the hub going down: the run ends stopped and keeps what it captured
  environment?: { plant: 'swap-partway'; to: string };   // a planted environment: after the first step, the stack's app is served from `to`
  plant?: Plant;
}
export interface Box { x: number; y: number; width: number; height: number }
/** A control, found by role and name, label or test ID within its named container; never a CSS path. */
export interface Locator { role?: string; name?: string; label?: string; testId?: string; within?: { role: string; name: string } }
export interface Control { role: string; name: string; testId?: string }
export type PageError =
  | { kind: 'uncaught'; message: string; step: string }
  | { kind: 'request'; url: string; status: number | null; unfinished: boolean; step: string };
/** One entry of the browser's own animation list, started on the page during the step. */
export interface Animation { target: Control; property: string; from: string; to: string; duration: number; delay: number; easing: string }
export interface StepRecord {
  id: string;
  outcome: 'passed' | 'failed' | 'overran' | 'stopped' | 'unrun';
  startMs: number; endMs: number;      // in the video
  route: string;                       // IDs, tokens and timestamps in the path or query read as one placeholder: /order/{id}
  controls: { appeared: Control[]; left: Control[]; changed: Control[] };
  screenshot: string | null;           // sha256; null for an API journey
  errors: PageError[];                 // the page's own errors during the step, declared or not
  animations: Animation[];
  firstFrame: { opacity: number; transform: string } | null;   // the motion target on the first frame it appears (motion steps)
}
export interface EndStateRecord {
  id: string;
  oracle: 'code' | 'model' | 'person';
  outcome: 'passed' | 'failed' | 'reading';   // a model's is a reading, never passed
  selector: Locator | null;            // what it looked at, for a locator check
  box: Box | null;                     // the bounding box it looked at, in the screenshot
  screenshot: string | null;           // the run's screenshot it looked at
  readback?: unknown;                  // what a readback check read from the real system
  reading?: { answer: boolean; quote: string; found: boolean; counted: boolean; sendBack: boolean };
}
/** A closed run outcome, check.kind@1's CheckResult plus the run record's fields. Never a verdict. */
export interface JourneyRun extends CheckResult {
  run: string;
  stack: { run: string; pid: number; ports: Record<string, number> } | null;   // null when no stack started
  served: Served;                      // gate's attributeStack on the supervisor's records of the run
  tree: string | null;                 // the served tree, by digest, when the records place it in the checkout
  steps: StepRecord[];
  endState: EndStateRecord[];
  video: string | null; trace: string | null;   // sha256; the video carries evidence Steps (step, startMs, endMs)
  script: string | null;               // the saved replayable script, a plain Playwright script, on a pass
  recording: string | null;            // the run's requests and responses
  expectedErrors: PageError[];         // the declared errors met, listed
  cause: string | null;                // for a missing run
  depth: Depth;
  recorded: boolean;                   // answered from a recording
  reducedMotion: 'reduce' | 'no-preference';
  redaction: Redaction;                // of the run's video
  timing: { total: number; playwright: number };   // ms: the run, and Playwright's own time in it
}
export type Review = { ok: true } | { ok: false; reasons: string[] };
export interface Feature { feature: string; name: string; files: string[]; journeys: string[] }
export interface Requirement { req: string; depth: Depth; oracle: 'code' | 'model' | 'person' }
export interface TasteAsk { kind: 'taste'; screenshot: string; reading: string }
/** What the core would make of the run for a requirement: the checks that count, and the verdict row that applies. */
export interface Cover { counted: string[]; wouldBe: 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE'; reasons: string[]; ask?: TasteAsk; sendBack: boolean }
export interface MaskAsk { kind: 'taste'; step: string; region: Box; mask: Locator; screenshot: string }
export interface Difference { step: string; boxes: Box[]; sizeChanged: boolean }
export interface Delta { kind: 'screen' | 'dom' | 'request' | 'timing' | 'bundle'; step?: string; what: string; base: string | number | null; head: string | number | null }
export interface ScreenOptions {
  host: Host; evidence: EvidenceStore;
  journey: string;                     // relative to each checkout
  base: { checkout: string; commit: string };   // the merge base's checkout and commit
  head: { checkout: string };
  cache: string;                       // where base renders are kept, per base commit, check, environment profile and machine
  spec: string;                        // the approved journey file a mask is saved to on your answer
  requirement: 'no-visible-change' | 'visual';
  answer: (ask: MaskAsk) => Promise<boolean>;   // you
  plant?: Plant;
}
export interface ScreenResult {
  outcome: 'passed' | 'failed' | 'uncounted' | 'INVALID';
  named: string[];                     // what the outcome names: the step and boxes, the region, the mask
  differences: Difference[];
  deltas: Delta[];                     // every delta that remains, screen, DOM, request, timing and bundle
  screens: { step: string; base: [string, string]; head: string }[];   // sha256 of each side's capture
  sideBySide: string | null;           // base beside head, with the boxes
  highlighted: string | null;          // the head frame with a strip beside it marking each change's rows
  taste: boolean;                      // the difference is evidence for a taste call (a visual requirement)
  renders: { base: number; head: number };   // renders made in this call (0 base renders when the cache held them)
  spec: string;
}
export interface Latency { outcome: 'passed' | 'failed'; base: number[]; head: number[]; shown: string }
export interface Motion { normal: JourneyRun; reduced: JourneyRun; outcome: 'passed' | 'failed' | 'inconclusive'; named: string[] }

/** Review of a journey file as data: end state required, no credential, no baseline image. */
export function reviewJourney(text: string): Review;
/** One journey against a stack env-local starts from the checkout through `host`, torn down after; the run's evidence stored. */
export function runJourney(o: JourneyRunOptions): Promise<JourneyRun>;
/** A saved script replayed against the stack (a real run), or, with `recording`, answered from it (a recorded run). */
export function replayJourney(o: JourneyRunOptions & { script: string; recording?: string }): Promise<JourneyRun | { status: 'refused'; reason: string }>;
/** The receipt for a step: the video, where to open it, and the line naming the tree the stack served. */
export function receiptFor(run: JourneyRun, step: string): { video: string; atMs: number; line: string };
export function listFeatures(checkout: string): { features: Feature[]; withoutJourney: string[] };
/** The changed features' journeys plus their nearest neighbors, the features that share changed files. */
export function selectJourneys(checkout: string, changed: string[]): { features: string[]; journeys: string[] };
/** The first step whose route or changes differ from the last PASS, or null. */
export function compareSteps(last: JourneyRun, next: JourneyRun, options?: { plant?: Plant }): { step: string | null; why: string | null };
export function requirementCover(run: JourneyRun, requirement: Requirement, options?: { plant?: Plant }): Cover;
/** The journey's screens on the head against the merge base rendered here, twice, under the same profile. */
export function compareScreens(o: ScreenOptions): Promise<ScreenResult>;
/** Two PNGs, equal only when every pixel outside the masks is equal; a size change is a difference. */
export function comparePixels(base: Uint8Array, head: Uint8Array, masks: Box[], options?: { plant?: Plant }): { equal: boolean; boxes: Box[]; sizeChanged: boolean };
export function latencyCheck(o: { host: Host; evidence: EvidenceStore; journey: string; base: string; head: string; runs: number; margin: string }): Promise<Latency>;
/** A motion journey run twice, with reduced motion off and on. */
export function motionCheck(o: JourneyRunOptions): Promise<Motion>;
/** Playwright's own time in a run, ms (AC16). */
export function playwrightTime(run: JourneyRun): number;
/** The check.kind@1 fill (#13, kit from #314) for the kind `journey`. */
export function journeyCheckKind(host: Host): CheckRunnerFill;
```
<!-- SURFACE:END -->

### The journey file (`.deepbuild/journeys/<id>.yaml`)

The design names the file and what it holds, not its keys. The fixtures write these:

```yaml
journey: cart-total          # its ID
feature: cart                # the feature it proves (.deepbuild/features/<feature>.yaml)
depth: journey               # journey | live
api: false                   # true: no browser; steps are requests
masks: []                    # locators the approved spec names: [{ role: contentinfo, name: Footer }]
steps:
  - id: open                 # every step has an ID and a deadline (ms)
    deadline: 10000
    goto: /cart
  - id: see-total
    deadline: 5000
    expect: { role: status, name: Total, text: "$18.00" }   # a web-first assertion; `visible: true`; or
                                                           # { until: true, evaluate: "<js>", equals: "<text>" } (a toPass block)
    timeout: 2000            # the expect's timeout; the runner keeps it under the step's deadline
  # click: { role: button, name: Pay, within: { role: region, name: Actions } }
  # fill: { role: textbox, name: Password, secret: TEST_PASSWORD }   # a secret by name; `text:` for plain text
  # scroll_into_view: { role: article, name: Featured }
  #   motion: [{ target: {...}, property: opacity, from: "0", to: "1", duration: 700, delay: 0, easing: "cubic-bezier(0.33, 1, 0.68, 1)" }]
  # request: { method: POST, path: /api/cart, body: { name: Tea } }   # an API step
  #   status: 200
expected_errors: []          # [{ step: confirm, message: "boom at step 3" }, { step: open, url: /img/missing.png, status: 404 }]
end_state:                   # required, at least one check whose oracle is code or person
  - id: total-shown
    oracle: code
    locator: { role: status, name: Total }
    text: "$18.00"           # or visible: true
  - id: cart-stored
    oracle: code
    readback: { method: GET, path: /api/cart }   # the real system
    equals: { total: "$18.00" }                  # or count: { orders: 1 }
  # - id: looks-right
  #   oracle: model
  #   requirement: "the cart total reads $18.00"
```

A feature file (`.deepbuild/features/<id>.yaml`): `feature`, `name`, `files` (the paths a change to it touches) and
`journeys` (its journey IDs; empty for a feature without one).

### The sample app (`fixtures/app`)

A dependency-free Node app (`server.mjs`, with its page, stylesheet and script served from it) that reads its port
from `web` and which build it is from `build.json` beside it; the working build has no flags. `helpers.ts`'s
`checkout(flags)` copies it into a temporary checkout as one snapshot. The builds the criteria name: `s2` ($18.01),
`export` (the Export button), `error-step3`, `missing-image`, `clock-footer`, `moved-8px`, `bigger-bundle`
(+100 bytes of app.js), `no-pay`, `no-store` (POST /api/cart answers 200 and stores nothing), `unhealthy`, `slow`
(+400 ms a page), `motion-400`, `motion-no-reduce`, `motion-script`. Its `.deepbuild/done.yaml` has the
environment block env-local reads (`up`, `ports: [web]`, `ready: { http: .../health }`), as #331's fixtures do.
The Total element is placed at (100, 200), 120×40; the Pay button near (100, 300); the hero image at (100, 400);
the footer at (100, 500), 300×24; the motion card 2000 px down the page.

## Readings

Where the issue is silent, this job read:

- **End state (AC1).** A journey's checks on what the page shows are its steps' `expect`s; an end state is an
  `end_state` entry: a locator check, a readback from the real system, or a model reading. "Checks only a label" is a
  journey whose `end_state` is empty or missing, and one whose only end-state check is a model reading, which can
  never pass alone (AC20), is refused too.
- **`deep env down` (AC2).** A run's stack is started by the runner from the checkout and torn down by run after the
  run, as a check's stack is; the test reads "after `deep env down`" as after that teardown: the app's process gone,
  the evidence whole in the store by hash.
- **The box (AC3).** The element's own bounding box, as the fixture's stylesheet places it, at 1280×720 with a device
  scale of 1; a readback check looks at no element (`box: null`).
- **Within one frame (AC7).** The video's evidence `steps` (the store's `Step`) are the runner's record of where
  each step starts and ends; the receipt opens at the step's start, within 1000/15 ms of it. The test checks the
  receipt against that record and the record's order and spans; it doesn't decode the video.
- **Incomplete (AC8).** From the typing step on, each screenshot and the video are `redaction: incomplete`; the
  steps before it stay `complete`. The export is the evidence store's own `send` (#15), whose boundary asks you.
- **Neighbors (AC5).** A changed path selects every feature whose `files` list it; the result is those features
  and the union of their journeys; a path no feature names selects nothing.
- **Side by side and the strip (AC6, AC11).** The side-by-side image is at least two frames wide; the highlighted
  image is the head frame plus a strip at its right, marked (non-white) on the rows of each changed box and clear
  elsewhere. A visual requirement is never passed or failed by a difference: `taste: true`.
- **Deltas (AC9).** `deltas` lists everything that remains after the masks: screen boxes, DOM changes (naming the
  element), requests, timings and bundle sizes (`base` and `head` in bytes). The same build lists none.
- **Latency (AC10).** `runs` journeys a side, the same count each, medians compared at `margin`; `shown` carries both
  times in ms.
- **Endings (AC12).** A step past its deadline: `overran` naming the step; a stack never ready: `missing` with the
  cause (BLOCKED in the verdict table), no step run; a stop signal: `stopped`, with the captured steps' screenshots.
- **The kit (AC13).** check.kind@1's kit has one reference, the command kind, and its fixed and seeded cases are
  command suites; a check kind that replaces a shipped one runs the kit's fixed part (#349). So `journeyCheckKind`
  answers a spec of kind `command` as the command kind does (it may delegate to `@deepbuild/checks-command`, an
  extension importing a sibling extension) and a spec of kind `journey` as a journey, and passes the kit. The three
  planted runners the criterion names are built from it as #30's `wrong.ts` builds them (`wrong.ts` here).
- **The API journey (AC14).** `api: true`; each step a request with its expected status; the end state a readback.
  On the `no-store` build the POST's 200 is not the end state.
- **The page's own errors (AC15).** Recorded per step: an uncaught error by message, a failed request by URL and
  status (an unfinished one marked). The failure names the error or URL and the step; a declared one (step and
  message or URL) is listed in `expectedErrors` and passes; declared for another step, it still fails.
- **Budgets (AC16).** `timing.total` and `playwrightTime(run)`: the runner's share is `(total − playwright) /
  playwright`. The merge-base comparison is the perf lane's.
- **Credentials (AC17).** A step's `fill` with `text:` into a field named `password`, or any `secret:` with a value
  rather than a name, is refused at review naming the step; a run on such a file is refused before any stack
  starts (`stack: null`). The value a lease gives is scrubbed as evidence is (#15).
- **Lines (AC18).** A failure's `file` is the journey file (relative to the checkout) and its `line` the line of
  the step's `expect` or action; the selector is in the message as Playwright writes it. A toPass block is
  `expect: { until: true, ... }`.
- **The tree (AC19).** `served` is gate's `attributeStack` on the supervisor's records of the run's processes;
  `tree` is the checkout's tree digest when it served the checkout. The planted environment (`environment.plant:
  'swap-partway'`) serves the app from `to` after the first step, so the stack's process works in S2's folder.
  An uncounted run's screenshots are stored with a kind naming `uncounted` and left out of `evidence`.
- **The reading (AC20).** The model gets exactly `{ requirement, snapshot, screenshot }`; the snapshot is the end
  step's roles, names and values, and the screenshot is null when any screenshot of the run is incomplete. A
  reading's `found` is the quote rule of Reading by reference on the snapshot; `counted` is true for a dropped
  reading (counted in the run's output). `requirementCover` says what the core would make: with no counted check
  `INCONCLUSIVE` and one taste ask; a found false reading `sendBack`.
- **Routes and controls (AC21).** `route` has one placeholder per ID, token or timestamp, `/order/{id}`;
  `controls` are the roles and names that appeared, left or changed during the step. `compareSteps` names the first
  step whose route or changes differ.
- **Depth (AC22).** A replay against the stack: `recorded: false`, `depth: journey`, and it covers a `live`
  requirement (a deeper proof satisfies a shallower one, and a real run of the deployed server is live for its
  requirement); with `recording`, either refused naming `live` or a `recorded: true` run that `requirementCover`
  won't pass at live depth.
- **Screens (AC23, AC24).** `base.commit` plus the check, the environment profile and the machine key the cache;
  `renders` counts what this call rendered. A journey naming a `baseline` image is refused at review. The clock
  footer's region differs between the two base renders: `uncounted`, naming it, one `MaskAsk` proposing the
  smallest element holding it (the Clock span, not the footer), saved into `spec` on `true`.
- **Motion (AC25).** `motionCheck` runs the journey with reduced motion off (`normal`) and on (`reduced`); the
  step's `animations` come from the browser's animation list; `firstFrame` is the target's computed opacity and
  transform on the first frame it appears under reduced motion. A build with no entry for the required motion
  leaves `inconclusive`, naming the card.

### Scope the tests leave alone

In the Scope with no criterion of their own, so untested here; a PR should say how it proves them: a feature list
proposed by agents and the ask to propose a journey for a feature with no journey; the trace as evidence beyond
its presence; `expect.poll`; a request that never finished recorded as unfinished (the field is in the shape); the
digest and size on every text artifact; goal steps.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#37.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped (as `scripts/proof-change.mjs` does). A test headed `(wrong program)` runs the criterion's assertion on the
planted twin it names, checks the twin is that twin, and expects the assertion to fail (`assertionFails`).

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#37.32d0ded7` | a label-only journey fails review: end state required | `review.test.ts` (2) | fails (no surface) |
| AC2 `#37.ed0df801` | evidence remains after the stack is down | `evidence.test.ts` (1) | fails |
| AC3 `#37.066be7dc` | each end-state check records selector and box with the screenshot | `evidence.test.ts` (1) | fails |
| AC4 `#37.18a57a59` | a broken page fails with a screenshot of the failure | `evidence.test.ts` (1) | fails |
| AC5 `#37.65684c1c` | a shared file runs the neighbors' journeys | `features.test.ts` (2) | fails |
| AC6 `#37.bb6b115c` | an 8 px move fails "no visible change", diff side by side | `screens.test.ts` (1) | fails |
| AC7 `#37.8b056f27` | a receipt opens the video within one frame of the step | `evidence.test.ts` (1) | fails |
| AC8 `#37.ff0f6f4d` | a password in a plain field marks later evidence incomplete; export refuses | `evidence.test.ts` (1) | fails |
| AC9 `#37.e421f602` | DOM and bundle diffs, every delta listed | `screens.test.ts` (1) | fails |
| AC10 `#37.892b5a33` | latency on both sides, same runs, fails past the margin showing both | `latency.test.ts` (2) | fails |
| AC11 `#37.bb3ba137` | highlighted screenshots with a strip, unasked | `screens.test.ts` (1) | fails |
| AC12 `#37.08d1098f` | overran; missing (BLOCKED) on an environment; a dying run keeps what it captured | `endings.test.ts` (3) | fails |
| AC13 `#37.f105223d` | passes check.kind@1; three planted runners fail it | `kind.test.ts` (4) | fails |
| AC14 `#37.d6f5f71b` | an API journey passes only on the end state read back | `api.test.ts` (3) | fails |
| AC15 `#37.8d57abb1` | page errors fail the step naming them; expected ones listed and pass; end-state-only runner fails | `errors.test.ts` (4) | fails |
| AC16 `#37.2f7f3193` | budgets on the reference Mac | `budgets.test.ts` (1) | BLOCKED off the Mac |
| AC17 `#37.47553e4b` | no credentials in journey files | `review.test.ts` (3) | fails |
| AC18 `#37.66b03932` | expect fails by locator timeout as an assertion before the deadline; click an error; toPass TypeError an error; planted deadline fails | `assertions.test.ts` (4) | fails |
| AC19 `#37.23f2f878` | S1 served and named; S2 swap uncounted; checkout-as-asked runner fails | `stack.test.ts` (3) | fails |
| AC20 `#37.51b3f942` | the model reading's inputs, INCONCLUSIVE alone, send-back, dropped, reading-as-pass fails | `reading.test.ts` (5) | fails |
| AC21 `#37.38cbc4c5` | routes with placeholders and controls; first differing step; raw-URL fails | `steps.test.ts` (3) | fails |
| AC22 `#37.9ea050d3` | replay is a real run at journey depth; a recording can't pass live; every-replay-recorded fails | `steps.test.ts` (3) | fails |
| AC23 `#37.42a70bf0` | the base render is the only baseline; capture rule; masks; INVALID mask; 4×4 block; tolerant comparator fails | `screens.test.ts` (5) | fails |
| AC24 `#37.94ac69b6` | base rendered twice and cached; unstable region uncounted with one mask ask, saved; second claim silent; difference rule fails | `screens.test.ts` (3) | fails |
| AC25 `#37.e2d2dca9` | the card's motion recorded and passes; 400 ms fails; reduced motion; per-frame script INCONCLUSIVE | `motion.test.ts` (4) | fails |

## Wrong programs

The planted twins are the surface's own `plant` options (as #30's are), since the package doesn't exist at this
base and no file can be laid over it; each `(wrong program)` test feeds the planted run to the criterion's own
assertion. No `twins.json` is needed: at this base every test fails on the merge base at its assertion, and the
in-test twins prove the criteria that name one.

| Twin | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `plant: 'end-state-only'` | AC15 | passes a run whose end state passed, whatever the page threw | the uncaught error at step 3 passes; the assertion says the journey fails |
| `plant: 'response-as-end-state'` | AC14 | passes on the responses' statuses | the `no-store` build passes; the assertion says the readback fails |
| `plant: 'deadline-under-expect'` | AC18 | sets the step deadline under the expect timeout | the Export journey overruns naming the step; the assertion says it failed at the expect |
| `plant: 'checkout-as-asked'` | AC19 | takes the checkout it asked for as the tree served | the swapped run is a FAIL of S1; the assertion says uncounted naming S2 |
| `plant: 'reading-as-pass'` | AC20 | counts a true reading as a pass | the reading-only journey passes on the broken build; the assertion says INCONCLUSIVE |
| `plant: 'raw-url'` | AC21 | compares steps by raw URL | the second checkout names the confirmation step on the order ID; the assertion says no step |
| `plant: 'every-replay-recorded'` | AC22 | treats every replay as recorded | the replay against the stack can't pass a live requirement; the assertion says it does |
| `plant: 'tolerates-16-pixels'` | AC23 | passes an image with up to 16 differing pixels | the 4×4 block passes; the assertion says a difference |
| `plant: 'unstable-base-as-difference'` | AC24 | fails the first claim as a difference | the clock footer fails; the assertion says uncounted with one ask |
| `wrong.ts`'s `bent` (`past-deadline`, `crashed-suite`, `type-error-as-assertion`) | AC13 | the kit's three named planted runners, built from the journey kind | each fails the kit with its own message |

The criteria that name no twin (AC1 to AC12, AC16, AC17, AC25) fail on the base; each checks the passing half too
(the fixture journey passes review, the working build passes), so a runner that refuses or fails everything fails
them as well. Past that, the mutation lane is their wrong program.

## Approved changes after the draft

Disputed on the work and approved by the owner on 2026-11-04 (PR #1153), after its blind redraft passed on the work:
AC7's first draft moved, unchanged, from `evidence.test.ts` into `receipt-first-draft.test.ts`, which is kept as
written and run by hand only (`scripts/lanes.mjs`, byHand). Its precondition needs the cart journey's first step to
take more than one frame (1000/15 ms), and the reference Mac now runs it in 31 to 34 ms, so it fails before AC7 is
checked. Its blind redraft, `redraft-ac7/` (REDRAFT.md), holds two steps 2 s in the page and runs in its place.

The blind redrafts of AC18 (`redraft/`) and AC16 (`redraft-ac16/`) also run in place of their first drafts,
`assertions.test.ts` and `budgets.test.ts`, which are kept as written and run by hand only; neither first draft was edited.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world (record, asks, supervisor, evidence store), the
  app as a checkout per build, trees and tree digests, journey files as data, the fake model, `assertionFails`, a
  PNG reader and the planted 4×4 block.
- `wrong.ts`: AC13's three planted runners, built from the fill.
- The test files: `review.test.ts` (AC1, AC17), `evidence.test.ts` (AC2, AC3, AC4, AC8), `receipt-first-draft.test.ts` (AC7's first draft, by hand), `features.test.ts`
  (AC5), `screens.test.ts` (AC6, AC9, AC11, AC23, AC24), `latency.test.ts` (AC10), `endings.test.ts` (AC12),
  `kind.test.ts` (AC13), `api.test.ts` (AC14), `errors.test.ts` (AC15), `budgets.test.ts` (AC16),
  `assertions.test.ts` (AC18), `stack.test.ts` (AC19), `reading.test.ts` (AC20), `steps.test.ts` (AC21, AC22),
  `motion.test.ts` (AC25).
- `fixtures/app/`: the sample app, its `.deepbuild/done.yaml`, features and journeys.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`; the fixtures left out.
- `BASE-FAILURE.txt`: the run on the base commit.
