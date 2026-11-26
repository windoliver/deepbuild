# Acceptance tests for #3430: a turn stopped in paseo isn't a failed turn

Written blind, from the issue, `docs/technical-design.md` and base commit `1b4929ae7977aa4bfe62b03e0ef39674be9e8a27`
(origin/main, November 24, 2026). Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: issue #3430 (its bullets, Scope, four criteria, Proof, References) as of November 24, 2026; in the
design, "What each agent gives us, and the limits we design around" (the paseo row), "Hooks are evidence, not a state
machine" (Facts as data), "States people see" and Dogfooding; `AGENTS.md`; the suites `tests/acceptance/55` (its
README, `helpers.ts`, `gate.test.ts`, `fixtures/paseo-host.mjs`) and `tests/acceptance/3433` for the format; at base,
`packages/paseo/server/plugin.ts`, `adapters/paseo.facts.json`, `adapters/index.mjs`, `packages/hub/src/hookmap.ts`,
`session-state.ts` and `status.ts`; and paseo's `PluginTurnOutcome` and `agent.turn.after` payload at v0.15.0
(`packages/plugin/src/server/lifecycle.ts`, the issue's reference): `{kind: "completed"}`,
`{kind: "failed", error: {message, code?}}`, `{kind: "canceled", reason}`.

## Run

```sh
npm ci && npm run build --workspaces        # the hub and CLI the tests run are the built ones
cargo build --locked -q -p deep-hook        # the hub refuses to start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3430 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3430/tsconfig.json
```

Node 24 (type stripping on). With `--root` here Vitest may write `tests/acceptance/3430/node_modules/.vite`; delete it
before committing. Every test starts its own hub and paseo stand-in under `/tmp/dh55-*` (#55's helpers), with `HOME`
there; the real `~/.deepbuild` and `~/.paseo` are never touched. `lane.json` runs the folder alone, as #55 runs.

## The world

#55's, reused through `../55/helpers.ts`: the real hub (`deep hub run`), the real plugin (`packages/paseo/index.server.ts`)
loaded by `../55/fixtures/paseo-host.mjs`, which stands in for paseo's daemon around a plugin, and a Copilot agent as a
recorded-shape fake (Copilot has no hooks of its own, so the plugin gates it). The test fires paseo's `agent.turn.after`
with the outcome shapes paseo 0.15.0 declares. No live paseo daemon runs: every criterion is about what the plugin sends
and how the hub reads it, and the issue says it runs on any machine. The agent works in #55's fixture repo (a trusted
repo with a `done.yaml` naming one check) and edits and commits the cart before the turn ends, so a gate that ran at the
turn's end would have work to judge.

## Criteria to tests

All in `canceled.test.ts`. IDs are the first 8 hex of SHA-256 of each criterion's text, trimmed, whitespace collapsed.

| Tag | Criterion | Test | What it requires | Wrong program it fails on |
|---|---|---|---|---|
| `#3430.98bfee96` | A Copilot session's turn canceled in the fixture paseo is recorded with no `agent.stop`, the gate doesn't run, and its row reads that its turn was interrupted. The merge base records a failed stop and fails this test, naming the stop | `a Copilot turn canceled in paseo …` | After `{kind: 'canceled', reason}`: no `agent.stop` of the session in `events.read`; within 15 s no `claim.made`, `check`, `verdict.made`, `stop.held` or `claim.sent_back` about it; its `status.read` row's `why` holds `its turn was interrupted` | `canceled-as-failed` (the merge base): fails at the first assertion, naming the `agent.stop` with outcome `failed` |
| `#3430.77661745` | A turn that failed with the error "rate limit" is still a failed stop whose cause reads `rate_limited`, and a completed turn is still a finished stop | `a turn that failed with the error "rate limit" …` and `a completed turn is still a finished stop` | `{kind: 'failed', error: {message: 'rate limit'}}` gives one `agent.stop` with `outcome: 'failed'`, `cause: 'rate_limited'`; `{kind: 'completed'}` gives one with `outcome: 'finished'` | `failed-as-canceled`, `completed-as-failed` |
| `#3430.920b7e03` | Your next prompt in that session clears the interrupted reading, as it does for any interrupted turn | `your next prompt in the session clears …` | The canceled turn's row reads interrupted; after paseo fires `agent.turn.before` for your next prompt, within 60 s the row's `why` no longer holds `its turn was interrupted` | `prompt-keeps-interrupt` |
| `#3430.5c4cf6e4` | An outcome the facts don't list marks the session unverified and names the outcome. A plugin that sends it as `failed` fails this test | `an outcome the facts don't list …` | After `{kind: 'timed_out'}`: an event about the session names `timed_out`, and the session has more unverified marks than before the turn ended (an event `events.read` gives `verified: false`, or a `session.reading` saying unverified) | `unlisted-as-failed` (the merge base) |

### On the merge base (`BASE-FAILURE.txt`)

Four tests fail at their assertions; `a completed turn is still a finished stop` passes, as a "still" criterion may.

- `#3430.98bfee96`: the record holds `agent.stop` with `outcome: "failed"`, `cause: "unknown"`, as the issue says.
- `#3430.77661745`, the rate-limit half: **fails on the base too.** The plugin sends `error: "rate limit"`, but the
  stop's cause reads `unknown`: `adapters/paseo.facts.json`'s `mapping` for `agent.turn.after` names no `cause`, so the
  facts' `errorTexts` never reach a paseo stop. The issue says "still"; the test asserts the issue's expected value, so
  the change has to make it hold. Flagged for the issue's owner (Open questions).
- `#3430.920b7e03`: fails at its first assertion (the row reads `flagged: its turn ended failed`, not interrupted).
- `#3430.5c4cf6e4`: nothing in the session's record names `timed_out`; every event of it is `verified: true`.

## Surfaces chosen

The issue names the plugin, the facts, the record's `agent.stop`, the gate and the session's row
(`packages/hub/src/status.ts:189-190`). The tests read them through:

- **paseo's hook**: `agent.turn.after` with `{agent, turnId, outcome, timeline}`, `outcome` paseo 0.15.0's
  `PluginTurnOutcome`. The canceled reason used is `Stopped from the paseo app`; the issue keeps whatever paseo sends.
- **The record**: `events.read` on a cli connection (#55's `events`), each event with its `verified` mark.
- **The row**: `status.read`, the rows `deep status` lists, matched by session ID; its `why` is the interrupted rule's
  `its turn was interrupted <age> ago`.
- **The gate**: the kinds it leaves in the record (`claim.made`, `check`, `verdict.made`, `stop.held`,
  `claim.sent_back`).

## Open questions

1. **"Still" rate_limited.** On the base a paseo stop's cause is always `unknown` (see above). Either the issue means
   the change also maps the error to a cause, or the criterion was read from source and is wrong about the base. This
   suite holds the issue's value.
2. **What "marks the session unverified" looks like.** The issue says "as a retyped field does"; on the base the live
   hub never uses the strict payload check's result (`hookmap.ts` reads only `.events` of `mapHook`), so there is no
   existing mark to copy. The test accepts either an event recorded `verified: false` or a `session.reading` saying
   unverified, and asks for more such marks after the turn ended than before.
3. **What "names the outcome" means.** The test accepts any event about the session whose data holds the kind paseo
   sent (`timed_out`), a reading or the stop's own data.
4. **What the row reads after your next prompt.** The issue says only that the interrupted reading clears; the test
   asserts that alone, not which state follows (working, for one).
5. **A claim made before the cancel.** Not tested: a `deep_claim` made during a canceled turn would make the row read
   `says done` (that rule sits above interrupted), and the issue doesn't say whether such a claim is judged. The
   canceled turn here makes no claim; "the gate doesn't run" is read from the record's gate kinds.
6. **The canceled reason.** Not asserted anywhere (the issue keeps it "as it came" and names no surface for it).
