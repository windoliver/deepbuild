# @deepbuild/adapters

## What it is for

The adapter contract (#312): one adapter per agent, driven by its facts file (adapter.facts@1), held to the published shapes at registration, and a registry that maps a hook request through the adapter its agent names. The hub, the archive, the extension host and the conformance kits read agents through it.

## Where new code goes

- `src/types.ts`: the shapes an adapter gives and takes, shared by the registry and the shipped parts so neither imports the other.
- `src/index.ts`: the registry, `factsAdapter`, `shipped()` and facts drift. No rule here reads an agent's name.
- `src/shipped.ts`: the parts of a shipped adapter that aren't data (caps, unsupported operations, doctor items, usage reading). The mapping itself belongs in the agent's facts file in the repo's top-level `adapters/` folder, not here.
- Tests: none in this package; the adapter contract is proven in `tests/acceptance/312/`, `tests/acceptance/18/` and the conformance package's adapter kit.

## What it may import

Core layer. It stands on `@deepbuild/contracts` only, through its package entry, plus `node:` built-ins and the facts engine noted below. It never imports the hub, the CLI, the app or any extension.

## Deviations

- `src/index.ts`: imports `mapHook` from `../../../adapters/index.mjs` by relative path. The facts engine and the facts files live in the repo's top-level `adapters/` folder, which is not a workspace package and is also run by `scripts/corpus.mjs` and the CLI, so there is no package entry to go through (commit 179441ca).
