// #2218 AC1: in a trusted fixture repo, a spec check with `runs: 3` whose command passes on its first run and fails
// on its second gives the claim INCONCLUSIVE, naming the check as passed and failed on real runs of the commit. A hub
// that drops `runs` runs it once and passes the claim (issue: Scope, "A spec check's `runs` and `accept` reach the
// claim's check, and the verdict rules count its clean runs against them as they do for a definition's check"; design:
// How runs become one of five verdicts, "passed and failed on real runs of the commit → INCONCLUSIVE", "a check with
// runs still to come ... is pending until they end" and, under the run counts, "a pass and a fail → INCONCLUSIVE").
//
// The spec's one check, `turnstile`, runs tests/turnstile.js with `runs: 3`. On the session's fixed tree its first run
// comes through and every later run fails (fixtures/turnstile.js): the count is a folder under the world's own folder,
// outside every checkout, which is why the spec lists the check under `outside` (#33). The session types the change,
// makes the fix and stops; the handed definition's one requirement passes, so the claim's verdict turns on the spec's
// check alone. A turnstile whose first run didn't pass is BLOCKED (thrown): the scenario never reached the criterion.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, TURNSTILE, claimed, cleanup, fixture, names, shop, shownClaim, shownRun, wordsOf } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC1} a spec check's runs reach the claim's check`, () => {
  it(`${AC1} with runs: 3, a check that passes on its first run and fails on its second gives the claim INCONCLUSIVE, naming the check as passed and failed on real runs of the commit`, async () => {
    const w = await shop({ spec: fixture('runs.yaml'), late: (world) => ({ [TURNSTILE]: fixture('turnstile.js').replace('__TURNED__', join(world.tmp, 'turned')) }) });
    const c = await claimed(AC1, w, { done: (r) => r.outcome === 'INCONCLUSIVE' && r.runs.some((run) => run.check === 'turnstile' && run.outcome === 'failed') });
    const runs = c.runs.filter((r) => r.check === 'turnstile');
    expect(runs.length, `${AC1} the trusted repo's spec check turnstile must run on the claim: ${shownClaim(c)}`).toBeGreaterThan(0);
    if (!runs.some((r) => r.outcome === 'passed') || !existsSync(join(w.tmp, 'turned'))) throw Error(`BLOCKED: ${AC1} the fixture's turnstile must let its first run on the fixed tree through, and that run must pass: ${runs.map(shownRun).join('; ')}`);
    expect(c.outcome, `${AC1} the spec gives turnstile runs: 3, and its command passes on its first run and fails on its second, so the claim must be INCONCLUSIVE; the hub ran turnstile ${runs.length === 1 ? 'once' : `${runs.length} times`} (${runs.map((r) => r.outcome ?? 'still going').join(', ')}) and judged the claim ${c.outcome ?? 'with no verdict'}: ${shownClaim(c)}`).toBe('INCONCLUSIVE');
    const snapshot = String(c.last!.data.commit);
    const real = runs.filter((r) => r.commit === snapshot);
    expect(real.some((r) => r.outcome === 'passed') && real.some((r) => r.outcome === 'failed'), `${AC1} the record must hold a run of turnstile that passed and one that failed, both real runs of the claim's commit ${snapshot.slice(0, 8)}: ${runs.map(shownRun).join('; ')}`).toBe(true);
    const said = wordsOf(c.last).filter((text) => names(text, 'turnstile'));
    expect(said.length, `${AC1} the INCONCLUSIVE verdict must name the check, turnstile: ${JSON.stringify(wordsOf(c.last))}`).toBeGreaterThan(0);
    expect(/pass/i.test(said.join('\n')) && /fail/i.test(said.join('\n')), `${AC1} the INCONCLUSIVE verdict must name turnstile as passed and failed on real runs of the commit: ${JSON.stringify(said)}`).toBe(true);
  }, 1_800_000);
});
