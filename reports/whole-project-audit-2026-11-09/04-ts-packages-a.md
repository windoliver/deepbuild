# ts-small-a: asks, record, gate, checks-*, supervisor, runner, env-local

Checkout `the checkout` (origin/main 06fd33cd). Read-only; nothing
was built or run. Regex and number claims marked "evaluated" were run as pure `node -e` copies of the expression.

How the area was read: record, gate and checks-command by the area reader in full; supervisor, runner and env-local by
a fork (its part is kept as `findings/ts-small-a.part-sre.md` and merged below as findings 14 to 27; the area reader
re-read the lines it cites for findings 14, 18, 19, 21, 23, 25 and 26, and evaluated finding 18's replacement again);
asks and the other four check kinds by the area reader after a second fork was refused by the session's agent limit.
asks and checks-journey were read only in part: the coverage table says which lines.

Paths are relative to the checkout root.

---

## Ranked index, worst first

The sections below are in ID order (1 to 13 from the area reader, 14 to 27 from the fork that read supervisor, runner and env-local); this table is the ranking. Every Linux finding is by reading only: no Linux machine was used.

| Rank | ID | Kind | Confidence | What | Where |
|---|---|---|---|---|---|
| 1 | ts-small-a-1 | broken | LIKELY | A pytest run whose every test is skipped or xfailed ends `passed`, `testsRun: 1` | `packages/checks-command/src/index.ts:444` |
| 2 | ts-small-a-14 | broken | SURE | Linux sandbox: `O_TMPFILE` in the write mask holds `O_DIRECTORY`, so every directory open outside a write grant is refused | `packages/supervisor/native/helper-linux.c:401, :814` |
| 3 | ts-small-a-15 | broken | LIKELY | Linux sandbox: `sendto(MSG_FASTOPEN)` opens a TCP connection the egress rule never sees | `packages/supervisor/native/helper-linux.c:461-497` |
| 4 | ts-small-a-16 | broken | LIKELY | Linux sandbox: netlink connect and Unix bind are continued, so the address can be swapped after the check | `packages/supervisor/native/helper-linux.c:701, :668` |
| 5 | ts-small-a-20 | inconsistent | LIKELY | Linux sandbox has no deny rule for `.claude/`, `.codex/`, `.mcp.json`, `.claude.json`; Seatbelt has, and three comments rely on it | `packages/supervisor/native/helper-linux.c:258-262` |
| 6 | ts-small-a-9 | broken | LIKELY | A review against a rubric page with no readable rule always passes | `packages/checks-review/src/review.ts:13-14, :115` |
| 7 | ts-small-a-18 | broken | SURE | The egress filter corrupts a credential that holds `$$`, `$&`, `` $` `` or `$'` | `packages/supervisor/src/egress.ts:187` |
| 8 | ts-small-a-3 | broken | LIKELY | A git killed with input unwritten can crash the hub: `child.stdin` has no error listener | `packages/gate/src/checkouts.ts:95` |
| 9 | ts-small-a-19 | broken | LIKELY | A cleanup that throws once is memoized: the run's leases and the runner's job stay stuck | `packages/supervisor/src/supervisor.ts:769-773` |
| 10 | ts-small-a-2 | broken | SURE | The one masked-exit rule misses `\|&` | `packages/gate/src/mask.ts:12` |
| 11 | ts-small-a-10 | broken | LIKELY | A service check whose floor lacks a number passes without asserting it | `packages/checks-work/runtime/probe.mjs:73-76` |
| 12 | ts-small-a-21 | broken | SURE | A warm run whose app fails its health check is signalled but never cleaned | `packages/env-local/src/warm.ts:594-598` |
| 13 | ts-small-a-17 | broken | LIKELY | Linux sandbox on x86_64: no x32 check, so x32 calls skip every rule | `packages/supervisor/native/helper-linux.c:457-460` |
| 14 | ts-small-a-23 | broken | LIKELY | On Linux the runner's git steps are granted read of `/` | `packages/runner/src/runner.ts:613` |
| 15 | ts-small-a-24 | broken | LIKELY | One failed `docker context inspect` is cached for the hub's life | `packages/env-local/src/stack.ts:414-429` |
| 16 | ts-small-a-12 | broken | LIKELY | A worktree with an scp-like SSH remote never places its own host or repo as `repo` | `packages/asks/src/targets.ts:117-122` |
| 17 | ts-small-a-22 | broken | LIKELY | The runner's quiet watch resets its own baseline and never stops a silent job (latent) | `packages/runner/src/runner.ts:904-919` |
| 18 | ts-small-a-11 | broken | SURE | `hunks` reads a removed `-- ` line as a file header (reached from acceptance tests only today) | `packages/checks-review/src/diff.ts:39` |
| 19 | ts-small-a-4 | broken | SURE | Index holders a crash leaves in the object store are never removed | `packages/gate/src/checkouts.ts:190-193, :271` |
| 20 | ts-small-a-25 | broken | SURE | A warm stack that fails to open leaves its two folders | `packages/env-local/src/warm.ts:173-177, :213` |
| 21 | ts-small-a-5 | broken | QUESTION | A read-only folder in a run's temp folder makes `rmSync` in `finally` replace the run's result | `packages/checks-command/src/index.ts:457-461` |
| 22 | ts-small-a-27 | broken | QUESTION | Linux sandbox: four smaller gaps (listen autobind, signals on Landlock 4-5, `/var` readable, `setxattrat`) | `packages/supervisor/native/helper-linux.c:490, :347, :325` |
| 23 | ts-small-a-8 | broken | LIKELY | `prepareRestore` leaves the copy's database open when its rebuild throws | `packages/record/src/index.ts:1034-1036` |
| 24 | ts-small-a-7 | broken | QUESTION | `simulate` reads `PASS` for a claim with no check (model only) | `packages/gate/src/scheduler.ts:120, :491` |
| 25 | ts-small-a-6 | inconsistent | SURE | gate's card: `yaml` is imported, and four source files are not on it | `packages/gate/README.md:9-17` |
| 26 | ts-small-a-26 | inconsistent | SURE | env-local's card says it never spawns a process; it runs `lsof` and `docker` | `packages/env-local/README.md:10` |
| 27 | ts-small-a-13 | inconsistent | SURE | checks-numbers' card says it has no `test/` folder; it has one | `packages/checks-numbers/README.md` |

Counts: 27 findings. broken 23 (SURE 7, LIKELY 13, QUESTION 3); inconsistent 4 (SURE 3, LIKELY 1). No full finding is `inefficient` or `unneeded`: speed was swept today, and what nothing reaches here is either already filed (#1900, #1907, hill-climb 04 F12) or used by an acceptance suite. A few of each are in the nits.

---

## Findings


### ts-small-a-1  A pytest run whose every test is skipped or xfailed in its source ends `passed` with `testsRun: 1`
- kind: broken (invariant 2; design line 296: "A run of zero tests ... counts as INVALID, never as a pass")
- confidence: LIKELY (read from the code; pytest was not run)
- where: `packages/checks-command/src/index.ts:444-445`; `packages/checks-command/runtime/python/deep_check_pytest.py:93-94, 99-104, 164-176, 192-198`; `packages/checks-command/src/report.ts:151-157`
- evidence:
  - `index.ts:444-445`:
    ```ts
    const tool = go || [nodeReport, vitestReport].some((r) => (r?.lines.length ?? 0) > 0);
    if (!ran.length) return tool ? done('ran_nothing', rest, ran) : done('passed', { ...rest, testsRun: 1 }, ran);
    ```
    "A test tool ran" is read from the report holding at least one line.
  - The pytest plugin writes a line only for: a `run:error` condition, a deselected or pattern-dropped test (`test:left`), a test whose call ran (`test:pass`/`test:fail`, `:164-176`, only `if test['ran']`), a collect failure, and `test:listed` for each test `_listing` finds (`:192-195`). `_listing` leaves out every test its source skips (`_SKIPS`, `:99-104`) and returns `[]` for a file with a module-level skip mark (`:93-94`). The trailer is not a line (`report.ts:11,25`).
  - So a file such as `import pytest\n\n@pytest.mark.skip\ndef test_total():\n    assert 11 == 12\n` writes the trailer alone. pytest exits 0 for "1 skipped" (exit 5 is only for nothing collected).
  - Vitest and Jest write `file:ran` per file and node:test writes its skip lines, so they read `ran_nothing` (pinned: `tests/acceptance/30/record.test.ts:26-29`, `packages/checks-command/test/regressions.test.ts:511-517`). No test covers pytest with nothing run: `rg "mark\.skip|pytestmark" packages/checks-command/test tests/acceptance/30` finds only `regressions.test.ts:404`, which keeps one passing test.
- failure: check `python3 -m pytest -q tests/test_cart.py` on a file whose tests all carry `@pytest.mark.skip` (or `pytestmark = pytest.mark.skip`, or `@pytest.mark.xfail`). Result: `{ outcome: 'passed', testsRun: 1 }`. Wanted: `ran_nothing`, 0 tests, as for Vitest, Jest and node:test.
- fix: the report file exists only when Vitest's, Jest's or pytest's reporter opened it (`vitest-reporter.mjs:12`, `jest-reporter.mjs:11`, `deep_check_pytest.py:52`), so read "a tool ran" from that:
  ```ts
  - const tool = go || [nodeReport, vitestReport].some((r) => (r?.lines.length ?? 0) > 0);
  + const tool = go || vitestReport !== null || (nodeReport?.lines.length ?? 0) > 0;
  ```
- verify: a new case beside `regressions.test.ts:511`: a checkout with the file above, `runner: 'python3 -m pytest -q'`, expect `['ran_nothing', 0]`. It fails before and passes after.
- risk: a command that starts Vitest, Jest or pytest and exits 0 with no test and no line now reads `ran_nothing` instead of `passed`; that is the documented rule. A typecheck or lint command opens no report file (`preload.mjs:19-20,33` loads a reporter only into Vitest's or Jest's own entry), so `tests/acceptance/33` AC5 (typecheck passes) is not touched. No test pins the current pytest result.

### ts-small-a-2  The one masked-exit rule misses `|&`, so a cited run piped that way is taken as proof
- kind: broken
- confidence: SURE that the rule returns null (evaluated); LIKELY for the edit (no test pins either way)
- where: `packages/gate/src/mask.ts:12` (second pattern); used by `packages/gate/src/floor.ts:111,140` (validity gate, production through the hub's `validityGate`), `packages/gate/src/claim.ts:165`; the kit's reference copy `packages/conformance/src/slots/check-kind.ts:70` has the same pattern (another area)
- evidence: `/(?<![|&])\|(?![|&])\s*\S+/` refuses a `|` followed by `&`. Evaluated on a copy of `maskIn`:
  ```
  "npm test |& tee log" => null
  "npm test | tail"     => "| tail"
  ```
  `|&` is zsh's and bash 4's pipe of stdout and stderr; the pipeline's exit is the last command's. The design lists "a pipe without `pipefail`" (`docs/technical-design.md:296`). Agents' shells on macOS are zsh. `rg -F '|&' tests/acceptance/29 tests/acceptance/30 packages/gate/test packages/checks-command/test` finds nothing.
- failure: a claim's final message cites `` `npm test |& tail -20` ``, a run that failed and exited 0. `validityGate` finds no `masked_exit` and the claim is not sent back for it. The command check kind itself is not affected: `untraced` reads `&` as a program it can't trace and leaves the run uncounted (`checks-command/src/shell.ts:222-235`).
- fix: `mask.ts:12`
  ```
  - /(?<![|&])\|(?![|&])\s*\S+/
  + /(?<![|&])\|(?!\|)&?\s*\S+/
  ```
  Evaluated: `a |& b` → `|& b`; `a | b` → `| b`; `a || b`, `a && b`, `x ||& y` → null; `a 2>&1 | tee x` → `| tee`.
- verify: add `expect(maskIn('vitest run |& tee out')).toBe('|& tee')` beside `packages/checks-command/test/regressions.test.ts:665`.
- risk: none found. `tests/acceptance/29/floor.test.ts:161-169` compares the floor's mask with `maskIn` of the same command, so it follows the rule.
- also seen, not proposed: the rule reads nothing inside quotes, so `sh -c "npm test || true"`, `bash -c 'npm test; true'`, `eval "…"` and `echo "$(npm test)"` all return null (evaluated). The check kind refuses each as an untraced program or a substitution; the validity gate does not. Closing that in `maskIn` changes what `blanked` means for every caller, so it is the owner's call. And `npm test || exit 1` is named a mask (`|| exit 1`) though it keeps the failure; the design names only `|| exit 0`.

### ts-small-a-3  A git that dies with input still unwritten can take the hub down: `child.stdin` has no error listener
- kind: broken
- confidence: LIKELY (Node behavior known, not reproduced here; the order of the two events is a race)
- where: `packages/gate/src/checkouts.ts:84-97` (`runGit`, `:95`), fed by `:289-290, :295, :392, :474`; the kill at `:202`; production callers pass a budget at `packages/hub/src/gate-runner.ts:568-592`
- evidence: `if (input !== undefined) child.stdin!.end(input);` and nothing listens for `'error'` on `child.stdin`. `materialize` hands `checkout-index -z --stdin` the whole path list of the tree (`:391-392`) whenever at least one big file was cloned; git reads that list as it writes files. The budget timer SIGKILLs every git of the claim at 8 s (`:202`). A write still queued when the reader dies fails with `EPIPE`; a stream's unhandled `'error'` is an uncaught exception. `rg "uncaughtException|unhandledRejection" packages/hub/src` finds no handler.
- failure: a claim on a large repo (path list over the pipe's 64 KiB, one tracked file of 1 MiB or more) under load, whose checkout passes 8 s. git is killed mid-read; when the EPIPE lands before the child's exit handler destroys stdin, the process running the gate exits with `write EPIPE` instead of the claim reading "snapshot over budget".
- fix: `checkouts.ts:95`
  ```ts
  - if (input !== undefined) child.stdin!.end(input);
  + // A git stopped before it read its input fails through execFile's callback; the pipe's own error is not another.
  + if (input !== undefined) { child.stdin!.on('error', () => undefined); child.stdin!.end(input); }
  ```
- verify: no existing test. A test that runs `runGit` (through `snapshot` under a budget whose git is a stub that sleeps and never reads stdin, with a 1 MiB input) and expects `OverBudget`, not a crash.
- risk: none; the callback already rejects on a failed or killed git (`:89-92`).

### ts-small-a-4  Index holders a crash leaves in the object store are never removed
- kind: broken (leak)
- confidence: SURE
- where: `packages/gate/src/checkouts.ts:271, :364, :469` (made), `:190-193` (open cleans only `root`), `:602-621` (prune touches refs and `objects/` only)
- evidence: each snapshot, checkout and base tree makes `mkdtemp(join(o.store, 'index-'))` and removes it in `finally`. The file's header says "a crash's goes at the next open", and `openCheckouts` clears every entry of `o.root`, but nothing lists `o.store` for `index-*`. `rg "index-" packages/gate/src packages/hub/src/retention.ts packages/hub/src/core.ts` finds only the three `mkdtemp` calls.
- failure: the hub is killed during a snapshot or a checkout. `<hub root>/objects/index-XXXXXX/index` (a copy of the repo's index, megabytes on a large repo) stays for the life of the install; each crash adds one.
- fix: after `checkouts.ts:193`
  ```ts
  + // An index holder a crash left in the store goes too: only a call in flight has one.
  + await Promise.all((await readdir(o.store)).filter((name) => name.startsWith('index-')).map((name) => rm(join(o.store, name), { recursive: true, force: true })));
  ```
- verify: no existing test; `tests/acceptance/31` opens the service on a fresh store. A test that makes `store/index-stale/` before `openCheckouts` and expects it gone.
- risk: two hubs on one store would remove each other's holders in flight; `openCheckouts` already clears the whole `root` on the same assumption (`:193`).

### ts-small-a-5  A run's temp folder is removed with a throwing `rmSync` in `finally`: a read-only folder in it replaces the run's result with an error and leaves the folder
- kind: broken
- confidence: QUESTION (needs a run that leaves a read-only folder under its HOME or TMPDIR; not reproduced)
- where: `packages/checks-command/src/index.ts:457-461`; compare `packages/gate/src/checkouts.ts:163-175` (`clear`, which chmods and retries)
- evidence: `finally { clearTimeout(kill); await removeControls(checkout, controls); rmSync(temp, { recursive: true, force: true }); }`. `force` only forgives a missing path. The run's `HOME` and `TMPDIR` are inside `temp` (`:287`). Go writes its module cache read-only under `$HOME/go/pkg/mod`; a test can `chmod 555` a folder it made in `TMPDIR`. The gate's own checkout removal handles exactly this case with `chmod -R u+rwX` and a second `rm`.
- failure: a `go test` check run `outside` (network on) that downloads a module, or any suite that leaves a mode-555 folder in its temp folder. `rmSync` throws `EACCES` from `finally`, so `runOnce` rejects in place of the result it had built, and `deep-check-<run>` stays in the temp folder.
- fix: `index.ts:460`
  ```ts
  - rmSync(temp, { recursive: true, force: true });
  + try { rmSync(temp, { recursive: true, force: true }); } catch { /* a folder the run made read-only: its result stands, and the OS clears the temp folder */ }
  ```
  (or chmod and retry, as `checkouts.ts` `clear` does, to also remove it).
- verify: a case in `regressions.test.ts` whose test does `mkdirSync(join(process.env.TMPDIR, 'ro', 'x'), { recursive: true }); chmodSync(join(process.env.TMPDIR, 'ro'), 0o555)` and expects `outcome: 'passed'`.
- risk: none for results; the try/catch form leaves the folder for the OS.

### ts-small-a-6  `@deepbuild/gate`'s card disagrees with the package: it may import `yaml`, and four source files are not on it
- kind: inconsistent
- confidence: SURE
- where: `packages/gate/README.md:9-12, :17`; `packages/gate/src/size.ts:8`; `packages/gate/package.json` (`"yaml": "2.9.1"`); `packages/gate/src/{checkouts,open,size,kinds}.ts`
- evidence: the card says "Core: only `@deepbuild/contracts`, `@deepbuild/leases`, `@deepbuild/verdicts` and `node:` built-ins ... plus types alone from `@deepbuild/conformance` ... and `@deepbuild/supervisor`". `size.ts:8` is `import { parse as parseYaml } from 'yaml';` (compose files' services, `:99-106`). "Where new code goes" names claims, floor, own, head, scheduler, exec, stack, claim, price and stalls; it does not name `src/checkouts.ts` (#31, the path the hub runs), `src/open.ts` (#323), `src/size.ts` (#324) or `src/kinds.ts` (#68), all exported from `src/index.ts:17-36`.
- failure: a reader following the card treats `yaml` as a boundary break and has no place for base-run, open-item or size code.
- fix: `README.md:17` add "and `yaml` (`src/size.ts` reads a compose file's services)" after "`node:` built-ins"; add one bullet: "`src/checkouts.ts`: snapshots, temporary checkouts and base-commit runs (#31); `src/open.ts`: what a claim leaves open (#323); `src/size.ts`: a change's size and scope (#324); `src/kinds.ts`: a check kind's admission (#68)."
- verify: diff review (docs only).
- risk: none.

### ts-small-a-7  `simulate`'s verdict of a claim with no check is `PASS`
- kind: broken (in the model only)
- confidence: QUESTION
- where: `packages/gate/src/scheduler.ts:120` (`worst` starts from `'PASS'`), `:491` (`verdictOf`), `:685-687` (`line` prints `PASS 0/0 · receipt`)
- evidence: `const worst = (rs: Result[]): Result => rs.reduce<Result>((a, b) => (RANK[b] > RANK[a] ? b : a), 'PASS');` and `verdictOf(c) { return worst([...c.entries.values()].map(...)); }`. A single check with no counted run is `pending` (`:487`), but a claim with no entries is `PASS`. The scheduler has no production caller (`rg "\bsimulate\b" packages --glob '!packages/gate/**'` finds none; only `tests/acceptance/29`), and the hub's verdict goes through the engine (`claim.ts:183`), so nothing a person sees reads this today.
- failure: a `SessionScript` with `checks: []` that stops after work: its `StopReply.verdict` is `PASS`.
- fix: only if the model is kept as the reference for the hub's lanes: `worst` of an empty list should be `'pending'` (or the engine's INVALID "no requirements").
- verify: a scenario in `tests/acceptance/29` style with an empty check list; that suite is never edited, so a `packages/gate/test` case.
- risk: `tests/acceptance/29` may hold a scenario with no checks that expects `PASS`; not checked scenario by scenario.

### ts-small-a-8  `prepareRestore` leaves the copy's database open when its rebuild throws
- kind: broken (handle leak on an error path)
- confidence: LIKELY
- where: `packages/record/src/index.ts:1034-1036, :1047-1050`
- evidence: `const record = new SqliteRecord({ path: tmp, now: Date.now }, fileStorage()); await record.rebuild(); record.sealRestored(...)`. Only `sealRestored` closes the connection (`:867`). A `rebuild` that throws (an event a migration or a projection can't read) goes to the outer `catch`, which deletes `tmp`, `tmp-wal` and `tmp-shm` under an open connection and rethrows.
- failure: `deep restore` of a backup whose log holds an event the projector throws on: the CLI process keeps a WAL-mode connection to unlinked files until it exits. Small, since the command ends; it matters only if a long-lived process ever calls it.
- fix: wrap `:1035-1036`
  ```ts
  - await record.rebuild();
  - record.sealRestored(generation, Math.max(copy.next, replaced.next));
  + try { await record.rebuild(); } catch (error) { await record.close().catch(() => undefined); throw error; }
  + record.sealRestored(generation, Math.max(copy.next, replaced.next));
  ```
  `close()` writes `state: stopped` to the copy, which the `catch` then discards.
- verify: `tests/acceptance/572` style: a backup with a corrupt event row; expect the error and no open handle (hard to assert; diff review).
- risk: none.

### ts-small-a-9  A review against a rubric page with no readable rule always passes
- kind: broken (invariant 2)
- confidence: LIKELY (read from the code; no model was run)
- where: `packages/checks-review/src/review.ts:13-14` (`rubricRules`), `:86`, `:37`, `:115`; the hub picks the page at `packages/hub/src/kinds.ts:107-114`
- evidence: a rule is a list item `- <id>: <text>` whose id matches `[A-Za-z0-9][\w.-]*` with the colon right after it. A page with none gives `rules = []`. Then every finding is dropped at `:37` (`rule … isn't a rule of the rubric`), `items` is empty, and `:115` returns `outcome: items.length ? 'failed' : 'passed', testsRun: 1`. The hub reads `<root>/wiki/review-rubric.md` whenever it exists, whatever it holds. The kit's only rubric has two well-formed rules (`src/kit.ts:28`), so nothing covers an empty one. The sibling kinds return `ran_nothing` for the same shape (`checks-work/runtime/probe.mjs:174`, `checks-numbers/runtime/probe.mjs:53`).
- failure: your wiki's `review-rubric.md` writes its rules as `- Swallowed errors: a catch block that drops the error` (a space in the id), as a numbered list, or as headings. Every review of every PR claim reads `passed`, "nothing sent back; N dropped", and a counted review run stands for the claim.
- fix: `review.ts`, after `:90`
  ```ts
  + // A rubric with no rule can send nothing back: the review ran nothing, never a pass.
  + if (!rules.length) return { ...nothing(), outcome: 'ran_nothing', testsRun: 0, failures: [], verdictLine: `review: ${spec.rubric} holds no rule (- <rule>: <text>)` };
  ```
- verify: a `packages/checks-review` test (it has no `test/` folder yet) or a kit fixture: a rubric of `# Rubric\n\nBe careful.\n`, expect `ran_nothing`. Fails before (reads `passed`).
- risk: a repo whose rubric page is malformed stops getting a (meaningless) pass and gets INVALID "ran nothing" until the page is fixed; that is the point. `tests/acceptance/87/review` uses well-formed rubrics (not re-read case by case).
- also seen: an empty diff (base and head the same tree) also reads `passed` with `testsRun: 1`; a claim with no change is unlikely to reach the review, so no edit is proposed.

### ts-small-a-10  A service check whose floor lacks a number passes without asserting it, and still reports three tests
- kind: broken (invariant 2)
- confidence: LIKELY
- where: `packages/checks-work/runtime/probe.mjs:73, :75, :76`
- evidence:
  ```js
  if (p95 > spec.floor.latency_ms) at('service: latency', …);
  if (rate < spec.floor.throughput_rps) at('service: throughput', …);
  done(3);
  ```
  A comparison with `undefined` is false. `rg "latency_ms|throughput_rps" packages --glob '!packages/checks-work/**'` finds no schema or validation; the spec's shape is a TypeScript type only (`src/types.ts:14`), and specs are drafted as data. The package already closed the same hole for `requests` (`:44`, `test/service.test.ts`: "it ran nothing, never a pass (AGENTS.md invariant 2)").
- failure: a drafted spec with `floor: { latency: 200 }` (a wrong key) or `floor: {}`. The endpoint answers in 30 s; the run is `passed`, `testsRun: 3`.
- fix: `probe.mjs`, after `:44`
  ```js
  + // A floor with no number asserts nothing: the check can't run, never a pass.
  + for (const k of ['latency_ms', 'throughput_rps']) if (!Number.isFinite(spec.floor?.[k])) throw new Error(`the service check's floor names no ${k}`);
  ```
  (a thrown error is the kit's "crash": `failed`, not at the assertion).
- verify: a case beside `packages/checks-work/test/service.test.ts` with `floor: {}` and a listening endpoint, expecting `failed` with a non-assertion failure naming `latency_ms`.
- risk: none for well-formed specs; `tests/acceptance/68` and the kit give both numbers (`src/kit.ts:48, :71, :75`).

### ts-small-a-11  `hunks` reads a removed line that starts with `-- ` as a file header, so later hunks of the file are lost
- kind: broken
- confidence: SURE (evaluated on a copy of `hunks` and `follow`)
- where: `packages/checks-review/src/diff.ts:35-44`; callers `packages/checks-review/src/review.ts:103-104`, `packages/checks-review/src/outcomes.ts:9, :18`
- evidence: `if (raw.startsWith('--- ')) { file = raw.slice(4).replace(/^a\//, ''); continue; }` with no test for being inside a hunk; `newSide` in the same file guards its `+++ ` with `!inHunk` (`:24-28`). In a `-U0` diff a removed SQL, Lua or Haskell comment `-- drop the old index` prints as `--- drop the old index`. Evaluated:
  ```
  hunks(diff) => [{file:"schema.sql",from:10,…},{file:"drop the old index",from:50,…}]
  follow("schema.sql", 50, hunks(diff)) => 49      (the commit rewrote line 50: should be null)
  ```
- failure: a commit removes a `-- …` line above a line a sent-back item cites and fixes the cited line. `itemOutcomes` reports the item `left`, not `fixed`; on a re-review the item stays `open`. Both paths are reached today only from `tests/acceptance/87` (the hub passes `since: null`, `packages/hub/src/kinds.ts:114`, and nothing outside the package calls `itemOutcomes`).
- fix: `diff.ts:35-44`
  ```ts
    let file = '';
  + let inHunk = false;
    for (const raw of diff.split('\n')) {
  -   if (raw.startsWith('--- ')) { file = raw.slice(4).replace(/^a\//, ''); continue; }
  +   if (raw.startsWith('diff --git ')) { inHunk = false; continue; }
  +   if (!inHunk && raw.startsWith('--- ')) { file = raw.slice(4).replace(/^a\//, ''); continue; }
      const h = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(raw);
  -   if (h) out.push({ … });
  +   if (h) { inHunk = true; out.push({ … }); }
  ```
- verify: `tests/acceptance/87/review` stays green (ordinary diffs read the same); a unit case with the diff above expects `follow('schema.sql', 50, …) === null`.
- risk: none; `git diff` always prints `diff --git` before a file's `---`.
- the same shape, lower stakes: `packages/gate/src/open.ts:116` (`addedLines`) and `packages/gate/src/size.ts:134-135` read an added line whose text starts with `++ ` as a `+++ ` header (a placeholder on that line is missed; a duplicated run is cut there).

### ts-small-a-12  A worktree whose remote is the scp-like SSH form never places its own host or repo as `repo`
- kind: broken (a person is asked what the repo already answers; design: `repo` "when the session's worktree configures it as a git remote")
- confidence: LIKELY (the URL reading is evaluated; how often a plan names a `host` or `repo` target was not measured)
- where: `packages/asks/src/targets.ts:35-41` (`url`), `:117-122` (`configured`); the header at `:4` and the doc at `:116`
- evidence: `configured` builds `urls` with `url(u)`, which is `new URL(...)`. Evaluated: `url('git@github.com:owner/repo.git') => undefined`, while `ssh://git@github.com/owner/repo.git` and `https://github.com/Owner/Repo.git` give host `github.com`, path `owner/repo`. So for the form `git clone git@github.com:…` writes, `urls` is empty, and `kind === 'host'` and `kind === 'repo'` return false; only the remote's name (`origin`) still matches. The hub's own reader takes both spellings (`packages/hub/src/paths.ts:29-33`, "the same for its HTTPS and SSH spellings"). `rg "git@" tests/acceptance/1098 packages/asks/test` finds no case.
- failure: a plan step "open a PR on `owner/repo`" in a checkout whose origin is `git@github.com:owner/repo.git`. The target is placed `unknown` ("appears in nothing you typed or approved, nor in anything the agent read"), which no decision covers (`UNCOVERED`, `:30`), so the standing decision for that repo never applies and the card warns about the repo's own remote.
- fix: `targets.ts`, read host and path from either spelling in `configured`:
  ```ts
  + /** A configured remote's host and path: a URL's, or the scp-like `[user@]host:path` git also takes. */
  + function hostPath(remote: string): { host: string; path: string } | undefined {
  +   const u = url(remote);
  +   if (u) return { host: new URL(u).hostname, path: new URL(u).pathname.replace(/^\/+/, '').toLowerCase() };
  +   const scp = /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+?)(?:\.git)?\/*$/.exec(remote);
  +   return scp ? { host: scp[1]!.toLowerCase(), path: scp[2]!.toLowerCase() } : undefined;
  + }
    …
  - if (kind === 'host') return urls.some((u) => new URL(u).hostname === ref);
  - if (kind === 'repo') return urls.some((u) => new URL(u).pathname.replace(/^\/+/, '').toLowerCase() === ref);
  + const places = [...remotes.values()].map(hostPath).filter((p) => p !== undefined);
  + if (kind === 'host') return places.some((p) => p.host === ref);
  + if (kind === 'repo') return places.some((p) => p.path === ref);
  ```
- verify: a case in `packages/asks/test` (or beside `tests/acceptance/1098`'s scenarios, which are never edited): a worktree with `url = git@github.com:octo/shop.git`, a step targeting `{ kind: 'repo', ref: 'octo/shop' }`, expect origin `repo`.
- risk: it widens what counts as the repo's own, by the remote the person configured; a planted wrong program `push-target-as-repo` (`:160`) tests the opposite direction and is not affected.

### ts-small-a-13  `@deepbuild/checks-numbers`' card says it has no `test/` folder; it has one
- kind: inconsistent
- confidence: SURE
- where: `packages/checks-numbers/README.md` ("There is no `test/` folder: its tests are the acceptance suite in `tests/acceptance/87/numbers` (never edited).") against `packages/checks-numbers/test/speed.test.ts` and `test/stated.test.ts` (tracked: `git ls-files packages/checks-numbers`)
- fix: replace that bullet with "Regression tests go in `test/`; the acceptance suite is `tests/acceptance/87/numbers` (never edited)."
- verify: diff review.
- risk: none.

### ts-small-a-14  Linux sandbox: every directory open outside a write grant is refused as a write
- kind: broken
- confidence: SURE (by reading; not run on Linux)
- where: `packages/supervisor/native/helper-linux.c:401` (filter), `:814` (openat2), `:816-817` (the refusal)
- evidence: `:401` `JSET(O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_TMPFILE, 0, 1);`. glibc and musl define `O_TMPFILE` as `__O_TMPFILE | O_DIRECTORY` (`020000000 | 0200000` on x86_64, `020000000 | 040000` on aarch64), so the mask holds the `O_DIRECTORY` bit and the filter sends every `open(..., O_DIRECTORY)` to the parent. For `openat`/`open`, `handle()` (`:804-818`) has no "not a write" exit (only `openat2` has one, `:814`, with the same mask), so it calls `write_allowed(... "file-write-data")`, and `may_write()` (`:258-262`) is false for a path not under a write grant: `log_denial` + `REFUSE(EACCES)`. The comment above the rule says "the parent is asked only when its flags can write or create". Tests: `src/bubblewrap.test.ts` and `tests/acceptance/70/sandbox.test.ts` run only `/bin/sh` builtins, `mv`, and the helper's `probe` (plain `open(O_RDONLY)`), none opens a directory.
- failure: on Linux, a run without `run_as_you` does `opendir` (glibc: `O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY`) on its read-only cwd, a `read` grant, or `/usr/lib/...`: `ls`, `find`, Node `fs.readdir`, Python's import finder. It gets EACCES and the record gains `sandbox.denied {operation: "file-write-data", target: <the directory>}`. A runner job (cwd read-only, programs under a read grant) can't list anything.
- fix: both lines, `O_TMPFILE` → `(O_TMPFILE & ~O_DIRECTORY)`:
  `:401` `JSET(O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | (O_TMPFILE & ~O_DIRECTORY), 0, 1);`
  `:814` `if (!(flags & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | (O_TMPFILE & ~O_DIRECTORY)))) { CONTINUE(v); return; }`
- verify: in the deep-ubuntu VM, add to `src/bubblewrap.test.ts`: `sup.start({ run, argv: ['/bin/ls', '/usr'], cwd, grant: {} })` → exit code 0 and no `sandbox.denied` for `/usr`. Before the fix: exit 2 and one `file-write-data` denial.
- risk: none seen. A real `O_TMPFILE` open must carry `O_WRONLY` or `O_RDWR` (else EINVAL), which the mask still holds. No test pins the refusal.

### ts-small-a-15  Linux sandbox: a TCP connection can be opened with no `connect` call (TCP Fast Open)
- kind: broken
- confidence: LIKELY (kernel behavior from its documentation; not run)
- where: `packages/supervisor/native/helper-linux.c:461-476` (socket rule lets any `AF_INET`/`AF_INET6` `SOCK_STREAM` socket be made), `:490-493` (only `connect` and `bind` are sent to the parent), `:497` (everything else `ALLOW`)
- evidence: the grant's hosts are enforced only in `handle_socket_call` (`:657-704`), reached from `__NR_connect`/`__NR_bind`. `sendto(fd, buf, n, MSG_FASTOPEN, &addr, len)` on an unconnected TCP socket connects and sends in one call (RFC 7413's Linux API; `net.ipv4.tcp_fastopen` defaults to 1, client on; with no cookie it falls back to a normal handshake). `sendto`, `sendmsg` and `sendmmsg` have no rule. Landlock's network rights are not used (`:346` `handled_access_net = 0`), and bwrap shares the machine's network namespace (`bubblewrap.ts:87`, no `--unshare-net`).
- failure: in a run whose grant names no host, `python3 -c "import socket;s=socket.socket();s.sendto(b'GET / HTTP/1.0\r\n\r\n',socket.MSG_FASTOPEN,('93.184.216.34',80));print(s.recv(100))"` reaches the outside. No `sandbox.denied` is written. The seam suite's `egress` case uses `connect`, so it passes.
- fix: refuse the flag in the filter, so callers fall back to `connect` (the kernel's own answer when TFO is off). After `:483` (`LD_NR;` following the socketpair rule) add:
  ```c
  // A send that would open a connection itself (TCP Fast Open): refused, so every connection is a connect the parent checks.
  const int sends[][2] = { { __NR_sendto, 3 }, { __NR_sendmsg, 2 }, { __NR_sendmmsg, 3 } };
  for (size_t i = 0; i < sizeof sends / sizeof *sends; i++) {
    JEQ(sends[i][0], 0, 4);
    LD_ARG(sends[i][1]);
    JSET(MSG_FASTOPEN, 0, 1);
    RET(ERRNO(EOPNOTSUPP));
    RET(SECCOMP_RET_ALLOW);
    LD_NR;
  }
  ```
  Also narrow the socket rule's protocol (`args[2]`) to 0 or `IPPROTO_TCP`: `socket(AF_INET, SOCK_STREAM, IPPROTO_SCTP)` and `IPPROTO_MPTCP` pass today, and an SCTP one-to-one socket also associates from `sendmsg` with an address.
- verify: a new `probe` op in the helper (`tfo <port>`: `sendto` with `MSG_FASTOPEN` to 127.0.0.1) added to `suite.ts`'s `egress` pair against the `stranger` listener: the stranger must see no connection.
- risk: a program that sets `MSG_FASTOPEN` gets EOPNOTSUPP and must fall back; curl and Go do. The filter grows by 18 instructions (`BPF_MAX` is 512; it uses about 140).

### ts-small-a-16  Linux sandbox: three `connect`/`bind` answers let the kernel re-read memory the program can change
- kind: broken
- confidence: LIKELY (seccomp_unotify(2) documents the race; not run)
- where: `packages/supervisor/native/helper-linux.c:701` (`AF_NETLINK` → `CONTINUE`), `:668` (`AF_UNIX` bind → `CONTINUE`), and for metadata `:753`, `:634`, `:711-712` (path not found → `CONTINUE`), `:790-794` (`utimes`/`utime`/`futimesat` → `CONTINUE` after the check)
- evidence: `SECCOMP_USER_NOTIF_FLAG_CONTINUE` makes the kernel run the call again from the program's own memory and descriptor table. The file's own comment at `:656` says why `AF_INET` is not continued: "checked here, and made on the process's own socket, so what was checked is what connects". The netlink and Unix-bind branches check only the address family in the copied bytes, not the socket.
- failure: thread A calls `connect(tcp_fd, p, 16)` with `*p = {AF_NETLINK}`; while the parent answers, thread B writes `{AF_INET, 93.184.216.34:443}` into `*p`. The parent sees netlink and continues; the kernel copies `*p` now and connects out. Same for `bind` with an `AF_UNIX` address swapped to `AF_INET` any port. For metadata: `chmod("d/x")` where `d` is a dangling link at check time and is re-pointed outside the grant before the kernel resolves it (Landlock does not govern chmod, chown, utimes or xattrs).
- fix: netlink is small: make it on the taken socket like `AF_INET`:
  `:701` `if (a.ss_family == AF_NETLINK) { CONTINUE(v); return; }` →
  ```c
  if (a.ss_family == AF_NETLINK) {
    int sock = still_waiting(v) ? take_fd(v->req->pid, (int)v->req->data.args[0]) : -1;
    if (sock < 0) { REFUSE(v, EBADF); return; }
    int rc = is_bind ? bind(sock, (struct sockaddr *)&a, len) : connect(sock, (struct sockaddr *)&a, len);
    RESULT(v, rc);
    close(sock);
    return;
  }
  ```
  The Unix bind and the not-found metadata paths need the owner's call (bind by `/proc/self/fd/<parent>/<name>`, or refuse `ENOENT` here instead of continuing). QUESTION for those.
- verify: a probe op that races the address from a second thread against the stranger listener (a loop of a few thousand tries).
- risk: a netlink bind made by the parent autobinds with the parent's PID as port ID; glibc reads the ID back with `getsockname`, so it holds, but it is a visible change.

### ts-small-a-17  Linux sandbox on x86_64: the filter has no x32 check, so x32 calls skip every rule
- kind: broken
- confidence: LIKELY (depends on the kernel's `CONFIG_X86_X32_ABI`; the two acceptance VMs are aarch64, `tests/acceptance/70/BASE-FAILURE.txt:1`)
- where: `packages/supervisor/native/helper-linux.c:457-460`
- evidence: the filter checks `arch == AUDIT_ARCH_X86_64`, then compares `nr` by equality and ends in `RET(SECCOMP_RET_ALLOW)` (`:497`). x32 calls report the same arch with `nr | 0x40000000`, so none of the `socket`, `connect`, `bind`, `ptrace`, `io_uring_*` rules match them and all are allowed.
- failure: on an x86_64 kernel with x32 on, `syscall(0x40000000 | 41, AF_INET, SOCK_DGRAM, 0)` and `syscall(0x40000000 | 42, fd, &addr, len)` open any socket and connect anywhere.
- fix: after `:460` `LD_NR;` add
  ```c
  #if defined(__x86_64__)
    // The x32 ABI's calls carry this bit under the same arch: none of the rules below would match one.
    emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000u, 0, 1));
    RET(SECCOMP_RET_KILL_PROCESS);
  #endif
  ```
- verify: on the x86 lane (#1983), a probe op that makes `syscall(0x40000000 | __NR_getpid)`: the child must die by SIGSYS.
- risk: none for 64-bit programs. Jump offsets after it are relative and unchanged.

### ts-small-a-18  Egress filter corrupts a credential that holds `$`
- kind: broken
- confidence: SURE
- where: `packages/supervisor/src/egress.ts:187`
- evidence: `headers[at] = headers[at]!.replace(c.standIn, c.value);`. With a string as the replacement, `$$`, `$&`, `` $` `` and `$'` are patterns. Run: `scratchpad/sre/p1.mjs` → `"pa$$word" -> "Bearer pa$word; x"`, `"tok$&en" -> "Bearer tokdeep_standin_abcen; x"`, `"k$'x" -> "Bearer k; xx; x"`. Values come from a dotfile, a CLI or the keychain (`env-local/src/stack.ts:269-299`), with no limit on their characters. `tests/acceptance/1106/*` use values without `$`.
- failure: a credential `pa$$word` with hosts reaches its API as `pa$word`: 401 from the provider, nothing recorded. `$&` puts the stand-in back in; `` $` `` and `$'` copy the rest of the header into the value.
- fix: `headers[at] = headers[at]!.replace(c.standIn, c.value);` → `headers[at] = headers[at]!.replace(c.standIn, () => c.value);`
- verify: `tests/acceptance/1106/standin.test.ts` shape with a value `k$&$$v-12345678`: the sample API must receive it byte for byte. Or `node scratchpad/sre/p1.mjs` (second column is the fixed form).
- risk: none; one occurrence is replaced either way (`seen > 1` is refused at `:184`).

### ts-small-a-19  A cleanup that throws once is never tried again: the run's leases and the runner's job stay stuck
- kind: broken
- confidence: LIKELY (the stuck state is certain from the code; the trigger is any throw inside `cleanupOnce`)
- where: `packages/supervisor/src/supervisor.ts:769-773` (memo), `:775-837` (`cleanupOnce`); callers that retry: `packages/runner/src/runner.ts:1071-1073`, `:941`, `:956`
- evidence: `if (r.cleaning) return r.cleaning; const cleaning = (r.cleaning = this.cleanupOnce(r));` and nothing ever clears `r.cleaning`. `cleanupOnce` can reject: `provable()` and `leftovers()` call `table()`, whose `run('/bin/ps')` rejects on any error but exit 1 (`procs.ts:13-21`: spawn EAGAIN, a signal); `append` on a record error; `step()` when `confine` throws; `leases.release`. The runner is written to retry: `tick()` calls `supervisor.cleanup(job).catch(() => undefined)` each second for a job that is `stopping` and `unconfirmed`.
- failure: `ps` fails once (fork EAGAIN on a loaded machine) during a run's cleanup. Every later `cleanup(run)` returns the same rejected promise. The run's ports and compose project stay leased, its processes may still run, and the runner's job reads `stopping` until the hub restarts.
- fix: two edits.
  `:770` `const cleaning = (r.cleaning = this.cleanupOnce(r));` → `const cleaning: Promise<Cleanup> = (r.cleaning = this.cleanupOnce(r).catch((error: unknown) => { delete r.cleaning; throw error; }));`
  and so a second pass gives nothing back twice, after `:822` `this.keys.set(name, {});` add `r.leases = r.leases.filter((l) => l !== lease);` (the `for…of` at `:814` keeps iterating the old array).
- verify: a supervisor test with a record whose `append` rejects once on `run.cleaned`: the second `cleanup(run)` must resolve `clean`. Today it rejects again.
- risk: without the second edit a retry after a partial release would free, or with a lease table release, a key another run has since taken. `r.leases` has no reader after cleanup (grep: `:198,230,573,797,806,814`). No test pins the memoized rejection.

### ts-small-a-20  Linux sandbox has no rule for the agents' hook and MCP files; three comments say the sandbox refuses them
- kind: inconsistent (broken on Linux)
- confidence: LIKELY (I can't see whether one of #70's moved parts, #1691 or #1712–#1716, already tracks it)
- where: `packages/supervisor/src/seatbelt.ts:86-88` (the rule), `packages/supervisor/native/helper-linux.c:258-262` (`may_write`, no counterpart), `packages/supervisor/src/bubblewrap.ts:74` (a guard not there yet is skipped); comments that rely on it: `packages/hub/src/core.ts:1064-1066`, `packages/runner/src/runner.ts:605-606`, `packages/runner/src/agents.ts:151-152`
- evidence: Seatbelt ends every profile with `(deny file-write* (regex #"/\.claude(/|$)") (regex #"/\.mcp\.json$") (regex #"/\.claude\.json$") (regex #"/\.codex(/|$)"))`, "Last, so no grant reaches them … wherever they are". `grep -n "claude\|codex\|mcp" helper-linux.c bubblewrap.ts` finds nothing. The hub's guards (`core.ts:1067-1073`) name `~/.claude` and `~/.codex` only, and bubblewrap skips a guard whose path does not exist (`if (!existsSync(g.path)) continue;`).
- failure: on Linux a run with a write grant on its checkout, or `run_as_you`, writes `<checkout>/.claude/settings.json`, `<checkout>/.mcp.json`, `~/.claude.json`, or creates `~/.codex/` when it is not there yet. On macOS each is refused. Invariant 3's second layer is missing on one platform.
- fix: in `helper-linux.c` before `may_write`:
  ```c
  /** The files agents read their hooks and MCP servers from, wherever they are: no grant reaches them (seatbelt.ts's last rule). */
  static int agent_file(const char *path) {
    for (const char *c = path; (c = strchr(c, '/'));) {
      size_t n = strcspn(++c, "/");
      if ((n == 7 && !strncmp(c, ".claude", 7)) || (n == 6 && !strncmp(c, ".codex", 6))) return 1;
      if (!c[n] && ((n == 9 && !strncmp(c, ".mcp.json", 9)) || (n == 12 && !strncmp(c, ".claude.json", 12)))) return 1;
    }
    return 0;
  }
  ```
  and `:260` `if (guarded(s, path)) return 0;` → `if (guarded(s, path) || agent_file(path)) return 0;`
- verify: `src/bubblewrap.test.ts`, a run with `grant: { write: [dir] }` doing `mkdir -p .claude && echo x > .claude/settings.json; echo x > .mcp.json`: neither file exists after, and both are in `sandbox.denied`.
- risk: this is refused in the parent, ahead of Landlock, so it shares ts-small-a-16's race for a program that tries; it stops the plain case. A Codex job's own home is already named `codex-home` for this reason (`agents.ts:155`).

### ts-small-a-21  A warm run whose app never answers leaves the app's run uncleaned
- kind: broken
- confidence: SURE
- where: `packages/env-local/src/warm.ts:594-598`; caller `packages/hub/src/stacks.ts:190-191`, `:157-162`, `:321-330`
- evidence: `if (app) await downStack(this.o.host, app); return { cause: … };`. `downStack` only signals and waits. The hub then runs `tear(w)` → `takeDown(w.stack.id)`: the stack's shell, not `app` (a second run, `app = newRun()`, `:582`), and the failed `serve` returns no handle to it. On success the hub does clean it (`stacks.ts:226`: `environment.down(serving.app!)` then `supervisor().cleanup(serving.app!)`). In the supervisor, only `cleanupOnce` closes `r.egress` (`supervisor.ts:826`), appends `run.cleaned` and lets the run be forgotten (`:843-849`).
- failure: a check's app (`environment.up`) with a stand-in credential fails its health route. The app's run stays in `runs` for the hub's life with its egress filter listening and its `deep-egress-*` folder on disk, and the record has `process.starting` with no `run.cleaned` until the next hub start reaps it. Each failed warm start adds one. The same holds if `containers()` (`:603`) throws after the app is up: the app is then not even signalled.
- fix: `:12` `import type { Grant, Host } from '@deepbuild/supervisor';` → `import type { Grant, Host, Supervisor } from '@deepbuild/supervisor';` and
  `:596` `if (app) await downStack(this.o.host, app);` → `if (app) { await downStack(this.o.host, app); await (this.o.host as Partial<Supervisor>).cleanup?.(app)?.catch(() => undefined); }` (the form `stack.ts:252` and `:801` use).
- verify: `tests/acceptance/580` world with an `up` that never listens and `ready.within: 1`: after `serve` returns its cause, the record must hold `run.cleaned` for the app's `process.starting`. Today it does not.
- risk: none seen; `cleanup` of a run already down is what `takeDown` does everywhere else.

### ts-small-a-22  The runner's quiet watch resets its own baseline, so it does not stop a silent, idle job
- kind: broken (latent: no production caller sets `output_timeout_ms`)
- confidence: LIKELY (arithmetic and a virtual-clock model; not run against a real job)
- where: `packages/runner/src/runner.ts:904-919`; doc `packages/runner/src/types.ts:49-50`
- evidence: each tick: `if (Date.now() - job.outputAt < ms) { last = undefined; return; }`, else ask `groupCpu`, and in its answer `last = now; job.outputAt = Date.now() - ms + Math.min(ms, 1000);`. The answer comes `d` ms after the tick (one `ps` run). At the next tick, `p = min(ms, 1000)` later, `Date.now() - outputAt = ms + jitter − d`, which is `< ms` whenever `ps` takes longer than the timer is late, so `last` is cleared before it is ever compared. `scratchpad/sre/p2.mjs` models it: `{ms:2000,d:30,j:1}` never stops; only `{d:5,j:40}` (an event loop 40 ms late) does. The one test, `tests/acceptance/159/lifecycle.test.ts:43-51`, checks only that a busy job is not stopped, which a watch that never fires passes. Callers of `output_timeout_ms`: none in `packages/` outside the runner (grep), only acceptance 159 and 822.
- failure: `submit({ …, output_timeout_ms: 2000 })` on an agent that hangs with no output and no CPU: it is never stopped `timed_out` unless the hub's loop lags.
- fix: QUESTION on the shape. Deleting `job.outputAt = Date.now() - ms + Math.min(ms, 1000);` makes two equal samples one tick apart stop it, but then "no CPU" means about one second, not "for the whole timeout" as the comment at `:903` and `types.ts:49` say, and Linux `ps cputime` has one-second steps. To match the doc, keep when the reading last changed and stop once it has not changed for `ms`:
  ```ts
  let last: { cpu: string; at: number } | undefined;
  …
  void groupCpu(job.rec.pgid!).then((now) => {
    if (now === null) { last = undefined; return; }
    if (last?.cpu !== now) { last = { cpu: now, at: Date.now() }; return; }
    if (Date.now() - last.at >= ms) { clearInterval(t); void this.stop(job, 'timed_out'); }
  });
  ```
- verify: a runner test with a fake agent that sleeps silently and `output_timeout_ms: 2000`: it must end `stopped` with cause `timed_out`. Today it runs to its deadline.
- risk: acceptance 159's busy case must still pass; with the second form a busy job's reading changes every tick.

### ts-small-a-23  On Linux the runner's git steps are granted read of `/`
- kind: broken
- confidence: LIKELY (the path arithmetic is certain; what git could be made to read is the open part)
- where: `packages/runner/src/runner.ts:613`, `:1137-1147`
- evidence: `const read = [repo, ...gitDirs(repo), dirname(dirname(dirname(git)))];`. On macOS `git` is `<developer dir>/usr/bin/git`, so the third `dirname` is the developer folder. Off macOS `gitBinary()` returns `'/usr/bin/git'`, and `dirname(dirname(dirname('/usr/bin/git')))` is `'/'` (checked with `node -e`). `bubblewrap.ts:64` turns it into `--read /`, and `helper-linux.c:355` adds a Landlock read rule on `/`.
- failure: on Linux every step of a job's checkout (`git init`, `fetch`, `ls-tree`, `cat-file`, `read-tree`) runs able to read every file you can, against the header's "granted only what it reads" (`:5-6`) and the comment at `:603-606`.
- fix: `:613` → `const read = [repo, ...gitDirs(repo), ...(process.platform === 'darwin' ? [dirname(dirname(dirname(git)))] : [])];` (`/usr` is readable in every Linux sandbox, `helper-linux.c:325`).
- verify: `tests/acceptance/159` checkout cases in the Linux VM still pass; a unit check that the grant handed to `supervisor.start` holds no `/`.
- risk: a Linux git outside `/usr`, `/opt`, `/snap` is not handled either way: `gitBinary()` never returns one.

### ts-small-a-24  One failed `docker context inspect` blocks every compose stack until the hub restarts
- kind: broken
- confidence: LIKELY
- where: `packages/env-local/src/stack.ts:406`, `:414-429`
- evidence: `daemons.set(docker, found)` runs for the `catch` branch too (`found = { why: 'docker context inspect failed, …' }`), and `:415` returns the cached value for ever. The call is `execFileSync(…, { timeout: 10_000 })`.
- failure: the first compose stack is asked for while Docker Desktop is starting or the machine is loaded; the CLI takes over 10 s once. Every later `upStack`, `WarmStack.open` and compose lease answers "docker context inspect failed … so no compose stack can run" for the hub's life.
- fix: QUESTION on the shape. Not caching the failure at all would run a blocking 10 s call on the hub's thread for each `dockerEnv()` while Docker is down. Keep a failure for a short time:
  `:406` `const daemons = new Map<string, Daemon>();` → `const daemons = new Map<string, { found: Daemon; until: number }>();`
  `:415` → `const kept = daemons.get(docker); if (kept && Date.now() < kept.until) return kept.found;`
  `:427` → `daemons.set(docker, { found, until: failed ? Date.now() + 30_000 : Infinity });` with `failed` set in the `catch`.
- verify: `packages/env-local/src/index.test.ts` with a fake `docker` that fails its first `context inspect` and answers the second, and a clock moved 30 s: the second `upStack` must not be BLOCKED on it.
- risk: `index.test.ts:118` (a TCP context is BLOCKED) and `:127` (a daemon that stops answering fails at once) pin nearby behavior; a TCP context is a real answer and stays cached.

### ts-small-a-25  A warm stack that fails to open leaves its two folders
- kind: broken
- confidence: SURE
- where: `packages/env-local/src/warm.ts:173-177` (made), `:199-215` (`open`), `packages/env-local/src/stack.ts:773-780` (removed only through `composed`)
- evidence: the constructor makes `<compose.dir>/warm/stack-XXXX` and `$TMPDIR/deep-warm-XXXX`. They are removed only by `downStack`, which reads them from `composed`, and `composed.set(this.id, …)` is the last line of `open`, after its three early returns (`:202`, `:204`, `:208`) and after `readEnvironment` may throw. The hub makes a new `WarmStack` per try and tears the failed one down by `takeDown(stack.id)` (`hub/src/stacks.ts:180-185`).
- failure: a repo whose environment names `compose` on a hub with no Docker CLI: each check run that wants the app leaves two empty folders, without bound.
- fix: move `composed.set(this.id, { work: this.data, judged: this.dir });` from `:213` to the end of the constructor (after `:176`), with its comment.
- verify: `index.test.ts`: `new WarmStack(…)`, `open` on a compose environment with `docker: undefined`, `downStack(host, stack.id)`: both folders are gone.
- risk: `downStack` gives a run with folders a 30 s grace (`stack.ts:774`), but an unknown or BLOCKED run's `wait` rejects, which reads as ended at once.

### ts-small-a-26  env-local's card and header say it never spawns a process; it runs `lsof` and `docker` itself
- kind: inconsistent
- confidence: SURE
- where: `packages/env-local/README.md:10`, `packages/env-local/src/stack.ts:3-4`; against `stack.ts:150` (`execFile(LSOF…)`), `:419` (`execFileSync(docker, ['context','inspect'…])`), `:446` and `:474`, `:706` (`docker ps`, `volume ls`, `version`)
- evidence: README: "Every process start, signal and wait goes through host@1; never spawn, signal or wait for one here." Header: "It never spawns, signals or waits for a process itself". The five calls above run outside the supervisor, as the hub, with no sandbox and no record.
- failure: a reader trusting the card adds nothing to the list of code that starts processes outside host@1 (the modularity audit's finding 2 names checks-numbers, checks-work and proof, not this).
- fix: README `:10` → "Every process of a stack starts, is signalled and is waited for through host@1. The hub's own short reads of the machine run directly: `lsof` for a port, and `docker context inspect`, `version`, `ps` and `volume ls`. `docker compose up` and `down` go through the host." Same wording in the header at `stack.ts:3-4`.
- verify: diff review.
- risk: none (docs).

### ts-small-a-27  Linux sandbox: four smaller gaps beside the grant's words
- kind: broken
- confidence: QUESTION (each by reading; the owner may hold some as known limits of #70)
- where and what:
  1. `helper-linux.c:490` has no `listen` rule: `listen()` on an unbound TCP socket autobinds an ephemeral port on every address, so a run can take connections from the LAN on a port its grant never named (`types.ts:16-17` says listen is by port). Seatbelt denies `network-inbound`.
  2. `helper-linux.c:347` scopes signals only on Landlock ABI 6; the floor is ABI 4 (`bubblewrap.ts:15`, `:107`). With no PID namespace (`bubblewrap.ts:83-84`) and the same uid, a run on Linux 6.7–6.11 can `kill` the hub or another run's process. Seatbelt allows `signal` to `same-sandbox` only (`seatbelt.ts:61`).
  3. `helper-linux.c:325` `SYSTEM_READ` holds `/var` and `/opt`: `/var/tmp` and, on ostree systems where `/home` links to `/var/home`, your whole home are readable by every run. The comment says "Programs and files the system ships". Seatbelt's list is programs only (`seatbelt.ts:10`).
  4. `helper-linux.c:490-492` lists `setxattr`/`removexattr` forms but not `setxattrat`/`removexattrat` (Linux 6.13), which Landlock does not govern.
- fix: 1: add `__NR_listen` to `notified` and answer it by `getsockname` on the taken socket (Unix, or a granted port). 2: raise `LANDLOCK_ABI` to 6 or send `kill`/`tgkill`/`pidfd_send_signal` to the parent. 3: drop `/var` and `/opt` from `SYSTEM_READ` or name the subfolders needed. 4: add both numbers (463, 466) to `notified` and refuse them. Each needs a suite case.
- verify: new `probe` ops per case in `suite.ts`.
- risk: 3 can break a program that reads `/var/lib/…`; 2 raises the kernel floor to 6.12.

---

## Nits (one line each)

### record, gate, checks-*, asks

- `packages/gate/src/mask.ts:12` first pattern names `|| exit 1` a mask, though it keeps the failure; the design lists `|| exit 0`. A locked command written that way is uncounted for no reason. QUESTION.
- `packages/gate/src/floor.ts:165` reads the cited file twice in one expression (`readFileSync(path!)` ×2); read it once.
- `packages/gate/src/exec.ts:61-68` `checkoutOf` leaves its `deep-checkout-*` folder when `read-tree` or `checkout-index` throws (reached only from `executeClaim`, which has no production caller: #1900).
- `packages/gate/src/checkouts.ts:436-439`: a stand-in started by `o.host.start` is pushed to `built` only after `started.leases.find(...)!.key` is read; a start with no `port` lease throws there and the run is never cleaned up.
- `packages/gate/src/checkouts.ts:256-257, :301` `refOf` lists every snapshot ref for each new snapshot; `for-each-ref 'refs/deep/snapshots/*/<commit>'` asks git for the one. Small (30 days of refs).
- `packages/checks-command/src/controls.ts:65-82` with `src/index.ts:302, :459`: when `plantControls` throws partway (an unreadable test file), the controls already written stay in the checkout, since `controls` is still `[]` in the `finally`. Later runs read a stale control as a control (`isControl` goes by the shared prefix), so no result changes.
- `packages/checks-command/runtime/preload.mjs:23-24`: `!(major() < 5)` is true when Vitest's version can't be read (`NaN`), so `--no-fsModuleCache` is pushed to a Vitest that may refuse it. The run then fails, never passes.
- `packages/checks-command/src/shell.ts:155-165` `packageScriptOf` reads the checkout root's `package.json` whatever folder the segment runs in (`cd packages/x && npm test`). The mask is still caught when npm starts the script's shell (`hiddenChild`, `:265-266`); only the earlier, cheaper refusal is missed.
- `packages/checks-numbers/src/speed.ts:17` runs `git rev-parse` with the hub's whole environment; the gate's rule (#31, `packages/gate/src/env.ts`) is that a check's git never inherits `GIT_DIR` and its kin.
- `packages/checks-journey/src/latency.ts:21-22`: a timing that is `NaN` gives a `NaN` median, `slower` false, and `passed`. The one caller pushes measured numbers (`src/index.ts:685`), so it can't happen today.
- `packages/checks-journey/src/png.ts:39-45`: a PNG whose pixel data is cut short decodes to zeros with no error (`raw[...]` is `undefined`); `inflateSync` usually throws first.
- `packages/record/src/trust.ts:51-53`: `ulid(now())`, `ts: now()` and the ask's `ulid(now())` call the clock three times, so an event's ID time and its `ts` can differ by a millisecond; every other appender reads the clock once.
- `packages/record/src/learned.ts:460-467` and `packages/asks/src/index.ts:458-461`: a doc comment stranded above the wrong declaration (the transcript cache's above `Placing`; "The trusted path" above `letters`, two lines from `TRUSTED`).
- `packages/record/src/learned.ts:720-728` `runsOf` splits at `&&`, `||`, `;` and `|` only: a step spec's `run: a & rm -rf x` or a quoted `;` is read differently from deep-hook. The guard itself still fires at the call, so this only decides whether the spec is loaded or held. QUESTION (deep-hook's matcher is another area's).
- `packages/asks/sources.json`: rows `production.write` and `service.beyond_localhost` have no raiser, literal or built (`effect.${…}`, `action.${…}`), anywhere in `packages`, `scripts`, `adapters`, `crates` or `tests`. If they are places the design reserves, they stay; otherwise two dead rows. QUESTION.
- `packages/asks/src/index.ts:305-315` `DRAFTED.fold: 5` and `:440` `FOLD_AT = 5` state the same number twice.

### supervisor, runner, env-local

- `supervisor/src/supervisor.ts:616-617`: `sha256File` rejects if a kept run's output file is gone; the `.then` has no catch, so it is an unhandled rejection and `wait()` never settles (Linux service runs only).
- `supervisor/src/supervisor.ts:960-966`: `close()` leaves a held `start()` pending for ever and does not wait for `launching`.
- `supervisor/src/supervisor.ts:307-334`, `:572`: if `/usr/bin/log stream` exits, denials go unrecorded from then on and nothing says so (the warning prints only at the first warm-up).
- `supervisor/src/supervisor.ts:597-599`: a second `openSync` that throws, or a throwing `spawn`, leaks the first descriptor.
- `supervisor/src/types.ts:25`: "(Seatbelt now; bubblewrap #70 and AppContainer later)" is stale; bubblewrap shipped (`index.ts:3-4`).
- `supervisor/README.md:19`: Deviations describe `helper.c` and `helper-linux.c` but not `native/pty.c`, the hosted terminal's host both include (#104, #989).
- `supervisor/tsconfig.json`, `env-local/tsconfig.json`: `"include": ["src/**/*.ts"]` compiles `src/*.test.ts` (five and one files) into `dist/`. Fix: add `"exclude": ["src/**/*.test.ts"]`. LIKELY; nothing imports the built tests (vitest globs `.ts`).
- `supervisor/native/helper-linux.c:872`: `poll(…, 200)` with SIGCHLD at its default: on kernels 6.7–6.10, where a seccomp filter is released only when its task is reaped, the program's end is seen up to 200 ms late. A no-op `SIGCHLD` handler makes `poll` return at once.
- `supervisor/native/helper-linux.c:280`: more than 64 `--connect`/`--listen` ports are dropped without a word; too many paths exit 126 (`:202`).
- `supervisor/native/pty.c:103-110`: `row_text` builds a C string, so an overlong NUL (`C0 80`) in the output cuts that row in the checkpoint.
- `supervisor/src/egress.ts:193-200`: the upstream request has no timeout and is not in `open`, so `close()` leaves it; `:41-46` `der` lengths stop at 65,535 bytes (a larger SAN list makes a bad certificate, refused by the client); `:144-146` with `:231`: a failed `listen` leaves the `deep-egress-*` folder.
- `supervisor/src/bubblewrap.ts:111`: `DEEP_CONFINE` carries the helper flags and the whole argv in one environment string; Linux caps one string at 128 KiB, so a launch whose arguments total more fails E2BIG where each alone would pass.
- `runner/src/runner.ts:139-140`: two doc comments on `forwarders`; "Opened with the first job that launches." is left over.
- `runner/src/types.ts:143-146`: `planWindows`' doc comment sits above `atReserve`'s.
- `runner/src/runner.ts:283-288`: if the `job.recorded` append rejects, the job stays in `jobs` as `waiting`, and a later pump can start it unrecorded.
- `runner/src/runner.ts:630-631`: `entry.split('\t')` destructured to two parts cuts a tree path at its first tab.
- `runner/src/runner.ts:673-685`: `step` has no deadline; a `--version` or git step that hangs holds the pump chain, and with it every waiting job.
- `env-local/src/stack.ts:78`, `:89`: port names skip the `variable()` rule, so a plain `up` stack may name a port `PATH` or `DEEP_RUN_TOKEN` (a compose stack is refused at `:701-702`); a name listed twice leases two ports and uses one.
- `env-local/src/stack.ts:709-728`: the compose run's two temp folders are removed on BLOCKED, but not when `host.start` throws.
- `env-local/src/stack.ts:509-516`, `:581`: top-level `configs` and `secrets` are judged, yet `configs` and `secrets` are not in `SERVICE_KEYS`, so no service may use one.
- `env-local/src/stack.ts:256-264`: a dotfile value keeps an inline `# comment`.
- `env-local/src/warm.ts:526` against `stack.ts:212`, `:340`: `SeedRecord.template` is the template file's SHA-256 in a cold stack and the seed step's key in a warm one; the type's comment says digest.
- `env-local/src/index.ts:2-3`: the type exports `SeedRecord`, `RunFacts`, `WarmProducts`, `WarmStep` have no importer (grep `@deepbuild/env-local` imports over `packages tests scripts benchmarks docs adapters packs`; the hub takes `RunFacts` from `@deepbuild/gate`).
- `env-local/src/stack.ts:756-760` (QUESTION): with no leased port, `ready` returns on the first 200 and never looks at whether its own command has already ended, so another program on the fixed port reads as this stack ready.
- `env-local/src/stack.ts:509-515` (QUESTION, design): a compose service has the daemon's default network, so it can reach outside hosts, while an `up` stack's sandbox can reach only its leased ports.

Outside this area, one line: `packages/hub/src/core.ts:7534-7549` (`builtOutside`) starts `/bin/sh -c <build>` with `own_sandbox: true`, waits with no deadline and never calls `cleanup` for the run.

---

## Coverage

### record, gate, checks-*, asks

| Package | Read in full | Skimmed (enough to know what it does or pins) | Not read, and why |
|---|---|---|---|
| record | `src/index.ts`, `learned.ts`, `projections.ts`, `lifecycle.ts`, `replay.ts`, `storage.ts`, `trust.ts`, `ids.js`, `ids.d.ts`, README, package.json, tsconfig | `test/record.test.ts` (test names only), `test/learned.test.ts`, `lifecycle.test.ts`, `replay-hash.test.ts` (names) | `projections.ts` `turn()` (`:667-715`) was read but not traced case by case |
| gate | every `src/*.ts` but `scheduler.ts`; README, package.json | `src/scheduler.ts` (header, types, `outcome`, `verdictOf`, `line`; about 120 of 771 lines), `test/*.ts` (names) | the rest of `scheduler.ts`: a model with no production caller (#1900), and time |
| checks-command | `src/*.ts`, `runtime/*.mjs`, `runtime/python/*.py`, README, package.json | `test/regressions.test.ts` (names, and the cases cited above) | - |
| checks-work | `src/*.ts`, `runtime/probe.mjs`, README, `test/*.ts` | - | - |
| checks-numbers | `src/index.ts`, `run.ts`, `speed.ts`, `types.ts`, `runtime/probe.mjs`, README | `src/kit.ts` (first 60 lines: rules and fixtures) | `test/*.ts` (their names and what they pin are in commit c37d51d8's message); the rest of `kit.ts` (the judge, a twin of checks-work's) |
| checks-review | `src/index.ts`, `review.ts`, `diff.ts`, `models.ts`, `outcomes.ts`, `post-close.ts`, `replay.ts`, `types.ts`, README | `src/kit.ts` (grep for the rubric and case shape) | `replay/*.json` (22 recorded cases; data read by `replayReview`, used by `scripts/proof-suites.mjs` and `tests/acceptance/87/gate/replay-lane.test.ts`) |
| checks-journey | `src/compare.ts`, `latency.ts`, `motion.ts`, `png.ts`, `features.ts`, `reading.ts`, `api.ts` (head), README | `src/index.ts` (`:150-378`, `:380-484`, `:672-739`), `src/run.ts` (`:96-163`), `runtime/driver.mjs` (`:8-20`, `:496-546`), `src/replay.ts` (head and `saveScript`), `test/*.ts` (names) | `src/journey.ts`, `src/screens.ts`, the rest of `index.ts`, `run.ts` and `driver.mjs`: time. Its dead code is already #1907 |
| asks | `src/targets.ts`, README, package.json | `src/index.ts` `:300-480` (settings, constants), `:640-1012` (raise, answer, later, undo, inbox), `:2078-2165` (settle, moveAway); `sources.json` (every row's source checked for a raiser) | the rest of `src/index.ts` (about 1,800 of 2,544 lines: show and batch timing, resolvers and decisions, the record fold, stops and blocks) and `test/*.ts`: time. This is the largest gap in the area |

The dependency lists of all eleven packages were compared with every import in `src`, `runtime` and tests: none is unused and none is missing (`vitest` and `fast-check` come from the root).

### supervisor, runner, env-local (the fork)

| | Files |
|---|---|
| Read in full | `packages/supervisor`: `README.md`, `package.json`, `tsconfig.json`, `build-helper.mjs`, `native/helper.c`, `native/helper-linux.c`, `native/pty.c`, `src/index.ts`, `timer.ts`, `types.ts`, `supervisor.ts`, `procs.ts`, `seatbelt.ts`, `bubblewrap.ts`, `egress.ts`, `suite.ts`, `bubblewrap.test.ts`, `seatbelt.test.ts`, `node-runtime.test.ts`, `supervisor.test.ts`. `packages/runner`: `README.md`, `package.json`, `tsconfig.json`, `src/index.ts`, `runner.ts`, `agents.ts`, `egress.ts`, `types.ts`. `packages/env-local`: `README.md`, `package.json`, `tsconfig.json`, `src/index.ts`, `stack.ts`, `warm.ts`. |
| Skimmed (test names, imports, what they pin) | `packages/supervisor/src/leases.test.ts` (first 40 of 104 lines), `packages/runner/test/runner.test.ts`, `codex-versions.test.ts`, `pi-cost.test.ts`, `packages/env-local/src/index.test.ts`. |
| Read outside the area to refute | `packages/hub/src/stacks.ts` (warm and cold paths, `takeDown`, `tear`), `packages/hub/src/core.ts:1060-1075`, `:7525-7550`, `packages/hub/src/starts.ts:268-290`, `tests/acceptance/70` (`sandbox.test.ts` head, `BASE-FAILURE.txt` head, README greps), `tests/acceptance/159/lifecycle.test.ts:25-55`. |
| Not read | Nothing tracked in the three packages. Not checked: agent CLI flags in `agents.ts` against `adapters/*.facts.json` (another area's files); the acceptance suites under `tests/acceptance/236`, `331`, `580`, `1106` beyond greps. |


---

## Appendix: the sub-reader's raw part (supervisor, runner, env-local)

# ts-small-a, part S: supervisor, runner, env-local

Checkout `the checkout` (origin/main 06fd33cd). Read-only; nothing built or run but two pure `node` snippets (`scratchpad/sre/p1.mjs`, `p2.mjs`). No Linux here, so every Linux finding is by reading the C and the kernel's documented behavior; none was run. Paths are relative to the checkout. Ranked worst first.

Skipped as already reported: hill-climb 03 F2, F3, F5–F9; deep audit's `Job.since`, runner re-exports, stream parsers, cold/warm repeats, `lsof` duplicate, seatbelt strings in supervisor.ts, config-eval backend pick, `alive` on EPERM.

---

### ts-small-a-S1  Linux sandbox: every directory open outside a write grant is refused as a write
- kind: broken
- confidence: SURE (by reading; not run on Linux)
- where: `packages/supervisor/native/helper-linux.c:401` (filter), `:814` (openat2), `:816-817` (the refusal)
- evidence: `:401` `JSET(O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_TMPFILE, 0, 1);`. glibc and musl define `O_TMPFILE` as `__O_TMPFILE | O_DIRECTORY` (`020000000 | 0200000` on x86_64, `020000000 | 040000` on aarch64), so the mask holds the `O_DIRECTORY` bit and the filter sends every `open(..., O_DIRECTORY)` to the parent. For `openat`/`open`, `handle()` (`:804-818`) has no "not a write" exit (only `openat2` has one, `:814`, with the same mask), so it calls `write_allowed(... "file-write-data")`, and `may_write()` (`:258-262`) is false for a path not under a write grant: `log_denial` + `REFUSE(EACCES)`. The comment above the rule says "the parent is asked only when its flags can write or create". Tests: `src/bubblewrap.test.ts` and `tests/acceptance/70/sandbox.test.ts` run only `/bin/sh` builtins, `mv`, and the helper's `probe` (plain `open(O_RDONLY)`), none opens a directory.
- failure: on Linux, a run without `run_as_you` does `opendir` (glibc: `O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY`) on its read-only cwd, a `read` grant, or `/usr/lib/...`: `ls`, `find`, Node `fs.readdir`, Python's import finder. It gets EACCES and the record gains `sandbox.denied {operation: "file-write-data", target: <the directory>}`. A runner job (cwd read-only, programs under a read grant) can't list anything.
- fix: both lines, `O_TMPFILE` → `(O_TMPFILE & ~O_DIRECTORY)`:
  `:401` `JSET(O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | (O_TMPFILE & ~O_DIRECTORY), 0, 1);`
  `:814` `if (!(flags & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | (O_TMPFILE & ~O_DIRECTORY)))) { CONTINUE(v); return; }`
- verify: in the deep-ubuntu VM, add to `src/bubblewrap.test.ts`: `sup.start({ run, argv: ['/bin/ls', '/usr'], cwd, grant: {} })` → exit code 0 and no `sandbox.denied` for `/usr`. Before the fix: exit 2 and one `file-write-data` denial.
- risk: none seen. A real `O_TMPFILE` open must carry `O_WRONLY` or `O_RDWR` (else EINVAL), which the mask still holds. No test pins the refusal.

### ts-small-a-S2  Linux sandbox: a TCP connection can be opened with no `connect` call (TCP Fast Open)
- kind: broken
- confidence: LIKELY (kernel behavior from its documentation; not run)
- where: `packages/supervisor/native/helper-linux.c:461-476` (socket rule lets any `AF_INET`/`AF_INET6` `SOCK_STREAM` socket be made), `:490-493` (only `connect` and `bind` are sent to the parent), `:497` (everything else `ALLOW`)
- evidence: the grant's hosts are enforced only in `handle_socket_call` (`:657-704`), reached from `__NR_connect`/`__NR_bind`. `sendto(fd, buf, n, MSG_FASTOPEN, &addr, len)` on an unconnected TCP socket connects and sends in one call (RFC 7413's Linux API; `net.ipv4.tcp_fastopen` defaults to 1, client on; with no cookie it falls back to a normal handshake). `sendto`, `sendmsg` and `sendmmsg` have no rule. Landlock's network rights are not used (`:346` `handled_access_net = 0`), and bwrap shares the machine's network namespace (`bubblewrap.ts:87`, no `--unshare-net`).
- failure: in a run whose grant names no host, `python3 -c "import socket;s=socket.socket();s.sendto(b'GET / HTTP/1.0\r\n\r\n',socket.MSG_FASTOPEN,('93.184.216.34',80));print(s.recv(100))"` reaches the outside. No `sandbox.denied` is written. The seam suite's `egress` case uses `connect`, so it passes.
- fix: refuse the flag in the filter, so callers fall back to `connect` (the kernel's own answer when TFO is off). After `:483` (`LD_NR;` following the socketpair rule) add:
  ```c
  // A send that would open a connection itself (TCP Fast Open): refused, so every connection is a connect the parent checks.
  const int sends[][2] = { { __NR_sendto, 3 }, { __NR_sendmsg, 2 }, { __NR_sendmmsg, 3 } };
  for (size_t i = 0; i < sizeof sends / sizeof *sends; i++) {
    JEQ(sends[i][0], 0, 4);
    LD_ARG(sends[i][1]);
    JSET(MSG_FASTOPEN, 0, 1);
    RET(ERRNO(EOPNOTSUPP));
    RET(SECCOMP_RET_ALLOW);
    LD_NR;
  }
  ```
  Also narrow the socket rule's protocol (`args[2]`) to 0 or `IPPROTO_TCP`: `socket(AF_INET, SOCK_STREAM, IPPROTO_SCTP)` and `IPPROTO_MPTCP` pass today, and an SCTP one-to-one socket also associates from `sendmsg` with an address.
- verify: a new `probe` op in the helper (`tfo <port>`: `sendto` with `MSG_FASTOPEN` to 127.0.0.1) added to `suite.ts`'s `egress` pair against the `stranger` listener: the stranger must see no connection.
- risk: a program that sets `MSG_FASTOPEN` gets EOPNOTSUPP and must fall back; curl and Go do. The filter grows by 18 instructions (`BPF_MAX` is 512; it uses about 140).

### ts-small-a-S3  Linux sandbox: three `connect`/`bind` answers let the kernel re-read memory the program can change
- kind: broken
- confidence: LIKELY (seccomp_unotify(2) documents the race; not run)
- where: `packages/supervisor/native/helper-linux.c:701` (`AF_NETLINK` → `CONTINUE`), `:668` (`AF_UNIX` bind → `CONTINUE`), and for metadata `:753`, `:634`, `:711-712` (path not found → `CONTINUE`), `:790-794` (`utimes`/`utime`/`futimesat` → `CONTINUE` after the check)
- evidence: `SECCOMP_USER_NOTIF_FLAG_CONTINUE` makes the kernel run the call again from the program's own memory and descriptor table. The file's own comment at `:656` says why `AF_INET` is not continued: "checked here, and made on the process's own socket, so what was checked is what connects". The netlink and Unix-bind branches check only the address family in the copied bytes, not the socket.
- failure: thread A calls `connect(tcp_fd, p, 16)` with `*p = {AF_NETLINK}`; while the parent answers, thread B writes `{AF_INET, 93.184.216.34:443}` into `*p`. The parent sees netlink and continues; the kernel copies `*p` now and connects out. Same for `bind` with an `AF_UNIX` address swapped to `AF_INET` any port. For metadata: `chmod("d/x")` where `d` is a dangling link at check time and is re-pointed outside the grant before the kernel resolves it (Landlock does not govern chmod, chown, utimes or xattrs).
- fix: netlink is small: make it on the taken socket like `AF_INET`:
  `:701` `if (a.ss_family == AF_NETLINK) { CONTINUE(v); return; }` →
  ```c
  if (a.ss_family == AF_NETLINK) {
    int sock = still_waiting(v) ? take_fd(v->req->pid, (int)v->req->data.args[0]) : -1;
    if (sock < 0) { REFUSE(v, EBADF); return; }
    int rc = is_bind ? bind(sock, (struct sockaddr *)&a, len) : connect(sock, (struct sockaddr *)&a, len);
    RESULT(v, rc);
    close(sock);
    return;
  }
  ```
  The Unix bind and the not-found metadata paths need the owner's call (bind by `/proc/self/fd/<parent>/<name>`, or refuse `ENOENT` here instead of continuing). QUESTION for those.
- verify: a probe op that races the address from a second thread against the stranger listener (a loop of a few thousand tries).
- risk: a netlink bind made by the parent autobinds with the parent's PID as port ID; glibc reads the ID back with `getsockname`, so it holds, but it is a visible change.

### ts-small-a-S4  Linux sandbox on x86_64: the filter has no x32 check, so x32 calls skip every rule
- kind: broken
- confidence: LIKELY (depends on the kernel's `CONFIG_X86_X32_ABI`; the two acceptance VMs are aarch64, `tests/acceptance/70/BASE-FAILURE.txt:1`)
- where: `packages/supervisor/native/helper-linux.c:457-460`
- evidence: the filter checks `arch == AUDIT_ARCH_X86_64`, then compares `nr` by equality and ends in `RET(SECCOMP_RET_ALLOW)` (`:497`). x32 calls report the same arch with `nr | 0x40000000`, so none of the `socket`, `connect`, `bind`, `ptrace`, `io_uring_*` rules match them and all are allowed.
- failure: on an x86_64 kernel with x32 on, `syscall(0x40000000 | 41, AF_INET, SOCK_DGRAM, 0)` and `syscall(0x40000000 | 42, fd, &addr, len)` open any socket and connect anywhere.
- fix: after `:460` `LD_NR;` add
  ```c
  #if defined(__x86_64__)
    // The x32 ABI's calls carry this bit under the same arch: none of the rules below would match one.
    emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000u, 0, 1));
    RET(SECCOMP_RET_KILL_PROCESS);
  #endif
  ```
- verify: on the x86 lane (#1983), a probe op that makes `syscall(0x40000000 | __NR_getpid)`: the child must die by SIGSYS.
- risk: none for 64-bit programs. Jump offsets after it are relative and unchanged.

### ts-small-a-S5  Egress filter corrupts a credential that holds `$`
- kind: broken
- confidence: SURE
- where: `packages/supervisor/src/egress.ts:187`
- evidence: `headers[at] = headers[at]!.replace(c.standIn, c.value);`. With a string as the replacement, `$$`, `$&`, `` $` `` and `$'` are patterns. Run: `scratchpad/sre/p1.mjs` → `"pa$$word" -> "Bearer pa$word; x"`, `"tok$&en" -> "Bearer tokdeep_standin_abcen; x"`, `"k$'x" -> "Bearer k; xx; x"`. Values come from a dotfile, a CLI or the keychain (`env-local/src/stack.ts:269-299`), with no limit on their characters. `tests/acceptance/1106/*` use values without `$`.
- failure: a credential `pa$$word` with hosts reaches its API as `pa$word`: 401 from the provider, nothing recorded. `$&` puts the stand-in back in; `` $` `` and `$'` copy the rest of the header into the value.
- fix: `headers[at] = headers[at]!.replace(c.standIn, c.value);` → `headers[at] = headers[at]!.replace(c.standIn, () => c.value);`
- verify: `tests/acceptance/1106/standin.test.ts` shape with a value `k$&$$v-12345678`: the sample API must receive it byte for byte. Or `node scratchpad/sre/p1.mjs` (second column is the fixed form).
- risk: none; one occurrence is replaced either way (`seen > 1` is refused at `:184`).

### ts-small-a-S6  A cleanup that throws once is never tried again: the run's leases and the runner's job stay stuck
- kind: broken
- confidence: LIKELY (the stuck state is certain from the code; the trigger is any throw inside `cleanupOnce`)
- where: `packages/supervisor/src/supervisor.ts:769-773` (memo), `:775-837` (`cleanupOnce`); callers that retry: `packages/runner/src/runner.ts:1071-1073`, `:941`, `:956`
- evidence: `if (r.cleaning) return r.cleaning; const cleaning = (r.cleaning = this.cleanupOnce(r));` and nothing ever clears `r.cleaning`. `cleanupOnce` can reject: `provable()` and `leftovers()` call `table()`, whose `run('/bin/ps')` rejects on any error but exit 1 (`procs.ts:13-21`: spawn EAGAIN, a signal); `append` on a record error; `step()` when `confine` throws; `leases.release`. The runner is written to retry: `tick()` calls `supervisor.cleanup(job).catch(() => undefined)` each second for a job that is `stopping` and `unconfirmed`.
- failure: `ps` fails once (fork EAGAIN on a loaded machine) during a run's cleanup. Every later `cleanup(run)` returns the same rejected promise. The run's ports and compose project stay leased, its processes may still run, and the runner's job reads `stopping` until the hub restarts.
- fix: two edits.
  `:770` `const cleaning = (r.cleaning = this.cleanupOnce(r));` → `const cleaning: Promise<Cleanup> = (r.cleaning = this.cleanupOnce(r).catch((error: unknown) => { delete r.cleaning; throw error; }));`
  and so a second pass gives nothing back twice, after `:822` `this.keys.set(name, {});` add `r.leases = r.leases.filter((l) => l !== lease);` (the `for…of` at `:814` keeps iterating the old array).
- verify: a supervisor test with a record whose `append` rejects once on `run.cleaned`: the second `cleanup(run)` must resolve `clean`. Today it rejects again.
- risk: without the second edit a retry after a partial release would free, or with a lease table release, a key another run has since taken. `r.leases` has no reader after cleanup (grep: `:198,230,573,797,806,814`). No test pins the memoized rejection.

### ts-small-a-S7  Linux sandbox has no rule for the agents' hook and MCP files; three comments say the sandbox refuses them
- kind: inconsistent (broken on Linux)
- confidence: LIKELY (I can't see whether one of #70's moved parts, #1691 or #1712–#1716, already tracks it)
- where: `packages/supervisor/src/seatbelt.ts:86-88` (the rule), `packages/supervisor/native/helper-linux.c:258-262` (`may_write`, no counterpart), `packages/supervisor/src/bubblewrap.ts:74` (a guard not there yet is skipped); comments that rely on it: `packages/hub/src/core.ts:1064-1066`, `packages/runner/src/runner.ts:605-606`, `packages/runner/src/agents.ts:151-152`
- evidence: Seatbelt ends every profile with `(deny file-write* (regex #"/\.claude(/|$)") (regex #"/\.mcp\.json$") (regex #"/\.claude\.json$") (regex #"/\.codex(/|$)"))`, "Last, so no grant reaches them … wherever they are". `grep -n "claude\|codex\|mcp" helper-linux.c bubblewrap.ts` finds nothing. The hub's guards (`core.ts:1067-1073`) name `~/.claude` and `~/.codex` only, and bubblewrap skips a guard whose path does not exist (`if (!existsSync(g.path)) continue;`).
- failure: on Linux a run with a write grant on its checkout, or `run_as_you`, writes `<checkout>/.claude/settings.json`, `<checkout>/.mcp.json`, `~/.claude.json`, or creates `~/.codex/` when it is not there yet. On macOS each is refused. Invariant 3's second layer is missing on one platform.
- fix: in `helper-linux.c` before `may_write`:
  ```c
  /** The files agents read their hooks and MCP servers from, wherever they are: no grant reaches them (seatbelt.ts's last rule). */
  static int agent_file(const char *path) {
    for (const char *c = path; (c = strchr(c, '/'));) {
      size_t n = strcspn(++c, "/");
      if ((n == 7 && !strncmp(c, ".claude", 7)) || (n == 6 && !strncmp(c, ".codex", 6))) return 1;
      if (!c[n] && ((n == 9 && !strncmp(c, ".mcp.json", 9)) || (n == 12 && !strncmp(c, ".claude.json", 12)))) return 1;
    }
    return 0;
  }
  ```
  and `:260` `if (guarded(s, path)) return 0;` → `if (guarded(s, path) || agent_file(path)) return 0;`
- verify: `src/bubblewrap.test.ts`, a run with `grant: { write: [dir] }` doing `mkdir -p .claude && echo x > .claude/settings.json; echo x > .mcp.json`: neither file exists after, and both are in `sandbox.denied`.
- risk: this is refused in the parent, ahead of Landlock, so it shares S3's race for a program that tries; it stops the plain case. A Codex job's own home is already named `codex-home` for this reason (`agents.ts:155`).

### ts-small-a-S8  A warm run whose app never answers leaves the app's run uncleaned
- kind: broken
- confidence: SURE
- where: `packages/env-local/src/warm.ts:594-598`; caller `packages/hub/src/stacks.ts:190-191`, `:157-162`, `:321-330`
- evidence: `if (app) await downStack(this.o.host, app); return { cause: … };`. `downStack` only signals and waits. The hub then runs `tear(w)` → `takeDown(w.stack.id)`: the stack's shell, not `app` (a second run, `app = newRun()`, `:582`), and the failed `serve` returns no handle to it. On success the hub does clean it (`stacks.ts:226`: `environment.down(serving.app!)` then `supervisor().cleanup(serving.app!)`). In the supervisor, only `cleanupOnce` closes `r.egress` (`supervisor.ts:826`), appends `run.cleaned` and lets the run be forgotten (`:843-849`).
- failure: a check's app (`environment.up`) with a stand-in credential fails its health route. The app's run stays in `runs` for the hub's life with its egress filter listening and its `deep-egress-*` folder on disk, and the record has `process.starting` with no `run.cleaned` until the next hub start reaps it. Each failed warm start adds one. The same holds if `containers()` (`:603`) throws after the app is up: the app is then not even signalled.
- fix: `:12` `import type { Grant, Host } from '@deepbuild/supervisor';` → `import type { Grant, Host, Supervisor } from '@deepbuild/supervisor';` and
  `:596` `if (app) await downStack(this.o.host, app);` → `if (app) { await downStack(this.o.host, app); await (this.o.host as Partial<Supervisor>).cleanup?.(app)?.catch(() => undefined); }` (the form `stack.ts:252` and `:801` use).
- verify: `tests/acceptance/580` world with an `up` that never listens and `ready.within: 1`: after `serve` returns its cause, the record must hold `run.cleaned` for the app's `process.starting`. Today it does not.
- risk: none seen; `cleanup` of a run already down is what `takeDown` does everywhere else.

### ts-small-a-S9  The runner's quiet watch resets its own baseline, so it does not stop a silent, idle job
- kind: broken (latent: no production caller sets `output_timeout_ms`)
- confidence: LIKELY (arithmetic and a virtual-clock model; not run against a real job)
- where: `packages/runner/src/runner.ts:904-919`; doc `packages/runner/src/types.ts:49-50`
- evidence: each tick: `if (Date.now() - job.outputAt < ms) { last = undefined; return; }`, else ask `groupCpu`, and in its answer `last = now; job.outputAt = Date.now() - ms + Math.min(ms, 1000);`. The answer comes `d` ms after the tick (one `ps` run). At the next tick, `p = min(ms, 1000)` later, `Date.now() - outputAt = ms + jitter − d`, which is `< ms` whenever `ps` takes longer than the timer is late, so `last` is cleared before it is ever compared. `scratchpad/sre/p2.mjs` models it: `{ms:2000,d:30,j:1}` never stops; only `{d:5,j:40}` (an event loop 40 ms late) does. The one test, `tests/acceptance/159/lifecycle.test.ts:43-51`, checks only that a busy job is not stopped, which a watch that never fires passes. Callers of `output_timeout_ms`: none in `packages/` outside the runner (grep), only acceptance 159 and 822.
- failure: `submit({ …, output_timeout_ms: 2000 })` on an agent that hangs with no output and no CPU: it is never stopped `timed_out` unless the hub's loop lags.
- fix: QUESTION on the shape. Deleting `job.outputAt = Date.now() - ms + Math.min(ms, 1000);` makes two equal samples one tick apart stop it, but then "no CPU" means about one second, not "for the whole timeout" as the comment at `:903` and `types.ts:49` say, and Linux `ps cputime` has one-second steps. To match the doc, keep when the reading last changed and stop once it has not changed for `ms`:
  ```ts
  let last: { cpu: string; at: number } | undefined;
  …
  void groupCpu(job.rec.pgid!).then((now) => {
    if (now === null) { last = undefined; return; }
    if (last?.cpu !== now) { last = { cpu: now, at: Date.now() }; return; }
    if (Date.now() - last.at >= ms) { clearInterval(t); void this.stop(job, 'timed_out'); }
  });
  ```
- verify: a runner test with a fake agent that sleeps silently and `output_timeout_ms: 2000`: it must end `stopped` with cause `timed_out`. Today it runs to its deadline.
- risk: acceptance 159's busy case must still pass; with the second form a busy job's reading changes every tick.

### ts-small-a-S10  On Linux the runner's git steps are granted read of `/`
- kind: broken
- confidence: LIKELY (the path arithmetic is certain; what git could be made to read is the open part)
- where: `packages/runner/src/runner.ts:613`, `:1137-1147`
- evidence: `const read = [repo, ...gitDirs(repo), dirname(dirname(dirname(git)))];`. On macOS `git` is `<developer dir>/usr/bin/git`, so the third `dirname` is the developer folder. Off macOS `gitBinary()` returns `'/usr/bin/git'`, and `dirname(dirname(dirname('/usr/bin/git')))` is `'/'` (checked with `node -e`). `bubblewrap.ts:64` turns it into `--read /`, and `helper-linux.c:355` adds a Landlock read rule on `/`.
- failure: on Linux every step of a job's checkout (`git init`, `fetch`, `ls-tree`, `cat-file`, `read-tree`) runs able to read every file you can, against the header's "granted only what it reads" (`:5-6`) and the comment at `:603-606`.
- fix: `:613` → `const read = [repo, ...gitDirs(repo), ...(process.platform === 'darwin' ? [dirname(dirname(dirname(git)))] : [])];` (`/usr` is readable in every Linux sandbox, `helper-linux.c:325`).
- verify: `tests/acceptance/159` checkout cases in the Linux VM still pass; a unit check that the grant handed to `supervisor.start` holds no `/`.
- risk: a Linux git outside `/usr`, `/opt`, `/snap` is not handled either way: `gitBinary()` never returns one.

### ts-small-a-S11  One failed `docker context inspect` blocks every compose stack until the hub restarts
- kind: broken
- confidence: LIKELY
- where: `packages/env-local/src/stack.ts:406`, `:414-429`
- evidence: `daemons.set(docker, found)` runs for the `catch` branch too (`found = { why: 'docker context inspect failed, …' }`), and `:415` returns the cached value for ever. The call is `execFileSync(…, { timeout: 10_000 })`.
- failure: the first compose stack is asked for while Docker Desktop is starting or the machine is loaded; the CLI takes over 10 s once. Every later `upStack`, `WarmStack.open` and compose lease answers "docker context inspect failed … so no compose stack can run" for the hub's life.
- fix: QUESTION on the shape. Not caching the failure at all would run a blocking 10 s call on the hub's thread for each `dockerEnv()` while Docker is down. Keep a failure for a short time:
  `:406` `const daemons = new Map<string, Daemon>();` → `const daemons = new Map<string, { found: Daemon; until: number }>();`
  `:415` → `const kept = daemons.get(docker); if (kept && Date.now() < kept.until) return kept.found;`
  `:427` → `daemons.set(docker, { found, until: failed ? Date.now() + 30_000 : Infinity });` with `failed` set in the `catch`.
- verify: `packages/env-local/src/index.test.ts` with a fake `docker` that fails its first `context inspect` and answers the second, and a clock moved 30 s: the second `upStack` must not be BLOCKED on it.
- risk: `index.test.ts:118` (a TCP context is BLOCKED) and `:127` (a daemon that stops answering fails at once) pin nearby behavior; a TCP context is a real answer and stays cached.

### ts-small-a-S12  A warm stack that fails to open leaves its two folders
- kind: broken
- confidence: SURE
- where: `packages/env-local/src/warm.ts:173-177` (made), `:199-215` (`open`), `packages/env-local/src/stack.ts:773-780` (removed only through `composed`)
- evidence: the constructor makes `<compose.dir>/warm/stack-XXXX` and `$TMPDIR/deep-warm-XXXX`. They are removed only by `downStack`, which reads them from `composed`, and `composed.set(this.id, …)` is the last line of `open`, after its three early returns (`:202`, `:204`, `:208`) and after `readEnvironment` may throw. The hub makes a new `WarmStack` per try and tears the failed one down by `takeDown(stack.id)` (`hub/src/stacks.ts:180-185`).
- failure: a repo whose environment names `compose` on a hub with no Docker CLI: each check run that wants the app leaves two empty folders, without bound.
- fix: move `composed.set(this.id, { work: this.data, judged: this.dir });` from `:213` to the end of the constructor (after `:176`), with its comment.
- verify: `index.test.ts`: `new WarmStack(…)`, `open` on a compose environment with `docker: undefined`, `downStack(host, stack.id)`: both folders are gone.
- risk: `downStack` gives a run with folders a 30 s grace (`stack.ts:774`), but an unknown or BLOCKED run's `wait` rejects, which reads as ended at once.

### ts-small-a-S13  env-local's card and header say it never spawns a process; it runs `lsof` and `docker` itself
- kind: inconsistent
- confidence: SURE
- where: `packages/env-local/README.md:10`, `packages/env-local/src/stack.ts:3-4`; against `stack.ts:150` (`execFile(LSOF…)`), `:419` (`execFileSync(docker, ['context','inspect'…])`), `:446` and `:474`, `:706` (`docker ps`, `volume ls`, `version`)
- evidence: README: "Every process start, signal and wait goes through host@1; never spawn, signal or wait for one here." Header: "It never spawns, signals or waits for a process itself". The five calls above run outside the supervisor, as the hub, with no sandbox and no record.
- failure: a reader trusting the card adds nothing to the list of code that starts processes outside host@1 (the modularity audit's finding 2 names checks-numbers, checks-work and proof, not this).
- fix: README `:10` → "Every process of a stack starts, is signalled and is waited for through host@1. The hub's own short reads of the machine run directly: `lsof` for a port, and `docker context inspect`, `version`, `ps` and `volume ls`. `docker compose up` and `down` go through the host." Same wording in the header at `stack.ts:3-4`.
- verify: diff review.
- risk: none (docs).

### ts-small-a-S14  Linux sandbox: four smaller gaps beside the grant's words
- kind: broken
- confidence: QUESTION (each by reading; the owner may hold some as known limits of #70)
- where and what:
  1. `helper-linux.c:490` has no `listen` rule: `listen()` on an unbound TCP socket autobinds an ephemeral port on every address, so a run can take connections from the LAN on a port its grant never named (`types.ts:16-17` says listen is by port). Seatbelt denies `network-inbound`.
  2. `helper-linux.c:347` scopes signals only on Landlock ABI 6; the floor is ABI 4 (`bubblewrap.ts:15`, `:107`). With no PID namespace (`bubblewrap.ts:83-84`) and the same uid, a run on Linux 6.7–6.11 can `kill` the hub or another run's process. Seatbelt allows `signal` to `same-sandbox` only (`seatbelt.ts:61`).
  3. `helper-linux.c:325` `SYSTEM_READ` holds `/var` and `/opt`: `/var/tmp` and, on ostree systems where `/home` links to `/var/home`, your whole home are readable by every run. The comment says "Programs and files the system ships". Seatbelt's list is programs only (`seatbelt.ts:10`).
  4. `helper-linux.c:490-492` lists `setxattr`/`removexattr` forms but not `setxattrat`/`removexattrat` (Linux 6.13), which Landlock does not govern.
- fix: 1: add `__NR_listen` to `notified` and answer it by `getsockname` on the taken socket (Unix, or a granted port). 2: raise `LANDLOCK_ABI` to 6 or send `kill`/`tgkill`/`pidfd_send_signal` to the parent. 3: drop `/var` and `/opt` from `SYSTEM_READ` or name the subfolders needed. 4: add both numbers (463, 466) to `notified` and refuse them. Each needs a suite case.
- verify: new `probe` ops per case in `suite.ts`.
- risk: 3 can break a program that reads `/var/lib/…`; 2 raises the kernel floor to 6.12.

---

## Nits

- `supervisor/src/supervisor.ts:616-617`: `sha256File` rejects if a kept run's output file is gone; the `.then` has no catch, so it is an unhandled rejection and `wait()` never settles (Linux service runs only).
- `supervisor/src/supervisor.ts:960-966`: `close()` leaves a held `start()` pending for ever and does not wait for `launching`.
- `supervisor/src/supervisor.ts:307-334`, `:572`: if `/usr/bin/log stream` exits, denials go unrecorded from then on and nothing says so (the warning prints only at the first warm-up).
- `supervisor/src/supervisor.ts:597-599`: a second `openSync` that throws, or a throwing `spawn`, leaks the first descriptor.
- `supervisor/src/types.ts:25`: "(Seatbelt now; bubblewrap #70 and AppContainer later)" is stale; bubblewrap shipped (`index.ts:3-4`).
- `supervisor/README.md:19`: Deviations describe `helper.c` and `helper-linux.c` but not `native/pty.c`, the hosted terminal's host both include (#104, #989).
- `supervisor/tsconfig.json`, `env-local/tsconfig.json`: `"include": ["src/**/*.ts"]` compiles `src/*.test.ts` (five and one files) into `dist/`. Fix: add `"exclude": ["src/**/*.test.ts"]`. LIKELY; nothing imports the built tests (vitest globs `.ts`).
- `supervisor/native/helper-linux.c:872`: `poll(…, 200)` with SIGCHLD at its default: on kernels 6.7–6.10, where a seccomp filter is released only when its task is reaped, the program's end is seen up to 200 ms late. A no-op `SIGCHLD` handler makes `poll` return at once.
- `supervisor/native/helper-linux.c:280`: more than 64 `--connect`/`--listen` ports are dropped without a word; too many paths exit 126 (`:202`).
- `supervisor/native/pty.c:103-110`: `row_text` builds a C string, so an overlong NUL (`C0 80`) in the output cuts that row in the checkpoint.
- `supervisor/src/egress.ts:193-200`: the upstream request has no timeout and is not in `open`, so `close()` leaves it; `:41-46` `der` lengths stop at 65,535 bytes (a larger SAN list makes a bad certificate, refused by the client); `:144-146` with `:231`: a failed `listen` leaves the `deep-egress-*` folder.
- `supervisor/src/bubblewrap.ts:111`: `DEEP_CONFINE` carries the helper flags and the whole argv in one environment string; Linux caps one string at 128 KiB, so a launch whose arguments total more fails E2BIG where each alone would pass.
- `runner/src/runner.ts:139-140`: two doc comments on `forwarders`; "Opened with the first job that launches." is left over.
- `runner/src/types.ts:143-146`: `planWindows`' doc comment sits above `atReserve`'s.
- `runner/src/runner.ts:283-288`: if the `job.recorded` append rejects, the job stays in `jobs` as `waiting`, and a later pump can start it unrecorded.
- `runner/src/runner.ts:630-631`: `entry.split('\t')` destructured to two parts cuts a tree path at its first tab.
- `runner/src/runner.ts:673-685`: `step` has no deadline; a `--version` or git step that hangs holds the pump chain, and with it every waiting job.
- `env-local/src/stack.ts:78`, `:89`: port names skip the `variable()` rule, so a plain `up` stack may name a port `PATH` or `DEEP_RUN_TOKEN` (a compose stack is refused at `:701-702`); a name listed twice leases two ports and uses one.
- `env-local/src/stack.ts:709-728`: the compose run's two temp folders are removed on BLOCKED, but not when `host.start` throws.
- `env-local/src/stack.ts:509-516`, `:581`: top-level `configs` and `secrets` are judged, yet `configs` and `secrets` are not in `SERVICE_KEYS`, so no service may use one.
- `env-local/src/stack.ts:256-264`: a dotfile value keeps an inline `# comment`.
- `env-local/src/warm.ts:526` against `stack.ts:212`, `:340`: `SeedRecord.template` is the template file's SHA-256 in a cold stack and the seed step's key in a warm one; the type's comment says digest.
- `env-local/src/index.ts:2-3`: the type exports `SeedRecord`, `RunFacts`, `WarmProducts`, `WarmStep` have no importer (grep `@deepbuild/env-local` imports over `packages tests scripts benchmarks docs adapters packs`; the hub takes `RunFacts` from `@deepbuild/gate`).
- `env-local/src/stack.ts:756-760` (QUESTION): with no leased port, `ready` returns on the first 200 and never looks at whether its own command has already ended, so another program on the fixed port reads as this stack ready.
- `env-local/src/stack.ts:509-515` (QUESTION, design): a compose service has the daemon's default network, so it can reach outside hosts, while an `up` stack's sandbox can reach only its leased ports.

Outside this area, one line: `packages/hub/src/core.ts:7534-7549` (`builtOutside`) starts `/bin/sh -c <build>` with `own_sandbox: true`, waits with no deadline and never calls `cleanup` for the run.

## Coverage

| | Files |
|---|---|
| Read in full | `packages/supervisor`: `README.md`, `package.json`, `tsconfig.json`, `build-helper.mjs`, `native/helper.c`, `native/helper-linux.c`, `native/pty.c`, `src/index.ts`, `timer.ts`, `types.ts`, `supervisor.ts`, `procs.ts`, `seatbelt.ts`, `bubblewrap.ts`, `egress.ts`, `suite.ts`, `bubblewrap.test.ts`, `seatbelt.test.ts`, `node-runtime.test.ts`, `supervisor.test.ts`. `packages/runner`: `README.md`, `package.json`, `tsconfig.json`, `src/index.ts`, `runner.ts`, `agents.ts`, `egress.ts`, `types.ts`. `packages/env-local`: `README.md`, `package.json`, `tsconfig.json`, `src/index.ts`, `stack.ts`, `warm.ts`. |
| Skimmed (test names, imports, what they pin) | `packages/supervisor/src/leases.test.ts` (first 40 of 104 lines), `packages/runner/test/runner.test.ts`, `codex-versions.test.ts`, `pi-cost.test.ts`, `packages/env-local/src/index.test.ts`. |
| Read outside the area to refute | `packages/hub/src/stacks.ts` (warm and cold paths, `takeDown`, `tear`), `packages/hub/src/core.ts:1060-1075`, `:7525-7550`, `packages/hub/src/starts.ts:268-290`, `tests/acceptance/70` (`sandbox.test.ts` head, `BASE-FAILURE.txt` head, README greps), `tests/acceptance/159/lifecycle.test.ts:25-55`. |
| Not read | Nothing tracked in the three packages. Not checked: agent CLI flags in `agents.ts` against `adapters/*.facts.json` (another area's files); the acceptance suites under `tests/acceptance/236`, `331`, `580`, `1106` beyond greps. |
