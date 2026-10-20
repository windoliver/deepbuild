# Build one variant of the hub-core slice (#56)

This is the one prompt both builds of issue #56 were written from. Each agent got this text with one line before it, `Variant: plain` or `Variant: effect`, and the checkout's absolute path filled in below; nothing else differed.

## The task

DeepBuild is deciding whether its hub core uses Effect 4 or plain TypeScript. You build one variant of the same slice: 50 sessions holding hooks with a 2-second timeout, flaky checks retried three times, leases from a pool of 10 ports, child processes that spawn grandchildren, random cancels, one extension that ignores its abort signal, and hold and release over a Unix socket.

The repo is the current directory (<the checkout's absolute path>). Read these first:

- `AGENTS.md`, the repo's rules.
- `tests/acceptance/56/README.md`, the surface you build to: the hub's flags, the socket protocol, what a hold does, the extension API, and the stats. It is the spec. Where this prompt and the README differ, the README wins.
- `tests/acceptance/56/*.test.mjs`, `helpers.mjs` and `fixtures/`, the tests your build must pass.
- In `docs/technical-design.md`: the hook protocol, Lease, and the process ownership line under Platforms, for how the real hub will do this.
- `spikes/hub-core/hub.mjs`, `bench.mjs`, `typecheck.mjs`, `package.json`, `tsconfig.base.json` and your variant's `tsconfig.json`.

## What you write

Only files under `spikes/hub-core/<variant>/`, as `.ts` sources. `spikes/hub-core/hub.mjs` imports `./<variant>/main.ts` and calls `main(args)`, where `args` is the command line without `--variant` and its value. `main` returns a `Promise<void>` and runs the hub until it's told to stop.

The sources run directly under Node's type stripping, with no build step:

- erasable syntax only: no enums, namespaces or parameter properties;
- relative imports name the `.ts` file;
- types come in with `import type`;
- no new dependencies, and no edits to the shared files or the tests.

### Plain variant

Use plain TypeScript on Node's built-ins only.

- Cancellation is a tree of AbortControllers: hub, session, hold, attempt. Aborting a node aborts everything under it.
- Process cleanup goes through a PID ledger kept in `<state>`.

### Effect variant

Use Effect 4 (`effect` 4.0.5, already installed in `spikes/hub-core/node_modules`).

- Write it the way Effect intends: scopes and finalizers for cleanup, fiber interruption for cancel and timeout, `Clock` for time (a virtual clock that `tick` drives), a `Semaphore`, `Queue` or `Pool` for the leases, `Schedule` for retries, typed errors, and `Effect.fn` or spans where they help traces.
- Effect 4 renamed and moved much of v3, so don't write from memory. Read `spikes/hub-core/node_modules/effect/AGENTS.md`, its `ai-docs/` and its `src/` for the v4 names. The `.d.ts` files under `dist/` show the exact signatures.
- Extensions stay plain TypeScript, Promises with an AbortSignal, as the design says. Your Effect code calls them through that boundary.
- A `kill -9` leaves no runtime to clean up. The Effect build still keeps a ledger in `<state>`, so a restarted hub can stop what the killed one started.

## Rules both variants follow

- **Process groups.** Each attempt runs in a process group of its own (`detached: true`), and everything in the group is stopped with SIGKILL before the next attempt starts and before the lease goes back. The check and its grandchildren ignore SIGTERM, so SIGTERM alone won't do.
- **Waiting.** Wait until the group is really gone before you free its port.
- **Killing.** Never kill by name, command line or port. Stop only groups this hub, or the killed hub before it, recorded. Prove each one is still yours by PID and start time, or by the group the ledger recorded still holding processes. The tests run a decoy of the same fixture that must survive.
- **Extensions.** Call `onHold(hold, signal)` without awaiting it. Abort the signal when the hold ends. Never let a pending extension promise or its timers keep a hold, a lease or the hub's exit waiting. On SIGTERM, stop everything you started and exit within 5 s.
- **Errors.** A check that can't start (spawn fails) comes back `blocked`. Its `error.message` or `error.stack` must name a `.ts` file of your build and a line in it, so wrap Node's error in one your code creates where it handles the failure. Node's own `spawn ENOENT` stack alone fails the test.
- **Stats.**
  - `rssBytes` is `process.memoryUsage().rss`.
  - `maxRssBytes` is `process.resourceUsage().maxRSS * 1024`.
  - `handles` is `process.getActiveResourcesInfo().length`.
- **Size.** Keep it small and readable. A maintainer reviews both builds and times the review, so clarity counts. Comment where the reason isn't obvious, and nowhere else.

## How you check your work

Run your variant's live tests from the repo root:

```
node --test --test-concurrency=1 --test-name-pattern '\[<variant>\]' tests/acceptance/56/processes.test.mjs tests/acceptance/56/leases.test.mjs tests/acceptance/56/timeouts.test.mjs
node --test --test-concurrency=1 --test-name-pattern '\[<variant>\] a failure inside' tests/acceptance/56/typecheck.test.mjs
node spikes/hub-core/bench.mjs --variant <variant>
```

Another agent may be running the other variant's tests on this machine at the same time. A timing failure can come from that load, so read the failure before you change code for it.

**Don't typecheck while you work.** That means no `tsc`, no `typecheck.mjs`, no TypeScript compiler API and no Effect language service. The spike measures how well an agent writes typed code on its own:

- When you're done, the maintainer runs `node spikes/hub-core/typecheck.mjs --variant <variant>` and sends you its diagnostics.
- Each send-back is one round of fixes. The criterion allows two.

## When you're done

Report:

- the files you wrote and their line counts;
- the output of the commands above (the pass/fail summary lines);
- anything in the README you couldn't meet, or read differently.

Don't commit.
