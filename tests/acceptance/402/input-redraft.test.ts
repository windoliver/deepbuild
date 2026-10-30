// Blind redraft of input.test.ts's SCOPE test (raw input: keys with press, repeat and release, text, paste, mouse, focus and
// resize), from the issue's scope line and the README's declared surface (Input (serve): what the hub sends for each input).
// Two real reader programs on real PTYs, each asking for bracketed paste, the mouse (1000, SGR) and focus events. Your click
// in A gives it focus (A may be told it gained it); the seam's events then go to A in a known order, and the bytes A reads
// from them are one contiguous run. Your click in B then tells A it lost focus and B that it gained it; a resize reaches A's
// program as a new window size. At the base `deep-show` has no `serve`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SLOTS, centre, down, installCall, openCall, openedOf, program, readBytes, readText, setupOf, sleep, strs, arr, terminalPlugin, tmp, upAt, useShow, waitFor, withServe,
  type JsonObject, type Serve,
} from './helpers.ts';

const show = useShow();
const [SLOT_A, SLOT_B] = [SLOTS[0]!, SLOTS[1]!];
const ESC = '\u001b';

async function click(s: Serve, panel: string, slot: [number, number, number, number]): Promise<void> {
  const pos = centre(slot);
  await s.ok(down(0, panel, pos), `your press in ${panel}`);
  await s.ok(upAt(0, panel, pos), `your release in ${panel}`);
}

describe('SCOPE raw input is keys with press, repeat and release, text, paste, mouse, focus and resize', () => {
  it('SCOPE a program that asked for bracketed paste, the mouse and focus events receives each as its escape says; a resize reaches it as a new window size', async () => {
    const dir = tmp('rawscope-redraft');
    mkdirSync(dir, { recursive: true });
    const [logA, logB] = [join(dir, 'a.log'), join(dir, 'b.log')];
    const modes = join(dir, 'modes.json');
    // Bracketed paste (2004), mouse presses and releases (1000) in SGR (1006), focus events (1004).
    writeFileSync(modes, JSON.stringify({ enable: `${ESC}[?2004h${ESC}[?1000h${ESC}[?1006h${ESC}[?1004h` }));
    let bBeforeFocus = '';
    await withServe(show(), setupOf({ evidence: dir, panels: { A: SLOT_A, B: SLOT_B } }), async (s) => {
      await s.ok(installCall(0, 'terminals', terminalPlugin({ A: 'TA', B: 'TB' })), 'the terminals plug-in installs');
      for (const [panel, terminal, log] of [['A', 'TA', logA], ['B', 'TB', logB]] as const) {
        const o = openedOf(await s.call(openCall(0, terminal, { panel, cols: 80, rows: 24, program: program(dir, 'reader', log, modes) }), 120_000), terminal);
        for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
      }
      await waitFor(() => readBytes(`${logA}.ready`).length + readBytes(`${logB}.ready`).length, (n) => n >= 2, 60_000);
      await sleep(1_000); // the programs have written their mode requests; give the hub's host a moment to apply them
      await click(s, 'A', SLOT_A);
      const focus = await s.ok({ call: 'focus' }, 'focus after your click in A');
      expect(focus['kb_focus'], 'keyboard focus is in A').toBe('A');
      const moved = await s.ok({ call: 'pointer', pos: centre(SLOT_A) }, 'the pointer over A');
      expect(moved['over'], 'the pointer is over A').toBe('A');

      const seam = async (event: JsonObject, what: string): Promise<void> => {
        const r = await s.ok({ call: 'seam', at: 0, event }, what);
        expect(strs(arr(r['reached'], `${what}: reached`), `${what}: reached`), `${what} reaches the focused panel A`).toEqual(['panel:A']);
      };
      await seam({ type: 'key', key: 'a', phase: 'press', mods: [] }, 'a key press');
      await seam({ type: 'key', key: 'a', phase: 'repeat', mods: [] }, 'a key repeat');
      await seam({ type: 'key', key: 'a', phase: 'release', mods: [] }, 'a key release');
      await seam({ type: 'text', text: 'é' }, 'input-method text');
      await seam({ type: 'paste', text: 'pasted text' }, 'a paste');
      const pos = centre(SLOT_A);
      await seam({ type: 'mouse', pos, button: 'left', phase: 'down' }, 'a mouse press');
      await seam({ type: 'mouse', pos, button: 'left', phase: 'up' }, 'a mouse release');
      await waitFor(() => readText(logA), (t) => /\u001b\[<0;\d+;\d+m/.test(t), 10_000);
      bBeforeFocus = readBytes(logB).toString('utf8');

      // Focus moves by your click in B: A is told it lost focus, B that it gained it.
      await click(s, 'B', SLOT_B);
      expect((await s.ok({ call: 'focus' }, 'focus after your click in B'))['kb_focus'], 'keyboard focus is in B').toBe('B');
      await waitFor(() => [readText(logA), readText(logB)], ([a, b]) => a!.includes(`${ESC}[O`) && b!.includes(`${ESC}[I`), 10_000);

      await s.ok({ call: 'terminal_resize', terminal: 'TA', cols: 100, rows: 30 }, 'a resize of A');
      await waitFor(() => readText(`${logA}.size`), (t) => t.includes('100x30'), 10_000);
    });
    const a = readBytes(logA).toString('utf8');
    const b = readBytes(logB).toString('utf8');
    // The seam's events, in the order made: `a` for the press and `a` for the repeat, nothing for the release (a legacy
    // terminal has no escape for it), `é`, the paste in its brackets, then the mouse press and release in SGR.
    const run = new RegExp(`aaé${ESC}\\[200~pasted text${ESC}\\[201~${ESC}\\[<0;([1-9]\\d*);([1-9]\\d*)M${ESC}\\[<0;\\1;\\2m`);
    const hit = run.exec(a);
    expect(hit, `A read the key press and repeat (a release sends nothing), the text, the bracketed paste and the SGR mouse press and release, in order: ${JSON.stringify(a)}`).not.toBeNull();
    const after = a.slice(hit!.index + hit![0].length);
    const before = a.slice(0, hit!.index);
    expect(before + hit![0], 'A is not told it lost focus while it holds it').not.toContain(`${ESC}[O`);
    expect(after, 'A is told it lost focus when your click moved focus to B').toContain(`${ESC}[O`);
    expect(bBeforeFocus, 'B, unfocused, read none of the keys, text, paste or mouse').not.toMatch(/a|é|pasted|\u001b\[<|\u001b\[200~/);
    expect(b, 'B is told it gained focus').toContain(`${ESC}[I`);
    const sizes = readText(`${logA}.size`).trim().split('\n');
    expect(sizes[0], 'A\'s program started with its 80 by 24 window').toBe('80x24');
    expect(sizes[sizes.length - 1], 'after the resize A\'s program has a 100 by 30 window').toBe('100x30');
  }, 600_000);
});
