import { describe, it } from 'vitest';
import {
  MACHINE_A, MACHINE_B, TIMEOUT, brief, claimId, claimOf, countPair, boundsPair, docId, errorsOf, faultsOf, gpuGate, gpuPair, holds,
  none, overdrawPair, passFailures, caughtFailures, reqId, requireMetal, rowOf, run, same, scenarioOf, useBuild, useFolders, verdict,
  type JsonObject, type JsonValue, type Pair, type Row,
} from './helpers.ts';

const FAULTS = '#2485.7e5188e4';
const MACHINES = '#2485.dac550b5';
const bin = useBuild();
const folder = useFolders();

interface Case { name: string; item: string; doc: JsonObject; check: JsonObject }
const planted = (p: Pair): Case => ({ name: `${p.name} (planted)`, item: p.item, doc: p.planted, check: p.plantedCheck });
const twin = (p: Pair): Case => ({ name: `${p.name}: its clean twin`, item: p.item, doc: p.twin, check: p.twinCheck });

function judged(cases: readonly Case[], evidence: string, on: string, machine?: { os: string; driver: string }, against?: readonly JsonObject[]): { rows: Row[]; replies: JsonObject[] } {
  const docs = Object.fromEntries(cases.map((c, i) => [docId(i + 1), c.doc]));
  const claims = Object.fromEntries(cases.map((c, i) => [claimId(i + 1), claimOf(docId(i + 1), reqId(i + 1), c.check)]));
  const calls = cases.map((_, i) => verdict(claimId(i + 1), against?.[i]));
  const replies = run(bin(), scenarioOf(evidence, docs, claims, calls, machine));
  return { rows: cases.map((c, i) => rowOf(replies[i]!, reqId(i + 1), `${c.name} on ${on}`)), replies };
}

function faultAndTwin(p: Pair): void {
  requireMetal(p.name);
  const { rows: [fault, clean] } = judged([planted(p), twin(p)], folder(), 'this machine');
  gpuGate(fault!, p.name);
  gpuGate(clean!, `${p.name}: its clean twin`);
  none([
    ...caughtFailures(fault!, p.item, p.planted, `effects.audit on ${p.name}`),
    ...passFailures(clean!, `effects.audit on ${p.name}'s clean twin`),
  ], `${p.name} fails effects.audit with its code, the item's ID and a fix as patch ops, and its clean twin passes`);
}

describe(`${FAULTS} each of effects.audit's four readings fails its planted effect, naming it with a fix as patch ops, and passes its clean twin`, () => {
  it(`${FAULTS} an effect over its peak count fails effects.audit with its code, the item's ID and a fix as patch ops, and its clean twin passes`, () => {
    faultAndTwin(countPair());
  }, TIMEOUT);

  it(`${FAULTS} an effect leaving its declared box fails effects.audit with its code, the item's ID and a fix as patch ops, and its clean twin passes`, () => {
    faultAndTwin(boundsPair());
  }, TIMEOUT);

  it(`${FAULTS} an effect over overdraw 8 fails effects.audit with its code, the item's ID and a fix as patch ops, and its clean twin passes`, () => {
    faultAndTwin(overdrawPair());
  }, TIMEOUT);

  it(`${FAULTS} an effect over its declared GPU time fails effects.audit with its code, the item's ID and a fix as patch ops, and its clean twin passes`, () => {
    faultAndTwin(gpuPair());
  }, TIMEOUT);
});

