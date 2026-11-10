// AC3, AC20, AC21 and AC22: what the window opens on, and its empties. The replica, launched on a copy of a real hub's
// record (`record_copy`) or on no record (`empty`), on its virtual clock; the hub it reads stopped or slow through the
// replica's `hub` door (README, Pinned 4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  byId, cleanup, clocksBetween, clockTimes, flat, HUB_DOWN, ID, listOf, listRows, makeWorld, MIN, pageOf, Replica, replicaOf,
  runsIn, wordsOf, zeroCounts, type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
/** Two projects and no open ask; docs's session is the most recently active. */
const NO_ASK: SessionSpec[] = [
  { key: 'a', project: 'shop', title: 'Cart totals', state: 'finished' },
  { key: 'b', project: 'shop', title: 'Checkout page', state: 'finished' },
  { key: 'c', project: 'docs', title: 'Release notes', state: 'finished' },
];
/** A project whose one session was archived: a project with no session. */
const NO_SESSION: SessionSpec[] = [{ key: 'gone', project: 'attic', title: 'Old spike', state: 'finished', archived: true }];
let quietWorld: World;
let emptyProject: World;
beforeAll(async () => { quietWorld = await makeWorld(NO_ASK); emptyProject = await makeWorld(NO_SESSION); }, 10 * MIN);

const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 200);
const COUNT = /\b(\d+) asks? needs? you\b/g;

describe(`AC3 ${ID.opensOn} with no open ask, and with the hub stopped`, () => {
  it(`AC3 ${ID.opensOn}: with no open ask the app opens on the most recently active project, its page reads "Nothing needs you" and the count agrees; with the hub stopped the list and the page say it isn't answering and since when, and no count reads 0`, async () => {
    const r = await replicaOf(quietWorld);
    const out: string[] = [];
    try {
      await r.wait(1000);
      const seen = await r.see();
      if (seen.address !== 'project/docs') out.push(`the window opens on ${said(seen.address)}, not project/docs, the project with the latest activity (README, Pinned 1)`);
      const page = pageOf(seen.snapshot);
      if (!page) out.push('the window shows no one page node');
      else if (!wordsOf(seen.snapshot, page).includes('Nothing needs you')) out.push(`the page doesn't read "Nothing needs you": ${said(wordsOf(seen.snapshot, page))}`);
      const all = flat(seen.snapshot.tree).map((n) => `${n.name ?? ''} ${typeof n.value === 'string' ? n.value : ''}`).concat((seen.snapshot.runs ?? []).map((x) => x.text)).join('\n');
      for (const m of all.matchAll(COUNT)) if (Number(m[1]) !== 0) out.push(`a count reads "${m[0]}" with no open ask`);
      const heading = byId(seen.snapshot, 'heading:needs-you');
      if (heading && !['0', '', 'null'].includes(String(heading.value ?? ''))) out.push(`Needs you's heading counts ${said(heading.value)} with no open ask`);

      const stoppedAt = r.now();
      await r.hub('stopped');
      await r.wait(3000);
      const down = (await r.see()).snapshot;
      const times = clocksBetween(stoppedAt - 2 * MIN, r.now());
      for (const [what, node] of [['the list', listOf(down)], ['the page', pageOf(down)]] as const) {
        if (!node) { out.push(`with the hub stopped the window has no ${what}`); continue; }
        const words = wordsOf(down, node);
        if (!words.includes(HUB_DOWN)) out.push(`with the hub stopped, ${what} doesn't say "${HUB_DOWN}": ${said(words)}`);
        else if (!clockTimes(words).some((t) => times.includes(t))) out.push(`with the hub stopped, ${what} doesn't say since when (a clock time between ${times[0]} and ${times.at(-1)}): ${said(words)}`);
      }
      out.push(...zeroCounts(down).map((z) => `with the hub stopped, ${z}`));
    } finally {
      await r.stop();
    }
    expect(out).toEqual([]);
  }, 30 * MIN);
});

