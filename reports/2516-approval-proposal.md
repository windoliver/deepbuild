# #2516 — approved frozen-check reconciliation

**Approved by the owner, recorded 2026-11-15T07:41:02Z**, after this proposal and the exact four comparison frames were shown. Exact instruction: **“goea d do whatever you reockemnd to close the issue”**. The implementing session recorded that go-ahead against the recommendation to apply A–C below and retain the displayed defaults. This is acceptance of the recommendation, not an invented detailed visual assessment.

The issue's criterion 4 was clarified explicitly and [PR comment](https://github.com/windoliver/deepbuild/pull/2578#issuecomment-6891236604) records the authorization. A separate acceptance-author job, given only the base/design/issue, existing drafts and this approval, applied it without seeing the implementation. See [the authored edit map](../tests/acceptance/2516/APPROVED.md). Original drafts remain in commit `3cd75b8aa`; pre-approval failures remain retained. No other test, golden, tolerance, compiler setting or criterion change is authorized.

## A. CPU oracle: point values versus a band's average

The first independently drafted `tests/acceptance/2516/reference.test.ts` compares the average over the cube's middle 10 cm (**0.6922** at 5 cm) directly with the issue's center-point value **0.68**, within a draft-only qualification tolerance 0.01. It fails before any renderer is called.

The one blind redraft, `tests/acceptance/2516/redraft-ac4/reference.test.ts`, independently derives the cube-face center value **0.6824** (rounds to 0.68) and qualifies both the center-point ray reference and the read-band average against their respective closed forms. Its five CPU tests pass. The rendering bound stays the issue's **0.1**; no expected value is removed and neither tolerance changes.

**Approved application:** the original qualification retains all existing cases and now qualifies its point value against 0.68/0.81 and the redraft's analytic face form, and its unchanged band reference against that form averaged over the same 11 points. Both original and redraft CPU suites run: **14/14 pass**. No case was silently excluded. GPU checks remain required; approval is not their result.

## B. Redraft type safety and reference-machine gate

The redraft had ten TS2532 errors at `redraft-ac4/reference.ts:41–42`: the array loop used an unrestricted `number` where its inputs are 3-tuples. The author applied the approved literal-index loop; the whole #2516 TypeScript project now type-checks with no compiler setting changed.

**Approved mechanical correction, applied by the drafting job:** iterate `for (const k of [0, 1, 2] as const)` rather than `for (let k = 0; k < 3; k++)`. No branch, expected value, ray, comparison, configuration, or numerical operation changes. Do not turn off `noUncheckedIndexedAccess`, cast away the warning, or change a check's outcome.

The redraft imports #379's old reference-machine helper, whose list has only Mac15,7 and Mac15,12. The issue's design also allows **Mac17,10**. The actual host is Mac17,10 with macOS build 26B8119. The author's approved correction is limited to this issue's gate; it now accepts the design's three real model IDs. #379's frozen helper is not edited.

**Approved gate correction, applied by the drafting job:** qualify exactly the design's three model IDs in the redraft's own helper, using the real OS reading; retain INCONCLUSIVE off those machines and BLOCKED without a GPU. Do not spoof `sysctl`, environment fingerprints, or GPU availability.

## C. Plant and timing remain measured gates

`ao_main_loop`, `ao_uniform_hemisphere`, and the full-radius variant are real renderer programs. The redraft's `ao_points_at_radius` name is wired to the same full-radius implementation as `ao_full_radius`; no estimator or constant differs by spelling.

The original full-radius wall witness previously failed near the 5 cm tolerance boundary in half resolution. It is not waived by this proposal. The shared surface-aware upsample improves the shipped camera-A contact reading and leaves the literal plant failing only camera B / 16 / half at 5 cm (~0.614). The redraft's first GPU run is INCONCLUSIVE on its stale machine gate, and its alternative wall fixture readings (0.6438–0.6811 at 5 cm) also do not establish the witness. Neither changing the machine gate nor approving the point/band interpretation alone closes AC4. No second redraft is authorized or attempted.

**Approved witness clarification, reflected in the issue and applied by the test author:** hold the literal full-radius plant to the original wall fixture at **full resolution**, both cameras and both sample counts, where the retained GPU run meets ±0.05; then require it to fail on the cube as before. Keep **every shipped-program wall bound** unchanged at both half and full resolution, 8 and 16 samples, both cameras. This narrows only the wrong-program demonstration; it does not loosen the product's tolerance or excuse a shipped reading. The issue's current wording and original frozen check are not silently reinterpreted or edited. The redraft's different wall fixture is not substituted.

The repeated follow-up tried a shared symmetric-tap blur, not a plant tweak. It did not resolve the same original witness, and was removed with its failing output retained. Further tuning solely to make that known-wrong program satisfy an unsupported witness is not proposed.

The castle's five warmed timestamp runs have now completed on merged commit `c7b6f9723` under a real timed grant and GPU lease, with nominal thermal state and all loads below 18 cores. The unchanged measurement, Cost-line and held-lease checks pass; the redacted record is `docs/evidence/2516/timings-803322230a66.json`. No acceptance approval was needed to take that real measurement. This does not make either disputed AC4 check pass.

## D. Taste and goldens

The owner's go-ahead accepts the recommendation to keep radius 0.5 m and strength 1 on the exact four check-run images shown. `tests/acceptance/2516/TASTE.json` records the instruction, its provenance and all four SHA-256 hashes. No other image or golden is approved. The unchanged taste check must still reproduce those images and match the record; authorization alone is not a passing run.

No stored golden has moved. The four committed #422 castle goldens use `packs/examples/castle.look.json`, whose AO is absent/off; the additional AO-on comparison frames are not replacements for those goldens. The shipped `physical_film` and `physical_night` looks retain their defaults. Any affected approved golden discovered by a run still requires its own proposal.

The reconciliation is approved and applied by the independent author. AC6 retains its qualified timing proof. AC7's exact-image owner record is present; its unchanged check is being run from a rebuilt base and the PR renderer. Closure still requires the approved GPU checks and the actual taste-check result, never approval alone.
