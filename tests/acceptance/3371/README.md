# Acceptance tests for #3371: the Linux sandbox hides granted sockets under /run

Written first and blind, from issue #3371 (`gh issue view 3371 --repo windoliver/deepbuild`), the design
(`docs/technical-design.md`: Sandbox and budgets, Dogfooding), `AGENTS.md` and the base commit `5b82006d5`
("Merge pull request #2911 …", origin/main), by a job that never saw an implementation; no other branch, worktree,
pull request or stash was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

| Criterion | Tag | Test (`sockets.test.ts`) |
|---|---|---|
| AC1: a socket granted by a path that resolves through a symlink to a real path under `/run` is connected to by the path as granted and by its real path; the listener counts at least 1 for each, the run exits 0 | `#3371.93dce41a` | `AC1 #3371.93dce41a …` |
| AC2: in the same run, a second listening socket in the same `/run` folder the grant doesn't name gets 0 connections and the connect fails; a planted whole-folder bind must fail it | `#3371.abb32c74` | `AC2 #3371.abb32c74 …`; twin `folder-bound` (`twins.json`) |
| AC3: hand run of 580 and 331 compose on a Docker host | `#3371.331846b9` | not here: a recorded hand run, not this job's |

The tags were given by the coordinator and checked against the live issue with `scripts/proof-change.mjs`'s
`criterionId` rule (sha256 of the criterion's text, whitespace folded, first 8 hex). Every test's name starts with its
criterion and tag; each is its own top-level `test()`, with no subtests.

## What was read

- `AGENTS.md`; `docs/technical-design.md` (Sandbox and budgets, Dogfooding).
- At the base: `packages/supervisor/src/index.ts` (the entry: `openSupervisor`, `bubblewrap`, `HELPER`, types),
  `src/bubblewrap.ts` (`OWN` holds `run`; `bwrapArgs` gives `--tmpfs /run` and passes each granted socket to the
  helper as `--socket real(s)` with no mount), `src/bubblewrap.test.ts` (how a supervised Linux run is started and how
  the helper's `probe` reports), `src/seatbelt.ts` (`real`), `src/types.ts` (`Grant.sockets`, `Exit`),
  `native/helper-linux.c` (`probe`'s `unix <path>` try and its JSON lines; `handle_socket_call`: a Unix connect is
  resolved inside the sandbox, refused `ENOENT` when nothing is there and `EACCES` when the real path is under no
  `--socket` path, and otherwise made by the helper on the program's socket).
- Sibling suites `2955/`, `3220/`, `1108/` for house style, `tsconfig.json`, `twins.json` and twins layout.

## The surface under test

One run, shared by both tests (the criteria say "in the same run"), started through `openSupervisor` from
`@deepbuild/supervisor` with `@deepbuild/record` and `@deepbuild/asks`, on real `/usr/bin/bwrap` and the built helper
(`HELPER`). Nothing is mocked.

- The `/run` folder: a fresh temp folder under `/run/user/<uid>` (the user's runtime folder, a real path under `/run`
  an unprivileged user can make sockets in) holding two Node listeners, `a.sock` and `b.sock`, each counting the
  connections it accepts.
- The symlink: `/tmp/deep-3371-*/var-run` → that folder, standing in for `/var/run` → `/run`.
- The grant: `sockets: [<link>/a.sock]` (the path as granted, through the symlink), `read` the helper's folder,
  `write` an output folder.
- The program: `HELPER probe <out>/tries.json unix <link>/a.sock unix <run>/a.sock unix <run>/b.sock unix <link>/b.sock`,
  which connects to each path in turn and writes one line per try (connected, or refused with its errno); the probe
  exits 0 after its tries.

AC1 asserts (soft, so every failing line shows): both connects to `a.sock` (as granted and by real path) report
connected; `a.sock`'s listener counts at least 2 (both connects dial the one listener and nothing else does, so that is
at least 1 for each path); the run's exit code is 0. AC2 asserts both connects to `b.sock` (by its real path and
through the symlink) report refused, and `b.sock`'s listener counts 0. A run whose probe wrote no tries ends either
test `BLOCKED`, never `PASS`; so does a fixture whose granted path doesn't resolve under `/run`.

On any machine but Linux with bwrap, the built helper and `/run/user/<uid>`, each test fails with a message starting
`BLOCKED: <criterion> <tag> … this machine is <platform>`; nothing is skipped.

## The planted twin for AC2: `twins/folder-bound`

`twins/folder-bound/packages/supervisor/src/bubblewrap.ts` is the base file with one change, "the fix, one folder
wider": for each granted socket it binds the socket's folder (`--bind <folder> <folder>`, after the sandbox's own
`/run`) and grants that folder to the helper's filter (`--socket <folder>`). Binding the folder alone would not be
caught by connect results: the helper's filter checks each connect's real path against the `--socket` paths and
refuses `b.sock` with `EACCES` either way (`handle_socket_call`), so a folder bind with the base filter still leaves
`b.sock` unreached. The twin therefore widens both, as a fix that treats the socket's folder as the grant would; with
it AC1 passes (the folder, and so `a.sock`, is reachable) and AC2 fails (`b.sock` connects).

**What AC2 can't tell apart (run, not guessed):** a backend that binds the whole folder but keeps the base's
per-socket filter (`--socket real(s)`) passes both tests: the filter refuses `b.sock` (`EACCES`), so its listener
counts 0 and the connect fails, exactly as the criterion asks. Measured on the same Linux machine (2026-11-24, twin
copy edited to that variant and rebuilt: `Tests 2 passed (2)`). The issue's scope line "only the granted socket file
is bound in, never its folder" is therefore not proven by AC2's connection counts against that program; the criterion
as written is about connections and the connect failing, and this suite asserts no more than it says (it doesn't pin
the errno, ENOENT vs EACCES, which the criterion leaves open).

## Running

On Linux (aarch64 or x86_64), from a checkout with `npm ci` and `npm run build -w packages/supervisor` done (the
helper at `packages/supervisor/dist/helper`):

    NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3371
    node node_modules/typescript/bin/tsc -p tests/acceptance/3371/tsconfig.json

The twin: overlay `twins/folder-bound/packages/supervisor/src/bubblewrap.ts` onto a copy of the checkout, rebuild the
supervisor and run the suite there; AC2 must fail.

The base run is in `BASE-FAILURE.txt`; the twin run is under "Twin failure" below.

## Twin failure

`twins/folder-bound` on the same Linux machine (Linux 7.0.0-1025-nvidia aarch64, bubblewrap 0.9.0, Node v24.22.0,
Vitest 5.0.5), 2026-11-24T08:23:34Z, load 142.09 147.92 140.75 (not waited on): a `cp -a` of the base clone, the twin's
`bubblewrap.ts` copied over `packages/supervisor/src/bubblewrap.ts`, `npm run build -w packages/supervisor` exit 0
(so the twin type-checks), then `NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3371`: exit 1.

- `AC1 #3371.93dce41a` passed (the twin is the fix, one folder wider).
- `AC2 #3371.abb32c74` FAILED at its assertions:
  - the connect to the ungranted socket by `/run/user/<uid>/deep-3371-<rand>/b.sock` fails: expected 'connected' to match /^refused /
  - the connect to the ungranted socket by `/tmp/deep-3371-<rand>/var-run/b.sock` fails: expected 'connected' to match /^refused /
  - connections the ungranted socket's listener counted: expected 2 to be +0
