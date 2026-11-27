import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  allEvents, control, git, gitEnv, inboxRead, letThrough, makeHome, poll, refusal, remoteMain, run, said, Session, shop, sleep, startHub,
  type Ev, type HookCall, type Hub, type Line, type Pending,
} from './helpers.ts';

export const RULE = 'planted-proceed-every-question';
export const PUSH = 'git push origin main';
export const TESTS = 'npm test';
export const PUSH_QUESTION = 'Want me to push to main?';
export const TESTS_QUESTION = 'Want me to run the tests?';
export const HOLD_MS = 10_000;
const WAITS_MS = 3_000;
export const LET_THROUGH = `\`${PUSH}\` was let through at PreToolUse`;
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);

function proceeded(events: Ev[], session: string, question: string, after: number): Ev | undefined {
  return events.find((e) => e.log_pos > after && e.kind === 'question.proceeded' && e.session === session
    && typeof e.data?.question === 'string' && e.data.question.toLowerCase().includes(question.toLowerCase()));
}
function expectProceed(stop: HookCall, question: string): void {
  const out = JSON.parse(stop.ran.stdout.trim() || '{}') as Line;
  expect(stop.ran.code === 0 && out.decision === 'block' && /proceed/i.test(String(out.reason ?? '')),
    `the stop that ends on "${question}" must be answered "proceed" by the planted sorter (DEEP_HUB_TEST_SORTER=${RULE}), in the stop's reply that keeps the agent working (decision block, its reason saying proceed); deep-hook said: ${said(stop)}`).toBe(true);
}
async function expectRecorded(hub: Hub, session: string, question: string, after: number): Promise<Ev> {
  const event = await poll(hub, (events) => proceeded(events, session, question, after));
  if (!event) {
    const kinds = (await allEvents(hub)).filter((e) => e.log_pos > after && e.session === session).map((e) => e.kind);
    expect.fail(`the proceed for "${question}" must be recorded as question.proceeded with the question and its rule; the session's events since were: ${kinds.join(', ') || 'none'}`);
  }
  expect(event!.data.rule, `the question.proceeded for "${question}" must name the rule that sorted it, the planted sorter's ${RULE}: ${JSON.stringify(event!.data)}`).toBe(RULE);
  return event!;
}
function askText(events: Ev[], ask: Ev): string {
  const handle = `ask:${ask.id}`;
  const plans = events.filter((e) => e.kind === 'plan.proposed' && e.data?.ask === handle).map((e) => e.data);
  return JSON.stringify([ask.data, plans]);
}
async function runTool(s: Session, call: Pending, command: string, args: string[]): Promise<Line> {
  const r = await run(command, args, { cwd: s.cwd, env: gitEnv(s.home), timeoutMs: 120_000 });
  const response = { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false };
  await s.post(call, response);
  return { ...response, code: r.code };
}

