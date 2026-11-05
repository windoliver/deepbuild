// Shared by the #879 acceptance tests. The card check is reached only by running
// `node scripts/repo-rules.mjs` (the lint lane's rules, #246) as a process, in scratch git
// repositories built with #246's helpers, in this checkout read-only, and through
// `scripts/lanes.mjs`'s lint lane.
import assert from 'node:assert/strict';
import { show } from '../246/helpers.mjs';

// The four headings, in the issue's own words (README: "Readings", 1).
export const HEADINGS = ['What it is for', 'Where new code goes', 'What it may import', 'Deviations'];

const bodies = {
  'What it is for': 'Counts fixture rows for the card tests.',
  'Where new code goes': 'New counters go in the src folder, one file per counter.',
  'What it may import': 'Only `node:` modules. The core never imports an extension.',
};

// A card for `name`. `omit` leaves one heading out and says its words in a plain paragraph
// instead, so only a real heading satisfies the check. `deviations` is a list of
// [file, reason]; none gives the deviations heading the single line `None.`.
export function card(name, { omit, deviations = [] } = {}) {
  const lines = [`# ${name}`, ''];
  if (omit) lines.push(`${omit}: covered in the other sections.`, '');
  for (const heading of HEADINGS) {
    if (heading === omit) continue;
    const body = heading === 'Deviations'
      ? (deviations.length ? deviations.map(([file, why]) => `- \`${file}\`: ${why}`).join('\n') : 'None.')
      : bodies[heading];
    lines.push(`## ${heading}`, '', body, '');
  }
  return lines.join('\n');
}

// The 1-based line of `text` that contains `needle`.
export function lineOf(text, needle) {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `no line holds ${needle}`);
  return index + 1;
}

// An npm package and a crate, neither declaring a dependency, so the deps rule passes on them.
export const npmPackage = (dir, name = dir.split('/').at(-1)) => ({
  [`${dir}/package.json`]: `${JSON.stringify({ name: `@fixture/${name}`, private: true }, null, 2)}\n`,
  [`${dir}/src/index.ts`]: `export const ${name.replace(/\W/g, '_')} = 0;\n`,
});
export const crate = (dir, name = dir.split('/').at(-1)) => ({
  [`${dir}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`,
  [`${dir}/src/lib.rs`]: 'pub fn tally() -> u32 {\n    0\n}\n',
});

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// `path` named as itself, not as the prefix of a longer name (packages/tally, not packages/tally-two).
export const names = (line, path) => new RegExp(`${escape(path)}(?![\\w-])`).test(line);
// A line number named the ways a location is usually written: `README.md:17`, `line 17`, `L17`, `#17`.
export const namesLine = (line, number) => new RegExp(`(?:[:#]|\\bline |\\bL)${number}(?!\\d)`, 'i').test(line);

export const stateLines = (result, check) => result.stdout.split('\n').filter((line) => new RegExp(`^(?:FAIL|INVALID|BLOCKED|PASS|NOTE) ${check}:`).test(line));
export const failLines = (result) => result.stdout.split('\n').filter((line) => line.startsWith('FAIL cards:'));

// The run fails, the card check says FAIL (never PASS), and one FAIL cards line passes `test`.
export function assertCardFail(result, what, test) {
  assert.equal(result.status, 1, `expected exit 1 for ${what}\n${show(result)}`);
  assert.doesNotMatch(result.stdout, /^PASS cards:/m, `the card check passes despite ${what}\n${show(result)}`);
  assert.ok(failLines(result).some(test), `no FAIL cards line names ${what}\n${show(result)}`);
}

// The run passes as a whole, and the card check prints PASS.
export function assertCardPass(result, what) {
  assert.match(result.stdout, /^PASS cards: /m, `no PASS cards line for ${what}\n${show(result)}`);
  assert.doesNotMatch(result.stdout, /^(?:FAIL|INVALID|BLOCKED) /m, `${what} should pass every check\n${show(result)}`);
  assert.equal(result.status, 0, `expected exit 0 for ${what}\n${show(result)}`);
}
