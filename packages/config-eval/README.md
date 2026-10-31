# @deepbuild/config-eval

## What it is for

Configuration evals (#112). A change to instruction files, skills, hooks, guards or policy is replayed on real past tasks from the transcript archive, once with the base's files and once with the change's, each repeat graded blind by a judge of another model family and compared by the record's one comparison rule under a plan frozen before either side runs. `scripts/config-eval.mjs` and the learned layer call `runEval`.

## Where new code goes

- `src/index.ts`: the eval (`runEval`) and its shapes.
- `src/archive.ts`: reading real past tasks from the archive (`archivedTasks`).
- `src/launcher.ts`: the default launcher, the real agents and judge on your plan, headless as the adapters' facts launch them.
- Tests: `test/`, against fake `claude` and `codex` executables; the acceptance suite and the live run are in `tests/acceptance/112/`.

## What it may import

Extension layer. It reaches `@deepbuild/record` through its package entry (and `@deepbuild/evidence` in tests only), plus `node:` built-ins. It never imports the hub, the CLI or the app. It runs on your machine or in a lane you dispatch, never in hosted CI on push.

## Deviations

None.
