// A held rule line (#344, #2076) is never lost to a reader of the held file: the reader that prunes the lines you
// applied waits on the record for each, and a line an agent's edit removed is held in the meantime.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readHeld, saveHeld, type Held } from '../src/rules.js';
import { SessionMemory, type SessionMemoryOptions } from '../src/session-memory.js';

const held = (id: string, ask: string | null): Held => ({ id, text: `rule ${id}`, file: 'AGENTS.md', scope: 'all', repo: '/repo', proposal: null, ask, session: 's' });

it('a line held or raised while the applied ones are pruned stays as saved, and only the applied one leaves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'held-race-'));
  try {
    saveHeld(dir, [held('applied', 'ask:applied'), held('kept', 'ask:kept'), held('raised', null)]);
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const raw = async (_sql: string, params?: unknown[]): Promise<unknown[]> => {
      if (params?.[0] !== 'ask:applied') return [];
      await answered;
      return [{ answer: 'apply' }];
    };
    const memory = new SessionMemory({ services: { root: { dir }, record: { raw } } } as unknown as SessionMemoryOptions);
    const pruning = (memory as unknown as { heldRules(): Promise<Held[]> }).heldRules();
    // An agent's edit takes a line out while the pruning waits on the record: the line is held.
    // Meanwhile too, a held line's proposal is raised and saved on it.
    saveHeld(dir, [...readHeld(dir).map((h) => (h.id === 'raised' ? { ...h, ask: 'ask:raised' } : h)), held('new', null)]);
    answer();
    await pruning;
    expect(readHeld(dir).map((h) => `${h.id} ${h.ask}`).sort()).toEqual(['kept ask:kept', 'new null', 'raised ask:raised']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("a held line whose proposal can't be raised is named in a reading that fits session.reading@1, however long the rule", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'held-reading-'));
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '- Run the linter before every commit\n');
    const long = `never use ${'moment '.repeat(1500)}`;
    const readings: string[] = [];
    const memory = new SessionMemory({
      services: { root: { dir } },
      mcp: () => ({ proposeRuleRemoval: async () => { throw new Error(`the planted raise failed: ${'x'.repeat(9000)}`); } }),
      events: { appendReading: async (_s: string, _a: string, reading: string) => { readings.push(reading); } },
    } as unknown as SessionMemoryOptions);
    await (memory as unknown as { holdRemoved(s: string, a: string, r: string, b: unknown[]): Promise<void> }).holdRemoved('s', 'claude-code', dir, [{ file: 'AGENTS.md', scope: 'all', rules: [long, 'Run the linter before every commit'] }]);
    expect(readHeld(dir).map((h) => h.text)).toEqual([long]);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toContain('the planted raise failed');
    expect(readings[0]!.length).toBeLessThanOrEqual(8192);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
