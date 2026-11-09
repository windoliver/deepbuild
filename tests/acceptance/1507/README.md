# Acceptance tests for #1507 — deletes past the worktree

Blind base: `a3efe5c80f7844578c11ff5539f4943e5999e0f4`.
**Validated red on the base:** four tests fail at their named missing-behavior assertions;
AC4 already passes and is retained as a regression guard. Typechecking passes.
`BASE-FAILURE.txt` contains the actual final Vitest output, with only the checkout's
absolute path replaced by `<base-checkout>` for privacy. No implementation was consulted.

## Sources

- The supplied issue #1507: Scope, all five checkbox criteria, Proof and dependencies.
- `docs/technical-design.md`: Before each command, A broken hub, Dogfooding,
  Definitions fixed at the start and copy-on-write platform requirements.
- Base checkout conventions in `tests/acceptance/347` and `tests/acceptance/1294`:
  READMEs, helpers, tsconfig and fixtures. Both fixtures here are independent copies
  from #1294, never imports from another suite; existing notices remain intact.
- Base public/protocol code: `crates/deep-hook/default-rules.json`, the hook matcher,
  hub staging/undo, `adapters/claude-code.facts.json`, package/TypeScript configuration.
- `scripts/proof-change.mjs`: criterion IDs are `#1507.` plus the first eight hex digits
  of SHA-256 of the criterion text, trimmed with whitespace collapsed. Backticks and
  punctuation are retained. All five IDs were recomputed from the supplied text.
- `scripts/affected.mjs`: affected-check verification.

No other checkout, branch, implementation or model was read. No network data was obtained.
The implementing job must not edit these tests; disputes return to the blind job.

## Run

Requires Node 24.22+, installed workspace dependencies, the pinned Rust toolchain,
macOS/APFS and `/usr/bin/cc`. Use provisioned offline dependencies/toolchain; do not
fetch them during this blind job. The second pass used the builds the user had already
completed, without rebuilding or installing anything outside this acceptance folder.

```sh
TEST_HOME=$(mktemp -d /tmp/dh1507-run-XXXXXX)
export HOME="$TEST_HOME" TMPDIR="$TEST_HOME"
export npm_config_offline=true npm_config_update_notifier=false
export npm_config_cache="$TEST_HOME/npm-cache" CARGO_NET_OFFLINE=true
# Provisioning, when needed (requires an offline cache and pinned toolchain):
npm ci                                  # only if node_modules is missing
npm run build --workspaces
cargo build --locked -q -p deep-hook
# Acceptance and typecheck:
npx vitest run --root tests/acceptance/1507 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1507/tsconfig.json
# Repository verification:
node scripts/affected.mjs tests/acceptance/1507/reach.test.ts tests/acceptance/1507/helpers.ts
```

The test file also sets the 600-second test/cleanup budget for runners that omit the
CLI flag. Each test owns its hub. The implementer should register this folder for
one-at-a-time execution beside #347/#1294; this job changes no lane configuration.

## Surfaces chosen and safety

- Real `deep hub run`, real `deep-hook claude-code <event>` with fixture transcripts
  at the newest covered version, and real `/bin/bash -c` after an allow. No model,
  fake guard, database writes, private implementation imports or planted matcher.
- Each session has a long-lived fixture parent for its hooks. Undo runs outside the
  session process tree, through `deep undo staged:<event id>`, with the existing
  `DEEP_HUB_TEST_CONFIRM` OS-confirmation seam.
- Real `events.read` through the CLI socket role: `tool.before`, `ask.created` and
  `command.staged`, the latter keyed by `data.call`. Shipped default rules are copied
  into each home. Staging settings use the existing `files`, `seconds: 20`, `keep: 3d`
  surface; AC1 sets a two-file ceiling and supplies at least five files.
- Every world is an owned `/tmp/dh1507-*` folder: home `h/`, worktree `h/work/repo/`,
  sibling `h/work/sibling/`, temporary folder `t/`. Home contains the worktree even
  though this disposable world lives under `/tmp`.
- `safe()` checks canonical paths, ownership, the temporary prefix and containment,
  and verifies home is neither the real OS-account home nor its ancestor. It uses
  `userInfo()` rather than trusting overridden HOME, before every session and again
  immediately before shell execution. Child environments are allowlisted, with
  HOME/TMPDIR/XDG paths isolated and no inherited billing keys or shell-init settings.
- Incorrectly allowed `rm -rf tests/ plan/ ~/` and `rm -rf ~/` really execute with
  **test HOME only**. Evidence is read before destruction; a deleted transcript does
  not mask the named assertion. Fixtures hold random bytes, not credentials.
