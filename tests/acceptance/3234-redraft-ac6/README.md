# Blind redraft of #3234's AC6: a picture replaced under a presented card

A blind redraft that supersedes only the first draft's AC6 test (`tests/acceptance/3234/card.test.ts`, its `AC6`
`describe`), on the owner's ruling. Every other test of the first draft stands as written. Written from issue #3234,
the design and the base, without the implementation. The implementing agent does not edit these files (AGENTS.md,
Proof).

## What was read

- Issue #3234 (its Scope and acceptance criteria).
- The design at the base: `docs/technical-design.md` (the record's tables, lines 152-156; Every ask ends, line 2249;
  Tests written first and Wrong programs, lines 2678-2683) and `docs/canvas-primitives.md` (Revision, line 494; The
  event catalogue, lines 572-640; Question card, lines 826-832; Sheet `sheet@1`, line 2667). `node
  scripts/design-section.mjs --issue 3234` printed BLOCKED in the base checkout (its git remote isn't a GitHub host),
  so the sections the issue links were read by their titles.
- At the base, for its surfaces only: `packages/contracts/schemas/{ask.created@5,ask.answered@6,doc.patched@2}.json`,
  `packages/hub/src/hub-canvas.ts` (how a revision is recorded), `packages/hub/src/human-answers.ts` (`revisionOf`),
  `packages/asks/src/index.ts` (`changed`, `reoffer`), `crates/deep-replica/src/drive/frames.rs` (`feed`),
  `tests/acceptance/606/outcomes.test.ts`, and the helpers this suite imports (#16, #26, #1463, #1461, #1808, #1101).
- The first draft, `tests/acceptance/3234/` at `/var/tmp/cn298/first3234`: its README, `helpers.ts` and `card.test.ts`.
  Its helpers are copied and trimmed here, never imported.

## The base, the old test, the new test, the criterion

| | |
|---|---|
| Base | `f8c6cff82` |
| Criterion | AC6 `#3234.23f156f5`: "A picture replaced under a presented card, by a new hash, returns the option to not armed with 1 left" |
| Old test | the first draft's `card.test.ts`, `AC6 #3234.23f156f5`: the ask pinned to an evidence manifest; the replacement fed as a new core kind, `ask.moved@1` |
| New test | `card.test.ts` here, `AC6 #3234.23f156f5`: the ask pinned to a document revision; the replacement fed as that document's next revision, `doc.patched@2` |
| Expected | the accepting option not armed, reading `1 of 4 not shown yet`, as the old test expects |

## The event

The replacement is **`doc.patched`** (`doc.patched@2`, catalogued at the base), the next revision of the document the
ask is pinned to. No `ask.*` kind fits, and the design gives the move to the pinned thing:

- The `ask.*` kinds are closed. "The catalog is closed" (canvas-primitives.md:574); its `ask.*` rows are the steps
  `ask.created`, `ask.batched`, `ask.later` and the closing kinds (canvas-primitives.md:613-615); outcomes "come from a
  closed set" and "each closing event names one outcome" (technical-design.md:2249). `#606.9092f0b3` refuses any other
  `ask.*` kind, so `ask.moved` breaks a landed test. `ask.superseded` closes the ask and names a newer one: the card the
  criterion keeps presented would be gone.
- What moves is the pin, not the ask. `pinned_to` is "the commit, document revision or evidence hash the ask shows; an
  answer after it moved says what changed" (technical-design.md:153), and an answer's `on` is "the revision the ask
  showed" (canvas-primitives.md:614). At the base a commit pin moves by the worktree's own commits, with no ask event
  (`packages/asks/src/index.ts`, `changed`; `packages/hub/src/human-answers.ts`, `revisionOf`).
- An evidence pin can't move: its ref is a SHA-256 (`ask.created@5`'s `pinned_to`), the name of fixed bytes. Of the
  three pin kinds, only a document revision has a next one, and `doc.patched` is the event that records it, `{doc, rev,
  …}`, with `hash` the canonical document's SHA-256 in the evidence store (canvas-primitives.md:494, 640). A sheet's
  cells are one of the lists the issue names, and a sheet is a document (Sheet `sheet@1`).
- The card already treats it as a change: `rearm_on: content`, "any change re-arms it" (canvas-primitives.md:830-832);
  the issue: "the card arms again as it does for any change".

## Surfaces (the implementation must provide these)

The first draft's surfaces 2 and 3 (a drawn picture in the snapshot; the card, its `card-option:<id>` nodes, `"armed"`,
and `<left> of <all> not shown yet`) hold unchanged. Its surface 1 gains one form:

