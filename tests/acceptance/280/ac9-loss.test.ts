// AC9 #280.4335448f: net.feel on the eight-seat fixture at window 8, delay 2 and 60 Hz, with 40 ms one-way latency, no
// jitter and `loss {rate: 0.01, seed: 7}`, ends with every copy's input track equal by hash to the lossless run's, reads
// stall at least the lossless run's on every copy, and gives byte-equal readings on a second run from the same seed; a
// planted resend from the newest step instead of the lowest unconfirmed one leaves a copy waiting on a step never sent
// again, and the run fails at its deadline, naming the copy and the step, never hanging
//
// net.feel runs through `match` on fixtures.ts's eight-seat fixture for its 3,600 steps, the players' seeded entries in
// `plays`: once lossless (40 ms, no jitter) and twice lossy (the same, with `loss {rate: 0.01, seed: 7}`), each in a
// `deep-show run` of its own. The lossy run's relay drops messages (#549's relay report: `dropped` above 0). Every
// copy's record (#549's `record.track`, the merged track it confirmed) is hashed as its lines (step, player, control,
// value, in step, player and seq order); each copy ran all 3,600 steps with no end, and its hash equals the lossless
// run's copy's. Each copy's stall reading is at least the lossless one's; the two lossy runs' readings are byte-equal.
// The planted resend is `net_resends_from_newest`: under the lossy profile its run ends (the `deep-show run` returns)
// with net.feel FAIL, a failure naming a copy and the step it waited on, and that copy's match ended at its timeout.
// Wrong programs it fails: the merge base (net.feel isn't a check kind); a relay that drops nothing, or a copy that
// never resends; a resend from the newest step; a run that waits past its deadline.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FEEL_STEPS, LOSSLESS, LOSSY, eightDoc, feel, seededMoves } from './fixtures.ts';
import { AC, FULL, TIMEOUT, none, num, obj, playFeel, readingOf, sameReadings, show, useBuilds, useChildren, useTemp, type Copy551, type Felt } from './helpers.ts';
import { trackLines } from '../551/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const plays = seededMoves(FEEL_STEPS);
const ask = (lossy: boolean) => ({ document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(lossy ? LOSSY : LOSSLESS) });
/** A copy's merged track by hash: its lines up to the last step it confirmed. */
const trackHash = (c: Copy551): string => createHash('sha256').update(trackLines(c.record?.track ?? [], FEEL_STEPS).join('\n')).digest('hex');
const dropped = (r: Felt): number => num(obj(obj(r.reply, 'the match')['relay'], 'the match: relay (the test relay\'s report)')['dropped'], 'the match: relay.dropped');

describe(`${AC[9]} net.feel with lost messages, and a resend that never comes`, () => {
  it(`${AC[9]} with loss {rate: 0.01, seed: 7}, every copy's input track equals the lossless run's by hash, its stall is at least the lossless run's, and a second run from the same seed gives byte-equal readings`, async () => {
    const lossless = await playFeel(builds.show(), temp(), 'AC9 lossless', ask(false));
    const lossy = await playFeel(builds.show(), temp(), 'AC9 lossy', ask(true));
    const again = await playFeel(builds.show(), temp(), 'AC9 lossy, again', ask(true));
    const f: string[] = [];
    if (dropped(lossy) === 0) f.push('AC9: the lossy run\'s relay dropped no message');
    for (const [c, base] of lossy.copies.map((c, i) => [c, lossless.copies[i]!] as const)) {
      if (c.ran < FEEL_STEPS || c.end !== null) f.push(`AC9: the lossy run's copy ${c.player} ran ${c.ran} of ${FEEL_STEPS} steps and ended ${String(c.end)}`);
      if (c.record?.confirmed !== base.record?.confirmed) f.push(`AC9: the lossy run's copy ${c.player} confirmed through step ${String(c.record?.confirmed)}, the lossless run's through ${String(base.record?.confirmed)}`);
      if (trackHash(c) !== trackHash(base)) f.push(`AC9: copy ${c.player}'s input track differs by hash from the lossless run's`);
      const [s, s0] = [readingOf(lossy.report, c.player).stall, readingOf(lossless.report, c.player).stall];
      if (s < s0) f.push(`AC9: copy ${c.player} reads ${s} ms of stall a minute with loss, less than the lossless run's ${s0}`);
    }
    f.push(...sameReadings(lossy.report, again.report, 'AC9 the two lossy runs'));
    none(f, 'loss with resends changes no track, adds stall and repeats from its seed');
  }, TIMEOUT);

  it(`${AC[9]} a planted resend from the newest step instead of the lowest unconfirmed one leaves a copy waiting on a step never sent again, and the run fails at its deadline, naming the copy and the step, never hanging`, async () => {
    const r = await playFeel(builds.show(), temp(), 'AC9 planted resend', { ...ask(true), planted: 'net_resends_from_newest' });
    expect(r.report.verdict, `the planted resend's net.feel reads FAIL: ${show(r.report.raw, 1200)}`).toBe('FAIL');
    const named = r.report.failures.filter((x) => typeof x['copy'] === 'number' && typeof x['step'] === 'number');
    expect(named.length, `a failure names the copy and the step it waited on ({copy, step}): ${show(r.report.failures, 1200)}`).toBeGreaterThan(0);
    const f: string[] = [];
    for (const x of named) {
      const c = r.copies.find((k) => k.player === x['copy']);
      if (!c) f.push(`AC9: the failure names copy ${String(x['copy'])}, which the match has none of`);
      else if (c.end !== 'timeout') f.push(`AC9: copy ${c.player}, which the failure names at step ${String(x['step'])}, ended ${String(c.end)}, not at its timeout`);
      else if (!c.waits.length) f.push(`AC9: copy ${c.player}, which the failure names, never waited`);
    }
    none(f, 'the run with the planted resend fails at its deadline, naming the copy and the step');
  }, TIMEOUT);
});
