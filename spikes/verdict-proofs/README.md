# Spike: the verdict table in Lean 4

Asks whether machine-checked proofs are worth adding to the release preflight, using the verdict engine
(`packages/verdicts`, #28) as the first target. The design already checks the engine against a pure reference
with sampled property tests (One table, one reference, in `docs/technical-design.md`). Here a Lean 4 model of
the same table proves those properties for every input, and exported vectors tie the model to the engine.

**Result: all five properties are proved for the model. No `sorry`, `admit` or new `axiom`. The engine agrees
with the model on all 10,000 vectors. All five planted twins (two adjacent precedence ranks swapped) are
caught. Recommendation: no proof lane in preflight for now (see the end).** Nothing is committed.

## Run it

```sh
cd spikes/verdict-proofs
export ELAN_HOME=$PWD/.elan PATH=$PWD/.elan/bin:$PATH   # the toolchain lives here only (gitignored)
lake build                                              # checks every proof and builds the vectors exe
lake env lean Axioms.lean                               # prints each theorem's axioms
.lake/build/bin/vectors 10279 10000 > vectors.jsonl     # 10,000 vectors from seed 10279 (14 MB, gitignored)
cd ../.. && npx vitest run --root spikes/verdict-proofs # the engine against the vectors, and the twins
```

The toolchain is installed under `.elan/` from elan's release tarball with `--default-toolchain
leanprover/lean4:v4.35.0`. It uses core Lean only: no Mathlib, no Batteries, no lake packages. No lane runs
`agree.test.ts`: the repo's test globs don't reach `spikes/`.

## Files

| File | Lines | What it holds |
|---|---|---|
| `VerdictProofs/Model.lean` | 245 | The types and the decision function: rows per check, per requirement and per claim, then rolled up as `engine.ts` does |
| `VerdictProofs/Top.lean` | 130 | Lemmas: `top` is the highest by precedence; `cnt` reads only which records are present |
| `VerdictProofs/Proofs.lean` | 389 | Properties (a) to (e) |
| `Vectors.lean` | 191 | A seeded generator (splitmix64) and a JSON writer: claim, verdict, per-check and per-requirement outcomes, the rows that applied |
| `Axioms.lean` | 9 | `#print axioms` for each theorem |
| `concretize.ts` | 96 | Builds a concrete `ClaimInput` from an abstract vector |
| `agree.test.ts` | 73 | The engine against every vector; the five twins |

That is 964 lines of Lean: 375 of model and lemmas, 389 of property proofs and 200 of tooling. There are 169
lines of TypeScript.

## What was proved

Every theorem depends only on Lean's standard axioms (`propext`, `Quot.sound`, `Classical.choice`).

| | Theorem | Statement, for every claim of the model |
|---|---|---|
| (a) | `verdict_one_of_six` | The verdict is PASS, FAIL, INVALID, BLOCKED, INCONCLUSIVE or pending. In the model this holds by construction, since the type has six constructors. The engine-side claim is what the vectors check. |
| (b) | `verdict_is_highest_row` | The verdict, rolled up per check, per requirement and for the claim as the engine does, equals the highest by precedence of every row that applies anywhere. It holds for any reading of the runs. `top_eq` characterizes "highest": the one result that is PASS or a row, and ranks at least every row. |
| (c) | `pass_requires` | PASS implies all of these. The claim has a check. Every check's outcome is PASS. No check is never started or has runs to come. None can't fail. None has a counted run that ran nothing, is missing or failed unwaived. A fix check is proven on the base. Every check has at least the clean runs it needs. Every code requirement has a check at its depth, with a contract if it is about numbers, that isn't the agent's own. Every person requirement is answered PASS. A claim with no requirements has a check that isn't the agent's own. |
| (d) | `verdict_depends_on_set`, `verdict_perm`, `verdict_dup` | The verdict depends only on which run records are present. So permuting them, or sending one twice at any position, changes nothing. |
| (e) | `verdict_only_rises` | Take a verdict that is neither PASS nor pending, and let pending results land (`Lands`). Counted runs stay. New records belong only to checks with runs to come. Such a check may change state to anything but never started. An open ask may get any answer. The verdict's rank never falls. The proof shows that every row other than pending survives landing (`rows_persist`). |

The proofs also fail on wrong models. I built three mutants of `Model.lean` in a scratch copy. Ranking pending
below PASS breaks the `top` lemmas. Making "ran nothing" a PASS row breaks `check_pass_requires`. Counting only
the first record breaks (d). See Mutants below for what each build printed.

## The model, and every assumption it makes

The model has the engine's rows, all 29 that set an outcome (`Model.lean`): `staticRows`, `runRows`,
`endedRows`, `reqRow` and `claimRows`. Assumptions, each a place where a proof about the model says nothing
about the engine:

1. **Which runs count is one bit per run** (`Run.counts`). The model leaves out `Selection.counted`: the
   key match (digest, environment, tools), retention (`kept`), and carry from earlier commits by globs,
   reads and changes. It also leaves out `selectReruns`. The vectors realize `counts = false` five ways
   (digest, environment, tools, `kept: false`, an unnamed commit) and `counts = true` two ways (the claim's
   commit, or carried from a parent whose change touches nothing). They exercise no glob matching.
2. **Runs needed is an input** (`Spec.need : Option Nat`), with `some n` meaning `n ≥ 1`. The model leaves
   out `runsNeeded`, its exact decimal arithmetic and its 65,535 cap. `none` stands for every unreadable
   declaration. The vectors realize it as `accept: '0%'`.
3. **One run ID, one record.** The model dedups by whole record and the engine by run ID. They agree only
   when no two different records share an ID. The engine breaks this (finding 1).
4. **Requirement IDs and check IDs are unique.** `isFix` uses `any` where the engine uses `find`; these
   agree only with unique IDs.
5. **Evidence states form the closed set.** The engine's row for a state outside the set
   (`evidence … in an unknown state`) is not modelled, since `EvidenceSlot['state']` excludes it at the type
   level.
6. **A contract report is `none`, `counts` or `invalid`.** An `invalid` report always raises its row. The
   engine raises it only when `reasons` is non-empty (finding 2).
7. **Waivers are pre-judged per failure** (`Failure.waived`). The model leaves out error-text
   normalization, end dates, conditions and the approver-isn't-the-claimant rule.
8. **Text, open items, asks, send-backs, fix tasks, smallest cases, pointers, contradictions, the verdict
   key and hashes are out of scope.** So are per-cause `missing` rows, which give one outcome however many
   causes there are. The model decides outcomes only.
9. **Landing (e) leaves the counted bit of earlier runs alone.** A new record never changes whether an
   older one counts. In the engine a late run on a parent commit can (finding 3).
10. **The model trusts the TypeScript shapes.** For example, `tests_run` is a natural number and outcomes
    are the closed set. Lean's `Nat` truncating subtraction stands in for `Math.max(0, …)` in `moreRuns`.

## Tie to the code

`lake exe vectors` generates abstract claims: 0–3 requirements, 0–4 checks, 0–5 runs each. About 15% of
claims hold a run sent twice at a random position, 5% hold a run for a check that doesn't exist, and 40% are
in a "clean" mode that makes PASS reachable. For each claim the exe prints the model's verdict, every check's
and requirement's outcome, and the rows that applied. `concretize.ts` builds a concrete `ClaimInput` from each
claim. `agree.test.ts` requires the engine's outcome, its per-check outcomes and its per-requirement outcomes
to equal the model's.

- Seed 10279, 10,000 vectors. Verdicts: INVALID 5,732, FAIL 1,708, INCONCLUSIVE 1,117, pending 749, PASS 446,
  BLOCKED 248. Every one of the 29 rows applies in at least 44 vectors. The test asserts all six outcomes and
  all 29 rows appear.
- The engine agrees on all 10,000 (1.3 s for the whole file).
- The twins copy `packages/verdicts/src` to `.twin/<swap>/` (gitignored, removed after the run) and swap two
  adjacent entries of the engine's `RANK`. All five swaps (PASS⇄pending, pending⇄INCONCLUSIVE,
  INCONCLUSIVE⇄BLOCKED, BLOCKED⇄INVALID, INVALID⇄FAIL) disagree with the model on at least one vector, and
  the failure names its seed.
