# A4 blind redraft: one document by two histories, one set of keys

Test: `history-redraft.test.ts`, one `describe` ("#387.15327229 the same document reached through two different patch
histories gets byte-identical content keys and cache hits, and no key contains an epoch or any other change counter
(redraft)") with one `it`, the redraft of the first test of `history.test.ts`. The ID is the first 8 hex of the
SHA-256 of the criterion's text with `- [ ] ` dropped (checked: `15327229`).

The criterion: "The same document reached through two different patch histories gets byte-identical content keys and
cache hits, and no key contains an epoch or any other change counter (parity/kernel/key-history.scene)".

`helpers.ts`, `tsconfig.json`, `fixtures/` (the scene among them), `README.md` and the first-draft test files are
copied unchanged from the first draft's folder; nothing was added to `helpers.ts`.

## What I read

- Issue #387; `docs/canvas-primitives.md` Revision (472–475: `hash: sha256 of the canonical document`; "Two patch
  histories that reach one content … give the same revision hash") and Content key (5049–5055: "Epochs … never enter
  a key, so the same content reached through another edit history gets the same key").
- At the base: `crates/deep-canvas/src/show.rs` `stamp` (writes the call's doc ID as the document's `id`) and
  `crates/deep-show/src/hub.rs` `show` (hashes the stamped canonical document).
- The first draft's `README.md`, `helpers.ts`, `history.test.ts` and `fixtures/parity/kernel/key-history.scene`.

HEAD is `a0d6583`, a descendant of `a5aa0a3` that differs from it only by #674's image sampling; `show.rs` and
`hub.rs` are the same.

## What the first draft asserted, and why it can't hold

```ts
expect(currentHash(revsB), 'both histories reach the same document (one revision hash)').toBe(currentHash(revsA));
```

`revsA` is the `revisions` of `DOC.a` after the short history, `revsB` that of `DOC.b` after the long one. The
revision hash is the sha256 of a canonical document that holds the doc ID `deep_show` stamped into it, so the two
differ whatever the histories do. The criterion and Revision speak of the same document (one doc ID) reached by two
histories; the scene's two histories run on two doc IDs only so their frames can share one process's cache.

A probe at the base (throwaway, in the scratchpad; the histories' revisions without `eval`):

```
short on DOC.a        673548698ad2c8d7ceea758e8c023f2c3a50eba48918e3e9013c08026bc46519
long on DOC.b         ac3f6fbe2bcde3cecb9c01f98d638917e9e1565ef38339823ab31a5d62900871   (A == B: false)
fresh, FINAL on DOC.a 673548698ad2c8d7ceea758e8c023f2c3a50eba48918e3e9013c08026bc46519   (== short)
fresh, FINAL on DOC.b ac3f6fbe2bcde3cecb9c01f98d638917e9e1565ef38339823ab31a5d62900871   (== long)
```

## What the redraft asserts instead

The first process is the first draft's: the short history on `DOC.a` and the long on `DOC.b`, a frame at 1 s after
each revision, then `revisions` of both. The fresh process now shows the scene's document once on `DOC.a` (with a
frame, as before) and once on `DOC.b`, with `revisions` after each.

| # | Assertion | Kept or new |
|---|---|---|
| 1 | Every revision of both histories is presented | kept |
| 2 | The two histories' last frames have the same nodes with the same keys and results (`sameNodes`) | kept |
| 3 | The long history's last frame runs no operator | kept |
| 4 | It finds at least one result by key (`hit`) | kept |
| 5 | Both fresh revisions are presented | new (preconditions of 6 and 7) |
| 6 | The short history's current revision has the hash of the scene's document shown once on `DOC.a` in a fresh process | kept (the first draft compared `fresh` with `revsA` too) |
| 7 | The long history's current revision has the hash of the scene's document shown once on `DOC.b` in a fresh process | new: replaces the cross-ID comparison |
| 8 | The fresh process's frame has the short history's last frame's keys and results | kept |

6 and 7 together say what the dropped assertion meant: each history reaches the scene's document, compared under its
own doc ID, so 2's equal keys are keys of one content. Wrong programs it fails: a key holding an epoch, a revision
number or a count of revisions (2: the long history's last frame has other keys; 8 against a process with no
history); a canonical document that carries history (6 or 7); the base (no `eval`: the run is refused). 6 and 7 hold at
the base (probe above).

Not redrafted: the first draft's second test (generated detours) compares only node keys, never a revision hash, so
it stands.

## Type check

`npx tsc -p tests/acceptance/387/tsconfig.json`: exit 0, no output.

## Run on the base

`npx vitest run --root tests/acceptance/387 --no-file-parallelism canonical-redraft.test.ts history-redraft.test.ts`:
2 tests, 2 failed, 0 passed. This file's test fails at the run's first reply, because the scenario holds `eval`:

```
× #387.15327229 parity/kernel/key-history.scene: the short and the long history each reach the scene's document under its own doc ID, the same keys and results at 1 s, and the second's last frame runs nothing, finding its results by key 1052ms
AssertionError: deep-show run refused the scenario: {"ok":false,"code":"bad_input"}: expected false to be true // Object.is equality
```

The same histories without `eval` run at the base (the probe above), so `bad_input` is the missing call.
