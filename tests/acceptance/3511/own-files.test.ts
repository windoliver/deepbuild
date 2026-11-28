import { afterEach, describe, expect, test } from 'vitest';
import { CHECK, cleanup, LIMIT } from '../999/helpers.ts';
import { AC, AGENTS_OWN, begin, CODE, edits, exitedZeroThere, PACKAGE, PACKAGE_GUTTED, proof, said, shownClaim, stopAndClaim, TEST_FILE, TEST_GUTTED, type Via } from './helpers.ts';

afterEach(cleanup, 900_000);

async function editedOwnFile(via: Via, file: string, bytes: string): Promise<void> {
  const sc = await begin(via);
  await edits(sc, CODE, '18.00\n');
  await edits(sc, file, bytes);
  const c = await stopAndClaim(sc);
  exitedZeroThere(sc, c);
  const names = said(c.verdicts.at(-1));
  proof(sc.w, `ac1-${via}.json`, { host: sc.w.alias, base: sc.base, edited: [CODE, file], claim: c.id, outcome: c.outcome, runs: c.runs, verdicts: c.verdicts.map((v) => v.data) });
  const read = sc.w.redact(shownClaim(c));

  expect.soft(c.verdicts.filter((v) => v.data.outcome === 'PASS').length, `${CHECK} must not pass the claim on ${sc.w.alias} that edited ${file}, which it runs: no verdict of the claim reads PASS. ${read}`).toBe(0);
  expect.soft(String(c.outcome), `the claim on ${sc.w.alias} that edited ${file}, which ${CHECK} runs, has a verdict, and it isn't PASS: ${read}`).toMatch(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)$/);
  expect.soft(names.filter((t) => t.includes(CHECK) && AGENTS_OWN.test(t)), `the claim's newest verdict names ${CHECK} as the agent's own: ${read}`).not.toEqual([]);
  expect.soft(names.filter((t) => t.includes(file)), `the claim's newest verdict names the edited file, ${file}: ${read}`).not.toEqual([]);
}

describe(AC[1], () => {
  test('a claim on the host that edits the test file its approved check runs, so the check exits 0 there, does not read PASS; the verdict names the check as the agent\'s own and the test file', async () => {
    await editedOwnFile('test-file', TEST_FILE, TEST_GUTTED);
  }, LIMIT);

  test('a claim on the host that edits the package script its approved check runs, so the check exits 0 there, does not read PASS; the verdict names the check as the agent\'s own and package.json', async () => {
    await editedOwnFile('script', PACKAGE, PACKAGE_GUTTED);
  }, LIMIT);
});
