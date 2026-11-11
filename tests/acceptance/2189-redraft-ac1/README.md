# Blind redraft of #2189's criterion 1, as amended: the showpiece class's 512 MB

`#2189.0da003b3`, criterion 1 of #2189 as the owner amended it on the yes to #2234:

> On Metal, an `envelope` call (`deep-gpu run`) with #1903's every-pass scene at 3456 × 2234 (the scene in
> `docs/evidence/1903/run.mts`: showpiece, moving camera) is refused at check: the reply's `code` is `refused`, with an
> `over_budget` issue whose `actual` names the size `[3456, 2234]`, its `gpu_bytes` over 512,000,000 and `cap_bytes`
> 512,000,000 (the showpiece class's cap since #2234); or it plays and every fixture's `gpu_memory.peak_bytes` is at
> most 512,000,000. On #2185's tip the scene is admitted and peaks at 659 MB, which fails.

The amendment puts 512,000,000 where the criterion named 256,000,000, three times. Its old tag was `#2189.41928b7b`,
tested by the first `it` in `tests/acceptance/2189/full-screen.test.ts`; this file replaces that test. The tag here is
the first 8 hex digits of the SHA-256 of the amended line with the leading `- [ ] ` dropped, trimmed, white space
collapsed, computed with the node one-liner in `tests/acceptance/305/README.md` over the issue's three criterion lines
(`0da003b3`, `39fdadfa`, `9104323e`; criteria 2 and 3 are unchanged and not tested here).

Written by a job that saw no implementation of the amendment, no diff, no other branch and no plan. The implementing
agent doesn't edit these files. A dispute goes to another blind redraft (AGENTS.md, Proof; design: Dogfooding).

**What was read:**

- Issue #2189 as amended and its comment; #2234 (the decision: the showpiece class takes 512 MB per window, the other
  classes keep 256 MB, and the every-pass scene at 644.8 MB is still refused).
