# @deepbuild/runner

## What it is for

DeepBuild's own headless jobs on your agent, apart from your sessions (#159): the drafting job, wiki reads, reading by reference, the review check's second model, an agent's smoke test, and the blind acceptance job (#1328). The acceptance job is the one kind that writes. It writes only `tests/acceptance/<issue>/` in its checkout of the base, and its record lists exactly its inputs. Only Claude Code has a writing launch so far. Each job is recorded before it starts and every process of it starts through the supervisor's `host@1`, in the platform sandbox. The hub and `@deepbuild/reading` call it.

## Where new code goes

- `src/runner.ts`: jobs, checkouts, plan windows, budgets and launch; `src/types.ts`: the public shapes. An `eval` job (#2077) takes a trusted evaluator as `submit`'s second argument, never an RPC value: one job owns the paired replay, rechecks each model's reserve and cancels its launcher. An agent prompt alone cannot create one.
- `src/agents.ts`: each agent's launch policy (confinement, sign-in, model hosts, version parsing and window readings). Add agent-specific launch behavior here, not to job lifecycle code; it starts no processes and imports no runtime core packages. Result-stream handling still lives in `src/runner.ts`.
- A process or process group's liveness comes from the supervisor (`alive`, `groupMembers`, `groupCpu`), never a `ps` of the runner's own. Eval cancellation also cleans a held start, and sends no cancelled prompt. Final results trigger cleanup after the ordinary grace; a deadline is a refusal, and unconfirmed cleanup stays `stopping`. A failed cleanup or rejected window report aborts the evaluator's signal before its process call settles, so catching a failed sample cannot pass a signal-guarded application. Outstanding cleanup never permits success.
- `src/egress.ts`: the job's only way out of its sandbox, a CONNECT tunnel to the hosts its agent names.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/159` and are never edited.

## What it may import

Hub-side core: only `@deepbuild/adapters` (`readFacts`, each agent's facts), `asks`, `budget`, `contracts`, `record`, `supervisor` and `node:` built-ins, through public entries. It never imports `@deepbuild/reading` (which stands on it), the hub, the CLI or the app.

## Deviations

- `src/runner.ts`: configuration-eval orchestration runs in the hub. Its replay launcher supplies the recording sandbox's grant to the supervisor; probe/judge use isolated config homes, with no user hooks/settings copied and no writes to the user's sign-in. Each process reuses the version, reserve, budget and token-lifetime gates. Replay argv comes from the trusted evaluator, never RPC; `execute` and `read` check the gated agent's executable identity before launch and again before the supervisor writes the prompt, including after a held start. Five-hour and weekly readings feed the reserve gate; a first-reading exemption counts once per account per composite job. Billing keys go only to gated subprocesses, not the evaluator callback. Reported process costs are summed; any unpriced process leaves the reservation held. No eval extension is imported into the runner.
- Eval child runs are recorded by the supervisor, not as extra runner jobs. Graceful close cancels and reaps them; on restart the supervisor reaps interrupted runs and the runner reports the composite lost, never reruns it or reports success. Child run IDs are not durably linked to the composite, so an unconfirmed crash cleanup cannot currently keep that lost composite in `stopping`. A trusted evaluator must await its process calls and cooperate with cancellation.
- `src/types.ts`: the `plant` option names planted wrong programs the acceptance tests select (tests only), so each test is shown to fail on a wrong program (AGENTS.md, Proof).
