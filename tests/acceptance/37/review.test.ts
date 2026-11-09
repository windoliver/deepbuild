// AC1: a journey that checks only a label fails review: end state is required. AC17: journey files never contain
// credentials; they come from leases (a secret is referenced by name, and the run is given its value).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkout, endState, journey, journeyPath, journeyVariant, openWorld, readJourney, runOptions, steps, testSecret, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

describe('AC1 #37.32d0ded7 a journey that checks only a label fails review: end state is required', () => {
  it('AC1 a journey whose steps expect a label and whose end state is empty is refused, naming the end state; the same journey with an end-state check passes review', async () => {
    const { reviewJourney } = await journey();
    const dir = checkout();
    const doc = readJourney(dir, 'cart-total');
    const labelOnly = { ...doc, end_state: [] };
    const refused = reviewJourney(stringify(labelOnly));
    expect(refused.ok, `a journey with no end-state check fails review: ${JSON.stringify(refused)}`).toBe(false);
    if (!refused.ok) expect(refused.reasons.join('\n')).toMatch(/end state/i);
    const withoutKey = { ...doc } as Record<string, unknown>;
    delete withoutKey.end_state;
    expect(reviewJourney(stringify(withoutKey)).ok, 'a journey with no end_state key fails review too').toBe(false);
    const passed = reviewJourney(readFileSync(join(dir, journeyPath('cart-total')), 'utf8'));
    expect(passed.ok, `the fixture's cart journey, with its end state, passes review: ${JSON.stringify(passed)}`).toBe(true);
  });

  it('AC1 an end-state check whose only oracle is a model is not an end state a journey can rest on: review refuses it naming the oracle', async () => {
    const { reviewJourney } = await journey();
    const dir = checkout();
    const doc = readJourney(dir, 'cart-total');
    doc.end_state = [{ id: 'looks-right', oracle: 'model', requirement: 'the cart total reads $18.00' }];
    const refused = reviewJourney(stringify(doc));
    expect(refused.ok, 'a model reading alone is no end state').toBe(false);
    if (!refused.ok) expect(refused.reasons.join('\n')).toMatch(/end state|model/i);
  });
});

describe('AC17 #37.47553e4b journey files never contain credentials; they come from leases', () => {
  it('AC17 a journey whose step types a literal into the password field is refused at review naming the step; one that names the secret passes review', async () => {
    const { reviewJourney } = await journey();
    const dir = checkout();
    const value = testSecret();
    const doc = readJourney(dir, 'login');
    const password = steps(doc).find((s) => s.id === 'password')!;
    password.fill = { role: 'textbox', name: 'Password', text: value };
    const refused = reviewJourney(stringify(doc));
    expect(refused.ok, `a credential written into the journey file is refused: ${JSON.stringify(refused)}`).toBe(false);
    if (!refused.ok) expect(refused.reasons.join('\n')).toMatch(/password/);
    const byName = readJourney(dir, 'login');
    expect(JSON.stringify(byName)).not.toContain(value);
    expect(reviewJourney(stringify(byName)).ok, 'the secret referenced by name passes review').toBe(true);
  });

  it('AC17 the run types the value the lease gave for TEST_PASSWORD, signs in, and keeps the value out of every text it records: the saved script, the steps and the end state', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const value = testSecret();
    const run = await runJourney(runOptions(world, dir, journeyPath('login'), { secrets: { TEST_PASSWORD: value } }));
    expect(run.outcome, `the login journey passes with the leased secret: ${JSON.stringify(run.failures)}`).toBe('passed');
    expect(run.endState.find((e) => e.id === 'welcomed')?.outcome).toBe('passed');
    const recorded = JSON.stringify({ steps: run.steps, endState: run.endState, failures: run.failures, evidence: run.evidence });
    expect(recorded, 'the value never appears in the run record').not.toContain(value);
    expect(run.script, 'a passing journey is saved as a replayable script').toMatch(/^[0-9a-f]{64}$/);
    const script = Buffer.from(await world.evidence.read(run.script!)).toString('utf8');
    expect(script, 'the saved script is scrubbed of the typed value').not.toContain(value);
    expect(script, 'the saved script names the secret, as evidence is scrubbed').toMatch(/TEST_PASSWORD|\[redacted\]/);
  }, 120_000);

  it('AC17 a journey file in the checkout that carries a literal secret never runs: the run is refused before any stack starts', async () => {
    const { runJourney } = await journey();
    const dir = checkout();
    const value = testSecret();
    const file = journeyVariant(dir, 'login', (doc) => { steps(doc).find((s) => s.id === 'password')!.fill = { role: 'textbox', name: 'Password', text: value }; }, 'login-literal');
    const run = await runJourney(runOptions(world, dir, file));
    expect(run.outcome, 'a journey holding a credential never passes').not.toBe('passed');
    expect(run.stack, 'no stack started for it').toBeNull();
    expect(JSON.stringify(run), 'the refusal never repeats the value').not.toContain(value);
    expect(endState(readJourney(dir, 'login')).length).toBeGreaterThan(0);
  }, 60_000);
});
