// AC4: a call equal to a recorded one except for a timestamp and a temporary path gets the recorded result. Inputs
// normalize as open items normalize error text (`errorShape` in packages/gate/src/open.ts): temporary paths, process
// IDs and timestamps become placeholders. A call that differs in substance still isn't in the recording.
import { afterEach, describe, expect, it } from 'vitest';
import { AC4, cleanup, runsOf, shown, world } from './helpers.ts';

afterEach(cleanup);

const SAME = 'Tell #builds that build 512 finished.';
const OTHER = 'Tell #builds that build 513 finished.';
/** The original session's post, at its time, naming its temp folder; and what the chat server answered. */
const RECORDED_INPUT = { channel: '#builds', text: 'Build 512 finished at 2026-10-05T09:14:03Z; log at /tmp/build-7f3a9c/out.log' };
const RECORDED = '{"ok":true,"channel":"C0FAKE02","ts":"1759655643.000200"}';

describe(`AC4 ${AC4} a call equal to a recorded one but for a timestamp and a temporary path gets the recorded result`, () => {
  it('the replayed post, at another time and naming another temp folder, gets the recorded result; one about another build reads "not in the recording"', async () => {
    const w = await world({
      // The replay's agent posts now, naming a fresh temp folder: `{{now}}` and `{{tmp}}` (README).
      [SAME]: { steps: [{ tool: 'mcp__chat__post_message', input: { channel: '#builds', text: 'Build 512 finished at {{now}}; log at {{tmp}}/out.log' } }] },
      [OTHER]: { steps: [{ tool: 'mcp__chat__post_message', input: { channel: '#builds', text: 'Build 513 finished at {{now}}; log at {{tmp}}/out.log' } }] },
    });
    const recording = [{ tool: 'mcp__chat__post_message', input: RECORDED_INPUT, result: RECORDED }];
    const tasks = [w.task('t1', SAME, recording), w.task('t2', OTHER, recording)];
    const report = await w.run(w.plan(['t1', 't2']), tasks);

    for (const { obs } of runsOf(w, SAME)) {
      const post = obs.calls.find((c) => c.tool === 'mcp__chat__post_message');
      expect.soft(String(post?.input.text), 'the replayed post differs from the recorded one in its time and temp folder').not.toBe(RECORDED_INPUT.text);
      expect.soft(post && !post.is_error && post.content.trim() === RECORDED,
        `a call equal to the recorded one but for a timestamp and a temporary path gets the recorded result ${RECORDED}; it got: ${shown(post)}`).toBe(true);
    }
    for (const { obs } of runsOf(w, OTHER)) {
      const post = obs.calls.find((c) => c.tool === 'mcp__chat__post_message');
      expect.soft(post?.is_error === true && /not in the recording/i.test(post.content), `a post about another build isn't in the recording; it got: ${shown(post)}`).toBe(true);
    }
    expect.soft(runsOf(w, SAME).length + runsOf(w, OTHER).length, 'all four runs reached their model endpoint').toBe(4);
    expect.soft(w.chat.hits.length, `your chat server at ${w.chat.url}/mcp got ${w.chat.hits.length} requests: a replayed post was sent`).toBe(0);
    expect.soft((report.calls ?? []).map((c) => [c.task, c.side, c.answered]).sort(), `the replay's record (report.calls): ${JSON.stringify(report.calls)}`)
      .toEqual([['t1', 'base', true], ['t1', 'change', true], ['t2', 'base', false], ['t2', 'change', false]]);
    expect.soft((report.diverged ?? []).map((d) => d.task), 'only the pair about another build reads diverged').toEqual(['t2']);
    expect.soft(report.after.n, 'both pairs stay in the count').toBe(2);
  }, 120_000);
});
