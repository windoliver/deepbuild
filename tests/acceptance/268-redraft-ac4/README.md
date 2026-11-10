# Blind redraft for #268, criterion 4's mover clause: "a pile a channel, a clip, physics or logic moves is refused at check, naming it"

Criterion ID `#268.a0c77147` (criterion 4: "Moving the pile 1 m between revisions changes the field's key and the field
equals a clean bake; a pile a channel, a clip, physics or logic moves is refused at check, naming it, and a field past
2,048 × 2,048 cells at its `cell` is refused, naming the count"). This folder redrafts only the clause in the title; the
other two clauses stay in `tests/acceptance/268/field.test.ts`. Written from issue #268, the design and base commit
`42319109`, by a job that never saw an implementation (AGENTS.md, Proof; design: Dogfooding). It replaces the test
"#268.a0c77147 a pile a channel, a clip, physics or logic moves is refused at check, naming it" in `field.test.ts`.

## What was read

- Issue #268: its Scope ("An item of `items` that a channel, driver, constraint, clip, physics or logic moves or
  reshapes during the document's span … refused at check"), its Fields row and criterion 4.
- `docs/canvas-primitives.md`: Logic `logic@1` (its arrays are read "by path" by drivers and readouts, and "a mark set
  or an instancer can take one as a column"; logic "can never … draw by itself (the core draws what it writes)"),
  Logic: interpolated writes, Instance `instance@1`, Instance `instance@1`: logic columns (`pos`, `live`, `gen` read
  `{array: <logic>.<name>, as}`; an element is `<instancer>#<slot>.<gen>`), Mark set: logic columns, Driver.
- `docs/technical-design.md`: Dogfooding.
- At the base, for call shapes and what it accepts: `tests/acceptance/268/` (its README, `helpers.ts`, `field.test.ts`,
  `tsconfig.json`), `tests/acceptance/166/physics.test.ts` (the logic fixture), `tests/acceptance/424/picks.test.ts`
  (an instancer's literal columns); `crates/deep-canvas-motion/src/program.rs` (a driver var reading an array is
  `ref_unresolved`, "motion's drivers read no canvas module's array"); `crates/deep-canvas-scene3d/src/{scene,cut,
  water,spec}.rs` (`evaluate_any`: #166's `logic_moved`, then `Program::compile`; instancers placed by `cut::elements`;
  a kind scene3d doesn't draw, such as `logic@1`, goes to `others`; `visible: false` on a prototype); `crates/
  deep-gpu-layer/src/{view3d,session3}.rs` (the order of the checks before a frame).

## The dispute, and this reading

`field.test.ts` moves its logic pile `pile-steered` by a driver whose var reads `pilot.x`, and requires that document
drawn with `shore: "none"`. The base refuses any driver that reads a module's array, whatever the shore
(`{"code":"ref_unresolved","reason":"drivers/steer/vars/x"}`), so that control fails on every program, right or wrong.

The design gives logic three ways to move what draws: a driver reading its array, a mark set's columns, and an
instancer's columns (and meshes from logic, which aren't piles). The base can't evaluate the first at all. It can take
the third: an `instance@1` whose `pos`, `live` and `gen` are `{array: …}` objects has no literal rows in the base's
`cut::elements`, so it places no element and nothing refuses it; the document draws. So the logic mover here is
`pile-fleet`, an instancer of piles fed by the `logic@1` item `pilot`'s `pos` (vec3), `live` (bool) and `gen` (i32)
arrays, each of count 1, under `requires.modules.logic: "^1"`. Logic moves every element of it: an element stands where
the last step wrote it. The collection names the instancer, the item in `items`; its hidden prototype `pile-proto` is
not in the collection.

- **"Naming it"** for the logic mover is the instancer's ID `pile-fleet` or an element's address `pile-fleet#<slot>` or
  `pile-fleet#<slot>.<gen>`, each as a whole ID. For the other three it is the moved item's ID as `field.test.ts` reads
  it (`refusedNaming` from `../268/helpers.ts`).
- **The driver form is not asserted.** A driver is its own mover in the Scope and isn't in the criterion; and a driver
  reading `pilot.x` can't be drawn by any program built on this base, so a test of it has no control that can pass.
- **Not vacuous**, each control one a correct program meets: every mover's document with `shore: "none"` is drawn; a
  static pile `pile-still` in the collection is drawn with the shore on; and a static instancer `pile-rows` (two literal
  `pos` rows, no logic) in the collection is drawn with the shore on, so what refuses `pile-fleet` is logic moving it,
  not its being an instancer. The Scope names static items as the shore, and nothing in it refuses an unmoved instancer.
- The channel, clip and physics movers are `field.test.ts`'s, unchanged.

## What the base does

The base reads no `shore`, so it draws all four movers with the shore on: the test fails there on the first mover's
refusal, as the clause requires. The controls draw at the base by the code read above (the instancer's columns go
unread, the logic item is an undrawn kind); no run of the base binary was made here.

## Run it

```sh
npx tsc -p tests/acceptance/268-redraft-ac4/tsconfig.json
npx vitest run --root tests/acceptance/268-redraft-ac4 --no-file-parallelism --testTimeout=3600000
```

It builds `deep-gpu` from the working tree through `../268/helpers.ts` (`useGpu`), so a run shows the working tree's
answers, not the base's. It times nothing.
