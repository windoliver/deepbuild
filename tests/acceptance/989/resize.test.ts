// AC1 and AC2: the tab's size reaches the program, through the host. A hosted terminal's tab grows from 80x24 to 200x50
// and back: a full-screen program is redrawn at each size within 100 ms of the resize, and a program printing its size
// on each change prints both. Shrinking a 50-row terminal whose program printed 200 numbered lines to 20 rows keeps the
// bottom rows and the cursor, where the newest output is, and moves the top rows into the scrollback. Real components
// throughout: the extension host (#348) on a real record, the supervisor (#236) in the platform sandbox, the host
// process it starts, and real programs on its pseudo-terminal; the tab is the hub's own (ExtensionHost.tab).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost, Plant, TerminalTab } from '../../../packages/extension-host/src/index.ts';
import {
  YOU, installPiece, notesIn, openHost, openTerminal, openWorld, outputOf, program, readText, sleep, tabUntil, tempDir, waitFor,
} from './helpers.ts';

/** The frame the full-screen program draws at `c` x `r`, row by row. */
function frame(c: number, r: number): string[] {
  const edge = `+${'-'.repeat(c - 2)}+`;
  const mid = `|${' '.repeat(c - 2)}|`;
  return Array.from({ length: r }, (_, y) => (y === 0 || y === r - 1 ? edge : y === 1 ? `|${`size ${c}x${r}`.padEnd(c - 2)}|` : mid));
}
const framed = (c: number, r: number) => (t: TerminalTab): boolean => t.cols === c && t.rows === r && frame(c, r).every((row, y) => t.screen[y] === row);
const shows = (t: TerminalTab): string => `${t.cols}x${t.rows}, its first rows ${JSON.stringify(t.screen.slice(0, 2).map((r) => r.slice(0, 48)))}`;

/**
 * Opens a full-screen program and a size-printing program, each in a terminal of 80x24, then sizes each tab to 200x50
 * and back to 80x24 from the app. Returns every problem it sees; throws when a step it needs can't run.
 */
async function growProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const w = await openWorld();
  const h: ExtensionHost = await openHost(w, { plant });
  const p = await installPiece(h);
  const fullDir = tempDir('fullscreen');
  const sizeDir = tempDir('sizes');
  const full = await openTerminal(h, p, program(fullDir, 'fullscreen'), fullDir, 'fullscreen', 80, 24);
  const sizes = await openTerminal(h, p, program(sizeDir, 'sizes'), sizeDir, 'sizes', 80, 24);
  await notesIn(fullDir, ['pid']);
  await notesIn(sizeDir, ['pid', 'ready']);
  const start = await tabUntil(h, full.terminal, framed(80, 24), 10_000);
  if (!start.ok) throw Error(`the tab of ${full.terminal} (fullscreen) never showed its program's 80x24 frame before any resize: ${shows(start.tab)}`);

  for (const [c, r] of [[200, 50], [80, 24]] as const) {
    const t0 = Date.now();
    await h.resize(YOU, full.terminal, c, r);
    const seen = await tabUntil(h, full.terminal, framed(c, r), 3000);
    const ms = seen.at - t0;
    const drawn = readText(join(fullDir, 'drawn')).trim().split('\n').join(', ');
    if (!seen.ok) problems.push(`terminal ${full.terminal} (fullscreen): its tab sized ${c}x${r} never showed the program redrawn at ${c}x${r} within 3 s; it shows ${shows(seen.tab)}; the program drew ${drawn}`);
    else if (ms > 100) problems.push(`terminal ${full.terminal} (fullscreen): its tab showed the program redrawn at ${c}x${r} ${ms} ms after the resize, over 100 ms`);
    await h.resize(YOU, sizes.terminal, c, r);
    await sleep(300);
  }

  const printed = async (): Promise<string[]> => [...(await outputOf(h, p, sizes.terminal)).matchAll(/size (\d+x\d+)/g)].map((m) => m[1]!);
  await waitFor(printed, (v) => v.length >= 2, 3000);
  await sleep(500);
  const said = await printed();
  if (JSON.stringify(said) !== JSON.stringify(['200x50', '80x24'])) {
    problems.push(`terminal ${sizes.terminal} (sizes): its program printed [${said.join(', ')}] on the two changes, not [200x50, 80x24]`);
  }
  return problems;
}

const LINES = 200;
/**
 * A terminal of 80x50 whose program printed `line 1` to `line 200` (the last with no newline, so the cursor rests after
 * it, where the newest output is) and sleeps; its tab is shrunk to 80x20 from the app.
 */
