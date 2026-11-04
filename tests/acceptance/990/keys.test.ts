// AC1: a byte-level matrix, run every release. Enter, Tab, Backspace, the four arrows and F1 to F12, each with no
// modifier, Shift, Option, Control and their pairs, in normal mode, application-cursor mode and with keyboard flags 1 and
// 31 pushed, each produces the bytes the table below names; a planted encoder that sends a bare carriage return for
// Shift+Enter fails, naming the key and the mode. Proof: the base fails at Shift+Enter.
//
// Real components only: `deep-show serve` (#402) runs a Node program on a real PTY; the program sets the mode itself by
// writing its escape (DECSET ?1 for application cursor, `CSI > 1 u` / `CSI > 31 u` to push the progressive keyboard
// protocol's flags), prints a marker, and logs every byte it reads in raw mode. Once the grid shows the marker (so the
// host applied the mode escape), each key goes through the input seam's test backend (`seam`, a key event with its key
// name, its physical key `code` and its modifiers) to the focused panel, and the bytes the program read are compared with
// the table. The SCOPE test is "shortcuts match by physical key under any input source": Control with the key in the C
// and D positions under a Russian layout still sends ^C and ^D.
import { describe, expect, it } from 'vitest';
import { ESC, keyEvent, newBytes, openFocused, readBytes, script, setup, shown, tmp, useShow, waitScreen, withServe } from './helpers.ts';

const show = useShow();

// ---------------------------------------------------------------------------------------------------
// The table. Modifier sets as the seam names them ("alt" is Option), and the parameter m both encodings use:
// m = 1 + (Shift 1) + (Alt/Option 2) + (Control 4)  (xterm "PC-style function keys"; kitty keyboard protocol "Modifiers").
const MODS: { name: string; mods: string[]; m: number }[] = [
  { name: 'none', mods: [], m: 1 },
  { name: 'Shift', mods: ['shift'], m: 2 },
  { name: 'Option', mods: ['alt'], m: 3 },
  { name: 'Control', mods: ['ctrl'], m: 5 },
  { name: 'Shift+Option', mods: ['shift', 'alt'], m: 4 },
  { name: 'Shift+Control', mods: ['shift', 'ctrl'], m: 6 },
  { name: 'Option+Control', mods: ['alt', 'ctrl'], m: 7 },
];
type Mode = 'normal' | 'application-cursor' | 'keyboard flags 1' | 'keyboard flags 31';
/** What the program writes to put its terminal in each mode (and nothing else on: every other mode is at its default). */
const MODE_ON: Record<Mode, string> = {
  normal: '',
  'application-cursor': `${ESC}[?1h`, // DECCKM
  'keyboard flags 1': `${ESC}[>1u`, // push flags 1: disambiguate escape codes
  'keyboard flags 31': `${ESC}[>31u`, // push 1|2|4|8|16: disambiguate, event types, alternate keys, all keys as escapes, associated text
};
const MODES = Object.keys(MODE_ON) as Mode[];

