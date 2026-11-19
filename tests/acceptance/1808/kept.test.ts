// AC3: the window comes back as you left it. The real `deep-app`, in a temp home over a real hub's record with two open
// asks, read and driven from outside its process (probe.swift): the window moved and sized through the Accessibility API
// as a person dragging its corner would; the list's edge dragged by the pointer events posted to the app's PID alone; a
// session's row opened from the keyboard, so what's selected isn't the first ask; ⌘Q; and the same binary launched again
// in the same home. The frame and the list's width are read back from the window itself after the relaunch, never from a
// file. Needs Accessibility and an unlocked, awake screen; without them it is BLOCKED, never a pass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appBins, askAt, askOf, blocked, cleanup, ID, KEY, makeWorld, MIN, PLANT, RealApp, screens, sessionOf, settled, sleep,
  type SessionSpec, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const SPECS: SessionSpec[] = [
  { key: 'a1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }] },
  { key: 'a2', project: 'shop', title: 'Checkout page', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'notes', project: 'docs', title: 'Release notes', state: 'finished' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 15 * MIN);

const SIZE = { width: 1200, height: 800 } as const;
const LIST = 300;
const ROW = /^(ask|session|quiet|project):[^\s:]+$/;
const fmt = (f: number[]): string => `[${f.map((v) => Math.round(v)).join(', ')}]`;
const near = (a: number[], b: number[], slack = 1): boolean => a.length === 4 && a.every((v, i) => Math.abs(v - b[i]!) <= slack);

/** The list's width now, its edge dragged toward `to` until it reads it: null when the window has no list. */
async function dragList(app: RealApp, to: number): Promise<{ before: number; after: number } | null> {
  const list = await app.node('list');
  if (!list) return null;
  const before = list.frame[2]!;
  let width = before;
  for (let tries = 0; tries < 3 && Math.abs(width - to) > 2; tries++) {
    const [x, y, w, h] = (await app.node('list'))!.frame as [number, number, number, number];
    await app.drag([x + w, y + h / 2], [x + w + (to - w), y + h / 2]);
    width = (await app.node('list'))?.frame[2] ?? width;
  }
  return { before, after: width };
}
/** F6 until the keyboard is in the list, the arrows to `id`, then Return (#1462); whether the window then shows `address`. */
async function openRow(app: RealApp, id: string, address: string): Promise<boolean> {
  const focus = async (): Promise<string> => (await app.focused())?.identifier ?? '';
  for (let i = 0; i < 3 && !ROW.test(await focus()); i++) await app.key(KEY.f6);
  for (const key of [KEY.down, KEY.up]) for (let i = 0; i < 12 && (await focus()) !== id; i++) await app.key(key);
  if ((await focus()) !== id) return false;
  await app.key(KEY.enter);
  return !(await settled(async () => ((await app.address()) === address ? [] : ['not yet']), 10_000)).length;
}

async function keptFailures(plant?: string): Promise<string[]> {
  const bins = await appBins();
  const bin = plant ? bins.plants : bins.plain;
  const env: Record<string, string> = plant ? { DEEP_HUB_PLANT: plant } : {};
  const first = askOf(world, 'a1');
  const notes = sessionOf(world, 'notes');
  const out: string[] = [];
  let left: { frame: number[]; list: number } | undefined;
  const app = await RealApp.launch(world.home, bin, env);
  try {
    const opened = await app.frame();
    if (Math.abs(opened[2]! - 960) > 1 || Math.abs(opened[3]! - 640) > 1) out.push(`the first launch in a fresh home opens at ${fmt(opened)}, not the opening size 960×640: something kept a frame outside the home`);
    const display = (await screens()).find((d) => opened[0]! >= d[0]! && opened[1]! >= d[1]! && opened[0]! < d[0]! + d[2]! && opened[1]! < d[1]! + d[3]!);
    if (!display) blocked(`no display holds the window, which opened at ${fmt(opened)}`);
    if (display![2]! < SIZE.width + 64 || display![3]! < SIZE.height + 96) blocked(`the window's display, ${fmt(display!)}, can't hold a ${SIZE.width}×${SIZE.height} window`);
    // A resize to 1200×800, somewhere the app never opens on its own: near the display's top left.
    const frame = await app.place(display![0]! + 32, display![1]! + 64, SIZE.width, SIZE.height);
    const dragged = await dragList(app, LIST);
    if (!dragged) blocked('the real window has no list (AXIdentifier "list") whose edge a drag could move');
    if (Math.abs(dragged!.after - dragged!.before) < 1) blocked(`a drag posted to the app's PID didn't move the list's edge: the list is still ${dragged!.after} wide, so this Mac's window server didn't deliver it`);
    if (Math.abs(dragged!.after - LIST) > 2) out.push(`the list's edge dragged to ${LIST} leaves the list ${dragged!.after} wide`);
    left = { frame: await app.frame(), list: dragged!.after };
    if (!near(left.frame, frame)) out.push(`dragging the list moved the window from ${fmt(frame)} to ${fmt(left.frame)}`);
    // What's selected isn't kept: the session's page is open when the app quits.
    if (!(await openRow(app, `session:${notes.id}`, `session/${notes.id}`))) blocked(`the keyboard couldn't open session:${notes.id} ("${notes.title}") before the quit: the window shows ${JSON.stringify(await app.address())}`);
    if (!(await app.quit())) {
      out.push('⌘Q didn\'t quit the app within 30 s');
      return out;
    }
  } finally {
    await app.stop();
  }
  const kept = left ?? blocked('the window was never left at a frame and a width');
  await sleep(1000);
  const again = await RealApp.launch(world.home, bin, env);
  try {
    out.push(...(await settled(async () => {
      const f: string[] = [];
      const frame = await again.frame();
      if (!near(frame, kept.frame)) f.push(`after a quit and a launch the window's frame is ${fmt(frame)}, not ${fmt(kept.frame)}, the frame it was left at`);
      const width = (await again.node('list'))?.frame[2];
      if (width === undefined || Math.abs(width - kept.list) > 2) f.push(`after a quit and a launch the list is ${width ?? 'not shown and not'} wide, not ${kept.list}, the width it was dragged to`);
      const address = await again.address();
      if (address !== askAt(first.handle)) f.push(`after a quit and a launch the window shows ${JSON.stringify(address)}, not the first open ask ${askAt(first.handle)}`);
      return f;
    }, 20_000)));
  } finally {
    await again.stop();
  }
  return out;
}

describe(`AC3 ${ID.kept} it comes back as you left it`, () => {
  it(`AC3 ${ID.kept}: after a resize to 1200×800 and the list dragged to 300, a quit and a launch show that frame and width with the first open ask selected`, async () => {
    expect(await keptFailures()).toEqual([]);
  }, 40 * MIN);

  it(`AC3 ${ID.kept} wrong program: a planted app that opens at the opening size fails, naming the frame`, async () => {
    expect((await keptFailures(PLANT.openingSize)).join('\n'), 'the planted app (README, Surface choices: opens-at-opening-size)').toMatch(/after a quit and a launch the window's frame is \[-?\d+, -?\d+, 960, 640\], not \[-?\d+, -?\d+, 1200, 800\]/);
  }, 40 * MIN);
});
