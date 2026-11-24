// Unit checks of criterion 8's client and judge (README: The unit checks). No criterion's tag and no deep-show: a small
// stand-in (standin.swift) opens one window with what an AccessKit window gives an assistive client, right or wrong in
// one way, and the same client and the same judge the criterion's test uses read it. Each window is small, never takes
// the focus, and is closed by its own PID. BLOCKED without macOS, swiftc, Accessibility trust or a screen that shows
// windows; no reference Mac is needed, since nothing of the product is read.
import { beforeAll, describe, expect, it } from 'vitest';
import { IDS, SCATTER, blocked, compile, judge, platformProblem, readWindow, screenProblem, type Judged, type Live, type Replica } from './helpers.ts';

let stopped: string | null = null;
beforeAll(async () => {
  stopped = await platformProblem({ reference: false });
  if (stopped === null) stopped = compile('standin').error || null;
}, 1_800_000);

// The texts are this file's own: two spaces, letters past ASCII and a quote in the value, one announcement said twice in
// a row, which the client must hear twice.
const REPLICA: Replica = {
  id: SCATTER,
  value: 'seven rows drawn,  “x” secondes 0 à 6, y mètres 2 to 40',
  said: ['0 s, 2 m', '1 s, 5 m', '2 s, 9 m', '2 s, 9 m', '3 s, 12 m', '4 s, −18 m', '5 s, 40 m'],
};
interface Spec { window: boolean; identifier: string | null; value: string; lines: string[] }
const RIGHT: Spec = { window: true, identifier: SCATTER, value: REPLICA.value, lines: REPLICA.said };

/** The stand-in `spec`, read and heard as the criterion's test reads a window, on shorter times. */
async function heard(spec: Spec, what: string): Promise<{ live: Live; judged: Judged }> {
  if (stopped !== null) blocked(stopped);
  const r = await readWindow(compile('standin').path, [JSON.stringify({ ...spec, gapMs: 100, lifeMs: 120_000 })], null, SCATTER, { expect: REPLICA.said.length, least: 2, most: 8, quiet: 2 });
  expect(r.answer, `${what}: the stand-in answers: ${r.stderr}`).toEqual({ ok: true });
  if (!r.live) return expect.fail(`${what}: the stand-in ended (${r.ended}): ${r.stderr}`);
  const screen = screenProblem(r.live);
  if (screen) blocked(screen);
  console.log(`client: ${what}: ended ${r.live.ended} after ${r.live.ms} ms, ${r.live.elements.length} identified, ${r.live.said.length} said${r.live.hidden.length ? `, hidden ${JSON.stringify(r.live.hidden)}` : ''}`);
  return { live: r.live, judged: judge(REPLICA, r.live, IDS) };
}
/** The judge fails the read, and a reason matches. */
function fails(j: Judged, reason: RegExp): void {
  expect(j.verdict, j.why.join('; ')).toBe('FAIL');
  expect(j.why.join('\n')).toMatch(reason);
}

