// AC1, AC2 and AC14: the window the real app opens on the ten-session fixture (helpers.ts `TEN`: ten sessions in shop,
// docs and search, two of them with an open ask each), a real hub's record. AC1 and AC14 read the real `deep-app` from
// outside its process (#1459's probe for identifiers, #1454's driver and capture); AC2 reads the replica launched on a
// copy of the same hub's record.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, settled, type Picture } from '../1454/helpers.ts';
import {
  appBin, axFlat, axTree, cleanup, flat, ID, MIN, makeWorld, placeAt, REFERENCE, replicaOf, SMALL, TEN,
  type AxNode, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
let world: World;
beforeAll(async () => { world = await makeWorld(TEN); }, 10 * MIN);

const FIRST = 'Which header colour on the login page?';
/** The ids of the views the replica draws that a person sees: the list, its headings and rows, the page, the card, the lane and the box. */
const VIEW = /^(list|lane|box|question-card|heading:.+|ask:[^:]+|session:[^:]+|quiet:[^:]+|(ask|session|project|page)\/\S+)$/;

/** What's wrong with the real window: AC1's shape, and each view the replica draws that it lacks. */
async function realFailures(pid: number, replica: Snapshot | null): Promise<string[]> {
  const windows = await axTree(pid);
  const main = [...windows].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0];
  if (!main) return ['the real app has no window'];
  const all = axFlat(main.tree);
  const byId = new Map(all.filter((n) => n.identifier).map((n) => [n.identifier!, n]));
  const out: string[] = [];
  const list = byId.get('list');
  if (!list) return [`the real window has no list: no node's AXIdentifier is "list" (README, Pinned 1); its identifiers are ${JSON.stringify([...byId.keys()].slice(0, 30))}`];
  const inList = axFlat(list);
  const rows = inList.filter((n) => /^ask:[^:]+$/.test(n.identifier ?? ''));
  if (rows.length !== 2) out.push(`the list holds ${rows.length} ask rows, not 2: ${JSON.stringify(rows.map((n) => n.identifier))}`);
  for (const a of world.asks) if (!inList.some((n) => n.identifier === a.handle)) out.push(`the list has no row for ${a.handle} ("${a.question}")`);
  const card = byId.get('question-card');
  const first = world.asks.find((a) => a.question === FIRST)!;
  if (!card) out.push('the real window shows no question card (AXIdentifier "question-card")');
  else {
    if (card.value !== 'armed') out.push(`the card is ${JSON.stringify(card.value)}, not armed`);
    const text = axFlat(card).map((n) => `${n.title ?? ''} ${n.description ?? ''} ${n.value ?? ''}`).join(' ');
    if (!text.includes(FIRST)) out.push(`the card isn't the first ask's (${first.handle}): it reads ${JSON.stringify(text.slice(0, 160))}`);
    const [lx, , lw] = list.frame as [number, number, number, number];
    if (card.frame[0]! < lx + lw - 1) out.push(`the card (x ${card.frame[0]}) isn't beside the list (which ends at x ${lx + lw}): they overlap`);
  }
  // Sessions by project: each session's row after its project's heading and before the next heading.
  const order = inList.map((n) => n.identifier ?? '');
  for (const s of world.sessions) {
    const h = order.indexOf(`heading:${s.project}`);
    const r = order.indexOf(`session:${s.id}`);
    if (h < 0) { out.push(`the list has no heading for project ${s.project} (heading:${s.project})`); continue; }
    if (r < 0) { out.push(`the list has no row for session ${s.key} "${s.title}" (session:${s.id})`); continue; }
    const next = order.findIndex((id, i) => i > h && id.startsWith('heading:'));
    if (r < h || (next >= 0 && r > next)) out.push(`session ${s.key} "${s.title}" isn't under its project ${s.project}'s heading`);
  }
  if (replica) {
    const real = new Set(all.map((n) => n.identifier).filter((i): i is string => !!i));
    for (const n of flat(replica.tree)) {
      if (typeof n.id === 'string' && VIEW.test(n.id) && !real.has(n.id)) out.push(`${n.id} (${n.role} ${JSON.stringify(n.name)}) is drawn in the replica and not in the real app`);
    }
  }
  return out;
}

async function windowAt(size: { width: number; height: number }, plant?: string): Promise<string[]> {
  const app = await App.launch({ home: world.home, binary: await appBin(plant ? 'plants' : 'plain'), ...(plant ? { env: { DEEP_HUB_PLANT: plant } } : {}) });
  const replica = await replicaOf(world, { size: [size.width, size.height] }, plant);
  try {
    await placeAt(app.pid, size);
    await replica.wait(2000);
    const snapshot = (await replica.see()).snapshot;
    return await settled(() => realFailures(app.pid, snapshot), plant ? 20_000 : 60_000);
  } finally {
    await replica.stop();
    await app.stop();
  }
}

describe(`AC1 ${ID.realApp} the real app on ten sessions and two open asks`, () => {
  it(`AC1 ${ID.realApp}: in the real app, at 960×640 and 1512×982, the two ask rows, the first ask's card armed beside them, and the sessions by project, with every view the replica draws`, async () => {
    for (const size of [SMALL, REFERENCE]) {
      expect(await windowAt(size), `the real window at ${size.width}×${size.height}`).toEqual([]);
    }
  }, 30 * MIN);

  it(`AC1 ${ID.realApp} wrong program: a card drawn only in the replica fails, naming it`, async () => {
    const failures = await windowAt(REFERENCE, 'card-replica-only');
    expect(failures.join('\n'), 'the planted app draws the card in the replica only').toMatch(/question-card[^\n]*drawn in the replica and not in the real app/);
  }, 30 * MIN);
});

