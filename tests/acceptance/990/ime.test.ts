// AC6: with a Chinese input method, typing a word into a program that hides its cursor shows the composition at the
// program's cursor cell and sends only the committed characters, once; a planted router that sends composing text sends
// it twice and fails. The SCOPE test: mouse reports use the drawn cell size, not a fixed one.
//
// A real Node program on a real PTY through `deep-show serve` hides its cursor (DECTCEM off) and puts it at row 5, column
// 12, then logs every byte it reads. The input method's events come through the input seam's test backend as the
// platform gives them: marked text while you compose (`preedit`: "n", "ni", "ni h", "ni ha", "ni hao", the pinyin of 你好)
// and then the committed text (`text`: "你好"). While composing, the grid (`cells`) says where it draws the composition
// (`preedit`: its text and its cell); after the commit, nothing is composing and the program has read 你好, once.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESC, SLOTS, TERMINAL, click, grid, gridOf, installCall, newBytes, openCall, openFocused, openedOf, readBytes, script, seam, setup, setupOf, shown,
  sleep, terminalPlugin, tmp, useShow, waitFor, waitScreen, withServe, type JsonObject, type Serve,
} from './helpers.ts';

const show = useShow();
const PINYIN = ['n', 'ni', 'ni h', 'ni ha', 'ni hao'];
const WORD = '你好';

interface Composed { preedits: (JsonObject | null)[]; cursor: { x: number; y: number; visible: boolean }; during: Buffer; after: Buffer; endPreedit: JsonObject | null }

async function compose(bin: string, planted?: string): Promise<Composed> {
  const dir = tmp('ime');
  const log = join(dir, 'in.log');
  return withServe(bin, setup(dir, planted), async (s) => {
    await openFocused(s, script(dir, 'recorder', log, { out: `READY-ime${ESC}[?25l${ESC}[5;12H` }));
    await waitScreen(s, (rows) => rows.some((r) => r.includes('READY-ime')), 'the program is up');
    const g0 = await waitFor(() => grid(s, 'the grid'), (g) => g.cursor.x === 11 && g.cursor.y === 4 && !g.cursor.visible, 10_000, 100);
    const preedits: (JsonObject | null)[] = [];
    for (const text of PINYIN) {
      await s.ok(seam({ type: 'preedit', text }), `composing "${text}"`);
      const r = await s.ok({ call: 'cells', terminal: TERMINAL }, `the grid while composing "${text}"`);
      preedits.push(r['preedit'] === undefined || r['preedit'] === null ? null : (r['preedit'] as JsonObject));
    }
    await sleep(500);
    const during = readBytes(log);
    await s.ok(seam({ type: 'text', text: WORD }), `committing ${WORD}`);
    await newBytes(log, during.length, 3000);
    await sleep(500);
    const end = await s.ok({ call: 'cells', terminal: TERMINAL }, 'the grid after the commit');
    return { preedits, cursor: g0.cursor, during, after: readBytes(log).subarray(during.length), endPreedit: (end['preedit'] ?? null) as JsonObject | null };
  });
}

/** What "the composition at the cursor cell, only the committed characters, once" asks. */
function imeProblems(c: Composed): string[] {
  const f: string[] = [];
  PINYIN.forEach((text, i) => {
    const p = c.preedits[i];
    if (!p) { f.push(`while composing "${text}" the grid shows no composition (cells: preedit)`); return; }
    if (p['text'] !== text) f.push(`while composing "${text}" the composition shown is ${JSON.stringify(p['text'])}`);
    if (p['x'] !== 11 || p['y'] !== 4) f.push(`while composing "${text}" the composition is at cell (${String(p['x'])}, ${String(p['y'])}), not the program's cursor cell (11, 4), which the program hid`);
  });
  if (c.during.length > 0) f.push(`composing text reached the program before the commit: it read "${shown(c.during)}"`);
  const committed = c.after.toString('utf8');
  const times = committed.split(WORD).length - 1;
  if (times !== 1 || committed !== WORD) f.push(`the program read "${shown(c.after)}" after the commit, not ${WORD} once (${times} times)`);
  if (c.endPreedit) f.push(`the composition is still shown after the commit: ${JSON.stringify(c.endPreedit)}`);
  return f;
}

