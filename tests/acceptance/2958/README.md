# Acceptance tests for #2958: the app and the replica present the token of the hub they call

Written first, blind, on November 21, 2026, from issue #2958 (its text as of that day: the body, Scope, the 3 checkbox
criteria and Proof), the design sections it links (`node scripts/design-section.mjs --issue 2958`: Socket roles and
contract versions; One hub per user, a tiny hook client, and extensions in-process), `AGENTS.md`, and the public
surfaces at the base commit `58b4a8cb2`: `deep-app --hub-check` (`crates/deep-app/src/main.rs`, `Mode::HubCheck`),
`deep_app::hub::address()` and `root()` (`crates/deep-app/src/hub.rs`), `deep hub run [--root <folder>]`
(`packages/hub/src/hub-command.ts`, `packages/hub/src/paths.ts`) and `packages/hub/test/hub.ts` (`withHub`, for how a
suite starts a hub). No implementation of #2958 was seen. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

The issue has 3 checkbox criteria, AC1 to AC3 in the body's order (IDs: the first 8 hex digits of the SHA-256 of each
criterion's text, whitespace folded, as `scripts/proof-change.mjs` computes them):

| AC | criterion ID | file |
| --- | --- | --- |
| AC1 | `#2958.9c0089ca` | `hub-check.test.mjs` |
| AC2 | `#2958.db948145` | `hub-check.test.mjs` |
| AC3 | `#2958.2a729810` | `token-sites.test.mjs` |

## How to run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub is started from packages/cli/dist/main.js
cargo build -p deep-hook --locked        # the hub doesn't start without target/debug/deep-hook
cargo build -p deep-app --bin deep-app --locked
node --test --test-concurrency=1 tests/acceptance/2958/hub-check.test.mjs tests/acceptance/2958/token-sites.test.mjs
```

- `DEEP_APP_BIN` names another build of `deep-app` (default `<repo>/target/debug/deep-app`), `DEEP_CLI` another built
  CLI (default `<repo>/packages/cli/dist/main.js`); either must be built from the commit under test. A missing build
  fails `BLOCKED`, never passes; so does a hub that exits or doesn't answer within 30 s.
- AC3 needs only Node: it reads the sources.
- Folders: `/tmp/dh2958-*` (a temp HOME `h/` and, for AC1, the dev hub's root `r/`), removed by the suite. The suite
  stops only the hubs it started, by PID (SIGTERM, then SIGKILL after 30 s).

## The surfaces under test, and the choices made

- **The hub** is a real one: `node <CLI> hub run [--root <root>]`, with HOME the temp home and none of this process's
  `DEEP_`, `XDG_`, `CLAUDE*`, `CODEX*`, `GIT_`, `npm_` or billing variables; ready once `<root>/hub.sock` says hello.
- **"Answered by that hub as the app, with no refusal"** is: `deep-app --hub-check`, run with the same HOME, exits 0
  within 60 s, its stdout's first line starts with `hub ok`, and its stderr matches neither `refus` nor `credential`
  (case-insensitive). The last part is load-bearing: at the base a refused hello is a `HubError::Refused`, which
  `--hub-check` reports as `hub ok` and exit 0 with `deep-app: the hub refused a call: Refused(... "credential" ...)`
  on stderr, so `hub ok` and exit 0 alone don't tell an answer from a refusal.
- **AC1.** The dev hub runs with `--root /tmp/dh2958-*/r`, outside `~/.deepbuild`; `~/.deepbuild/config.json` holds
  `{"hub":{"address":"unix:<r>/hub.sock"}}`. Run twice, once with the installed root holding a `control.token` that
  isn't the dev hub's, once with none. No hub is at `~/.deepbuild/hub.sock` (asserted), so only the dev hub can
  answer. The dev hub must have written its `control.token` beside its socket.
- **AC2.** No config: a hub at the installed root (`deep hub run`, HOME the temp home), which writes its own
  `~/.deepbuild/control.token`; the check must reach it as above.
- **AC3, the one function (a surface this job pinned; the issue names no function).** A *site* is an occurrence of
  the literal text `control.token` in a file under `crates/deep-app/src` or `crates/deep-replica/src`, in code or in a
  string literal; in a `.rs` file comments (`//`, `///`, `//!`, block comments) are not sites, in any other file every
  occurrence is one. Each site is placed in the innermost `fn` body holding it. The allowed sites are those inside a
  function body in `crates/deep-app/src/hub.rs`, when all of that file's sites in function bodies are in one function.
  The test fails, listing `<file>:<line>: <text> (in fn <name>)` for every other site: any outside `hub.rs`, any in
  `hub.rs` outside a function body (a `const` or `static` too), and every one of them when they're in more than one
  function of `hub.rs`; and it fails when no function of `hub.rs` names it (no one function). Test code under `src`
  (`#[cfg(test)]` modules) counts like any other source. Before the real sources, the test runs the reader on three
  in-memory twins (a fixed shape that must pass; a stray site, which must fail naming its file and line; two
  functions and a `const` in `hub.rs`, which must fail), so a pass isn't a reader that sees nothing.

## At the base

`BASE-FAILURE.txt` is AC3's output at `58b4a8cb2` on Linux, with the home folder written `~`. It fails naming 8 sites:
`crates/deep-app/src/main.rs` lines 163, 321 and 568, `crates/deep-app/src/show.rs:535`, and in deep-replica
`canvas.rs:44`, `drive/mod.rs:489`, `live.rs:222` and `main.rs:149`. The issue's ninth, `HubClient::app` at
`crates/deep-app/src/hub.rs:260`, is the only function of `hub.rs` naming it at the base, so this reading counts it as
the one function there; after the fix whichever single function of `hub.rs` names it is the one.

AC1 and AC2 were not run by this job when the suite was written (see the job's report for any later run). At the base
AC1 is expected to fail: with a different installed token at `--hub-check`'s credential refusal on stderr, and with
none at exit 1 (the token file can't be read).
