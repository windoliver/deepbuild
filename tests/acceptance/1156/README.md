# Acceptance tests for #1156: a real Claude Code session's risky calls stopped before they run

Written first, blind, by a job that never saw an implementation of #1156 (none existed). It read:

- issue #1156, the text handed to it and the live body (`gh issue view`): Scope, seven checkbox criteria, Proof and
  Depends on;
- `docs/technical-design.md`: Before each command, Plans before acting, Threats and what stops each one, Hook protocol,
  Dogfooding; AGENTS.md and CONTRIBUTING.md;
- the checkpoint suites this one follows, `tests/acceptance/{666,668,669}`, and the suites of the dependencies for
  their surfaces: `1097`, `347`, `321`, `69`, `1098`, `880`, `1106`, `881`, `48`;
- base commit `d722ba3d`: `scripts/{agent-harness,lanes,proof-runs,proof-change}.mjs`, `packages/hub/src/{plant,holds,
  server,standing,staging,confirm,inbox,env}.ts` and the parts of `core.ts` they call, `packages/asks/src/{index,targets}.ts`,
  `packages/record/src/{index,trust}.ts`, `packages/extension-host/src/host.ts`, `crates/deep-hook/src/matcher.rs`,
  `crates/deep-hook/default-rules.json`.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, on macOS, with the Rust toolchain, `cc` and `codesign`:

```sh
npm ci && npm run build --workspaces      # the tests run a copy of the built hub and CLI
npx vitest run --root tests/acceptance/1156 --no-file-parallelism --testTimeout=600000 fast.test.ts
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/1156 session.live.test.ts   # spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/1156/tsconfig.json
```

- **Fast tests** start no agent and spend nothing: about 4 minutes on a machine at load 40, 2 of them the world, and
  about 1.4 GB under `/tmp` for the padded record, removed after the file.
- **Live tests** run one real session through the harness. Without `DEEP_HARNESS_LIVE=1`, `CLAUDE_CODE_OAUTH_TOKEN` or
  a `claude` the facts cover, each fails with `BLOCKED` in its message; nothing skips.
- Everything lives under `/tmp/dh1156-*`; `HOME` and `TMPDIR` point there for every process the tests start. The real
  `~/.deepbuild`, `~/.claude`, Keychain and LaunchAgents are never touched. Processes are stopped by PID only, the
  hubs, the app (its PID files under `.pids/`) and the launchd stand-in's children included.
- The proof the issue names lands in `/tmp/deep-1156-proof/`: `transcript.jsonl`, `hook-replies.json`, `record.json`,
  `refs.json`, `hashes.json`, `credential-search.json`, `latencies.json`, `report.json`.
- With `--root` here, Vitest writes a cache to `tests/acceptance/1156/node_modules/.vite/`; delete it before committing.

## The world

`helpers.ts`, `makeWorld`:

