# AC19 blind redraft: a 16 MB output beside 1,000 hooks

Test: `hotpath-ac19-redraft.test.ts`, one `describe` ("AC19 #16.8f097301 a 16 MB output with a scrub-list
value: … (redraft)") with two tests: the run, and `(wrong program)` on `DEEP_HUB_PLANT=parse-on-event-loop`.
New fixture: `fixtures/load-held.mjs`. `helpers.ts`, `tsconfig.json` and the other fixtures are the suite's,
copied unchanged.

The criterion's ID: SHA-256 of its text (trimmed, whitespace collapsed, `- [ ] ` dropped) starts `8f097301`.

## What I read

- Issue #16 (`gh issue view 16 --repo windoliver/deepbuild --comments`): Scope, above all "Parsing off the event
  loop" ("a worker thread parses each hook request line, keeps its kind's catalogue fields, scrubs them and
  hashes what goes to evidence … the event loop only reads lines, acknowledges, routes and writes replies"), the
  criteria, "Added Oct 9", "Done when", and the comment.
- `docs/technical-design.md` at `4f6dec5` (`git show 4f6dec5:docs/technical-design.md`): "Hook protocol
  (deep-hook and the hub)" (the acknowledgement "within 20 ms of reading the request", "before any reply that
  waits"; deep-hook gives up after 50 ms), "Evidence", "Privacy" (scrub by value in raw, URL-encoded and base64
  at each of three offsets in both alphabets; "An event keeps only its kind's fields in the event catalogue …
  never the call's whole input or output"), and in "How we know version 0 works": Wrong programs and Dogfooding.
- This checkout (`c9891b3`): `packages/contracts/schemas/tool.after@1.json` and `hook.ack@1.json`,
  `packages/contracts/src/{index,schemas}.ts` (`validate`), `packages/record/src/index.ts` (the `Event` shape the
  record's JSON has), and the exports of `packages/evidence/src/{index,scrub}.ts`.
- The suite's README, `helpers.ts` and `fixtures/` (read-only copies the job was given).

Nothing under `packages/hub`, no other branch, worktree or PR, and no other test of #16.

## Why the old load fixture can't see the wrong program

The hub writes a hello on accept, and a client sends its request only after reading it. `fixtures/load.mjs`
opens a new connection per hook and times from the request written, which it writes as soon as the hello is in.
A hub whose event loop is held can't accept or greet: a session that connects during the hold sends its
request only once the hold is over, the hub reads it at once and acknowledges in a millisecond, and from the
write it isn't late. The only requests a hold delays are ones already written on a greeted connection, and with
one short exchange per session every 50 ms almost none are in flight at the moment the hold starts. Against a
stand-in hub that holds its loop 500 ms on the 16 MB line, `load.mjs` found **0 late acknowledgements in 5 of 5
runs** (below).

## What the new fixture does

`fixtures/load-held.mjs`, in a process of its own:

- **Greeted ahead of time.** Each session connects and reads the hello as soon as its previous hook is answered,
  then writes its next request when it is due (every 50 ms). So at any moment nearly every session holds a
  greeted connection, and a request written on it can be read by the hub at once: its write time is "the moment
  the request could first be read". A hold that starts at any moment catches every session whose time falls
  inside it with its request sent and unread.
- **Staggered.** Session k starts k·50/30 ms in, so some session writes a request every 1.7 ms.
- **The large call from a child process.** Building the 16 MB line and writing it would hold the timing
  process's own loop and make a good hub look late, so a child builds it before the hooks start, and sends it
  (new connection, hello, the line) when session 0 reaches its hook 8 of 34. Session 0 waits for its reply
  before its next PreToolUse, as an agent waits on its PostToolUse hook; the other 29 keep sending, about 25
  more hooks each, about 1.2 s.
- **The large call.** A PostToolUse, `tool_name` Bash, whose `tool_response.stdout` is exactly 16,777,216
  characters: filler text with the control token in each of the 15 printed forms `everyForm` gives (raw,
  URL-encoded both cases, base64 at offsets 0 to 2 in both alphabets, each printed whole) spread through it.
  Its `tool_input.command` is `cat logs/<token>/build.log # <every form>`.
- **One clock.** Every time is `performance.timeOrigin + performance.now()`, ms since the epoch, so the child's
  times and the parent's compare.

## Assertions, the sentence each comes from, and the wrong program each catches

| # | Assertion | Source | Wrong program it catches |
|---|---|---|---|
| 0 | The scenario ran: hub started, 30 SessionStarts answered, 1,000 PreToolUse sent, the large call written whole (16,777,216 output bytes), acknowledged and answered without an error line, and every other session wrote at least 10 requests after the large call's last byte. Otherwise `BLOCKED` (the large call refused or unanswered fails as itself) | Criterion: "While 30 scripted sessions send 1,000 PreToolUse hooks, one session's PostToolUse carries a 16 MB tool output"; README: a plant that doesn't start fails its test | A run that never puts requests in flight across the large call, and so can't fail; a hub that refuses or drops a 16 MB line |
| 1 | `checkAcks`: for every PreToolUse of the 29 other sessions, an ack line arrived no more than 20 ms after its request was written. Otherwise it throws `… the first late one is request <ULID> (session <id>, its hook <n>): acknowledged <x> ms after its request was written, written <y> ms after the large call's last byte`, the earliest-written late request first, with the next three late IDs. A request that never got a hello or an ack counts as late | Criterion: "every other session's acknowledgement arrives within 20 ms of its request being read"; design: "within 20 ms of reading the request" | `parse-on-event-loop`: the held loop leaves the requests sent during the hold unread, and their acks come hundreds of ms after the write |
| 2 | `checkRoundTrip`: p95 of (reply read − request written) over all 1,000 PreToolUse is under 2 ms; a hook with no reply counts as infinite. Otherwise it throws with the p95, how many took 2 ms or more and the slowest request's ULID | Criterion: "the socket round trip stays under 2 ms at p95" | A hub that acks in time but holds replies, or is slow on every hook |
| 3 | The large call's event, read through `events.read` once the log has stopped growing, appears exactly once by its ULID; otherwise it throws naming the ULID, the count and the `log_pos` values | Criterion: "the large call's event is appended once" | A hub that appends it twice (say, once from the loop and once from the worker) or never |
| 4 | Its kind is `tool.after`, and the event without `verified`, `session`, `project` and `agent` validates as `tool.after@1` (`validate` from `@deepbuild/contracts`; `data` is one of the `{kind, paths, command}` shapes with `additionalProperties: false`). Otherwise it throws naming the ULID and every issue | Criterion: "with only its kind's catalogue fields"; design, Privacy: "never the call's whole input or output" | A hub that keeps `tool_response`, `stdout` or `tool_input` in the event |
| 5 | The event's JSON doesn't hold the output's filler text | Same | A hub that keeps the output under a catalogue field (in `paths`, say) |
| 6 | No form of the control token (each `everyForm` core: raw, URL-encoded both cases, base64 at three offsets in two alphabets) is in the event's JSON or any of its strings, nor in any evidence file the event cites. Otherwise it throws naming the ULID (or the hash) and each form found | Criterion: "no form of the scrub-list value"; design, Privacy: the forms | A hub that doesn't scrub hook payloads by value, or scrubs only the raw form, or cites unscrubbed evidence |
| W | `(wrong program)`: the same scenario on `DEEP_HUB_PLANT=parse-on-event-loop` runs (row 0's checks pass), its large call's event is appended, some other session's ack is late, at least one late request was written after the large call's last byte (so the lateness is the large line's), and `checkAcks` throws with `the first late one is request <the earliest-written late request's ULID>` in its message | Criterion: "A hub that parses and scrubs on its event loop holds the next acknowledgements past 20 ms and fails, naming the first late one" | A check that can't fail, or one whose failure doesn't name the request |

The messages are built as strings, so Vitest can't shorten them, and the `(wrong program)` test matches the ULID
inside the thrown error's message with `toThrow(string)`.

## Readings where the issue left a choice

- **"Within 20 ms of its request being read."** The test can't see when the hub reads; it times from when the
  request could first be read: written on a connection the hub had already greeted. The README's reading (from
  the request written, "which can only be earlier") is kept; what changes is that the write happens on a
  connection that was open and greeted beforehand, so the write is not itself held back by the hold.
- **"Every other session's"**: the 29 sessions other than the large call's. Session 0's own PreToolUse hooks
  count in the round trip's p95 but not in the 20 ms check, and the large call's own ack is not timed (the
  criterion doesn't, and a hub may parse that line before it acknowledges it).
- **The round trip's p95** is over all 1,000 PreToolUse hooks, as in the README (request written to reply read,
  in the load process). It is asserted on any machine, as the criterion has no reference-Mac clause (AC12 has).
- **The scrub-list value** is the hub's control token, as the README reads it ("its own tokens"); the test
  requires it to be at least 16 characters.
- **The event's own fields.** The record's JSON adds what the connection proved (`session`, `project`, `agent`)
  and the hub adds `verified` (README); those four are set aside before validating, and every other field must
  be `tool.after@1`'s. No field is required beyond the schema; whether `command` is kept or null is the schema's.
- **Evidence the event cites** is checked for the forms too: the design scrubs "before any evidence is hashed",
  and a cited file is part of what the event points at. The event need not cite any.
- **"Appended once"** is read after the large call's event is readable and the log has gone 1 s without growing
  (at most 60 s).
- **Session 0 waits for its large call's reply** before its next hook, as an agent's PostToolUse hook blocks it.

## What the stand-in checks showed

Two throwaway stand-in hubs in my scratchpad (deleted after), each enough protocol for this test: hello on
accept, ack and reply, the cli hello and `events.read`, a `tool.after` event with `{kind: 'shell', paths: [],
command}` scrubbed of the token's forms. One parsed and scrubbed lines over 64 KB in a worker thread (the
16 MB line transferred as a buffer); the other, under `DEEP_HUB_PLANT=parse-on-event-loop`, parsed and scrubbed
every line on the event loop and, for a line over 1 MB, busy-waited so the loop was held about 500 ms. The test
ran against them through a temporary copy of this folder whose `helpers.ts` pointed `CLI` at the stand-in.

- **Good stand-in**: the test passed in 8 of 8 runs. A direct probe of the fixture (5 runs): no late
  acknowledgement, longest ack 2.7–5.1 ms, round-trip p95 1.02–1.90 ms, longest wait for a hello 2.4–3.9 ms,
  36–58 other-session requests written while the large call was in flight and about 745 after its last byte.
- **Planted stand-in**: the `(wrong program)` test passed every time (8 runs). Probe, 5 runs: 29 late acks every
  run (one per other session: each had a request sent into the hold), the first 488–503 ms late, written 0.2–4.5
  ms after the large call's last byte. One message, as thrown: `29 of 966 other sessions' acknowledgements
  arrived more than 20 ms after the request could first be read; the first late one is request
  01M5G6G2TKD915W1R624994VBT (session ad8fc2d2-…, its hook 7): acknowledged 499.29 ms after its request was
  written, written 2.89 ms after the large call's last byte. Next late: …`
- **Whatever moment the hold starts**: with the planted stand-in starting its 500 ms hold a random 0–900 ms
  after it read the large line (10 runs; it started at 288 to 876 ms), 29 late acks in 10 of 10. The round
  trip's p95 alone would have missed it in some of those runs (1.73–3.76 ms), which is why the 20 ms check is
  the one the wrong program must fail.
- **The old fixture** (`load.mjs`) against the planted stand-in: 0 late acks in 5 of 5 runs.
- **Planted stand-in with the plant switched off** (the same hub as the good one, started with the plant name):
  the `(wrong program)` test failed, `the planted hub held no other session's acknowledgement past 20 ms`.
- **Event-check mutants** of the good stand-in, each failing the run test with the named message: no scrub
  (`… holds the scrub-list value: the control token raw, … URL-encoded, upper-case hex, …`), 100 characters of
  the output kept as `data.output` (`… holds more than tool.after@1's catalogue fields: {"code":"unlisted_field",
  …"path":"/data/output"…}`), the event appended twice (`… is appended 2 times (log_pos 300, 301), not once`).

Another session was running its own #16 crash suite on this machine during these runs; the timings above
include that load.

## Type check

`node node_modules/typescript/bin/tsc -p tests/acceptance/16/tsconfig.json` (after `npm ci`): exit 0, no output.

## Run on the base

Node v24.22.0, checkout `c9891b3`, `npm ci`, `npm run build --workspaces` (twice; both passed), then
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/16 hotpath-ac19-redraft` (exit 1). Both tests
fail because the base has no `deep hub` command, the expected reason:

```
 RUN  v5.0.5 ~/dev/claude-worktrees/github-issue-16-acaf52/agent-a9f02e80c488d7219/tests/acceptance/16

 ❯ hotpath-ac19-redraft.test.ts (2 tests | 2 failed) 128ms
   ❯ AC19 #16.8f097301 a 16 MB output with a scrub-list value: others' acks within 20 ms, round trip under 2 ms at p95, its event once, catalogue fields only, no form of the value (redraft) (2)
     × AC19 while 30 sessions send 1,000 PreToolUse hooks, one PostToolUse carries 16 MB holding the control token: every other ack within 20 ms of its request, round trip under 2 ms at p95, the event once, tool.after@1 fields only, no form of the token 73ms
     × AC19 (wrong program) a hub that parses and scrubs on its event loop holds the next acknowledgements past 20 ms and fails, naming the first late one 54ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  hotpath-ac19-redraft.test.ts > AC19 #16.8f097301 … (redraft) > AC19 while 30 sessions send 1,000 PreToolUse hooks, …
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11
 ❯ scenario hotpath-ac19-redraft.test.ts:52:15
 ❯ hotpath-ac19-redraft.test.ts:178:39

 FAIL  hotpath-ac19-redraft.test.ts > AC19 #16.8f097301 … (redraft) > AC19 (wrong program) a hub that parses and scrubs on its event loop …
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11
 ❯ scenario hotpath-ac19-redraft.test.ts:52:15
 ❯ hotpath-ac19-redraft.test.ts:185:32

 Test Files  1 failed (1)
      Tests  2 failed (2)
   Start at  14:41:08
   Duration  364ms (tests 45%, transform 36%, import 18%, worker 1%)
```

(The describe and test names are shortened with `…` in the two FAIL headers; the rest is as printed.)

## Not verified

- Against a real hub: none exists at this base. The stand-ins prove the detection and the event checks, not that
  a real worker-thread hub keeps the round trip under 2 ms at p95 with 16 MB in flight; the good stand-in's p95
  reached 1.90 ms on this machine under another session's load.
- The checkout is `c9891b3`; the design was read at `4f6dec5` as the brief said. The schemas used
  (`tool.after@1`) are the checkout's.
