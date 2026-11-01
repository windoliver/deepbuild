# @deepbuild/cli

## What it is for

The `deep` command (the root package's `bin`). It prints help and the banner, runs `deep run` and `deep debug bundle` itself, and hands every hub command (hub, setup, status, inbox, env, doctor and the rest) to `@deepbuild/hub`, and `deep find` and `deep read` to `@deepbuild/reading`. You and scripts call it.

## Where new code goes

- `src/main.ts`: argument dispatch and the few commands with no hub. A new hub command's logic goes in `@deepbuild/hub`; here it gets only its dispatch line.
- Tests: `test/` for the command's own output; command behavior is proven in the acceptance suites of the issues that add it (for example `tests/acceptance/19/`).

## What it may import

Top layer. It may reach any workspace package through its package entry, including the hub; nothing in the core imports it. It also reads the repo's top-level `adapters/index.mjs` (see Deviations).

## Deviations

- `src/main.ts`: loads `@deepbuild/conformance`, `@deepbuild/contracts`, the hub, otlp, evidence and reading with `await import(...)` inside the commands that use them, so `deep inbox` starts without them (#24's startup budget); keep new heavy imports lazy. It imports `replaySession` from `../../../adapters/index.mjs` by relative path because the facts engine lives in the repo's top-level `adapters/` folder, not in a workspace package.
