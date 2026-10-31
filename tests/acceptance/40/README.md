# Acceptance tests for #40: pi package (in-process client, native tools, sendUserMessage delivery)

Written blind, from the issue, `docs/technical-design.md` and base commit `244a3455`. Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

## Run

```
DEEP_PI_CLI=<dir>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/40/
```

Keep the trailing slash: without it vitest also runs suites 400 to 409.

Node 24, `npm ci` and `npm run build --workspaces` first. Install pi anywhere with `npm i @earendil-works/pi-coding-agent@1.4.0`. A missing `DEEP_PI_CLI`, or a pi of another version, fails with `BLOCKED: ...` and never skips. Tests that need real pi first check it, so with no pi they read BLOCKED rather than naming a missing package. The tests use a scratch `HOME` and `PI_CODING_AGENT_DIR` under `/tmp/dh40-*`.

No account: the model is `fixtures/scripted-provider.ts`, a local pi provider following a file of steps. `npm` is reached through a local stub registry. Both are boundaries the repo doesn't own. Everything else is real: pi, its RPC mode, `pi install`, the hub (`deep hub run`), `deep inbox answer`, `scripts/corpus.mjs`, `mapHook`, `openRunner`.

## Criteria

| ID | Criterion | Tests |
|----|-----------|-------|
| `#40.bb9b6512` AC1 | An idle pi session starts a turn with the answer | `delivery.test.ts` |
| `#40.d992de05` AC2 | A busy session gets it after its current tool calls | `delivery.test.ts` |
| `#40.8dc59e9e` AC3 | The runner starts a pi job from its facts; usage and stop cause recorded | `runner.test.ts` |
| `#40.5fd13825` AC4 | Handled prompt, recoverable end, replaced session, incomplete nested record | `delivery.test.ts` |
| `#40.9680351d` AC5 | The in-process client adds under 1 ms per event to pi, reference Mac, against the merge base | `budgets.test.ts` |
| `#40.c666bc59` AC6 | Installs with `pi install`, pinned to a version | `install.test.ts` |
| `#40.0a086a33` AC7 | pi's edit records as an edit with the same paths as Claude Code's Edit; a write mapping fails, naming the call | `mapping.test.ts` |
| `#40.c6c858c2` AC8 | The corpus holds a recorded case for each of the four | `mapping.test.ts` |
| `#40.249583fd` AC9 | Scripted RPC sessions reproduce the four cases; the adapter maps each as its facts say | `mapping.test.ts` |

## The surface (my choice)

The issue and the design name pi, RPC mode, `pi.sendUserMessage`, `pi install`, the events, `pi --mode json -p`, the facts and the corpus, not these paths. An implementation must provide exactly these.

**The package.** `packages/pi/`, npm name `@deepbuild/pi`:

- `package.json`: an exact `x.y.z` version, not private, keyword `pi-package`, `pi.extensions` non-empty, no `@deepbuild/*` dependency (`npm pack` must yield something that runs alone), pi's host packages (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`) not in `dependencies`.
- `pi -e packages/pi` loads it, with whatever build it needs already done by `npm run build --workspaces`.
- It finds the hub as the other clients do: `<HOME>/.deepbuild/hub.sock` unless the `hub.address` setting says otherwise. No new environment variable.
- It registers one native tool per key of `packages/hub/tools.json`, same name and description, and answers them over the hub socket.

**Hook lines.** It sends the hub's `hook.request` lines with `agent: 'pi'` and `event` the pi event name; the hub accepts `pi` in its adapters. Payload fields: `hook_event_name` (pi's event name), `session_id`, `cwd`, then:

| Event | Fields |
|-------|--------|
| `session_start` | `source` (pi's reason, such as `startup`, `new`), `parent` (the previous session's ID, when there was one) |
| `input` | `text`, `source`, `disposition: 'handled'` when an extension loaded after the package consumed it (Disputes D1) |
| `tool_call` | `tool_name`, `tool_input`, `tool_use_id`, `parent_tool_use_id` when nested |
| `tool_result` | `tool_name`, `tool_use_id`, the outcome, `nested_calls` as pi wrote them |
| `agent_start`, `agent_end`, `agent_settled` | none needed |
| `agent_before_settle` | `outcome` |

**Facts.** `adapters/pi.facts.json`, a frozen version of `adapter.facts` they validate against (Disputes D2), `agent: 'pi'`, `versions` holding `1.4.0`:

