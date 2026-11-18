# #2330 — independent blind redraft

Origin: **1c4d1f0e2aaad8c6a6573848823566d04ff73d17**. Inputs: issue #2330,
its design, and that base's interfaces. No previous draft or implementation is an input.
These files are sealed for the implementer; no product file or existing check changes.

## Commands

From the checkout root, with the lockfile's TypeScript installed and Node >=24.22:

```sh
for f in tests/acceptance/2330-redraft/*.mjs; do node --check "$f" || exit; done
node tests/acceptance/2330-redraft/run.mjs --check
```

`--check` makes and removes a small disposable transpilation, executes the real
CLI's `hub --help`, and loads `@deepbuild/hub/hub`. It starts no hub and makes no
timing verdict. These checks were run successfully during drafting.

**Not run during drafting.** Only an authorized operator in a quiet scheduled
reference-Mac window may collect the following readings (not an instruction to
an agent to open, edit or run the window):

```sh
node tests/acceptance/2330-redraft/run.mjs --measure
```

This executes, sequentially, the actual transpiled CLI as
`node <temporary>/packages/cli/dist/main.js hub start --root <private-dev-root>`
and `... hub stop --root <private-dev-root>`. The entry, argument dispatcher,
service implementation, wire encoder and runtime import closure are unchanged.
Only the `hub run` peer is replaced by the scheduled stand-in, through a
**test-owned** Node preload. It observes real spawn, propagates its timestamp,
and records process exit; it does not replace lifecycle commands, sockets or
clocks. No production hook/export, dependency, Rust or full workspace build.
A server placeholder throws if the preload fails, rather than starting a real hub.

## Mapping and wrong-program proof

| Criterion | Executable scenario / assertions |
|---|---|
| AC1 `#2330.c6939f4f`: answers at **30 ms**, start returns within **60 ms** | `start`: starts the peer through the real CLI spawn. The peer schedules listening at spawn+30 ms. Its independent client reads a complete hello; this is not the polling CLI's first observation. Check actual process completion, exit 0, empty stdout/stderr and the 60 ms bound. |
| AC2 `#2330.c4ac049d`: stop within **30 ms** of exit, **never** while answering | `stop`: acknowledge `hub.stop`, continue answering for 30 ms, then exit. Check both processes' completion, silent exit 0, exit-to-command interval and an independent post-command socket probe. `early-close`: close the control connection after acknowledgement but keep the listener answering another 200 ms. `stubborn`: acknowledge and close the control connection but answer indefinitely, past the CLI's **15 s** limit; a successful exit is forbidden. No invented error message/code is required on this unspecified failure path. |
| AC3 `#2330.61815fcc`: never answers, fails at **15 s**, today's message, exit **3** | `never`: launched peer stays alive without binding. Check no early timeout, actual command completion, exact stdout/stderr and exit 3. Literal diagnostic: `deep hub start: no hub answered at unix:<root>/hub.sock within 15 s; see <root>/logs/hub.log\n`. |

The original base is the wrong program, not an invented lifecycle twin. Its
100 ms start polling should miss the independently witnessed 30 ms answer; its
100 ms stop polling should lag the scheduled exit by about 70 ms. The same
sealed command must collect base and candidate readings, with **both commands**
failing their named latency assertion on the base. The stubborn case also
rejects the base's successful stop at its deadline while the socket answers.
AC3 is preservation coverage, expected to hold on the base. No wrong-program
failure has been claimed or fabricated: timing and base failures are **UNRUN**.

## Measurement qualifications (not changed budgets)

- Real monotonic milliseconds, across processes on one host; no accelerated or
  controlled clock substitutes for the literal 15 seconds. All limits above
  retain the issue's values. The 15 s loop has the base's final 100 ms polling
  granularity: a 15,000–15,100 ms observation band, not a new 16 s timeout.
- The call to listen is a conservative lower bound on the first possible
  answer; the independent complete hello is its upper bound. CLI close is an upper bound on command completion;
  its exit-handler timestamp is a lower bound. Stop similarly brackets actual
  hub exit between its exit handler and the parent's close observation. A pass
  needs the **upper** lag inside the limit; a fail needs the **lower** lag over
  the design margin. Overlapping/ambiguous intervals are INCONCLUSIVE. Negative,
  missing, partial or non-finite measurements cannot pass.
- Spawn-to-independent-answer must be **30–35 ms**. The extra 5 ms qualifies
  the scheduled fixture, never increases the 60 ms budget. A slow Node launch
  or scheduling miss is INCONCLUSIVE, not a poller pass or a retry. The fixture
  has no lifetime timeout: shutdown is relative to the real stop request; a
  never-answering/stubborn peer lives until test cleanup. The harness's 60 s
  hang bound is BLOCKED, never an acceptance limit.
- One warm-up then five fixed readings per timed scenario; no retries until
  green. The design's existing `fingerprint`/`judgeLimit` supplies reference-Mac,
  mains, Low Power Mode, thermal and five-reading margin qualification. Load
  must be strictly below core count before/after every sample. The runner
  refuses to launch measurements on an unqualified machine. Caches are warm
  after the declared warm-up; each sample still uses fresh processes and roots.
- These are executable acceptance **readings**, not a scheduled budget task.
  Per `docs/parallel-proof.md` §12a, the runner always exits 3 after measurement
  with overall INCONCLUSIVE, even if individual readings meet their bounds.
  No task in `benchmarks/budgets.json` was added or changed: registering these
  criterion IDs, collecting **20 samples per side** for the exact merged commit
  and its base, and the scheduled-window evidence remain genuine prerequisites
  to claiming the literal budgets/closing the issue. An ordinary timed grant,
  a standalone run, an unmeasured criterion or `--check` is never that proof.

## Isolation and event integrity

All child environments are allowlisted; HOME/XDG config, sockets, tokens and
logs live under a short random `/tmp` directory. No user service, setup, hook,
real home or network endpoint is used. Authentication tokens are generated at
runtime and never printed. Cleanup signals only owned child/spawn PIDs, never
a name/port/group; peers also exit if their owning test process disappears.
Per-process event files are reread without consuming partial final lines;
exactly one required event is mandatory. Socket readers buffer complete newline
frames. Command output is collected through stdio close, not just a first chunk
or an early output marker. Temporary output is removed, including on failure.

Files: `build.mjs` (small runtime closure), `observe.mjs` (test preload),
`hub.mjs` (scheduled real socket peer), `run.mjs` (assertions/qualification).
The suite is intentionally not `*.test.mjs`: ordinary discovery/affected must
not accidentally launch a timing suite on a loaded machine. Existing checks
and scheduled tooling are untouched. Requirement → assertion → proof mapping
is above; actual acceptance, wrong-program runs and scheduled proof are unrun.
