# @deepbuild/reading

## What it is for

Reading by reference (#63): when DeepBuild needs free text read, your own agent gets handles through the runner and reads them a slice at a time, answering only with findings that cite a handle and the exact quote; each quote is checked before the install writes what is kept to the wiki. The hub and the CLI's `deep read` and `deep find` call it.

## Where new code goes

- `src/index.ts`: the reading job and its checks; `src/slices.ts`: slices of what a handle names, the one reader of handles.
- `src/claims.ts`: claim IDs; `src/plan.ts`: plan usage between window readings; `src/tools.mts`: the job's MCP reading tools.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/63` and are never edited.

## What it may import

Hub-side: `@deepbuild/contracts`, `evidence`, `record`, `runner`, `wiki` and `node:` built-ins, through public entries; a `session:` handle resolves through the record, never an agent's or extension's folder. It never imports the hub, CLI or app.

## Deviations

- `src/tools.mts`: an `.mts` among `.ts` that imports only Node's own modules, so a reading job is granted Node and this file and nothing of the record, and Node runs the built `.mjs` with no package.json.
- `test`: several tests import `tests/acceptance/63`'s world by relative path, to run on the real runner, record and fake agent of that suite.
