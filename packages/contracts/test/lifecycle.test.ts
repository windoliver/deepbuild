// The lifecycle tables' contract test (#570): every record object with a lifecycle has its table, each table holds
// together and moves only on published kinds through guards that mean something, and each is frozen in
// digests.json, so a change to a table is a contract change.
import { describe, expect, it } from 'vitest';
import { d1Digest, frozenDigests, getSchema, LIFECYCLE_OBJECTS, lifecycleGaps, machineProblems, machines, type Schema } from '../src/index.js';

const published = (kind: string): boolean => {
  for (let v = 1; v < 20; v++) {
    try { getSchema(`${kind}@${v}`); return true; } catch { /* the next version */ }
  }
  return false;
};

describe('lifecycle tables', () => {
  it('every record object with a lifecycle has its table', () => {
    expect(lifecycleGaps(LIFECYCLE_OBJECTS, machines())).toEqual([]);
  });

  it('each table holds together: its states, moves, guards and final states, on published kinds', () => {
    for (const table of machines()) expect(machineProblems(table, published), table.id).toEqual([]);
  });

  it('a table naming a guard with no meaning, or moving on a kind no schema publishes, is refused', () => {
    const [ask] = machines().filter((t) => t.id === 'ask.machine@1');
    const planted = { ...ask!, moves: [...ask!.moves, { from: 'open', event: 'ask.vanished', to: 'moot' }, { from: 'open', event: 'ask.moot', guard: 'feels_right', to: 'moot' }] };
    const problems = machineProblems(planted, published);
    expect(problems.some((p) => p.includes('ask.vanished') && p.includes('no schema publishes'))).toBe(true);
    expect(problems.some((p) => p.includes('feels_right'))).toBe(true);
  });

  it('each table is frozen in digests.json: changing one is a contract change', () => {
    const frozen = frozenDigests();
    for (const table of machines()) expect(frozen[table.id], table.id).toBe(d1Digest(table as unknown as Schema));
  });
});
