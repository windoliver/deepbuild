# Acceptance tests for #2801: `hub.health` during the hub's startup

Written first, blind, by a job that never saw a fix for #2801; none existed. Nothing here was edited by the
implementing agent (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #2801, live (`gh issue view 2801 --repo windoliver/deepbuild`): what happens, what is expected and its three
  acceptance criteria.
- `AGENTS.md`; `docs/technical-design.md` (Dogfooding, the hub and its socket).
- The base, `d4cef00fb` (origin/main), for the surfaces the issue names: `packages/hub/src/service.ts` (`startHub`,
  `hubStatus`, `control`, `waitForHub`), `server.ts` (`deep hub run`: the token is written, the socket listens, then
  the core's start is awaited; `hub.health` goes to the core), `core-worker.ts` (`asRefusal`), `core.ts` (`init`,
  `openRecordAndAsks`, `raw`), `hub-control.ts`, `paths.ts` (`rootOf`), `packages/evidence/src/index.ts`
  (`openEvidenceStore`) and `packages/record/src/index.ts` (`openRecord`).
- For conventions: `tests/acceptance/2745/`, `2742/` and `16/` (its `helpers.ts`: how a hub is started, read and
  stopped), `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs`.

## How to run

```sh
npm ci && npm run build --workspaces          # once
cargo build --locked -p deep-hook             # once: the hub's core stops at start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2801 --no-file-parallelism startup.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2801/tsconfig.json   # type-check
rm -rf tests/acceptance/2801/node_modules
```

About 35 s on this Mac at load ~200. With no `deep-hook` built (under `$CARGO_TARGET_DIR` or `target/`, debug or
release), every test throws `BLOCKED: no deep-hook is built …` before starting anything. Each test starts its own dev
hub with this checkout's CLI, `node packages/cli/dist/main.js hub start --root <root>`, with `HOME` a scratch home and
no `DEEP_*`/`XDG_*` variable, in a folder under the system temp folder (`dh2801-*`), so the real `~/.deepbuild` and
the launchd job are never touched. After each test (`cleanup`): every hold is released, the hub is stopped with
`deep hub stop --root` and, if still alive, by the PID its own ready line in `<root>/logs/hub.log` names; then the
folder is removed. Nothing is stopped by name or port. `BASE-FAILURE.txt` is this command's output at the base.

## How the startup window is held

The bug lives between the moment the hub's socket answers and the moment its core has started; on a quiet machine that
is a fraction of a second. The tests make it last as long as they need, at the base and on a fix alike, without
leaning on load or on any test hook of the hub: before the hub starts, two files its core reads while it starts are
made named pipes (FIFOs) in the fresh root (`helpers.ts`, `hold`, `holdStart`):

1. `<root>/evidence/records.jsonl`, the evidence journal. At the base the core reads it first (`openEvidenceStore`,
   an async read), before the record is opened: while it waits, the core's thread is free and answers calls, with
   `this.record` still unset.
2. `<root>/transcripts.json`, the transcript cursors. At the base the core reads it right after the record opens, with
   `readFileSync`: while it waits, the core's thread answers nothing.

A FIFO's reader waits until a writer opens it and closes it. The test sees the hub's reader arrive (a non-blocking
writer's open stops failing with ENXIO) and decides when to release: it unlinks the path, then closes its writer, so
the read ends empty and every later read or write finds no file, as in a fresh root. Both are ordinary steps of a core
start made slow, as a slow disk makes them; a correct program has to cope with any start step taking long. A fix may
read the files in another order, or not at all: the tests release a hold whose reader never arrives when they finish,
and no assertion requires either file to be read.

## Criterion → test

Each ID is `criterionId`'s hash of the checkbox's text (first 8 hex digits of its SHA-256, trimmed, white space
collapsed). All tests are in `startup.test.ts`.

| Criterion | Test | What it does | At the base |
|---|---|---|---|
| `#2801.9ff40b64` while the hub starts, `hub.health` (and any control call) waits for the core or is refused with a plain `unavailable` naming the startup; no refusal carries an internal error's message | `AC1 #2801.9ff40b64 hub.health and events.read sent every 100 ms on the socket …` | Starts `deep hub start --root`; holds each FIFO 3 s from its reader's arrival; from the same instant sends a control call every 100 ms on `<root>/hub.sock` as `deep hub status` does (hub hello, `{v:1, hello:'cli', token}`, then the call), alternately `hub.health` and `events.read {after:0, limit:10}`, each waiting up to 60 s (so a call that waits for the core passes), until a `hub.health` sent after both releases answers with the health. Fails if any refusal is not `code: "unavailable"` with a remediation naming the start (`/\bstart/i`) or carries an internal error's text (`helpers.ts`, `INTERNAL`: `Cannot read propert…`, `is not a function`, `undefined`, `TypeError`, …); also fails if `deep hub start` doesn't exit 0 or the health never answers | 19 `hub.health` calls refused with `"remediation":"Cannot read properties of undefined (reading 'raw')"` |
| `#2801.a166701c` polled every 2 s from the moment `deep hub start` returns, `deep hub status` never drops from an answer back to no answer | `AC2 #2801.a166701c deep hub status --root every 2 s …` | Runs `deep hub start --root`; from the moment it exits, runs `deep hub status --root` every 2 s (try starts 2 s apart; one that ran longer is followed at once) until three tries in a row print the health, 120 s at most. Each try is health (exit 0, a JSON line), a refusal (`… was refused: {…}`) or no answer (anything else: the CLI's `no answer within 2000 ms`, a closed connection, no socket). The first hold ends once a try has answered, or 4 s after its reader came while `deep hub start` still waits; the second once a try after an answered one got no answer, or 5 s after its reader came (so a try's 2 s timeout falls inside it). Fails if any try after the first answered one gets no answer, or the three healthy tries never come | try 1: the TypeError refusal; try 2: `no answer within 2000 ms`; tries 3–5: health |
| `#2801.9e13fccc` `deep hub start` exits 0 only once the core answers `hub.health`, so `deep hub status` right after it succeeds | `AC3 #2801.9e13fccc deep hub status --root run the moment deep hub start --root exits 0 …` | Holds the evidence FIFO until the status run below has finished, or 5 s after its reader came while `deep hub start` still waits (the transcripts hold is released at once); runs `deep hub start --root`, then at once `deep hub status --root`. Fails unless start exits 0 and status exits 0 with one JSON line holding the hub's `start` ID and `pid` | start exits 0 after 461 ms; status exits 3: `hub.health was refused: {… "Cannot read properties of undefined (reading 'raw')" …}` |

## How each test passes on a correct program

- AC1: every call during the holds either waits and answers, or is refused `unavailable` with a remediation that names
  the start (the issue's example, "the hub's core is still starting", matches). A refusal for any other reason, at
  any time in the run, fails it; calls are only sent until the core answers the health, with valid parameters.
- AC2: a hub that refuses plainly while starting, or one whose `deep hub start` only returns once the core answers,
  never turns a later try into no answer. With a start that waits, the holds end on their own (4 s, then 5 s), so
  start returns after roughly 9 s plus the core's own start: inside `startHub`'s 15 s wait at this base's value.
- AC3: a start that waits for the core returns after the 5 s hold and the rest of the start, and the status after it
  reads the health.

## Deviations and open points

- AC2 and AC3 release their first hold early once the base's bug has shown (an answered try; the status run), and
  AC2 its second once a drop has shown, so the base fails fast; on a correct program they run their full times. At
  the base they could pass falsely only if `deep hub start` returned more than 4–5 s after the core reached its
  evidence read; in every run here it returned before the core got there.
- The criterion's "any control call" is held for `hub.health` and `events.read`. At the base `events.read` waits for
  the core and passes; `hub.health` is what fails.
- "Names the startup" is read as a remediation matching `/\bstart/i` (starting, startup, start); the exact sentence
  isn't pinned.
- AC1 counts a call that waited up to 60 s and then answered as "waits for the core". A call with no answer at all
  in AC1 (no socket yet, no token yet) is not judged by AC1; dropping back to no answer is AC2's.
- AC3's second half ("a `deep hub status` run right after it succeeds") is what is tested; the first half is implied
  by it, since `deep hub status` reads `hub.health` from the core.
- The issue's third Expected bullet allows "or the gap is documented"; the criterion doesn't, and AC3 holds the
  criterion.
- `scripts/lanes.mjs` wasn't edited (this job writes only this folder). The suite starts hubs with holds timed in
  seconds; if lanes run it beside load-sensitive suites, the implementer may list `tests/acceptance/2801/` in `alone`.
