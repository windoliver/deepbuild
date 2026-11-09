// AC1: on a fixture, closing the first ask leaves every other row's `id` unchanged; a planted index-based ID fails, naming
// the row. The replica is the real deep-drive, launched on fixtures/record.events.jsonl and on a copy of it in which the
// oldest ask was answered; the judge reads each row's `id` from the snapshot `see` returns (README, Pinned 1 and 2).
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../16/helpers.ts';
import { driveBinary, ID, idFailures, openAsks, RECORD, requireMacos, see, sessionsOf, variant } from './helpers.ts';

afterAll(() => cleanup(), 60_000);
const MIN = 60_000;

async function judged(plant?: Parameters<typeof driveBinary>[0]): Promise<string[]> {
  requireMacos();
  const bin = await driveBinary(plant);
  const asks = openAsks(RECORD);
  const closedFirst = variant('close-first');
  const [before, after] = [await see(bin, RECORD), await see(bin, closedFirst)];
  return idFailures(before, after, asks, asks[0]!, sessionsOf(RECORD));
}

describe(`AC1 ${ID.ids} On a fixture, closing the first ask leaves every other row's \`id\` unchanged. A planted index-based ID fails, naming the row`, () => {
  it('AC1 every row carries an id, no two the same, and after the oldest ask closes every other row, ask or session, keeps its id', async () => {
    expect(await judged()).toEqual([]);
  }, 30 * MIN);

  it('AC1 wrong program: rows keyed by their place (plant-row-index-ids) fail, naming the row whose id moved', async () => {
    const failures = await judged('plant-row-index-ids');
    const second = openAsks(RECORD)[1]!;
    expect(failures.join('\n'), 'the planted index-based ids fail').not.toBe('');
    expect(failures.join('\n'), 'the failure names the row below the closed one').toContain(second.handle);
    expect(failures.join('\n')).toMatch(/its id is its place/);
  }, 30 * MIN);
});
