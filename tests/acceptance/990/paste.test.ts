// AC2: pasting text that contains `ESC[201~` followed by `rm -rf ~/planted` into a shell with bracketed paste on leaves
// the whole text at the prompt and runs nothing; a planted paste that keeps the marker runs the command against a planted
// folder and fails, naming the paste. The SCOPE test: a paste into a program without bracketed paste sends no marker at
// all, not even the one inside its text.
//
// A real shell on a real PTY through `deep-show serve`: bash 5.1 or newer (readline's bracketed paste) with its own HOME
// (a temp folder holding the folder `planted` and a file in it) and an inputrc that turns bracketed paste on. A command
// you type first runs (the control: this shell runs what reaches it as typed keys), then the paste goes through the input
// seam's test backend. The pasted text is two commands, `touch ~/pasted-ran` and `rm -rf ~/planted`, with an end-of-paste
// marker between them: a paste that keeps the marker ends early at it, and the rest arrives as typed keys and runs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESC, grid, inconclusive, modernBash, newBytes, openFocused, progEnv, readBytes, script, seam, setup, shown, sleep, tmp, useShow, waitFor, waitScreen,
  withServe, keyEvent,
} from './helpers.ts';

const show = useShow();
const END = `${ESC}[201~`;
const PASTE = `touch ~/pasted-ran\n${END}rm -rf ~/planted\n`;
const PROMPT = '990$';

interface Played { plantedLeft: boolean; ran: boolean; control: boolean; screen: string[] }

async function play(bin: string, planted?: string): Promise<Played> {
  const bash = modernBash();
  if ('why' in bash) inconclusive(bash.why);
  const home = tmp('paste');
  mkdirSync(join(home, 'planted'), { recursive: true });
  writeFileSync(join(home, 'planted', 'keep.txt'), 'the planted folder\n');
  writeFileSync(join(home, 'inputrc'), 'set enable-bracketed-paste on\n');
  const program = { argv: [bash.path, '--noprofile', '--norc', '-i'], env: progEnv(home, { PS1: `${PROMPT} `, INPUTRC: join(home, 'inputrc'), HISTFILE: '/dev/null' }), cwd: home };
  return withServe(bin, setup(home, planted), async (s) => {
    await openFocused(s, program);
    const atPrompt = (): Promise<unknown> => waitFor(() => grid(s, 'the shell'), (g) => g.text.some((r) => r.endsWith(PROMPT)) && g.modes['bracketed_paste'] === true, 30_000, 100);
    await atPrompt();
    const g0 = await grid(s, 'the shell at its prompt');
    expect(g0.modes['bracketed_paste'], 'the shell turned bracketed paste on at its prompt (the grid\'s modes)').toBe(true);
    // The control: a command typed as keys runs.
    await s.ok(seam({ type: 'text', text: 'touch ~/control' }), 'typing a command');
    await s.ok(keyEvent('enter', [], 'Enter'), 'Enter');
    const control = await waitFor(() => existsSync(join(home, 'control')), (v) => v, 15_000);
    await waitFor(() => grid(s, 'the shell'), (g) => g.text.filter((r) => r.endsWith(PROMPT)).length >= 2, 15_000, 100);
    await s.ok(seam({ type: 'paste', text: PASTE }), `the paste ${JSON.stringify(PASTE)}`);
    await sleep(2500);
    return { plantedLeft: existsSync(join(home, 'planted', 'keep.txt')), ran: existsSync(join(home, 'pasted-ran')), control, screen: (await grid(s, 'the shell after the paste')).text };
  });
}

/** What "leaves the whole text at the prompt and runs nothing" asks, as failures naming the paste. */
function pasteProblems(p: Played): string[] {
  const f: string[] = [];
  const name = `the paste ${JSON.stringify(PASTE)}`;
  if (!p.plantedLeft) f.push(`${name} ended early at its ESC[201~: rm -rf ~/planted ran and deleted the planted folder`);
  if (p.ran) f.push(`${name} ran touch ~/pasted-ran: a pasted command ran without your Enter`);
  const screen = p.screen.join('\n');
  for (const part of ['touch ~/pasted-ran', 'rm -rf ~/planted']) if (!screen.includes(part)) f.push(`${name}: "${part}" is not at the prompt; the screen: ${JSON.stringify(p.screen.filter((r) => r !== '').slice(-6))}`);
  return f;
}

describe('AC2 a paste can\'t end early', () => {
  it('AC2 a paste of "touch ~/pasted-ran", ESC[201~ and "rm -rf ~/planted" into bash with bracketed paste on leaves the whole text at the prompt and runs nothing: the planted folder stays', async () => {
    const p = await play(show());
    expect(p.control, 'the control: a command typed as keys runs in this shell').toBe(true);
    expect(pasteProblems(p), 'the whole text at the prompt, nothing run').toEqual([]);
  }, 600_000);

  it('AC2 a planted paste that keeps the marker runs rm -rf against the planted folder and fails, naming the paste', async () => {
    const p = await play(show(), 'paste_keeps_end_marker');
    expect(p.control, 'the control: a command typed as keys runs in this shell').toBe(true);
    expect(p.plantedLeft, 'the planted paste ends early and the rest runs: the planted folder is deleted').toBe(false);
    const f = pasteProblems(p);
    expect(f.some((m) => m.startsWith(`the paste ${JSON.stringify(PASTE)}`) && m.includes('rm -rf ~/planted ran')), `the planted paste_keeps_end_marker fails, naming the paste: ${JSON.stringify(f)}`).toBe(true);
  }, 600_000);
});

describe('SCOPE a paste into a program without bracketed paste sends no marker at all', () => {
  it('SCOPE the same text pasted into a program that never turned bracketed paste on reaches it with no ESC[200~ and no ESC[201~, the rest of the text whole', async () => {
    const dir = tmp('nomarker');
    const log = join(dir, 'in.log');
    let got: Buffer = Buffer.alloc(0);
    await withServe(show(), setup(dir), async (s) => {
      await openFocused(s, script(dir, 'recorder', log, { out: 'READY-nomarker' }));
      const g = await waitScreen(s, (rows) => rows.some((r) => r.includes('READY-nomarker')), 'the program is up');
      expect(g.modes['bracketed_paste'], 'the program has bracketed paste off').toBe(false);
      const from = readBytes(log).length;
      await s.ok(seam({ type: 'paste', text: PASTE }), 'the paste');
      got = await newBytes(log, from, 5000);
    });
    const text = got.toString('utf8');
    expect(text.includes(`${ESC}[200~`) || text.includes(END), `no marker reaches the program: it read "${shown(got)}"`).toBe(false);
    expect(text.replace(/\r/g, '\n'), 'the rest of the text arrives whole (a newline may arrive as CR)').toBe('touch ~/pasted-ran\nrm -rf ~/planted\n');
  }, 600_000);
});
