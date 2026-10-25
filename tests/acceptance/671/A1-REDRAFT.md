# Blind redraft: AC1's first test

Redrafted by a job that read only issue #671, the design sections the README lists, the README, `helpers.ts`, the
fixtures, `BASE-FAILURE.txt` and the base commit `d122341`. It did not read the implementation or its diff.

## The dispute

`present.test.ts`'s first AC1 test checked the screen's two layers with:

```ts
expect(rows.map((b) => [b.band, b.owner]).sort(), 'two layers on screen, one for each test agent, in the agent band')
  .toEqual([['agent', { kind: 'agent', id: LABEL_AGENT.thread }], ['agent', { kind: 'agent', id: SCENE_AGENT.thread }]]);
```

The `.sort()` was meant to make the comparison order-insensitive. JavaScript's default sort compares elements as
strings, and both rows stringify to `agent,[object Object]`, so the sort keeps the screen's order. The assertion
therefore demanded the label's layer before the scene's. Neither the issue nor the README fixes that order (the
README says "on screen two layers in the agent band, owned by `thread-scene` and `thread-label`"). A screen that lists
the scene's layer first, in the order the agents sent them, meets the criterion and failed the test.

## What changed

- The test moved to `present-redraft.test.ts`, named with the same `AC1 …` text plus ` (redraft)`, under the same
  `describe`. It was removed from `present.test.ts`, along with `scopeHolds` and the imports only it used (the root
  tsconfig's `noUnusedLocals` refuses them otherwise). The snapshot test is unchanged.
- The layer rows and the expected rows both go through `bySet`, which sorts `[band, owner]` rows by a key built from
  the band and the owner's `kind` and `id`. Two lists holding the same rows in any order now compare equal; anything
  else still fails `toEqual`, including an owner with an extra field.
- One check was added, from the README's "two layers on screen": the two non-card rows name two different `layer`s.
  This catches a screen that lists one layer twice under two owners.
- Everything else is kept as it was: the fixtures' scope (`scopeHolds`), both replies `presented` with
  `issues: []`, every scene item in `agent:thread-scene`'s layer and every label item in `agent:thread-label`'s,
  the label's layer apart from the labelled box's, `read`'s `draws` holding every box, the plane, the beacon and every
  label item, and the revision's hash. The proof files (`ac1-replies.json`, `ac1-hub-document.json`) are the same.
- The file builds only `deep-show`, the one binary this test uses. The original file built `deep-gpu` as well, for
  its snapshot test.

## Wrong programs it still fails on

Checked against the comparison logic on its own in node: scene-first and label-first both match; the rest do not.

- A hub that folds the label into the scene's layer: the screen shows one agent row, or two rows naming one layer
  (the new distinct-layer check). The document checks also fail, since the label's items would sit in
  `agent:thread-scene`'s layer.
- A hub that stamps either document as you: that row's owner is `{kind: 'you'}`, which matches neither expected row.
- A screen that shows one layer: one row against two expected.
- A check that refuses or warns on the scene (the base refuses its orbit channel): `expectPresentedClean`.
- An anchor to another writer's item left unresolved: the label's items are missing from `draws`.

## At the base

Not run. Building the base binaries in a scratch checkout was too heavy for this job, and vitest was not run against
the worktree's binaries. The failure at the base comes from `BASE-FAILURE.txt` instead. There, the original test
failed at its first `deep show` assertion: the hub refused the scene with `ref_unresolved` at
`channels/orbit/target` ("items/cam/params/orbit/azimuth reaches nothing"). The redraft makes the same calls with the
same fixtures and runs the same `expectPresentedClean(scene, …)` before the layer comparison, so at the base it fails
at that same assertion with the same issue. The redraft changes only checks that run after that assertion.

Type-checked with `npx tsc -p tests/acceptance/671/tsconfig.json` (exit 0).
