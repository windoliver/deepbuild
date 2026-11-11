# deep-images

## What it is for

The one image service every image path draws through (`image@1`, #1486). A request is a picture's hash, a crop and a level. Each level is made once, off the UI thread, by the service's own workers, and kept in the content store by hash, crop, level and tool version, so a second open reads it back. Live frames ask without blocking, visible requests first and then prefetch, newest first within each; canonical renders wait for the exact level. One cache, bounded in bytes and entries, evicts the least recently used first and never what the last two drawn frames drew. deep-marks-render, deep-show and deep-app call it, so all three reach the same levels, order and budget.

## Where new code goes

- `src/lib.rs`: the service, its queue, its workers and its cache.
- `src/level.rs`: which level a request needs and how a level is reduced, averaged in linear light.
- `src/source.rs`: a picture's hash, its crop in pixels, the decode and its cap, and the content store's rows.
- `src/tests.rs`: the unit tests; tests/acceptance/1486 reads the service from outside.

## What it may import

deep-canvas, for the pinned sRGB transfer the levels average through, image (PNG and JPEG decoders only) and sha2, each through its crate root.

## Deviations

None.