describe(`${MACHINES} counts and bounds agree on every machine; overdraw and GPU time hold on one machine and are INCONCLUSIVE on another`, () => {
  it(`${MACHINES} the peak count and the bounds give the same results on machine B as on machine A`, () => {
    requireMetal('effects.audit');
    const evidence = folder();
    const cases = [planted(countPair()), planted(boundsPair()), twin(countPair()), twin(boundsPair())];
    const isPlanted = (i: number): boolean => i < 2;

    const onA = judged(cases, evidence, 'machine A', MACHINE_A);
    onA.rows.forEach((r, i) => gpuGate(r, `${cases[i]!.name} on machine A`));
    none(cases.flatMap((c, i) => (isPlanted(i)
      ? caughtFailures(onA.rows[i]!, c.item, c.doc, `${c.name} on machine A`)
      : passFailures(onA.rows[i]!, `${c.name} on machine A`))), 'on machine A each planted effect is caught and each twin passes');

    const onB = judged(cases, evidence, 'machine B, against A', MACHINE_B, onA.replies);
    const across: string[] = [];
    cases.forEach((c, i) => {
      const [r, was] = [onB.rows[i]!, onA.rows[i]!];
      if (isPlanted(i) && r.result !== 'FAIL') across.push(`${c.name} on machine B is ${r.result}, where A's was FAIL: ${brief(r.raw, 800)}`);
      if (!isPlanted(i) && r.result === 'FAIL') across.push(`${c.name} on machine B is FAIL, where A's was ${was.result}: ${brief(r.raw, 800)}`);
      if (!same(errorsOf(r), errorsOf(was))) across.push(`${c.name} on machine B raises the errors ${brief(errorsOf(r), 800)}, where A raised ${brief(errorsOf(was), 800)}`);
    });
    none(across, 'on machine B, judged against A\'s verdict, the peak count and the bounds give A\'s results');
  }, TIMEOUT);

  it(`${MACHINES} overdraw and GPU time hold on machine A and report INCONCLUSIVE on machine B, naming both fingerprints`, () => {
    requireMetal('effects.audit');
    const evidence = folder();
    const cases = [planted(overdrawPair()), planted(gpuPair())];

    const onA = judged(cases, evidence, 'machine A', MACHINE_A);
    onA.rows.forEach((r, i) => gpuGate(r, `${cases[i]!.name} on machine A`));
    const decided: string[] = cases.flatMap((c, i) => caughtFailures(onA.rows[i]!, c.item, c.doc, `${c.name} on machine A`));
    cases.forEach((c, i) => {
      const fp = onA.rows[i]!.raw['fingerprint'];
      if (fp === undefined || fp === null) decided.push(`${c.name} on machine A carries no fingerprint: ${brief(onA.rows[i]!.raw, 800)}`);
    });
    none(decided, 'on machine A each planted effect is caught, and each row names the fingerprint it was measured under');
    const fingerprint = (i: number): JsonValue => onA.rows[i]!.raw['fingerprint']!;

    const again = judged(cases, evidence, 'machine A again, against A', MACHINE_A, onA.replies);
    const held: string[] = [];
    cases.forEach((c, i) => {
      const [r, was] = [again.rows[i]!, onA.rows[i]!];
      if (r.result !== 'FAIL') held.push(`${c.name} on machine A again is ${r.result}, where A's own verdict was FAIL: ${brief(r.raw, 800)}`);
      if (!same(faultsOf(r) as JsonValue, faultsOf(was) as JsonValue)) held.push(`${c.name} on machine A again raises ${faultsOf(r).join('; ') || 'nothing'}, where A raised ${faultsOf(was).join('; ')}`);
      if (!same(r.raw['fingerprint'], fingerprint(i))) held.push(`${c.name} on machine A again names the fingerprint ${brief(r.raw['fingerprint'])}, not A's ${brief(fingerprint(i))}`);
    });
    none(held, 'on machine A, judged against its own verdict, overdraw and GPU time hold');

    const onB = judged(cases, evidence, 'machine B, against A', MACHINE_B, onA.replies);
    const across: string[] = [];
    cases.forEach((c, i) => {
      const r = onB.rows[i]!;
      if (r.result !== 'INCONCLUSIVE') across.push(`${c.name} on machine B is ${r.result}, not INCONCLUSIVE: ${brief(r.raw, 800)}`);
      const own = r.raw['fingerprint'];
      if (own === undefined || own === null || same(own, fingerprint(i))) across.push(`${c.name} on machine B names the fingerprint ${brief(own)}, which isn't another than A's ${brief(fingerprint(i))}`);
      if (!holds(r.raw, fingerprint(i))) across.push(`${c.name} on machine B doesn't name A's fingerprint ${brief(fingerprint(i))}: ${brief(r.raw, 800)}`);
    });
    none(across, 'on machine B, judged against A\'s verdict, overdraw and GPU time are INCONCLUSIVE, naming both fingerprints');
  }, TIMEOUT);
});
