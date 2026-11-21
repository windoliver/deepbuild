# Acceptance tests for #832: catalog.dominance's paired runs, interval and pairing

Written first, blind, at base commit cfc1e6a71 ("design(#832): name catalog.dominance's surface as built"), from issue
#832 ("catalog.dominance: paired runs with and without each card or upgrade, and a row that wins on its own fails": its
Scope, 3 acceptance criteria and Proof line, as the brief gave them), its Oracle page (as the brief gave it), the design
sections it names and that tree alone, by a job that never saw an implementation; none existed, and no other commit,
branch, worktree, pull request or GitHub page was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle lane's port is in
`tests/acceptance/832-oracle/`. Lean: one test file per criterion, each running the planted program its criterion names.

## What was read

- `docs/canvas-primitives.md`: Check input: catalog kinds, with its As built (#194) and As built (#832); Asset: tables:
  catalogs `table.layout@1` and its As built; Check input: playtest; Play interface `game.play@1`; Check input: plug-in
  reads; Logic `logic@1` (data assets at `assets_at`, the read region's entries, the step's seed); logic.tuning's As
  built (#194) (the copy "baked in the catalog's place").
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong
  programs, Dogfooding). `AGENTS.md`.
- At the base, only for the surfaces these tests use: `tests/acceptance/555` (README, helpers, programs, a test),
  `tests/acceptance/194` (README's surface, helpers, fixtures' types, programs) and `194-oracle`,
  `tests/acceptance/184/helpers.ts`, `tests/acceptance/533/helpers.ts`; `packages/checks/catalog` (`index.ts`,
  `check.ts`, its manifest), `packages/checks/playtest` (`index.ts`, `iface.ts`, `types.ts`, `run.ts`'s play calls, its
  manifest); `packages/extension-host/src/host.ts` (`deep.canvas.play`, `runCheck`, the validator of a passed play);
  `crates/deep-logic/src/play.rs`, `grid_bot.rs` (the `none` form, the greedy legal bot), `piece.rs` (control slots,
  data assets), `track.rs`; `crates/deep-replica/src/drive/play.rs`; `scripts/lanes.mjs`, `scripts/throttle.mjs`,
  `scripts/studied-names.mjs`, `scripts/budget-window.mjs` (the criterion ID).

What the base has, which the tests rely on: `deep-catalog pack`; `deep-drive`'s `play` with a piece whose logic item
names a catalog among its data assets, the greedy legal bot on a play interface of the `none` form, `piece_seed: run`,
spans in steps, values at each step and replays of a track; the extension host's `deep.canvas.play` and `runCheck`.
What it lacks, which the tests need: `catalog.dominance` (the plug-in's manifest lists six kinds), `dominance.ts`, the
play call's `off`, and the host's rules for this kind's plays.

## Run them

```sh
node scripts/throttle.mjs build --wait 240 -- npm ci --no-audit --no-fund        # once, in a fresh worktree
node scripts/throttle.mjs build --wait 240 -- npm run build --workspaces         # once
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- \
  npx vitest run --root tests/acceptance/832 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/832/tsconfig.json
rm -rf tests/acceptance/832/node_modules/.vite
```

Every test passes its own timeout (90 minutes) above `--testTimeout`. Each file builds, once and honoring
`CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` (#184's helper), `deep-logic` (#533's, for the duel's layout
probe), `deep-catalog` (#194's) and #533's assembler from a copy outside the repo (#555's helper). Off macOS a test
fails `INCONCLUSIVE:` first (the replica's binaries exit on any other OS), never a pass; cargo that can't run is
`BLOCKED:`. Nothing depends on time or load: every expected value rests on the replicas' plays and the design's
arithmetic. Folders are temporary and deleted; processes are #184's helpers' children, stopped by PID. A test leaves
the checkout as it found it.

**Lanes.** The folder belongs in `scripts/lanes.mjs`'s `alone` list (the implementer adds the line, as #555's and #194's
folders are there): each file starts four replicas and an extension host and plays the duel about 1,000 (criterion 3)
or 4,800 times (criteria 1 and 2, two checks of 2,400 plays and replays each). No `timed` entry: nothing here times
anything. Criteria 1's and 2's files will likely run past two minutes and so belong in `slow` once a run on an
implementation is recorded. The oracle folder needs no entry: it imports one module and runs in milliseconds.

Time. On the base the suite fails in under a minute once the binaries are built. With an implementation, a check of
200 pairs over five rows is 1,200 plays and their 1,200 replays; 1,200 plays of the duel took 83 to 93 s here on four
debug replicas at load about 200, so criterion 1's and criterion 2's files should take some 6 to 12 minutes each and
criterion 3's (40 pairs) a few, plus what the host and the plug-in add (estimate; the suite can't run before the
implementation). Cold builds of the replica take many minutes on a loaded machine.

## The surface

The issue and the design name catalog.dominance's whole surface: the spec's `dominance` (`{playtest, catalog, table,
offered, taken, goal, limit, pairs = 200}`), `catalogs` and `play`; the `offers` column; a play's `off: {catalog,
table, row}` and its answer `off.sha256`; pair i's seed hash(the playtest's seed, i) and the playtest's first bot;
the pairing rule; b, c, the shares, d = (b − c)/n and its interval; the verdicts, `needs`, the outcome; the result's
`catalog.found` and `dominance`; `runDominance(input, play, carried, playFn, planted?)` and `binomialInterval(k, n,
confidence = 0.95)` in `packages/checks/catalog/dominance.ts`; the planted runners `dominance_straddle_passes` and
`dominance_unpaired_seeds`. The tests use exactly those. Where the design leaves a form open, this suite reads it as
below; the implementer builds these readings, or a dispute goes to a blind redraft.

- **The hub.** An extension host with the catalog plug-in installed from `packages/checks/catalog` under a grant of
  this suite's documents, checked and loaded in the hub (#194's way), whose replica is a pool of `deep-drive` processes
  taking the host's play call with the piece named `<doc>@<rev>` (#184's and #555's way). Its manifest lists
  `catalog.dominance` among its checks. The check runs through `runCheck('catalog.dominance', spec, …)`.
- **The spec.** `{kind: "catalog.dominance", dominance: {playtest: "R1", catalog: <sha256>, table: "cards", offered:
  "offered", taken: "taken", goal: "won", limit, pairs?}, catalogs: {<sha256>: {bytes, record}}, play: <the playtest's
  input>}`. `offered` and `taken` are keys of the play interface's `values`; the goal `won` has `when: "duel.won"`, a
  logic array path.
- **The plays.** A with-run is a play call with a `bot` and no `off`; a without-run one with a `bot` and `off`; a replay
  one with no `bot` and a `track`, the run's recorded `entries`, at the run's seed (the without-run's with its `off`).
  Pair i is 0-based. A reply that isn't ok is thrown, as `deep.canvas.play` throws it.
- **The result.** `dominance.rows[]`: `row` the row's ID as written, `interval` `[lo, hi]`, `needs` a count or the
  string `"more than 65535"`. A finding's `row` is the ID; `catalog.unpaired`'s `pair` is i and its `seed` hash(the
  playtest's seed, i), pair i's own seed, whichever run broke. A failure's `test` is `cards.<row ID>`. Messages name
  numbers as JavaScript prints them (`0.995`, `0.475`), as `catalog.found` holds them ("as written", #194's rule).
- **The planted runners.** `runDominance(spec.dominance, spec.play, spec.catalogs, playFn, '<runner name>')`, the
  name a string, its `playFn(piece, run)` this suite's pool, answering as `deep.canvas.play` does; it returns the check
  result or a promise of it.

## The card duel (`duel.ts`)

One logic item, `duel`, at 60 Hz, of class figure, reading `pick` (a slider) and naming its catalog among its data
assets. Its catalog has one table, `cards`: `id`, `damage: i32`, `recoil: i32` and `offers: i32` (range [0, 4]). The
hero starts at 25 hp, the foe at 24. Each turn the duel offers three cards, each slot filled on its own: attempt a = 0,
1, … draws h = hash(the init seed, the turn, the slot, a), takes row (h >> 32) mod rows when its `offers` is above
h & 3, and leaves the slot empty after 64 attempts. So a row whose `offers` is 0 is never on offer, and taking one row
out changes only the slots that would have held it: a pair's runs agree until the row is first offered, and then in
every other slot. An entry on `pick` naming a filled slot takes its card: the foe loses its damage, the hero its recoil;
a foe at 0 or below is felled (`won`); else the foe strikes for 1 to 6, drawn by hash(the init seed, the turn), and a
hero at 0 or below falls (`lost`); a duel at turn 12 not won is lost. It publishes `offered` (each slot's card as its ID
hash, 0 when empty or over), `taken` (turn t's card at slot t), `won`, `lost`, `hero`, `foe`, `turn`, the legal rows
`(take, slot, 0)` with each row's `score`, its card's damage, and `accepted` and `refused`.

Its interface (`duelPlay`), the `none` form: `values {offered, taken, won, lost, hero, foe}`, `turn`, `actions {take:
{control: pick, args: option}}`, `legal {rows, count, score}`, `accepted`, `refused`. The playtest (`duelPlaytest`): the
greedy legal bot alone, 20 runs, seed 832, `span {steps: 128}` (the duel is over by step 13; checkpoints at 0, 60 and
120), the goal `won`, `piece_seed: run`.

Catalogs, the four normal cards ash, fern, moss and reed (damage 3, recoil 0, offers 4) in each, and:

| Catalog | Fifth row | Used by |
|---|---|---|
| planted | brute: damage 30 (ten times), recoil 0, offers 4 | criterion 1 |
| normal | brute: damage 3 | criterion 1's clean twin |
| edge | edge: damage 6, recoil 3, offers 4 | criteria 2 and 3 |

## How the numbers were chosen

Before any implementation, the duel was played here at the base through `deep-drive` by a scratch harness that isn't
part of the suite (deleted). The base has no `off`, so each without-run played a piece whose logic item names this
suite's own copy of the catalog, the row's offers cell set to 0, in the catalog's place, which is what the design's
`off` makes. 200 pairs a catalog at hash(832, i), the greedy bot, 128 steps, `piece_seed: run`; this suite's own
judge and interval read them:

| Catalog | Row | b | c | with | without | difference | 95% interval of the difference |
|---|---|---|---|---|---|---|---|
| planted | brute | 104 | 0 | 1 | 0.48 | 0.52 | [0.4838, 0.52] |
| planted | ash, fern, moss, reed | 0 | 0 | 1 | 1 | 0 | [0, 0] |
| normal | each of the five | 0 | 0 | 0.48 | 0.48 | 0 | [0, 0] |
| edge | edge | 51 | 6 | 0.705 | 0.48 | 0.225 | [0.16236, 0.26242] |
| edge | ash | 5 | 10 | 0.705 | 0.73 | −0.025 | [−0.0573, 0.0174] |
| edge | fern | 8 | 10 | 0.705 | 0.715 | −0.01 | [−0.0512, 0.0346] |
| edge | reed | 4 | 13 | 0.705 | 0.75 | −0.045 | [−0.0734, −0.0002] |
| edge | moss | 6 | 16 | 0.705 | 0.755 | −0.05 | [−0.0864, 0.0005] |

So criterion 1's limit is 0.2: brute's interval lies wholly above it and every other row's wholly below, on the
planted catalog and on its clean twin. Criterion 2's limit is 0.22: edge's difference, 0.225, sits on it, its interval
holds it, and every normal card's lies below it; there this suite's arithmetic gives `needs` 17,800 (the scaled
interval's low end lies 3.8e-9 above 0.22 at 17,800 and 1.4e-7 below at 17,799; at the limit 0.2 it would be 912).
Edge's c of 6 keeps its interval off the degenerate b = m case. Under the design's pairing no pair broke the rule;
paired as `dominance_unpaired_seeds` pairs them, 186 to 194 of each row's 200 pairs did (a pair on different seeds can
agree by chance where the rule looks). Replays of 12 of the runs reached the same checkpoints (steps 0, 60 and 120)
and final hash. These are readings for choosing the limits: the tests read every number again from the plays the
implementation makes, and check the expected verdicts from them.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #832.d6fbcd45 | the planted card fails, naming it and both shares; at normal damage it passes | `ac01-dominant.test.ts`: on the planted catalog, from the replicas' plays, each row's 200 pairs (with-run at hash(832, i), without-run at that seed on the row's copy), b, c, shares, difference, taken count and this suite's exact interval; brute reads FAIL with a catalog.dominant finding (table, both shares, difference, interval, limit 0.2, pairs) and the failure `cards.brute` naming brute and both shares; the normal cards PASS; failed; testsRun 1,000. On the normal catalog every row PASS, passed. Fails on the base, a plug-in that never fails a row or fails every row, reads shares from anything but the pairs' goal values, plays the without-run on the whole catalog, or names other shares |
| AC2 #832.c07dc2c3 | a straddling row reads INCONCLUSIVE, naming the pairs needed; a plug-in that reads PASS there fails | `ac02-inconclusive.test.ts`: on the edge catalog with 200 pairs and limit 0.22, edge's interval (from its plays) holds the limit; it reads INCONCLUSIVE, its failure `cards.edge` starting `INCONCLUSIVE:` and naming its `needs`, a count at which the scaled interval lies clear of the limit while one fewer doesn't (or "more than 65535" when none up to 65,535 does); the normal cards PASS; nothing found; uncounted. The planted `dominance_straddle_passes` on the same input: the same judge fails it, naming edge reading PASS. Fails on the base, that runner, a plug-in that reads the row FAIL or PASS or names a count that doesn't clear |
| AC3 #832.d550c82e | each pair's runs share a seed, differ only in the row's offers, both replay; a planted pairing on different seeds fails, naming the pair | `ac03-pairing.test.ts`: on the edge catalog with 40 pairs, for each row and pair, from the plays: one seed, the first bot, one span and piece seed; the without-run's `off` names the catalog, table and the row's index, and its `off.sha256` is this suite's own copy's (the row's offers cell 0, no other byte changed); offered, taken and won agree before the with-run first offers the row and then in each other slot, and the without-run never offers or takes it; each run's replay reaches its checkpoints and final hash; the evidence holds the catalog, every copy and every run's track; no catalog.unpaired; testsRun 200. The planted `dominance_unpaired_seeds`: for every pair the plays show broken when paired as it pairs them, a catalog.unpaired finding naming the table, row, pair, seed hash(832, i) and first step, and a failure `cards.<row>` naming the row, the pair and the seed; failed. Fails on the base, that runner, a plug-in that plays a without-run on another seed or catalog, skips a replay or never checks a pair |

The Oracle lane (`../832-oracle/`) holds the binomial interval to an upstream statistics library's rows for criteria 1
and 2; this suite's own interval, from which its expected verdicts and counts come, must meet the same rows first, or
the test is `BLOCKED:` (`helpers.ts`, `exact`).

## Planted programs

| Program | Where | Criterion | What catches it |
|---|---|---|---|
| brute, ten times a normal card's damage | `duel.ts` | 1 | catalog.dominant on brute, its shares named |
| brute at normal damage | `duel.ts` | 1 | the clean twin: every row PASS |
| `dominance_straddle_passes` | the plug-in's `dominance.ts` | 2 | criterion 2's judge: edge reads PASS where its interval holds the limit |
| `dominance_unpaired_seeds` | the plug-in's `dominance.ts` | 3 | each pair its two runs break must be named catalog.unpaired with its seed and first step |

## Readings where the issue and design leave a choice

- **"Sits on the limit"** is read as a row whose difference lies near the limit and whose 95% interval of it holds the
  limit at 200 pairs: edge's 0.225 against 0.22 (above). A limit equal to the difference was not chosen: no count
  would then clear it, and `needs` would only ever read "more than 65535".
- **"Naming the pairs needed"**: `needs`, named in the INCONCLUSIVE failure's message as a whole number; checked
  against this suite's own arithmetic: at the count named the scaled interval lies clear of the limit, and at one fewer
  it doesn't, each within 1e-6. Not a pinned 17,800: near that count one pair moves an end by about 1e-7, so two sound
  quantile routines may land a few pairs apart; the tolerance refuses any count further off.
- **"Fails, naming the pair"** for the planted pairing: the plug-in's own pairing check is what fails it; the pairs it
  must name are those whose two runs, paired as the runner pairs them, break the design's rule by their values (a pair
  on different seeds can, by chance, agree where the rule looks; such a pair isn't required).
- **The shares named "as written"**: as JavaScript prints the number.
- **AC3's 40 pairs**: the pairing doesn't depend on the count, and 40 keeps the file to minutes.

## Not covered (scope with no criterion here)

BLOCKED with no `play`; a table without `offers` refused before any run; a bool `offers` column; a goal `when` that's an
expression refused; a model bot refused; the host's own refusals of seeds, bots and `off` (exercised only by the right
program's runs passing through it); the conformance kit's entries for the new kind; tuning a catalog.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts` (catalogs and copies, the pool, the hub, the runs, the
exact interval, the judge), `duel.ts` (the duel, its catalogs, schema, interface, bot and playtest), and one test file
per criterion: `ac01-dominant`, `ac02-inconclusive`, `ac03-pairing`.
