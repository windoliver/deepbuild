# #2345: the proof #1687 left unrun

**Outcome.** AC2, AC3 and AC4 are proven. For AC1, the full `affected.mjs --slow --timed` selection for #2236's change set ran on both sides, timed files included:

- 5,223 rows by test; 4,919 are the same on both sides.
- The 304 rows that differ are named below with their causes: the tests #2236 added, #2342's fixture fix, main's crate changes, the machine and its load, and flakes that land on either side.
- 16 of them fail only on the merged result, with no message naming a cause.

When this was written, 105 files with differing rows were still being run in pairs, each file on both sides back to back. Their causes are named from the rows' own messages, and the pairs' rows will replace them.

| Criterion | Result |
|---|---|
| AC1, the full selection gives the same rows on both sides, or each row that differs is fixed or named with its cause | 4,919 of 5,223 rows the same. The 304 that differ are named below; none is fixed in code. 16 fail only on the merged result with no message-borne cause, and their pairs were still running |
| AC2, `takes-first-stamp` fails its criterion case at its assertion 20 of 20, and the clean program passes the same 20 | Proven, on the blind redraft `tests/acceptance/39/redraft-ac5` |
| AC3, `21/plant-ignored` fails its criterion case at its assertion under a timed grant | Proven, in a timed window opened at load 12 |
| AC4, the three loader-review digests confirmed by a review #2236's author didn't make | Proven: [issue-2345-loader-review.md](issue-2345-loader-review.md) |

## The two sides

