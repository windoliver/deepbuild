// AC4 of #1592: Shown to you: a contact sheet of every state mark and icon in light and dark, taken by the check run from
// the real app, is attached to the PR and shown to you. Whether it looks right is one taste call, recorded; without it
// the run stays INCONCLUSIVE, never PASS.
//
// The real `deep-app`, built with its `contact-sheet` feature, opens its contact sheet (README, Pinned 4): one window that
// draws every status-map entry's mark and every icon the chrome draws, through the app's own builders, in the appearance
// DEEP_APP_APPEARANCE forces. It is read from outside its process: its tree through #1459's probe, which gives each node's
// identifier, and its window placed and captured by window ID through #1454's. The icons it must hold are every icon the
// replica's shipped pages draw, by name (the same reading as AC1). Each picture is taken once the sheet's tree holds every
// tile. Pictures go to $DA1592_SCREENS (a temp folder without it) with run.json, the app's SHA-256. Then TASTE.json is read:
// no call, an anonymous one or one on other files is INCONCLUSIVE; `looks_wrong` fails, quoting its note; `looks_right` on
// exactly these files passes. A kept folder holding exactly a recorded call's files, from this same app binary, stands, so
// the run doesn't take them again. "Attached to the PR and shown to you" is the implementing agent's; no test can see it.
// Nothing here judges a picture.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { App, probeBinary, settled, useCleanup } from '../1454/helpers.ts';
import {
  AC, ENTRIES, MINUTES, SUITE, blocked, cleanup, contactSheetApp, explore, iconFailures, inconclusive, run, sha256File, sleep, sorted,
  tempDir, type Taste,
} from './helpers.ts';

useCleanup();
afterAll(cleanup, 60_000);
const LOOKS = ['light', 'dark'] as const;
type Look = (typeof LOOKS)[number];
const file = (look: Look): string => `contact-sheet-${look}.png`;
const expected = (): string[] => [...LOOKS.map(file), 'run.json'].sort();
/** The sheet's tiles' identifiers (README, Pinned 4). */
const markTile = (entry: string): string => `contact-sheet:mark:${entry}`;
const iconTile = (icon: string): string => `contact-sheet:icon:${icon}`;

interface AxNode { identifier: string | null; children: AxNode[] }
const axFlat = (n: AxNode, into: AxNode[] = []): AxNode[] => { into.push(n); for (const c of n.children) axFlat(c, into); return into; };
/** Every identifier in the process's windows, as an assistive client reads them (#1459's probe). */
async function identifiers(pid: number): Promise<Set<string>> {
  const t1459 = await import('../1459/helpers.ts');
  const r = await t1459.run(await t1459.probeBinary(), ['tree', String(pid)], undefined, 60_000);
  if (r.code !== 0) blocked(`#1459's probe couldn't read the window's tree: ${r.stderr.slice(-300)}`);
  return new Set((JSON.parse(r.stdout) as { tree: AxNode }[]).flatMap((w) => axFlat(w.tree)).map((n) => n.identifier).filter((id): id is string => !!id));
}

/** The screen is locked: nothing a window draws reaches a capture (#1458's redraft reads it the same way). */
async function locked(): Promise<boolean> {
  const r = await run('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a']);
  return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(r.stdout);
}

/** The contact sheet in `look`, once its tree holds every tile, to `out`; what kept it from its picture. */
async function take(binary: string, look: Look, icons: readonly string[], out: string): Promise<string[]> {
  const app = await App.launch({ home: tempDir(), binary, args: ['--contact-sheet'], env: { DEEP_APP_APPEARANCE: look } });
  try {
    const tiles = [...ENTRIES.map(markTile), ...icons.map(iconTile)];
    const missing = await settled(async () => { const held = await identifiers(app.pid); return tiles.filter((t) => !held.has(t)); }, 30_000);
    if (missing.length) return [`${look}: the contact sheet's window holds no ${missing.join(', ')} (README, Pinned 4)`];
    await app.front();
    await sleep(800);
    const window = await app.mainWindow();
    const picture = await app.capture(file(look).replace(/\.png$/, ''), window);
    if (picture.width !== window.frame[2]! * 2 || picture.height !== window.frame[3]! * 2) inconclusive(`AC4: ${file(look)} is ${picture.width} × ${picture.height} px, not twice the window's ${window.frame[2]} × ${window.frame[3]} pt: this Mac's screen can't take it at 2×`);
    copyFileSync(picture.path, join(out, file(look)));
    return [];
  } finally {
    await app.stop();
  }
}

describe(`#1592 ${AC.shown} shown to you`, () => {
  it(`${AC.shown}: the check run takes the contact sheet of every state mark and icon from the real app in light and dark, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says it looks right`, async () => {
    if (process.platform !== 'darwin') blocked(`the app draws on macOS only; this is ${process.platform}`);
    const binary = await contactSheetApp();
    // Both probes compiled and their permissions read before any window waits on them.
    await probeBinary();
    await (await import('../1459/helpers.ts')).probeBinary();
    if (await locked()) blocked('the screen is locked, so no window\'s pixels can be captured');
    const out = process.env.DA1592_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === app && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      // Every icon the shipped pages draw, at rest and with the pointer over each node, as AC1 reads them.
      const icons = iconFailures(await explore({ hover: true })).names;
      const missing: string[] = [];
      for (const look of LOOKS) missing.push(...await take(binary, look, icons, out));
      expect(missing, 'every state mark and icon is on the contact sheet\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 1592, criterion: 'AC4', app, entries: ENTRIES, icons })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote both pictures and run.json to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC4: the contact sheet from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC4: no taste call is recorded for this contact sheet (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC4: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC4: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says the contact sheet doesn't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 240 * MINUTES);
});
