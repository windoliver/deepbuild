# scripts-infra findings

Checkout read: `the checkout` (06fd33cd). Read-only. Nothing
was run but `git`, `grep`/`rg`, `ls`, `wc` and small `node -e` snippets that parse a JSON file or list paths. No test
runner, build or benchmark ran, so every "the lane fails" below is read from the code, not observed. Paths are relative
to the checkout.

Edits to `scripts/lanes.mjs` change what the checks run, so the proof guard asks for the owner's signed approval tag.
That applies to SCRIPTS-1, -2, -3, -4 and -16.

Counts: 19 findings. broken 8, inconsistent 8, unneeded 2, inefficient 1. SURE 5, LIKELY 7, QUESTION 7.

---

### SCRIPTS-1  The unit lane's one-at-a-time block runs 20 files that lanes.mjs says run by hand only
- kind: broken
- confidence: LIKELY (the mechanics are certain; the run was not observed)
- where: `scripts/lanes.mjs:281-282`, `scripts/lanes.mjs:130-138, 219, 226, 231, 233, 238`
- evidence: the parallel block excludes the by-hand files, the alone block does not:
  ```js
  [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...[...alone, ...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])],
  [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone],
  ```
  A vitest positional argument is a substring filter on the file path, so `tests/acceptance/37/` selects every test
  file under it. I matched each `byHand` entry against each `alone` entry (folder prefix or same file). Twenty by-hand
  files sit inside an alone folder: `1202/session.live`, `124/ac1-agents.live`, `124/ac5-budgets.live`,
  `140/gpu/capture.live`, `140/gpu/color.live`, `1427/ac8-budget.live`, `1434/ac6-idle.live`, `1434/ac7-budgets.live`,
  `1434/ac8-snapshots.live`, `1436/ac2-still.live`, `1436/ac9-budgets.live`, `1546/ac4-needs-you.live`,
  `33/next-pr.live`, `33/spine.live`, `366/ac1-build.live`, `37/assertions`, `37/budgets`, `37/receipt-first-draft`,
  `46/live`, `806/live` (all `tests/acceptance/…​.test.ts`). `scripts/affected.mjs:273` skips by-hand files before it
  sorts into blocks, so only the preflight lane has the gap. No test pins the alone command without excludes
  (`tests/preflight.test.mjs:181-199` reads only the positional names after `--no-file-parallelism`).
- failure: `npm run preflight`, unit lane, second command. `tests/acceptance/37/assertions.test.ts` runs, and
  lanes.mjs:120-122 says of it "its two line assertions search the journey file for a flow-style substring that the
  suite's own YAML rewrite never writes, so they expect line 0": it fails, so the lane fails. The live files run too;
  the ones that gate themselves skip, which reads BLOCKED or INCONCLUSIVE.
