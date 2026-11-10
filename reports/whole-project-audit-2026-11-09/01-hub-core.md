# hub-core findings

Checkout read: `the checkout` (origin/main 06fd33cd). Read-only. Nothing was built or run; commands used were `rg`, `sed -n`, `wc`, `git log -S`, and three `node -e` snippets that read JSON facts files or compared two name lists.

**Not everything was read.** `core.ts` is 7,879 lines; I read about 76% of it line by line and did not reach about 1,900 lines (ranges in the coverage table). I tried to hand three ranges to helper agents and the session's agent limit refused, so those ranges are unread, not delegated. Every finding below comes from lines I read myself.

Prior reports read first and not repeated: `package-deep-audit.md`, `package-modularity-audit.md` (hub lines), `hillclimb-audit-2026-11-09/01-hub-hot.md`, `02-hub-rest.md` (gate-runner findings F3, F6, F7, F9 and its notes).

Counts: 11 findings by main kind: 4 broken (1, 3, 4, 8), 7 inconsistent (2, 5, 6, 7, 9, 10, 11). By confidence: 1 SURE (the mismatch in HUB-CORE-2), 6 LIKELY (1, 3, 4, 5, 6, 7), 4 QUESTION (8, 9, 10, 11). 9 nits. No unneeded or inefficient finding. None of them is a PASS reached with nothing run; five (1, 2, 3, 4, 8) are claims left with no verdict, or with one that can't settle.

---