describe('AC6 input methods: the composition at the program\'s cursor, only committed text to the program', () => {
  it('AC6 composing 你好 in pinyin into a program that hid its cursor shows each composition at the program\'s cursor cell, sends nothing while composing, and sends 你好 once on the commit', async () => {
    const c = await compose(show());
    expect(c.cursor, 'the program\'s cursor is at (11, 4) and hidden').toMatchObject({ x: 11, y: 4, visible: false });
    expect(imeProblems(c), 'the composition shown at the cursor, the word sent once').toEqual([]);
  }, 600_000);

  it('AC6 a planted router that sends composing text sends the word twice and fails', async () => {
    const c = await compose(show(), 'ime_sends_composing');
    const f = imeProblems(c);
    expect(f.some((m) => m.startsWith('composing text reached the program') || m.includes(`not ${WORD} once`)), `the planted ime_sends_composing fails, naming the composing text it sent: ${JSON.stringify(f)}`).toBe(true);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// SCOPE: mouse reports use the drawn cell size

interface Drawn { x: number; y: number; w: number; h: number }
const drawnOf = (r: JsonObject, what: string): Drawn => {
  const d = r['drawn'] as JsonObject | undefined;
  expect(d, `${what}: the grid says where and how big it draws its cells (cells: drawn {x, y, w, h}, window px)`).toBeDefined();
  const n = (k: string): number => { const v = d![k]; expect(typeof v, `${what}: drawn.${k} is a number`).toBe('number'); return v as number; };
  return { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
};

describe('SCOPE mouse reports use the drawn cell size, not a fixed one', () => {
  it('SCOPE two terminals drawn at font sizes 13 and 20: the larger font draws larger cells, and a click at the centre of column 15, row 6 of each, by its drawn cells, reaches its program as that cell', async () => {
    const dir = tmp('mouse');
    const panels = { A: SLOTS[0]!, B: SLOTS[1]! };
    const got: Record<string, string> = {};
    const drawn: Record<string, Drawn> = {};
    await withServe(show(), setupOf({ evidence: dir, panels }), async (s: Serve) => {
      await s.ok(installCall(0, 'terminals', terminalPlugin({ A: 'TA', B: 'TB' })), 'the terminals plug-in installs');
      for (const [panel, terminal, size] of [['A', 'TA', 13], ['B', 'TB', 20]] as const) {
        const log = join(dir, `${panel}.log`);
        const o = openedOf(await s.call({ ...openCall(0, terminal, { panel, cols: 30, rows: 12, program: script(join(dir, panel), 'recorder', log, { out: `READY-${panel}${ESC}[?1000h${ESC}[?1006h` }) }), font: { size } }, 120_000), terminal);
        for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
      }
      for (const [panel, terminal] of [['A', 'TA'], ['B', 'TB']] as const) {
        await waitFor(async () => gridOf(await s.ok({ call: 'cells', terminal }, `${panel}'s grid`), `${panel}'s grid`), (g) => g.modes['mouse'] === 'sgr', 30_000, 100);
        drawn[panel] = drawnOf(await s.ok({ call: 'cells', terminal }, `${panel}'s grid`), `${panel}'s grid`);
      }
      for (const [panel] of [['A'], ['B']] as const) {
        const d = drawn[panel]!;
        const log = join(dir, `${panel}.log`);
        await click(s, panel, panels[panel]);
        const from = readBytes(log).length;
        const pos = [d.x + 14.5 * d.w, d.y + 5.5 * d.h];
        await s.ok(seam({ type: 'mouse', pos, button: 'left', phase: 'down' }), `a press at column 15, row 6 of ${panel}`);
        await s.ok(seam({ type: 'mouse', pos, button: 'left', phase: 'up' }), `a release there`);
        got[panel] = shown(await newBytes(log, from, 3000));
      }
    });
    expect(drawn['B']!.w > drawn['A']!.w && drawn['B']!.h > drawn['A']!.h, `the 20-point terminal draws larger cells than the 13-point one: ${JSON.stringify(drawn)}`).toBe(true);
    expect(got, 'each click reaches its program as column 15, row 6 (SGR, press and release)').toEqual({ A: '\\x1b[<0;15;6M\\x1b[<0;15;6m', B: '\\x1b[<0;15;6M\\x1b[<0;15;6m' });
  }, 600_000);
});
