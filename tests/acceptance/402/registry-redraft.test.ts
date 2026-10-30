// SCOPE (the issue's scope line, not a criterion): "The cell grid as the cells canvas module, registered through the
// registry and seal (#305) and depending on the text module the canvas modules task (#137) lays out". The r2 and full
// build sets hold `cells` beside `text`; core and r1 hold no `cells` and refuse a document that needs it with
// `module_missing`, naming it. Blind redraft of the first draft's test of the same name: the first draft sent a
// whole revision of an empty board to the document a grid board was current on, which `deep_show` refuses with
// `unintended_removal` (it leaves out `term` without `removes`), so its third picture could never be taken. Here every
// revision is the first of its document, or keeps every item of the current one.
import { describe, expect, it } from 'vitest';
import { DOC, REGISTRY, board, issues, moduleMissing, registry, requires, run, scenario, show, theSnapshot } from '../305/helpers.ts';
import type { JsonObject, JsonValue } from './helpers.ts';
import { obj, strs, useOut, useShow } from './helpers.ts';

const full = useShow();
const r2 = useShow(['r2']);
const r1 = useShow(['r1']);
const core = useShow(['core']);
const out = useOut();

const ANSI: string[] = Array.from({ length: 16 }, (_, i) => ['ink', 'muted', 'accent', 'ground'][i % 4]!);
const MODES = { alt_screen: false, bracketed_paste: false, app_cursor: false, focus_events: false, mouse: 'none' };
/** A frame of cols × rows cells, row-major, from lines of text; colors are `#rrggbb`, attrs a u16, link 0 for none. */
function frame(cols: number, rows: number, text: string[]): JsonObject {
  const cells: JsonValue[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const g = text[Math.floor(i / cols)]?.[i % cols] ?? ' ';
    cells.push({ g, fg: '#e8e8e8', bg: '#101010', attrs: 0, link: 0 });
  }
  return { revision: 1, base: null, cells, attrs: ['bold', 'italic', 'underline', 'inverse', 'dim', 'strike'], cursor: { x: 0, y: 0, shape: 'block', visible: true, blink: false }, scroll: { history: 0, offset: 0 }, links: {}, images: [], modes: MODES };
}
function grid(text: string[]): JsonObject {
  const cols = 20, rows = 6;
  return {
    id: 'term', kind: 'cells@1', name: 'Terminal', order: 'a1', at: { pos: [16, 16, 0] },
    params: {
      size: { cols, rows, cell: [8, 16] }, font: { family: 'mono', size: 13, fallback: [], ligatures: false },
      palette: { fg: 'ink', bg: 'ground', ansi: ANSI, truecolor: true },
      frame: frame(cols, rows, text),
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
      const owned = Object.entries(sealed.arrays).filter(([, a]) => a['owner'] === 'cells');
      for (const [name] of owned) expect(name.startsWith('cells.'), `the array ${name} that cells owns is named for it`).toBe(true);
      for (const [name, a] of Object.entries(sealed.arrays)) if (name.startsWith('cells.')) expect(a['owner'], `the array ${name} is owned by cells`).toBe('cells');
      const m = obj(obj(mod, 'the module call')['module'], 'the cells module');
      expect(m['name']).toBe('cells');
      expect(obj(obj(m['depends_on'], 'depends_on')['text'], 'depends_on.text')['optional'], 'cells requires text').toBe(false);
      expect(strs(obj(m['registers'], 'registers')['kinds'], 'registers.kinds'), 'it registers the cell grid\'s kind').toContain('cells@1');
    }

    // The frame is drawn. Three pictures in one process: "hello" and then "world" on DOC.a (the same item `term`, so
    // the second whole revision leaves nothing out), and an empty board on DOC.b (the first revision of its document).
    const [hello, world, none] = run(r2(), scenario(e, [
      show(withCells('Cells', grid(['hello'])), { pixels: true }),
      show(withCells('Cells', grid(['world'])), { pixels: true }),
      show(board('Empty', [], requires({ cells: '^1' })), { doc: DOC.b, pixels: true }),
    ])).replies.map((reply, i) => {
      expect(issues(reply, `picture ${i + 1}`).filter((x) => x.code === 'unintended_removal' || x.code === 'module_missing'), `picture ${i + 1} is refused for neither a removal nor a missing module`).toEqual([]);
      return theSnapshot(reply, `picture ${i + 1}`).sha256;
    });
    expect(new Set([hello, world, none]).size, 'hello, world and an empty board draw three different pictures').toBe(3);

    // Builds that leave cells out refuse a document that needs it, naming it; the grid's document is the only thing sent.
    for (const bin of [core(), r1()]) {
      const reg = registry(run(bin, scenario(e, [REGISTRY])).replies[0]!);
      expect(reg.modules, `${reg.build_set} holds no cells module`).not.toContain('cells');
      const reply = run(bin, scenario(e, [show(withCells('Cells', grid(['hello'])))])).replies[0]!;
      expect(String(reply['outcome']), `${reg.build_set} refuses the grid's document`).toBe('refused');
      expect(moduleMissing(reply, 'cells').length, `${reg.build_set} names cells in module_missing`).toBeGreaterThan(0);
    }
  }, 3_600_000);
});