- **A taste ask pinned to a document revision.** `ask.created` as at the base (`deep_ask.taste`), `pinned_to: {kind:
  "doc_revision", ref: "doc:<id>@<rev>"}` (the base's `doc:<id>@<rev>` form, as a verdict key's `doc_revisions` hold
  it). The ask's pictures are those its document's newest recorded revision lists: the `doc.patched` whose `data.doc` is
  `doc:<id>` with the highest `rev`, its canonical document read from the evidence store under `data.hash`.
- **A picture replaced under a presented card** is that document's next revision, `doc.patched@2` from the session's
  agent's connection (`writer: "mcp:<session>"`, `data.writer: "agent"`), whose canonical document lists the same
  pictures with one hash swapped. The test feeds it to a running replica (`feed`), as the base's hub records one
  (`packages/hub/src/hub-canvas.ts`, `recordRevision`).

## Readings, where the issue leaves a choice

1. **The revision's canonical document** is the first draft's manifest, `{"pictures": [{"sha256": "<64 hex>", "size":
   [<w px>, <h px>]}, …]}`, in RFC 8785 form, so the pictures are listed the same way under either pin kind. A canvas
   document of profile `sheet` would list its pictures through `assets` and cells, which no criterion here needs; a
   later redraft may move to it.
2. **Which picture is replaced**: one the window no longer draws whole once all four were shown, so its replacement,
   drawn in its slot, is not shown when the card is read. That is checked: the new picture must not be drawn whole at
   half its size across the arming interval, or the test fails naming the fixture's premise, not the card.
3. **When the card is read**: the arming interval and 200 ms after the feed, so a card that only re-arms on the change
   (as for any change) and keeps counting the old picture has armed again by then.

## The wrong programs this test fails on

Not run: the replica draws on macOS only, and this was written on Linux. By reading:

- **The base** draws no `picture:<sha256>` node: the first expectation fails, naming the card.
- **A card that keeps the pinned revision's pictures** (ignores `doc.patched`): it stays armed with 0 left; fails on
  "must be not armed", naming the old and new hashes.
- **A card that only re-arms on the change** and keeps counting the old picture as shown: armed again after the
  interval; fails the same way.
- **A card that counts every picture not shown again on a change**: reads `4 of 4`; fails on `1 of 4`.
- **A card that drops the replaced picture from the count** (counts three): reads no count or `0 of 3`; fails on `1 of 4`.

The criterion names no planted twin, so none is added; the release preflight's mutants of the change's lines are the
wrong programs the trace lane runs (technical-design.md:2682).

## How to run

With Node 24.22 and cargo first on `PATH`, on macOS, from the repo root, once this folder is placed at
`tests/acceptance/3234-redraft-ac6/`:

```sh
npm ci --ignore-scripts && npm run build --workspaces
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/3234-redraft-ac6 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3234-redraft-ac6/tsconfig.json
```

- `deep-drive` comes from #1101's `driveBin`, unplanted. Every HOME is a temp folder; only what the test started is
  stopped, by PID. It starts a real hub and draws in a replica, so it needs the same `alone` macOS lane in
  `scripts/lanes.mjs` as the first draft's folder.
- Neither command was run here: the base checkout has no `node_modules`, and the replica needs macOS. A type-strip of
  `card.test.ts` parsed.
- Vitest writes `node_modules/.vite/` under `--root`; delete it before committing.

## Files

- `card.test.ts`: AC6 only.
- `helpers.ts`: the first draft's pictures, world, replica, readers and trace, trimmed to AC6, with the document pin
  and `doc.patched` added.
- `tsconfig.json`: as the first draft's.
