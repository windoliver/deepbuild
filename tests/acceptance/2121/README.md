# #2121 — frozen blind acceptance tests

Inputs: issue.json supplied for #2121, base `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, AGENTS.md and the base design (How it installs, Privacy, Dogfooding). No implementation checkout or branch was consulted. Do not edit these tests to make an implementation pass; disputes require blind redraft.

## Requirement → test → base result

Each row is one test in `sync.test.ts`; soft assertions exercise the remaining scenarios even after a defect is found.

| AC / criterion tag | Observable checks | Observed on base |
|---|---|---|
| 1 `#2121.3e853d4d` | Propose, create **or** edit config, approve, `deep undo sync:<id>`; exact pre-apply text; config mode stays 0640 | Newly created file deleted; edited file retains server |
| 2 `#2121.8525e30d` | Install two files at A, update SKILL.md at B, propose run.sh at C; plan, `agents.read` pin/agents/differs=false, both paths in `agents/skills.json` | C conflicts; stored list lost run.sh |
| 3 `#2121.8fd04c79` | Real backup/restore into another temporary home; approve every restore plan found through `agents.read`; both servers listed and each `deep mcp-exec` prints its own marker; separate recorded skill restore | beta missing and cannot start; skill proposal returns staging ENOENT |
| 4 `#2121.6ec2cf13` | Actual process cut after first durable status/journal write; untouched target; restart reads dropped or proposed (and actually applies if proposed) | Reads applying |
| 5 `#2121.fba3943c` | Real git commits, initial script 0644, changed script committed 0755; approve; installed bytes and mode | New bytes, old mode 0644 |
| 6 `#2121.c9b234f1` | `agents.restart`, no execution before approval; exit-1 command with stderr; also binary removed before approval; one stderr line naming ask and cause | No diagnostic in either case |
| 7 `#2121.e0878cb4` | Staging exists at proposal, survives complete for undo, gone after decline/undo/VFS-dropped recovery/refused apply; undo restores original | All four terminal states retain staged copies |
| 8 `#2121.9c9dad1d` | Six separate local skills: sudo -E bash, /bin/sh, env bash, pipe-and, source and dot forms; ask must say audit stopped it and quote exact line | All six lack stop and quote |
| 9 `#2121.4afb7e83` | Exact planned paths including café.md; separately add linked.md symlink; refusal must name it as a link | Quoted/escaped café path outside skill folder; link accepted |

Tags use `scripts/proof-change.mjs` normalization: checkbox text including Markdown, trim, collapse whitespace, SHA-256 first eight hex digits. No-op implementations fail the positive plan/apply/read/file assertions in every test.

## Boundaries and scope

Real hub and CLI built here, real filesystem, git, approvals and SQLite backup/restore. Only the OS confirmation and Codex restart executable are stand-ins. No installed agent or sign-in is needed: these criteria observe sync files and hub methods, not agent loading. Child environments are allowlisted; every HOME/state/source is temporary. Cleanup owns child PIDs; the base Vitest cleanup also stopped two descendant processes left by the run. No repository hooks, production edits, exports or switches were added.

AC4's base VFS exposes `sync_intent` only **after** the journal, so it cannot reach the defect. `power-cut.cjs` wraps the OS filesystem boundary, performs the real directory fsync, then SIGKILLs its own hub before the next write. It cuts whichever of `agents/syncs` and `agents/journal` is durable first, so journal-first code is exercised too. It neither fabricates sync state nor imports production internals. AC7 uses the existing VFS's `cutAt: {kind: 'sync_intent', nth: 1}`. AC2 checks the full stored file list because the base page omits file lists from its skill rows; its public row, pin and differs are checked separately. AC3 discovers restore plans through the page, without prescribing a new multi-plan response shape.

## Exact commands and evidence

Build prerequisites **from this checkout**:

```sh
npm run build --workspaces
PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo build --locked --offline -p deep-hook
```

The run used Node 24.22.2 and the installed Rust toolchain directly (adjust tool locations on another host):

```sh
mkdir -p /tmp/deepbuild-2121.WRTSs6/runner-home /tmp/deepbuild-2121.WRTSs6/runner-tmp
export HOME=/tmp/deepbuild-2121.WRTSs6/runner-home TMPDIR=/tmp/deepbuild-2121.WRTSs6/runner-tmp
export PATH="/Users/$(id -un)/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/node@24/bin:/usr/bin:/bin"
node scripts/affected.mjs --list tests/acceptance/2121/sync.test.ts
node scripts/affected.mjs tests/acceptance/2121/sync.test.ts
```

`--list` selected only this test file, no WIDE lines. The final test report contains **9 failed tests / 9**, all named assertion failures above, no skipped or blocked criterion; duration 37.70 s. Full assertion output plus affected summary is saved outside the repo at `/tmp/deepbuild-2121.WRTSs6/base-failures.log` (user-home path components redacted). Builds and strict test TypeScript checking succeeded. Initial setup attempts (missing Cargo PATH, then missing deep-hook) are not defect evidence; the hook was built before the final run.

Runner deviation: affected also always runs its lint commands. Its summary was `FAIL affected: 189 new, 11 already failing on main, 0 inconclusive or blocked, 0 listed skips, 0 passed`; nine new failures are these tests and 180 are unrelated base lint findings. No WIDE or INCONCLUSIVE line was emitted. After Vitest wrote all nine results and its end marker, its `deep lease` wrapper hung with no children; only our owned wrapper PID 11120 was killed after about four minutes so affected could finish. Therefore **runner completion is INCONCLUSIVE**, despite the complete nine-test assertion evidence. The initial outer run was also interrupted. No checks were weakened, and no green implementation run, timeout-restart scenario or extra recovery-undo scenario is claimed.

Isolation deviation: an early process-list diagnostic was broader than intended and exposed unrelated command lines. No other checkout files, Git branches, or #2121 implementation were opened or used; subsequent process inspection was restricted to owned PIDs.

Frozen at delivery. Tests/helpers/preload total 261 lines; this README adds only mapping, reproducibility and deviations. SHA-256 hashes are in the delivery report.
