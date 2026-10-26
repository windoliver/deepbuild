// Done when: a prediction that disagrees with its run shows up as a contradiction.
// (Added Oct 9: `deep_claim` records what the agent expects each check to show before it runs; a run that disagrees
// is reported as a contradiction. Design: Predictions first.)
// The worktree's spec has two checks whose command fails. The agent claims at its commit, predicting unit passes and
// lint fails, then runs both; unit's run disagrees with its prediction and lint's agrees.

import { afterAll, expect, test } from 'vitest';
import { agentWorld, callTool, cleanup, eventMatching, sleep, ulid, valueOf, type Line } from './helpers.ts';

afterAll(cleanup, 30_000);

/** Every element of every `contradictions` list anywhere in a value. */
function contradictions(value: unknown, into: Line[] = []): Line[] {
  if (Array.isArray(value)) for (const v of value) contradictions(v, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'contradictions' && Array.isArray(v)) into.push(...(v as Line[]));
      else contradictions(v, into);
    }
  }
  return into;
}

test('#26.done-when a prediction deep_claim recorded that its run disagrees with shows in deep_status as a contradiction; one it agrees with doesn\'t', async () => {
  const { agent, hub, wt } = await agentWorld();
  const made = valueOf(await callTool(agent, 'deep_claim', {
    task_ref: `task:${ulid()}`, attempt: 1, commit: wt.commit, scope: 'session',
    predictions: [{ check: 'unit', expects: 'passed' }, { check: 'lint', expects: 'failed' }],
  }), 'deep_claim with its predictions');
  const claim = typeof made?.claim === 'string' ? made.claim : `claim:${made?.event}`;
  expect(claim, `deep_claim names the claim it recorded: ${JSON.stringify(made)}`).toMatch(/^claim:[0-9A-Za-z]+$/);

  const runs: Record<string, string> = {};
  for (const check of ['unit', 'lint']) {
    const started = valueOf(await callTool(agent, 'deep_run', { check, claim }), `deep_run of ${check} for ${claim}`);
    expect(started?.run, `deep_run names the run it started for ${check}: ${JSON.stringify(started)}`).toMatch(/^run:[0-9A-Za-z]+$/);
    runs[check] = started.run as string;
  }
  for (const [check, run] of Object.entries(runs)) {
    const finished = await eventMatching(hub, (e) => e.kind === 'run.finished' && e.data?.run === run, 120_000);
    expect(finished?.data?.outcome, `BLOCKED unless ${check}'s run (${run}), whose command is false, finishes failed`).toBe('failed');
  }

  let seen: Line[] = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    seen = contradictions(valueOf(await callTool(agent, 'deep_status', {}), 'deep_status after the runs'));
    if (seen.some((c) => c.check === 'unit')) break;
    await sleep(500);
  }
  expect(seen.filter((c) => c.check === 'unit').map((c) => ({ check: c.check, run: c.run, predicted: c.predicted, outcome: c.outcome })),
    `deep_status shows unit's run ${runs.unit} as a contradiction of the prediction that it passes`).toContainEqual({ check: 'unit', run: runs.unit, predicted: 'passed', outcome: 'failed' });
  expect(seen.filter((c) => c.check === 'lint' && c.late !== true), `lint's run ${runs.lint} agrees with its prediction, so it is no contradiction`).toEqual([]);
}, 300_000);
