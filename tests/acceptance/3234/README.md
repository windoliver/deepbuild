# Acceptance tests for #3234: a yes on a taste call counts what was on screen

Written first and blind, at base commit `f8c6cff82` (main), from issue #3234 (no comments: its problem, Scope, eleven
acceptance criteria and Proof), the design and the base, before any implementation. The implementing agent does not
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). `TASTE.json`
is the one file here a person's call changes.

## What was read

- Issue #3234; #2030, #1808, #109, #726, #43, #327, #394 and #328 only for the words #3234 cites.
- The design, as `node scripts/design-section.mjs --issue 3234` prints it: Question card, Sheet `sheet@1`, An ask and
  your answer getting back (with Where they reach you), How we know version 0 works (Wrong programs, Dogfooding, Tests
  written first), and what they lean on: the Needs-you view, the Replica, the `view` row (the return card holds the
  verdict line), Numbers.
- At the base, for its surfaces only: `crates/deep-app/src/{question.rs,arming.rs,card.rs,kinds.rs,answer.rs,views.rs,
  states.rs,open.rs,words.rs,plain.rs,hub.rs,show.rs}`, `crates/deep-replica/` (README, `src/deep_drive.rs`,
  `src/drive/{mod,frames,counts,clocks,see,plant,hubcopy}.rs`, `src/snapshot.rs`), `packages/hub/src/{human-answers,
  status,verdict-chat,numbers,plant,server}.ts`, `packages/asks/src/{index,answers,settings}.ts`, `packages/evidence/
  src/index.ts`, `packages/readings/src/{types,panel}.ts`, `packages/verdicts/src/engine.ts`, `packages/cli/src/main.ts`,
  `packages/contracts/schemas/{ask.created@5,ask.answered@6,ask.batched@1,claim.made@2,verdict.made@2,evidence.*}.json`,
  `packages/record/src/projections.ts`; the suites `1808`, `327`, `1345`, `1455`, `2029`, `1101`, `24`, `394`, `45`,
  `2648`, `1015` and `1097`.

## How to run

