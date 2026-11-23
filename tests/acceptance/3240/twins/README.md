# Twins for the 3240 tests

The issue names three planted wrong samplers, and `../twins.json` names them, with a fourth for the criterion that
names none. Each replaces `scripts/throttle.mjs` with the base's (`618ab3ab4`), its sampler given the issue's new
fields (`waiting`, `idle`, `busy`, the GPU read, `gpu`, `gpuTop`, `gpuUnread` and the report's new lines) as section 6
states them, but for one rule, marked `Planted:`. The blind job wrote them from a throwaway right sampler that was never
committed; `../TWINS-RUN.txt` shows each failing its criterion's test.

| Twin | What it gets wrong | The test that fails on it | At |
|---|---|---|---|
| `by-name` | A process's GPU time goes to a grant whose tree holds a process of the same name, whatever tree it is in | `gpu.test.mjs` (#3240.6f5727c7) | "the grant's gpu is ... s; the test's own ioreg read ... s, so it must be within a fifth of that" |
| `zeros-on-failure` | A GPU read that can't be made is written as zeros (`gpu: 0`, `gpuTop: []`), with no `gpuUnread` | `gpu-unread.test.mjs` (#3240.2d406576) | "the sample taken while ioreg failed doesn't say the GPU wasn't read" |
| `holder-waits` | `waiting` counts the holder of each grant held as a waiter of its class | `line.test.mjs` (#3240.f0d5ecc3) | "waiting holds 1 request of class build" (it records 2) |
| `gpu-arguments` | `gpuTop` names each process by its whole command line, as `ps` prints `args` | `log.test.mjs` (#3240.712a690c) | "load.log holds a stub's argument" |

The base fails every test of this folder at an assertion (`../BASE-FAILURE.txt`), since it has none of the new fields;
`log.test.mjs` fails there only at its precondition (the sample has no `gpuTop`), so `gpu-arguments` shows it failing
for its criterion's reason.
