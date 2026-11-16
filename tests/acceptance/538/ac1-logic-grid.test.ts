// AC1 #538.798488ed: A 40 × 12 cell grid fed by a logic array of 480 values, with glyphs ['.', '#', '@', 'é'] and roles
// [ink, accent], draws '@' in the accent role on the ink role for the value 0x1002 (glyph 2, foreground 1, background
// 0); the value 7 draws a blank cell in the grid's background and raises grid.out_of_range naming the array, the cell, 7
// and the step; a planted unpacking that wraps the index draws 'é' (7 mod 4 = 3) and fails, naming the cell; a glyph
// list holding U+E000, which no bundled font draws, is refused at check, naming it; and an array of 479 values is refused
// at check, naming both counts
//
// The grid (fixtures.ts `gridDoc`): `board`, 40 × 12 cells from `rules.cells` (programs.ts `gridProgram`: walls round
// the edge, floor inside, 0x1002 at (5, 3), 'é' at (20, 6), and 7 at (12, 7) from step 30), beside `key`, three literal
// cells whose colors are the palette's ink and accent by index, so each role's color is the one the cells module draws
// for it. What a cell draws is `determinism`'s `cells` block (#1967), on both sides at step 30: every one of the 480
// cells is the glyph and the two roles its value unpacks to, and a value past a list a blank cell in the grid's own
// background (its palette's `bg`, the ground). The issue is `eval`'s at steps 29 and 30. The refusals are `deep_show`'s
// check, named in an error issue's own fields.
import { describe, expect, it } from 'vitest';
import { BAD, COLS, GLYPHS, ROWS, gridProgram, gridValue } from './programs.ts';
import { gridDoc } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, at, binOf, blocked, determinismCall, errorsOf, evalCall, failsNaming, field, issuesOf, names, namedIn,
  none, obj, prebuild, presented, putEvidence, runShow, scenario, show, showCall, str, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { grid: DOC(1), glyph: DOC(2), short: DOC(3) };
const PRIVATE_USE = '';

interface Cell { g: string; fg: string; bg: string }
/** One grid of a `determinism` side's `cells` block: its cells in row-major order. */
function cellsOf(side: JsonObject, id: string, count: number, what: string): Cell[] {
  const grid = obj(obj(side['cells'], `${what}: the side's cells block (#1967)`)[id], `${what}: the cells block's ${id}`);
  const list = arr(grid['cells'], `${what}: ${id}.cells`).map((c, i) => {
    const o = obj(c, `${what}: ${id}.cells[${i}]`);
    return { g: str(o['g'], `${what}: ${id}.cells[${i}].g`), fg: str(o['fg'], `${what}: ${id}.cells[${i}].fg`).toLowerCase(), bg: str(o['bg'], `${what}: ${id}.cells[${i}].bg`).toLowerCase() };
  });
  expect(list.length, `${what}: ${id} shows ${count} cells`).toBe(count);
  return list;
}
const hex = (v: number): string => `0x${v.toString(16)}`;
/**
 * The judge: every cell of `board` against its value at step 30, unpacked as the issue's Fields pack it (bits 0 to 11 a
 * glyph, 12 to 15 the foreground role, 16 to 19 the background role, 28 to 31 zero), with the roles' colors read from
 * `key` (cell 0: accent on ink; cell 2: the default colors, whose background is the grid's own). A value past a list is a
 * blank cell (no grapheme, or a space) in that background.
 */
function gridFailures(board: Cell[], key: Cell[], side: string): string[] {
  const out: string[] = [];
  const role = { accent: key[0]!.fg, ink: key[0]!.bg };
  const ground = key[2]!.bg;
  if (new Set([role.accent, role.ink, ground]).size !== 3) out.push(`${side}: the key's ink ${role.ink}, accent ${role.accent} and ground ${ground} aren't three colors`);
  const roles = [role.ink, role.accent];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = gridValue(x, y, BAD.from);
      const c = board[COLS * y + x]!;
      const [glyph, fg, bg] = [v & 0xfff, (v >>> 12) & 0xf, (v >>> 16) & 0xf];
      const fits = glyph < GLYPHS.length && fg < roles.length && bg < roles.length && v >>> 28 === 0;
      const at = `${side}: cell (${x}, ${y}), value ${hex(v)}`;
      if (!fits) {
        if ((c.g !== '' && c.g !== ' ') || c.bg !== ground) out.push(`${at}, draws ${JSON.stringify(c.g)} on ${c.bg}, not a blank cell in the grid's background ${ground}`);
      } else if (c.g !== GLYPHS[glyph] || c.fg !== roles[fg] || c.bg !== roles[bg]) {
        out.push(`${at}, draws ${JSON.stringify(c.g)} in ${c.fg} on ${c.bg}, not ${JSON.stringify(GLYPHS[glyph])} in ${roles[fg]} on ${roles[bg]}`);
      }
    }
  }
  return out;
}

