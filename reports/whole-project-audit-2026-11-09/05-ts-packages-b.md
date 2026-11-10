# ts-small-b: findings

Checkout: `the checkout` at 06fd33cd. Paths are relative to it.
Read-only. Nothing was built or tested. Ran only `rg`, `git diff/log`, `sed -n`, `wc`, and three `node -e` expressions
(quoted where used). Every finding is from reading the code; none was reproduced by a run.

Counts: 17 findings (15 broken, 2 inconsistent) plus 13 one-line nits (one unneeded export among them).
By confidence: SURE 4, LIKELY 10, QUESTION 3.

Already reported and skipped: Gmail `find` reading a 5xx as "no marker" (#1889), a reading job on Codex (#1880), the
five GitHub REST clients (#1904), `buying`/`proof` with no production importer (#1900), `diffOf`'s per-ID scan and the
leases `ps` per lease (PR #2051), `deep find` lowercasing (hill-climb F1), readings' quadratic folds (F3), `Buyer.sync`
(F9), the OTLP attribute sort (F13), unbounded per-repo maps in `github/src/delivery.ts`.

---

## Findings, worst first

### ts-small-b-1  A Kani harness whose checker printed no check reads `passed`
- kind: broken
- confidence: LIKELY (Kani is not installed here; read from the parser alone)
- where: packages/proof/src/kani.ts:75-90, :129; packages/proof/src/run.ts:126-131 (`outcomeOf`)
- evidence: `report()` splits the output at `Checking harness <name>...`, pushes the name into `out.ran` (:75) and then
  reads `Check N:` blocks (:76). Failures and causes come only from those blocks. `r.status` is never read on this path.
  `kani()` passes `testsRun: v.ran.length` (:129) and `outcomeOf` returns `passed` when there are no failures, no causes
  and `testsRun > 0`. The file header says the runner "reads Kani's per-check report, never the harness's one-line
  verdict", so `VERIFICATION:- FAILED` and a non-zero exit are ignored on purpose.
- failure: `cargo kani` prints `Checking harness proofs::clamp_within...`, then CBMC is killed for memory or exits with
  an error before any `Check 1:` line. `checks` is `[]`, so no failure and no cause; the harness is in `ran`; the run
  is `passed` with one test run. A proof that checked nothing passes (invariant 2). `packages/proof/test/outcome.test.ts`
  covers only `testsRun === 0`.
- fix: in `report()`, after line 76:
  old → (nothing)
  new → `if (!checks.length) { out.causes.push({ theorem: h, why: 'unfound', line: \`${h} was not checked by Kani: it printed no check for it (cargo kani exited ${String(r.status)})\` }); continue; }`
  (`unfound` gives `ran_nothing`; the reason names the harness, as the kit's `hold` requires.)
- verify: a unit test beside `test/outcome.test.ts` that calls `report` (needs an export) or `kani`'s parser on the
  text `Checking harness proofs::a...\nCBMC failed\n` and expects `ran_nothing`. Fails before, passes after.
- risk: none for a harness with checks. The kit's `kani-proved` and seeded cases print checks. `proof` has no
  production importer yet (#1900), so this is latent.

### ts-small-b-2  A hook-written `session.end` never matches a lease's holder, so SessionEnd ends no lease
- kind: broken
- confidence: SURE for the mismatch, LIKELY for the effect (not run)
- where: packages/leases/src/index.ts:214; packages/hub/src/hookmap.ts:37-39, :429-430; packages/hub/src/heavy.ts:186, :211; packages/record/src/index.ts:491;
  packages/contracts/schemas/session.end@1.json (`required`)
- evidence: the fold names the holder
  `e.subject?.startsWith('session:') ? e.subject : e.session ? \`session:${e.session}\` : undefined`.
  The hub gives a hook event a `session:` subject only when `<kind>@1` requires one (`needsSubject`); `session.end@1`
  requires `v,id,kind,writer,actor,scope,ts,data` (checked with `node -e`), so a hook `session.end` has no subject and
  `e.session` is the raw session id (`record/src/index.ts:491`). Every lease holder is
  `session:${id.replace(/[^0-9A-Za-z]/g, '')}` (heavy.ts:186 and :211; `gate/src/exec.ts:83` takes the holder its caller built the same way). Claude Code and Codex session ids are
  UUIDs with dashes, so `session:3f2a-…` never equals `session:3f2a…`.
  Both test worlds append `session.end` with `subject: holder` (tests/acceptance/237/world.ts:59,
  packages/leases/test/table.test.ts:31), so they never take the fallback.
- failure: a Claude Code session with a leased background command ends (SessionEnd). `ends` holds
  `session:<uuid with dashes>`; `ended(h)` finds nothing for `session:<letters>`; the lease stays until the agent's
  pid is seen gone, or forever (stale) when the caller passed no `agent`. The header's "It ends when its holder has
  ended (its SessionEnd, …)" does not hold in production.
- fix: line 214
  old → `e.session ? \`session:${e.session}\` : undefined`
  new → `e.session ? \`session:${e.session.replace(/[^0-9A-Za-z]/g, '')}\` : undefined`
- verify: in `packages/leases/test/table.test.ts`, a lease held by `session:ab12`, then a hook `session.end` with
  `session: 'ab-12'` and no subject, then `tick()`: one `lease.released`. Fails before, passes after.
- risk: none for ids that are already letters and digits. No test pins the mismatch.

### ts-small-b-3  A holder's end is kept for good: a session that starts again loses its leases, and an unverified end counts
- kind: broken
- confidence: LIKELY
- where: packages/leases/src/index.ts:133 (`FOLDED`), :212-224, :361-365
- evidence: `ends.set(holder, e.id)` on `session.end`/`session.gone`; nothing removes it but the 64-entry trim, and
  `session.start` is not folded. `ended(h)` returns `this.ends.get(holder)` first. Elsewhere a session can start
  again after an end and an unverified end ends nothing: `resolver-decisions/src/index.ts:105-113`
  (`ended.delete(e.session)` on `session.start`; "Only a verified end counts: an unverified one ends nothing, as in
  the hub"), `hub/src/core.ts:3118` and `:5814` (the newest of `session.start`/`session.end` decides). The hub also
  writes `session.end` itself with a letters-only subject for a Codex process that exited (`core.ts:2734`), which
  does match a holder.
- failure: Codex exits, the hub records `session.end` (subject `session:<letters>`); the user runs `codex resume`
  on the same session; it takes a `cpu.slot`. On the next 1 s tick `ended(h)` returns the old end and, if no process
  of the lease's run is recorded as running yet, `end(h, [oldEnd])` releases the lease while its holder runs; the
  pool hands the slot to someone else.
- fix: add `'session.start'` to `FOLDED`; in `fold`, before the `session.end` case:
  `case 'session.start': { const holder = …same expression as line 214…; if (holder) this.ends.delete(holder); break; }`
  and at the top of the `session.end` case: `if ((e as { unverified?: true }).unverified) break;`
- verify: table test: `session.end`, `session.start`, lease, `tick()` → the lease is still held.
- risk: a `session.gone` the table itself wrote is cleared by a later start of the same id, which is the intent.
  No test appends a start after an end.

### ts-small-b-4  A judge's `"score": null` is read as a grade of 0
- kind: broken
- confidence: SURE
- where: packages/config-eval/src/launcher.ts:240; packages/config-eval/src/index.ts:261-264
- evidence: `grades.filter(isObj).map((g) => ({ label: String(g.label), score: Number(g.score) }))`.
  `node -e`: `Number(null)`, `Number('')`, `Number(false)`, `Number([])` are all `0`. `grade()` keeps any finite
  number from 0 to 1, and its comment says "A grade the judge didn't give stays missing."
- failure: the judge answers `{"grades":[{"label":"A","score":0.9},{"label":"B","score":null}]}` for an output it
  could not score. B's run gets `metrics.grade = 0`, a measured zero, and the comparison counts it against that side.
- fix: line 240
  old → `score: Number(g.score)`
  new → `score: typeof g.score === 'number' || (typeof g.score === 'string' && g.score.trim() !== '') ? Number(g.score) : NaN`
- verify: `packages/config-eval/test/judge.test.ts` has a fake judge; a case that prints `"score":null` expects
  `metrics.grade` null. Fails before (0), passes after.
- risk: none; `grade()` already turns NaN into null. No test pins null → 0.

### ts-small-b-5  A verdict made after a hub restart never finds the commit pushed before it
- kind: broken
- confidence: LIKELY
- where: packages/github/src/delivery.ts:96-101 (`keep`), :163-173 (`deliver`), :273-286 (`readRepo`)
- evidence: `w.trees` (tree → pushed commit) lives in memory and is filled only from ref changes newer than
  `state.seen[repo]`, which is saved to `github.json`. `deliver` posts when the verdict's commit is on a
  remote-tracking ref; otherwise it holds the verdict under its tree and sets `sha` only if `w.trees` has the tree.
  `packages/github/test/github.test.ts:46` covers "verdict held, restart, then push", not the other order.
- failure: the agent pushes commit C; the hub reads the push (`seen` advances); the hub restarts (`w.trees` is
  empty); the agent says done; the verdict is on snapshot S whose tree equals C's. `pushed(S)` is false, `w.trees`
  has no entry, and no later ref change brings that tree. The `deepbuild/verdict` status is never posted and the
  entry is dropped after 30 days.
- fix: in `deliver`, when `watch(repo).trees` has no entry, look at the clone's remote-tracking tips before holding:
  `const tips = lines((await git(row.cwd, ['for-each-ref', '--format=%(objectname) %(tree)', 'refs/remotes/origin'])).out); const hit = tips.map((l) => l.split(' ')).find(([, t]) => t === tree)?.[0];`
  and use `hit` as `sha` when present.
- verify: extend the test at github.test.ts:46: push first, `pass()`, reopen, then the verdict → one status on the
  pushed commit.
- risk: a tip with the same tree as the snapshot gets the status, which is what the existing tree rule already does.

### ts-small-b-6  One `compare` call that keeps timing out stops a repo's ref changes from ever being read
- kind: broken
- confidence: LIKELY
- where: packages/github/src/pushes.ts:28 (`AbortSignal.timeout(4000)`), :59-63 (`commitsOf`); packages/github/src/delivery.ts:279-285, :303-309
- evidence: `readRepo` walks changes oldest first and saves `state.seen[repo] = change.id` only after
  `commitsOf` returns. `commitsOf` turns a 404 into "no commits" and rethrows everything else. `pass()` catches the
  throw and logs it once per distinct message.
- failure: a push whose `GET /repos/…/compare/a...b` takes more than 4 s (a large first push or an import; the
  answer carries file patches) aborts every time. `seen` stays before it, so each pass retries the same change and
  no later ref change of that repo is read: no `ref.unguarded`, no `pushed`, no tree for held verdicts.
- fix (smallest): in `readRepo`, treat a compare that failed without a rate limit as "no entry", which head trust
  already reads as untrusted:
  old → `keep(w, await commitsOf(rest, repo, false, w.base!, change));`
  new → `keep(w, await commitsOf(rest, repo, false, w.base!, change).catch((error: unknown) => { if (error instanceof ForgeRefused && error.retryAt !== undefined) throw error; return []; }));`
- verify: github.test.ts with the fake forge stalling one compare: the next change is still read.
- risk: a transient 5xx on compare now leaves that push's commits out of `w.pushes` (untrusted, the safe side;
  `trusted()` re-reads through `pushesWithForks` when a commit is missing). QUESTION for the lead whether a bounded
  retry is wanted instead.

### ts-small-b-7  Against api.github.com no CI run is ever archived, and one unreadable log blocks every older run
- kind: broken
- confidence: QUESTION (the off-origin refusal is pinned by `packages/archive/test/forge-boundary.test.ts:21`, and
  PR #1775's report says it "fails closed"; it does not say what that means for the default forge)
- where: packages/archive/src/index.ts:290-306 (`get`), :307-325; packages/hub/src/core.ts:1180 (`forge.api` default)
- evidence: `get` throws `the forge redirected outside its declared origin` when a redirect leaves `forge.api`'s
  origin. GitHub's `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` answers 302 to a storage host (its REST
  doc: "Returns a redirect URL"). The loop at :313-322 throws at the first job log, `ci.archived` is never appended,
  and `pass()` rejects with an AggregateError on every pass for any repo with a completed run. Separately, on a
  same-origin forge a job whose log answers 404 or 410 (a skipped job, an expired log) throws at :303 each pass; the
  walk stops there, and once a full page of newer runs is copied `if (!listed.length || !fresh.length) break` never
  reaches the older ones again.
- failure: README line 5 says the archive "copies completed CI runs before the forge deletes them"; with the
  default `https://api.github.com` it copies none.
- fix: needs the owner's call (it loosens a boundary a test pins): allow the one hop a log download makes, without
  the `authorization` header, to a host the forge names; and treat 404/410 on a job's log as "no log kept" for that
  job. Not a hand edit.
- verify: `forge-boundary.test.ts` with a fake forge that redirects logs to a second origin.
- risk: credential leak if the header follows the redirect; the fix must drop it.

### ts-small-b-8  With no cases of your own, every standing rule reads "widen" and none can FAIL
- kind: broken
- confidence: QUESTION (the formula is the design's; the acceptance property generates `yours.cases >= 1` only)
- where: packages/resolver-decisions/src/rules.ts:36, :41-45; packages/hub/src/core.ts:1274 (margin 1.5), :1283-1284;
  packages/asks/src/index.ts:2444 (`widen: 'active'`)
- evidence: `upper(broke, cases)` is `1` when `broke >= cases`, so `upper(0, 0) = 1`; `limit = 1 * 1.5`. Then
  `bounds.lower > limit` is never true and `bounds.upper <= limit` always is. `evidence()` gives `yours` =
  the asks of the rule's key you answered yourself in the window; once a rule answers that kind for you, that
  is usually none.
- failure: a rule decided 10 asks in the window and all 10 broke; you answered none of that kind yourself.
  `judge({cases:10,broke:10},{cases:0,broke:0},1.5)` → `widen` → state `active`. Nothing is measured on your side
  and the rule passes (invariant 2). The same holds for `yours.cases` of 1 or 2 with no breakage (bounds 0.95 and
  0.776, limits above 1), but `tests/acceptance/23/rules/margin.test.ts` pins those.
- fix: rules.ts:42, before the two verdict lines:
  `if (yours.cases === 0) return { verdict: 'undecided', rule: bounds, yours: mine, limit, more: null };` (move the
  `bounds` line above it).
- verify: a case in `packages/resolver-decisions/test/resolver.test.ts`: `judge({cases:10,broke:10},{cases:0,broke:0},1.5).verdict` is not `widen`.
- risk: `more: null` on `undecided` is new; `asks.judged` stores it as given. The acceptance property never draws 0.

### ts-small-b-9  A paid check that failed once asks "run it again" forever, even after a later pass
- kind: broken
- confidence: LIKELY
- where: packages/budget/src/index.ts:266-269, :478, :503-506
- evidence: `failed.set(sameInputs(...), e.log_pos)` on a `run.finished` that isn't `passed`; nothing deletes it.
  `rerunYes` is deleted when the re-run reserves (:478). The ask's words: "on the same inputs, whose last paid run
  didn't pass".
- failure: check X fails on inputs I; you say yes; the re-run passes. The next run of X on I (a second clean run
  the check needs) finds `failed(I) > rerunYes(none)` and asks again, saying the last paid run didn't pass, which is
  false. `packages/budget/test/budget.test.ts:141` covers only a second request before the re-run finishes.
- fix: :503-506
  old → `if (run && d.outcome !== PASSED) this.failed.set(sameInputs(run.check, run.inputs), e.log_pos);`
  new → `if (!run) return; if (d.outcome === PASSED) this.failed.delete(sameInputs(run.check, run.inputs)); else this.failed.set(sameInputs(run.check, run.inputs), e.log_pos);`
- verify: budget.test.ts: fail, yes, re-run, `finished(passed)`, request again → `started`.
- risk: two runs on the same inputs finishing out of order (fail, then an older run's pass) clear the mark; the
  ask's own word is "last", which matches.

### ts-small-b-10  Answers placed in a paseo session are not reported when another answer arrives during the send
- kind: broken
- confidence: LIKELY
- where: packages/paseo/server/plugin.ts:136-141
- evidence:
  `await handle(a)!.send(…).catch(() => { a.held.unshift(...words); });`
  `if (asks.length && !a.owner && !a.held.length) await report(a, asks, …);  continue;`
  `!a.held.length` stands for "the send did not fail", but `listen()` pushes to `a.held` at any time.
- failure: the send succeeds while `listen()` pushes a second answer. `a.held.length` is 1, so `session.delivered`
  is never sent for the first asks; the hub keeps them undelivered and hands them over again (the same words twice).
  Also, when `send` keeps failing, the loop retries with no sleep until the snapshot fails.
- fix:
  old → `.catch(() => { a.held.unshift(...words); });` and `if (asks.length && !a.owner && !a.held.length)`
  new → `let sent = true;` before it, `.catch(() => { sent = false; a.held.unshift(...words); });`,
  `if (!sent) { await sleep(POLL_MS); continue; }`, `if (asks.length && !a.owner)`
- verify: `tests/acceptance/55` drives the plugin; a regression that pushes an answer from inside the fake
  `send` and expects two `session.delivered` calls.
- risk: none seen; the failed-send path still re-queues.

### ts-small-b-11  A judge or agent CLI that exits before reading its prompt can crash the eval
- kind: broken
- confidence: LIKELY (Node's behavior: a stream `'error'` with no listener throws)
- where: packages/config-eval/src/launcher.ts:32-56
- evidence: `child.stdin!.end(prompt)` with no `'error'` listener on `child.stdin`. `child.on('error')` covers a
  failed spawn only. The judge's prompt holds up to `2 * repeats` outputs of 20,000 characters, past a pipe's buffer.
- failure: `codex exec` exits at once (not signed in, bad model). The rest of the prompt gets EPIPE, emitted as
  `'error'` on `child.stdin`, unhandled, and the process running `runEval` dies instead of `grade()` catching a
  rejected judge call.
- fix: before line 56 add `child.stdin!.on('error', () => undefined);`
- verify: `packages/config-eval/test/launcher.test.ts` uses fake executables: one that exits 1 without reading
  stdin, with a 200 KB prompt; `runCli` resolves with `[]`.
- risk: none; the exit and close handlers still end the run.

### ts-small-b-12  comparator dying is read as the kernel refusing each theorem "at its obligation"
- kind: broken
- confidence: QUESTION (comparator's exit codes can't be checked here)
- where: packages/proof/src/lean.ts:152, :165-170; packages/proof/src/index.ts:34-42 (`runBase`)
- evidence: any status that isn't 0 or 2, `null` included (`spawnSync` gives `status: null` for a signal), adds a
  failure per theorem with `assertion: true` and the message `comparator exited null`. `runBase` reads
  `assertion && spec.theorems.includes(f.test)` as "the checker refused it on the base", which proves a fix.
- failure: on the base run comparator is killed (memory). The base reads `failed, on_assertion: true`, so the fix
  check counts as proven by a run that judged nothing.
- fix: lean.ts:152
  old → `if (c.status === 2) throw new Missing(…)`
  new → `if (c.status === 2 || c.status === null) throw new Missing(\`comparator ${c.status === null ? 'was stopped by a signal' : 'could not start'}: …\`)`
- verify: by hand with Lean installed (`tests/acceptance/685`); no unit seam exists.
- risk: latent like ts-small-b-1.

### ts-small-b-13  A read that fails while checking head trust drops the verdict's status as "refused"
- kind: broken
- confidence: LIKELY
- where: packages/github/src/delivery.ts:133-148 (`post`), :117-131 (`trusted`); packages/github/src/pushes.ts:99-107
- evidence: `post` wraps `o.posts`, `trusted()` and the POST in one `try`. Its catch returns `true` ("needs nothing
  more") for any `ForgeRefused` under 500 with no retry time, and logs "status … was refused". `trusted()` calls
  `pushesWithForks`, which reads `/repos/<fork>/activity` for every fork with an open pull request.
- failure: one fork is private to the read token (404). Every verdict whose head holds a commit not yet in
  `w.pushes` throws that 404 from the read, and its status is dropped for good with a message that blames the POST.
- fix: in `trusted`, `keep(w, await pushesWithForks(rest, v.repo).catch((error: unknown) => { if (error instanceof ForgeRefused && error.status < 500 && error.retryAt === undefined) return []; throw error; }))`
  so an unreadable fork leaves its commits without an entry (untrusted, a pending status) instead of no status.
- verify: github.test.ts with a fake fork that answers 404: the status is posted `pending: untrusted head`.
- risk: none on the trusted side; missing entries read untrusted.

### ts-small-b-14  A journal line a crash cut short also loses the next record written
- kind: broken
- confidence: LIKELY
- where: packages/evidence/src/index.ts:166-173, :183-192
- evidence: the loader skips an unparsable line ("a line a crash cut short"), and `note` appends
  `${JSON.stringify(entry)}\n` to whatever the file ends with. Nothing ends a cut line first.
- failure: the file ends `…{"sha256":"ab` with no newline. The next put appends its record onto that line; on the
  next open the joined line fails to parse, so that put's file is on disk with no index entry: `get` is undefined,
  `send` says missing, and `retain` never removes the file.
- fix: after line 166, when not read-only:
  `const raw = …the text read…; if (!options.readOnly && raw && !raw.endsWith('\n')) await appendFile(journal, '\n');`
  (import `appendFile` from `node:fs/promises`).
- verify: `packages/evidence/test/evidence.test.ts`: write a journal ending in half a line, open, put, reopen,
  `get` returns the record.
- risk: none.

### ts-small-b-15  The store's refusal names three media types; it takes four
- kind: inconsistent
- confidence: SURE
- where: packages/evidence/src/index.ts:265; packages/evidence/src/intake.ts:1, :24-28
- evidence: `the bytes are ${found ?? 'not png, jpeg or mp4'}`; `MediaType = 'png' | 'jpeg' | 'mp4' | 'webm'` and
  `detect` returns `webm`. `rg "not png, jpeg or mp4"` over the checkout: this line only, no test.
- fix: old → `'not png, jpeg or mp4'`  new → `'not png, jpeg, mp4 or webm'`
- verify: diff review.
- risk: none.

### ts-small-b-16  The same bytes put again without a declared type lose their "truncated" mark
- kind: broken
- confidence: LIKELY (no production caller of `admitBaseline` today: `rg admitBaseline packages/*/src` finds only the store)
- where: packages/evidence/src/index.ts:229-237, :293-298
- evidence: `save` writes `intake: missing ? 'truncated' : 'captured'` from the current call only. The comment says
  "The same bytes keep the most cautious origin and label any writer gave them", and origin and redaction do; intake
  and `missing` don't.
- failure: half a PNG is put with `declares: 'png'` (truncated); the same bytes are put with no `declares`
  (`binary`, captured). `admitBaseline` now resolves for a file the interface says "never becomes a baseline".
- fix: line 235
  old → `intake: missing ? 'truncated' : 'captured', ...(missing && { missing }),`
  new → `intake: missing || earlier?.intake === 'truncated' ? 'truncated' : 'captured', ...((missing ?? earlier?.missing) && { missing: missing ?? earlier?.missing }),`
  and return the slot from the record's `intake`.
- verify: `tests/acceptance/15/intake.test.ts` style case in `packages/evidence/test/`: put truncated, put again as
  binary, `admitBaseline` rejects.
- risk: none seen; identical bytes can't become whole.

### ts-small-b-17  budget's README says four packages call `openLedger`; one does
- kind: inconsistent
- confidence: SURE
- where: packages/budget/README.md:5
- evidence: "The runner, the hub, buying and resolver-decisions call `openLedger`." `rg "openLedger\(" packages/*/src`:
  only `packages/hub/src/core.ts:1096` (and the definition). The runner, buying and resolver-decisions take a `Ledger`
  in their options.
- fix: old → `The runner, the hub, buying and resolver-decisions call \`openLedger\`.`
  new → `The hub opens it (\`openLedger\`) and hands the ledger to the runner, buying and resolver-decisions.`
- verify: diff review. risk: none.

---

## Nits (one line each)

1. packages/verdicts/src/contract.ts:16: `|a − e| ≤ atol + rtol·|e|` is true for a finite `a` against `e = ±Infinity` when `rtol > 0` (`node -e`: `Math.abs(5-Infinity) <= 1e-6 + 1e-5*Infinity` → true). `runContract` has no production caller (acceptance 28 only). QUESTION.
2. packages/config-eval/src/archive.ts:76-79: a first prompt with no parsable `timestamp` is skipped as "its folder … is no git checkout on this machine". SURE, wrong reason text.
3. packages/reading/src/plan.ts:1, :8 and index.ts:56 say "share" for `five_hour_pct`; the runner stores `used_percent` and `reading.finished@1` says "Percentage points", 0 to 100. Wording only.
4. packages/leases/src/index.ts:332: `${kind.cooldown / 60_000} min` prints `0.08333333333333333 min` for a 5 s cooldown.
5. packages/pi/src/index.ts:517: `JSON.parse(reply.stdout)` unguarded in `agent_before_settle`; the paseo twin guards it (`parsed`, plugin.ts:28).
6. packages/otlp/src/doctor.ts:46 hard-codes `4318`; index.ts:17 has `DEFAULT_PORT = 4318`. Two constants, same value.
7. packages/archive/README.md:9 says what was copied is "never kept in memory"; index.ts:186-189 keeps `copied`, `runs`, `alerted` in memory, loaded from the record. Wording.
8. packages/evidence/README.md:5 lists its users without `checks-journey` (`src/index.ts:16`, `src/replay.ts:5` import it).
9. Test-only workspace imports not declared: `wiki/test` and `buying/test` import `@deepbuild/evidence`, `resolver-decisions/test` imports `@deepbuild/contracts`; `config-eval` declares the same case under `devDependencies`. Hoisting hides it.
10. packages/readings/src/usage.ts:20: `SHIPPED_RATE_CARD` is exported and named nowhere outside this file (`rg -lw SHIPPED_RATE_CARD packages scripts tests benchmarks docs adapters packs crates`: usage.ts only). The `export` is unneeded.
11. packages/readings/src/baseline.ts:101-103: `recomputeBaseline` does not refuse a window that parses to NaN (`baselineMessages` does, :83); a transcript with no timestamps is then counted whole under `{from: NaN, to: NaN}`.
12. packages/sources/linear/index.ts:13-15: `comments { nodes }` and `memberships { nodes }` are read with no paging; past the provider's page size `find` can miss its marker (a second comment) and a member reads `outside`. QUESTION; packages/sources/gmail/index.ts:60 skips a listed message whose read isn't 200 (same class as #1889).
13. packages/buying/src/index.ts:151: the first rule that fits wins and rules are never replaced, so a later, lower `max_usd` for the same seller does not lower the limit. QUESTION (no way to revoke a card rule exists).

## Seen outside this area (not traced to the end)

- packages/hub/src/core.ts:7506-7517: a paid check reserves (`ledger.request`) and then `builtOutside` or `runs.start` can throw; nothing charges the reservation, so its room is held until the budget ends.
- packages/gate/src/scheduler.ts:358, :465, :485 call `moreRuns` with `runs` only; a check that declares `accept` gets one run while `verdicts`' `judge` needs `runsNeeded(c)` clean runs.
- adapters/claude-code.facts.json `modelFamily.families` lists exact ids; a dated or newer id folds to `other` in `packages/otlp/src/index.ts:47-50`.

## Coverage

| Package | Read in full | Skimmed | Not read |
|---|---|---|---|
| evidence | `src/index.ts`, `intake.ts`, `patterns.ts`, `scrub.ts`, `fields.ts` (read once; its heuristics were not traced case by case), `package.json`, `README.md` | `test/evidence.test.ts` (names), `test/webm.test.ts` | `gitleaks/gitleaks.toml` (vendored, 3,209 lines), `gitleaks/LICENSE` |
| verdicts | all of `src/`, `package.json`, `README.md`, `tsconfig.json` | `test/` (names and the lines that pin the chat line) | `model/*.lean`, `lakefile.toml`, `lake-manifest.json` (Lean model, not checked) |
| config-eval | all of `src/`, `package.json`, `README.md` | `test/judge.test.ts`; other tests by name | rest of `test/` |
| reading | all of `src/`, `package.json`, `README.md`, `test/plan.test.ts` | `test/slicer.test.ts` (greps) | other tests |
| readings | all of `src/`, `package.json`, `README.md` | tests by name | test bodies |
| pi | `src/index.ts`, `tools.mjs`, `package.json`, `README.md`, `tsconfig.json` | — | `test/guards.test.ts`, `test/lifecycle.test.ts` |
| proof | all of `src/` (`kit.ts` judge and planted fills read, fixtures list skimmed), `test/outcome.test.ts`, `package.json`, `README.md` | — | `fixtures/` (Kani crate and Lean package) |
| budget | `src/index.ts`, `package.json`, `README.md` | `test/budget.test.ts` (names, one case) | — |
| otlp | all of `src/`, `package.json`, `README.md` | tests by name | test bodies |
| github | all of `src/`, `package.json`, `README.md` | `test/github.test.ts` (first case read) | — |
| wiki | `src/index.ts`, `package.json`, `README.md` | tests by name | test bodies |
| leases | `src/index.ts`, `package.json`, `README.md` | tests (names, the `session.end` helpers) | — |
| archive | `src/index.ts`, `package.json`, `README.md` | tests by name | test bodies |
| resolver-decisions | all of `src/`, `package.json`, `README.md` | tests by name; `fixtures/keys.json` (head) | — |
| paseo | all files | — | — |
| buying | `src/index.ts`, `package.json`, `README.md` | — | `test/card-numbers.test.ts` |
| workspaces | `src/index.ts`, `package.json`, `README.md` | — | `test/api-origin.test.ts` |
| sources | `README.md`, `gmail/*`, `linear/index.ts` | `linear/deepbuild.json` (diffed against gmail's) | — |
| channels | `README.md`, `chat/*`; `email`, `paseo`, `text` by diff against `chat` (they differ in name, kind and digest only) | — | — |

Not reached: the Lean model under `packages/verdicts/model` against the engine; the field-name scrub's cases one by
one; most test bodies. Per-package `tsconfig.json` files were read for verdicts, pi and paseo only; the rest were not opened.
