// AC1: under a standing rule, a change whose only open requirement is a taste call, and which reaches no release, no
// published page and no outside service, lands once every other check passes. Its issue stays open naming the call,
// and no view reads PASS: the record, `deep work show`, the forge's commit statuses and the app's list. A planted
// lander that records the landing as PASS fails the same judgement, naming the claim.
import { expect, test } from 'vitest';
import { claimsOf, FIRST, landedFailures, MIN, named, namesCall, openCallsOf, PLANT, sleep, waitUntil, World } from './helpers.ts';

const N = 100;

/** One issue, its change reversible, worked under a standing rule until its change lands and its issue names the call. */
async function landed(plant?: string): Promise<World> {
  const w = await World.open({ issues: [{}], atOnce: 'one', ...(plant ? { plant } : {}) });
  await w.startRun();
  const merged = await waitUntil(() => w.mergeOf(N), FIRST, 2000);
  expect(merged, `#${N}'s reversible change, every check but its taste call passing, lands within ${FIRST / MIN} minutes of the approval (${await w.about(N)})`).toBeDefined();
  // The call, and the issue naming it, come with the landing; then the lander's own writes settle.
  await waitUntil(async () => { const open = openCallsOf(await w.events(), N); return open.length > 0 && namesCall(w.issueText(N), open[0]!); }, 5 * MIN, 2000);
  await sleep(30_000);
  return w;
}

test(named(1), async () => {
  const w = await landed();
  expect(await landedFailures(w, N), `#${N}'s change landed with its taste call open`).toEqual([]);
  await w.close();

  // The planted lander records the landing as PASS: the same judgement fails, naming the claim.
  const p = await landed(PLANT.landsAsPass);
  const claims = claimsOf(await p.events(), N);
  expect(claims.length, `the planted lander judged #${N}'s change by a claim (landing.made's claim)`).toBeGreaterThan(0);
  const failures = (await landedFailures(p, N)).filter((f) => f.includes('reads PASS'));
  expect(failures.length, `the planted lander that records a PASS fails the judgement, on a view that reads PASS; a pass proves nothing`).toBeGreaterThan(0);
  for (const claim of claims) expect(failures.join('\n'), 'its failure names the claim').toContain(claim);
}, 90 * MIN);
