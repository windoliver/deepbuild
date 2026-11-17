// Criterion 9: a test backend whose caps() list no character controller reads excluded_by_caps on the four character
// fixtures and passes the rest; and a planted kit report that counts an excluded fixture as passed is refused, naming
// the fixture.
//
// The test backend is `--backend no_character_controller`; the four are `character/slope`, `character/step`,
// `character/snap` and `character/jump`, which pass on Rapier (the test build). The judge is the kit's caps rule read
// from its report: a fixture naming a cap its backend's caps() lack reads excluded_by_caps, never pass, and a report
// that reads otherwise is refused, naming the fixture. The planted kit is `--planted kit_passes_excluded`.
import { describe, expect, test } from 'vitest';
import {
  AC, CHARACTER_CAP, CHARACTER_FIXTURES, KIT, TIMEOUT, capsOf, caught, kitReport, named, none, physics, prebuild, resultOf,
  type KitReport,
} from './helpers.ts';

prebuild(['test']);
const BACKEND = 'no_character_controller';

/** The caps rule over a report: refused, naming the fixture, wherever a fixture naming a missing cap reads other than excluded_by_caps. */
function capsFailures(k: KitReport, caps: string[]): string[] {
  const out: string[] = [];
  for (const r of k.results) {
    const missing = r.caps.filter((c) => !caps.includes(c));
    if (missing.length && r.result !== 'excluded_by_caps') out.push(`refused: ${r.fixture} names ${missing.join(', ')}, which ${k.backend}'s caps() lack, yet reads ${r.result}`);
    if (!missing.length && r.result !== 'pass') out.push(`${r.fixture} reads ${r.result} on ${k.backend}, whose caps hold every cap it names: ${r.what}`);
  }
  for (const f of CHARACTER_FIXTURES) {
    const r = k.results.find((x) => x.fixture === f);
    if (!r) out.push(`the report holds no ${f}`);
    else if (!r.caps.includes(CHARACTER_CAP)) out.push(`${f} doesn't name ${CHARACTER_CAP} in its caps: ${r.caps.join(', ')}`);
  }
  return out;
}

describe(`${AC[9]} a backend without a character controller reads excluded_by_caps on the character fixtures`, () => {
  test(`${AC[9]} on ${BACKEND} the four character fixtures read excluded_by_caps and every other passes; on Rapier they pass`, () => {
    const [rapier] = physics([KIT], { build: 'test' });
    const onRapier = kitReport(rapier!, 'the kit on Rapier (test build)');
    for (const f of CHARACTER_FIXTURES) expect(resultOf(onRapier, f, 'Rapier').result, `${f} passes on Rapier`).toBe('pass');
    const [info, kit] = physics([{ call: 'backend' }, KIT], { backend: BACKEND });
    const caps = capsOf(info!, BACKEND);
    expect(caps, `${BACKEND}'s caps() list no character controller`).not.toContain(CHARACTER_CAP);
    const k = kitReport(kit!, `the kit on ${BACKEND}`);
    none(capsFailures(k, caps), `${BACKEND}'s report`);
    for (const f of CHARACTER_FIXTURES) expect(resultOf(k, f, BACKEND).result, `${f} on ${BACKEND}`).toBe('excluded_by_caps');
    expect(k.verdict, `${BACKEND}'s verdict (an excluded fixture is neither a pass nor a fail)`).toBe('pass');
  }, TIMEOUT);

  test(`${AC[9]} a planted kit report counting an excluded fixture as passed (--planted kit_passes_excluded) is refused, naming the fixture`, () => {
    const [info, kit] = physics([{ call: 'backend' }, KIT], { backend: BACKEND, planted: 'kit_passes_excluded' });
    const k = kitReport(kit!, `the planted kit on ${BACKEND}`);
    const failures = capsFailures(k, capsOf(info!, BACKEND));
    caught(failures, 'the report that counts an excluded fixture as passed');
    const counted = k.results.find((r) => r.caps.includes(CHARACTER_CAP) && r.result === 'pass');
    expect(counted, 'the planted report counts a character fixture as passed').toBeDefined();
    named(failures, ['refused', counted!.fixture], 'the refusal');
  }, TIMEOUT);
});
