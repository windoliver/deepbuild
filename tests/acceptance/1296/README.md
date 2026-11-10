# Acceptance tests for #1296: a repo status line that shadows the forwarder, and the 10,000-character cap

Written blind from issue #1296 (Scope, its five acceptance criteria, Proof), `AGENTS.md` and `docs/technical-design.md`
("What each agent gives us, and the limits we design around", with Health reads the agent's side and Facts as data;
"Hook protocol (deep-hook and the hub)"; "Parallel sessions and plan limits", with Plan usage and What DeepBuild adds;
Reading by reference). The base is the tree of `0c4a4ec7` (the worktree's `96b462a6` holds the same tree after the
history rewrite), with no implementation of #1296. At the base I also read `packages/hub/src/doctor.ts` (the
`claude.statusline` item, `hooksOff`, the exit table), `setup.ts` (`withStatusLine`), `plant.ts`, `status.ts`,
`core.ts` (`buildReply` at SessionStart, `startSet`, typed rules), `ask-tasks.ts` (`brief`), `rules.ts`,
`crates/deep-hook/src/main.rs` (`statusline`), `packages/runner/src/runner.ts` (`report`), `packages/reading`
(`deep read`), `packages/conformance` (`kits`, `runKit`, `shippedFill`, fakes), `scripts/corpus.mjs` and
`scripts/proof-change.mjs`. The implementing agent doesn't edit these files; a dispute goes to a blind redraft.

## How to run

Node 24.22.0 and the Rust toolchain on `PATH` (the 19/doctor world runs `cargo build -p deep-hook`):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the deep CLI, the hub and the doctor
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/1296/ --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1296/tsconfig.json
```

The files start hubs, sessions and setup, so they belong on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), as
19/doctor and 340/flow do. No network, no model, no real `claude` (19's stand-in answers `--prompt`). Folders go under
`/tmp/dh19d-*`, `/tmp/dh340f-*` and the OS temp dir (`dh1296f-*`), removed after each file; every process is stopped
by its PID through the imported suites' `cleanup`.

## Criteria to tests

Each ID is `scripts/proof-change.mjs`'s `criterionId`: `#1296.` and the first 8 hex digits of the SHA-256 of the
criterion's text, trimmed, white space collapsed.

