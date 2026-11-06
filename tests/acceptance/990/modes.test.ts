// AC5: a program that turns on bracketed paste, mouse reporting, keyboard flags and the alternate screen and then exits
// leaves a shell whose next paste and click arrive as plain text and nothing; a host that leaves the modes on sends
// escape codes to the shell and fails, naming the mode. The SCOPE test: the same when the host restarts the program.
//
// A real shell on a real PTY through `deep-show serve`: `/bin/sh -i` (job control on, no line editor of its own). You type
// one command line: run a Node program that turns on the alternate screen, bracketed paste, mouse reporting (1000, SGR
// 1006), application cursor and pushes keyboard flags 1, then exits; then the shell itself prints a marker and reads one
// line with its `read` builtin and writes that line's bytes, in hex, to a file. Once the marker shows, you click in the
// panel, paste "PASTED-990", press Up, Escape and Enter. With every mode reset, the shell reads exactly the paste's text,
// CSI A and ESC; a mode left on shows as its escape in that line, which names it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESC, SLOT, centre, fileText, grid, keyEvent, openFocused, progEnv, readBytes, script, scriptPath, seam, setup, shown, sleep, tmp, useShow, waitFor,
  waitScreen, withServe, type Grid, type Serve,
} from './helpers.ts';

const show = useShow();
const MODES_ON = `${ESC}[?1049h${ESC}[?2004h${ESC}[?1000h${ESC}[?1006h${ESC}[?1h${ESC}[>1u in-the-program\r\n`;
const LINE = `PASTED-990${ESC}[A${ESC}`;

/** Your click, paste, Up, Escape and Enter, through the input seam. */
async function typeAfter(s: Serve): Promise<void> {
  const [x, y] = centre(SLOT);
  await s.ok(seam({ type: 'mouse', pos: [x, y], button: 'left', phase: 'down' }), 'your click (press)');
  await s.ok(seam({ type: 'mouse', pos: [x, y], button: 'left', phase: 'up' }), 'your click (release)');
  await s.ok(seam({ type: 'paste', text: 'PASTED-990' }), 'your paste');
  await s.ok(keyEvent('up', [], 'ArrowUp'), 'Up');
  await s.ok(keyEvent('escape', [], 'Escape'), 'Escape');
}

