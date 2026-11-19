# Blind redraft of #1113's first drain test under #2833

#2833 raises the Linux test-slot limit in `scripts/throttle.mjs` (`LIMITS`) from 4 to 6. `tests/acceptance/1113/helpers.mjs` hard-codes `LIMIT.test` as 4 off the Mac. The first test in `tests/acceptance/1113/drain.test.mjs` fills `LIMIT.test` test slots so that the test class is full outside A's chain. With 6 real slots, 2 stay free. The test still passes, but it no longer proves that the nested test request passed through: a program that queues it would get a free slot. This folder redrafts that test from #1113's criterion (as `tests/acceptance/1113/README.md` AC3 quotes it), #2833 and its comment, and the base `c26bdb5be`. The owner approved the redraft ("Approve #1113 redraft"). #2833's comment names the surface: the machine's test limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/1113-redraft-2833/drain.test.mjs
```

It imports `tests/acceptance/1113/helpers.mjs` unchanged. `helpers.mjs` here holds `testLimit()`. It reads the source text of `scripts/throttle.mjs`, because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `test` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1113/drain.test.mjs` › #1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain | #1113.ca815dac (AC3 part a) | It fills `LIMIT.test` = 4 test slots. Under #2833 Linux has 6, so the test class isn't full outside A's chain, and a nested test request that is queued instead of passed through still gets a slot and passes | `drain.test.mjs` › same name. The only change: the other chains fill `testLimit()` test slots instead of `LIMIT.test`. The build side keeps the original's `LIMIT.build` (2 on Linux, 1 on the Mac), which #2833 doesn't change. The scene, the waits and holds, the assertions and the expected values are the original's, line for line |

## Kept as they are

- `1113/drain.test.mjs` › #1113.ca815dac a nested timed request under a build holder still drains…: it holds one test grant and one build grant, never fills a class, and doesn't read `LIMIT.test`.
- `1113/drain.test.mjs` › both #1113.1f6072ef tests: they hold two grants and don't read `LIMIT.test`.
- The rest of #1113 (`before`, `cli`, `guard`, `load`, `measured`, `waits`), and `twins.json` with the twins. This redraft doesn't review whether any of them reads `LIMIT.test`; #2833 names only this test for #1113.

No twins here: `tests/acceptance/1113/twins.json` maps the original's criterion, and the redraft keeps its ID.

## Runs

Linux, 20 cores, node 24. Each file ran once per program, under `node --test`, so the throttle used each test's sandboxed table.

On the base `c26bdb5be` (Linux test limit 4) the redraft passes:

```
$ node --test tests/acceptance/1113-redraft-2833/drain.test.mjs
✔ #1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain
ℹ pass 1  ℹ fail 0
```

On a throwaway that meets #2833 (the base with only `test: 4` → `test: 6` in the Linux branch of `LIMITS`), the redraft passes, and the original file passes 4 of 4:

```
$ node --test tests/acceptance/1113-redraft-2833/drain.test.mjs
✔ #1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain
ℹ pass 1  ℹ fail 0
$ node --test tests/acceptance/1113/drain.test.mjs
✔ (all four tests)
ℹ pass 4  ℹ fail 0
```

On a planted wrong program on that throwaway: in `acquire`, a nested `test` request under a holder no longer passes through. The program is the throwaway plus one line, `cls === 'build' || cls === 'test' ||` → `cls === 'build' ||`. The original still passes, because one of the 6 slots is free. The redraft fails, because all 6 are full:

```
$ node --test tests/acceptance/1113/drain.test.mjs
✔ #1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain
✔ (the other three)
ℹ pass 4  ℹ fail 0
$ node --test tests/acceptance/1113-redraft-2833/drain.test.mjs
✖ #1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain
    A-test never ran: a nested request under a build holder must pass through
ℹ pass 0  ℹ fail 1
```

The throttle log of that failing run shows the nested request queued and then hitting its timeout (`"event":"timeout","class":"test","wait":0.05`).
