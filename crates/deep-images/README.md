# deep-images

## What it is for

The shared image service for `image@1` (#1486): reduced levels made off the UI
thread and kept in the content store, a visible-first queue and one cache bounded
in bytes and entries. `deep-app`, `deep-marks-render` and `deep-show` use the same
levels, queue order and budget.

## Where new code goes

- `src/lib.rs`: requests, worker scheduling, cancellation, cache and frame reads.
- `src/level.rs`: level selection, linear-light reduction and stored level bytes.
- `src/source.rs`: content hashes, image headers, decode caps and source pixels.
- `src/tests.rs`: service tests; acceptance coverage lives in `tests/acceptance/1486`.

## What it may import

The pinned color transfer through `deep-canvas`'s public entry, `image` for PNG
and JPEG decoding, and `sha2` for content hashes. It imports no app or renderer.

## Deviations

- `src/lib.rs` owns worker threads and a mutable cache: this is the host's image
  service, not a canvas evaluation module. Live draws never wait for its jobs;
  canonical renders can wait for the exact level.
