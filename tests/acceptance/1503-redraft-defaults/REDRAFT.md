# #1503 AC1 blind redraft (defaults): the merge base's deep-hook meets the defaults it shipped with

AC1's wrong-program test in `tests/acceptance/1503/inline.test.ts` runs deep-hook built from the pinned merge base
`c12a65bb` (`../1503/helpers.ts`, `BASE`, `buildBase`) against a home whose first `rules.json` is the checkout's
`crates/deep-hook/default-rules.json` (`stoppedHome` calls `seedDefaults`). When the suite was written the checkout was
that commit, so the two matched. The checkout's file has since gained `no-delete-past-worktree`
(`effect:unrestorable-delete`), whose match the pinned reader doesn't know: the pinned `matcher.rs` `known()` accepts
`effect:<class>` only for a class in `EFFECTS` (`cloud-resource`, `dependency`, `service`, `top-level-folder`,
`unknown-reach-delete`, `discard-edits`, `drop-stash`, `push`, `pr`, `merge`, `dispatch`, `send`, `delete`), and
`unrestorable-delete` isn't one. The pinned `main.rs` `rules()` maps every entry through `guard()`, which requires
`matcher::known(match)`, and fails the whole file on the first entry that isn't one ("has an entry
no-delete-past-worktree that isn't a guard@1 entry"). `forward()` then sets the denial for every PreToolUse, so with
the hub stopped the merge base denies every call, exit 2, the six AC1 calls included, and never shows the fault the
test is about. The other entries added since the pin (`no-approval-tag-sign`, `no-approval-tag-push`, both
`shell:…`) and the widened `write:`/`read:` path lists are ones `known()` reads; only `no-delete-past-worktree` is
unreadable to the pinned reader.

The redraft keeps the test's scenario, judge, assertions and messages, and changes only the home the merge base's
deep-hook runs on: it starts from the merge base's own shipped `default-rules.json`.

## Inputs read

- `AGENTS.md`.
- Issue #1503, `gh issue view 1503 --repo windoliver/deepbuild` (title and body only: statement, Scope, the five
  criteria, Proof, Overlaps, Depends on). No comments, no linked pull requests.
- `docs/technical-design.md`, found by search: the Wrong programs bullet, the Proven on the base bullet, the Dogfooding
  paragraph, and the opening paragraph of Before each command. Threats, and what stops each one was not reread: the
  test's scenario doesn't change. To learn whether a new blind suite's files may hold comments I also read the repo
  guards bullet (the comment ratchet) and `scripts/comment-ratchet.mjs` lines 12-13 and 100-160: a blind suite's file
  not yet landed has a ceiling of zero, so the redraft's `.ts` files hold no comments and this file carries their
  explanations.
- The frozen first draft `tests/acceptance/1503/`: README.md, BASE-FAILURE.txt, helpers.ts and inline.test.ts in full;
  the folder's listing (no other file opened).
- At the pinned merge base `c12a65bbe9c0fa26a677b2fd65e12146b3a24016` via `git show`: `crates/deep-hook/default-rules.json`
  (entry names, matches, modes, `fail_closed`, the set of fields), `crates/deep-hook/src/matcher.rs` lines 20-140 (the
  match kinds' doc, `CLASSES`, `EFFECTS`, `known()`), `crates/deep-hook/src/main.rs` lines 160-240 (`Guard`, `Rules`,
  `rules()`, `standing()`), the head of `guard()` (from line 285), and lines 1095-1125 (`forward()`, where an
  unreadable `rules.json` becomes the denial).
- At the base commit `0beb4a141`: `crates/deep-hook/default-rules.json` (entry names, matches, modes, `fail_closed`,
  the set of fields).
