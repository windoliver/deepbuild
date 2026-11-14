# #2065 — restart-safe done-gate answers

Base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17` (the isolated shallow checkout).
Inputs: `issue-2065.json`, `AGENTS.md`, relevant sections of `docs/technical-design.md`
(Dogfooding, What done means, event log, asks), and this base's code/test helpers.
No production fix, existing-test edit, fetch, or commit.

## Files and surfaces

- `restart.test.ts`: seven tests covering all six issue criteria. Criterion IDs are hashes of
  the issue's normalized criterion text. Expected counts, rounds, cap and item texts are literals.
- `hook-peer.mjs`: a separate agent parent with a child per hook, forwarding the hook protocol
  using the existing `packages/hub/test/hub.ts` socket reader. It makes no gate decisions.
- `BASE-FAILURE.txt`: complete failing Vitest output from the final `affected.mjs` invocation,
  with frozen SHA-256 digests of both executable files.
- `BASE-RESULTS.jsonl`: that invocation's complete machine-readable test report.

Reuse: #325's worlds, actual command checks, transcript/session actions, CLI answers,
record readers and PR command; #16's hub lifecycle and hook-request helpers. No DeepBuild
component is mocked. External boundaries are the supplied work-source readings, drafted
requirements, planted price, OS-confirmation fixture and agent payloads/transcripts.

Every restart stops and awaits the old **process**, then starts another process against the
same on-disk record and checks that a clean shutdown was recorded. No hub object, record
connection, or cache survives. The tests enter `deep hub run`, its documented hook socket,
`deep inbox answer`, `events.read` and `inbox.read`. `gh pr create --body "Closes #…"` is tested
at its actual PreToolUse gate; it never contacts GitHub or creates a PR. A clock step through
the base's `test.clock` interface lets the real ask scheduler take the deadline default.

## Requirement → test → base result

| Criterion | Test/expected observable | Observed behavioral failure |
| --- | --- | --- |
| AC1 `#2065.d984fab2` | Stalled ask, restart, `split`; exactly **1** `issue.drafted` for its ask/task, listing R1 “A dropped connection is retried” and R2 “Each rejected token is logged” | **0** drafts; failure names the ask and task. Both real drafted checks failed before restart; the repo spec passes. |
| AC2 `#2065.5b02fc15` | Stalled ask, restart, `accept`; Closes gate **allow**, then another process restart and **allow** again | **deny both times**, naming `task:item206502` and its unproven items. Both observations are collected before soft assertions. |
| AC3 `#2065.e0ad4590` | `reject_expired` answered `stay-off`, restart; Closes **allow** in original and second Git worktree; total switch asks remains **1** | **deny in both worktrees**; **3** asks total (original plus two new asks). Before restart, the answer allows Closes and its real follow-up completes. |
| AC4 `#2065.4d4ad2b8` | Two actual send-backs, restart, third send-back; recorded rounds **[1, 2, 3]** | **[1, 2, 1]**, naming `task:item2065040`. Open-item wording changes to avoid the separate two-identical-stops stall rule; the same failing check remains. |
| AC5 `#2065.ae196407` | One paid check, planted **$4.00** price, locked definition, restart, `approve`; **1** `spend.approved`, issue scope, **1** run, **4** cap_usd | **0** approvals; failure names the budget ask and $4.00 cap. |
| AC6 `#2065.f0caaac6` | Separate explicit `not-yet` and deadline-default tests; no open inbox ask, Closes **deny**, Part of until switched on, no “you're asked in your inbox” | Both refusals still say **“you're asked in your inbox”**, despite no open ask, and do not explain waiting until the switch is on. |

AC3 uses two tasks/PRs in two real worktrees of the same repo. This tests the issue's explicit
repo-and-name switch identity, independently of an issue or a worktree path. Both tasks have
passing checks before the switch gate is exercised. No release check is needed for this bug.

## Commands

Node used: v24.22.2. Dependencies were already present; nothing was downloaded.
Initial prerequisite commands:

```sh
npm run build --workspaces
cargo build --offline --locked -q -p deep-hook
```

