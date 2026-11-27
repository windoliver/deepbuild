# Acceptance tests for #3429: a session paseo runs in a mode that doesn't ask is named as unguarded

Written blind, from the issue, the design and base commit `8feb93630b60d18c55d551e8b07554d51049e497` (origin/main,
November 25, 2026). Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: issue #3429 (its bullets, Scope, six criteria, Proof, References) as of November 25, 2026, and
the words it cites in #6, #47, #55, #574, #1453, #1849 and #3235; in the design, "What each agent gives us, and the
limits we design around" (the paseo row), "Hooks are evidence, not a state machine" (Who is calling, Facts as data),
"Before each command", "Threats, and what stops each one" (Sessions DeepBuild starts) and "States people see";
`AGENTS.md` and `CONTRIBUTING.md`; the suites `tests/acceptance/3430` and `55` (READMEs, `helpers.ts`, `real.test.ts`,
`gate.test.ts`, `fixtures/paseo-host.mjs`, `fixtures/fake-provider`), `29/h-d.ts`, `27/helpers.ts`, `1832` and `3433`
for the format; at base, `packages/paseo/server/plugin.ts`, `hub.ts` and `plant.ts`, `adapters/paseo.facts.json`,
`claude-code.facts.json` and `codex.facts.json` (`skipping`), `adapters/corpus/README.md` and paseo's set,
`scripts/corpus-paseo.mjs` and its provider, and in `packages/hub/src/` `hookmap.ts`, `server.ts` (`paseoHook`),
`status.ts`, `rows.ts`, `reading-codes.ts`, `log-reads.ts`, `hub-control.ts` and `session-state.ts`, and
`packages/verdicts/src/engine.ts` (a failure the base shares); and paseo 0.15.0:
`copilot-acp-agent.ts`, `acp-agent.ts`, `messages.ts` (`AgentSnapshotPayloadSchema`), the plugin hooks' types
(`lifecycle.ts`), `custom-providers.md`, `cli.md`, and a real 0.15.0 daemon run in a scratch home.

## Run

```sh
npm ci && npm run build --workspaces        # the hub and CLI the tests run are the built ones
cargo build --locked -q -p deep-hook        # the hub refuses to start without it; the Claude Code test runs it
npm i --prefix <paseo> @getpaseo/cli@0.15.0
DEEP_PASEO_CLI=<paseo>/node_modules/.bin/paseo \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3429 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3429/tsconfig.json
```

- Node 24 (type stripping on), on macOS. `DEEP_PASEO_CLI` is the `paseo` command of `@getpaseo/cli` at the version
  `adapters/paseo.facts.json` pins, as #55's `real.test.ts` needs it; missing or another version, `real.test.ts` reads
  `BLOCKED`, never a skip. `real.test.ts` needs no build: nothing of DeepBuild's runs in it.
