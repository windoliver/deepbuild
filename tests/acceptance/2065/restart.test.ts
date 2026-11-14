// #2065: real hub processes, record, answers and gh pr create's hook gate. No component mocks.
// Reuse #325's checks/worlds/transcripts and #16's socket/process helpers; no external gh call.
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanup as cleanupHubs, hookRequest, own, startHub as launch, stopHub } from '../16/helpers.ts';
import {
  CHECKS, FIX, FLAG, Session as TranscriptSession, allEvents, answered, asksRaised, childEnv, claimsOf, cleanup,
  control, decision, draftFor, inbox, lastPos, makeWorld, parseObject, replyText, sentBack, settle, stallDecisions,
  startOnItem, taskVerdicts, workItem, type Ev, type Hub, type Line, type Ran, type World,
} from '../325/helpers.ts';
import { bump, CRITERIA, prCreate, SAME_OPEN, SWITCH_SPEC } from '../325/scenarios.ts';
import { git } from '../325/helpers.ts';

const AC1 = 'AC1 #2065.d984fab2';
const AC2 = 'AC2 #2065.5b02fc15';
const AC3 = 'AC3 #2065.e0ad4590';
const AC4 = 'AC4 #2065.4d4ad2b8';
const AC5 = 'AC5 #2065.ae196407';
const AC6 = 'AC6 #2065.f0caaac6';
const SWITCH = 'reject_expired';
const WAIT = 20_000;

afterEach(async () => { await cleanupHubs(); await cleanup(); });

// Drive the documented hook socket directly: this issue tests the hub's gate, not deep-hook's 50 ms
// fail-open timer (which dropped Stop/PreToolUse on this machine under load). No retry of a hook.
class Session extends TranscriptSession {
  private readonly peer = fork(fileURLToPath(new URL('./hook-peer.mjs', import.meta.url)), [],
    { env: childEnv(this.w.home), stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  constructor(w: World, cwd = w.repo) { super(w, cwd); own(this.peer.pid); }
  override async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const at = performance.now();
    const request = hookRequest({ agent: 'claude-code', id: this.id, cwd: this.cwd, transcript: this.transcript }, event,
      { ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields });
    const response = await new Promise<Line>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`BLOCKED setup: no ${event} reply within ${timeoutMs} ms`)), timeoutMs);
      this.peer.once('message', (message: Line) => { clearTimeout(timer); resolve(message); });
      this.peer.send({ id: request.id, socket: join(this.w.root, 'hub.sock'), request });
    });
    if (!response.result) throw Error(`BLOCKED setup: ${event} had no hub reply: ${JSON.stringify(response)}`);
    const r: Ran = { code: response.result.exit, stdout: response.result.stdout, stderr: response.result.stderr,
      signal: null, timedOut: false, ms: performance.now() - at, ended: Date.now() };
    const context = parseObject(r.stdout.trim())?.hookSpecificOutput?.additionalContext;
    if (typeof context === 'string' && context) this.entry({ type: 'attachment', promptId: this.prompt,
      attachment: { type: 'hook_additional_context', content: [context], hookName: event, toolUseID: fields.tool_use_id ?? event, hookEvent: event } });
    if (event === 'Stop' && sentBack(r)) this.entry({ type: 'user', promptId: this.prompt,
      message: { role: 'user', content: `Stop hook feedback:\n${replyText(r)}` } });
    return r;
  }
}

async function stalled(n: number, who: string) {
  const w = makeWorld({
    drafts: [draftFor(n, [{ text: CRITERIA.retry, check: CHECKS.retry }, { text: CRITERIA.audit, check: CHECKS.audit }])],
    readings: [workItem(n, 'Retry dropped connections and log rejected tokens', [CRITERIA.retry, CRITERIA.audit])],
  });
  const hub = await start(w);
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, who);
  await s.edit(FIX.file, FIX.from, FIX.to); // Spec passes; both drafted requirements remain genuinely failing.
  for (let round = 0; round < 3; round++) {
    if (round) await bump(s);
    const since = await lastPos(hub);
    const r = await s.stop(SAME_OPEN);
    const judged = await settle(hub, (all) => taskVerdicts(all, ref, since).some((v) =>
      v.data.requirements?.length === 2 && v.data.requirements.every((q: { outcome: string }) => q.outcome === 'FAIL')), WAIT);
    expect(taskVerdicts(judged, ref, since).some((v) => v.data.requirements?.length === 2 &&
      v.data.requirements.every((q: { outcome: string }) => q.outcome === 'FAIL')),
    `${who} setup: both real checks failed for ${ref}: ${JSON.stringify(taskVerdicts(judged, ref, since))}`).toBe(true);
    if (!round) expect(sentBack(r), `${who} setup: first failing stop is sent back`).toBe(true);
    if (stallDecisions(judged).length) break;
  }
  const events = await settle(hub, (all) => stallDecisions(all).length > 0, WAIT);
  const asks = stallDecisions(events);
  expect(asks.length, `${who} setup: one real stalled-claim ask for ${ref}`).toBe(1);
  return { w, hub, s, ref, decision: asks[0]! };
}