- For form: `tests/acceptance/1097-redraft-defaults/` REDRAFT.md, base-defaults.ts, computed.test.ts, tsconfig.json.
- The hub, at the base commit (the checkout), only to learn whether `deep hub run` writes `rules.json` (below):
  a search of `packages/hub/src` for `rules.json`; `guards.ts` lines 40-42 (`shippedRules`), 80-100
  (`restoreShipped`), 195-235 (`rewriteRules`, `writeStanding`, `dropEntries`, `writeRejected`); `server.ts` lines
  1040-1075 (the hub's `rules()` reread and rewrite); `setup.ts` lines 60-75 (`setUpFirst`), 85-120 (`install`, which
  calls `installRules`) and 355-385 (`installRules`); `session-memory.ts` around line 529-535 (`writeStanding`'s
  caller); `packages/cli/src/main.ts` lines 397 and 425-442 (`setUp` and the `hub` branch); a search of
  `packages/hub/src/hub-command.ts` for `setup`, `setUp`, `installRules` and `rules` (no hit); `packages/hub/package.json`
  `exports["./hub"]`.

I never read any implementation of #1503, a branch, a pull request, a diff or another worktree, and ran no git command
that changes anything.

**What reached this job beyond its inputs:** the base run's failure, in its instructions: on main `9fd3774c7`, macOS,
2026-11-27, `tests/acceptance/1503/inline.test.ts` › "AC1 (wrong program) deep-hook on the merge base allows all of
them and fails this test, naming the call" fails: the merge base's deep-hook exits 2 on every call,
`expected 'deny' to be 'allow'`, stderr "~/.deepbuild/rules.json has an entry no-delete-past-worktree that isn't a
guard@1 entry, so deep-hook can't check its guards while the hub doesn't answer"; every other test in the file passes;
the cause named there (`seedDefaults` seeds the checkout's defaults, which gained entries since the pin). I checked
that cause against the pinned `known()`/`EFFECTS` and the two `default-rules.json` files, not against any history.

## What changed

| Original (path › describe › it) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/1503/inline.test.ts` › AC1 #1503.22d68710 python3 -c and node -e writing agent config or rules.json, or reading the control token, are denied with the hub stopped › AC1 (wrong program) deep-hook on the merge base allows all of them and fails this test, naming the call | #1503 AC1 | The pinned reader can't read the checkout's defaults (`no-delete-past-worktree`, `effect:unrestorable-delete`, isn't in its `EFFECTS`), so with the hub stopped it denies every call, exit 2, naming no guard. The judge still throws naming the first call (its denial names no guard), but the last expectations, that the merge base allows each call, fail: `expected 'deny' to be 'allow'` (the base run) | `tests/acceptance/1503-redraft-defaults/inline.test.ts` › the same describe › AC1 (wrong program) deep-hook on the merge base allows all of them and fails this test, naming the call (redraft defaults) |

## The seeding choice

`stoppedBaseHome()` (`base-defaults.ts`, the redraft's one local addition) is the frozen `stoppedHome()` with one
change: its first `rules.json` is `seedBaseDefaults(home)`, which writes `git show
c12a65bb…:crates/deep-hook/default-rules.json` verbatim as `<home>/.deepbuild/rules.json`, where `seedDefaults` writes
the checkout's. It then starts `deep hub run` on that home and stops it by its PID, as `stoppedHome` does (with no
`whileUp`, which the AC1 test never passes). Why that file:

- **It is the wrong program as a whole.** The design's Wrong programs: "For a fix, the merge base is that program."
  The merge base's deep-hook shipped with that `default-rules.json`; every entry in it is one the pinned reader reads
  (its `effect:` classes are all in `EFFECTS`, its other kinds in `known()`, each entry has exactly guard@1's six
  fields), and the first draft's own base run passed this test with exactly that file seeded (BASE-FAILURE.txt: the
  pinned merge base was the checkout then).
- **The criterion's entries are in it.** `no-agent-config-write` (`write:` … `~/.claude/settings.json` …),
  `no-deepbuild-home-write` (`write:~/.deepbuild ~/.deepbuild/* …`) and `no-control-token-read`
  (`read:~/.deepbuild/control.token`) are all block and `fail_closed` there, so the judge's guard lists (`SETTINGS`,
  `HOME_WRITE`, `TOKEN`) name entries the home holds.
- **Not a filtered copy of the checkout's file.** Dropping the entries the pinned reader can't read would have the
  test decide by a rule of its own which those are, and its home would move with every new default; the pinned file
  never moves.

**The hub doesn't put unreadable entries back.** From the base commit's hub code (read as listed above): the only path
that adds shipped entries to an existing `rules.json` is `installRules`, called from setup's `install`, reached by
`deep setup` or by `setUpFirst` through the CLI's `setUp`; the CLI's `hub` branch calls `hubCommand` with no `setUp`,
and `hub-command.ts` names no setup or rules writer. While running, the hub writes `rules.json` only through
`rewriteRules` (`writeStanding` adds a `standing` member when your decided standing rules differ from the file's,
none on a fresh home; `dropEntries` and `writeRejected` act on memory lessons and rejected directions, none here),
which keeps every entry it read, and through `server.ts`'s `rules()`, which writes the file back as it last read it
only when it can't be read. So the stopped hub leaves the merge base's defaults as seeded. I did not trace every
caller of `writeStanding` past `session-memory.ts`; a `standing` member it might add is one the pinned `rules()` reads
(`standing()`).

**The wrong program still fails for the criterion's reason.** On the merge base's defaults the pinned reader reads
`rules.json`, finds `fail_closed` entries, and matches each call: an interpreter's inline text isn't read, so none of
the six calls meets an entry and each is allowed with the hub stopped (as the first draft's base run showed on the same
file and binary). `judgeDenied` throws on the first, "`python3 -c "open('…/.claude/settings.json','w').write('{}')"`
(plain path) must be denied with the hub stopped: …", which names the call; each `decision` is `allow`.

## Kept as they are

- **The redraft file runs in the original's place.** The whole `tests/acceptance/1503/inline.test.ts` goes by hand,
  so this folder's `inline.test.ts` holds every test the original has: AC1's right-program test, AC1's redrafted
  wrong-program test and AC2's describe (unaffected by the base failure, carried so nothing the original ran is lost).
  The other first-draft files (`unread.test.ts`, `twins.test.ts`, `corpus.test.ts`) are not redrafted; none failed in
  the base run as reported.
- The case lists (`ac1`, `AC2_CASES`), the guard lists, `judgeDenied`, every expectation and message, the `beforeAll`
  build, `afterEach(cleanup)` and the timeouts are copied exactly from the original. `observe` is the original's with
  one change: it takes the stopped home as an argument, `stopped`, in place of calling `stoppedHome()` itself. The
  right-program test and AC2's test pass the frozen `stoppedHome`, which is what the original's `observe` called; the
  wrong-program test passes `stoppedBaseHome`. That argument is the only change in those two tests' bodies.
- The `describe` titles and the right-program and AC2 `it` titles are the originals' word for word; the wrong-program
  `it` title is the original's with ` (redraft defaults)`.
- Everything else comes from `../1503/helpers.ts`, imported unchanged; `base-defaults.ts` imports `BASE`, `REPO`,
  `makeHome`, `rootOf`, `startHub` and `stopHub` from it.
- No comments in the `.ts` files (the comment ratchet gives a new blind suite's file a ceiling of zero); the
  original's comments are not carried, and their content is in the first draft's README and here.

## Run

```sh
npx vitest run --root tests/acceptance/1503-redraft-defaults --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1503-redraft-defaults/tsconfig.json
```

With the setup of `tests/acceptance/1503/README.md` (the hub and CLI built; `buildBase` builds the pinned deep-hook
under `target/base-1503/`). 3 tests in 1 file. The type-check is clean (Node v24.22.0); the tests were not run by this
job (another job builds in this checkout).
