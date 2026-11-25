# Acceptance tests for #3481: deep-app --hub-check fails when the hub refuses the app's hello

I drafted these tests blind from these sources:

- issue #3481, as `gh issue view 3481` printed it on 2026-11-24
- `docs/technical-design.md`, section "Socket roles and contract versions" (the control token: random, new each launch,
  held only by the app and the CLI), and the Dogfooding part
- AGENTS.md
- the base commit `1b4929ae7` (origin/main), where `Mode::HubCheck` in `crates/deep-app/src/main.rs` sends every error
  but `Io`, `Protocol` and `Older` to the arm that prints `hub ok: contract <n>` and exits 0, and `HubClient::hello_app`
  in `crates/deep-app/src/hub.rs` turns a hello the hub refuses into `HubError::Refused`

At the base I also read `crates/deep-app/src/record.rs` (`RecordReader::check` and `connect`), the hub's local hello in
`packages/hub/src/server.ts` (a token that isn't this launch's is refused with code `credential` at `/token`; `writeToken`
writes the token with a trailing newline), `packages/hub/test/hub.ts` (`withHub`), and `tests/acceptance/41/app/`
(`compat.test.ts` and `helpers.ts`, #41's real-hub `--hub-check` test). The example run the issue cites,
`docs/evidence/2958/base-hub-check.txt`, isn't on main, so I didn't read it. Per AGENTS.md the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with Node 24 on macOS (the app runs on macOS only; #41's `appBinary` says BLOCKED elsewhere):

```sh
npm ci && npm run build --workspaces     # once: the hub is the built CLI's `deep hub run`
npx vitest run tests/acceptance/3481
```

The first test builds `deep-hook` (the hub won't start without it) and `deep-app` through `scripts/lease cargo build
--locked`; a cold `deep-app` build is large. Once built, the suite takes about 10 to 40 s (`BASE-FAILURE.txt`).

## Criteria to tests

| Criterion | Test | What it requires | Wrong program |
|---|---|---|---|
| `#3481.e99bba39` Against a real hub (`deep hub run`) with an app home whose `control.token` differs from the hub's, `deep-app --hub-check` exits non-zero, prints no `hub ok`, and names the `credential` refusal in its output. On the merge base it exits 0 with `hub ok`. | `hub-check.test.ts` | a real hub on a temp home; an app home of its own with a random control.token and `hub.address` pointing at that hub's socket; `deep-app --hub-check` finishes on its own, exits non-zero, no `hub ok` in stdout or stderr, and `credential` as a word in stdout or stderr | the merge base (exits 0 with `hub ok`); twin `refusal-unnamed` |
| `#3481.0d194ed9` With the hub's own token, `deep-app --hub-check` still prints `hub ok` and exits 0. | `hub-check.test.ts` | a real hub on a temp home; `deep-app --hub-check` with HOME that same home (the hub's socket and the token it wrote at this launch) exits 0 and a stdout line starts with `hub ok` | twin `token-untrimmed` (passes on the merge base) |

## Surfaces chosen

- **The hub**: `withHub` from `packages/hub/test/hub.ts`, the built CLI's `deep hub run` on a temp home of its own per
  test, ready at its first stdout line, stopped by SIGTERM to its own PID.
- **The app**: #41's `appBinary()` (a copy of `target/debug/deep-app` built from the checkout) and its `setUpHome` /
  `childEnv` (a temp home with a random control.token, a scrubbed environment). The app reads `hub.address` from
  `~/.deepbuild/config.json` as `unix:<path>` (`crates/deep-app/src/hub.rs`), so the mismatched home reaches the real
  hub without touching the hub's own home.
- **"Its output"**: stdout and stderr together, since the issue names no stream.

## Open questions

1. **Which stream names the refusal, and its wording**: the test asks only for the word `credential` somewhere in stdout
   or stderr. The base already prints it on stderr (as a Debug dump), so the base fails at the exit code, not there.
2. **The exit code's value**: any non-zero exit passes; the issue says only "non-zero".
3. **A refused call after an accepted hello** (the issue's Scope line: it still reads `hub ok`) has no criterion, so no
   test here. With the real hub and its own token, the base refuses no call, so `#3481.0d194ed9` doesn't exercise it.
4. **Reading `hub ok`**: no `hub ok` anywhere in either stream for the refused case; for the accepted case, a stdout line
   that starts with `hub ok` (#41 asks for it as the first line; this issue says only "prints").

## How I checked the tests can pass

No implementation was written into the repository. In my worktree I edited `crates/deep-app/src/main.rs` by hand for each
run and restored it with `git checkout` afterwards (a scratch copy would have needed a second cold `deep-app` build on a
full disk). The throwaway fix opened one `HubClient::app()` connection before `reader.check()` and, on
`HubError::Refused`, printed `deep-app: the hub refused the app's hello: <refusal JSON>` and exited 1: both tests passed.
Then, one at a time: the same with the refusal left out of the message (`refusal-unnamed`) failed `#3481.e99bba39` at
"must name the hub's credential refusal"; the fix plus the token presented untrimmed in `record.rs` and `hub.rs`
(`token-untrimmed`) failed `#3481.0d194ed9` at "must exit 0". The throwaway isn't kept and proves nothing about the real
change. The suite was then run again on the restored base (`BASE-FAILURE.txt`).

## Files

- `hub-check.test.ts`: both criteria.
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, home paths written as `~`.

No lane.json: each test's hub listens only on a Unix socket in its own temp home, with no ports or screen. No fixture
holds a secret or personal data; tokens are made at run time.