- **Merged result:** `1c4d1f0e2`, main with #2236 merged.
- **Merge base:** `651bf06d3`, the merge base of `1c4d1f0e2`'s two parents. This is the one #2236 named as its own.
- **Main's other changes:** between the two commits, main also took #2341, #2342 and #2344. They touch tests in `173/`, `2017/` and `236/`, the 3D renderer crates and `crates/deep-show`. A row only those reach is named as theirs.
- **Checkouts:** each side ran in a private clone of this repository at its commit, after `npm ci` from the same lock (#2236 doesn't change it).

## AC1: how the selection ran

**The selection.** `node scripts/affected.mjs --list --slow --timed <#2236's 150 changed paths>` gives 1,322 files on the merged result:

- 476 parallel vitest and 21 parallel node;
- 743 alone vitest, in 167 shard groups and 3 exclusive ones;
- 81 timed vitest and 1 timed node;
- `cargo test -p deep-app` and the lint scripts.

The merge base gives the same files in the same blocks, less the 5 tests #2236 added (`tests/acceptance/1687/...`). Its `affected.mjs` reads every path it is given, so those 5 were left off its list. Main's copy has since learned to skip a test file that isn't there. No run printed a WIDE line.

**`deep-hook` in every checkout.** At both commits the hub finds `deep-hook` only under its own checkout's `target/` (`packages/hub/src/paths.ts`, `deepHook`). The machine's hourly cleanup empties an idle shard's `target/`. A first attempt therefore read more than 200 hub-test rows BLOCKED with "no deep-hook is built". It was stopped and restarted.

Before each side's run, `deep-hook` was built with `--features env-plants` in the side's checkout and in each shard the run then claimed, as the shared world helper builds it. The shards were claimed through `scripts/shards.mjs`'s `claimShards`, at the side's own tree.

**Four phases:**

1. **Every block but the timed one.** On each side: `node scripts/throttle.mjs test --wait 720 -- node scripts/affected.mjs --slow <the change set>`. Each side ran inside one test grant, so its build, binaries and shard requests passed through it instead of each queueing 30 minutes for the machine's one build slot. The two sides overlapped for most of their runs.
   - Merged: 2,953 passed, 979 new failures, 13 already failing on main, 674 inconclusive or blocked, 21 listed skips, 35,110 s.
   - Merge base: 3,129 passed, 932 new failures, 14 already failing on main, 509 inconclusive or blocked, 21 listed skips, 18,450 s.
   - The load ran from 100 to 500. Rows compared by test: 5,081, of which 934 differed, in 398 files.
2. **The 82 timed files, in one timed window.** `node scripts/throttle.mjs timed -- …`, opened at load 12 with no other grant on the machine. On each side in turn: `node scripts/affected.mjs --slow --timed <the 82 timed files>`.
   - Merged: 229 passed, 194 new failures, 11 already failing on main, 99 inconclusive or blocked, 2 listed skips, 6,894 s at load 6.
   - Merge base: 228, 194, 11, 100 and 2, in 6,387 s at load 17.
   - Of the timed files' 272 rows, 258 were the same.
3. **Every file with a differing row, again.** 393 files on the merged result and 388 on the merge base, both sides at once, the same way as phase 1. After it, 339 rows differed, in 137 files.
4. **Pairs.** Each file still differing ran once on the merged result and right after on the merge base (`vitest run --no-file-parallelism <file>`, as `affected.mjs` runs an alone file), so both saw the same machine. The 9 timed files ran in a second timed window.

**Rows.** Each run's reports were read with that side's own parsers (`reportResults`, `cargoResults`, `lintFindings` from `scripts/`). A pass is a row too, and the run's printed lines fill in what no report holds. A file run again takes its rows from its latest run, on both sides. [issue-2345-rows.tsv](issue-2345-rows.tsv) holds every row: test, merged, merge base, and the phase it came from.

**Leftover processes.** Test hubs at both commits leave `/usr/bin/log stream` children behind. Both commits' `deep lease` (`runGroup` in `packages/hub/src/heavy.ts`) waits until every process of its command's group has ended, so a job whose tests had all reported could wait for hours. Those leftovers were stopped by PID, only for jobs of these runs and only after their tests had reported, which changes no row. The same was done for one `824` cleanup's `lsof -t +D`, which ran 2.5 h after its four tests had reported.

## AC1: the rows that differ, and why

Each differing row gets the first cause in this table that fits it, read from the row's own messages:

| Rows | Cause |
|---|---|
| 33 | Tests #2236 added (`tests/acceptance/1687/`), which the merge base doesn't have |
| 23 | `tests/acceptance/236/`: on the merge base the devices fixture doesn't build (`'CGDisplayCreateImage' is unavailable`). #2342 fixed that fixture on main between the two commits |
| 57 | Timeouts under load: "Test timed out", "Hook timed out", "the hub wasn't ready within 10 s", waits that ran past their limits |
| 52 | A hub started while `deep-hook` was absent or being rebuilt under it: helpers rebuild it with different features beside running tests |
| 52 | A test's hub didn't start or stopped answering ("didn't start", "unreachable", "exited before it was ready") |
| 15 | A test that ran on one side only, because its file stopped early on the other |
| 4 | The machine: no real pi, `DEEP_CLAUDE_BIN` unset, no Screen Recording permission, a locked screen, no Docker or test VM, `ps` overflowing its buffer |
| 14 | Lint findings in Rust and canvas files main changed between the two (#2341, #2342, #2344) |
| 3 | Lint findings for `packages/hub/src/core.ts`, `packages/extension-host/src/host.ts` and `packages/asks/src/index.ts` over their size ceilings on the merge base only: #2236 shrank them |
| 3 | Lint: the slot kit's fixture environment sometimes "did not come up", on both sides. Two more runs of each lint gave the same findings on both sides once, and one different finding the other time |
| 19 | The merge base fails or blocks where the merged result passes, with no message naming a cause: in `1018/hub`, `323/*`, `1017/floor`, `315/failopen`, `331/install`, `39-redraft/job`, `18/mapping/record`, `19/authority`, `352/merge` and `824/leftovers` |
| 9 | Both sides fail or block, differently (FAIL on one, BLOCKED on the other): in `1018/hub`, `323/*` and `875/hub` |
| 4 | Skipped with no note on the merged result, passed on the merge base: `504-redraft-ac2/explains` |
| 16 | The merged result fails or blocks where the merge base passes, with no message naming a cause (below) |

**Rows failing only on the merged result.** 16 rows fail or block on the merged result and pass on the merge base, without a timeout or an environment message:

- `25/routes/thirty-stops` (2), `25/routes/session-end`, `25/routes/stalled`
- `875/hub` (2), `323/match`, `331/install`, `18/mapping/record`
- `1922/build`, `26/search`, `344/sets`, `350/staged`, `67/loop`, `67/targets`
- `1863/filter`, BLOCKED: "the handed definition must lock: none was recorded"

Five of these files also have rows that only the merge base fails: `875/hub`, `323/*`, `331/install` and `18/mapping/record`. Their pairs were running when this was written.

**Already settled by pairs:**
- **The 9 timed files that differed** now give the same rows on both sides: `1461/budget`, `154/budgets`, `1863/speed`, `2026/load`, `25/routes/twenty-minutes`, `25/routes/wake`, `27/budgets`, `325/timing` and `340/flow/budgets`.
  - `1863/speed` and `154/budgets` had read "the DeepBuild hub is unreachable" on the merged result in the timed window. Their pairs pass, and the merged result's `1863/speed` also passed when run three times on its own.
  - `1461/budget`'s benchmark had failed on the merged result because `deep-drive` wasn't built in that checkout yet. Run directly it gives 700 rows in 29 ms, and its second pair is the same on both sides.
- **13 non-timed files:** 124 rows the same, and 3 that differ, all in `packages/hub/test/monitor-ends.test.ts`. Each is a 120 s timeout, on one test on the merged result and on two other tests on the merge base.

**A reading, not a decision.** `2026/load` misses its 1,000 ms budget on both sides. In the timed window: merged 1,192 to 1,235 ms, merge base 1,158 to 1,207 ms. In its pair: merged median 1,264 ms, merge base 1,233 ms. Both times the merged result's median is 2.5% to 3.7% higher, at loads where the test itself calls the timing a reading only.

## AC2: `takes-first-stamp` fails its criterion case 20 times in 20

**The case.** `tests/acceptance/39/redraft-ac5/ac5.test.ts` is the blind redraft of #39's AC5 (`#39.de9f23ce`). The job that wrote it never saw the first draft's tests, the twins, the hub's binding code or this dispute. Its brief carried one disclosure, in general terms: fix every order the case relies on, and cover both orders in which the two calls can reach the hub relative to the two stamps. Its README quotes it.

The redraft has two cases. Thread A's PreToolUse is sent, then thread B's, each in the record before the next step. Then the two `deep_ask` calls go, each call's ask in the record before the next call is sent:

- one case sends the calls in the stamps' order;
- the other sends them against it.

**The runs.** At `1c4d1f0e2`, 20 rounds, each running the redraft's file once on the clean program and once with `tests/acceptance/39/twins/takes-first-stamp` laid over it. The twin differs from that commit's `packages/hub/src/mcp-operations.ts` by exactly its two fault lines. Each failure is classed by `scripts/proof-runs.mjs`'s own `atAssertion`: a framework assertion thrown under the test paths. Rows: [issue-2345-twin-runs.json](issue-2345-twin-runs.json).

| Program | Case in the stamps' order | Case against it |
|---|---|---|
| Clean | 20 of 20 pass | 20 of 20 pass |
| `takes-first-stamp` | 20 of 20 pass | **20 of 20 fail at the assertion** in `ac5.test.ts`, each with thread A's ask filed under thread B's session |

The twin binds a call to the first unspent stamp without checking its digest. It passes the case in the stamps' order, as it should: that case is there for a wrong program that binds to the newest stamp.

The rounds ran at load 12 to 32, 3 s to 4 s each. They ran outside a throttle grant, while this issue's two affected runs held the machine's two test slots.

**Three earlier rounds at load about 400 are not counted.** There the hub stamped neither program's calls reliably: calls came back `unbound` ("no PreToolUse stamped for it is unspent") on the clean program as well as the twin. The hub records a stamp only for a verified, unreplayed PreToolUse, and under that load the hook's check didn't complete. Those rounds are in the same file.

The first draft's AC5 case in `tests/acceptance/39/session.test.ts` stays as it is. Swapping it for the redraft needs the maintainer's approval, as #39's README says of its other redrafts.

## AC3: `21/plant-ignored` fails its criterion case under a timed grant

The run was inside the timed window: `throttle.mjs timed`, opened at load 12 with no other grant on the machine, at `1c4d1f0e2`. The case `AC2 #21.9a5768d4 (wrong program) a hub that appends a replayed event twice (DEEP_HUB_PLANT=replay-appends-twice) fails the same check, naming the call` of `tests/acceptance/21/replay.test.ts` ran once on the clean program and once with `tests/acceptance/21/twins/plant-ignored` laid over it. The twin differs from that commit's `packages/hub/src/spool.ts` by one line, which ignores the plant.

| Program | Result |
|---|---|
| Clean | pass (34 s, load 12) |
| `plant-ignored` | **fail at the assertion**: `AssertionError: the check names an event in the record twice: expected '' to match /in the record 2 times/`, thrown in `tests/acceptance/21/replay.test.ts` (33 s, load 10) |

## AC4: the three loader-review digests

Confirmed by a review that #2236's author didn't make: [issue-2345-loader-review.md](issue-2345-loader-review.md).

- Each re-recorded value of `core.ts`, `plant.ts` and `server.ts` equals the checker's own identity of that file at `1c4d1f0e2`.
- No changed member touches the loader trust chain.
- The review's completeness check passes there, 2 of 2.

## The guard's findings on #2236 (scope; not a criterion)

`node scripts/proof.mjs guard` ran at #2236's head `be4ba76dc`, with main at its merge (`9de614e76`), so its merge base is `651bf06d3`. It gives four findings, all in `acc5121c5`, which swapped part of `tests/acceptance/1687/full/structure.test.mjs` for the blind redraft's oracle:

- `structure.test.mjs › AC2 #1687.f156a5ac Core is local composition; every method body, including constructor, is <=100 source lines`: changed
- `structure.test.mjs:89`, a test named as it runs: changed
- `structure.test.mjs › AC3 #1687.2e07fefc recursive module graph introduces no cycle edge beyond the base`: changed
- `structure.test.mjs › AC3 #1687.2e07fefc Core and its reachable implementation modules do not import concrete extensions`: changed

It finds nothing in `e4f24691b` or `39bee16ae`.

Main now holds `.deepbuild/approvers`, with one key: a hardware security key (`sk-ecdsa`) under JingW6. The guard counts a `deep/approved/` tag only when its signature carries a touch and it names every file its commit touches. `acc5121c5` touches 11 files, so its approval names all 11. The maintainer signs it with that key:

```sh
cat > /tmp/approve-acc5121c5.txt <<'EOF'
Approve #2236's swap of tests/acceptance/1687/full/structure.test.mjs for the blind redraft's oracle (#2345).

Approves: packages/hub/test/floor.test.ts
Approves: packages/hub/test/reserve-wait.test.ts
Approves: tests/acceptance/1687/ac3-redraft/REVIEWED-LOADERS.md
Approves: tests/acceptance/1687/ac3-redraft/ac3.test.mjs
Approves: tests/acceptance/1687/ac3-redraft/graph.mjs
Approves: tests/acceptance/1687/ac3-redraft/loader-boundary.test.ts
Approves: tests/acceptance/1687/ac3-redraft/reviewed-loaders.json
Approves: tests/acceptance/1687/ac3-redraft/reviewed-loaders.mjs
Approves: tests/acceptance/1687/full/structure.test.mjs
Approves: tests/acceptance/822/README.md
Approves: tests/acceptance/822/hub.test.ts
EOF
git -c gpg.format=ssh -c user.signingkey=<the listed security key> tag -s deep/approved/acc5121c5ee8 acc5121c5ee839e1eff8c51fb13eacc0a30c5894 -F /tmp/approve-acc5121c5.txt
git push origin deep/approved/acc5121c5ee8
```

The tag is a signed record, not a pass. `readApprovals` reads the approver list at a change's merge base. #2236's merge base `651bf06d3` predates the list (`4950c76d5`, Nov 13), so the guard over #2236's own range still reads FAIL with the tag in place. #2236 is merged, and no later change's guard reads its commits again.

## Not done here

- **The last pairs.** The pairs of 98 files and the 7 files of the exclusive folders (`236/`, `315/`) were still running when this PR was opened.
- **The redraft swap.** Retiring #39's first AC5 case for its redraft needs the maintainer's signed approval.
- **The redraft on main.** `tests/acceptance/39/redraft-ac5` ran on `1c4d1f0e2`, where the twin lies; it was not run on main. The twins in `tests/acceptance/39/twins/` are whole copies of `mcp-operations.ts` from #2236's head, and main has changed that file since.
