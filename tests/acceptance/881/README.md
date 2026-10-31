# Acceptance tests for #881: project trust held in memory

Written first, blind, by a job that never saw an implementation of #881. It read:

- issue #881 as given to this job on October 31, 2026: its title, problem statement, Scope, three checkbox criteria,
  Proof and dependencies (#348, #350)
- `docs/technical-design.md`: Hook protocol, Extension API (with "Several handlers, one reply"), Dogfooding, Criteria
  in a checked shape, the budget rule ("Every task carries its own budgets"), the done-gate and spec-draft rows on
  trust, and Threats (Untrusted repos)
- `AGENTS.md`
- the acceptance tests of #348, #350 and #822, and the timing judges of #857 and #348, for their conventions
- the base commit `0f7fb686`: `packages/extension-host` (its entry, `trust.ts`, the host's hook path), `packages/record`
  (append, read, raw, sync), `packages/hub/src/core.ts` (where the hub opens one trust reader and hands it to the host)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/881 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/881/tsconfig.json
```

- **Time and disk:** `latency.test.ts` appends 1,000,000 events of about 1 KB first: about 60 to 90 s here and about
  1.5 GB under `/tmp`, removed after the file. The whole suite takes about 2 to 3 minutes on the base.
- **`--no-file-parallelism`:** the files start sandboxed processes through the supervisor and time hook replies, so
  nothing else of the suite should run beside them. `scripts/lanes.mjs` lists `tests/acceptance/881/` in `alone`, the
  unit lane's files run one at a time, as it lists #348's and #857's. That one-line edit is the only change outside
  this folder.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment and
  points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`.
- **Temp folders:** everything is under `/tmp/dh881-*`, real paths, removed after its file. Every host a test opens is
  closed after its file, which stops what it started; nothing is stopped by name or port. No network.
- Vitest may write a cache to `tests/acceptance/881/node_modules/.vite/`; delete it before committing.

## The surface under test

The issue names no new interface, so the tests use only what the base's public entries already have, and nothing an
implementation must agree on beyond them:

- `@deepbuild/extension-host` (`packages/extension-host/src/index.ts`): `openTrust({ record, now })` and its
  `ProjectTrust` (`trusted(project)`, `answer(connection, project, trusted)`); `openExtensionHost(options)` with
  `options.trust`; and the host's `install`, `check`, `load`, `loaded`, `hook(HookRequest)` (#348, #350);
  `packageDigest` for the test package.
- `@deepbuild/record`: `openRecord`, `append`, `read`, `raw`, `sync`, `ulid`.
- `@deepbuild/asks`, `@deepbuild/supervisor`, `@deepbuild/evidence` to build the world as #348's and #350's suites do,
  and `@deepbuild/contracts`' `tool.before@2` fixture as the hook's data.

The test package is `fixtures/denier`: a TypeScript package from a folder, built by no agent (so it runs in the
sandbox), that denies every `tool.before` with its own `why` template. With probe.json's `note`, each call its handler
takes first appends a `task.created` titled `<its id> asked <n>` and waits for it.

## Readings

- **"Reaches the agent" (AC1).** The joined reply's `denies` holds the extension's deny, the reply's `failed` names
  nothing of it, and the reply came back within the hook's 500 ms deadline, timed from the request to the reply. A
  reply after the deadline is read as not reaching the agent, since the hook has stopped waiting by then. In the
  saved base run every reply came 567 to 907 ms after the request; the host waits a 250 ms grace past the deadline
  before it drops a reply, so the deny was dropped, with "acme/denier missed the hook's deadline of 500 ms", only at
  the two calls past about 750 ms (BASE-FAILURE.txt).
- **"1,000,000 events appended after a project's trust decision" (AC1).** Your trust answer first, then one agent
  session's shell calls, `tool.before` and `tool.after` in turn, each with a command of about 1 KB, through
  `record.append`, 5,000 issued at a time and committed by the record in batches on its stream path, then synced. The
  test counts the events after the decision's `log_pos` (at least 1,000,000). The hosts open and the extension loads
  after the events are in, as after a hub restart on a big record; the issue's "read once when the project's first
  extension loads" then reads once over the big record, which no criterion times.
- **AC1's measurement: what the trust check adds at p95.** Two hosts on the same world (record, supervisor, trust
  reader), each with the same denying package: on host P it comes with the trusted repo (a project's extension, so
  its trust is checked on each call), on host C it comes with no project (no trust to check). Calls go to P and C in
  turn, the order alternating, so both see the same machine. A run is 100 calls a side; its reading is P's p95 reply
  time minus C's, floored at 0 (the check can't take time away). Five runs after a warm-up of five calls a side are
  judged by the design's timing rule against the issue's 1 ms (PASS when all five are within it, FAIL when all five
  are over it by more than the margin, the larger of 5% and the five readings' spread as a fraction of the limit, as
  `scripts/benchmark.mjs`'s `judgeLimit` takes it; otherwise INCONCLUSIVE). Every timed reply must carry its
  package's deny, or the comparison is void.
  - To keep the base's run short, a run stops calling P once 6 of P's calls are past the deadline: P's p95 (the 95th
    of 100) is then at least the 6th-largest of those, whatever the rest would take, so that bound is the run's
    reading. It can only understate the cost. C's calls all run.
  - With 1,000 events instead of 1,000,000, the base's own host reads 0.14 to 0.21 ms added on this loaded Mac
    (one record query over a small log), so the method resolves well under 1 ms.
