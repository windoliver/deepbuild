// Test-side tools for #1470 (README). Nothing here stands in for the replica: every reading is a `see` snapshot from the
// real `deep-drive` binary, built and driven by #124's helpers (imported, not copied). A process is stopped by its PID.
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Drive, launch, must, nodesOf, type Box, type Obj } from '../124/helpers.ts';

export { Drive, cleanup, requireMacos, type Box, type Obj } from '../124/helpers.ts';

/** Each criterion's ID: `#1470.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed. */
export const AC1 = '#1470.505e6fae';
export const AC2 = '#1470.4c830268';
export const AC3 = '#1470.ff7b4e38';
export const AC4 = '#1470.51fc1f6d';

/** The planted wrong program (README, The plant): every release over an open menu counts as a pick or a close. */
export const PLANT = 'menu-release-always';

export const PANEL = fileURLToPath(new URL('./fixtures/menu', import.meta.url));
export const TRIGGER = { text: 'Actions' };
export const ROW = { alpha: 'Alpha row', bravo: 'Bravo row', charlie: 'Charlie row' } as const;
export type RowId = keyof typeof ROW;
export const ROW_IDS = Object.keys(ROW) as RowId[];
export const SIZE: [number, number] = [800, 600];
/**
 * A point in the panel's empty space, read from the panel box `see` reports (the fixture mounts in the sidebar slot, not
 * the whole window): its horizontal centre, 40 points above its bottom, below the counters and off every row.
 */
export const offPoint = (panel: Box): [number, number] => [Math.round(panel[0] + panel[2] / 2), panel[1] + panel[3] - 40];

export interface Replica { drive: Drive; replica: string }
/** A fresh replica of the fixture at scale 1, so device pixels are points; `drive` is started with the plant when named. */
export async function open(plant?: string, drive?: Drive): Promise<Replica> {
  const d = drive ?? (await Drive.start(plant ? { plant } : {}));
  const replica = await launch(d, { from: 'fixture', panel: PANEL, size: SIZE, scale: 1, clock: 'virtual' });
  return { drive: d, replica };
}

