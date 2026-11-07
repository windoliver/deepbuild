# Blind redraft of AC10 #149.affd8de8, clause: "a collection target costs no more than its declared bytes"

Written from issue #149, the design and base c12a65bb only; no implementation was seen. One lean test of this clause
(`target-bytes.test.ts`), on the reference Mac.

## What was read

- `docs/canvas-primitives.md`, "Effect and GPU operator: collection targets": the input field `texture: target
  {collection, output: color | coverage | pressure | height, resolution, mips}`; **Cost**: "A target per output per
  collection at its resolution: about 4 MB for rgba16float at half 1080p" (960 x 540 x 8 B = 4,147,200 B).
- "The cost model and its class table": GPU memory is a per-frame sum refused over the class's cap, with coefficients
  from the reference Mac.
- "Meter and degrade ladder" and `tests/acceptance/379/`: a count is "each at its allocation's size as the device
  reports it: every mip ... with padding, and 0 for a memoryless target, never a formula over its descriptor";
  `crates/deep-gpu/src/memory.rs` reads Metal's `allocatedSize`. The meter's own tolerance for the count against the
  sum of device sizes is 1% (criterion #379.20ef578a).

## Reading

A declaration states a resolution, an output and mips, so its declared bytes are the formula over it: width x height x
bytes of the format x the mip chain (here 960 x 540 x 8 B, one level); that figure is computed in the test, never read
from the reply. The device's count (`allocatedSize`) may exceed it only by the padding the device allocates in, so
"no more than" is judged as `bytes <= declared_bytes x 1.01`, the meter's 1% tolerance; a target at full size
(16.6 MB) or at rgba32float (8.3 MB) is far over it. The design gives no per-texture granularity figure, so 1% (about
41 KB here) is the only allowance.

## Surface under test

`deep-gpu run` `layers` with `"float": true, "target_costs": true`; its reply's `target_costs:
[{collection, output, width, height, format, mips, declared_bytes, bytes}]`, `bytes` from the device.

## Run

```sh
npx vitest run --root tests/acceptance/149-redraft-ac10 --no-file-parallelism
npx tsc -p tests/acceptance/149-redraft-ac10/tsconfig.json
```

Builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`). Off macOS, or on `unsupported_platform`, it fails
with `INCONCLUSIVE:`. Delete `tests/acceptance/149-redraft-ac10/node_modules/.vite` after a run. `BASE-FAILURE.txt`
says how it fails at the base.
