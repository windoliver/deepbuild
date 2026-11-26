// #2485's e2e hand run: the four readings' planted effects and clean twins from the blind suite's fixtures
// (tests/acceptance/2485/helpers.ts), judged by a built deep-show through `deep-show run` as an agent's verdict is,
// on machine A, then on machine B against A's verdict. Prints each requirement row: its result, what it raised (code,
// items, severity, the fix's op count), what stayed unread, and the fingerprint the row was judged under.
// Usage: node --experimental-transform-types e2e.ts <deep-show> <evidence folder>
import { spawnSync } from 'node:child_process';
import {
  MACHINE_A, MACHINE_B, boundsPair, claimId, claimOf, countPair, docId, gpuPair, overdrawPair, reqId, scenarioOf, verdict,
  type JsonObject, type Machine, type Pair,
} from '../../../tests/acceptance/2485/helpers.ts';

const [bin, evidence] = process.argv.slice(2);
if (!bin || !evidence) throw Error('usage: e2e.ts <deep-show> <evidence folder>');

interface Case { name: string; item: string; doc: JsonObject; check: JsonObject }
const planted = (p: Pair): Case => ({ name: `${p.name} (planted)`, item: p.item, doc: p.planted, check: p.plantedCheck });
const twin = (p: Pair): Case => ({ name: `${p.name}: its twin`, item: p.item, doc: p.twin, check: p.twinCheck });

function judged(cases: Case[], machine: Machine, against?: JsonObject[]): JsonObject[] {
  const docs = Object.fromEntries(cases.map((c, i) => [docId(i + 1), c.doc]));
  const claims = Object.fromEntries(cases.map((c, i) => [claimId(i + 1), claimOf(docId(i + 1), reqId(i + 1), c.check)]));
  const calls = cases.map((_, i) => verdict(claimId(i + 1), against?.[i]));
  const t0 = Date.now();
  const r = spawnSync(bin!, ['run'], { input: `${JSON.stringify(scenarioOf(evidence!, docs, claims, calls, machine))}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  const answer = JSON.parse(r.stdout.trim().split('\n')[0]!) as JsonObject;
  console.log(`  deep-show run: exit ${r.status}, ok ${answer['ok']}, ${cases.length} verdicts in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (r.status !== 0 || answer['ok'] !== true) { console.log(r.stderr.slice(-2000)); process.exit(1); }
  return answer['replies'] as JsonObject[];
}

function show(cases: Case[], replies: JsonObject[]): void {
  cases.forEach((c, i) => {
    const row = (replies[i]!['requirements'] as JsonObject[]).find((x) => x['id'] === reqId(i + 1))!;
    const issues = ((row['issues'] ?? []) as JsonObject[]).filter((x) => x['check'] === 'effects.audit')
      .map((x) => `${x['code']} [${(x['ids'] as string[]).join(', ')}] ${x['severity']}, fix ${Array.isArray(x['fix_ops']) ? `${(x['fix_ops'] as unknown[]).length} op(s)` : 'none'}`);
    const fp = row['fingerprint'] as JsonObject | undefined;
    const unread = ((row['results'] ?? []) as JsonObject[]).flatMap((x) => (x['unread'] ? [JSON.stringify(x['unread'])] : []));
    console.log(`  ${row['result'].toString().padEnd(12)} ${c.name.padEnd(46)} ${issues.join('; ') || 'nothing raised'}`
      + `${unread.length ? `; unread ${unread.join(' ')}` : ''}${fp ? `; fingerprint ${JSON.stringify(fp).slice(0, 60)}` : ''}`);
  });
}

const pairs = [countPair(), boundsPair(), overdrawPair(), gpuPair()];
const all = pairs.flatMap((p) => [planted(p), twin(p)]);
console.log('Machine A: each planted effect and its clean twin');
const onA = judged(all, MACHINE_A);
show(all, onA);
console.log('Machine B, against machine A\'s verdicts');
show(all, judged(all, MACHINE_B, onA));
