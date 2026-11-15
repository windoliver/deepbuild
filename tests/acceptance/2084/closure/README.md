# Acceptance tests for #2084: a held heavy-command call keeps its `deep lease` rewrite

Drafted blind from `issue-2084.json`, `AGENTS.md`, `docs/technical-design.md` and the base checkout
`b9131dbd9857aefc4dcc39dd0d534d007b1ef671`. Nothing existing was edited; the implementation was not seen. These tests
have not been run by their author: no builds or tests were allowed in this job. The first run is the implementer's.

## Files

| File | Holds |
| --- | --- |
| `closure.test.ts` | AC1 and AC3, read from one real run of the two original #1015 files |
| `held-reply.test.ts` | AC2, and Scope's second bullet (Codex's one denial), on #1015's helpers |

## Criteria and tags

Tags are `#2084.<first 8 hex of SHA-256 of the live criterion text, trimmed, whitespace collapsed>`.

| Criterion | Tag | Test |
| --- | --- | --- |
| AC1 the two #1015 files pass on main, unchanged | `#2084.2c4c3709` | `closure.test.ts` |
| AC2 two changed sessions: first `cargo test --workspace` after prompt rewritten, holds `cpu.slot`, sibling notice still reaches it | `#2084.ef9a3ee6` | `held-reply.test.ts` (Claude case; the Codex case is Scope's denial, tagged the same) |
| AC3 until then the two cases are listed in `scripts/known-failures.json` with #2084 | `#2084.76e6811e` | `closure.test.ts` |

## What each test does, and how the base fails it

- **AC1.** Checks the two #1015 files, `helpers.ts` and the two fixtures against the base's SHA-256 ("unchanged"), runs
  `claude.test.ts` and `focused.test.ts` in a vitest child (`--reporter=json`, `--no-file-parallelism`, no `VITEST*` or
  `DEEP_PROOF*` env), and requires every test in the report to be `passed`, the two tagged cases reported. Nothing of their
  assertions is copied. **Base failure:** at `every test of the two #1015 files must pass`, listing
  `claude.test.ts › … AC1 #1015.081f8373 … [failed]` with its own message (`the sixth command … started while 5 others ran`)
  and the `focused.test.ts` AC3 case with `must be rewritten into its deep lease form`.
- **AC2.** Real hub, deep-hook, `deep lease` and record. Sessions A and B in two worktrees of one repo both Edit
  `README.md` (each has changes); A edits it again, so a notice waits for B and B's next call is held. B's first
  `cargo test --workspace` after its prompt must (1) be rewritten to `deep lease`, (2) carry the sibling notice naming A and
  `README.md` in the same PreToolUse reply, matching a new `notice.delivered` to B in the record, and (3) hold a `cpu.slot`
  under B while it runs. **Base failure:** at (1), `must be rewritten into its deep lease form`, with the empty
  stdout the issue describes. The Scope test: a Codex B, held after A's change, must be denied once with a backticked
  `deep lease` form; **base failure:** `must still be denied once`.
- **AC3.** Temporal reading of "Until then ... listed ... with this issue", decided from the same run as AC1: a target case
  that fails must be listed in `scripts/known-failures.json` under its exact id (`<file> › <describe> › <test>`) with
  `(#2084, added <date>)`; a target case that passes must not be listed; no `(#2084, …)` entry may stand for a case that
  passes. So it is observable and honest on every state: failing and listed passes; failing and unlisted fails;
  fixed and unlisted passes; fixed and still listed fails (stale exemption). **Base failure:** both cases fail and the file
  lists neither, so `… must list it by that id with (#2084, added <date>)`.

## Run

Build first (`npm run build --workspaces`, `target/debug/deep-hook`), as #1015's own README says. Then, frozen:

```
npx vitest run tests/acceptance/2084/closure/closure.test.ts tests/acceptance/2084/closure/held-reply.test.ts --no-file-parallelism
```

Or `node scripts/affected.mjs` on the change. Both files start hubs and sleep on real time; the implementer adds their
folder to `alone` in `scripts/lanes.mjs` (the one-at-a-time list) and `closure.test.ts` to `slow`, since it runs ~4 min or more.

## Provenance

Reused unchanged: `tests/acceptance/1015/helpers.ts` (`World`, `Session`, `claudeCall`, leases, `allEvents`) and its
fixtures; the original `claude.test.ts` and `focused.test.ts` are the AC1 target, run as a child and pinned by hash.
Edit payloads and transcript entries follow #352's `ClaudeSession.edit` (`tests/acceptance/352/helpers.ts`). The notice
sequence (a session with changes marks its siblings for a held next call; a sibling's later edit of the same file
queues a notice for it) is read from the design's "Sessions that know about each other" and from `siblings.ts` as the
base has it, for which edits and calls to script; the assertions are on hook replies, the record and the lease table only.

## Gaps and risks, unresolved

- **Not run.** The AC2 sequence (A edit, B edit, A edit again, then B's `cargo`) is the author's reading of how a held
  call and a pending sibling notice coincide; if the fixed hub does not hold B's call or queue that notice there, the
  test would fail on the fix and the dispute goes to a blind redraft, not an edit.
- **AC3** has no state a fixed tree can show in `known-failures.json` beyond absence: it can only fail on the base by the
  missing listing, as the temporal wording demands. It also reads the two cases' ids from the child run, so it can't
  tell a case that is listed under a differently shaped id; the exact id is the one `scripts/affected.mjs` forms (`file › describe › test`).
- **Load.** deep-hook spools a hook past 50 ms; a spooled AC2 reply fails `INCONCLUSIVE`, never as a pass or a wrong-program failure.
- **Codex notice.** The Scope test shows the denial under a hold but doesn't assert a notice on a Codex call.
- The #1015 files' timing assertions (AC1 of #1015) are load-sensitive; a failure of the child on a loaded machine is a failure here.
