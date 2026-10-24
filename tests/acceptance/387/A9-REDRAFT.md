# A9 blind redraft: −0 and +0 give one content key and one set of canonical bytes

Test: `canonical-redraft.test.ts`, one `describe` ("#387.a0eea545 a revision whose param is −0 gets the same content
key and canonical bytes as one with +0 (redraft)") with one `it`, the redraft of the first test of
`canonical.test.ts`. The ID is the first 8 hex of the SHA-256 of the criterion's text with `- [ ] ` dropped (checked:
`a0eea545`).

The criterion: "A revision whose param is −0 gets the same content key and canonical bytes as one with +0, and a NaN
or an infinity in a param is refused with out_of_range, naming the path". This redraft covers its first half; the
second half stays in `canonical.test.ts`'s third test, unchanged.

`helpers.ts`, `tsconfig.json`, `fixtures/`, `README.md` and the first-draft test files are copied unchanged from the
first draft's folder; nothing was added to `helpers.ts`.

## What I read

- Issue #387 (scope, field lists, the ten criteria, proof).
- `docs/canvas-primitives.md`: Revision (472–475: `hash: sha256 of the canonical document`; the canonical document's
  defined bytes; "Two patch histories that reach one content … give the same revision hash"), Content key (5049–5055:
  "Canonical params store a float −0 as +0 … the canonical document follows the same rule").
- At the base: `crates/deep-canvas/src/show.rs` (`stamp`: the stamped document's first member is `"id": doc`, the
  call's doc ID; any `id` in the payload is dropped) and `crates/deep-show/src/hub.rs` (`show`: `stamp(&show.document,
  &show.doc.to_ascii_lowercase(), …)`, then `hash = canonical_in(stamped).sha256`; the `revisions` reply's rows
  `{rev, base_rev, writer, hash, state}`).
- The first draft's `README.md`, `helpers.ts` and `canonical.test.ts`.

The checkout's HEAD is `a0d6583`, a descendant of `a5aa0a3` whose diff from it is #674's image sampling
(`deep-canvas-marks`, `deep-marks-render`, `deep-marks-vello`, `deep-show/src/snapshot.rs` and
`tests/acceptance/674/`); neither `show.rs` nor `hub.rs` differs.

## What the first draft asserted, and why it can't hold

```ts
expect(currentHash(replies[3]!), 'the canonical bytes are the same: one revision hash').toBe(currentHash(replies[2]!));
```

`replies[2]` is the `revisions` of the +0 board shown on `DOC.a`, `replies[3]` that of the −0 board shown on `DOC.b`.
A revision's hash is the sha256 of the canonical document (Revision), and the document holds its `id`, which
`deep_show` stamps from the call's doc ID. So one content under two doc IDs has two revision hashes, whatever the
param's sign and whatever any implementation of #387 does. The criterion speaks of one revision's canonical bytes
against another's, with the sign as the only difference; it doesn't ask that two documents share a hash.

A probe at the base (throwaway, in the scratchpad; no `eval`, which the base lacks) showed it:

```
+0 on DOC.a  bedcbc2f6e3e2b8c169dc504c6a6cbed5dfb495b437dafe5605121cab23e34c0
−0 on DOC.b  a639ad86684dabe454eee07fa046f29f31e955b45a31be64bd2d1245d085f56d   (A == B: false)
```

## What the redraft asserts instead

One process, calls in order: the +0 board on `DOC.a` (revision 1), the −0 board on `DOC.b`, a frame of each, the +0
board under another title on `DOC.a` (revision 2), the −0 board on `DOC.a` (revision 3), then `revisions` of `DOC.a`.
A fresh process: the −0 board on `DOC.a`, a frame, then `revisions` of `DOC.a`.

| # | Assertion | Kept or new |
|---|---|---|
| 1 | The scenario text spells `-0.0`; both boards are presented | kept |
| 2 | Every node of the −0 board's frame has the key and result of the +0 board's (`sameNodes`) | kept |
| 3 | Revision 2 (retitled) has another hash than revision 1 | new: the hash sees the content, so 4 can't pass on a hash that ignores it |
| 4 | Revision 3 (−0) has revision 1's (+0) hash, under the same doc ID | new: replaces the cross-ID comparison |
| 5 | Revision 3 is the current one | new: the hash compared is the one shown |
| 6 | In the fresh process the −0 board's nodes have the +0 board's keys and results | kept |
| 7 | In the fresh process the −0 board on `DOC.a` has revision 1's hash | new: the same doc ID in two processes |

The retitled revision sits between the two so that an implementation that treats an unchanged resend specially (no
new revision, or a revision that isn't hashed) can't stand in for the comparison.

Wrong programs it fails: a key that hashes −0's bits (2 and 6: the −0 nodes get other keys); a canonical document
that writes −0 as `-0` (4 and 7); the base (no `eval`: the run is refused). The infinity half (the base's `bad_input`
for `1e999`) is `canonical.test.ts`'s third test, not this one. The base already writes −0 as 0 in the canonical
document, so 3, 4, 5 and 7 hold there (probe: revision 3 = revision 1 = the fresh process's hash,
`bedcbc2f…34c0`; revision 2 `9cfbc240…c6ce`).

Not redrafted: the first draft's second test (generated −0 placements) compares only node keys across `DOC.a` and
`DOC.b`, never a revision hash, so it stands.

## Type check

`npx tsc -p tests/acceptance/387/tsconfig.json`: exit 0, no output.

## Run on the base

`npx vitest run --root tests/acceptance/387 --no-file-parallelism canonical-redraft.test.ts history-redraft.test.ts`
(builds `full` with `cargo build --locked --bin deep-show --no-default-features --features full`): 2 tests, 2 failed,
0 passed. This file's test fails at the run's first reply, because the scenario holds `eval`:

```
× #387.a0eea545 a board with −0 in a rect's box, radius and at.pos and a label's at.pos has the node keys and results of the board with +0, in one process and in two, and the revision hash of the +0 board under the same doc ID, as a later revision of it and in a fresh process 4193ms
AssertionError: deep-show run refused the scenario: {"ok":false,"code":"bad_input"}: expected false to be true // Object.is equality
```

The same scenario without the `eval` calls runs at the base (the probe above), so `bad_input` is the missing call.
