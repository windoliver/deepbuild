# Dispute: the first draft asks a picture to change that the issue's own rule leaves as it was

This redraft exists because of this dispute. The first draft is `tests/acceptance/2386/ac6-hashes.test.ts`, the one
test of "Each fixture of #1653 and #536 keeps its pixel hash" (`#2386.b3f6fe16`). This file is the work's, not the
blind job's: the job wrote the other files of this folder and never saw this one.

## What fails

The first draft draws ten pictures of #1653's and #536's fixtures and holds each to the hash the merge base draws.
All ten hold on the work. Its last line then asks that one more picture differ, to show the hash sees what the issue
moves: #1653's isometric fixture with `draw: [32, 32]` and `anchor: [0.5, 0.75]` on its set.

```ts
expect(pixelHash(drawn[FIXTURES.length]!), 'the hash sees what this issue moves: …').not.toBe(hashes[ISO]);
```

The run, on the work:

```
FAIL  ac6-hashes.test.ts > AC6 #2386.b3f6fe16 no pixel of a set without draw or anchor changes > AC6 #2386.b3f6fe16
      each fixture of #1653 and #536 keeps its pixel hash
AssertionError: the hash sees what this issue moves: the isometric fixture with draw [32, 32] and anchor [0.5, 0.75]
draws other pixels than the fixture without them: expected '511cf05ff120de0e36bc10f99699557f84c11…' not to be
'511cf05ff120de0e36bc10f99699557f84c11…' // Object.is equality
```

The tiles are drawn at 32 × 32 u from their anchors: criteria 1 and 3 hold the same code to the issue's boxes and
texels, and pass. On this fixture the taller quads change no pixel. Its set sits at the origin of a 128 × 64 u page
with cell [32, 16], rows (1, 0) and (2, 1) in one opaque color and (0, 0) and (0, 1) in the other. With the two fields
each quad grows 16 u upward from its cell's quad and keeps its sides and its foot. The part added above (0, 0) and
above (1, 0) is off the page or under its own cell's quad; the part above (0, 1) covers only (0, 0)'s quad, the same
color; the part above (2, 1) covers only (1, 0)'s, the same color. Worked from the issue's rule (quads placed by
anchor, drawn in order of cell center y, then x), 0 of the page's 8,192 pixels differ between the two documents.

So the line asks for a difference the issue's rule doesn't give. The first draft's README lists no probe of that
picture: at the base, which reads neither field, the two hashes are equal for another reason.

## How the redraft was made

The test went to a fresh run of the suite's blind job with the same inputs: issue #2386, the design, base
`b6b99ad8c`, and the surface the suite already asks for (`deep-canvas-render raster` and the issue's two fields). It
never saw the work, the first draft or this dispute. It was told to redraft the test of the clause, to show that a
comparison isn't vacuous, and to work out from the issue's rule which pixel settles what it expects of a picture
before it reads one. It was not told why a redraft was asked for.

It drew eleven pictures of the two suites' fixtures and took their hashes at the base. It found the same thing by
itself, at the base, emulating the issue's quads with free rows: with a tile standing up from its cell (`draw: [w,
2h]`, `anchor: [0.5, 0.75]`), #1653's isometric fixture and #536's flat hex board draw the picture they draw with
neither field. So its twin hangs each tile from its cell's top edge instead (`draw: [w, 2h]`, `anchor: [0.5, 0.25]`),
and before it reads a picture it works out, from the issue's rule in f64, a pixel under a last-line cell that the hung
tile must cover and the plain set leaves bare. Its two tests: each of the eleven pictures keeps the base's hash, with
a named pixel inside a row and one under its cell read as well; and each of the eleven, hung, reads the row's tile at
that pixel and hashes differently.

On the work both pass, run once (`ac6-hashes.test.ts`, 2 of 2). At the base the first passes, as a guard, and the
second fails at its own assertion on all eleven pictures (`BASE-FAILURE.txt`).

## What is decided, and what is yours

Nothing is decided. The first draft stays where it is and fails at that one line; no lane skips it, and its ten
hashes pass. `scripts/lanes.mjs` gains only the redraft's folder in `alone`, since its file builds a cargo binary and
a redraft folder takes no lane file.

This is the one dispute that comes to you (design: Dogfooding): take the redraft's reading, that the comparison is
shown to see a set's pixels on a twin the issue's rule moves; or hold the first draft's line, which asks #1653's
isometric fixture to change under a `draw` and an `anchor` that, by the issue's rule, change none of its pixels. If you
take the redraft, `tests/acceptance/2386/ac6-hashes.test.ts` goes by hand in `scripts/lanes.mjs`, by your signed tag.
