// AC3 #535.341f5d9a: A pool of 64 actor rows whose alive array is true for rows 0 to 9 only draws those 10 rows, the
// set's bounds and spatial index hold only those 10, and a selection click at row 20's position selects nothing; a
// planted set that drops dead rows from drawing alone keeps rows 10 to 63 in its bounds and spatial index, so the same
// click selects row 20 and the criterion fails, naming it
//
// The pool (fixtures.ts `poolDoc`): 64 free rows at `actors.x`, `actors.y` (row i at (20 + 24 (i mod 8), 20 + 24 ⌊i ÷
// 8⌋) u, 16 u quads), alive from `actors.alive`. Drawn: `deep_show`'s snapshot. Bounds and index: the `spatial` call on
// the 2D document (README). The click: the interaction scope's `input`, a press and release 60 ms apart at the row's
// centre mapped to the panel through the scope's camera (#383's), read as `state.selection`; a click on alive row 3
// shows the click reaches rows at all.
import { describe, expect, it } from 'vitest';
import { POOL, poolProgram } from './programs.ts';
import { ALIVE, ALIVE_BOUNDS, POOL_EMPTY, POOL_SIZE, POOL_TILE, ROW_ALIVE, ROW_CLICKED, actorAt, poolAtlas, poolDoc } from './fixtures.ts';
import {
  AC, DOC, MS, PERIOD, arr, binOf, failsNaming, near, none, num, obj, pixel, pngOf, prebuild, presented, putEvidence, runShow, scenario,
  show, showCall, shownSnapshot, str, useTemp, type JsonObject, type JsonValue, type Planted, type Rect,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = DOC(1);
/** The panel: 624 × 624 px, 3 px a u for the 208 u page. */
const PANEL: Rect = [0, 0, 624, 624];
const rowId = (i: number): string => `pool#${i}`;

/** `spatial` (#421) on the 2D document at t 0: one box query over the whole page. */
const spatialCall = (): JsonObject => ({ call: 'spatial', doc: D, t: 0, queries: [{ box: { min: [0, 0, -1], max: [POOL_SIZE[0], POOL_SIZE[1], 1] } }] });
const v3 = (v: JsonValue | undefined, what: string): number[] => arr(v, what).map((x, i) => num(x, `${what}[${i}]`));

/** The camera the panel's scope shows (#383's `state.camera` and `state.rect`), and a page point in panel px. */
function toPanel(state: JsonObject, [x, y]: [number, number]): [number, number] {
  const cam = obj(state['camera'], 'scope state: camera');
  const target = v3(cam['target'], 'camera.target');
  const width = num(cam['view_width'], 'camera.view_width');
  const rect = v3(state['rect'], 'scope state: rect');
  const k = width / rect[2]!;
  return [rect[0]! + rect[2]! / 2 + (x - target[0]!) / k, rect[1]! + rect[3]! / 2 + (y - target[1]!) / k];
}
const input = (at: number, event: JsonObject): JsonObject => ({ call: 'input', at, panel: 'p1', event });
const click = (at: number, p: [number, number]): JsonObject[] => [input(at, { type: 'down', pos: p }), input(at + 60 * MS, { type: 'up', pos: p })];
const selectionOf = (reply: JsonObject, what: string): string[] =>
  arr(obj(reply['state'], `${what}: state (${show(reply, 600)})`)['selection'], `${what}: state.selection`).map((s, i) => str(s, `${what}: selection[${i}]`));

interface Pool { failures: string[]; afterRow20: string[] }
/** The criterion's check of the pool: what draws, the bounds, the index and the click at row 20; each failure names a row. */
function judgePool(planted?: Planted): Pool {
  const ev = temp();
  const program = poolProgram();
  putEvidence(ev, program.bytes);
  const atlas = putEvidence(ev, poolAtlas());
  const doc = poolDoc(program, atlas);
  const o = planted ? { planted } : {};
  const failures: string[] = [];

  const [shown, spatial] = runShow(binOf(), scenario(ev, [D], [showCall(D, doc, { pixels: true }), spatialCall()], o), 'AC3 the pool, drawn and indexed') as [JsonObject, JsonObject];
  presented(shown, 'the pool');
  const im = pngOf(ev, shownSnapshot(shown, 'the pool'), 'the pool\'s snapshot');
  const ground = pixel(im, ...POOL_EMPTY);
  for (let i = 0; i < POOL; i++) {
    const p = pixel(im, ...actorAt(i));
    if (i < ALIVE && !near(p, POOL_TILE)) failures.push(`row ${i} is alive and doesn't draw: ${JSON.stringify(p)}`);
    if (i >= ALIVE && !near(p, ground)) failures.push(`row ${i} is dead and draws: ${JSON.stringify(p)}`);
  }

  expect(spatial['code'], `the spatial call answers the 2D document, not refused: ${show(spatial)}`).toBeUndefined();
  const item = obj(obj(spatial['items'], 'spatial: items')['pool'], 'spatial: items.pool (the set)');
  const b = obj(item['bounds'], 'spatial: items.pool.bounds');
  const [min, max] = [v3(b['min'], 'bounds.min'), v3(b['max'], 'bounds.max')];
  const off = Math.max(...[0, 1].map((k) => Math.max(Math.abs(min[k]! - ALIVE_BOUNDS.min[k]!), Math.abs(max[k]! - ALIVE_BOUNDS.max[k]!))));
  if (off > 1e-6) {
    // The dead rows whose quads the reported bounds hold.
    const held = Array.from({ length: POOL }, (_, i) => i).filter((i) => i >= ALIVE && [0, 1].every((k) => actorAt(i)[k]! - 8 >= min[k]! - 1e-6 && actorAt(i)[k]! + 8 <= max[k]! + 1e-6));
    failures.push(`the set's bounds are [${min.slice(0, 2).join(', ')}] to [${max.slice(0, 2).join(', ')}], not the alive rows' [12, 12] to [196, 52]; they hold dead rows ${held.slice(0, 12).join(', ') || 'none'}${held.length > 12 ? ` and ${held.length - 12} more` : ''}${held.includes(ROW_CLICKED) ? ' (row 20 among them)' : ''}`);
  }
  const results = arr(spatial['results'], 'spatial: results');
  const hits = arr(results[0], 'spatial: results[0], the box over the page').map((x, i) => str(x, `results[0][${i}]`)).filter((id) => id.startsWith('pool#'));
  const want = Array.from({ length: ALIVE }, (_, i) => rowId(i));
  const extra = hits.filter((id) => !want.includes(id));
  if (extra.length) failures.push(`the spatial index holds dead rows: ${extra.slice(0, 12).join(', ')}${extra.includes(rowId(ROW_CLICKED)) ? ' (row 20 among them)' : ''}${extra.length > 12 ? ` and ${extra.length - 12} more` : ''}`);
  const missing = want.filter((id) => !hits.includes(id));
  if (missing.length) failures.push(`the spatial index lacks alive rows: ${missing.join(', ')}`);

  // The clicks, on the scope's clock: the document presented, its scope read, then the clicks where its camera puts the rows.
  const present = { ...showCall(D, doc, { at: 1 }) };
  const first = runShow(binOf(), scenario(ev, [D], [present, { call: 'scope', at: 20 * PERIOD, panel: 'p1' }], { ...o, clock: true, rect: PANEL }), 'AC3 the pool\'s scope');
  presented(first[0]!, 'the pool on its panel');
  const state = obj(first[1]!['state'], `the pool's scope state (${show(first[1], 600)})`);
  const replies = runShow(binOf(), scenario(ev, [D], [
    present, { call: 'scope', at: 20 * PERIOD, panel: 'p1' },
    ...click(30 * PERIOD, toPanel(state, actorAt(ROW_CLICKED))),
    ...click(40 * PERIOD, toPanel(state, actorAt(ROW_ALIVE))),
  ], { ...o, clock: true, rect: PANEL }), 'AC3 the clicks on the pool');
  const afterRow20 = selectionOf(replies[3]!, 'the click at row 20');
  const afterRow3 = selectionOf(replies[5]!, 'the click at row 3');
  if (afterRow20.length) failures.push(`the click at row 20's position (dead) selects ${afterRow20.join(', ')}${afterRow20.includes(rowId(ROW_CLICKED)) ? ': it selects row 20' : ''}`);
  if (JSON.stringify(afterRow3) !== JSON.stringify([rowId(ROW_ALIVE)])) failures.push(`the click at row 3's position (alive) selects ${JSON.stringify(afterRow3)}, not [${rowId(ROW_ALIVE)}]`);
  return { failures, afterRow20 };
}

describe(`${AC[3]} a pool of 64 rows whose alive array holds rows 0 to 9: drawn, bounded, indexed and selected as those 10 alone`, () => {
  it(`${AC[3]} the pool draws rows 0 to 9 only, its bounds and spatial index hold only them, and a click at row 20's position selects nothing (one at alive row 3 selects it)`, () => {
    none(judgePool().failures, 'the pool');
  }, 1_800_000);

  it(`${AC[3]} planted dead_rows_hidden_from_drawing_only keeps rows 10 to 63 in the bounds and the index, so the click selects row 20 and the check fails naming it`, () => {
    const twin = judgePool('dead_rows_hidden_from_drawing_only');
    expect(twin.afterRow20, 'under the planted set the click at row 20\'s position selects row 20').toEqual([rowId(ROW_CLICKED)]);
    failsNaming(twin.failures, [/selects row 20/], 'the pool under dead_rows_hidden_from_drawing_only');
  }, 1_800_000);
});
