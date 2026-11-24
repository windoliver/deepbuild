// AC8 and AC9: Numbers lists accepted taste calls as seen and unseen, with the median time a picture was on screen, and
// the longest run of accepted calls in a row with that median for its first half and its second. Each fixture is a
// record a real hub reads (README, The fixtures): taste asks raised by the asks core, one a session so none folds,
// answered through the asks core as the card answers (the app's connection, with each picture's entry, README Pinned
// 4) or as `deep inbox answer` does (the CLI's connection, nothing drawn). Numbers is `deep numbers --json` (#45). The
// expected values are this file's hand count of the fixture.
import { afterAll, describe, expect, it } from 'vitest';
import { ACCEPT, askOf, BACK, cleanup, ID, makeWorld, MIN, numbersRows, PLANT, said, type Line, type SessionSpec, type World } from './helpers.ts';
import type { Seeding } from '../26/helpers.ts';

afterAll(cleanup, 60_000);
const TINY: [number, number][] = [[8, 8], [8, 8]];
const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** One call of a fixture: answered on the card with each picture on screen `ms` ms (all shown), or from the terminal. */
interface Call { via: 'card' | 'inbox'; option: string; ms?: [number, number] }
const specsOf = (calls: readonly Call[]): SessionSpec[] => calls.map((_, i) => ({ key: `c${i}`, title: `Screen ${i + 1}`, asks: [{ key: `c${i}`, question: `Does screen ${i + 1} look right?`, pictures: TINY }] }));
/** Answers each call in order, 20 s apart, as the card or the terminal does. */
const answering = (calls: readonly Call[]) => async (s: Seeding, w: World): Promise<void> => {
  for (const [i, call] of calls.entries()) {
    const ask = askOf(w, `c${i}`);
    s.at(s.now() + 20_000);
    const writer = call.via === 'card' ? 'app' : 'cli';
    const input: Line = { option: call.option };
    if (call.via === 'card') input.pictures = ask.pictures.map((p, k) => ({ sha256: p.sha, shown: true, scale: 1, ms: call.ms![k]! }));
    await s.asks.answer({ writer, actor: 'you', scope: 'you' } as never, ask.handle, input);
  }
};
/** The fixture's world, or a failure saying the record takes no per-picture entry on an answer. */
async function fixture(calls: readonly Call[], plant?: string): Promise<World> {
  return makeWorld(specsOf(calls), { more: answering(calls), ...(plant ? { plant } : {}) })
    .catch((e: Error) => expect.fail(`the fixture can't be recorded: an answer with each picture's entry (pictures: [{sha256, shown, scale, ms}]) is refused: ${e.message.slice(0, 600)}`));
}
const rowOf = (rows: readonly Line[], id: string): Line | undefined => rows.find((r) => r.id === id);

// ---- AC8: a week of 6 accepted calls seen and 2 unseen.

const WEEK: Call[] = [
  { via: 'card', option: ACCEPT, ms: [500, 1500] },
  { via: 'card', option: ACCEPT, ms: [4000, 4000] },
  { via: 'inbox', option: ACCEPT },
  { via: 'card', option: ACCEPT, ms: [4000, 4000] },
  { via: 'card', option: ACCEPT, ms: [4000, 4000] },
  { via: 'inbox', option: ACCEPT },
  { via: 'card', option: ACCEPT, ms: [4000, 4000] },
  { via: 'card', option: ACCEPT, ms: [9000, 12000] },
];
/** The hand count: accepted calls answered on the card (every picture shown) and from the terminal, and the median of the seen calls' pictures. */
const HAND = { seen: WEEK.filter((c) => c.via === 'card').length, unseen: WEEK.filter((c) => c.via === 'inbox').length, median: median(WEEK.flatMap((c) => c.ms ?? [])) };

async function weekFailures(plant?: string): Promise<string[]> {
  const rows = await numbersRows(await fixture(WEEK, plant));
  const [seen, unseen, ms] = ['taste_calls_seen', 'taste_calls_unseen', 'taste_picture_ms_median'].map((id) => rowOf(rows, id));
  const out: string[] = [];
  if (seen?.value !== HAND.seen || unseen?.value !== HAND.unseen) out.push(`Numbers reads seen ${said(seen?.value ?? 'no row')} and unseen ${said(unseen?.value ?? 'no row')}, not ${HAND.seen} and ${HAND.unseen}`);
  if (ms?.value !== HAND.median || ms?.unit !== 'ms') out.push(`Numbers reads the median time a picture ${said(ms ? { value: ms.value, unit: ms.unit } : 'no row')}, not ${HAND.median} ms`);
  return out;
}

