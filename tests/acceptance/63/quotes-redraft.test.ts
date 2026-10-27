// #63 AC10, blind redraft (AC10-REDRAFT.md): a quote is at its handle only when it is a byte-exact substring of the
// redacted slice that handle names, after Unicode NFC and collapsing each whitespace run to one space, and a quote
// from a transcript cites its message (`#<message>`): a quote that differs only by a line break is at its handle, one
// with a word changed is refused, naming the handle, and so is one that cites the whole session; a check that compares
// case-folded text accepts 'Port 3000' for 'port 3000' and fails this test.
//
// Every case goes through one reading job (README, The surface under test): the findings are planted in the fake
// agent's answer (the agent is the boundary these tests don't own), each citing one handle under one archived session,
// and the job's result and its `reading.dropped` events are the check's verdicts.
//
// The normalization cases are built from code points, never typed accented text, so the source file's own encoding
// can't make them NFC on both sides: the transcript the archive copies holds `NFD_KO` (decomposed Hangul jamo) where
// the quote holds `NFC_KO` (precomposed syllables), and the other way round for `NFC_CITY`/`NFD_CITY`. Every non-ASCII
// character here is above U+00FF, so the fake (Perl, printing without an encoding layer) prints its answer as UTF-8.
import { afterAll, describe, expect, it } from 'vitest';
import { caseProblems, storedMessages, type Case, type Verdict } from './checks.ts';
import { session, tag } from './corpus.ts';
import { AC, cleanup, norm, readAll, type Line, type Planted } from './helpers.ts';
import { foldedCheck } from './wrong.ts';
import { dataOf, openWorld, runReading } from './world.ts';

afterAll(cleanup);

const KO = '한국어'; // 한국어, three Hangul syllables
const NFC_KO = KO.normalize('NFC');
const NFD_KO = KO.normalize('NFD'); // nine conjoining jamo
const CITY = '서울'; // 서울
const NFC_CITY = CITY.normalize('NFC');
const NFD_CITY = CITY.normalize('NFD');
const LIGATURE = 'ﬁ'; // ﬁ: NFC keeps it, only a compatibility form (NFKC) makes it "fi"
const SEED = 6310;
const token = `ghp_${'dh63AC10'.repeat(4)}abcd`; // made up; the store's pattern scrub masks it

