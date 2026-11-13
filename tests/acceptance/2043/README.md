# Acceptance tests for #2043: one hook line whose agent or event is a name every object has ends the hub

Written blind at base commit `1c4d1f0e2` ("Merge pull request #2236 …"), from the issue, the design doc and the base
alone, before any implementation. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a
blind redraft by this job.

## What was read

- Issue #2043 as given to this job: its intro (the agent and event lookups in plain objects, `constructor` and
  `toString` coming back as functions, the reply that can't be posted, the throw inside the worker, no catch in
  `parser.ts`, a pool that listens for messages only, the hub's process ending), Scope (three lines), AC1 to AC4 and
  Proof.
- `docs/technical-design.md`: "One hub per user, a tiny hook client, and extensions in-process" (one hub process every
  session's hooks reach over its socket); "Hook protocol (deep-hook and the hub)" (the request line, the
  acknowledgement `{ "v": 1, "ack": <id>, "hold_until_ms": … }` and the reply `{ "v": 1, "exit", "stdout", "stderr" }`;
  deep-hook acts as with the hub down when no acknowledgement comes); "Threats, and what stops each one" (Callers
  posing as others: a hook can't control the hub; A broken hub: deep-hook fails open with the hub down, the hub
  replays and refuses to start twice).
- The base, to learn the existing surface only: `packages/hub/src/hookmap.ts` (`parseLine`, `mapRequest`: an agent
  `ADAPTERS` has no entry for is refused `enum` at `/agent`, an event the facts' `mapping` has no rule for gives a hook
  with no drafts), `parser.ts` (no catch; `postMessage` of the parse), `server.ts` (`parserPool`: one worker for small
  lines and one for large lines started at the first, each listened to for `message` only; `line()`: a refused first
  line is written as `{ id, error }` and the connection ended; `hook()`: an ack and the reply in one write;
  `hub.health`: `pid`, `start` and the core's health), `plant.ts` (`DEEP_HUB_PLANT` names one plant, checked against
  `PLANTS`; an unknown name stops the hub at start), `wire.ts` (`refusal`, error@1's shape), the `hook.request@3`
  schema and fixture under `packages/contracts`, and `ADAPTERS` in `packages/adapters/src/index.ts`.
- `tests/acceptance/16/helpers.ts` (every hub helper used here is imported from it: temp homes under short `/tmp`
  paths, `deep hub run` as a real process, `Conn`, `control`, `health`, `hookRequest`, `fromHere`, `buildDeepHook`,
  cleanup that stops only the PIDs this suite started) and `tests/acceptance/909` (its README and tests, the model
  for this one).
- One probe of the base hub, outside the suite, to read the shapes this suite asserts: `pi` and `paseo` with an event
  their facts don't map get `{"v":1,"ack":<id>,"hold_until_ms":null}` then `{"v":1,"exit":0,"stdout":"","stderr":""}`;
  agent `no-such-agent` gets `{"v":1,"id":<id>,"error":{"code":"enum","retryable":false,"remediation":"No adapter
  maps no-such-agent; send one of claude-code, claude, codex, cursor, grok, pi, paseo.","path":"/agent",
  "actual":"no-such-agent","evidence":[]}}`; the hub closes the connection after each; 100 Claude Code `PreToolUse`
  lines in a row are each acknowledged and answered with that empty reply.

## The surface under test

- `deep hub run` on a temp home (its root `<home>/.deepbuild`), as a real process, with the `pid` its ready line
  prints.
- Its socket's line protocol: each hook line is written as a new connection's first line after the hub's hello, as
  deep-hook writes it; the test reads every line the hub sends back until a line with `exit` or `error`, or 10 s, and
  whether the hub then closes the connection. `hub.health` on a control connection (the `cli` hello with the control
  token), for `pid` and for the pool's count (Surface choices).
- AC1's fixture line, `fixtures/pi-constructor.jsonl`, checked against `hook.request@3` with `validate` from
  `@deepbuild/contracts`.

## Surface choices

The issue leaves these open; the tests use them exactly, so the implementation matches them.

- **AC1's fixture line**: `fixtures/pi-constructor.jsonl`, one line ending in a newline, sent byte for byte:
  `{"v":1,"agent":"pi","event":"constructor","seq":"1762905600000000000","id":"01KA2043C0NSTRVCT0R0000000","pid":2043,"ppid":1,"matched":[],"payload":{"session_id":"pi-2043-constructor","cwd":"/tmp"}}`.
- **"As it answers an event the adapter doesn't map"**: the judge's reference is read on the same hub, just before:
  the fixture line with its event set to `no_such_event`, which no adapter's facts map, and a new `id`, `seq` and
  session. The fixture line must get the same lines, its acknowledgement naming its own `id`, and the hub must close
  its connection as it closed the reference's. The same holds for AC2's `pi` and `paseo` lines, each against its own
  agent's `no_such_event` line: Scope says an event with no entry keeps its own name, so it is answered as any event
  the adapter doesn't map.
- **"Refused at `/agent` as an unknown agent is"**: the reference is a Claude Code `PreToolUse` line with agent
  `no-such-agent`, read on the same hub. Each of the five agents must get the same lines, with its own `id`, and its
  own name where the reference has `no-such-agent` (in `remediation` and `actual`), and the hub must close the
  connection. On the base that refusal is `code: "enum"`, `path: "/agent"`.
- **Answered** (AC1's `PreToolUse` line and AC3's 100 lines): an acknowledgement naming the line's `id` and a reply
  line with a numeric `exit`, with no error line, within 10 s. Each is a Claude Code `PreToolUse` from #16's
  `hookRequest`, with this process's `pid` and `ppid`.
- **A refusal** (AC3's and AC4's marked line): a line whose `error` is an object with a non-empty string `code` and a
  string `remediation` (error@1's shape), and no acknowledgement or reply line, within 10 s. Its `id` and `code` are
  left open: the pool may not know the line's `id`.
- **The hub's process id is unchanged**: `hub.health`'s `pid` on a new control connection, read after the lines,
  equals the `pid` of the ready line `deep hub run` printed.
- **The planted worker faults**, two test-only variables each parser worker reads. Only tests set them. Each names a
  text; a parser worker handed a line whose bytes contain that text misbehaves on it, and parses every other line as
  it would without the variable. The tests set the text to the marked line's `id`, a fresh ULID only that line
  carries.
  - `DEEP_HUB_TEST_PARSER_THROW=<text>`: the worker throws an `Error` that nothing in the worker catches, so the
    worker ends with an `error` event on the hub's thread, as the base's worker does on AC1's line, and it doesn't
    answer that line. The throw must escape any catch the fix adds around the parse (for example, thrown from a
    `setImmediate` the message handler schedules): that is the fault a pool must survive, and the one the planted
    pool below can't.
  - `DEEP_HUB_TEST_PARSER_EXIT=<text>`: the worker ends at once, without answering that line, through
    `process.exit(1)` in the worker: its `Worker` emits `exit` and no `error`.
- **The planted pools**, each a `DEEP_HUB_PLANT` name added to `PLANTS` in `packages/hub/src/plant.ts`, so a hub with
  one starts. Each combines with either variable above; everything not named is as fixed.
  - `parser-pool-messages-only`: the parser pool as the base has it: it listens to each worker for its messages
    only, with no `error` or `exit` listener, and replaces no worker.
  - `parser-pool-leaves-line-waiting`: a pool that hears a worker end and starts its replacement, as fixed, but
    leaves each line the ended worker held waiting, never answered.
- **The count of workers the pool holds**: `hub.health` gains a top-level `parsers`, a whole number: the parser
  workers the pool holds as the reply is made, each counted from when the pool starts it until it ends. This suite
  sends only small lines, so it reads 1 on a fixed hub. AC4 reads it on a control connection opened before the marked
  line, then again after the line's refusal, every 100 ms for up to 10 s, until it equals the first reading. That
  field, the socket and the two variables are all the hub is asked for. (The hub process's OS thread count was ruled
  out: the core's thread, the child-process thread and libuv's pool come and go beside the parsers.)
- **Criterion IDs**: each test's name starts with `#2043.<first 8 hex of SHA-256>` of its criterion's text, trimmed
  and white space collapsed (`scripts/proof-change.mjs`, `criterionId`), computed from the text as this job received
  it, which starts `AC1:` to `AC4:`. This job didn't read the live issue body, so the IDs aren't checked against it.

## The tests

`lookups.test.ts`, AC1 and AC2, each on its own hub:

- **`#2043.cbf38aec` AC1 the fixture line pi/constructor is answered as an event pi doesn't map, and a `PreToolUse`
  line on a new connection is answered afterwards.** The fixture must be one line, valid against `hook.request@3`,
  with agent `pi` and event `constructor`. A hub starts; the reference `pi`/`no_such_event` line is sent; then the
  fixture's bytes as a new connection's first line, which must get the reference's lines and close; then a new
  `PreToolUse` line on a new connection must be answered. A failure names the line (`fixtures/pi-constructor.jsonl`,
  agent, event and `id`) and says whether the hub's process ended, with the end of its stderr.
- **`#2043.ccd54552` AC2 15 lines, 15 answers, the hub's process id unchanged.** A hub starts; the references are read
  (`no-such-agent`, then `pi` and `paseo` with `no_such_event`). Then 15 lines, each a new connection's first line:
  agents `constructor`, `toString`, `hasOwnProperty`, `valueOf`, `__proto__` (each must be refused as `no-such-agent`
  is), then `pi` and `paseo` with each of the five as the event (each must be answered as its agent's `no_such_event`
  is). Every line is sent and judged; the failure lists each line that wasn't answered as expected. The 15 must get 15
  answers, and `hub.health`'s `pid` must be the hub's.

`workers.test.ts`, AC3 and AC4, each test on its own hub, the marked line a Claude Code `PreToolUse` whose `id` the
variable names:

- **`#2043.d1e23f18` AC3** with `DEEP_HUB_TEST_PARSER_THROW` set: the marked line's connection must get a refusal;
  then 100 `PreToolUse` lines, each on a new connection, must each be answered; then `hub.health`'s `pid` must be the
  hub's.
- **`#2043.d1e23f18` AC3 (wrong program)** with `DEEP_HUB_PLANT=parser-pool-messages-only` as well: the same judge
  must fail at its first step, "the line `<id>`, on which the parser worker throws, gets a refusal on its connection"
  (the hub's process ended, so the connection closes with no answer), and the hub's process must have exited within
  10 s.
- **`#2043.43f43d35` AC4** with `DEEP_HUB_TEST_PARSER_EXIT` set: `parsers` is read, the marked line must be refused
  within 10 s, `parsers` must have read a whole number of at least 1 before it, and must read that number again within
  10 s after the refusal.
- **`#2043.43f43d35` AC4 (wrong program)** with `DEEP_HUB_PLANT=parser-pool-leaves-line-waiting` as well: the same
  judge must fail under its 10 s timeout, at "the line `<id>`, held by a parser worker that exited, is refused within
  10 s: … still waiting at the timeout", naming the line by its `id`.

AC1's and AC2's wrong program is the base itself, shown by their failing there.

## On the base (the wrong programs)

Run once on `1c4d1f0e2`, every test fails, each for the reason its criterion names (BASE-FAILURE.txt):

- AC1: the fixture line gets no answer: the connection closes, and the hub's process has ended with code 1, its stderr
  ending `DataCloneError: function Object() { [native code] } could not be cloned` at `parser.js`'s `postMessage`,
  then `Emitted 'error' event on Worker instance`. The failure names the line.
- AC2: the first line, agent `constructor`, ends the hub (the adapter lookup throws inside the worker: the adapters'
  registry refuses `actual: 'function Object() { [native code] }'` at `/name`, called from `mapRequest`), and the other
  14 find no hub (`ECONNREFUSED`): 0 answers to 15 lines, and no `hub.health` after them.
- AC3 and AC4: the base has neither variable, so the marked line is acknowledged and answered like any other, not
  refused; the hub runs on. (Had the base a throwing or exiting worker, its pool would end the hub, or leave the line
  and every later one waiting, as the issue reads it.) The base has no `parsers` in `hub.health` either.
- AC3 and AC4 (wrong programs): the base doesn't know `parser-pool-messages-only` or `parser-pool-leaves-line-waiting`,
  so the hub doesn't start (`BLOCKED`, "names no planted program"). The base's pool is the first of the two wrong
  programs, as the issue reads it.

## Running them

```
npm ci && npm run build --workspaces
npx vitest run tests/acceptance/2043 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2043/tsconfig.json
```

Node 24.22 or later (the repo's `engines`), and cargo 1.99.1 on `PATH`: the hub doesn't start without a `deep-hook`
under the checkout's `target/`, so each file's `beforeAll` builds it with #16's `buildDeepHook` (a no-op once built).
On a fixed hub the files take about half a minute, AC4's wrong program waiting out its 10 s. Homes are under
`/tmp/dh16-*`; nothing touches the real `~/.deepbuild`; each hub this suite starts is stopped by its PID.
