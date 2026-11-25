// #3379: a logic item's control reads are declared references. refs_to a control lists the rows that read it, with
// kind `control`; a whole revision that removes a control a logic item still reads is refused with `ref_unresolved`
// at the read, its `actual` the rows refs_to gave on the revision before, in the same order.
//
// The board (README: Fixtures): the controls `press` and `aim`, the logic item `counter` whose reads are
// `["press", "reading:pad", "other.score"]` and whose preview reads are `["aim"]`, and the logic item `other` that
// writes `score`. Every call goes through `deep-show run` (#1801's helpers): deep_show of whole revisions, with
// `removes`, and deep_query `what: "refs_to"`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA_WRITER, DOC, FULL, brief, isObject, none, presented, refsFailures, refsTo, rows, run, scenario, show, stored, useBuilds, useEvidence,
  type JsonObject, type JsonValue, type Ref,
} from '../1801/helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const BOARD = DOC.door;

// ---------------------------------------------------------------------------------------------------
// The program both logic items run (Logic `logic@1`): one 64 KiB page whose maximum is its minimum, immutable i32
// globals `reads_at` = 0 and `writes_at` = 4096, and `init(i64)` and `step(i64)` with empty bodies.

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const PROGRAM = (): Buffer => Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
  ...section(3, vec([[0x00], [0x00]])),
  ...section(5, vec([[0x01, 0x01, 0x01]])),
  ...section(6, vec([[0x7f, 0x00, 0x41, 0x00, 0x0b], [0x7f, 0x00, 0x41, 0x80, 0x20, 0x0b]])),
  ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
  ...section(10, vec([[0x02, 0x00, 0x0b], [0x02, 0x00, 0x0b]])),
]);

// ---------------------------------------------------------------------------------------------------
// The board

const ENVELOPE: JsonObject = {
  format: 1, profile: 'board', title: 'Counter', description: 'A counter that reads a press, a reading and another item\'s score, and previews an aim.',
  size: [320, 200], requires: { modules: { logic: '^1' } },
};
const seed = (): JsonObject => ({ ...ENVELOPE, layers: { 'alpha-main': { writer: ALPHA_WRITER, title: 'Claude Code: counter', order: 'a0' } }, items: {} });
const slider = (label: string): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range: [0, 1], default: 0, increment: 1 });
const READS = ['press', 'reading:pad', 'other.score'];

/** The board with the controls `controls` and `counter` reading `reads` (README: Fixtures). */
function board(program: string, controls: readonly string[], reads: readonly string[] = READS): JsonObject {
  const label: Record<string, string> = { press: 'Press', aim: 'Aim', tap: 'Tap' };
  return {
    ...ENVELOPE,
    controls: Object.fromEntries(controls.map((c) => [c, slider(label[c]!)])),
    items: {
      counter: {
        id: 'counter', kind: 'logic@1', name: 'Counter', order: 'a0',
        params: { program, step_rate: 60, reads: [...reads], preview: { reads: ['aim'], writes: {} }, writes: { presses: { type: 'i32' } } },
      },
      other: { id: 'other', kind: 'logic@1', name: 'Other', order: 'a1', params: { program, step_rate: 60, reads: [], writes: { score: { type: 'i32' } } } },
    },
  };
}
/** Alpha's whole revision of the board that also names `removes` as removed. */
const showRemoving = (document: JsonObject, removes: string[]): JsonObject => ({ ...show(BOARD, document), removes });

/** One `deep-show run` on the board, shared at revision 0, with `calls`. */
function play(calls: (program: string) => JsonObject[]): JsonObject[] {
  const program = stored(evidence(), PROGRAM());
  return run(builds.bin(FULL), scenario(evidence(), { [BOARD]: { document: seed() } }, calls(program)));
}

const FIRST_READ: Ref = { path: 'items/counter/params/reads/0', kind: 'control' };
const AIM_READ: Ref = { path: 'items/counter/params/preview/reads/0', kind: 'control' };

/**
 * The reply refuses the revision with a `ref_unresolved` issue at `items/counter/params/reads/0` whose `actual` is
 * `before`, the rows refs_to press gave on the revision before, in the same order; the board stays at revision 1.
 */
