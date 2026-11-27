// AC6 #3233.58c6f0e7: the extension guide's table lists eight planted fills for the slot, and the guide's own drift
// check passes.
//
// The table is docs/extension-guide.md's Slots table, read as the file holds it; the slot's row is the one for
// `deep.registerView` and `panel@1`. The eight are the five the row has at the base and the kit's three, by the names
// the kit gives the fills that raise `no_name`, `low_contrast` and `pointer_only` (the conformance package's public
// entry). The drift check is the guide's own script, `node scripts/guide.mjs --check`. Nothing is built.
import { describe, expect, it } from 'vitest';
import { AC6, conformance, guideCheck, PANEL, readGuide } from './helpers.ts';
import { guidePlanted, guideRowProblems, NEW_RULES } from './judges.ts';

describe(`AC6 ${AC6} the guide's row for the slot lists the three planted fills with the five it has`, () => {
  it(`AC6 ${AC6} the extension guide's table lists eight planted fills for the slot: the five it had and the kit's three`, async () => {
    const { slotKits } = await conformance();
    const kit = slotKits().find((k) => k.slot === PANEL);
    expect(kit, `the conformance package ships ${PANEL}'s kit`).toBeDefined();
    const problems: string[] = [];
    const three: string[] = [];
    for (const { name, code } of NEW_RULES) {
      const plant = kit!.planted.find((p) => p.codes.includes(code));
      if (plant) three.push(plant.name);
      else problems.push(`the kit plants no fill that raises ${code}, for "${name}", so the row has no name to list for it`);
    }
    problems.push(...guideRowProblems(guidePlanted(readGuide(), 'deep.registerView', PANEL), three));
    expect(problems).toEqual([]);
  });

  it(`AC6 ${AC6} the guide's own drift check passes (it does at the base too: a row edited by hand, off the contract, fails it)`, () => {
    const ran = guideCheck();
    const said = `${ran.stdout}\n${ran.stderr}`;
    expect(said.split('\n').filter((line) => /^FAIL guide/.test(line)), said).toEqual([]);
    expect(ran.code, said).toBe(0);
    expect(ran.stdout, said).toMatch(/^PASS guide/m);
  }, 10 * 60_000);
});
