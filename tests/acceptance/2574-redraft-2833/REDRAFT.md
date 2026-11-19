# Blind redraft of #2574's tests that #2833's limit contradicts

#2833 raises the Spark's (Linux's) `test` class in `scripts/throttle.mjs` from 4 grants to 6, by the owner's approval. `tests/acceptance/2574/helpers.mjs` hard-codes `LIMIT = darwin ? 2 : 4`, and its `fill` holds exactly `LIMIT` test slots with other sessions' holders. On a machine of 6 slots, 4 holders leave 2 free, so the run under test takes a grant at once, and the two tests that need every slot held, `#2574.AC2b` and `#2574.AC2d`, fail. This folder redrafts those two from #2574's AC2 (as `tests/acceptance/2574/README.md` quotes it), #2833 and its comment, the design (Dogfooding; `docs/parallel-proof.md`) and the base `c26bdb5be`, drafted by a blind job, with #2833's surface: the machine's test limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The originals are not edited or deleted; a person approves the swap (the owner approved these redrafts in #2833's comment, to land in #2834). Run with:

```
node --test tests/acceptance/2574-redraft-2833/grant.test.mjs
```

`grant.test.mjs` imports `tests/acceptance/2574/helpers.mjs`, unchanged, for the sandbox, the scratch tree, the probes and the run. `helpers.mjs` here holds only what doesn't fit: `testLimit(source, platform)`, which reads the `test` limit for the platform from the source text of the `scripts/throttle.mjs` the tests run (`LIMITS` isn't exported), and `LIMIT` and `fill` on top of it. `testLimit` reads `const LIMITS = process.platform === '<p>' ? {…} : {…};` (or a single `{…}`) and the `test: <n>` in the platform's object; any other shape, no `LIMITS` line or no numeric `test` entry throws an assertion naming what it couldn't read, so the tests fail loudly and never assume a number.

## What each redraft replaces

One change serves both: `fill` holds as many test slots as `scripts/throttle.mjs` states for this platform, not a hard-coded 2 or 4. Test names, criterion IDs, assertions and expected values are the originals', line for line (the two test bodies are byte-identical to the originals').

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `2574/grant.test.mjs` › #2574.AC2b while every test slot is held by other live processes the run starts no job, and starts once a slot frees | #2574.AC2b (AC2, bullet 2) | Its `fill` holds 4 slots; under #2833 Linux has 6, so 2 stay free, the run starts its jobs at once and "every test slot is held" is never set up | `grant.test.mjs` › same name, with this folder's `fill` holding all the slots `LIMITS` states |
| `2574/grant.test.mjs` › #2574.AC2d with no grant within the wait the run prints INCONCLUSIVE no grant, names each file, reads INCONCLUSIVE, exits 2 and starts no job | #2574.AC2d (AC2, bullet 4) | The same: with 2 of 6 slots free the run gets a grant, runs its jobs and reads PASS, so no-grant is never reached | `grant.test.mjs` › same name, the same way |

## Kept as they are

These hold under #2833:

- `2574/grant.test.mjs` › #2574.AC2a, › #2574.AC2c (one run with no neighbour) and › #2574.AC2e (`--timed`): none fills the table, so the number of test slots doesn't enter them.
- `2574/shards-linux.test.mjs` (AC1) and `2574/wide.test.mjs` (AC3): neither reads the throttle's limits.

The issue's sentence "At most as many runs as the machine has `test` slots (4 on the Spark, 2 on the Mac)" is informative and has no test of its own; under #2833 the Spark's number is 6, and the redraft reads it rather than restating it.

## On the base and on a throttle that meets #2833

Run on the Spark (Linux, 20 cores, 1-minute load about 22 at the end), each file once per program, each in a memory-capped transient unit (`systemd-run --user --wait --pipe --collect -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G`, `CARGO_BUILD_JOBS=2`, `DEEP_SHARDS=2`), the three runs at once in separate trees, each with its own sandboxed throttle table.

On the base `c26bdb5be` (Linux limit 4) both pass:

```
$ node --test tests/acceptance/2574-redraft-2833/grant.test.mjs
✔ #2574.AC2b while every test slot is held by other live processes the run starts no job, and starts once a slot frees (16323.611682ms)
✔ #2574.AC2d with no grant within the wait the run prints INCONCLUSIVE no grant, names each file, reads INCONCLUSIVE, exits 2 and starts no job (2281.372873ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0
```

On a throwaway worktree of `c26bdb5be` that meets #2833, with only `test: 4` changed to `test: 6` on `LIMITS`'s Linux branch (not kept), the redraft passes too:

```
$ node --test tests/acceptance/2574-redraft-2833/grant.test.mjs
✔ #2574.AC2b while every test slot is held by other live processes the run starts no job, and starts once a slot frees (16441.550079ms)
✔ #2574.AC2d with no grant within the wait the run prints INCONCLUSIVE no grant, names each file, reads INCONCLUSIVE, exits 2 and starts no job (2409.199286ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0
```

The originals on that throwaway, as the table says:

```
$ node --test --test-name-pattern='#2574\.AC2[bd] ' tests/acceptance/2574/grant.test.mjs
✖ #2574.AC2b while every test slot is held by other live processes the run starts no job, and starts once a slot frees (11218.352491ms)
    jobs started while all 4 test slots were held by others
✖ #2574.AC2d with no grant within the wait the run prints INCONCLUSIVE no grant, names each file, reads INCONCLUSIVE, exits 2 and starts no job (5820.494434ms)
    no "INCONCLUSIVE no grant: no test grant came within 0.02 min" line
ℹ tests 2  ℹ pass 0  ℹ fail 2
```

(In the AC2d failure the run exited 0 with `PASS affected: … 2 passed`: it got one of the two free grants.)

`testLimit` was also checked by hand against the base source: it reads 4 for Linux, 2 for darwin, 6 with the Linux branch at 6, and throws on an empty source, a renamed `LIMITS`, a `tests:` key and `test: four`.

A redraft that passes on both programs proves nothing new about AC2 by itself: the wrong programs for AC2b and AC2d are the ones that start jobs before a grant or never print no-grant, and these assertions, unchanged, still catch them; what changed is only that the scene fills every slot the machine has.