/** What "plain text and nothing" asks of the bytes the next reader got and of the grid's modes; each failure names the mode. */
function modeProblems(got: Buffer, g: Grid, who: string): string[] {
  const f: string[] = [];
  const t = got.toString('latin1');
  if (t.includes(`${ESC}[200~`) || t.includes(`${ESC}[201~`)) f.push(`bracketed paste is still on: ${who} read the paste as "${shown(got)}"`);
  if (/\x1b\[<\d+;\d+;\d+[Mm]/.test(t) || t.includes(`${ESC}[M`)) f.push(`mouse reporting is still on: ${who} read your click as "${shown(got)}"`);
  if (t.includes(`${ESC}OA`)) f.push(`application cursor is still on: ${who} read Up as SS3 A in "${shown(got)}"`);
  if (/\x1b\[\d+(;\d+)?u/.test(t)) f.push(`keyboard flags are still pushed: ${who} read Escape as a CSI u escape in "${shown(got)}"`);
  if (g.modes['alt_screen'] === true) f.push('the alternate screen is still on after the program exited');
  for (const [k, off] of [['bracketed_paste', false], ['app_cursor', false], ['mouse', 'none']] as const) if (g.modes[k] !== off) f.push(`the grid's mode ${k} is ${JSON.stringify(g.modes[k])}, not ${JSON.stringify(off)}, after the program exited`);
  if (f.length === 0 && t !== LINE) f.push(`${who} read "${shown(got)}", not the paste's text, CSI A and ESC ("${shown(LINE)}")`);
  return f;
}

async function playShell(bin: string, planted?: string): Promise<{ got: Buffer; grid: Grid; ran: string }> {
  const dir = tmp('modes');
  const log = join(dir, 'modes.log');
  const cfg = join(dir, 'modes.json');
  writeFileSync(cfg, JSON.stringify({ out: MODES_ON, hold_ms: 500 }));
  const program = { argv: ['/bin/sh', '-i'], env: progEnv(dir, { PS1: '990$ ', ENV: '' }), cwd: dir };
  return withServe(bin, setup(dir, planted), async (s) => {
    await openFocused(s, program);
    await waitScreen(s, (rows) => rows.some((r) => r.endsWith('990$')), 'the shell\'s prompt');
    const line = `${process.execPath} ${scriptPath(dir, 'modes')} ${log} ${cfg}; echo READY-990; IFS= read -r line; printf '%s' "$line" | od -An -tx1 | tr -d ' \\n' > got.hex; echo DONE-990`;
    await s.ok(seam({ type: 'text', text: line }), 'typing the command line');
    await s.ok(keyEvent('enter', [], 'Enter'), 'Enter');
    await waitScreen(s, (rows) => rows.some((r) => r.trim() === 'READY-990'), 'the program ran and exited, and the shell reads input');
    await typeAfter(s);
    await s.ok(keyEvent('enter', [], 'Enter'), 'Enter, ending the line');
    await waitFor(() => fileText(join(dir, 'got.hex')), (t) => t !== '', 15_000);
    await waitScreen(s, (rows) => rows.some((r) => r.trim() === 'DONE-990'), 'the shell wrote what it read');
    return { got: Buffer.from(fileText(join(dir, 'got.hex')).trim(), 'hex'), grid: await grid(s, 'the grid after'), ran: fileText(log) };
  });
}

describe('AC5 modes a program set are reset when it exits', () => {
  it('AC5 after a program turns on bracketed paste, mouse reporting, keyboard flags, application cursor and the alternate screen and exits, the shell reads your paste as plain text, your click as nothing and Up and Escape as plain keys; the grid is back on the main screen', async () => {
    const p = await playShell(show());
    expect(p.ran, 'the program ran and exited').toBe('exiting');
    expect(modeProblems(p.got, p.grid, 'the shell'), 'every mode reset before the shell read input').toEqual([]);
  }, 600_000);

  it('AC5 a host that leaves the modes on sends escape codes to the shell and fails, naming the mode', async () => {
    const p = await playShell(show(), 'modes_left_on');
    const f = modeProblems(p.got, p.grid, 'the shell');
    expect(f.some((m) => m.startsWith('bracketed paste is still on')), `the planted modes_left_on fails, naming the mode: ${JSON.stringify(f)}`).toBe(true);
  }, 600_000);
});

describe('SCOPE modes are reset when the host restarts the program', () => {
  it('SCOPE a terminal whose program turned every mode on and exited, restarted with a new program (`terminal_restart`), gives the new program your paste, click, Up and Escape as plain bytes', async () => {
    const dir = tmp('restart');
    const log = join(dir, 'modes.log');
    const rec = join(dir, 'in.log');
    let got: Buffer = Buffer.alloc(0);
    let g: Grid | null = null;
    await withServe(show(), setup(dir), async (s) => {
      await openFocused(s, script(dir, 'modes', log, { out: MODES_ON, hold_ms: 500 }));
      await waitFor(() => fileText(log), (t) => t === 'exiting', 30_000);
      const r = await s.ok({ call: 'terminal_restart', terminal: 'T1', program: script(dir, 'recorder', rec, { out: 'READY-restart' }) }, 'the host restarts the program', 120_000);
      expect(r['restarted'], `the terminal restarts its program: ${JSON.stringify(r)}`).toBe(true);
      const pid = (r['program'] as { pid?: number } | undefined)?.pid;
      if (typeof pid === 'number') s.known.add(pid);
      await waitScreen(s, (rows) => rows.some((x) => x.includes('READY-restart')), 'the restarted program is up');
      const from = readBytes(rec).length;
      await typeAfter(s);
      await waitFor(() => readBytes(rec).length, (n) => n >= from + 'PASTED-990'.length + 4, 10_000);
      await sleep(300);
      got = readBytes(rec).subarray(from);
      g = await grid(s, 'the grid after the restart');
    });
    expect(modeProblems(got, g!, 'the restarted program'), 'every mode reset before the restarted program read input').toEqual([]);
  }, 600_000);
});
