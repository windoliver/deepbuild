# deep-canvas-seams

## What it is for

The canvas's platform seams (#140; canvas primitives: Seam and backend): the thirteen seams' names, the backend type every result names its backends with, the headless and CPU backends' names, and the network seam with its conformance suite and test relay. A seam whose backend lives in another crate (the GPU seam in deep-gpu, fonts in deep-text, the window, input and capture seams in deep-show and deep-app) names itself with this crate's `Backend`.

## Where new code goes

- `src/lib.rs`: the seam list, `Backend`, and the backends no other crate owns.
- `src/network.rs`: the network seam's interface (`Transport`, `Wire`), its correct test backend and its suite. Its macOS backend is in deep-relay (#309); the web player's comes with the net module (#179).
- A new seam's suite goes beside its interface here when no crate owns the seam; `scripts/seams.mjs` runs every seam's suite.
- Tests: unit tests in a `#[cfg(test)]` module beside the code; the suites' proofs are in tests/acceptance/140.

## What it may import

serde_json only. It is named deep-canvas*, so the canvas lint reads it and the wasm32 lane builds it: no threads, clocks, statics or target predicates. A backend's platform facts (the CPU's architecture) come from the binary that reports them.

## Deviations

None.
