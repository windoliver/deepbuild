# Acceptance tests for #670: an agent's figure through deep show, checked and rendered back the same every time

Written first, from issue #670 (its scope, its five acceptance criteria and its proof line), the bodies of the
issues it depends on (#373 and #392 read in full; the others through their suites' READMEs), the design
sections it names and those they lean on, and base commit `a5aa0a3` ("Merge pull request #675 …
feat/305-shared-sealed"), by a job that never saw an implementation of #670; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (technical
design: Dogfooding).

What was read:

- `docs/technical-design.md`: Seeded and replayable (876); The canvas core (1041), with its module table and
  the Conventions paragraph; Document (1088), Item and kind (1096), 2D marks and paint (1104), Mark set, scale
  and encode (1112), Channel and key (1158: "It can never: Integrate state between frames"), Clip, placement
  and marker (1182); Patch (1467: "a whole revision through `deep_show` names every item it removes, or it's
  refused with `unintended_removal`"); Render-back (1491) and Document check (1499: "determinism by hash");
  Dogfooding (2508); the parity suite and reftests (2528–2532: "a seek and a play" must draw the same); Tests
  written first (2539).
- `docs/canvas-primitives.md`: the path grammar (38: "A sub-address after `#` names … a mark set's row key"),
  Handles (46), the status-color rule (68), Honest numbers (76), Document envelope (291), Writer layer (428),
  Patch (451), Revision (468: "a refusal keeps the last good one"; a whole revision is diffed "in every map
  keyed by ID"), Admission and latch (698), Render-back (929: "2D snapshots render with Vello CPU"), Paint:
  stroke gradients (1750), Mark set and columns (2046), Bound value (2133), Status binding (2172), Channel and
  key (5253), and What holds a document to its rules (8160).
- At the base: the merged suites `tests/acceptance/{389,390,391,392,393,394,372,373}/` (READMEs; #393's
  helpers and fixture, whose JSON-lines and scenario pieces `helpers.ts` copies), and the crates they drive:
  `crates/deep-show` (`main.rs`, `hub.rs`, `snapshot.rs`), `crates/deep-canvas` (the document check),
  `crates/deep-canvas-marks` (mark sets, bound values, the clean look) and `crates/deep-canvas-motion`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
cargo build --locked --bin deep-show
npx vitest run tests/acceptance/670 --no-file-parallelism
npx tsc -p tests/acceptance/670/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Like #393's they build a cargo binary in each file, so they run one file at a time (`scripts/lanes.mjs` needs
its `alone` list widened to this folder, as the earlier suites' READMEs say for theirs). Every file first runs
`cargo build --locked --bin deep-show` and fails each of its tests when the build fails. Each test opens an
evidence store in a temporary folder and deletes it; snapshots are read back through the store's public entry
(`packages/evidence/src/index.ts`). Everything runs on the CPU, on any platform: render-back draws with Vello
CPU, and nothing here draws the window.

**The proof** (the issue's Proof line: the document, each reply with its issues, and the snapshots with their
hashes from both runs) is written to `$TMPDIR/deep-670-proof/` (`PROOF_DIR` in `helpers.ts`, `os.tmpdir()`),
rewritten on each run and never read back (delete it first when you keep a run's proof, so no file of an earlier run stays): `ac1-figure.json` and every other document sent, each reply
(`ac1-…-reply.json`, `ac2-replies.json`, `ac5-replies.json`, …), `ac2-hashes.json` (each time's hash in the
first run, the second run and the fresh process), each snapshot as `ac2-snapshot-<t>.png` (its hash in `ac2-hashes.json`),
`ac3-hashes.json`, and the planted renderer's hashes and failures (`ac2-planted-*.json`). Nothing in it is
personal: the sessions, processes and handles are the fixtures'.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names `deep show` from a test process standing in for an agent, render-back headless on Vello CPU,
the document's rules, revisions and a planted renderer, and says the work is built only on what has merged.
So the tests drive the merged surface #393 defined, and nothing else: the `deep-show` binary's `run`
subcommand (`target/debug/deep-show`), whose scenario stands in for the hub, read and answered exactly as
#393's README gives it (one scenario per stdin line, one JSON line out per line, `{"ok": true, "replies":
[…]}`). Each test sends:

- **The agent and its process tree.** One session, `sess-checkpoint` (thread `thread-checkpoint`), whose agent
  process is 4100; the test process that runs `deep show` is 4102, under the agent's tool shell 4101. The
  calls are `{"call": "deep show", "peer": {"pid": 4102, "start": 1200}, "doc", "document", "t", "size":
  [640, 400], "include": ["issues", "pixels"]}`, so the peer check makes them the agent's, and each revision is
  the agent's own writer layer (#393 AC4 and AC6).
- **The record.** The bound bar's reading `reading:01JB7R00000000000000000670` (value 75, `as_of` 705,600,000
  flicks: its source and as-of time) and the badge's verdict `verdict:01JB7V00000000000000000670` (state
  `pass`), both the agent's session's, so its credential reads them.
- **`revisions` and `screen`** (#393's), to read which revision is current and which layers are on screen.
- **`planted`**: one new value, `seeds_noise_from_clock`, the proof's planted renderer (open question 4).

A second run "in the same process" is a second scenario line on the same `deep-show run` process's stdin (a new
run of the hub, as #393's convention gives each line); "a fresh process" is another spawn.

## Fixtures

Written by this job before any implementation of #670 ran, as the agent sends a document (no `id`, no
`layers`, no item `layer`: the hub mints the ID and stamps the layer):

- `fixtures/figure.json`: a 640 × 400 `figure`, `transport.span` 2 s, holding every item the scope lists:
  - the title, a `text@1` "Checks passed this week" (no digits, so honest numbers don't touch it);
  - the chart: `ys`, a linear `scale@1` from 0–100 onto 340–100 u, and `chart`, a `marks@1` of `mark: "bar"`
    (R2's mark set, #373) with three rows keyed 1, 2 and 3, `x`/`x2` columns and a `y` column through `ys`,
    painted `muted` with a 4 u stroke whose linear gradient runs from `muted` to `ink` (R2's stroke gradient);
  - the bound bar: row 2, `chart#2`, whose `y` the bound value `middle-bar` fills from the reading (its
    column holds 0 there, since a bound value is never typed over; open question 1);
  - the badge, a `rect@1` with no paint whose fill the status binding `badge-verdict` takes from the verdict
    (#392's form, `items/badge/params/paint/fill`);
  - the marker, a `circle@1` whose x the channel `marker-x` keys linearly from 96 u at 0 s to 528 u at 2 s,
    across the chart (#391's channel form `{target, type, keys}`).
- `fixtures/figure-no-bar-source.json`: the figure with `bound_values/middle-bar/source` removed.
- `fixtures/figure-literal-badge.json`: the figure with the badge painted `{"fill": {"role": "status.pass"}}`
  and `status_bindings` removed.
- `fixtures/figure-no-marker.json`: the figure with the marker left out: the `marker` item and the
  `marker-x` channel that keys it.

Each variant changes nothing else.

## Criteria to tests

Each test's name starts with its criterion's ID. Each states the wrong program it fails on.

| ID | Criterion (the issue's text) | Tests, the assertions that carry each condition, and the wrong program each fails on |
|---|---|---|
| AC1 | The figure is presented with no issues; the same figure with the bound bar's source removed is refused, its issue naming the bar | `present.test.ts`. "Presented with no issues": the figure's reply has `issues: []` (no issue of any severity) and `outcome: "presented"`, with one 640 × 400 snapshot; its revision is stamped `{kind: agent, id: thread-checkpoint}` and the one layer on screen is the agent's, in the agent band (its own writer layer). Fails on a check that refuses or warns on any part of the figure. "Refused, its issue naming the bar": the no-source variant is `refused`, with an error whose `ids` hold `chart#2`, or hold `chart` with `chart#2` in its `path` or `actual`; no snapshot; no revision current. Fails on a check that lets a bound bar with no source show, and on one whose issue names only the bound value entry (`middle-bar`) and not the bar it fills |
| AC2 | Render-back at 0 s, 1 s and 2 s returns snapshots whose hashes are equal on a second run and in a fresh process | `hashes.test.ts`. One scenario renders the figure back at `0s`, `1s` and `2s`; it runs twice in one process and once in another. Every reply is presented; `hashFailures` (each time's hash equal on the second run and in the fresh process, a missing snapshot a failure too) returns nothing; each snapshot reads back from the evidence store by its hash (its bytes' SHA-256 is the hash) as a 640 × 400 PNG; and the three times' hashes differ, since the marker moves (a render-back that ignores `t` would make this and AC3 hold vacuously). Fails on a renderer seeded by the clock, a per-process hash order, or a cache that changes what it draws. **The proof's planted renderer**: the same three runs with `planted: "seeds_noise_from_clock"` each return a snapshot at every time, and `hashFailures` fails on them, every failure starting `snapshot at <t>: hash …`, naming the snapshot |
| AC3 | Seeking to 1 s gives the same snapshot hash as playing from 0 s to 1 s | `seek.test.ts`. Seek: a fresh run whose only render-back is at `1s`. Play: one run that renders back every frame from `0f` to `60f` (0 s to 1 s at the time grammar's default 60 fps) in order. Every play frame is presented with a snapshot; the play's last frame differs from its first (the marker moved, so the comparison can fail); and its hash equals the seek's. Fails on a renderer that steps motion from frame to frame or carries state between frames ("It can never: Integrate state between frames") |
| AC4 | A literal status color written on the badge, not through a verdict binding, is refused, naming the badge | `badge.test.ts`. The literal-badge variant is `refused` with an error of code `status_color_unbound` (#392's code for a status color taken from anything but a status binding) whose `ids` hold `badge`; no snapshot; no revision current. Fails on a check that lets a literal status role through, and on one that refuses the figure only for something else. A check that refuses every badge fails AC1's presented figure, whose badge goes through its verdict binding |
| AC5 | A whole revision that leaves the marker out without naming it in its removes is refused with unintended_removal, and the last good revision stays shown | `removal.test.ts`, first test, in one run: the figure (snapshot at 1 s), then the no-marker variant with no `removes`, then the figure again. "Refused with unintended_removal": the no-marker revision is `refused`, an `unintended_removal` error's `ids` hold `marker`, and it has no snapshot. "The last good revision stays shown": afterwards the current revision has the good one's `rev` and `hash`; the screen still shows the agent's one layer; and the figure re-sent is diffed against what is current with `marker` and `marker-x` unchanged (not created again) and draws at 1 s the good revision's snapshot hash. Fails on a deep show that presents the revision (the planted `presents_unnamed_removal` of #393 is that program), or makes the refused revision current, or takes the layer off screen. Second test: the same no-marker revision with `removes: ["marker", "marker-x"]` is presented with both listed as `removed`, so a check that refuses every revision dropping an item fails |

## Open questions, where the issue and design leave an interface open

1. **The bound bar's target.** The design binds a value to "ID + path" and lets a path name "a mark set's row
   key" after `#` (the path grammar); a bar of R2's mark set is a row, and picking names it `<id>#<key>`. The
   tests bind row 2's `y` column: `items/chart#2/y`, so the reading's value goes through the set's y scale
   ("numeric targets go through scales"). Which field follows `#2` (`y`, or `params/y`) is not fixed by the
   design. The bound row's own `y` holds 0 in the column ("never typed over"); whether a bound row's column
   must hold a particular placeholder is not fixed either. "Its issue naming the bar" is read as `chart#2` in
   the issue's `ids`, or `chart` in `ids` with `chart#2` in its `path` or `actual`.
2. **"Playing from 0 s to 1 s".** The merged render-back takes one time per request and has no play request,
   so a play is every frame from 0 s to 1 s at 60 fps rendered back in order in one run of the hub, each a
   `deep show` of the same document (each an unchanged whole revision), and the seek is a render-back at 1 s in
   a fresh run. If a play request lands (Render-back's `t: time | sheet`), this reading stays valid.
3. **"The marker"** is read as the scope's marker, an item key-framed across the chart, not a timeline
   `markers` entry; leaving it out leaves out its item and the channel that keys it, and the refusal must name
   at least the item.
4. **The planted renderer's name.** #393's `planted` list has no renderer that seeds noise from the clock, so
   this suite names it `seeds_noise_from_clock`: a render-back that adds noise to each snapshot's pixels
   seeded from the system clock at sub-millisecond resolution, reachable only through the scenario's
   `planted`, for this proof. It is expected to be added; at the base the binary answers `bad_input` to it.
5. **The badge's refusal code.** The issue says only "refused, naming the badge"; the test also reads the
   code `status_color_unbound`, which #392's README defines and the merged check raises for a literal status
   role.
6. **Snapshot size.** The tests ask for 640 × 400, the figure's size.

## What the merged code does differently from the design (found while writing these tests)

Read from the base's code and from running the base binary; none of it changed the tests.

- The core document check (`crates/deep-canvas/src/document/check.rs`, `check_targets`) allows only `target` in
  a `channels` entry, so a channel with `type` and `keys` (Channel and key's fields; #391's form) sent through
  `deep show` is refused with `unknown_field` at `channels/<id>/keys` and `channels/<id>/type`. A clip and
  placement carrying the same channel pass the check (clips and placements are not field-checked).
- The same check refuses every `#sub` target ("no kind in this build has parts"), so no bar of a mark set can be
  bound, though the path grammar names a mark set's row key as a sub-address. Bound values are drawn only on
  `items/<id>/params/text` targets (`crates/deep-canvas-marks/src/scene.rs`, `bound_texts`).
- A bound value with no `source` is refused with `out_of_range` at `bound_values/<id>/source`, naming only the
  bound value, not the item it fills.
- A mark set's `paint.stroke.gradient` passes the check but bars draw with a solid fill only
  (`crates/deep-canvas-marks/src/data.rs`); no criterion reads those pixels, so no test asserts them.
- Honest numbers are checked on texts only: bar heights from literal columns raise nothing.

Not tested, because no criterion asks: the stroke gradient's and the bars' pixels, salience and the camera
(the figure needs neither; the scope lists them among what the work may build on), `deep show --check`'s
result, the audit and timing fields, and the bad-input convention (no new subcommand).
