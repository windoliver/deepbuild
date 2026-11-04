# Acceptance tests for #669: a false done held and sent back with its verdict line, and the fix passes

Written first, blind, by a job that never saw an implementation of #669 (none existed). It read:

- issue #669 as of November 3, 2026: its Scope, six checkbox criteria, Proof and Depends on (#29, #30, #25, #83,
  #668, all closed at the base); it has no comments;
- `docs/technical-design.md`: An agent says it's done (Every stop is judged, Fast and slow lanes, Slow runs start when
  the turn ends, The verdict in the chat), How runs become one of five verdicts (the rules, Check health, Failing on an
  assertion, Fail before, pass after, Pinned to a commit), the Hook protocol and Dogfooding;
- AGENTS.md and CONTRIBUTING.md;
- the READMEs and twins of the suites whose surfaces it drives: `668/` (its helpers, fixtures and twins), `83/`, `29/`,
  `30/`, `25/twins.json`, `875/` (a fix check through the real hub with Vitest), `666/`;
- base commit `29d29ba5` (origin/main): `packages/hub/src/{plant,gate-runner,ask-tasks,verdict-chat,server}.ts`, the
  parts of `packages/hub/src/core.ts` that run a claim's checks, `scripts/agent-harness.mjs` (its scenarios),
  `scripts/lanes.mjs`, `scripts/proof-runs.mjs` (how twins are laid over a checkout) and `scripts/proof-change.mjs`
  (criterion IDs).

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` (`.node-version`), on macOS, and the Rust toolchain:

```sh
npm ci && npm run build --workspaces    # the tests run the built CLI; checkout-web's Vitest is cloned from this install
cargo build --locked -q -p deep-hook    # setup's entries run it; the tests build it too
npx vitest run --root tests/acceptance/669 --no-file-parallelism --testTimeout=600000 fast.test.ts
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/669 session.live.test.ts   # by hand only: spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/669/tsconfig.json
```

- **Fast tests** (`fast.test.ts`) start no agent and spend nothing. Two homes: the main world (AC1, AC2, AC4, AC5) and
  a side world (AC3, AC6), each with its own `deep setup` and hub.
- **Live tests** (`session.live.test.ts`) run one real Claude Code session through the agent test harness on your own
  sign-in, and read AC1, AC2, AC4 and AC5 off it (the issue's end-to-end path). Without `DEEP_HARNESS_LIVE=1`, without
  `CLAUDE_CODE_OAUTH_TOKEN`, or without a `claude` on `PATH`, each fails with `BLOCKED` in its message; nothing skips.
- Every test makes its folders under `/tmp/dh669-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json`, the Keychain
  or `~/Library/LaunchAgents`. It stops only processes it started, by PID, including the hubs the launchd stand-in
  started. No child inherits a billing key or a `CLAUDE*`, `CODEX*`, `GIT_*`, `OTEL_*`, `npm_*` or `DEEP_*` variable of
  the runner's; the live run passes `CLAUDE_CODE_OAUTH_TOKEN` to the harness and nothing else.
- With `--root` here, Vitest writes its cache to `tests/acceptance/669/node_modules/.vite/`; delete it before committing.

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep setup`** (#18, #19): run in the checkout, it writes DeepBuild's hook entries into `~/.claude/settings.json`
  and starts the hub through its login service (the launchd stand-in, which hands setup's environment to the hub, so
  the test seams below reach it). DeepBuild's entries are those whose command runs deep-hook or the deep CLI.
- **`deep status`** (#19, #83): exit 0 when it read the hub; a session is shown by a line holding the first 8
  characters of its ID, and its lines run to the next line naming another session.
- **The hub's socket** (#16): `events.read` on a `cli` connection with the control token.
- **The record** (#14, #29, #30, #303): `user.ask` (its `tasks`), `definition.locked` (`task_ref`), `claim.made` (one
  per judged stop, its `commit`), `run.started` and `run.finished` (`claim`, `check`, `commit`, `outcome`,
  `tests_run`), `verdict.made` (subject or `claim` the claim's handle `claim:<event id>`, `outcome`, `reasons`, and the
  commit it judged in `commit` or `key.commit`).
- **The handed definition** (#303's seam `DEEP_HUB_TEST_DRAFTS`, as #875 uses it): the drafting job's output for the
  prompt, one requirement `R1` whose check is `.deepbuild/checks/npm-test.sh` (`npm test`, one line), `on_base: fails`,
  `asserts: ["test/coupon.test.js:5"]`, `deliverables: ["src/coupon.js"]`. The issue's "approved `npm test` check" is
  this check, locked by the kernel with its bytes; there is no `.deepbuild/done.yaml`.
- **Claude Code's hook output** (#83, #80): a Stop entry's `{"decision":"block","reason"}` continues the turn with the
  reason (the send-back); a reply's `systemMessage` is shown in the chat; a UserPromptSubmit entry's block keeps the
  prompt from the model and shows the reason.
- **The command check kind** (#30): runs `npm test` hermetically in the claim's checkout and counts the tests from the
  tool's report; the gate runner (#29) admits it to the stop's fast lane; #83's line; #25's Stop hold.
- **`DEEP_HUB_PLANT=<name>`** (#16): a planted wrong program; the twins replace `packages/hub/src/plant.ts`.

### Stand-ins (boundaries this repo doesn't own), first on `PATH` as `<tmp>/bin`

`launchctl` (`fixtures/launchd.mjs`, #668's copy), `systemctl`, `sh-login`, `deep`, and in the fast tests `claude`
(`fixtures/claude.sh`) and Claude Code running its user settings' hooks (`fixtures/claude-code.mjs`, #668's copy
as-is). The stand-in runs every matching entry of `<tmp>/h/.claude/settings.json` with `/bin/sh -c`, as Claude Code
does, and each Bash command as its child.

### The fixture repo

`fixtures/checkout-web/`: `package.json` (`"test": "vitest run"`), `src/cart.js` and `test/cart.test.js` (two passing
tests), `src/coupon.js`, whose percent coupon takes the percent off as cents, and `test/coupon.test.js`, one test whose
`expect` on line 5 fails (1990, not 1800) until the fix. `npm test` runs **3 tests**. Each world copies it to
`<tmp>/<world>/checkout-web`, writes `.gitignore` (`node_modules/`) and the check file, lays its variant over it, and
makes two commits ("Start the checkout page", "Add the coupon code and its check"); Vitest is cloned in from this
checkout's install (#875's `installVitest`). The variants:

| World | Variant | Its session |
|---|---|---|
| main | none | types the prompt; `npm test` (fails); stops saying done; the send-back; Read and Edit `src/coupon.js`; `npm test` (passes); `git commit -am "Fix the coupon discount"`; stops; types `all done?` |
| zero-tests | every `it(` is `it.skip(`: `npm test` runs 0 tests and exits 0 | types the prompt; `npm test`; stops saying done; types `all done?` once its verdict is in |
| masked | the script is `vitest run \|\| true`: `npm test` exits 0 with the coupon test failing | the same |
| slow | `test/slow.test.js`, one test that waits 20 s | types the prompt; the fix (Read, Edit); stops; once a run of its claim's check has started, the hub is restarted (SIGTERM to its PIDs, then `launchctl kickstart gui/<uid>/<label>`); `all done?` once its verdict is in |

The side world runs zero-tests, masked, then slow (the restart last), on one home and hub.

## Readings where the issue and design leave a choice

1. **"The chat shows one verdict line"**: the verdict lines of DeepBuild's Stop entry's reply are the lines of its
   `systemMessage` and the first line of a block's `reason` that name a verdict (`PASS`, `FAIL`, `INVALID`,
   `INCONCLUSIVE`, `BLOCKED`, `sent back`, `says done`, `checks running`), counted once each; there must be exactly
   one. Tests read the line at the agent's side only.
2. **"Reading FAIL"**: #83's line spells a FAIL as `sent back <round>/3`; either that or the word `FAIL` reads FAIL,
   and the line never says `PASS`. **"The failing test's file and line"**: the line holds `coupon.test.js:5`.
   **"The count of tests run"**, and AC2's **"its test count"**: the line holds `3 tests` (a `3` not after a `/` or a
   digit, then `test` or `tests`), as in `3 tests` or `3 tests run`.
3. **"The first stop is held, the check runs"**: a run of the claim's check finished no later than the Stop entry's
   reply. **"The session goes on with the send-back"**: that reply blocks the stop with a reason.
4. **"Its verdict names the commit it judged"** (AC2, AC4): the `verdict.made` names, in `commit` (or `key.commit`),
   the commit HEAD was at when the session stopped: the fixture's last commit at the first stop (the worktree is
   clean), the fix's commit at the second. Every verdict on the session's claims names its claim's `commit`.
5. **"`deep status` shows the same outcome as the chat"** (AC4): `deep status` in the checkout, once the stop's
   verdict is in the record, exits 0 and the session's lines hold the line's outcome (`FAIL` or `sent back` for FAIL).
6. **"A check cut short by a hub restart reads INCONCLUSIVE"** (AC3): the hub dies during the stop's hold, so the line
   is read where the chat next shows it: the first line of the answer to `all done?`, typed once the claim's verdict is
   in the record; the record also holds an INCONCLUSIVE verdict on the claim. **"One that ran zero tests reads
   INVALID"**: the zero-tests stop's line. **"Neither line ever says PASS"**: no verdict line DeepBuild showed in
   either session (every Stop and prompt reply) says `PASS`, and neither claim has a PASS verdict.
7. **"Answered from the record with no model call"** (AC5): DeepBuild's UserPromptSubmit entry blocks `all done?`
   (Claude Code then never sends it to the model) and its reason names the outcome of the record's newest verdict on
   the session's newest claim (PASS). Live, the transcript holds a `hook_blocked_prompt` entry naming that outcome and
   no assistant entry after it; the live session's chat lines are read from the transcript's `hook_system_message`,
   Stop hook feedback and `hook_blocked_prompt` entries (#80's record of how Claude Code saves them).
8. **AC6, "fails this test, naming the check"**: the masked world's check (`npm test` whose script is `vitest run ||
   true`) must be judged INVALID (Check health: a masked command can't fail), or FAIL by the precedence when its report
   counts the failing coupon test, never PASS, and no line of its session says PASS. Each failure message names the
   check `.deepbuild/checks/npm-test.sh` and its mask.
9. **A loaded machine.** The hold may reply before a check starved of CPU ends. When a stop's check hadn't ended by
   its reply and the machine's load average was past its core count, AC1, AC2, AC4 and AC5 fail `INCONCLUSIVE`
   (thrown, never a pass), as #29's and #668's suites read a loaded run. A prompt whose task never locks, a hub that
   doesn't start, or a slow check that never starts is `BLOCKED` (thrown), with the hub's log and the load in the
   message. A hub that starts again after the restart but answers nothing for 3 minutes is not BLOCKED: AC3 then fails
   at its assertion, since no INCONCLUSIVE line ever reaches the chat.

## The planted wrong programs

Each is named in `packages/hub/src/plant.ts`'s `Plant` and `PLANTS` by the implementation and selected with
`DEEP_HUB_PLANT`. Its twin under `twins/<name>/packages/hub/src/plant.ts` replaces that file whole, keeps every export
the base has (`Plant`, `plantOf`, `activePlant`, `plantedSessionEnd`, `plantedReload`, `plantedStart`, `plantedStop`,
`piAcceptsReplaced`) and returns its plant whatever the variable says.

| Name | Read by | What it plants | Fails |
|---|---|---|---|
| `runner-passes-masked-exit` | the hub's command check runner (#30) | a run whose command, or the package script it runs, masks its exit status is read as a clean pass: `passed`, no mask recorded, the report's failures dropped, so the claim it covers is judged PASS | AC6: "the check .deepbuild/checks/npm-test.sh (`npm test`, whose package script is `vitest run \|\| true`) masks its exit status, so its claim is INVALID …, never PASS" |
| `line-pass-without-verdict` | the hub's Stop reply (#83's line) | every judged stop's reply shows `PASS 3 tests` whatever the record holds, with no verdict row behind it | AC4: "stop 1's line reads PASS …, but the record holds no PASS verdict on its claim"; AC1: "the first stop's line must read FAIL" |
| `status-from-model` | the hub's UserPromptSubmit reply (#83's status answer) | a status question you type ("all done?") is never answered from the record: it goes on to the model as any prompt does | AC5: "\"all done?\" must be answered by DeepBuild's prompt entry, blocking the prompt so no model call is made" |

`twins.json` maps AC1 and AC4 to `line-pass-without-verdict`, AC5 to `status-from-model` (AC5 already holds at the
base, #83's work, so only a twin can show its test fails on a wrong program) and AC6 to `runner-passes-masked-exit`.

## Additions the implementation must make

This job edits nothing outside this folder.

1. **The three plants** above, in `packages/hub/src/plant.ts`, its exports kept as the base has them.
2. **A harness scenario**, `fix-coupon-test`, in `scripts/agent-harness.mjs`, shaped like #668's `fix-checkout-test`:
   `run --scenario fix-coupon-test --workdir <dir> [--pass-env <NAME>]... [--claude <path>] [--timeout-ms <n>] [--out
   <dir>]`. One interactive Claude Code session (never `-p`) in `--workdir`, loading your user settings only
   (`--setting-sources user`), tools `Bash`, `Read` and `Edit` allowed with no prompt. It types `PROMPT`
   (helpers.ts) word for word, with `FIRST_STOP` (helpers.ts) added to its system prompt, so its first stop says
   "done" before the fix; it lets the send-back continue the turn; once a stop ends the turn, it types `all done?`,
   then `/exit`. Its run line: `verdict` `PASS` when the session ended after `all done?`, `sessionId`, `transcript`.
3. **`scripts/lanes.mjs`**: `tests/acceptance/669/fast.test.ts` in `alone` (it starts hubs and restarts one), and
   `tests/acceptance/669/session.live.test.ts` in `byHand` (or a local-preflight lane of its own on the reference Mac,
   as the issue's Scope asks).
4. Whatever the line, the record and the status answer need for the readings above: the test count on the verdict
   line, a recorded PASS verdict naming its commit, and the line `all done?` gets after a restart.

## Criteria to tests

IDs are `#669.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed>` (the rule of
`scripts/proof-change.mjs`). Every test name and every check message starts with its tag.

| ID | Criterion (short) | Fast test | Live | Fails on |
|---|---|---|---|---|
| AC1 `#669.2302adfc` | first stop held, one FAIL line with file:line and test count, sent back | `AC1 … held while \`npm test\` runs …` | yes | the base (no test count); twin `line-pass-without-verdict` |
| AC2 `#669.b95b4d96` | next stop PASS with test count; verdict names its commit | `AC2 … reads PASS with 3 tests …` | yes | the base |
| AC3 `#669.db713958` | restart-cut check INCONCLUSIVE, zero tests INVALID, never PASS | `AC3 … all skipped reads INVALID … hub restart reads INCONCLUSIVE …` | no | the base: the restarted hub answers nothing, so no INCONCLUSIVE line or verdict |
| AC4 `#669.059078dc` | every verdict a record row with its commit; `deep status` matches the chat | `AC4 … each stop's line is a verdict row …` | yes | the base (`deep status` shows no outcome); twin `line-pass-without-verdict` |
| AC5 `#669.b5400502` | "all done?" answered from the record, no model call | `AC5 … "all done?" typed after the PASS …` | yes | twin `status-from-model` (passes at the base) |
| AC6 `#669.f2c64a9c` | a runner passing a masked exit fails this test, naming the check | `AC6 … \`|| true\` … is never PASS …` | no | twin `runner-passes-masked-exit` (passes at the base) |

`BASE-FAILURE.txt` holds the run at the base and why each test fails or passes there.

## The proof

Written to `$TMPDIR/deep-669-proof/` (`os.tmpdir()`), `fast/` and `live/`, rewritten on each run and never read back:
per world, `<world>-transcript.jsonl` (the session's transcript), `<world>-chat.json` (each DeepBuild reply and its
verdict lines), `<world>-record.json` (the claims, the verdict rows with the commit each judged, the check runs with
their outcomes and `tests_run`, and the session's events), `<world>-terminal.txt` (the stop replies, `deep status`,
the restart); and `machine.txt`.

## Files

- `helpers.ts`: the home and stand-ins, the fixture repo and its variants, the CLI, the hub's socket and restart, the
  session driver, the worlds, every criterion's check, the harness run, the transcript reading and the proof.
- `fast.test.ts`, `session.live.test.ts`: the tests. `tsconfig.json`: the root options with `noEmit`.
- `fixtures/`: `checkout-web/`, `claude.sh`, `claude-code.mjs`, `launchd.mjs` (#668's copies).
- `twins.json`, `twins/<plant>/packages/hub/src/plant.ts`: the planted wrong programs for the proof lane.
- `BASE-FAILURE.txt`: the run at the base.
