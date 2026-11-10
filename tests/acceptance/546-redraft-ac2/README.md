# Blind redraft of #546's criterion 2, as amended: the data view class on the web

`#546.232a6e07`, criterion 2 of #546 as the owner amended it:

> With on [app, web], a step whose fuel lies between the data view class's web and app step ceilings passes on the app
> and fails on the web, naming the step, the host web and the ceiling, from the bake's fuel alone and the same on
> macOS and Linux; a piece whose steps all fit both ceilings reads BLOCKED on the web until the player's timed run,
> and a planted logic.budget that passes the web part from fuel alone reads PASS and fails, naming the host

The amendment puts the data view class (`data_view`, 2 ms of frame CPU: canvas primitives, Budget classes) where the
criterion named the figure class (4 ms). Its old tag was `#546.73b1f110`, tested by
`tests/acceptance/546/ac02-web-ceiling.test.ts`. The tag here is the first 8 hex digits of the SHA-256 of the amended
text, trimmed, white space collapsed (`scripts/proof-change.mjs`).

Written by a job that saw no implementation of #546, no diff, no other branch and no plan. The implementing agent
doesn't edit these files. A dispute goes to another blind redraft (AGENTS.md, Proof; design: Dogfooding).

**What was read:**

- The amended issue body, as handed to this job.
- AGENTS.md.
- `docs/technical-design.md`: The logic module (Sandbox and budgets; Logic bake and checks).
- `docs/canvas-primitives.md`: Budget classes; Logic: work across steps; Logic: step blocks; Logic: sandbox; Check
  input: logic kinds.
- At `6e17c659` (base `f38d2b39` plus the original blind suite), read only:
  - `crates/deep-logic/src/budget.rs`: the app ceiling for the figure class's 4 ms, from this host's measured ns per
    fuel unit; `web` read as BLOCKED with one ask and never held to a ceiling.
  - `crates/deep-show/src/kinds.rs`.
  - The whole of `tests/acceptance/546/`.

## Run it

```sh
npm ci                          # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH   # rustup's cargo; ../546/helpers.ts also adds it when present
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: the Linux x86_64 host (rust-toolchain.toml's channel)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/546-redraft-ac2 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/546-redraft-ac2/tsconfig.json
```

The file imports `../546/helpers.ts` and `../546/programs.ts` and builds what they build:

- `deep-logic` and `deep-show` for this Mac.
- #532's assembler, from a copy outside the checkout.
- For the first test, `deep-logic` for linux/amd64. It is built in `docker run --platform linux/amd64` with
  `rust:<channel>-slim-bookworm`, the checkout mounted read-only and the caches under `target/acceptance-546-linux/`.

Nothing is pulled. With no Docker, or no linux/amd64 image, the first test fails `BLOCKED:` and names the `docker pull`
command. It never passes or skips. Each test passes the 546 suite's `TIMEOUT` (90 minutes; the Linux build runs under
emulation).

**`scripts/lanes.mjs` needs `'tests/acceptance/546-redraft-ac2/'` in its `alone` list**, since the file builds cargo
binaries and starts Docker. This README is the instruction; the implementer makes that edit. `BASE-FAILURE.txt` says
how it fails at the base.

## The surface

This file uses exactly the surface in `tests/acceptance/546/README.md`, "The surface under test":

- deep_kinds' `step_ceilings`, read for `"60"`, `data_view`, `app` and `web`.
- deep-logic's `bake` and `budget` (logic.budget), with `fuel_share: 1` and `on: ["app", "web"]`.
- The piece's `class`, here `"data_view"`.
- The ceiling failure `{"rule": "ceiling", "item", "step", "host", "ceiling", …}`.
- `blocked: [{"host": "web", "ask"}]`.
- `report.items[<id>].ceiling: {<host>: fuel}`.
- `deep-logic --planted budget_web_passes_from_fuel`, defined in 546's README as a logic.budget that, from the bake's
  fuel alone, passes on `web` a piece whose steps all fit the web ceiling: no `blocked` entry for web, its web ceiling
  failures unchanged.
