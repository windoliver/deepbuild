# Acceptance tests for #1412: a canvas restart that can't prove a layer file

Drafted blind, before any implementation, from issue #1412 ("Canvas restart drops a missing layer file and still
pushes the revision": its report, Scope, the four acceptance criteria, Proof and Not in scope, read with
`gh issue view`), `AGENTS.md`, the design's Revision paragraph in `docs/canvas-primitives.md` ("The `doc.patched`
event is the commit point … The `doc.patched` event carries the revision's hash. A restart that can't read a layer
file, or whose rebuilt document hashes differently, stops that one document with an issue naming it and never shows
it under the newer revision, while the other documents restore"), and the code at the base commit `118ec119f`
(origin/main). No other branch, worktree, pull request or diff was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

At the base I read `crates/deep-show/src/shared.rs` (`restore`, `layer_file`, `files`), `shared/calls.rs`
(`open_shared`, the commit that writes layer files by hash and then appends the `doc.patched@1` event,
`shared_revisions`), `crates/deep-show/src/evidence.rs` (`read` returns nothing for a file whose bytes don't hash to
its name), `packages/contracts/schemas/doc.patched@1.json` and `doc.patched@2.json`, and suite `tests/acceptance/96/`
(README, helpers, `commit.test.ts`, `layers.test.ts`), whose approach this suite reuses; `2854/` for the tags and
the BASE-FAILURE format.

## Run

```sh
source ~/.nvm/nvm.sh && nvm use 24
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" \
  NO_COLOR=1 npx vitest run --root tests/acceptance/1412 --no-file-parallelism
```

Any machine. The file builds `deep-show` once (`cargo build --locked --bin deep-show`) and fails every test with
`BLOCKED: deep-show builds` when it can't. Each test makes a temp evidence folder and a temp state folder and removes
both when it ends. Nothing is stopped by name or port; a hung `deep-show run` is stopped by spawnSync's own timeout,
which signals only that child.

## The surface

- **`deep-show run`** (the hub's canvas side, as #96's suite drives it), one scenario line with `state: <folder>`,
  two shared documents (`docs`, A on panel `main`, B on panel `side`, both a two-node board in your layer) and
  your patches from `deep show` in your own shell (the peer check's process table). Read: each patch's `outcome`;
  `read` (`rev`, `hash`, `code`, `issues[].code`) and `revisions` (`revisions[]: {rev, hash, patches}`) of each
  document.
- **The state folder**: layer files at `<state>/layers/<2 hex>/<62 hex>` by SHA-256, and `<state>/record.jsonl`, one
  `{log_pos, session, event}` per line, each event a `doc.patched` event (validated against `doc.patched@<its v>`
  through `packages/contracts`' public entry), `data.doc` = `doc:<id>`, `data.rev`, `evidence` = the layer files it
  wrote.
- **A restart** is a second `deep-show run` on the same state folder.

## Names this suite fixes

The design names no issue code for these cases, so the tests name them and the implementation must use them:

- **`layer_file_missing`**: the restarted document's record names a layer file the state folder doesn't hold (AC1).
- **`layer_file_mismatch`**: it holds the file, but its bytes don't hash to its name (AC2). Changed bytes always
  land here, not on a rebuilt-document hash check, because a layer file is named by its own hash; the rebuilt
  document's hash against the event's is checked by AC3 and AC4 through `data.hash`.
- The code is read from the restarted document's `read` or `revisions` reply: its top-level `code` or any
  `issues[].code`. Where else the issue also appears is left to the implementation.
- **The event's field** (Scope's first bullet): `data.hash`, the name `doc.patched@2` already gives "the SHA-256 of
  the revision's canonical document". The tests don't require v 2; they validate each event against the schema
  version it says and read `data.hash`.

## What "the last one it can prove" means here

Before the restart, the scenario commits three patches to each document, interleaved (A: node 1 to x = 100, 200,
300; B: 110, 210, 310), so each has revisions 0 to 3. The damaged file is one that A's revision-2 event names and no
other event names. Revision 1 is then the last revision of A whose layer files are all intact: revision 3 builds on
revision 2. After the restart A may show revision 0 or 1, or no revision at all (stopped), but if its `read` gives a
`rev`, it is at most 1 and at the `hash` it had before the restart, and its `revisions` list no row past 1. On main
A shows revision 3, rebuilt without the change of revision 2 (the issue's "shows the revision with the layer
missing").

"Restores whole" (AC3, and AC4 for both documents) is: the same shown `rev` and `hash` as before the restart, the
same `revisions` rows (rev, hash, patches, in order), each row past 0 at the hash its `doc.patched` event carries in
`data.hash`, and no `layer_file_missing` or `layer_file_mismatch`. The `data.hash` part is Scope's first bullet ("The
event carries the revision's hash"), the means by which a restart proves a revision; it is why AC3 and AC4 fail on
main too (below).

## The tests (`restart.test.ts`)

Tags are `#1412.` and the first 8 hex digits of the SHA-256 of the criterion's text (`scripts/proof-change.mjs`
criterionId).

| Criterion | Tag | Test |
| --- | --- | --- |
| AC1 one layer file deleted before restart → that document reports a named issue and no revision past the last one it can prove | `#1412.d0145601` | A's revision-2 file deleted → A reports `layer_file_missing`, shows and lists nothing past 1 |
| AC2 one layer file's bytes changed → the same | `#1412.83dd035b` | A's revision-2 file rewritten in place (still JSON, node 1 at x = 555) → A reports `layer_file_mismatch`, shows and lists nothing past 1 |
| AC3 a second document in the same state folder restores whole in both cases | `#1412.8d00dba2` | two tests, one per damage: B restores whole |
| AC4 a clean restart gives the same revisions and hashes as before it | `#1412.09a35255` | untouched state folder: A and B both restore whole |

## On the base (`BASE-FAILURE.txt`)

All five tests fail at their assertion:

- AC1, AC2: A reports no issue and shows revision 3, listing revisions 2 and 3 past 1, at a hash other than the one
  revision 3 had before (the layer file is dropped by `filter_map` and the revision pushed anyway).
- AC3, AC4: the documents restore with the same revisions and hashes as before (that part holds on main), but every
  `doc.patched` event is `v: 1` with no `data.hash`, so no restored revision is proven by its record. They fail only
  for that.

## Not tested

- Repairing a damaged document (the issue's Not in scope).
- A record whose event names a valid layer file of another revision (a rebuilt document hashing differently while
  every file matches its name): no criterion names it, and a test would have to edit the record itself.
- The live path without a state folder (`packages/hub/src/canvas.ts` starts `deep-show canvas` with none).
