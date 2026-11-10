// AC6, AC7, AC8 and AC29: what the shell keeps. The names the merge base's shell draws (fixtures/base-names.json) stay in
// the tree or are recorded as moved (crates/deep-app/moves.json, README Pinned 7); a replacement Needs you still fills the
// list's first section; `deep.registerView`'s areas still place a panel, and one registered to `sidebar` opens as a page.
// The replica on a copy of a real hub's record, or on no record for the first launch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureCopy as fixture1459, openAsks, RECORD_338, viewKit } from '../1459/helpers.ts';
import {
  cleanup, FIXTURES, fixtureCopy, flat, headings, ID, listOf, listRows, makeWorld, MIN, pageOf, REPO, Replica, replicaOf, runsIn,
  sessionOf, wordsOf, type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const SPECS: SessionSpec[] = [
  { key: 'n1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }, { kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'n2', project: 'shop', title: 'Checkout page' },
  { key: 'n3', project: 'docs', title: 'Release notes', state: 'finished' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 10 * MIN);
const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 200);
/** #1459's replacement Needs you view and its planted twin that hides the oldest ask, used as they are. */
const SUITE_1459 = join(REPO, 'tests/acceptance/1459/fixtures/views');

describe(`AC6 ${ID.names} the tree keeps the shell's names`, () => {
  it(`AC6 ${ID.names}: the tree holds every name from the merge base's shell or a recorded move, including Tasks, Needs you, Set up, Terminal and Pop out Needs you`, async () => {
    const names = new Set<string>();
    const take = (s: Snapshot): void => {
      for (const n of flat(s.tree)) if (n.name) names.add(n.name);
      for (const r of s.runs ?? []) names.add(r.text);
    };
    const out: string[] = [];
    let r: Replica = await replicaOf(world);
    try {
      await r.wait(1000);
      const opened = (await r.see()).snapshot;
      take(opened);
      const list = listOf(opened);
      if (list?.name !== 'Tasks') out.push(`the list's region is named ${said(list?.name)}, not "Tasks"`);
      if (headings(opened)[0]?.name !== 'Needs you') out.push(`the list's first heading is ${said(headings(opened)[0]?.name)}, not "Needs you"`);
      for (const address of [`session/${sessionOf(world, 'n1').id}`, 'project/shop', 'page/agents']) {
        await r.open(address);
        await r.wait(500);
        take((await r.see()).snapshot);
      }
      await r.press('cmd-k');
      await r.wait(300);
      take((await r.see()).snapshot);
      await r.press('escape');
    } finally {
      await r.stop();
    }
    r = await replicaOf(null, { setup: 'unfinished' });
    try { await r.wait(500); take((await r.see()).snapshot); } finally { await r.stop(); }

    const base = (JSON.parse(readFileSync(join(FIXTURES, 'base-names.json'), 'utf8')) as { names: { name: string; where: string }[] }).names;
    const file = join(REPO, 'crates/deep-app/moves.json');
    const moves = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { from: string; to: string; by: string }[]) : [];
    for (const name of ['Tasks', 'Needs you', 'Set up', 'Terminal', 'Pop out Needs you']) if (!names.has(name)) out.push(`the tree doesn't hold "${name}"`);
    for (const { name, where } of base) {
      if (names.has(name)) continue;
      const move = moves.find((m) => m.from === name);
      if (!move) out.push(`"${name}" (${where} at the merge base) is gone from the tree, and no recorded move in crates/deep-app/moves.json names it`);
      else if (!names.has(move.to)) out.push(`"${name}" is recorded as moved to "${move.to}" (${move.by}), which the tree doesn't hold`);
    }
    expect(out).toEqual([]);
  }, 30 * MIN);
});

describe(`AC7 ${ID.needsYouKit} a replacement Needs you fills the list's first section`, () => {
  it(`AC7 ${ID.needsYouKit}: a replacement view that passes needs-you@1 still fills the list's first section`, async () => {
    const kit = await viewKit(join(SUITE_1459, 'needs-you-by-id'));
    expect(kit.verdict, `deep-replica --view-kit needs-you@1 on the replacement view: ${kit.said}`).toEqual({ result: 'pass' });
    const r = await replicaOf(world, { panel: fixture1459('views', 'needs-you-by-id'), replaces: 'needs-you' });
    const out: string[] = [];
    try {
      await r.wait(1000);
      const s = (await r.see()).snapshot;
      const list = listOf(s);
      const [first, second] = headings(s);
      if (!list || !first) out.push('the list has no first section (no list, or no heading in it)');
      else {
        if (first.id !== 'heading:needs-you') out.push(`the list's first section is ${String(first.id)}, not Needs you's`);
        const top = first.bounds[1]! + first.bounds[3]!;
        const bottom = second ? second.bounds[1]! : list.bounds[1]! + list.bounds[3]!;
        const section = [list.bounds[0]!, top, list.bounds[2]!, bottom - top];
        if (!runsIn(s, section).some((x) => x.text.includes('Asks for you'))) out.push('the replacement view isn\'t drawn in the list\'s first section: "Asks for you" isn\'t there');
        for (const a of world.asks) {
          const row = flat(list).find((n) => n.id === a.handle);
          if (!row || row.bounds[1]! < top - 1 || row.bounds[1]! >= bottom) out.push(`the list's first section has no row of the replacement view for ${a.handle}`);
        }
      }
    } finally {
      await r.stop();
    }
    expect(out).toEqual([]);
  }, 30 * MIN);

  it(`AC7 ${ID.needsYouKit} wrong program: a planted one that hides the oldest ask fails, naming the ask`, async () => {
    const kit = await viewKit(join(SUITE_1459, 'hides-oldest'));
    expect(kit.verdict?.result, `deep-replica --view-kit needs-you@1: ${kit.said}`).toBe('fail');
    expect(kit.verdict?.names, 'the kit names the oldest open ask, the one hidden').toBe(openAsks(RECORD_338)[0]!.handle);
  }, 30 * MIN);
});

describe(`AC8 ${ID.areas} the areas home and the line`, () => {
  it(`AC8 ${ID.areas}: the extension areas home and the line place a test panel without a change to deep.registerView`, async () => {
    const out: string[] = [];
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    const entry = (text: string): unknown => {
      let found: unknown;
      const walk = (x: unknown): void => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') { if ((x as { method?: unknown }).method === 'deep.registerView') found = x; else Object.values(x).forEach(walk); }
      };
      walk(JSON.parse(text));
      return found;
    };
    const now = entry(readFileSync(join(REPO, 'packages/contracts/extension-api.json'), 'utf8'));
    const then = entry(execFileSync('git', ['show', `${base}:packages/contracts/extension-api.json`], { cwd: REPO, encoding: 'utf8' }));
    if (JSON.stringify(now) !== JSON.stringify(then)) out.push(`deep.registerView's contract changed from the merge base ${base.slice(0, 8)}: ${said(now)}`);
    for (const [area, address] of [['home', 'project/shop'], ['line', `session/${sessionOf(world, 'n2').id}`]] as const) {
      const r = await replicaOf(world, { panel: fixtureCopy('panel'), view: { name: 'test-panel' }, area });
      try {
        await r.open(address);
        await r.wait(1000);
        const s = (await r.see()).snapshot;
        const page = pageOf(s);
        if (!page || page.id !== address) out.push(`with the panel in ${area}, the window shows ${String(page?.id)}, not ${address}`);
        else if (!wordsOf(s, page).includes('Test panel')) out.push(`a panel registered to ${area} isn't on ${address}'s page`);
      } finally {
        await r.stop();
      }
    }
    expect(out).toEqual([]);
  }, 30 * MIN);
});

