# Blind redraft of #2009's third criterion's test under #2241

#2241 makes a `tangent_speed` other than 0 run on Rapier: "`caps()` says the backend has it, and `rolling_resistance` stays refused". #2009's third criterion, `#2009.43ed60cb`, says a world whose contact material sets "tangent_speed 1 m/s" is refused at check naming the field and the backend, and the first test of `tests/acceptance/2009/ac3-rolling-and-caps.test.ts` requires that refusal and runs the twin that lifts it. #2241 says of it: "This reopens a decided line: #2009's third criterion reads that refusal, so its test is redrafted blind when this starts, and the line stands until you decide." This folder is that redraft, from the two issues, the design and the base `9d0256132`.

It was written blind, in runs of the same job (an earlier one drafted the test; this one checked it against the issues, ran it and wrote the documents), none of which saw an implementation of #2241. The original is not edited or deleted; a person approves the swap. Run with:

```
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2009-redraft-2241 --no-file-parallelism --testTimeout=600000
```

It imports `tests/acceptance/2009/helpers.ts` unchanged and adds no helper. `criteria.ts` holds the criterion's ID, as `tests/acceptance/2009-redraft-ac2/criteria.ts` does. Type-check: `node node_modules/typescript/bin/tsc -p tests/acceptance/2009-redraft-2241/tsconfig.json`.

## What was read

- #2009's body and its two comments, and #2241's body (it has no comments), as the job's inputs hold them. The comments don't touch the third criterion.
- The base `9d02561325430d91e0b8cff3242e11011cc1b8cc`: `tests/acceptance/2009/` (the frozen test, `helpers.ts`, the README's Refusals, Planted twins and Criteria to tests); `tests/acceptance/2009-redraft-ac2/` (`criteria.ts`, `tsconfig.json`, the head of `BASE-FAILURE.txt`); `tests/acceptance/1113-redraft-2833/REDRAFT.md` for the form; `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (#2009's line); `docs/canvas-primitives.md`, Contact material; and the lines that name `tangent_speed` in `crates/deep-canvas-physics/src/caps.rs` and `caps_allow_tangent_speed` in `crates/deep-physics-rapier/src/`.
- `tests/acceptance/2241/README.md`, untracked beside the base: #2241's own blind suite's surface and its criteria to tests. It is tests, not an implementation.
- Nothing else: no other checkout, worktree or git ref, no implementation of #2241, no pull request, no web. That list is this run's; the earlier run worked under the same limits.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old expectation no longer holds under #2241 | Replaced by |
|---|---|---|---|
| `2009/ac3-rolling-and-caps.test.ts` › #2009.43ed60cb rolling_resistance 0.05, tangent_speed 1 m/s and a gear of two hinges in dynamic mode are each refused at check naming the field and rapier3d; at 0 and without the gear each world is admitted; each cap's twin is caught | #2009.43ed60cb (the third) | Its `tangent_speed 1 m/s` case requires the pad world with `tangent_speed: 1` refused at `contact_materials/pad/tangent_speed` with `actual` 1 and a `what` naming `rapier3d`, then runs `--planted caps_allow_tangent_speed` and requires that process to exit 0 and its answer to be caught. Under #2241 "a `tangent_speed` other than 0 runs" on Rapier and "`caps()` says the backend has it": the backend's refusal is gone, and the twin's program is the shipped one. The pad world's material also sits on its dynamic crate, so #2241 still refuses that world, but for the body's kind and "naming the field" only. Neither issue says that refusal names the backend, so the old judge can't be held to it | `ac3-rolling-and-caps.test.ts` › #2009.43ed60cb rolling_resistance 0.05 and a gear of two hinges in dynamic mode are each refused at check naming the field and rapier3d; at 0, tangent_speed 0 too, and without the gear each world is admitted; each cap's twin is caught (redraft 2241). The changes: the `tangent_speed 1 m/s` row leaves `CASES` with its twin; its control, the pad world with `tangent_speed: 0`, is checked in the same process and judged by the same `admittedFailures`; `AC` comes from `./criteria.ts` and the helpers from `../2009/helpers.ts`; the header comment and the `describe` and test names drop the refusal. Every other line is the original's (`diff` the two files) |

## Kept as they are

- `ac3-rolling-and-caps.test.ts` › #2009.43ed60cb a solid ball of radius 0.1 m rolling at 2 m/s with angular damping 2/s slows below 0.05 m/s between 6 and 7.5 s (6.46 s predicted): copied line for line, so that the file holds the whole criterion. #2241 touches neither damping nor a rolling ball.
- The `rolling_resistance 0.05` case with `caps_allow_rolling_resistance`, and the gear case with `caps_allow_dynamic_gear`: the worlds, the wanted fields, the judge and the twin runs are the original's. #2241 says "`rolling_resistance` stays refused" and "`rolling_resistance: 0.05` is still refused on Rapier, naming the field and the backend", and says nothing of gears.
- The frozen helpers, imported unchanged: `physics`, `check`, `bake`, `issuesOf`, `statesOf`, `refusalFailures`, `admittedFailures`, `caught`, `none`, `prebuild`, the world builders, and `TIMEOUT` (60 minutes), which each test passes.
- The control `tangent_speed: 0`: the dropped case's `admitted` world. The reading taken: a written 0 is the default's value and no belt, so the world is admitted though `pad` is also the dynamic crate's material (#2241: "`tangent_speed` is 0 unless written, so no world changes" and "A belt at speed 0 changes nothing"; what it refuses on a dynamic body is `tangent_speed: 1`).
- The rest of #2009's suite (`ac1-restitution`, `ac4-interface`, `2009-redraft-ac2/`) is not redrafted: #2241 names only the third criterion's test. `ac4-interface.test.ts` requires a public field named `tangent_speed`, which #2241 keeps. What #2241 still refuses of `tangent_speed` (on a dynamic body, and on a backend without belts) is `tests/acceptance/2241/`'s to hold, not this folder's.

