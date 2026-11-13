# #1718 criterion 1 blind redraft, after #1720: `deep-show run`'s reference holds the shipped first-party packs

#1718's criterion 1 says that through a running hub and `deep mcp`, each of six `deep_kinds` ops "equals, apart from
`core` and `set_digest`, the reply `deep-show run` gives the same call". Its suite, `tests/acceptance/1718/`, takes that
reference from `deep-show run` with no packs in its store, because the live hub's canvas core held none. #1720 changes
that: "The hub installs the first-party packs that ship in its release into its canvas core when the core starts,
through the pack check". The same call to `deep-show run` with no packs is then no longer the reply a correct hub gives.
The redraft keeps #1718's criterion and changes only the reference: `deep-show run` holding the shipped first-party
packs as the hub's canvas core holds them.

Written from issue #1718 (closed; criterion 1, and criterion 3, which runs criterion 1's check), issue #1720 (read live
with `gh issue view`), the frozen `tests/acceptance/1718/` (README.md, helpers.ts, hub.test.ts, planted.test.ts,
fixtures/stamps-at.mjs, BASE-FAILURE.txt), #1720's own blind suite at `5fd5abc5c` (`tests/acceptance/1720/`: README,
helpers.ts, hub.test.ts, BASE-FAILURE.txt; tests, not an implementation), base `de304b9ff` (AGENTS.md;
`docs/technical-design.md`, "Five ways in, all onto the same core" and Dogfooding; `docs/canvas-primitives.md`, Pack and
its subsections; `crates/deep-show/src/kinds.rs`, `registries.rs`, `packs.rs`, `hub.rs` `install_pack`, `main.rs` the
scenario's `packs`; `crates/deep-canvas/src/document/packs.rs`, `Packs`; `packages/hub/src/canvas.ts` `shape`,
`packages/hub/src/core.ts` `canvasWorld` and `install`, `packages/hub/src/packs.ts`; `packs/*/pack.json`;
`tests/acceptance/26/helpers.ts`; `tests/acceptance/484/redraft-1637/REDRAFT.md` for form). The example the brief
names, `tests/acceptance/724-redraft-1405/`, isn't in the base, and this job reads no other commit, so its shape was
taken from the brief's description. I never read an implementation of #1720, any diff, branch, PR or other worktree.

## What #1720 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1718/hub.test.ts` › AC1 deep_kinds sheet answers without isError, its reply equal to deep-show run's apart from core and set_digest | #1718 AC1 | The sheet is built from the listing (`kinds_sheet` → `kinds_listing`), which holds every entry the installed packs fill (`registries_reply` → `pack_entries`, `self.packs`); #412's planted `SheetWithoutPackEntries` shows the sheet must hold them. #1720 installs the shipped packs in the hub's core and its Scope puts their recipes and aliases in the listing, so a sheet equal to a no-pack `deep-show run`'s is a hub that left them out | `1718-redraft-1720/hub.test.ts` › AC1 deep_kinds sheet … with the shipped first-party packs installed … (redraft 1720) |
| `1718/hub.test.ts` › AC1 deep_kinds list … | #1718 AC1 | The first page of the listing is the listing "with the packs installed" (`kinds_listing`). #1720's Scope: "`deep_kinds list` on a live hub shows those packs' recipes and aliases", and its criterion 3 lists every shipped pack with its version, so the no-pack page is no longer the reference | `1718-redraft-1720/hub.test.ts` › AC1 deep_kinds list … (redraft 1720) |
| `1718/hub.test.ts` › AC1 deep_kinds search … | #1718 AC1 | Search ranks the gallery, the guides and then every entry of the same listing (`kinds_search` → `kinds_listing().rows`); with the packs' recipes and aliases in the listing, `box` finds them | `1718-redraft-1720/hub.test.ts` › AC1 deep_kinds search … (redraft 1720) |
| `1718/hub.test.ts` › AC1 deep_kinds word … | #1718 AC1 | `kinds_word` answers from the aliases of the packs the core holds. #1720's criterion 2: through `deep mcp`, `word BoxGeometry` answers `familiar.box@1`, "byte-equal to `deep-show run`'s answer with the pack installed"; a no-pack `deep-show run` answers `no_match` | `1718-redraft-1720/hub.test.ts` › AC1 deep_kinds word … (redraft 1720) |
| `1718/planted.test.ts` › AC3 the planted canvas core fails criterion 1 for every op, naming it; the same installed tree with its own canvas core passes | #1718 AC3 (runs AC1's check) | Its clean half holds #41's installed tree with its own canvas core to criterion 1's check for every op, against `deep-show run` with no packs. Under #1720 a release ships its first-party packs and its hub installs them (#1720's suite reads this on the same installed tree), so that half fails a correct release at `word`, and at sheet, list and search once the listing shows the packs. The planted half doesn't change: the stamped `at` is refused before any pack is read | `1718-redraft-1720/planted.test.ts` › AC3 … against deep-show run with the shipped packs installed (redraft 1720) |