- **Load and the reference Mac.** A timing judged off a reference Mac (Mac15,7 M3 Pro 36 GiB or Mac15,12 M3 16 GiB)
  is a reading, so INCONCLUSIVE. Power, Low Power Mode and load are printed beside the readings, never gated (the
  owner's rule, as #857 and #379 apply it). INCONCLUSIVE fails the test with that word, never a skip (Nothing missing
  passes). In AC1's deadline test, a P call that misses while the C call made right after it on the same record also
  misses is counted as load, and the test fails `INCONCLUSIVE` for those alone.
- **"Revoking the project's trust in the app" (AC2).** Your one answer on the trusted path, `answer` with the app's
  connection (writer `app`), as #348's suite reads it, given to the reader the host holds: the hub's core opens one
  reader and hands it to the host. Then exactly one tool call goes to the same host object, never reopened or
  restarted.
- **"Unloads the extension before that call" (AC2).** The handler takes no call after the revoke (its notes in the
  record don't move), its deny isn't in that call's reply, and right after that reply the host doesn't list it in
  `loaded()`.
- **"Refuses it naming the project" (AC2).** That call's reply names the project, by its folder's path or folder
  name, in the reply's failure for the extension or in a deny's reason. Which of the two carries it is left to the
  host.
- **"Share one trust answer" (AC3).** A repo's folder and a symlink to it from another folder. You trust through the
  link; the reader then answers trusted for both, an extension that comes with each folder loads, and both deny the
  next call. Revoking through the real folder makes the reader answer untrusted for both, and neither denies the
  next call.
- **Scope items with no criterion.** "No record query or file-system call on the hook path" is tested only through
  its effect, AC1's latency; nothing counts queries or file-system calls. `tool.after` and stop hooks have no hook
  request on the host's surface yet (`HookRequest.kind` is `tool.before`), so only `tool.before` is timed. The done
  gate's and spec drafting's readers have no criterion here; #348's AC3 already holds readers on one record to one
  decision.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#881.<first 8 hex of the SHA-256 of its text>`, computed on the live issue's text after `- [ ] ` (which has no `ACn: `), trimmed and
whitespace collapsed, as `scripts/proof-change.mjs` does. A test that passes on the merge base proves its criterion
by failing at its assertion on a planted twin that `twins.json` names for the criterion's tag: the proof lane's
before lane lays the twin's files over the code under test and runs the test there (`scripts/proof-runs.mjs`).

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#881.3c298943` | 1,000,000 events after the decision: the deny still reaches the agent; the trust check adds < 1 ms at p95; main misses, drops, fails naming the extension | `latency.test.ts` AC1 (2): the deny within the 500 ms deadline at each of 10 calls; the p95 the trust check adds, five runs | both fail, naming `acme/denier` |
| AC2 `#881.622513f5` | revoke in the app, one call: unloaded before it, refused naming the project, no restart; a cache keeping the old answer fails | `revoke.test.ts` AC2 (1): revoke then one call; twin `keeps-old-answer` | fails only on naming the project; on the twin it also fails on the deny still reaching the agent |
| AC3 `#881.23ca93e8` | a folder and a symlink to it share one answer | `symlink.test.ts` AC3 (1): trust through the link, revoke through the folder; twin `trust-by-given-path` | passes (the base keys trust by the real path); fails on the twin at its assertion |

## Wrong programs

| Twin | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| the host on main: the base commit `0f7fb686` | AC1 | each `tool.before` asks the reader, which runs `realpathSync` and a query for the latest `decision.created`, walking the record on the event loop | every reply comes past the 500 ms deadline, the deny dropped at the slowest, and the p95 the trust check adds is about 540 to 580 ms; both failures name `acme/denier` (BASE-FAILURE.txt) |
| `twins/keeps-old-answer` (`twins.json`, `#881.622513f5`) | AC2 | the public entry with `openTrust` wrapped: each reader keeps the first answer it reads per project until a new reader is opened (the hub restarts); your answers still reach the record | the extension takes the first call after the revoke, stays loaded, and its deny reaches the agent |
| `twins/trust-by-given-path` (`twins.json`, `#881.23ca93e8`) | AC3 (none named; regression protection) | the public entry with `openTrust` wrapped: each reader keeps its own list keyed by the folder as given | trusting the link leaves the real folder untrusted, so neither extension loads |

Each twin replaces only `packages/extension-host/src/index.ts`, the public entry: it re-exports every module the
entry has at the base (`digest`, `host`, `sources`, `kit`, `trust`, and the runtime's API) with `export *` and
shadows `openTrust` alone, so it lays over a fix that changes those modules' insides. The tests' readers come from
that entry, and the host is handed the reader, so the twins catch a host that reads trust through the reader it is
given, as the base does. A fix that drops one of those modules, or a host that bypasses the reader it is given, makes
a twin unrunnable or uncaught; then this job redrafts the twin (Open questions, 1). Both were checked on the base by
laying each over the entry by hand: AC2 fails on `keeps-old-answer` with the deny still reaching the agent, and AC3
on `trust-by-given-path` with the real folder left untrusted.

## Open questions

1. **Where the in-memory answer lives.** The issue says the host holds it and every reader reads "the one in-memory
   answer". These tests don't care where, so long as the host reads trust through the `ProjectTrust` it is given and a
   revoke through that reader reaches it. If the fix changes that interface (a new method, or a host that no longer
   takes `trust`), the tests and twins need a redraft of this job, not an edit.
2. **Revoking through another reader.** The tests revoke through the reader the host holds. Whether a revoke made
   through a second reader opened on the same record (another piece's) must reach the host on its next call is in the
   Scope's "the one in-memory answer", but no criterion states it, so nothing here tests it.
3. **How the refusal names the project.** The issue doesn't say whether the project is named by its path, its real
   path or its folder name, nor whether the refusal is the reply's failure for the extension or a deny of the call.
   The test takes any of them (Readings).
4. **Event size.** The issue gives the count, not the size. At about 1 KB an event this Mac's base walks the record in
   about 0.55 to 0.9 s per call. With much smaller events a fast Mac's base might reply within 500 ms; it would still
   fail the 1 ms test by hundreds of ms.
5. **"Drops the deny".** On this Mac most of the base's replies came within the host's 250 ms grace past the
   deadline, so the deny was still in them; it was dropped at 2 of 10 calls, those past about 750 ms. The test reads a
   reply past the deadline as not reaching the agent, which the base fails at every call. If the owner reads "drops
   the deny" strictly, the deadline test would need every base call past 750 ms, which depends on the machine.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world (record, asks, supervisor, trust), hosts, the
  package copier, hook requests and their timing, the 1,000,000-event append, and the timing judge with the
  reference-Mac check.
- `judges.ts`: each criterion's assertions as problems that name the extension or the project.
- `twins.json` and `twins/`: the planted wrong programs for AC2 and AC3, each a replacement of the extension host's
  public entry.
- `latency.test.ts` (AC1), `revoke.test.ts` (AC2), `symlink.test.ts` (AC3).
- `fixtures/denier/`: the test package; its `index.ts.fixture` is renamed when copied, so this suite's Vitest and
  type check skip it.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, `twins/` excluded.
- `BASE-FAILURE.txt`: the run on the base commit.