## Wrong programs

The redrafted first test still fails on these two planted twins. It runs each through its switch on its refused world, and requires the process to exit 0 and answer and the judge that passes the real program to fail on that answer:

- `caps_allow_rolling_resistance`: caps() admits a contact material's `rolling_resistance` above 0.
- `caps_allow_dynamic_gear`: caps() admits a `gear` joint in dynamic mode.

Without a switch it fails on a check that refuses everything (the three controls, `tangent_speed: 0` among them) and on a refusal that names no field or no backend. The second test fails, as in the original, on damping that doesn't reach the roll.

`caps_allow_tangent_speed` ("caps() admits a contact material's `tangent_speed` above 0") plants no wrong program once #2241 lands: that is what #2241 asks of caps(). So no test here runs it. At the base only the frozen test runs it; whether its switch stays in the binary isn't this folder's to say. #2241's own wrong programs (`belt_hook_left_out`, `belt_speed_along_world_x`, `belt_speed_along_level_ground`) and its test backend `no_belts` belong to `tests/acceptance/2241/`.

## Criterion ID

Both tests' names start with `#2009.43ed60cb`, from `criteria.ts`. It is the third criterion's ID as #2009's body reads today, the same as the frozen suite's, computed the way `scripts/proof-change.mjs`'s `criterionId` does: the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed. This line prints it, then the ID of the same text with the clause below struck:

```
$ node -e 'const h=(t)=>"#2009."+require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ")).digest("hex").slice(0,8);const t=[...require("fs").readFileSync(process.argv[1],"utf8").split(/^###\s+Acceptance criteria\s*$/m)[1].split(/^#{1,6}\s/m)[0].matchAll(/^\s*- \[[ xX]\] (.+)$/gm)][2][1];console.log(h(t),h(t.replace(" or tangent_speed 1 m/s","")))' issue-2009-body.md
#2009.43ed60cb #2009.b8b12d95
```

## What the owner decides

1. **The swap.** Whether, once #2241 lands, `tests/acceptance/2009-redraft-2241/ac3-rolling-and-caps.test.ts` runs in place of `tests/acceptance/2009/ac3-rolling-and-caps.test.ts`. Until then the line stands and the original is the test that counts.
2. **The clause.** The third criterion can't be read as written once #2241 lands. The clause is "or tangent_speed 1 m/s", in "a world whose contact material sets rolling_resistance 0.05 or tangent_speed 1 m/s, or that joins two hinges with a gear in dynamic mode, is refused at check naming the field and the backend". Under #2241 that world runs when the shape use is a static or kinematic body's, and on a dynamic body it is refused "naming the field", for the body's kind, not for the backend. The redraft is drafted against the criterion with the clause struck:

   > On Rapier, a world whose contact material sets rolling_resistance 0.05, or that joins two hinges with a gear in dynamic mode, is refused at check naming the field and the backend; and a solid ball of radius 0.1 m rolling at 2 m/s on a level floor with angular damping 2/s slows below 0.05 m/s between 6 and 7.5 s, as v = v0·e^(−2ct/7) predicts (6.46 s)

   That wording's ID would be `#2009.b8b12d95`. An agent can't edit an issue's text. If the owner strikes the clause, the one line of `criteria.ts` takes that ID; until then the tests carry `#2009.43ed60cb`.

#2009's Scope ("caps() refuses rolling_resistance and tangent_speed above 0") and the design's Contact material paragraph ("on it `caps()` refuses `rolling_resistance` and `tangent_speed` other than 0") state the same refusal. Those are #2241's to change, not this folder's.

## Lanes

`scripts/lanes.mjs` runs #2009's folders one file at a time, because each file builds `deep-physics`. This folder needs the same, and this job may not edit the script. The implementer adds:

```
alone.push('tests/acceptance/2009-redraft-2241/');
```

## Runs

At the base `9d0256132`, once, on macOS arm64 with Node 24.22.2, vitest 5.0.5 and cargo 1.99.1 (`BASE-RESULTS.txt`): the type-check exits 0 and 2 of 2 tests pass. They pass there because the redraft reads only what the base and a program that meets #2241 have in common: `rolling_resistance` and the gear refused, both twins caught, each control admitted, the ball's roll. So it is not the test that fails first for #2241; `tests/acceptance/2241/` is.

Not run: the redraft on a program that meets #2241, which this job never sees, and the original file.
