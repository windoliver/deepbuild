# Acceptance tests for #2309: a contact frequency the step can't settle is refused, solver.contact_hz held to a sixth of the step rate times the substeps

Written first, blind, from issue #2309 as of November 17, 2026 (its opening paragraph, Scope, four acceptance criteria,
Proof line and dependency; it has no comments), its epic #97, its dependency #191, the design's physics sections and
base commit `6f1dd3a7e` ("Merge pull request #2734 …"), by a job that never saw an implementation, a diff of one, or
`crates/deep-physics-rapier/src/runner/contact.rs` (the base has no such file). The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-refused-at-check.test.ts` | `#2309.6e2a91d2`: 81 Hz refused at 120 Hz and 4 substeps naming the field, 81 and the bound 80, 80 accepted; a written 30 refused at 1 substep naming 20; the planted quarter accepts 110 Hz and fails, naming the field | 3 |
| `ac2-stacks-at-rest.test.ts` | `#2309.867e3130`: five and ten cubes at `contact_hz: 80` each under 1 mm/s through the sixth second; the top of five at the default ends 5.87 mm below 4.5 m within 0.3 mm; the planted static contact at the same frequency ends 6.90 mm low and fails, naming the top body | 4 |
| `ac3-default-at-one-substep.test.ts` | `#2309.55fde6cd`: at 1 substep with no `contact_hz`, five cubes each under 5 mm/s through the sixth second; the planted default of 30 Hz moves them faster than 0.05 m/s and fails, naming a body; at 4 substeps with none, step hashes byte-identical to the merge base's | 3 |
| `ac4-behavior-kit.test.ts` | `#2309.2d1bb5c9`: the resting stack in the behavior kit's data once, passed by the reference backend on macOS arm64 and in the wasm32 build | 2 |
| `helpers.ts` | the worlds, the judges and the runner, over `../191/helpers.ts` (imported read only) | |
| `BASE-FAILURE.txt` | the suite run once at the base | |

## What was read

- The issue, live (`gh issue view 2309 --repo windoliver/deepbuild`), #97 and #191 the same way.
- `docs/technical-design.md`: The physics module (World; Joint and force; Bake and golden; Behavior kit), Dogfooding,
  Tests written first. AGENTS.md.
- At the base, for surfaces only: `tests/acceptance/191/` (helpers, README, ac1, ac2, ac11) and `2306/` (its merge-base
  test and README); `crates/deep-physics-rapier` (`main.rs`, `planted.rs`'s names, `runner.rs`'s `check` and `bake`
  replies and its issue fields); `crates/deep-canvas-physics` (`check.rs`'s joint spring refusal, `doc.rs`'s `solver`
  reader, `kit.rs`'s fixture and row, `kit/fixtures.rs`'s world helpers); `scripts/physics-wasm32.mjs`;
  `scripts/proof-change.mjs` (criterion IDs).

What the base already does, which these tests don't credit: `solver.contact_hz` takes any positive number and defaults
to 30 Hz at every substep count; a joint's spring above (step rate × substeps) ÷ 4 Hz is refused with `out_of_range`
at `joints/<ID>/spring/hz`, its value in `actual` and the bound in its sentence; the behavior kit runs natively and on
wasm32. The base knows none of the three planted names and holds no `resting_stack`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot (not scripts/throttle.mjs):
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/2309 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2309/tsconfig.json         # type-check
rm -rf tests/acceptance/2309/node_modules              # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| all four | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`) |
| `ac3` | also the merge base's release build (`git merge-base HEAD origin/main`), exported by `git archive` into `target/acceptance-191-base/<sha>` and built there (#191's `mergeBasePhysics`) |
| `ac4` | also the crate for wasm32, by `node scripts/physics-wasm32.mjs` |

