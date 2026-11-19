// AC3 #1431.ee4481cb: a one-hour replica replay ends with `unaccounted` within 50 MB of its value at minute 5. A planted
// leak of 1 MB a minute in an ungauged buffer fails.
//
// Two replica processes (`deep-drive`, the env-plants build) run side by side for the full hour, each launched on its
// fixture on the real clock, so a replica's minute is a minute of wall time: the replica as it ships and
// `DEEP_DRIVE_PLANT=leaks-ungauged-buffer`, which adds a 1,000,000 B buffer outside the heap that no gauge counts at each
// whole minute since its launch. Both replay the same journey over and over (pages opened, sessions opened, the pointer
// moved over the window, the window's text tree read), call by call in turn, and at each whole minute from the
// replay's start each answers its reading (`{"call": "footprint"}`): the replay's series, minute 0 to minute 60, printed
// as the Proof. A minute whose reading is missing or has no `unaccounted` (a read unknown) is void and is never
// compared. The judge compares minute 60 with minute 5; the replica as it ships must pass it, and the planted leak,
// about 55 MB over those 55 minutes, must fail it on its drift.
import { describe, expect, it } from 'vitest';
import { DRIVE_BUILD, DRIVE_PLANT, ID, MB, Replica, mb, readingOf, requireMacos, short, useBuild, type Reading } from './helpers.ts';

const drive = useBuild(DRIVE_BUILD);

const MINUTE_MS = 60_000;
const MINUTES = 60;
const COMPARED = 5;
const WITHIN = 50 * MB;

/** The sessions of the replica's fixture record (docs/spikes/338/fixtures/needs-you.events.jsonl at the base). */
const SESSIONS = ['01MCBH57D812FQ88XJ33AV9KCE', '01MCBH58CGAQESGES1C4G0D6KF', '01MCBH59BR567E65G5ZMQVD50Y', '01MCBH5AB06WMYG6MC4XXAC1Y8', '01MCBH5BA8VDDP75ES6BGN4S84', '01MCBH5C9GCHP932NZK0RVQ19S', '01MCBH5D8RGQHJD9XH63321Q3Q'];
/** Points over the reference window (1,512 × 982 pt at 2×), in device pixels: the sidebar's rows and the page. */
const POINTS: [number, number][] = [300, 900, 1500, 2100, 2700].flatMap((x) => [300, 800, 1300, 1800].map((y): [number, number] => [x, y]));

/**
 * The journey the replay plays over and over: home, the pointer over the window, Needs you, every session's page with
 * the pointer on it, and the window's text tree read. An `open` of a page the fixture lacks answers what became of it
 * and changes nothing; every call must answer ok.
 */
function journey(): { call: string; [key: string]: unknown }[] {
  const hovers = POINTS.map((point) => ({ call: 'act', act: { kind: 'hover', point } }));
  return [
    { call: 'open', open: { address: 'page/home' } },
    ...hovers,
    { call: 'open', open: { address: 'page/needs-you' } },
    ...SESSIONS.flatMap((s, i) => [{ call: 'open', open: { address: `session/${s}` } }, hovers[(i * 3) % hovers.length]!]),
    { call: 'see', see: { include: ['roles', 'names', 'values', 'bounds'] } },
  ];
}

interface Minute { minute: number; reading: Reading | null; why: string }

/** Why minute `m` of a series is void, or null when it holds a known `unaccounted`. */
function voidWhy(series: Minute[], m: number): string | null {
  const x = series.find((s) => s.minute === m);
  if (!x) return `minute ${m} has no reading`;
  if (x.reading === null) return `minute ${m} is void: ${x.why}`;
  return x.reading.unaccounted === null ? `minute ${m} is void: its reading names ${short(x.reading.unknown)}` : null;
}
const unaccountedAt = (series: Minute[], m: number): number => series.find((s) => s.minute === m)!.reading!.unaccounted!;

