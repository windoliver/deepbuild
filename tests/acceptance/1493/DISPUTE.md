# #1493: AC1's first draft disputed, and its blind redraft

The first draft of this suite (`test(1493): blind acceptance suite for the pack census`) lists the reference's public
names, apart from the script, by the rule the brief gave it: the entries of an `export { … } from '…'` list, and X of
`export class|function|const X`. The pinned reference reaches most of its names through `export * from` lines whose
files export by a local list with no `from`: each geometry file ends `export { BoxGeometry };`, the materials index is
one local `export { … };` list, and the rounded-box addon ends `export { RoundedBoxGeometry };`. That listing holds
none of familiar@1's 17 geometry words, its material word or its addon word, while the criterion requires the mapped
rows to be exactly pack.json's 22 aliases and every row to name a listed name, so no program can pass it. The rule
was the brief's error, not the job's.

Under Dogfooding the criterion went back to the same job, told the base fact above and never the work or its diff.
Its redraft, `1493-redraft-ac1/census.test.ts`, lists every name an export list or declaration gives, and passes on
the work. Nothing in either draft was edited.

| Criterion | First draft (disputed) | Blind redraft |
|---|---|---|
| AC1 `#1493.943e1d6c` | `1493/census.test.ts`, its AC1 test | `1493-redraft-ac1/census.test.ts` (1 test, pass) |

## The failing output on the work

```
#1493.943e1d6c familiar@1's census at the pin
  AssertionError: no row names a word the reference files do not export
  + "BoxGeometry", "CapsuleGeometry", … "MeshStandardMaterial", … "RoundedBoxGeometry", … "WireframeGeometry"
  ❯ tests/acceptance/1493/census.test.ts:48
```

On the work the same file's other three tests (AC2, AC4, AC5) pass, and the suite's other files pass 5 of 5.

## The ruling

The owner, in the session (Nov 15, 2026): "Yes, swap it". The redraft proves AC1. The lanes work by file, so the first
draft's `census.test.ts` is kept by hand (`scripts/lanes.mjs`), and its AC2, AC4 and AC5, which pass, run by hand
with it.
