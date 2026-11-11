# #220 evidence

Run on the reference Mac (Mac17,10, M5 Max, AC power) on Nov 10, 2026, at load averages of 300 to 900 from other sessions.

## The blind suite (`tests/acceptance/220`, base a9f78a6b), each file once on the final code

| AC | Tag | Result |
|---|---|---|
| AC1 | `#220.a1078979` | 4/4 pass, the second triple in a linux/amd64 `node:24.22.0-bookworm-slim` container with no network: the same SVG bytes as this Mac |
| AC2 | `#220.ec8a4363` | 2/2 pass |
| AC3 | `#220.472f9775` | 3/3 pass |
| AC4 | `#220.e4f3b85e` | the 40-glyph SVG is 26,398 bytes, under 64 KB: pass. The times are INCONCLUSIVE (load about 347 on 18 cores, thermal state "fair"): warm 7.6, 117.8, 20.2, 5.7, 4.8 ms against 50; cold 238.6, 276.8, 535.9, 257.7, 185.1 ms against 1,000. An earlier run read warm 5.3 to 11.0 ms and cold 273 to 466 ms |
| AC5 | `#220.56b932fa` | INCONCLUSIVE until the owner's taste call on the three pictures below is recorded in `tests/acceptance/220/TASTE.json` |

`proof/` holds the suite's own proof files: the SVGs (`ac1-five-linux.svg` is the container's), the morph's pieces at 0, 0.5 and 1 s, the three issues' replies, and the times.

## The twins (`tests/acceptance/220/twins`), each run once against the test it plants for

| Twin | Fails |
|---|---|
| `typeset-apart` | AC1: the union of the five parts' outlines (11 sub-paths) doesn't equal the one part point for point |
| `typeset-use` | AC1: the SVG holds eight `<use>` elements |
| `typeset-stamped` | AC1: the two runs' SVGs differ |
| `typeset-index-ids` | AC2: the shared terms' ids, and the morph's pieces (a first run aborted at install under load; the rerun failed at both assertions) |
| `typeset-no-checks` | AC3: `\ce{H2O}` and `e^{i` + `\pi}` answer `done` |
| `typeset-slow` | AC4: warm 63 to 106 ms, read INCONCLUSIVE by load rather than FAIL |

## The pictures (`node docs/evidence/220/shoot.mjs`)

- `five-parts.png`: a^2 + b^2 = c^2 as the typeset job wrote it, in dark_math, each of its five part groups boxed from the job's probe
- `match-morph.png`: the 1 s match_morph to a^2 = c^2 - b^2 halfway, from the exported frames
- `match-morph.apng`: the match_morph's exported frames, 24 a second
- `proof.apng`: the circle-area proof, five typeset steps whose shared terms move, with a θ in the math role
- `failures.json`: the three planted failures (`typeset.unknown_command`, `typeset.parts_apart`, `formula.alt_mismatch`)
