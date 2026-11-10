# hub-rest: findings

Area: `packages/hub/` except `src/core.ts`, `server.ts`, `gate-runner.ts`, `hookmap.ts`, `log-reads.ts`, `index.ts`.
Checkout: `the checkout` at 06fd33cd. Read-only. Nothing was run
but `rg`, `git log`, `wc`, `ls` and a few pure `node -e` snippets (two proofs, quoted where used, and three reads of
JSON keys). No test was run, so every "verify" line is a check that was not run.

How it was read: the area is about 1.27 MB of source. Two sub-readers took the largest files (part A six, part B
twelve; merged below and re-checked where marked); the lead reader read the other 80 in full. A third sub-reader could not be
started (the session's agent limit), so its files were read by the lead reader; what was not reached is in the
coverage table.

Layout: the ranked index below covers all three sets. Then the lead reader's findings in full (`HUBREST-1` to
`HUBREST-15`), its nits, part A in full (`HUBREST-A1` to `HUBREST-A20`), part B in full (`HUBREST-B1` to
`HUBREST-B13`), and the coverage table. Parts A and B are the sub-readers' own text; the lead reader re-read the quoted
lines of the ones marked "re-checked" in the index and found them as quoted. The others are as the sub-reader reported
them.

Counts, all three sets (48 findings): broken 39, inconsistent 8, unneeded 1, inefficient 0. By confidence: SURE 9 (HUBREST-1, -2, -9 for its first half, -11 for its texts; A4, A7; B1, B2, B3), LIKELY 29, QUESTION 10. Lead reader alone (15): broken 13, inconsistent 2; SURE 4, LIKELY 8, QUESTION 3.

## Ranked index, worst first

| # | ID | Confidence | One line | Where |
|---|---|---|---|---|
| 1 | HUBREST-1 | SURE | A second `deep setup` with a moved deep-hook saves our own status line forwarder as "yours": your status line is lost and deep-hook runs itself without end | `setup.ts:250-259` |
| 2 | HUBREST-2 | SURE | A failed copy is forgotten when another copy finishes after it; the discard runs as "staged" | `staging.ts:133-147` |
| 3 | HUBREST-A4, -B2, -B3 | SURE (re-checked) | Five detached promises with no catch: a failed ask, append or wiki clean-up is an unhandled rejection, which stops the hub's core | `agents.ts:733`, `runs.ts:414,428`, `wiki-build.ts:551`, `acceptance.ts:270` |
| 4 | HUBREST-B1 | SURE (re-checked) | `events.push(...fresh)` throws at about 490,000 rows after the cursor moved: readings lose all earlier history | `numbers.ts:80-82` |
| 5 | HUBREST-A1 | LIKELY (re-checked) | `deep undo sync:` compares against the plan-time digest: it leaves our entry in, or deletes a file you made | `agents.ts:683,698,830-833` |
| 6 | HUBREST-3 | LIKELY | `deep setup` writes back a copy of `~/.claude.json` read minutes earlier | `setup.ts:82-133` |
| 7 | HUBREST-A2, -A3 | LIKELY (re-checked) | A skill update forgets unchanged files; a restore of several items lands only the first | `agents.ts:561,566,743` |
| 8 | HUBREST-5 | LIKELY | `setup.json` written in place; a cut write makes undo "restore" our own entries | `agent-files.ts:130-132` |
| 9 | HUBREST-A7, -A6, HUBREST-8 | SURE / LIKELY (re-checked) | Push guards misread `git push 2>&1`, `+branch`, `--all`, and an `--auto` merge with no PR number | `holds.ts:61,73,217`, `named.ts:39-40` |
| 10 | HUBREST-6 | LIKELY | An entry folder the index doesn't name makes every later build of that key fail after it ran | `products.ts:467-469` |
| 11 | HUBREST-7 | LIKELY | `splice(-1)` drops another `deep lease` waiter; an unknown ticket is read as a new lease with no kinds | `heavy.ts:285,203-215` |
| 12 | HUBREST-A10, -A11 | LIKELY | A rebuilt run journal reruns a kept run beside itself; a start that failed early runs at the next hub start | `runs.ts:183-195,246-251,450-467` |
| 13 | HUBREST-B4 | LIKELY | Two `wiki.build` calls at the reserve read later batches with two paid jobs | `wiki-build.ts:130,531` |
| 14 | HUBREST-B5, -B6 | LIKELY (re-checked) | A channel that answers nothing is resent four times a second; a rule fetch that throws stays "held" for good | `channels.ts:265-270`, `libraries.ts:222-223` |
| 15 | HUBREST-A5, -A9 | LIKELY | Two `deep start` at once both pass `at_once`; a started run can't be linked after a restart | `starts.ts:252-303,89-104` |
| 16 | HUBREST-9 | SURE / LIKELY | "in 30s" sets no wake-up; "look at 3 files" sets one for 03:00 | `promises.ts:17,23,42-44` |
| 17 | HUBREST-10 | LIKELY | After a restart the product store reads live worktrees as idle | `products.ts:519-526,572-574` |
| 18 | HUBREST-B10, -B9 | LIKELY | A dispute with a missing redraft settles "stands"; review threads past 100 are never read | `acceptance.ts:172-176,395-403`, `open-items.ts:28-30` |
| 19 | HUBREST-A12 to -A15 | LIKELY | Sync stuck "applying"; skill file mode never updated; silent daemon restart failure; staged copies of `~/.claude.json` never removed | `agents.ts:662,709,955,563` |
| 20 | HUBREST-11, -B11, -B7, -A8 | SURE / LIKELY | Things that should agree and don't: Codex home in health texts; which files reserve commits; thumbnail comment; started sessions' branch name against the map's `issue-<n>` | `codex-settings.ts:322,353`, `questions.ts:88`, `libraries.ts:170`, `starts.ts:487` |
| 21 | HUBREST-12, -15, -B8 | LIKELY | Doctor reads Node under Homebrew as "a checkout"; the canvas core's child has no error handler; never-ending patterns miss `tail -n 100 -f` | `doctor.ts:205-221`, `canvas.ts:137-160`, `waits.ts:30` |
| 22 | HUBREST-4, -13, -14, -A16 to -A20, -B12, -B13 | QUESTION | launchd keeps a loaded job's old definition (a test pins the kickstart); paseo undo; where `done.yaml` is read; and the sub-readers' questions | see each |

## Findings, worst first (lead reader's files)

### HUBREST-1  A second `deep setup` with a moved deep-hook saves DeepBuild's own status line forwarder as "yours": your status line is lost and deep-hook then runs itself without end
- kind: broken
- confidence: SURE (from the code; not run)
- where: `packages/hub/src/setup.ts:250-259` (`withStatusLine`), `packages/hub/src/setup.ts:107,124` (the hook path), `packages/hub/src/paths.ts:205-215` (`deepHook`: the newer of `target/release` and `target/debug`), `crates/deep-hook/src/main.rs:1607-1618` (runs `statusline.yours`, no guard), `packages/hub/src/claude-settings.ts:110` (the only place that recognises an older forwarder)
- evidence: `withStatusLine` treats the line as ours only on exact equality: `if (line?.command === ours) return settings;`, and otherwise `if (typeof line?.command === 'string') c.statusline = { ...statusline, yours: line.command };`. `ours` is `` `${q(hook)} statusline` `` and `hook` is `installedPrograms(root)?.hook ?? builtHook()`; `builtHook` returns `deepHook()`, which picks whichever of `target/release/deep-hook` and `target/debug/deep-hook` has the newer mtime, or `target/debug/deep-hook` after its own cargo build, or the installed version's `versions/current/bin/deep-hook`. Hook entries survive a moved path because `withHooks` removes every command the earlier `claude-hooks.json` recorded; the status line has no such record. deep-hook's `statusline()` reads `statusline.yours` from `~/.deepbuild/config.json` and spawns it with no check that it is not itself. Greps: `rg "statusline\.yours|yours:" packages tests crates/deep-hook/src` finds no test of a second setup with another hook path (`tests/acceptance/19/setup/uninstall.test.ts:83` and `18/install/coexist.test.ts:26` run setup with one path).
- failure: setup from a checkout whose newest build is `target/debug/deep-hook`, with your own `statusLine.command = "my-line"`: config.json gets `statusline.yours = "my-line"`. Build release (`cargo build --release -p deep-hook`), or promote/install a version, then run `deep setup` again. Now `line.command` is `'/repo/target/debug/deep-hook' statusline`, not equal to the new `ours`, so `statusline.yours` becomes `'/repo/target/debug/deep-hook' statusline` and "my-line" is gone from every file. Each status line render then runs release deep-hook → debug deep-hook → debug deep-hook → …: every level reads the same `statusline.yours` and spawns it again, each waiting on its child, until the process table fills. `deep setup --undo` on an edited settings file then "restores" `statusLine.command` to the deep-hook command.
- fix: in `withStatusLine`, treat an earlier forwarder as ours and keep `statusline.yours` as it is. After `setup.ts:252` (`if (line?.command === ours) return settings;`) add:
  `// An earlier setup's forwarder at another path: yours stays as that setup kept it.`
  `if (typeof line?.command === 'string' && /deep-hook\S*'? statusline$/.test(line.command)) return { ...settings, statusLine: { ...line, command: ours } };`
  (the regex is the one `withoutOurs` uses at `claude-settings.ts:110` and `doctor.ts:179`; export it once from `claude-settings.ts`).
- verify: a unit test in `packages/hub/test` that runs `deep setup` twice in a temp home with two hook paths and reads `config.json`'s `statusline.yours`: before the fix it holds the first forwarder, after it holds the user's command.
- risk: none found for required behavior: with one hook path the new branch is never taken. No test pins the current result.