const openInbox = async (hub: Hub) => (await inbox(hub)).filter((a) => a.status === 'open' || a.status === 'later');

async function start(w: World): Promise<Hub> {
  const h = await launch({ home: w.home, env: {
    ...childEnv(w.home), DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_PRICES: w.prices, DEEP_HUB_TEST_CLOCK_STEPS: '1',
    DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9', DEEP_HUB_TEST_STOP_HOLD_MS: '30000',
  } }, 120_000);
  return { pid: h.pid, socket: h.socket, home: h.home, root: h.root, child: h.proc.child,
    exit: h.proc.exit.then(() => undefined), plant: undefined, stderr: h.proc.stderr };
}

async function restart(w: World, h: Hub): Promise<Hub> {
  await stopHub(h, 'SIGTERM', 60_000);
  await h.exit; // The whole old process (including every map/cache and record connection) is gone.
  expect(h.child.exitCode !== null || h.child.signalCode !== null, 'setup: old hub exited').toBe(true);
  const next = await start(w);
  expect((await allEvents(next)).some((e) => e.kind === 'hub.stopped'), 'setup: restart follows a recorded clean shutdown').toBe(true);
  return next;
}

// No GitHub access: exercise PreToolUse only, the gate that decides whether gh may run.
const closes = (s: Session, n: number) => s.hook('PreToolUse', {
  tool_name: 'Bash', tool_input: { command: prCreate(`Closes #${n}`) }, tool_use_id: `toolu_${randomUUID()}`,
});
const drafts = (events: Ev[], ask: Ev) => events.filter((e) => e.kind === 'issue.drafted' && e.subject === `ask:${ask.id}`);
const switchAsks = (events: Ev[]) => asksRaised(events, 0).filter((a) =>
  String(a.data.question).includes(SWITCH) && a.data.options.some((o: { id: string }) => o.id === 'stay-off'));

it(`${AC1} stalled claim's ask answered split after a hub restart records one issue.drafted listing the open items`, async () => {
  const { w, hub: old, decision: ask, ref } = await stalled(206501, AC1);
  const hub = await restart(w, old);
  expect((await inbox(hub)).map((a) => a.ask), `${AC1} setup: persisted ask:${ask.id} is answerable`).toContain(`ask:${ask.id}`);
  await answered(w, ask, 'split', AC1);
  const events = await settle(hub, (all) => drafts(all, ask).length > 0, WAIT);
  const found = drafts(events, ask);
  expect(found.length, `${AC1} ask:${ask.id} split after restart must record one issue.drafted for ${ref}; recorded ${found.length}`).toBe(1);
  expect(found[0]!.data.task_ref, `${AC1} ask:${ask.id} drafts its stalled task`).toBe(ref);
  expect(found[0]!.data.items.map((i: { id: string; text: string }) => ({ id: i.id, text: i.text })),
    `${AC1} ask:${ask.id} lists both open items: R1 retry and R2 audit`).toEqual([
    { id: 'R1', text: 'A dropped connection is retried' }, { id: 'R2', text: 'Each rejected token is logged' },
  ]);
}, 240_000);

it(`${AC2} accept after restart permits gh pr create saying Closes and still permits it after a second restart`, async () => {
  const n = 206502;
  const { w, hub: old, s, ref, decision: ask } = await stalled(n, AC2);
  expect(decision(await closes(s, n)), `${AC2} setup: ${ref} is unproven before accept`).toBe('deny');
  let hub = await restart(w, old);
  await answered(w, ask, 'accept', AC2);
  await s.start('resume');
  const first = await closes(s, n);
  hub = await restart(w, hub);
  await s.start('resume');
  const second = await closes(s, n);
  // Read both before asserting: the base must be observed refusing both, not stop at the first refusal.
  expect.soft(decision(first), `${AC2} task ${ref}, ask:${ask.id}: accept after restart must let Closes run; ${replyText(first)}`).toBe('allow');
  expect.soft(decision(second), `${AC2} task ${ref}: Closes must still run after the second restart; ${replyText(second)}`).toBe('allow');
}, 240_000);

