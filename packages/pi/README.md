# @deepbuild/pi

## What it is for

DeepBuild's pi package (#40), loaded in-process by pi: it sends pi's session and tool events to the hub as hook requests, offers the `deep_*` tools as native pi tools over the hub's socket, and delivers the hub's answers through `pi.sendUserMessage`. It never decides anything.

## Where new code goes

- `src/index.ts`: the whole extension: event forwarding, tools and answer delivery.
- `tools.mjs`: the build step that writes `dist/tools.json`; never hand-edit the output.
- Regression tests go in `test/` and run only with `DEEP_PI_CLI` set; acceptance tests live in `tests/acceptance/40` and are never edited.

## What it may import

An adapter-side package pi loads on its own: at run time only `node:` built-ins, reaching the hub over its socket, never through a workspace import. It never imports the hub, CLI, app or a core package.

## Deviations

- `package.json`: not private and with no workspace dependencies, since it is the published package pi installs (`pi.extensions`, `files: dist`).
- `tools.mjs`: reads `../hub/dist/tools.js` at build time so the published package carries the tool list and needs nothing of the workspace.
- `src/index.ts`: `DEEP_PI_PLANT` selects the wrong programs the #40 tests plant; only tests set it.
