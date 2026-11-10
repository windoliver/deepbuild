// AC3: "The loudness bake reads EBU Tech 3341's test signals 1 to 23 and Tech 3342's signals 1 to 6 within each table's
// tolerance (±0.1 LU momentary, short-term and integrated, ±1 LU loudness range, +0.2/−0.4 dB true peak at 4× and 8×
// oversampling), the signals fetched by hash on first use and never committed; a planted meter that reads sample peaks
// fails signal 16, a tone at a quarter of the sample rate and 45° of phase, by about 3 dB"
//
// Through `media_bake` with `kind: loudness` (README: The surface under test), on the EBU loudness test set v05, read
// from its zip by pinned SHA-256 (helpers.ts `ebuSet`; without it the test fails BLOCKED with the unblock line, never
// passes). Each signal is judged by its row of Tech 3341-2016's Table 1 or Tech 3342-2016's Table 1, with that row's
// expected response; the readings are the bake's (README: Readings). Signals 15 to 23 are baked at `tp_oversample` 4 and
// at 8, the others at 4. The planted `sample_peak_meter` bakes signal 16 at 4 and at 8, and must miss −6.0 dBTP by
// 2.5 to 3.5 dB at each, failing the same judgement, naming signal 16.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AC, FIVE, SIGNALS, TIMEOUT, bakes, between, ebuSet, fmt, gitBlob, loudnessOf, maxOf, putAsset, trackedBlobs, useEvidence,
  useShow, type Ask, type EbuSet, type Loudness, type Place, type Planted,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

let set: EbuSet | string = 'BLOCKED: the EBU set was not read';
beforeAll(async () => { set = await ebuSet(); }, TIMEOUT);

interface Signal { name: string; file: string; channels?: Place[]; oversample?: 4 | 8; judge: (r: Loudness) => string[] }

const near = (v: number | null, want: number, tol: number): boolean => v !== null && Math.abs(v - want) <= tol + 1e-9;
/** I = want ±0.1 LUFS. */
const integrated = (want: number) => (r: Loudness): string[] => (near(r.integrated, want, 0.1) ? [] : [`integrated loudness reads ${fmt(r.integrated)} LUFS, not ${want.toFixed(1)} ±0.1`]);
/** Every reading of a series whose window ends at or after `fromMs` is want ±0.1. */
const every = (key: 'momentary' | 'short_term', fromMs: number, want: number) => (r: Loudness): string[] => {
  const xs = between(r[key], fromMs - 10, Infinity);
  if (xs.length === 0) return [`no ${key} readings from ${fromMs / 1000} s`];
  const bad = xs.find((x) => !near(x.v, want, 0.1));
  return bad ? [`${key} at ${bad.ms / 1000} s reads ${fmt(bad.v)} LUFS, not ${want.toFixed(1)} ±0.1 (every reading from ${fromMs / 1000} s)`] : [];
};
/** The largest reading of a series is want ±0.1. */
const most = (key: 'momentary' | 'short_term', want: number) => (r: Loudness): string[] => {
  const m = maxOf(between(r[key], -Infinity, Infinity));
  return near(m, want, 0.1) ? [] : [`max ${key} reads ${fmt(m)} LUFS, not ${want.toFixed(1)} ±0.1`];
};
/** Over each segment i of `segMs`, the largest reading is −38 + i ±0.1 ("successive values"). */
const successive = (key: 'momentary' | 'short_term', segMs: number) => (r: Loudness): string[] => {
  const out: string[] = [];
  for (let i = 0; i < 20; i++) {
    const m = maxOf(between(r[key], segMs * i, segMs * (i + 1)));
    if (!near(m, -38 + i, 0.1)) out.push(`max ${key} over segment ${i + 1} (${(segMs * i) / 1000} s to ${(segMs * (i + 1)) / 1000} s) reads ${fmt(m)} LUFS, not ${(-38 + i).toFixed(1)} ±0.1`);
  }
  return out;
};
const range = (want: number) => (r: Loudness): string[] => (Math.abs(r.range - want) <= 1 + 1e-9 ? [] : [`loudness range reads ${r.range.toFixed(3)} LU, not ${want} ±1`]);
const truePeak = (want: number) => (r: Loudness): string[] => (r.true_peak <= want + 0.2 + 1e-9 && r.true_peak >= want - 0.4 - 1e-9 ? [] : [`true peak reads ${r.true_peak.toFixed(3)} dBTP, not ${want.toFixed(1)} +0.2/−0.4 (${(want - r.true_peak).toFixed(2)} dB under)`]);
const all = (...js: ((r: Loudness) => string[])[]) => (r: Loudness): string[] => js.flatMap((j) => j(r));

