// AC10 #540.a41e287c: A margin never reaches through what hides a target: a point mark hidden behind an opaque wall
// except for a 1 px sliver, 2 px from a press that lands on the wall, is named only while the sliver draws; fully
// hidden, it is never named, and the wall is. A press on a mesh 2 px from a 1 px line names the mesh
//
// The scenes (fixtures.ts `wallDoc`), under the camera at the origin looking along −Z, fov 90° on 1000 × 1000: `wall`,
// an opaque box whose front face at depth 10 spans columns 600 to the edge; `mark`, a 3 px point at depth 20 over
// columns 699 to 701; `block`, an opaque box at depth 10 over columns 200 to 300; `rail2`, a 1 px line at depth 10 in
// column 302. Three documents in three panels: A, the wall's edge at 701 (column 701 of the mark is the sliver) with
// `targets: [mark]`; B, the edge at 702 (the mark fully hidden) with `targets: [mark]`; C, the edge at 702 with
// `targets: [mark, wall, block, rail2]`. In each a click at (699.5, 500.5), on the wall, 2 px from the sliver's pixel
// centre; in C also a click at (300.5, 500.5), on the block, 2 px from the line's. Margin 3 throughout.
// Reading (README: Readings): the Scope's rule lets the pixel under the pointer win when it holds a target, so the
// sliver is named through a margin only where the wall isn't a target (A); "and the wall is" is read with the wall
// among the targets (C).
import { describe, it } from 'vitest';
import { EYE_POSE, HIDDEN_EDGE, SLIVER_EDGE, wallDoc } from './fixtures.ts';
import type { V2 } from './geometry.ts';
import { AC, DOC, Script, TIMEOUT, binOf, entriesOf, entryName, none, prebuild, presented, runShow, scenario, show, useTemp, valueOf, type JsonObject } from './helpers.ts';

prebuild();
const temp = useTemp();
const A = DOC(101), B = DOC(102), C = DOC(103);
const ON_WALL: V2 = [699.5, 500.5];
const ON_BLOCK: V2 = [300.5, 500.5];

describe(`${AC[10]} a margin never reaches through what hides a target`, () => {
  it(`${AC[10]} the mark is named through its 1 px sliver, never when fully hidden, where the wall is named; a press on a mesh 2 px from a line names the mesh`, () => {
    const s = new Script();
    s.present(A, wallDoc(SLIVER_EDGE, ['mark']));
    s.present(B, wallDoc(HIDDEN_EDGE, ['mark']));
    s.present(C, wallDoc(HIDDEN_EDGE, ['mark', 'wall', 'block', 'rail2']));
    s.panel = 'p1'; const a = s.click(ON_WALL);
    s.panel = 'p2'; const b = s.click(ON_WALL);
    s.panel = 'p3'; const c = s.click(ON_WALL); const m = s.click(ON_BLOCK);
    const r = runShow(binOf(), scenario(temp(), [A, B, C].map((id) => ({ id, size: EYE_POSE.size })), s.calls), 'AC10 the presses by the wall');
    ['A (the sliver draws)', 'B (fully hidden)', 'C (fully hidden, the wall a target)'].forEach((w, i) => presented(r[i]!, `scene ${w}`));
    const press = (idx: [number, number]): JsonObject | null => entriesOf(r, idx, 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
    const failures: string[] = [];
    const check = (idx: [number, number], want: { set: number; key: [number, number] } | null, what: string): void => {
      const e = press(idx);
      if (!e) { failures.push(`${what}: the press writes no press entry: ${show(r[idx[0]]!['appended'] ?? null)}`); return; }
      if (JSON.stringify(valueOf(e).hit) !== JSON.stringify(want)) failures.push(`${what}: ${entryName(e)} names ${show(valueOf(e).hit)}, not ${want ? show(want) : 'nothing'}`);
    };
    check(a, { set: 0, key: [0, 0] }, 'A, the press on the wall 2 px from the drawn sliver, targets [mark]: it names the mark');
    check(b, null, 'B, the press on the wall with the mark fully hidden, targets [mark]: the mark is never named');
    check(c, { set: 1, key: [0, 0] }, 'C, the press on the wall with the mark fully hidden, targets [mark, wall, block, rail2]: it names the wall');
    check(m, { set: 2, key: [0, 0] }, 'C, the press on the block 2 px from the 1 px line: it names the mesh');
    none(failures, 'the presses by the wall and the block');
  }, TIMEOUT);
});
