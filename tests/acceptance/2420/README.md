# Acceptance tests for #2420: a run's recorded refusals have a ceiling, and a target is recorded at a bounded length

Written first, blind, on November 23, 2026, from issue #2420 (its text as of that day: Scope, the 5 checkbox criteria,
Proof and Runs on), issues #2399 and #1106 for what they say, `docs/technical-design.md` (Threats, and what stops each
one), `docs/canvas-primitives.md` (the event catalogue, the `sandbox.denied` row), `AGENTS.md`, the acceptance suites
of #2399 and #1106 for their conventions and the sample stack, and `packages/supervisor`, `packages/hub`,
`packages/env-local` and `packages/cli` as they are at the base commit `0a875355b2c19e7705b1b248c9a20b85e24cbbcd`
(main), read for their public surfaces, by a job that never saw an implementation of #2420. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

On macOS or Linux, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js
cargo build -p deep-hook --locked                 # once: the hub doesn't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2420 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2420/tsconfig.json
```

- `--no-file-parallelism`: the files start real hubs and stacks on ports leased from 3000 up.
- On Linux the Node that runs Vitest must be one a bubblewrap sandbox can read (not under a home folder), as #2399's
  README says. Nothing in this suite is platform-specific beyond that; no test skips.
- Nothing leaves the loopback. The stack, the sample APIs, the hub on a temp folder, the temp HOME and the fake
  credentials are #1106's (`../1106/helpers.ts`, imported as it is); the filter port, plain requests, the second
  worktree and `deep env up`/`down` are #2399's (`../2399/helpers.ts`, imported as it is). Every request this suite
  sends goes to a filter's port on 127.0.0.1, and every host it names ends in `.invalid`.
- With `--root` here, Vitest may write a cache under `tests/acceptance/2420/node_modules/.vite/`; delete it before
  committing.
- Planted wrong programs are not selected by this suite: the implementer supplies them as twins
  (`tests/acceptance/2420/twins.json`, laid over the change by the proof lane), and each criterion test is written to
  fail at an assertion on the wrong program its criterion names, with the message naming what the criterion says.

## The surface under test

Each choice is listed so a dispute can name it.

- **#1106's sample stack, the run, the filter port**: as #2399's suite has them. #1106's `upWorld()` brings the app up
  by `deep env up --root <hub> --json` in a worktree; its `run` is the run. The filter port is the one in the app's
  own `HTTPS_PROXY` (#2399's `filterOf`).
- **A plain HTTP request under a Host** (criteria 1, 2, 4, 5): #2399's `plain`, `GET http://<name>/ HTTP/1.1` with
  `Host: <name>`, one connection each, sent from this process (outside the run), 16 at a time. The names are
  `dh2420-<tag>-<i>.invalid`, every one different within a test; "under other names" (criterion 2) are another tag.