describe(`AC29 ${ID.sidebarArea} a panel registered to sidebar opens as a page`, () => {
  const shape = (s: Snapshot): string => JSON.stringify([...headings(s), ...listRows(s)].sort((a, b) => a.bounds[1]! - b.bounds[1]!).map((n) => [n.id, n.name]));
  const failures = async (plant?: string): Promise<string[]> => {
    const out: string[] = [];
    let without: string;
    const plain = await replicaOf(world);
    try { await plain.wait(1000); without = shape((await plain.see()).snapshot); } finally { await plain.stop(); }
    const r = await replicaOf(world, { panel: fixtureCopy('panel'), view: { name: 'test-panel' }, area: 'sidebar' }, plant);
    try {
      await r.wait(1000);
      const s = (await r.see()).snapshot;
      if (shape(s) !== without) out.push(`the panel test-panel changes the list's rows and headings: ${shape(s).slice(0, 300)}, not ${without.slice(0, 300)}`);
      const opened = async (how: string): Promise<void> => {
        await r.wait(500);
        const now = (await r.see()).snapshot;
        const page = pageOf(now);
        if (!page || !String(page.id).startsWith('page/') || !wordsOf(now, page).includes('Test panel')) out.push(`${how} doesn't open the panel test-panel as a page: the window shows ${String(page?.id)}`);
      };
      await r.press('cmd-k');
      await r.type(null, 'test-panel');
      await r.press('enter');
      await opened('⌘K');
      const view = (await r.see()).menus.find((m) => m.title === 'View');
      const item = view?.items.find((i) => i.title.toLowerCase().replace(/[^a-z]/g, '').includes('testpanel'));
      if (!item) out.push(`the View menu lists no item for the panel test-panel: ${said(view)}`);
      else {
        await r.open('project/shop');
        await r.menu(['View', item.title]);
        await opened('the View menu');
      }
    } finally {
      await r.stop();
    }
    return out;
  };
  it(`AC29 ${ID.sidebarArea}: a test panel registered to the sidebar area opens as a page from View and ⌘K, and the list's rows and headings are unchanged`, async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it(`AC29 ${ID.sidebarArea} wrong program: a planted plug-in that adds a list section fails, naming the panel`, async () => {
    expect((await failures('sidebar-panel-in-list')).join('\n')).toMatch(/the panel test-panel changes the list's rows and headings/);
  }, 30 * MIN);
});
