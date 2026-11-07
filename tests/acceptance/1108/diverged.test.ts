// AC2: a replayed agent that calls `gh pr create`, which the original session never called, gets an error saying it
// isn't in the recording; the call is in the replay's record, and the pair reads diverged and stays in the count.
import { afterEach, describe, expect, it } from 'vitest';
import { AC2, cleanup, runsOf, shown, world, type RecordedCall } from './helpers.ts';

afterEach(cleanup);

const PROMPTS = ['Check whether PR 12 merged, then fix the cart total.', 'Check whether PR 13 merged, then fix the cart tax.', 'Check whether PR 14 merged, then fix the cart badge.'];
const CREATE = 'gh pr create --title "Fix the cart tax" --body "Rounds tax per line."';
/** Each original session asked the forge about its PR, through gh; none opened one. */
const recording = (pr: number): RecordedCall[] => [{ tool: 'Bash', input: { command: `gh pr view ${pr} --json state` }, result: '{"state":"MERGED"}' }];

describe(`AC2 ${AC2} a replayed call the original session never made gets "not in the recording", and the pair reads diverged`, () => {
  it('gh pr create, made only by the change side of one task, is refused from the recording, recorded, never sent, and its pair stays in the denominator as diverged', async () => {
    const w = await world(Object.fromEntries(PROMPTS.map((p, i) => [p, {
      steps: [
        { tool: 'Bash', input: { command: `gh pr view ${12 + i} --json state` } },
        // Only the second task's change side, whose instruction file asks for a PR, opens one.
        ...(i === 1 ? [{ tool: 'Bash', input: { command: CREATE }, when: 'Open a PR' }] : []),
      ],
    }])));
    const tasks = PROMPTS.map((p, i) => w.task(`t${i + 1}`, p, recording(12 + i)));
    const report = await w.run(w.plan(tasks.map((t) => t.id)), tasks);

    // The agent's gh pr create gets an error saying it isn't in the recording.
    const [changeRun] = runsOf(w, PROMPTS[1]!, 'change');
    const create = changeRun?.obs.calls.find((c) => c.tool === 'Bash' && String(c.input.command).startsWith('gh pr create'));
    expect.soft(create?.is_error === true && /not in the recording/i.test(create.content),
      `the replayed gh pr create returns an error saying it isn't in the recording; it got: ${shown(create)}`).toBe(true);
    // It never reaches the forge.
    expect.soft(w.forge.hits.length, `the forge fixture got ${w.forge.hits.length} requests (${w.forge.hits.map((h) => h.body).join(' | ')}): a replayed call reached the network`).toBe(0);
    // The call is in the replay's record, unanswered.
    const recorded = (report.calls ?? []).filter((c) => c.tool === 'Bash' && JSON.stringify(c.input).includes('gh pr create'));
    expect.soft(recorded.map((c) => ({ task: c.task, side: c.side, answered: c.answered })), `the replay's record (report.calls) holds the gh pr create call: ${JSON.stringify(report.calls)}`)
      .toEqual([{ task: 't2', side: 'change', answered: false }]);
    // The pair reads diverged, and the report lists the call.
    expect.soft((report.diverged ?? []).map((d) => d.task), 'the pair with a call the recording can\'t answer reads diverged; no other pair does').toEqual(['t2']);
    expect.soft(JSON.stringify(report.diverged?.[0]?.calls ?? []), 'the report lists the call that diverged').toContain('gh pr create');
    // It stays in the count as a missing pair, as #112 keeps failed pairs.
    expect.soft(report.after.n, 'the diverged pair stays in the denominator: three tasks named, three compared').toBe(3);
    expect.soft(report.after.tasks.map((t) => [t.task, t.failed]).sort(), 'the diverged pair counts as a failed pair; the others are whole')
      .toEqual([['t1', false], ['t2', true], ['t3', false]]);
    // Every recorded call, on every side, got its recorded result.
    for (const p of PROMPTS) for (const { obs } of runsOf(w, p)) {
      const view = obs.calls.find((c) => String(c.input.command).startsWith('gh pr view'));
      expect.soft(view && !view.is_error && view.content.trim() === '{"state":"MERGED"}', `a recorded gh pr view gets its recorded result; it got: ${shown(view)}`).toBe(true);
    }
  }, 180_000);
});