async function shrinkProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const w = await openWorld();
  const h = await openHost(w, { plant });
  const p = await installPiece(h);
  const dir = tempDir('lines');
  const script = `i=1; while [ $i -lt ${LINES} ]; do echo "line $i"; i=$((i+1)); done; printf 'line ${LINES}'; : > '${dir}/done'; exec sleep 100000`;
  const t = await openTerminal(h, p, ['/bin/sh', '-c', script], dir, 'lines', 80, 50);
  const range = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);
  const before = await tabUntil(h, t.terminal, (x) => x.screen[49] === `line ${LINES}`, 10_000);
  if (!before.ok) throw Error(`the tab of ${t.terminal} never showed line ${LINES} on its bottom row before the shrink: ${JSON.stringify(before.tab.screen.slice(-3))}`);
  if (JSON.stringify(before.tab.screen) !== JSON.stringify(range(151, 200))) problems.push(`terminal ${t.terminal}: before the shrink its 50 rows aren't line 151 to line 200: ${JSON.stringify(before.tab.screen.slice(0, 3))}…`);
  if (JSON.stringify(before.tab.scrollback) !== JSON.stringify(range(1, 150))) problems.push(`terminal ${t.terminal}: before the shrink its scrollback isn't line 1 to line 150: ${before.tab.scrollback.length} rows`);

  await h.resize(YOU, t.terminal, 80, 20);
  const after = (await tabUntil(h, t.terminal, (x) => x.rows === 20, 1000)).tab;
  if (after.rows !== 20 || after.cols !== 80) problems.push(`terminal ${t.terminal}: after the shrink its tab is ${after.cols}x${after.rows}, not 80x20`);
  const want = range(181, 200);
  if (JSON.stringify(after.screen) !== JSON.stringify(want)) {
    const nums = after.screen.map((r) => /^line (\d+)$/.exec(r)?.[1]).filter((n): n is string => !!n).map(Number);
    const shown = nums.length ? `line ${Math.min(...nums)} to line ${Math.max(...nums)}` : 'no numbered line';
    const missing = want.find((l) => !after.screen.includes(l));
    problems.push(`terminal ${t.terminal}: after the shrink to 20 rows its tab shows ${shown}, not line 181 to line 200; the first missing line is ${missing ?? 'none (they are out of order)'}`);
  }
  if (after.cursor.row !== 19 || after.cursor.col !== `line ${LINES}`.length) {
    problems.push(`terminal ${t.terminal}: after the shrink its cursor is at row ${after.cursor.row}, column ${after.cursor.col}, not after line ${LINES} on the bottom row (row 19, column ${`line ${LINES}`.length})`);
  }
  const back = range(1, 180);
  if (JSON.stringify(after.scrollback) !== JSON.stringify(back)) {
    const i = back.findIndex((l, k) => after.scrollback[k] !== l);
    problems.push(`terminal ${t.terminal}: after the shrink its scrollback holds ${after.scrollback.length} rows, not line 1 to line 180 in order; row ${i} reads ${JSON.stringify(after.scrollback[i] ?? null)}, not "${back[i] ?? ''}"`);
  }
  return problems;
}

describe('AC1 a hosted terminal\'s tab size reaches its program, through the host', () => {
  it('AC1 a tab grown from 80x24 to 200x50 and back shows a full-screen program redrawn at each size within 100 ms, and a program printing its size on each change prints 200x50 then 80x24', async () => {
    expect(await growProblems()).toEqual([]);
  }, 120_000);

  it('AC1 (wrong program) keeps-start-size: a host that signals the program but keeps the start size prints 80x24 twice and fails, naming the terminal', async () => {
    const problems = (await growProblems('keeps-start-size')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/terminal term:\S+ \(sizes\): its program printed \[80x24, 80x24\]/);
  }, 120_000);
});

describe('AC2 shrinking the rows keeps the bottom rows and the cursor, and moves the top rows into the scrollback', () => {
  it('AC2 a 50-row terminal whose program printed 200 numbered lines, shrunk to 20 rows, shows lines 181 to 200 with the cursor after them and lines 1 to 180 in the scrollback in order', async () => {
    expect(await shrinkProblems()).toEqual([]);
  }, 120_000);

  it('AC2 (wrong program) resize-drops-bottom-rows: a resize that drops the bottom rows shows 151 to 170 and fails, naming the first missing line', async () => {
    const problems = (await shrinkProblems('resize-drops-bottom-rows')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/shows line 151 to line 170, not line 181 to line 200; the first missing line is line 181/);
  }, 120_000);
});
