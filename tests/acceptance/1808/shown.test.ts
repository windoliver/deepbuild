// AC9: Shown to you. Screenshots of the list scrolled to its last row, the window at 700 wide on the list and on a page,
// a long card scrolled, and rows with a long, a Han and an Arabic title, taken by the check run from the real app,
// attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the
// run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The real `deep-app` over a real hub's record (two open asks, the older the 30-row approval; three titled sessions in
// docs; 700 in shop), driven from outside its process (probe.swift); each picture is taken only once its state is on the
// window's tree. Pictures go to $DA1808_SCREENS (a temp folder without it) with run.json, the app's SHA-256. Then
// TASTE.json is read: no call, or one on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting its note; `looks_right`
// on exactly these files passes. A kept folder holding exactly a recorded call's files, from this same app binary, stands,
// so the run doesn't take them again. "Attached to the PR and shown to you" is the implementing agent's; no test can see
// it. Nothing here judges a picture.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appBins, askAt, blocked, cleanup, ID, inconclusive, jsonRows, KEY, makeWorld, MIN, NARROW, OPENING, RealApp, realAppAccess,
  screens, settled, sha256File, SUITE, tempDir, THIRTY, TITLE, type AxNode, type SessionSpec, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const SPECS: SessionSpec[] = [
  { key: 'push', project: 'docs', title: 'Release 2.4', state: 'finished', asks: [THIRTY] },
  { key: 'pick', project: 'docs', title: 'Checkout page', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'long', project: 'docs', title: TITLE.long, state: 'finished' },
  { key: 'han', project: 'docs', title: TITLE.han, state: 'finished' },
  { key: 'arabic', project: 'docs', title: TITLE.arabic, state: 'finished' },
  ...Array.from({ length: 700 }, (_, i): SessionSpec => ({ key: `r${i}`, project: 'shop', title: `Task ${String(i + 1).padStart(3, '0')}`, state: 'finished' })),
];
const FILES = ['titles-960x640.png', 'long-card-960x640.png', 'narrow-page-700x640.png', 'narrow-list-700x640.png', 'last-row-960x640.png'] as const;
const expected = (): string[] => [...FILES, 'run.json'].sort();
const ROW = /^(ask|session|quiet|project):[^\s:]+$/;

/** Whether each node with an id in `ids` lies wholly in the window's frame. */
const inWindow = (nodes: AxNode[], frame: number[], ids: string[]): string[] => ids.filter((id) => {
  const n = nodes.find((x) => x.identifier === id);
  return !n || n.frame[0]! < frame[0]! - 1 || n.frame[1]! < frame[1]! - 1 || n.frame[0]! + n.frame[2]! > frame[0]! + frame[2]! + 1 || n.frame[1]! + n.frame[3]! > frame[1]! + frame[3]! + 1;
});

async function pictures(world: World, binary: string, out: string): Promise<string[]> {
  const failures: string[] = [];
  const [push, pick] = world.asks;
  const rows = (await jsonRows(world, 'status')).rows.filter((r) => r.id.startsWith('session:') && r.project === 'shop');
  const last = rows.at(-1)?.id ?? blocked('deep status --json lists no session in shop');
  const titled = ['long', 'han', 'arabic'].map((k) => `session:${world.sessions.find((s) => s.key === k)!.id}`);
  const app = await RealApp.launch(world.home, binary);
  try {
    const display = (await screens())[0] ?? blocked('no display to draw the window on');
    const at = (size: { width: number; height: number }): Promise<number[]> => app.place(display[0]! + 32, display[1]! + 64, size.width, size.height);
    /** Takes `name` once `ready` says the state is on the tree, else names what's missing. */
    const take = async (name: string, ready: () => Promise<string[]>): Promise<void> => {
      const missing = await settled(ready, 30_000);
      if (missing.length) { failures.push(`${name}: ${missing[0]}`); return; }
      await app.front();
      await new Promise((resolve) => setTimeout(resolve, 800));
      await app.capture(join(out, name));
    };
    let frame = await at(OPENING);
    await take('titles-960x640.png', async () => inWindow(await app.nodes(), frame, titled).map((id) => `the row ${id} isn't in the window`));
    // The approval's card, its rows scrolled to their end by the wheel over them.
    for (let turn = 0; turn < 30; turn++) {
      const nodes = await app.nodes();
      if (!inWindow(nodes, frame, ['card-step:29']).length) break;
      const steps = nodes.filter((n) => /^card-step:\d+$/.test(n.identifier ?? '') && !inWindow(nodes, frame, [n.identifier!]).length);
      const middle = steps[Math.floor(steps.length / 2)];
      if (!middle) break;
      await app.scroll([middle.frame[0]! + middle.frame[2]! / 2, middle.frame[1]! + middle.frame[3]! / 2], frame[3]! / 2);
    }
    await take('long-card-960x640.png', async () => {
      const nodes = await app.nodes();
      if ((await app.address()) !== askAt(push!.handle)) return [`the window shows ${JSON.stringify(await app.address())}, not the approval's page`];
      return inWindow(nodes, frame, ['card-step:29']).map(() => 'the card\'s last row (card-step:29) isn\'t in the window');
    });
    frame = await at(NARROW);
    await take('narrow-page-700x640.png', async () => inWindow(await app.nodes(), frame, ['page-count']).map(() => 'the page shows no count (page-count) in the window'));
    await app.key(KEY.escape);
    await take('narrow-list-700x640.png', async () => inWindow(await app.nodes(), frame, [push!.handle, pick!.handle]).map((id) => `the ask row ${id} isn't in the window`));
    frame = await at(OPENING);
    for (let i = 0; i < 3 && !ROW.test((await app.focused())?.identifier ?? ''); i++) await app.key(KEY.f6);
    await app.key(KEY.down, { times: rows.length + 30 });
    await take('last-row-960x640.png', async () => inWindow(await app.nodes(), frame, [last]).map((id) => `the list's last row ${id} isn't in the window`));
  } finally {
    await app.stop();
  }
  return failures;
}

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));

describe(`AC9 ${ID.shown} shown to you`, () => {
  it(`AC9 ${ID.shown}: the check run takes the list scrolled to its last row, the window at 700 wide on the list and on a page, a long card scrolled and rows with a long, a Han and an Arabic title from the real app, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    await realAppAccess({ pictures: true });
    const out = process.env.DA1808_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = (await appBins()).plain;
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === app && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      const world = await makeWorld(SPECS);
      expect(await pictures(world, binary, out), 'each state is on the real window\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 1808, criterion: 'AC9', app })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC9: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC9: no taste call is recorded for these pictures (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC9: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC9: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 120 * MIN);
});