async function switchWorld(n: number, secondTree = false) {
  const numbers = secondTree ? [n, n + 1] : [n];
  const w = makeWorld({ spec: SWITCH_SPEC,
    files: { 'config/flags.json': '{}\n', 'config/deployed.json': '{"reject_expired":false}\n' },
    drafts: numbers.map((id) => draftFor(id, [{ text: CRITERIA.expired, check: CHECKS.expired }])),
    readings: numbers.map((id) => workItem(id, 'Reject expired tokens behind a switch', [CRITERIA.expired])),
  });
  const hub = await start(w);
  const sessions: Session[] = [];
  for (const [i, id] of numbers.entries()) {
    const cwd = i === 0 ? w.repo : join(w.tmp, 'second-worktree');
    if (i) {
      git(w.tmp, w.repo, ['worktree', 'add', '-q', '-b', 'second', cwd, w.base]);
      const config = JSON.parse(readFileSync(join(w.home, '.claude.json'), 'utf8'));
      config.projects[cwd] = { allowedTools: [], hasTrustDialogAccepted: true };
      writeFileSync(join(w.home, '.claude.json'), JSON.stringify(config));
    }
    const s = new Session(w, cwd);
    await startOnItem(hub, s, id, 'setup: switch task');
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    await s.edit('config/flags.json', '{}', '{"reject_expired":false}');
    const green = await s.stop('Expired tokens are rejected behind reject_expired.');
    expect(sentBack(green), `setup: switch task #${id} passes its checks: ${replyText(green)}`).toBe(false);
    sessions.push(s);
  }
  const refused = await closes(sessions[0]!, n);
  expect(decision(refused), `setup: ${SWITCH} off must initially refuse Closes`).toBe('deny');
  expect(replyText(refused), `setup: refusal is about ${SWITCH}, not a missing check`).toContain(SWITCH);
  const events = await settle(hub, (all) => switchAsks(all).length === 1, WAIT);
  const asks = switchAsks(events);
  expect(asks.length, `setup: one actual ${SWITCH} ask`).toBe(1);
  expect((await inbox(hub)).map((a) => a.ask), `setup: ${SWITCH} ask is in the inbox`).toContain(`ask:${asks[0]!.id}`);
  return { w, hub, sessions, ask: asks[0]! };
}

it(`${AC3} stays off survives restart: Closes runs with no second reject_expired ask, in a second worktree too`, async () => {
  const n = 206503;
  const { w, hub: old, sessions, ask } = await switchWorld(n, true);
  await answered(w, ask, 'stay-off', AC3);
  expect(decision(await closes(sessions[0]!, n)), `${AC3} setup: stays off permits Closes before restart`).toBe('allow');
  // Wait for the real follow-up, so shutdown cannot race the original answer's asynchronous work.
  const saved = await settle(old, (all) => drafts(all, ask).length === 1, WAIT);
  expect(drafts(saved, ask).length, `${AC3} setup: ${SWITCH} decision completed before shutdown`).toBe(1);
  const hub = await restart(w, old);
  const attempts = [];
  for (const [i, s] of sessions.entries()) {
    await s.start('resume');
    attempts.push(await closes(s, n + i));
  }
  const asks = switchAsks(await allEvents(hub));
  for (const [i, r] of attempts.entries()) expect.soft(decision(r),
    `${AC3} switch ${SWITCH}, ${i ? 'second worktree of the same repo' : 'original worktree'}: stays off must survive restart; ${replyText(r)}`).toBe('allow');
  expect.soft(asks.map((a) => a.id), `${AC3} switch ${SWITCH}: no second ask after restart, including the second worktree; got ${asks.map((a) => `ask:${a.id}`).join(', ')}`).toEqual([ask.id]);
}, 240_000);

it(`${AC4} task sent back twice without new evidence, then restart: next claim.sent_back is round 3, not round 1`, async () => {
  const n = 2065040;
  const w = makeWorld({ drafts: [draftFor(n, [{ text: CRITERIA.retry, check: CHECKS.retry }])],
    readings: [workItem(n, 'Retry dropped connections', [CRITERIA.retry])] });
  let hub = await start(w);
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, AC4);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const rounds = (events: Ev[]) => {
    const handles = new Set(claimsOf(events, ref).map((c) => `claim:${c.id}`));
    return events.filter((e) => e.kind === 'claim.sent_back' && handles.has(e.data.claim)).map((e) => e.data.round);
  };
  // Different open-item words avoid the separate two-unchanged-stops rule; the actual check results never change.
  const words = ['a 100 ms backoff', 'a 200 ms backoff with jitter', 'the connection pool'];
  for (let i = 0; i < 2; i++) {
    await bump(s);
    const r = await s.stop(`Still open:\n- A dropped connection is retried, with ${words[i]}`);
    expect(sentBack(r), `${AC4} setup: ${ref} send-back ${i + 1}; ${replyText(r)}`).toBe(true);
  }
  expect(rounds(await allEvents(hub)), `${AC4} setup: ${ref} already sent back twice`).toEqual([1, 2]);
  hub = await restart(w, hub);
  await s.start('resume');
  await s.typed(`Continue fixing https://work.test/acme/shop/issues/${n}`);
  await bump(s);
  const r = await s.stop(`Still open:\n- A dropped connection is retried, with ${words[2]}`);
  expect(sentBack(r), `${AC4} setup: ${ref} next stop is sent back; ${replyText(r)}`).toBe(true);
  expect(rounds(await allEvents(hub)), `${AC4} task ${ref}: third send-back after restart must be recorded as round 3, never restart at round 1`).toEqual([1, 2, 3]);
}, 240_000);

