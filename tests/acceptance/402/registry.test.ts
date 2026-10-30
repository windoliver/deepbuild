// SCOPE (the issue's scope, not its criteria): the cell grid is the `cells` canvas module, registered through the registry
// and seal (#305) on the text module (#388), in the r2 and full build sets (the design's module table: "cells … Depends on
// text … R2"; Registry and seal: `build_set`: "r2 adds vector, cells, scene3d and effects"). A build without it (core, r1)
// refuses a document that needs it with `module_missing`, naming `cells`. Its kind `cells@1` draws a frame through the one
// shaper, and its fields (README: The cell grid's document form) are checked: a size past u16, a palette of fewer than 16
// ANSI roles, a frame whose cells aren't cols × rows, and a status role in the palette are each refused, naming the
// field. At the base no build holds a `cells` module (the seal knows the name and refuses its kind).
import { describe, expect, it } from 'vitest';
import { REGISTRY, board, moduleMissing, registry, requires, run, scenario, show, theSnapshot } from '../305/helpers.ts';
import type { JsonObject, JsonValue } from './helpers.ts';
import { arr, obj, strs, useOut, useShow } from './helpers.ts';

const full = useShow();
const r2 = useShow(['r2']);
const r1 = useShow(['r1']);
const core = useShow(['core']);
const out = useOut();

const ANSI: string[] = Array.from({ length: 16 }, (_, i) => ['ink', 'muted', 'accent', 'ground'][i % 4]!);
const MODES = { alt_screen: false, bracketed_paste: false, app_cursor: false, focus_events: false, mouse: 'none' };
/** A frame of cols × rows cells, row-major, from lines of text; colors are `#rrggbb`, attrs a u16, link 0 for none. */
function frame(cols: number, rows: number, text: string[], count = cols * rows): JsonObject {
  const cells: JsonValue[] = [];
  for (let i = 0; i < count; i++) {
    const g = text[Math.floor(i / cols)]?.[i % cols] ?? ' ';
    cells.push({ g, fg: '#e8e8e8', bg: '#101010', attrs: 0, link: 0 });
  }
  return { revision: 1, base: null, cells, attrs: ['bold', 'italic', 'underline', 'inverse', 'dim', 'strike'], cursor: { x: 0, y: 0, shape: 'block', visible: true, blink: false }, scroll: { history: 0, offset: 0 }, links: {}, images: [], modes: MODES };
}
interface Make { cols?: number; rows?: number; ansi?: string[]; fg?: string; text?: string[]; count?: number }
function grid(o: Make = {}): JsonObject {
  const cols = o.cols ?? 20, rows = o.rows ?? 6;
  return {
    id: 'term', kind: 'cells@1', name: 'Terminal', order: 'a1', at: { pos: [16, 16, 0] },
    params: {
      size: { cols, rows, cell: [8, 16] }, font: { family: 'mono', size: 13, fallback: [], ligatures: false },
      palette: { fg: o.fg ?? 'ink', bg: 'ground', ansi: o.ansi ?? ANSI, truecolor: true },
      frame: frame(cols, rows, o.text ?? ['hello'], o.count),
    },
  };
}
const withCells = (title: string, ...items: JsonObject[]): JsonObject => board(title, items, requires({ cells: '^1' }));

describe('SCOPE the cells module is in the r2 and full build sets, on the text module', () => {
  it('SCOPE the r2 build seals with cells beside text, owning only arrays of its own, and draws a frame; core and r1 hold no cells and refuse its kind with module_missing, naming it', () => {
    const e = out();
    for (const bin of [r2(), full()]) {
      const [reg, mod] = run(bin, scenario(e, [REGISTRY, { call: 'module', name: 'cells' }])).replies;
      const sealed = registry(reg!);
      expect(sealed.modules, `${sealed.build_set} holds the cells module and the text module it depends on`).toEqual(expect.arrayContaining(['cells', 'text']));
      for (const [name, a] of Object.entries(sealed.arrays)) if (a['owner'] === 'cells') expect(name.startsWith('cells.'), `the array ${name} that cells owns is named for it`).toBe(true);
      const m = obj(obj(mod, 'the module call')['module'], 'the cells module');
      expect(m['name']).toBe('cells');
      expect(obj(obj(m['depends_on'], 'depends_on')['text'], 'depends_on.text')['optional'], 'cells requires text').toBe(false);
      expect(strs(obj(m['registers'], 'registers')['kinds'], 'registers.kinds'), 'it registers the cell grid\'s kind').toContain('cells@1');
    }
    // The frame is drawn: two frames that differ differ in pixels, and each differs from a board with no grid.
    const doc = (text: string[]): JsonObject => withCells('Cells', grid({ text }));
    const pix = (bin: string): string[] => {
      const r = run(bin, scenario(e, [show(doc(['hello']), { pixels: true }), show(doc(['world']), { pixels: true }), show(board('Empty', [], requires({ cells: '^1' })), { pixels: true })])).replies;
      return r.map((x, i) => theSnapshot(x, `frame ${i + 1}`).sha256);
    };
    const [hello, world, none] = pix(r2());
    expect(new Set([hello, world, none]).size, 'hello, world and an empty board draw three different pictures').toBe(3);
    // Builds that leave cells out refuse a document that needs it.
    for (const bin of [core(), r1()]) {
      const reg = registry(run(bin, scenario(e, [REGISTRY])).replies[0]!);
      expect(reg.modules, `${reg.build_set} holds no cells module`).not.toContain('cells');
      const reply = run(bin, scenario(e, [show(doc(['hello']))])).replies[0]!;
      expect(String(reply['outcome']), `${reg.build_set} refuses the grid's document`).toBe('refused');
      expect(moduleMissing(reply, 'cells').length, `${reg.build_set} names cells in module_missing`).toBeGreaterThan(0);
    }
  }, 3_600_000);

  it('SCOPE the grid\'s fields are checked: a size past u16, fewer than 16 ANSI roles, a frame that isn\'t cols × rows cells, and a status role in the palette are each refused, naming the field', () => {
    const cases: { what: string; item: JsonObject; names: string[] }[] = [
      { what: 'cols 70,000 (past u16)', item: grid({ cols: 70_000, rows: 1, count: 1 }), names: ['cols'] },
      { what: '15 ANSI roles', item: grid({ ansi: ANSI.slice(0, 15) }), names: ['ansi'] },
      { what: 'a frame of 119 cells for 20 × 6', item: grid({ count: 119 }), names: ['cells'] },
      { what: 'the status role fail as the foreground', item: grid({ fg: 'fail' }), names: ['fail'] },
    ];
    const replies = run(full(), scenario(out(), cases.map((c) => show(withCells('Fields', c.item))))).replies;
    cases.forEach((c, i) => {
      expect(String(replies[i]!['outcome']), `${c.what} is refused`).toBe('refused');
      const text = JSON.stringify(arr(replies[i]!['issues'], 'issues'));
      for (const n of c.names) expect(text.includes(n), `${c.what}: an issue names ${n}: ${text.slice(0, 300)}`).toBe(true);
    });
    expect(String(run(full(), scenario(out(), [show(withCells('Fine', grid()))])).replies[0]!['outcome']), 'the same grid with sound fields is presented').toBe('presented');
  }, 600_000);
});
