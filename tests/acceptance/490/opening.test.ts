// Criterion 2: "Opening the eases as ease@1 leaves every content key, golden and corpus snapshot of the shipped
// fixtures byte for byte the same, and deep://registries lists ease@1 with since, digest, fill, each entry's origin
// and its kit result; a planted opening that renumbers the entries changes the key of a channel keyed with
// in_out_cubic and fails, naming the ease and the item"
//
// Through `deep-show run` in the `full` build, the planted `full,test-ease-renumbered` build (README: Test features)
// and the merge base's `full` build (exported by `git archive` and built apart, as #200's suite does). The listing
// is read first, so a build without ease@1 never reaches the merge base's build. "Shipped fixtures" are every fixture
// the merge base's `fixtures` call lists, plus this suite's board whose items are keyed with in_out_cubic, out_back,
// sigmoid(6) and smoothstep. For each, at 0, 0.5 and 1 s: every `eval` node's content key and the bytes it wrote
// ("golden", as #200 reads it), and `corpus_record`'s values and snapshots ("corpus snapshot"), byte for byte. A
// failure on a node names the item and the eases its channels' keys use. No upstream test (oracle page).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, EASES, FIXTURES, TIMEOUT, none, runShow, scenario, show, theRegistry,
  useEvidence, useShow, type PackFixture,
} from './helpers.ts';

const FULL = 'full';
const shows = useShow([FULL]);
const evidence = useEvidence();
const EPACK: PackFixture = { id: 'test/epack', version: '1.0.0', dir: join(FIXTURES, 'packs', 'epack-1.0.0') };

describe('criterion 2: opening the eases as ease@1 changes no content key, golden or corpus snapshot, and deep://registries lists it', () => {
  it('criterion 2: deep://registries lists ease@1 with since, digest and fill, each closed ease the core\'s first-party entry with its kit result, and a pack\'s ease table with origin pack', () => {
    const bin = shows.bin(FULL);
    const r = theRegistry(runShow(bin, scenario(evidence(), [{ call: 'registries' }], [EPACK]))[0]!, 'ease@1');
    expect(r.owner, 'ease@1 is declared by the core').toBe('core');
    expect(r.since, `ease@1 has its since: ${show(r.raw)}`).toMatch(/^R\d+$/);
    expect(r.digest, 'ease@1 has its digest').toMatch(DIGEST);
    expect(r.fill, 'the core fills it and packs fill it').toContain('pack');
    const failures: string[] = [];
    for (const name of EASES) {
      const e = r.entries.find((x) => x.name === name);
      if (!e) { failures.push(`ease@1 holds no entry ${name}`); continue; }
      if (e.origin !== 'first_party') failures.push(`${name}'s origin is ${e.origin}, not first_party`);
      if (e.module !== 'core') failures.push(`${name} is filled by ${e.module ?? 'nothing'}, not the core`);
      if (!/^R\d+$/.test(e.since)) failures.push(`${name} has no since: ${show(e.raw)}`);
      if (!DIGEST.test(e.digest)) failures.push(`${name} has no digest: ${show(e.raw)}`);
      if (e.kit.verdict !== 'PASS') failures.push(`${name} fails ease@1's kit: ${show(e.kit.raw)}`);
      for (const rule of r.kit) if (!e.kit.rules.some((x) => x.rule === rule.rule && x.verdict === 'PASS')) failures.push(`${name}'s kit result has no PASS for the rule ${rule.rule}`);
    }
    const dip = r.entries.find((x) => x.name === 'epack.dip');
    if (!dip) failures.push('ease@1 lists no entry epack.dip from the installed pack test/epack');
    else {
      if (dip.origin !== 'pack') failures.push(`epack.dip's origin is ${dip.origin}, not pack`);
      if (dip.kit.verdict !== 'PASS') failures.push(`epack.dip fails ease@1's kit: ${show(dip.kit.raw)}`);
    }
    if (r.planted.length === 0) failures.push('ease@1 declares no planted wrong entry');
    for (const p of r.planted) if (p.result.verdict !== 'FAIL') failures.push(`ease@1's kit admits its planted entry ${p.name}`);
    none(failures, 'the listing of ease@1');
  }, TIMEOUT);

  // The two comparisons against the merge base that stood here are replaced by
  // tests/acceptance/490-redraft-2/opening.test.ts (README: Disputes): on the base itself they
  // stopped at the first shipped fixture the base refuses, text/counter, before comparing.
});
