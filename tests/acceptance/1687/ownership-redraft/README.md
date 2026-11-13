# #1687: blind ownership / length redraft (AC1 and AC2 only)

Inputs: issue #1687, `docs/technical-design.md`, base
`c52f1c66d22886c336189d41237265e82843c34a`, and the owner's ONE PR decision.
That decision changes packaging only; every original responsibility and criterion remains.
No prior #1687 acceptance draft, candidate implementation, diff, session or dispute was read.
No AC3 checks are included. No existing behavior check is replaced or modified.

Run only this draft:

```sh
node --test tests/acceptance/1687/ownership-redraft/oracle.test.mjs tests/acceptance/1687/ownership-redraft/structure.test.mjs
```

## What the checks actually establish

| Requirement | Check | Wrong source / proof |
| --- | --- | --- |
| AC1's named seams; AC2's non-hook responsibilities leave their original source | `retained` compares TypeScript AST statement sequences (or expression bodies) from selected **base** methods/functions/dispatch branches against the original three source files | Base bodies still there; renamed methods, module helpers, arrow fields, nested closures, and an imported seam beside a retained implementation are rejected in planted fixtures |
| AC2: no method over 100 lines | Every callable with a body anywhere in `core.ts`, including constructor, accessors, methods, function-valued properties, callbacks and free functions, is measured by AST start/end positions | Executable 100/101-line fixture pairs for each callable form; actual base fails |
| Oracles themselves must distinguish wrong programs | `oracle.test.mjs` calls the same oracles as the source checks, asserts exact findings and failed assertions on wrong sources | Planted algorithms compile through TypeScript and run in an isolated VM; clean relocation produces the same `[4,6]` and has no retained algorithm |

Length means physical lines inclusive from the declaration's first token to its last token.
Leading documentation is excluded; internal comments, blank lines and multiline signatures count.
Function bodies cannot evade the limit by changing a method to a field, callback or module helper.
The 100-line constraint is not applied to Host, asks, or destination files: the issue names `core.ts`.

`base-surfaces.json` is generated test data: ordered AST statement hashes, old source labels and
body line spans, not proposed destination names. Its 53 surfaces cover:

- hub: remaining spool replay coordination; transcript read/tail/cursors/backfill; all four explicitly
  named delivery methods (`deliver`, `deliveryHeld`, `unwoken`, `resent`); stop holds and judging;
  MCP dispatch, binding and refusal handling;
- Host: source reads and shown cadence; schedule history, dispatch, blocking and judging; send rule
  handling and the actual `deep.send` branch in `dispatchNow`; runner jobs and their input reach;
- asks: resolver consultation/coverage gate, batching/show rules, and subject/fold/request/block keys.

These are selected old source surfaces, not a complete semantic inventory. Existing forwarding
methods need not disappear. The checks accept arbitrary new module/class/member names, imports
with aliases, and re-exports. An unchanged selected algorithm still in the old file fails even
under another method name or class, with cosmetic trivia changes, or inside a larger block.
The embedded send branch is measured as code, not by searching for its name in comments or strings.

## Proof limits — requirements remain open, not waived

The design's **Criteria in a checked shape**, **Wrong programs**, **Definitions fixed at the start**
and **Dogfooding** require independent checks through named surfaces and evidence from wrong
programs. The issue explicitly names these source files, so they are read as source, never imported
through a private production entry. A structural result is only the observation it asserts.

- Absence of an exact AST sequence is **not proof of semantic ownership**. Identifier/type changes,
  splitting/reordering statements, deletion, moving algorithms into local callbacks in changed form,
  or a rewritten implementation can avoid a match. We do not guess equivalence or impose a new
  delegate syntax. Missing/invalid source is an error, not a pass; an absent named Core is invalid.
- A green structure lane alone cannot prove **hook path and wiring only**. Review all remaining
  `core.ts` bodies, closures, helpers and state, and the destinations and calls, for responsibility
  ownership; splitting long methods into short policy methods does not satisfy this clause.
- AC1 still needs the unchanged reached behavior tests via `node scripts/affected.mjs` on base and
  candidate, with matching per-check results. Preserve and report WIDE/INCONCLUSIVE and known failures.
  Movement-only/public-entry/behavior equivalence cannot be inferred from these hashes.
- Every existing twin over a moved method must move with its method and still fail **its own
  criterion**, on runnable code, not merely on imports/build errors. These miniature source fixtures
  qualify the structural oracle; they are **not** replacements for those behavior twins. No old
  `twins.json` or #1687 test was read here; inventory and relocation proof remain required.
- Review that every original hub seam is a class with its own options (as Holds is), that sources,
  schedules, sends and jobs are actually owned by their Host seams, and that the asks gate, show
  rules and decision keys live behind the same entry in their own files. No arbitrary new file name,
  export name, options identifier or input-count limit is invented by this draft. This suite does
  not grant the later audit comment's narrower scope precedence over the owner's full-criteria decision.

Behavior parity, twin relocation, destination options, and complete semantic ownership are
**INCONCLUSIVE / unrun here**, never PASS. Only the direct Node structural tests are authorized for
this blind drafting job: `affected.mjs` and full preflight are intentionally not run. The red base
output is saved in `baseline.red.txt`, with checkout/home paths redacted. Nothing is committed.

The handwritten checks and this explanation fit under about 400 lines. The larger JSON is generated
base evidence, not copied product source. It is frozen input, not refreshed against future code.
