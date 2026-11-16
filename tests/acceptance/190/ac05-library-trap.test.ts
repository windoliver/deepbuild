// Criterion 5 (no upstream test): "A fuel trap inside grid_path, on a grid too large for one step, is reported by
// logic.trap with the item, the step, the kind and grid_path's function by name, at the same offset on two machines"
//
// Through `deep-logic bake` (README: deep-logic, LogicTrap) on this host and in a linux/amd64 container. `swarm`
// searches an open 160 × 160 grid corner to corner under the default 1,000,000 fuel a step: the search visits about
// 25,600 cells, eight neighbors each, well past the step's fuel, so step 0 traps inside find_route. The trap names
// grid_path@1 (with its hash) and its function `find_route`; its function index and offset (in the merged program,
// before the rewrite) are the same on both machines, which must have different CPU architectures.
import { describe, expect, it } from 'vitest';
import { ABOUT, AC, TIMEOUT, bakeCall, bakeOf, logicBin, onHost, onLinux, prebuild, show } from './helpers.ts';
import { LARGE_GRID, gridPath1, pack, routePiece } from './libs.ts';

prebuild(() => { logicBin(); });

describe(`${AC[5]} a trap in library code names the library and its function`, () => {
  it(`${AC[5]} a fuel trap inside grid_path on a grid too large for one step names the item, the step, the kind and find_route, at the same offset on two machines`, () => {
    const lib = gridPath1();
    const p = routePiece('swarm', LARGE_GRID, lib, [pack('gridcore', [lib])], 190_05);
    const [about, bake] = onHost([ABOUT, bakeCall(p, 2)]);
    const here = bakeOf(bake!, 'the bake on this host');
    expect(here.traps.length, `one trap: ${show(here.raw['traps'])}`).toBe(1);
    const t = here.traps[0]!;
    expect([t.item, t.step, t.kind], 'logic.trap names the item, step 0 and kind fuel').toEqual(['swarm', 0, 'fuel']);
    expect(t.library, 'and grid_path@1\'s function by name').toEqual({ name: 'grid_path@1', hash: lib.program.sha, function: 'find_route' });
    const [linuxAbout, linuxBake] = onLinux([ABOUT, bakeCall(p, 2)]);
    expect(linuxAbout!['arch'], 'the second machine is Linux x86_64').toBe('x86_64');
    expect(linuxAbout!['arch'], 'the two machines differ in CPU architecture').not.toBe(about!['arch']);
    const there = bakeOf(linuxBake!, 'the bake on Linux x86_64').traps;
    expect(there.map((x) => [x.item, x.step, x.kind, x.library, x.function, x.offset]), 'Linux x86_64 reports the same trap at the same offset')
      .toEqual([[t.item, t.step, t.kind, t.library, t.function, t.offset]]);
  }, TIMEOUT);
});