it(`${AC5} planted price, one paid check locks, restart, approve budget ask: one spend.approved with asked cap $4.00`, async () => {
  const n = 206505;
  const w = makeWorld({
    drafts: [draftFor(n, [{ text: 'A live price quote is given for a valid token', check: CHECKS.live, on_base: 'passes', paid: 'live call' }])],
    readings: [workItem(n, 'Paid quote check', ['A live price quote is given for a valid token'])],
    prices: { prices: { [CHECKS.live.file]: 4 }, costs: { [CHECKS.live.file]: 4 } },
  });
  let hub = await start(w);
  const ref = await startOnItem(hub, new Session(w), n, AC5);
  const events = await settle(hub, (all) => asksRaised(all, 0).length > 0, WAIT);
  const asks = asksRaised(events, 0);
  expect(asks.length, `${AC5} setup: one budget ask for ${ref}`).toBe(1);
  const ask = asks[0]!;
  expect(ask.data.question, `${AC5} setup: ask:${ask.id} offers the independently planted cap`).toContain('$4.00');
  const since = await lastPos(hub);
  hub = await restart(w, hub);
  await answered(w, ask, 'approve', AC5);
  const after = await settle(hub, (all) => all.some((e) => e.kind === 'spend.approved' && e.log_pos > since), WAIT);
  const approvals = after.filter((e) => e.kind === 'spend.approved' && e.log_pos > since);
  expect(approvals.length, `${AC5} ask:${ask.id}: approve after restart must record one spend.approved with asked cap $4.00; recorded ${approvals.length}`).toBe(1);
  expect(approvals[0]!.data, `${AC5} ask:${ask.id} approves this issue's one run at the asked cap`).toMatchObject({ scope: { kind: 'issue', ref }, runs: 1, cap_usd: 4 });
}, 120_000);

for (const how of ['answer', 'deadline'] as const) it(`${AC6} switch ask closed on not yet by ${how}: refused Closes must not say "you're asked in your inbox"`, async () => {
  const n = how === 'answer' ? 206506 : 206507;
  const { w, hub, sessions: [s], ask } = await switchWorld(n);
  if (how === 'answer') await answered(w, ask, 'not-yet', AC6);
  else await control(hub, 'test.clock', { advance_ms: Math.max(0, ask.data.deadline - Date.now()) + 1000 });
  const kind = how === 'answer' ? 'ask.answered' : 'ask.defaulted';
  const ended = await settle(hub, (all) => all.some((e) => e.kind === kind && e.subject === `ask:${ask.id}`), WAIT);
  expect(ended.some((e) => e.kind === kind && e.subject === `ask:${ask.id}`), `${AC6} setup: ask:${ask.id} closed by ${how}`).toBe(true);
  expect(await openInbox(hub), `${AC6} setup: no open ask after not yet by ${how}`).toEqual([]);
  const r = await closes(s!, n);
  expect(decision(r), `${AC6} not yet still refuses Closes`).toBe('deny');
  const text = replyText(r);
  expect.soft(text, `${AC6} ask:${ask.id} closed by ${how}, no ask open: refusal must not say "you're asked in your inbox"; ${text}`).not.toContain("you're asked in your inbox");
  expect.soft(text, `${AC6} switch ${SWITCH}: refusal keeps the PR at Part of until the switch is on`).toMatch(/Part of/i);
  expect.soft(text, `${AC6} switch ${SWITCH}: refusal must explain it waits until the switch is on; ${text}`).toMatch(/until[^.\n]*(?:\bon\b|enabled|switched on)/i);
  expect.soft(await openInbox(hub), `${AC6} not yet by ${how} must not send you to a replacement ask`).toEqual([]);
}, 180_000);