- `packages/verdicts` is not edited.

## Disagreements found

Each counterexample below was run against the engine and the acceptance reference
(`tests/acceptance/28/reference.ts`), in scratch tests outside the repo.

1. **Engine: two different records with one run ID make the verdict depend on order.** `Selection` keeps
   the first record per ID before sorting. The reference also keeps the first counted one. Take one check
   needing one run. Records `run:R1 passed` and `run:R1 failed` (one failure) give **PASS** in that order
   and **FAIL** in the reverse order, in both the engine and the reference. The design's "doesn't change
   when records arrive in another order" holds only for identical copies. This matters if a run record is
   ever re-emitted with a changed outcome. Follow-up: reject conflicting records under one ID (INVALID,
   naming the run), or pick deterministically.
2. **Engine: a contract report with `outcome: 'INVALID'` and `reasons: []` raises no row.** The engine adds
   one INVALID row per reason. A run that passed with such a report gives engine **PASS**, reference
   **INVALID**. `runContract` never emits that shape, but the engine reads run records from the record, not
   from `runContract`. Follow-up: key the row on `outcome`, not on `reasons.length`.
3. **Design/engine: a late run on a parent commit can lower a verdict** (outside assumption 9). Take check
   `k` with `inputs: ['lib/**']` and `runs: 2`. It has a `missing` run on parent commit C, carried because
   C's change touches only `src/x.ts`, and another check declares `src/**`. The verdict is **BLOCKED**.
   Then a second run of `k` on C ends, having read `src/x.ts`. The carry is withdrawn, `k` has no counted
   runs, and the verdict becomes **pending**. BLOCKED fell to pending, against "a verdict only rises as
   pending results land". It turns on whether such a late run counts as a pending result of this claim. The
   design doesn't say. Follow-up for the design: either freeze the carry decision once a verdict is made,
   or state that carry inputs are read only from runs that ended before the claim.
