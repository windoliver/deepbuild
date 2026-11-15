// #2365 AC5, on #20's acceptance suite: for every transcript its tests write, archived as each test archives it, the
// parts joined are byte-identical to the one copy the merge base's own archive stores of the finished file, and a
// second pass over the unchanged transcript reads none of it. Then the planted wrong archives (wrong.ts), each on the
// scenarios the real archive passed first: one that rereads its sources fails the zero-read clause, one that drops
// the newline at each cut fails byte identity; each failure names the session.
import { afterAll, describe, expect, it } from 'vitest';
import { removeTemps } from '../20/helpers.ts';
import { AC5, problemsOf, runScenario, SUITE, type Run, type Scenario } from './scenarios.ts';
import { cutBeforeNewlineArchive, rereadingArchive } from './wrong.ts';

afterAll(removeTemps);

const summary = (run: Run): string => `${run.scenario}: ${run.seen.map((t) => `${t.session} ${t.size} B, ${t.readings.length} joins, read ${t.read} B`).join('; ')}`;

describe(`AC5 ${AC5} for every transcript in #20's suite, the parts joined equal the merge base's one copy, and an unchanged transcript's second pass reads none of it`, () => {
  for (const s of SUITE) {
    it(`AC5 ${s.name}`, async () => {
      const run = await runScenario(s);
      console.log(summary(run));
      expect(run.seen.length, `${s.name}: the scenario left its transcripts`).toBeGreaterThan(0);
      expect(problemsOf(run), `${s.name}: ${run.seen.length} transcripts against the merge base ${run.base.sha.slice(0, 12)}`).toEqual([]);
    }, 300_000);
  }
});

describe(`AC5 ${AC5} planted wrong archives fail the criterion's check, naming the session`, () => {
  const growth = SUITE.find((s) => s.name.startsWith('#20 AC10'))!;
  const three = SUITE.find((s) => s.name.startsWith('#20 AC1 '))!;
  const scenarios: Scenario[] = [three, growth];

  it('AC5 (wrong program) an archive that rereads each transcript on every pass reads all of an unchanged one: the check fails naming each session and the bytes it read', async () => {
    for (const s of scenarios) expect(problemsOf(await runScenario(s)), `the real archive first: ${s.name}`).toEqual([]);
    for (const s of scenarios) {
      const run = await runScenario(s, rereadingArchive);
      const found = problemsOf(run).join('\n');
      for (const t of run.seen) {
        expect(t.read, `the twin read all of ${t.session} on the unchanged pass`).toBeGreaterThanOrEqual(t.size);
        expect(found, `the check names ${t.session} and what the twin read of it`).toContain(`${t.session} (${t.agent}, ${t.path}, ${t.size} bytes): the second pass over the unchanged transcript read ${t.read} bytes of it`);
      }
    }
  }, 600_000);

  it('AC5 (wrong program) an archive that leaves the newline out of each part: its parts joined differ from the merge base\'s copy, and the check fails naming the session and the first line that differs', async () => {
    for (const s of scenarios) expect(problemsOf(await runScenario(s)), `the real archive first: ${s.name}`).toEqual([]);
    for (const s of scenarios) {
      const run = await runScenario(s, cutBeforeNewlineArchive);
      const found = problemsOf(run);
      for (const t of run.seen) {
        expect(t.read, `the twin reads nothing of ${t.session} when it is unchanged`).toBe(0);
        const mine = found.filter((p) => p.includes(`${t.session} (`));
        expect(mine.join('\n'), `the check names ${t.session}: its parts joined are not the merge base's copy`).toMatch(/no join of its parts is byte-identical to the merge base's one copy .* line \d+ differs/);
      }
    }
  }, 600_000);
});
