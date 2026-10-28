// AC6: "A test pack whose requires.modules names scene3d is refused with module_missing naming scene3d in
// a build without scene3d, and so is a document that names it, its checks BLOCKED, while the same pack
// checks clean in a build with scene3d; a planted pack check that skips requires.modules admits it and
// fails, naming the pack"
//
// asserts: in the `r1` build (no scene3d) the test pack test/solid@1.0.0, whose requires.modules names
// scene3d, is refused at its pack check with `module_missing` naming scene3d (`packModuleFailures`); a
// board naming it (with an instance of solid.block@1) is refused with `module_missing` naming scene3d, no
// snapshot, and its `--check` is BLOCKED; in the `full` build (scene3d among its modules) the same pack
// installs with no error; `pack_check_skips_requires_modules` in `r1` admits the pack and fails
// `packModuleFailures`, naming test/solid.

import { describe, expect, it } from 'vitest';
import {
  DOC, FULL, PACKS, R1, SOLID, board, check, errors, failsNaming, instance, issues, names, none, outcome, packAt, packModuleFailures, packRow, run, scenario, show, snapshots,
  useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1, FULL]);
const evidence = useEvidence();
const solid = board('A block', [packAt(SOLID)], [instance('s1', 'solid.block@1', { side: 2 }, 'a0', [100, 100])]);

describe('AC6 a pack whose requires.modules names scene3d is refused without scene3d, and checks clean with it', () => {
  it('AC6 in the build without scene3d the pack is refused with module_missing naming scene3d, and so is a document naming it, its check BLOCKED', () => {
    const [packs, shown, checked] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main' }, [SOLID], [
      PACKS,
      show(solid, { pixels: true }),
      check(solid, { doc: DOC.b }),
    ]));
    none(packModuleFailures(packRow(packs!, SOLID), SOLID, 'scene3d'), 'the pack check without scene3d');
    expect(outcome(shown!), 'the board naming the pack is refused').toBe('refused');
    expect(snapshots(shown!).length, 'and not drawn').toBe(0);
    const missing = errors(issues(shown!)).filter((i) => i.code === 'module_missing' && names(i, 'scene3d'));
    expect(missing.length, `the board's refusal carries module_missing naming scene3d: ${JSON.stringify(shown!['issues']).slice(0, 600)}`).toBeGreaterThan(0);
    expect(checked!['result'], `the board's check is BLOCKED: ${JSON.stringify(checked).slice(0, 600)}`).toBe('BLOCKED');
  });

  it('AC6 in the build with scene3d the same pack checks clean', () => {
    const [packs] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [SOLID], [PACKS]));
    const row = packRow(packs!, SOLID);
    expect(row.state, `the pack installs with scene3d: ${JSON.stringify(row.issues.map((i) => i.raw)).slice(0, 600)}`).toBe('installed');
    expect(errors(row.issues), 'with no error').toEqual([]);
  });

  it('AC6 a planted pack check that skips requires.modules admits the pack without scene3d and fails this check, naming the pack', () => {
    const [packs] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main' }, [SOLID], [PACKS], { planted: 'pack_check_skips_requires_modules' }));
    failsNaming(packModuleFailures(packRow(packs!, SOLID), SOLID, 'scene3d'), [SOLID.id], 'the pack check that skips requires.modules');
  });
});