### HUBREST-2  Staging a discard: one file whose copy failed is forgotten when another copy finishes after it, and the command runs as "staged"
- kind: broken
- confidence: SURE (semantics proven with a snippet; not run in the hub)
- where: `packages/hub/src/staging.ts:133-147` (`stageFiles`, the `copier`), `:229-231` (undo's digest check)
- evidence: eight copiers share `why`: `why ??= Date.now() > deadline ? 'late' : await lost[k]!.write(to, deadline); if (!why) digests[k] = await digestOf(to);`. `a ??= await b` reads `a` before the await and assigns after it without reading again. So a copier that started while `why` was unset, and whose own copy succeeds, assigns `undefined` over a failure another copier stored meanwhile. Snippet (two copiers, file 0 fails after 10 ms, file 1 succeeds after 30 ms), same statement shape: `node -e "…why ??= await write(k); if(!why) digests[k]='d'+k…"` prints `{"why":"undefined","digests":[null,"d1"]}`. With `why` unset again the `while (next < lost.length && !why)` loops go on, `if (why)` at :143 is false, and `record()` writes `command.staged` with `files: [{ path, digest: undefined }, …]`; `gate` returns `{}` and the command runs.
- failure: `git checkout -- .` over two or more edited files, one of which deep-hook's clone can't copy (unreadable, gone between `git status` and the clone, a file system that refuses that one clone) while another clone is still in flight. The discard runs with no copy of that file. `deep undo staged:<id>` then passes the digest check for it (`undefined !== undefined` is false) and fails at the clone: the file is lost, where the design says a copy that can't be made turns the command into an ask.
- fix: `staging.ts:138-139`, old → new:
  `why ??= Date.now() > deadline ? 'late' : await lost[k]!.write(to, deadline);`
  `if (!why) digests[k] = await digestOf(to);`
  →
  `const failed = Date.now() > deadline ? 'late' : await lost[k]!.write(to, deadline);`
  `if (failed) { why ??= failed; return; }`
  `digests[k] = await digestOf(to);`
- verify: a unit test of `Staging.gate` with `edits` over two files and a deep-hook stand-in whose `clone` fails for the first and sleeps then succeeds for the second: today the gate returns `{}`; after, it returns `held`. `tests/acceptance/1294` should stay green.
- risk: none found; a failure now always stands, which is what :143-146 already expects.

### HUBREST-3  `deep setup` reads `~/.claude.json` and `settings.json` first and writes them back after every slow step, so anything Claude Code wrote meanwhile is lost
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/setup.ts:82-99` (read), `:102-123` (the steps between), `:124-125,129-133` (write)
- evidence: `planned.set(file, read.value)` at :98 is taken before `draftAskSettings`, `recordLoginPath` (a login shell, up to 5 s), `enrollConfirm` (waits on the Secure Enclave), `builtHook()` (`cargo build`, `timeout: 900_000`), `installCodex`, and `installPaseo` (`paseo plugin install`, `timeout: 300_000`). Then `writeJson(userFile, { ...user, mcpServers: … })` writes the object read at :89. `~/.claude.json` is Claude Code's live state file (projects, trust, MCP servers); a running session rewrites it often.
- failure: a Claude Code session is open while `deep setup` runs a first-time cargo build (minutes). You accept a folder's trust dialog or `claude mcp add` a server in that window. Setup's write puts back the copy from before: the trust and the server are gone. (`keepOriginal` at :114 reads the bytes late, so the copy kept for undo is the newer one; the file itself is the older one plus our entries.)
- fix: read each file again, strictly, right before its write, and merge into that: a helper `fresh(file)` that does what :84-98 does and throws `${file} ${read.refused}`; use it at :124 (`withHooks(root, fresh(settingsFile), groups)`) and :129 (`const user = fresh(userFile)`). Keep the early parse as the "refuse the whole setup" gate. The `catch` at :141 already reports and stops.
- verify: a test whose stand-in deep-hook `--help` adds a key to `~/.claude.json`; assert the key survives setup. Fails before.
- risk: the planted wrong program `setup-last-duplicate-wins` must use `lenient` in the helper too. The window shrinks from minutes to microseconds; it does not close.

### HUBREST-4  macOS: `deep hub start` rewrites the launchd plist, but an already-loaded job keeps its old definition
- kind: broken
- confidence: QUESTION (launchd's behavior is from knowledge, not run here; and `packages/hub/test/onboarding.test.ts:140-146` pins the kickstart: "starts its own job again when that job is the one loaded" expects `kickstart <own plist>` from a stand-in `launchctl`)
- where: `packages/hub/src/service.ts:163-173` (darwin branch of `launch`), against `:174-186` (linux: `daemon-reload` first); reached from `startHub` (`:216`) and `promote.ts:123` (`up`)
- evidence: `launchctl bootstrap` of a label that is already bootstrapped fails and re-reads nothing; the code then runs `launchctl kickstart`, which starts the definition launchd already holds. The plist on disk was just rewritten (`startService`, :196). The job stays loaded after a clean `hub.stop`, since `KeepAlive.SuccessfulExit=false` only stops restarts. The linux branch re-reads the unit with `systemctl --user daemon-reload` before `enable --now`.
- failure: (a) the hub was set up from a checkout (`ProgramArguments = [node, …/packages/cli/dist/main.js, hub, run]`); the first `deep hub promote` stops it, switches `current`, writes a plist naming `versions/current/bin/deep`, bootstrap fails "already loaded", kickstart starts the checkout's CLI again; that hub answers `hub.check` with PASS, and promote prints "<commit> is in" while the login service still runs the checkout until the next login. `deep doctor` reads the plist file and says "runs a promoted build". (b) the checkout moved or PATH changed: every `deep hub start` ends "no hub answered … within 15 s".
- fix: when the label is loaded from this same file, boot it out and bootstrap again instead of kickstart. `service.ts:171-172`, old → new:
  `const kicked = run('launchctl', ['kickstart', \`${domain}/${LABEL}\`]);`
  `return kicked.status === 0 ? undefined : \`launchctl: ${loaded.stderr.trim()} ${kicked.stderr.trim()}\`;`
  →
  `run('launchctl', ['bootout', \`${domain}/${LABEL}\`]);`
  `const again = run('launchctl', ['bootstrap', domain, file]);`
  `return again.status === 0 ? undefined : \`launchctl: ${loaded.stderr.trim()} ${again.stderr.trim()}\`;`
- verify: by hand on a Mac: start, stop, change the plist's program, start; `launchctl print gui/$UID/com.deepbuild.hub` shows the new arguments only after the fix. The stand-in in `onboarding.test.ts:115-125` models the same thing ("kickstart runs the job's program"): it would need a `bootout` case, and the test at :140-146 would expect `bootstrap <own>` in place of `kickstart <own>`.
- risk: changes what a regression test pins, so it needs the owner's yes and one manual run (bootout of a job that is still exiting can make the bootstrap fail once; `promote.ts:109-117` already waits for the old PID).

### HUBREST-5  `setup.json`, the record `deep setup --undo` depends on, is written in place; a cut write makes the next setup keep DeepBuild's own entries as "your original"
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/agent-files.ts:130-132` (`saveRecord`), `:122-129` (`setupRecord` reads a damaged file as empty), `:134-145` (`keepOriginal`), `:142` (the original's bytes, not synced)
- evidence: `writeFileSync(recordFile(root), …)` truncates then writes; `setupRecord` answers `{ files: {}, created: [] }` on any parse error; `keepOriginal` returns early only when `record.files[file]` exists. The same file has `writeThrough` (temp file, fsync, read back, rename, folder fsync), used for every agent file.
- failure: setup is killed, or the disk fills, inside `saveRecord`: `setup.json` is empty or half written. The next `deep setup` reads it as empty, so `keepOriginal` hashes `settings.json` as it is now, with DeepBuild's hooks in it, and records that as `before`. `deep setup --undo` then "restores" the copy that still holds DeepBuild's hooks and prints "your settings are as they were". `record.created` is lost too, so the skill folder is never removed.
- fix: `agent-files.ts:131`: `writeFileSync(recordFile(root), \`${JSON.stringify(record, null, 2)}\n\`, { mode: 0o600 });` → `writeThrough(recordFile(root), \`${JSON.stringify(record, null, 2)}\n\`);` (`writeThrough` gives a new file mode 0o600).
- verify: `packages/hub/test/codex-hub.test.ts:396` and `tests/acceptance/19/setup` read `setup.json` only for existence and stay green; a unit test that truncates `setup.json` between two setups shows the failure today.
- risk: low.

### HUBREST-6  Product store: an entry folder the index doesn't name makes every later build of that key fail at the rename, after the whole build ran
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/products.ts:467-469` (`buildEntry`: `renameSync(stage, this.entryDir(entry))` then `save()`), `:382-385` (`keep`, same), `:190-191` (`open`: a missing or unreadable `products.json` is "a new store"; only index entries without a folder are dropped)
- evidence: `open()` filters `this.index.entries` by `existsSync(this.entryDir(e))` but never removes a folder under `products/<repo>/` that no entry names. `buildEntry` skips the build only when `this.found(repo, name, key)` exists with its folder; otherwise it builds, then `renameSync(stage, entryDir)`. A rename onto a non-empty folder fails with ENOTEMPTY. The error is caught in `ensure` (:431) as a reading, and `tried` keeps the commit, so it is tried again at each hub start and each new default-branch commit.
- failure: the hub is killed between `renameSync` (:467) and `save()` (:469), or `products.json` is lost while `products/` stays (a restore, a hand delete). From then on the store's build of that product runs in full under a heavy lease (a `cargo build`, minutes) and ends "The store's build of … failed: ENOTEMPTY …, rename …"; no worktree ever receives that key again until someone deletes the folder by hand.
- fix: clear the unnamed folder before each rename; `found()` has just said no entry holds it. `products.ts:467` and `:383`: before `renameSync(stage, this.entryDir(entry));` add `rmSync(this.entryDir(entry), { recursive: true, force: true });`.
- verify: unit test on `Products`: build once, delete `products.json`, open a new `Products`, `ensure` again; today the second build's reading says ENOTEMPTY.
- risk: low: the folder removed is one no index entry names, so nothing is placed from it.

### HUBREST-7  `HeavyQueue.attempt` can remove another waiter from the queue, and a poll with an unknown ticket is read as a new `deep lease` with no kinds
- kind: broken
- confidence: LIKELY (a narrow race, shown from the code)
- where: `packages/hub/src/heavy.ts:285` (`this.waiting.splice(this.waiting.indexOf(w), 1)`), `:233-235` (`expire`), `:373-374` (`tick` calls `expire` every 500 ms, `core.ts:1029`), `:203-215` (`wait` builds a new waiter when the ticket is unknown)
- evidence: `attempt` awaits `this.o.table.leases()` / `table.lease()` between `indexOf(w)` at :239 and the splice at :285. `expire()` runs from `tick` and from every other `wait` call (`core.ts:5696` does not serialise calls) and drops a waiter whose `peer.pid` is gone. If `w` was dropped while its attempt was in flight and the attempt is then granted, `indexOf(w)` is -1 and `splice(-1, 1)` removes the last waiter. That waiter's next poll sends only `{ ticket, secret }` (`heavy.ts:480`); `wait` finds neither a waiter nor a held entry and falls into `if (!w)`, building a waiter from `params.kinds ?? []`, `params.command ?? ''`, `params.jobs` undefined.
- failure: A is killed (Ctrl-C) while its `lease.wait` is inside `table.lease`; the tick drops A; A's grant then splices out C, the last in line, which waits on `gpu:exclusive`. C's next poll is granted a `cpu.slot` only: its command runs without the GPU lease it asked for, as a `jobserver` build whatever its entry said, and its place in line is lost.
- fix: `heavy.ts:285`: `this.waiting.splice(this.waiting.indexOf(w), 1);` → `const at = this.waiting.indexOf(w); if (at >= 0) this.waiting.splice(at, 1);`. Second, at `:206`, refuse a poll that names a ticket nothing holds: `if (!w) { if (typeof params.ticket === 'string') throw Error('this deep lease lost its place in the queue; run it again'); …`.
- verify: unit test on `HeavyQueue` with a `table.lease` stub that waits on a gate: queue A and C, mark A's pid dead, run `tick`, open the gate; assert C still waits. Fails before.
- risk: the first edit is safe alone. The second turns a silent re-queue into exit 3 for `deep lease`, and `core.ts:7350` (`buildProduct`) polls the same way: lead's call.

### HUBREST-8  `pushBranches` misses a force push written `+branch` and git's `--all` / `--mirror`, so a push to a branch whose merge is armed goes through
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/named.ts:39-40`; caller `packages/hub/src/holds.ts:276-277`; test `packages/hub/test/holds.test.ts:137-151`
- evidence: `refs.map((r) => r.split(':').at(-1)!.replace(/^refs\/heads\//, ''))` keeps a refspec's leading `+`, and the git branch has no `--all` / `--mirror` / `--branches` case (the jj branch returns `['*']` for `--all`). `holds.ts:277` denies only when `targets.includes(branch) || targets.includes('*')`. The test's table has no `+` form and no git `--all`.
- failure: pull request 12's merge is armed with `--auto` on `feature`. `git push origin +feature` (or `git push --force origin +refs/heads/feature`) reads as the branch `+feature`; `git push --all origin` from another branch reads as the current branch. Neither is denied by `merge-names-head`, and the armed merge takes the changed head.
- fix: `named.ts:39-40`: return `['*']` when the git push's words hold `--all`, `--mirror` or `--branches`; and strip the force mark: `.map((r) => r.replace(/^\+/, '').split(':').at(-1)!.replace(/^refs\/heads\//, ''))`.
- verify: add `['git push origin +b', ['b']]` and `['git push --all origin', ['*']]` to the table at `holds.test.ts:140`; both fail today.
- risk: none found; a refspec's leading `+` is never part of a branch name there.
- note: this is the second reader of a `git push` line; `pushTargets` (`holds.ts:61-86`, HUBREST-A7) is the first, and the two have drifted: `pushTargets` skips the value of `-o`, `--push-option`, `--receive-pack` and `--exec` (`VALUED`, `holds.ts:62`), `pushBranches` does not, so `git push -o ci.skip origin b` reads here as the branches `origin` and `b`.

### HUBREST-9  Promised checks: "in 30s" sets no wake-up, and "look at 3 files" sets one for 03:00
- kind: broken
- confidence: SURE for the first; LIKELY for the second (the fix is a judgment)
- where: `packages/hub/src/promises.ts:42-44` (`dueOf`, the unit), `:13` (`UNITS.s`), `:19` (`IN_SPAN` lists `s`); `:17` (`PROMISE`) with `:23` (`AT_CLOCK`)
- evidence: `const unit = span[2]!.toLowerCase().replace(/s$/, ''); const ms = UNITS[unit] ?? UNITS[unit.replace(/s$/, '')];` turns the unit `s` into `''`, and both lookups miss. Snippet with the file's own regex and table: `in 30s -> "" undefined`, `in 30 s -> "" undefined`, `in 30 seconds -> "second" 1000`. Second: `PROMISE` takes "at" as a time word after any promise verb, and `AT_CLOCK` needs no am/pm: `[...'Let me look at 3 examples of the failure.'.matchAll(PROMISE)].map(m => m[1])` gives `[' at 3 examples of the failure']`, and `AT_CLOCK` matches `at 3`. `packages/hub/test/promises.test.ts:19` tests only ` at 3pm`; `rg "in 30 ?s\b|look at" packages/hub/test/promises.test.ts tests/acceptance/120` finds no case of either.
- failure: an agent says "I'll check again in 30s": no wake-up is set, though the same words with "seconds" set one. An agent says "Let me look at 3 examples": a promised check is recorded, due at the next 03:00, and the session is woken then with "your promised check is due".
- fix: first, `promises.ts:42-43`: `const unit = span[2]!.toLowerCase(); const ms = UNITS[unit] ?? UNITS[unit.replace(/s$/, '')];`. Second (lead's call): make `AT_CLOCK` need minutes or a meridiem, e.g. `/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b|\bat\s+(\d{1,2}):(\d{2})\b/i`, reading the groups of whichever half matched.
- verify: `packages/hub/test/promises.test.ts`: add `dueOf(' in 30s', NOW)` equals `NOW + 30_000` (fails today) and `promisesIn('Let me look at 3 examples.', NOW)` is empty (fails today).
- risk: the first is safe. The second drops "at 9" with no am/pm and no minutes; no test in the checkout uses that form, but it is a behavior change.

### HUBREST-10  After a hub restart the product store reads worktrees with live sessions as idle
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/products.ts:519-526` (`quiet`), `:565-577` (`seen`, `hook`), `:277` (the only place a session is registered); call sites `core.ts:1817-1818`
- evidence: `sessions` is filled only in `start()` (a SessionStart in the worktree). `hook()` returns at once for a session it has never seen: `const s = this.sessions.get(meta.session); if (!s) return;`. After a restart the map is empty, and `quiet(top)` takes the no-session branch: `if (!mine.length) return now - placed >= IDLE_MS ? placed : undefined;`.
- failure: a session started before the hub restarted (an update, a promote) works on in its worktree for hours. Under the disk floor, `reclaimOne` sees no session for that worktree and a product placed over two hours ago, and removes its `target/` between two of its builds (when no process has a file open under it), with the reading "nobody works there".
- fix: register an unknown session from its hooks. `products.ts:572-574`: take `cwd` in `hook(meta)` and, when the session is unknown and has a cwd, `void this.repoAt(meta.cwd).then((r) => { if (r) this.seen(meta.session, r.top).last = this.o.now(); })` before returning; `core.ts:1817` already passes the whole `meta`.
- verify: unit test: place a product, make a new `Products` over the same root, send a PreToolUse for the old session, call `reclaimOne` with free space under the floor: today it removes the product.
- risk: one `git rev-parse` per unknown session per hook until it is registered; guard with a set of sessions being looked up.

### HUBREST-11  The Codex health texts name this process's `CODEX_HOME`, not the home setup wrote in, and `codexTrusted` reads the wrong home too
- kind: inconsistent
- confidence: SURE for the texts; LIKELY for `codexTrusted`
- where: `packages/hub/src/codex-settings.ts:322-323` (`modified`), `:353,360` (`codexRelations`), `:296-299` (`codexTrusted`), `packages/hub/src/doctor.ts:304`; against `codex-settings.ts:309-315` (`recordedHome`, `entriesFor`), `:294` (`hooksDisabled`), `doctor.ts:298` and `hook-programs.ts:40` (both name `join(recordedHome(root), …)`)
- evidence: the file's own rule at :78: "the hub and doctor read this home whatever their own environment says". `modified()` reads `join(recordedHome(root), 'hooks.json')` through `entriesFor`, then says `removed from ${codexHooks()}`; `codexHooks()` is `join(process.env.CODEX_HOME || ~/.codex, 'hooks.json')`. `codexRelations` reads `join(recordedHome(root), 'config.toml')` and says `in ${codexConfig()}`. `doctor.ts:304` says the entries "are in ${codexHooks()}". `codexTrusted` calls `configTables()` with its default, `codexConfig()`. `packages/hub/test/codex-hub.test.ts:312-336` sets up with `CODEX_HOME=<other>` and checks the readers, not these texts; `rg "was removed from|was modified in|put the Stop entry" packages/hub/test tests/acceptance` finds no test of the texts.
- failure: `CODEX_HOME=/x deep setup`; the hub (a login service with no `CODEX_HOME`) finds the Stop entry edited in `/x/hooks.json` and says "put the Stop entry's timeout back in ~/.codex/hooks.json", a file with no entry of ours. `codexTrusted` reads `~/.codex/config.toml`, so a project trusted in `/x/config.toml` reads as untrusted (`core.ts:7338`).
- fix: in `modified`, `codexRelations` and `doctor.ts:304` replace `codexHooks()` with `join(recordedHome(root), 'hooks.json')` and `codexConfig()` with `join(recordedHome(root), 'config.toml')` (five sites). For `codexTrusted`, add `root` and pass `join(recordedHome(root), 'config.toml')` to `configTables` (one caller, `core.ts:7338`).
- verify: in `packages/hub/test/codex-hub.test.ts`'s "elsewhere" block, assert the doctor line names `<other>/hooks.json`; today it names the default home.
- risk: none for the texts (equal when the homes are equal).

### HUBREST-12  `deep doctor`'s service item reads Node under Homebrew or nvm as "a checkout" and fails it for the wrong program
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/doctor.ts:205-221` (`serviceItem`: `programs = args.filter((a) => a.startsWith('/'))`, `where`)
- evidence: `where(program)` walks up from each absolute argument looking for `.git`. The service's first argument, for a hub not yet promoted, is Node (`lastingNode()`, e.g. `/opt/homebrew/opt/node/bin/node`). `/opt/homebrew` is itself a git checkout on Apple Silicon (`ls -d /opt/homebrew/.git` on this Mac: present); `~/.nvm` is one too.
- failure: on this Mac, a hub started from an npm install (CLI in no git folder) should read `service_unpromoted`, `warn`; it reads `fail`, "runs /opt/homebrew/opt/node/bin/node, in a checkout, /opt/homebrew, which can move or vanish under the run". For a hub run from a worktree the item fails as it should, but names Node and `/opt/homebrew`, not the worktree.
- fix: judge the program the service runs, not its interpreter: `doctor.ts:205`: `const programs = args.filter((a) => a.startsWith('/'));` → `const all = args.filter((a) => a.startsWith('/')); const programs = all.length > 1 && /\/node$/.test(all[0]!) ? all.slice(1) : all;`.
- verify: `tests/acceptance/1334` (reads the item from plists it writes) stays green; a new case with `ProgramArguments = [/opt/homebrew/opt/node/bin/node, /usr/local/lib/x/main.js, hub, run]` expects `warn`.
- risk: low; `--root <folder>` arguments are still read as programs, as today.

### HUBREST-13  `deep setup --undo` puts paseo's `config.json` back to its bytes from before setup whatever you changed in it since
- kind: broken
- confidence: QUESTION (a test pins part of it)
- where: `packages/hub/src/setup.ts:390-404` (`undoPaseo`), against `agent-files.ts:155-165` (`putBack`: only "when it still holds what setup left")
- evidence: `if (kept.before === null) rmSync(target(file), { force: true }); else writeThrough(file, readFileSync(join(root, 'originals', kept.before)));` runs with no comparison against `kept.after`, though `installPaseo` records it (`noteWritten`, :387). Every other file goes through `putBack`. `tests/acceptance/55/real.test.ts:78-106` (AC7) requires "paseo's config.json back byte for byte", and its README (:118) says paseo's own `plugin remove` reorders keys.
- failure: weeks after setup you add another paseo plugin or change a paseo setting; `deep setup --undo` writes the pre-setup bytes over it.
- fix (if wanted): hash the file before `paseo plugin remove`; restore the original only when that hash equals `kept.after`, else leave what paseo's remove leaves and say so, as `putBack` does.
- verify: `tests/acceptance/55/real.test.ts` AC7 must stay green (it changes nothing in the file between setup and undo, as far as I read; "an agent paseo saved meanwhile" may write it: check before applying).
- risk: could break AC7 if paseo itself rewrites `config.json` between setup and undo.

### HUBREST-14  The session briefing finds `done.yaml` in any folder above; teardowns, release checks and the core read it at the session's folder only
- kind: inconsistent
- confidence: QUESTION
- where: `packages/hub/src/session-facts.ts:84-94` (`briefing`: `for (const dir of upFrom(cwd))`), `products.ts:91-96` (`specAbove`); against `teardowns.ts:68`, `release.ts:18`, `search.ts:175`, `core.ts:6879,7314,7528` (all `join(cwd, '.deepbuild', 'done.yaml')`)
- evidence: `rg "'\.deepbuild', 'done\.yaml'" packages/hub/src` lists nine readers; two walk up, seven do not.
- failure: a session started in `repo/packages/x` is told "Active checks in this repo: unit, lint" and "Start this repo's stack with deep env up", while the readers that apply them find no spec at its cwd: a resource it creates gets no teardown task, and its release checks read as none.
- fix: lead's call which side is right; the smallest is to make `briefing` read `join(cwd, '.deepbuild', 'done.yaml')` only, as the core does, so the briefing never promises checks the gate won't see.
- verify: a hub test that starts a session in a subfolder and compares the briefing with `deep status`.
- risk: I did not read how the core maps a session's cwd to its repo top; if it does so before these readers, this is moot.

### HUBREST-15  The canvas core's child process has no `error` handler, on the process or on its stdin; the replica beside it has both
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/canvas.ts:137-160` (`Canvas.start`, `send`); against `packages/hub/src/drive.ts:46-51`; `Canvas` is made in the core (`core.ts:6567`)
- evidence: `start()` listens for `exit` only. `send()` writes to `child.stdin` of whatever `this.child` is. `drive.ts` has `child.stdin.on('error', () => undefined)` and `child.once('error', gone)` for the same shape of child. An `error` event with no listener is thrown, and in the core's worker that is the fatal path (`server.ts:232`, `:452-455`).
- failure: `deep-show canvas` dies (a panic on a document) and a second call's write reaches its closed pipe before the `exit` event is handled: EPIPE on `stdin`, unhandled, and the hub's core stops. Or the spawn itself fails asynchronously (EACCES, or EAGAIN at the process limit): same.
- fix: in `start()`, after `child.stderr.resume();` add `child.stdin.on('error', () => undefined);` and `child.on('error', () => { if (this.child === child) this.child = undefined; this.world = ''; for (const wake of this.waiting.splice(0)) wake({ ok: false, code: 'canvas_core_exited' }); });`.
- verify: by reading; a unit test that points `canvasCore()` at a non-executable file needs a seam that does not exist today.
- risk: none found; the `exit` handler does the same clean-up.


## Nits, lead reader (one line each; all read from the code, none run)

- `packages/hub/README.md:8`: lists `deep hub run | start | status | stop | use`; `hub-command.ts:1,15` also has `promote`. Add it.
- `packages/hub/src/session-facts.ts:130`: comment says "just `to` when `from` isn't one of its ancestors"; `git rev-list from..to` then lists up to 100 commits not reachable from `from`, and `[to]` comes back only for an empty list or an error. Fix the comment, or check `merge-base --is-ancestor` first (the core's `commit.made` reader should say which).
- `packages/hub/src/staging.ts:68`: comment "not following a link" over `stat(path)`, which follows links; `lstat` is what the comment says.
- `packages/hub/src/products.ts:118`: "The bytes a folder's files hold, and their count": `sizeOf` returns bytes only.
- `packages/hub/src/process-health.ts:21`: the comment about the `ps` child sits over `count++`; the `- 1` it explains is at :46.
- Doc comments stranded over the wrong declaration (a later declaration was inserted under them): `codex-settings.ts:260`, `setup.ts:195-198`, `paths.ts:194`, `wire.ts:153-157`, `promises.ts:124`.
- `packages/hub/src/mcp.ts:5,85` and `codes.ts:1` say `error@2`; `wire.ts:2,17` says `error@3`. Both schemas exist with the same fields (`packages/contracts/schemas/error@2.json`, `error@3.json`); name one.
- `packages/hub/src/heavy.ts:150,212,216`: `Waiter.seen` is written and never read (`rg "\.seen\b" packages/hub/src/heavy.ts`: one write).
- Exports no other file imports (`rg -w` over `packages crates scripts tests benchmarks adapters packs`, twins excluded): `memoryPressure` (`heavy.ts:37`), `driveCall` (`drive.ts:84`), `PointKind` (`vfs.ts:13`), `Compat` (`compat.ts:5`). Drop the `export` word; each is used inside its own file.
- `adapters/loops.facts.json:24` names `target`, `schedule`, `lastRun` for heartbeats; `codex-loops.ts:100-103` hardcodes `target_thread_id`, `rrule`, `last_run_at` and `CodexFacts.heartbeats` (:21) omits the three keys. Read them from the facts or drop them from the file.
- `packages/hub/src/claude-settings.ts:215`: `toolMs >= 10_000 &&` can never decide: `ASK_WAIT_MS + HOLD_MARGIN_MS <= toolMs` (45 000) implies it.
- `packages/hub/src/claude-settings.ts:108`: after an undo of an edited file whose only hooks were ours, `"hooks": {}` is left where there was no `hooks` key before setup (the delete needs `!isObj(settings.hooks)`).
- `packages/hub/src/codex-settings.ts:283`: `withoutServer` leaves the blank line `withServer` added before the table (`"a = 1\n"` → with → without → `"a = 1\n\n"`).
- `packages/hub/src/reach.ts:16`: `apiHost` reads `~/.claude/settings.json` by `homedir()`, not `claudeSettings()`, so `CLAUDE_CONFIG_DIR` is ignored here and honored in `claude-settings.ts:28` and `session-facts.ts:45`.
- `packages/hub/src/setup.ts:297-298` (`installRules`): a shipped entry added to an existing `rules.json` comes without its shipped proof (a fresh `rules.json` gets `entries` and `proofs`). No reader needs it today (no shipped proof has a `rule`).
- `packages/hub/src/mcp.ts:110,151`: `calls` keeps one settled promise per tool call for the life of `deep mcp`; a `Set` that drops each on settle holds only what is in flight.
- `packages/hub/src/children.ts:65-66` (`groupUnder`): runs `ps` and then returns for an empty `text`; test `!text` first.
- `packages/hub/src/secret-command.ts:43`: `usage:` in lower case; every other command writes `Usage:`.
- `packages/hub/src/installer.ts:57,59`: a `.staging-<version>-<pid>` or `.current-<pid>` left by a killed install is never removed (the cleanup at :75-76 is for this process's own).
- `packages/hub/src/installer.ts`: no command reaches `installVersion`; its only importer is `tests/acceptance/41/install` (in use by the brief's rule; noted so nobody looks for the command).


---

## Part A, in full: `agents.ts`, `ask-tasks.ts`, `starts.ts`, `siblings.ts`, `runs.ts`, `holds.ts` (sub-reader's text; paths under `packages/hub/`)


Checkout: `the checkout`. All paths below are under
`packages/hub/`. Nothing was run but `rg`, `git log`, `wc` and pure `node -e` regex checks. No finding here was
proven by a test run; SURE means proven from the code and a pure expression alone.

Shared fact used by HUBREST-A4: no file in `packages/` or `scripts/` registers `unhandledRejection`
(`rg -n "unhandledRejection|unhandled-rejections" packages scripts` finds nothing), the core runs in a worker
(`src/server.ts:465`), and `src/server.ts:232` `worker.on('error', (error) => onFatal(...))` leads to
`src/server.ts:452-455` `process.stderr.write('deep hub: the core stopped: ...'); this.exit(1);`. So a promise that
rejects with no handler inside the core stops the hub.

---

### HUBREST-A1  `deep undo sync:<id>` uses the plan-time `before` digest: after a file changed between the plan and the apply, undo leaves DeepBuild's entry in, or deletes a file you made
- kind: broken
- confidence: LIKELY
- where: src/agents.ts:657-661, 674-678, 683, 688-700 (apply and write never update `t.before`); src/agents.ts:830-833 (undo reads it)
- evidence:
  - apply stages the bytes that are there at apply time and journals their digest, but only in the journal:
    `src/agents.ts:659-660` `if (current !== null) writeSyncedFile(join(staged, \`before-${i}\`), current); return { path: t.path, before: digestOf(current), after: sha(bytes) };`
    and on a re-plan `src/agents.ts:677-678` `if (now !== null) writeSyncedFile(join(staged, \`before-${i}\`), now); journal[i] = { path: t.path, before: digestOf(now), after: sha(bytes) };`
  - `write` updates only `after`: `src/agents.ts:698-699` `t.status = 'written'; t.after = sha(bytes);`. `t.before` stays the digest from `plan()` (`src/agents.ts:564`).
  - undo compares the staged file against that stale digest: `src/agents.ts:830-833`
    `if (digestOf(current) === t.after) { if (t.before === null) rmSync(target(t.path), { force: true }); else if (existsSync(beforeFile) && sha(readFileSync(beforeFile)) === t.before) this.replace(t.path, readFileSync(beforeFile)); else { notes.push(\`...: its bytes before the sync are gone, so it was left as it is\`); continue; }`
  - Checked: every reader of `Target.before` (`next` at 574, `shown` 609, `read` 884, undo 831-832). Tests: `tests/acceptance/148/plan.test.ts:45-56` (`editBetween`) edits between plan and apply but never undoes; `tests/acceptance/148/sync.test.ts:19-45` undoes with no change in between. Neither pins this.
- failure:
  1. `agents.propose` a server for Codex; add a comment to `~/.codex/config.toml`; answer apply (this is AC12's flow). Then `deep undo sync:<id>` while the file is as the sync left it: `sha(before-0)` is the edited file's digest, `t.before` is the pre-edit digest, so undo says "its bytes before the sync are gone, so it was left as it is", keeps the entry, then still sets the sync `undone` (850) and deletes it from `servers.json` (854). The entry left in the file runs `deep mcp-exec <name>`, which now answers "No synced stdio server" (912), and `deep undo` says "is undone already" (822).
  2. Plan when the target file doesn't exist (`t.before === null`); the file appears before you approve (you ran the agent once, or added a server of your own); apply merges into it. Undo with the file as the sync left it takes the `t.before === null` branch and `rmSync`s the whole file, your own content with it.
- fix: record the digest the write actually replaced. In `apply`, `src/agents.ts:683`
  `this.write(s, record, t, bytes);` → `t.before = journal[i]!.before; this.write(s, record, t, bytes);`
  and in `recover`, `src/agents.ts:798-799`, set `t.before = f.before;` before `t.status = 'written'` and before `this.write(...)`.
  Related gap, same cause, not fixed by that edit: `overwrite` (760-769) stages no `before-<i>` for the bytes it writes over, so undo after a "Write DeepBuild's entry" answer can only take the `withoutEntries` path or restore older bytes.
- verify: `tests/acceptance/148/plan.test.ts` `editBetween`, extended by one `deep undo` and a byte compare with the edited file, fails before and passes after (acceptance files are not edited: this needs a new hub test).
- risk: `before` is shown by `agents.read` (884) and in the plan (`shown`, 609); after the fix a written target's `before` is the apply-time digest, not the plan's. No test compares it after apply: `rg -n "\.before\b" tests/acceptance/148 packages/hub/test` finds only `tests/acceptance/148/crash.test.ts:52,55,68`, which read `before` from the propose's own answer, taken before the apply.

### HUBREST-A2  An update of a skill forgets every file the update didn't change, so the next update that touches one is refused as "isn't DeepBuild's"
- kind: broken
- confidence: LIKELY
- where: src/agents.ts:561 (unchanged files leave the plan), 743 (state rebuilt from the plan's targets only), 576-577 (the check that then fails), 868 (`differs` reads the same list)
- evidence:
  - `src/agents.ts:561` `if (current !== null && next.bytes.equals(current)) continue;`
  - `src/agents.ts:743` `skills[s.item.skill.name] = { ..., agents: [...new Set(s.targets.flatMap((t) => t.agents))], files: s.targets.map((t) => ({ path: t.path, after: t.after })), sync: s.id };` replaces the skill's whole entry.
  - `src/agents.ts:576-577` `const installed = Object.values(this.skillState()).some((k) => k.files.some((f) => f.path === t.path)); return installed ? { bytes } : { conflict: \`${shownPath(t.path)} is there already and isn't DeepBuild's\` };`
  - Tests read: `tests/acceptance/148/skills.test.ts:39-66` proposes one update and never applies it; no test applies two updates.
- failure: install skill `notes` at commit A (`SKILL.md`, `run.sh`). Update to commit B, which changes only `SKILL.md`: the plan holds one target per agent folder, and `skills.json` now lists only `SKILL.md`. Then (a) a hand edit of `run.sh` no longer shows as differing (`differs`, 868), and the update's question no longer warns "applying it replaces your edits" (590); (b) an update to commit C that changes `run.sh` is refused at plan time: "Nothing was planned: ~/.claude/skills/notes/run.sh is there already and isn't DeepBuild's. Rename one of them, then add it again." (560). Re-syncing the same commit (no file differs) writes `files: []` and forgets the whole skill.
- fix: `src/agents.ts:743`, keep what the entry already lists:
  `files: s.targets.map((t) => ({ path: t.path, after: t.after }))` → `files: [...(skills[s.item.skill.name]?.files ?? []).filter((f) => !s.targets.some((t) => t.path === f.path)), ...s.targets.map((t) => ({ path: t.path, after: t.after }))]`
  and `agents: [...new Set(s.targets.flatMap((t) => t.agents))]` → `agents: [...new Set([...((skills[s.item.skill.name]?.agents as string[] | undefined) ?? []), ...s.targets.flatMap((t) => t.agents)])]`.
- verify: a hub test: install at A, apply B (one file changed), then `agents.read` lists the skill with `differs: false` and a propose of C (other file changed) returns a plan instead of a `conflict` refusal.
- risk: a file a newer commit deleted stays listed (it stays on disk today too). Undo of the update still deletes the whole entry when `sync === s.id` (858): after undoing B the v1 files are back on disk and unknown to `skills.json`; same family, not covered by this edit.

### HUBREST-A3  `agents.propose {via:'restore'}` with more than one item lands only the first; with a skill in the record it throws ENOENT
- kind: broken
- confidence: LIKELY
- where: src/agents.ts:454-460, 566-567, 572, 598, 737-746
- evidence:
  - one sync is planned over every wanted item, but it keeps one: `src/agents.ts:566` `const item = items.length === 1 ? items[0]!.item : items[0]!.item;` (both arms are the same expression).
  - `landed` (737-745) writes `servers.json` / `skills.json` for `s.item` only, and 746 records `agents.synced` with that one item and the union of every item's agents.
  - `exec` (910-912) and `scopeDenial` (897-899) read `servers.json` by name.
  - a restored skill is never staged: restore takes items from the record (458) and skips `readSkill`; `next` then reads `src/agents.ts:572` `readFileSync(join(this.stagedDir(id), t.file!.sha))` in the new sync's empty staged folder.
  - `question` (598) slices each skill target's path by `itemName(s.item)`, the first item's name.
  - The only caller of `via: 'restore'` in the checkout is `tests/acceptance/148/entries.test.ts:73`, with one server (`rg -n "restore" packages/cli/src packages/hub/src | rg -i "propose|via"` finds only agents.ts).
- failure: a record with two approved servers `a` (first) and `b` (scoped to one repo, with a secret). Restore, apply: every agent file gets both entries, `servers.json` gets `a` only. `deep mcp-exec b` refuses "No synced stdio server b" so `b` never starts; had `b` no secret, its scope would be unenforced (`scopeDenial` returns undefined for a server `servers.json` doesn't hold). A record that holds any skill: the propose rejects with a raw `ENOENT ... agents/staged/<id>/<sha>` and nothing is planned, servers included.
- fix: not a one-line edit. Plan a restore as one sync per item (loop `items`, each through `plan`/`raise`/`save` with its own id), and for a skill item call `readSkill({repo, commit, path}, staged)` again so its files are staged and re-audited. Then delete the dead ternary at 566 and the `reason` at 567.
- verify: a hub test restoring a record with two servers: after apply, `agents.read().servers` names both.
- risk: `tests/acceptance/148/entries.test.ts:77` expects one refusal for one restored server; one sync per item keeps that.

### HUBREST-A4  Three detached promises in agents.ts and runs.ts have no rejection handler, so a failed ask or a failed `run.finished` append stops the hub
- kind: broken
- confidence: SURE (that each is unhandled and fatal when it rejects); LIKELY for how often each rejects
- where: src/agents.ts:733; src/runs.ts:414; src/runs.ts:428-432
- evidence:
  - `src/agents.ts:733` `for (const t of open) if (t.status === 'conflict') void this.askConflict(s, t);` — `askConflict` awaits `this.o.raise(...)` (751), which is `asks.raise` (`src/core.ts:855`); asks refuse by throwing (`AskRefused`, handled as a normal case in `src/holds.ts:182,299`). Every other detached call in the file has a `.catch` (621-623, 746-747).
  - `src/runs.ts:414` `void done.finally(() => this.o.leases().release(lease.id, []).catch(() => undefined)).finally(() => this.live.delete(run.run));` — `done` (375-412) awaits `sink.close()`, `this.o.stored`, `this.o.keyed` and `this.finish` → `appendCore('run.finished')`, none caught. `ended()` (141) and `settled()` (148) handle `done` itself, not this derived chain.
  - `src/runs.ts:428` `setInterval(() => void this.o.supervisor().lives(run.run).then(async (lives) => { ...; await this.keptEnded(run); }), 1000)` — `keptEnded` appends through `finish`; no catch. The interval is also never cleared at `stopAll`/stop, so it can fire against a closed record.
  - fatal path: see the shared fact at the top.
- failure: (a) a sync whose file keeps changing ends in conflict and its conflict ask is refused (asks settings, or the asks core closing): the hub exits 1 with "the core stopped". (b) a run still ending when `Core.stop` reaches `record.close()` (`src/core.ts:7794-7803`; `settled()` waits 5 s only): its `run.finished` append rejects, the worker errors, and a clean stop exits 1. (c) a kept run (#70) that ends while the record refuses its finish: same.
- fix:
  - `src/agents.ts:733` → `void this.askConflict(s, t).catch((error: unknown) => process.stderr.write(\`deep hub: sync:${s.id}'s conflict on ${t.path} wasn't asked: ${error instanceof Error ? error.message : String(error)}\n\`));`
  - `src/runs.ts:414` append `.catch((error: unknown) => process.stderr.write(\`deep hub: ${run.run}'s finish wasn't recorded: ${error instanceof Error ? error.message : String(error)}\n\`))` to the chain (the journal still holds the run, so the next start recovers it).
  - `src/runs.ts:428-432` add `.catch(() => undefined)` after the `.then(...)`.
- verify: none cheap exists; a unit test with `raise` rejecting and a `process.on('unhandledRejection')` spy.
- risk: none found; no test expects the hub to die here (`rg -n "the core stopped" packages/hub/test tests/acceptance`: no match).

### HUBREST-A5  Two `deep start` calls at once both pass `at_once`
- kind: broken
- confidence: LIKELY
- where: src/starts.ts:251-256 with 302-303 (the count), 257-277 (awaits), 278 (the slot is taken)
- evidence: `src/starts.ts:302-303` `const running = [...this.started.values()].filter((s) => s.ask === a.ask && !s.ended).length; if (running >= a.at_once) return {...}` runs inside `outside()` at line 252. The run enters `this.started` only at `src/starts.ts:278` `this.started.set(run, s);`, after `await this.versionOf(agent)` (260, runs `<agent> --version`), `await this.worktree(...)` (267, four git calls), `await this.credential(...)` (271, a token mint over the network). The core does not queue `start.session`: `src/core.ts:5682-5684` returns `this.sessionStarts.startSession(params, context)` directly.
- failure: an approval with `at_once: 1`; `deep start --issue 41 … & deep start --issue 42 …` in one shell line. Both calls count 0 running, both start. `tests/acceptance/1330/never-started.test.ts:13` checks the bound with one start already recorded, so it doesn't see this.
- fix: take the slot before the first await after the bound check. Move the `run` id up and reserve:
  after `src/starts.ts:256` add `const run = \`run:${ulid(this.o.now())}\`; const s: Started = { run, ask: approval.ask, agent, sandbox: NONE, ended: false }; this.started.set(run, s);`,
  set `s.ended = true` on each later refusal (259, 261, 264, 286) and in a `catch` around 267-282, and at 277 assign the remaining fields onto `s` instead of building a new object; delete line 266.
- verify: a hub test that sends two `start.session` requests without awaiting the first and expects one `at_once` refusal.
- risk: a reserved entry that never clears would hold a slot: every exit path after the reservation must set `ended`.

### HUBREST-A6  A merge armed with `--auto` and no pull request number is recorded but never read back, so pushes to its branch aren't held
- kind: broken
- confidence: LIKELY
- where: src/holds.ts:217, 268-270
- evidence:
  - `src/holds.ts:268-269` `const pr = call.merge?.pr ?? ''; if (call.merge?.auto && !unpinned) await this.o.reading(..., \`Merge of pull request ${pr} armed with --auto on branch ${await this.branch(meta.cwd)}\`);`
  - `src/holds.ts:217` `const m = /^Merge of pull request (\S+) (?:armed with --auto on branch (\S*)|disarmed)/.exec(reading);`
  - `node -e`: that regex on `"Merge of pull request  armed with --auto on branch feat"` → `null`; with `12` → `['12','feat']`.
  - `pr` is optional by type (`src/wire.ts:177`) and by its source: `src/server.ts:367-369` sets it only when deep-hook's note has `pr=`, and `crates/deep-hook/src/matcher.rs:1360,1367-1369` adds `pr=` only when a third plain word exists. Line 270 already treats an empty `pr` as a case (`if (!pr || armed === pr)`).
  - Tests arm only with a number: `tests/acceptance/1523/auto.test.ts:34`, `tests/acceptance/84/guard/head-commit.test.ts`.
- failure: `gh pr merge --auto --squash --match-head-commit=<pass sha>` (the current branch's PR, no number) passes the head rule and is recorded as "Merge of pull request  armed ...". `armed()` skips that reading, so a later `git push` to the branch runs with no "a merge ... armed with --auto is pending" denial: the auto-merge then merges a head no verdict covers.
- fix: `src/holds.ts:217` `(\S+) (?:armed` → `(\S*) (?:armed`, and `src/holds.ts:270` `if (!pr || armed === pr)` → `if (!pr || !armed || armed === pr)`.
- verify: `packages/hub/test/holds.test.ts` style unit: gate a merge with `merge: { auto: true, head }` and no `pr`, then a push to that branch is denied naming guard `merge-names-head`.
- risk: the denial text then reads "pull request  armed" with an empty number; cosmetic. Out of my area, for the deep-hook reader: with the space form `--match-head-commit <sha>`, `plain(&words).get(2)` (`matcher.rs:1360`) is the SHA, so `pr=<sha>`.

### HUBREST-A7  `pushTargets` reads a redirection, a comment or a line continuation as the remote
- kind: broken
- confidence: SURE
- where: src/holds.ts:61 (`PUSH`'s tail `([^;&|)\n]*)`), 73, 78-85
- evidence: `node -e` with the file's `PUSH`, `VALUED` and function body copied out:
  `"git push 2>&1 | tail -5" => ["2>"]`, `"git push > /tmp/out.log" => [">"]`, `"git push 2>/dev/null" => ["2>/dev/null"]`, `"git push --force-with-lease 2>&1" => ["2>"]`, `"git push #comment" => ["#comment"]`, `"git push\\\n  origin main" => ["\\"]`; `"git push -u origin main 2>&1" => ["origin"]` is right.
  Call sites read: `src/holds.ts:254` and `318`, both with `call.label`, both feeding the authority ask's plan targets. `packages/hub/test/holds.test.ts:111-135` and `tests/acceptance/1523/auto.test.ts` hold no line with a redirection.
- failure: an agent runs `git push 2>&1 | tail -5` (the usual form) with no request naming a push: the ask's card names the remote `2>`, which no remote matches, where the doc comment at 66-69 says "a push that names none goes to git's default, origin".
- fix: `src/holds.ts:73` `const words = (rest ?? '').trim().split(/\s+/)` → `const words = (rest ?? '').replace(/(^|\s)(?:\d*[<>]|#).*$/s, '').trim().split(/\s+/)` (cuts the tail at the first redirection or comment). A line continuation still reads as `\`, which shows as unknown on the card; left alone, since the real remote is on the next line.
- verify: add to the `it.each` table at `packages/hub/test/holds.test.ts:111`: `['git push 2>&1 | tail -5', 'origin']`, `['git push > /tmp/out.log', 'origin']`, `['git push upstream main >/dev/null 2>&1', 'upstream']`; the first two fail before. Checked with `node -e`: with the edit all 17 rows pinned at 112-128 and the three multi-push lines at 133-135 keep their answers, and the new rows read as written here.
- risk: a remote literally named `>x` or `#x` would read as origin; neither is a usable remote name.

### HUBREST-A8  A session DeepBuild starts never has an issue in the session map: its branch is `deep/<n>-<id>`, and the map reads `issue-<n>`
- kind: inconsistent
- confidence: LIKELY
- where: src/starts.ts:487; src/siblings.ts:42-46
- evidence: `src/starts.ts:487` `const branch = \`deep/${issue}-${id.slice(-6).toLowerCase()}\`;` against `src/siblings.ts:44` `/(?:^|[^0-9A-Za-z])issue-(\d+)(?![0-9])/i`. `node -e`: `issueOf('deep/1330-abc123')` → `undefined`; `issueOf('claude/issue-1108-c657d3')` → `1108`. `tests/acceptance/352/issue.test.ts:2` names the surface: "A session's issue is read from its branch (README SURFACE: `issue-<n>`)". `tests/acceptance/1330/start.test.ts:34` asks only that the branch name hold the number (`(^|\D)41(\D|$)`). No other reader of `deep/<n>-`: `rg -n "'deep/|deep/\\$" packages crates scripts tests` finds only starts.ts.
- failure: two `deep start` sessions on issue 41 (two agents under one approval): `row()` shows `issue: null` for both, the start notice leaves out ", on issue #41", and the "Keep which?" ask (`sameIssue`, 535) is never raised.
- fix: `src/starts.ts:487` `\`deep/${issue}-${...}\`` → `\`deep/issue-${issue}-${...}\``.
- verify: `node -e` on `issueOf('deep/issue-41-abc123')` → `41`; `tests/acceptance/1330/start.test.ts` still matches.
- risk: behavior change the owner should want but may not expect: started sessions on one issue now raise the "Keep which?" ask unless a `race.started` names the issue.

### HUBREST-A9  After a hub restart, a started run whose first hook hasn't come yet can never be linked to its session, and its 60 s "never started" timer is gone
- kind: broken
- confidence: LIKELY
- where: src/starts.ts:89, 97-104 (open), 325 (sessionOf), 292 (the timer)
- evidence: `open()` rebuilds each run with no `pid` and no `timer` (`src/starts.ts:89`) and for one still running only sets `s.ended = false` (102). `sessionOf` filters `src/starts.ts:325` `!s.ended && !s.session && s.pid !== undefined`, and the supervisor's status carries no pid (`packages/supervisor/src/types.ts:109` `RunStatus { run; state; on? }`). The timer is armed only in `startSession` (292).
- failure: `deep start`, then the hub restarts (a promotion, #1334) before the agent's first hook. The session's hooks arrive, `sessionOf` returns undefined, no `start.session` is recorded: its row shows no run or sandbox (`rowOf`), its sandbox and forge refusals are never recorded (`refusals` returns at 344), and a push it makes is attributed to no session (`pushed`). If the agent never hooks at all, nothing ends it: it holds its `at_once` slot until the process exits.
- fix: in `open()`, for a run that is running and has no session, read the agent's pid the terminal host wrote and re-arm the timer: after `s.ended = false;` add
  `if (!s.session) { const pid = Number((() => { try { return readFileSync(join(s.dir!, 'pid'), 'utf8'); } catch { return ''; } })().trim()); if (Number.isSafeInteger(pid) && pid > 1) s.pid = pid; s.timer = setTimeout(() => void this.neverStarted(s).catch(() => undefined), FIRST_EVENT_MS); }`
  (the agent's pid is an ancestor of its hooks, as the host's is, so the walk at 329-332 finds it).
- verify: a hub test: start, stop the hub before the first hook, start it, send the hook; `start.session` is on the record.
- risk: the pid file's pid is the agent, not the host; `neverStarted` already reads the same file (314).

### HUBREST-A10  A journal rebuilt from the record drops `keep`, `spec`, `outside`, `stack` and `key`, so a kept run is finished "stopped" and started a second time while it still runs
- kind: broken
- confidence: LIKELY
- where: src/runs.ts:95-126 and 255-261 (what run.started@3 records), 183-195 (the rebuild), 450-467 (recover)
- evidence: `recordable` returns `argv, cwd, env, grant, deadline_ms, command, stand_ins`; the event adds `environment` (260). The rebuild at 187-193 restores exactly those. `Run` has since gained `keep` (41, #70), `spec` (39, #1537), `outside` (31, #33), `stack` (27, #580) and `key` (35, #1018); none is recorded or rebuilt. `recover` branches on `run.keep` first (450-454) and otherwise finishes the run "stopped" and launches it again (456, 467).
- failure: a `run.start` with `keep: true` is running; the hub dies and `runs.json` is unreadable at the next start (the case `open()` exists for). The rebuilt entry has no `keep`: recover records `run.finished` "stopped, hub restarted" for a run that is alive, then starts a second copy of its command beside it. A rebuilt run of another check kind (`spec`) is rerun as a plain command check, and one marked `outside` is rerun inside the sandbox; both only when their folder is not under the checkouts folder (460).
- fix: the full fix records `keep`, `outside` and `spec` in `run.started`, but `packages/contracts/schemas/run.started@3.json` is closed (`data.additionalProperties: false`; its properties are `run, check, claim, commit, host, needs, lane, argv, cwd, env, grant, deadline_ms, environment, command, stand_ins, withheld`), so that is a new schema version and the owner's call. Inside today's schema, two edits remove the wrong reruns:
  - `src/runs.ts:450` `if (run.keep) {` → `if (run.keep || await this.o.supervisor().lives(run.run)) {` (a non-kept run was reaped when the supervisor opened, so `lives` is false for it and nothing changes; a kept run that lost its flag is adopted, not doubled);
  - in `recordable` (after 118) push `'spec'` / `'outside'` into `withheld` when `run.spec` / `run.outside` is set, so a rebuilt run of that kind ends INCONCLUSIVE at 460-463 and is not rerun as something else. The names go into the event's `withheld` list, which the schema allows.
- verify: `packages/hub/test` has journal-rebuild tests for #996 (`rg -ln "kept aside|couldn't be read" packages/hub/test tests/acceptance/996`); add a kept run to one.
- risk: `withheld` is shown in the INCONCLUSIVE reason ("the record doesn't keep its spec"); a test that pins an empty `withheld` for a `spec` run would notice.

### HUBREST-A11  A run whose start fails before `run.started` stays in the journal and is started at the next hub start
- kind: broken
- confidence: LIKELY (rare trigger)
- where: src/runs.ts:246-251, 262-267, 456-467
- evidence: `launch` journals first (246), then `await this.claimSession(...)` (250) and `await slot(...)` (251). `slot` throws on a capped table (`packages/gate/src/exec.ts:85` `if (got.status === 'BLOCKED') throw Error(got.message);`, from `packages/leases/src/index.ts:325-326`). Neither await has the cleanup that the next step has (262-266: "A start the record refused never ran: it leaves neither its slot nor the journal"). At the next start `recover` finds no `run.started`, deletes the entry (457) and, unless its folder is under checkouts, falls through to `this.launch({ ...run, run: \`run:${ulid(...)}\` })` (467).
- failure: `run.start` while `cpu.slot` is at its kind's cap: the caller gets the error, and the same command runs by itself after the next hub restart.
- fix: wrap 250-251 so a throw removes the journal entry: `const lease = await (async () => slot(this.o.leases(), await this.claimSession(run.claim), run.run, run.lane === 'fast' ? 'fast' : 'slow'))().catch((error: unknown) => { try { this.writeJournal((runs) => { delete runs[run.run]; }); } catch { /* recovery finds no start for it */ } throw error; });` (and drop the separate `holder` line).
- verify: unit test with a lease table stub returning `BLOCKED`; the journal file holds no entry after the rejected start.
- risk: a cut while a run waits for its slot is still rerun (by design, header line 3-4): unchanged.

### HUBREST-A12  A cut between a sync's "applying" status and its journal leaves the sync "applying" for good
- kind: broken
- confidence: LIKELY (a window of one fsync)
- where: src/agents.ts:662-664, 775-782
- evidence: `src/agents.ts:662-664` `s.status = 'applying'; this.save(s); this.writeJson(join('journal', \`${id}.json\`), { sync: id, files: journal });`. `recover` (775-811) walks only `journal/*.json`; the constructor re-arms only `proposed` syncs (378). The named durable point `sync_intent` (665) comes after both writes, so the crash tests (`tests/acceptance/148/crash.test.ts:50`) cut after the journal exists.
- failure: the hub dies between the two writes: the sync shows "applying" on the Agents page forever, nothing was written, its ask is spent, and recovery never drops it (the header at 9 says it "drops a sync that replaced nothing").
- fix: swap the order: write the journal, then set and save the status. `recover` doesn't read `s.status`, so a journal with a `proposed` sync is dropped as "replaced nothing".
- verify: by reading; `tests/acceptance/148/crash.test.ts` keeps passing (it cuts at `sync_intent` or later).
- risk: none found.

### HUBREST-A13  A skill update never changes an installed file's mode
- kind: broken
- confidence: LIKELY
- where: src/agents.ts:709, 693
- evidence: `src/agents.ts:709` `const keep = existsSync(real) ? statSync(real).mode & 0o777 : mode ?? 0o600;` — for a file that exists the planned mode (`t.file?.mode`, passed at 693) is ignored. The skill's pin does cover the mode: `src/agents.ts:347` `digest: sha(canonical(files.map((f) => [f.rel, f.sha, f.mode])))`.
- failure: a skill's `run.sh` is `100644` at commit A and `100755` at commit B. After the update the file has B's bytes and mode 0644, so the skill's script can't be executed, while the Agents page shows the skill at B's digest and `differs: false`.
- fix: `src/agents.ts:709` → `const keep = mode ?? (existsSync(real) ? statSync(real).mode & 0o777 : 0o600);` (config targets pass no mode, so they keep the file's own; undo's `replace` calls at 832 and 837 pass none either).
- verify: by reading the three `replace` call sites (653, 693, 832/837).
- risk: undo of such an update restores the bytes and not the old mode (it passes no mode); today's behavior there is unchanged.

### HUBREST-A14  A daemon restart that fails says nothing
- kind: broken
- confidence: LIKELY
- where: src/agents.ts:952-957, 620-623
- evidence: `src/agents.ts:956` `return new Promise((done) => execFile(bin, facts.daemon!.restart!, { ..., timeout: 60_000 }, () => done()));` drops the callback's error, and 955 resolves silently when the binary isn't on the login PATH. The caller wired a failure line that can never run: `src/agents.ts:623` `void this.runRestart(about.restart.agent).catch(fail);`.
- failure: you approve "Restart Codex's daemon"; `codex <restart args>` exits non-zero or times out at 60 s: no stderr line, no reading, the sessions keep the old MCP set and nothing tells you.
- fix: `src/agents.ts:955-956` → `if (!facts.daemon?.restart) return Promise.resolve(); if (!bin) return Promise.reject(Error(\`no ${facts.binary} on your login shell's PATH\`)); return new Promise((done, fail) => execFile(bin, facts.daemon!.restart!, {...}, (error, _out, stderr) => (error ? fail(Error(String(stderr || error.message).trim())) : done())));`
- verify: by reading; the plant path at 948 awaits `runRestart` inside `restart`, so wrap that call in `.catch(() => undefined)` to keep the plant's behavior.
- risk: the plant `restarts-without-answer` (948) would otherwise reject `agents.restart` when the restart command fails.

### HUBREST-A15  `agents/staged/<id>/` is never removed: every sync keeps up to three whole copies of each agent file for good
- kind: unneeded
- confidence: LIKELY
- where: src/agents.ts:335, 563, 658-659, 677-679 (writes); no delete anywhere
- evidence: `rg -n "staged" packages/hub/src` outside agents.ts finds only `staging.ts` (a different folder, `<root>/staged`). agents.ts has no `rmSync` on `stagedDir`. Per target a sync writes the planned bytes by digest (563), `after-<i>` (658) and `before-<i>` (659). Declined (628), dropped (787), refused (646) and undone (850) syncs keep theirs too; `readSkill` stages every blob before it checks for `SKILL.md` (335 vs 345), so a refused propose leaves a folder no sync names.
- failure: with Claude Code as a target the file is `~/.claude.json`, which holds every project's history and your MCP servers' env values; each sync leaves three mode-0600 copies of it under `~/.deepbuild/agents/staged/`, forever.
- fix: remove the folder where it can no longer be read: in `decline` after 628, in `recover`'s dropped branch after 790, in `apply`'s refused branch after 649, and at the end of `undo` after 851: `rmSync(this.stagedDir(s.id), { recursive: true, force: true });`. A complete sync's folder must stay (undo reads `before-<i>`).
- verify: by reading every reader of `stagedDir` (572, 644, 668, 799, 825-832).
- risk: `agents.read` of a declined sync still shows its diff from the sync's JSON, not from staged files.

---

## Part A questions (the owner's or the lead's call)

### HUBREST-A16  A push to the default branch that a ruleset refuses is not recorded when the repo has no `origin/HEAD`
- kind: inconsistent
- confidence: QUESTION
- where: src/starts.ts:373-377 against 477-483
- evidence: `worktree()` falls back to `origin/main` then `origin/master` when `refs/remotes/origin/HEAD` is unset (479-482). `defaultBranch()` reads only `origin/HEAD` (375) and returns undefined otherwise, so 366 `f.ref === \`refs/heads/${main}\`` is never true.
- failure: a repo made with `git init` + `git remote add` + `git fetch` (no `origin/HEAD`): sessions start fine from `origin/main`; a GH013 refusal of a push to `refs/heads/main` records no `forge.refused`.
- fix: give `defaultBranch` the same two fallbacks, or record the branch `worktree()` chose in `Started`.
- verify / risk: #1325's blind suite (`tests/acceptance/1325`) decides whether the record must show it.

### HUBREST-A17  The sibling map's "default branch" is whatever branch the main checkout has checked out
- kind: inconsistent
- confidence: QUESTION
- where: src/siblings.ts:559-566, 489-505; src/starts.ts:477
- evidence: `defaultHead` reads `<common>/HEAD` ("as its own HEAD names it"), while starts.ts takes `refs/remotes/origin/HEAD`. `tests/acceptance/352/helpers.ts:227-231` makes its merge in the repo's own checkout, so the suite pins the local reading.
- failure: the main checkout switches from an old branch back to `main`: `merges()` logs every `Merge pull request #N` between the two heads and tells each session whose files they touched to "Rebase onto main before you say done", including PRs merged before the session branched. A detached HEAD in the main checkout turns merge notices off. Squash and rebase merges are never seen (`--merges` and `MERGED`, 98 and 496).
- fix: none proposed; say in the header which branch is meant.

### HUBREST-A18  The skill audit's fetch-and-run patterns miss common forms
- kind: broken
- confidence: QUESTION (the audit is "a reading, never proof", 586)
- where: src/agents.ts:304-310
- evidence: `node -e` with the four fetch patterns: not flagged: `curl -fsSL https://x.sh | sudo -E bash`, `curl … | /bin/sh`, `wget -qO- … | env bash`, `curl … | tee f | sh`, `curl … |& bash`, `source <(curl …)`, `. <(curl …)`. Flagged: `| sh`, `| sudo sh`, `| bash -s`, `bash -c "$(curl …)"`, `| python3 -`.
- fix: widen the first pattern's tail to `\|&?\s*(sudo\s+(-\S+\s+)*)?(env\s+)?(\S*\/)?(ba|z|da|k)?sh\b` and add `(source|\.)\s+<\(\s*(curl|wget)\b`.
- risk: more installs stop for an answer; `tests/acceptance/148/skills.test.ts:22` pins only the plain `| sh` line.

### HUBREST-A19  `readSkill` parses `git ls-tree` without `-z`
- kind: broken
- confidence: QUESTION
- where: src/agents.ts:320, 329-331, 333
- evidence: without `-z` git C-quotes a path with non-ASCII bytes, a quote or a tab (`core.quotePath`), so `m[3]` is `"skills/n/caf\303\251.md"` with the quotes; `relative(path, m[3])` is then a path outside the skill folder's naming. A symlink (`120000 blob`) is written as a regular 0644 file holding the link's target text.
- fix: add `'-z'` to the `ls-tree` arguments and split on `'\0'`; skip or refuse mode `120000`.

### HUBREST-A20  A start that fails after its worktree is made leaves the worktree and its branch
- kind: broken
- confidence: QUESTION
- where: src/starts.ts:267, 283-287, 308-318
- evidence: the worktree is added at 267; a launch that fails returns a refusal at 286, and a never-started run ends at 310-317; neither removes the worktree or the `deep/<n>-…` branch, and nothing in `packages/hub/src` runs `git worktree remove` (`rg -n "worktree', 'remove'|worktree remove" packages/hub/src packages/gate/src packages/workspaces/src`: no match).
- fix: owner's call whether a refused start may delete what `worktree.created` recorded.

---

## Part A nits (one line each; all read from the code, none run)

- src/agents.ts:566 `items.length === 1 ? items[0]!.item : items[0]!.item`: both arms are the same (see HUBREST-A3).
- src/agents.ts:50, 62: `AgentFacts.home` is read from the facts and used nowhere (`rg -n "\.home\b" packages/hub/src/agents.ts` finds only these two lines).
- src/agents.ts:724, 731: `finish(s, journal)` never uses `journal` (`void journal;`); three callers pass it (685, 768, 810).
- src/agents.ts:883: `this.differs(k)` runs twice per skill on every `agents.read` (each run reads and hashes every file of the skill).
- src/agents.ts:880: `k.slice(k.indexOf(':') + 1)` on keys built as `${project}:${name}` (406): a project path that holds `:` gives the wrong name; `lastIndexOf` is right, since a name can't hold `:` (40).
- src/agents.ts:598: the folder the question names is cut at the first `/<skill name>/` in the path; a skill named like a folder above it (your user name, `skills`) names the wrong folder.
- src/runs.ts:439: `keptEnded` deletes the run from the journal a second time; `finish` (424) just did. One extra synced rewrite and one extra `journal_rewrite` durable point per kept run.
- src/runs.ts:443: `run.replace(/'/g, "''")` escapes a value that is passed as a bound `?` parameter.
- src/holds.ts:120: a hand-written `new Promise((done) => setTimeout(done, 20))` in a file that imports `setTimeout as sleep` (16) and uses it at 320.
- src/holds.ts:189-190: any ask not `open` or `later` reads "you said no", an ask that closed on its default included.
- src/ask-tasks.ts:36, 39: two import lines from `@deepbuild/gate`.
- src/ask-tasks.ts:568 against 549: `followed` splits a target at its first `#`, `unresolvedTarget` at its last.
- src/starts.ts:286: a launch that failed is recorded with bound `version`; `packages/contracts/schemas/start.refused@1.json` says "version: one its agent's facts don't cover". The enum is closed, so no better value exists today.
- src/starts.ts:264: "is past the versions its facts cover" is also said for a version older than the list.
- src/starts.ts:314: `readFileSync(join(s.dir, 'pid'))` is unguarded; if the file is missing the throw skips `sup.signal` and `sup.cleanup` (the caller at 292 swallows it). The host writes the file right after `forkpty` (`packages/supervisor/native/pty.c:652-653`), so this needs a host that is alive without one.
- src/starts.ts:516-518: `replaceAll(..., string)` reads `$&`, `$$`, `` $` `` and `$'` in the replacement: a home, repo or worktree path that holds one is rewritten (`'a{worktree}'.replaceAll('{worktree}', '/tmp/a$&b')` → `a/tmp/a{worktree}b`). Function replacers avoid it.
- src/siblings.ts:541: the `race.started` exemption matches the issue number in any repo.
- test/holds.test.ts:139-193: the last two tests open a record and never close it; the first test does (69).

## Part A: leftover `doneright` names

None in the six source files or the 27 test files (`rg -n -i "doneright|done-right|\.done/|done\.ya?ml"` over them: no match).

## Part A: unused exports

None found. Checked over `packages`, `crates`, `scripts`, `tests`, `benchmarks`, `docs`, `adapters`, `packs`:
`Agents`, `Sync` (core.ts:66), `AskTasks`, `WorkItem` (core.ts:40), `Plan` (scope.ts:14), `Starts`, `Siblings`,
`SiblingOptions` (test/siblings-notices.test.ts:9), `Runs`, `RUN_AS_YOU` (core.ts:81), `Holds`, `pushTargets`
(test/holds.test.ts:11). Every public method of the six classes has a caller in core.ts but four, which are called
only inside their own class and could be `private` (nit): `AskTasks.waitingWhy` (ask-tasks.ts:305), `Agents.installed`
(agents.ts:435), `Agents.recover` (agents.ts:775), `Starts.runOf` (starts.ts:116). Checked with
`rg -n "\.waitingWhy\(|\.runOf\(|agents\.installed\(|agents\.recover\(" packages tests`: no match outside those files.

## Part A coverage

| File | How read |
|---|---|
| src/agents.ts (958) | in full |
| src/ask-tasks.ts (832) | in full; no finding above nit level |
| src/starts.ts (575) | in full |
| src/siblings.ts (579) | in full |
| src/runs.ts (470) | in full |
| src/holds.ts (429) | in full |
| test/holds.test.ts | in full |
| test/start-ps, loop-transcript, gone-watch, pi-takeover, background (.test.ts) | in full |
| test/siblings-notices.test.ts | helpers and 4 of 14 tests in full, the rest by title |
| test/ask-tasks, background-group, background-hold, continues, siblings-order, loop-starters, session-states, monitor-ends, hook-parent, notification-idle, queued, asleep, jobs, answer-after-restart, claim-replay, replay, prompt-flush, threads, relations, callers (.test.ts) | titles, top-level helpers, imports and weak-matcher grep only; bodies not read |
| tests/acceptance/148, 1330, 352, 1523 | only the tests that touch a finding (to see what they pin) |
| src/core.ts, server.ts, gate-runner.ts | only the call sites named in the findings |

What the test skim found: no declared or imported name unused in any of the 27 files (script: each top-level
`const/function/type` and each named import appears on more than one line); every `../src/` import still exists;
the `toBeDefined`/`toBeTruthy` uses are preconditions followed by a stronger check. I did not find a test that
cannot fail, but 20 of the 27 bodies were not read, so that is not a clean bill for them.

Not checked: whether `asks.raise` dedupes by key (assumed in the `asked` set note of siblings.ts restore), the
`definitions` table's row-per-task rule behind `leftOf`'s `LIMIT 1` (ask-tasks.ts:806), and anything by running it.

---

## Part B, in full: `wiki-build.ts`, `acceptance.ts`, `status.ts`, `libraries.ts`, `channels.ts`, `waits.ts`, `open-items.ts`, `rules.ts`, `workspaces.ts`, `questions.ts`, `numbers.ts`, `scope.ts` (sub-reader's text)


Checkout read: `the checkout`. Read-only. Nothing was built or run but `rg`, `git log`, `wc` and pure `node -e` snippets (each named where it is used). Paths below are relative to that checkout.

Files: `packages/hub/src/{wiki-build,acceptance,status,libraries,channels,waits,open-items,rules,workspaces,questions,numbers,scope}.ts`, read in full, and 18 test files, skimmed (coverage table at the end).

Counts: 13 findings. broken 10, inconsistent 3. SURE 3, LIKELY 8, QUESTION 2 (HUBREST-B8 is LIKELY for its miss and QUESTION for its over-match). No unneeded export with zero users was found (five type exports are used only inside their own file; in the nits). No `doneright`/DoneRight name is left in these 30 files (`rg -i doneright` over them: no hit).

Not re-reported: #1885 (token beside the socket), #1880 (reading job on Codex), the hillclimb items (01-hub-hot F3–F5, F10; 02-hub-rest F5, the `Libraries.answers` note; 04-ts-small's `Numbers.fold` refold and `search` recompute), #1906's hand-rolled tmp-and-rename and `duration`/`isObj`/`letters` copies, the core-thread forks in `open-items.ts:57-60` and `scope.ts:82`.

---

### HUBREST-B1  The readings' first fold throws on a large record, and the cursor has already moved past the rows it lost
- kind: broken
- confidence: SURE (the mechanism, from the code and a measured limit; the row count a real record needs is stated)
- where: `packages/hub/src/numbers.ts:80-82`; reached from `numbers.ts:63-66` (`catchUp`), `core.ts:5638` (`numbers.read`), `core.ts:6856` (`deep_search`)
- evidence:
  ```ts
  80    this.at = rows.at(-1)!.log_pos;
  81    this.events.push(...fresh);
  82    this.state = update(this.state, fresh);
  ```
  `fold()` reads every event of 14 kinds plus failed `tool.after` since `this.at` (0 after each hub start) in one query (`:68`), then spreads the whole result into `push`: one call with one argument per row. Measured here on Node v24.22.2 with `a.push(...new Array(n).fill({}))`: inside a `worker_threads` Worker (the core runs in one, `server.ts:215`) it passes at n = 490,625 and throws `RangeError: Maximum call stack size exceeded` at 495,312; on the main thread it throws between 120,000 and 130,000. `fold` has one caller, `catchUp`, which chains the next fold after a rejection too (`:64`). Events are never retained away (01-hub-hot F7 says so; I did not re-check retention), so the first fold after every start reads all of them. `packages/hub/test/numbers.test.ts` folds a few hundred rows at most. The prior reports name `numbers.ts:82` and `:130` for cost only.
- failure: a record with about 490,000 or more events of those kinds. The first `numbers.read` or `deep_search` after a hub start rejects with the RangeError. Line 80 has already moved `this.at` to the newest row, so every later call succeeds and serves readings folded from nothing before that start. The numbers are silently short until the next restart, which does it again.
- fix: `numbers.ts:80-82`
  ```ts
      this.at = rows.at(-1)!.log_pos;
      this.events.push(...fresh);
      this.state = update(this.state, fresh);
  ```
  →
  ```ts
      // Folded first and the cursor moved last, so a fold that throws is read again, never skipped.
      const state = update(this.state, fresh);
      for (const e of fresh) this.events.push(e);
      this.state = state;
      this.at = rows.at(-1)!.log_pos;
  ```
- verify: `node -e 'const {Worker}=require("worker_threads");new Worker("const a=[];a.push(...new Array(500000).fill({}))",{eval:true}).on("error",(e)=>console.log(e.message))'` prints the RangeError; the loop form does not throw. `packages/hub/test/numbers.test.ts` must stay green.
- risk: none below the limit. With the cursor moved last, an `update` that throws for a reason of its own is retried on every call instead of being skipped once; that turns a silent gap into a repeated error. No test pins the order.

### HUBREST-B2  A reading chain that fails in its own clean-up is an unhandled rejection, which ends the hub's core
- kind: broken
- confidence: SURE (mechanism); it needs a file error at the wrong moment
- where: `packages/hub/src/wiki-build.ts:530-551`; `server.ts:232` (`worker.on('error', … onFatal`)
- evidence:
  ```ts
  541            } finally {
  542              for (const u of batch) reading.delete(u.session);
  543              const changed = changedSince(seen);
  544              bookkeeping(changed);
  545              seen = pagesOf();
  546            }
  …
  551        void chain.finally(() => { settled = true; });
  ```
  The `catch` at `:538-540` covers the `try`, not the `finally`. `changedSince` and `pagesOf` read every page (`:134-143`, `readdirSync` then `readFileSync`), `bookkeeping` writes `index.md` and appends `log.md` (`:150-160`). Any throw there (a page removed between the listing and the read, a full disk, a folder made unreadable) rejects `chain`. `chain.finally(cb)` returns a promise that rejects with the same reason, and `void` drops it. `rg unhandledRejection packages/hub/src` finds no handler, so Node raises it as an uncaught exception in the core worker, and the server treats the worker's `error` as fatal. When the build had already returned with `waiting: true` (`:553`), nobody else holds the chain either.
- failure: a reading job ends while `~/.deepbuild/wiki` can't be read or written (disk full is the likely one). The hub's core worker dies instead of one line on stderr.
- fix: `wiki-build.ts:551`
  ```ts
          void chain.finally(() => { settled = true; });
  ```
  →
  ```ts
          void chain.catch((error: unknown) => process.stderr.write(`deep hub: wiki reading: ${error instanceof Error ? error.message : String(error)}\n`)).finally(() => { settled = true; });
  ```
- verify: no existing test reaches it. By reading: `Promise.reject(1).finally(() => {})` with no handler exits Node with code 1 (`node -e 'void Promise.reject(new Error("x")).finally(()=>{})'`).
- risk: none; the loop below still ends on `settled`.

### HUBREST-B3  A blind job whose judging fails while the record can't be written is an unhandled rejection
- kind: broken
- confidence: SURE (mechanism); it needs an append to fail
- where: `packages/hub/src/acceptance.ts:269-271`, against `:272-274`
- evidence:
  ```ts
  269  private judging(e: Entry): void {
  270    void this.judge(e).catch((error: unknown) => this.end(e, 'refused', `its judging failed: …`));
  271  }
  272  private settling(e: Entry, d: Dispute): void {
  273    void this.settle(e, d).catch((error: unknown) => this.ask(e, d, …)).catch(() => undefined);
  ```
  `end` awaits `save` (the core's append, `core.ts:1120`) and then `pump`, which can call `first` and `save` again (`:224-230`, `:214-222`). When `judge` itself ended in `this.end(…)` and that append rejected, the handler calls `end` again, which rejects again, and nothing takes it. `settling` beside it and `answered` (`:199`) both end in `.catch(() => undefined)`; `judging` is the one that doesn't. Same consequence as HUBREST-B2: `server.ts:232`.
- failure: appends fail (the state `core.ts:1207` is written for: "While appends fail…") while a first draft's job ends. The core worker dies.
- fix: `acceptance.ts:270`: append `.catch(() => undefined)` to the chain, as line 273 has it.
- verify: by reading; `packages/hub/test/acceptance-slots.test.ts` and `tests/acceptance/1328/*` must stay green.
- risk: none. The entry stays without a result in memory, as it does today in the instant before the crash; `open()` judges it again at the next start (`:126-127`).

### HUBREST-B4  Two `wiki.build` calls while a reading job waits at the reserve read every later batch twice
- kind: broken
- confidence: LIKELY (read from the code; not run)
- where: `packages/hub/src/wiki-build.ts:130-131, 482, 530-548, 552-555, 564`; caller `setup.ts:183`, `core.ts:5701-5705`
- evidence:
  ```ts
  130  /** The sessions a reading job still has, so a build run while one waits doesn't hand them to another. */
  131  const reading = new Set<string>();
  …
  482        if (from < messages.length && !reading.has(s.id)) unread.push(…);
  …
  531          for (const batch of batches) {
  532            for (const u of batch) reading.add(u.session);
  ```
  Only the batch whose job is running is in `reading`. A build returns as soon as a job waits on the plan reserve (`:553`, "the job goes on"), which clears `building` (`:564`). The sessions of batches two onward are neither in `reading` nor advanced (`advance` runs only after their own job finished, `:537`). `openReading().run` submits a job per call with no dedupe by handle (`packages/reading/src/index.ts:258-278`).
- failure: more than 30 worth-reading messages across sessions (two batches, `JOB = 30`), the account at its reserve. `deep setup` runs `wiki.build`: batch A's job waits, the build returns `waiting: true`. `deep setup` runs again: batch B's sessions are unread and not held, so a second chain submits a job for B. When the window clears, the first chain finishes A and submits B again. B is read by two paid jobs.
- fix: hold every batch's sessions for the chain's whole life. `wiki-build.ts:530-548`
  ```ts
          const chain = (async () => {
            for (const batch of batches) {
              for (const u of batch) reading.add(u.session);
              try {
  ```
  →
  ```ts
          // Held from here, not from each batch's turn: a build run while the first job waits hands none of them to another.
          for (const batch of batches) for (const u of batch) reading.add(u.session);
          const chain = (async () => {
            for (const batch of batches) {
              try {
  ```
  and at the chain's end, so a chain that returned early on a failed job lets the rest go: wrap the `for` in `try { … } finally { for (const batch of batches) for (const u of batch) reading.delete(u.session); }`.
- verify: no existing test has two batches. Cheapest: in `tests/acceptance/356`'s world, two sessions with 16 `always …` messages each, the reserve held, `wiki.build` twice, then `job.list` must show two `read` jobs once the window clears, not three.
- risk: a later build no longer pattern-matches new messages of sessions queued behind a waiting job until that chain ends; today that is already so for the running batch. No test pins either.

### HUBREST-B5  A channel whose send answers nothing is sent the same card four times a second, and its other cards never go
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/channels.ts:263-270`, `:161-164`, `:214-217`, `:143-149`; `packages/extension-host/src/host.ts:1671-1679` (the package's answer is returned as it came)
- evidence:
  ```ts
  265      said = await (this.deps.call(c.name, 'deliver', item, this.ctx(c.name)) as Promise<ChannelDelivered>).catch(() => ({ outcome: 'timed_out' as const }));
  …
  269    const ack = said.outcome === 'delivered' && …
  ```
  A throw is turned into `timed_out`; an answer that is `null`, `undefined` or a string is not, and `said.outcome` throws a TypeError (or reads `undefined` on a string, which line 270 does map to `stalled`). On the throw: `t.inflight` is false again (`:267`), `t.tries` and `t.retryAt` are untouched (`:282-283` are never reached), no `channel.delivered` is appended, and `pass` rejects before the next item of `due()` (`:161-164`). `due()` keeps the thread (`!t.inflight && t.key !== keyOf(item) && Date.now() >= t.retryAt`, with `key` unset and `retryAt` 0), answerable cards first.
- failure: an installed channel package whose `deliver` returns nothing on some path (a missing `return`). Every 250 ms tick calls `deliver` for the first due card again, writes one stderr line, and sends no other card on that channel for the hub's life.
- fix: `channels.ts`, after the `finally` at `:266-268`:
  ```ts
      // An answer that is no object is a stalled send: it backs off like one.
      if (typeof said !== 'object' || said === null) said = { outcome: 'stalled' };
  ```
- verify: a unit of `Channels` with `call: async () => null` and one live ask: before, `call` is invoked once per tick; after, once, then at the back-off (2 s, 4 s, …) with `channel.delivered` `outcome: 'stalled'` on the record. `tests/acceptance/65/*` must stay green.
- risk: none seen; `stalled` is already the answer for an unknown outcome (`:270`).

### HUBREST-B6  A fetch under a standing rule that throws stays "held" with no ask until the hub restarts
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/libraries.ts:222-223`, `:191`, against `:272`; throws from `packages/extension-host/src/host.ts:1036-1045` and `sources.ts:469-475`
- evidence:
  ```ts
  222      this.fetches.set(key, { state: 'fetching', ask: null });
  223      return this.run(library, id, picked);
  …
  191    if (now?.state === 'fetching') return { status: 'held', ask: now.ask };
  ```
  `run` awaits `libraryFile`, which rethrows everything but `NoAnswer`; `workFetch` throws a plain Error when the source's quota is spent or its secret is missing. `run` also awaits `d.keep`. The answered path guards this (`:272`, `.catch((e) => this.fetches.set(key, { state: 'refused', … }))`); the rule path has no guard, and `core.ts:6680-6683` rethrows what isn't a `LibraryRefused`.
- failure: a library with a standing rule, its quota spent (or the store failing a `put`). The fetch errors once; every later fetch of that id answers `{ status: 'held', ask: null }`: waiting on an ask that doesn't exist.
- fix: `libraries.ts:223`
  ```ts
        return this.run(library, id, picked);
  ```
  →
  ```ts
        try { return await this.run(library, id, picked); } catch (e) { this.fetches.delete(key); throw e; }
  ```
- verify: `tests/acceptance/1731/fetch.test.ts` (the rule's CC0 control) must stay green. New behavior by reading: after a throw the next fetch starts over.
- risk: none seen. A related call the owner may want to make: `run` also remembers a non-200 answer (`:294`) and a hash mismatch (`:295`) as `refused` for the hub's life, so a 503 is never retried. Not changed here; no test pins it either way.

### HUBREST-B7  One thumbnail that can't be fetched fails the whole asset search
- kind: inconsistent (code against its comment) with a concrete failure
- confidence: LIKELY
- where: `packages/hub/src/libraries.ts:170-181`, called at `:165`; `core.ts:6678-6683`
- evidence:
  ```ts
  170  /** A row's thumbnail, fetched once through the library's source and kept by hash; null when it couldn't be. */
  …
  176    const got = await this.d.host()!.libraryFile(library, path);
  177    if (got.status !== 200) return null;
  178    const sha = await this.d.keep(got.bytes, 'asset.thumbnail', row.url, …);
  ```
  `libraryFile` returns `{ status: null }` only for `NoAnswer`; a spent quota throws (`sources.ts:469-470`). The throw is outside `searchOne`'s own try (`:147-152`), is no `LibraryRefused`, and leaves `search` through `core.ts:6680-6681` as an internal error. A search reads up to 50 thumbnails (`LIMIT_MAX`) on the source, on top of the fill's own calls.
- failure: a search whose thumbnail reads pass the source's own quota for the minute (two 50-row searches on a source that declares 60 a minute): it returns an error and no rows, from any library, where the comment promises rows with `thumbnail: null`.
- fix: `libraries.ts:176-178`
  ```ts
      const got = await this.d.host()!.libraryFile(library, path);
      if (got.status !== 200) return null;
      const sha = await this.d.keep(…);
  ```
  →
  ```ts
      let sha: string;
      try {
        const got = await this.d.host()!.libraryFile(library, path);
        if (got.status !== 200) return null;
        sha = await this.d.keep(got.bytes, 'asset.thumbnail', row.url, { name: row.license.id, allows: [] });
      } catch { return null; }
  ```
- verify: `tests/acceptance/1731/search.test.ts` must stay green.
- risk: a store failure on a thumbnail now reads as "no thumbnail" rather than failing the search; that is what the comment says.

### HUBREST-B8  The never-ending-command patterns miss `tail -n 100 -f` and take ordinary words in arguments for commands
- kind: broken
- confidence: LIKELY for the miss; QUESTION for the over-match (it is a heuristic by design; the inputs are real)
- where: `packages/hub/src/waits.ts:30` (miss); `:31, :32, :34, :36, :40` (over-match); effect at `:233-245`
- evidence: evaluated with the twelve regexes copied into `node -e`:
  ```
  ends      | tail -n 100 -f app.log          (:30 wants the -f flag first)
  ends      | tail -100f app.log
  ENDLESS#2 | kubectl logs --tail=100 mypod    (:31 --tail / -t end by themselves for kubectl, docker, journalctl)
  ENDLESS#2 | docker logs --tail 50 web
  ENDLESS#3 | git commit -m "add more tests"   (:32 watch|top|less|more after any space)
  ENDLESS#3 | cargo build && echo no more
  ENDLESS#3 | python -m pytest tests/ -k top
  ENDLESS#3 | git checkout -b more-tests
  ENDLESS#5 | npx vitest packages/hub/test/waits.test.ts   (:34 vitest without `run` ends when not on a TTY)
  ENDLESS#7 | grep -rn serve docs              (:36 serve|vite as a word)
  ENDLESS#11| ./release.sh --confirm yes       (:40 yes|cat at the end)
  ENDLESS#11| git log | cat
  ```
  An endless command in a Claude Code session that bypasses approvals gets `timeout: Math.min(expected, 600_000)` (`:243-244`), and `expected` is 60 s for a command with no history (`:10`). A call that reports failed teaches no time (`:261`), so if the timed-out call does, the next run gets 60 s again.
- failure: (miss) `tail -n 100 -f app.log` gets no deadline. (over-match) in a bypass session `git commit -m "add more tests"` with a pre-commit hook over a minute, `cargo build && echo no more`, or `npx vitest <file>` are cut at 60 s, every time.
- fix: for the miss, `waits.ts:30`
  ```ts
    /(^|[\s;&|(])tail\s+(?:-[a-zA-Z]*[fF][a-zA-Z]*|--follow)\b/,
  ```
  →
  ```ts
    /(^|[\s;&|(])tail\s+(?:[^;&|]*?\s)?(?:-[a-zA-Z0-9]*[fF][a-zA-Z0-9]*|--follow)\b/,
  ```
  Checked with `node -e` on `tail -f x`, `cd app && tail -F log | grep x`, `tail -fn 100 x`, `curl x | tail -f -` (true, as before); `tail -n 100 -f app.log`, `tail -100f app.log`, `tail -n 20 --follow x` (now true); `tail -n 5 file`, `tail -n 5 my-file`, `tail -c 10 x | grep -F y`, `tail -n 3 x; grep -f pats y` (false). For the over-match, the owner's call: match the listed names only in command position (start, or after `;`, `&`, `|`, `(`, with leading `NAME=value` and `sudo|npx|exec|env|time` allowed) instead of after any white space, and drop `-t|--tail` from `:31` for all but `heroku logs`.
- verify: `packages/hub/test/waits.test.ts:31-32` pins both lists and must stay green; add the rows above to them.
- risk: the `:30` edit is additive on the pinned cases. Narrowing `:32/:36/:40` could miss `FOO=1 npm run dev`-style forms if the prefix list is too short; that is why it is a QUESTION.

### HUBREST-B9  A PR's review threads past the first 100 are never read
- kind: broken
- confidence: LIKELY
- where: `packages/hub/src/open-items.ts:28-30`, `:157-159`
- evidence: the query asks for `reviewThreads(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { … } }` and `threads()` reads `nodes` only. `rg hasNextPage` over the checkout finds the query and the test fixture (`tests/acceptance/323/github.ts:32`, always `false`), no reader.
- failure: a PR with 101 or more review threads: an unresolved thread past the hundredth opens no item, so `openNotes` (`:216-218`) is empty for it and the PR may say Closes with a review note open (#87).
- fix: page until `hasNextPage` is false. In `THREADS`, `query($owner: String!, $repo: String!, $number: Int!, $after: String)` and `reviewThreads(first: 100, after: $after)`; in `threads()`, loop: read with `after`, push the page's nodes, stop when `pageInfo.hasNextPage !== true`, set `after = pageInfo.endCursor`; a page that fails (`status !== 200`) returns as today. About eight lines.
- verify: `tests/acceptance/323/review.test.ts` and `tests/acceptance/87/gate/review-notes.test.ts` must stay green (their fixture answers one page). A fixture answering `hasNextPage: true` once would show the second read.
- risk: one more GraphQL call per hundred threads at each claim. The recorded answers still match: `recordedGraphql` (`github-source.ts:73`) takes an answer when every variable it recorded equals the request's, ignores the query text, and so ignores an added `after`.

### HUBREST-B10  A dispute left with no redraft, or one of two, reads "stands" at the next start
- kind: broken
- confidence: LIKELY (needs a failed submit or a stop between two awaits)
- where: `packages/hub/src/acceptance.ts:172-176`, `:168-169`, `:128`, `:395-403`
- evidence:
  ```ts
  173    e.disputes.push(d);
  174    await this.redraft(e, d);
  175    this.settling(e, d);
  …
  395    while (d.drafts.length < d.jobs.length) { …
  400      if (d.drafts.length === 1 && draft.on_work === 'passes') await this.redraft(e, d);
  401    }
  402    const passing = d.drafts.filter((x) => x.on_work === 'passes');
  403    if (passing.length < 2) return this.settled(e, d, 'stands');
  ```
  (a) `redraft` can throw (`runner.submit` throws when the runner is closed or the append of `job.recorded` fails, `packages/runner/src/runner.ts:263, 285`; `save` at `:371` too). The dispute is already in `e.disputes` with `jobs: []`, `settling` is never started, and a second `acceptance.dispute` for the same test returns `{ job: null }` (`:169`). Any later `save(e)` records it; at the next start `open()` settles it (`:128`): the loop is skipped, zero passing drafts, `stands`. (b) A hub stopped between the save at `:398` and the redraft at `:400` leaves `drafts: [passes]`, `jobs: [j1]`: at the next start the loop is skipped and one passing draft reads `stands`, where the rule is that a second draft decides.
- failure: a disputed test is settled as standing with no blind redraft run on the work (a), or with the one that ran siding against the test (b).
- fix: (a) `acceptance.ts:174`: `try { await this.redraft(e, d); } catch (error) { e.disputes.splice(e.disputes.indexOf(d), 1); throw error; }`. (b) at the top of `settle`, before the loop: `if (d.drafts.length === 1 && d.jobs.length === 1 && d.drafts[0]!.on_work === 'passes') await this.redraft(e, d);`.
- verify: `packages/hub/test/acceptance-slots.test.ts` and `tests/acceptance/1328/*` must stay green; neither restarts the hub mid-dispute.
- risk: low. (b) submits a job at start for a dispute in that state, which is the job the stop cut off.

### HUBREST-B11  Whether "your rules reserve commits" reads other files than the rules page does
- kind: inconsistent
- confidence: LIKELY
- where: `packages/hub/src/questions.ts:86-94`, used at `:186`; against `packages/hub/src/rules.ts:134-150` and `:70-76`
- evidence:
  ```ts
  88  for (const file of [join(homedir(), '.claude/CLAUDE.md'), join(cwd, 'CLAUDE.md'), join(cwd, 'AGENTS.md')]) {
  ```
  `rules.ts` reads both user-level files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `:146`) and finds the repo from any folder inside it (`repoRoot`). This list has no `~/.codex/AGENTS.md` and reads `cwd`, not the repo's root. `rg commit-not-reserved` finds no test; `tests/acceptance/84/sort/README.md:77` drives AC8 through a guard entry, the other half of line 186.
- failure: a Codex session whose `~/.codex/AGENTS.md` says "Never commit unless I ask", or any session started in `repo/packages/x` whose root `AGENTS.md` says it, ends on "Want me to commit this?". DeepBuild answers `proceed` by rule `commit-not-reserved` where the design says a commit your rules reserve is authority (`docs/technical-design.md:2178`).
- fix: `questions.ts:88`
  ```ts
    for (const file of [join(homedir(), '.claude/CLAUDE.md'), join(cwd, 'CLAUDE.md'), join(cwd, 'AGENTS.md')]) {
  ```
  →
  ```ts
    const repo = repoRoot(cwd) ?? cwd;
    for (const file of [join(homedir(), '.claude/CLAUDE.md'), join(homedir(), '.codex/AGENTS.md'), join(repo, 'CLAUDE.md'), join(repo, 'AGENTS.md'), join(cwd, 'CLAUDE.md'), join(cwd, 'AGENTS.md')]) {
  ```
  with `import { repoRoot } from './rules.js';`.
- verify: `tests/acceptance/84/sort/authority.test.ts` must stay green.
- risk: only toward asking: more commit offers become authority asks. No cycle: `rules.ts` imports only `client.js` (which imports `paths`, `compat`, `generations`, `wire`), and `questions.ts` is imported by `core.ts` and `holds.ts`.

### HUBREST-B12  `isRuleFile` says yes to files the rules page never reads, so a line removed from one becomes a rule in force
- kind: inconsistent
- confidence: QUESTION (which side is right is the owner's call)
- where: `packages/hub/src/rules.ts:256-257` against `:105-119`; users `server.ts:973-974`, `core.ts:4229-4241`
- evidence: `repoFiles` skips every dot-folder and `node_modules`, `target`, `dist`, `build`, `vendor`, `.venv` (`:116`). `isRuleFile` is `/(^|\/)(AGENTS|CLAUDE)\.md$/` and so is true for `.claude/CLAUDE.md`, `vendor/y/CLAUDE.md`, `node_modules/x/AGENTS.md` (checked with `node -e`). On an edit of such a file the server records its bullets with scope `all` (`server.ts:974`, the file isn't among `files`), and `holdRemoved` turns each removed bullet into a held rule and a proposal to you; `rulesOf` (`:170-175`) then lists it as a rule in force for every path.
- failure: an agent rewrites `vendor/y/AGENTS.md` (or `.claude/CLAUDE.md`, which Claude Code does read as project memory and this page does not): each bullet it dropped appears on your rules page as held, scope `all`, though no bullet of that file was ever a rule here.
- fix: either read what `isRuleFile` accepts (add `.claude/CLAUDE.md` to `repoFiles`, as `.github/…` and `.cursor/rules` are added at `:124-125`) or make the test agree with the walk: `rules.ts:257` `/(^|\/)(AGENTS|CLAUDE)\.md$/.test(rel)` → `(/(^|\/)(AGENTS|CLAUDE)\.md$/.test(rel) && !rel.split('/').slice(0, -1).some((d) => d.startsWith('.') || SKIP.has(d)))`.
- verify: `tests/acceptance/344/*` must stay green.
- risk: the second form stops holding a line removed from `.claude/CLAUDE.md`; the first starts listing its rules. Neither is pinned.

### HUBREST-B13  A session outside any repo gets a second workspace after a hub restart
- kind: broken
- confidence: QUESTION (no test or design line says a restart must keep it)
- where: `packages/hub/src/workspaces.ts:55-56`, `:147-153`, `:61-73`
- evidence: `sessions` ("The workspace a session outside any repo landed in, so its next task lands there too") is set only in `land` (`:153`) and is not rebuilt in `open()`, which restores `spaces` and `tasks` from `workspace.created`, `workspace.moved` and `state.read`. `workspace.created` is appended on a connection with no session (`:82-84, :111`).
- failure: a session in `~/Downloads` opens a task, lands in workspace W; the hub restarts; the session's next task finds `known` undefined, makes workspace W2 and tells the agent a new home (`:151`).
- fix: record the session on `workspace.created` (`data.session`) and set `this.sessions` from it in `open()`; or derive it from `task_ref` when it has the `session:<id>#<n>` form (`core.ts:7031`). The schema for `workspace.created` would need the field, so this is not a hand edit.
- verify: `packages/hub/test/workspace-landing.test.ts` and `tests/acceptance/67/*` must stay green; none restarts.
- risk: touches a contract.

---

## Part B nits

- `wiki-build.ts:423`: a `config.json` holding `null` makes `choose` throw a TypeError (`config.plan`), failing `wiki.build`; one holding an array is "changed" and written back unchanged. The comment says a file that doesn't parse is left alone; say the same for one that is no object.
- `wiki-build.ts:329`: the kept user memory file's `source` is its own hash (`source: at`); `remember` at `:291` gives the path.
- `wiki-build.ts:566-579`: `forget` and `writeRules` wait for `building` but not for a chain still reading after a `waiting` build; both then log the same page change (two `log.md` lines).
- `libraries.ts:98`: a `libraries.json` that doesn't parse, or parses without `on`/`rules`/`assets`, throws in the constructor, inside the core's start (`core.ts:1127`); `channels.ts:347-354` falls back to empty for its file.
- `libraries.ts:28-40, 57, 73`: `AssetLicense`, `AssetRow`, `FileRef`, `LibraryDeps`, `FetchReply` are exported and used only in this file (`rg -lw` over packages, crates, scripts, tests, benchmarks, docs, adapters, packs: one file each). Types only; drop `export` or leave.
- `open-items.ts:5`: the header says every item is `open_item.opened@2`; `stillNeeded` writes v3 (`:188`), rightly, since `open_item.opened@3.json` is what adds `from: verdict`.
- `open-items.ts:122`: an item closed by a reviewer's resolution stays closed when the thread is unresolved again (`was` exists, so the loop continues); `tests/acceptance/323/README.md:122` says a later `opened` reopens. QUESTION; edit would be `if (was && (was.open || !was.by?.startsWith('review thread')) && !(…)) continue;`.
- `open-items.ts:57-60, 143`: a `git diff` that fails or passes its 10 s timeout reads as no added lines, with no stderr line; `atClaim`'s own failure at least writes one (`core.ts:7230`).
- `open-items.ts:242`: a waiver's item is looked up among the newest 5,000 openings; an older one is silently not closed.
- `questions.ts:178`: when `struck` removes every option, `options[0]!.id` throws inside the stop's sort.
- `questions.ts:280`: a card with no questions answers `{ answers: {} }` for Claude Code.
- `rules.ts:52`: a glob with braces (`**/*.{ts,tsx}`) is split at its comma and never matches (`node -e`: false); the comment documents commas only. Copilot's `applyTo` and Cursor's `globs` both take braces.
- `rules.ts:94-95`: `* * *` and `- - -` (thematic breaks) read as the rules `* *` and `- -` (`node -e`).
- `rules.ts:142`: a Cursor rule with neither `globs` nor `alwaysApply: true` (one the agent requests) gets scope `all`.
- `rules.ts:217`: every agent but Codex is taken to read `CLAUDE.md` by itself (`own = agent === 'codex' ? 'codex' : 'claude-code'`), pi and Cursor included.
- `waits.ts:243-244`: the attached deadline replaces a shorter `timeout` the agent set itself (`npm run dev` with `timeout: 10000` becomes 60 s). QUESTION; `Math.min` with a numeric `call.input.timeout` would keep the shorter.
- `channels.ts:292-299`: `a?.thread_key` allows for a null answer; `a.signature` on the next lines doesn't.
- `channels.ts:118, 124`: a links file that doesn't parse reads as `{}` and the next `link()` writes over it.
- `workspaces.ts:171`: `fill` refuses `..` but not `.git/…`, so a handed file can write the workspace's `.git/config` before `keepWork` runs git there. Reachable only through `DEEP_HUB_TEST_DRAFTS` today (`server.ts:436`); worth closing before a real drafting job hands files.
- `workspaces.ts:104-111, 122-133`: the event is appended after `trust()`; a trust that throws leaves a folder made or moved with nothing on the record.
- `workspaces.ts:66`: a `workspace.moved` with no `workspace.created` before it throws in `open()`.
- `numbers.ts:120`: `read()` runs `checks()` twice (once inside `checked`), so each `numbers.read` reads and classifies both label files twice.
- `acceptance.ts:357-360`: a stop between `update-ref` and the saved `ready` makes the next start judge again, and `update-ref … 0000` then refuses its own branch.
- `status.ts`: nothing found. (`numbersCommand`, the `deep numbers` command, lives here rather than in `numbers.ts`; no change proposed.)
- Tests: `wiki.test.ts:66` writes its confirm file in `/tmp` and never removes it; `acceptance-slots.test.ts:33-36` makes a temp folder per call that nothing removes and leaves `DEEP_HUB_TEST_CONFIRM` set; `numbers.test.ts` `await until(0)` waits for nothing.

---

## Part B coverage

| File | How read |
|---|---|
| `packages/hub/src/wiki-build.ts` (581) | in full |
| `packages/hub/src/acceptance.ts` (443) | in full |
| `packages/hub/src/status.ts` (375) | in full |
| `packages/hub/src/libraries.ts` (358) | in full |
| `packages/hub/src/channels.ts` (354) | in full |
| `packages/hub/src/waits.ts` (343) | in full |
| `packages/hub/src/open-items.ts` (276) | in full |
| `packages/hub/src/rules.ts` (310) | in full |
| `packages/hub/src/workspaces.ts` (303) | in full |
| `packages/hub/src/questions.ts` (287) | in full |
| `packages/hub/src/numbers.ts` (250) | in full |
| `packages/hub/src/scope.ts` (217) | in full |
| `test/wiki.test.ts`, `waits.test.ts`, `waits-hub.test.ts`, `numbers.test.ts`, `acceptance-slots.test.ts`, `status-question.test.ts`, `waiting-quiet.test.ts`, `reserve-wait.test.ts`, `scope.test.ts`, `size-scope.test.ts`, `workspace-landing.test.ts`, `floor.test.ts`, `slot.test.ts` | read through (lines cut at 210–330 characters) |
| `test/checkouts.test.ts`, `extensions.test.ts`, `reading.test.ts`, `archive.test.ts`, `overridden.test.ts` | outline only: imports, every `it`/`describe`, every `expect` line. They drive `@deepbuild/gate`'s checkouts, the extension host, the hooks-not-reaching reading, the archive and mods through a real hub; none imports a file of mine. |
| `core.ts`, `server.ts` | call sites only (`core.ts:1118-1215, 4222-4246, 5638-5720, 6655-6700, 7222-7232`; `server.ts:215-232, 420, 436, 973-981`) |
| Other packages | only to check a claim: `runner/src/runner.ts:262-294`, `reading/src/index.ts:256-300`, `extension-host/src/host.ts:1015-1045, 1664-1679`, `extension-host/src/sources.ts` (`workFetch` throws), `workspaces/src/index.ts:61-80`, `contracts/schemas/open_item.opened@*.json`, `definition.locked@2.json` (requirement id pattern) |

What the tests are: all 18 run real components (a real hub over its socket, a real record, real git); I found no test that would pass with its subject returning nothing, no test of something that no longer exists, and no unused helper in them. `reserve-wait.test.ts` and `floor.test.ts` test `ask-tasks.ts`, not a file of mine.

Not done: no test was run, so every "must stay green" is unverified. The over-match half of HUBREST-B8 and HUBREST-B11–HUBREST-B13 rest on reading the design line, not on a failing run. I did not read `tests/acceptance/{65,84,120,323,344,356,1328,1731}` beyond the lines quoted, so a pin in a suite I only grepped could exist; the greps I ran for each are named in the finding.

---

## Lead reader: what was checked mechanically over the whole area

- Leftover `doneright` names: none. `rg -i "doneright|done-right|done right" packages/hub` finds nothing in source, tests, fixtures or the README.
- Modules nothing imports: none. Every file under `packages/hub/src` is imported by another source file, by `packages/cli/src`, or is an entry in `package.json`'s `exports` (`hub-command.ts`, `heavy.ts`, `mcp.ts`, `mcp-exec.ts`). `installer.ts` is imported only by `tests/acceptance/41/install` (in use, by the brief's rule; see the nit).
- Exports with no user: 474 exported names in the area were matched (`rg -o -w -F -f names.txt`) against `packages crates scripts tests benchmarks docs adapters packs skills` with twins, `dist` and `node_modules` left out. Nine had no user outside their own file; the four worth a line are in the nits (`memoryPressure`, `driveCall`, `PointKind`, `Compat`), and five are types in `libraries.ts` (part B's nits). The 29 names used only outside `packages/hub/src` were each looked up: all are used by a hub test, an acceptance suite or a benchmark.
- Planted wrong programs: all 288 names in `plant.ts` are read by some source file outside it and named by some test or script (two `rg -F -f` passes). None is dead.
- Dependencies: every `@deepbuild/*` package in `packages/hub/package.json` is imported under `src/`, and every one imported is listed; `yaml` and `better-sqlite3` are used.
- `tools.json` and `tools.ts`: the same 13 tool names on both sides.
- Tests, all 88 files: no `.skip`, `.only` or `.todo` (seven `it.runIf(platform)` in `onboarding.test.ts`); every `../src/<module>.js` import names a file that exists; every test file has assertions; every export of `test/hub.ts` has a user; `expect(true).toBe(true)` appears nowhere.

## Coverage, lead reader

| Files | How read |
|---|---|
| `src/`: `agent-files`, `answers`, `authority`, `backup`, `canvas`, `canvas-doctor`, `children`, `children-worker`, `claude-settings`, `client`, `codes`, `codex-loops`, `codex-settings`, `compat`, `confirm`, `contracts`, `core-worker`, `could-do`, `disk`, `doctor`, `drive`, `env`, `fix-command`, `forge`, `gate-command`, `generations`, `github-source`, `guards`, `heavy`, `hook-programs`, `hub-command`, `identity`, `inbox`, `install`, `installer`, `keychain`, `kinds`, `leftover`, `lock`, `mcp`, `mcp-exec`, `mcp-servers`, `memory`, `mods`, `named`, `panels`, `parser`, `paths`, `people`, `process-health`, `products`, `promises`, `promote`, `reach`, `readonly-core`, `release`, `remote`, `retention`, `search`, `secret-command`, `service`, `session-facts`, `settle`, `setup`, `shared-runs`, `show`, `spool`, `stacks`, `staging`, `standing`, `start-command`, `teardowns`, `tools`, `trusted`, `undo`, `verdict-chat`, `vfs`, `visible`, `wire`, `workspace-command` (80 files) | in full |
| `src/plant.ts` (330 lines) | first 30 and last 25 lines read; every plant name cross-checked mechanically (above). The middle, the union type's comments and `plantOf`, was not read line by line |
| `src/agents`, `ask-tasks`, `starts`, `siblings`, `runs`, `holds` | part A's reader, in full (its coverage table above) |
| `src/wiki-build`, `acceptance`, `status`, `libraries`, `channels`, `waits`, `open-items`, `rules`, `workspaces`, `questions`, `numbers`, `scope` | part B's reader, in full (its coverage table above) |
| `native/build.mjs`, `native/deep-confirm.swift`, `native/dev.deepbuild.confirm.policy`, `README.md`, `package.json`, `tsconfig.json` | in full |
| `tools.json` | keys only, against `tools.ts` |
| `fixtures/canvas-doctor.json` | not read; its loaders are `src/canvas-doctor.ts:19` and `scripts/seams.mjs:35` |
| `test/onboarding.test.ts:96-150`, `test/holds.test.ts:125-151`, `test/codex-hub.test.ts:312-336`, `test/promises.test.ts` (grepped), `test/codex-files.test.ts` (grepped) | read where a finding needed to know what is pinned |
| The other tests of the lead's share (`install`, `codex-files`, `codex-hub`, `env-resources`, `mods`, `mods-start`, `products-start`, `memory`, `memory-overrule`, `stack-provider`, `hook-programs`, `drive`, `hub.ts`, `onboarding`) and the whole share of the sub-reader that could not be started (`forge`, `guards`, `guard-forms`, `shared-runs`, `shared-runs-hub`, `github-source`, `promises`, `promises-hub`, `verdict-chat`, `verdict-stop`, `teardowns`, `people`, `reach`, `answers`, `codes`, `leftover`, `visible`, `hub-down`, `client-compat`, `cant-run`, `parsers`, `actions`, `actions-server`, `gate-identity`, `gate-queue`, `gate-runner`, `gate-stop`, `login-plan`) | NOT read through: only the mechanical checks above. "A test that cannot fail" and "a test of something gone" are not established for these 42 files |
| `src/core.ts`, `server.ts`, `gate-runner.ts`, `hookmap.ts` | call sites only (`core.ts:748-760, 842-843, 1027-1029, 1568, 1817-1818, 4454, 5696-5698, 6567, 7335-7368`; `server.ts:230-233, 450-455`) |
| Outside the area, to check a claim | `crates/deep-hook/src/main.rs:1568-1640` (status line), `crates/deep-hook/default-rules.json` (keys), `packages/asks/src/index.ts:317-335, 426-432`, `packages/env-local/src/stack.ts:765-780`, `packages/contracts/schemas/error@2.json`, `error@3.json`, `adapters/loops.facts.json:24`, `tests/acceptance/55/real.test.ts:78-106` (grepped), `tests/acceptance/41/install` (grepped) |

Not done: no test, build or type-check was run, by the limits. Nothing in `tests/acceptance` was read beyond the lines
named. HUBREST-4 rests on how launchd treats a loaded job, which was not tried on this Mac. The speed and memory
items of the two earlier audits were not looked at again.