### HUB-CORE-1  A claim whose snapshot or checkout fails for any cause but the budget gets no verdict at all
- kind: broken (an error path that swallows, in the verdict path)
- confidence: LIKELY
- where: `packages/hub/src/gate-runner.ts:588-598, 622`; `packages/hub/src/core.ts:7298, 7305-7306, 4688, 7419-7420`; `packages/gate/src/checkouts.ts:91, 341`
- evidence: gate-runner.ts:594-597
  ```ts
  } catch (error) {
    if (!(error instanceof OverBudget)) throw error;
    await this.o.invalid(r.claim, snapshot, error.message, 'INCONCLUSIVE');
  ```
  `checkouts.ts` throws plain errors: `Error(\`git ${args[0]}: ...\`)` (:91) and `Error(\`can't copy ${folder} into the checkout\`)` (:341). In core.ts the throw rejects the claim's lane; :7306 only writes `deep hub: <claim>'s checks did not start: ...` to stderr; `laneOf` reads the rejection as `lane.catch(() => undefined)` (:4688) and returns undefined. The claim is added to `GateRunner.claims` only at gate-runner.ts:622, after the throw, so `verdictOf(claim)` is undefined and `judged` returns at its first line (:7419-7420), now and on every later call.
- failure: a stop while the disk is full, `.git/index.lock` is held, or `cp -cR node_modules` fails. `claim.made` is recorded; no `verdict.made` ever follows; no reading lands on the session's row; the stop is let through with no send-back. The runner's own rule says otherwise (":709 A run that never started is missing, named, so the check is BLOCKED, never pending with no run to come"), and its slow lane does record a missing run for the same checkout failure (:1110-1115).
- fix: core.ts:7306
  ```ts
  // old
  lane.catch((error: unknown) => process.stderr.write(`deep hub: ${r.claim}'s checks did not start: ${error instanceof Error ? error.message : String(error)}\n`));
  // new
  lane.catch((error: unknown) => {
    const why = error instanceof Error ? error.message : String(error);
    process.stderr.write(`deep hub: ${r.claim}'s checks did not start: ${why}\n`);
    void this.invalid(r.claim, r.commit, `its checks did not start: ${why}`, 'INCONCLUSIVE').catch(() => undefined);
  });
  ```
  (the same call the OverBudget branch makes).
- verify: no test pins it (`rg "did not start" tests packages` finds only hub-start messages). A hub test whose worktree has `.git/index.lock` at the stop: no verdict row today, one INCONCLUSIVE naming git's error after.
- risk: adds a verdict where none was written. Needs its failing test first, so not a blind apply.

### HUB-CORE-2  On a 1-core host the core reports zero check slots while the lease table has one: no check ever starts
- kind: inconsistent (and broken on such a host)
- confidence: SURE for the mismatch; LIKELY that a 1-core host is used (a 1-vCPU Linux VM, #70)
- where: `packages/hub/src/core.ts:819`; `packages/leases/src/index.ts:434`; `packages/hub/src/gate-runner.ts:665, 682-688, 1038`
- evidence: core.ts:819 `slots: () => ({ free: Math.max(0, Math.floor(CORES / 2) - this.runs.size) })`. leases/src/index.ts:434 declares `cpu.slot` as `pool(${Math.max(1, Math.floor(cores / 2))})`. With `CORES = 1` the core says 0, the table 1.
- failure: `GateRunner.stop` builds `free = []` (:665), so `start = Infinity` and every check goes to `slow` (:685-688); `pump` returns at `slots().free <= 0` (:1038). The claim's verdict stays pending with nothing to end it.
- fix: core.ts:819 `Math.floor(CORES / 2)` → `Math.max(1, Math.floor(CORES / 2))`.
- verify: `rg DEEP_HUB_TEST_CORES tests packages` shows 4, 5 and 12 only, so nothing pins 0. A `gate-runner.test.ts` case with `slots: () => ({ free: 0 })` shows the hang.
- risk: none on 2+ cores (same value).

### HUB-CORE-3  A check whose run never started is carried to the next claim on the same tree, so it stays BLOCKED after its cause is gone
- kind: broken / inconsistent
- confidence: LIKELY
- where: `packages/hub/src/gate-runner.ts:582, 585, 654-660` against `:173-174`; `packages/hub/src/core.ts:7507`
- evidence: `:582 const ended = (e: Entry | undefined) => e !== undefined && !e.running && e.outcome !== null && e.runs.length > 0;` is the test for both the no-snapshot path (:585) and the same-tree carry (:656-659). A start that is refused leaves `e.outcome = 'missing'` and one synthetic run (`cantStart`, :540-544), so `ended` is true. The cross-session carry has the opposite rule at :173: "Missing, stopped and uncounted runs say nothing of the key, so they never carry."
- failure: a paid check's start throws "it waits for your answer, ask:…" (core.ts:7507). The claim is BLOCKED. You approve the budget. The agent stops again having changed nothing: `same` is true, every check is `ended`, the missing run is copied to the new claim, nothing runs, and the verdict is BLOCKED again. It stays so until the agent changes a file. The same holds for a run `stopped` by a hub stop within one hub life and for an `uncounted` journey or timing run.
- fix: gate-runner.ts:582, append to the expression: `&& e.outcome !== 'missing' && e.outcome !== 'stopped' && e.outcome !== 'uncounted'`.
- verify: `tests/acceptance/82/nowork.test.ts` and `packages/hub/test/gate-stop.test.ts` pin "nothing runs on an unchanged tree" for checks that ended as results; I did not find a case with a missing run. A unit case: first stop with `start` rejecting, second stop with `same: true` and `start` working, expects one run.
- risk: an unchanged tree with a still-refused start is tried again at each stop (one checkout each time). Owner may prefer that only `missing` retries.

### HUB-CORE-4  A drift rerun whose run can't start leaves its check pending for ever
- kind: broken / inconsistent
- confidence: LIKELY
- where: `packages/hub/src/gate-runner.ts:835-852` against `:707-711`, `:1096-1099`, `:1110-1114`; `packages/verdicts/src/engine.ts:292`
- evidence: `rerun` first sets `e.runs = []; ... delete e.group` (:835); its catch is `} catch { e.outcome = 'missing'; }` (:848-849). The other three start paths add `if (!e.runs.length) this.cantStart(e, error);`.
- failure: `checkoutOf(c)` rejects (the snapshot was pruned, the disk is full) or `o.start` refuses during a workspace drift rerun. The entry has no run, no group, is not running and not stale, so `verdictOf` gives it no `state` (:505) and the engine reads "no state, no runs" as `running` (engine.ts:292). The claim reads pending and no later event ends it.
- fix: gate-runner.ts:848-849 `} catch {\n          e.outcome = 'missing';` → `} catch (error) {\n          e.outcome = 'missing';\n          if (!e.runs.length) this.cantStart(e, error);`
- verify: `packages/hub/test/gate-runner.test.ts:120-160` has the rerun cases; add one with `start` rejecting: `verdictOf` is pending before, BLOCKED after.
- risk: low; the two existing rerun tests start their runs.

### HUB-CORE-5  The Closes gate fails open on its own error, while the gate around it fails closed
- kind: inconsistent
- confidence: LIKELY
- where: `packages/hub/src/core.ts:3470` (and the same shape at `:3483`); `packages/hub/src/server.ts:926, 930-931`
- evidence: core.ts:3470 `const deny = await this.closesGate(meta.session, call.command).catch(() => undefined);` then `if (!call.classes.length && ...) return {};`. If `toolGate` itself rejects, the server denies: server.ts:926 turns the rejection into `{ failed }` and :931 replies "DeepBuild held this: checking whether `…` needs your authority failed (…). Run it again."
- failure: any throw inside `closesGate` (`tasks.unproven`'s `JSON.parse` of a definition row, a record read, `switchesOff`) lets `gh pr create --body "Closes #n"` run with requirements unproven, silently. The design line it guards: "A pull request says Closes only when every requirement of the issue's task passed" (comment at :3468).
- fix: core.ts:3470 drop the catch: `const deny = await this.closesGate(meta.session, call.command);`. The server's existing path then denies once with the cause.
- verify: `tests/acceptance/87/gate` and `tests/acceptance/322` cover the gate's denies; a hub test with a malformed `definitions.requirements` row shows the PR allowed today.
- risk: a transient read error now denies one `gh pr create`, with "Run it again". Line 3483 (`resent(...).catch(() => undefined)`) has the same shape, but its forge lookup is already known not to work (#1881), so removing that catch could deny a resumed session's send repeatedly: leave it until #1881 is fixed.

### HUB-CORE-6  Approved check bytes are written through a symlinked folder of the snapshot; the held-out overlay beside it guards against exactly this
- kind: inconsistent
- confidence: LIKELY
- where: `packages/hub/src/core.ts:7478-7484` against `:7486-7497`
- evidence: :7479-7483
  ```ts
  const file = join(r.cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, await this.store.read(sha256), { mode: path === r.check ? 0o500 : 0o400 });
  renameSync(`${file}.tmp`, file);
  ```
  with no containment test. For the overlay, :7493 `if (!\`${realpathSync(folder)}/\`.startsWith(\`${realpathSync(r.cwd)}/\`) || ...) throw Error(...)`, under the comment "Its folder is resolved through any link the snapshot holds and must still lie in the checkout". `r.cwd` is a checkout of the agent's snapshot (`checkout-index -a` makes its symlinks) and this code runs in the hub, as you, outside any sandbox.
- failure: the session commits `tests/acceptance/12` as a symlink to a folder outside the repo. At its stop the hub writes each approved check and each referenced expected output into that folder (the content is the approved bytes, the name the check's basename), replacing a file of the same name there.
- fix: before :7481 add the overlay's test:
  ```ts
  let folder = dirname(file);
  while (!existsSync(folder)) folder = dirname(folder);
  if (!`${realpathSync(folder)}/`.startsWith(`${realpathSync(r.cwd)}/`) || !`${file}/`.startsWith(`${r.cwd}/`)) throw Error(`a check's file ${path} lies outside its checkout`);
  ```
  The gate-runner turns the throw into a missing run (BLOCKED).
- verify: `tests/acceptance/1018` has the overlay's link case; a twin for the check's own path fails today.
- risk: low. A check folder that is a symlink to another folder inside the checkout still passes.

### HUB-CORE-7  A standing rule's yes is dropped whenever any extension handles `tool.before`
- kind: inconsistent
- confidence: LIKELY
- where: `packages/hub/src/server.ts:793, 943-952, 1072-1078`
- evidence: `gateReply`: `if (before !== undefined) return this.extensionReply(conn, meta, before, hold, ruled);` (:943) comes before the block that writes `permissionDecision: 'allow'` from `gate.allow` (:946-952). `extensionReply` writes `agentReply(meta.agent, reply, ruled)` or `ruled`; neither carries `gate.allow`. `before` is set whenever `this.hooks.has('tool.before')` (:793).
- failure: an extension that handles `tool.before` is loaded and your standing rule answers a dependency install with yes. With no extension Claude Code gets the explicit allow and the rule's words; with the extension loaded it gets neither, so its own permission prompt asks you what the rule already answered (invariant 4).
- fix: needs a small restructure, not a one-liner: in `gateReply` compute `allow` first, pass it to `extensionReply`, and when the extensions deny nothing write the allow output with their context appended.
- verify: `packages/hub/test/extensions.test.ts` (tool.before hold) and the #23 standing-rule tests; no case combines the two.
- risk: touches the reply both features share; test first.

### HUB-CORE-8  When the fast lane outlasts the stop's hold, the claim's slow checks are never queued
- kind: broken
- confidence: QUESTION
- where: `packages/hub/src/core.ts:4493, 4596, 4683-4689`; `packages/hub/src/gate-runner.ts:723, 883-889`; `packages/hub/src/server.ts:1055`
- evidence: `laneOf` races the lane against `until` (the server's hold less 500 ms) and returns undefined when the lane is still going. :4596 then calls `this.gate.turnEnded(lane && judged?.claim ? judged.claim : null, ...)`: with null, `c` is undefined and `slow = []`, so no slow entry is placed or held. `GateRunner.stop` itself resolves only at `stopAt + hold_ms` (:723), about half a second after `until`. The only other callers of `turnEnded` are `slowStop` (:4738, Codex) and `judgeEnded` (:5052, replayed stops and watches).
- failure: a fast check expected at 5 s runs 61 s. The stop is let go at the hold. The fast check later passes. The slow entries have no run, are not queued and not stale, so the verdict reads pending until the session stops again on a new claim.
- fix: owner's call between two: start them late (`void this.lanes.get(claim)?.then(() => this.gate.turnEnded(claim, ...))` when the lane missed the hold), or mark them `never_started` so the verdict settles.
- verify: a case belongs in `tests/acceptance/29`; I did not find one for a fast lane past the hold.
- risk: late slow runs may be outdated by the next claim, which the queue already handles.

### HUB-CORE-9  A person's connection (#1337) reads every session's ID and other sessions' command text through `hub.health`
- kind: inconsistent
- confidence: QUESTION
- where: `packages/hub/src/server.ts:46, 52, 1314-1318`; `packages/hub/src/core.ts:5807-5817, 2889-2895, 2594`
- evidence: server.ts:46 "A person's connection (#1337) reads only what that person may see." `['hub.health', ['app', 'cli', 'person']], ['health', ['app', 'cli', 'person']]`. The other person reads filter by `seenBy(context.role)` (core.ts:5623, 5625, 5677 with 5832-5837). `health()` takes no role and returns `sessions` (the 100 newest IDs with `closed`) and `claude.readings`, whose lines quote a running call of any session: "…while the shell call <id> (`<command>`) was running" (:2889-2895, text built at :2594).
- failure: a person added to one project calls `hub.health` and reads the IDs of the owner's sessions in other repos, and after a settings-tamper reading the command line of the owner's running call.
- fix: server.ts:1318, for `conn.role === 'person'` reply `{ pid, start, off, gates }` only. Check what a person's CLI reads from health first (`packages/hub/src/remote.ts`, `status.ts`).
- verify: `tests/acceptance/1337`, `1338`; I found no test of a person's `hub.health`.
- risk: a person's client that reads other health fields loses them.

### HUB-CORE-10  A spec check's failure read as carried from another session never runs on the merge base, so an inherited failure reads as the claim's own FAIL
- kind: inconsistent
- confidence: QUESTION
- where: `packages/hub/src/gate-runner.ts:299, 765, 1056-1064`; `packages/verdicts/src/engine.ts:334-337`
- evidence: `carry` sets `e.outcome = ...every passed ? 'passed' : 'carried'` (:299). `onBase` returns unless `e.outcome === (on_base === 'fails' ? 'passed' : source === 'spec' ? 'failed' : null)` (:765). A spec check carried with a failed run has outcome `'carried'`, so the base run that would mark it inherited (engine.ts:337, BLOCKED "also fails on the merge base") never starts.
- failure: sessions A and B on equal keys; main is broken. A runs the check: fails on head and base, BLOCKED inherited. B stops: carried, no base run, FAIL and a send-back for a failure B didn't cause.
- fix: at :765 treat a carried failure as failed for the spec branch (test the group's runs for `failed`/`overran`, as :716 already does).
- verify: `packages/hub/test/shared-runs-hub.test.ts`, `tests/acceptance/1018`, `tests/acceptance/33`; no case carries a failed spec check.
- risk: #1018's text may intend the carried FAIL; owner's call.

### HUB-CORE-11  A Codex stop starts its slow checks at once, whatever the loop or background work says
- kind: inconsistent
- confidence: QUESTION
- where: `packages/hub/src/core.ts:4535-4540, 4738, 4596`; `packages/hub/src/gate-runner.ts:883-896`
- evidence: `slowStop` calls `await this.gate.turnEnded(claim);` (:4738) with no background list and no loop reading, so in `turnEnded` `looping` is false, `background` is empty and every slow check is placed and every held one released (:893-896). The later call at :4596 passes the real reading, but the checks are already queued or running.
- failure: a Codex session on a goal's continuation (origin `continuation`) with background work stops green. #965 and #907 say its slow checks wait for the loop to pause or the work to end; they start now, on code the next continuation changes.
- fix: pass the same `background`, `stopAt` and reading to the call at :4738 that :4596 builds, and hold the stop only for the checks `turnEnded` placed.
- verify: `tests/acceptance/965` (does it run a Codex session?), `tests/acceptance/39`. Not checked.
- risk: #39's hold for a slow check needs the check started at the stop; the two issues may conflict by design.

---

## Nits (one line each)

- `core.ts:177-178, 280-284, 336, 1433-1436, 7162-7170, 7808-7814`: doc comments left above the wrong declaration after code moved (the `AUTHORITY` comment sits above `signInCommands`; three JSDoc blocks stack above `fixItem`; `crashing`'s and `withAppend`'s docs sit above `continueText`).
- `server.ts:360`: "What the hub reads of a guard@1 entry in rules.json" sits above `NAMED_RULES`' comment; `interface Guard` is at :375.
- `server.ts:1425-1429`: two JSDoc blocks on `runHub`; the second says "the hub loads none yet in either mode", stale since the core loads every installed extension (`core.ts:1132`); belongs with #1879.
- `core.ts:5613-5614`: `case 'hub.health': case 'health'` in `dispatch` can't be reached from the server, which sends `{ op: 'health' }` for both (`server.ts:1318`). Scripted compare of `ALLOWED` against `dispatch`'s cases otherwise agrees (the five without a case are served by the server or by `call`; `person.join` is the server's own).
- `core.ts:5108`: `codexStop` writes the session ID into its SQL text (`session_id = '${sql(meta.session)}'`), one compiled statement per session, where every neighbour binds it.
- `gate-runner.ts:938`: `slowEnded` loops on `Date.now()` where the rest of the class uses `this.o.now()`; its one caller passes wall-clock times (`core.ts:4749-4750`), so it agrees today.
- `server.ts:1166`: a network listener that fails to listen (port in use, or a `hub.listen` port over 65535, which throws inside the promise) leaves `this.network` set or rejects `open()`; either way it is never tried again until the hub restarts.
- `server.ts:275-281`, `parser.ts:11-16`: parser workers have no 'error' listener and `parseLine` runs with no try. I found no input that makes `mapRequest` throw after its schema check (facts files checked for `questionTools`, `mapping`, `events.versions`), so a nit.
- `core.ts:7774-7778`: a core whose `init` failed returns from `stop` before `writeState('stopped')`, so the next start appends `hub.stopped { reason: 'crashed' }` for a hub that never started.

## Checked and found in order (no finding)

- `packages/hub/package.json`: all 27 dependencies have an importer in `packages/hub/src` (counted per package name); `better-sqlite3` and `yaml` are imported.
- `packages/hub/src/index.ts`: every export has a user outside the package (CLI, `benchmarks/wiki.mjs` for `rootOf`, `tests/acceptance/139/budgets.test.ts` for `contractAdapter`, `tests/acceptance/992/helpers.ts` for `activePlant`).
- `packages/hub/README.md`: `scripts/skill.mjs` exists and writes `packages/hub/tools.json` (:125); the files it names exist; "Only the CLI imports it" holds (`rg "@deepbuild/hub"` outside the package: `packages/cli`, tests and `scripts/repo-rules.json`).
- `packages/hub/tools.json`: 13 tools; `mcpCall` (`core.ts:6482-6497`) serves those 13 plus `find_actions` and `call_action`, which `tools.ts:190` says are listed another way. Tool descriptions were not checked against each tool's behavior (the tool bodies are in the unread ranges).
- `hookmap.ts`: `ADAPTERS` covers `cursor` and `grok`, so `coveredBy` can't hit a missing adapter; `deep-hook` never sends the alias `claude`.
- `log-reads.ts`: read-ahead, stream and `reflecting` read as their comments say.
- `server.ts` frames: order holds while `held` drains (each write callback moves one held frame before any new frame can pass `queued < BEHIND`).
- `core.ts` `judged` (:7418-7467): every downgrade applies only to PASS or keeps a FAIL first; a failed `recordVerdict` is retried at the next call. `invalid` records INVALID or INCONCLUSIVE only.
- `core.ts` void-ed calls with no catch (`rg "void (this|…)\("` less those with a catch): each either catches inside or calls a helper that can't reject (`children.ts` `run` catches; `driftAll` catches per workspace).

## Coverage

| File | Read |
|---|---|
| `packages/hub/src/core.ts` | In full, line by line: 1-3200, 3440-3700, 3986-4118, 4340-5900, 6462-6540, 7140-7879 (about 5,990 lines). Greps only: the rest. **Not read: 3200-3440** (relay, `unwoken`, `woken`, `shown`, the cut-off turn's sends), **3700-3986** (the stall gate, `split`, release checks, switches), **4118-4340** (Your rules, #344), **5900-6462** (answers on the trusted path: `answer`, undo, overrule, pairing, channels, inbox), **6540-7140** (the canvas side, deep_show, deep_status/search/ask/claim/run bodies, `peer`). Reason: ran out of budget; helper agents were refused by the session's agent limit. |
| `packages/hub/src/server.ts` | In full |
| `packages/hub/src/gate-runner.ts` | In full |
| `packages/hub/src/hookmap.ts` | In full |
| `packages/hub/src/log-reads.ts` | In full |
| `packages/hub/src/index.ts`, `package.json`, `tsconfig.json`, `tools.json`, `README.md` | In full |
| Other files, for call sites only | `parser.ts`, `core-worker.ts` (in full, short); parts of `children.ts`, `release.ts`, `standing.ts`, `rules.ts`, `reach.ts`, `open-items.ts`, `ask-tasks.ts`; `packages/gate/src/claim.ts`, `checkouts.ts` (throw sites); `packages/verdicts/src/engine.ts` (state handling); `packages/leases/src/index.ts:434` |
| Tests | Not read; grepped for what pins each finding (named per finding) |
