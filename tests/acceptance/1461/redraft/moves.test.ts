// Blind redraft of #1461's AC18 and AC25 (README.md here): a press on a list row that just moved. The pointer rests on
// the third session row, a new ask arrives and shifts it, and a press lands where the pointer is, 100 ms or 400 ms later.
// The world is a record a real hub built (../helpers.ts `makeWorld`); the window is `deep-drive`'s, on its virtual clock.
// Which row slides under the pointer is read from the snapshot after the shift, never assumed from a layout.
import { afterAll, describe, expect, it } from 'vitest';
import { byId, cleanup, feedAsk, headings, ID, listRows, makeWorld, MIN, replicaOf, sessionOf, type Row, type SessionSpec, type SNode, type Snapshot, type World } from '../helpers.ts';

afterAll(() => cleanup(), MIN);

/**
 * One project, so every session row sits under its one heading whatever order projects take: the third session row has a
 * session row right above it, and the new ask's row, added under the open one in Needs you, shifts them all by a row.
 * Session `a` already waits on you, so a second ask on it changes no session's state and moves no row inside the project.
 */
const SHOP: SessionSpec[] = [
  { key: 'a', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'b', project: 'shop', title: 'Checkout page' },
  { key: 'c', project: 'shop', title: 'Billing page' },
  { key: 'd', project: 'shop', title: 'Login flow', state: 'finished' },
  { key: 'e', project: 'shop', title: 'Coupon codes', state: 'finished' },
  { key: 'f', project: 'shop', title: 'Gift cards' },
];
let made: Promise<World> | undefined;
const shop = (): Promise<World> => (made ??= makeWorld(SHOP));

const center = (b: number[]): number[] => [b[0]! + Math.floor(b[2]! / 2), b[1]! + Math.floor(b[3]! / 2)];
const holds = (b: number[], p: number[]): boolean => p[0]! >= b[0]! && p[0]! < b[0]! + b[2]! && p[1]! >= b[1]! && p[1]! < b[1]! + b[3]!;
/** The list's row or heading at a point in device pixels, if any. */
const itemAt = (s: Snapshot, p: number[]): SNode | undefined => [...listRows(s), ...headings(s)].find((n) => holds(n.bounds, p));
/** A row's address: the hub's row says it; else `session:<id>` opens `session/<id>`, as #1460's addresses go. */
const addressOf = (rows: Row[], id: string): string => String(rows.find((r) => r.id === id)?.address ?? id.replace(':', '/'));

interface Pressed { third: string; slid: string; slidAddress: string; shown: string | null; after: string | null; delay: number }

/**
 * The criterion's journey, in the plain build or with `plant`: the pointer rests on the third session row; a new ask
 * arrives on session `a` (its `ask.created` and its row, as the hub writes them) and shifts that row; `delay` ms of the
 * virtual clock later, a press where the pointer is; half a second on, the page's address. Each thing the criterion
 * presumes is asserted as it happens, so a list where it doesn't fails saying which.
 */
async function pressAfterShift(delay: number, plant?: string): Promise<Pressed> {
  const w = await shop();
  const r = await replicaOf(w, {}, plant);
  try {
    await r.wait(500);
    const first = await r.see();
    const sessions = listRows(first.snapshot).filter((n) => String(n.id).startsWith('session:'));
    expect(sessions.length, `the list holds the project's session rows (rows: ${listRows(first.snapshot).map((n) => String(n.id)).join(', ') || 'none'})`).toBeGreaterThanOrEqual(3);
    const third = String(sessions[2]!.id);
    const rested = await r.hover({ id: third });
    const point = Array.isArray(rested.point) ? (rested.point as number[]) : center(sessions[2]!.bounds);
    const was = byId((await r.see()).snapshot, third)?.bounds;

    const a = sessionOf(w, 'a');
    const handle = await feedAsk(r, { id: `session:${a.id}`, session: a.id, project: a.project, agent: 'claude-code' } as unknown as Row, 'Ship the totals fix before the sale?', 'choice');
    const moved = await r.see();
    const now = byId(moved.snapshot, third)?.bounds;
    expect(was !== undefined && now !== undefined && now[1] !== was[1], `the new ask ${handle} shifts ${third}, the row the pointer rests on: it was at ${JSON.stringify(was)}, then ${JSON.stringify(now)}`).toBe(true);
    const under = itemAt(moved.snapshot, point);
    const slid = String(under?.id ?? '');
    expect(/^(ask|session|quiet):/.test(slid) && slid !== third, `after the shift a list row other than ${third} lies under the pointer at ${JSON.stringify(point)}; there is ${under ? `${under.role} ${slid}` : 'nothing in the list'}`).toBe(true);
    const slidAddress = addressOf(moved.rows, slid);

    await r.wait(delay);
    const shown = (await r.see()).address;
    expect(shown !== slidAddress && shown !== addressOf(moved.rows, third), `before the press the page (${shown}) is neither row's, so a press that opens one shows`).toBe(true);
    await r.clickAt(point);
    await r.wait(500);
    const after = (await r.see()).address;
    return { third, slid, slidAddress, shown, after, delay };
  } finally {
    await r.stop();
  }
}

/** AC18: the press opened nothing. A failure names the row the pointer rested on and the row that slid under it. */
const droppedFailures = (p: Pressed): string[] => (p.after === p.shown ? [] : [
  `a press ${p.delay} ms after the new ask shifted ${p.third} opened ${p.after}${p.after === p.slidAddress ? `, the page of ${p.slid}` : ''}: the pointer rested on ${p.third} and ${p.slid} slid under it, so the press opens nothing`,
]);
/** AC25: the press opened the row now under the pointer. */
const landsFailures = (p: Pressed): string[] => (p.after === p.slidAddress ? [] : [
  `a press ${p.delay} ms after ${p.third} moved opened ${p.after === p.shown ? 'nothing' : p.after}, not ${p.slid}, the row now under the pointer`,
]);

describe(`AC18 ${ID.pressDropped} With the pointer resting on the third session row, a new ask arrives and shifts that row. A press 100 ms later opens nothing. A planted list that opens the row that slid under the pointer fails, naming both rows`, () => {
  it('AC18 a press 100 ms after the shift leaves the page where it was', async () => {
    expect(droppedFailures(await pressAfterShift(100))).toEqual([]);
  }, 30 * MIN);

  it('AC18 wrong program: press-through-move, the press going to the row now under the pointer, fails naming both rows', async () => {
    const p = await pressAfterShift(100, 'press-through-move');
    const failures = droppedFailures(p);
    expect(failures, `the planted list opened something: the page read ${p.shown} before the press and ${p.after} after`).toHaveLength(1);
    expect(failures[0]).toContain(p.third);
    expect(failures[0]).toContain(p.slid);
  }, 30 * MIN);
});

describe(`AC25 ${ID.pressLands} A press 400 ms after a row moved opens the row now under the pointer. A planted list that drops every press fails`, () => {
  it('AC25 a press 400 ms after the shift opens the row that slid under the pointer', async () => {
    expect(landsFailures(await pressAfterShift(400))).toEqual([]);
  }, 30 * MIN);

  it('AC25 wrong program: list-drops-presses fails', async () => {
    const p = await pressAfterShift(400, 'list-drops-presses');
    expect(landsFailures(p), `the planted list's page after the press: ${p.after}`).toHaveLength(1);
  }, 30 * MIN);
});
