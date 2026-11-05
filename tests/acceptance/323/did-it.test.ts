// #323 AC10: a task's "I did it" re-runs its check (design: Tasks only you can do, '"I did it" re-runs that check, so
// a claim never passes on your word, and a check that still fails sends the task back with what's still missing';
// Tasks close themselves, "A task closes when its check passes, so you never type 'done'").
//
// The repo's spec has a second check, `ready`, a node:test test that passes only once the speech model's license is
// accepted (vendor/license-accepted exists), and its done claim needs both. A recorded Claude Code session makes its
// definition and the unit test pass, then raises a task for you through its own `deep mcp` (deep_ask, kind unblock,
// naming `ready`). You answer "I did it" without doing it: the gate re-runs `ready`, which still fails, and the task
// comes back to you with what's missing; the session's stop is not passed. Then you accept the license and answer
// again: `ready` passes and the task closes.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  AC10, FIX, FLAG, answer, asksRaised, begin, cleanup, draft, inbox, lastPos, listed, makeWorld, must, settle, shown, startHub, strings, taskVerdicts,
  judgedAfter, type Ev, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PROMPT = 'make the auth middleware reject expired tokens';
const SPEC = 'claims:\n  done:\n    checks: [unit, ready]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n  ready: { type: command, run: "node --test tests/ready.test.js", min_tests: 1 }\n';
const READY_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst fs = require('node:fs');\ntest('the speech model license is accepted', () => {\n  assert.ok(fs.existsSync('vendor/license-accepted'), 'the speech model license is not accepted yet');\n});\n";
const TASK = {
  kind: 'unblock', question: "Accept the speech model's license on the vendor's site", options: null, recommended: null,
  steps: ["Open the speech model's page on the vendor's site", 'Accept its license', 'Save the acceptance as vendor/license-accepted in the repo'],
  where: 'the vendor site, in your browser', why: 'The voice tests need the speech model, which needs its license accepted', check: 'ready', thread: null, subject: null,
};

/** The runs of the spec's `ready` check started after `since`, each with its finish. */
const readyRuns = (events: readonly Ev[], since: number) => events.filter((e) => e.kind === 'run.started' && e.log_pos > since && /(^|[#:])ready$/.test(String(e.data.check)))
  .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
/** Your open unblock tasks in the inbox (`inbox.read`), as `deep inbox` lists them. */
const openTasks = async (hub: Parameters<typeof inbox>[0]): Promise<Line[]> => (await inbox(hub)).filter((r) => r.kind === 'unblock' && r.status !== 'closed');

describe(`${AC10} a task's "I did it" re-runs its check`, () => {
  it(`${AC10} "I did it" with the license not accepted re-runs \`ready\`, which fails, so the task comes back with what's missing and the claim doesn't pass; after you accept it, "I did it" re-runs \`ready\`, which passes, and the task closes`, async () => {
    const w = await makeWorld({ drafts: [draft(PROMPT)], spec: SPEC, files: { 'tests/ready.test.js': READY_TEST } });
    const hub = await startHub(w);
    const { s, ref } = await begin(w, hub, w.repos.repo!, PROMPT, AC10);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    const raised = await lastPos(hub);
    const asking = s.tool('deep_ask', TASK, 120_000);
    let events = await settle(hub, (all) => asksRaised(all, raised).some((a) => a.data.kind === 'unblock'), 30_000);
    const task = asksRaised(events, raised).find((a) => a.data.kind === 'unblock');
    must(task !== undefined, `BLOCKED: ${AC10} the session's deep_ask must raise its unblock task naming \`ready\`: ${listed(asksRaised(events, raised))}`);

    // "I did it", with nothing done.
    const said = await lastPos(hub);
    const r = await answer(w, `ask:${task!.id}`, 'done');
    must(r.code === 0, `${AC10} your "I did it" through deep inbox answer must count, exit 0: ${shown(r)}`);
    await asking.catch(() => undefined);
    events = await settle(hub, (all) => readyRuns(all, said).some((x) => x.finished !== undefined), 60_000);
    const rerun = readyRuns(events, said);
    must(rerun.length > 0, `${AC10} "I did it" re-runs the task's check, \`ready\`: no run of it started after your answer; runs since: ${listed(events.filter((e) => e.log_pos > said && e.kind === 'run.started'))}`);
    must(rerun[0]!.finished?.data.outcome === 'failed', `${AC10} \`ready\` still fails (vendor/license-accepted doesn't exist): ${JSON.stringify(rerun[0]!.finished?.data ?? 'no run.finished')}`);
    const back = await settle(hub, () => false, 2000).then(() => openTasks(hub));
    must(back.length > 0, `${AC10} a check that still fails returns the task to you: no unblock task of yours is open after the failing re-run: ${JSON.stringify(await inbox(hub)).slice(0, 800)}`);
    const missing = strings(back).join('\n');
    must(/\bready\b/.test(missing) && /license is (not )?accepted/i.test(missing), `${AC10} the returned task says what's missing: the check \`ready\` and its failure ("the speech model license is not accepted yet"): ${JSON.stringify(back).slice(0, 800)}`);

    const stopAt = await lastPos(hub);
    await s.stop("You accepted the license, so everything passes now.");
    const judged = await judgedAfter(hub, ref, stopAt);
    const v = taskVerdicts(judged, ref, stopAt).at(-1);
    must(v?.data.outcome !== 'PASS', `${AC10} the claim never passes on "I did it" alone: \`ready\` still fails, and the verdict is ${JSON.stringify(v?.data.outcome ?? 'none')}`);

    // You accept the license, then say "I did it" again.
    mkdirSync(join(w.repos.repo!, 'vendor'), { recursive: true });
    writeFileSync(join(w.repos.repo!, 'vendor', 'license-accepted'), 'accepted 2026-11-03\n');
    const again = await lastPos(hub);
    const r2 = await answer(w, String(back[0]!.ask), 'done');
    must(r2.code === 0, `${AC10} your second "I did it" must count, exit 0: ${shown(r2)}`);
    events = await settle(hub, (all) => readyRuns(all, again).some((x) => x.finished !== undefined), 60_000);
    must(readyRuns(events, again).some((x) => x.finished?.data.outcome === 'passed'), `${AC10} the second "I did it" re-runs \`ready\`, which passes now: ${JSON.stringify(readyRuns(events, again).map((x) => x.finished?.data ?? x.started.data))}`);
    await settle(hub, () => false, 2000);
    must(!(await openTasks(hub)).some((t) => t.ask === back[0]!.ask), `${AC10} a task closes when its check passes: ${String(back[0]!.ask)} is still open`);
  }, 600_000);
});
