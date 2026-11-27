import { afterEach, describe, expect, it } from 'vitest';
import { AC1, call, cleanup, personDeclares, refusalOf, tasteArgs, underParams, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC1} A missing setting isn't the agent's argument`, () => {
  it(`${AC1} deep_ask of a taste question on a hub with no taste deadline: the refusal's path is not under /params and its remediation says the person declares the deadline`, async () => {
    const w = await world('no-taste-deadline');
    const r = refusalOf(await call(w, 'deep_ask', tasteArgs()), 'deep_ask of a taste question with no taste deadline declared');
    const said = JSON.stringify(r);
    expect(underParams(r.path), `the refusal's path ${JSON.stringify(r.path)} is under the call's parameters, as if the agent had sent a wrong argument: ${said}`).toBe(false);
    expect(String(r.remediation ?? ''), `the remediation names the deadline it lacks: ${said}`).toMatch(/deadline/i);
    expect(personDeclares(String(r.remediation ?? '')), `the remediation says the person declares the deadline (README: Readings): ${said}`).toBe(true);
  }, 240_000);
});
