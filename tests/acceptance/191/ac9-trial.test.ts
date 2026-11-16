// Criterion 9: a trial of B against a build with A, the canvas interfaces task's test implementations of test.sim@1
// (#185), replays two test.sim@1 corpus documents, the interface's parity fixtures and two recorded input tracks of 1,200
// steps, and reports each as equal or within tolerance; a planted B that adds one unit to one value at step 300 makes the
// trial report that track as differing, naming the item, step 300 and the field; neither trial switches the build; and
// after one decision to switch, the goldens the switch changes move once, each naming that decision as its cause.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  A, AC, B, SIM, SIM_ITEM, TIMEOUT, TRACK_STEPS, arr, caught, isObject, none, num, obj, prebuildShow, scenario, show, showBin,
  showRun, simBoard, str, trackCall, type JsonObject, type JsonValue, type ShowBuild,
} from './helpers.ts';

prebuildShow(['inUse', 'candidate', 'plantedB']);

interface Setup { evidence: string; corpus: string; store: string; tracks: string[] }
/** On the build in use (A): two test.sim@1 corpus documents and two recorded input tracks of 1,200 steps. */
function setUp(evidence: string): Setup {
  const corpus = join(evidence, 'corpus');
  const store = join(evidence, 'tracks');
  const steady = simBoard('Trial steady', 2.5);
  const { replies } = showRun(showBin('inUse'), scenario(evidence, [
    { call: 'corpus_record', corpus, name: 'steady', document: steady, times: ['0s', '1s'] },
    { call: 'corpus_record', corpus, name: 'raised', document: simBoard('Trial raised', 9.75), times: ['0s', '1s'] },
    trackCall(store, steady, [[0, 1.25], [300, 4.5], [900, 0.5]]),
    trackCall(store, steady, [[0, 6], [600, 12.25]]),
  ]));
  replies.slice(0, 2).forEach((r, i) => expect(typeof r['file'], `corpus_record ${i} wrote its file: ${show(r)}`).toBe('string'));
  const tracks = replies.slice(2).map((r, i) => {
    expect(r['steps'], `track_record ${i} recorded ${TRACK_STEPS} steps: ${show(r)}`).toBe(TRACK_STEPS);
    return str(r['track'], `track_record ${i}: track`);
  });
  expect(new Set(tracks).size, 'two different tracks').toBe(2);
  return { evidence, corpus, store, tracks };
}
const trialCall = (s: Setup, candidate: ShowBuild): JsonObject => ({ call: 'trial', candidate: B, build: showBin(candidate), corpus: s.corpus, store: s.store, tracks: s.tracks });

interface Entry { input: JsonObject; result: JsonValue; key: string }
function entries(reply: JsonObject, what: string): Entry[] {
  expect(reply['ok'], `${what}: the trial ran: ${show(reply)}`).toBe(true);
  return arr(reply['results'], `${what}: results`).map((v, i) => {
    const o = obj(v, `${what}: results[${i}]`);
    const input = obj(o['input'], `${what}: results[${i}].input`);
    return { input, result: o['result'] ?? null, key: JSON.stringify(input) };
  });
}
/** The inputs a trial must replay: both corpus documents, both tracks, and the interface's parity fixtures. */
function coverageFailures(list: Entry[], s: Setup): string[] {
  const out: string[] = [];
  for (const name of ['steady', 'raised']) if (!list.some((e) => e.input['corpus'] === name)) out.push(`no result for corpus document ${name}`);
  for (const t of s.tracks) if (!list.some((e) => e.input['track'] === t)) out.push(`no result for track ${t}`);
  for (const f of ['sim-small', 'sim-large']) if (!list.some((e) => e.input['fixture'] === f)) out.push(`no result for parity fixture ${f}`);
  return out;
}
/** A result read as equal, or within a fixture's tolerance naming the fixture and the tolerance. */
function cleanFailures(list: Entry[]): string[] {
  return list.flatMap((e) => {
    if (e.result === 'equal') return [];
    const w = isObject(e.result) && isObject(e.result['within']) ? e.result['within'] : null;
    if (w && typeof w['fixture'] === 'string' && typeof w['tolerance'] === 'number') return [];
    return [`${e.key} reads ${show(e.result)}, neither equal nor within {fixture, tolerance}`];
  });
}
/** Every track read as differing at step 300, naming the item and a field of its value. */
function plantedFailures(list: Entry[], s: Setup): string[] {
  return s.tracks.flatMap((t) => {
    const e = list.find((x) => x.input['track'] === t);
    const d = e && isObject(e.result) && isObject(e.result['differs']) ? e.result['differs'] : null;
    if (!d) return [`track ${t} reads ${show(e?.result)}, not differs`];
    if (d['item'] !== SIM_ITEM || d['step'] !== 300 || typeof d['field'] !== 'string' || !d['field'].includes('pos')) return [`track ${t} differs at ${show(d)}, not item ${SIM_ITEM}, step 300 and its pos field`];
    return [];
  });
}
/** The build in use still chose A: the trial reply says it didn't switch, and the published plan names A. */
function inUseFailures(trial: JsonObject, schedule: JsonObject): string[] {
  const out: string[] = [];
  if (trial['switched'] !== false) out.push(`the trial reply's switched is ${show(trial['switched'])}, not false`);
  const impl = obj(obj(obj(schedule['interfaces'], 'schedule: interfaces')[SIM], `schedule: interfaces["${SIM}"]`)['implementation'], 'implementation');
  if (impl['name'] !== A) out.push(`after the trial the build's ${SIM} implementation is ${show(impl['name'])}, not ${A}`);
  return out;
}