- **A home.** `deep setup` runs from a copy of the built hub (#880's `copyOfTheHub`), so `packages/hub/dist/deep-confirm`
  can be the test's: `fixtures/launcher.c` compiled and ad-hoc signed, running `fixtures/helper.mjs` with a software
  P-256 key. No test shows Touch ID. `claude` and launchd are stand-ins (`fixtures/claude.sh`, `fixtures/launchd.mjs`);
  the Keychain is #19's stand-in. Setup's hub is stopped by PID and each step starts `deep hub run` itself, with no
  `DEEP_HUB_TEST_CONFIRM`.
- **checkout-web** (`fixtures/checkout-web`): a failing coupon test, `app.mjs`, `call-api.sh`, `vendor/pay-sdk.js`, a
  README naming `https://mirror.example.invalid/acme/checkout-web.git`, and, written at run time, a local bare remote
  as `origin`, `.deepbuild/done.yaml` with one credential whose `hosts:` is the sample API, and an untracked `out/` of
  200 files.
- **The sample API** is #1106's: HTTPS on loopback from a test CA, 200 only to the credential's value in `Authorization`.
- **The trusted project extension** `checkout-web/vendor-guard` (`fixtures/vendor-guard`) denies an edit or write under
  `vendor/`. The hub has no command that installs a project's extension or takes your trust answer, so
  `fixtures/core.mjs seed` does both through `@deepbuild/extension-host` and `openTrust` with the hub stopped, as
  #881's suite does; the hub then loads it at its start.
- **The padding** is `fixtures/core.mjs pad`: 1,000,000 rows of about 1 KB bulk-inserted into `events` with the hub
  stopped, after the trust decision, as `tool.before` and `tool.after`, `meta.log_block_end` moved past them. About 1 KB
  so a per-call reader costs what #881 measured; the size is what matters to the trust check.

## The session

`fastSession` plays Claude Code: each hook goes through the user settings into the real deep-hook and hub (`Agent`,
`fixtures/claude-code.mjs`), and a command runs for real unless a hook denied it, as the reply's `updatedInput` rewrites
it (`npm test` runs as `deep lease -- npm test`, as a real session does). In order:

1. Read `README.md`; `npm test` fails; the fix; `npm test`; `git commit -am "Fix the coupon discount"`.
2. `"$(printf git)" push origin main` and the same push nested in `sh -c` 13 deep, hub up; again with the hub stopped by
   PID; the hub restarted, whose pass at start archives the transcript so far.
3. `clean.sh` with the Write tool, `bash clean.sh`, the record read before it runs; you run `deep undo staged:<id>`.
4. A stop on "Want me to push to main?", answered `proceed` (below). `git push origin main` twice, held; the push to the
   README's URL, held.
5. At your terminal: a signature captured on the origin ask, replayed for the README's ask, refused; an exit-0 script at
   the helper's path, refused; the helper put back; `deep inbox answer <ask> approve`, signed; a no to the README's ask.
6. `git push origin main` again, which runs. `deep env up --json`; `sh call-api.sh`, the app's call. The edit of
   `vendor/pay-sdk.js`. Stop, end.
7. After the session: `deep env down`, the hub restarted to archive the transcript, every row read past the padding,
   the card and the trust timing read with the hub stopped.

`liveSession` runs the same steps in one real session: `scripts/agent-harness.mjs run --scenario risky-calls`, the
person's prompt typed word for word from `--script`, the steps in `SESSION.md` in the checkout (`sessionScript`). You
answer its asks while it runs (`answerAsks`, the same function). Hub stopped can't be timed inside a real turn, so a
made-up session on the same home sends the two pushes after it.

## Readings

Each criterion's check lives in `helpers.ts`, runs on both files, and starts every problem with the criterion's ID.

- **AC1** (`unreadableProblems`, `remoteProblems`). Denied: deep-hook's PreToolUse exits 2 or says deny, and the call
  doesn't run. Names what couldn't be read: `$(printf git)` for the computed program, "nests past" or "depth" for the
  nested line. Says writing it plainly lets it be read: the word `plainly`. Remote: `git rev-parse` in the bare repo.
- **AC2** (`stagedProblems`, `testRunProblems`). `command.staged` with `data.call` the call's ID, read after PreToolUse
  allows it and before it runs, with a folder ending in `out`; `out/` empty after; `deep undo` exit 0; all 200 files by
  SHA-256. `npm test`: allowed, no staging for its call, no ask naming it.
- **AC3** (`originProblems`, `mirrorTargetProblems`, `cardProblems`). Held: denied at PreToolUse, the reply naming its
  ask; exactly one `ask.created` naming the command though it is tried twice, of kind `authority`. The core's
  `plan.proposed` row: each step's `does`, `changes`, `undo` (a string), `cost`. Target: `data.targets` as #1098 places
  them; origin's reads `repo`, the URL's reads `read`, its `first` a `session:` or `ev:` handle that `deep read`
  resolves to text holding the URL. Card: `asks.card`, its `saves.scope` null or "this ask only", no option's label
  naming a repo or "always".
- **AC4** (`answerProblems`, `exitZeroProblems`, `replayProblems`). The helper's log shows the hub's challenge for the
  ask and its signature; `deep inbox answer` exits 0; one `ask.answered`; the retried call runs, one `tool.after` for it;
  the bare repo's `main` is the session's commit. Refused is #880's: exit 3, the output naming the path or the ask, no
  closing event and no decision.
- **AC5** (`credentialProblems`, `credentialHits`). `GET /env` holds `SHOP_API_KEY` and no copy of the value; `/call`
  reports 200; the sample API got the value in `Authorization`. The search covers every evidence file (unpacked), the
  transcripts, the hub's other files, the checkout, and the record's rows through `events.read`, for the value raw,
  base64, reversed, and XOR'd with `0x5a` (bytes and hex). The padding is the test's own text and isn't read. Control:
  the stand-in reversed, which `call-api.sh` prints, must be found in evidence, so the search reaches what the session
  printed.
- **AC6** (`vendorProblems`, `timingProblems`). Denied with the extension's own words, `vendor/pay-sdk.js` unchanged,
  deep-hook's reply within 500 ms. The trust check's cost is #881's reading: two hosts on the fixture's padded record
  with the hub stopped, the same extension on P with the trusted project and on C with none; the session's own
  `tool.before` rows replayed through both in turn, 100 calls a side, five runs, P's p95 minus C's, void unless the
  timed replies carry the extension's deny on the replayed `vendor/` edit; PASS when all five
  are under 1 ms, FAIL when all are past it by the margin, otherwise `INCONCLUSIVE`, which fails the test with that word.
- **AC7** (`reportOf`). See below.

### The run's report

The issue says "the run's report" and no surface has one: the harness's run line has one verdict for the run, and
`deep report` doesn't exist yet. The smallest honest reading: **the report is `report.json` in the proof folder**, one
line per step of the script, written by `reportOf` from that run's hook replies and record rows. A step reads PASS only
with its reply, its rows and no problem; with either missing, INCONCLUSIVE, and the run never PASS. A live run the
harness didn't pass fails before any report. The AC7 test holds the report to PASS on the whole run first, then takes
each step's reply, then its rows, away.

## Wrong programs

Each runs after the main checks, on the same world, and must fail its criterion's check naming what the issue says. Each
test ends by asserting the main check passes, so a wrong program can't pass on a check that fails everything.

| Issue's name | How it's planted | Fails naming |
|---|---|---|
| the pre-#1097 reader | deep-hook built from `fad1c4cb` (#1097's merge base) with `git archive`, under `target/base-1156/` | the call |
| the copy-less stager | `DEEP_HUB_PLANT=stages-without-copy`, **new: the implementer adds it** | the command |
| the all-`repo` matcher | the asks core's `push-target-as-repo` option (#1098), in `fixtures/core.mjs raise`, on the session's record | the URL |
| the exit-0 helper | #880's script at the helper's path | the path |
| the replayed signature | #880's helper in `replay` mode, the signature captured for the earlier ask | the ask |
| the by-value environment | `DEEP_HUB_PLANT=env-loads-by-value` (#1106) | the evidence file |
| the per-call trust reader | `fixtures/core.mjs per-call`: the real host handed a reader that walks the record through `record.read` at each call | the extension |

`twins.json` gives the proof lane a wrong program for each criterion whose tests pass on the base: `stages-without-copy`
(AC2), `proceed-covers-turn` (AC4: no ask, so nothing to answer), `env-loads-by-value` (AC5), each a whole
`packages/hub/src/plant.ts` that keeps the base's exports, and `trust-read-per-call` (AC6), a whole
`packages/record/src/trust.ts` with the query main ran before #881. A twin of `plant.ts` must keep up with that file's
exports.

## What the implementation adds

1. What makes AC1 and AC3 pass: see `BASE-FAILURE.txt`. A plan naming `{kind: 'remote', ref}` targets is enough for the
   placing: raised by hand on this session's record, the README's URL read `read`, citing the README's message.
2. `stages-without-copy` in `Plant` and `PLANTS` of `packages/hub/src/plant.ts`: the stager lets the call through with
   its `command.staged` row and keeps no copy.
3. The harness scenario `risky-calls`: `--workdir`, `--script <file>` typed word for word as the prompt; your user
   settings loaded, never the checkout's; Bash, Read, Edit and Write allowed; the turn goes on past a stop DeepBuild
   answers `proceed`; ends with `/exit` after the turn that says `Done.`.
4. `scripts/lanes.mjs`: `tests/acceptance/1156/fast.test.ts` in `alone`, `tests/acceptance/1156/session.live.test.ts` in
   `byHand` or a lane of its own for the local preflight on the reference Mac, as the Scope says.

## Calls where the issue left a choice

1. **A push needs a proceed to be held.** At the base `git push origin main` is held only in the turn a proceed starts
   (#321; `authority-push` is `watch`). The issue's script has no such stop and says the rules stay their own issues'.
   So the session stops on "Want me to push to main?", and #321's planted sorter (`DEEP_HUB_TEST_SORTER`; #84's real one
   isn't built) answers `proceed`. This passes whether the implementer keeps #321's rule or holds every push. If the
   owner means every push is held with no proceed, a redraft drops that stop.
2. **AC1 with `deep setup`'s own rules.** At the base `"$(printf git)" push origin main` is let through: it meets
   `authority-push`, a watch entry, and no `fail_closed` entry takes a push. #1097's suite added a `fail_closed` block
   entry of its own (`t-push`). This suite doesn't: such an entry would deny `git push origin main` outright and AC3 could
   never hold it on a plan. The test holds the issue's words on the defaults, so it fails at the base; how it comes to
   pass is the implementer's.
3. **The prompt names no remote.** The issue says "push to origin", but a prompt naming `origin` places it `you` under
   #1098, and AC3 wants `repo`. The prompt says "commit the fix and push it"; live, the commands sit in `SESSION.md`, a
   file the session reads, for the same reason.
4. **`clean.sh` sets `OUT=out`** on its first line, so its reach can be read as `out/`. Left unset its reach is unknown
   and the call is asked about, against AC2.
5. **"Earlier ask".** The origin ask comes first, and it must still be open for the yes, so its signature is captured
   with a cancelled prompt and replayed for the README's ask, which then stays open; a no closes it before the stop.
6. **Hub stopped, live**: see The session.
7. **A deadline for the extension's deny**: deep-hook's whole reply, spawn included, within 500 ms; on a machine at load
   40 it took tens of ms at the base.
8. **The run's report**: above.

## Files

- `fast.test.ts`, `session.live.test.ts`: one test per criterion, and the seven wrong programs in the fast file.
- `helpers.ts`: the world, the session, the readings, the report, the wrong programs.
- `fixtures/`: `checkout-web/`, `vendor-guard/`, `core.mjs`; `launcher.c`, `helper.mjs`, `launchd.mjs` (#880's),
  `claude-code.mjs`, `claude.sh` (#668's).
- `twins.json`, `twins/`: see Wrong programs.
- `BASE-FAILURE.txt`: the run at the base.