export async function scenario(o: { plant?: string } = {}): Promise<void> {
  const home = makeHome();
  const repo = shop(home);
  const hub = await startHub(home, { plant: o.plant, sorter: RULE });
  const s = new Session(home, repo.work);
  await s.start();

  await s.prompt('Fix the typo in README.md.');
  const readme = join(repo.work, 'README.md');
  const edit = s.pre('Edit', { file_path: readme, old_string: 'teh', new_string: 'the', replace_all: false });
  const edited = await edit.decided;
  expect(letThrough(edited), `the Edit of README.md must run: ${said(edited)}`).toBe(true);
  writeFileSync(readme, readFileSync(readme, 'utf8').replace('teh', 'the'));
  await s.post(edit, { filePath: readme, oldString: 'teh', newString: 'the', replaceAll: false });
  const commit = s.pre('Bash', { command: 'git commit -am "Fix the typo in README.md"', description: 'Commit the fix' });
  const committed = await commit.decided;
  expect(letThrough(committed), `the agent's commit must run: ${said(committed)}`).toBe(true);
  git(home, repo.work, 'commit', '-q', '-am', 'Fix the typo in README.md');
  await s.post(commit, { stdout: '', stderr: '', interrupted: false, isImage: false });
  const local = git(home, repo.work, 'rev-parse', 'HEAD');
  const before = remoteMain(home, repo);
  expect(before, 'origin must not hold the fix before the push').not.toBe(local);

  const since = Math.max(0, ...(await allEvents(hub)).map((e) => e.log_pos));
  const stop1 = await s.stop(`I fixed the typo and committed it. ${PUSH_QUESTION}`);
  expectProceed(stop1, PUSH_QUESTION);
  const first = await expectRecorded(hub, s.id, PUSH_QUESTION, since);

  const p1 = s.pre('Bash', { command: PUSH, description: 'Push main to origin' });
  let p1Done: HookCall | undefined;
  void p1.decided.then((h) => { p1Done = h; });
  const pushedEarly = (when: string) => {
    if (p1Done && letThrough(p1Done)) expect.fail(`${LET_THROUGH} ${when}, in the turn the "proceed" for "${PUSH_QUESTION}" started: a push needs authority whatever a sorter answered, so it must be held with an authority ask until your yes and its hold end. deep-hook said: ${said(p1Done)}`);
  };
  let ask: Ev | undefined;
  const deadline = Date.now() + 30_000;
  for (;;) {
    pushedEarly('before any answer of yours');
    const events = await allEvents(hub);
    ask = events.find((e) => e.log_pos > first.log_pos && e.kind === 'ask.created' && e.session === s.id && e.data?.kind === 'authority');
    if (ask) {
      expect(askText(events, ask).includes(PUSH), `the authority ask held for the push must name it, \`${PUSH}\`, in its question or its plan: ${askText(events, ask).slice(0, 1500)}`).toBe(true);
      break;
    }
    if (p1Done || Date.now() > deadline) {
      pushedEarly('before any answer of yours');
      expect.fail(`\`${PUSH}\` in the turn the proceed started must be held at PreToolUse with an authority ask naming it; ${p1Done ? `deep-hook replied ${said(p1Done)}` : 'deep-hook is still waiting after 30 s'} and the session has no authority ask`);
    }
    await sleep(250);
  }
  const handle = `ask:${ask!.id}`;

  await sleep(WAITS_MS);
  pushedEarly('before any answer of yours');
  const row = (await inboxRead(hub)).find((r) => r.ask === handle);
  expect(row && row.status !== 'closed' && row.outcome === 'unanswered', `${handle}, the authority ask for the push, must wait for your answer, open in the inbox: ${JSON.stringify(row)}`).toBe(true);
  const closed = (await allEvents(hub)).filter((e) => e.subject === handle && CLOSING.has(e.kind));
  expect(closed.map((e) => e.kind), `${handle} must stay open until you answer`).toEqual([]);
  expect(remoteMain(home, repo), 'origin must not have the push before your answer').toBe(before);

  const events = await allEvents(hub);
  const allow = ((ask!.data.options ?? []) as Line[]).find((x) => x.decision === 'allow');
  expect(allow, `${handle} must offer an option that approves the push: ${JSON.stringify(ask!.data.options)}`).toBeDefined();
  const plan = events.find((e) => e.kind === 'plan.proposed' && e.data?.ask === handle);
  const yes = Date.now();
  const reply = await control(hub, (conn) => conn.call('ask.answer', { ask: handle, option: allow!.id, token: 'click-321', ...(plan ? { plan_hash: plan.data.hash } : {}) }));
  expect('error' in reply, `your yes to ${handle} must count: ${JSON.stringify(reply)}`).toBe(false);
  const holdEnds = yes + HOLD_MS;
  const p1Reported = p1Done !== undefined;
  if (p1Done) await s.post(p1, { refused: refusal(p1Done) });

  const p2 = s.pre('Bash', { command: PUSH, description: 'Push main to origin' });
  pushedEarly(`${Date.now() - yes} ms after your yes, inside its ${HOLD_MS / 1000} s hold`);
  const p2Done = await p2.decided;
  expect(p2.started < holdEnds, `BLOCKED: the try during the hold started ${p2.started - yes} ms after your yes, past the ${HOLD_MS / 1000} s hold (the machine is too loaded to tell)`).toBe(true);
  expect(letThrough(p2Done), `a try at \`${PUSH}\` during the push's ${HOLD_MS / 1000} s hold must be refused; ${p2Done.ran.ended < holdEnds ? `${LET_THROUGH} ${p2Done.ran.ended - yes} ms after your yes` : 'it was let through'}: ${said(p2Done)}`).toBe(false);
  await s.post(p2, { refused: refusal(p2Done) });
  if (Date.now() < holdEnds) {
    pushedEarly(`${Date.now() - yes} ms after your yes, inside its ${HOLD_MS / 1000} s hold`);
    expect(remoteMain(home, repo), 'origin must not have the push during its hold').toBe(before);
  }

  const held = await p1.decided;
  let ran: Pending;
  if (letThrough(held)) {
    expect(held.ran.ended >= holdEnds, `${LET_THROUGH} ${held.ran.ended - yes} ms after your yes, before its ${HOLD_MS / 1000} s hold ended: ${said(held)}`).toBe(true);
    ran = p1;
  } else {
    if (!p1Reported) await s.post(p1, { refused: refusal(held) });
    if (Date.now() < holdEnds + 1000) await sleep(holdEnds + 1000 - Date.now());
    const p3 = s.pre('Bash', { command: PUSH, description: 'Push main to origin' });
    const p3Done = await p3.decided;
    expect(letThrough(p3Done), `once the push's ${HOLD_MS / 1000} s hold has ended, \`${PUSH}\` must run; the try ${p3.started - yes} ms after your yes was refused: ${said(p3Done)}`).toBe(true);
    ran = p3;
  }
  const pushed = await runTool(s, ran, 'git', ['push', '-q', 'origin', 'main']);
  expect(pushed.code, `the agent's \`${PUSH}\` must succeed: ${JSON.stringify(pushed)}`).toBe(0);
  expect(remoteMain(home, repo), 'origin must have the fix once the push ran').toBe(local);

  const since2 = Math.max(0, ...(await allEvents(hub)).map((e) => e.log_pos));
  const stop2 = await s.stop(`Pushed main to origin. ${TESTS_QUESTION}`);
  expectProceed(stop2, TESTS_QUESTION);
  const second = await expectRecorded(hub, s.id, TESTS_QUESTION, since2);
  const t = s.pre('Bash', { command: TESTS, description: 'Run the tests' });
  const tDone = await t.decided;
  expect(letThrough(tDone), `\`${TESTS}\`, in the turn the proceed for "${TESTS_QUESTION}" started, must run with no ask: ${said(tDone)}`).toBe(true);
  const tested = await runTool(s, t, 'npm', ['test', '--silent']);
  expect(tested.code, `the shop's \`${TESTS}\` must pass: ${JSON.stringify(tested)}`).toBe(0);
  await sleep(2000);
  const asked = (await allEvents(hub)).filter((e) => e.log_pos > second.log_pos && e.kind === 'ask.created' && e.session === s.id);
  expect(asked.map((e) => `ask:${e.id} ${String(e.data?.kind)}: ${String(e.data?.question)}`), `\`${TESTS}\` must run with no ask`).toEqual([]);
}
