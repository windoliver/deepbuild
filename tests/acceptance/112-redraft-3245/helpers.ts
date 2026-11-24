// #112's helpers, reused as they are, with the fake judge and agent #3245's reading of an output needs (REDRAFT.md): the
// judge answers the eval's first request, the control, and an agent's work is in its changes, never in its reply.
import { expect } from 'vitest';
import {
  evalModule, fakeLauncher as original, plainEnv,
  type EvalReport, type EvalWorld, type Fake, type JudgeRequest, type ReplayPlan, type ReplayTask, type Script,
} from '../112/helpers.ts';

export * from '../112/helpers.ts';
/** #112's fake, with the controls its judge was sent, apart from the agents' work in `judged`. */
export type Judging = Fake & { controls: JudgeRequest[] };
export function fakeLauncher(tasks: ReplayTask[], script: Script, options: { inspect?: boolean } = {}): Judging {
  const fake = original(tasks, script, options);
  const { work, judge } = fake.launcher;
  const controls: JudgeRequest[] = [];
  fake.launcher.work = async (run) => {
    const result = await work(run);
    return result.ok ? { ...result, result: 'Done.' } : result;
  };
  fake.launcher.judge = async (request) => {
    // The control is the package's own request, sent before any agent: it holds no task's words. Of its two outputs
    // the change is the one a git diff shows.
    if (fake.views.length || tasks.some((t) => request.prompt.includes(t.prompt))) return judge(request);
    controls.push(structuredClone(request));
    return request.outputs.map((o) => ({ label: o.label, score: /^(?:diff --git |@@ |\+)/m.test(o.text) ? 0.9 : 0.1 }));
  };
  return Object.assign(fake, { controls });
}
/** Runs the eval on the fake, and fails on anything the fake saw go wrong. */
export async function runOnFake(w: EvalWorld, plan: ReplayPlan, tasks: ReplayTask[], script: Script, inspect = false): Promise<{ report: EvalReport; fake: Judging }> {
  const ev = await evalModule();
  const fake = fakeLauncher(tasks, script, { inspect });
  const report = await ev.runEval({ plan, tasks, root: w.root, env: plainEnv(w.home), launcher: fake.launcher });
  expect(report && typeof report === 'object' && report.after && report.before, 'runEval resolves with a report holding after and before').toBeTruthy();
  return { report, fake };
}
