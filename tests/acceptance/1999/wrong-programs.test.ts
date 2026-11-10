// AC1's judges against the planted wrong programs (README, Pinned 4): the same world, on a hub started with
// DEEP_HUB_PLANT, must fail the judge that covers what the plant gets wrong, naming it. A base that doesn't list a
// plant can't start that hub: the test is BLOCKED there, nothing judged.
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, buildWorld, CANARY, changeFailures, cleanup, ITEM, MIN, modelCalls, openItemFailures, PLANTS } from './helpers.ts';

afterAll(cleanup, MIN);

describe(`${AC1} (wrong programs) a sentence from the agent's words or a model, or a kind with none, fails`, () => {
  it(`${AC1} (wrong program) ${PLANTS.agentText}: a change whose sentence is the agent's last message fails, naming the agent's words`, async () => {
    const failures = changeFailures(await buildWorld({ plant: PLANTS.agentText }));
    expect(failures.join('\n')).toContain(`holds the agent's words "${CANARY}"`);
  }, 10 * MIN);

  it(`${AC1} (wrong program) ${PLANTS.model}: sentences written by a headless agent call fail, naming the call`, async () => {
    const failures = modelCalls(await buildWorld({ plant: PLANTS.model }));
    expect(failures.join('\n')).toMatch(/a model call while the sentences were made and read: `(claude .*(-p|--print)|codex e(xec)?)\b/);
  }, 10 * MIN);

  it(`${AC1} (wrong program) ${PLANTS.noItemSentence}: an open item shown with no sentence fails, naming the item`, async () => {
    const failures = openItemFailures(await buildWorld({ plant: PLANTS.noItemSentence }));
    expect(failures.join('\n')).toContain(`the open item "${ITEM}" of claim:`);
    expect(failures.join('\n'), 'the plant lists the item with its text and leaves out its sentence').toContain('shows no plain sentence');
  }, 10 * MIN);
});
