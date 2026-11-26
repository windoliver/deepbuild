// A reading recorded before codes (#1456) is read by the one table of earlier words. An interrupted turn's words changed
// with #3430: any hook's "<hook>: you interrupted this turn", where Codex's "Interrupt: …" was the only one before. Both
// must read as interrupted, and the words elsewhere in a reading, or a reading that carries its own code, must not.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readingCode } from '../src/reading-codes.js';

function codeOf(data: Record<string, unknown>): string {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE r (data TEXT)');
  db.prepare('INSERT INTO r (data) VALUES (?)').run(JSON.stringify(data));
  const row = db.prepare(`SELECT ${readingCode('r')} AS code FROM r`).get() as { code: string };
  db.close();
  return row.code;
}

describe('an earlier record\'s interrupted turn', () => {
  it('reads Codex\'s Interrupt and, since #3430, any hook\'s interrupted turn as interrupted', () => {
    expect(codeOf({ reading: 'Interrupt: you interrupted this turn' })).toBe('interrupted');
    expect(codeOf({ reading: 'Stop: you interrupted this turn (canceled)' })).toBe('interrupted');
  });

  it('reads the words anywhere but right after the hook\'s name as no interrupt, and a reading\'s own code first', () => {
    expect(codeOf({ reading: 'Stop: it said: you interrupted this turn' })).toBe('other');
    expect(codeOf({ reading: 'Stop: you interrupted this turn', code: 'other' })).toBe('other');
  });
});
