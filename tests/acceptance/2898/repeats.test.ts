// AC4: each tool listed idempotent, called twice with the same input, the second starting no process and adding
// nothing the first didn't; a planted deep_job that runs its tool again fails, naming the job (README).
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { KIND, TOOL_A, events as jobEvents, input, job, kindWorld } from '../1922/helpers.ts';
import {
  AC, TEST_MS, brief, callsWorld, cleanup, counts, forms, gained, installHello, lastPos, listedAs, said, t26, tableSays,
  type Ev, type Line, type Reader, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

interface Repeat {
  label: string;
  /** One call alone with a fresh input of the same shape: what one call adds. None for a tool that changes nothing. */
  calibrate?: () => Promise<t26.Outcome>;
  call: () => Promise<t26.Outcome>;
  read: Reader;
}
/**
 * The call made twice with the same input, the second sent while the first is still pending (the retry a client makes
 * of a pending call), then once more after both answered: what each added beyond what one call adds, by kind.
 */
async function repeatFailures(r: Repeat): Promise<string[]> {
  const one: Record<string, number> = {};
  if (r.calibrate) {
    const since = await lastPos(r.read);
    const o = await r.calibrate();
    expect(o.isError, `BLOCKED: ${r.label}: one call alone answers: ${brief(o.reply ?? o.value, 1200)}`).toBe(false);
    await t26.sleep(800);
    Object.assign(one, counts(await gained(r.read, since)));
  }
  const failures: string[] = [];
  const since = await lastPos(r.read);
  const pair = await Promise.all([r.call(), r.call()]);
  await t26.sleep(800);
  const added = counts(await gained(r.read, since));
  const over = Object.entries(added).filter(([kind, n]) => n > (one[kind] ?? 0));
  if (over.length) failures.push(`${r.label}: called twice with the same input, the second added ${over.map(([kind, n]) => `${n - (one[kind] ?? 0)} ${kind}`).join(', ')} beyond what one call adds (${brief(one)}); replies ${pair.map((o) => brief(o.value, 400)).join(' / ')}`);
  const again = await lastPos(r.read);
  const third = await r.call();
  await t26.sleep(800);
  const later = await gained(r.read, again);
  if (later.length) failures.push(`${r.label}: called again with the same input once both answered, it added ${said(later)}; reply ${brief(third.value, 400)}`);
  return failures;
}

/** call_action of the hello plug-in's read action through a session's deep-actions server, stamped by its PreToolUse. */
function callAction(hub: t26.Hub, s: Session, request: string): () => Promise<t26.Outcome> {
  const args = { action: 'ext.hello.greet', request, input: JSON.stringify({ name: 'Ada' }) };
  return async () => {
    await s.stand.hook(hub, 'PreToolUse', { tool_name: 'mcp__deep-actions__call_action', tool_input: args, tool_use_id: `toolu_${randomBytes(10).toString('hex')}` });
    return s.server.call('call_action', args);
  };
}

/** deep_job's run of #1922's kind on its first tool, through a deep mcp of the job world: the job named by its kind, tool and input. */
async function jobRepeat(plant?: string): Promise<{ label: string; failures: string[] }> {
  const w = await kindWorld(plant as never);
  const run = (name: string, text: string) => {
    const path = input(w, name, text);
    return async (): Promise<t26.Outcome> => {
      const o = await job(w, { op: 'run', kind: KIND, tool: TOOL_A, params: '{"case":"upper","trim":false}', inputs: [{ name: 'text', path }] });
      return { isError: o.isError, value: o.value, reply: o.value, ms: 0, protocolError: false };
    };
  };
  const label = `deep_job run ${KIND} on ${TOOL_A} of twice.txt${plant ? ` (planted ${plant})` : ''}`;
  const read: Reader = async () => (await jobEvents(w)) as unknown as Ev[];
  return { label, failures: await repeatFailures({ label, calibrate: run('once.txt', 'one call alone'), call: run('twice.txt', 'the same input twice'), read }) };
}

describe('a tool listed idempotent can be called again', () => {
  it(`AC4 ${AC.repeats} each tool listed idempotent is called twice with the same input, the second while the first is pending, and once more: the second call starts no process and adds nothing the first didn't; a planted deep_job that runs its tool again fails, naming the job`, async () => {
    const w = await callsWorld([{ label: 'agent' }, { label: 'actions', argv: 'actions' }, { label: 'actions-hook', argv: 'actions-hook' }]);
    const agent = w.sessions.get('agent')!;
    const read: Reader = async () => (await t26.events(w.hub)) as unknown as Ev[];
    const lists = [
      { name: 'deep mcp', server: agent.server, tools: await agent.server.tools() },
      { name: 'deep mcp actions', server: w.actions, tools: await w.actions.tools() },
      { name: 'deep-hook mcp actions', server: w.actionsHook, tools: await w.actionsHook.tools() },
      { name: 'the reading tools', server: w.reading, tools: await w.reading.tools() },
    ];
    const listed = [...new Set(lists.flatMap((l) => listedAs(l.tools, 'idempotentHint')))].sort();
    expect(listed, `the servers list idempotent the tools the table does (${lists.map((l) => `${l.name}: ${listedAs(l.tools, 'idempotentHint').join(', ') || 'none'}`).join('; ')})`).toEqual(tableSays('idempotentHint'));

    await installHello(w.home);
    const ctx = { doc: w.doc, ask: agent.ask, revision: w.revision };
    const failures: string[] = [];
    for (const l of lists) {
      for (const tool of listedAs(l.tools, 'idempotentHint')) {
        if (tool === 'deep_job') continue;
        if (tool === 'call_action') {
          const s = w.sessions.get(l.name === 'deep mcp actions' ? 'actions' : 'actions-hook')!;
          const request = `req-${randomBytes(6).toString('hex')}`;
          failures.push(...await repeatFailures({ label: `${l.name}: call_action ext.hello.greet with request ${request}`, calibrate: callAction(w.hub, s, `req-${randomBytes(6).toString('hex')}`), call: callAction(w.hub, s, request), read }));
          continue;
        }
        const args = forms(tool, ctx)[0]?.args as Line | undefined;
        expect(args, `BLOCKED: this suite knows a form of ${tool} to call`).toBeDefined();
        failures.push(...await repeatFailures({ label: `${l.name}: ${tool} ${brief(args, 200)}`, call: () => l.server.call(tool, args!), read }));
      }
    }
    await w.close();
    const jobs = await jobRepeat();
    expect([...failures, ...jobs.failures], 'every tool listed idempotent, called again with the same input, starts no process and adds nothing').toEqual([]);

    const planted = await jobRepeat('job-second-call');
    expect(planted.failures.filter((f) => f.startsWith(planted.label) && f.includes('process.starting')), `the same check fails a deep_job that runs its tool again, naming the job: ${planted.failures.join(' | ') || 'no failure'}`).not.toEqual([]);
  }, TEST_MS);
});
