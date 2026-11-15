# #2516 — frozen-check reconciliation proposal (pending)

No acceptance test or golden has been changed to apply this proposal. No approval or taste decision has been recorded. The request to close gaps is not recorded as either decision.

## A. CPU oracle: point values versus a band's average

The first independently drafted `tests/acceptance/2516/reference.test.ts` compares the average over the cube's middle 10 cm (**0.6922** at 5 cm) directly with the issue's center-point value **0.68**, within a draft-only qualification tolerance 0.01. It fails before any renderer is called.

The one blind redraft, `tests/acceptance/2516/redraft-ac4/reference.test.ts`, independently derives the cube-face center value **0.6824** (rounds to 0.68) and qualifies both the center-point ray reference and the read-band average against their respective closed forms. Its five CPU tests pass. The rendering bound stays the issue's **0.1**; no expected value is removed and neither tolerance changes.

**Proposal:** use the redraft's separate point and band qualification for AC4, retaining the original draft and its failure as superseded history through the project's approved mechanism. Do not silently exclude the failing original or substitute a different expected number in it. The redraft does not yet have GPU proof, so approval of its oracle interpretation alone is not a PASS for AC4.

## B. Redraft type safety and reference-machine gate

The redraft has ten TS2532 errors at `redraft-ac4/reference.ts:41–42`: the array loop uses an unrestricted `number` where its inputs are 3-tuples.

**Proposed mechanical correction, by the drafting job:** iterate `for (const k of [0, 1, 2] as const)` rather than `for (let k = 0; k < 3; k++)`. No branch, expected value, ray, comparison, configuration, or numerical operation changes. Do not turn off `noUncheckedIndexedAccess`, cast away the warning, or change a check's outcome.

The redraft imports #379's old reference-machine helper, whose list has only Mac15,7 and Mac15,12. The issue's design also allows **Mac17,10**. The actual host is Mac17,10 with macOS build 26B8119. Without an approved correction to the redraft's own gate, its GPU run is INCONCLUSIVE on this host. #379's frozen helper is not edited.

**Proposed gate correction, by the drafting job:** qualify exactly the design's three model IDs in the redraft's own helper, using the real OS reading; retain INCONCLUSIVE off those machines and BLOCKED without a GPU. Do not spoof `sysctl`, environment fingerprints, or GPU availability.

## C. Plant and timing remain measured gates

`ao_main_loop`, `ao_uniform_hemisphere`, and the full-radius variant are real renderer programs. The redraft's `ao_points_at_radius` name is wired to the same full-radius implementation as `ao_full_radius`; no estimator or constant differs by spelling.

The original full-radius wall witness previously failed near the 5 cm tolerance boundary in half resolution. It is not waived by this proposal. The shared surface-aware upsample improves the shipped camera-A contact reading and leaves the literal plant failing only camera B / 16 / half at 5 cm (~0.614). The redraft's first GPU run is INCONCLUSIVE on its stale machine gate, and its alternative wall fixture readings (0.6438–0.6811 at 5 cm) also do not establish the witness. Neither changing the machine gate nor approving the point/band interpretation alone closes AC4. No second redraft is authorized or attempted.

**Proposed witness clarification, requiring owner approval and an issue/check update:** hold the literal full-radius plant to the original wall fixture at **full resolution**, both cameras and both sample counts, where the retained GPU run meets ±0.05; then require it to fail on the cube as before. Keep **every shipped-program wall bound** unchanged at both half and full resolution, 8 and 16 samples, both cameras. This narrows only the wrong-program demonstration; it does not loosen the product's tolerance or excuse a shipped reading. The issue's current wording and original frozen check are not silently reinterpreted or edited. The redraft's different wall fixture is not substituted.

The repeated follow-up tried a shared symmetric-tap blur, not a plant tweak. It did not resolve the same original witness, and was removed with its failing output retained. Further tuning solely to make that known-wrong program satisfy an unsupported witness is not proposed.

The castle's five warmed timestamp runs require a timed grant plus GPU lease and qualified machine state. No approval in this proposal authorizes a number from a busy/unleased run or an invented Cost line.

## D. Taste and goldens

The owner alone decides the corners at the default radius and strength, on the exact four check-run images shown. No such decision is saved. A changed shader requires its own frames; a call on earlier frames is not silently carried.

No stored golden has moved. The four committed #422 castle goldens use `packs/examples/castle.look.json`, whose AO is absent/off; the additional AO-on comparison frames are not replacements for those goldens. The shipped `physical_film` and `physical_night` looks retain their defaults. Any affected approved golden discovered by a run still requires its own proposal.

Until the check reconciliation is approved, the original failing qualification remains required and the issue cannot be closed. Until a real taste call and qualified timing run exist, those criteria remain INCONCLUSIVE.
