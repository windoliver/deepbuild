// AC1 (#1972), its applies clause: "Each example applies to the gallery's product reveal through `deep-show run`
// with outcome `applied`" (in AC1: "`deep_kinds read guide: patches` returns every op the patch schema lists, each with
// an example. Each example applies …").
//
// asserts: the guide `deep_kinds read guide: patches` serves, read to its last page, holds an example of each op the
// patch schema lists (as `deep_kinds op: field` answers `patch.<op>`, with the six ops of the patch's shape); and every
// example it holds (each patch, or single op, in a JSON code block), sent by an agent through `deep_show` as one patch
// at base 0 on its own copy of the gallery's product reveal (the bytes `deep_kinds read example` serves, stored as
// revision 0 with its items in that agent's layer), is answered with outcome `applied`. A failure names the op that
// has no example, or the example, its ops and the issues it was refused with.

import { describe, it } from 'vitest';
import { applyFailures, coverageFailures, examplesIn, guideText, none, productReveal, schemaOps, sendAll, useBuild, useCleanup } from './helpers.ts';

const bin = useBuild();
useCleanup();

describe('AC1 each example of the patches guide applies to the gallery\'s product reveal', () => {
  it('AC1 every example in deep_kinds read guide: patches applies to the product reveal through deep-show run with outcome applied', () => {
    const b = bin();
    const ops = schemaOps(b);
    const examples = examplesIn(guideText(b, 'patches'));
    const missing = coverageFailures(ops, examples);
    const refused = applyFailures(examples, sendAll(b, productReveal(b), examples));
    none([...missing, ...refused], `the patches guide's examples (${examples.length} found; ops listed: ${ops.join(', ')}), each sent on the product reveal`);
  }, 3_600_000);
});
