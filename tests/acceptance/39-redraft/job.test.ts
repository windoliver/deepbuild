// #39: "A Codex job the runner started with `codex exec` leaves no session row, claim or task spend".
// The real hub runs the real runner; the only stand-in is `codex` on a temp PATH. The job's hooks go through deep-hook
// as Codex's engine runs a command, from the job's folder, with the thread ID the job printed. A plain Codex session
// on the same hub, with the same hooks, must leave its session row: a hub that drops all Codex hooks proves nothing.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  ACCOUNT, allEvents, cleanup, codexLimits, control, hook, installCodex, makeWorld, newThread, payload, shown, startHub, stopHub, waitFor,
  type Hub, type Line, type Thread, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const letters = (s: string) => s.replace(/[^0-9A-Za-z]/g, '');
const ENDED = ['finished', 'stopped', 'refused', 'lost'];
/** Everything a session, a claim or task spend leaves behind. A job's own `job.*` events are not among them. */
const JUDGED = new Set(['session.start', 'session.end', 'session.reading', 'user.ask', 'tool.before', 'tool.after', 'agent.stop', 'permission.request', 'claim.made', 'verdict.made', 'turn.usage', 'spend.reserved', 'spend.charged', 'task.created', 'task.completed', 'task.closed']);

async function withHub(): Promise<{ w: World; hub: Hub }> {
  const w = makeWorld();
  installCodex(w);
  const hub = await startHub(w);
  // A window reading with room, as a Codex token event carries it. Before Codex's adapter the hub refuses it; the job then says so.
  await control(w, hub, 'windows.report', { agent: 'codex', account: ACCOUNT, rate_limits: codexLimits() }).catch(() => undefined);
  return { w, hub };
}
const status = (w: World, hub: Hub, job: string) => control(w, hub, 'job.status', { job });
async function submit(w: World, hub: Hub, prompt: string): Promise<Line> {
  const rec = await control(w, hub, 'job.submit', { spec: { kind: 'read', agent: 'codex', account: ACCOUNT, prompt, deadline_ms: 180_000 } });
  expect(rec.state, `a Codex job must run through the runner: ${JSON.stringify(rec)}`).not.toBe('refused');
  return rec;
}
/** Fires one hook and needs it to have exited 0: Codex treats anything else as a failed hook. */
async function fire(w: World, body: Line): Promise<void> {
  const r = await hook(w, body);
  expect(r.code, `${String(body.hook_event_name)} through deep-hook: ${shown(r)}`).toBe(0);
}
const toolCall = { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'exec-1' };
/** A whole turn that did work and says it is done, the shape a session's stop is read as a claim from. */
async function turn(w: World, t: Thread): Promise<void> {
  await fire(w, payload(t, 'SessionStart', { source: 'startup' }));
  await fire(w, payload(t, 'UserPromptSubmit', { prompt: 'Read the notes and say what they hold.' }));
  await fire(w, payload(t, 'PreToolUse', toolCall));
  await fire(w, payload(t, 'PostToolUse', { ...toolCall, tool_response: 'notes.md' }));
  const stop = await hook(w, payload(t, 'Stop', { stop_hook_active: false, last_assistant_message: 'Done. The change is finished and the tests pass.' }));
  expect(stop.code, `Stop through deep-hook: ${shown(stop)}`).toBe(0);
}
/** Waits until each of a job's hooks reads as its event: a hook's events are appended after its connection closes. */
async function jobEvents(w: World, hub: Hub, job: string, events: string[]): Promise<void> {
  const seen = async () => (await allEvents(w, hub)).filter((e) => e.kind === 'job.event' && e.data?.job === job).map((e) => String(e.data.event));
  await waitFor(async () => { const s = await seen(); return events.every((e) => s.includes(e)); }, 30_000, `${job}'s hooks ${events.join(', ')} as job.event`, async () => `it has ${JSON.stringify(await seen())}`);
}
async function ended(w: World, hub: Hub, job: string): Promise<Line> {
  return waitFor(async () => { const r = await status(w, hub, job); return ENDED.includes(String(r.state)) && r; }, 60_000, `${job} to end`, async () => JSON.stringify(await status(w, hub, job)));
}
/** After the hub has stopped and drained: what the record holds of the job's thread, and of the plain session beside it. */
async function judge(w: World, job: string, thread: string, control_: Thread | undefined): Promise<void> {
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const sessions = (await record.table('sessions')).rows.map((r: Line) => letters(String(r.id)));
    const claims = (await record.table('claims')).rows.map((r: Line) => letters(String(r.session_id)));
    const events = (await record.read({ after: 0, limit: 100_000 })) as unknown as { kind: string; session?: string; data: unknown }[];
    expect(sessions, `session row for the job ${job}'s thread ${thread}`).not.toContain(letters(thread));
    expect(claims, `claim for the job ${job}'s thread ${thread}`).not.toContain(letters(thread));
    const left = events.filter((e) => JUDGED.has(e.kind) && (e.session === thread || JSON.stringify(e.data).includes(thread) || JSON.stringify(e.data).includes(job)));
    expect(left.map((e) => e.kind), `what the job ${job} left as a session, a claim or task spend`).toEqual([]);
    if (control_) {
      expect(sessions, 'a plain Codex session on this hub, its hooks the same, must leave its session row').toContain(letters(control_.id));
      expect(events.filter((e) => e.session === control_.id).map((e) => e.kind), 'the plain Codex session\'s events').toEqual(expect.arrayContaining(['session.start', 'tool.after', 'agent.stop']));
    }
  } finally {
    await record.close();
  }
}

