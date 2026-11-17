# Acceptance tests for #2731: the environment@1 kit and a process table over 1 MiB

Written first, blind, by a job that never saw a fix. On November 17, 2026 it read:

- issue #2731 (its text as of that day: What is wrong, Evidence, Effect, Fixes to choose from, AC1 and AC2)
- `AGENTS.md` (Proof) and `docs/technical-design.md` ("Who drafts it", Dogfooding)
- the base commit `3c124dee5`: `packages/conformance/src/slots/environment.ts`, reached only through the package's
  entry (`slotKits`, `cleanFills`, `runKit`), `packages/conformance/src/slot-runner.ts`, `scripts/conformance-lint.mjs`
  and `scripts/conformance-lint-slot.mjs`
- for conventions only: `tests/acceptance/2634/` and `tests/acceptance/349/README.md`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## Criteria and tests

All four tests are in `ps-table.test.ts`.

| Criterion, in full | Tests |
| --- | --- |
| "AC1: with a process table over 1 MiB, the environment kit's clean fill reads PASS on health-route and status-route, and `node scripts/conformance-lint.mjs` prints no `ps failed: … ENOBUFS` line." | **`#2731 AC1 … the environment kit's clean fill reads PASS on health-route and status-route`**: runs the environment@1 kit's fixed part on its clean fill (`runKit(kit, cleanFills(kit)[0], { parts: ['fixed'] })`) and asserts the cases `health-route` and `status-route` each read `PASS`. **`#2731 AC1 … prints no ps failed: … ENOBUFS line`**: runs `node scripts/conformance-lint.mjs` and asserts no line of its stdout or stderr matches `ps failed: .*ENOBUFS`; also that the lint ended on its own with a status other than 3 (not built) and printed a `slot kit environment@1` line, so a lint that never reached the kit doesn't pass. The lint's exit status is otherwise not asserted: the issue doesn't state it, and other checks of the lint can fail on a machine. |
| "AC2: a `ps` that really fails still reads BLOCKED naming the failure, never PASS." | **`#2731 AC2 … the environment kit's clean fill reads BLOCKED on health-route and status-route, naming the failure`**: with a `ps` first on `PATH` that fails every time (prints `dh2731-ps-broke: …` on stderr, exits 7), the same kit run reads `BLOCKED` on both cases, and each message names `ps` and the failure (what ps said, or its status 7). **`#2731 AC2 … never reads the environment@1 kit PASS, and its lines name the failure`**: the lint under the same `PATH` doesn't exit 0, prints no `PASS slot kit environment@1` line, and each `clean fill health-route` / `clean fill status-route` line says `BLOCKED` and names `ps` and the failure. |

### The precondition of AC1: the table is really over 1 MiB

The machine's own table was about 0.65 MiB when these were written, so the AC1 tests make it large themselves, the way
#2634's test does: 16 idle `node` processes with about 120 KiB of arguments each (Linux caps one argument at
128 KiB), about 1.9 MiB in all, started before the two tests and stopped after them, each by its PID. Before and
after the kit run, and before and after the lint run, each test asserts that every filler still runs and that
`ps -Awwo pid=,ppid=,stat=,command=` (the issue's own measure) prints over 1.25 MiB. If it doesn't, the test fails;
it never passes on a small table.

### AC2 at the base, and the wrong program it catches

AC2 is a guard: the base already reads a failing `ps` as BLOCKED naming it, so both AC2 tests pass at the base
(`BASE-FAILURE.txt`). They fail on a wrong program:

- one that reads `PASS` when `ps` fails (a fix that treats an unreadable table as empty, or swallows the error):
  `expect(outcome).toBe('BLOCKED')` fails, and the lint test fails on the `PASS slot kit environment@1` line or exit 0
- one that reads `FAIL` (blames the fill): the same assertion fails
- one that reads BLOCKED without naming the failure (a bare "the process table can't be read"): the message
  matches neither `dh2731-ps-broke` nor a status of 7

The test first checks that the `ps` found by name is the failing one (`execFileSync('ps', ['-A'])` throws), so it
can't pass because the fake was never reached. The base's own reading of a working `ps` on a small table is PASS (the
lint printed `PASS slot kit environment@1` on this machine before the fillers), which is what that wrong program
would print here.

## How to run

```sh
npm run build -w packages/conformance     # the lint reads packages/conformance/dist; the lint tests fail if it is older than src/slots/environment.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/2731
node node_modules/typescript/bin/tsc -p tests/acceptance/2731/tsconfig.json
```

On the Linux dev machine both the build and the run were inside
`systemd-run --user --quiet --wait --pipe --collect -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G`.
The run takes about 40 s (two lint runs). The kit tests import the package's source entry; the lint tests run the
built package, as the lint does.

`BASE-FAILURE.txt` is the run at the base: both AC1 tests fail with
`ps failed: ps -Awwo: ENOBUFS` read as BLOCKED (the lint prints the issue's six lines), both AC2 tests pass.

Temp files: one folder `/tmp/dh2731-bin-*` holding the failing `ps`, removed after the AC2 tests. No network. Nothing
is stopped by name or port.

## Left open

No test is written for these; the issue doesn't settle them:

- **Which fix** (a larger `maxBuffer`, reading only the kit's own processes, or streaming `ps`), and so any bound on
  the table size the kit must read. The tests use a table of about 2.5 MiB, the size of the issue's evidence.
- **"Don't retry a tool whose error is ENOBUFS"** and **"Keep ENOBUFS read as BLOCKED if it still happens"**: both
  are in "Fixes to choose from", not in a criterion, and whether ENOBUFS can still happen depends on the fix.
- **The lint's exit status and its other lines** on a large table (the planted proofs, the `lsof failed` shape of a
  machine reading, other kits): AC1 names only the absence of a `ps failed: … ENOBUFS` line.
- **The wording** of the BLOCKED finding beyond that it names the failure, and its codes.
- **Other ways `ps` can fail** (missing from `PATH`, a hang, a signal): AC2 names none; the tests use a `ps` that
  starts, says why on stderr and exits non-zero. They assume the kit still reads the table through a `ps` found on
  `PATH`, as every fix the issue lists does.
- **`packages/conformance/src/slots/environment.test.ts`, `tests/acceptance/2538` and `tests/acceptance/2146`**, which
  the issue lists as affected: evidence and effect, not criteria.
