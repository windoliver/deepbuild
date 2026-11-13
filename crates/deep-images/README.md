# deep-images

## What it is for

The one image service every image path draws through (#1486; canvas primitives: Image `image@1`). A request is a picture's sha256, a crop, its flips (#1653) and a level. A level is a box reduction by 2^k in linear light, made once off the UI thread by the service's own workers and kept in the content store by hash, crop, level and tool version, so a second open reads it back. Live frames ask with `show`, which never blocks and runs visible requests before prefetch; canonical renders ask with `wait` for the exact level. One cache, bounded in bytes and entries, evicts least recently used first at frame start and never what the last two drawn frames drew. Decodes stay inside the caps a picture's header is checked against (#1485). deep-marks-render, deep-show and deep-app reach it through `shared()`, so all three share its levels, order and budget.

## Where new code goes

- `src/lib.rs`: requests, the queue, the cache and its eviction, the workers, the counts and the planted wrong programs.
- `src/level.rs`: how a level is made and chosen, and its stored form.
- `src/source.rs`: the content store, a picture's header and its decode inside the caps.
- `src/tests.rs`: the crate's own tests. The acceptance tests are in `tests/acceptance/1485`, `1486` and `1653`.

## What it may import

`deep-canvas` for the pinned sRGB transfer the levels average through, `image` for PNG and JPEG decoding, and `sha2` for the hashes that name sources and levels. No other DeepBuild crate: the crates that draw pictures import this one.

## Deviations

- `src/lib.rs` keeps its wrong programs (`Plant`) in every build, chosen by a request's `planted` name through deep-marks-render, rather than behind a feature no shipped build turns on.
