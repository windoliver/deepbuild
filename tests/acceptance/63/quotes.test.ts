// #63 AC2: a finding whose quote isn't at its handle is dropped and logged, never written.
// AC10's first draft was here; its blind redraft replaced it (quotes-redraft.test.ts, AC10-REDRAFT.md).
// The findings are planted in the fake agent's answer (README, The fake agent): the agent is the boundary.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FACTS, session } from './corpus.ts';
import { AC, cleanup } from './helpers.ts';
import { dataOf, openWorld, runReading, toJson } from './world.ts';

afterAll(cleanup);

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

describe(`AC2 ${AC[2]} a finding whose quote isn't at its handle is dropped and logged, never written`, () => {
  it('AC2 the install drops a finding quoting what its handle does not hold, logs it naming the handle, and writes it nowhere', async () => {
    const sessions = [1000, 1001, 1002].map((seed) => session(seed, { project: 'api', count: 10 }));
    const at = `${sessions[0]!.handle}#m2`;
    const wrong = 'api starts with `yarn dev` on port 4000';
    const w = await openWorld({ planted: [{ text: `remember: ${wrong}`, cites: [{ at, quote: wrong }] }] });
    try {
      await w.seed(sessions);
      expect(w.said.get(at), 'the handle holds the true fact, not the planted one').toContain(FACTS.api);
      const { result, runs } = await runReading(w, { kind: 'install' });
      expect(runs.length, 'the install ran jobs').toBeGreaterThan(0);
      expect(result.findings.flatMap((f) => f.cites.map((c) => c.quote)), 'the finding is dropped').not.toContain(wrong);
      expect(result.findings.some((f) => f.cites.some((c) => c.quote.includes('npm run dev'))), 'the true finding is kept').toBe(true);
      const dropped = result.dropped.filter((d) => d.at === at && d.quote === wrong);
      expect(dropped.length, `the result lists the dropped quote at ${at}`).toBeGreaterThan(0);
      expect(dropped[0]!.reason, 'the reason names the handle').toContain(at);
      const logged = (await w.events(['reading.dropped'])).filter((e) => dataOf(e).reading === result.reading && dataOf(e).at === at && dataOf(e).quote === wrong);
      expect(logged.length, `a reading.dropped event logs the quote at ${at}`).toBeGreaterThan(0);
      expect(String(dataOf(logged[0]!).reason), "the log's reason names the handle").toContain(at);
      for (const file of filesUnder(join(w.root, 'wiki'))) expect(readFileSync(file, 'utf8'), `${file} never holds the dropped finding`).not.toContain('yarn dev');
      const learned = (await w.events()).filter((e) => e.kind.startsWith('learn'));
      expect(learned.length, 'the install wrote its other findings as learned changes').toBeGreaterThan(0);
      for (const e of learned) expect(toJson(e), `${e.kind} ${e.id} never carries the dropped finding`).not.toContain('yarn dev');
    } finally {
      await w.close();
    }
  }, 900_000);
});
