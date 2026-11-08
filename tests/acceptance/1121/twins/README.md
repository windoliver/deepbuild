# Twins for the 1121 tests

The planted wrong programs the issue's Proof asks to see failing. The blind job wrote this list and showed each fault
failing on a throwaway copy of the base (`../BASE-FAILURE.txt`). The implementing job plants each twin in the real
change's code, in a folder of this name holding only the file it replaces, and no test or helper.

| Criterion | Twin | Replaces | The planted fault | Fails where |
|---|---|---|---|---|
| `#1121.23cb368c` | `x86-nofollow` | `crates/deep-hook/src/main.rs` | deep-hook's `NOFOLLOW` is `0o400000`, the x86_64 Linux value, on every target | The Spark: on aarch64 that's `O_LARGEFILE`, so the open follows the link and the line lands in the file it points at. The Mac too: there it's `O_NOCTTY` |
| `#1121.301969cb` | `usr-sbin-lsof` | `packages/env-local/src/stack.ts` | env-local runs `/usr/sbin/lsof` on every platform | The Spark, where only `/usr/bin/lsof` exists: the spawn fails, so no port reads free |
| `#1121.301969cb` | `usr-bin-lsof` | `packages/env-local/src/stack.ts` | env-local runs `/usr/bin/lsof` on every platform | The Mac, the mirror of the one above |

On the Spark the hub's env-resources test (`lsof.test.mjs`) also fails on the base's own `packages/hub/src/stacks.ts`,
which hardcodes `/usr/sbin/lsof`, so the base is that test's wrong program and needs no twin.
