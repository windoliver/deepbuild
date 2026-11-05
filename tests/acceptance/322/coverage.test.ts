// #322 AC9: in this repo, each acceptance criterion's coverage comes from the tests tagged with its ID; a criterion
// with no tagged test is uncovered and keeps the change at Part of, and no criterion waits on a hand mapping or an
// approval ask to find its tests.
//
// The session works in this checkout (REPO). The test work source gives one reading, windoliver/deepbuild#322 at
// work.test (so the GitHub source never sees it), whose criteria are two of #322's own, AC1's and AC9's, which this
// suite's tests tag by their IDs (`#322.6e5671a4`, `#322.5c042dfa`), and one planted criterion no test tags. No
// definition is handed. The locked definition must give each tagged criterion a check that names a test file under
// tests/acceptance/322/ carrying its tag, and the planted one no check; no ask is raised to find them. Then the agent's
// `gh pr create` whose body says Closes #322 is refused, naming Part of and the planted criterion (its ID or text),
// since an uncovered criterion can't pass (AC2's surface).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { AC1, AC9, REPO, asksRaised, cleanup, itemTask, lastPos, lockedFor, makeWorld, must, replyText, requirementsOf, Session, settle, sha256, shown, startHub, type Reading } from './helpers.ts';

afterEach(cleanup, 60_000);

const AC1_TEXT = 'An untrusted repo\'s spec commands never run';
const AC9_TEXT = 'In this repo, each acceptance criterion\'s coverage comes from the tests tagged with its ID; a criterion with no tagged test is uncovered and keeps the change at Part of, and no criterion waits on a hand mapping or an approval ask to find its tests';
const PLANTED = 'The planted criterion that no test in this repo tags holds';
const idOf = (text: string): string => `#322.${sha256(text.trim().replace(/\s+/g, ' ')).slice(0, 8)}`;
const PLANTED_ID = idOf(PLANTED);
const LINK = 'https://work.test/windoliver/deepbuild/issues/322';
const ISSUE: Reading = {
  source_id: 'windoliver/deepbuild#322', link: LINK, title: 'Done gate core reads', body: `### Acceptance criteria\n- [ ] ${AC1_TEXT}\n- [ ] ${AC9_TEXT}\n- [ ] ${PLANTED}\n`,
  criteria: [AC1_TEXT, AC9_TEXT, PLANTED], authors: [{ handle: 'windoliver', role: 'owner' }], updated: '2026-11-03T10:04:15Z',
};
const CLOSES = 'gh pr create --title "Done gate core reads" --body "Closes #322"';

describe(`${AC9} coverage from tagged tests, in this repo`, () => {
  it(`${AC9} AC1's and AC9's criteria get checks naming the test files tagged ${AC1.split(' ')[1]} and ${AC9.split(' ')[1]}; the planted criterion gets none and no ask; gh pr create with Closes #322 is refused naming Part of and ${PLANTED_ID}`, async () => {
    must(idOf(AC1_TEXT) === AC1.split(' ')[1] && idOf(AC9_TEXT) === AC9.split(' ')[1], `${AC9} the criteria's texts hash to this suite's tags: ${idOf(AC1_TEXT)}, ${idOf(AC9_TEXT)}`);
    const w = makeWorld({ readings: [ISSUE] });
    const hub = await startHub(w);
    const s = new Session(w, REPO);
    await s.start();
    const since = await lastPos(hub);
    await s.typed(`Fix ${LINK}`);
    await s.read('AGENTS.md');
    const events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
    const ref = itemTask(events, s);
    must(ref !== undefined, `${AC9} the session started from ${LINK} must open one task under its thread, keyed by the item`);
    const [lock] = lockedFor(events, ref!);
    must(lock !== undefined, `${AC9} the definition of ${ref} must lock from the item's three criteria with no hand mapping and no ask: no definition.locked was recorded`);
    const reqs = requirementsOf(lock);
    for (const [text, tag] of [[AC1_TEXT, AC1.split(' ')[1]!], [AC9_TEXT, AC9.split(' ')[1]!]] as const) {
      const r = reqs.find((q) => typeof q.text === 'string' && q.text.includes(text));
      must(r !== undefined, `${AC9} the definition holds a requirement quoting "${text.slice(0, 60)}…": ${JSON.stringify(reqs).slice(0, 600)}`);
      const check = typeof r!.check === 'string' ? r!.check : '';
      must(check.startsWith('tests/acceptance/322/'), `${AC9} the requirement for ${tag} takes its check from the tests tagged with its ID, a test file under tests/acceptance/322/: ${JSON.stringify(r)}`);
      const file = check.split(/[\s:#]/)[0]!;
      let source = '';
      try { source = readFileSync(join(REPO, file), 'utf8'); } catch { /* not a file */ }
      must(source.includes(tag), `${AC9} the check ${check} names a test file carrying the tag ${tag}: ${file} ${source ? 'has no such tag' : 'is not a file in this checkout'}`);
    }
    const planted = reqs.find((q) => typeof q.text === 'string' && q.text.includes(PLANTED));
    must(planted !== undefined, `${AC9} the planted criterion "${PLANTED}" is a requirement too: ${JSON.stringify(reqs).slice(0, 600)}`);
    must(!planted!.check, `${AC9} no test tags ${PLANTED_ID}, so its requirement is uncovered, with no check: ${JSON.stringify(planted)}`);
    const asks = asksRaised(events, since);
    must(!asks.length, `${AC9} no criterion waits on a hand mapping or an approval ask to find its tests: ${asks.length} asks raised: ${asks.map((a) => JSON.stringify(a.data).slice(0, 200)).join('; ')}`);

    const closes = await s.bash(CLOSES);
    must(!closes.allowed, `${AC9} ${PLANTED_ID} is uncovered, so the change stays at Part of #322: \`${CLOSES}\` must be refused; deep-hook allowed it: ${shown(closes.before)}`);
    const reason = replyText(closes.before);
    must(/\bPart of\b/.test(reason), `${AC9} the refusal names Part of: ${reason.slice(0, 500)}`);
    must(reason.includes(PLANTED_ID) || reason.includes(PLANTED), `${AC9} the refusal names the uncovered criterion, ${PLANTED_ID} or its text: ${reason.slice(0, 500)}`);
  }, 300_000);
});
