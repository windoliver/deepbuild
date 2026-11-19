# Acceptance tests for #1592: one drawn icon set at two sizes, and one status mark

Written first and blind, at base commit `f6ddd396f` (main), from issue #1592 (its Scope, four acceptance criteria and
Proof), the words it cites from #1453 (rules 5 and 10), #1458, #1461, #1464 (its scope line on icon sizes and its AC8, "a
planted 18 pt icon") and #1593 (the status map), the design (`docs/technical-design.md`: Look, States people see, Panels
and devices' Replica, How we know version 0 works; `docs/canvas-primitives.md`: Look `look@1`) and the base, before any
implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). `TASTE.json` is the one file here a person's call changes.

**Read this first.** Every test ran once at the base; `BASE-FAILURE.txt` holds that run, trimmed. All four fail, each
for its criterion's reason: AC1 at the missing surface (the snapshot has no `icons`) and because the app draws no icon;
AC2 because the list's nine marks are one shape with color off (each an 8 pt square of its color), naming all 36 pairs;
AC3 because a session's page draws `⊘` through font fallback (`line-status` and `return-card`); AC4 at the missing
surface (`deep-app` has no `contact-sheet` feature). At the base the replica file took about a minute, with
`deep-drive`'s builds already made (each takes about three minutes here from cold).

## What was read at the base

- `crates/deep-canvas-marks/looks/clean.json` and `src/look.rs`: the status map, `status_treatment.glyph` (✓ ✗ ⊘ ■ ? ↻ !
  ◇ ○), `status_map()`'s `status_glyph_shared`, #1458's sizes; the look has no `icons` field.
- `crates/deep-app/src`: `views.rs` (`marked()`, `status()`, `row_element()` and its `<row id>:mark` slot, `control()`,
  `title_bar()`, `observed()`, `drawn_views()`), `list.rs`, `states.rs` (`TABLE`, `glyph`), `chrome.rs`, `plain.rs`
  (`planted`), `main.rs` (`DEEP_APP_APPEARANCE`, the fixture modes), `brand.rs`, `events.rs`, `chrome_gallery.rs`, and
  `Cargo.toml`'s features.
- `crates/deep-replica`: README, `src/drive/mod.rs` (`launch`, `see` with #1458's `runs` and `views`, `act` with
  `hover`, `screenshot`), `src/drive/glyphs.rs`, and `fixtures/session-row.events.jsonl` for the shape of a hub-built
  `row.set`.
- `vendor/gpui-pre/src/window.rs` (`paint_svg`: an SVG is one monochrome sprite from an atlas tile keyed by its path and
  size) and the kit's icon set (`crates/assets` of the pinned gpui-kit: SVG files under `assets/icons/`, a 24 view box,
  stroke-width 2).