describe(`AC8 ${ID.week} Numbers counts accepted taste calls as seen and unseen`, () => {
  it(`AC8 ${ID.week}: a fixture week with 6 accepted calls seen and 2 unseen reads 6 and 2 on Numbers with the median time a picture (hand count: ${HAND.seen}, ${HAND.unseen}, ${HAND.median} ms)`, async () => {
    expect(HAND).toEqual({ seen: 6, unseen: 2, median: 4000 });
    expect(await weekFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC8 ${ID.week} wrong program: a count that folds them into 8 fails this test`, async () => {
    expect((await weekFailures(PLANT.foldsSeenUnseen)).join('\n'), `the planted count (README, Plants: ${PLANT.foldsSeenUnseen}) wasn't caught`).toContain('Numbers reads seen 8 and unseen');
  }, 30 * MIN);
});

// ---- AC9: the longest run of accepted calls in a row, with its first half's median and its second's.

const RUN: Call[] = [
  ...Array.from({ length: 5 }, (): Call => ({ via: 'card', option: ACCEPT, ms: [8000, 8000] })),
  ...Array.from({ length: 5 }, (): Call => ({ via: 'card', option: ACCEPT, ms: [2000, 2000] })),
];
const BROKEN: Call[] = [...RUN.slice(0, 5), { via: 'card', option: BACK, ms: [3000, 3000] }, ...RUN.slice(5)];
/** The hand count of each fixture's longest runs: their length, and the median of each half's pictures. */
function runsOf(calls: readonly Call[]): { value: number; detail: { calls: number; first_half_ms: number; second_half_ms: number }[] } {
  const runs: Call[][] = [];
  let now: Call[] = [];
  for (const c of calls) {
    if (c.option === ACCEPT) now.push(c);
    else { if (now.length) runs.push(now); now = []; }
  }
  if (now.length) runs.push(now);
  const value = Math.max(...runs.map((r) => r.length));
  return {
    value,
    detail: runs.filter((r) => r.length === value).map((r) => ({ calls: r.length, first_half_ms: median(r.slice(0, Math.floor(r.length / 2)).flatMap((c) => c.ms ?? [])), second_half_ms: median(r.slice(Math.ceil(r.length / 2)).flatMap((c) => c.ms ?? [])) })),
  };
}

async function runFailures(calls: readonly Call[], plant?: string): Promise<string[]> {
  const rows = await numbersRows(await fixture(calls, plant));
  const row = rowOf(rows, 'taste_calls_in_a_row');
  const want = runsOf(calls);
  const got = row ? { value: row.value, detail: (Array.isArray(row.detail) ? row.detail : []).map((d: Line) => ({ calls: d.calls, first_half_ms: d.first_half_ms, second_half_ms: d.second_half_ms })) } : undefined;
  if (JSON.stringify(got) === JSON.stringify(want)) return [];
  const halves = (got?.detail ?? []).map((d) => `a run of ${String(d.calls)} reads first half ${String(d.first_half_ms)} ms and second ${String(d.second_half_ms)} ms`).join('; ');
  return [`Numbers' longest run of accepted calls must read ${said(want)}; it reads ${said(got ?? 'no taste_calls_in_a_row row')}${halves ? ` (${halves})` : ''}`];
}

describe(`AC9 ${ID.run} the longest run of accepted calls shows a yes getting faster`, () => {
  it(`AC9 ${ID.run}: 10 accepted calls in a row, the first five at 8 s a picture and the last five at 2 s, read a run of 10 with 8 s and 2 s; with a call sent back between the fifth and the sixth they read two runs of 5`, async () => {
    expect(runsOf(RUN)).toEqual({ value: 10, detail: [{ calls: 10, first_half_ms: 8000, second_half_ms: 2000 }] });
    expect(runsOf(BROKEN)).toEqual({ value: 5, detail: [{ calls: 5, first_half_ms: 8000, second_half_ms: 8000 }, { calls: 5, first_half_ms: 2000, second_half_ms: 2000 }] });
    expect([...await runFailures(RUN), ...await runFailures(BROKEN)]).toEqual([]);
  }, 40 * MIN);

  it(`AC9 ${ID.run} wrong program: a planted reading that gives one median for the whole run fails this test`, async () => {
    const whole = median(RUN.flatMap((c) => c.ms ?? []));
    expect((await runFailures(RUN, PLANT.oneMedianPerRun)).join('\n'), `the planted reading (README, Plants: ${PLANT.oneMedianPerRun}) wasn't caught`).toContain(`a run of 10 reads first half ${whole} ms and second ${whole} ms`);
  }, 30 * MIN);
});
