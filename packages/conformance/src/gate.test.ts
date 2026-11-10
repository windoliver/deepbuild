import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { gateRun } from './gate.js';

it('a corpus with no case is not decided: INCONCLUSIVE, exit 3, never PASS', async () => {
  const corpus = mkdtempSync(join(tmpdir(), 'deep-gate-corpus-'));
  try {
    writeFileSync(join(corpus, 'manifest.json'), JSON.stringify({ kit: 'gate@1', cases: [] }));
    const lines: string[] = [];
    expect(await gateRun(corpus, [], (line) => lines.push(line))).toBe(3);
    expect(lines).toEqual(['INCONCLUSIVE gate@1: 0 cases']);
  } finally {
    rmSync(corpus, { recursive: true, force: true });
  }
});