- `burn` from 546's `programs.ts`, with its fuel line read off one calibration bake.

Nothing is added.

## What the tests assert

`ac2-data-view-web.test.ts` has 2 tests.

**The pieces.** Two `burn` pieces of 12 steps at 60 Hz, `class: "data_view"`. Every step runs 1,000 loop iterations
except step 5. app and web are deep_kinds' 60 Hz data view ceilings, and web must be below app.

- **`between`.** Step 5 spends the fuel of the least loop count whose fuel reaches web + max(2 iterations' fuel,
  ⌊(top − web) ÷ 3⌋), where top is the lesser of app and the fuel budget's 10,000,000. The test fails if that step plus one more
  iteration can't stay at or under top.
- **`fits`.** Step 5 spends at most half the web ceiling.

**Test 1, the criterion.**

- On this Mac, bakes check the fuel. `between`'s step 5 is over web, at or under app, and under 10,000,000. Every
  other step, and every step of `fits`, is at or under web.
- logic.budget on [app, web], on this Mac and in the linux/amd64 container, must give, on each host:
  - **`between`:**
    - verdict FAIL;
    - exactly one `ceiling` failure: item `burn`, step 5, host web, ceiling web;
    - no failure of any rule naming host app;
    - `report.items.burn.ceiling` equal to `{app, web}` from deep_kinds.
  - **`fits`:**
    - verdict BLOCKED;
    - no failure;
    - `blocked` exactly one entry, host web, with a non-empty ask.
- Linux must read, for each piece, the same verdict, the same failures (each failure object whole) and the same
  blocked hosts as macOS.

**Test 2, the twin.** `budget_web_passes_from_fuel` runs both pieces on this Mac. `fits` must read PASS, and test 1's
judgement of the replies must fail with a failure naming `host web`.

Wrong programs these tests fail on:

- A web ceiling equal to the app's, or from another class.
- A logic.budget that leaves the web ceiling to the browser run, or skips the app ceiling when web is in `on`.
- A failure naming another step, host or ceiling.
- A PASS on the web from fuel alone.
- A reading that differs between macOS and Linux.

## Readings where the criterion leaves a choice

- **The rate.** The criterion names none. The test uses 60 Hz, logic@1's default and the rate the Fields line
  estimates at.
- **"A step whose fuel lies between the … web and app step ceilings".** Over web, at or under app, and under the fuel
  budget's cap so the step runs: a third of the way up from web, at least two loop iterations over it.
- **"Passes on the app".** No failure of any rule names host app, and the report holds the item to the data view
  class's app ceiling. That makes the pass a pass against that ceiling, not a host left unchecked.
- **"Fails on the web, naming the step, the host web and the ceiling".** FAIL with exactly that one `ceiling` failure.
  Other failures that name host web are allowed.
- **"From the bake's fuel alone and the same on macOS and Linux".** The linux/amd64 container, where no browser runs,
  must give macOS's verdict, failures and blocked hosts. The test excuses no difference: a rule for host app that a
  machine times for itself, rather than computes from the bake's fuel, would read otherwise under emulation and fail
  here.
- **"A piece whose steps all fit both ceilings reads BLOCKED on the web until the player's timed run".** The timed run
  (#1044) isn't made, so `fits` must read BLOCKED, on both hosts, with web its one blocked host.
- **"Reads PASS and fails, naming the host".** The twin's `fits` reads PASS, and the judgement fails naming host web.

## Where this differs from 546's test of the old criterion

- The class is `data_view`, so app and web are the data view ceilings.
- `between`'s step 5 lies a third of the way up, not 30%.
- The judgement also requires `report.items.burn.ceiling` to be deep_kinds' `{app, web}`, a field 546's README defines.
- Both bakes are checked, so no step but `between`'s step 5 is over web.
