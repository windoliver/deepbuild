// AC8, the run's half: a check whose setup writes a table that no file outside the repo's test, fixture and script
// folders writes is marked a stand-in, found by a search of the source with no model. In the fixture repo the
// check seeds `policies` from scripts/seed.ts while src/ only reads it: a stand-in. In its twin src/ inserts into
// `policies` too: not one. That a stand-in can't pass a requirement about what real users get (it stays
// INCONCLUSIVE) is the claim's verdict, the gate runner's (#29), in blocked.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';
import { everySeededTableAStandIn } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The twin: the app itself writes the refund policy too. */
const TWIN_SRC = `import type { Db } from '../test/db';

// The app reads the refund window from the policies table, and an admin screen sets it.
export function refundWindow(db: Db): number {
  const row = db.get('SELECT days FROM policies WHERE name = ?', ['refunds']);
  return Number(row?.days ?? 0);
}

export function setRefundWindow(db: Db, days: number): void {
  db.run('INSERT INTO policies (name, days) VALUES (?, ?)', ['refunds', days]);
}
`;
const policiesCheck = (twin: boolean) => command(world.sup, project('policies', twin ? { 'src/policies.ts': TWIN_SRC } : {}), VITEST, { inputs: ['src/**', 'test/**', 'scripts/**'] });

/** The criterion's assertion on the twin's run: its setup seeds `policies`, and the check isn't a stand-in. */
function twinIsNoStandIn(r: CommandRun): void {
  const policies = r.seeded.find((s) => s.name === 'policies');
  expect(policies, `the record lists the table the setup writes (seeded: ${JSON.stringify(r.seeded)})`).toMatchObject({ name: 'policies', by: 'scripts/seed.ts' });
  expect(r.seeded.filter((s) => s.standIn).map((s) => s.name), 'the twin, whose src/ inserts into policies, is marked a stand-in for').toEqual([]);
}

describe('AC8 #30.626ffab8 a check whose setup writes a table nothing outside the test, fixture and script folders writes is a stand-in', () => {
  it('AC8 the check that seeds policies from scripts/seed.ts, while no file under src/ writes policies, is marked a stand-in naming the table and the file that seeds it', async () => {
    const r = await runCommandCheck(policiesCheck(false));
    expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('passed');
    expect(r.seeded, 'the record lists the stand-in').toContainEqual({ name: 'policies', by: 'scripts/seed.ts', standIn: true });
  }, 180_000);

  it('AC8 in its twin, where src/ inserts into policies, the check is not a stand-in', async () => {
    const r = await runCommandCheck(policiesCheck(true));
    expect(r.outcome, outputOf(r).slice(0, 1500)).toBe('passed');
    twinIsNoStandIn(r);
  }, 180_000);

  it('AC8 (wrong program) a rule that marks every seeded table a stand-in marks the twin and fails this test, naming policies', async () => {
    const r = await runCommandCheck(policiesCheck(true));
    const wrong = everySeededTableAStandIn(r);
    expect(() => twinIsNoStandIn(wrong)).toThrow(/policies/);
  }, 180_000);
});
