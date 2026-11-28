import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, REPO, scanSources, shownFindings, temp } from './helpers.ts';

afterAll(cleanup);

const SRC = join(REPO, 'packages', 'record', 'src');
const copy = (): string => {
  const dir = temp('deep-1894-src-');
  cpSync(SRC, dir, { recursive: true });
  return dir;
};

describe('AC1 #1894: packages/record/src names no agent and imports no adapter', () => {
  it('ordinary words that look like agent names are not findings', () => {
    const dir = temp('deep-1894-plain-');
    writeFileSync(join(dir, 'plain.ts'), [
      'const cursor = await readSince(record, 0, kinds);',
      'export const readCursor = (at: number) => at; // move the cursor past the page',
      'const r = Math.PI * 2; const pipeline = api(); const epic = spin(); const pi2 = 1;',
      'const opener = codec(); const claudeish = 0; const precursor = 1;',
      "import { registry } from '@deepbuild/contracts'; import type { Facts } from './adapter-facts.js';",
    ].join('\n'));
    expect(shownFindings(scanSources(dir))).toBe('');
  });

  it.each([
    ['Claude Code', '// What Claude Code writes under the user\'s role'],
    ['claude-code', "const agent = 'claude-code';"],
    ['Codex', 'function codexCommand(p: Obj) { return p; }'],
    ['pi', "// pi's entry has its id"],
    ['Cursor', '// a Cursor line has neither'],
    ['Gemini', "const MAKERS = [[/^gemini/, 'Google']];"],
    ['OpenCode', '// an OpenCode session'],
    ['an adapter import', "import { ADAPTERS } from '@deepbuild/adapters';"],
    ['an adapter path import', "import { claudeReader as r } from '../../adapters/src/readers.js';"],
    ['an adapter dynamic import', "const m = await import('@deepbuild/adapters/readers');"],
  ])('the scan fails on a copy of the sources with %s planted', (_, planted) => {
    const dir = copy();
    const file = join(dir, 'learned.ts');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n${planted}\n`);
    const found = scanSources(dir).filter((f) => f.file === 'learned.ts' && f.text === planted.trim().slice(0, 160));
    expect(found.length, `the planted line is a finding: ${planted}`).toBeGreaterThan(0);
  });

  it('no file under packages/record/src names an agent or imports an adapter', () => {
    expect(shownFindings(scanSources(SRC))).toBe('');
  });
});