/**
 * One key's row: for each mode, the bytes with no modifier and the bytes with modifier parameter m (`{m}`), plus the
 * exceptions by modifier name. Sources, cited per rule:
 *
 * Normal and application-cursor modes (no keyboard flags): xterm's encoding (ctlseqs, "PC-Style Function Keys" and
 * "modifyOtherKeys"):
 * - Arrows: CSI A/B/C/D; in application-cursor mode SS3 A/B/C/D, but only with no modifier; with a modifier
 *   CSI 1 ; m A/B/C/D in both modes.
 * - F1–F4: SS3 P/Q/R/S with no modifier (both modes; DECCKM doesn't touch them), CSI 1 ; m P/Q/R/S with one.
 * - F5–F12: CSI 15/17/18/19/20/21/23/24 ~, with a modifier CSI n ; m ~.
 * - Enter, Tab, Backspace: CR, HT, DEL with no modifier. Shift+Tab is CSI Z (backtab, terminfo kcbt). Option alone is
 *   ESC before the key's byte (xterm metaSendsEscape, the macOS terminals' "Option as Meta"), which shells read as Meta.
 *   Every other modified Enter, Tab or Backspace is xterm's modifyOtherKeys form CSI 27 ; m ; code ~ (code 13, 9, 127),
 *   so Shift, Option and Control all reach the program: Shift+Enter is CSI 27;2;13~, never a bare CR.
 *
 * Keyboard flags pushed (the kitty keyboard protocol, sw.kovidgoyal.net/kitty/keyboard-protocol):
 * - Flag 1, "Disambiguate escape codes": keys that don't make text are CSI number ; modifier u or CSI 1 ; modifier
 *   [ABCDPQS] / CSI number ; modifier ~; "the only exceptions are the Enter, Tab and Backspace keys which still generate
 *   the same bytes as in legacy mode" — with no modifier. With one they are CSI 13/9/127 ; m u (Shift+Tab is CSI 9;2u,
 *   not CSI Z). No legacy SS3: an unmodified arrow is CSI A, F1 CSI P, F2 CSI Q, F4 CSI S. F3 is CSI 13 ~ (the spec's
 *   table: "F3 13 ~"; CSI R is the cursor position report). With no modifier the "1;" and the modifier are left out.
 * - Flag 8 (in 31), "Report all keys as escape codes": "this flag implies all keys are reported as escape codes,
 *   including the Enter, Tab and Backspace keys": Enter CSI 13 u, Tab CSI 9 u, Backspace CSI 127 u.
 * - Flag 2 (in 31), event types: a press is event type 1, the default, which is left out (as kitty itself writes it);
 *   these tests send presses only. Flag 4, alternate keys: none of these keys has a shifted or base-layout alternate.
 *   Flag 16, associated text: none of these keys makes text. So the rest of 31 is flag 1's table.
 * - Application-cursor mode is off in the flags rows; with flags pushed it would not change these bytes anyway.
 */