- `mapping`: `session_start` to `session.start` (`session`, `source`, `parent`); `input` to `user.ask` (`disposition` when handled); `agent_start`, `agent_end`, `agent_settled` to `session.activity` (`session`, `activity` the pi event name); `agent_before_settle` to `agent.stop` (`outcome`: `finished`, `failed` for an aborted or failed run; `did_work`); `tool_call` to `tool.before` (`call`, `kind`, `paths`); `tool_result` to `tool.after` (`call`, `tool`, `outcome`, `nested` with `complete` as pi wrote it).
- `toolKinds.tools`: `edit: 'edit'`, `write: 'write'`, others as they are. Relative `tool_input.path` resolves against `cwd`.
- `continuation.hook: 'agent_before_settle'`: the only hook that may continue a run.
- `launch.readOnlyJob`: `prompt: 'stdin'`; `args` holding `--mode json`, `-p`, `--tools <subset of read,grep,find,ls>`, `--no-extensions`, `--no-approve`.
- `errorTexts`: a `401` or authentication text gives cause `sign_in_required`, a `429` or rate-limit text `rate_limited`; what they don't name is `unknown`.
- `install.source`: `npm:@deepbuild/pi@<the package's exact version>`.

**The corpus.** `adapters/corpus/pi/1.4.0/<session>/`, with `session.json` (`corpus.session@1`, agent `pi`, `surface: 'rpc'`), `events.jsonl`, and `transcript.jsonl` (pi's session file, header first). Each line has `payload`, `expect`, `source`, `reviewed`. Four lines carry `tag`:

- `prompt-handled`: an `input` with `disposition: 'handled'`; expects `user.ask` with that disposition; no `agent_start` before the next input.
- `two-starts-one-settle`: the session's order holds `agent_start, agent_end, agent_start, agent_end, agent_before_settle, agent_settled`; only the pre-settle event expects `agent.stop`.
- `replaced-session-answer`: a `session_start` with `source: 'new'`; the line also has `pending: { ask: 'ask:<id>', session: <old>, outcome: 'replaced' }`; expects `session.start` with `parent` equal to `pending.session`.
- `nested-incomplete`: a `tool_result` with `nested_calls.complete: false`; expects `tool.after` with `nested.complete: false`. Its transcript holds pi's `nestedCalls.complete: false`.

The set also records one `edit` call, so replay holds the edit mapping. `node scripts/corpus.mjs replay` and `check` read it; each pi line's result is `match`.

**Delivery.** `deep inbox answer` on an ask raised by the native `deep_ask` reaches the session through `pi.sendUserMessage`. One `delivery.outcome@1` per answer (`delivery: 'ask:<id>'`, under the existing closed values):

- idle: `delivered`, a new turn;
- busy: `delivered` `via` `steer` or `next_prompt`, after the running calls' results; both calls run to their end;
- handled by an extension: one outcome with no `agent_start`, not offered again;
- during a recoverable end: nothing is sent until the run settles or retries, so no request starts before pi's own 2 s retry, and the answer arrives once;
- bound to a replaced session: `outcome: 'replaced'`; never sent into the replacement.

**The runner.** `JobSpec.agent: 'pi'`. The runner finds `pi` on the login PATH, launches from `launch.readOnlyJob`, reads `--mode json` output: `session` from its `session` line, `model`, `usage` summed over messages (`input`, `cached` from `cacheRead`, `output`), `result` as the final assistant text, `stop.cause` from the facts' error texts. A pi job doesn't wait on a plan window (none in pi's facts). `grant.read` in the tests covers pi's install, node, the fixtures and the temp folder; the wrapper on the login PATH sets its own environment because the runner's is allowlisted. Sandboxed real pi on this path hasn't been run against an implementation; a real sandbox obstacle goes to a dispute.

**The budget.** `benchmarks/pi-client.mjs` exits 0 on real pi from `DEEP_PI_CLI`. `benchmarks/budgets.json` has a task whose `command` includes it and whose `initialReason` names `#40`; `validateBudgets` accepts it against the merge base.

**Plants.** `DEEP_PI_PLANT`, read by the package and the hub, set by the wrong-program tests only:

| Value | The wrong program |
|-------|-------------------|
| `waits-for-agent-start` | a delivery outcome waits for `agent_start` |
| `continues-on-end` | an answer goes in at a recoverable `agent_end` |
| `accepts-replaced` | an answer bound to an old generation is delivered |
| `drops-incomplete` | normalization loses `complete: false` |

The plant is compiled in the same code paths and does nothing unset. This follows `plant` on the runner's options and earlier suites' `DEEP_*` plants; a shipped build ignores it only if the implementation can show so.

## Wrong programs

| AC | Wrong program | What catches it |
|----|---------------|-----------------|
| AC4 | a handled prompt waits on `agent_start` | `DEEP_PI_PLANT=waits-for-agent-start` |
| AC4 | competing continuation on a recoverable end | `DEEP_PI_PLANT=continues-on-end` |
| AC4 | answer accepted for a replaced generation | `DEEP_PI_PLANT=accepts-replaced` |
| AC4 | incomplete nested record normalized away | `DEEP_PI_PLANT=drops-incomplete` |
| AC7 | edit mapped as write | facts copy with `toolKinds.tools.edit = 'write'`; the error names the call |
| AC8 | settled or `agent_end` treated as a result; edit as write | planted facts through `scripts/corpus.mjs replay --facts` |
| AC6 | a floating source | the same install unpinned writes something else |
| AC1, AC2, AC3 | no package, no facts | base (see `BASE-FAILURE.txt`) |

## Timing

AC5 follows the existing rule (`tests/acceptance/159`): off a reference Mac in a fit state the number is printed and the test is skipped as `INCONCLUSIVE`, with the reason, never passed. On one: every pair within 1 ms passes, every pair over by the margin fails, otherwise `INCONCLUSIVE`.

## Disputes

Decided on the issue, the design, base and real pi 1.4.0. The redraft below hasn't been run: the implementation is absent, and this job was told not to run the suite.

**D1, upheld in part.** `AC9 a prompt handled without a run` expects the package to record `prompt:handled`, and it loaded after the extension that consumes the prompt. In pi 1.4.0, `emitInput` (`dist/core/extensions/runner.js`) returns at the first handler answering `handled`, in load order, so the package was never called, and the only other report of the disposition is the RPC response to the client. No in-process package could pass. The package now loads ahead of the fixture by default. `AC4`'s handled scenario keeps the old order, through `handlerAhead`: it needs only one outcome for an answer the package itself sent, nothing about the input event, and pi really has this order, since it merges `-e` paths ahead of installed packages. Moving it would drop that coverage. A handled prompt from an extension ahead of the package stays unrecorded by the package; no test asks otherwise.

**D2, upheld.** `adapter.facts@1` is frozen in `packages/contracts/digests.json`, with `additionalProperties: false` at the top level, on `mapping` (Claude Code's and Codex's hooks only) and on `continuation` (no `hook`), and no `install`. pi's facts, which this suite requires to hold `mapping.agent_before_settle`, `continuation.hook` and `install.source`, can't validate against it, and the expected value contradicted the suite. The test now takes `adapter.facts@<n>`, requires that version in the frozen digests and requires the facts to validate against it through the real `validate`. That is stricter than before: no version was validated. The expected fields are unchanged.

**D3, upheld.** `askStep` raises a `taste` ask with no deadline or default, so base's `fill` (`packages/asks/src/index.ts`) refuses it `BLOCKED`, and every delivery test would time out at `askCreated`. The refusal is right: a value nobody declared stays `BLOCKED`. The world was missing what a person has. `tests/acceptance/19/authority` gets there by running `deep setup`, which drafts `asks` into `<root>/config.json`. `startHub` now writes the same setting with setup's values (`taste: '3d'`, `recommended`), and only those: no `batch`, so an ask shows when raised. It doesn't run `deep setup`, which would also install Claude Code hooks into the scratch home, and then `deep_ask`'s wait would depend on Claude Code's tool timeout. The native `deep_ask` stays.

## How far these tests were checked

Run on real pi 1.4.0 and the real hub: the fixtures, the RPC driver, pi's own `complete: false` marks, the hub client, a Claude Code Edit hook recorded through the socket, and the facts' job command line by hand. `install.test.ts` passed in a throwaway copy against a stub package that only registers the tools. Never run against a real implementation, because none exists: the delivery, lifecycle, runner-job and budget scenarios, and the plants. On base all 43 tests fail; see `BASE-FAILURE.txt`.