describe('#39 a Codex job the runner started leaves no session row, claim or task spend', () => {
  it('a job through `codex exec` whose hooks carry the thread ID it printed reads as the job\'s events, with no session row, claim or task spend, while a plain Codex session beside it has its row', async () => {
    const { w, hub } = await withHub();
    let job = '';
    let thread: Thread | undefined;
    const plain = newThread(w, w.repo, 'cli');
    try {
      await turn(w, plain);
      const id = crypto.randomUUID();
      const rec = await submit(w, hub, `Read the notes.\n@thread ${id}`);
      job = String(rec.job);
      await waitFor(async () => (await status(w, hub, job)).session === id, 30_000, `the runner to read ${job}'s thread ID from its JSON output`, async () => JSON.stringify(await status(w, hub, job)));
      const printed = String((await control(w, hub, 'job.output', { job })).stdout);
      expect(printed, 'the job must be started as `codex exec --json`').toMatch(/stand-in argv: exec\b.*--json/);
      thread = { ...newThread(w, String(rec.folder), 'exec'), id };
      await turn(w, thread);
      await jobEvents(w, hub, job, ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
      writeFileSync(join(String(rec.folder), 'release'), '');
      const end = await ended(w, hub, job);
      expect(end.state, JSON.stringify(end)).toBe('finished');
    } finally {
      await stopHub(hub);
    }
    await judge(w, job, thread!.id, plain);
  }, 300_000);

  it('hooks that reach the hub from the job\'s folder before the runner has read its thread ID still read as the job\'s, never as a session', async () => {
    const { w, hub } = await withHub();
    let job = '';
    const id = crypto.randomUUID();
    try {
      const rec = await submit(w, hub, `Read the notes.\n@thread ${id}\n@hold-thread`);
      job = String(rec.job);
      await waitFor(async () => (await status(w, hub, job)).state === 'running', 30_000, `${job} to run`, async () => JSON.stringify(await status(w, hub, job)));
      const t: Thread = { ...newThread(w, String(rec.folder), 'exec'), id };
      await fire(w, payload(t, 'SessionStart', { source: 'startup' }));
      await fire(w, payload(t, 'UserPromptSubmit', { prompt: 'Read the notes.' }));
      writeFileSync(join(String(rec.folder), 'release-thread'), '');
      await jobEvents(w, hub, job, ['SessionStart', 'UserPromptSubmit']);
      writeFileSync(join(String(rec.folder), 'release'), '');
      expect((await ended(w, hub, job)).state).toBe('finished');
    } finally {
      await stopHub(hub);
    }
    await judge(w, job, id, undefined);
  }, 300_000);
});