- fix: `scripts/lanes.mjs:282`
  old: `[process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone],`
  new: ``[process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...[...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`]), '--no-file-parallelism', ...alone],``
  The excludes go before `--no-file-parallelism` so `tests/preflight.test.mjs:194` still reads only the alone names.
- verify: `node -e "import('./scripts/lanes.mjs').then(({checks})=>{const c=checks.find(l=>l.name==='unit').commands[1];console.log(c.includes('tests/acceptance/37/assertions.test.ts'))})"` prints `false` before and `true` after (as an `--exclude` value).
- risk: none to the files that should run. `reporting()` (lanes.mjs:609) inserts its reporters right after `run`, and
  `throttleClass` (lanes.mjs:486) only looks for the flag, so both still work. Needs the lanes approval tag.

### SCRIPTS-2  The unit lane's node block has no by-hand filter: it runs two live panel tests and three vitest fixture files
- kind: broken
- confidence: LIKELY (not run)
- where: `scripts/lanes.mjs:284-286`, `scripts/lanes.mjs:12-16`; `tests/panel-host.live.test.mjs:1-3`,
  `tests/panel-keys.live.test.mjs:1-3, 12, 21-33`;
  `packages/conformance/fixtures/gate/cases/passes-on-retry/{base,fix,head}/test/cart.test.mjs`
- evidence:
  ```js
  [process.execPath, '--test', 'tests/*.test.mjs', ...testGlobs('mjs').filter((glob) => !glob.startsWith('tests/'))],
  ```
  `testGlobs('mjs')` leaves `packages/**/test/**/*.test.mjs`. (a) `tests/*.test.mjs` matches
  `tests/panel-host.live.test.mjs` and `tests/panel-keys.live.test.mjs`. Both headers say
  "Run: node --test --test-concurrency=1 tests/panel-….live.test.mjs". `panel-keys` spawns
  `target/release/deep-app panel-keys --host target/release/deep-panel-host` (docs/spikes/358/keys.json, `check.command`)
  and never builds it; the preflight builds debug only (lanes.mjs:326), and `keys.json`'s own build needs
  `--features deep-app/panel-check`. (b) `packages/**/test/**/*.test.mjs` matches the three `passes-on-retry` fixture
  files, which begin `import { expect, test } from 'vitest';`. Every other gate case uses `cart.test.js`, which the glob
  misses; these three came in 23538e99 (Nov 7, #33). Neither is in `scripts/known-failures.json`.
- failure: `npm run preflight` on a machine with no `target/release/deep-app`: `panel-keys.live` fails on spawn; the
  three fixture files call vitest's `test()` outside vitest and throw. The unit lane reads FAIL. I could not run node
  --test to see the exact message.
- fix: two small moves, neither in lanes.mjs. (1) `git mv tests/panel-host.live.test.mjs tests/panel-keys.live.test.mjs`
  into a folder the glob does not reach, e.g. `tests/live/`, and fix `panel-host`'s three `./acceptance/358/…` imports
  to `../acceptance/358/…` and both headers' Run lines. (2) Rename the three fixture files to `cart.test.js` as the
  other cases have (the package is `"type": "module"`, so `.js` is ESM; its `vitest.config.mjs` names no include).
  The second is in `packages/conformance`: that reader should confirm nothing names `cart.test.mjs` for this case
  (I found no reference in `packages/conformance/src` to the passes-on-retry file name).
- verify: `git ls-files 'tests/*.live.test.mjs' 'packages/**/test/**/*.test.mjs' | grep -v '^packages/.*/spec/'` lists five files before and none after.
- risk: `scripts/affected.mjs` still treats every `packages/**/test/**/*.test.js` fixture as a test of the repo
  (`isTestFile`, proof-change.mjs:23), so a change to a gate case's `src/` selects its fixture test; that is a
  follow-up, not part of this fix.

### SCRIPTS-3  185 node acceptance files in 46 issue folders are run by no preflight lane, release or local
- kind: inconsistent
- confidence: QUESTION (the fact is certain; which files should run is the owner's call)
- where: `scripts/lanes.mjs:284-286`, `scripts/lanes.mjs:50-55` (the `slow` comment), `scripts/lanes.mjs:140-151`
- evidence: the comment above the node command says "Node's acceptance suites under tests/acceptance/ run by hand, as
  their READMEs say: #48's live tests spend plan usage, and #246's check that change against its own base." That named
  two suites. `git ls-files 'tests/acceptance/**/*.test.mjs' | wc -l` is 185, in folders 1003 1015 1113 1114 1115 1116
  1117 1118 1119 1326 1329 1333 1334 1336 1352 1404 1406 1421 1426 1555 246 326 337 338 339 358 47 48 56 568 569 573 580
  583 594 605 606 607 689 724 79 80 821 879 882 910. No command in `checks` or `releaseLanes` names them; vitest's
  include is `.test.ts` only (`vitest.config.ts`, `testGlobs('ts')`). Only `scripts/affected.mjs` (when a change
  reaches one) and the proof `before` lane (the change's own issue) run them. The `slow` list's comment says "the
  release preflight runs them", and the list holds seven of these files (`1113/before`, `1114/lanes`, `1117/proofs`,
  `48/harness`, `910/ac1…ac3`); the `timed` list holds more (`1113/load`, `246/lanes`, `568/`, `583/…`, `724/`).
- failure: `npm run release:check` can print PASS for every lane with none of these 185 files run, among them the
  suites of the proof lanes themselves (#569, #1113-#1119) and of the known-failures gate (#1333).
- fix: owner's choice. Smallest honest one: correct the two comments (lanes.mjs:284-285 and :53-54) to say these
  run only through affected.mjs and the before lane. To run them at release: add a release lane
  `{ name: 'node acceptance', commands: [[process.execPath, '--test', '--test-concurrency=1', 'tests/acceptance/**/*.test.mjs']] }`
  less the live ones.
- verify: `node scripts/affected.mjs --list tests/acceptance/569/replay.test.mjs` lists it; no lane in
  `scripts/lanes.mjs` contains `acceptance/**/*.test.mjs` or any of the 46 folders as a node file.
- risk: running them will surface failures main already has (two are listed: #56 and #882).

### SCRIPTS-4  byHand misses two live files, so the preflight runs them and reads BLOCKED and INCONCLUSIVE
- kind: inconsistent
- confidence: LIKELY
- where: `scripts/lanes.mjs:130-138`; `scripts/affected.mjs:273`; `tests/acceptance/1023/live-ctrl-c.live.test.ts:12-16`;
  `tests/acceptance/1330/start.live.test.ts:11-17`
- evidence: `affected.mjs:273` treats any `tests/acceptance/**.live.test.*` as by hand. lanes.mjs lists by-hand files one
  by one, and I checked every tracked `*.live.test.ts` against the list: three are missing. `39/app.live.test.ts` is
  covered another way (four `skips` entries in known-failures.json). `1023/live-ctrl-c.live.test.ts` does
  `ctx.skip('BLOCKED: needs three live Ctrl-C ends…')` and `1330/start.live.test.ts` does `test.skipIf(!LIVE)(…)` with
  no note; neither is in `byHand`, `alone` or the `skips` list (`grep -n '1023\|1330' scripts/lanes.mjs
  scripts/known-failures.json` finds nothing).
- failure: the unit lane's parallel block runs both. `readSkips` (lanes.mjs:591-599) reads #1023's skip as BLOCKED and
  #1330's note-less skip as INCONCLUSIVE "skipped with no note", so the unit lane can never read PASS, while
  `affected.mjs` on the same tree prints `SKIP … (by hand)`.
- fix: `scripts/lanes.mjs:138`, append to `byHand`:
  old: `'tests/acceptance/994/app.test.ts', 'tests/acceptance/994/taste.test.ts'];`
  new: `'tests/acceptance/994/app.test.ts', 'tests/acceptance/994/taste.test.ts', 'tests/acceptance/1023/live-ctrl-c.live.test.ts', 'tests/acceptance/1330/start.live.test.ts'];`
- verify: the check I ran: every `git ls-files 'tests/**/*.live.test.ts'` path is covered by a `byHand` entry or is `39/app.live.test.ts`.
- risk: none; the files stay runnable by hand. Needs the lanes approval tag.

### SCRIPTS-5  affected.mjs never reads a test job's exit status, so a node --test run killed mid-way can read PASS
- kind: broken
- confidence: LIKELY
- where: `scripts/affected.mjs:449-472`
- evidence: for a `vitest*`/`node*` job the loop reads only the report file. A vitest report must end in
  `{"type":"end"}` (lanes.mjs:541, since `label` is passed). A node report has no such end row, and the only other
  guard is `files.filter((file) => !report.includes(file))`, which a `start` row satisfies. `job.status` is read for
  `build`, `lint*` and `cargo` only.
- failure: `node scripts/affected.mjs` selects three node files; `node --test` is killed (memory pressure, a SIGTERM
  passed on by throttle.mjs:286) after each file's first `start` row. No `fail` row, every file "reported", so
  `failures` is empty and the last line is `PASS affected: 0 new, …, 0 passed`.
- fix: after `scripts/affected.mjs:470`, inside `if (tests) {`:
  add ``if (job.status !== 0 && !results.failures.length && !results.noGrant) failures.push({ id: `${job.label} job`, state: 'INCONCLUSIVE', message: `the runner exited ${job.status ?? 'on a signal'} with no failed test, so a result may be missing` });``
- verify: a case in `tests/affected.test.mjs` beside its report cases; before the fix nothing in the file asserts on a
  job status.
- risk: a vitest job that exits non-zero for an unhandled error already carries a `vitest › unhandled error` failure,
  so it is not double counted.

### SCRIPTS-6  affected.mjs gives the two canvas-closures lint jobs one label, so both write and read one log file
- kind: broken
- confidence: SURE
- where: `scripts/affected.mjs:336-339, 418, 424`; `scripts/lanes.mjs:270`
- evidence: the lint lane holds `[node, 'scripts/canvas-closures.mjs', 'closures']` and `[…, 'drift']`. Line 424 labels a
  job `lint ${rest.find((arg) => arg.startsWith('scripts/')) ?? rest[0]}`, so both are `lint scripts/canvas-closures.mjs`.
  `run` (337-339) opens `join(logs, label.replace(/\W+/g, '-') + '.log')` with `'w'` for each, and both jobs start at
  once (both are LIGHT, line 336). Each child writes from offset 0 of its own descriptor; each job's `output` is then
  the same file.
- failure: `closures` prints two `FAIL closures: …` lines, `drift` prints `PASS drift: …`. The shorter write lands on
  top of the first FAIL line. `lintFindings` then sees one FAIL line cut in half and one whole, and reads the file once
  per job: the whole line is counted twice (so a finding main already has, baseline count 1, reads `NEW FAIL`), and the
  cut one is lost or shows as `exited 1: PASS drift: …`.
- fix: `scripts/affected.mjs:424`
  old: ``...lints.map(([command, ...rest]) => run(logs, `lint ${rest.find((arg) => arg.startsWith('scripts/')) ?? rest[0]}`, command, rest)),``
  new: ``...lints.map(([command, ...rest]) => run(logs, `lint ${rest.find((arg) => arg.startsWith('scripts/')) ?? rest[0]}${rest[0].startsWith('scripts/') && rest[1] && !rest[1].startsWith('-') ? ` ${rest[1]}` : ''}`, command, rest)),``
  and `scripts/affected.mjs:336`: old `…|guide)\.mjs$/` → new `…|guide)\.mjs(?: \w+)?$/` so both stay grant-free.
- verify: `node scripts/affected.mjs scripts/canvas-closures.mjs` then `ls <logs>/lint-scripts-canvas-closures-*`:
  one file before, two after.
- risk: none found. I grepped `tests/*.mjs` and `tests/acceptance` (twins aside) for `lint scripts` and `LIGHT`: nothing
  pins the label. `vendor-rebase.mjs check` becomes `lint scripts/vendor-rebase.mjs check`, which is not LIGHT either way.

### SCRIPTS-7  The interface lane's crate list is from Oct 30 and misses eight canvas crates
- kind: inconsistent
- confidence: LIKELY
- where: `scripts/api-surface.mjs:24-25`; compare `scripts/wasm32.mjs:73-75`
- evidence: `const CRATES = ['deep-canvas', 'deep-canvas-effects', 'deep-canvas-graph', 'deep-canvas-marks',
  'deep-canvas-motion', 'deep-canvas-record', 'deep-canvas-scene3d', 'deep-canvas-sheet', 'deep-canvas-test-modules',
  'deep-hook']`, "the canvas module crates and deep-hook's library". `ls crates` also has `deep-canvas-cells`,
  `-drawn`, `-input`, `-loop`, `-media`, `-sandbox`, `-seams`, `-vector`, each with a `src/lib.rs`, added Oct 30 to
  Nov 8; their Cargo.toml headers call six of them canvas modules (cells, input, loop, media, sandbox, vector).
  `git log -- scripts/api-surface.mjs` has one commit (c66b1d7f, Oct 30). wasm32.mjs takes the same family from
  `cargo metadata`, so it has not drifted.
- failure: a removed public function in `crates/deep-canvas-vector` passes `interfaces` with
  `PASS api: … no public change in deep-canvas, …`.
- fix: add the six module crates to `CRATES` (`'deep-canvas-cells', 'deep-canvas-input', 'deep-canvas-loop',
  'deep-canvas-media', 'deep-canvas-sandbox', 'deep-canvas-vector'`), or take the list as wasm32.mjs does. Whether
  `-drawn` and `-seams` are interfaces is the owner's call.
- verify: `tests/acceptance/139/apisurface.test.ts` (plant a removed `pub fn` in one of the six).
- risk: each added crate costs a rustdoc build per side in the lane.

### SCRIPTS-8  The interface lane compares the working tree with HEAD, so a committed interface change never shows
- kind: broken
- confidence: QUESTION (`tests/acceptance/139/apisurface.test.ts:6-7, 31` pins "the commit at HEAD" with uncommitted plants)
- where: `scripts/api-surface.mjs:121-129`; `scripts/lanes.mjs:291-293`
- evidence: `git worktree add --detach baseline HEAD` is the baseline and `cwd: root` is the candidate. The comment
  says "so an interface change shows in the pull request that made it".
- failure: a branch whose commits remove a public item, with a clean tree: baseline equals candidate, the Rust half
  prints PASS. The release preflight runs on a clean checkout, so its Rust half can never fail.
- fix: none proposed; the baseline would be the merge base with origin/main, which the blind suite does not cover.
- verify / risk: an owner decision; the TypeScript half compares with a committed report and is not affected.

### SCRIPTS-9  The verdict replay lane's case folders do not exist, so it is BLOCKED for every change to the verdict engine
- kind: broken
- confidence: QUESTION
- where: `scripts/proof-suites.mjs:103-106`; `scripts/proof.mjs:61-65`
- evidence: `seeded = /^tests\/fixtures\/(?:false-done|cheat)\/[^/]+\.json$/`. `git ls-files tests/fixtures` is
  `approver.d.mts`, `approver.mjs`, `slow-lock.cjs`; `git log --diff-filter=D -- tests/fixtures/false-done
  tests/fixtures/cheat` is empty, so they never existed here. The only users of those paths are the blind suites'
  scratch repositories (`tests/acceptance/569`, `1118`). docs/technical-design.md:2597 says a verdict engine change
  replays "the seeded false done cases, the cheat corpus".
- failure: any change under `packages/verdicts/src/` (73b91419 was one): `node scripts/proof.mjs` prints
  `BLOCKED replay: no seeded false "done" case (tests/fixtures/false-done/*.json) or cheat-corpus case …`, so the
  proof lane and the preflight cannot pass. It is correctly not PASS; it also cannot be satisfied.
- fix: seed the cases (the gate corpus under `packages/conformance/fixtures/gate/cases` may be the source), or point
  `seeded` at where they live. Not a hand edit.

### SCRIPTS-10  The seams lane prints PASS with 8 of its 13 suites hard-coded BLOCKED
- kind: inconsistent
- confidence: QUESTION (tests/acceptance/140 may pin the exit code)
- where: `scripts/seams.mjs:48, 61-69, 76-79`; `scripts/lanes.mjs:297-298`
- evidence: `process.exit(failed.length || Object.keys(conformance).length < 13 ? 1 : 0)` where `failed` is the FAIL
  suites only. `cpu`, `surface`, `color`, `display`, `accessibility`, `capture`, `codecs` and `audio` are always
  `blocked(…)`. runLanes reads exit 0 as `PASS seams`.
- failure: on every machine the lane says PASS while its own lines say `BLOCKED cpu: …` eight times; AGENTS.md
  invariant 2 says an unrun check is never PASS. The lines are printed above the PASS, so nothing is hidden.
- fix: owner's call: exit 1 with a first line `BLOCKED seams: 8 suites need …` (runLanes then reads BLOCKED), or keep.

### SCRIPTS-11  Three checks pass when they read nothing
- kind: broken
- confidence: LIKELY
- where: `scripts/canvas-closures.mjs:59-75`; `scripts/gpu-validation.mjs:21-32`; `scripts/color-literal-guard.mjs:72`
- evidence: `closures()`: `const files = existsSync(dir) ? readdirSync(dir)… : []` then
  `PASS closures: 0 lists in 0 canvas schemas each carry a closure`, exit 0 (its sibling `drift()` answers
  `BLOCKED … is missing`, exit 3). gpu-validation: `process.exit(bad.length ? 1 : 0)` with no check that
  `reply.fixtures.length > 0` ("0 of 0 fixtures clean"). color-literal-guard: `files = (dir, ext) =>
  (existsSync(dir) ? readdirSync(dir) : [])`. No test contains `0 lists in 0` or `0 of 0 fixtures`.
- failure: `packages/contracts/canvas-schemas` is renamed (or `--root` is mistyped): the closure lint passes with no
  schema read.
- fix: `scripts/canvas-closures.mjs`, after line 62:
  add ``if (!files.length) { console.log(`BLOCKED closures: no schema under ${dir}`); return 3; }``
  `scripts/gpu-validation.mjs:21`: old `if (!reply?.fixtures) {` → new `if (!reply?.fixtures?.length) {`.
- verify: `node scripts/canvas-closures.mjs closures --root /tmp/empty` exits 0 before, 3 after.
- risk: `tests/acceptance/200` drives `--root` trees; one with no schema folder would now read BLOCKED. I did not read
  that suite.

### SCRIPTS-12  Two known-failures lint entries name a file removed in #140
- kind: unneeded
- confidence: SURE
- where: `scripts/known-failures.json:22-23` (the `lint` map)
- evidence: `"canvas-lint: crates/deep-text/src/worker.rs a static item, state a check could carry between runs": 1`
  and `"canvas-lint: crates/deep-text/src/worker.rs the thread module, ambient input a check never reads": 2`.
  `ls crates/deep-text/src` is atlas, cache, fonts, lib, main, outlines, shape, unicode; the last commit on
  `worker.rs` is 52fb4ec5 (#140). Every other path in `failures`, `lint`, `timing` and `skips` exists, and the three
  cargo targets named are in `crates/deep-replica/Cargo.toml`.
- failure: nothing reads them today; a new `worker.rs` with the same findings would be waved through as known.
- fix: delete the two lines.
- verify: `grep -c 'deep-text/src/worker.rs' scripts/known-failures.json` is 2 before, 0 after.
- risk: none; `classify` (affected.mjs:325) only compares counts for keys a run finds.

### SCRIPTS-13  tests/preflight.test.mjs reads tests/acceptance/plans.ts as a folder (already #1624, lapses Nov 14)
- kind: broken
- confidence: LIKELY (known failure on main; not re-reported as new)
- where: `tests/preflight.test.mjs:186-188`; `scripts/known-failures.json:12`
- evidence: `readdirSync('tests/acceptance/').flatMap((issue) => readdirSync(`tests/acceptance/${issue}/`)…)`.
  `tests/acceptance/plans.ts` is a file (imported by 103, 34 and 66's helpers), so the inner read throws ENOTDIR.
  All ten `failures` entries are dated 2026-10-31; `known-failures-check.mjs` fails each on Nov 14.
- fix: `tests/preflight.test.mjs:186`
  old: `const gated = readdirSync(new URL('tests/acceptance/', root))`
  new: `const gated = readdirSync(new URL('tests/acceptance/', root), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)`
- verify: the test itself. I could not run it, and once it reads the folders it may find gated files outside the
  alone list, so it may still fail for a real reason.

### SCRIPTS-14  proof.mjs lists the whole repository once per touched path
- kind: inefficient
- confidence: SURE
- where: `scripts/proof.mjs:53`; `scripts/proof-change.mjs:35-36`
- evidence: `touched.filter((path) => listFiles(root).includes(path))`. `listFiles` runs `git ls-files` and an `lstat`
  per file; the repo has 10,237 tracked files. Call path: preflight → `proof` lane → `node scripts/proof.mjs`, any
  change, lifecycle lane.
- failure: a 60-file change spawns git 60 times and makes about 600,000 lstat calls to answer a set lookup.
- fix: old `const tables = (release ? listFiles(root) : touched.filter((path) => listFiles(root).includes(path))).filter((path) => TABLES.test(path));`
  new `const listed = listFiles(root); const tables = (release ? listed : touched.filter((path) => listed.includes(path))).filter((path) => TABLES.test(path));`
- verify: `tests/acceptance/569` lifecycle cases; same output.
- risk: none; same list, read once.

### SCRIPTS-15  README's account of the preflight is from issue #12
- kind: inconsistent
- confidence: SURE (README.md is not in my file list; the lead decides who edits it)
- where: `README.md:53, 68-71`; `scripts/lanes.mjs:268-347`; `benchmarks/budgets.json` (`preflight.limits.elapsedMs`); `package.json:16`
- evidence: "Its lanes are `typecheck`, `lint`, `unit`, `parity quick` and `perf`" against 20 lanes in `checks`, plus
  perf and harness budgets. "must finish in under five minutes" against `elapsedMs: 900000`, raised on 2026-10-22 by
  the budget's own `changeReason`. "`npm run build` compiles the TypeScript workspaces and the `crates/deep-hook`
  binary" against `"build": "npm run build --workspaces && cargo build --workspace --locked"`.
- fix: say the lanes are listed in `scripts/lanes.mjs`, "under 15 minutes", and "the Cargo workspace".

### SCRIPTS-16  motion.mjs's blocked line is not in the form runLanes reads, and the lane's Fix text ends ",."
- kind: inconsistent
- confidence: SURE
- where: `scripts/motion.mjs:31`; `scripts/lanes.mjs:323, 756-757`
- evidence: ``console.log(`motion: BLOCKED: ${error.message}; pacing not measured`)``. runLanes takes a state only from
  `/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\s+(.+)/`, so a deep-drive that did not start reads `FAIL motion`. Every other
  script prints `BLOCKED <lane>: …`. lanes.mjs:323: `'Make the motion each finding above names settle, fade or fly as declared,.'`
- fix: motion.mjs:31 → ``console.log(`BLOCKED motion: ${error.message}; pacing not measured`)``; lanes.mjs:323 `declared,.` → `declared.`
- risk: `tests/acceptance/1427` may match the old line; I did not read it. Mark QUESTION if it does.

### SCRIPTS-17  Two one-off Proof scripts nothing names
- kind: unneeded
- confidence: QUESTION
- where: `scripts/plans-proof.mjs` (134 lines), `scripts/frame-fs-calls.mjs` (48) with `scripts/frame-fs-calls/counter.c` (88)
- evidence: `rg --fixed-strings` for `plans-proof`, `frame-fs-calls` and `counter.c` over the whole checkout
  (node_modules, target, reports, vendor aside) finds only the files themselves. `plans-proof.mjs` wrote
  `docs/evidence/69/transcript.txt` (#69, closed); `frame-fs-calls.mjs` is #1457's count, and
  `tests/acceptance/1457` does not use it. Two more look alike and are in use through their output:
  `scripts/checkpoint-1162-shots.mjs` writes `$TMPDIR/deep-1162-proof/ac7/`, which
  `tests/acceptance/1162/shown.test.ts` reads, and `scripts/agents-page-shots/shots.test.ts` writes
  `docs/evidence/148/`, which `tests/acceptance/148/taste.test.ts` reads. Keep those two.
- fix: delete the three files, or keep them as the way to remake the evidence. Owner's call.

### SCRIPTS-18  The 2,823 TypeScript files under tests/ are never type-checked
- kind: inconsistent
- confidence: QUESTION
- where: `tsconfig.json:19-22`; `scripts/lanes.mjs:269`; `.deepbuild/done.yaml:9`
- evidence: `"include": ["packages/**/*.ts", "vitest.config.ts"]`; the typecheck lane and the bootstrap spec both run
  `tsc --noEmit` on that config. `git ls-files 'tests/**/*.ts' | wc -l` is 2823. vitest strips types without checking.
  `tests/proof/344` and `tests/proof/883` carry a tsconfig of their own; no lane runs tsc on either.
- failure: a helper under `tests/acceptance` called with the wrong argument type runs until it throws, or passes.
- fix: none proposed; blind suites may not type-check as written.

### SCRIPTS-19  affected.mjs treats fixture projects under packages/**/test/** as the repo's own tests
- kind: inconsistent
- confidence: QUESTION
- where: `scripts/lanes.mjs:12`; `scripts/proof-change.mjs:13-23`; `scripts/affected.mjs:226, 245-248`
- evidence: `testPaths` holds `packages/**/test/**`, and `isTestFile` is `underTestPaths(path) && /\.test\.(mjs|js|ts)$/`.
  `packages/conformance/fixtures/gate/cases/<case>/<side>/test/cart.test.js` (about 40 files) matches. Several cases
  are wrong programs on purpose (`answered-fail`, `edited-assertion`).
- failure: a change to `packages/conformance/fixtures/gate/cases/answered-fail/base/src/…` selects that case's
  `cart.test.js`; run with the repo's vitest config it is outside `include` and reads `reported no test` (FAIL), or
  under node it fails as the fixture means it to, and prints `NEW FAIL`.
- fix: none proposed here; a `fixtures/` exclusion in `isTestFile` would also change what the proof guard counts as
  test code.

---

## Nits

- `scripts/proof.mjs:68`: every `Blocked` gets the Fix "Fetch main so the merge base exists", also the one thrown by
  `autoMerge` (proof-change.mjs:147, "git merge-tree cannot remerge").
- `scripts/wasm32.mjs:68`: a missing `wasm32-unknown-unknown` target prints `FAIL toolchain`, where the lane's Fix
  text and every other script use BLOCKED for a missing tool.
- `scripts/lanes.mjs:316` reads `process.env.CARGO_TARGET_DIR ?? 'target'` for `deep-plain-words`, while
  `motion.mjs:12`, `parity.mjs:20`, `seams.mjs:14`, `relay-kit.mjs:22`, `canvas-kit.mjs:23` and
  `gpu-validation.mjs:16` use `target/debug` fixed. `preflight.mjs:12` deletes the variable, so only a bare
  `node scripts/checks.mjs` with it set sees the difference.
- The same `files(dir)` walker and `--root` parsing are written out in `record-reader-guard.mjs:15-25`,
  `blocking-call-guard.mjs:17-27`, `plant-lint.mjs:14-24` and `render-lint.mjs:16-26`; `code()` is the same in
  `plant-lint.mjs:27` and `render-lint.mjs:29`. They have not drifted.
- The glob-to-regex for `testPaths` is written twice: `scripts/perf.mjs:262` and `scripts/proof-change.mjs:13`.
  Same text today.
- `.deepbuild/done.yaml:1-3` still says "until week 5's drafted spec replaces this file".
- `scripts/planned-names.txt` holds only its header comment. That is valid (no planned name).
- `scripts/studied-names.json` is salted hashes; its entries can't be checked for staleness by reading.
- `contracts/releases/`, `contracts/breaks/` and `contracts/corpus-decisions.json` do not exist yet. contract-diff.mjs
  handles each as "no earlier release", so the `contracts` lane and the `ecosystem corpus` release lane pass on
  nothing to compare until the first release is recorded.

## Checked and found consistent

- Every path named in `scripts/lanes.mjs` (`alone`, `slow`, `byHand`, `timed`, `exclusive`, `ownLane`, the release
  lanes; 521 literals plus the templated ones) exists.
- `benchmarks/budgets.json`: 110 tasks, no duplicate id, every command's file exists and every subcommand is in its
  file. Three benchmarks have no task: `hub-churn.mjs` and `hub-sessions.mjs` are release lanes, `hub-soak.mjs` is
  run by `tests/acceptance/41/soak`.
- `scripts/repo-rules.json`: all 69 `deps` manifests and 9 `allowedFindings` paths exist; the script fails stale
  entries itself.
- `scripts/known-failures.json`: no entry has lapsed (all dated 2026-10-31; they lapse Nov 14).
- `.gitignore`: every path pattern points at a folder that exists; `.lean/` and `.lake/` are made on demand.
- Every `tests/acceptance/<issue>/` folder holds a test file; every `.rs` under it is a Cargo target or a module of one.
- Root devDependencies are all used (`jest` and `gpt-tokenizer` through acceptance and `benchmarks/canvas.mjs`,
  `@stryker-mutator/core` by `proof-runs.mjs:710`, `@microsoft/api-extractor` by `api-surface.mjs:60`).
- Relative imports in every `scripts/*.mjs` and `benchmarks/*.mjs` resolve (dist → src), and the named exports I
  checked exist.
- Shell scripts `scripts/preflight`, `scripts/lease`, `scripts/app-bundle`: `set -eu`, every path quoted.
- `.github/` has no workflow.

## Coverage

| | files |
|---|---|
| Read in full | `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.node-version`, `.github/*`, `.deepbuild/*`, `CONTRIBUTING.md`; `scripts/`: preflight, preflight.mjs, lease, app-bundle, checks.mjs, lanes.mjs, lanes.d.mts, affected.mjs, throttle.mjs, proof.mjs, proof-suites.mjs, proof-change.mjs, proof-reporter.mjs, proof-vitest-reporter.mjs, benchmark.mjs, perf.mjs, repo-rules.mjs, known-failures.json, known-failures-check.mjs, planned-names.txt, actions-server.mjs, parity.mjs, open-issues.mjs, catalogue-drift.mjs, slots-check.mjs, gpu-validation.mjs, motion.mjs, conformance-lint.mjs, record-reader-guard.mjs, canvas-kit.mjs, rust-source.mjs, blocking-call-guard.mjs, panel-catalog.mjs, seams.mjs, relay-kit.mjs, wasm32.mjs, canvas-closures.mjs, plant-lint.mjs, render-lint.mjs, design-links.mjs, public-text.mjs, text-lint.mjs, api-surface.mjs, checkpoint-1162-shots.mjs, frame-fs-calls.mjs, plans-proof.mjs, agents-page-shots/shots.test.ts; `lint/canvas/crates.json` |
| Read in part | `scripts/proof-runs.mjs` (lines 1-700 of 886), `scripts/verdict-proofs.mjs` (1-81), `scripts/contract-diff.mjs` (grep of its inputs and exits), `scripts/repo-rules.json` and `benchmarks/budgets.json` (parsed and cross-checked, not read line by line), `scripts/color-literal-guard.mjs`, `scripts/shards.mjs`, `scripts/agent-harness.mjs`, `benchmarks/hub-soak.mjs` (headers and the lines cited), `tests/preflight.test.mjs` (1-60, 150-200), `tests/panel-*.live.test.mjs`, `tests/vitest-setup.test.mjs` (heads), `README.md` 44-116 |
| Not read | `scripts/`: proof-guard.mjs, bays.mjs, main-watch.mjs, vendor-rebase.mjs, canvas-lint.mjs, corpus.mjs, corpus-pi.mjs, corpus-redact.mjs, corpus-elicit.mjs, agent-eval.mjs, agent-eval-run.mjs, agent-harness-hook.mjs, lifecycle.mjs, lifecycle-sim.mjs, config-eval.mjs, guide.mjs, skill.mjs, spine.mjs, budget-window.mjs, release-budgets/-pack/-rehearse/-stage/-verify.mjs, install-prefix.mjs, app-inventory.mjs, codex-hook-types.mjs, npm-launcher.mjs, drive-reading.mjs, conformance-lint-slot.mjs, count-children.c, frame-fs-calls/counter.c, studied-names.json. All 38 `benchmarks/*.mjs` bodies and `benchmarks/canvas/*.json` (only their commands and imports were cross-checked). `lint/canvas/clippy.toml`. The other 38 top-level `tests/*.test.*` files, `tests/proof/`, `tests/goldens/`, `tests/fixtures/`, `tests/vitest-setup.ts`, `tests/agent-name-branches.json`. Reason: I ran out of budget after the lane, affected, proof and perf paths, which the brief ranked first. |

`tests/acceptance/` was checked for structure only, as asked.
