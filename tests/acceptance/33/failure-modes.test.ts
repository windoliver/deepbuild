// #33 AC9: with the hub killed mid-run the check is INCONCLUSIVE (stopped); on a full disk the gate turns watch-only
// with a BLOCKED reason; with the environment missing the journey is BLOCKED (missing); with an expired token the check
// is BLOCKED naming the credential and you. An engine that returns FAIL for any of them fails this test.
//
// Each mode is a corpus case the kit plays, its world's fault made by the case's `setup` (README, The corpus; the
// kit's to define): `mode:hub-killed`, `mode:disk-full`, `mode:env-missing`, `mode:token-expired`. The test reads
// each case's expectation as the criterion states it (INCONCLUSIVE naming `stopped`; BLOCKED naming `watch-only`;
// BLOCKED naming `missing`, on a journey check; BLOCKED naming `you` and a credential the base's environment loads),
// runs the kit on the four, and requires each claim's line to hold those words. Each twin, the same claim with no
// fault, PASSes. The wrong program `failures-as-fail` (DEEP_HUB_PLANT) is an engine that returns FAIL for each: the
// kit fails on it, naming each case.
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, it } from 'vitest';
import { AC9, CORPUS, MODES, caseFor, cleanup, expectedOf, kit, kitCaught, kitPassed, must, readManifest, treeOf, type Case } from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'failures-as-fail';
type Spec = { checks?: Record<string, { type?: string }>; environment?: { credentials?: Record<string, unknown> } };
const specOf = (c: Case): Spec => (parseYaml(treeOf(CORPUS, c, 'base').get('.deepbuild/done.yaml') ?? '') ?? {}) as Spec;

/** The four cases, each checked against the criterion's words; returns them by tag. */
function modeCases(): Map<string, Case> {
  const m = readManifest();
  const out = new Map<string, Case>();
  for (const [tag, outcome] of Object.entries(MODES)) {
    const c = caseFor(m, tag, AC9);
    must(expectedOf(c.claim).join() === outcome, `${AC9} ${c.id} (${tag}) expects ${outcome}, as the criterion states: ${JSON.stringify(c.claim.expected)}`);
    must(expectedOf(c.twin).join() === 'PASS', `${AC9} ${c.id}'s twin, the same claim with no fault, expects PASS: ${JSON.stringify(c.twin.expected)}`);
    out.set(tag, c);
  }
  const names = (tag: string) => out.get(tag)!.claim.names ?? [];
  must(names('mode:hub-killed').includes('stopped'), `${AC9} the hub-killed case names stopped: ${JSON.stringify(names('mode:hub-killed'))}`);
  must(names('mode:disk-full').includes('watch-only'), `${AC9} the full-disk case names watch-only: ${JSON.stringify(names('mode:disk-full'))}`);
  must(names('mode:env-missing').includes('missing'), `${AC9} the missing-environment case names missing: ${JSON.stringify(names('mode:env-missing'))}`);
  const journeys = Object.values(specOf(out.get('mode:env-missing')!).checks ?? {}).filter((c) => c.type === 'journey');
  must(journeys.length > 0, `${AC9} the missing-environment case's base spec holds a journey check: ${JSON.stringify(specOf(out.get('mode:env-missing')!).checks)}`);
  const credentials = Object.keys(specOf(out.get('mode:token-expired')!).environment?.credentials ?? {});
  must(names('mode:token-expired').includes('you') && credentials.some((v) => names('mode:token-expired').includes(v)), `${AC9} the expired-token case names you and the credential its base environment loads (${credentials.join(', ') || 'none'}): ${JSON.stringify(names('mode:token-expired'))}`);
  return out;
}

describe(`${AC9} a killed hub, a full disk, a missing environment and an expired token never read as FAIL`, () => {
  it(`${AC9} the kit plays the four: INCONCLUSIVE (stopped), BLOCKED (watch-only), BLOCKED (missing), BLOCKED (the credential, you); each twin PASSes`, async () => {
    const cases = modeCases();
    const ids = [...cases.values()].map((c) => c.id);
    const k = await kit(['run', ...ids.flatMap((id) => ['--case', id])]);
    kitPassed(AC9, k, ids);
    for (const c of cases.values()) {
      const line = k.lines.find((l) => l.id === c.id && l.play === 'claim')!;
      for (const name of c.claim.names ?? []) must(line.reasons.includes(name), `${AC9} ${c.id}'s verdict names ${name}: ${line.raw}`);
    }
  }, 3_600_000);

  it(`${AC9} (wrong program) an engine that returns FAIL for them (DEEP_HUB_PLANT=${PLANT}) fails the kit, naming each case`, async () => {
    const cases = modeCases();
    const ids = [...cases.values()].map((c) => c.id);
    const k = await kit(['run', ...ids.flatMap((id) => ['--case', id])], { plant: PLANT });
    for (const id of ids) kitCaught(AC9, k, id, 'FAIL');
  }, 3_600_000);
});
