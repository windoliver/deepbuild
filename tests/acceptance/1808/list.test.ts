// AC1: every list scrolls. At 960×640 with 700 rows, the last row is reached by the wheel and by Down, and the focused
// row is always in view. The replica on a copy of a real hub's record of 700 finished sessions in one project, so the
// list's rows are those 700 in the hub's order (helpers.ts `listOrder`). A row is reached when a person sees it: wholly
// inside the list's part of the window, its title drawn (`showing`). The wheel is #124's `act scroll` over the row shown
// nearest the middle of the list, half the list's height at a time; Down is the key #1462 gave the list, from where F6
// puts the keyboard in it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  blocked, byId, cleanup, ID, listOrder, listRows, listView, makeWorld, MIN, named, OPENING, PLANT, replicaOf, showing,
  type Replica, type Row, type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const ROWS = 700;
const SPECS: SessionSpec[] = Array.from({ length: ROWS }, (_, i) => ({ key: `r${i}`, project: 'shop', title: `Task ${String(i + 1).padStart(3, '0')}`, state: 'finished' }));
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 30 * MIN);

/** The list's rows a person sees now, top to bottom. */
function rowsShown(s: Snapshot): string[] {
  const view = listView(s);
  return view ? listRows(s).filter((n) => showing(s, n, view)).map((n) => String(n.id)) : [];
}
const ROW = /^(ask|session|quiet|project):[^\s:]+$/;

/** From the top, the wheel over the list until its last row shows or the wheel moves nothing. */
async function wheelFailures(r: Replica, order: string[], rows: Row[]): Promise<string[]> {
  const last = order.at(-1)!;
  const reached = new Set<string>();
  let before = '';
  let foot = 'no row';
  for (let turn = 0; turn < 400; turn++) {
    const s = (await r.see()).snapshot;
    const shown = rowsShown(s);
    shown.forEach((id) => reached.add(id));
    if (reached.has(last)) return [];
    if (shown.length) foot = named(rows, shown.at(-1)!);
    if (shown.join(' ') === before) break;
    before = shown.join(' ');
    const view = listView(s);
    const middle = view ? view[1]! + view[3]! / 2 : 0;
    const at = listRows(s)
      .filter((n) => shown.includes(String(n.id)))
      .sort((a, b) => Math.abs(a.bounds[1]! + a.bounds[3]! / 2 - middle) - Math.abs(b.bounds[1]! + b.bounds[3]! / 2 - middle))[0];
    if (!view || !at) break;
    await r.scroll({ id: String(at.id) }, Math.max(32, Math.round(view[3]! / s.window.scale / 2)));
  }
  const first = order.find((id) => !reached.has(id)) ?? last;
  return [`by the wheel, the first row that can't be reached is ${named(rows, first)}: the wheel over the list moves nothing further, with ${foot} the last row shown`];
}

/** From where F6 puts the keyboard in the list, Down until the last row, the focused row in view after every press. */
async function downFailures(r: Replica, order: string[], rows: Row[]): Promise<string[]> {
  const last = order.at(-1)!;
  let s = (await r.see()).snapshot;
  const inList = (x: Snapshot): boolean => typeof x.focus === 'string' && ROW.test(x.focus);
  for (let i = 0; i < 3 && !inList(s); i++) {
    await r.press('f6');
    s = (await r.see()).snapshot;
  }
  if (!inList(s)) return [`F6 never put the keyboard in the list: the focus is on ${JSON.stringify(s.focus)}`];
  for (let press = 0; press <= order.length + 20; press++) {
    const focus = String(s.focus);
    const view = listView(s);
    if (!view || !showing(s, byId(s, focus), view)) {
      return [`by Down, the first row that can't be reached is ${named(rows, focus)}: after ${press} presses the keyboard is on it out of view`];
    }
    if (focus === last) return [];
    await r.press('down');
    const next = (await r.see()).snapshot;
    if (next.focus === s.focus) {
      const after = order[order.indexOf(focus) + 1] ?? last;
      return [`by Down, the first row that can't be reached is ${named(rows, after)}: after ${press + 1} presses the keyboard stays on ${named(rows, focus)}`];
    }
    s = next;
  }
  return [`by Down, the last row ${named(rows, last)} isn't reached in ${order.length + 20} presses`];
}

/** What's wrong with the list at 960×640, by the wheel from the top, then by Down in a fresh window. */
async function listFailures(plant?: string): Promise<string[]> {
  const out: string[] = [];
  for (const walk of [wheelFailures, downFailures]) {
    const r = await replicaOf(world, OPENING, plant);
    try {
      const seen = await r.see();
      const order = listOrder(seen.rows);
      if (order.length < ROWS) blocked(`the replica's copy of the record lists ${order.length} rows, not the fixture's ${ROWS}`);
      out.push(...(await walk(r, order, seen.rows)));
    } finally {
      await r.stop();
    }
  }
  return out;
}

describe(`AC1 ${ID.list} every list scrolls`, () => {
  it(`AC1 ${ID.list}: at 960×640 with 700 rows, the last row is reached by the wheel and by Down, and the focused row is always in view`, async () => {
    expect(await listFailures()).toEqual([]);
  }, 60 * MIN);

  it(`AC1 ${ID.list} wrong program: a planted list that clips fails, naming the first row that can't be reached`, async () => {
    const failures = (await listFailures(PLANT.listClips)).join('\n');
    expect(failures, 'the planted list (README, Surface choices: list-clips) cuts its rows at its foot').toMatch(/the first row that can't be reached is session:[^\s:]+ \("Task \d{3}"\)/);
  }, 60 * MIN);
});
