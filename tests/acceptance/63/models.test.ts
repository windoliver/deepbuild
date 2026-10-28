// #63 AC7: where a model can be chosen, sub-reads run on a smaller one and the final answer and premise reviews on
// the strongest available, and the job's record names each. Claude Code is an agent whose models DeepBuild chooses
// (`--model`, and each sub-agent's `model` in `--agents`); the fake answers on what it was launched with (README,
// The fake agent), so the models it reports are the ones the job chose.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { session } from './corpus.ts';
import { AC, cleanup, modelsOf, REPO } from './helpers.ts';
import { dataOf, openWorld, runReading } from './world.ts';

afterAll(cleanup);

/** Claude Code's model families, as its facts name them (`modelFamily.families`). */
const families = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { modelFamily: { families: Record<string, string> } }).modelFamily.families;
const familyOf = (model: string): string => families[model] ?? `unknown (${model})`;
const STRONGEST = 'opus';
const SMALLER = ['sonnet', 'haiku'];

describe(`AC7 ${AC[7]} sub-reads on a smaller model, the final answer and premise reviews on the strongest, each named in the record`, () => {
  for (const kind of ['summary', 'premise'] as const) {
    it(`AC7 a ${kind} job of eight sessions: its sub-reads answer on a smaller model, its ${kind === 'premise' ? 'premise review' : 'final answer'} on the strongest, and reading.finished names each`, async () => {
      const sessions = Array.from({ length: 8 }, (_, i) => session(7000 + i, { project: 'web', count: 10 }));
      const w = await openWorld();
      try {
        await w.seed(sessions);
        const { result, runs } = await runReading(w, { kind, handles: sessions.map((s) => s.handle), question: kind === 'premise' ? 'Does the premise "web starts on port 5173" hold in these sessions?' : 'How does web start?' });
        const answered = new Set(runs.flatMap((r) => { const m = modelsOf(r.stdout); return [...(m.main ? [m.main] : []), ...m.subs]; }));
        expect(answered.size, 'the job answered on some model').toBeGreaterThan(0);
        const finished = (await w.events(['reading.finished'])).find((e) => dataOf(e).reading === result.reading);
        expect(finished, `reading.finished records ${result.reading}`).toBeDefined();
        const named = dataOf(finished!).models as { final: string; subreads: string[] };
        expect(named, 'the record names the models').toEqual(result.models);
        expect(familyOf(named.final), `the ${kind === 'premise' ? 'premise review' : 'final answer'} ran on ${named.final}`).toBe(STRONGEST);
        expect(named.subreads.length, 'the job read in sub-reads').toBeGreaterThan(0);
        for (const m of named.subreads) expect(SMALLER, `a sub-read ran on ${m}, a smaller model than ${STRONGEST}`).toContain(familyOf(m));
        expect([...answered].filter((m) => m !== named.final && !named.subreads.includes(m)), 'every model the job answered on is named in its record').toEqual([]);
        for (const m of [named.final, ...named.subreads]) expect(answered.has(m), `${m}, named in the record, is a model the job answered on`).toBe(true);
      } finally {
        await w.close();
      }
    }, 900_000);
  }
});
