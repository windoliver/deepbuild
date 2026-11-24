# Dispute: #189's lab suite, first draft against its blind redraft

Criteria 8 and 10 and criterion 11's re-derive leg (`#189.4e3f31a0`, `#189.dfd0da6e`, `#189.9badbff7`). The owner rules once
on the swap (technical design: Dogfooding); until then `scripts/lanes.mjs` runs this redraft in the first draft's place and
keeps `tests/acceptance/189/lab/` by hand. Neither draft was edited by the implementing agent.

## Why the first draft went back

Every file of `tests/acceptance/189/lab/` (commit 287690d79) stops before its own assertions, because the base itself
refuses the lab document at presentation. A logic item may read `<world>.<body>.grounded` only when the world declares an
output `{from: <body>, read: grounded}`: `crates/deep-logic/src/play.rs:87` (`world_reads`, #182) builds the piece's
`world_reads` from those outputs alone, and `crates/deep-logic/src/piece/checks.rs:411`/`420` refuse any other read. The
first draft's `labWorld` declares no outputs. The drafting job had never run `deep-show` at the base (the build queue
held it), so it didn't see this. The base fact, and nothing of the work, went back to the same drafting job once, as the
design's rule for a check that fails outside its named assertions says.

The first draft's run on the work (`ac10-world-content.test.ts`, the change's tree, Nov 20 2026), each test the same:

```
AssertionError: the lab with the layout probe as its program is presented: [{"check":"document.validate","code":"logic_refused","severity":"error","ids":["rules"],"path":"items/rules/params","actual":{"ok":false,"code":"logic_refused","item":"rules","refusals":[{"rule":"read","what":"lab.hero.grounded names no control or logic item of this piece","read":"lab.hero.grounded"}]},"what":"the logic module refuses this logic item","fix":"See the issue."}]: expected 'refused' to be 'presented'
```

`ac08-rederived.test.ts` and `ac11-rederive-budget.test.ts` stop at the same presentation.

## The redraft

Commit 2d9042dc8 (cherry-picked as 2ce143acf), by the same drafting job from the same inputs plus that base fact. Its one
change is the lab world's `outputs: {footing: {from: 'hero', read: 'grounded'}}`; the three test files, the surface, the
calls, the notice, the test builds and the planted names are the first draft's. At the base all six of its tests fail on
their assertion "the logic call's saves" (its BASE-FAILURE.txt).

On the work (Nov 20 2026, load 68 on 18 cores):

| File | First draft | Redraft |
|---|---|---|
| `ac08-rederived.test.ts` | 0/3, refused at presentation | 3/3 pass |
| `ac10-world-content.test.ts` | 0/2, refused at presentation | 2/2 pass |
| `ac11-rederive-budget.test.ts` | refused at presentation | INCONCLUSIVE by load: runs 341, 488, 178, 257, 172 ms against 5,000 ms, off a reference Mac |

The redraft passes on the work where the first draft can't run, so the swap is the owner's call: keep the redraft as
these criteria's tests (and move the first draft out of the by-hand list), or rule otherwise.