/** Tech 3341-2016 Table 1 (signals 1 to 23) and Tech 3342-2016 Table 1 (signals 1 to 6), as the set's files hold them. */
function table(): Signal[] {
  const s: Signal[] = [
    { name: 'Tech 3341 signal 1', file: 'seq-3341-1-16bit.wav', judge: all(every('momentary', 400, -23), every('short_term', 3000, -23), integrated(-23)) },
    { name: 'Tech 3341 signal 2', file: 'seq-3341-2-16bit.wav', judge: all(every('momentary', 400, -33), every('short_term', 3000, -33), integrated(-33)) },
    { name: 'Tech 3341 signal 3', file: 'seq-3341-3-16bit-v02.wav', judge: integrated(-23) },
    { name: 'Tech 3341 signal 4', file: 'seq-3341-4-16bit-v02.wav', judge: integrated(-23) },
    { name: 'Tech 3341 signal 5', file: 'seq-3341-5-16bit-v02.wav', judge: integrated(-23) },
    { name: 'Tech 3341 signal 6', file: 'seq-3341-6-5channels-16bit.wav', channels: FIVE, judge: integrated(-23) },
    { name: 'Tech 3341 signal 7 (Tech 3342 signal 5)', file: 'seq-3341-7_seq-3342-5-24bit.wav', judge: all(integrated(-23), range(5)) },
    { name: 'Tech 3341 signal 8 (Tech 3342 signal 6)', file: 'seq-3341-2011-8_seq-3342-6-24bit-v02.wav', judge: all(integrated(-23), range(15)) },
    { name: 'Tech 3341 signal 9', file: 'seq-3341-9-24bit.wav', judge: every('short_term', 3000, -23) },
  ];
  for (let i = 1; i <= 20; i++) s.push({ name: `Tech 3341 signal 10, file ${i}`, file: `seq-3341-10-${i}-24bit.wav`, judge: most('short_term', -23) });
  s.push({ name: 'Tech 3341 signal 11', file: 'seq-3341-11-24bit.wav', judge: successive('short_term', 6000) });
  s.push({ name: 'Tech 3341 signal 12', file: 'seq-3341-12-24bit.wav', judge: every('momentary', 1000, -23) });
  for (let i = 1; i <= 20; i++) s.push({ name: `Tech 3341 signal 13, file ${i}`, file: `seq-3341-13-${i}-24bit.wav${i >= 3 ? '.wav' : ''}`, judge: most('momentary', -23) });
  s.push({ name: 'Tech 3341 signal 14', file: 'seq-3341-14-24bit.wav.wav', judge: successive('momentary', 800) });
  const peaks = [-6, -6, -6, -6, 3, 0, 0, 0, 0];
  for (const oversample of [4, 8] as const) peaks.forEach((want, k) => s.push({ name: `Tech 3341 signal ${15 + k} at ${oversample}×`, file: `seq-3341-${15 + k}-24bit.wav.wav`, oversample, judge: truePeak(want) }));
  [10, 5, 20, 15].forEach((want, k) => s.push({ name: `Tech 3342 signal ${k + 1}`, file: `seq-3342-${k + 1}-16bit.wav`, judge: range(want) }));
  return s;
}

/** Bakes each signal (its file into the evidence store by its SHA-256) and judges it; each line names its signal. */
function run(ebu: EbuSet, signals: Signal[], what: string, planted?: Planted): string[] {
  const evidence = evidenceDir();
  const asks: Ask[] = signals.map((g) => ({
    asset: putAsset(evidence, ebu.file(g.file)), kind: 'loudness', tp_oversample: g.oversample ?? 4, ...(g.channels ? { channels: g.channels } : {}),
  }));
  return bakes(show(), evidence, asks, what, planted).flatMap((b, i) => signals[i]!.judge(loudnessOf(b, `${what}: ${signals[i]!.name}`)).map((l) => `${signals[i]!.name}: ${l}`));
}

describe('AC3 the loudness bake reads the EBU test signals within their tables\' tolerances', () => {
  it(`${AC[3]} Tech 3341 signals 1 to 23 and Tech 3342 signals 1 to 6 read within ±0.1 LU (M, S, I), ±1 LU (LRA) and +0.2/−0.4 dB (true peak at 4× and 8×), the set fetched by pinned hash and never committed; a planted sample-peak meter fails signal 16 by about 3 dB`, () => {
    if (typeof set === 'string') expect.fail(set);
    const ebu = set;
    const tracked = trackedBlobs();
    const committed = Object.keys(SIGNALS).filter((name) => tracked.has(gitBlob(ebu.file(name))));
    expect(committed, 'no EBU signal is committed: none is a blob of HEAD or the index').toEqual([]);

    const signals = table();
    expect(new Set(signals.map((g) => g.file)).size, 'every Tech 3341 and 3342 signal file of the set is read').toBe(Object.keys(SIGNALS).length - 1);
    expect(run(ebu, signals, 'the EBU loudness test set'), 'each signal reads within its table\'s tolerance').toEqual([]);

    // Wrong program: a meter whose true peak is the sample peak. Signal 16's samples sit at ±0.354 (45° off the fs/4
    // tone's crests), so it reads about −9.0 dBTP against −6.0.
    const planted: Planted = 'sample_peak_meter';
    const sixteen = signals.filter((g) => g.name.startsWith('Tech 3341 signal 16 '));
    const w = run(ebu, sixteen, 'Tech 3341 signal 16', planted);
    for (const g of sixteen) {
      const line = w.find((l) => l.startsWith(`${g.name}: true peak reads`));
      const under = line ? Number(/\(([-\d.]+) dB under\)/.exec(line)?.[1]) : NaN;
      expect(under >= 2.5 && under <= 3.5, `planted ${planted} fails ${g.name}, about 3 dB under −6.0 dBTP; got ${JSON.stringify(w)}`).toBe(true);
    }
  }, TIMEOUT);
});
