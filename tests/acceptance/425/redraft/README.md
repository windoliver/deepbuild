# Blind redraft of #425's disputed tests

Written by the blind redraft of the acceptance-test job (technical design: Dogfooding, disputes), from issue #425, the
design (`docs/canvas-primitives.md`, `docs/technical-design.md`), the base commit `2ea0fb77` and the original suite
(`e8e44ef4`, `../`). No implementation was seen. These files replace `../pure-selection.test.ts`,
`../levels.test.ts`, `../masks.test.ts` and `../taste.test.ts`; `./helpers.ts` sits beside `../helpers.ts`, which
stands and is imported unchanged, and replaces only its `holdChannel`, `bandDoc` and `levelDoc` for these four files.
`../climb.test.ts`, `../hold.test.ts`, `../README.md` and `../BASE-FAILURE.txt` stand. The original files are not
edited; whoever settles the dispute swaps them.

## The dispute, checked against the code

**D1 holds.** `../helpers.ts` (`holdChannel`) keys frame n's value at t = (2n − 1) ÷ (2 · 32) s and writes it with
`String`, so key `k0001` is `0.015625s` and every one of the 192 keys after `k0000` has six fraction digits (an odd
multiple of 1/64 always does). At the base:

- `crates/deep-canvas/src/grammar/time.rs`: `Span::parse` refuses a seconds span whose fraction has more than
  `MAX_SECONDS_DIGITS = 5` digits ("every decimal of up to five digits is a whole number of flicks, and a longer one
  is refused"); the grammar's own test refuses `1.123456s` with `bad_time`.
- `crates/deep-canvas-motion/src/doc.rs`: each channel key's `t` goes through `time_of`, which parses with
  `Time::parse` and refuses `bad_time` at the path `channels/<id>/keys/<key>/t`.

So `bandDoc()` and `levelDoc()` are refused `bad_time` at `channels/dolly/keys/k0001/t` by any
implementation that keeps the base's grammar, before a frame draws: AC1, AC2, AC3 and AC6 could never pass. The
grammar is the base's and outside #425, so the fixture moves, not the grammar.

## What changed

Only the sweeps' key times. `./helpers.ts`' `holdChannel` puts key n (n ≥ 1) on the 10 µs tick at or just before half
a frame before frame n: ⌊(2n − 1) · 100,000 ÷ 64⌋ × 10 µs, written with at most five fraction digits (`0.01562s`,
`0.04687s`, …, `5.98437s`). That is 15.63 ms before frame n and 15.62 ms after frame n − 1, so no frame lands on a key,
and with `hold` frame n still shows exactly `values[n]`; frames n and 192 − n still show bit-identical views, and a
seek to frame n still draws the n-th value. Every key is a whole number of flicks (5-digit decimals are, per the
grammar's comment). `holdChannel` asserts each key's literal against the grammar's form, so a fixture the grammar
would refuse fails here, naming the key. `SWEEP_FPS` (32), the sweeps' values, the documents and everything else are
unchanged: with the key times set aside, `bandDoc()` and `levelDoc()` are the originals' JSON byte for byte.

| File | Criterion | Change |
|---|---|---|
| `pure-selection.test.ts` | AC1 `#425.85981004` | Imports `bandDoc` from `./helpers.ts`; otherwise word for word. |
| `levels.test.ts` | AC2 `#425.fe13e22a` | Imports `levelDoc` from `./helpers.ts`; otherwise word for word. |
| `masks.test.ts` | AC3 `#425.4c1317b2` | Imports `bandDoc` from `./helpers.ts`; otherwise word for word. |
| `taste.test.ts` | AC6 `#425.e26677a1` | Imports `bandDoc` and `levelDoc` from `./helpers.ts`; otherwise word for word. Its orbit document's keys (`0s`, `2s`, `4s`) were already valid. |

The assumed surfaces, planted programs, criteria mapping and readings of `../README.md` all stand; this redraft adds
none. Its "The fixtures" line "keys sit half a frame before each frame" now reads "about half a frame before (on the
10 µs tick at or before it)".

## What was checked here

- A scratch script (not committed) imported both helpers and found: the original sweeps have 192 keys of six fraction
  digits each; the redrafted documents equal the originals once key times are dropped; every redrafted key parses
  with at most five digits to a whole number of flicks and lies strictly after frame n − 1 and strictly before frame
  n, for both sweeps.
- `node node_modules/typescript/bin/tsc -p tests/acceptance/425/tsconfig.json` exits 0 (`../tsconfig.json` already
  includes `redraft/`).

Nothing was built with cargo and no test was run.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/425 --no-file-parallelism --testTimeout=600000 redraft/
node node_modules/typescript/bin/tsc -p tests/acceptance/425/tsconfig.json
```

The `INCONCLUSIVE:` rules of `../README.md` hold unchanged.