4. **The test-only reference misses five engine rows.** It disagrees with the engine and the model on 433
   of the 10,000 vectors (4.3%). Every disagreement is the reference being more lenient, and in each case
   below the reference gives **PASS** where the engine is right to refuse:
   - a fix check with no base run (engine INVALID): the reference only checks a base that exists;
   - a contract check whose run has no contract report (engine INVALID);
   - a state digest that isn't a sha256 (engine INVALID);
   - captured evidence with no digest (engine INCONCLUSIVE);
   - a claim with no requirements and only the agent's own checks (engine INCONCLUSIVE).

   AC27's 10,000-claim agreement can't see these because `generate.ts` never produces them. So a
   regression in any of those five engine rows passes the acceptance suite. A follow-up for #28's acceptance
   job, not this spike, since agents don't edit acceptance tests: add the rows to the reference and the
   cases to the generator.

No disagreement was found between the model and the design's rule table apart from item 3.

## What the property tests already cover, and what the proof adds

Already covered: `tests/acceptance/28/reference.test.ts` checks (a) to (e) on the real engine, plus
never-started checks, carry keys and open-item IDs. It samples 1,000 claims per property and 10,000 for
agreement, from its own generator. A failure there is a failure of the shipped code.

The proof adds:

- (b) to (e) hold for every claim of the model: every size, every combination of the 29 rows, waivers and
  inheritance included. The sampled tests reach only what `generate.ts` draws: no waivers, no claim without
  requirements, no bad state.
- (d) is proved in a stronger form, dependence on the set of records, which covers duplicates at any
  position.
- (e) is proved for any landing: state changes, any number of new runs, answers arriving. The sampled test
  only appends 0–3 pass/fail runs and ends every running check.

What it doesn't add: any guarantee about `engine.ts`. The model is hand-written next to the engine, and the
link between them is 10,000 sampled vectors, the same strength of evidence as AC27's agreement test. None of
the five properties failed in the model. The findings above came from writing the model and diffing
vectors, not from a failed proof. Writing the model forced every row to be enumerated, and comparing against
it exposed the reference's gaps.

## Cost

- **Time:** about 25 minutes of wall time for the whole spike: toolchain install, model, proofs, vectors,
  TS test and probes. The proofs took about 10 minutes and 7 build/fix rounds. Every error was tactic
  plumbing (simp lemma names, `rcases` shapes). None was a property that failed to hold.
- **Tokens:** about 270k tokens of context at the end (messages about 187k), read from the session's usage
  report. Cumulative billed input across turns, which re-reads context, was not measured.
- **Machine:** the toolchain is 2.8 GB under `.elan/` and the build output is 7 MB. A cold `lake build` of
  proofs plus exe takes 35 s. The agreement test takes 1.3 s.
- **Upkeep:** every change to the rule table needs a matching edit to `Model.lean`, `concretize.ts` and
  usually the proofs. `check_pass_requires` destructures the 17 per-check rows by position, so adding a row
  breaks it until someone edits it.

## Recommendation: no proof lane in preflight, for now

The lane would cost 35 s and 2.8 GB on every release machine, plus Lean upkeep on every table change. It
would guarantee only the model. The engine would still be tied to the model by the same kind of sampled
agreement the preflight already runs against the TypeScript reference. This round, the value came from
writing the model and diffing it, not from the proofs. The cheaper ways to get that value are follow-ups 1,
2 and 4: fix the two engine edges, and give the reference and its generator the five missing rows. The
design question in finding 3 needs an owner call.

Revisit when one of these holds:

- the rule table stops changing often, so upkeep is rare;
- interactions grow past what sampling reaches (waivers × inheritance × flaky × landing already need
  hand-built generators);
- a proved model can replace `reference.ts` as AC27's oracle, so there is one hand-written reference instead
  of two.

At that point a lane would be `lake build && vectors && agree.test.ts`, about 40 s.

## Mutants

Scratch copies of `Model.lean` with one change each, built with `lake build VerdictProofs`:

- **pending ranked below PASS** (`PASS => 1, pending => 0`): the build fails in `Top.lean`
  (`rank_eq_zero`, `foldl_max_spec`).
- **"ran nothing" raises PASS**: the build fails in `Proofs.lean`, `check_pass_requires`. `decide` refutes
  `PASS ≠ PASS`.
- **only the first run record is read** (`cnt` reads `runs.take 1`): the build fails in `Top.lean`,
  `cnt_congr`, the lemma (d) rests on.

Two of the three fail in a lemma, not in the property theorem itself. Either way, the wrong model can't be
proved.