/** The criterion's judge: the replay ends (minute 60) with unaccounted within 50 MB of its value at minute 5. */
function replayProblems(series: Minute[], who: string): string[] {
  const voids = [voidWhy(series, COMPARED), voidWhy(series, MINUTES)].filter((w): w is string => w !== null);
  if (voids.length) return voids.map((w) => `${who}: BLOCKED: ${w}`);
  const [five, end] = [unaccountedAt(series, COMPARED), unaccountedAt(series, MINUTES)];
  const drift = end - five;
  return Math.abs(drift) <= WITHIN ? [] : [`${who}: unaccounted ended at ${mb(end)}, ${mb(drift)} from its ${mb(five)} at minute ${COMPARED}, past ${mb(WITHIN)}`];
}

describe(`${ID.ac3} an hour of the app's use leaves unaccounted where it was`, () => {
  it(`${ID.ac3} a one-hour replica replay ends with unaccounted within 50 MB of its value at minute 5; a planted leak of 1 MB a minute in an ungauged buffer fails`, async () => {
    requireMacos('the replica');
    const launch = { from: 'fixture', clock: 'real' };
    const honest = await Replica.start(drive(), launch);
    const replicas: [string, Replica][] = [['as it ships', honest]];
    try {
      // The replica answers its reading before the hour starts, so a build without one fails here, not an hour later.
      await honest.reading('before the replay');
      replicas.push([DRIVE_PLANT.leaks, await Replica.start(drive(), launch, DRIVE_PLANT.leaks)]);
      const series = new Map<string, Minute[]>(replicas.map(([who]) => [who, []]));
      const start = Date.now();
      const take = async (minute: number): Promise<void> => {
        for (const [who, r] of replicas) {
          const reply = await r.call({ call: 'footprint' });
          const reading = reply['ok'] === true ? readingOf(reply['reading'], `${who} at minute ${minute}`) : null;
          const why = reading === null ? `its reading failed: ${short(reply)}` : '';
          series.get(who)!.push({ minute, reading, why });
          console.log(`PROOF ${ID.ac3} minute ${minute} ${who}: ${reading ? `unaccounted ${reading.unaccounted ?? 'unknown (void)'}, footprint ${reading.footprint}, heap ${reading.heap}, gauges ${reading.gauges.reduce((s, g) => s + (g.bytes ?? 0), 0)}${reading.unknown.length ? `, unknown ${short(reading.unknown)}` : ''}` : `void: ${why}`}`);
        }
      };
      await take(0);
      const calls = journey();
      let next = 1;
      let step = 0;
      while (next <= MINUTES) {
        const call = calls[step % calls.length]!;
        for (const [who, r] of replicas) {
          const reply = await r.call(call);
          expect(reply['ok'], `${who}: the replay's step ${step} (${short(call, 200)}): ${short(reply)}`).toBe(true);
        }
        step += 1;
        while (next <= MINUTES && Date.now() - start >= next * MINUTE_MS) await take(next++);
      }
      console.log(`PROOF ${ID.ac3} the replay played ${step} steps on each replica in ${((Date.now() - start) / MINUTE_MS).toFixed(1)} minutes`);

      const shipped = replayProblems(series.get('as it ships')!, 'as it ships');
      expect(shipped, `the replica as it ships ends the hour with unaccounted within ${mb(WITHIN)} of minute ${COMPARED}:\n  ${shipped.join('\n  ')}`).toEqual([]);
      const planted = replayProblems(series.get(DRIVE_PLANT.leaks)!, DRIVE_PLANT.leaks);
      console.log(`PROOF ${ID.ac3} the judge on ${DRIVE_PLANT.leaks}: ${planted.join('; ') || 'passes'}`);
      expect(planted.some((p) => !p.includes('BLOCKED')), `the planted leak of 1 MB a minute in an ungauged buffer fails the same judge on its drift, its minutes ${COMPARED} and ${MINUTES} read: ${planted.join('; ') || 'it passed'}`).toBe(true);
    } finally {
      for (const [, r] of replicas) await r.stop();
    }
  }, 5_400_000);
});