function refusedAtTheRead(reply: JsonObject, before: readonly JsonObject[], what: string): void {
  expect(reply['outcome'], `${what} is refused: ${brief(reply, 2000)}`).toBe('refused');
  const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject);
  const at = issues.find((i) => i['code'] === 'ref_unresolved' && i['path'] === FIRST_READ.path);
  expect(at, `${what}: a ref_unresolved issue at ${FIRST_READ.path} (issues ${brief(issues as JsonValue[], 1500)})`).toBeDefined();
  expect(at!['actual'], `${what}: the issue's actual is the rows refs_to press gave on revision 1, in the same order`).toEqual(before);
  expect(reply['rev'], `${what}: the board stays at revision 1`).toBe(1);
}

describe('#3379 a logic item\'s control reads are references: refs_to lists them and a whole revision that drops a read control is refused', () => {
  it('#3379.d3f05542 refs_to press returns exactly items/counter/params/reads/0 of kind control, and refs_to aim exactly items/counter/params/preview/reads/0; neither returns the reading or the array read', () => {
    const [shown, press, aim] = play((program) => [show(BOARD, board(program, ['press', 'aim'])), refsTo(BOARD, 'press'), refsTo(BOARD, 'aim')]);
    expect(presented(shown, 'the board'), 'the board is revision 1').toBe(1);
    const pressRows = rows(press, 'refs_to press');
    const aimRows = rows(aim, 'refs_to aim');
    console.log(`AC1 refs_to press: ${brief(pressRows as JsonValue[])}\nAC1 refs_to aim: ${brief(aimRows as JsonValue[])}`);
    none(refsFailures('press', pressRows, [FIRST_READ]), 'refs_to press gives the one row that reads press');
    none(refsFailures('aim', aimRows, [AIM_READ]), 'refs_to aim gives the one row that reads aim');
  });

  it('#3379.1fe9c8e9 a whole revision removing press while counter still reads it is refused with ref_unresolved at items/counter/params/reads/0, its actual the rows refs_to press gave before, and the board stays at its revision', () => {
    const [shown, before, refused, after] = play((program) => [
      show(BOARD, board(program, ['press', 'aim'])),
      refsTo(BOARD, 'press'),
      showRemoving(board(program, ['aim']), ['press']),
      refsTo(BOARD, 'aim'),
    ]);
    expect(presented(shown, 'the board'), 'the board is revision 1').toBe(1);
    refusedAtTheRead(refused!, rows(before, 'refs_to press on revision 1'), 'the revision removing press');
    expect(after?.['rev'], `after the refusal refs_to reads revision 1: ${brief(after, 600)}`).toBe(1);
  });

  it('#3379.dce5a74c a rename that adds tap and removes press while counter still reads press is refused the same way', () => {
    const [shown, before, refused, after] = play((program) => [
      show(BOARD, board(program, ['press', 'aim'])),
      refsTo(BOARD, 'press'),
      showRemoving(board(program, ['aim', 'tap']), ['press']),
      refsTo(BOARD, 'aim'),
    ]);
    expect(presented(shown, 'the board'), 'the board is revision 1').toBe(1);
    refusedAtTheRead(refused!, rows(before, 'refs_to press on revision 1'), 'the rename that leaves reads at press');
    expect(after?.['rev'], `after the refusal refs_to reads revision 1: ${brief(after, 600)}`).toBe(1);
  });

  it('#3379.dce5a74c the same rename with counter reading tap is presented with no ref_unresolved, and refs_to tap then returns items/counter/params/reads/0', () => {
    const [shown, renamed, tap] = play((program) => [
      show(BOARD, board(program, ['press', 'aim'])),
      showRemoving(board(program, ['aim', 'tap'], ['tap', 'reading:pad', 'other.score']), ['press']),
      refsTo(BOARD, 'tap'),
    ]);
    expect(presented(shown, 'the board'), 'the board is revision 1').toBe(1);
    expect(presented(renamed, 'the rename with counter reading tap'), 'the rename is revision 2').toBe(2);
    const unresolved = (Array.isArray(renamed!['issues']) ? renamed!['issues'] : []).filter((i) => isObject(i) && i['code'] === 'ref_unresolved');
    expect(unresolved, 'the rename with counter reading tap has no ref_unresolved issue').toEqual([]);
    const tapRows = rows(tap, 'refs_to tap');
    console.log(`AC3 refs_to tap: ${brief(tapRows as JsonValue[])}`);
    none(refsFailures('tap', tapRows, [FIRST_READ]), 'refs_to tap gives the one row that reads tap');
  });
});