The workspace build found the supplied `node_modules/@deepbuild/github` link missing;
Cargo was installed but not on PATH. Prerequisite repair and successful builds:

```sh
ln -s ../../packages/github node_modules/@deepbuild/github
npm run build --workspace @deepbuild/hub --workspace @deepbuild/cli
PATH="/opt/homebrew/opt/rustup/bin:$PATH" CARGO_NET_OFFLINE=true \
  cargo build --offline --locked -q -p deep-hook
```

These only prepared ignored dependencies/build products; no tracked file outside this folder
changed. The final socket tests do not require the Rust hook binary.

Selection (only the new test file was selected; no WIDE line):

```sh
PATH="/opt/homebrew/opt/rustup/bin:$PATH" CARGO_NET_OFFLINE=true \
  node scripts/affected.mjs --list tests/acceptance/2065/restart.test.ts
```

Exact final invocation (the intermediate output was named `DRAFT-RUN.txt`; final evidence
was copied from this invocation's completed `vitest.log` and `vitest.jsonl`):

```sh
REAL_HOME="$HOME"
RUN_HOME=$(mktemp -d /tmp/db2065-runner.XXXXXX)
printf '%s\n' "$RUN_HOME" > tests/acceptance/2065/RUN-HOME.txt
HOME="$RUN_HOME" RUSTUP_HOME="$REAL_HOME/.rustup" CARGO_HOME="$REAL_HOME/.cargo" \
PATH="/opt/homebrew/opt/rustup/bin:$PATH" CARGO_NET_OFFLINE=true \
DEEP_VENDOR_RELEASES="$RUN_HOME/no-vendor-releases" \
HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
ALL_PROXY=http://127.0.0.1:9 NO_PROXY=localhost,127.0.0.1 NODE_USE_ENV_PROXY=1 \
node scripts/affected.mjs tests/acceptance/2065/restart.test.ts \
  > tests/acceptance/2065/DRAFT-RUN.txt 2>&1
```

The isolated runner HOME avoids the installed hub. Offline Cargo, an unavailable vendor
release directory and closed-loopback proxies prevent auxiliary checks fetching material.
Temporary setup/build logs were removed after saving the final evidence.

## Run status, setup corrections, limits

**Seven tests completed, seven behavioral failures, zero skipped, no setup failure or unhandled
error in the final report.** Vitest took 538.23 s on this heavily loaded machine. Both test files
are frozen at the digests in `BASE-FAILURE.txt`; no test edits followed the valid failures.

**INCONCLUSIVE outer runner completion:** the tool running the shell reached its 600 s limit
(including runner/lint startup). The already-started Vitest child subsequently completed;
its JSONL ends with `{"type":"end"}`. Thus there is no final aggregate `affected` exit/summary
to claim. Its mandatory auxiliary lints are not acceptance proof: the vendor check reported
BLOCKED for missing offline releases of accesskit_macos, gpui-pre, gpui-pre-apple,
gpui-pre-macos, quickjs-jit-runtime and unicode. No WIDE suites were selected or left unrun.
No acceptance criterion is blocked or unrun. Full preflight and live external services were
not run and are not required here.

Before freezing, base-only setup observations led to these corrections:
- The Rust hook's 50 ms fail-open timer dropped hooks under load; use the documented hub
  hook socket without retries, while retaining real adapters and gates.
- Hooks sent from the test parent caused the real CLI to correctly reject answers from an
  agent process tree; isolate the agent/hook peer from the person's CLI process tree.
- `inbox.read` also returns closed historical rows; filter its explicit open/later statuses.
- A passing fix check introduced unrelated background/base-check timing into stall setup;
  use the two existing genuinely failing checks, verify their verdicts, and keep spec green.
- An OS network sandbox also prevented `ps`, blocking the runner before tests; the final run
  instead uses the offline/proxy environment above. An initial isolated-HOME invocation
  failed before tests because Rust's home was misbound; it downloaded nothing.

No changes were made to production, runner configuration, existing acceptance tests, fixtures
or helpers. The pre-existing untracked `issue-2065.json` was left untouched.
