// #2077 candidate selection uses the rule parser's body/fence boundaries, not the first similar example.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { RULE, cleanup, deep, fixture, lessons, stopHub } from '../../../tests/acceptance/2077/helpers.ts';

afterAll(cleanup, 120_000);
it('removes the real rule, not the fenced example that precedes it', async () => {
  const w = await fixture('adopt');
  const file = join(w.repo, 'legacy/AGENTS.md');
  const prefix = `# Examples\r\n\r\n\x60\x60\x60text\r\n- ${RULE}\r\n\x60\x60\x60\r\n\r\n`;
  writeFileSync(file, `${prefix}- ${RULE}\r\n`);
  // This existing seam supplies only #344's external eval reading; no runner result is fabricated by the test.
  const evaluated = join(w.tmp, 'eval.json'); writeFileSync(evaluated, JSON.stringify({ outcome: 'adopt' }));
  const { startHub } = await import('../../../tests/acceptance/344/helpers.ts');
  const hub = await startHub(w, { eval: evaluated });
  try {
    const lesson = (await lessons(w)).find((l) => l.text === RULE)!;
    expect(lesson).toBeDefined();
    const reply = await deep(w, ['memory', 'remove', lesson.id]);
    expect(reply.code, reply.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(prefix);
  } finally { await stopHub(hub); }
}, 120_000);
