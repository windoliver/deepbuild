# Blind redraft of #213's criterion 3 (`#213.b4f8dc3a`)

"A step that writes 257 ray requests with max_per_step 256 traps services, naming physics.cast@1 and 257, and the
item's arrays keep the last good step's; and each answered request adds 4,000 fuel to the next step in the bake"

A fresh run of the acceptance job for this one criterion (design: Dogfooding: a disputed test goes to a fresh run of
that job, with the same inputs and the criterion), written from issue #213, the design and base `658b44f04` ("Merge
pull request #2499 …") with the first blind suite (`tests/acceptance/213/`, `213-oracle/`) on top, by a job that saw no
implementation, no diff and no dispute. The implementing agent doesn't edit these files (AGENTS.md, Proof). One file,
`ac3-trap-fuel.test.ts`, one test per clause, each titled with the criterion's ID.

## What was read

- The issue, live with `gh issue view 213 --repo windoliver/deepbuild`: its Scope, Fields (Logic: between-step
  services), the criterion and the Proof line ("the trap and the refusals with what each names").
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Between-step
  services). AGENTS.md.
- `docs/canvas-primitives.md`: Logic `logic@1` (its fields, exports and Semantics: "A trap stops only that item: its
  arrays keep the last step's values"); Logic: occurrences (a count over its cap traps, naming the kind and the count);
  Logic: sandbox (trap kinds, fuel); Logic: checkpoints and bake (the bake's `fuel: [u64] (per step)`); Logic:
  between-step services; Check input: `physics.query`; Check input: logic kinds (`logic.trap`, logic.budget reading
  the bake's fuel per step); ID and sub-address.
- In this checkout: the first suite's README (The surface under test), `helpers.ts`, `fixtures.ts` and `programs.ts`
  (imported read only; not its criterion-3 test file); `tests/acceptance/548/README.md` and `ac4-query-arrays.test.ts`
  (deep_query's logic read, the `logic` replay's `trap`), `539/README.md` (the `logic` call), `387/README.md`
  (`intern`); `crates/deep-show/src/picks.rs` (`logic_call`, `stepped`), `logic.rs` (`logic_read`), `query.rs`,
  `main.rs` (`deep_query`'s fields), `crates/deep-logic/src/world.rs` (where a trap is recorded, the occurrences
  trap's `count`, `rec.fuel`), `bake.rs` (`arrays_at`), `piece.rs` (the fuel budget's range, `services` refused).

What the base already does, which these tests don't credit: `deep_query`'s logic read bakes a document's logic items
over its span and answers each asked step's arrays and fuel and the item's `logic.trap`; a trap freezes only its item
and the bake keeps its last good step's arrays (an occurrences trap names its kind and `count`); `deep-logic` refuses a
logic item's `services` ("services isn't built yet in logic@1").

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/213-redraft-ac3 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/213-redraft-ac3/tsconfig.json
rm -rf tests/acceptance/213-redraft-ac3/node_modules/.vite
```

The file builds `deep-show` once, in `beforeAll`, through the first suite's `useBuilds(['show'])` (`cargo build --locked
-p deep-show --bin deep-show`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`
and Homebrew's rustup on PATH when present), and its programs with #544's assembler (`tests/acceptance/544/wat`, read
only, into `target/acceptance-544-wat/`). A cold `deep-show` build takes many minutes on a loaded Mac; run it first
under `node scripts/throttle.mjs build --wait 120 -- sh scripts/lease cargo build --locked -p deep-show --bin
deep-show` to make the run's own build a no-op. Each test passes a 60-minute timeout; its folders (the binary, the
evidence store) are temporary and deleted. No process is started but cargo, the assembler and `deep-show`, each waited
for; none is stopped by name or port. Nothing here depends on timing or load.

## The surface under test

The issue names the `services` field, the `services_at` region, physics.cast@1 with its 256 a step and 4,000 fuel, the
trap kind `services {service, count}` and the bake, but no call. This file keeps the first suite's surfaces where they
serve and otherwise uses what the base already exposes; **only the first suite's inventions below are new**, and they
stand as its README writes them.

- **The binary.** `deep-show run`, the only binary that links the logic and physics modules (the first suite's
  choice), one scenario line in, `{ok, replies}` out (the first suite's `scenario`, `runShow`).
- **The document.** The first suite's range (`fixtures.ts` `rangeScene`: world `range`, a static 1 × 4 × 4 m wall whose
  face is at x = 10 m and a static post off the ray, 2 s, items at 60 Hz) with one logic item whose params are
  `services: {"physics.cast@1": {"max_per_step": 256}}`, its `writes` and `budget: {fuel: 4,000,000}` (under the
  10,000,000 the base takes), and whose program exports `services_at` (the issue's).
- **The services region** is the first suite's (its README: The services region): at `services_at` a u32 request
  count and 4 zero bytes, then 256 requests of 160 bytes (a ray: kind 0, its world's handle, the group mask, max, from,
  dir), then a u32 result count (the requests the module answered) and 4 zero bytes, then 256 results.
- **The world's handle** a request names is the first suite's `handles.worlds.range` on the `logic` call's reply,
  read from a probe run of the same document (same doc ID, item ID and params) whose program asks nothing, presented
  and stepped once (the first suite: handles depend on the document's IDs alone, not on a program's bytes).
- **The bake** is read through deep_query's logic read, as #548's README gives it at the base: `{"call":
  "deep_query", session, doc, "what": "logic", "items": [<logic ID>], "steps": [k]}` →
  `logic.<id>: {region_map, steps: [{step, arrays: {"<id>.<name>": [value]}, fuel}], trap: LogicTrap | null}`, the
  item's bake as the hub bakes the document over its span: each asked step's arrays as that step left them, the fuel
  that step used, and the item's `logic.trap` (`{item, step, t, kind, function, offset, inputs}`).
- **A services trap** in that `trap`: `kind: "services"`, and the issue's trap fields `service` (the service's name)
  and `count` (the request count the step wrote) beside #548's, as the base's occurrences trap carries `count`.

Nothing here reads the `logic` call's step records or a per-step fuel on them.

## Readings where the issue leaves a choice

- **"Writes 257 ray requests":** the program copies 257 ray requests from its own memory into the region from its
  first slot (the 257th past the region's 256 slots, where the result block starts) and writes the request count 257.
  Every step before writes 256, the most, so 256 never traps and the last good step asked the cap.
- **"Traps services, naming physics.cast@1 and 257":** the bake's trap is the item's, at the step that wrote 257
  (step 20), of kind `services`, with `service: "physics.cast@1"` and `count: 257`.
- **"The item's arrays keep the last good step's":** in the bake, the item's arrays at the trapping step and at every
  later step asked (21 to 24, 60, 119) are step 19's (`n` 19, `asked` 256), not what step 20 wrote (`n` 20, `asked`
  257): the trapping step's writes are dropped and the item stays frozen (Logic `logic@1`: a trap stops only that item,
  its arrays keep the last step's values), as the base drops an occurrences trap's.
- **"Each answered request adds 4,000 fuel to the next step in the bake":** the meter runs the same instructions every
  step (the same 256 requests copied, only the count word changing), so its own fuel is the same at every step, and
  step 0, which follows no answered request, pays exactly that. Step k + 1's fuel in the bake is then step 0's plus
  4,000 × the requests step k had answered, for k = 0 … 39, over counts 3, 0, 1, 256, 2, 255, 0, 7 repeating. The
  program copies its result count each step (`answered`), which must equal the count the step before asked: no request
  dropped. Half the rays point away from every shape: a ray with no hit is answered too and costs the same.
- **"In the bake":** the hub's bake of the document, as deep_query's logic read gives it (the design's bake keeps
  `fuel: [u64] (per step)`, which logic.budget reads).

## What the tests assert, and the wrong programs each fails on

| Test | Asserts | Fails on |
|---|---|---|
| traps services | both documents presented; one trap `{item: flood, step: 20, kind: services, service: physics.cast@1, count: 257}`; `flood.n` k and `flood.asked` 256 at steps 0 to 19, then 19 and 256 at 20 to 24, 60 and 119 | no trap, a clamp or a dropped request at 257, a trap at 256, another kind, a trap that names neither, arrays from the trapping step, an item that steps on |
| adds 4,000 fuel | no trap; at steps 0 to 40, `asked` the count, `answered` the step before's, and fuel minus step 0's exactly 4,000 × the step before's count | no charge, a charge to the asking step, a charge for hits only, another price, a dropped request |

`BASE-FAILURE.txt` is the run at this checkout, where the feature doesn't exist.