interface GridRun { replies: JsonObject[]; failures: string[] }
function gridRun(planted?: Planted): GridRun {
  const ev = temp();
  const program = gridProgram();
  putEvidence(ev, program.bytes);
  const calls: JsonObject[] = [
    showCall(D.grid, gridDoc(program)), determinismCall(D.grid, [at(BAD.from)]),
    evalCall(D.grid, at(BAD.from - 1), { pixels: false }), evalCall(D.grid, at(BAD.from), { pixels: false }),
    ...(planted ? [] : [
      showCall(D.glyph, gridDoc(program, { glyphs: [...GLYPHS.slice(0, 3), PRIVATE_USE] })),
      showCall(D.short, gridDoc(program, { count: COLS * ROWS - 1 })),
    ]),
  ];
  const replies = runShow(binOf(), scenario(ev, Object.values(D), calls, planted), 'AC1 the logic grid');
  presented(replies[0]!, 'the 40 × 12 grid fed by rules.cells');
  const compared = replies[1]!;
  if (compared['outcome'] === 'refused' && /gpu|adapter/.test(String(compared['code']))) blocked(`no GPU for determinism's renders here: ${show(compared)}`);
  expect(compared['outcome'], `determinism compares the grid at step 30: ${show(compared, 2000)}`).toBe('compared');
  const frame = obj(arr(compared['frames'], 'determinism: frames')[0], 'determinism: frames[0]');
  const failures: string[] = [];
  for (const side of ['play', 'seek'] as const) {
    const s = obj(frame[side], `determinism at step 30: ${side}`);
    failures.push(...gridFailures(cellsOf(s, 'board', COLS * ROWS, `the ${side} side`), cellsOf(s, 'key', 3, `the ${side} side`), `step 30, ${side === 'play' ? 'played' : 'seeked'}`));
  }
  return { replies, failures };
}

describe(`${AC[1]} the 40 × 12 logic grid: unpacked cells, a value past its list, and the refusals at check`, () => {
  it(`${AC[1]} draws each value's glyph and roles ('@' in accent on ink for 0x1002), a blank cell in the grid's background for 7 with grid.out_of_range naming the array, the cell, 7 and the step; refuses U+E000 and 479 values at check`, () => {
    const { replies, failures } = gridRun();
    none(failures, 'every cell of the grid at step 30, played and seeked');
    const ranged = (reply: JsonObject): JsonObject[] => issuesOf(reply).filter((i) => i['code'] === 'grid.out_of_range');
    expect(ranged(replies[2]!), `at step 29, when every value fits its lists, no grid.out_of_range: ${show(issuesOf(replies[2]!))}`).toEqual([]);
    const raised = ranged(replies[3]!);
    const naming = raised.filter((i) => names(String(field(i, 'array')), 'rules.cells') && JSON.stringify(field(i, 'cell')) === JSON.stringify([BAD.x, BAD.y])
      && field(i, 'value') === BAD.value && field(i, 'step') === BAD.from);
    expect(naming.length, `at step 30 eval raises grid.out_of_range {array: rules.cells, cell: [${BAD.x}, ${BAD.y}], value: 7, step: 30}; its issues: ${show(issuesOf(replies[3]!), 2500)}`).toBeGreaterThan(0);

    const glyph = replies[4]!;
    expect(glyph['outcome'], `the glyph list holding U+E000 is refused at check: ${show(glyph, 2000)}`).toBe('refused');
    expect(errorsOf(glyph).some((i) => namedIn(i).includes(PRIVATE_USE) || /U\+E000/i.test(namedIn(i))), `an error issue names U+E000 in its own fields: ${show(errorsOf(glyph), 2500)}`).toBe(true);
    const short = replies[5]!;
    expect(short['outcome'], `the grid over 479 values is refused at check: ${show(short, 2000)}`).toBe('refused');
    expect(errorsOf(short).some((i) => names(namedIn(i), '479') && names(namedIn(i), '480')), `an error issue names both counts, 479 and 480 (40 × 12), in its own fields: ${show(errorsOf(short), 2500)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[1]} planted grid_wraps_index draws 'é' (7 mod 4 = 3) at cell (12, 7) and fails, naming the cell`, () => {
    const { failures } = gridRun('grid_wraps_index');
    expect(failures.some((f) => f.includes(`cell (${BAD.x}, ${BAD.y})`) && f.includes(JSON.stringify(GLYPHS[BAD.value % GLYPHS.length]))), `under the planted unpacking, cell (12, 7) draws 'é': ${failures.slice(0, 6).join('; ')}`).toBe(true);
    failsNaming(failures, [new RegExp(`cell \\(${BAD.x}, ${BAD.y}\\)`)], 'the grid under grid_wraps_index');
  }, TIMEOUT);
});