describe(`AC10 ${AC[10]} a quote is at its handle only as a byte-exact substring of the redacted slice it names, after NFC and whitespace collapse, citing its message (redraft)`, () => {
  const s = session(SEED, {
    project: 'web', count: 7,
    texts: {
      1: `${tag(SEED, 1)} The api listens on port 3000 once it has started.`,
      2: `${tag(SEED, 2)} Start it with npm run dev\nand then open the browser.`,
      3: `${tag(SEED, 3)} The ${NFD_KO} page is served from the ko folder.`,
      4: `${tag(SEED, 4)} The ${NFC_CITY} office opens at nine.`,
      5: `${tag(SEED, 5)} The worker retries \t  three\t times before it gives up.`,
      6: `${tag(SEED, 6)} The fixture loader reads its seeds first.`,
      7: `${tag(SEED, 7)} The deploy token is ${token} and it rotates monthly.`,
    },
  });
  const m = (n: number) => `${s.handle}#m${n}`;
  const fixed: Case[] = [
    { name: 'exact', at: m(1), quote: 'listens on port 3000', expected: 'at' },
    { name: 'a line break apart', at: m(2), quote: 'npm run dev and then open the browser', expected: 'at' },
    { name: 'NFC quote of an NFD slice', at: m(3), quote: `The ${NFC_KO} page is served`, expected: 'at' },
    { name: 'NFD quote of an NFC slice', at: m(4), quote: `The ${NFD_CITY} office opens`, expected: 'at' },
    { name: 'a whitespace run in the slice', at: m(5), quote: 'retries three times before', expected: 'at' },
    { name: 'a whitespace run in the quote', at: m(1), quote: 'listens  on\n\t port 3000', expected: 'at' },
    { name: 'a word changed', at: m(1), quote: 'listens on port 4000', expected: 'refused' },
    { name: "'Port 3000' for 'port 3000'", at: m(1), quote: 'listens on Port 3000', expected: 'refused' },
    { name: 'the whole session cited', at: s.handle, quote: 'listens on port 3000', expected: 'refused' },
    { name: 'another message of the session cited', at: m(2), quote: 'listens on port 3000', expected: 'refused' },
    { name: 'a compatibility form (NFKC, not NFC)', at: m(6), quote: `The ${LIGATURE}xture loader`, expected: 'refused' },
    { name: 'the secret as it was before redaction', at: m(7), quote: `deploy token is ${token}`, expected: 'refused' },
  ];
  const plant = (cases: readonly Case[]): Planted[] => cases.map((c) => ({ text: `case: ${c.name}`, cites: [{ at: c.at, quote: c.quote }] }));

  it("AC10 the reading job keeps each quote at its handle (exact, a line break apart, NFC either way, a whitespace run either side, the redacted text) and refuses the rest naming the handle (a word changed, 'Port 3000', the whole session, another message, NFKC, the unredacted secret); (wrong program) a case-folded check accepts 'Port 3000' and fails", async () => {
    expect(NFD_KO, 'the fixture: the NFD form differs from the NFC form').not.toBe(NFC_KO);
    expect(NFD_CITY, 'the fixture: the NFD form differs from the NFC form').not.toBe(NFC_CITY);
    const w = await openWorld();
    try {
      await w.seed([s]);
      // The bytes the record holds: the archived copy keeps the transcript's normalization forms (the check must do NFC).
      const { messages } = await storedMessages(w, s.handle);
      const stored = (n: number) => messages.find((x) => x.at === m(n))?.text ?? '';
      expect(stored(3), 'the archived copy holds message 3 in NFD').toContain(NFD_KO);
      expect(stored(3), 'the archived copy holds message 3 in NFD, not NFC').not.toContain(NFC_KO);
      expect(stored(4), 'the archived copy holds message 4 in NFC').toContain(NFC_CITY);

      // The redacted slice m7 names: the secret isn't in it, and a quote of its redacted text is at its handle.
      const m7 = readAll(w.root, m(7)).text;
      expect(m7, `the slice ${m(7)} names is redacted: the token is not in it`).not.toContain(token);
      const from = m7.indexOf('deploy token is');
      const to = m7.indexOf('and it rotates');
      expect(from >= 0 && to > from, `the slice ${m(7)} keeps the words around the secret: ${JSON.stringify(m7)}`).toBe(true);
      const cases: Case[] = [...fixed, { name: 'the redacted text as the slice holds it', at: m(7), quote: m7.slice(from, to + 'and it rotates'.length), expected: 'at' }];

      // The cases as the criterion judges them, on the slices `deep read` serves: so each expected verdict is the rule's.
      const slices = new Map(cases.map((c) => [c.at, readAll(w.root, c.at).text]));
      const rule = (c: Case): Verdict => (c.at.includes('#') && norm(slices.get(c.at)!).includes(norm(c.quote)) ? 'at' : 'refused');
      expect(caseProblems(cases, new Map(cases.map((c) => [c.name, rule(c)]))), 'the cases hold on the served slices').toEqual([]);

      w.plant(plant(cases));
      const { result, runs } = await runReading(w, { kind: 'summary', handles: [s.handle], question: 'What does this session say about the api, the pages and the deploy?' });
      expect(runs.length, 'the job ran through the runner').toBeGreaterThan(0);

      const verdicts = new Map<string, Verdict>();
      for (const c of cases) {
        const kept = result.findings.some((f) => f.text === `case: ${c.name}`);
        const dropped = result.dropped.filter((d) => d.at === c.at && d.quote === c.quote);
        if (kept && !dropped.length) verdicts.set(c.name, 'at');
        if (!kept && dropped.length) {
          verdicts.set(c.name, 'refused');
          expect(dropped[0]!.reason, `${c.name}: the refusal names the handle ${c.at}`).toContain(c.at);
        }
      }
      expect(caseProblems(cases, verdicts), 'the real check, through a reading job').toEqual([]);
      const logged = (await w.events(['reading.dropped'])).map((e) => dataOf(e) as Line).filter((d) => d.reading === result.reading);
      for (const c of cases.filter((x) => x.expected === 'refused')) {
        expect(logged.some((d) => d.at === c.at && d.quote === c.quote && String(d.reason).includes(c.at)), `${c.name}: logged as reading.dropped naming ${c.at}`).toBe(true);
      }
      for (const c of cases.filter((x) => x.expected === 'at')) {
        expect(logged.some((d) => d.at === c.at && d.quote === c.quote), `${c.name}: never logged as dropped`).toBe(false);
      }

      // The wrong program: the same cases on the same redacted slices, by a check that case-folds (wrong.ts).
      const twin = new Map<string, Verdict>(cases.map((c) => [c.name, foldedCheck(c.at, slices.get(c.at)!, c.quote)]));
      const problems = caseProblems(cases, twin);
      expect(problems, 'the case-folded check fails this test on exactly one case').toHaveLength(1);
      expect(problems[0], "and that case is 'Port 3000' for 'port 3000', judged at its handle").toContain("'Port 3000' for 'port 3000'");
    } finally {
      await w.close();
    }
  }, 900_000);
});
