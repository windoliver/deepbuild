// AC3 #1884.1f89e40b `doctor.ts` holds no version comparison of its own: a planted second rule fails a test that
//   reads the source.
//
// The source is packages/hub/src/doctor.ts with its comments taken out. A version comparison of its own is any of
// (README: What counts as a comparison of its own): a comparator over version strings (a function or constant named
// compare/cmp/semver/newer/older, a split of a version on dots, a numeric localeCompare), or a test on a facts
// `versions` list (membership, position or ordering, directly or through a name bound to it). The same detector is
// first run on planted second rules, so the test can't pass by finding nothing anywhere.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { REPO } from './helpers.ts';

const DOCTOR = join(REPO, 'packages/hub/src/doctor.ts');

/** The source without its comments (block comments, and line comments that start a line or follow white space). */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** Every version comparison the source holds of its own, each as the text that shows it. */
function ownComparisons(source: string): string[] {
  const text = code(source);
  const found: string[] = [];
  const add = (re: RegExp) => { for (const m of text.matchAll(re)) found.push(m[0].trim()); };
  // A comparator over version strings.
  add(/\b(?:function\s+|const\s+|let\s+)(?:compare\w*|cmp\w*|semver\w*|newer\w*|older\w*|versionCompare\w*)\b/gi);
  add(/\.split\(\s*(?:\/\[\.-\]\/|\/\[-\.\]\/|\/\\\.\/|'\.'|"\.")\s*\)/g);
  add(/localeCompare\([^;\n]*?numeric/g);
  // A test on a facts `versions` list, directly...
  add(/\.versions\b[\w\s.!?()[\]]*?\.(?:includes|indexOf|lastIndexOf|some|every|find|findIndex|has)\(/g);
  // ...or through a name bound to it.
  for (const [, name] of text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n{}=]*\.versions\b(?!\s*\()/g)) {
    add(new RegExp(`\\b${name}\\s*\\.(?:includes|indexOf|lastIndexOf|some|every|find|findIndex|has)\\(`, 'g'));
    add(new RegExp(`\\b\\w*(?:compare|cmp)\\w*\\([^)]*\\b${name}\\s*\\[`, 'gi'));
    add(new RegExp(`(?:[<>]=?)\\s*${name}\\s*\\[|\\b${name}\\s*\\[[^\\]]*\\]!?\\s*(?:[<>]=?)`, 'g'));
  }
  return [...new Set(found)];
}

/** Second rules planted into a doctor-like source, each of which the detector must find. */
const PLANTS: Record<string, string> = {
  'range rule': `const parts = (v: string) => v.split(/[.-]/).map(Number);\nfunction compare(a: string, b: string): number { return 0; }\nconst covered = (agent: string, version: string) => { const range = facts(agent).versions; return compare(version, range[0]!) >= 0 && compare(version, range[range.length - 1]!) <= 0; };`,
  'list copy': `const covered = (agent: string, version: string) => facts(agent).versions.includes(version);`,
  'bound list copy': `const covered = (agent: string, version: string) => { const listed = facts(agent).versions; return listed.indexOf(version) >= 0; };`,
  'numeric collation': `const covered = (agent: string, v: string) => v.localeCompare(facts(agent).versions[0]!, undefined, { numeric: true }) >= 0;`,
};

test('AC3 #1884.1f89e40b doctor.ts holds no version comparison of its own: the detector finds each planted second rule, and none in doctor.ts', () => {
  for (const [name, plant] of Object.entries(PLANTS)) expect(ownComparisons(plant), `the detector finds the planted second rule "${name}"`).not.toEqual([]);
  const source = readFileSync(DOCTOR, 'utf8');
  expect(ownComparisons(source), `${DOCTOR} decides coverage with a version comparison of its own, a second rule beside the hub's`).toEqual([]);
});
