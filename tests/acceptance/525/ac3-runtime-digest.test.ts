// #525.105c2755: "A golden recorded on a build with B 1.0.0 and run on a build with B 1.0.1 is BLOCKED before any step,
// naming test.sim@1, both versions and both runtime digests, never compared and never PASS, while on a build with B 1.0.0
// it compares and passes; and an export's receipt names the build's runtime digest, so a planted receipt writer that
// leaves it out fails, naming the field"
//
// B is #185's measured implementation `test.sim.b` of `test.sim@1`, with backend_bytes state; #1920's builds put it at
// 1.0.0 (`core,test-sim-b`) and 1.0.1 (`core,test-sim-b-1-0-1`, nothing else changed), and each build publishes its
// runtime digest with its sealed plan (`schedule.runtime_digest`). The expected digests are those two published values.
//
// 1. The golden (README: The golden): a board of one test.sim@1 item, presented by an agent's session, recorded for 8
//    steps on B 1.0.0; its `runtime_digest` is that build's. Run on B 1.0.1 it is BLOCKED with no step run and no report,
//    naming test.sim@1, 1.0.0 and 1.0.1 and both digests; a copy with step 2's hash changed is BLOCKED the same way, so
//    nothing was compared. Run on another process of B 1.0.0 it PASSes, all 8 steps run, and the changed copy FAILs at
//    step 2, so it compares. Wrong program (the criterion names none for the golden): `golden_compares_across_digests`,
//    a verifier that compares under another runtime digest and so passes B 1.0.1's equal answers.
// 2. The receipt: a 12-frame film exported as a png_seq on the full build names, in `receipt.runtime_digest`, the
//    digest that build publishes. The criterion's planted receipt writer, `receipt_omits_runtime_digest`, leaves it out,
//    and the same check fails, naming `runtime_digest`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC_ID, TIMEOUT, arr, docScenario, failsNaming, isObject, none, obj, present, presented, receiptFilm,
  runShow, runtimeDigestOf, show, simBoard, str, useBuilds, useTemp, verifiedOf, type JsonObject, type JsonValue, type Verified,
} from './helpers.ts';

const ID = CRITERIA[3];
const bin = useBuilds(['core,test-sim-b', 'core,test-sim-b-1-0-1', 'full']);
const temp = useTemp();

const STEPS = 8;
const CHANGED = 2;
const SIM = 'test.sim@1';
/** `golden_record`, not `golden`: #138's kit already answers a `golden` call (a fixture's golden digests). */
const golden = (steps: number): JsonObject => ({ call: 'golden_record', doc: DOC_ID, steps });
const verify = (g: JsonObject): JsonObject => ({ call: 'golden_verify', doc: DOC_ID, golden: g });

/** The golden run on B 1.0.1: BLOCKED before any step, never compared, naming the interface, both versions and both digests. */
function blockedFailures(v: Verified, d100: string, d101: string, what: string): string[] {
  const f: string[] = [];
  if (v.verdict !== 'BLOCKED') f.push(`${what}: the verdict is ${v.verdict}, not BLOCKED (a golden is never compared under another runtime digest)`);
  if (v.steps_run !== 0) f.push(`${what}: ${v.steps_run} steps ran, though it is BLOCKED before any step`);
  if (v.report !== null) f.push(`${what}: a comparison report ${show(v.report)} was made, though it is never compared`);
  const want: JsonObject = { interface: SIM, versions: ['1.0.0', '1.0.1'], runtime_digests: [d100, d101] };
  for (const [k, value] of Object.entries(want)) {
    if (JSON.stringify(v.blocked?.[k]) !== JSON.stringify(value)) f.push(`${what}: blocked.${k} is ${show(v.blocked?.[k])}, not ${JSON.stringify(value)} (blocked: ${show(v.blocked)})`);
  }
  for (const name of [SIM, '1.0.0', '1.0.1', d100, d101]) if (!v.reason.includes(name)) f.push(`${what}: the reason doesn't name ${name}: "${v.reason}"`);
  return f;
}

