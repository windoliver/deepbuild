// #3548's Scope, fourth line: "This task also amends the state folder's line in One hub per user, which names `logs/`
// with no size". The limit criterion 1 holds (#3548.2789a2c7) is the design's once that line says
// it: the paragraph of docs/technical-design.md that starts "Everything lives under `~/.deepbuild/`" names `logs/`
// and gives its size, the issue's 64 MB (README: Readings, The design's line). On the merge base the line ends
// "and `logs/`." with no size, and the test fails, naming the line's end.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers.ts';

const IDS = '#3548.2789a2c7';

describe(`${IDS} (Scope) the design gives logs/ its size`, () => {
  it(`${IDS} (Scope) the state folder's line in One hub per user names logs/ with its size, 64 MB`, () => {
    const design = readFileSync(join(REPO, 'docs/technical-design.md'), 'utf8');
    const lines = design.split('\n').filter((line) => line.startsWith('Everything lives under `~/.deepbuild/`'));
    expect(lines.length, 'docs/technical-design.md has the one line that starts "Everything lives under `~/.deepbuild/`"').toBe(1);
    const line = lines[0]!;
    const at = line.indexOf('`logs/`');
    expect(at, 'that line names `logs/`').toBeGreaterThanOrEqual(0);
    expect(/\b64\s?(?:Mi?B|megabytes|mebibytes)\b/i.test(line), `the state folder's line gives \`logs/\` its size, 64 MB; from \`logs/\` on it reads: ${JSON.stringify(line.slice(at, at + 300))}`).toBe(true);
  }, 60_000);
});
