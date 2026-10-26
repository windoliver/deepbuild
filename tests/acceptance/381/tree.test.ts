// AC1, second half: the dependency tree of the canvas's text and marks crates, which never depend on
// GPUI, links HarfRust as its one shaper and no other shaping or system font library, swash's shaper
// among them. Read with `cargo tree --locked -p <crate> -e normal --target all` for each of
// deep-text, deep-canvas-marks, deep-marks-vello, deep-canvas-scene3d and deep-scene3d-render, which
// resolves features as a build of that crate alone does. The check's twins: a throwaway workspace
// under the OS temp folder whose members each add one forbidden library (as a stub path crate, so it
// resolves offline) beside a stub harfrust, and one with no harfrust; each must fail, named, and the
// clean member must pass.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  OTHER_SHAPERS, SYSTEM_FONT_FEATURES, SYSTEM_FONT_LIBS, TEXT_AND_MARKS_CRATES, cargoTree, treeProblems,
} from './helpers.ts';

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

interface Twin { member: string; deps: string; names: RegExp }

/** A throwaway workspace: one member per twin, and stub crates (not members) for every library they name. */
function twinWorkspace(twins: Twin[], stubs: { name: string; features: string[] }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-381-tree-'));
  scratch.push(dir);
  const crate = (where: string, name: string, extra: string): void => {
    mkdirSync(join(dir, where, 'src'), { recursive: true });
    writeFileSync(join(dir, where, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n${extra}`);
    writeFileSync(join(dir, where, 'src', 'lib.rs'), '');
  };
  writeFileSync(join(dir, 'Cargo.toml'), `[workspace]\nmembers = [${twins.map((t) => `"${t.member}"`).join(', ')}]\nexclude = ["stubs"]\nresolver = "2"\n`);
  for (const t of twins) crate(t.member, t.member, `\n[dependencies]\n${t.deps}`);
  for (const s of stubs) crate(`stubs/${s.name}`, s.name, s.features.length ? `\n[features]\n${s.features.map((f) => `${f} = []`).join('\n')}\n` : '');
  return dir;
}

const dep = (name: string, features: string[] = []): string =>
  `${name} = { path = "../stubs/${name}"${features.length ? `, features = [${features.map((f) => `"${f}"`).join(', ')}]` : ''} }\n`;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('AC1 the canvas\'s text and marks crates never depend on GPUI and link HarfRust as their one shaper, with no other shaping or system font library', () => {
  it(`AC1 the normal dependency tree of each of ${TEXT_AND_MARKS_CRATES.join(', ')} holds one harfrust, no gpui crate, no other shaper (swash among them) and no system font library or feature`, () => {
    const problems = TEXT_AND_MARKS_CRATES.flatMap((crate) => treeProblems(crate, cargoTree(crate)));
    expect(problems, 'the text and marks crates\' dependency trees').toEqual([]);
    // The shaper is parley over HarfRust, with outlines read by skrifa (Which text shaper).
    const text = cargoTree('deep-text');
    for (const name of ['parley', 'harfrust', 'skrifa']) expect(text.has(name), `deep-text's tree holds ${name}`).toBe(true);
  }, 600_000);

  it('AC1 the check\'s twins: a tree that adds swash, any other shaper, a system font library, a system font feature or GPUI fails naming it, one with no harfrust fails, and the clean tree passes', () => {
    const twins: Twin[] = [
      { member: 'twin-clean', deps: dep('harfrust'), names: /^$/ },
      { member: 'twin-no-harfrust', deps: '', names: /links no harfrust/ },
      { member: 'twin-gpui', deps: dep('harfrust') + dep('gpui-kit'), names: /depends on gpui-kit \(GPUI\)/ },
      ...OTHER_SHAPERS.map((name) => ({ member: `twin-shaper-${name.replace(/_/g, '-')}`, deps: dep('harfrust') + dep(name), names: new RegExp(`links ${escape(name)}, a second shaper`) })),
      ...SYSTEM_FONT_LIBS.map((name) => ({ member: `twin-fonts-${name.replace(/_/g, '-')}`, deps: dep('harfrust') + dep(name), names: new RegExp(`links ${escape(name)}, a system font library`) })),
      ...SYSTEM_FONT_FEATURES.map(([name, feature]) => ({ member: `twin-feature-${name.replace(/_/g, '-')}`, deps: dep('harfrust') + dep(name, [feature]), names: new RegExp(`enables ${escape(name)}/${escape(feature)}`) })),
    ];
    const stubs = [
      { name: 'harfrust', features: [] }, { name: 'gpui-kit', features: [] },
      ...[...OTHER_SHAPERS, ...SYSTEM_FONT_LIBS].map((name) => ({ name, features: [] })),
      ...SYSTEM_FONT_FEATURES.map(([name, feature]) => ({ name, features: [feature] })),
    ];
    const root = twinWorkspace(twins, stubs);
    for (const t of twins) {
      const problems = treeProblems(t.member, cargoTree(t.member, root, false));
      if (t.member === 'twin-clean') expect(problems, 'the clean twin (a stub harfrust alone) passes').toEqual([]);
      else {
        expect(problems.length, `${t.member} fails the check`).toBeGreaterThan(0);
        expect(problems.join('\n'), `${t.member} fails naming what it adds`).toMatch(t.names);
      }
    }
  }, 600_000);
});
