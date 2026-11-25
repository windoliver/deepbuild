// The #231 Oracle lane's judge: the upstream law's own comparison, on our export's work counters. A pure function, so
// a plain `node` script can run it; `proveJudges` shows it failing a planted set and passing its clean twin, and
// helpers.ts runs that before any binary is asked for. README: Sources.

/** The upstream test's allowance over "the same": a count may grow by at most a tenth. */
export const SLACK = 0.1;

/** The export's work counters (the #231 suite's README: the reply's `work`). */
export interface Work {
  draws: number; hashes: number; fidelity: { draws: number; hashes: number };
  frames_read_back: number; digests_read_back: number; digest_bytes_read_back: number;
}
/** Every counter by name, as the upstream test reads every field of its work. */
export const flat = (w: Work): [string, number][] => [
  ['draws', w.draws], ['hashes', w.hashes], ['fidelity.draws', w.fidelity.draws], ['fidelity.hashes', w.fidelity.hashes],
  ['frames_read_back', w.frames_read_back], ['digests_read_back', w.digests_read_back], ['digest_bytes_read_back', w.digest_bytes_read_back],
];

/** Each count's growth, the longer hold's over the 1 s hold's, as the upstream's `growth` gives it: a count both
 * leave at 0 didn't grow (1), and one only the longer run makes grew without bound. */
export function growth(short: readonly [string, number][], long: readonly [string, number][]): [string, number][] {
  const of = new Map(long);
  return short.map(([k, a]) => { const b = of.get(k) ?? NaN; return [k, a !== 0 ? b / a : b === 0 ? 1 : Infinity]; });
}
/** The upstream assertion: the worst growth is at most 1 + SLACK, or the failure names the hold's length, the count
 * and both readings. */
export function growthFailures(shortSeconds: number, short: readonly [string, number][], seconds: number, long: readonly [string, number][]): string[] {
  const grown = growth(short, long);
  const worst = grown.reduce((w, g) => (g[1] > w[1] || Number.isNaN(g[1]) ? g : w), grown[0]!);
  if (worst[1] <= 1 + SLACK) return [];
  const a = new Map(short).get(worst[0]); const b = new Map(long).get(worst[0]);
  return [`held ${seconds} s, ${Number.isFinite(worst[1]) ? worst[1].toFixed(2) : String(worst[1])}x the ${worst[0]} of ${shortSeconds} s: ${String(a)} → ${String(b)}`];
}

export function proveJudges(): void {
  const must = (ok: boolean, what: string): void => { if (!ok) throw Error(`the #231 Oracle suite's own judge is wrong: ${what}`); };
  const one: Work = { draws: 1, hashes: 1, fidelity: { draws: 1, hashes: 1 }, frames_read_back: 0, digests_read_back: 2, digest_bytes_read_back: 64 };
  // A hold that costs one frame's work however long it lasts, against one drawn every frame (10 a second for 30 s).
  must(growthFailures(1, flat(one), 30, flat(one)).length === 0, 'it fails a 30 s hold that costs what a 1 s hold does');
  const each: Work = { draws: 300, hashes: 300, fidelity: { draws: 300, hashes: 300 }, frames_read_back: 0, digests_read_back: 600, digest_bytes_read_back: 19_200 };
  must(/^held 30 s, 30\.00x the draws of 1 s: 10 → 300$/.test(growthFailures(1, flat({ ...each, draws: 10, hashes: 10, fidelity: { draws: 10, hashes: 10 }, digests_read_back: 20, digest_bytes_read_back: 640 }), 30, flat(each))[0] ?? ''), 'it passes a hold drawn every frame');
  // A count that only the longer hold makes grew without bound; one within the slack didn't grow.
  must(/Infinityx the frames_read_back of 1 s: 0 → 5/.test(growthFailures(1, flat(one), 2, flat({ ...one, frames_read_back: 5 }))[0] ?? ''), 'it passes a count that appears from nothing');
  must(growthFailures(1, flat({ ...one, digest_bytes_read_back: 640 }), 7, flat({ ...one, digest_bytes_read_back: 704 })).length === 0, 'it fails growth of exactly a tenth');
  must(growthFailures(1, flat({ ...one, digest_bytes_read_back: 640 }), 7, flat({ ...one, digest_bytes_read_back: 705 })).length === 1, 'it passes growth over a tenth');
}