describe(`${ID} the runtime digest keeps goldens and receipts of two backends apart`, () => {
  it(`${ID} a golden of test.sim@1 recorded on B 1.0.0 is BLOCKED on B 1.0.1 before any step, naming test.sim@1, 1.0.0, 1.0.1 and both runtime digests, never compared; on B 1.0.0 it compares and passes; a planted verifier that compares across digests fails, naming the verdict`, () => {
    const [b100, b101] = [bin('core,test-sim-b'), bin('core,test-sim-b-1-0-1')];
    const board = simBoard();

    const rec = 'B 1.0.0 (core,test-sim-b), recording';
    const [r0, r1, r2] = runShow(b100, docScenario(temp('ev'), [present(board), golden(STEPS), { call: 'schedule' }]), rec);
    presented(r0, rec);
    const d100 = runtimeDigestOf(r2, rec);
    const g = obj(obj(r1, rec)['golden'], `${rec}: golden`);
    expect(str(g['runtime_digest'], `${rec}: golden.runtime_digest`), `${rec}: the golden records the build's runtime digest`).toBe(d100);
    const hashes = arr(g['step_hashes'], `${rec}: golden.step_hashes`).map((h, i) => str(h, `${rec}: golden.step_hashes[${i}]`));
    expect(hashes.length, `${rec}: one step hash a step`).toBe(STEPS);
    // The same golden with step 2's hash changed in its last character (a recorded value tampered with, for the comparison to find).
    const h2 = hashes[CHANGED]!;
    const changed: JsonObject = { ...g, step_hashes: hashes.map((h, i) => (i === CHANGED ? `${h2.slice(0, -1)}${h2.endsWith('0') ? '1' : '0'}` : h)) };

    const run101 = (planted?: string): { v: Verified; vc: Verified; d101: string } => {
      const what = `B 1.0.1 (core,test-sim-b-1-0-1)${planted ? `, planted ${planted}` : ''}`;
      const [p, v, vc, sch] = runShow(b101, docScenario(temp('ev'), [present(board), verify(g), verify(changed), { call: 'schedule' }]), what, planted);
      presented(p, what);
      return { v: verifiedOf(v, `${what}: the golden`), vc: verifiedOf(vc, `${what}: the changed golden`), d101: runtimeDigestOf(sch, what) };
    };
    const { v, vc, d101 } = run101();
    expect(d101, 'B 1.0.1\'s runtime digest differs from B 1.0.0\'s (#1920)').not.toBe(d100);
    const f = [...blockedFailures(v, d100, d101, 'the golden on B 1.0.1'), ...blockedFailures(vc, d100, d101, 'the changed golden on B 1.0.1')];

    const again = 'B 1.0.0 (core,test-sim-b), a second process';
    const [q, pass, fail] = runShow(b100, docScenario(temp('ev'), [present(board), verify(g), verify(changed)]), again);
    presented(q, again);
    const ok = verifiedOf(pass, `${again}: the golden`);
    if (ok.verdict !== 'PASS' || ok.steps_run !== STEPS || ok.blocked !== null) f.push(`${again}: the golden reads ${ok.verdict} after ${ok.steps_run} steps (blocked ${show(ok.blocked)}), not PASS after all ${STEPS}`);
    const bad = verifiedOf(fail, `${again}: the changed golden`);
    const first = isObject(bad.report as JsonValue) ? bad.report!['first_step'] : undefined;
    if (bad.verdict !== 'FAIL' || first !== CHANGED) f.push(`${again}: the changed golden reads ${bad.verdict} with report ${show(bad.report)}, not FAIL at first_step ${CHANGED}: it isn't compared`);
    none(f, 'BLOCKED across runtime digests, compared and passed on the same one');

    const planted = run101('golden_compares_across_digests');
    failsNaming(blockedFailures(planted.v, d100, planted.d101, 'the golden on B 1.0.1 (planted)'), /the verdict is \w+, not BLOCKED/, 'golden_compares_across_digests');
  }, TIMEOUT);

  it(`${ID} an export's receipt names the runtime digest the build publishes; a planted receipt writer that leaves it out fails, naming runtime_digest`, () => {
    const full = bin('full');
    const receipt = (planted?: string): string[] => {
      const what = `the film exported on the full build${planted ? ` (planted ${planted})` : ''}`;
      const out = join(temp('out'), 'frames');
      const [p, ex, sch] = runShow(full, docScenario(temp('ev'), [present(receiptFilm()), { call: 'export', doc: DOC_ID, out, video: { codec: 'png_seq' } }, { call: 'schedule' }]), what, planted);
      presented(p, what);
      const digest = runtimeDigestOf(sch, what);
      if (ex!['outcome'] !== 'exported') return [`${what}: the export was not delivered: ${show(ex)}`];
      const r = obj(ex!['receipt'], `${what}: receipt`);
      if (!('runtime_digest' in r)) return [`${what}: the receipt has no field runtime_digest (Registry and seal: runtime digest, "an export's receipt names it")`];
      return r['runtime_digest'] === digest ? [] : [`${what}: receipt.runtime_digest is ${show(r['runtime_digest'])}, not the build's runtime digest ${digest}`];
    };
    none(receipt(), 'the receipt names the build\'s runtime digest');
    failsNaming(receipt('receipt_omits_runtime_digest'), /runtime_digest/, 'receipt_omits_runtime_digest');
  }, TIMEOUT);
});
