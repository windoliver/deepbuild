// AC4, AC13, AC18, AC24 and AC25: when rows move, one rule. The replica on a copy of a real hub's record (two open
// asks, six sessions in two projects), on its virtual clock. A change made elsewhere is fed as the hub writes it: an
// answer from `deep` is `ask.answered` (via the CLI) and the ask's row leaving the list; a new ask is `ask.created` and
// its row (helpers.ts). The card's answer is the app's own, through the card, kept in the replica's trace (Pinned 5).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  askOf, cleanup, feedAnswered, feedAsk, ID, listRows, makeWorld, MIN, Replica, replicaOf, sessionOf, wordsOf,
  type Row, type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const FIRST = 'Which header colour on the login page?';
const SECOND = 'Keep the cart on SQLite or plain files?';
const MOVES: SessionSpec[] = [
  { key: 'm1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'taste', question: FIRST }] },
  { key: 'm2', project: 'shop', title: 'Checkout page', state: 'finished', asks: [{ kind: 'choice', question: SECOND }] },
  { key: 'm3', project: 'shop', title: 'Billing page', state: 'finished' },
  { key: 'm4', project: 'shop', title: 'Login flow', state: 'finished' },
  { key: 'm5', project: 'docs', title: 'Release notes', state: 'finished' },
  { key: 'm6', project: 'docs', title: 'API guide', state: 'finished' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(MOVES); }, 10 * MIN);

const placed = (s: Snapshot): Map<string, number[]> => new Map(listRows(s).map((n) => [String(n.id), n.bounds]));
/** Each row of `before` other than `except` that `after` draws somewhere else, or not at all. */
function movedRows(before: Map<string, number[]>, after: Map<string, number[]>, except: string[] = []): string[] {
  const out: string[] = [];
  for (const [id, b] of before) {
    if (except.includes(id)) continue;
    const a = after.get(id);
    if (!a) out.push(`row ${id} is gone`);
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`row ${id} moved from ${JSON.stringify(b)} to ${JSON.stringify(a)}`);
  }
  return out;
}
const addressOf = (id: string): string => id.replace(/^(ask|session):/, '$1/');
const rowOf = (rows: Row[], id: string): Row => rows.find((x) => x.id === id) ?? (() => { throw Error(`see's rows hold no ${id}`); })();

async function answerNextFailures(plant?: string): Promise<string[]> {
  const [a1, a2] = [askOf(world, FIRST), askOf(world, SECOND)];
  const r = await replicaOf(world, {}, plant);
  const out: string[] = [];
  try {
    await r.wait(500);
    const opened = await r.see();
    if (opened.address !== addressOf(a1.handle)) return [`the window opens on ${String(opened.address)}, not the first open ask ${addressOf(a1.handle)}`];
    await r.waitValue('question-card', 'armed');
    const before = placed((await r.see()).snapshot);
    await r.click({ role: 'button', name: a1.options[0]!.label }, `pressing the card's option "${a1.options[0]!.label}"`);
    await r.wait(300);
    const after = await r.see();
    if (after.address !== addressOf(a2.handle)) out.push(`answering the first ask opened ${String(after.address)}, not the second ask ${addressOf(a2.handle)}`);
    out.push(...movedRows(before, placed(after.snapshot), [a1.handle]).map((m) => `answering the first ask: ${m}`));
    const { hub } = await r.close();
    if (!hub) out.push('the trace keeps no hub calls (README, Pinned 5)');
    else if (!hub.some((c) => c.method === 'ask.answer' && c.params.ask === a1.handle)) out.push(`the card sent no ask.answer for ${a1.handle}: the trace's hub calls are ${JSON.stringify(hub).slice(0, 300)}`);
  } finally {
    await r.stop();
  }
  return out;
}

