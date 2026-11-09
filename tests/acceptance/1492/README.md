# Acceptance tests for #1492: a panel that re-renders the same thing draws nothing

Written blind, from the issue, `docs/technical-design.md`, `docs/canvas-primitives.md` (Panel runtime and panel host),
`AGENTS.md` and the base commit `c88d9ae1` (the panel host's `serve` in `crates/deep-panel-host`, the `idle` task in
`benchmarks/canvas.mjs`, the suites 358, 854 and 1425 for style); no implementation of #1492 existed. The implementing
agent doesn't edit these files; a dispute goes to a blind redraft of this job.

| AC | ID | Test |
|---|---|---|
| 1 | `#1492.2e66f748` | `panel-host.test.ts`: 60 s, a shipped host and the planted one, side by side |
| 2 | `#1492.40149fbb` | `panel-host.test.ts`: a tree that changes on the third tick |
| 3 | `#1492.3139ba2b` | `idle-energy.test.ts`: the judge on made-up readings (3 tests), and the idle task on a Mac (live, about 6 minutes) |

Energy is a reading only. Nothing here gates on it: the same report at 1e6, 9e9 and 0 nJ must get an identical verdict `status`, `targets` and `reason`, only `energy` differing. The tests never assert an overall PASS, since the base's judge answers INCONCLUSIVE for any made-up report (its load check, from #1555, needs readings a report can't carry).

## The surface under test

The issue names no line or field. These are this job's choices, the smallest the criteria allow; an implementation
provides them as written. They add to what `serve` and the idle task print at the base; nothing existing changes.

### The panel host, `deep-panel-host serve --panel DIR [--planted NAME]`

A frame request is one stdout line:

```json
{"frame": {"panel": "<manifest id>", "hash": "<hex>", "tree": "<the tree, as an invalidate reply carries it>"}}
```

- The host hashes the tree after every render, whatever caused it (a command or a panel's own timer), and writes a
  frame line only when the hash differs from the last render's. A timer render that changes nothing writes nothing.
- A reply to `{"cmd":"invalidate"}` (the app's own draw, which the app asked for) keeps its shape, `{tree, scriptNs}`,
  and gains `hash`. It is not a frame line and not counted in `frames`. It sets the hash the next render is compared with.
- `{"cmd":"stats"}` replies `{"panel": id, "renders": n, "frames": n, "hash": "<hex>"}`: every script render since
  the host opened (invalidate's included), the frame lines written, and the hash of the last tree.
- `{"cmd":"verdict","max_frames":N}` replies `{"status": "PASS" | "FAIL", "panel": id, "frames": n, "reason": text}`,
  `frames` counting frame lines written since the last `invalidate` reply. `FAIL` when `frames > N`, with a `reason`
  that names the panel's id and the frame count.
- `--planted redraw_every_render` is the wrong program: a frame line after every render, changed or not.

A panel's id is `id` in its `gpui-shell.json`. The test panel is a view whose `init(_props, cx)` runs
`cx.timer.every(1000, ...)` and calls `cx.notify()`, as gpui-shell's own tests do; the host runs it on its clock
(advanced by real time while it waits on stdin), so a render a second really happens.

### The idle report, `node benchmarks/canvas.mjs idle`, and its judge

- Each run in the report gains `energy: {"counter": "<name>", "nj": <number>}`: the energy the window's process used in
  the run, in nanojoules, read from the process by the named kernel counter (the tests use `ri_energy_nj`, the name
  only matters as a string). `nj` is `0` when the counter read zero.
- `node benchmarks/canvas.mjs judge`'s verdict for the task gains `energy`:
  `{"status": "READING", "counter": name, "runs": [the five nj]}`, or
  `{"status": "BLOCKED", "counter": name, "reason": text naming the counter}` when any run's `nj` is `0`.
  The verdict's own `status`, `targets` and `reason` are decided by frames, wakeups and CPU alone as before, whatever `energy` holds.

## What the tests cannot see

The live idle test needs a Mac and about 6 minutes, and is skipped elsewhere as INCONCLUSIVE. The 60 s test uses the
real clock and takes a minute. Neither the hash's strength nor the frame's pixels are tested: a frame line is the
request, and drawing it is the app's.

## Run them

```sh
npm ci
npx vitest run --root tests/acceptance/1492 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1492/tsconfig.json
```

The host test builds `deep-panel-host` with `cargo build --release --locked -p deep-panel-host`; a failed build is
BLOCKED, never a pass. A run leaves Vitest's cache in `tests/acceptance/1492/node_modules/.vite`; delete it.
