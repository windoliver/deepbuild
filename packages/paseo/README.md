# @deepbuild/paseo

## What it is for

DeepBuild's paseo plugin (#55), loaded by paseo's daemon: every agent paseo opens gets DeepBuild's MCP server (`deep mcp`, launch-only, so nothing stays in paseo's saved configuration), and each turn's end and permission request goes to the hub as a hook request keyed by the agent's own session ID. A session deep-hook or the pi package bound first is only relayed. It sends the hub's send-back as the session's next prompt once the agent reads idle, and answers a permission request in paseo with the hub's decision. It never decides anything.

## Where new code goes

- `index.server.ts`: the entry paseo loads; nothing else.
- `server/plugin.ts`: the hooks, the order they reach the hub in, and placing words in a session.
- `server/hub.ts`: the hub's socket: one hook request per connection, one long wait per session for its answers.
- `server/plant.ts`: the one place the #55 tests' wrong programs are read; acceptance tests live in `tests/acceptance/55` and are never edited.

## What it may import

A plugin paseo installs alone: at run time only `node:` built-ins and its own `server/` modules, imported with `.ts` extensions and erasable syntax, since paseo runs the TypeScript as it is. It never imports `@getpaseo/*` at run time, the hub, the CLI or a core package; it reaches the hub over its socket.

## Deviations

- `package.json`: not private, no dependencies, and no `dist`: paseo's daemon loads `index.server.ts` and `server/` from the published package.
- `server/plant.ts`: `DEEP_PASEO_PLANT` selects the wrong programs the #55 tests plant; only tests set it.
