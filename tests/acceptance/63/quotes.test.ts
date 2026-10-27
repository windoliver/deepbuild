// #63 AC2: a finding whose quote isn't at its handle is dropped and logged, never written.
// #63 AC10: a quote is at its handle only when it is a byte-exact substring of the redacted slice that handle names,
// after Unicode NFC and collapsing each whitespace run to one space, and a quote from a transcript cites its message
// (`#<message>`): a line break apart is at its handle, a changed word is refused naming the handle, and so is one
// citing the whole session; a check that compares case-folded text accepts 'Port 3000' for 'port 3000' and fails.
// The findings are planted in the fake agent's answer (README, The fake agent): the agent is the boundary.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { caseProblems, type Case, type Verdict } from './checks.ts';
import { FACTS, session, tag } from './corpus.ts';
import { AC, cleanup, readAll, type Line } from './helpers.ts';
import { foldedCheck } from './wrong.ts';
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

describe(`AC10 ${AC[10]} a quote is at its handle only as a byte-exact substring of the redacted slice, after NFC and whitespace collapse, citing its message`, () => {
  const token = `ghp_${'dh63AC10'.repeat(4)}abcd`;
  const s = session(2000, {
    project: 'web', count: 4,
    texts: {
      1: `${tag(2000, 1)} The api listens on port 3000 once it has started.`,
      2: `${tag(2000, 2)} Start it with npm run dev\nand then open the browser.`,
      3: `${tag(2000, 3)} The café page uses   three   spaces.`,
      4: `${tag(2000, 4)} The deploy token is ${token} and it rotates monthly.`,
    },
  });
  const m = (n: number) => `${s.handle}#m${n}`;
  const cases: Case[] = [
    { name: 'exact', at: m(1), quote: 'listens on port 3000', expected: 'at' },
    { name: 'a line break apart', at: m(2), quote: 'npm run dev and then open the browser', expected: 'at' },
    { name: 'NFC and a whitespace run', at: m(3), quote: 'café page uses three spaces', expected: 'at' },
    { name: 'a word changed', at: m(1), quote: 'listens on port 4000', expected: 'refused' },
    { name: "'Port 3000' for 'port 3000'", at: m(1), quote: 'listens on Port 3000', expected: 'refused' },
    { name: 'the whole session cited', at: s.handle, quote: 'listens on port 3000', expected: 'refused' },
    { name: 'the secret before redaction', at: m(4), quote: `The deploy token is ${token}`, expected: 'refused' },
  ];
  const planted = cases.map((c) => ({ text: `case: ${c.name}`, cites: [{ at: c.at, quote: c.quote }] }));

  it("AC10 the reading job keeps the quotes at their handles and refuses the rest, each refusal naming the handle; (wrong program) a case-folded check accepts 'Port 3000' and fails", async () => {
    const w = await openWorld({ planted });
    try {
      await w.seed([s]);
      expect(readAll(w.root, m(4)).text, 'the slice m4 names is redacted: the token is not in it').not.toContain(token);
      const { result, runs } = await runReading(w, { kind: 'summary', handles: [s.handle], question: 'What does this session say about starting the api?' });
      expect(runs.length, 'the job ran').toBeGreaterThan(0);
      const verdicts = new Map<string, Verdict>();
      for (const c of cases) {
        const kept = result.findings.some((f) => f.text === `case: ${c.name}`);
        const dropped = result.dropped.filter((d) => d.at === c.at && d.quote === c.quote);
        if (kept && !dropped.length) verdicts.set(c.name, 'at');
        if (!kept && dropped.length) {
          verdicts.set(c.name, 'refused');
          expect(dropped[0]!.reason, `${c.name}: the refusal names the handle`).toContain(c.at);
        }
      }
      expect(caseProblems(cases, verdicts), 'the real check, through a reading job').toEqual([]);
      const logged = (await w.events(['reading.dropped'])).map((e) => dataOf(e) as Line);
      for (const c of cases.filter((x) => x.expected === 'refused')) {
        expect(logged.some((d) => d.at === c.at && d.quote === c.quote && String(d.reason).includes(c.at)), `${c.name}: logged as reading.dropped naming ${c.at}`).toBe(true);
      }
      // The twin: the same cases, judged on the same redacted slices (deep read), by a check that case-folds.
      const twin = new Map<string, Verdict>(cases.map((c) => [c.name, foldedCheck(c.at, readAll(w.root, c.at).text, c.quote)]));
      const problems = caseProblems(cases, twin);
      expect(problems, 'the case-folded check fails this test on exactly one case').toHaveLength(1);
      expect(problems[0], "and that case is 'Port 3000' for 'port 3000'").toContain('Port 3000');
    } finally {
      await w.close();
    }
  }, 900_000);
});