The suite's own cargo calls find those builds made and only copy them. Every test passes #191's 60-minute timeout
(four times that for ac3's merge-base test). Node built-ins and vitest only. No process is started but `cargo`, `git`,
`tar`, `node` and `deep-physics`, each waited for; none is stopped by name or port. **`scripts/lanes.mjs` needs
`'tests/acceptance/2309/'` in its `alone` list** (the files build cargo binaries, one of them a second checkout's);
this README is the instruction, the implementer makes that edit. No test times anything, so none depends on the
machine or its load. ac4's native leg requires macOS arm64, as the criterion does.

## The surface under test

The issue names the field, the refusal's code (`out_of_range`), the bound and the default, and no call or flag. These
tests drive `deep-physics` as #2009 and #191 left it: `{"call": "check", "world"}` → `{"ok": true, "issues": [Issue]}`;
`{"call": "bake", "world", "steps", "read"?}` → `bodies.<ID>[k]`, the state after step k (`pos`, `linear`), and
`step_hashes`; `behavior_fixtures` and `behavior_kit`. **Bold** names are this job's choices, the smallest the criteria
need; the implementer builds exactly these.

### The refusal (criterion 1)

One issue per refused world, shaped as the joint spring's is at the base:

```text
{"code": "out_of_range", "severity": "error", "path": "solver/contact_hz", "actual": 81, "what": "… 80 …", …}
```

- `path` is **`solver/contact_hz`**, the field as the reader's other refusals name fields.
- `actual` is the written value, as a number (81, 30, 110).
- `what` names the bound as a number in its sentence: `80` (or `80.0`) at 120 Hz and 4 substeps, `20` at 1 substep.
  A longer number holding those digits (`180`, `0.80`, `80.5`) doesn't count.
- An accepted world's check lists no issue of severity `error` and none at `solver/contact_hz`, and it bakes.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the shipped build (the base's way of starting a wrong program), changing
nothing but what its row says. Its process must exit 0 and answer; the judge that passes the real program must fail on
it, naming what the criterion says it names.

| Name | Criterion | The wrong program | The judge's failure names |
|---|---|---|---|
| `contact_hz_quarter` | 1 | the check holds `solver.contact_hz` to (step rate × substeps) ÷ 4, as it holds joints: 110 Hz at 4 substeps is under its 120 Hz and accepted, with no issue at the field | the field, `solver/contact_hz` |
| `static_contact_same_hz` | 2 | the backend wrapper holds a contact with a static body at `contact_hz`, the frequency of any other, not twice it: the top of five at the default ends 6.90 mm below 4.5 m (within 0.3 mm) | the top body, `cube5`; and the kit's `resting_stack` row reads `fail` on it, its `body` and its `what` naming the fixture's top body, its `measured` 0.0069 m within 0.0003 m |
| `contact_default_30` | 3 | the unwritten default stays 30 Hz whatever the step: at 120 Hz and 1 substep a cube moves faster than 0.05 m/s in the sixth second | a body, `cube<k>` |

### The fixture in the behavior kit (criterion 4)

**`resting_stack`** joins `behavior_fixtures` and `behavior_kit` exactly once:

| Field | Value |
|---|---|
| `name` | `resting_stack` |
| `world` | at g = 9.81 m/s², 120 Hz and 4 substeps, `solver.contact_hz` unwritten (or 30): exactly five dynamic bodies, each one box of `half: [0.5, 0.5, 0.5]` on a contact material of `density: 1000` and `friction: 0.5`, the top one built at y = 4.5 m |
| measure | how far the top body, the dynamic body built highest, ends below where it was built, in metres, after the fixture's own `steps` |
| `answer` | 0.00587 m as printed, read within half a unit of its last digit (the closed form, 2 × (4 + 3 + 2 + 1) × g ÷ (2π × 30)² + 5 × g ÷ (2π × 60)² = 0.005867 m, is inside it) |
| `tolerance` | `{"m": 0.0003}` |
| `caps` | none the reference backend lacks: it runs, never `excluded_by_caps` |

Its row on the reference backend reads `pass`, with the interface's answer and tolerance and a `measured` within
0.0003 m of 0.00587 m, natively (target `aarch64-apple-darwin`) and on `wasm32-unknown-unknown`; and the fixture's own
world, baked by the test for the fixture's `steps`, ends its top body within 0.01 mm of what the kit measured. A fail
carries `body`, the top body's ID, as #191's fails name bodies.

## The worlds

All at 120 Hz, gravity (0, −9.81, 0), on #191's `world` defaults (seed 191, every solver field but `contact_hz`
unwritten). A static floor `floor`, a box whose top face is y = 0; cubes `cube1` (on the floor) to `cube<n>` (the
top), each one box of half 0.5 m on a contact material of density 1,000 kg/m³, friction 0.5 and restitution 0, built
touching, `cube<k>`'s centre at y = k − 0.5 m, each with `sleep: false`. Six seconds are 720 steps; the sixth second is
the states after steps 601 to 720; a body's speed is the length of its `linear`.

Why `sleep: false` (the kit's own dynamic bodies have it too): a sleeping body reads 0 m/s whatever its contacts do,
so with sleep on no speed limit here could fail, and a stack put to sleep stops sinking early. The base shows which
the issue's numbers are. With sleep on, the base's stack of five at the default ends 5.062 mm low and every case reads
0.000 mm/s, the 30 Hz default at 1 substep among them. With `sleep: false` it ends 5.845 mm low (the issue's 5.87 mm),
30 Hz at 1 substep moves the top cube 0.127 m/s (the issue's "faster than 0.05 m/s"), 20 Hz at 1 substep moves no
cube faster than 0.24 mm/s, and 80 Hz at 4 substeps none faster than 0.09 mm/s, for five and for ten. The fixture in
the kit's data may write its bodies' sleep either way, as long as its row measures what the criterion says.

## The tests

- **ac1.** 81 at 4 substeps is refused as above and 80 is accepted and bakes; 30 at 1 substep is refused naming 20;
  110 at 4 substeps is refused naming 80, and under `contact_hz_quarter` the same check is accepted, so the refusal
  judge fails, naming `solver/contact_hz`.
- **ac2.** Five and ten cubes at `contact_hz: 80`: every cube's largest speed in the sixth second is under 0.001 m/s
  (each printed). Five at the default: `cube5` ends 4.5 m − y within 0.0003 m of 0.00587 m, printed beside the worked
  answer. Under `static_contact_same_hz` it ends within 0.0003 m of 0.0069 m, the same judge fails naming `cube5`, and
  the kit's `resting_stack` row fails as the table says.
- **ac3.** Five cubes at 1 substep with no `contact_hz`: every cube under 0.005 m/s through the sixth second, and each
  cube's last state equal to the one the same world with `contact_hz: 20` written gives (it runs its contacts at 20 Hz).
  Under `contact_default_30` some cube passes 0.05 m/s and the rest judge fails, naming it. Five cubes at 4 substeps with
  no `contact_hz`: all 721 step hashes are the same strings on this checkout's release build and the merge base's.
- **ac4.** The fixture's data and row as above, natively and on wasm32; the pass judge is shown to fail on the same
  row measuring 6.90 mm.

`BASE-FAILURE.txt` is the run of the whole suite at the base, with each test's result and failing assertion.
