// AC2: "A patch whose path is `at/pos` is refused with a fix that names `items/<id>/at/pos`, and a bare op list is
// refused with a fix that names the envelope fields." Proof: "The refusal fixtures with their planted twins."
//
// asserts: the gallery's product reveal (read through deep_kinds) is stored as shared document DOC at revision 0, and
// you send it, through `deep-show run`, one op moving its text item `name` (`set`, value [400, 140, 0]) three ways, each
// to a fresh copy: in its envelope with path `items/name/at/pos` (the control: it applies, so the fixtures are refused
// for their path and their shape alone); in its envelope with path `at/pos`, which must be refused with a fix that names
// `items/name/at/pos` (or `items/<id>/at/pos` as the issue writes it); and as a bare op list, which must be refused with
// a fix that names every field of the envelope: patch, doc, base, reason and ops. Each fixture's planted twin fails its
// check: `patch_fix_path_without_id` (the fix names items/at/pos) naming items/name/at/pos, and
// `patch_fix_envelope_without_reason` (the fix leaves reason out) naming reason.

import { describe, expect, it } from 'vitest';
import {
  FULL_PATH, PLANTS, envelope, envelopeFailures, failsNaming, fullPathFailures, moveOp, none, outcomeOf, productReveal, sendEach, useCleanup,
  useFullBuild, type JsonObject,
} from './helpers.ts';

const bin = useFullBuild();
useCleanup();

/** The control: the op with its full path, in its envelope, applies to the product reveal. */
function control(reply: JsonObject): void {
  expect(reply['outcome'], `the control, the same op with path ${FULL_PATH} in its envelope, applies: ${outcomeOf({ reply })}`).toBe('applied');
}

describe('AC2 the two refusals the dry run hit name the full path and the envelope fields', () => {
  it(`AC2 a patch whose path is at/pos is refused with a fix that names ${FULL_PATH}`, () => {
    const b = bin();
    const { document } = productReveal(b);
    const [ok, atPos] = sendEach(b, document, [envelope(FULL_PATH), envelope('at/pos')]);
    control(ok!);
    none(fullPathFailures(atPos!), 'the patch whose path is at/pos');
  }, 3_600_000);

  it(`AC2 its planted twin ${PLANTS.pathFixWithoutId} fails, naming ${FULL_PATH}`, () => {
    const b = bin();
    const { document } = productReveal(b);
    const [ok, atPos] = sendEach(b, document, [envelope(FULL_PATH), envelope('at/pos')], PLANTS.pathFixWithoutId);
    control(ok!);
    failsNaming(fullPathFailures(atPos!), [`no fix names ${FULL_PATH}`], `the planted twin ${PLANTS.pathFixWithoutId}`);
  }, 3_600_000);

  it('AC2 a bare op list is refused with a fix that names the envelope fields', () => {
    const b = bin();
    const { document } = productReveal(b);
    const [ok, bare] = sendEach(b, document, [envelope(FULL_PATH), [moveOp(FULL_PATH)]]);
    control(ok!);
    none(envelopeFailures(bare!), 'the bare op list');
  }, 3_600_000);

  it(`AC2 its planted twin ${PLANTS.envelopeFixWithoutReason} fails, naming reason`, () => {
    const b = bin();
    const { document } = productReveal(b);
    const [ok, bare] = sendEach(b, document, [envelope(FULL_PATH), [moveOp(FULL_PATH)]], PLANTS.envelopeFixWithoutReason);
    control(ok!);
    failsNaming(envelopeFailures(bare!), ['leaves out', 'reason'], `the planted twin ${PLANTS.envelopeFixWithoutReason}`);
  }, 3_600_000);
});