With Node 24.22 and cargo first on `PATH` (`/opt/homebrew/opt/rustup/bin`), on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/3234 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3234/tsconfig.json
DA3234_SCREENS=<dir> ... shown        # keeps AC11's pictures, for the taste call
```

- **Builds.** `deep-drive` comes from #1101's `driveBin`: `--features deep-app/test-confirm`, and with `env-plants` for a
  plant, each copied to `$TMPDIR/da1101-bin-<uid>-<checkout>/`, built in a grant of `scripts/throttle.mjs build` with
  #1172's build environment, and reused while it is newer than every Rust source. `deep-hook` is built when missing
  (#1461's `needBuilds`). AC10's timed half builds release replicas with `frame-clocks`, this checkout's and the merge
  base's (`git archive` of `f8c6cff82` into `$TMPDIR/dd3234-<uid>-<checkout>/`, no worktree added, no `.git` copied),
  only on a fit reference Mac.
- **Folders and processes.** Every HOME is a temp folder (#16's `makeHome`); the replica runs in the world's HOME, so
  the app reads the pictures from that HOME's evidence store. Nothing touches the real `~/.deepbuild`, `~/.claude` or
  `~/Library/LaunchAgents`. Only what a test started is stopped, by PID.
- **Lanes.** Every file starts real hubs and most draw in a replica, so the folder needs an `alone` entry in
  `scripts/lanes.mjs` (a macOS lane), and `shown.test.ts` runs by hand; the implementer makes that edit.
- Vitest writes `tests/acceptance/3234/node_modules/.vite/` under `--root`; delete it before committing.

## Surfaces (the implementation must provide these)

The issue names Numbers, `deep inbox answer`, the record and the replica, and leaves the rest open. These are the
smallest that fit the merged surfaces; the tests use exactly these.

1. **A taste ask's pictures, by hash.** The ask is `ask.created` as at the base (`deep_ask.taste`, data unchanged), pinned
   to `{kind: "evidence", ref: <M>}`, where `M` is the SHA-256 of a JSON file in the hub's evidence store (put through
   `@deepbuild/evidence`, so it lies at `~/.deepbuild/evidence/<first 2 hex>/<rest>`):
   `{"pictures": [{"sha256": "<64 hex>", "size": [<width px>, <height px>]}, …]}`, in the order the evidence lists them.
   Each picture is a PNG in the same store. **A picture replaced** under a presented card is the core's event
   `ask.moved@1`: `{v: 1, kind: "ask.moved", writer: "core", subject: "ask:<ULID>", data: {pinned_to: {kind: "evidence",
   ref: <M'>}}}`, the ask now showing the manifest `M'` (the design's "after that moved", as a commit pin moves with its
   worktree). The tests feed it to a running replica (`feed`); the hub's schema for it is the implementer's.
2. **A drawn picture, in the snapshot.** The replica's `see` (#124) holds a node for each picture the window draws, its
   `id` `picture:<sha256>` and its `bounds` the rect the picture is drawn at, in device pixels, nothing more. Its
   **scale** is `bounds` width ÷ the picture's width in pixels (a 1512 px screenshot drawn 96 px wide is 0.063). It is
   **drawn whole inside the window** when its bounds lie inside the window's (`[0, 0, 3024, 1964]` at the reference
   window) and inside those of each node that encloses it in the snapshot (so a picture cut at its scroll area's edge
   isn't). A press on a picture's node **opens** it: the window then draws it (the same id) at half its size or more.
3. **The card.** A taste ask's accepting option is its recommended one (#1345's "yes"); Send back is the other (#1345's
   "back"). Options keep #1462's ids, `card-option:<option id>`. An option node's `value` is `"armed"` when a press on
   it answers; the accepting option of a taste ask reads otherwise until each picture was drawn whole inside the window,
   at half its pixel size or more, for an unbroken `arm_after` (500 ms). Until then it says what's left, in its
   accessible name or a string drawn inside its bounds: **`<left> of <all> not shown yet`** (`2 of 4 not shown yet`).
   Send back arms on the interval and the slot alone. Words are typed where the keyboard is on a presented card (its
   answer field) and go with the option pressed. On a **batched taste card** each row keeps #1345's id,
   `card-row:<ULID>`, and its `value` is `"armed"` once that row's own pictures were shown, as above.
4. **The answer's record.** The app's `ask.answer` params and the core's `ask.answered` data gain **`pictures`**: one
   entry per picture its manifest lists, in that order, **`{"sha256": "<64 hex>", "shown": <bool>, "scale": <number>,
   "ms": <integer>}`**: `shown` as in 3; `scale` the largest scale it was drawn whole inside the window at, 0 if never;
   `ms` the milliseconds it was drawn whole inside the window, at any scale, until the answer. `via` stays as today. An
   answer given where nothing is drawn (`deep inbox answer`, a channel) records every entry
   `{"shown": false, "scale": 0, "ms": 0}`, its `via` `inbox` (or `channel`).
5. **"answered unseen"**, the exact words, on three surfaces, read after `deep inbox answer`:
   - **The claim's verdict line**: the line `deep status` prints under the session's row, the `verdict` of the
     session's row in the hub's `status.read` (`{rows: [{id: <session>, verdict, …}]}`), which `status.ts` builds from
     the claim's newest verdict (#83). `deep status --json` prints the list's rows without it.
   - **The return card**: the node `return-card` on the session's page (`session/<id>`), its own words or the strings
     drawn inside it.
   - **The Decided page**: the answered ask's own address, `ask/<ULID>`, opened once the ask is closed: what `open`
     says and every string the window draws then. The base has no page by that name; this is the one place the app
     shows how a decided ask was decided ("answered at 14:02 from deep inbox", design: Where they reach you), and
     it already names where the answer came from, which the planted line falsifies.
6. **Numbers**: `deep numbers --json`'s `rows` (#45), as `PanelRow`s:
   - `{id: "taste_calls_seen", value: <count>}`: accepted taste calls (answered with their recommended option) whose
     every picture was shown;
   - `{id: "taste_calls_unseen", value: <count>}`: accepted taste calls with a picture not shown, as every one answered
     where nothing is drawn;
   - `{id: "taste_picture_ms_median", value: <ms>, unit: "ms"}`: the median of `ms` over the pictures of the seen calls;
   - `{id: "taste_calls_in_a_row", value: <calls>, detail: [{calls, first_half_ms, second_half_ms}, …]}`: the longest run
     of accepted calls in a row, by when each was answered (any other answer to a taste call ends a run), one `detail`
     entry per run of that length, oldest first, with the median `ms` of the pictures of its first half of calls and of
     its second half.

## Plants

Each is selected by `DEEP_HUB_PLANT=<name>`: the app reads it through `deep_app::plain::planted` in `deep-drive`'s
`env-plants` build; a hub's plant must be listed in `packages/hub/src/plant.ts`, which refuses an unknown name, and
AC5's hub is given its plant only when that file lists it (#1101's `hubLists`).

| Plant | Criterion | Where | The wrong program | Fails naming |
|---|---|---|---|---|
| `arms-at-presentation` | AC1 | app | the accepting option arms on the interval alone, whatever pictures were shown | the two hashes below the fold |
| `counts-small-draw` | AC2 | app | a picture counts as shown once drawn whole inside the window, at any size | the picture and its scale |
| `refuses-send-back` | AC3 | app | Send back is held like the accepting option: pressed while a picture is left, it sends nothing | the ask |
| `marks-all-shown` | AC4 | app | the answer's entries mark every picture shown | the picture never shown |
| `unseen-reads-as-card` | AC5 | hub and app | an answer given where nothing is drawn reads on the verdict line, the return card and the Decided page as one from the card does | the surface |
| `arms-every-row` | AC7 | app | once one row of a batched taste card arms, every row arms | rows 2 and 3 (their `card-row` ids and asks) |
| `folds-seen-unseen` | AC8 | hub | Numbers counts every accepted taste call as seen (8 and 0) | the counts |
| `one-median-per-run` | AC9 | hub | the run's reading gives the whole run's median for both halves | the run and its one median |

## The fixtures

Every world is a record a real hub made (`helpers.ts` `makeWorld`): sessions in a git folder `shop`, each with its task;
taste asks raised by the asks core as `deep_ask.taste`, options `looks-right` ("Looks right", recommended and the
default) and `send-back` ("Send back"), each pinned to the manifest of its pictures; then `deep hub run` on its test
clock with the OS confirming you (DEEP_HUB_TEST_CONFIRM). Pictures are solid two-colour PNGs, a pair no other picture
has.

- `card.test.ts`: `four`, four 800 × 700 pictures (two fit above the fold at the reference window, one column at their
  own size, as Sheet's "never scaled"), plus a spare one and the four manifests with one picture swapped for it (AC6);
  `wide`, one 1512 × 982 screenshot.
- `answer.test.ts`: three asks like `four`, one for the clean run and one per plant.
- `terminal.test.ts`: `four` in a session whose claim (`claim.made@2`) has a verdict (`verdict.made@2`, INCONCLUSIVE)
  whose one requirement is a person's (`oracle: person`, `ask:` the call, pending); a second world for the plant.
- `batch.test.ts`: three asks in three sessions, two 800 × 700 pictures each, and the core's `ask.batched` of the three.
- `numbers.test.ts`: one tiny two-picture ask per session, answered through the asks core as the card answers (the
  app's connection, `pictures` all shown with the fixture's `ms`) or as `deep inbox answer` does (the CLI's connection).
  The week: 8 accepted calls, 6 from the card (`ms` per picture 500 and 1500, four calls at 4000 and 4000, then 9000 and
  12000) and 2 from the terminal: seen 6, unseen 2, median 4000 ms (with or without the unseen calls' pictures). The run:
  10 accepted calls, five at 8000 ms a picture then five at 2000; and the same with a Send back between the fifth and
  the sixth. The hand counts are computed in the file from these lists.
- `budgets.test.ts`: twenty 120 × 80 pictures, drawn at once.
- `shown.test.ts`: `four`, and a second session like `terminal.test.ts`'s.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`. Each test's name starts with its criterion and ID.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#3234.3085aabe` | `card.test.ts`: two pictures drawn whole and two below the fold; the accepting option not armed, reading 2 of 4; a hardware press sends no `ask.answer`; the wheel shows the other two for the interval; it arms; one press sends one `ask.answer` with `looks-right` | the base (no picture drawn); `arms-at-presentation`, naming the two hashes below the fold |
| AC2 | `#3234.09622499` | `card.test.ts`: the screenshot drawn whole under half its size for 1.5 s leaves the option not armed, reading 1 of 1; a press opens it at half size or more; the option arms | the base (no picture drawn); `counts-small-draw`, naming the picture and its scale |
| AC3 | `#3234.c875f23b` | `answer.test.ts`: three pictures shown, one never; words typed; Send back pressed: the app sends one answer, `send-back` with the words; the hub takes it, signed as the app signs it, and records it once, from the card | the base (no picture drawn); `refuses-send-back`, naming the ask |
| AC4 | `#3234.38958545` | `answer.test.ts`: the same answer's `ask.answered` holds four entries in the manifest's order, each `shown`, `scale` and `ms` equal to the replica's trace (Readings 2) | the base (no entries); `marks-all-shown`, naming the picture never shown |
| AC5 | `#3234.660ee1b4` | `terminal.test.ts`: `deep inbox answer` takes the call; the record's `via` is `inbox` and its four entries are not shown; the verdict line, the return card and the Decided page each read "answered unseen" | the base (no entries, no such words); `unseen-reads-as-card`, naming the surface, after the same judge passed the program as shipped |
| AC6 | `#3234.23f156f5` | `card.test.ts`: the four shown, the option armed; `ask.moved` swaps one the window no longer draws for a new hash; the option reads not armed, 1 of 4 | the base (no picture drawn) |
| AC7 | `#3234.5392d306` | `batch.test.ts`: the card draws the three rows; row 1's pictures shown for the interval; row 1 arms; rows 2 and 3, whose pictures were never drawn whole, don't | the base (no picture drawn); `arms-every-row`, naming rows 2 and 3 |
| AC8 | `#3234.432669e1` | `numbers.test.ts`: the week reads seen 6, unseen 2, median 4000 ms | the base (the record refuses an answer's entries); `folds-seen-unseen` (seen 8) |
| AC9 | `#3234.f499fe58` | `numbers.test.ts`: the run reads 10 with 8000 and 2000 ms; with a Send back between the fifth and the sixth, two runs of 5 (8000 and 8000, then 2000 and 2000) | the base (as AC8); `one-median-per-run` (5000 and 5000) |
| AC10 | `#3234.d6a29dc6` | `budgets.test.ts`: the idle window wakes no more than the merge base's (when it wakes none, nothing is compared or built); a frame drawing 20 pictures within 0.1 ms of the merge base's, by #1097's rule, on a fit reference Mac only | the base (no picture drawn); elsewhere the timing is INCONCLUSIVE, never PASS |
| AC11 | `#3234.b4cd2f05` | `shown.test.ts`: three pictures from the replica at the reference window, each once its state is on the tree, then `TASTE.json`: INCONCLUSIVE until a recorded call on exactly these files | none: a picture is never judged here |

## Readings, where the issue leaves a choice (a redraft may revisit them)

1. **Where pictures are listed.** "The pictures its evidence lists by hash" is read as the evidence the ask is pinned to
   listing them: one manifest file, so `ask.created` keeps its data and its one evidence pin, and a sheet's cells, a
   contact sheet and a before and after are all such lists. Pixel sizes are in the manifest, so the card needn't open a
   picture to know what half its size is.
2. **The replica's trace.** What was drawn is read from `see` snapshots at known times on the virtual clock, with one
   action (a wait, one wheel turn, a press) between two: a picture drawn whole at both ends of an interval was drawn
   whole through it, at one end for part of it, at neither not at all. A picture is shown once samples draw it whole
   at half its size or more across 500 ms unbroken. The record's `ms` must lie within the interval sum's bounds, 50 ms
   either side (three frames); its `scale` within 0.01 of the largest sampled whole draw; its `shown` exactly. A card
   reads "armed with pictures not shown" only for a picture no sample ever drew whole at half its size, so sampling
   can't fault a right card.
3. **"Below the fold"** is the fixture's premise, checked: 700 ms after the page draws its pictures, two are shown and
   two were never drawn whole. A layout that puts more of them above the fold fails naming the premise, not the card.
4. **"The answer is taken"** (AC1) is the card sending exactly one `ask.answer` with the accepting option (`see`'s
   `hub`). **"Reaches the agent once"** (AC3) is the hub, given what the app sent as the app sends it (#1101's signed
   app connection), recording exactly one `ask.answered` for the ask, with the words, from the card: delivery itself
   is the hub's path as today (#327).
5. **"Opened at half size or more"** is a press on the picture's node, after which the window draws it whole at half
   its size or more. The criterion's 96 px is the app's small draw; any draw under half its size is held to the rule,
   and a first draw at half its size or more fails the premise.
6. **"No timer and no wakeup to an idle window"** is read in the replica that draws only the frames a real window
   would: ten seconds with no input once the card armed, crossing no whole minute of the views' clock (where a "3 min
   ago" may rightly redraw), no frame drawn and none with a notified entity. A timer that
   runs and draws nothing reaches no surface the base has. When the count isn't zero it is compared with the merge
   base's on the same record, built only then. **"Under 0.1 ms to a frame that draws 20 pictures"** is the median CPU
   time of 60 forced frames, this checkout's release replica against the merge base's, five runs, #1097's rule; the
   merge base draws no picture, so the difference bounds tracking from above.
7. **Numbers' median** is over the seen calls' pictures; the fixture is chosen so counting the unseen calls' zeros
   reads the same, so that choice isn't judged. An odd run's middle call belongs to neither half; the fixture's runs
   are uniform, so that isn't judged either.
8. **AC11's pictures** come from the app's views as the replica draws them headless at the reference window (#1101's
   reading); the verdict line is pictured on the session's page, whose return card holds it (design: view).

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: whether an unseen yes still settles a requirement; a channel's
answer (the terminal's stands for it); a film's contact sheet and a before and after as such; Numbers raising no ask
and sending no notification; the half's exact value beyond 96 px against 1512.

## Files

- `helpers.ts`: IDs, plants and the pinned words; the pictures and their manifests; the worlds; the replica and its
  readers; the trace; the surfaces.
- `card.test.ts` (AC1, AC2, AC6), `answer.test.ts` (AC3, AC4), `terminal.test.ts` (AC5), `batch.test.ts` (AC7),
  `numbers.test.ts` (AC8, AC9), `budgets.test.ts` (AC10), `shown.test.ts` (AC11).
- `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