describe(`AC4 ${ID.answerNext} answering the first ask selects the second`, () => {
  it(`AC4 ${ID.answerNext}: answering the first ask selects the second without moving any other row`, async () => {
    expect(await answerNextFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC4 ${ID.answerNext} wrong program: a planted reorder under the pointer fails, naming the row`, async () => {
    expect((await answerNextFailures('list-closes-gap')).join('\n')).toMatch(/row (ask|session):\S+ moved from/);
  }, 30 * MIN);
});

describe(`AC13 ${ID.leaveWaits} a row leaving waits, a row arriving doesn't`, () => {
  it(`AC13 ${ID.leaveWaits}: a row whose ask is answered elsewhere waits 2 s before it moves, and a new ask's row moves at once`, async () => {
    const [a1, a2] = [askOf(world, FIRST), askOf(world, SECOND)];
    const page = `session/${sessionOf(world, 'm5').id}`;
    const r = await replicaOf(world);
    const out: string[] = [];
    try {
      await r.open(page);
      await r.hover({ id: page });
      await r.wait(500);
      const before = placed((await r.see()).snapshot);
      await feedAnswered(r, { handle: a1.handle, session: a1.session, option: a1.options[0]!.id });
      await r.wait(1500);
      out.push(...movedRows(before, placed((await r.see()).snapshot)).map((m) => `1.5 s after ${a1.handle} was answered elsewhere, ${m}`));
      await r.wait(1000);
      const later = await r.see();
      const after = placed(later.snapshot);
      if (after.has(a1.handle)) out.push(`2.5 s after it was answered, ${a1.handle}'s row is still in the list`);
      if ((after.get(a2.handle)?.[1] ?? Infinity) >= (before.get(a2.handle)?.[1] ?? -Infinity)) out.push(`2.5 s after ${a1.handle} was answered, ${a2.handle}'s row hasn't moved up into its place`);
      const settled = placed(later.snapshot);
      const added = await feedAsk(r, rowOf(later.rows, `session:${sessionOf(world, 'm3').id}`), 'Ship the cart page today?');
      const now = placed((await r.see()).snapshot);
      if (!now.has(added)) out.push(`the new ask ${added} has no row a frame after it arrived`);
      const pushed = [...settled.entries()].filter(([, b]) => b[1]! > (now.get(added)?.[1] ?? Infinity));
      for (const [id, b] of pushed) if (JSON.stringify(now.get(id)) === JSON.stringify(b)) out.push(`a frame after ${added} arrived above it, row ${id} hasn't moved`);
    } finally {
      await r.stop();
    }
    expect(out).toEqual([]);
  }, 30 * MIN);
});

async function focusKeepsFailures(plant?: string): Promise<string[]> {
  const a1 = askOf(world, FIRST);
  const [m4, m5] = [sessionOf(world, 'm4'), sessionOf(world, 'm5')];
  const r = await replicaOf(world, {}, plant);
  const out: string[] = [];
  try {
    await r.wait(500);
    await r.click({ id: `session:${m5.id}` }, 'a click on a session row, which gives the list focus');
    await r.hover({ id: `session:${m4.id}` });
    await r.wait(300);
    const before = placed((await r.see()).snapshot);
    await feedAnswered(r, { handle: a1.handle, session: a1.session, option: a1.options[0]!.id });
    await r.wait(500);
    out.push(...movedRows(before, placed((await r.see()).snapshot)).map((m) => `with the pointer resting on the list, 0.5 s after ${a1.handle} was answered from deep, ${m}`));
    if (out.length) return out;
    await r.hover({ id: `session/${m5.id}` });
    await r.wait(3000);
    const kept = (await r.see()).snapshot;
    out.push(...movedRows(before, placed(kept)).map((m) => `with focus in the list, 3 s after the answer, ${m}`));
    const row = listRows(kept).find((n) => n.id === a1.handle);
    if (row && !/answered/i.test(wordsOf(kept, row))) out.push(`${a1.handle}'s row is kept but not drawn answered: it reads ${JSON.stringify(wordsOf(kept, row).slice(0, 160))}`);
    await r.click({ id: 'box-draft' }, 'a click in the box, which takes focus out of the list');
    await r.wait(1500);
    if (!placed((await r.see()).snapshot).has(a1.handle)) out.push(`${a1.handle}'s row left 1.5 s after focus and pointer left the list, before 2 s`);
    await r.wait(1000);
    if (placed((await r.see()).snapshot).has(a1.handle)) out.push(`${a1.handle}'s row is still there 2.5 s after focus and pointer left the list`);
  } finally {
    await r.stop();
  }
  return out;
}

describe(`AC24 ${ID.focusKeeps} focus in the list keeps an answered row`, () => {
  it(`AC24 ${ID.focusKeeps}: with focus in the list, an ask answered from deep keeps its row in place, drawn answered, until focus and pointer have been out of the list for 2 s`, async () => {
    expect(await focusKeepsFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC24 ${ID.focusKeeps} wrong program: a planted list that closes the gap under a resting pointer fails, naming the row`, async () => {
    expect((await focusKeepsFailures('list-closes-gap')).join('\n')).toMatch(/resting on the list[^\n]*row (ask|session):\S+ (moved|is gone)/);
  }, 30 * MIN);
});

/**
 * The pointer rests on the third session row, a new ask arrives above and shifts it, and a press lands where the pointer
 * is `delay` ms later. What the window shows after, the row the pointer rested on and the row now under it.
 */
async function pressAfterMove(delay: number, plant?: string): Promise<{ opened: string | null; rested: string; under: string | null; shifted: boolean }> {
  const r: Replica = await replicaOf(world, {}, plant);
  try {
    await r.wait(500);
    await r.open('project/docs');
    await r.wait(300);
    const seen = await r.see();
    const third = listRows(seen.snapshot).filter((n) => String(n.id).startsWith('session:'))[2] ?? (() => { throw Error('the list has no third session row'); })();
    const [x, y, w, h] = third.bounds as [number, number, number, number];
    const point = [Math.round(x + w / 2), Math.round(y + h / 2)];
    await r.hover({ id: String(third.id) });
    await r.wait(200);
    await feedAsk(r, rowOf(seen.rows, `session:${sessionOf(world, 'm3').id}`), 'Ship the cart page today?');
    const moved = (await r.see()).snapshot;
    const shifted = JSON.stringify(listRows(moved).find((n) => n.id === third.id)?.bounds) !== JSON.stringify(third.bounds);
    const under = listRows(moved).find((n) => point[0]! >= n.bounds[0]! && point[0]! < n.bounds[0]! + n.bounds[2]! && point[1]! >= n.bounds[1]! && point[1]! < n.bounds[1]! + n.bounds[3]!);
    await r.wait(delay);
    await r.clickAt(point);
    await r.wait(100);
    return { opened: (await r.see()).address, rested: String(third.id), under: under ? String(under.id) : null, shifted };
  } finally {
    await r.stop();
  }
}

describe(`AC18 ${ID.pressDropped} a press on a row that just moved`, () => {
  const failures = (p: Awaited<ReturnType<typeof pressAfterMove>>): string[] => [
    ...(p.shifted ? [] : [`the new ask didn't shift the third session row ${p.rested}, so this proves nothing`]),
    ...(p.opened === 'project/docs' ? [] : [`a press 100 ms after the move opened ${String(p.opened)}: the row now under the pointer (${String(p.under)}), though the pointer rested on ${p.rested}`]),
  ];
  it(`AC18 ${ID.pressDropped}: with the pointer resting on the third session row, a new ask arrives and shifts that row; a press 100 ms later opens nothing`, async () => {
    expect(failures(await pressAfterMove(100))).toEqual([]);
  }, 30 * MIN);

  it(`AC18 ${ID.pressDropped} wrong program: a planted list that opens the row that slid under the pointer fails, naming both rows`, async () => {
    expect(failures(await pressAfterMove(100, 'press-through-move')).join('\n')).toMatch(/opened \S+: the row now under the pointer \((ask|session):\S+\), though the pointer rested on session:\S+/);
  }, 30 * MIN);
});

describe(`AC25 ${ID.pressLands} a press after the row settled`, () => {
  const failures = (p: Awaited<ReturnType<typeof pressAfterMove>>): string[] => {
    if (!p.shifted) return [`the new ask didn't shift the third session row ${p.rested}, so this proves nothing`];
    if (!p.under) return ['no row is under the pointer after the move'];
    return p.opened === addressOf(p.under) ? [] : [`a press 400 ms after the move opened ${String(p.opened)}, not ${addressOf(p.under)}, the row now under the pointer`];
  };
  it(`AC25 ${ID.pressLands}: a press 400 ms after a row moved opens the row now under the pointer`, async () => {
    expect(failures(await pressAfterMove(400))).toEqual([]);
  }, 30 * MIN);

  it(`AC25 ${ID.pressLands} wrong program: a planted list that drops every press fails`, async () => {
    expect(failures(await pressAfterMove(400, 'list-drops-presses')).join('\n')).toMatch(/a press 400 ms after the move opened project\/docs, not/);
  }, 30 * MIN);
});