| Criterion | File | Tests |
|---|---|---|
| AC1 `#1296.f8f2af0a` (statusLine in the repo's settings: the doctor) | `doctor.test.ts` | clean repo: the status line OK; `.claude/settings.json` warns; `.claude/settings.local.json` warns; wrong program `statusline-user-settings-only` |
| AC2 `#1296.51fd7de6` (the session's window unknown; file untouched) | `windows.test.ts` | the shadowed session; wrong programs `window-unknown-as-zero`, `window-carried-from-other-repo` |
| AC3 `#1296.f9371fe0` (facts without the context-output entry) | `facts.test.ts` | the entry and the lane's failure without it; the control on the shipped facts |
| AC4 `#1296.edc2bba0` (the 14,000-character resume block) | `resume.test.ts` | delivered inside the cap, the rest by handle, the record; wrong program `sends-block-whole` |
| AC5 `#1296.8af9a270` (the kit's planted adapter) | `kit.test.ts` | `block-as-postcompact-stdout`; `block-as-stderr-exit-0` |

## The surface under test

- **`deep doctor --json [--prompt]`**, run with its working folder the fixture repo, in #19's world
  (`../19/doctor/helpers.ts`, `world`, imported): one doctor.item@1 per line. The shadow item is one whose `item` is
  `claude.statusline_shadowed`, or whose `code` is `statusline_shadowed` (or `claude.statusline_shadowed`), with
  `level: "warn"`, its `evidence` or `fix` naming the repo's file (its absolute path, or `.claude/<file>` and the
  repo) and the key `statusLine`; the doctor exits non-zero. In a clean repo no such item is above ok and every
  `claude.statusline*` item is ok.
- **`deep setup`** run in the shadowed repo (the world's working folder), and the user-level forwarder it installs:
  `~/.claude/settings.json`'s `statusLine.command`, run by `/bin/sh -c` with Claude Code's status line JSON on stdin
  (`session_id`, `cwd`, `workspace`, `rate_limits.five_hour` / `seven_day` with `used_percentage` and `resets_at`).
- **`deep status`** (text): a session's block is the line naming its ID's first 8 characters and the indented lines
  under it. The five-hour window is a line of the block matching `5 h`, `5h` or `five-hour`/`five_hour`; a reading
  shows as a percentage (`\d+%`).
- **`node scripts/corpus.mjs check --facts <dir>`**, the adapter-facts conformance case (as #1033's suite runs it).
- **The 340/flow world** (`../340/flow/helpers.ts`, imported): `deep hub run` with `DEEP_HUB_TEST_DRAFTS` and
  `DEEP_HUB_PLANT`, `deep-hook claude-code <event>` as a child of the session's process, `events.read`,
  `hookSpecificOutput.additionalContext`.
- **`deep read <handle> --json [--slice <cursor>]`**, following `next` until none.
- **The conformance kit**: `kits()`'s `adapter@1`, its `fakes`, `runKit(kit, fill, { headless: true })` and
  `shippedFill(<agent>)` from `packages/conformance/src/index.ts`.

## Open choices I made

1. **The shadow item's name.** The issue names `claude.statusline_shadowed`; I accept it as the item or as the code,
   since the base's items pair `claude.statusline` with codes like `statusline_missing`. Its level is `warn` (the
   criterion says it warns), and the doctor must exit non-zero although the base's exit table gives 0 for a warn.
2. **"The doctor reports OK"** in a repo without a status line: no shadow item above ok, and the status line items
   (`claude.statusline*`) ok. Not "every item ok, exit 0": at this base #19's world is no longer all ok here (the
   canvas items `canvas.gpu`, `canvas.headless` and `canvas.verdict` fail with the canvas binaries unbuilt, and
   `hub.service` and `app.notifications` read not checked), so the doctor exits 1 in every repo. The non-zero exit
   in the shadowed repos is still asserted, but in that world it proves nothing; with the canvas built and those
   items ok it does.
3. **Where the session's windows show**: `deep status`, the session's row (the design's "each session row").
   "Unknown" is the word `unknown` on its five-hour line, with no percentage on it; "naming the file" is
   `.claude/settings.json` in the block. A hub that shows 0% or carries over the other repo's 31% shows a percentage
   there, and the failure names the session's ID.
4. **The control for AC2**: the other repo's session, whose forwarder sent `five_hour.used_percentage: 31`, shows a
   percentage on its own five-hour line. Without a reading that lands, a carry-over hub has nothing to carry over.
5. **The context-output entry's name** is open: the test finds a key of `adapters/claude-code.facts.json`, at any
   depth, matching `^context[-_ ]?outputs?$` (`contextOutput` fits), and requires its JSON to hold `10000`, `2000`, a
   version and `PostCompact`. The lane's FAIL line must name that key and Claude Code.
6. **The planted resume block** is the context the SessionStart of a resume (`source: "resume"`, same session ID,
   after a SessionEnd) injects. It is planted through real surfaces: #340's three open asks (R1 to R12), five rules
   you type (`rule: <text>.`, one prompt each), and the repo's `AGENTS.md` with 54 rule lines `bulk-00` to `bulk-53`
   (13,661 characters; 14,018 with the typed rules and the IDs), which the base gives a Claude Code
   session as rules from your rule files. The planted parts are at least 14,000 characters (the test checks it); the
   base sends the whole context, 15,744 characters. The criterion lets only the requirement IDs and the typed
   rules be required inline, so the AGENTS.md lines are "the rest".
7. **What the model sees** is modelled from the issue's numbers: the whole `additionalContext` when it is at most
   10,000 characters, else its first 2,000. A hub that sends the block whole has the IDs after the rules, so the
   first missing ID is R1.
8. **"The rest goes by handle, with a line saying where to continue"**: a line of the context naming `deep read` or
   `deep_read` and a handle (a scheme of `HANDLE_SCHEMES`, or `wiki:`/`rule:`). `deep read` of those handles, every
   slice, together with the inline text, holds every `bulk-NN` marker.
9. **"The record says what went inline and what went by handle"**: an event of the session (its `session`, or data
   naming it), at or after the resume's `session.start` and not that event, whose data names a handle from the line
   and every requirement ID R1 to R12.
10. **The kit's planted adapters** are fakes of `adapter@1` (`kit.fakes`) named `block-as-postcompact-stdout` and
    `block-as-stderr-exit-0`. The first's failure names `PostCompact`. The second's names a Claude Code hook event
    (any of `helpers.ts`'s `HOOK_EVENTS`), the one it sent the block on. The shipped Claude Code adapter passes each
    case they fail.

## Wrong programs the implementer adds

`DEEP_HUB_PLANT` names go in `packages/hub/src/plant.ts` (`Plant` and `PLANTS`; a name the hub doesn't list stops it
from starting, so its test fails BLOCKED). The kit's two are fakes in `packages/conformance`. `twins.json` lists them
by criterion, with `plants-ignored`.

| Name | Where | Criterion | What it does wrong | How its test fails |
|---|---|---|---|---|
| `statusline-user-settings-only` | doctor (CLI side, env on the doctor only) | AC1 | reads `statusLine` only in your user settings, so a repo's own never shadows | `AC1 deep doctor must warn claude.statusline_shadowed in …` |
| `window-unknown-as-zero` | hub and status | AC2 | shows a session with no reading as 0% | `AC2 session <id> … shows a percentage` |
| `window-carried-from-other-repo` | hub and status | AC2 | shows a session with no reading the account's last reading, from the other repo | the same |
| `sends-block-whole` | hub | AC4 | sends the resume's SessionStart context whole, past the cap | `the first requirement ID missing from what the model sees is R<n>` |
| `block-as-postcompact-stdout` | `adapter@1`'s fakes | AC5 | sends a needed block as plain stdout of a PostCompact hook | a FAIL case naming `PostCompact` |
| `block-as-stderr-exit-0` | `adapter@1`'s fakes | AC5 | sends a needed block as stderr with exit 0 | a FAIL case naming the hook event |

`plants-ignored` is #19's twin form (`../19/twins/plants-ignored`): a copy of the implementer's `plant.ts` whose
`plantOf` and `activePlant` return nothing, so each wrong-program test fails. It and an `always-<name>` copy per plant
are folders under `twins/` that the proof lane needs only for a test that passes on the merge base; the implementer
builds them on its own `plant.ts`, since a copy of the base's would go stale.

## On the base

Run once (`BASE-FAILURE.txt`): 11 of 13 tests fail, 2 pass.

- AC1: both shadowed repos fail at their first assertion (no `claude.statusline_shadowed` item). The clean-repo test
  passes, by design. The wrong-program test passes too: the base reads only user settings, as the plant does, so the
  helper throws its expected message. On the implementation it needs the plant, and the proof lane needs the
  `plants-ignored` twin to see it fail.
- AC2: the shadowed session's row shows no five-hour window (`must show its five-hour window`). The two
  wrong-program tests fail BLOCKED: the base's hub refuses a plant it doesn't list.
- AC3: no context-output entry, in both tests.
- AC4: the resume's context is 15,744 characters, and the first ID missing from the 2,000-character preview is R1. The
  wrong-program test fails BLOCKED (plant not listed).
- AC5: `adapter@1` holds neither planted adapter.

## Files

`helpers.ts` (tags, the cap and preview, hook event names), `doctor.test.ts`, `windows.test.ts`, `facts.test.ts`,
`resume.test.ts`, `kit.test.ts`, `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt`. No fixture holds a secret or
personal data; IDs, paths and rule texts are made up.
