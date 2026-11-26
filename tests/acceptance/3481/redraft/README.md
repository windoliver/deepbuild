# Blind redraft of #3481 AC1's test

AC1 `#3481.e99bba39`: "Against a real hub (`deep hub run`) with an app home whose `control.token` differs from the hub's,
`deep-app --hub-check` exits non-zero, prints no `hub ok`, and names the `credential` refusal in its output. On the merge
base it exits 0 with `hub ok`."

Written blind as the redraft of AC1's test, from issue #3481, the design section it links and base commit `1b4929ae7`,
by a job that saw no implementation of #3481 and no other draft of this test. The implementing agent does not edit
these files (AGENTS.md, Proof); a dispute goes to another blind redraft (design: Dogfooding). AC2 (the hub's own token
still reads `hub ok`) is not drafted here.

## What was read

- `.blind/issue-3481.md` (the issue's title and body) and `.blind/design-3481.md` (Socket roles and contract versions).
- `AGENTS.md`.
- At the base: `crates/deep-app/src/main.rs` (`--hub-check`), `crates/deep-app/src/hub.rs` (`root`, `address`,
  `hub.address` in config.json, `hello_app`, `HubError`), `crates/deep-app/src/record.rs` (`RecordReader::check`,
  `connect`); `packages/hub/src/server.ts` (the hello, `tokenMatches`, the `credential` refusal at `/token`,
  `writeToken`); `packages/hub/test/hub.ts` (`withHub`); `tests/acceptance/41/app/compat.test.ts`, `helpers.ts` and
  `base-run.txt`; `tests/acceptance/993/README.md`, `hub-check.test.ts` and `tsconfig.json`;
  `tests/acceptance/1018-redraft-1830/README.md` (redraft format); the list of `tests/acceptance/*` folders that run
  `deep-app`, for its platform gate.

## The setup

- **The hub** is the real one: the built CLI's `deep hub run`, started by `withHub` (`packages/hub/test/hub.ts`) with
  `HOME=/tmp/hub-315-*`. At launch it writes its control token to `<hub home>/.deepbuild/control.token` (mode 0600)
  and listens on `<hub home>/.deepbuild/hub.sock`.
- **The app home** is a second folder, `/tmp/da3481-*` (`helpers.ts`, `appHome`). Its `.deepbuild/control.token` holds a
  fresh random token (mode 0600), and its `.deepbuild/config.json` is `{"hub":{"address":"unix:<hub home>/.deepbuild/hub.sock"}}`.
- **The app** is `deep-app` as `cargo build --locked -p deep-app --bin deep-app` builds it from the checkout (through
  `scripts/lease`), copied to `target/acceptance-3481-redraft/deep-app`. It runs `--hub-check` with `HOME` the app home
  and no `DEEP_*`, `XDG_*`, `CLAUDE*`, `CODEX*`, `GIT_*`, `npm_` or API-key variable of the runner's.

**Which token the app presents, and why.** The app reads its hub address from `~/.deepbuild/config.json`'s
`hub.address` and its token from `~/.deepbuild/control.token` under its own `HOME` (`crates/deep-app/src/hub.rs`,
`root()`; `main.rs` passes `root().join("control.token")`). So it connects to the real hub's socket but presents the
app home's token, which the hub never wrote. That is the criterion's "app home whose `control.token` differs from the
hub's", and the hub refuses that hello with `credential` at `/token` (`server.ts`, `hello`). Pointing `hub.address` at
the hub, rather than putting the socket in the app home, keeps the hub's own token file out of the app's home.

Before running the app, the test checks its own setup: the hub answers a fresh connection to that socket with its
`deep-hub` hello, the hub wrote a non-empty token, and the app home's token differs from it. A setup that fails these
fails with its own message, never as the criterion.

## What it asserts

On `deep-app --hub-check` run as above:

1. it exits within 120 s, with an exit code;
2. the exit code is not 0;
3. neither stdout nor stderr contains `hub ok`;
4. stdout or stderr names the refusal's code, `credential` (as a word).

Each failure message starts with `AC1 #3481.e99bba39` and quotes the run's exit, stdout and stderr.

## Why it fails on the base

At `1b4929ae7`, `RecordReader::connect` (record.rs) gets the hub's error line from `hello_app` as
`HubError::Refused`. `main.rs`'s `--hub-check` handles only `Older`, `Io` and `Protocol` apart; `Refused` falls into the
arm for a hello that covers the app, which prints `hub ok: contract <n>` to stdout, writes the refusal to stderr and
returns, exiting 0. So on the base the test fails at assertion 2 ("it exited 0"), with `hub ok` in stdout, the reason
the criterion names. Nothing it calls is missing at the base: the hub, `withHub`, `--hub-check`, `hub.address` and the
`credential` refusal all exist there. Assertion 4 alone would pass on the base, since the stderr line carries the
refusal's code; it is the exit code and the `hub ok` line that the base gets wrong.

## How to run

On macOS only: `deep-app` builds and runs there (its window's dependencies). On any other platform the test throws
`BLOCKED` before it builds anything, which is never a pass. With Node 24 first on `PATH` and `cargo` on `PATH`:

```sh
npm run build --workspaces          # the hub runs from packages/cli/dist/main.js; missing, the test is BLOCKED
npx vitest run --root tests/acceptance/3481/redraft
node node_modules/typescript/bin/tsc -p tests/acceptance/3481/redraft/tsconfig.json
```

The test builds `deep-app` itself (a cold build can take most of an hour; the test's time limit is one hour). It stops
only processes it started, by PID (`withHub` stops its hub with SIGTERM), removes both temp homes, and never touches the
real `~/.deepbuild`. No network. With `--root` here, Vitest writes its cache under this folder's `node_modules/.vite/`;
delete it before committing.
