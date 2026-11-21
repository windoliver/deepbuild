// AC6 #280.456285f7: net.feel passes only within its bounds: the fixture under the spike profile above fails a bound of
// 500 ms of stall a minute, naming the copy, the reading and its 740 ms, and passes a bound of 1,000 ms; a net.feel
// whose profile or bounds a working agent's patch changed is refused, naming the field; and two runs from one seed give
// byte-equal readings, while a planted meter on the wall clock gives two and fails, naming the reading
//
// Bounds: net.feel through `match` on the eight-seat fixture under criterion 3's spike profile, `bounds.stall` 500 then
// 1,000 (the other two bounds open): FAIL with a failure `{copy, reading, value}` for a copy that waits on player 1, its
// reading the stall and its value 740 within one step length a spike; then PASS with no failure. The working agent's
// patch: the fixture stored with net.feel among its own checks (the envelope's `checks`, where the core reads a
// document's own check inputs), its profile and bounds yours; the working agent's `deep_show` of that document with
// `bounds.stall`, then `profile.spikes.hold`, changed (its patch to the stored revision) is each refused, an error issue
// naming the field's path, and the stored net.feel keeps your values. The repeat: two `deep-show run`s of net.feel under a profile with seeded jitter and seeded
// spikes from one seed give byte-equal readings; the planted meter `net_feel_wall_clock` gives two, and the judge fails
// naming the reading. Wrong programs it fails: the merge base (net.feel isn't a check kind); a net.feel that passes past
// its bound, or names no copy, reading or value; one that takes its profile or bounds from the working agent; one that
// times a stall on the wall clock.
import { describe, expect, it } from 'vitest';
import {
  FEEL_STEPS, LOOSE_STALL, SEEDED, SPIKED, SPIKED_STALL, STALL_TOLERANCE, TIGHT_STALL, eightDoc, feel, seededMoves,
  type JsonObject,
} from './fixtures.ts';
import {
  AC, FULL, SESSION, Script, TIMEOUT, failsNaming, isObject, none, obj, playFeel, putProgram, runShow, sameReadings, scenario, show, useBuilds, useChildren, useTemp,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const plays = seededMoves(FEEL_STEPS);
const spiked = (stall: number) => ({ document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(SPIKED, { bounds: { stall } }) });

describe(`${AC[6]} net.feel's bounds, where they come from, and its repeat`, () => {
  it(`${AC[6]} the fixture under the spike profile fails a bound of 500 ms of stall a minute, naming the copy, the reading and its 740 ms, and passes a bound of 1,000 ms`, async () => {
    const tight = await playFeel(builds.show(), temp(), 'AC6 a bound of 500 ms', spiked(TIGHT_STALL));
    const f: string[] = [];
    if (tight.report.verdict !== 'FAIL') f.push(`AC6: net.feel under a 500 ms bound reads ${tight.report.verdict}, not FAIL: ${show(tight.report.raw, 900)}`);
    const named = tight.report.failures.filter((x) => typeof x['copy'] === 'number' && x['copy'] !== 1 && typeof x['reading'] === 'string' && /stall/.test(x['reading'] as string)
      && typeof x['value'] === 'number' && Math.abs((x['value'] as number) - SPIKED_STALL) <= STALL_TOLERANCE);
    if (!named.length) f.push(`AC6: no failure names a copy that waits on player 1, the stall reading and its 740 ms (within one step length a spike): ${show(tight.report.failures, 1200)}`);
    const loose = await playFeel(builds.show(), temp(), 'AC6 a bound of 1,000 ms', spiked(LOOSE_STALL));
    if (loose.report.verdict !== 'PASS' || loose.report.failures.length) f.push(`AC6: net.feel under a 1,000 ms bound reads ${loose.report.verdict} with ${loose.report.failures.length} failures, not PASS: ${show(loose.report.raw, 900)}`);
    none(f, 'net.feel fails past its bound and passes within it');
  }, TIMEOUT);

  it(`${AC[6]} a net.feel whose profile or bounds a working agent's patch changed is refused, naming the field`, async () => {
    const evidence = temp();
    putProgram(evidence);
    const yours = { kind: 'net.feel', steps: 600, ...feel(SPIKED, { bounds: { stall: TIGHT_STALL } }) } as unknown as JsonObject;
    const document: JsonObject = { ...eightDoc(), checks: [yours] };
    const doc = String(document['id']);
    const s = new Script();
    const read0 = s.add({ call: 'read', doc });
    // The working agent's patch: its deep_show of the stored document with one of net.feel's fields changed.
    const changed = (check: JsonObject): JsonObject => ({ ...document, checks: [check] });
    const spikes = SPIKED.spikes!;
    const changes = [
      { path: 'checks/0/bounds/stall', document: changed({ ...yours, bounds: { ...(yours['bounds'] as JsonObject), stall: 100_000 } }), field: /bounds\/stall|bounds\.stall/ },
      { path: 'checks/0/profile/spikes/hold', document: changed({ ...yours, profile: { ...SPIKED, spikes: { ...spikes, hold: 0 } } as unknown as JsonObject }), field: /profile\/spikes\/hold|profile\.spikes\.hold/ },
    ];
    const at = changes.map((c) => s.add({ call: 'deep_show', session: SESSION, doc, document: c.document, include: ['issues'] }));
    const read1 = s.add({ call: 'read', doc });
    const r = await runShow(builds.show(), scenario(evidence, [doc], s.calls, { seeds: { [doc]: document } }), 'AC6 the working agent\'s patches');
    const stored = (reply: JsonObject | undefined, what: string): JsonObject => {
      const d = obj(reply, what);
      const held = isObject(d['document']) ? d['document'] : d;
      const checks = Array.isArray(held['checks']) ? held['checks'].filter(isObject) : [];
      expect(checks.length, `${what}: the stored fixture holds its net.feel among its own checks: ${show(d, 1200)}`).toBe(1);
      return checks[0]!;
    };
    expect(stored(r[read0], 'AC6 before the patches'), 'the stored net.feel is yours, as given').toEqual(yours);
    const f: string[] = [];
    changes.forEach((c, i) => {
      const reply = obj(r[at[i]!], `AC6 the patch to ${c.path}`);
      const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject).filter((x) => x['severity'] === 'error') : [];
      const naming = issues.filter((x) => c.field.test(String(x['path'] ?? '')) || c.field.test(String(x['field'] ?? '')));
      if (reply['outcome'] !== 'refused') f.push(`AC6: the working agent's patch to ${c.path} is ${String(reply['outcome'])}, not refused: ${show(reply, 900)}`);
      if (!naming.length) f.push(`AC6: no error issue of the refusal names the field ${c.path}: ${show(issues, 900)}`);
      if (!naming.some((x) => /net\.feel/.test(JSON.stringify(x)))) f.push(`AC6: the refusal naming ${c.path} doesn't say it's net.feel's: ${show(naming, 900)}`);
    });
    none(f, 'the working agent\'s patches to net.feel\'s profile and bounds are refused, naming the field');
    expect(stored(r[read1], 'AC6 after the patches'), 'the stored net.feel keeps your profile and bounds').toEqual(yours);
  }, TIMEOUT);

  it(`${AC[6]} two runs from one seed give byte-equal readings, while a planted meter on the wall clock gives two and fails, naming the reading`, async () => {
    const ask = { document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(SEEDED) };
    const [one, two] = [await playFeel(builds.show(), temp(), 'AC6 the first run', ask), await playFeel(builds.show(), temp(), 'AC6 the second run', ask)];
    none(sameReadings(one.report, two.report, 'AC6'), 'two runs from one seed give byte-equal readings');
    const planted = { ...ask, planted: 'net_feel_wall_clock' as const };
    const [p1, p2] = [await playFeel(builds.show(), temp(), 'AC6 the planted meter, first', planted), await playFeel(builds.show(), temp(), 'AC6 the planted meter, second', planted)];
    failsNaming(sameReadings(p1.report, p2.report, 'AC6 planted'), [/copy [1-8]'s stall/], 'the meter on the wall clock');
  }, TIMEOUT);
});
