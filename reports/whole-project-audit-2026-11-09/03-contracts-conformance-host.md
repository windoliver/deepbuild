# ts-platform: contracts, conformance, extension-host, adapters, cli, contracts/

Checkout `the checkout` at 06fd33cd. Read-only; nothing built or run but `rg`, `git log/show`, and two small read-only node scripts kept outside the checkout (`scratchpad/ts-platform-parts/`). Paths below are relative to the checkout root.

Status: finished. Nothing here was reproduced by running the repo: every finding is from reading, plus the snippets named in it. 30 findings: 18 `TSP-n` (mine) and 12 `HOST-n` (a sub-reader's, on `host.ts`; five re-checked by me, see that section).

Counts: broken 21, inconsistent 9, unneeded 0, inefficient 0. SURE 11 (TSP-1, 2, 4, 5, 6, 7, 8, 9, 13 and HOST-2, 8), LIKELY 15, QUESTION 4. Nothing unneeded made the bar: the candidates I checked each had a user in an acceptance suite (see the nits).

## Ranking, worst first (the bodies below are in ID order)

| # | ID | One line | Confidence |
|---|---|---|---|
| 1 | TSP-7 | slot check fails on main: the library slot row has no kit | SURE |
| 2 | TSP-1 | `doctor.item@1` frozen digest stale: #311, #312, #603 suites fail on main | SURE |
| 3 | TSP-2 | `service_unpromoted` has no verdict mapping: #313 suite and conformance lint fail | SURE |
| 4 | HOST-1 | a package reads another plug-in's store by listing its name in `replaces` | LIKELY |
| 5 | TSP-16 | an impossible cron line, once edited in, stops every tick: schedules, deliveries, rollups | LIKELY |
| 6 | TSP-18 | a failing work delivery retries every 250 ms with a synced claim, forever | LIKELY |
| 7 | TSP-8 | state-source@1 kit passes a fixture with no change: install reads PASS on nothing | SURE |
| 8 | HOST-2 | concurrent `deep.store.put` calls pass the quota together and miscount it | SURE |
| 9 | TSP-3 | series windows close with timeout 0 after a restart: a rollup is overwritten by one value | LIKELY |
| 10 | TSP-4 | library file of 384 to 512 MiB downloads whole, then reads "unreachable" and offline | SURE |
| 11 | TSP-17 | a re-registered schedule keeps the old cadence and later saves it as your edit | LIKELY |
| 12 | TSP-10 | `runProbe` has no stdin error listener: uncaught EPIPE in the hub | LIKELY |
| 13 | HOST-3 | failed `enterProject` stays counted, its packs never stop | LIKELY |
| 14 | TSP-11 | `servedAt` does not follow `$ref`: a later enum member is not read as `unknown` | LIKELY |
| 15 | TSP-9 | `gate run` on an empty corpus prints PASS, exit 0 | SURE |
| 16 | HOST-4 | a failing environment `down` aborts `unload` and `close()` | LIKELY |
| 17 | HOST-8 | `readStream` loses another stream's cursor | SURE |
| 18 | HOST-5 | canvas keys per package, not per run | LIKELY |
| 19 | TSP-15 | action@1 and channel@1 kits pass a fill that does nothing | QUESTION |
| 20 | HOST-6 | extension-api.json lacks `quota`, the index fill and `readings` | LIKELY |
| 21 | TSP-5 | `deep --help` omits `deep hub promote` | SURE |
| 22 | TSP-12 | reference check runner counts skipped tests; `tool; node -e 0` unmasked | LIKELY |
| 23 | HOST-7 | `deep.evidence.put`, `deep.asks.create` published and refused | LIKELY |
| 24 | HOST-9 | `ready()` can start a package twice | QUESTION |
| 25 | HOST-10 | `checkNow` leaks its snapshot folder on a throw | LIKELY |
| 26 | TSP-13 | conformance reads `adapters/` by path; the test's pattern misses it | SURE |
| 27 | TSP-6 | `source.called.bytes` counts base64 characters | SURE |
| 28 | TSP-14 | over-cap answer reads "unreachable" | QUESTION |
| 29 | HOST-11 | `trustKey` does not refuse a session | QUESTION |
| 30 | HOST-12 | extension-host README out of date | LIKELY |

Rows 1 to 3, TSP-4 and TSP-5 come from two commits that landed today (d0d685b8 #1334, 727aa5aa #1731) after the two earlier audits ran. Rows 1 to 3 mean five acceptance suites (#311, #312, #603, #313, #349) and two lint checks (`scripts/slots-check.mjs`, `scripts/conformance-lint.mjs`) fail on main at 06fd33cd, by reading; none is in `scripts/known-failures.json`.

## Findings: contracts, conformance, cli, adapters, and extension-host's compose, series and sources

### TSP-1  `doctor.item@1` changed shape without a new frozen digest: three acceptance suites fail on main
- kind: broken
- confidence: SURE (that it is broken); the refreeze follows the precedent of 9ca6169e, see risk
- where: `packages/contracts/digests.json:100` (the `doctor.item@1` line), `packages/contracts/schemas/doctor.item@1.json:37` (`"service_unpromoted"`)
- evidence: commit d0d685b8 (#1334, Nov 9) added the enum member `service_unpromoted` to `schemas/doctor.item@1.json` and touched `digests.json` only to add `build.rolled_back@1`. I recomputed every digest the way `src/digest.ts` does (`scratchpad/ts-platform-parts/digests.mjs`: normalize, RFC 8785 text, SHA-256): 258 of 259 schemas, all 14 slot interfaces and all 8 lifecycle tables equal their frozen value; `doctor.item@1` is frozen as `d1:72e758375c39be52dd55b3a298b7c75cfcbfcd64bdde98d766acb09f2746cc66` and now hashes to `d1:6deda921daddc78e4fb1de8a983da0581c9535087fa1679acd53125fe5feba97`. `npm run generate` cannot heal it: `src/generate.ts:24` is `frozen[name] ??= d1Digest(schema)` (adds, never refreezes).
- failure: `frozenDrift(listSchemas(), frozenDigests())` returns `['doctor.item@1']`, so these fail on main: `tests/acceptance/311/d1.test.ts:73`, `tests/acceptance/312/cursor.test.ts:66`, `tests/acceptance/603/ac4-digest-redraft.test.ts:39` (each `expect(frozenDrift(...)).toEqual([])`). None is in `scripts/known-failures.json`.
- fix: in `packages/contracts/digests.json`, `"doctor.item@1": "d1:72e758375c39be52dd55b3a298b7c75cfcbfcd64bdde98d766acb09f2746cc66"` → `"doctor.item@1": "d1:6deda921daddc78e4fb1de8a983da0581c9535087fa1679acd53125fe5feba97"`.
- verify: `node scratchpad/ts-platform-parts/digests.mjs <checkout>` prints no `SCHEMA DRIFT` line; or `tests/acceptance/311/d1.test.ts`.
- risk: README says a changed published shape "takes a new minor or a new name, never an edit in place". Two commits already refroze in place because no release is cut (9ca6169e "#13: refreeze 11 contract digests that drifted on main, since no release is cut yet (as #139 refroze doctor.item@1)"), and `contracts/releases/` does not exist, so nothing else pins the old digest (`rg 72e758375c` finds only digests.json). If the owner wants the strict rule instead, the fix is `doctor.item@1.1`, which is a much larger change.

### TSP-2  The doctor code `service_unpromoted` has no verdict mapping and no fix text: `judge` calls a published code "not listed", #313's suite and the conformance lint fail
- kind: broken
- confidence: SURE (broken); LIKELY for the verdict value `FAIL`
- where: `packages/conformance/src/families.ts:31-35` (`MAPPING.doctor`), `packages/conformance/src/planted.ts:39-65` (`DOCTOR_FIXES`), `packages/hub/src/doctor.ts:220,223` (the hub emits the code), `packages/contracts/schemas/doctor.item@1.json:37`
- evidence: same commit as TSP-1 (d0d685b8) added the code to the schema and the hub; `rg service_unpromoted` over the checkout finds it in the schema, generated types, `hub/src/doctor.ts` and #1334's twins, and nowhere in `packages/conformance`. `families.ts:61` lists any enum value without a mapping as unmapped; `families.ts:82-83` makes `judge('doctor', 'service_unpromoted')` return `listed: false, verdict: 'INVALID'` with the text "is not listed by doctor.item@1", which is false. This is the same omission PR #1775 fixed for `job_failing` and `notifications_off` (`src/doctor-codes.test.ts`); the prior reports do not name this code (it landed after them).
- failure: `tests/acceptance/313/codes.test.ts:58` `expect(unmappedCodes()).toEqual([])` fails; `scripts/conformance-lint.mjs:19` prints `doctor service_unpromoted maps to no verdict`; `planted()` (`planted.ts:117`) writes the entry with the fallback fix `See deep doctor.`.
- fix: `families.ts:34`: `job_failing: 'FAIL', notifications_off: 'FAIL', unknown: 'INCONCLUSIVE',` → `job_failing: 'FAIL', notifications_off: 'FAIL', service_unpromoted: 'FAIL', unknown: 'INCONCLUSIVE',`. `planted.ts:63` after the `hook_program_missing` line add `service_unpromoted: 'Promote a build main watch passed with deep hub promote <build folder>, so the login service runs the promoted build.',` (the hub's own fix text, `hub/src/doctor.ts:220`).
- verify: `tests/acceptance/313/codes.test.ts`; add `'service_unpromoted'` to the list in `packages/conformance/src/doctor-codes.test.ts:5`.
- risk: none pins the INVALID reading. The hub emits the code at level `fail` (`doctor.ts:220`) and `warn` (`:223`); every other problem code maps to FAIL or BLOCKED, so FAIL is the consistent choice, but it is the owner's table.

### TSP-3  After a hub restart a series source's windows close with timeout 0, so a call that straddles a minute or hour end overwrites that window's rollup with one value
- kind: broken
- confidence: LIKELY (read from the code; depends on the package not being live when `reopen` runs, which is the normal order; not reproduced)
- where: `packages/extension-host/src/series.ts:83` (`Rollups` keeps the timeout it was built with), `:236-238` (`windowsOf` returns the existing `Rollups`), `:261` (`reopen` builds it with `this.o.timeoutOf?.(d.source) ?? 0`), `:214` (`land` passes the real timeout, too late), `packages/extension-host/src/host.ts:943` (`timeoutOf` answers only for a live package), `host.ts:3873` (the 250 ms timer starts before the packages load), `packages/record/src/projections.ts:50,480` (`rollups` is keyed by source, span, start and upserted)
- evidence: `ready()` starts the timer, then loads packages in `this.starting`. The first tick calls `series.tick()` → `reopen()`, which re-adds every batch of the last day to its still-open windows through `windowsOf(d.source, timeoutOf(d.source) ?? 0)`. `timeoutOf` maps over `this.exts` and reads `e.live ? e.sources.get(name) : undefined`, so for a package not yet loaded it is `undefined` and the source gets `new Rollups(0)`. `land` later calls `this.windowsOf(source.name, source.timeout)`, which finds that object and never changes its timeout. `close()` (`:110`) then closes each window at its end + 0.
- failure: source `ext.shop.metrics`, timeout 5 s, called every 10 s; hub restarts at 10:30. A call starts at 10:30:59.9 (`as_of` is the start, `sources.ts:302,379`) and lands at 10:31:00.4. The tick at 10:31:00.25 has already closed minute 10:30 and written its rollup. The landed value opens a second 10:30 window, the next tick closes it, and the second `reading.rollup` for (source, minute, 10:30) replaces the first in `rollups`: the minute now reads `count: 1` and min = max = mean = that value. The header comment (`series.ts:5`) says a window closes "once its end plus the source's timeout has passed" so that cannot happen. Same at each hour end.
- fix: `series.ts:83` `constructor(private readonly timeout: number) {}` → `constructor(public timeout: number) {}`; `series.ts:214` `this.windowsOf(source.name, source.timeout).add(asOf, values);` → `const windows = this.windowsOf(source.name, source.timeout);` / `// Windows reopened before the package was live took no timeout: a call that lands gives the source's own.` / `windows.timeout = source.timeout;` / `windows.add(asOf, values);`. And in `tick` (`:222`), before `windows.close(now)`: `const timeout = this.o.timeoutOf?.(source); if (timeout !== undefined) windows.timeout = timeout;` so a window whose first straddling call is still in flight also waits.
- verify: extend `packages/extension-host/test/series.test.ts`: open the store with `timeoutOf: () => undefined`, land two values in 10:00, open a second store (restart), tick once at 10:00:40 (reopen), land a value with `asOf` 10:00:59 while `now` is 10:01:02 after a tick at 10:01:01; expect one 10:00 rollup with count 3. Fails today with count 1.
- risk: none of `series.test.ts` or `tests/acceptance/262/rollups.test.ts` passes an undefined `timeoutOf` then lands; the existing restart test stubs `timeoutOf` to always answer. A source that is never loaded again still closes at timeout 0, as today.

### TSP-4  A library file between 384 MiB and 512 MiB is downloaded whole, then fails as "host unreachable", and the hub reads that as the library being offline
- kind: broken
- confidence: SURE (the numbers); the replacement cap is the owner's pick
- where: `packages/extension-host/src/sources.ts:78` (`const FILE = 512 * 1024 * 1024`), `:166-174` (`nodeHttp`), `:514-520` (`call` turns any throw into `unreachable`), `:485` (`NoAnswer`), `packages/extension-host/src/host.ts:1039-1043` (`libraryFile`), `packages/hub/src/libraries.ts:285-289` (`status === null` → `this.offline(...)`)
- evidence: `nodeHttp` ends with `Buffer.concat(chunks).toString('base64')`. Node's longest string is `buffer.constants.MAX_STRING_LENGTH` = 536,870,888 characters (checked on this Mac's Node 24.22.2), which is 402,653,166 bytes as base64 (384.0 MiB). The cap lets 512 MiB through, so for a file of 402,653,167 to 536,870,912 bytes `toString` throws `ERR_STRING_TOO_LONG` after the whole body is in memory. `call()`'s `catch` maps every throw to `{ error: signal.aborted ? 'timeout' : 'unreachable' }`, `workFetch` throws `NoAnswer`, `libraryFile` returns `{ status: null, why: '<host> gave no answer: <host> unreachable' }`, and `Libraries.run` takes `status === null` as offline.
- failure: a picked asset whose main file is 450 MiB: 450 MiB downloaded and held, one day-quota call spent, `source.called` recorded with outcome `unreachable`, and the fetch answered from the offline path as if there were no network. The cap added today in 727aa5aa (#1731); no test or doc names 512 MiB (`rg "512" tests/acceptance/1731 docs/technical-design.md` finds none for this).
- fix: `sources.ts:77-78`: `/** The largest file a library fetch downloads in one call (#1731). */ const FILE = 512 * 1024 * 1024;` → `/** The largest file a library fetch downloads in one call (#1731): under what one base64 string can hold (2^29 - 24 characters, 384 MiB of bytes). */ const FILE = 380 * 1024 * 1024;`. An over-cap answer still reads `unreachable` (TSP-9).
- verify: `node -e 'const c=require("buffer").constants;console.log(c.MAX_STRING_LENGTH*3/4 >= 380*1024*1024, c.MAX_STRING_LENGTH*3/4 >= 512*1024*1024)'` prints `true false`.
- risk: a file of 380 to 384 MiB that works today (if the hub survives the memory) would be refused. Nothing pins the number.

### TSP-5  `deep --help` and `deep hub --help` do not list `deep hub promote`, the command the doctor's fix text tells you to run
- kind: inconsistent
- confidence: SURE
- where: `packages/cli/src/main.ts:184-186` (the three `deep hub` usage lines), `packages/hub/src/hub-command.ts:1,10-15,20` (`promote` dispatched and in the hub's own USAGE), `packages/hub/src/doctor.ts:220,223` ("Promote a build main watch passed with `deep hub promote <build folder>`"), `packages/hub/README.md:10` (`deep hub run | start | status | stop | use`)
- evidence: `main.ts:177` says "Every command's usage as `deep --help` lists it". `deep hub promote` landed today (d0d685b8, #1334) in `hub-command.ts` only. `deep hub promote --help` hits the CLI's help path (`asksHelp`, `main.ts:230`) and prints the three hub lines without `promote`.
- failure: `deep doctor` says to run `deep hub promote <build folder>`; `deep --help`, `deep hub --help` and `deep hub promote --help` never show it.
- fix: after `main.ts:186` add `'deep hub promote <build folder>   a build main watch passed becomes the one the hub and hooks run, rolled back by itself if its hub fails its check',`; `packages/hub/README.md:10` `run | start | status | stop | use` → `run | start | status | stop | use | promote`.
- verify: `node packages/cli/dist/main.js hub --help` lists four lines; `tests/acceptance/1359/help-table.test.ts` then runs `deep hub promote --help` too (it must write nothing and open no socket, which holds: help returns before dispatch).
- risk: `tests/acceptance/1359/helpers.ts` `listedCommands` parses each usage line; a line with one alternative is the simple case. `packages/cli/test/cli.test.ts` pins no line count.

### TSP-6  `source.called` records a library file's size as its base64 length, a third too large
- kind: inconsistent
- confidence: SURE
- where: `packages/extension-host/src/sources.ts:516` (`bytes = Buffer.byteLength(got.body);`), `:174` (body is base64 when `encoding === 'base64'`), `packages/contracts/schemas/source.called@1.json` (`bytes`: "The answer's body, in bytes")
- evidence: for a library file `got.body` is the base64 text, so `Buffer.byteLength` counts 4 characters per 3 bytes: `node -e 'console.log(Buffer.byteLength(Buffer.alloc(1000).toString("base64")))'` prints 1336.
- failure: a 300 MiB asset is recorded as a 400 MiB call.
- fix: `bytes = Buffer.byteLength(got.body);` → `bytes = Buffer.byteLength(got.body, request.encoding === 'base64' ? 'base64' : 'utf8');`
- verify: `node -e 'console.log(Buffer.byteLength(Buffer.alloc(1000).toString("base64"),"base64"))'` prints 1000; `packages/extension-host/test/sources.test.ts:137` (cost of a text call) is unchanged.
- risk: none found; `rg "source\.called" tests/acceptance/1731` finds no test reading `bytes` of a file call.

### TSP-7  The preflight's slot check fails on main: the `deep.registerSource, library` row ships with no kit and no planted fill
- kind: broken
- confidence: SURE (read from the code and the data; the script itself was not run, `dist/` is not built in this checkout)
- where: `packages/contracts/hub-slots.json:68-77` (the row `"method": "deep.registerSource", "variant": "library", "interface": "asset.library@1"` at `:71`, `"kit": null` at `:74`, `"planted": []`), `packages/conformance/src/slot-check.ts:45` (`if (!row.kit) { problem(... declares no kit ...); continue; }`), `scripts/slots-check.mjs:25`, `tests/acceptance/349/slot-table.test.ts:20-24`
- evidence: the row arrived today in 727aa5aa (#1731); `tests/acceptance/1731/README.md:112-114` says "its kit and planted names are the implementer's", and the implementer left both empty. `rg asset.library@1 packages/conformance` finds nothing: no kit of that name exists in `slotKits()` or `kits()`. `slotProblems` reports a row without a kit and, at `:48`, one without a planted fill; #349's AC5 is exactly "a slot declared without a kit or a planted wrong fill fails the preflight naming the slot".
- failure: `node scripts/slots-check.mjs` prints `FAIL slots: deep.registerSource, library: deep.registerSource, library declares no kit; a slot needs the kit that holds its fills to the interface` and exits 1, so the lint lane (`scripts/lanes.mjs:270`) fails, and `tests/acceptance/349/slot-table.test.ts:22-23` (`expect(real.status).toBe(0)`, `/^PASS slots/m`) fails. Neither is in `scripts/known-failures.json`.
- fix: no small edit. The slot needs `packages/conformance/src/slots/asset-library.ts` (a kit named `asset.library@1` with a reference fill, rules and one planted fill per rule), listed in `src/slots/kits.ts`, and the row's `kit` and `planted` filled. Marking the row as kit-less in `slot-check.ts` would weaken a check and needs the owner.
- verify: `node scripts/slots-check.mjs` after a build; `tests/acceptance/349/slot-table.test.ts`.
- risk: a new kit is new code under #1731, not a cleanup.

### TSP-8  state-source@1's kit passes a source whose fixture offers no change: nothing is read, compared or undone, and the install reads PASS
- kind: broken
- confidence: SURE
- where: `packages/conformance/src/slots/state-source.ts:89-112` (the judge), `:76` (the one fixture, `every-change`), `packages/extension-host/src/host.ts:1520-1529` (the install runs this kit on the package's own fixture and refuses only a verdict other than PASS)
- evidence: `const changes = list('start', yield () => fill.fixture.start()) as StateChange[]; for (const [i, change] of changes.entries()) { ... }`. Every rule (`read-is-now`, `compare-names-the-change`, `undoable-means-undone`) is checked inside that loop. `list()` accepts `[]`. The kit's own planted fills all return two changes, so the kit check never sees this.
- failure: a package's state source with `fixture: { start: () => [], make() {}, run() {} }` and any `read`, `compare` and `undo` at all (ones that throw included, since they are never called): the judge yields one step and returns, the case is PASS, `runKit` returns PASS and `deep install` keeps `{ slot: 'state-source@1', verdict: 'PASS' }`. Invariant 2: nothing unrun passes.
- fix: `state-source.ts:91` after the `const changes = ...` line add `if (!changes.length) throw new Finding('FAIL', "the source's fixture offers no change to try, so the kit held nothing", ['required']);` and import `Finding` beside `fail` on line 7 (`import { fail, Finding } from '../slot-types.js';`).
- verify: a case beside `packages/conformance/src/slot-runner.test.ts`: `runKit(stateSourceKit(), { ...cleanFills(kit)[0], fixture: { start: () => [], make() {}, run() {} } })` reads FAIL; today it reads PASS.
- risk: the four shipped fills (`packages/workspaces/src/index.ts:171,192,205,218`) each return two changes; `rg "start: \(\) => \[\]|return \[\]" tests/acceptance/67 packages/workspaces` finds no fixture that offers none. `['required']` is a shape code, so the kit check's "planted fill names only shape refusals" rule is not touched.

### TSP-9  `deep-conformance gate run` on a corpus with no case prints `PASS gate@1: 0 cases` and exits 0
- kind: broken
- confidence: SURE
- where: `packages/conformance/src/gate.ts:214` (`judged.every((j) => j === 'PASS') ? 'PASS'`), `:81-85` (`readManifest` takes `cases: []`), `packages/conformance/src/bin.ts:23,28` (`--corpus <dir>`)
- evidence: `const verdict: Judgement = judged.includes('FAIL') ? 'FAIL' : judged.every((j) => j === 'PASS') ? 'PASS' : ...`. With no play, `judged` is `[]` and `[].every(...)` is `true`. The package's own exit table gets this right: `families.ts:91` `verdicts.length > 0 && verdicts.every(...)`.
- failure: `deep-conformance gate run --corpus <a folder whose manifest.json is {"kit":"gate@1","cases":[]}>` ends `PASS gate@1: 0 cases`, exit 0, having started no hub. `gate check` on the same corpus fails for its missing tags, but `run` does not call it.
- fix: `gate.ts:214` `judged.every((j) => j === 'PASS') ? 'PASS'` → `judged.length > 0 && judged.every((j) => j === 'PASS') ? 'PASS'` (an empty run then reads INCONCLUSIVE, exit 3).
- verify: `node -e 'console.log([].every((j) => j === "PASS"))'` prints `true`; after the fix, `gate run` on an empty manifest exits 3.
- risk: none; `tests/acceptance/33/rows.test.ts` plays named cases of the shipped corpus (52 cases).

### TSP-10  `runProbe` writes the probe's input with no error listener on stdin: a probe that dies before reading a large input takes the hub down with an uncaught EPIPE
- kind: broken
- confidence: LIKELY (the mechanism is shown below; it needs an input larger than the pipe's buffer and a probe that exits early)
- where: `packages/conformance/src/probe.ts:39` (`child.stdin.end(JSON.stringify({ ...input, checkout: ctx.checkout }));`), callers `packages/checks-numbers/src/run.ts:11`, `packages/checks-work/src/run.ts:15`
- evidence: every other place in the repo that writes to a child's stdin adds `child.stdin.on('error', () => undefined)` (`supervisor.ts:602`, `hub/src/doctor.ts:39`, `drive.ts:46`, `confirm.ts:33`, `mcp-servers.ts:131`, `extension-host/src/sources.ts:233`, `runtime/runner.mjs:21`, `conformance/runtime/gate/agent.mjs:41`); `runProbe` does not. Shown with a pure snippet: `spawn(process.execPath, ['-e', 'process.exit(1)'])` then `child.stdin.end('x'.repeat(2_000_000))` raises `uncaughtException: EPIPE write EPIPE` in the parent. The two runners this file replaced (6a6d6b4f `checks-numbers/src/run.ts:40`, `checks-work/src/run.ts:45`) had the same gap, so it is not new with PR #1909, only now in one place.
- failure: a numbers or work check whose spec serializes past the pipe buffer (64 KiB on macOS) and whose probe exits at once (a syntax error, a missing module, a kill): the hub process ends on the uncaught error instead of the check reading `failed` through `crashed(...)`.
- fix: `probe.ts:39` before the `child.stdin.end(...)` line add `child.stdin.on('error', () => undefined); // A probe that exits before it reads its input: its close says why.`
- verify: `tests/probe-report.test.ts` gains a case with a probe file `process.exit(1)` and an input of 2 MB; it rejects with an uncaught EPIPE today and resolves `failed` after.
- risk: none; the `close` handler already settles every run.

### TSP-11  A reading served to its user at an earlier minor is not narrowed below a `$ref`, a union or a map: `servedAt` reads only inline `properties`, `items` and `enum`
- kind: broken
- confidence: LIKELY (by reading; #103's suite has no `$ref` in a use's schema, so nothing shows it either way)
- where: `packages/extension-host/src/compose.ts:107-119` (`servedAt`), callers `packages/extension-host/src/host.ts:3058,3258`; sibling `packages/conformance/src/closures.ts:137-161` (`serveAt`, which resolves `$ref`, unions and maps)
- evidence: `servedAt(value, schema)` returns `value` unchanged unless `schema.properties`, `schema.items` or `schema.enum` is on the node itself. A use's schema is the manifest row's opaque JSON Schema (`extension.compose@1`: "the interface's JSON Schema at the use's minor"), and `d1Digest` inlines `$ref`s, so a schema written with `$defs` is a normal one. The host passes `use.schema` straight in; nothing inlines it first (`rg "servedAt\(" packages` finds the two call sites only).
- failure: user built against `{ type: 'object', properties: { status: { $ref: '#/$defs/status' } }, $defs: { status: { type: 'string', enum: ['ok', 'unknown'], 'x-closure': { closed: '…', reopens: '…', mark: 'extensible' } } } }`; the provider's later minor answers `{ status: 'paused', extra: 1 }`. `extra` is dropped (root properties), but `status` reaches the user as `'paused'`, not `'unknown'`: the node is `{ $ref }`, which has no `enum`. The same holds for a record under a `$ref` (its new fields pass through) and for every branch of a `oneOf`. The header comment (`compose.ts:104-106`) and the design's "What a minor may change" say it reads `unknown`.
- fix: follow a `$ref` against the use's own schema: `export function servedAt(value: unknown, schema: unknown, root: unknown = schema): unknown {` and, as the first lines, `for (let hops = 0; isObject(schema) && typeof schema.$ref === 'string' && hops < 32; hops++) schema = isObject(root) && isObject(root.$defs) ? root.$defs[schema.$ref.replace(/^#\/\$defs\//, '')] : undefined;`; pass `root` on in the two recursive calls (`servedAt(v, props[k], root)`, `servedAt(v, schema.items, root)`). Unions and maps stay unserved; say so in the comment or port `closures.ts`'s branch.
- verify: a case in `tests/acceptance/103/versions.test.ts`'s style with the schema above; or `packages/extension-host/test/host.test.ts` with `servedAt({ status: 'paused' }, schema)` expecting `{ status: 'unknown' }`.
- risk: low; a schema with no `$ref` takes the same path as today. `tests/acceptance/103` pins flat schemas only.

### TSP-12  The reference check runner counts a skipped test as run and passed, and reads `tool; node -e 0` as unmasked: it disagrees with its own reporter, its own rule text and the shipped command kind
- kind: inconsistent
- confidence: LIKELY
- where: `packages/conformance/src/slots/check-kind.ts:80` (`ReportLine` has no `skip` or `todo`), `:203` (`tests`), `:205` (`failures`), `:73-77` (`maskIn`'s last step); `packages/conformance/runtime/check-kind/reporter.mjs:25-27` (writes `skip` and `todo`); `packages/checks-command/src/report.ts:98,102` (reads them); `packages/gate/src/mask.ts:34-35` (any `;` or newline sequence is a mask)
- evidence: the reporter says "node:test reports a skipped test as passed, and a todo test that fails as failed though the run doesn't fail" and marks both; the shipped `command` kind drops them (`l.skip !== true`, `l.todo !== true`); the kit's reference counts `test:pass || test:fail` whatever they carry. For the mask: `check-kind.ts:65-68` says the tool's exit reaches the runner "only when the tool is the last command of a plain `&&` chain", but `:76` exempts any sequence whose last program is `node`. Evaluated on the copied function: `maskIn('node --test spec/*.test.mjs; node -e 0')` and the newline form both return `null`; gate's `maskIn` names `; node`.
- failure: a suite of two `test.skip(...)` reads `passed`, `testsRun: 2` from the reference fill (the command kind reads `ran_nothing`); `node --test …; node -e 0` whose first process exits 1 with no reported failure reads `passed`. No fixture of the kit has a skipped test or a `;` sequence ending in node (`rg "skip|todo" packages/conformance/fixtures/check-kind` finds none), so the kit holds no fill to either.
- fix: `check-kind.ts:80` add `skip?: boolean; todo?: boolean;` to `ReportLine`; `:203` → `const tests = lines.filter((l) => (l.type === 'test:fail' || (l.type === 'test:pass' && l.skip !== true)) && l.todo !== true && !l.suite && !fileEntry(l));`; `:205` add `&& l.todo !== true` to the failures filter. `:73` `command.split(/&&|;|\n/)` → `command.split(/;|\n/)` and `:76` `if (segments.length > 1 && program !== 'node' && !program.endsWith('/node')) return ...` → `if (segments.length > 1) return \`; ${program}\`;` (gate's rule).
- verify: `packages/conformance/src/slots/check-kind.test.ts` with a temp suite of two skipped tests expects `ran_nothing`; the 18 fixtures still pass (the only `;` fixture, `forced-exit`, is caught earlier by `exit 0`; `untraced-reader` is one `&&` chain).
- risk: `tests/acceptance/314/check-kind.test.ts` pins six fixtures' outcomes, none with a skip or a `;` sequence. It changes what the reference fill reports, so run the kit's own check (`scripts/conformance-lint.mjs`) after.

### TSP-13  `packages/conformance/src/gate-play.ts` reads `adapters/claude-code.facts.json` by path; the rule and its test say only adapters and the CLI may, and the test's pattern does not see this form
- kind: inconsistent
- confidence: SURE
- where: `packages/conformance/src/gate-play.ts:21,42` (`const FACTS = join(REPO, 'adapters/claude-code.facts.json');` … `JSON.parse(readFileSync(FACTS, 'utf8'))`), `tests/facts-entry.test.mjs:20` (`REACH`), `packages/adapters/README.md` Deviations ("`readFacts(name)` is the one way every other package reads them")
- evidence: `REACH = /['"\`](?:\.\.\/)+adapters\/|join\([^)]*['"]adapters['"]/` matches `'../../../adapters/…'` and `join(x, 'adapters', …)`, not `join(REPO, 'adapters/claude-code.facts.json')`. `rg "'adapters/" packages/*/src` (tests, adapters and cli left out) finds this one line. conformance already depends on `@deepbuild/adapters`.
- failure: #1686's rule is broken in one place and its test passes.
- fix: `gate-play.ts`: add `import { readFacts } from '@deepbuild/adapters';`, delete line 21, and line 42 → `const COVERED = readFacts<{ versions: string[] }>('claude-code.facts.json').versions.at(-1)!;`. In `tests/facts-entry.test.mjs:20` widen the pattern: `join\([^)]*['"]adapters['"]` → `join\([^)]*['"]adapters[/'"]` (a test edit: the owner's call).
- verify: `tests/facts-entry.test.mjs` with the widened pattern fails before the source edit and passes after.
- risk: `gate-play.ts` loads at `deep-conformance gate`, where the adapters entry is already in the graph through `kit.ts`.

### TSP-14  An answer over its size cap is recorded and shown as "host unreachable"; the cap's own message is never seen
- kind: inconsistent
- confidence: QUESTION (the closed outcome list is a contract)
- where: `packages/extension-host/src/sources.ts:169` (`throw Error(\`the answer from … is over ${cap} bytes\`)`), `:518-520` (every throw becomes `timeout` or `unreachable`), `:540` (`describe`), `packages/contracts/schemas/source.called@1.json` (`outcome`: answered, timeout, unreachable; exhaustive)
- evidence: `call()` catches without reading the error. A polled source whose answer is 1.1 MiB reads `failed: <host> unreachable`, is recorded `outcome: 'unreachable'`, and backs off as if the host were down.
- failure: a plug-in author sees "unreachable" for a host that answered 200 with too many bytes.
- fix: owner's call: either a fourth outcome (`too_large`) in a new minor of `source.called`, or keep the outcome and carry the cause text: in the `catch`, `answer = { error: signal.aborted ? 'timeout' : 'unreachable' }` stays, and `describe` gets the thrown message for the reader only.
- verify: `packages/extension-host/test/sources.test.ts` with an http stub that throws the over-cap error.
- risk: the recording's `error` union (`RecordedCall`) is read by replays (`tests/acceptance/364/replay.test.ts`).

### TSP-15  Two slot kits pass a fill that does nothing, by the way their rules are written
- kind: broken (a kit that passes with nothing held)
- confidence: QUESTION (each is how the kit was specified; the owner decides whether a rule is owed)
- where: `packages/conformance/src/slots/action.ts:87-90`; `packages/conformance/src/slots/channel.ts:102-122`
- evidence and failure:
  - action@1: `if (!schemas.validate(fill.name, call).ok) return;` then PASS. Every case's call is `{ count: <integer> }` (fixtures `:57-60`, seeded `:65`). A fill whose input schema is anything but the reference's (say `{ type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }`) refuses every call, so `run` is never called on any case and the rule `output-is-json` passes on an action that returns a function. Nothing runs this kit on a real action today (`rg "action@1" packages/extension-host packages/hub` finds no kit run), so it only self-checks.
  - channel@1: all three rules are conditional (`delivered` needs an ack; an answer may carry no proof; shapes). A fill whose `deliver` returns `{ outcome: 'stalled' }` without calling `ctx.fetch` and whose `receive` returns `{ answers: [], seen: [], conflict: null }` passes every case, though the kit's provider acknowledged nothing because it was never called. The host runs this kit at load (`host.ts:2075-2082`), so a channel that transports nothing reads PASS. The header says the provider "answers every request alike, whatever path and body the fill sends", so the kit could hold "deliver made a provider call that carried the item" without knowing the protocol.
- fix: action: draw the call from the fill's own schema when the case's call is refused (`draw(fill.input, seed, 1)[0].valid` from `../generator.js`), so `run` is reached on every fill. channel: a fourth rule, `deliver-reaches-provider` (`if (![...acks.values()].some((body) => body.includes(key))) throw fail(...)`), with its planted fill. Both add or change a kit rule: an approved proposal, not a cleanup.
- verify: `runKit(channelKit(), doNothingFill)` reads PASS today.
- risk: the email and text channel fills (`packages/channels/*`) must be checked against a new channel rule before it lands.

## extension-host: host.ts and runtime/ (read by a sub-reader; IDs HOST-n)

Read line by line by a sub-reader I briefed; its own file is `scratchpad/ts-platform-parts/host.md`. I re-read the quoted lines of HOST-1, HOST-2, HOST-3, HOST-4 and HOST-8 in `host.ts` and they are as quoted; HOST-5, 6, 7, 9, 10, 11 and 12 I did not re-check. Production reach: the hub opens the host with `release: []` and no `asks`, `canvas` or `firstParty` (`packages/hub/src/core.ts:1126`), so HOST-4 and HOST-5 cannot happen in the hub today; they are real in the host as tests and acceptance suites open it.

### HOST-1  A package can read another plug-in's store, and send its notices, by listing the name in `replaces`
- kind: broken
- confidence: LIKELY (read every step; not run)
- where: `packages/contracts/src/manifest.ts:180-184`; `packages/extension-host/src/host.ts:1333-1368` (`admit`), `:2726-2728` (`deep.store`), `:2769-2780` (`deep.store.get`/`list`), `:3095-3114` (`items`/`store`), `:3352` (`noticeAllowed`), `:3136-3150` (`foreign`/`reaches`)
- evidence:
  - The manifest contract lets a name outside the package's own prefix through when `replaces` lists it:
    `manifest.ts:183`: `(m[list] ?? []).forEach((name, i) => { if (!replaces.has(name) && !own(name, plugin, false)) issues.push(...)` for `NAME_LISTS = ['events', 'stores', 'checks', 'codes', 'notices', 'actions']`. Its header says the install decides whether the replaced piece exists and may be replaced (`manifest.ts:7-9`).
  - `admit` decides that only for the ring, the done gate and check kinds (`host.ts:1349-1362`). Nothing looks at `stores`, `events`, `notices` or `actions`.
  - `deep.store` asks only `(ext.manifest.stores ?? []).includes(kind)` (`:2728`). `deep.store.get`/`list` then read `this.items(kind)`, which is every event of that kind whoever wrote it (`:3103`), with no grant (`needs: null`, `deep.mjs:49-52`).
  - `reaches` says the rule this breaks: "Another plug-in's store and event kinds never: they come only through a declared use" (`host.ts:3141-3142`). `deep.record.query` and `deep.on` do hold it, through `foreign`; the store calls don't.
  - Greps: no fixture or test manifest lists an `ext.` name of another plug-in in `replaces` for these lists (`rg replaces` over `deepbuild.json`, `*.fixture`, `tests/acceptance`, `packages`; the only `ext.` entry is #103's `ext.stocks.prices@1`, a `provides` interface, which `wireCheck` types).
- failure: `evil/x` ships `"stores": ["ext.stocks.alert"], "replaces": ["ext.stocks.alert"]`, no access words. It installs and passes conformance. Loaded, it calls `deep.store('ext.stocks.alert', { generation: 99, schema: { type: 'object' } })` then `deep.store.list('ext.stocks.alert')` and gets every item `acme/stocks` wrote. Its puts are refused by the record (`packages/record/src/index.ts:464-465`, writer rule), so this is a read hole. With `"notices": ["ext.stocks.price"], "replaces": [...]` it passes `:3352` and sends a notice under a subscription you made for stocks (cites `[]`).
  A second case with the same root: two packages whose ids share the name part (`acme/stocks`, `evil/stocks`) share the whole `ext.stocks.` prefix; there the record's writer rule passes too, so the second one reads and writes the first one's store. Nothing at install refuses the second id.
- fix: in `admit`, after the `replaces`/ring block (`host.ts:1350`), add:
  ```ts
  // A name it adds is its own (extension.manifest@1). `replaces` lets a shipped piece's bare name through, and
  // another package's check kind, which the holder rule below decides: never another plug-in's store, event,
  // notice or action name.
  const mine = `ext.${id.slice(id.indexOf('/') + 1)}.`;
  for (const list of ['events', 'stores', 'notices', 'actions'] as const) {
    const stray = (m[list] ?? []).find((name) => name.startsWith('ext.') && !name.startsWith(mine));
    if (stray) throw Error(`${id} declares ${stray} among its ${list}, another plug-in's name, which no package takes by listing it in replaces`);
  }
  ```
  The shared name part is the owner's call (refuse a second id with an installed name part, or key the prefix by the whole id): QUESTION.
- verify: new test in `packages/extension-host/test/host.test.ts`: install a store owner, then a package with the manifest above; expect `install` to reject naming `ext.stocks.alert`. Fails before (installs), passes after.
- risk: a package meant to take over another's action or notice name by `replaces` would now be refused; I found none. No test pins the current behavior.

### HOST-2  Two `deep.store.put` calls under way together both pass the quota, and the store's byte count keeps only the last one
- kind: broken
- confidence: SURE (bug shown from the code; the edit leaves a lone put as it is)
- where: `packages/extension-host/src/host.ts:2757-2765`; comment `:2740` ("never grows past it"); criterion `tests/acceptance/365/budgets.test.ts:152` ("stays within its declared quota")
- evidence:
  ```ts
  const held = await this.store(kind as string);
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
  const total = held.bytes - (held.items.get(key)?.bytes ?? 0) + bytes;
  if (store.quota !== null && total > store.quota) throw Error(...);
  ...
  await this.options.record.append(connection, {...});
  held.items.set(key, { value: structuredClone(value), generation: store.generation, bytes });
  held.bytes = total;
  ```
  `total` is read before the `await` and written after it. A second call that reaches `:2759` while the first is in its append reads the same `held.bytes`. Nothing serializes a package's calls: `peer` serves each line as it arrives (`deep.mjs:307`), and in the hub `extensionSide` calls `dispatch` directly. `migrate` already uses the delta form (`:3132`). The 365 fixture puts one at a time (`tests/acceptance/365/fixtures/tally/index.ts.fixture:28`, `await` in a loop), so nothing pins this.
- failure: a store with `quota: { bytes: 4096 }`, empty. The package runs `await Promise.all(keys.map((k) => deep.store.put(KIND, k, big)))` with 100 keys of 3,000 bytes. Each call computes `total = 3000`, passes, appends. The store holds 300,000 bytes; `held.bytes` reads 3,000 until the hub restarts, so later puts pass too.
- fix: old `:2759-2765` → new
  ```ts
  const was = held.items.get(key)?.bytes ?? 0;
  const total = held.bytes - was + bytes;
  if (store.quota !== null && total > store.quota) throw Error(`${method}: ${String(kind)} would hold ${total} bytes with the item for ${key}, past its quota of ${store.quota}`);
  // Its growth counts from the check on: two puts under way can't both fit a quota that one fills.
  const reserved = Math.max(0, bytes - was);
  held.bytes += reserved;
  const now = this.options.now();
  const call = scope === undefined ? null : ext.callOf.get(scope) ?? null;
  try {
    await this.options.record.append(connection, { v: 1, id: ulid(now), kind: kind as string, ts: now, data: { key, generation: store.generation, value: value as JsonValue, call } });
  } catch (e) {
    held.bytes -= reserved;
    throw e;
  }
  // Against what the key holds now: another put of it may have landed while this one was appended.
  held.bytes += bytes - (held.items.get(key)?.bytes ?? 0) - reserved;
  held.items.set(key, { value: structuredClone(value), generation: store.generation, bytes });
  ```
- verify: add to `tests`-side or `packages/extension-host/test/host.test.ts`: a package action that puts 20 items at once into a store whose quota fits 2; expect at most 2 taken and the rest refused naming the quota. Fails before (20 taken). `tests/acceptance/365/budgets.test.ts` (sequential) must stay green.
- risk: two puts of one key at once near the quota: the second is refused where a sequential replace would fit. No test pins the race.

### HOST-3  `enterProject` that fails partway leaves the project counted as entered, so its loaded packs never stop
- kind: broken
- confidence: LIKELY
- where: `packages/extension-host/src/host.ts:1615-1628`, `:1630-1636`; hub `packages/hub/src/core.ts:7200-7207`
- evidence: `this.inside.set(real, (this.inside.get(real) ?? 0) + 1);` runs before the loop that installs, checks and loads each pack, and each of those throws (`:1624`, `:1626`, and `packsNamed` at `:791`). The hub records the session as inside only on success: `if ((await this.extensions!.enterProject(cwd)).trusted) this.entered.set(session, cwd);` inside a `catch` that only prints. `leftProject` returns early when `entered` has no row, so `leaveProject` is never called for that enter.
- failure: a trusted project's `packs.json` names `a` and `b`; `a` loads, `b` fails conformance. `enterProject` throws with `inside = 1` and `a` live. The session ends; the hub calls no `leaveProject`. `a` stays loaded and `projectViews()` (`:1637`, every key of `inside`) keeps showing its views with nobody in the project. Every later session there adds one more to the count that nothing takes back.
- fix: `host.ts:1616-1627`, wrap the loop:
  ```ts
  try {
    for (const pack of packsNamed(real)) { /* unchanged */ }
  } catch (e) {
    // A failed enter counts nobody in: what it loaded stops once nobody else is in the project.
    await this.leaveProject(real).catch(() => undefined);
    throw e;
  }
  ```
- verify: new case in `tests/acceptance/67`-style helper or `packages/extension-host/test`: a project with one good and one broken pack; after the rejected `enterProject`, `projectViews()` is `[]` and `loaded()` holds neither. Fails before.
- risk: none found. `tests/acceptance/67/packs.test.ts` has no failing-pack case (`rg "rejects|toThrow"` there: none).

### HOST-4  An environment whose `down` fails makes `unload` throw before its leases end and its folder goes, and makes `close()` stop at that package
- kind: broken
- confidence: LIKELY (hub-bound packages only; not reachable in the hub today, which passes `release: []`)
- where: `packages/extension-host/src/host.ts:2364-2366` (`unload`), `:2388-2395` (`stopHandlers`), `:3664-3665` (`down` kept once it rejects), `:4000` (`close`), `:2150`, `:3684`
- evidence: `stopHandlers` ends with `if (failed.length) throw new AggregateError(failed, ...)` (`:2394`, added today in d13d25e0). `unload` runs it bare, then `await this.releaseLeases(ext).catch(() => undefined); rmSync(ext.folder, ...)`. `close` runs `for (const ext of [...this.exts.values()]) await this.unload(ext);` then stops terminals and calls `this.terminals.close()`. `down` is `stopped ??= within(CALL_MS, ...)`, so a rejected stop is kept and answers every later call. No test expects the throw (`rg "did not all stop|AggregateError"`: only `host.ts:2394`).
- failure: a release package has an environment up; its `down` throws or takes over 10 s. `host.close()` rejects at that package: packages after it in `exts` are never unloaded, hosted terminals are not stopped, `terminals.close()` is not called, and a second `close()` returns at once (`this.closed`). For `disable`/a new install: the package's `deep.lease` leases stay held and its `run-*` copy stays under the home.
- fix: `host.ts:2364-2366`:
  ```ts
  try {
    await this.stopHandlers(ext);
  } finally {
    await this.releaseLeases(ext).catch(() => undefined);
    rmSync(ext.folder, { recursive: true, force: true });
  }
  ```
  and `host.ts:4000`: collect instead of stopping: `const failed: unknown[] = []; for (const ext of [...this.exts.values()]) await this.unload(ext).catch((e: unknown) => failed.push(e));` and after `this.terminals.close();` add `if (failed.length) throw new AggregateError(failed, 'not every package stopped at close');`.
- verify: `packages/extension-host/test/environment-handles.test.ts` with a `down` that throws: after `close()` rejects, the supervisor shows no live run of another loaded package. Fails before.
- risk: removing the folder of a package whose environment is still up is a judgment (its code is already loaded; the environment's process may read from it). No test pins the order.

### HOST-5  A check's canvas keys are kept per package, not per run: two runs of one package's kinds at once lose or swap them
- kind: broken
- confidence: LIKELY (needs a `canvas` core, which the hub doesn't hand the host yet)
- where: `packages/extension-host/src/host.ts:866`, `:2530`, `:3718-3733`
- evidence: `this.canvasKeys.set(ext, []);` at a run's start, `this.canvasKeys.get(ext)?.push(...keys)` in `deep.canvas.read`, `const read = this.canvasKeys.get(ext) ?? [];` at its end and `this.canvasKeys.delete(ext)` in `finally`. The `run` ask carries no scope, so a read can't be told from another run's.
- failure: package P registers kinds k1 and k2. Run A (k1) starts, then run B (k2): B's `set` empties A's list. A reads the canvas, ends, and its `finally` deletes the entry. B's later reads hit `get(ext)?.push` on nothing; at its end `read` is `[]`, so `missing` is empty and B passes without its content keys as evidence, the rule `:3725-3727` exists to hold. The other order fails a run for keys that were the other run's.
- fix: no one-line edit. Smallest sound one: give each run a scope, as `dispatchRun` does (`:3396-3400`): in `runCheck` make `const scope = randomUUID(); ext.scopes.set(scope, CORE);`, key `canvasKeys` by `scope`, send `scope` with the `run` params, delete both in `finally`; in `deep.mjs:157-161` run the runner under it (`return await scope.run(params.scope, () => runner(params.spec, params.ctx));`); in `deep.canvas.read` use `this.canvasKeys.get(scope ?? '')`. About 8 lines in two files.
- verify: `tests/acceptance/411/plugin.test.ts` stays green; add a case running two kinds of one package at once, one reading the canvas and one not, and expect the reader's pass to need its keys.
- risk: medium: every call a check makes would then carry a scope, which `connection()` reads (`:2465-2472`); with `CORE` as the scope's caller the connection is what it is now (`actor: 'you', scope: 'you'`).

### HOST-6  The published API disagrees with what the host takes: `deep.store` has no `quota`, `deep.registerIndex` no fill, `deep.registerCheck` no `readings`
- kind: inconsistent
- confidence: LIKELY
- where: `packages/contracts/extension-api.json:665` (`deep.store`), `:503` (`deep.registerIndex`), `:24` (`deep.registerCheck`); `contracts/api-report/extension-api.api.md:207`, `:162`, `:156`; `packages/extension-host/src/host.ts:2741-2742`, `:2644-2646`, `:2546-2549`; `docs/technical-design.md:385`
- evidence (contract params printed with `node -e`):
  - `deep.store`: `declared` is `{generation, schema, migrates?}` with `"additionalProperties": false`. The host reads `declared.quota.bytes` (#365) and the #365 fixture passes it (`tests/acceptance/365/fixtures/tally/index.ts.fixture:16`).
  - `deep.registerIndex`: params are `{name}` only, `additionalProperties: false`. The host refuses a call without a second argument `{ slot: 'index@1', revision >= 1 }` (`:2646`); the design writes `deep.registerIndex(name, index)`; `deep.registerChannel` does list its `channel` param.
  - `deep.registerCheck` (the one `stable` method): params are `{type}`. The host also takes `{ readings }` (`:2546`).
  - The api-report is generated from the JSON (`scripts/api-surface.mjs:23,49-58`) and matches it method for method (40 = 40), so it carries the same three gaps, as does the generated guide.
- failure: a package written from the guide calls `deep.registerIndex('mine')` and is refused; one that declares a store quota or a check's readings passes a shape the contract says is not allowed.
- fix: in `extension-api.json` add `"quota": {"type":"object","properties":{"bytes":{"type":"integer","minimum":1}},"required":["bytes"],"additionalProperties":false}` to `deep.store`'s `declared`; an `index` param `{slot: const "index@1", revision: integer >= 1}` (open, as `channel` is) to `deep.registerIndex`, required; an optional `options: {readings?: string[]}` to `deep.registerCheck`. Then `packages/contracts/src/generate.ts` (digests), `node scripts/guide.mjs`, `node scripts/api-surface.mjs --write-report`.
- verify: `node scripts/api-surface.mjs` and `node scripts/guide.mjs --check` after regenerating; `tests/acceptance/139/*`.
- risk: each edit moves that method's digest; `deep.registerCheck` is stable, so its change needs the owner's yes (#139's rules). QUESTION for that one.

### HOST-7  `deep.evidence.put` and `deep.asks.create` are in the API, the guide and the design, and the host refuses both
- kind: inconsistent
- confidence: LIKELY
- where: `packages/extension-host/runtime/deep.mjs:35-36`; `packages/extension-host/src/host.ts:2918-2919`; `packages/contracts/extension-api.json:577`, `:598`; `docs/extension-guide.md:156`, `:332`; `docs/technical-design.md:411-413`
- evidence: a `node -e` comparison of `deep.mjs`'s `API` with the `case` labels of `dispatchNow`: the only two methods with no case are these; they fall to `default: throw Error(`${method} isn't wired into this host yet`)`. The guide lists both as "In R1 · preview" with no such note. The contract tracks them under `#359`. `tests/acceptance/348/grants.test.ts:22` requires the schema to list them, so they can't be dropped from `API`.
- failure: a package with `files` in its access words calls `deep.evidence.put('report.txt')` and gets `deep.evidence.put isn't wired into this host yet`.
- fix: owner's call: build them (issue #359), or have `scripts/guide.mjs` mark the two as not served yet. No safe small edit.
- verify: `tests/acceptance/348/grants.test.ts` (walk) stays green either way.
- risk: none for the note; building them is new behavior.

### HOST-8  `readStream` writes cursors.json from a copy read before its await: a read of another stream at the same time loses its cursor
- kind: broken
- confidence: SURE (the edit is a no-op for a lone call; no production caller today)
- where: `packages/extension-host/src/host.ts:1787`, `:1804`
- evidence: `const cursors = this.read<string | null>('cursors.json');` then `await this.ask(...)` (`:1791`), then `this.save('cursors.json', { ...cursors, [name]: p!.cursor });`. Callers: only `packages/extension-host/test/sources.test.ts:281-286` (`rg "\.readStream\("` over packages, tests, scripts, benchmarks), one at a time.
- failure: `readStream('ext.a.s', 10)` and `readStream('ext.b.s', 10)` start together. Both read `{}`. A saves `{a: c1}`, B saves `{b: c1}`: A's cursor is gone, and A's next page is its first page again.
- fix: `:1804` → `this.save('cursors.json', { ...this.read<string | null>('cursors.json'), [name]: p!.cursor });` (`read` and `save` are synchronous, so nothing can land between them).
- verify: `packages/extension-host/test/sources.test.ts` (the three `readStream` expectations) unchanged; add two streams read with `Promise.all` and expect both cursors kept after a restart.
- risk: none; two reads of the same stream at once still both get the same page (unchanged).

### HOST-9  `ready()` starts every package with no `ask`, also one whose own load is starting it, or one removed while the loop waited
- kind: broken
- confidence: QUESTION (a narrow window; the hub loads one at a time before `ready`)
- where: `packages/extension-host/src/host.ts:3878-3885`, `:2176-2180`, `:2248`
- evidence: `for (const ext of [...this.exts.values()]) { ... if (!ext.ask) { await this.start(ext)...`. A sandboxed load sets `ext.ask` only once its process connected (`:2308`), so a `loadNow` that resumed after `isReady = true` and is inside `sandboxed()` has no `ask` yet. And the list is a copy: a package unloaded while the loop awaited an earlier start (up to `LOAD_MS`) is still in it.
- failure: (a) `load(p)` is awaiting trust when `ready()` is called and `firstPartyVersions()` reads the record: `loadNow` starts `p`, the loop starts it again under the same run ID; the second start fails, `failed.push`, and `unload(ext)` removes the package the first start was bringing up. (b) `install` of a new version of B while the loop starts A: B is unloaded and its folder removed, then the loop starts it: `ready` rejects naming B though B was replaced, not broken.
- fix: `:3880` `if (!ext.ask) {` → `if (!ext.ask && !ext.starts && this.exts.get(ext.entry.id) === ext) {` (`starts` is bumped synchronously at `start()`'s first line).
- verify: `packages/extension-host/test/host.test.ts:434` and `:513` (ready with a package loaded before it) stay green.
- risk: none found; a package loaded before ready has `starts === 0`.

### HOST-10  `checkNow` removes its snapshot folder only on the straight path
- kind: broken (leak)
- confidence: LIKELY (low)
- where: `packages/extension-host/src/host.ts:2042-2058`, `:2077-2088`
- evidence: `const { folder, digest } = this.snapshot(entry);` ... `rmSync(folder, ...)` at `:2058` with no `finally`. `registers` rethrows what its kit loop throws (`await import('@deepbuild/conformance')`, `runKit`; its `finally` only stops the package). `installKits` and `contract` do use `finally` (`:1581-1584`, `:1263-1266`).
- failure: `runKit` throws on a channel fill: the `run-XXXXXX` copy of the package stays under `~/.deepbuild` for good; nothing sweeps `run-*` folders.
- fix: wrap `:2043-2057` in `try { ... } finally { rmSync(folder, { recursive: true, force: true }); }` and drop `:2058`.
- verify: `tests/acceptance/348/conformance.test.ts` unchanged.
- risk: none.

### HOST-11  `trustKey` checks the writer only; every other trusted-path call also refuses a session
- kind: inconsistent
- confidence: QUESTION
- where: `packages/extension-host/src/host.ts:1409-1414` against `:1416-1420`; doc `:249-253`
- evidence: `if (connection.writer !== 'app' && connection.writer !== 'cli') throw ...` while `trustedPath` adds `|| connection.session !== undefined` ("the CLI outside any agent's session", `:1415`). `approve`, `revoke`, `enterSecret`, `removeSecret`, `signIn`, the schedule edits, `subscribeNotice`, `setSendRule` and the work calls all go through `trustedPath`. The hub's one caller builds `this.connection('cli')` itself (`packages/hub/src/core.ts:6341`), so this is the host's own line of defense only.
- failure: a connection `{ writer: 'cli', session: 's1' }` (the CLI run inside an agent's session) may trust a new publisher key; the same connection is refused `approve`.
- fix: replace `:1410` with `this.trustedPath(connection, 'a publisher key is trusted');`.
- verify: `tests/acceptance/351/signature.test.ts:41-45` (an agent's call refused or ignored, yours accepted).
- risk: the refusal text changes; `rg "publisher key is trusted only"` finds it only at `host.ts:1410`.

### HOST-12  The package README's map of `src/` and of its acceptance suites is out of date
- kind: inconsistent
- confidence: LIKELY
- where: `packages/extension-host/README.md:9-13`, `:17`
- evidence: "Where new code goes" names `host.ts`, `replies.ts`, `trust.ts`, `compose.ts`, `sources.ts`, `jobs.ts`, `terminals.ts`, `digest.ts`, `kit.ts`. `git ls-files` also has `src/schedules.ts`, `sends.ts`, `series.ts`, `work.ts`. Line 13 lists suites 348-351, 363-366, 104, 103; the code also cites #65, #66, #67, #139, #262, #411, #989, #1454, #1731 (each has `tests/acceptance/<n>` using this package). Line 17's import list omits `better-sqlite3`, which `src/terminals.ts:14` imports and `package.json:24` declares.
- fix: add to line 11: "`src/schedules.ts`: schedules and their runs; `src/sends.ts`: sends; `src/series.ts`: series batches and rollups; `src/work.ts`: work sources"; extend line 13's list; add "and `better-sqlite3` for the terminals' hub lock" to line 17.
- verify: diff review (docs only).
- risk: none.

## extension-host: schedules, work, sends, replies, terminals (read by me)

### TSP-16  A cron line for a date that never comes (`0 0 31 2 *`) passes `cadenceOf`; edited onto a schedule it makes every hub tick throw, which stops every later schedule, every work delivery and every series rollup
- kind: broken
- confidence: LIKELY (each step read and the cron functions evaluated; not run in a host)
- where: `packages/extension-host/src/schedules.ts:118-126` (`cadenceOf` only parses), `:98-110` (`nextCron` throws after 100,000 steps), `:364-371` (`edit` sets `s.cadence` before `nextSlot` can throw), `:234-238` (`tick` awaits each `due` in one loop), `:264,269-273` (`slot` → `nextSlot`), `packages/extension-host/src/host.ts:1897` (`editSchedule`), `host.ts:1807-1813` (`tick`: scheduler, then work, then series)
- evidence: copied `parseCron`/`nextCron` into `node -e`: `0 0 31 2 *`, `0 0 30 2 *` and `0 0 31 4 *` all parse, then `nextCron` throws `the cron line matches no time in the years ahead` after 22 to 117 ms. `edit()` is `s.cadence = cadence; s.next = nextSlot(cadence, this.host.now()); this.host.saved(...)`: the throw leaves the new cadence in memory with the old `next`, unsaved. Once `now >= s.next`, `due(s)` calls `this.slot(s, now)` → `nextSlot` → throws; `tick()` rejects before it reaches the schedules after `s` in the map; `host.tick()` awaits `scheduler.tick()` first, so `work.tick()` and `series.tick()` never run, and the timer swallows the rejection (`host.ts:3873` `.catch(() => undefined)`).
- failure: on the trusted path, `editSchedule(connection, 'ext.shop.daily', { cron: '0 0 31 2 *' })` rejects with the message above, and from that schedule's next slot on: no schedule after it runs, no work delivery moves, no rollup or series retention is written, and each 250 ms tick burns 20 to 120 ms, until the hub restarts (the bad cadence was never saved).
- fix: `schedules.ts:121-124`: after `parseCron(d.cron);` add a line that proves the line has a time: `nextCron(parseCron(d.cron), 0);` (one call, instant for a real line). And in `edit` (`:366-368`) compute before assigning: `const next = nextSlot(cadence, this.host.now()); s.cadence = cadence; s.next = next;`.
- verify: `packages/extension-host/test/schedules.test.ts`: `expect(() => cadenceOf({ cron: '0 0 31 2 *' })).toThrow(/no time/)`; today it returns the cadence.
- risk: none; a `deep.schedule` with such a line is already refused at `register` (the same throw), so only the place of the refusal moves.

### TSP-17  A schedule registered again in one hub keeps its old declaration's cadence, and the next save writes that old cadence down as your edit
- kind: broken
- confidence: LIKELY
- where: `packages/extension-host/src/schedules.ts:199-200` (`if (before) return void Object.assign(before, { decl, live: true });`), `:201` (first registration takes `history.settings.cadence ?? decl.cadence`), `:388-390` (`settings`: `s.cadence !== s.decl.cadence` by identity), `:325,369,380` (the three `saved` calls); `packages/extension-host/src/host.ts:2859,980` (every `deep.schedule` call re-registers with a fresh `decl` and the saved settings)
- evidence: `drop(plugin)` only clears `live`, so a package loaded again (disable and enable, or a new version) finds `before`. Its `cadence` field is left pointing at the first declaration's object. The comment says its runs go on "under its new declaration".
- failure: v1 declares `{ every: 3_600_000 }`, you never edit it. v2 declares `{ every: 300_000 }` and is installed without a hub restart: the schedule still runs hourly. Then it FAILs five times in a row: `saved(name, settings(s))` writes `{ cadence: { every: 3600000 }, paused: … }` because the old object is not the new declaration's. After a restart `history.settings.cadence` is hourly, so v2's own cadence is never used and the list shows it as your setting.
- fix: `schedules.ts:200` → `if (before) return void Object.assign(before, { decl, live: true, cadence: history.settings.cadence ?? decl.cadence });`
- verify: `packages/extension-host/test/schedules.test.ts`: register `{ every: 60_000 }`, `drop`, register `{ every: 10_000 }` with empty settings; expect the next run 10 s on, and `saved` (after a `resume`) to carry no `cadence`.
- risk: `tests/acceptance/365` re-registers nothing with a changed cadence (`rg "drop\(|register\(" tests/acceptance/365` finds none). A cadence you edited is kept: it comes back through `history.settings`.

### TSP-18  A work delivery whose `deliver` throws is tried again at every 250 ms tick, with a synced claim each time, for as long as it fails
- kind: broken
- confidence: LIKELY (the retry is intended, #66 AC15; its spacing is not written anywhere)
- where: `packages/extension-host/src/work.ts:466-467` (`recorded` or `tried` with a rule or an ask → `send`), `:486-502` (`send`: `claimed` with `sync`, then `tried` on a throw or on no outcome), `:439-457` (`tick` → `deliverAll`), `packages/extension-host/src/host.ts:497,1811` (the 250 ms timer), `packages/sources/linear/index.ts:86` (a shipped `deliver` that throws when the provider refuses)
- evidence: nothing in `advance` reads a time. After `step(x, 'tried', …)` the next tick sees `x.phase === 'tried'` and `x.rule || x.ask`, and calls `send` again: one `work.delivery` `claimed` append with `record.sync()`, one package call, one `tried` append. When the source's quota is spent, `workFetch` throws (`sources.ts:469-470`), the package's `deliver` rejects, and the loop goes on without the provider.
- failure: Linear refuses a comment for a day (the issue is locked, the text too long, the token's scope gone): 4 ticks a second make 8 `work.delivery` events and 4 fsyncs a second, about 690,000 events a day for one delivery, and every later delivery to that thread waits behind it (`:449-453`).
- fix: owner's call on the numbers. Smallest: a wait that doubles, kept in memory. In `WorkSources`: `private readonly retry = new Map<string, { at: number; gap: number }>();`; in `advance` before `:466`: `const wait = this.retry.get(x.key); if (x.phase === 'tried' && wait && this.h.now() < wait.at) return;`; in `send` before each of the two `return this.step(x, 'tried', …)` (`:495`, `:501`): `const gap = Math.min((this.retry.get(x.key)?.gap ?? 500) * 2, 6 * 3_600_000); this.retry.set(x.key, { at: this.h.now() + gap, gap });`; and `this.retry.delete(x.key)` where it reads `sent` or `gone`. `settle`'s own `tried` (`:513`) goes out at once, as now.
- verify: a case beside `tests/acceptance/66/order.test.ts`: a tracker that answers 503 for ten minutes of the fake clock; count `work.delivery` events for the key (thousands today).
- risk: `tests/acceptance/66/order.test.ts:26` wants the first delivery "tried three times" within three hours of its clock, which a 1 s, 2 s wait still gives; check how its `step` helper moves the clock before landing this.

## Nits (one line each; mine, beyond the sub-reader's list in `scratchpad/ts-platform-parts/host.md`)

- `packages/adapters/src/index.ts:44-45`: the comment says Codex's facts don't list SessionEnd "yet, #47"; `adapters/codex.facts.json:837-838` has mapped `SessionEnd` → `session.end` since d27b5c9d (Oct 19). Stale comment.
- `packages/adapters/src/index.ts:86` and `packages/conformance/src/runner.ts:26`: the list of facts schema versions (`@2` to `@5`) is written twice, once as four `===` and once as a regex; an `@6` needs both.
- `packages/contracts/src/slots.ts:16-26`: `ApiEntry` has no `tracking`, which every preview row of `extension-api.json` carries and `scripts/contract-diff.mjs` reads.
- `packages/contracts/src/manifest.ts:169`: a `replaces` package id that `extension.compose@1` refuses is reported at `/pieces/<n>`, a path the manifest does not have (the field is `replaces`), though the comment at `:117-118` says the issues' paths are the manifest's.
- `packages/extension-host/src/series.ts:204,220`: `this.reopened ??= this.reopen()` keeps a rejected promise: one failed `record.raw` at the first tick makes every later `land` and `tick` reject until the hub restarts. Same shape in `packages/extension-host/src/work.ts:129` (`loaded`).
- `packages/extension-host/src/series.ts:223-228`: `windows.close(now)` takes every closed window out before the first is written; a `put` or `append` that throws on one loses the rollups of the rest (rebuilt at a restart only when no later window of that span was written).
- `packages/extension-host/src/sources.ts:330-331`: a failed call's back-off is counted from the call's start (`now` is read at `:302`), so after a timeout the first waits (1 s, 2 s, … up to the source's timeout) are already over when they are set.
- `packages/extension-host/src/sources.ts:442`: `signIn`'s token call goes through `options.http`, not `call()`: it is not recorded, and a host opened with `replay` would make it live, against the header's "a recording … make[s] no live call".
- `packages/extension-host/src/schedules.ts:283,304`: a resumed run keeps its first `dispatched` time, so a run that passes after a hub restart longer than its deadline is recorded FAIL "it ran past its deadline". QUESTION: intended or not; #365's stopped test resumes at once.
- `packages/extension-host/src/schedules.ts:98-110`: `30 2 * * *` does not run on the spring-forward day in a zone with DST (evaluated: after 2027-03-13 in America/Los_Angeles the next slot is Mar 15). The fall-back hour is not doubled.
- `packages/extension-host/src/schedules.ts:234-238`: one schedule whose `due` throws (a failed append) skips every schedule after it for that tick.
- `packages/extension-host/src/terminals.ts:382-395`: when the ring wraps under all three tries, `read` returns the bytes of the third read, which it has just found overwritten, at the new offset. Needs over 8 MiB of output between two `O` calls three times running.
- `packages/extension-host/src/work.ts:535-589`: the work.item@1 kit reads PASS for a fixture with no `items` and a source that lists nothing; its only callers are #66's tests, which pass real fixtures.
- `packages/extension-host/src/work.ts:105`: a receipt longer than about 7,980 characters makes the cut's end negative, so the "cut" text is the head minus its tail rather than a prefix.
- `packages/conformance/src/slots/reading-source.ts:108-114`: the comment says a fill that refuses "names the changed digest"; the judge accepts any `{ refused: 'schema_digest_changed' }` without reading `expected` and `actual`.
- `packages/conformance/src/slots/resolver.ts:104`: `decisions.sort(() => (random.int(0, 1) ? 1 : -1))`: an inconsistent comparator; the order for a recorded seed is whatever this V8's sort does with it.
- `packages/conformance/src/slots/check-kind.ts:84`, `environment.ts:493`: `rel.startsWith('..')` also refuses a real entry named `..x` in the checkout.
- `packages/cli/src/login-service.ts`: only `tests/acceptance/41/update/login-service.test.ts` imports `serviceDefinition`; setup writes the service from `packages/hub/src/paths.ts:200-203` (`installedPrograms`). In use by the brief's rule (an acceptance suite reads it), so not reported as unneeded; the suite proves a function setup does not call.
- `packages/cli/src/update-check.ts:17-19`: any registry version other than this one reads "is available", an older one too.
- `packages/cli/src/main.ts:304`: `deep explain --json <folder>` reads `--json` as the folder (the flag is only taken after it).
- `contracts/corpus.json`: 256 "earlier-release/R1" members copied from the fixtures on Oct 30 and Nov 5; 81 of the 259 published schemas (those added since, `source.called@1`, `work.read@1`, `build.rolled_back@1` among them) have no member, and nothing checks that. QUESTION: is it meant to follow main until R1 is cut (e82334bb says "the corpus holds main's new contract fixtures")?
- `contracts/fixtures/R1/index.ts:2-3` says the fixture is "pinned by their envelope digest in contracts/releases/R1.json"; `contracts/releases/` does not exist (no release recorded yet), so `contract-diff.mjs old-load` passes with nothing to load. A state, not a bug.
- Checked and fine: every schema but `doctor.item@1`, every slot interface and every lifecycle table equals its frozen digest; all 40 `extension-api.json` digests equal the d1 of their params; every `hub-slots.json` digest equals `digests.json`; every schema has a fixture folder and no fixture folder lacks its schema; `digests.json` has no orphan key; the 52 gate cases and 14 check-kind suites under `packages/conformance/fixtures` are each used and none is missing; `contracts/shipped.json`'s three pieces exist and call `deep.registerCheck`; every `corpus.json` source path exists and every sample's schema is published; `packages/cli`, `packages/adapters`, `packages/contracts` and `packages/conformance` `package.json` `exports`, `bin` and dependencies each name something that exists and is imported; the terminal frame (type byte, u32 LE length; `R` two u16 LE; 8 MiB ring; 16 MiB input; 1 to 1000 cells) agrees with `packages/supervisor/native/pty.c`; no `doneright` name in my files.

## Coverage

| Read in full | Skimmed (enough to know what it pins or holds) | Not read, and why |
|---|---|---|
| `packages/contracts/src/*.ts` but `generated/` (17 files), `package.json`, `README.md`, `tsconfig.json` | `packages/contracts/test/*.ts` (test names; `lifecycle.test.ts` body), `extension-api.json`, `hub-slots.json`, `rpc-methods.json`, `digests.json`, `slots/*.json`, `schemas/*.json`, `fixtures/**` (by script: digests, names, orphans; `doctor.item@1`, `source.called@1`, `extension.compose@1` read), `canvas-*.json` (who loads them) | `packages/contracts/src/generated/types.ts` (generated); the 360 fixture files and 267 schemas line by line (structure checked by script, as the task said) |
| `packages/conformance/src`: `index`, `findings`, `pointer`, `result`, `probe`, `dispatch`, `types`, `slot-types`, `slot-runner`, `slot-check`, `runner`, `kit`, `shipped`, `families`, `planted`, `pages`, `bin`, `generator`, `closures`, `gate`, and all of `slots/*.ts` but the two test files; `runtime/check-kind/*.mjs`; `package.json`, `README.md` | `src/gate-play.ts` (lines 1-60 and its constants), `src/doctor-codes.test.ts`, test names of `slots/check-kind.test.ts`, `fixtures/gate/manifest.json` and `fixtures/**` (by script) | `src/fake-agent.ts` (the adapter kit's reference fake, 231 lines), `src/gate-play.ts` 61-325, `runtime/environment/*.mjs`, `runtime/gate/agent.mjs`, `src/precedence.test.ts`, `slot-runner.test.ts`, `slot-check.test.ts`, `slots/environment.test.ts`: ran out of room; the fixture suites' own files |
| `packages/extension-host/src`: `compose`, `series`, `sources`, `schedules`, `sends`, `replies`, `work`, `terminals`; by the sub-reader: `host.ts` (all 4,030 lines), `index`, `trust`, `jobs`, `kit`, `digest`, `runtime/*`, `kit/decision-kinds/*`, `package.json`, `README.md` | `test/series.test.ts` (whole), `test/host.test.ts`, `slots.test.ts`, `leases.test.ts` (names, by the sub-reader), `packages/supervisor/native/pty.c` (frame and caps only) | `test/sources.test.ts`, `schedules.test.ts`, `environment-*.test.ts` beyond what a finding needed; `host.ts` by me beyond the lines of HOST-1, 2, 3, 4, 8 and the call sites my findings cite |
| `packages/adapters/src/index.ts`, `shipped.ts`, `types.ts`, `package.json`, `README.md`, `tsconfig.json` | `src/codex-hooks.generated.ts` (header) | the generated body |
| `packages/cli/src/*.ts`, `package.json`, `README.md`, `test/loads.test.ts` | `test/cli.test.ts` (test names) | - |
| `contracts/shipped.json`, `plain-words.json`, `fixtures/R1/*` | `contracts/corpus.json` (by script), `contracts/api-report/extension-api.api.md` (compared with the JSON by the sub-reader's script) | - |

Outside my area, read to prove a finding: `scripts/contract-diff.mjs`, `scripts/slots-check.mjs`, `tests/facts-entry.test.mjs`, `packages/hub/src/hub-command.ts`, lines of `packages/hub/src/libraries.ts`, `packages/gate/src/mask.ts`, `packages/checks-command/src/report.ts`, `packages/record/src/projections.ts`, `packages/workspaces/src/index.ts`, `packages/sources/linear/index.ts`.

One sub-reader I meant to start for `work.ts`, `terminals.ts`, `schedules.ts`, `sends.ts` and `replies.ts` could not start (the session's limit on agents was reached), so I read those five myself, later and faster than the rest.