- Every other test starts its own hub and #55's paseo stand-in under `/tmp/dh55-*` (#55's helpers) or `/tmp/dh29-*`
  (#29's, for the Claude Code session), and the real daemon lives under `/private/tmp/dh3429-*`. `HOME` is inside
  that folder for every process, so the real `~/.deepbuild`, `~/.paseo` and `~/.claude` are never touched. The daemon
  listens on a free port of its own on 127.0.0.1 with its relay off and fetches no speech model. Processes are stopped
  by PID and by the process group this suite started, never by name or port.
- `lane.json` runs the folder alone, as #55 runs. No network beyond 127.0.0.1, no model, no account. With `--root`
  here Vitest may write `tests/acceptance/3429/node_modules/.vite`; delete it before committing.
- No line is needed anywhere else: `lane.json` puts the folder on the one-at-a-time list.

## The worlds

- **A real paseo daemon** (`real.test.ts`, `daemon.ts`): `paseo daemon run` 0.15.0 with two fixtures of this suite.
  `fixtures/acp-agent.mjs` is the scripted ACP agent: it speaks the Agent Client Protocol over stdio in the shape of
  Copilot's CLI, and paseo's own Copilot provider runs it in place of `copilot --acp` (`agents.providers.copilot.command`
  in the daemon's `config.json`, as paseo's custom-providers page gives it). So the modes are paseo's own:
  `paseo run --provider copilot --mode allow-all` turns the agent's `allow_all` option on, and the snapshot reads
  `currentModeId: "allow-all"`. Each prompt is one turn with one tool call, a shell command that writes a file in the
  agent's folder. With `allow_all` off the agent asks first, through `session/request_permission`; with it on it asks
  nobody and runs the command. `fixtures/observer` is a paseo plugin that decides nothing: it writes down each agent
  hook the daemon fires, and how the snapshot reads the mode at a turn's start. DeepBuild's plugin and hub don't run
  here: the question is what paseo fires.
- **Paseo around the plugin** (`mode.test.ts`, `gate.test.ts`, `world.ts`): #55's world, reused through
  `../55/helpers.ts`. The real hub (`deep hub run`), the real plugin (`packages/paseo/index.server.ts`) loaded by
  `../55/fixtures/paseo-host.mjs`, and a Copilot agent as a recorded-shape fake in #55's fixture repo. Its snapshot
  reads the mode as the real daemon's does: `currentModeId` and `runtimeInfo.modeId` hold the same ID, `allow-all` or
  `https://agentclientprotocol.com/protocol/session-modes#agent` (Agent, the mode that asks, paseo's default for
  Copilot), and `availableModes` lists Agent, Plan and Allow All. `real.test.ts` asserts both IDs on the real daemon,
  so the fake can't drift from it unseen.
- **Claude Code** (`gate.test.ts`) is #29's stand-in: its hooks go through the real deep-hook, which binds the session
  first, and paseo's stand-in then runs the same session ID as provider `claude`.

## The recorded run

Criterion 1 ends: "If it fires, this issue closes on that run. Until the run exists, every criterion below reads
BLOCKED, never PASS." This suite knows the run exists by one thing: the corpus holds it, at

```
adapters/corpus/paseo/<the version the facts pin>/self-approved-call/
  session.json       schema corpus.session@1, agent paseo, that version, scenario self-approved-call
  events.jsonl       the plugin's hook requests of ONE session, in the order paseo fired them: the turn in the mode
                     that approves its own calls, from its agent.turn.before to its agent.turn.after
  transcript.jsonl   paseo's own record of the agent (paseo inspect), whose Mode names the mode it ran in
```

as `adapters/corpus/README.md` describes a set and `scripts/corpus-paseo.mjs` records paseo's. Whether `events.jsonl`
holds an `agent.permission.before` payload is the recorded answer. The scenario's name and the one-session rule are
this job's choice (the issue names neither); a control turn in the asking mode, if recorded, belongs in a set of its
own, as `permission-allowed` already is. The recording is the implementer's to make and commit.

- `real.test.ts` runs the real daemon and compares: the recorded answer must be what the daemon does. A recording
  written by hand that says otherwise fails there (invariant 1).
- Each test of criteria 2 to 6 calls `needRun` (`run.ts`) once its own assertions hold. A program that fails the
  criterion fails at its assertion, naming what the criterion names. A program that passes it reads `BLOCKED` while
  the corpus lacks the run, and `BLOCKED` for good if the run shows the hook firing, since the issue then closes on
  that run and nothing below is to be built. No test of criteria 2 to 6 can read PASS without the run. It needs no
  real daemon, so those tests run on any machine, as the issue's `Runs on:` line says.

## Criteria to tests

IDs are the first 8 hex of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.

| Tag | Criterion | Test | What it requires | Wrong program it fails on |
|---|---|---|---|---|
| `#3429.c0361f49` | On the pinned paseo's real daemon, a scripted ACP agent in a mode that approves its own calls runs a tool call, and whether paseo fires `agent.permission.before` for it is recorded for the corpus (#47). If it fires, this issue closes on that run. Until the run exists, every criterion below reads BLOCKED, never PASS | `real.test.ts`: `on the pinned paseo's real daemon …` | Without the pinned `paseo`: BLOCKED. In the asking mode the agent's call asks and paseo fires `agent.permission.before` (else BLOCKED: the observer can't see one). In `allow-all` the snapshot reads `allow-all`, the agent asks nobody and the command's file exists. The corpus holds the run (above), and its answer equals what the daemon just did | `recording-contradicts-daemon`; the merge base (no recording) |
| `#3429.97f78b7f` | A Copilot session through the fixture paseo whose snapshot reads `allow-all` starts a turn: the record holds one reading naming the mode, and its row says no call is checked before it runs. The merge base records nothing about the mode and fails this test, naming the session | `mode.test.ts`: `a Copilot session whose snapshot reads allow-all starts a turn …`; `Copilot's entry in paseo's facts lists allow-all …` | Within 60 s of the turn's start: exactly one `session.reading` of the session whose data names `allow-all`; it says `no call is checked before it runs` and names the turn's end; the row holds a one-line string saying so and naming `allow-all`; `session.page` holds that one reading. `providers.copilot` in the facts names `allow-all` | `mode-unread` (the merge base) |
| `#3429.51266e12` | The same session switched to its asking mode loses the line at its next turn's start, and a second turn in `allow-all` adds no second reading | `mode.test.ts`: `a second turn in allow-all adds no second reading …` | Turn 1 and turn 2 in `allow-all`, each to its stop: one reading, and the row keeps its line. Snapshot switched to Agent, turn 3 starts: within 60 s the row holds no such line, and no "mode not known" either; still one reading. Switched back, turn 4 starts: a second reading (Scope: "one reading per change of mode") and the line again | `reading-every-turn`, `line-stays-after-switch` |
| `#3429.d3ca9d44` | A provider with a facts entry, in a mode the entry doesn't list, reads "mode not known". A plugin that reads an unlisted mode as asking fails, naming the mode | `mode.test.ts`: `a Copilot session in a mode its facts entry doesn't list …`; `Copilot's entry in paseo's facts lists allow-all …` | A Copilot snapshot reading `dh3429-mode-no-facts-list` starts a turn: within 60 s its row holds a string saying `mode not known` | `unlisted-as-asking` (the merge base) |
| `#3429.9ecaeb87` | In `allow-all`, a false done still comes back to the session with its failing case, once | `gate.test.ts`: `in allow-all, a Copilot false done still comes back …` | #55's false done (AC2) with the snapshot in `allow-all`: within 180 s the plugin sends words naming `cart-discount` into the same agent, once (none more within 10 s), never as an interrupt, and the claim is judged once and doesn't pass (the verdict's word is the base's: The first run, below) | `unguarded-skips-send-back` |
| `#3429.0888aab7` | A Claude Code session through paseo gets no mode reading from the plugin | `gate.test.ts`: `a Claude Code session deep-hook gates …` | A Claude Code session deep-hook bound, run by paseo's stand-in with its snapshot reading `bypassPermissions`, starts a turn: within 20 s of the plugin reading the agent, no `session.reading` of the session names `bypassPermissions`, says `no call is checked before it runs` or says `mode not known`, and its row holds no such line | `reads-mode-for-relayed` |

Each failing assertion's message holds the name its criterion asks for: the session's ID (criteria 2, 3, 5, 6) or
the mode (criterion 4). `twins.json` maps each tag to its twins; `twins/README.md` says how to plant each.

### On the merge base (`BASE-FAILURE.txt`)

All seven tests ran on the built base (`packages/*/dist`, and `target/debug/deep-hook` built with
`--features env-plants`), with `DEEP_PASEO_CLI` set. `BASE-FAILURE.txt` is this job's last run, 228 s at a load of
11 to 18 on 18 cores. Five tests fail at an assertion of this suite's; two hold their assertions and read BLOCKED.

- `#3429.c0361f49` fails at "is recorded for the corpus": the corpus holds no
  `adapters/corpus/paseo/0.15.0/self-approved-call`. Its message holds what the real daemon did: in `allow-all` it
  fired `agent.create.after`, `agent.turn.before` and `agent.turn.after`, and no `agent.permission.before`.
- `#3429.97f78b7f` fails at its first assertion, naming the session: "Copilot session <ID> (paseo agent <ID>) started
  a turn with its snapshot reading currentModeId allow-all … the record must hold one reading of the session naming
  allow-all; the session's record: session.activity, session.state, row.set; its readings: none".
- `#3429.51266e12` fails at its first assertion, naming the session: no reading after the first turn in `allow-all`
  (`session.activity, agent.stop, session.state, row.set`). The base never reaches the second turn's assertions.
- `#3429.d3ca9d44` fails naming the mode: "started a turn in mode dh3429-mode-no-facts-list … it reads "mode not
  known", never as a mode that asks; its row reads working: last seen 1m ago".
- `#3429.97f78b7f` + `#3429.d3ca9d44`, the facts: fails, the base's `providers.copilot` names no mode.
- `#3429.9ecaeb87` holds its four assertions on the base, as a "still" criterion may, and reads BLOCKED from
  `needRun`: the recorded run is missing. It must fail on its twin instead (`twins/README.md`).
- `#3429.0888aab7` holds its two assertions on the base, as a "no" criterion may, and reads BLOCKED from `needRun`.

### The first run on a built base, and the one change it made

`mode.test.ts` and `gate.test.ts` were drafted with no build to run them on. Their first run did what this README
said of the base in every test but one.

**`#3429.9ecaeb87` failed at an assertion the criterion doesn't make.** As drafted it ended, after #55's AC2, with
"the claim has one verdict, FAIL". On this base the gate judges the fixture's false done `BLOCKED`, not `FAIL`: its
reasons read "cart-discount: inherited: also fails on the merge base", since #55's `cart-discount` check fails on the
fixture repo's own base commit too, and the verdict engine reads a failure the base shares as inherited
(`packages/verdicts/src/engine.ts`). The send-back is unchanged by that: the plugin sent, once, "DeepBuild sent this
claim back: the repo's spec check cart-discount BLOCKED." into the session. #55's own AC2 test fails on this base at
the same line for the same reason (run here; `scripts/known-failures.json` doesn't list it).

The criterion's words are "a false done still comes back to the session with its failing case, once". It names no
verdict word, and "still" means as the base does it. So the assertions that carry its sentence are kept as drafted
(words naming `cart-discount` come back into the same agent, once, never as an interrupt), and the last one now
reads what "a false done" says and no more: the claim is judged once and doesn't pass. A gate that passed it, or
judged it twice, in `allow-all` would be a changed gate. With that, the test holds on the base and reads BLOCKED for
the missing run, which is what this README said a "still" criterion does there.

Nothing else changed in a test's assertions. One guard was added to `#3429.0888aab7`: if the hub lists no row for
the Claude Code session, the test reads BLOCKED rather than finding no mode line in a row that isn't there. On the
base the row is there.

**The bounds were left as they are.** On the base a turn's start and its stop each showed in the record within a
second, minutes after a run that ended at a load of 86 on 18 cores, so the 60 s a mode reading gets to show is a
ceiling a right program doesn't approach;
only a wrong one waits it out, and three tests do on the base (184 s of the run). It stays at 60 s: the hub reads
some of what a row shows off the hook's path, a watched session's transcript each 30 s and its clock-bound states in
a pass each minute (`packages/hub/src/status.ts`), and a mode line made that way must still be seen. A change to
30 s was written and taken back unrun, before the run `BASE-FAILURE.txt` holds.

## Surfaces chosen

The issue names paseo's hooks and snapshot, the plugin, the facts, the record, the session's row and its page, and
the done gate's send-back. The tests read them through:

- **paseo's snapshot**: `currentModeId` (the issue's field) with `runtimeInfo.modeId` equal to it, as the real daemon
  gives both; set before `agent.turn.before` fires, so a plugin that reads the mode at the turn's start sees it.
- **The record**: `events.read` on a cli connection (#55's `events`). "A reading" is a `session.reading` event of the
  session, the record's kind for one; "naming the mode" is the mode's ID in its data. Other kinds that carry the ID
  (a `row.set`, the turn's own event) aren't counted.
- **The row**: `rows.read` with `detail: true`, behind every hook the hub received: the list's row every reader
  shows and the detail `deep status` prints under it. "Says" is any string either holds, so the line may sit in
  `why`, a flag, a note or a reading; "in one line" is one string with no line break that also names the mode.
- **The page**: `session.page`, the window of the session's events its page is drawn from.
- **The words**: the issue's own, `no call is checked before it runs` and `mode not known`, matched whatever their
  case. The reading's third part, that the turn's end still is checked, is matched as `turn's end` or
  `end of its turn`.
- **The facts**: `providers.copilot` in `adapters/paseo.facts.json` holds the string `allow-all`, in whatever field
  lists the modes. The field's name is the implementer's.
- **The gate**: #55's surfaces, the plugin's `send` and `verdict.made`.

## Open questions

1. **Two sentences disagree about the merge base.** Criterion 1 says every criterion below reads BLOCKED until the
   run exists; criterion 2 says the merge base fails its test, naming the session. This suite keeps both as far as
   they go together: a test of criteria 2 to 6 never reads PASS without the run, a program that fails the criterion
   fails at its assertion (so the merge base fails criteria 2, 3 and 4 by name, as the before lane wants), and one
   that holds it reads BLOCKED. If the owner wants BLOCKED before any assertion, `needRun` moves to each test's first
   line in a redraft.
2. **"If it fires, this issue closes on that run."** Read here as: the tests of criteria 2 to 6 then read BLOCKED for
   good, naming the run, and are never built. On paseo 0.15.0 it doesn't fire (How far these tests were checked).
3. **"With the marks the design already has (#1453)."** Not asserted. The tests require the line and that it is one
   string; which mark, flag or status-map entry carries it has no surface a socket read can pin.
4. **Which facts field lists the modes**, and whether it also lists the modes that ask. The third criterion needs
   Copilot's asking mode to read as one that asks while the fourth needs an unlisted one to read "mode not known", so
   something must tell the two apart; the tests don't say what.
5. **"One reading per change of mode."** Read as: a turn in a listed mode right after a turn in the same mode adds
   none, and a turn in a listed mode after a turn in another mode adds one. The last step of the third criterion's
   test holds the second half, which the criterion itself doesn't spell out.
6. **Where "mode not known" reads.** The row. Whether the record also holds a reading for it isn't asserted.
7. **A snapshot with no mode** (`currentModeId: null`, as #55's and #3430's Copilot fakes have). Not tested: the
   issue speaks of a mode the facts don't list, and no mode isn't one.
8. **paseo's own Auto Accept.** `acp-agent.ts` at v0.15.0 has a second way a call skips the request: the ACP
   feature toggle `Auto Accept` ("Automatically approves ACP permission prompts"), on by default for an unattended
   create, answers `session/request_permission` inside paseo before any `permission_requested` event. It is no
   mode, so `currentModeId` doesn't show it and this issue doesn't cover it. Noted for the issue's owner.
9. **The scripted agent stands in for Copilot's CLI.** That the real Copilot asks nobody in Allow All is read from
   paseo's source, as the issue says; the run shows only that paseo raises nothing when the agent doesn't ask.

## How far these tests were checked

Run, on the base:

- **The whole suite, four times on the built base**, one run at a time: a run made for this job before it went on
  (226 s), this job's first (235 s, load 58 to 86), and two after the one change above (262 s at a load of 110 to
  140, then 228 s at 11 to 18, which is `BASE-FAILURE.txt`). The first two read alike: six tests as this README says
  and `#3429.9ecaeb87` failing at its verdict's word. The last two read alike too, as "On the merge base" gives it.
- **What the base's failures never reach** (a throwaway test in this folder, run once and deleted). Four turns of
  one Copilot session with the snapshot switched to Agent and back: each turn's start and stop showed in the record
  within a second, and the plugin's handlers raised nothing. `rows.read` with its detail gave the session's list row
  and its `deep status` detail, and `session.page` its events (`session.activity`, `agent.stop`, `session.state`; no
  `row.set`). For a provider with no facts entry, the base's own watch-only `session.reading` was found by
  `readingsOf`, in the row by `saying` (its detail's `note`), and in the page by `stating`: a reading does reach
  the three places `mode.test.ts` reads, through the helpers it reads them with.
- **#55's AC2 test on this base**, alone: it fails at "has one verdict, FAIL" with `BLOCKED`, as this suite's test
  did before the change above.
- **The real daemon.** `real.test.ts` on paseo 0.15.0, eight times, the run made for this job among them: 5 to 8 s
  in six of them, 14 and 22 s in the two at a load past 55. Each read the same. In Copilot's asking mode the
  scripted agent's call asked and paseo fired `agent.create.after`, `agent.turn.before`, `agent.permission.before`,
  `agent.permission.after` (after `paseo permit allow`) and `agent.turn.after`. In `allow-all` the agent's log reads
  `allow_all: on`, `asked: false`, `ran: true`, the command's file exists, and paseo fired `agent.create.after`,
  `agent.turn.before` and `agent.turn.after`: **no `agent.permission.before`**. The snapshot at the turn's start read
  `currentModeId` and `runtimeInfo.modeId` `allow-all` (Agent's ID in the asking mode), and `paseo inspect` read
  `"Mode": "allow-all"`. With DeepBuild's base plugin installed beside the observer (a probe, not a test), the plugin
  sent `agent.turn.before` and `agent.turn.after` for that turn and nothing between.
- **Its BLOCKED readings.** With `DEEP_PASEO_CLI` unset, naming no file, and naming a script that prints `0.14.9`,
  the test read `BLOCKED: no real paseo …` twice and `BLOCKED: DEEP_PASEO_CLI is paseo 0.14.9; the facts pin 0.15.0`.
- **The recorded run's reader.** `run.ts` in a throwaway copy beside nine corpus sets: none, a whole one, one with
  `agent.permission.before`, two sessions, no turn end, no payload, no `Mode`, another scenario's `session.json`, and
  files that aren't JSON. `needRun` passed only the whole one, read "isn't to be built" for the one that fired, and
  BLOCKED naming the fault for the rest.
- **The base plugin in #55's stand-in**, with a socket where it finds the hub (a probe): for a Copilot fake in
  `allow-all`, twice, then in Agent, it sent `agent.turn.before` with `turn_id` and no mode each time, and called
  `refresh` once for all three turns. It keeps the session ID from the first, so reading the mode at each turn's
  start means reading the snapshot again.
- `tsc -p tests/acceptance/3429/tsconfig.json` exits 0. The studied-names check prints nothing. The lint lane's own
  rules for a new suite (no fixed wait, timers marked `// deadline:`, no home path or key shape, 1,500 lines a file)
  were read over the folder by a scratch script; the lanes themselves were not run.

How long it takes, on the base: 226 to 262 s for the whole suite. `mode.test.ts` is 184 to 196 s of that, three
tests waiting out their 60 s bound for a reading the base never records; the false done is 14 to 17 s, the Claude
Code test 21 to 24 s (its 20 s bound), and the real daemon 6 to 22 s.

Never run:

- **Any implementation, guess or twin.** None exists, and this job wrote no guess at the change. So no test of
  criteria 2 to 6 has been seen to pass, none has been seen to fail on its twin, and every assertion of
  `mode.test.ts` after each test's first has never been evaluated on a record that holds a mode reading: the
  reading's words, the row's line and its one-line form, the page, the second turn, the switch to Agent and the
  switch back.
- **`#3429.0888aab7` on a program that gives the Claude Code session a reading.** On the base the plugin's line for
  a session deep-hook gates is relayed and recorded nowhere, so the test's 20 s wait for an unwanted reading has only
  been seen to run out.
- **A shorter bound.** Whether 30 s would do for the 60 s bounds was not tried on a run.
- **The lanes.** `scripts/affected.mjs`, `scripts/proof.mjs`, `scripts/lanes.mjs` and the preflight were not run, by
  this job's brief; the lint lane's rules for a new suite were read over the folder by a scratch script instead.