- AGENTS.md.
- `docs/canvas-primitives.md`: GPU surface ("the check's memory estimate … refuses a document that can't fit at those
  floors, naming the size"), The cost model and its budget class table, Meter and degrade ladder ("Per-writer memory
  caps are hard"). `docs/technical-design.md`: Decisions → Decided, "GPU memory for a full-screen 3D view".
- At base `f28d8777` (origin/main), read only: `crates/deep-gpu-layer/src/envelope.rs` (`checked` calls `admit` with a
  0-frame window on the copy path and maps its issues to `{"code": "refused", "issues"}`; `fixture_row`'s
  `gpu_memory` row), `crates/deep-gpu-layer/src/live.rs` (`admit`: `meter::fit` at the class's moving scale, and its
  `over_budget` issue `{path: "size", actual: {size, gpu_bytes, cap_bytes}}`), `crates/deep-gpu/src/meter.rs` (`fit`,
  `FIT_SHARE` 0.95), `crates/deep-canvas/src/budget.rs` (`Class::Showpiece`'s row), `crates/deep-gpu-layer/src/main.rs`.
- The blind suite `tests/acceptance/2189/` (README, `helpers.ts`, `fixtures/every-pass.json`, `full-screen.test.ts`,
  `tsconfig.json`), and `tests/acceptance/546-redraft-ac1/` for the form of a redraft.

What the base holds: the docs already say 512 MB for the showpiece class (the budget class table and the Decided row),
but `Class::Showpiece` in `crates/deep-canvas/src/budget.rs` still gives `gpu_bytes` 256 MB. #2189's estimate is in
(`admit` counts what the view holds), so the every-pass scene at full screen is refused at check at the base, naming
`cap_bytes` 256,000,000. `BASE-FAILURE.txt` has the run.

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2189-redraft-ac1 --no-file-parallelism --testTimeout=1800000
npx tsc -p tests/acceptance/2189-redraft-ac1/tsconfig.json
```

The file imports `../2189/helpers.ts` (and through it `../1903/helpers.ts`) and builds what it builds: `cargo build
--locked --release --bin deep-gpu`, once, copied out of `target/release` (or `$CARGO_TARGET_DIR/release`). It draws on
this Mac's Metal GPU, so **`scripts/lanes.mjs` needs `'tests/acceptance/2189-redraft-ac1/'` in its `alone` list**. This
README is the instruction; the implementer makes that edit. A run with `--root` leaves Vitest's cache in
`tests/acceptance/2189-redraft-ac1/node_modules/.vite`; delete it.

## The surface

Exactly the surface in `tests/acceptance/2189/README.md`, "The surface under test", through its helpers:

- `envelopeCall(dir, [3456, 2234], false)`: one `envelope` call (#1903) of `../2189/fixtures/every-pass.json` (the
  every-pass scene, `budget.class` `showpiece`, its own `size` 3456 × 2234) played at `render.pixels` 3456 × 2234,
  `seconds` 1, no first frame wait, no `separate_items`.
- `onMetal`: `deep-gpu run` with no `--backend`, so this Mac's GPU, no stub; one scenario, one reply. Off macOS, or a
  binary or reply that answers `no_device`, is skipped as INCONCLUSIVE, never passed.
- The refusal `{"code": "refused", "issues": [{"code": "over_budget", "path": "size", "actual": {"size": [w, h],
  "gpu_bytes": bytes, "cap_bytes": bytes}, …}]}`, read by `overBudget`; or the played rows' `gpu_memory.peak_bytes`,
  read by `playedRows` and `bytesOf`.

`../2189/helpers.ts`'s `CAP_BYTES` is the old criterion's 256,000,000, so this file doesn't import it and holds its own
`CAP_BYTES = 512_000_000`. Nothing else is added.

## Criterion to test

| ID | Test (`ac1-full-screen.test.ts`) and what it asserts |
|---|---|
| `#2189.0da003b3` | One `envelope` call of the every-pass scene at 3456 × 2234 on Metal. **Refused:** `code` is `refused`; some `over_budget` issue's `actual.size` is `[3456, 2234]`; among those, the `cap_bytes` values include 512,000,000 (its own assertion, so a run against another cap fails there, naming the cap it got); and at least one such issue has `cap_bytes` 512,000,000 and `gpu_bytes` a number over 512,000,000. **Played** (no `code`): the `scene` row was played, and every played row's `gpu_memory.peak_bytes` is a number at most 512,000,000. Any other reply fails: another `code`, no issue naming the size, a missing or null peak, a reply that can't be read. |

Wrong programs it fails on:

- The base: the showpiece class at 256 MB, so the refusal names `cap_bytes` 256,000,000 (the cap assertion).
- A cap raised past 512 MB (or a document-level cap read wrongly): the refusal names another `cap_bytes`, or the scene
  plays and the device holds about 659 MB, over 512,000,000.
- An estimate back at #2185's 162 MB: the scene is admitted under any cap, and plays at about 659 MB.
- A refusal at a fit room of 95% that names `gpu_bytes` at or under the cap (between 486.4 and 512 MB): the
  `gpu_bytes` assertion.
- A refusal that names another size, or none.

## Readings where the criterion leaves a choice

The same readings as `tests/acceptance/2189/README.md` for criterion 1; nothing changes but the figure.

- **"On Metal"** is this Mac's own GPU through `deep-gpu run` with no `--backend` and no stub meter, as #1903's evidence
  ran. The test doesn't gate on a reference Mac: the criterion reads bytes the check names or the device allocates,
  not a timing.
- **"Every fixture's `gpu_memory.peak_bytes`"** is every row the call played (each row not marked `why: "not_run"`). The
  call carries the scene alone, since the criterion names only the scene, so the `separate-items` row is `not_run`. A
  null peak (the device couldn't say) is not "at most".
- **"An `over_budget` issue whose `actual` names …"** is at least one such issue holding all three values: the size,
  `gpu_bytes` over 512,000,000 and `cap_bytes` exactly 512,000,000.
- **"The showpiece class's cap since #2234"** is read as the cap the refusal names for this document. The every-pass
  scene's `budget` names only `class: "showpiece"`, no `gpu_mb`, so its cap is the class's.
- **Run length.** Not named; a view's allocations are made when it opens. `render.seconds` is 1, as in ../2189.

Not tested, as the criterion doesn't ask: criteria 2 and 3 (unchanged, in `tests/acceptance/2189/`), the other classes'
caps, and the docs' wording.
