// AC4 #154.ee9b85a0: "A library under CC BY-SA, NC or GPL is refused at install naming its licence"
//
// asserts: in a real hub, `deep install` of a sample library's pack (README: Fixtures) is refused, exiting non-zero
// and naming the licence, for a library under CC-BY-SA-4.0, one under CC-BY-NC-4.0, one under GPL-3.0-only (the pack
// and its takes under it), and a CC0 library one of whose takes is CC-BY-NC-4.0 (Pack: "a pack whose own license or
// any asset's license is CC BY-SA, NC or GPL is refused at install, naming the license"); after each refusal a fetch
// of its take is refused, no request for it reaches the shelf and the evidence store holds none of it. The controls, a
// CC0 library and a CC-BY-4.0 one written the same way, install. The wrong program is the base, which installs them.
import { describe, expect, it } from 'vitest';
import {
  AC, CC0, CC_BY, CC_BY_NC, CC_BY_SA, GPL, TIMEOUT, addLibrary, fetchTake, openWorld, plainLibrary, proof, said, sha256, shown, stored, takePath, takesOf,
  type Lic, type Library,
} from './helpers.ts';

/** How a refusal names each licence: its SPDX ID, or the words the design uses. */
const NAMES: Record<string, RegExp> = {
  'CC-BY-SA-4.0': /CC[- ]?BY[- ]?SA/i,
  'CC-BY-NC-4.0': /CC[- ]?BY[- ]?NC|\bNC\b|non[- ]?commercial/i,
  'GPL-3.0-only': /\bGPL/i,
};

describe(`${AC[4]} a library under CC BY-SA, NC or GPL is refused at install`, () => {
  it(`${AC[4]} libraries under CC-BY-SA-4.0, CC-BY-NC-4.0 and GPL-3.0-only, and one with a CC-BY-NC-4.0 take, are refused at install naming the licence; CC0 and CC-BY-4.0 install`, async () => {
    const w = await openWorld();
    const controls: Library[] = [plainLibrary('test/free-keys', CC0), plainLibrary('test/credit-keys', CC_BY)];
    const forbidden: { lib: Library; licence: Lic }[] = [
      { lib: plainLibrary('test/sa-keys', CC_BY_SA), licence: CC_BY_SA },
      { lib: plainLibrary('test/nc-keys', CC_BY_NC), licence: CC_BY_NC },
      { lib: plainLibrary('test/gpl-keys', GPL), licence: GPL },
      { lib: plainLibrary('test/mixed-keys', CC0, 3, 'main', (k) => (k === 1 ? CC_BY_NC : undefined)), licence: CC_BY_NC },
    ];
    const results: Record<string, unknown> = {};
    for (const lib of controls) {
      const ran = await addLibrary(w, lib);
      results[lib.id] = { code: ran.code };
      expect(ran.code, `the control ${lib.id} under ${lib.license.id} installs: ${shown(ran)}`).toBe(0);
    }
    for (const { lib, licence } of forbidden) {
      const from = w.shelves['main']!.log.length;
      const ran = await addLibrary(w, lib);
      const fetches = [];
      for (const t of takesOf(lib)) fetches.push({ take: t.path, reply: (await fetchTake(w, lib, t)).value, stored: (await stored(w, sha256(t.bytes))) !== undefined });
      const requests = w.shelves['main']!.log.slice(from).filter((q) => takesOf(lib).some((t) => q.path === takePath(lib, t)));
      results[lib.id] = { code: ran.code, said: said(ran).slice(-1200), fetches, requests };
      expect(ran.code, `${lib.id} (${licence.id}) is refused at install: ${shown(ran)}`).not.toBe(0);
      expect(NAMES[licence.id]!.test(said(ran)), `the refusal of ${lib.id} names its licence ${licence.id}: ${shown(ran)}`).toBe(true);
      expect(fetches.every((f) => f.reply?.status !== 'fetched' && !f.stored), `no take of ${lib.id} is fetched or stored after the refusal: ${JSON.stringify(fetches).slice(0, 800)}`).toBe(true);
      expect(requests, `no request for a take of ${lib.id} reaches the shelf`).toEqual([]);
    }
    proof('ac4-licences.json', results);
  }, TIMEOUT);
});