- `/tmp/x` is the criterion's literal hook input but is never executed: that global
  path is not owned by the test. The other free commands execute and their effects
  are checked. This is a deliberate safety limit, not a substituted command.
- Only owned ChildProcess instances are stopped, by PID. The agent fixture likewise
  owns and stops its hook children. No process-name, port or process-group kills.
- APFS private-size measurements, compiled inside the world, prove a copy-on-write
  clone exists at allow, before deletion. Restoration is checked by SHA-256.
- Missing or late live delivery throws BLOCKED/INCONCLUSIVE, never PASS or accepted
  matcher-failure evidence. No test retries until a desired outcome appears.

## Requirement → test → base proof

Exactly one Vitest test per criterion, in `reach.test.ts`:

| Criterion ID | Required behavior checked | Observed base result |
|---|---|---|
| AC1 `#1507.38331cb5` | Mixed local/home delete past ceiling: hold before timeout, exactly one authority ask identifying the command and known home reach, original bytes kept, no completed staging | `HOME_NEVER_UNSTAGED`: command allowed and executed, no staging, **0/5 files kept** |
| AC2 `#1507.56b942ba` | Untracked sibling: clone and recorded staging before run, delete succeeds, no ask, undo restores every byte | `STAGED_BEFORE_RUN`: **2 files deleted**, no clone or staging |
| AC3 `#1507.0ecedf02` | Both forced clean commands, separate worlds: ignored `.env` for `-fdx`, untracked file for `-fd`; clone, record, delete and undo | `STAGED_BEFORE_RUN` for **both** commands, each deleting its file without clone or staging; failures collected |
| AC4 `#1507.04e8286c` | node_modules/build deletes, literal temp-delete hook, dry-run clean: allowed, no staging or ask; local effects verified | **PASS on base**, regression guard; no artificial contrast or invented failure |
| AC5 `#1507.0f4ac05d` | Stop the owned hub PID after session start: home delete denied, denial names a guard, home intact | `HUB_DOWN_DENY`: command allowed and executed with hub stopped, home file gone |

AC1's base is the issue's named wrong program: a matcher covering only unknown reach.
It proves actual loss through the session surface, not an implementation predicate.
AC4 checks effects as well as hook replies, so a no-op driver cannot satisfy it.

Ask wording is not an exact sentence: it must identify the command, name home by name
or expanded path, describe its reach and not call the known reach unknown. The offline
guard ID is not hard-coded, allowing a renamed entry or a dedicated guard.

## Verification record and limits

- First executable direct run: four expected failures, AC4 passed; tsc exit 0.
- `affected.mjs` then ran once. It selected only this test file, plus its built-in
  repository lints; **no WIDE lines**. It ended FAIL: 128 new findings, 3 known,
  14 inconclusive/blocked, 1 passed. This is not an acceptance-proof result:
  - AC1 and AC2 were INCONCLUSIVE because hooks spooled without a timely hub reply
    under load (reported load 266).
  - AC3 hit that runner's default 5-second timeout; this drafting defect was corrected
    by setting the same 600-second budget in the test file.
  - AC5 reached its expected assertion and AC4 passed.
  - Canvas lint was BLOCKED on an unavailable offline Cargo dependency.
  - Eleven known-failure entries were INCONCLUSIVE: the runner's automatic issue
    lookups attempted `gh`, which stopped at the missing-authentication prerequisite.
    This automatic lookup was an unintended verification side effect; no issue text
    was obtained and no credentials or network access were supplied.
  - Unrelated base findings included secret/path lint, dependency lists, cards, slot
    kits, drift, record reader, guide and panel catalogue. They were not changed.
    The one suite-local finding, an absolute home path in saved output, was redacted.
- After these harness/privacy corrections, only the affected direct suite and tsc
  were rerun: **4 expected assertion failures, AC4 passed, tsc exit 0**. Final direct
  output is saved in `BASE-FAILURE.txt`. Repository-wide affected lints were not rerun.
- Undo and authority-ask/guard-wording assertions are encoded but not reached on this
  base: earlier required behavior fails. No passing implementation is claimed.
- Scope also names unlink, shred, find-delete, rsync-delete, non-git working folders
  and other containing paths. This five-criterion suite does not exhaust those
  spellings or test design prose. Seconds ceilings and retention belong to #347.
- Scratch `.build-home`, `BUILD.txt`, `AFFECTED.txt` and `TYPECHECK.txt` were removed.
  Only the requested suite files remain. No source/check configuration was changed,
  no full preflight was run, and nothing was committed.
