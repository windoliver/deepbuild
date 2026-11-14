# Blind redraft of #1485 AC2

This folder is the blind redraft of #1485's AC2 (docs/technical-design.md: Dogfooding, "A disputed test goes to a fresh
run of that job"). It supersedes `tests/acceptance/1485/cap.test.ts` for AC2; nothing else of `tests/acceptance/1485/`
changes.

## The only facts it was written from

- The issue, windoliver/deepbuild#1485, and its criterion AC2: "Four 2,000 × 2,000 linear images (64,000,000 B) draw,
  and a fifth (80,000,000 B in all) is refused. A planted cap that counts only copies draws it and fails."
- The design at the base: `docs/canvas-primitives.md` "Image `image@1`" and "Asset", `docs/technical-design.md`
  "Dogfooding" and "Tests written first".
- The base commit, `f2af227be`: the surfaces of `crates/deep-marks-render` (`deep-canvas-render`'s JSON-line `raster`
  and `render`, the `planted` request field, `asset::Plant`'s names), and the helpers of
  `tests/acceptance/1485/helpers.ts`, copied into `helpers.ts`.

Disclosure: while listing `tests/acceptance/1485/README.md`'s headings to find its surface section, a `grep` printed that
README's AC2 row in its "Criteria to tests" table (one line). `cap.test.ts` there was not opened. This draft departs
from what that line said on the one point the design now decides (below).

## What it draws, and why at these sizes

The design's budget rule as it stands at the base (Image `image@1`): "The budget counts what a frame draws at the levels
it draws", a level being "a box reduction by a power of two in linear light, the smallest at or above the drawn size";
"at most 64 MB of drawn levels per document". A 2,000 × 2,000 picture drawn small counts only its small level, so the
criterion's byte sums hold only where each picture is drawn at its full level. So each picture here is drawn at its own
size:

- Five assets, PNGs written by the test, each 2,000 × 2,000 px of one flat opaque color (p1 … p5, five colors apart from
  the ground), stored by sha256 in a scratch store.
- One board of 10,000 × 2,000 u, one writer layer; `image@1` items `p1` … `p5` in draw order (`order` a0 … a4), each
  `sampling: linear`, `fit: fill`, box `[2000·(i−1), 0, 2000, 2000]` u, side by side with no overlap.
- `view.zoom` 1, so each box is 2,000 × 2,000 device px: each picture's drawn level is the whole picture,
  2,000 × 2,000 × 4 = 16,000,000 B. Four are 64,000,000 B, within 64 MB (and 64 MiB); five are 80,000,000 B, past both.

`cap.test.ts`, for each of `raster` (Vello CPU, every platform) and `render` (GPUI's offscreen Metal renderer, macOS
only; elsewhere it skips `INCONCLUSIVE`):

- **The criterion.** The board with p1 … p4 answers `ok: true`, writes a 10,000 × 2,000 PNG, shows each picture's color
  at its box's center within 3 codes, and the ground at the empty fifth box's center. The board with all five answers
  `{"ok": false, "code": "over_budget", "path": "items/p5/params/asset…"}` (a suffix such as `: <sha256>` is allowed).
- **The plant.** With `planted: "cap_counts_copies_only"` the same check runs; the test passes only if the plant draws
  the fifth picture (p5's color at its center) and the check fails on exactly that: one miss, naming the refusal of
  `items/p5/params/asset`.

## Run it

```sh
npm ci                         # once, if node_modules is missing
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/1485-redraft-ac2 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1485-redraft-ac2/tsconfig.json
```

The file builds `cargo build --locked --bin deep-canvas-render` once (cargo from `PATH`), copies the binary out of
`target/`, writes under the OS temp folder and deletes what it wrote. A run with `--root` leaves Vitest's cache in
`tests/acceptance/1485-redraft-ac2/node_modules/.vite`; delete it.

## Base

At `f2af227be` on this Mac (Apple silicon, macOS), one run, unleased (no `deep` CLI on `PATH`, so `scripts/lease`
ran the commands directly): `Tests 4 passed (4)` in 20.9 s, and `tsc` clean.

- `raster` and `render`, the criterion: PASS. Four pictures draw, each at its color; the fifth is refused `over_budget`
  naming `items/p5/params/asset`.
- `raster` and `render`, planted `cap_counts_copies_only`: PASS, meaning the wrong program is caught. The plant draws
  all five pictures, p5 at its color, and the criterion's check fails on that alone.

The base already carries #1485's cap (it counts every decoding a frame draws, at full size), so the honest test passes
there; the plant is this criterion's wrong program. The test does not separate the base's full-size count from the
design's drawn-level count, since at these sizes the two are equal.