describe('client: an AccessKit-shaped window read and heard from outside its process', () => {
  it('client: reads the identifier and the value back exactly, hears every announcement, each as many times as it is posted, in order, and the judge passes it', async () => {
    const { live, judged } = await heard(RIGHT, 'a right window');
    expect(live.elements, 'the one identified element, as the stand-in gives it').toEqual([{ identifier: SCATTER, role: 'AXImage', title: 'The chart', description: null, value: REPLICA.value }]);
    expect(live.said, 'the announcements, in order').toEqual(REPLICA.said);
    expect(judged, 'the judge').toEqual({ verdict: 'PASS', why: [] });
  }, 600_000);

  it('client: a window whose value is stale fails, naming both values', async () => {
    const { judged } = await heard({ ...RIGHT, value: REPLICA.value.replace('40', '55') }, 'a stale value');
    fails(judged, /2 to 55.*2 to 40/);
    expect(judged.why, 'and only on the value').toHaveLength(1);
  }, 600_000);

  it('client: a window that skips an announcement fails, naming it', async () => {
    const { judged } = await heard({ ...RIGHT, lines: REPLICA.said.filter((t) => t !== '1 s, 5 m') }, 'one announcement skipped');
    fails(judged, /asks for "1 s, 5 m" 0 time\(s\), the replica announces it 1 time/);
  }, 600_000);

  it('client: a window that says an announcement twice fails, naming it', async () => {
    const { judged } = await heard({ ...RIGHT, lines: REPLICA.said.flatMap((t) => (t === '3 s, 12 m' ? [t, t] : [t])) }, 'one announcement said twice');
    fails(judged, /asks for "3 s, 12 m" 2 time\(s\), the replica announces it 1 time/);
  }, 600_000);

  it('client: a window that swaps two announcements fails, naming the first', async () => {
    const lines = [...REPLICA.said];
    [lines[4], lines[5]] = [lines[5]!, lines[4]!];
    const { judged } = await heard({ ...RIGHT, lines }, 'two announcements swapped');
    fails(judged, /announcement 5 the window asks for is "4 s, −18 m", the replica's is "3 s, 12 m"/);
  }, 600_000);

  it('client: a window with no identified element is BLOCKED, not a pass and not a fail', async () => {
    const { judged } = await heard({ ...RIGHT, identifier: null }, 'no identified element');
    expect(judged.verdict, judged.why.join('; ')).toBe('BLOCKED');
    expect(judged.why.join('; ')).toMatch(/no element in its tree carries the identifier/);
  }, 600_000);

  it('client: a process that opens no window is BLOCKED once AppKit lists none for 30 s', async () => {
    const { live, judged } = await heard({ ...RIGHT, window: false }, 'no window');
    expect(live.listed).toBe(false);
    expect(judged.verdict, judged.why.join('; ')).toBe('BLOCKED');
    expect(judged.why.join('; ')).toMatch(/listed no window/);
  }, 600_000);

  // No window: the judge alone, on a read as the client gives one, an announcement every 6 s.
  const AT = REPLICA.said.map((_, i) => 6_000 * i);
  const READ: Live = {
    listed: true, ended: 'heard', ms: 50_000, said: REPLICA.said, at: AT, locked: false, asleep: false, hidden: [],
    elements: [{ identifier: SCATTER, role: 'AXImage', title: 'The chart', description: null, value: REPLICA.value }],
  };
  it('client: the judge blocks a read the screen locked or the display slept during, whatever it holds', () => {
    for (const read of [READ, { ...READ, said: [], at: [] }, { ...READ, elements: [] }]) {
      expect(judge(REPLICA, { ...read, locked: true }, IDS).verdict).toBe('BLOCKED');
      expect(judge(REPLICA, { ...read, asleep: true }, IDS).verdict).toBe('BLOCKED');
    }
  });

  it('client: the judge blocks announcements only missing from a window hidden as they could have come, and fails every other difference', () => {
    const THROUGHOUT: Live['hidden'] = [[0, 50_000]];
    /** The read with the announcements at these places left out, hidden in these stretches. */
    const without = (places: number[], hidden: Live['hidden']): Judged['verdict'] => {
      const kept = REPLICA.said.map((_, i) => i).filter((i) => !places.includes(i));
      return judge(REPLICA, { ...READ, hidden, said: kept.map((i) => REPLICA.said[i]!), at: kept.map((i) => AT[i]!) }, IDS).verdict;
    };
    expect(without([], THROUGHOUT), 'every announcement heard is a pass').toBe('PASS');
    for (const places of [[0], [4], [6], [1, 5], [0, 1, 2, 3, 4, 5, 6]]) {
      expect(without(places, THROUGHOUT), `hidden throughout, without ${places}`).toBe('BLOCKED');
      expect(without(places, []), `shown throughout, without ${places}`).toBe('FAIL');
    }
    // The fifth could have come between the fourth, at 18 s, and the sixth, at 30 s.
    expect(without([4], [[20_000, 22_000]]), 'hidden as it could have come').toBe('BLOCKED');
    expect(without([4], [[2_000, 17_000], [31_000, 50_000]]), 'hidden only when it could not').toBe('FAIL');
    expect(without([1, 5], [[5_000, 9_000]]), 'one excused and one not').toBe('FAIL');

    const [a, b, ...rest] = REPLICA.said;
    for (const said of [[b!, a!, ...rest], [a!, a!, b!, ...rest], [...REPLICA.said, 'more'], ['another']]) {
      expect(judge(REPLICA, { ...READ, hidden: THROUGHOUT, said, at: said.map((_, i) => 6_000 * i) }, IDS).verdict, `hidden, but ${said.join(' | ')}`).toBe('FAIL');
    }
    expect(judge(REPLICA, { ...READ, hidden: THROUGHOUT, said: [], at: [], elements: [{ ...READ.elements[0]!, value: 'old' }] }, IDS).verdict, 'a stale value').toBe('FAIL');
  });

  it('client: the judge reads the value from any of the three attributes, white space collapsed, and fails a tree that identifies only another item', () => {
    const at = (e: Partial<Live['elements'][number]>): Judged => judge(REPLICA, { ...READ, elements: [{ ...READ.elements[0]!, value: null, title: null, ...e }] }, IDS);
    expect(at({ title: ` ${REPLICA.value.replace('  ', ' ')}\n` }).verdict).toBe('PASS');
    expect(at({ description: REPLICA.value }).verdict).toBe('PASS');
    fails(at({}), /gives value null, description null and title null/);
    fails(at({ identifier: 'caption' }), /holds no element identified scatter/);
    expect(at({ identifier: 'close-button' }).verdict, "an identifier that is no item's").toBe('BLOCKED');
  });
});
