# C2 blind redraft: depth fighting needs depth that changes across a face

Test file: `depth-redraft.test.ts`. One `describe` ("#378.29d4b8e6 a fixture with surfaces 0.5 m apart at 5 km
shows no depth fighting, and no part of the city is clipped by a far plane (redraft)") with one `it`. It redrafts the
second test of `depth.test.ts`, the planted `forward_z` run. The first test of `depth.test.ts`, the clean run on
`city-depth.json`, stays as it is.

The criterion: "A fixture with surfaces 0.5 m apart at 5 km shows no depth fighting, and no part of the city is
clipped by a far plane".

New fixture: `fixtures/city-depth-oblique.json`. The first-draft files are unchanged, byte for byte, including
`city-depth.json`, which the first test reads. The test imports only exported helpers from `helpers.ts`: `project`,
`readIds`, `view3d`, `runGpu` and their kin. Its own check, `depthProblems`, and the quad geometry are in the file.

## What I read

- Issue #378.
- `docs/technical-design.md`, Conventions (1089): reversed Z from R2, "a `Depth32Float` target cleared to 0,
  compared greater-or-equal, with an infinite far plane for perspective cameras; the far distance only bounds
  culling".
- The first draft: `README.md` (its surface, the `forward_z` row of Planted programs, and the Depth reading),
  `helpers.ts` (`project`, `frontFace`, `readIds`), `depth.test.ts` and `fixtures/city-depth.json`.
- Base `6173ee0`: `deep-gpu` has no `view3d` call.
- 387's redraft convention.

## What the first draft asserted, and why it can't hold

```ts
const { ids } = draw('forward_z');
const problems = depthProblems(ids, 'forward_z');
expect(problems.some((p) => /depth fighting at 5 km: .* (a|b)-near/.test(p)), 'the check sees the fighting, naming the pair').toBe(true);
```

In `city-depth.json` the camera looks straight down −Z, and every face is a plane of constant z. So each face has a
single depth over all its pixels.

Under the mutant (forward Z, near 0.1, far 10 km), the near and far faces of a pair differ in depth by
0.1 × (1/5000 − 1/5000.5) ≈ 2·10⁻⁹. Both sit near 0.99998, where one f32 step is 2⁻²⁴ ≈ 6·10⁻⁸. Rounding each
vertex's clip z (about 0.8 of a step at 5,000) is larger than the gap. Whether a near face shows is therefore one
coin flip per face:
- if both faces round to one value, draw order decides, and pair B (near face last, compared less) shows its far
  face;
- if the near face rounds a step nearer, it shows whole in either order.

The implementer reports the second case on this Mac's Metal device: both near faces drawn whole. The check then names
no pair, so the first assertion fails while the program is wrong. Depth fighting is a per-pixel effect, so a fixture
with one depth per face can't show it reliably.

## What the redraft asserts instead

`city-depth-oblique.json` is `city-depth.json` turned about the camera's vertical axis by ψ, with sin ψ = 0.6 and
cos ψ = 0.8 (36.87°): every item's place and the camera's target. Three things follow:
- Every centre projects to the same pixel as before, at the same depth.
- The boxes stay axis-aligned (no `rot`), so each pair's faces now stand at 36.87° to the view. A near face's depth
  changes by 180 m across it (4,910–5,090 m). Under the mutant that is about 12 f32 steps over its roughly 37 px.
- A pair's far face sits 0.5 m straight behind its near face along their normal (world +Z). The near face's centre
  is 5,000 m deep, and the faces keep their sizes and their draw order (pair A near first, pair B near last).

The scratchpad generator: `gen.mjs`, which turns each near face's front-centre point and then places the far face
0.5 m behind it.

| # | Assertion | Kept or new |
|---|---|---|
| 1 | Camera near 0.1 and no far; pair A lists its near face first and pair B last | kept (first test's preconditions) |
| 2 | Each pair: both boxes have no `rot`; the far box sits straight behind the near one; the front faces are 0.5 m apart (to 1e−6); the near face's centre is 5,000 m deep (to 1e−3) | kept, with depth measured along the view now that the view is turned |
| 3 | Each near face's corners differ in depth by more than 150 m | new: the property the first fixture lacked |
| 4 | No other item's projected box comes within 4 px of a pair's far face; the farthest block is past 20 km; at least one block is past 10 km; every item's centre projects inside the frame with 20 px to spare | kept or tightened (the first two are new guards on the fixture) |
| 5 | **The clean run**: in the ID target, every pixel of each near face inset 3 px (a quad now, from the four projected corners) shows the near face, in both draw orders; every pixel of the far face inset 3 px and outside the near face dilated 3 px shows the far face; the 25 pixels at the post's and each block's projected centre show that item | new in this test: the first test's check, on this fixture, so a check that misreads the turned geometry can't fail the mutant by itself |
| 6 | `--planted forward_z`: the check names depth fighting at 5 km in a near face (`a-near` or `b-near`) | kept (the disputed assertion, now on a fixture where it is per pixel) |
| 7 | `--planted forward_z`: the check names every block deeper than 10 km (city-10, city-11) as clipped | kept |

Assertion 5 is a new requirement on the implementation: the right program must pass the depth check on this
fixture too. The criterion asks no less: the fixture has the same surfaces 0.5 m apart at 5 km, seen at an angle. With
reversed Z and an infinite far plane, depth is n/z. The gap between the faces is about 1,300 f32 steps at 2·10⁻⁵,
far beyond any per-vertex rounding. The faces' 0.2 m sides cover under 0.05 px.

**How a wrong program fails it.** Forward Z (the README's `forward_z`, unchanged) gives every pixel of a near face
its own depth to round. The relative error each vertex carries changes across a face. So a near face can show whole
only if rounding favours it at every corner, in both pairs. Otherwise:
- pair B, where draw order loses ties, shows its far face wherever the two round to one value;
- pair A shows its far face wherever far rounds nearer.

A finite far plane at 10 km clips city-10 and city-11 (7). A program that draws nothing on oblique faces fails 5.
Draw order standing in for depth fails 5, in pair B.

A CPU model of the mutant, written in the scratchpad (`model.mjs`, not a test), counts the near pixels (inset 3) that
lose:

```
                    city-depth.json (square on)   city-depth-oblique.json
per-pixel rounding  A 0/2116, B 2116/2116          A 0/1380,   B 1794/1840
plus vertex error   A 0/2116, B 2116/2116          A 460/1380, B 1380/1840
reversed Z          0 in every case                0 in every case
```

The model's square-on run fails whole or not at all. Metal's per-face rounding happened to fall the other way, which
is the dispute. The oblique run fails across most of pair B. This is a model, not the GPU: the redraft has not run on
an implementation, because the base has none.

## Planted names and surface fields

There is no new planted name: `forward_z` is the README's, with the same definition. There is no new surface field:
the test sends `view3d` with `targets: ["ids"]` and `capture: [0]`, both already in the README's surface.

## Type check

`npx tsc -p tests/acceptance/378/tsconfig.json` exits 0 with no output.

## Run on the base

`BASE-FAILURE-REDRAFT.txt` holds the run. Every fixture precondition (1–4) holds at the base. The test then fails at the
clean run's reply, on the assertion "the oblique city-depth fixture was answered, not refused". The failure is the
expected one: the base has no `view3d` call.

```
AssertionError: the oblique city-depth fixture was answered, not refused: {"code":"bad_input","reason":"unknown call"}: expected 'bad_input' to be undefined
```