/** The page's empty line (README, Pinned 1): `empty`'s words and its mark's status-map entry. */
function emptyLine(s: Snapshot, which: string): { text: string; mark: string } | string {
  const page = pageOf(s);
  if (!page) return `${which}: the window shows no one page node`;
  const node = flat(page).find((n) => n.id === 'empty');
  if (!node) return `${which}: the page has no empty line (a node with id "empty"): it reads ${said(wordsOf(s, page))}`;
  return { text: wordsOf(s, node), mark: String(node.value ?? '') };
}
async function emptiesFailures(plant?: string): Promise<string[]> {
  const take = async (world: World, launch: Record<string, unknown>, steps: (r: Replica) => Promise<void>): Promise<Snapshot> => {
    const r = await replicaOf(world, launch, plant);
    try { await steps(r); return (await r.see()).snapshot; } finally { await r.stop(); }
  };
  const nothing = await take(emptyProject, {}, async (r) => { await r.open('project/attic'); await r.wait(1000); });
  const unread = await take(quietWorld, { hub: 'slow' }, async (r) => { await r.wait(200); });
  const stopped = await take(quietWorld, {}, async (r) => { await r.wait(1000); await r.hub('stopped'); await r.wait(3000); });
  const lines = [['a project with no session', nothing], ['a count not yet read', unread], ['a stopped hub', stopped]] as const;
  const read = lines.map(([which, s]) => [which, emptyLine(s, which)] as const);
  const out = read.flatMap(([, e]) => (typeof e === 'string' ? [e] : []));
  if (out.length) return out;
  const got = read.map(([which, e]) => [which, e as { text: string; mark: string }] as const);
  for (let i = 0; i < got.length; i++) {
    for (let j = i + 1; j < got.length; j++) {
      const [[a, x], [b, y]] = [got[i]!, got[j]!];
      if (x.text === y.text) out.push(`${a} and ${b} read alike: ${said(x.text)}`);
      if (x.mark === y.mark) out.push(`${a} and ${b} carry the same mark: ${said(x.mark)}`);
    }
  }
  if (got[0]![1].mark !== 'idle') out.push(`a project with no session doesn't read calm: its mark is ${said(got[0]![1].mark)}, not idle`);
  for (const [which, e] of got.slice(1)) if (e.mark === 'idle') out.push(`${which} reads calm (its mark is idle)`);
  return out;
}

describe(`AC20 ${ID.empties} the empties differ`, () => {
  it(`AC20 ${ID.empties}: a project with no session, a count not yet read and a stopped hub: the page's snapshots differ in text and in mark, and only the first reads calm`, async () => {
    expect(await emptiesFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC20 ${ID.empties} wrong program: a planted app that draws two of them alike fails, naming the pair`, async () => {
    expect((await emptiesFailures('empties-alike')).join('\n')).toMatch(/a count not yet read and a stopped hub (read alike|carry the same mark)/);
  }, 30 * MIN);
});

async function afterSetUpFailures(plant?: string): Promise<string[]> {
  const r = await replicaOf(null, {}, plant);
  try {
    await r.wait(500);
    const s = (await r.see()).snapshot;
    const out: string[] = [];
    const page = pageOf(s);
    const box = byId(s, 'box');
    if (!page) return ['right after Set up the window shows no one page node'];
    if (!box || !flat(page).includes(box)) out.push(`the page ${String(page.id)} holds no box (a node with id "box")`);
    if (s.focus !== 'box-draft' && s.focus !== 'box') out.push(`the box doesn't have focus: the snapshot's focus is ${said(s.focus)}`);
    const words = runsIn(s, page.bounds).filter((x) => !box || !(x.bounds[1]! >= box.bounds[1]! && x.bounds[1]! < box.bounds[1]! + box.bounds[3]!));
    if (!words.length) out.push(`the page ${String(page.id)} is blank but for the box: it draws nothing above it`);
    for (const row of listRows(s)) out.push(`the list has a row: ${String(row.id)} (${said(row.name)})`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC21 ${ID.afterSetUp} right after Set up`, () => {
  it(`AC21 ${ID.afterSetUp}: on a record with no session the page holds the box with focus and isn't blank, and the list has no row`, async () => {
    expect(await afterSetUpFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC21 ${ID.afterSetUp} wrong program: a planted blank page fails, naming it`, async () => {
    expect((await afterSetUpFailures('blank-first-page')).join('\n')).toMatch(/the page \S+ is blank but for the box/);
  }, 30 * MIN);

  it(`AC21 ${ID.afterSetUp} wrong program: an agent drawn as a list row fails, naming it`, async () => {
    expect((await afterSetUpFailures('agent-as-row')).join('\n')).toMatch(/the list has a row: \S+/);
  }, 30 * MIN);
});

const CONTROL = /^(button|link|menu_item|switch|check_box|radio_button|.*_input)$/;
async function firstLaunchFailures(plant?: string): Promise<string[]> {
  const r = await replicaOf(null, { setup: 'unfinished' }, plant);
  try {
    await r.wait(500);
    const s = (await r.see()).snapshot;
    const page = pageOf(s);
    if (!page) return ['on first launch the window shows no one page node'];
    const controls = flat(page).filter((n) => CONTROL.test(n.role));
    const out: string[] = [];
    if (!controls.some((n) => n.role === 'button' && n.name === 'Set up')) out.push(`the first-launch page has no Set up button: its controls are ${said(controls.map((n) => [n.role, n.name, n.id]))}`);
    for (const n of controls.filter((c) => !(c.role === 'button' && c.name === 'Set up'))) out.push(`the first-launch page holds a second control: ${n.role} ${said(n.id)} ${said(n.name)}`);
    return out;
  } finally {
    await r.stop();
  }
}

describe(`AC22 ${ID.firstLaunch} first launch`, () => {
  it(`AC22 ${ID.firstLaunch}: on first launch the page's tree holds one control that writes, Set up`, async () => {
    expect(await firstLaunchFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC22 ${ID.firstLaunch} wrong program: a planted box on that page fails, naming it`, async () => {
    expect((await firstLaunchFailures('box-on-first-launch')).join('\n')).toMatch(/second control: \w+ "box/);
  }, 30 * MIN);
});
