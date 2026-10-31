// #855.f682f4c0: the seal refuses a planted frame-phase operator that writes a JSON value, naming the
// operator; with every shipped operator typed, a 10,000-item board's frame with one item changed
// allocates no JSON value, counted by the allocator.
//
// The planted operator is `test.json.out` of the test canvas module `test.json` (feature `test-json`,
// README: The test builds), which writes a JSON value in phase items; its module's `test.json.audit`
// writes one in phase check, where JSON stays, so the refusal names the first and only the first. The
// count is `json_values` on each `frames` entry (README: `frames`). So that a count stuck at zero can't
// pass, the planted operator, let through by the startup argument `--planted admits_frame_json`, must be
// counted. The wrong programs: the base (no refusal, no `json_values`); a seal that lets the operator in;
// a seal that refuses every JSON writer, check phases too; a counter that never counts.
import { describe, expect, it } from 'vitest';
import {
  DOC, KINDS, board, edit, evalCall, evaluated, framesCall, framesOf, mixed, presented, rect, refusedStart, requires,
  run, scenario, show, slide, sorted, strs, useBuilds, useTemp, type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#855.f682f4c0';
const FULL: Build = { set: 'full' };
const JSON_WRITER: Build = { set: 'full', with: ['test-json'] };
const builds = useBuilds([FULL, JSON_WRITER]);
const temp = useTemp();

/** 10,000 items, 2,000 of each of the five kinds (rect, circle, path, text, frame). */
const BIG = mixed('Ten thousand', 10_000);
/** One item of each kind changed: its id and the edit. Each makes a revision of BIG with that one item changed. */
const CHANGES: { item: string; edits: Record<string, JsonValue> }[] = [
  { item: 'r0', edits: { 'items/r0/params/box/2': 3.6 } },
  { item: 'c1', edits: { 'items/c1/params/r': 4.5 } },
  { item: 'p2', edits: { 'items/p2/params/d': 'M0 0 L40 6 L80 0' } },
  { item: 't3', edits: { 'items/t3/params/text': 'Changed text' } },
  { item: 'f4', edits: { 'items/f4/params/box/2': 18 } },
];

describe(`${ID} the seal refuses a planted frame-phase operator that writes a JSON value, naming it; a 10,000-item board's frame with one item changed allocates no JSON value`, () => {
  it(`${ID} the build with test.json refuses to start: seal_refused, json_in_frame, naming the operator test.json.out and not the check-phase writer test.json.audit`, () => {
    const line = refusedStart(builds.bin(JSON_WRITER), []);
    expect(line['code'], `the refusal is the seal's: ${JSON.stringify(line)}`).toBe('seal_refused');
    expect(line['reason'], `the refusal's reason: ${JSON.stringify(line)}`).toBe('json_in_frame');
    expect(sorted(strs(line['operators'], 'the refusal\'s operators')), 'the refusal names the frame-phase operator that writes JSON, and only it: JSON stays at check phases').toEqual(['test.json.out']);
    expect(strs(line['modules'], 'the refusal\'s modules'), 'the refusal names the operator\'s canvas module').toContain('test.json');
    expect(strs(line['arrays'], 'the refusal\'s arrays'), 'the refusal names the array the operator writes JSON into').toContain('test.json.out');
  });

  it(`${ID} with every shipped operator typed, each frame of the 10,000-item board after one item of each kind changes allocates no JSON value, while the frame runs that item's operators`, () => {
    const calls: JsonObject[] = [show(BIG), framesCall(DOC.a, 1)];
    for (const c of CHANGES) calls.push(show(edit(BIG, c.edits)), framesCall(DOC.a, 2));
    const replies = run(builds.bin(FULL), scenario(temp(), calls));
    presented(replies[0]!, 'the 10,000-item board');
    const failures: string[] = [];
    CHANGES.forEach((c, k) => {
      presented(replies[2 + 2 * k]!, `the revision with ${c.item} changed`);
      const [changed, still] = framesOf(replies[3 + 2 * k]!, `the frames after ${c.item} changed`, 2);
      expect(changed!.ran, `the frame after ${c.item} changed runs the operators that read it, so the frame path was exercised`).toBeGreaterThan(0);
      if (changed!.json_values !== 0) failures.push(`the frame with ${c.item} changed allocated ${changed!.json_values} JSON values`);
      expect(still!.ran, `the next frame, with nothing changed, runs no operator`).toBe(0);
      if (still!.json_values !== 0) failures.push(`the frame after it, with nothing changed, allocated ${still!.json_values} JSON values`);
    });
    expect(failures, 'no frame with one item changed allocates a JSON value').toEqual([]);
    expect(KINDS.length, 'one change per kind of the board').toBe(CHANGES.length);
  }, 1_800_000);

  it(`${ID} a 10,000-item board whose one rect slides on a clip: every frame moves that one item and allocates no JSON value`, () => {
    const moving = mixed('Ten thousand, one sliding', 10_000, slide('r5', 'rect@1', 0, 600));
    const replies = run(builds.bin(FULL), scenario(temp(), [show(moving), framesCall(DOC.a, 12)]));
    presented(replies[0]!, 'the sliding board');
    const list = framesOf(replies[1]!, 'the sliding board\'s frames', 12);
    const failures: string[] = [];
    for (const [i, f] of list.entries()) {
      if (i === 0) continue;
      expect(f.ran, `frame ${i}: the slid rect moved, so its operators ran`).toBeGreaterThan(0);
      if (f.json_values !== 0) failures.push(`frame ${i} (t ${f.t}) allocated ${f.json_values} JSON values`);
    }
    expect(failures, 'no frame with the one sliding item changed allocates a JSON value').toEqual([]);
  }, 1_800_000);

  it(`${ID} the count is the allocator's: let in by --planted admits_frame_json, test.json.out's frame after its item changes counts JSON values, while test.json.audit stays in phase check`, () => {
    const doc = board('JSON writer', [rect('r0', 0), { id: 'j0', kind: 'test.json@1', name: 'Planted', order: 'a000001', params: { box: [10, 10, 40, 20] } }], requires({ 'test.json': '^1' }));
    const moved = edit(doc, { 'items/j0/params/box/2': 60 });
    const replies = run(builds.bin(JSON_WRITER), scenario(temp(), [show(doc), framesCall(DOC.a, 1), show(moved), framesCall(DOC.a, 1), evalCall(DOC.a)]), ['--planted', 'admits_frame_json']);
    presented(replies[0]!, 'the board with the planted JSON writer');
    presented(replies[2]!, 'its revision with the planted item changed');
    const [after] = framesOf(replies[3]!, 'the frame after the planted item changed', 1);
    expect(after!.ran, 'the frame after the planted item changed runs its operator').toBeGreaterThan(0);
    expect(after!.json_values, 'the planted frame-phase JSON writer\'s values are counted, so a zero elsewhere means none was allocated').toBeGreaterThan(0);
    const e = evaluated(replies[4]!, 'the planted board\'s frame');
    const phase = (op: string): string[] => e.nodes.filter((n) => n.operator === op).map((n) => n.phase);
    expect(phase('test.json.out'), 'test.json.out runs in phase items').toEqual(['items']);
    expect(phase('test.json.audit'), 'test.json.audit runs in phase check').toEqual(['check']);
  }, 600_000);
});
