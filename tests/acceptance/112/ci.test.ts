// No eval runs in hosted CI on push: the repo's own workflows start none, and the eval itself refuses to run on a
// hosted push or pull request, while a run you dispatch goes ahead (README: Readings, AC2).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC2, CUTOFF, DAY, evalModule, evalWorld, fakeLauncher, ids, makePlan, makeTasks, plainEnv, removeRoots } from './helpers.ts';

afterAll(removeRoots);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** A workflow that starts on these runs on every push to a branch or a pull request's branch. */
const ON_PUSH = /\b(push|pull_request|pull_request_target|merge_group)\b/;
/** What starts an eval, or the lanes that would: its package, its entry, its live opt-in, this suite, the preflight. */
const RUNS_EVAL = /config-eval|runEval|DEEP_EVAL_LIVE|tests\/acceptance\/112|preflight|release:check|lanes\.mjs/;

describe(`AC2 ${AC2} no eval runs in hosted CI on push`, () => {
  it(`AC2 ${AC2} no workflow that starts on a push or pull request runs the eval, and the eval refuses a hosted push or pull request; a dispatched run goes ahead`, async () => {
    const dir = join(ROOT, '.github', 'workflows');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      if (!ON_PUSH.test(text)) continue;
      expect(RUNS_EVAL.exec(text)?.[0], `.github/workflows/${file} starts on a push or pull request and runs the eval or a lane that does`).toBeUndefined();
    }

    const ev = await evalModule();
    const w = evalWorld();
    const tasks = makeTasks(w.repo, ids('t', 2).map((id, i) => ({ id, at: CUTOFF + (i + 1) * DAY })));
    const plan = makePlan({ tasks: ['t01', 't02'], repeats: 1 });
    const hosted = { ...plainEnv(w.home), CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'checks', GITHUB_RUN_ID: '1' };
    for (const event of ['push', 'pull_request']) {
      const fake = fakeLauncher(tasks, () => ({ quality: 0.5 }));
      const report = await ev.runEval({ plan, tasks, root: w.root, env: { ...hosted, GITHUB_EVENT_NAME: event }, launcher: fake.launcher });
      expect(report.after.outcome, `hosted CI on ${event} (${report.after.reason})`).toBe('refused');
      expect(fake.views.length + fake.judged.length, `hosted CI on ${event}: no agent or judge started`).toBe(0);
    }
    const fake = fakeLauncher(tasks, (_t, _s, k) => (k < 1 ? { quality: 0.5 } : undefined));
    const report = await ev.runEval({ plan, tasks, root: w.root, env: { ...hosted, GITHUB_EVENT_NAME: 'workflow_dispatch' }, launcher: fake.launcher });
    expect(report.after.outcome, `a run you dispatch (${report.after.reason})`).not.toBe('refused');
    expect(fake.views.length, 'a run you dispatch replays its tasks: 2 tasks × 2 sides × 1 repeat').toBe(4);
  }, 120_000);
});
