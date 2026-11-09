# @deepbuild/runner

## What it is for

DeepBuild's own headless jobs on your agent, apart from your sessions (#159): the drafting job, wiki reads, reading by reference, the review check's second model and an agent's smoke test. Each job is recorded before it starts and every process of it starts through the supervisor's `host@1`, in the platform sandbox. The hub and `@deepbuild/reading` call it.

## Where new code goes

- `src/runner.ts`: jobs, checkouts, plan windows, budgets and launch; `src/types.ts`: the public shapes.
- `src/agents.ts`: each agent's launch policy (confinement, sign-in, model hosts, version parsing and window readings). Add agent-specific launch behavior here, not to job lifecycle code; it starts no processes and imports no runtime core packages. Result-stream handling still lives in `src/runner.ts`.
- A process or process group's liveness comes from the supervisor (`alive`, `groupMembers`, `groupCpu`), never a `ps` of the runner's own.
- `src/egress.ts`: the job's only way out of its sandbox, a CONNECT tunnel to the hosts its agent names.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/159` and are never edited.

## What it may import

Hub-side core: only `@deepbuild/asks`, `budget`, `contracts`, `record`, `supervisor` and `node:` built-ins, through public entries. It never imports `@deepbuild/reading` (which stands on it), the hub, the CLI or the app.

## Deviations

- `src/types.ts`: the `plant` option names planted wrong programs the acceptance tests select (tests only), so each test is shown to fail on a wrong program (AGENTS.md, Proof).