/** Each place the window draws "needs you", case aside: the strings drawn, with the node that holds each. */
function needsYouShown(s: Snapshot): { text: string; holder: string }[] {
  const out: { text: string; holder: string }[] = [];
  const nodes = flat(s.tree).filter((n) => typeof n.id === 'string');
  for (const r of s.runs ?? []) {
    const times = (r.text.match(/needs you/gi) ?? []).length;
    if (!times) continue;
    const holders = nodes.filter((n) => r.bounds[0]! >= n.bounds[0]! && r.bounds[1]! >= n.bounds[1]! && r.bounds[0]! + r.bounds[2]! <= n.bounds[0]! + n.bounds[2]! + 1 && r.bounds[1]! + r.bounds[3]! <= n.bounds[1]! + n.bounds[3]! + 1);
    const holder = holders.sort((a, b) => a.bounds[2]! * a.bounds[3]! - b.bounds[2]! * b.bounds[3]!)[0];
    for (let i = 0; i < times; i++) out.push({ text: r.text, holder: holder ? `${String(holder.id)}` : 'no node with an id' });
  }
  return out;
}
async function twiceFailures(plant?: string): Promise<string[]> {
  const r = await replicaOf(world, {}, plant);
  try {
    await r.wait(1000);
    const s = (await r.see()).snapshot;
    if (!s.runs) return ['the snapshot lists no drawn strings (runs)'];
    const shown = needsYouShown(s);
    return shown.length <= 2 ? [] : [`one screen shows "needs you" ${shown.length} times, not at most twice: ${shown.map((x) => `in ${x.holder} ("${x.text}")`).join('; ')}`];
  } finally {
    await r.stop();
  }
}

describe(`AC2 ${ID.twice} "needs you" at most twice on one screen`, () => {
  it(`AC2 ${ID.twice}: on that fixture, one screen shows "needs you" at most twice`, async () => {
    expect(await twiceFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC2 ${ID.twice} wrong program: a planted bottom band repeating a row fails, naming the band and the phrase`, async () => {
    const failures = (await twiceFailures('band-repeats-row')).join('\n');
    expect(failures, 'the band (README, Pinned 8: its node is `band`) and the phrase are named').toMatch(/"needs you"[\s\S]*in band /);
  }, 30 * MIN);
});

// ---- AC14: lines at rest, by the real window's pixels.

type Rgb = readonly [number, number, number];
const far = (a: Rgb, b: Rgb, t: number): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > t;
/**
 * The thin strokes across a picture: a column (or row) one or two pixels wide whose colour differs from both its sides
 * while its sides agree, for at least 60% of the window's height (or width). A boundary between two fills is no line.
 */
function linesIn(p: Picture): { along: 'vertical' | 'horizontal'; at: number }[] {
  const found: { along: 'vertical' | 'horizontal'; at: number }[] = [];
  const stroke = (side: Rgb, c: Rgb, c2: Rgb, other: Rgb, other2: Rgb): boolean =>
    (far(c, side, 9) && far(c, other, 9) && !far(side, other, 12)) || (!far(c, c2, 6) && far(c, side, 9) && far(c2, other2, 9) && !far(side, other2, 12));
  for (let x = 1; x < p.width - 3; x++) {
    let n = 0;
    for (let y = 0; y < p.height; y += 2) if (stroke(p.at(x - 1, y), p.at(x, y), p.at(x + 1, y), p.at(x + 1, y), p.at(x + 2, y))) n++;
    if (n >= 0.6 * (p.height / 2) && !found.some((l) => l.along === 'vertical' && Math.abs(l.at - x) <= 2)) found.push({ along: 'vertical', at: x });
  }
  for (let y = 1; y < p.height - 3; y++) {
    let n = 0;
    for (let x = 0; x < p.width; x += 2) if (stroke(p.at(x, y - 1), p.at(x, y), p.at(x, y + 1), p.at(x, y + 1), p.at(x, y + 2))) n++;
    if (n >= 0.6 * (p.width / 2) && !found.some((l) => l.along === 'horizontal' && Math.abs(l.at - y) <= 2)) found.push({ along: 'horizontal', at: y });
  }
  return found;
}

describe(`AC14 ${ID.oneLine} one line at rest`, () => {
  it(`AC14 ${ID.oneLine}: at rest the window has one line, the list's edge, with none under the title bar`, async () => {
    const app = await App.launch({ home: world.home, binary: await appBin('plain') });
    try {
      const failures = await settled(async () => {
        const windows = await axTree(app.pid);
        const main = [...windows].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0];
        const list = main ? axFlat(main.tree).find((n: AxNode) => n.identifier === 'list') : undefined;
        if (!main || !list) return ['the real window has no list (AXIdentifier "list") to find its edge by'];
        const picture = await app.capture('rest');
        const edge = Math.round((list.frame[0]! + list.frame[2]! - main.frame[0]!) * (picture.width / main.frame[2]!));
        const lines = linesIn(picture);
        const out: string[] = [];
        if (!lines.some((l) => l.along === 'vertical' && Math.abs(l.at - edge) <= 4)) out.push(`the list's edge (x ${edge} px) draws no line`);
        for (const l of lines) {
          if (l.along === 'vertical' && Math.abs(l.at - edge) <= 4) continue;
          out.push(l.along === 'horizontal' ? `a horizontal line at y ${l.at} px${l.at < 0.12 * picture.height ? ', under the title bar' : ''}` : `a vertical line at x ${l.at} px, not the list's edge (${edge} px)`);
        }
        return out;
      }, 30_000);
      expect(failures, `the window at rest, ${REFERENCE.width}×${REFERENCE.height}, light`).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 30 * MIN);
});