Each redrafted test is the original with one change: the reference replies come from `references` in this folder's
`helpers.ts` instead of #1718's. Every other line, the check (`kindsFailures`, `allFailures`), the calls (`argsOf`), the
session, the installed tree and the plant are #1718's helpers, imported unchanged. The test names are the originals'
with "with the shipped first-party packs installed" and "(redraft 1720)".

## Kept as they are

- `1718/hub.test.ts` › AC1 deep_kinds gallery …: `kinds_gallery` reads only the installed corpus and the corpus runs, and
  `set_digest`; no pack is read, and #1720 adds no example to the gallery. The no-pack reference is the reply a correct
  hub gives.
- `1718/hub.test.ts` › AC1 deep_kinds read …: `kinds_read_example` reads the kinds' generated examples, then the corpus;
  the gallery's first hash is a corpus example, and no pack is read.
- `1718/hub.test.ts` › AC2 cursor on word is refused with unlisted_field at /params/arguments/cursor: `kinds_reply`
  refuses an unlisted field before the op runs, so no pack is read.

The redrafted `planted.test.ts` still runs all six ops in its clean half (its criterion holds the installed tree to
criterion 1 for every op); for gallery and read its reference with the packs equals the one without (On the base).

## Readings

- **"As the hub's canvas core would hold them" is the scenario's `packs`.** The hub hands its canvas core its packs as
  the world's `packs`, a list of `{id, dir}` (`core.ts`, `canvasWorld`: `this.libraries.packs.all()`; `canvas.ts`,
  `shape`), and `deep-show canvas` and `deep-show run` read that field with one parser (`main.rs`, the scenario's
  `packs`, #306), installing each through the pack check before the first call (`hub.rs`, `install_pack`). So the
  reference is `deep-show run` with `packs` in its scenario and the one deep_kinds call, run with the binary the hub runs
  as its canvas core (#1718's `checkoutCore`, or the installed tree's own `deep-show`). No field is invented.
- **Which packs: every folder of the checkout's `packs/` with a `pack.json`**, read at test time (at the base: blender,
  chrome-fx, composites, familiar, fx, godot and unreal; `studio-1.0.0/` holds only looks and `examples/` no pack.json),
  each with the version its pack.json gives. #1720 says "the first-party packs that ship in its release"; its criterion 3
  names "every folder under `packs/` with a `pack.json`".
- **Their IDs are `deepbuild/<name>`.** A pack.json has no owner. The castle names `deepbuild/composites@1.0.0`,
  #1720's evidence `pack_missing` (`deepbuild/composites` at 1.0.0), `familiar.rs` `deepbuild/familiar`; #1720's own
  suite reads it the same way. The canvas core sets the manifest's `id` from the one given (`packs.rs`, `load`).
- **Only the packs the canvas core's own check installs.** #1720: "A pack that fails its check isn't installed", and its
  criterion 3 holds a pack that fails its check absent from the listing. So the reference first offers every shipped pack
  to the same binary (`packs` in the scenario, one `{"call": "packs"}`) and keeps those whose row reads `state:
  installed`, then holds only those. At the base the check installs five and refuses fx and chrome-fx (On the base).
  Whether the hub offers a refused pack to its core every time or checks it once and never hands it over, a correct
  hub's core holds the same admitted set. If the check installs none, the test fails `BLOCKED:`, since the reference
  would then be #1718's and prove nothing about #1720.
- **The packs' folders are the checkout's.** The hub may hold a staged copy (`packs.ts`, `stage`: `<root>/packs/<digest>/`,
  recipes inlined, as the canvas core's `load` inlines them). No deep_kinds reply at the base names a folder, and
  `Packs` keeps admitted versions by ID (`BTreeMap`), so neither the folder nor the order offered changes a reply. A hub
  that changes a pack's bytes before its core checks them answers differently, and the test names the op.
- **The installed tree's reference holds the checkout's packs too**, not packs found in the tree: a release of this
  checkout ships these, and a tree that ships none has a hub that installs none, which this test must fail.
- **The origin.** #1720's Scope says the packs' origin is first-party; no criterion of either issue states a field.
  The reference gives whatever origin the canvas core gives a pack offered as `{id, dir}`. A hub whose core shows
  first-party only through something `deep-show run`'s `packs` can't carry would differ here, naming the op; that is a
  dispute for the owner, not something this redraft can name a field for.
- **"The gallery's first hash"** is `examples[0].hash` of `deep-show run`'s gallery with the packs installed (equal to
  the one without at the base). The redrafted hub test sends no `read`; the planted test does.
- Everything else is #1718's README's reading as it stands: "equals, apart from `core` and `set_digest`" compares every
  top-level field but those two by their JSON, `list` and `search` on their first page; the session is bound by its hooks
  and its `session.start` read; the plant is #1718's `fixtures/stamps-at.mjs` in the installed tree.
- **Homes** are `/tmp/dh1718x-*` (this folder's `openSession`, #1718's with the folder renamed); the installed tree's
  prefix stays #1718's `/tmp/dh1718-p-*` (`install`, imported unchanged). Every process is stopped by PID by #1718's
  `cleanup`; no test uses the network or writes into the checkout's `packs/`.

## Wrong programs they still fail

- #1718's: a canvas core that stamps `at` onto a deep_kinds call (#1718's merge base, and the plant), each op refused at
  `/params/arguments/at`, the failure naming the op. The redraft changes nothing on that path.
- #1720's: a hub whose canvas core holds none of the shipped packs (the base). `word` fails: `no_match` against
  `familiar.box@1` with the familiar pack's conversion. So does the planted test's clean half, on the installed tree,
  whose release ships no packs at the base.
- A hub that holds a different set: a pack missing, one the check refuses, another version, or bytes changed before
  the check. Each fails the ops whose reply reads it.
- sheet, list and search fail a hub without the packs only on a canvas core whose listing shows something of them. At
  the base no first-party pack fills a registry entry (none has `entries`, and the base lists only the registry entries
  packs fill), so these three replies are the same with and without the packs, and these three tests pass at the base.
  #1720's Scope puts the packs' recipes and aliases in `deep_kinds list`; from then on a hub without them fails these
  three, and a hub with them fails the originals.

## On the base

`BASE-FAILURE.txt` is the one run at `de304b9ff` (warm builds, 14 s): 5 tests, 2 failed, 3 passed.

- word (`hub.test.ts`): **fails**. The hub, whose canvas core holds no pack at the base, answers `no_match`; the reference
  answers `familiar.box@1` with the familiar pack's conversion, `pack: deepbuild/familiar@1.0.0` and `renamed_from:
  CubeGeometry`. The failure names the op.
- sheet, list and search (`hub.test.ts`): **pass**, for the reason under Wrong programs: the base lists nothing of a
  first-party pack, so these replies are the same with and without the packs.
- AC3 (`planted.test.ts`): **fails** at its last assertion. The planted half holds (each op stamped, refused at
  `/params/arguments/at`, named); the installed tree with its own canvas core passes five ops and fails word, since the
  base's release ships no first-party pack.

By hand, outside the suite, with the base's `deep-show run`: the pack check installs blender, composites, familiar,
godot and unreal (`checks: 1` each) and refuses chrome-fx (`unknown_field` at `functions` and `operators`) and fx
(`unknown_field` at `operators`); with the five installed against none, #1718's six calls answer the same apart from
`core` and `set_digest` for sheet, list, search, gallery and read, and differently for word (`code`, `target`,
`conversion`, `pack`, `renamed_from`). The suite type-checks (`tsc -p tests/acceptance/1718-redraft-1720/tsconfig.json`,
exit 0). Not run: the frozen `tests/acceptance/1718/` suite at this base, and any implementation of #1720 (none exists).

## Run it

```sh
npm ci && npm run build --workspaces      # the tests run the built CLI: deep hub run, deep mcp
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1718-redraft-1720 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1718-redraft-1720/tsconfig.json
```

Each file builds `deep-show` and `deep-hook` once in the checkout's `target/` (#1718's `useCanvasCore`); a cold build is
long. `scripts/lanes.mjs` needs `'tests/acceptance/1718-redraft-1720/'` in its `alone` list, as `'tests/acceptance/1718/'`
is: the files build cargo, start hubs and lay out an installed tree. That edit is the implementer's, at the swap.

## At merge

The frozen `tests/acceptance/1718/` stays as written. The owner's call is to swap its four AC1 tests for sheet, list,
search and word, and its AC3 test, for the five here, and to keep its AC1 tests for gallery and read and its AC2 test
as they stand.
