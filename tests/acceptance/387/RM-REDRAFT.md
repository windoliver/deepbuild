# Reduced-motion blind redraft: the operators that play motion change key, and only theirs

Test: `view-reduced-motion-redraft.test.ts`, one `describe` ("#387.f71bf834 flipping the view's reduced motion changes
the keys of every operator that plays motion (redraft)") with one `it`. It redrafts the second test of `view.test.ts`
("#387.f71bf834 reduced motion off → on: the operators whose result moves (the text animator) change the key of every
node they have"). The ID is the first 8 hex of the SHA-256 of the criterion's text with `- [ ] ` dropped (checked:
`f71bf834`).

The criterion: "Flipping the view's locale, and separately its reduced motion, changes the content keys of every
operator that formats numbers, shapes text or plays motion, and both reduced-motion renditions exported in one process
give different text-animator frames; a planted key without the locale or reduced motion reuses the other's result and
fails, naming the operator". This redraft covers its reduced-motion key half. The locale test, the one-process
renditions test and both planted tests stay in `view.test.ts`, unchanged.

`helpers.ts`, `tsconfig.json`, `fixtures/`, `README.md` and the other test files are unchanged. The redraft's own
helpers (`fresh`, `readsFrom`, `motionFailures`) are in its file. The board `VIEWED` is `view.test.ts`'s, copied
unchanged.

## What I read

- Issue #387: the Operator and read set field list (`view(… | reduced_motion)` among the read terms; "It can never: Read
  what it didn't declare") and the criterion above.
- Issue #371, AC2: "A still scene draws no new frames, and under reduced motion nothing moves".
- `docs/technical-design.md`: line 518 (the app moves the parts every frame, "stopping when everything settles … and
  holding still under reduced motion"); Dirty classes and content key (1494: a key is `hash@1` of the operator, "the
  content keys of its read set …, the view inputs it reads and the seed").
- `docs/canvas-primitives.md`: Transport (5092–5095: `reduced_motion: hold | slow = hold`; with `hold` "a text animator
  keeps only opacity", motifs and drift hold); Operator and read set (1117–1121: "The core builds an operator's inputs
  from its reads … and computes its content key and change test from the same list"; "a key that changed while its
  result didn't is counted as a reading, never a failure").
- `AGENTS.md`; the suite's `README.md` (the `eval` reply, the registry's `operators` and `contributes_to`, Readings:
  "Formats numbers, shapes text or plays motion", the text animator, the planted keys), `helpers.ts`, `view.test.ts`,
  `A4-REDRAFT.md` and `A9-REDRAFT.md`.

HEAD is `14561af` ("Merge pull request #755 …"), where #387 is merged. I saw no implementation of the change that raised
the dispute and didn't look for one.

## The dispute

The first draft judges "plays motion" by result alone:

```ts
const moved = sorted([...new Set(x.nodes.filter((n) => right.get(`${n.operator}@${n.item ?? '(document)'}`)?.result !== n.result).map((n) => n.operator))]);
```

and then requires every node of each such operator to change key. Any operator downstream of a moved input counts.
`VIEWED` is a board under `transport.reduced_motion: hold`, so by the design a correct build's motion operator holds
`mover`'s slide and the title's clip offset still when reduced motion is on. That operator then reads
`view(reduced_motion)`, and the operators below it get another result on `title` and `mover` because their input
moved: `core.transform` and `core.fields` (motion contributes `motion.at` and `motion.fields` to them), `core.world`,
`text.shape` on the title. The first draft then requires their keys to change on `back`, `n` and `lbl` too, whose reads
didn't change. Only a false read of the view input could give that.

At `14561af` motion doesn't hold under reduced motion, so only `text.animate@title` and `marks2d.frame@(document)` move
(a probe at the base, two fresh clean renditions at 0.5 s):

```
motion.channels@title  result same  key same      text.animate@title        result DIFF  key DIFF
motion.channels@mover  result same  key same      marks2d.frame@(document)  result DIFF  key DIFF
core.world@*           result same  key same      (every other node: result same, key same)
```

Both moved operators have one node each, so the first draft passed there for a reason the design no longer allows.

## What the redraft asserts instead

Two fresh clean renditions, as before: reduced motion off, then on. "Plays motion" now means an operator that reads the
view's reduced motion, by either of two readings:

- **Its own result moves while nothing it reads moved.** One of its nodes has another result, and every node of every
  operator it depends on has the same result in both renditions, on any item. Any item is checked so that reads
  through `parent`, `children`, `refs` or a set count. "Depends on" means the writers of the arrays in its registered
  reads, of arrays the registry says contribute to one of them, and of arrays that contribute to an array it writes
  (a contribution is composed into that array, so it can reach the writer's own result). Time, tables and the reading
  are the same in both renditions, so only a view input can have moved it.
- **Its registered reads name `view(reduced_motion)`.** The content key holds "the view inputs it reads", so its keys
  must change. This keeps the text animator in scope when a holding motion operator has already moved its input
  (`core.fields` on the title), which hides its own read from the first reading.

| # | Assertion | Kept or new |
|---|---|---|
| 1 | The title's frame moves with reduced motion: some node on `title` has another result | kept (the first draft's precondition, now any node on the title) |
| 2 | Some operator's result moves while nothing it depends on moved | new: replaces "some moved operator has a node on the title" |
| 3 | Every node of each operator that plays motion (2's operators and the declared readers) has another key in the second rendition | kept in form; its operator set narrowed |

An operator whose result moved only because something it depends on moved isn't asked to change key on nodes whose
reads didn't change: `core.world` on `back`, `n` and `lbl`. Such an operator still changes key where its input's key
moved, because its read set's keys are in its key. That half belongs to the perturbation tests, not to this criterion.

Wrong programs it fails:

- A key without the view's reduced motion. At the base, `planted: "key_without_reduced_motion"` on both fresh
  renditions (a throwaway copy of this file) fails at 3:
  `text.animate on title keeps its key across the reduced-motion flip, though text.animate reads the view's reduced motion`.
  So the redraft still catches the suite's planted twin. `view.test.ts`'s planted test, which checks result reuse in
  one process, is unchanged.
- A holding motion operator whose key leaves out reduced motion.
- A text animator whose key does.

The last two were checked on a synthetic second rendition, built from the base's real first rendition and registry
(throwaway, deleted). In it, motion holds: `motion.channels` on `title` and `mover`, the transform, fields and world on
those items, the title's shaping and animator, and the frame all have another result and key.

| Case | Redraft | First draft |
|---|---|---|
| Correct holding build | finds `motion.channels` (by reading 1) and `text.animate` (by reading 2), no failures | fails on `core.fields`, `core.transform` and `core.world` on `back`, `n` and `lbl`, and on `text.shape` on `n` and `lbl` |
| Same, with only `core.world@mover` moving downstream | same result as the row above | not run |
| `motion.channels` keeps its keys | fails, naming `motion.channels` on `title` and `mover` | not run |
| `text.animate` keeps its key | fails, naming `text.animate` on `title` | not run |

A real holding build wasn't available to me, so this checks only the judging function, not a build.

Limits: an operator that reads an array it didn't declare would look like a direct reader, and its keys would be judged.
That is the "Read what it didn't declare" wrong program, so failing it is right, though the failure message would name
the view input. The test doesn't run under a test build's `access` log because `full` is the build the criterion
names.

## Type check

`npx tsc -p tests/acceptance/387/tsconfig.json`: exit 0, no output.

## Run on the base

`npx vitest run --root tests/acceptance/387 view-reduced-motion-redraft --no-file-parallelism` at `14561af` (after
`npm ci` and building `deep-show` with `full`): 1 test, 1 passed.

```
 ✓ view-reduced-motion-redraft.test.ts > #387.f71bf834 flipping the view's reduced motion changes the keys of every operator that plays motion (redraft) > #387.f71bf834 reduced motion off → on: the operators whose result moves with the view's reduced motion itself, not through an operator they read, change the key of every node they have 1764ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

The same file with `planted: "key_without_reduced_motion"`:

```
 × … 1737ms
AssertionError: every node of an operator that plays motion (text.animate; moved: text.animate@title) changes key with reduced motion: expected [ Array(1) ] to deeply equal []
+   "text.animate on title keeps its key across the reduced-motion flip, though text.animate reads the view's reduced motion",
```