function withEvidence(f: (s: Setup) => void): void {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-191-trial-'));
  try { f(setUp(evidence)); } finally { rmSync(evidence, { recursive: true, force: true }); }
}

describe(`${AC[9]} a trial of B against a build with A, in two replicas, and one decision to switch`, () => {
  test(`${AC[9]} B against A: two corpus documents, the parity fixtures and two 1,200-step tracks each read equal or within tolerance, and the build doesn't switch`, () => {
    withEvidence((s) => {
      const { replies: [trial, schedule] } = showRun(showBin('inUse'), scenario(s.evidence, [trialCall(s, 'candidate'), { call: 'schedule' }]));
      const list = entries(trial!, 'the trial of B');
      const replicas = arr(trial!['replicas'], 'the trial: replicas').map((r, i) => obj(r, `replicas[${i}]`)['implementation']);
      expect([...replicas].sort(), 'the trial ran a replica of the build in use (A) and one of the candidate\'s (B)').toEqual([A, B].sort());
      none([...coverageFailures(list, s), ...cleanFailures(list), ...inUseFailures(trial!, schedule!)], 'the trial of B');
    });
  }, TIMEOUT);

  test(`${AC[9]} a planted B adding one unit at step 300 reads each track as differing at item ${SIM_ITEM}, step 300 and its field, and the build doesn't switch`, () => {
    withEvidence((s) => {
      const { replies: [trial, schedule] } = showRun(showBin('inUse'), scenario(s.evidence, [trialCall(s, 'plantedB'), { call: 'schedule' }]));
      const list = entries(trial!, 'the trial of the planted B');
      none([...plantedFailures(list, s), ...inUseFailures(trial!, schedule!)], 'the trial of the planted B');
      // The comparison's planted mismatch: the clean judge rejects this trial's report.
      caught(cleanFailures(list), 'the clean trial\'s judge on the planted B');
    });
  }, TIMEOUT);

  test(`${AC[9]} one decision to switch moves each golden the switch changes once, naming that decision as its cause`, () => {
    withEvidence((s) => {
      const bin = showBin('inUse');
      const { replies: [trial] } = showRun(bin, scenario(s.evidence, [trialCall(s, 'candidate')]));
      const list = entries(trial!, 'the trial of B');
      const id = str(trial!['trial'], 'the trial\'s ID');
      const changed = list.filter((e) => e.result !== 'equal').map((e) => e.key).sort();
      const decision = { switch: { interface: SIM, to: B, trial: id } };
      const { replies: [first, second] } = showRun(bin, scenario(s.evidence, [{ call: 'decide', decision }, { call: 'decide', decision }]));
      const failures: string[] = [];
      if (first!['outcome'] !== 'decided') failures.push(`the decision to switch wasn't decided: ${show(first)}`);
      const cause = first!['decision'];
      const moved = arr(first!['moved'] ?? null, 'the decision: moved').map((m, i) => obj(m, `moved[${i}]`));
      const keys = moved.map((m) => JSON.stringify(m['input'])).sort();
      if (changed.length === 0) failures.push('the trial reported no input the switch changes, so no golden can move');
      if (JSON.stringify(keys) !== JSON.stringify(changed)) failures.push(`the decision moved ${show(keys)}, not the goldens the switch changes ${show(changed)}, each once`);
      for (const m of moved) if (m['cause'] !== cause) failures.push(`moved ${show(m['input'])} names cause ${show(m['cause'])}, not the decision ${show(cause)}`);
      const again = second!['outcome'] === 'refused' || (Array.isArray(second!['moved']) && second!['moved'].length === 0);
      if (!again) failures.push(`the same decision again moved goldens a second time: ${show(second)}`);
      none(failures, 'the decision to switch');
      expect(num(changed.length, 'changed'), 'B lands off A somewhere, so the switch changes goldens').toBeGreaterThan(0);
    });
  }, TIMEOUT);
});
