# Acceptance tests for #233, Oracle lane: upstream tests ported and run against our output

Written first, blind, from issue #233, its oracle page (`doneright/oracles/issues/233.md` and `cases/233.json` in
`DeepBuildAI/deepbuild`, branch `doneright`), the upstream files that page pins (read from its `vendor/` folder), the
design and base commit `5aa64f71`, by a job that never saw an implementation; none existed. #136's rule applies: a
linked test counts only when run against our output, so every case here is asserted against what `deep-show run`,
`deep-canvas-render geometry` or `deep-motion eval` answers. The issue's own lane, with its planted programs, refusals
and budgets, is `tests/acceptance/233/`, whose README defines the surface these tests share (the pack, documents,
Reading the expansion, Reading the drawing, An alias to an ease). The implementing agent doesn't edit these files.

Scope: the six criteria the oracle page links upstream tests to: 1, 3, 4, 5, 8 and 9. The upstream projects are the
upstream math-film library at `a6d5cc02b430fb57d22add51236b6406fbf19d91` (MIT) and a fork of it at
`cfd33af5aa7cc0d6aa7dfe13919744e2124629dc` (MIT). No code is copied: each test's case is re-expressed in TypeScript in
the test that uses it, named after its upstream test; the rate functions' equations are in `reference.ts`.

## Sources and what is ported

| Criterion | File | Upstream | Use |
|---|---|---|---|
| 1 | `c1-axes-coordinates.test.ts` | fork `tests/unit/mobjects/test_plotting.py:191-212` (`test_coordinates_and_points_are_inverse`) | port: four fixed cases over the property search's domains; ticks fit one linear map spanning the length, plot points read back to (x, f(x)) |
| 3 | `c3-riemann.test.ts` | fork `tests/unit/mobjects/test_plotting.py:245-288` | port: x² − 0.25 over [−1, 1], dx 1, left and right; x² over [0, 1], dx 0.25, center and right; each bar's edges read back to x, x + dx, 0 and f(sample) |
| 4 | `c4-to-edge.test.ts` | fork `tests/unit/test_mobject.py:459-468` | port: a square to_edge in eight directions at buffs 0.5, 0, 0.25 and 1, on 1920 × 1080 and 1080 × 1920 |
| 5 | `c5-rate-functions.test.ts` | fork `tests/unit/animation/test_easing.py:31-51, 97-136`; reference `utils/rate_functions.py` (under its package folder) | port: exact ends and held ends for the mapped eases and the there-and-back pulses; squish_rate_func's window, default window and empty window; not_quite_there's proportion |
| 8 | `c8-number-line.test.ts` | fork `tests/unit/mobjects/test_plotting.py:94-122`; reference `tests/module/mobject/graphing/test_number_line.py:62-105` | port: (0, 3, 1) excluding 0 with 1 elongated; `labels` by value; number_to_point on the default line |
| 9 | `c9-planes-tables-matrices.test.ts` | fork `tests/unit/mobjects/test_plotting.py:395-440`, `tests/unit/mobjects/test_grid.py:85-201`; reference `tests/module/mobject/test_table.py:24-45` | port: the seven polar planes' rings and rays; table rule counts and positions; matrix grid spacing and brackets |

Each file's header lists what it leaves out and why. Not run here at all: the reference project's graphical tests
(`test_graphical_units/test_axes.py` with their control frames), which compare that renderer's own pixels; criterion 1's
golden is our own rendering of the upstream library's positions (the issue's lane, `ac1-parabola-golden.test.ts`).

## Tolerances

Upstream asserts 1e-8 to 1e-12 in its units. Our numbers come back as drawn u in f64 (135 u to a unit), so positions are
judged within 1e-6 u (c1, c4, c9's polar planes), coordinates read back within 1e-9 (c3), rate functions within 1e-12 or
exactly where upstream asserts equality (c5), and layout placed through Auto layout, which snaps to device pixels,
within 0.5 px (c8's labels, c9's tables and matrix).

## Run

```sh
npm ci
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/233-oracle --no-file-parallelism --testTimeout=600000 <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/233-oracle/tsconfig.json
```

Each file builds `deep-show` (`--features full`), `deep-canvas-render` and, for c5, `deep-motion` once in `beforeAll`;
`scripts/lanes.mjs` needs `'tests/acceptance/233-oracle/'` in its `alone` list (the implementer's edit). Node built-ins
and vitest only. `BASE-FAILURE.txt` is the one run at the base.