interface Row { key: string; code: string; label: string; modes: Record<Mode, { none: string; mod: string; except?: Record<string, string> }> }
const C = `${ESC}[`;
const SS3 = `${ESC}O`;
function legacyText(byte: string, codeNum: number): Row['modes']['normal'] {
  return { none: byte, mod: `${C}27;{m};${codeNum}~`, except: { Option: `${ESC}${byte}`, ...(codeNum === 9 ? { Shift: `${C}Z` } : {}) } };
}
const kittyText = (byte: string, codeNum: number, flags: 1 | 31): Row['modes']['normal'] => ({ none: flags === 1 ? byte : `${C}${codeNum}u`, mod: `${C}${codeNum};{m}u` });
function textKey(key: string, code: string, label: string, byte: string, codeNum: number): Row {
  return { key, code, label, modes: { normal: legacyText(byte, codeNum), 'application-cursor': legacyText(byte, codeNum), 'keyboard flags 1': kittyText(byte, codeNum, 1), 'keyboard flags 31': kittyText(byte, codeNum, 31) } };
}
function arrow(key: string, code: string, label: string, f: string): Row {
  const kitty = { none: `${C}${f}`, mod: `${C}1;{m}${f}` };
  return { key, code, label, modes: { normal: { none: `${C}${f}`, mod: `${C}1;{m}${f}` }, 'application-cursor': { none: `${SS3}${f}`, mod: `${C}1;{m}${f}` }, 'keyboard flags 1': kitty, 'keyboard flags 31': kitty } };
}
function f1to4(n: number, f: string): Row {
  const legacy = { none: `${SS3}${f}`, mod: `${C}1;{m}${f}` };
  // F3 under the keyboard protocol is CSI 13 ~ (spec table), the others CSI 1 ; m P/Q/S with "1;m" left out unmodified.
  const kitty = f === 'R' ? { none: `${C}13~`, mod: `${C}13;{m}~` } : { none: `${C}${f}`, mod: `${C}1;{m}${f}` };
  return { key: `f${n}`, code: `F${n}`, label: `F${n}`, modes: { normal: legacy, 'application-cursor': legacy, 'keyboard flags 1': kitty, 'keyboard flags 31': kitty } };
}
function f5to12(n: number, num: number): Row {
  const t = { none: `${C}${num}~`, mod: `${C}${num};{m}~` };
  return { key: `f${n}`, code: `F${n}`, label: `F${n}`, modes: { normal: t, 'application-cursor': t, 'keyboard flags 1': t, 'keyboard flags 31': t } };
}
const TABLE: Row[] = [
  textKey('enter', 'Enter', 'Enter', '\r', 13),
  textKey('tab', 'Tab', 'Tab', '\t', 9),
  textKey('backspace', 'Backspace', 'Backspace', '\x7f', 127),
  arrow('up', 'ArrowUp', 'Up', 'A'),
  arrow('down', 'ArrowDown', 'Down', 'B'),
  arrow('right', 'ArrowRight', 'Right', 'C'),
  arrow('left', 'ArrowLeft', 'Left', 'D'),
  f1to4(1, 'P'), f1to4(2, 'Q'), f1to4(3, 'R'), f1to4(4, 'S'),
  f5to12(5, 15), f5to12(6, 17), f5to12(7, 18), f5to12(8, 19), f5to12(9, 20), f5to12(10, 21), f5to12(11, 23), f5to12(12, 24),
];
function expected(row: Row, mode: Mode, mod: (typeof MODS)[number]): string {
  const t = row.modes[mode];
  if (mod.m === 1) return t.none;
  return t.except?.[mod.name] ?? t.mod.replace('{m}', String(mod.m));
}
// A few rows spelled out, so the table above reads as the bytes it means.
const SPOT: [string, Mode, string, string][] = [
  ['Enter', 'normal', 'Shift', `${ESC}[27;2;13~`],
  ['Enter', 'keyboard flags 1', 'Shift', `${ESC}[13;2u`],
  ['Enter', 'keyboard flags 1', 'none', '\r'],
  ['Enter', 'keyboard flags 31', 'none', `${ESC}[13u`],
  ['Tab', 'normal', 'Shift', `${ESC}[Z`],
  ['Tab', 'keyboard flags 1', 'Shift', `${ESC}[9;2u`],
  ['Backspace', 'normal', 'Option', `${ESC}\x7f`],
  ['Up', 'application-cursor', 'none', `${ESC}OA`],
  ['Up', 'application-cursor', 'Control', `${ESC}[1;5A`],
  ['F1', 'normal', 'none', `${ESC}OP`],
  ['F1', 'keyboard flags 31', 'none', `${ESC}[P`],
  ['F3', 'keyboard flags 1', 'Shift', `${ESC}[13;2~`],
  ['F12', 'normal', 'Option+Control', `${ESC}[24;7~`],
];

// ---------------------------------------------------------------------------------------------------

interface Miss { key: string; mods: string; mode: Mode; want: string; got: string }
/** Every key of the table with every modifier set, in one mode, through the seam into a real program; the misses. */
async function playMode(bin: string, mode: Mode, planted?: string): Promise<{ misses: Miss[]; pressed: number }> {
  const dir = tmp(`keys-${mode.replace(/\W+/g, '')}`);
  const log = `${dir}/in.log`;
  const marker = `READY-${mode.replace(/\W+/g, '-')}`;
  const misses: Miss[] = [];
  let pressed = 0;
  await withServe(bin, setup(dir, planted), async (s) => {
    await openFocused(s, script(dir, 'recorder', log, { out: `${MODE_ON[mode]}${marker}` }));
    // The mode escape is applied once the grid shows the marker written after it.
    await waitScreen(s, (rows) => rows.some((r) => r.includes(marker)), `the program in ${mode} mode is up`);
    for (const row of TABLE) {
      for (const mod of MODS) {
        const from = readBytes(log).length;
        await s.ok(keyEvent(row.key, mod.mods, row.code), `${mod.name === 'none' ? '' : `${mod.name}+`}${row.label} in ${mode} mode`);
        const got = (await newBytes(log, from)).toString('latin1');
        pressed++;
        const want = expected(row, mode, mod);
        if (got !== want) misses.push({ key: row.label, mods: mod.name, mode, want, got });
      }
    }
  });
  return { misses, pressed };
}
const sayMiss = (m: Miss): string => `${m.mods === 'none' ? '' : `${m.mods}+`}${m.key} in ${m.mode} mode: the program read "${shown(m.got)}", the table names "${shown(m.want)}"`;