- `packages/hub/src`: `rows.ts` (`orderOf`, each state's entry), `sections.ts`, `status.ts` (the one ordered table).
- The suites `1458` (the closest model: `runs`, `views`, plants through `DEEP_HUB_PLANT`), `1461` (AC28 and its
  `TASTE.json`), `1454` (`App`, its probe and captures), `1459` (its probe's identifiers), `1808`, `2021` (the `<row
  id>:mark` slot pictured) and `1436` (a gallery of chrome effects).

## How to run

On macOS, in a logged-in session:

```sh
export PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1
npm ci --ignore-scripts && npm run build --workspaces
caffeinate -di npx vitest run --root tests/acceptance/1592 --no-file-parallelism --testTimeout=600000
caffeinate -di npx vitest run --root tests/acceptance/1592 --testTimeout=600000 replica                              # AC1-AC3
DA1592_SCREENS=<dir> caffeinate -di npx vitest run --root tests/acceptance/1592 --testTimeout=600000 shown          # AC4
node node_modules/typescript/bin/tsc -p tests/acceptance/1592/tsconfig.json
```

- **Builds.** `deep-drive` with `--features env-plants`, then plain; for AC4, `deep-app` with `--features
  contact-sheet`, then plain. Each is copied to `$TMPDIR/da1592-bin-<uid>-<8 hex of this checkout's path>/`, so another
  worktree's build never stands in for this one, and `target/debug` holds the plain builds afterwards.
  `CARGO_TARGET_DIR` is honored.
- **Headless.** `replica.test.ts` drives the real `deep-drive` on GPUI's test platform; a locked screen changes nothing.
- **Permissions.** Only `shown.test.ts` needs Accessibility and Screen Recording for the process running the tests (#1454's
  and #1459's probes check both) and an unlocked, awake screen; without them it stops `BLOCKED: …`, never passes.
- **Folders and processes.** Everything runs under `/tmp/da1592-*` and the folders #1454's and #1459's helpers make. Each
  replica's and app's HOME is a temp folder; nothing touches the real `~/.deepbuild`, `~/.claude` or `~/Library`. Only
  processes a test started are stopped, by PID.
- **Lanes.** `scripts/lanes.mjs` lists this folder `alone` and `shown.test.ts` `byHand`, in this commit.
- Vitest writes `tests/acceptance/1592/node_modules/.vite/` under `--root`; delete it before committing.

## Surface choices

The issue names the shipped pages, the states, the icons and "the real app", but no call, field or binary. Where it
leaves a name open, this suite reads the base's own surfaces as they are and pins the smallest addition to them. The
implementation must provide these.

1. **`icons` in the snapshot (AC1, AC4).** Every snapshot `deep-drive`'s `see` returns (`scope: "window"`, the
   default) gains a top-level `icons` list beside #1458's `runs` and `views`: one entry per icon the frame drew,
   `{"icon": <name>, "bounds": [x, y, w, h] in device pixels, "size": <points>}`. An icon is an SVG drawn as a
   monochrome sprite (GPUI's `svg()`, the kit's `Icon`), from the kit's icon set or anywhere else, except the brand
   artwork `brand/surfaces.json` lists (the title bar's mark and first launch's lockup, #79) and except a status mark.
   `icon` is its file's name in the kit's set without `.svg` (`icons/external-link.svg` is `external-link`), else the
   path or key it was drawn by. `size` is the larger side of the box it was laid out in, in points. An icon a control
   draws clear at rest may be listed at rest or only under the pointer; the tests read both. The snapshot's other keys
   keep their base shape.
2. **Status marks (AC2, AC3): the base's surfaces, as they are.** A status mark is drawn inside a node whose value is
   a status-map entry (design, Replica: "a node's value carries a state's status-map entry"; #1459). On the list each
   row has its mark slot, the node `<row id>:mark` (#1461's row: 16 wide with 8 after it, valued with the row's entry),
   which #2021's suite pictures too. AC2 crops each slot's bounds from the replica's `screenshot` (`target: "window"`) taken right
   after the `see` that gave them. AC3 reads #1458's `runs`: a run's `face` is the family its font was asked for by,
   and is empty for a glyph shaped from a font no text asked for, the platform's stand-in for a character the
   asked-for font lacks: font fallback. (`drive/glyphs.rs` records a family only for fonts asked for; at the base a
   session's page draws `⊘` as such a run.) Every run whose middle lies inside a node valued with an entry is that
   mark's.
3. **The plants**, each a wrong program a criterion names, selected by `DEEP_HUB_PLANT` and read through
   `deep_app::plain::planted` only in a build with `env-plants` (`cargo build -p deep-replica --bin deep-drive
   --features env-plants`, as #1458's suite builds it; a release build refuses `env-plants`):

   | Plant | Criterion | The wrong program | Where its run fails, naming what |
   |---|---|---|---|
   | `icon-18-on-page` | AC1 | a session's page draws an icon of the kit's set at 18 pt in its page chrome, at rest | AC1's judge on the session's page at rest: `deepbuild/session: the icon "<name>" is drawn at 18 pt, not 14 or 16 pt` |
   | `stale-mark-as-idle` | AC2 | the `stale` mark draws the `idle` mark's shape, in stale's color, wherever a mark is drawn | AC2's judge on Needs you's list: `stale and idle draw the same shape with color off: …` |
   | `mark-as-font-glyph` | AC3 | every status mark draws the look's Unicode glyph for its entry (`status_treatment.glyph`) as text in the chrome's face, as the base's session page does | AC3's judge on Needs you: `deepbuild/sidebar: the invalid mark "<id>" draws "⊘" from a font no text asked for: font fallback` (the system face lacks at least `⊘`) |

4. **The contact sheet (AC4): `deep-app --contact-sheet`**, in a build of `deep-app` with the Cargo feature
   `contact-sheet`, in no shipped build (`cargo build -p deep-app --bin deep-app --features contact-sheet`). It opens
   one window, with no hub and no record, that draws through the app's own builders and the look's roles, in the
   appearance `DEEP_APP_APPEARANCE` (`light` or `dark`) forces, as it does for the app's window: a tile per status-map
   entry, its status mark as every surface draws it, and a tile per icon the chrome draws, at the size its role gives
   it. Each tile is an accessibility node whose identifier is its `observed` id (#1459): `contact-sheet:mark:<entry>`
   for each of `pass`, `fail`, `invalid`, `blocked`, `inconclusive`, `running`, `needs_you`, `stale` and `idle`, and
   `contact-sheet:icon:<icon>`, with `<icon>` the name Pinned 1 lists. The check run launches it once per appearance,
   places its window at 1512 × 982 (#1454's `place`), waits until its tree holds a mark tile for each entry and an icon
   tile for every icon the replica's shipped pages draw (at rest and under the pointer, as AC1 reads them), and captures
   it by window ID: `contact-sheet-light.png`, `contact-sheet-dark.png` and `run.json` (`{issue, criterion, app: the
   binary's SHA-256, entries, icons}`).
5. **The shipped pages** are the values `deep-drive`'s `launch.center` accepts, as its refusal of an unknown center
   lists them (at the base `deepbuild/needs-you`, `deepbuild/home`, `deepbuild/session`, `deepbuild/welcome` and
   `deepbuild/agents`), and the question card (Needs you with the choice ask's row clicked). Each is launched over the
   fixture at 1512 × 982 in light, in a replica of its own, read at rest and then once with the pointer over each node
   that has an id (`act`, `hover`), so what a page draws on hover or selection is read too. A page added to
   `launch.center` is in every test here. A failure names the smallest of #1458's `views` that holds the icon or string,
   else the page.

## The fixture

`fixtures/marks.events.jsonl`, on the replica's clock (`NOW`, 1 800 000 000 000 ms, 2027-01-15 08:00 UTC): nine
sessions in project `shop`, each with its `session.start` and `task.created`, and each listed by a `row.set` in the
hub's own shape (`orderOf`'s key; the state's word and entry as `packages/hub/src/rows.ts` gives them), one per
status-map entry:

| Session | ID | Word | Entry |
|---|---|---|---|
| Header layout (the record's first, so a session's page shows it) | `01QMSESS000000000000000001` | INVALID | invalid |
| Checkout page | `01QMSESS000000000000000002` | PASS | pass |
| Cart totals | `01QMSESS000000000000000003` | sent back | fail |
| Billing page | `01QMSESS000000000000000004` | BLOCKED | blocked |
| Login flow | `01QMSESS000000000000000005` | INCONCLUSIVE | inconclusive |
| Search index | `01QMSESS000000000000000006` | working | running |
| Release notes, with one open choice ask, "Keep the old logo in the header?" (`ask:01QMASK0000000000000000010`), and its row | `01QMSESS000000000000000007` | needs you | needs_you |
| API guide | `01QMSESS000000000000000008` | stale | stale |
| Docs refresh | `01QMSESS000000000000000009` | finished | idle |

## Criterion to tests

IDs are `#1592.` and the first 8 hex of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`, `criterionId`). Each plant's test holds the clean run to the same judge first
(`expect.soft`), so a program that already fails can't make its plant look caught, and a plant the build ignores fails
as "wasn't caught".

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 every icon on the shipped pages is 14 or 16; a planted 18 fails, naming the view | `#1592.9baca743` | `replica.test.ts`: every icon each shipped page and the card draw, at rest and under the pointer, is 14 or 16 pt (to 0.01 pt), and they draw at least one; then the plant's session page fails naming `deepbuild/session` and 18 pt | the base (no `icons`; the app draws no icon); `icon-18-on-page` |
| AC2 each state has its own mark, told apart with color off; a planted pair with the same shape fails, naming them | `#1592.7a78eb3d` | `replica.test.ts`: on Needs you's list, each entry's mark slot from the replica's picture, color off: every two entries' shapes differ in at least 10% of the pixels either inks; then the plant fails naming stale and idle | the base (nine squares, every pair one shape); `stale-mark-as-idle` |
| AC3 a status mark draws with no font fallback; a planted glyph fails | `#1592.edcecbf6` | `replica.test.ts`: on every shipped page and the card, no string inside a node valued with an entry comes from a font no text asked for, and each of the nine entries has such a node; then the plant's Needs you fails naming font fallback | the base (`⊘` in a session page's `line-status` and `return-card`); `mark-as-font-glyph` |
| AC4 shown to you: a contact sheet of every state mark and icon in light and dark, from the real app; one taste call, else INCONCLUSIVE | `#1592.15a3cc5f` | `shown.test.ts`: the contact sheet from the real app in light and dark, each picture once its tree holds every tile, to `$DA1592_SCREENS` with `run.json`; then `TASTE.json`: no call, an anonymous one or one on other files is INCONCLUSIVE, `looks_wrong` fails quoting its note, `looks_right` on exactly these files passes | the base (no `contact-sheet` feature); no call recorded (INCONCLUSIVE) |

AC2 reads pixels as a measurement a script makes the same way every time; the only picture a person judges is AC4's,
and AC4 judges none itself.

## The taste call (AC4)

`$DA1592_SCREENS` (a temp folder without it) gets `contact-sheet-light.png` and `contact-sheet-dark.png`, each the real
window at 2×, and `run.json`. `TASTE.json`'s `verdict` is `null` until a person calls it. Take the pictures once, call
them, record each file's SHA-256 with who and when, and run again against the same folder: a kept folder holding exactly
the files of a recorded call, with the same app hash in `run.json`, stands without new pictures. "Attached to the PR and
shown to you" is the implementing agent's; no test can see it.

## Ambiguities

1. **Brand artwork is not an icon.** The title bar's mark and first launch's lockup are the kit files of #79 at
   `brand/surfaces.json`'s sizes (24 and about 200 pt), not icons of the kit's set; `icons` leaves them out.
2. **A status mark is not an icon.** The issue sets it apart ("one drawn glyph per state in a 16 slot") and AC4 names
   marks and icons apart, so `icons` leaves marks out even when one is drawn as an SVG; AC2 and AC3 hold the marks.
3. **"14 in rows and 16 in page chrome".** AC1 holds every icon to 14 or 16, as the criterion says. Which of the two
   goes where (a list heading's control, a page's title row) is not judged here; the contact sheet shows each icon at
   its role's size for the taste call.
4. **"Every icon on the shipped pages"** is every icon drawn on the five pages and the card over this fixture, at rest
   or under the pointer. At least one must be drawn: an app that draws none has nothing measured (invariant 2), and AC1
   fails saying so. The base draws none.
5. **"Told apart with color off"** is read on luminance alone. A mark's shape is the pixels of its slot that differ
   from the slot's commonest color by at least half the most any pixel of that mark does, so one shape drawn in two
   colors, or in ink with a tinted core, is one shape. Two marks are told apart when their shapes, laid centre on
   centre (a mark moved in its slot, as the working mark steps, keeps its shape), differ in at least 10% of the pixels
   either inks. Light only: a shape doesn't change with the appearance.
6. **"State" is an entry (#1593).** Marks are compared by entry, one row each in the fixture, so two words that share an
   entry are never a planted pair, and the contact sheet pictures each entry's mark once (quiet and finished share
   `idle`'s). Whether two words that share an entry draw the same mark is the Scope's, not a criterion's, and isn't
   tested. A quiet row folds into one row per project (#1461), so the fixture's `idle` row is `finished`.
7. **"No font fallback"** is read as: no string drawn inside a status mark's node comes from a font no text asked for.
   A mark drawn as a path or an SVG draws no string and passes; one drawn from a bundled face its text asks for by
   family passes. A row's node holds its title, word and time too; the fixture's are plain ASCII in the chrome's face.
8. **"A planted glyph"** is the look's Unicode glyphs drawn as text in the chrome's face, as the base draws them on a
   session's page; the system face lacks at least `⊘`, so the plant falls back.
9. The glyph is also text in accessible names (`states::glyph`), in notification titles (`notify.rs`) and in the menu
   bar item's menu (`states::menu`). Names are spoken, not drawn, and macOS, not the app, draws notifications and that
   menu; AC3 reads what the app's window draws.
10. **AC4's "taken by the check run from the real app".** No world on a real hub shows all nine entries without
    claims and verdicts that only the gate makes, so the real app draws them in a window of its own, through its own
    builders: the contact sheet (Pinned 4), as #1436 drew its chrome effects in a gallery. "Every state mark" is the
    nine entries; "every icon" is every icon the replica's shipped pages draw.
11. **Not a criterion, so not tested:** "one stroke" (it shows in the contact sheet), an icon's size as a role of the
    look, a control that shows only an icon keeping its name in the tree (#1453 rule 10, #1464's tree comparison), the
    mark tinted only in its core (#1453 rule 5, #1464), the 16 slot and the state word beside the mark. #1464 checks
    the icon scale on every page; this suite holds the shipped pages over its fixture.
12. **Windows.** AC1 to AC3 read the reference window, 1512 × 982, in light; sizes, shapes and faces don't change with
    the appearance. AC4 takes both appearances.

## Files

- `helpers.ts`: builds, the `deep-drive` client, the page readings, every judge, the PNG reader.
- `replica.test.ts` (AC1, AC2, AC3), `shown.test.ts` (AC4).
- `fixtures/marks.events.jsonl`: the record. `TASTE.json`: AC4's taste call, unrecorded. `tsconfig.json`: as #1461's.
  `BASE-FAILURE.txt`: the run at the base.
