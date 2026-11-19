# Acceptance tests for #2403: the app speaks your language

Every word the app draws of its own comes from one table, Simplified Chinese is the first language after English, and a
word outside the table fails a lane. Written first and blind, at base commit `c21400b43`, from issue #2403 (updatedAt
2026-11-19T01:33:58Z, no comments: its problem, Scope, seven acceptance criteria and Proof), the design and the base,
before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- Issue #2403; epic #1324; #1299 (pieces' copy checks, open: no stale-translation check exists anywhere at the base),
  #1550 (chrome wraps in every script) and #1998 (the box) only for the words #2403 cites.
- `docs/technical-design.md`: States people see (the words table; a state is a code, never a phrase), Needs-you view,
  Replica, How runs become one of five verdicts (the five verdict words), How we know version 0 works (Wrong programs,
  Dogfooding). `docs/canvas-primitives.md`: Replica `deep_drive` (`launch` with `locale`, `see`, `notification`,
  `ui_check`), Text `text@1`: keyed copy (copy tables, plural forms by CLDR's cardinal rules at a pinned release, a
  translation recording the hash of its source string, `en-XA`), Question card (the card's own labels).
- The base, for its surfaces: `crates/deep-replica/src/drive/{mod,check,frames}.rs`, `snapshot.rs`, `lib.rs` (NOW,
  WINDOW); `crates/deep-app/src/{views,notify,lib,main,welcome,setup,plain,installed}.rs`, `inventory.json`;
  `crates/deep-canvas-marks/src/{copy,plural}.rs` and `cldr-1129998233/plurals.xml`; `scripts/{lanes,color-literal-guard,
  plant-lint,proof-change}.mjs`; `packages/hub/src/server.ts` (the test clock); the suites `1808`, `1461`, `1458`, `2026`,
  `124`, `1459`, `1462` (its probe), `883`, `994`, `1100`, `16`, `26`, `1463`. (`tests/acceptance/1592/` isn't in the base.)

## How to run

With Node 24.22 and cargo (1.99.1) first on `PATH`, Xcode's command line tools (`swiftc`), on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/2403 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2403/tsconfig.json
```

- **Builds.** Each file builds what it uses, one build at a time, with #1172's environment (`CARGO_INCREMENTAL=0`,
  `CARGO_PROFILE_DEV_DEBUG=0`), and copies each binary out of the target folder into
  `$TMPDIR/dd2403-bin-<uid>-<first 8 hex of SHA-256 of the checkout path>`: `deep-drive` with
  `--features deep-app/test-confirm` (plain) and `--features env-plants,deep-app/test-confirm` (planted), and `deep-app`
  as shipped. `CARGO_TARGET_DIR` is honored. `deep-hook` is built when missing (#1461's `needBuilds`).
- **The merge base's build** (AC1). The merge base is `git merge-base HEAD origin/main` (else `main`). Its tree is
  written with `git archive -o <dir>/base.tar <sha>` and extracted with `tar -x` into
  `$TMPDIR/dd2403-base-<uid>-<first 12 hex of the sha>/src`, never a worktree, and built there with its own
  `CARGO_TARGET_DIR` (`<dir>/target`) and the plain build's features; the binary is kept at `<dir>/deep-drive` and reused
  while it's there. The first build is a cold one (about 7 minutes at a load of 300 on 18 cores).
- **Permissions.** `asks.test.ts` (AC5) reads the real app's status item from outside its process: it needs Accessibility
  and an unlocked screen. `shown.test.ts` (AC7) also needs Screen Recording. Without them they fail `BLOCKED: …`.
- **Folders and processes.** Every HOME is a temp folder; nothing touches the real `~/.deepbuild`, `~/.claude`,
  `~/Library` or the system's languages (the real app's languages are set for its one process, by its arguments). Only
  what a test started is stopped, by PID. Replicas run with `TZ=UTC`.
- **Pictures.** AC7 writes to `$DA2403_SCREENS` (a temp folder without it). It reads INCONCLUSIVE until `TASTE.json`
  records a call on exactly that run's files.
- **`--root` cache.** Vitest writes `tests/acceptance/2403/node_modules/.vite/`; delete it before committing.

## The surface under test

The issue names the replica's `locale`, `ui_check`, "the table", "a lane", "the release check" and the accessibility
tree; everything else here is chosen, the smallest that fits, and marked *(chosen)* so a dispute can start there.

1. **The table** *(chosen)*: `crates/deep-app/copy/en.json`, the source, and one file per other language beside it,
   `crates/deep-app/copy/zh-Hans.json` first. A file beside `en.json` is a shipped language.
2. **`en.json`** *(chosen)*: a JSON object, key → entry. An entry is a string, or a plural entry: an object with `other`
   and any of `zero`, `one`, `two`, `few`, `many`, each a string. Placeholders are `{0}` to `{3}`, as in pieces' copy
   tables. Keys are the implementer's; no test names one: a test finds a key by its English.
3. **`zh-Hans.json`** *(chosen)*: key → `{"text": <entry>, "source": "<hex SHA-256>"}`. `source` records the English the
   translation was written from: the SHA-256 of a string entry's UTF-8 bytes, or of a plural entry's JSON with its forms
   in key order and no white space (helpers.ts `sourceHash`). A key missing from the file has no translation.
   **Confirming** a translation *(chosen)* records the current English's hash beside the same words; **translating it
   again** writes new words with that hash. Either clears the key.
4. **Plural forms** *(chosen)*: a plural entry's string for a count n is `zero` when n is 0 and the entry has it, else the
   form CLDR's cardinal category for n names at the pinned release (`crates/deep-canvas-marks/cldr-1129998233`: zh has
   only `other`; en `one` for 1), else `other`; `{0}` becomes n in ASCII digits. So the English count entry keeps the
   merge base's "Nothing needs you" for 0.
5. **The lookup in Rust** *(chosen)*: `deep_app::copy::text(key: &str) -> String`, a string entry in the app's language.
   Only AC4's planted sentence names it (`crate::copy::text`); the plural lookup's name is the implementer's.
6. **How a language is asked for** *(chosen)*: the replica by `launch.locale` (merged), `"zh-Hans"` or `"en-US"`. The real
   app by the system's preferred languages, read at launch, as macOS gives them to one process through its argument
   domain: `deep-app -AppleLanguages "(zh-Hans-CN, en-US)"`, or `"(en-US)"`. The app picks the first of them it has, so
   `zh-Hans-CN` reads the zh-Hans table. At the base `deep-app` panics on these arguments ("unknown argument").
7. **The lint and the release check** *(chosen)*: `node scripts/app-copy-lint.mjs [--root <dir>] [--release]`. It prints
   one `FAIL` line per finding, each naming `<path>:<line>` for a literal the app draws outside the table or a sentence
   joined from a word and a number, and, under `--release`, one naming the language and key of each key missing or stale
   in a shipped language (the word `stale` in a stale key's line); without `--release` those keys are listed but don't
   fail. It exits 1 on a `FAIL` line and 0 otherwise. `--root` reads another checkout's source, as the base's guards do.
   It is on the `lint` lane of `scripts/lanes.mjs` (`checks`) as `[process.execPath, 'scripts/app-copy-lint.mjs']`, and
   the release check is a lane of `releaseLanes` running `[process.execPath, 'scripts/app-copy-lint.mjs', '--release']`.
8. **`ui_check`** (merged, #124) with what this issue needs *(chosen)*: `ui_check.locale` (the launch's values, en-US
   when left out); renders at the reference window, 1512 × 982, and 360 pt wide (360 × 982), light and dark, each render
   as now (`size`, `theme`, `snapshot`, `findings`); a new audit, `text_overlap`, for two strings drawn over each other,
   naming `view` and `node` as every finding does. Clipped text is the merged `cut_off` and `outside_frame`.
9. **The plant** *(chosen)*, selected by `DEEP_HUB_PLANT` and read through `deep_app::plain::planted` in an `env-plants`
   build only (`deep-drive --features env-plants,deep-app/test-confirm`): `zh-twice-as-long` (AC3): each zh-Hans string the
   app draws is drawn repeated until it is at least twice as many characters as its English. `ui_check` must fail it,
   naming the view and the node: a `cut_off`, `outside_frame` or `text_overlap` finding in a shipped view whose node's name
   or text holds a zh-Hans string twice running.
10. **Merged, used as they are**: `deep-drive --out <dir>` and its `launch` (`from: fixture | empty`, `fixture`,
    `setup: "unfinished"`, `locale`), `see` (`snapshot` with `tree`, `runs`, `views`, `menu_bar.title` and `items`;
    `sha256`; `address`), `open {address}`, `wait_for {t}`, `close` (its trace's `notifications`) and `ui_check`;
    `deep hub run` with `DEEP_HUB_TEST_CLOCK`; `events.read`; #26's seeding; the ids `question-card`, `empty`,
    `session:<id>`; #1808's `RealApp`; #1462's probe `status`.

## The fixtures

Each world is a record a real hub made: sessions, titles, states and asks seeded through the record and asks core with
the hub stopped (#26's `seed`), each session's worktree a git folder named for its project, then `deep hub run`, whose
first backfill builds every row (`row.set`) (helpers.ts `makeWorld`). A **fixture world** is seeded before, and served on
a test clock at, 20 minutes before the replica's NOW (`crates/deep-replica/src/lib.rs`, 2027-01-15 08:00 UTC), its
record read back through `events.read` and written as a replica fixture file, so every build launched on it draws the
same at NOW. A **live world** is on the wall clock, for the real app.

- **RICH** (AC1, AC3, AC5, AC7): in `ledger`, a working session with an approval whose plan is one step ("Push the ledger
  branch to origin/main?", the oldest ask, so the window opens on its card) and a finished session; in `atlas`, a failed
  session with a choice ("Store coastline tiles as PNG or WebP?") and a working one with a taste call ("Which header tint
  reads better on the atlas?"). Every question, option, title and project is the agent's words, in English.
- **Counts** (AC4): 0, 1, 2 and 11 open asks, one a session (one session and no ask for 0), so no ask folds into another.
- **Empty** (AC7): no session. AC1's empty state and first launch are `from: "empty"` launches.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, from the live issue.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#2403.f805f24b` | `words.test.ts`: seven visits of RICH and two empty launches, each with zh-Hans and en-US in this checkout's and the merge base's `deep-drive`; the zh-Hans visits draw sidebar, home, session, welcome, agents and rules and the question card; each draws otherwise than its en-US twin and holds no English string the table has a key for; the table keys "Needs you", "Nothing needs you" and "Set up"; each en-US snapshot is byte-identical to the merge base's | the base (each zh-Hans launch draws the same as en-US, naming node 1); the merge base's build, its own test: its zh-Hans visits draw the same as en-US, and the judge names the node of its first visit that first holds an English string the table has a key for |
| AC2 | `#2403.940d60a6` | `lint.test.ts`: the lint lane runs the lint; it passes an unplanted source copy and exits 1 on a copy with a planted button whose label is a literal, naming `welcome.rs:<line>` | the base (no lint, nothing on the lane); the planted button |
| AC3 | `#2403.5f7fc02a` | `layout.test.ts`: `ui_check` on every shipped view with en-US and zh-Hans renders each at 1512 and 360 pt wide, finds no `cut_off`, `outside_frame` or `text_overlap`, and its zh-Hans renders draw the zh-Hans table's words; with `zh-twice-as-long`, a finding names the view and a node holding a doubled string, and the claim is FAIL | the base (no table, no `locale`, no 360, no overlap audit; its `ui_check` panics at its second render); `zh-twice-as-long` |
| AC4 | `#2403.d67d213a` | `counts.test.ts`: the menu bar's title at 0, 1, 2 and 11 open asks reads the merge base's sentences in en-US, which the English plural entry gives, and in zh-Hans the zh-Hans entry's form for each count, in Chinese, with its number; `lint.test.ts`: a planted `format!("{n} {}", crate::copy::text(<key of "Needs you">))` fails the lint, naming `views.rs:<line>` | the base (zh-Hans reads the English sentence); the planted joined sentence |
| AC5 | `#2403.83c0c375` | `asks.test.ts`: the replica's notification for the approval reads otherwise in zh-Hans, holds the question unchanged in both, and in zh-Hans holds no English string the table has a key for and Chinese words of its own; the real app's status item title, read from its accessibility tree, is the count's sentence in zh-Hans with `(zh-Hans-CN, en-US)` and in English with `(en-US)` | the base (the zh-Hans notification is the English one; the app refuses the languages' arguments) |
| AC6 | `#2403.7d32942a` | `release.test.ts`: the release lanes run the lint with `--release`; it passes the checkout's tables; with the English of "Set up" edited, it exits 1 naming that key as stale; confirmed, and translated again, it passes | the base (no release check); the edited English string |
| AC7 | `#2403.a13ac61c` | `shown.test.ts`: six pictures (Needs you with the card, a session's page, the empty state; en-US and zh-Hans) from the real app at 1512 × 982, each once its state is on the tree, then `TASTE.json`: INCONCLUSIVE until a recorded call on exactly these files | none: a picture is never judged here |

## Readings where the issue leaves a choice

1. **"Holds an English string the table has a key for."** What a person reads: each node's name, each string drawn
   (`runs`), and the menu bar's title and lines; never a node's value, which is a code (a status-map entry, an ask's
   status, the card's arming state, an empty kind), though several codes are English words. A place holds an English
   string when it holds it case for case, not inside a longer ASCII word, a placeholder standing for any text, once the
   world's own words are taken out (its agents' questions, options, steps, titles, projects, paths, session ids and
   handles, and a string cut at an ellipsis that starts one of them). An English string counts when it has two letters
   running, and isn't one of the words that stay as written: the five verdict words, and the names DeepBuild, Claude
   Code, Codex and pi. A failure names the visit and the first such place, a node first.
2. **"No shipped view."** The visits draw, between them, every shipped view the replica's main window draws at the base:
   sidebar (the list, with Needs you's section), home, session, welcome, agents and rules, and an ask's page with its
   question card. Needs you popped out is a window of its own and the line isn't laid out in the main window, so no `see`
   holds them; `ui_check` renders all eight (AC3).
3. **"Byte-identical to the merge base's."** The `see` snapshot of the same visit (same fixture file, same calls, the
   replica's NOW, UTC) from the merge base's own build, compared by the `sha256` `see` gives of its bytes; a difference
   names the first node that differs.
4. **"On the merge base the two launches draw the same, and the test fails, naming the first node."** Both ways: run at
   the base, the main test fails on each zh-Hans launch drawing the same as en-US, naming its first node with English
   words; and in a change, a test of its own runs the merge base's build through the judge with the change's table and
   needs it to fail, naming the node that first holds a keyed English string.
5. **"In both languages, at the reference window and at 360 pt wide."** One `ui_check` per language; each shipped view
   needs a render 1512 wide and one 360 wide, and only those are judged (more sizes may stay). "Clipped" is the merged
   `cut_off` and `outside_frame`; "overlapping" is `text_overlap`. The plant may be found at any size.
6. **"Read right"** (AC4): the count's sentence is read from the menu bar's title. English keeps the merge base's
   sentences; zh-Hans says the zh-Hans entry's form for the count, with Han characters and, from 1 up, its number.
7. **"Read from the accessibility tree"** (AC5): the menu bar's title from the real app's accessibility tree (its status
   item, as an assistive client reads it). An unbundled app has no Notification Center a test can read, so the
   notification is read where the replica keeps it for Notification Center (#883, #994, #1100), the title and body macOS
   is asked to show. The question is unchanged when it appears whole in both languages' notifications.
8. **"Marks that key stale"** (AC6) is read from the release check's line naming the key with `stale`.
9. **The planted sentence** (AC4) joins a number and a word the table gives, as a count's sentence would if it were built
   from pieces; a literal word joined with a number would be AC2's plant again.

## Known limits

- At the base, `ui_check` panics (`used a entity with the wrong context`) at its second render, as does any second
  `launch` in one `deep-drive` process; so each test here launches once a process, and AC3 needs that fixed.
- The real app's language comes from its process's arguments, not the account's settings, which a test must not change.
- The judge reads a keyed string at ASCII word boundaries; English glued to an ASCII letter isn't seen, and words the
  table doesn't key (the hub's `why` and `doing`, agents' reach lines) aren't judged.
- AC5 needs Accessibility, and AC7 Screen Recording too; here (Accessibility on, Screen Recording off) AC7 is BLOCKED.
- Changing the language in the box (Scope, #1998) is tested by no criterion and not here; nor is `deep`'s output.

## What the implementer adds outside this folder

- The table files and their form (Surface 1-4), `deep_app::copy::text` (5), and every word the app draws of its own
  through them, in the replica's `launch.locale` and in the real app from the system's preferred languages (6), which
  `deep-app` must accept as arguments.
- `scripts/app-copy-lint.mjs` (7), on the `lint` lane and as a lane in `releaseLanes` of `scripts/lanes.mjs`.
- `ui_check.locale`, the 360 pt render and the `text_overlap` audit (8), and a replica whose second launch in one
  process doesn't panic.
- The plant `zh-twice-as-long` (9), read under `env-plants` (`scripts/plant-lint.mjs`).
- `scripts/lanes.mjs`: this folder in a macOS, logged-in lane that runs it one file at a time (it builds, starts hubs
  and replicas, and AC5 drives the real app), and `shown.test.ts` by hand.

## Files

- `helpers.ts`: IDs and the plant; builds, the merge base's build; a driver for any `deep-drive` build; worlds and
  fixture files; the table, plural forms and source hashes; the English judge; the lint and the lanes; the real app's
  languages and status item. Reuses `../16`, `../26`, `../1463`, `../1461`, `../1458` and `../1808` helpers and
  `../1462/probe.swift`, unchanged.
- `words.test.ts` (AC1), `lint.test.ts` (AC2, AC4's plant), `layout.test.ts` (AC3), `counts.test.ts` (AC4),
  `asks.test.ts` (AC5), `release.test.ts` (AC6), `shown.test.ts` (AC7).
- `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