- **The 9,000-character Host** (criterion 3): one request `GET / HTTP/1.1` whose `Host` header is 9,000 ASCII
  characters (labels `l0000.l0001...`, ending `.invalid`), so its length in characters and in bytes is 9,000. The
  request line names no absolute URL, so the request line stays short and the filter reads the target from the Host
  (the filter's own fallback at the base); a 9,000-character absolute URL as well would put the head near Node's
  16 KiB header limit.
- **`sandbox.denied` events for the run** are every event of that kind (the hub's `events.read`, cli role) whose
  `data.run` is the run. **Naming a target** is every such event whose operation isn't `more`, of any operation
  (the ceiling covers all three paths, Scope). **The closing event** is one whose `data.operation` is `more`; its
  target is `data.target` read as a string and compared exactly (`'744'`, `'1744'`, `'44'`).
- **After the run ends**: `deep env down --root <hub> --json` in the run's worktree (exit 0), as #2399's suite ends a
  run. The test then waits for the record's `run.cleaned` naming the run (the supervisor's end of a run), then for a
  closing event for at most 60 s (20 s in criterion 4, where none must come), and reads the record.
- **"256 ... and one more"** is read on the whole record for the run after its end: exactly 256 naming a target and
  exactly one closing event with that target. Before ending the run, the test waits (60 s at most) until 256 are
  recorded, since past the ceiling no new refusal can serve as a marker that the record has caught up.
- **"Adds no event while the run lives"** (criterion 2): no event of the run names one of the second thousand's
  names, and the run's events naming a target are 256 after its end. The closing event is appended when the run
  ends, after all its refusals were counted, so an event the second thousand added would be in the record by then.
- **"Recorded with a target of its first 512 bytes followed by `9000`"** (criterion 3): after the long request, one
  plain request under `dh2420-after-long.invalid` is sent and the test waits for its refusal (#2399's ordering
  reading). Then exactly one event of the run has a target starting with the Host's first 512 bytes; what follows
  those bytes holds no more of the Host, is at most 32 bytes, and holds `9000` as a whole number. A separator
  between the bytes and the length (or none) is the implementer's.
- **"3 different targets"** (criterion 4): three names, each refused once; the test waits for each in the record.
- **Two runs side by side** (criterion 5): two worktrees of one repo (#2399's `secondWorktree`), each brought up by
  `deep env up` on one hub, both up at once, each with a filter port of its own. The first run is sent its 300
  first; once it holds 256 (or 60 s), the second its 300 under other names. So a supervisor that keeps one count for
  both records 256 for the first and none for the second, and the test fails naming the second run. Both runs are
  then ended, first then second.

### What the failures name

| Criterion's wrong program | The failing assertion's message names |
|---|---|
| none (criterion 1, base) | `run <run> recorded 1000 sandbox.denied naming a target, expected 256` |
| a new 256 once the first is full (criterion 2) | `run <run> recorded 512 sandbox.denied naming a target, expected 256 (...the second thousand added 256...)`: the count |
| always writes the closing event (criterion 4) | `run <run>, refused 3 different targets, got a closing sandbox.denied: [{"operation":"more","target":"0"}]`: the run |
| one count for both runs (criterion 5) | `the second run <run> recorded 0 sandbox.denied naming a target, expected 256`: the second run |

## Criteria to tests

Each test's name starts with its criterion's ID, `#2420.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace
collapsed, `- [ ] ` dropped).

| ID | Criterion (short) | Test | At this base |
|---|---|---|---|
| `#2420.d74ef6aa` | 1,000 Hosts: each 403, 256 recorded, closing `744` | `ceiling.test.ts` | fails at the 256 count (BASE-FAILURE.txt) |
| `#2420.a7473ad6` | a second thousand adds none, closing `1744` | `ceiling.test.ts` | fails at the 256 count |
| `#2420.9574047b` | a 9,000-character Host: 403, first 512 bytes then `9000` | `long-target.test.ts` | fails: no event starts with the first 512 bytes |
| `#2420.17cfe76e` | 3 targets: 3 events, no closing one | `runs.test.ts` | passes (its condition holds at the base; its twin proves it) |
| `#2420.fdfdf3b3` | two runs, 300 each: 256 and `44` each | `runs.test.ts` | fails at the first run's 256 count |

### Not tested

- The macOS log reader's and the Linux sandbox parent's share of the ceiling and the cut (Scope): no criterion
  drives them, and a run can't be made to hit 256 sandbox refusals through a surface the issue names.
- A cut inside a multi-byte character: the criterion's Host is ASCII.
- The set kept in memory stopping its growth: the supervisor's memory, which no named surface shows.

## Files

- `helpers.ts`: many plain requests, the long-Host request, a run's record split into events naming a target and
  closing ones, waits on the record, and the end of a run. The rest is imported from `../1106/helpers.ts` and
  `../2399/helpers.ts`, unchanged.
- `ceiling.test.ts` (criteria 1, 2), `long-target.test.ts` (3), `runs.test.ts` (4, 5).
- `tsconfig.json`: as #2399's; it type-checks clean at the base.
- `BASE-FAILURE.txt`: the run on the base commit, home paths written `~`.