describe('AC1 the byte-level key matrix: keys from the program\'s modes, with Shift, Option and Control', () => {
  it('AC1 the table reads as the bytes it means (spot rows spelled out)', () => {
    for (const [key, mode, modName, want] of SPOT) {
      const row = TABLE.find((r) => r.label === key)!;
      expect(shown(expected(row, mode, MODS.find((m) => m.name === modName)!)), `${modName}+${key} in ${mode} mode`).toBe(shown(want));
    }
    expect(TABLE.length * MODS.length * MODES.length, '19 keys × 7 modifier sets × 4 modes').toBe(532);
  });

  it('AC1 Enter, Tab, Backspace, the four arrows and F1–F12, with no modifier, Shift, Option, Control and their pairs, in normal, application-cursor, keyboard-flags-1 and keyboard-flags-31 modes, each reach a real program as the table\'s bytes', async () => {
    const all: Miss[] = [];
    let pressed = 0;
    for (const mode of MODES) {
      const r = await playMode(show(), mode);
      all.push(...r.misses);
      pressed += r.pressed;
    }
    expect(pressed, 'every cell of the matrix was pressed').toBe(532);
    expect(all.map(sayMiss), `${all.length} of 532 key presses read other bytes than the table names (first: ${all[0] ? sayMiss(all[0]) : 'none'})`).toEqual([]);
  }, 1_800_000);

  it('AC1 a planted encoder that sends a bare carriage return for Shift+Enter fails, naming the key and the mode', async () => {
    const r = await playMode(show(), 'normal', 'shift_enter_bare_cr');
    const shiftEnter = r.misses.filter((m) => m.key === 'Enter' && m.mods === 'Shift');
    expect(shiftEnter.length, `the planted shift_enter_bare_cr fails at Shift+Enter: ${JSON.stringify(r.misses.slice(0, 4).map(sayMiss))}`).toBe(1);
    const said = sayMiss(shiftEnter[0]!);
    expect(said, 'the failure names the key').toContain('Shift+Enter');
    expect(said, 'the failure names the mode').toContain('normal mode');
    expect(shiftEnter[0]!.got, 'what the planted encoder sent: a bare carriage return').toBe('\r');
    expect(r.misses.filter((m) => !(m.key === 'Enter' && m.mods === 'Shift')).map(sayMiss), 'the planted encoder differs from the real one only at Shift+Enter').toEqual([]);
  }, 1_800_000);
});

describe('SCOPE shortcuts match by physical key under any input source', () => {
  it('SCOPE under a Russian layout, Control with the keys in the C and D positions (characters с and в) sends ^C and ^D to the program, as under a US layout', async () => {
    const dir = tmp('physical');
    const log = `${dir}/in.log`;
    const got: string[] = [];
    await withServe(show(), setup(dir), async (s) => {
      await openFocused(s, script(dir, 'recorder', log, { out: 'READY-physical' }));
      await waitScreen(s, (rows) => rows.some((r) => r.includes('READY-physical')), 'the program is up');
      for (const [key, code] of [['с', 'KeyC'], ['в', 'KeyD'], ['c', 'KeyC']] as const) {
        const from = readBytes(log).length;
        await s.ok(keyEvent(key, ['ctrl'], code), `Control+${key} (${code})`);
        got.push(shown(await newBytes(log, from)));
      }
    });
    expect(got, 'Control+с (KeyC) is ^C, Control+в (KeyD) is ^D, and the US Control+c is ^C').toEqual(['\\x03', '\\x04', '\\x03']);
  }, 600_000);
});
