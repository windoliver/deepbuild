// AC11 and AC15: the page's reading lane, and a hub hiccup that never flashes. The replica on a copy of a real hub's
// record; the hub it reads stopped and started again through the replica's `hub` door, on its virtual clock (README,
// Pinned 4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  byId, cleanup, flat, flicks, FLICKS, HUB_DOWN, ID, makeWorld, MIN, pageOf, px, Replica, replicaOf, runsIn, sessionOf, type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const SPECS: SessionSpec[] = [
  { key: 'l1', project: 'shop', title: 'Cart totals: keep the running total in one place and show it on every page of the checkout', state: 'finished' },
  { key: 'l2', project: 'shop', title: 'Checkout page' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 10 * MIN);
const pt = (v: number): string => `${Math.round(v / 2)} pt`;

/** AC11: the page's lane is min(720, page − 48) wide and centred, and every string drawn under the page's title is in it. */
function laneFailures(s: Snapshot, address: string): string[] {
  const page = pageOf(s);
  if (!page || page.id !== address) return [`the window shows ${String(page?.id)}, not ${address}`];
  const lane = flat(page).find((n) => n.id === 'lane');
  if (!lane) return [`the page ${address} has no lane (a node with id "lane")`];
  const out: string[] = [];
  const [x, , w] = page.bounds as [number, number, number];
  const want = Math.min(px(720), w - px(48));
  if (Math.abs(lane.bounds[2]! - want) > 2) out.push(`the page ${address}'s lane is ${pt(lane.bounds[2]!)} wide, not ${pt(want)}`);
  if (Math.abs(lane.bounds[0]! + lane.bounds[2]! / 2 - (x + w / 2)) > 2) out.push(`the page ${address}'s lane isn't centred on the page`);
  const title = byId(s, 'page-title');
  if (!title) out.push(`the page ${address} has no title node (id "page-title")`);
  const below = title ? title.bounds[1]! + title.bounds[3]! : page.bounds[1]!;
  const wide = runsIn(s, page.bounds).filter((r) => r.bounds[1]! >= below && (r.bounds[0]! < lane.bounds[0]! - 1 || r.bounds[0]! + r.bounds[2]! > lane.bounds[0]! + lane.bounds[2]! + 1));
  for (const r of wide.slice(0, 3)) out.push(`the page ${address} draws "${r.text.slice(0, 60)}" from ${pt(r.bounds[0]! - x)} to ${pt(r.bounds[0]! + r.bounds[2]! - x)} of the page, outside its lane`);
  const widest = Math.max(0, ...runsIn(s, page.bounds).filter((r) => r.bounds[1]! >= below).map((r) => r.bounds[2]!));
  if (widest > px(720) + 1) out.push(`the page ${address} draws a line of text ${pt(widest)} wide, wider than 720 pt`);
  return out;
}

describe(`AC11 ${ID.lane} one reading lane`, () => {
  const failures = async (plant?: string): Promise<string[]> => {
    const address = `session/${sessionOf(world, 'l1').id}`;
    const r = await replicaOf(world, {}, plant);
    try {
      await r.open(address);
      // A long line in the box, which sits in the lane at the page's foot.
      await r.must('setting the box to a long line', { call: 'act', locator: { id: 'box-draft' }, act: { kind: 'set', value: 'Make the running total sit in one place on every page of the checkout and keep it in view while the list of items scrolls, on a phone and on a wide window alike, and say what it counts' } });
      await r.wait(500);
      return laneFailures((await r.see()).snapshot, address);
    } finally {
      await r.stop();
    }
  };
  it(`AC11 ${ID.lane}: at 1512×982 a session's text is no wider than 720`, async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it(`AC11 ${ID.lane} wrong program: a planted page with no lane fails, naming the page`, async () => {
    expect((await failures('page-no-lane')).join('\n')).toMatch(/the page session\/\S+ (has no lane|'s lane is|draws .* outside its lane|draws a line of text)/);
  }, 30 * MIN);
});

/** The window says the hub isn't answering, anywhere: a node's name or value, or a string drawn. */
const saysDown = (s: Snapshot): boolean => flat(s.tree).some((n) => `${n.name ?? ''} ${typeof n.value === 'string' ? n.value : ''}`.includes(HUB_DOWN)) || (s.runs ?? []).some((x) => x.text.includes(HUB_DOWN));
/** Every other frame for `ms` of the replica's clock: whether the window said the hub isn't answering, at ms since `from`. */
async function frames(r: Replica, ms: number, from: number): Promise<{ at: number; down: boolean }[]> {
  const out: { at: number; down: boolean }[] = [];
  const end = r.t + flicks(ms);
  while (r.t < end) {
    await r.wait(1000 / 30);
    out.push({ at: Math.round(((r.t - from) * 1000) / FLICKS), down: saysDown((await r.see()).snapshot) });
  }
  return out;
}

describe(`AC15 ${ID.hiccup} a short hiccup never flashes`, () => {
  const failures = async (plant?: string): Promise<string[]> => {
    const r = await replicaOf(world, {}, plant);
    const out: string[] = [];
    try {
      await r.wait(1000);
      if (saysDown((await r.see()).snapshot)) return [`the window says "${HUB_DOWN}" before the hub stopped`];
      // Down for 200 ms.
      const short = r.t;
      await r.hub('stopped');
      const during = await frames(r, 200, short);
      await r.hub('answering');
      const shortAll = [...during, ...(await frames(r, 1300, short))];
      const flash = shortAll.find((f) => f.down);
      if (flash) out.push(`"${HUB_DOWN}" shows at ${flash.at} ms after a 200 ms outage began (the frame at ${flash.at} ms)`);
      await r.wait(3000);
      // Down for 1 s.
      const long = r.t;
      await r.hub('stopped');
      const down = await frames(r, 1000, long);
      await r.hub('answering');
      const all = [...down, ...(await frames(r, 1500, long))];
      const first = all.findIndex((f) => f.down);
      if (first < 0 || all[first]!.at > 2000) out.push(`a hub down for 1 s doesn't show "${HUB_DOWN}" within 2 s${first < 0 ? '' : `: it shows at ${all[first]!.at} ms`}`);
      else {
        const gone = all.findIndex((f, i) => i > first && !f.down);
        const shown = (gone < 0 ? all.at(-1)!.at : all[gone]!.at) - all[first]!.at;
        if (shown < 400) out.push(`"${HUB_DOWN}" shows for ${shown} ms after a 1 s outage, under 400 ms (from the frame at ${all[first]!.at} ms)`);
      }
    } finally {
      await r.stop();
    }
    return out;
  };
  it(`AC15 ${ID.hiccup}: a hub that stops answering for 200 ms shows no "isn't answering"; one down for 1 s shows it within 2 s and keeps it for at least 400 ms`, async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it(`AC15 ${ID.hiccup} wrong program: a planted row that shows it on the first missed reply fails, naming the frame`, async () => {
    expect((await failures('down-at-first-miss')).join('\n')).toMatch(/shows at \d+ ms after a 200 ms outage began \(the frame at \d+ ms\)/);
  }, 30 * MIN);
});
