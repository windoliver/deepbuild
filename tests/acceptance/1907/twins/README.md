# Twins for the 1907 tests

`#1907.ee5abddf` (AC2) fails on the merge base at its assertion, so it needs none. `#1907.0d8e070f` (AC1) passes on
the merge base (its results against themselves), so it needs a wrong program.

| Criterion | Twin | The planted fault | Tests it fails |
|---|---|---|---|
| `#1907.0d8e070f` (AC1) | `keeps-no-video` | `packages/checks-journey/src/run.ts` trimmed as the issue asks, but the trim also stops keeping `.webm` files: the video is looked up by name among the artifacts, so every browser run keeps no video and fails ("the run kept no video") | `result.test.ts`'s one test, at its assertion (`cart-total`, `login` and `motion` differ) |

The twin is the merge base's `run.ts` with the artifact's `sha256`, `size` and `kind`, the run's `out` and `wallMs` and
the hashing removed, and `DriveOptions`' `host`, `run`, `dir`, `secrets` and `stop` made optional, so it builds whether
or not the change's `index.ts` still passes them. It keeps the base's exports (`cancel`, `discard`, `drive`,
`playwrightVersion`, `prestart`, `PROFILE`, and the types `DriverRun`, `Job`, `Prestarted`, `Profile`, `Report`) and
their shapes; a change whose `index.ts` needs another export of `run.ts`, or another `Job` shape, makes the twin fail to
build, and the before lane says so.