export interface Seen { texts: string[]; boxes: Map<string, Box>; panel: Box }
/** The window's text snapshot, as the strings it draws and the box of the first node that draws each. */
export async function see(r: Replica): Promise<Seen> {
  const window = await must(r.drive, { call: 'see', replica: r.replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds'] } }, 'see window');
  const panel = await must(r.drive, { call: 'see', replica: r.replica, see: { scope: 'panel', include: ['roles', 'bounds'] } }, 'see panel');
  const texts: string[] = [];
  const boxes = new Map<string, Box>();
  for (const n of nodesOf(window.snapshot)) {
    for (const t of [n.name, typeof n.value === 'string' ? n.value : null]) {
      if (typeof t !== 'string' || t === '') continue;
      texts.push(t);
      if (!boxes.has(t)) boxes.set(t, n.bounds);
    }
  }
  return { texts, boxes, panel: panel.snapshot.tree.bounds as Box };
}

/** The rows whose label is drawn now, in the order they were declared. */
export const shown = (s: Seen): RowId[] => ROW_IDS.filter((id) => s.texts.includes(ROW[id]));
/** The fixture's counters: how many times each row's on_pick ran, and the total it draws. */
export function ran(s: Seen): Record<RowId | 'total', number> {
  const count = (id: string): number => {
    const line = s.texts.filter((t) => t === `ran ${id} 0` || new RegExp(`^ran ${id} \\d+$`).test(t));
    expect(line.length, `exactly one "ran ${id} <n>" line in the snapshot, got ${JSON.stringify(s.texts)}`).toBe(1);
    return Number(line[0]!.split(' ')[2]);
  };
  return { alpha: count('alpha'), bravo: count('bravo'), charlie: count('charlie'), total: count('total') };
}

export const center = (b: Box): [number, number] => [Math.round(b[0] + b[2] / 2), Math.round(b[1] + b[3] / 2)];
export const within = (p: [number, number], b: Box): boolean => p[0] >= b[0] && p[0] < b[0] + b[2] && p[1] >= b[1] && p[1] < b[1] + b[3];

export const click = (r: Replica, locator: Obj): Promise<Obj> => must(r.drive, { call: 'act', replica: r.replica, locator, act: { kind: 'click' } }, `click ${JSON.stringify(locator)}`);
/** The drive's only press-move-release verb: down on `locator`, moves, up at `to` (device pixels), with nothing between. */
export const dragTo = (r: Replica, locator: Obj, to: [number, number]): Promise<Obj> => must(r.drive, { call: 'act', replica: r.replica, locator, act: { kind: 'drag', to_point: to } }, `drag ${JSON.stringify(locator)} to ${to}`);
export const keys = (r: Replica, text: string): Promise<Obj> => must(r.drive, { call: 'act', replica: r.replica, act: { kind: 'press', keys: text } }, `press ${text}`);
export const settle = (r: Replica): Promise<Obj> => must(r.drive, { call: 'wait_for', replica: r.replica, wait_for: { state: 'settled' } }, 'settled');
/** The drive runs one replica at a time: every replica is closed before the next launch. */
export const close = (r: Replica): Promise<Obj> => must(r.drive, { call: 'close', replica: r.replica }, 'close');

/** Where each row is when the menu is open: read in a replica of its own, opened by a plain click, so a drag can aim at it. */
export async function rowCenters(drive: Drive): Promise<Record<RowId, [number, number]>> {
  const r = await open(undefined, drive);
  await click(r, TRIGGER);
  const s = await see(r);
  expect(shown(s), 'a click on the trigger opens the menu, its rows in the order declared').toEqual(ROW_IDS);
  const out = {} as Record<RowId, [number, number]>;
  for (const id of ROW_IDS) {
    const c = center(s.boxes.get(ROW[id])!);
    out[id] = c;
    expect(within(c, s.panel), `${id} is drawn inside the panel ${JSON.stringify(s.panel)}, at ${c}`).toBe(true);
  }
  expect(out.alpha[1] < out.bravo[1] && out.bravo[1] < out.charlie[1], `rows run top to bottom: ${JSON.stringify(out)}`).toBe(true);
  await close(r);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The journeys. Each returns what it saw, as problems against its criterion; none when the program meets it.

export type Centers = Record<RowId, [number, number]>;

/**
 * Criterion 1: press on the trigger, move to row 2, release there. `at` is where the rows are, read by `rowCenters` on
 * an honest drive; read on `drive` when not given (a planted drive can't read them: its click closes the menu).
 */
export async function pressSlideRelease(drive: Drive, at?: Centers): Promise<string[]> {
  at ??= await rowCenters(drive);
  const r = await open(undefined, drive);
  await dragTo(r, TRIGGER, at.bravo);
  await settle(r);
  const s = await see(r);
  await close(r);
  const problems: string[] = [];
  const n = ran(s);
  if (JSON.stringify(n) !== JSON.stringify({ alpha: 0, bravo: 1, charlie: 0, total: 1 })) problems.push(`the release on row 2 ran ${JSON.stringify(n)}, not row 2 once`);
  if (shown(s).length) problems.push(`the menu is still open after the pick: ${JSON.stringify(shown(s))}`);
  return problems;
}

/** Criterion 3: press on the trigger, move off every row, release. `at` as for `pressSlideRelease`. */
export async function releaseOutside(drive: Drive, at?: Centers): Promise<string[]> {
  at ??= await rowCenters(drive);
  const r = await open(undefined, drive);
  const before = await see(r);
  const off = offPoint(before.panel);
  expect(within(off, before.panel), `the release point ${off} is inside the panel ${JSON.stringify(before.panel)}`).toBe(true);
  expect(Object.values(at).every((p) => Math.hypot(p[0] - off[0], p[1] - off[1]) > 40), `the release point ${off} is far from every row: ${JSON.stringify(at)}`).toBe(true);  await dragTo(r, TRIGGER, off);
  await settle(r);
  const s = await see(r);
  await close(r);
  const problems: string[] = [];
  if (shown(s).length) problems.push(`the menu is still open after a release off every row: ${JSON.stringify(shown(s))}`);
  const n = ran(s);
  if (n.total !== 0 || n.alpha || n.bravo || n.charlie) problems.push(`a release off every row ran ${JSON.stringify(n)}`);
  return problems;
}

/** Criterion 2: a press and release within 3 px, as a click and as a 2 px drag, leave it open; a later click picks. */
export async function clickNoDrag(drive: Drive): Promise<string[]> {
  const problems: string[] = [];
  // First replica: a plain click, then the later click on row 2 in the same replica; closed before the next launch.
  const open1 = await open(undefined, drive);
  await click(open1, TRIGGER);
  await settle(open1);
  const s1 = await see(open1);
  if (JSON.stringify(shown(s1)) !== JSON.stringify(ROW_IDS)) problems.push(`a click on the trigger left the menu ${shown(s1).length ? `showing ${JSON.stringify(shown(s1))}` : 'closed'}`);
  if (ran(s1).total !== 0) problems.push(`a click on the trigger ran a row: ${JSON.stringify(ran(s1))}`);
  if (shown(s1).length === ROW_IDS.length) {
    await click(open1, { text: ROW.bravo });
    await settle(open1);
    const s3 = await see(open1);
    if (JSON.stringify(ran(s3)) !== JSON.stringify({ alpha: 0, bravo: 1, charlie: 0, total: 1 })) problems.push(`the later click on row 2 ran ${JSON.stringify(ran(s3))}, not row 2 once`);
    if (shown(s3).length) problems.push(`the menu is still open after the later click: ${JSON.stringify(shown(s3))}`);
  }
  await close(open1);

  // Second replica: a press and release 2 px apart.
  const open2 = await open(undefined, drive);
  const box = (await see(open2)).boxes.get(TRIGGER.text)!;
  const [cx, cy] = center(box);
  await dragTo(open2, TRIGGER, [cx + 2, cy + 1]);
  await settle(open2);
  const s2 = await see(open2);
  await close(open2);
  if (JSON.stringify(shown(s2)) !== JSON.stringify(ROW_IDS)) problems.push(`a press and release 2 px apart left the menu ${shown(s2).length ? `showing ${JSON.stringify(shown(s2))}` : 'closed'}`);
  if (ran(s2).total !== 0) problems.push(`a press and release 2 px apart ran a row: ${JSON.stringify(ran(s2))}`);
  return problems;
}
