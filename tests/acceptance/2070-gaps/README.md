# Gap tests for #2070: past the criteria, inside the Scope

Written by #2070's implementer, not the blind job, for two parts of the change that `tests/acceptance/2070/` doesn't
reach. Each was shown to fail on a wrong program before it was committed.

| Test | Scope line it holds | Wrong program it fails on |
|---|---|---|
| a process outside a shared agent's tree that names it as its parent can't spend a PreToolUse stamped for that agent's call | "After the change, a process outside a session's own agent process tree can't act as that session over deep mcp", on the per-call route a shared process takes | the merge base's rule, the parent from the hello: mutant `conn.parent = proved` in server.ts files the claim under the session and fails, naming it |
| a session's agent process saying hello as mcp itself, as the pi package does inside pi, binds to its own session | the pi package's binding kept: its peer is the agent process, not a child of it | mutant without the agent-itself branch in `mcpHello` binds it to none and fails, naming the session |

## Run

```sh
npm ci && npm run build --workspaces
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  cargo build --locked -q -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2070-gaps --no-file-parallelism --testTimeout=600000
```

They reuse #26's agent stand-in and hub helpers and `tests/acceptance/2070/`'s process fixture, unchanged. Real pi isn't
used: on this Mac #40's native deep_ask test times out with or without the change, so the pi package's shape (lines and
hello from the agent's own process) is held here instead.
