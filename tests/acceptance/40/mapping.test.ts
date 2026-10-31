// #40 AC7, AC8 and AC9: pi's facts, its corpus through the real `scripts/corpus.mjs`, and scripted RPC sessions
// through the real package and hub. A wrong mapping is a planted copy of the facts, run through the same code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CORPUS, NODE, REPO, VERSION, answer, cleanup, corpusSessions, holdsRun, lifecycleOf, openWorld, outcomesOf, pendingAsk, askStep, plantedFacts, readFacts, run, sleep, waitFor, word, type CorpusCase, type Line,
} from './helpers.ts';
import { mapHook } from '../../../adapters/index.mjs';
import { frozenDigests, validate } from '../../../packages/contracts/src/index.ts';

afterEach(cleanup, 60_000);

const claudeFacts = (): Line => JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
const claudeVersion = (): string => (claudeFacts().versions as string[]).at(-1)!;

/** The call on pi and the same edit on Claude Code, through the adapter: the same kind and the same paths, or it names the call. */
function assertSameAsClaudeEdit(facts: Line, call: string): void {
  const cwd = '/work/shop';
  const pi = mapHook({ facts, version: VERSION, payload: { hook_event_name: 'tool_call', session_id: 'pi-s', cwd, tool_name: 'edit', tool_input: { path: 'src/a.ts', edits: [{ oldText: 'a', newText: 'b' }] }, tool_use_id: call } });
  const claude = mapHook({ facts: claudeFacts(), version: claudeVersion(), payload: { hook_event_name: 'PreToolUse', session_id: 'cc-s', cwd, tool_name: 'Edit', tool_input: { file_path: '/work/shop/src/a.ts', old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_1', permission_mode: 'default', transcript_path: '/t.jsonl' } });
  const got = pi.events.find((e) => e.kind === 'tool.before')?.data;
  const want = claude.events.find((e) => e.kind === 'tool.before')?.data;
  if (got?.kind !== want?.kind) throw Error(`pi's edit call ${call} records as ${String(got?.kind)}, not ${String(want?.kind)} as Claude Code's Edit does`);
  if (JSON.stringify(got?.paths) !== JSON.stringify(want?.paths)) throw Error(`pi's edit call ${call} records paths ${JSON.stringify(got?.paths)}, not ${JSON.stringify(want?.paths)} as Claude Code's Edit does`);
  if (got?.call !== call) throw Error(`pi's edit call records call ${String(got?.call)}, not ${call}`);
}

/** A hook line for Claude Code's Edit, as deep-hook sends it, to the same hub. */
function sendClaudeEdit(socket: string, session: string, cwd: string, path: string): Promise<void> {
  const payload = { hook_event_name: 'PreToolUse', session_id: session, cwd, tool_name: 'Edit', tool_input: { file_path: path, old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_40', permission_mode: 'default', transcript_path: join(cwd, 'none.jsonl') };
  const seq = String(BigInt(Date.now()) * 1_000_000n);
  const request = { v: 1, agent: 'claude-code', event: 'PreToolUse', seq, id: '01KABCDEFGHJKMNPQRSTVWXYZ0', pid: process.pid, ppid: process.ppid, matched: [], payload };
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    let first = true;
    sock.setEncoding('utf8').on('data', () => {
      if (first) { first = false; sock.write(`${JSON.stringify(request)}\n`); } else { sock.destroy(); resolve(); }
    });
    sock.on('error', () => resolve());
    setTimeout(() => { sock.destroy(); resolve(); }, 5000);
  });
}

describe('AC7 #40.0a086a33 pi\'s edit tool records as an edit with the same paths as Claude Code\'s Edit', () => {
  it('AC7 through the adapter: the same kind and the same absolute paths, from the shipped facts', () => {
    assertSameAsClaudeEdit(readFacts(), 'call_edit_1');
    const write = mapHook({ facts: readFacts(), version: VERSION, payload: { hook_event_name: 'tool_call', session_id: 'pi-s', cwd: '/work/shop', tool_name: 'write', tool_input: { path: 'src/a.ts', content: 'x' }, tool_use_id: 'call_w' } });
    expect(write.events.find((e) => e.kind === 'tool.before')?.data, 'pi\'s write stays a write, so the mapping isn\'t one kind for everything').toMatchObject({ kind: 'write', paths: ['/work/shop/src/a.ts'] });
  });

  it('AC7 (wrong program) a mapping that records pi\'s edit as a write fails this test, naming the call', () => {
    const facts = readFacts();
    facts.toolKinds.tools.edit = 'write';
    expect(() => assertSameAsClaudeEdit(facts, 'call_edit_2')).toThrow(/call_edit_2.*records as write/);
  });

  it('AC7 real pi\'s real edit tool, through the package and the hub, records what the hub records for Claude Code\'s Edit', async () => {
    const w = await openWorld({ steps: [
      { tools: [{ name: 'write', arguments: { path: 'f.txt', content: 'a\n' } }] },
      { tools: [{ name: 'edit', arguments: { path: 'f.txt', edits: [{ oldText: 'a', newText: 'b' }] } }] },
      { text: 'Edited.' },
    ] });
    await w.pi.call({ type: 'prompt', message: 'Edit the file.' });
    await w.pi.until('agent_settled', 1, 30_000);
    const path = join(w.cwd, 'f.txt');
    expect(readFileSync(path, 'utf8')).toBe('b\n');
    await sendClaudeEdit(w.hub.socket, 'claude-edit-40', w.cwd, path);
    const events = await waitFor(async () => {
      const all = await w.client.events();
      return all.some((e) => e.kind === 'tool.before' && e.session === 'claude-edit-40') && all.some((e) => e.kind === 'tool.before' && e.data?.call === 'call_2_0') ? all : undefined;
    }, 15_000, 'tool.before for pi\'s edit, call_2_0, and for Claude Code\'s Edit');
    const pi = events.find((e) => e.kind === 'tool.before' && e.data?.call === 'call_2_0')!;
    const claude = events.find((e) => e.kind === 'tool.before' && e.session === 'claude-edit-40')!;
    expect(pi.session, 'the call is under the pi session').toBe(w.pi.session);
    expect({ call: 'call_2_0', kind: pi.data.kind, paths: pi.data.paths }, 'pi\'s edit call call_2_0').toEqual({ call: 'call_2_0', kind: claude.data.kind, paths: claude.data.paths });
    expect(pi.data.kind).toBe('edit');
    const written = events.find((e) => e.kind === 'tool.before' && e.data?.call === 'call_1_0')!;
    expect(written.data.kind, 'the file\'s first call is pi\'s write').toBe('write');
  }, 120_000);
});

// The four cases, by tag (README, The corpus).
const NEEDLES: Record<string, string[]> = {
  'prompt-handled': ['prompt:handled'],
  'two-starts-one-settle': ['agent_start', 'agent_end', 'agent_start', 'agent_end', 'stop', 'agent_settled'],
};
const TAGS = ['prompt-handled', 'two-starts-one-settle', 'replaced-session-answer', 'nested-incomplete'];
function caseOf(tag: string): { session: ReturnType<typeof corpusSessions>[number]; recorded: CorpusCase } {
  for (const session of corpusSessions()) {
    const recorded = session.cases.find((c) => c.tag === tag);
    if (recorded) return { session, recorded };
  }
  throw Error(`the pi corpus holds no case tagged ${tag}, under ${CORPUS}`);
}
const expected = (session: ReturnType<typeof corpusSessions>[number]): { kind: string; data: Line }[] => session.cases.flatMap((c) => c.expect ?? []);

describe('AC8 #40.c6c858c2 The pi corpus holds a recorded case for each of the four', () => {
  it('AC8 every session is a recorded set of a covered version, with reviewed expected events and nothing personal', () => {
    const facts = readFacts();
    // pi's own event names don't fit adapter.facts@1's closed mapping, so its facts name a later version of the contract, frozen and held to (README, Disputes D2).
    expect(facts.schema).toMatch(/^adapter\.facts@\d+$/);
    expect(Object.keys(frozenDigests()), 'the version is a frozen contract').toContain(facts.schema);
    expect(validate(facts.schema, facts), 'pi\'s facts hold to the version they name').toEqual({ ok: true });
    expect(facts.versions, 'pi\'s facts cover 1.4.0, the version with agent_before_settle and agent_settled').toContain(VERSION);
    const sessions = corpusSessions();
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.meta, s.name).toMatchObject({ schema: 'corpus.session@1', agent: 'pi', version: s.name.split('/')[0] });
      expect(s.meta.surface, s.name).toBe('rpc');
      expect(s.transcript.length, `${s.name} keeps pi's session file as transcript.jsonl`).toBeGreaterThan(0);
      expect(s.transcript[0]!.type, `${s.name}'s transcript opens with pi's session header`).toBe('session');
      for (const c of s.cases) {
        expect(Array.isArray(c.expect), `${c.session}:${c.line} stores its expected events`).toBe(true);
        expect(typeof c.source === 'string' && typeof c.reviewed === 'string', `${c.session}:${c.line} names its source and its review`).toBe(true);
        expect(typeof c.payload.hook_event_name === 'string' && typeof c.payload.session_id === 'string', `${c.session}:${c.line} is a pi event as the package sends it`).toBe(true);
      }
      const text = readFileSync(join(s.dir, 'events.jsonl'), 'utf8') + readFileSync(join(s.dir, 'transcript.jsonl'), 'utf8');
      expect(text.includes(process.env.HOME ?? '\0') || /\/Users\/(?!user\b)/.test(text), `${s.name} is redacted`).toBe(false);
    }
  });

  it('AC8 a prompt handled without a run: disposition handled, recorded as handled, with no agent_start for it', () => {
    const { session, recorded } = caseOf('prompt-handled');
    expect(recorded.payload).toMatchObject({ hook_event_name: 'input', disposition: 'handled' });
    expect(recorded.expect).toEqual([{ kind: 'user.ask', data: expect.objectContaining({ session: recorded.payload.session_id, disposition: 'handled' }) }]);
    const next = session.cases.find((c) => c.line > recorded.line && ['input', 'agent_start'].includes(String(c.payload.hook_event_name)));
    expect(next?.payload.hook_event_name, 'nothing starts a run for it: the next thing that may is another input').not.toBe('agent_start');
  });

  it('AC8 two starts before one settle: agent_start twice, one agent_before_settle as the one agent.stop, agent_settled as activity', () => {
    const { session } = caseOf('two-starts-one-settle');
    const hooks = session.cases.map((c) => c.payload.hook_event_name);
    expect(holdsRun(hooks as string[], ['agent_start', 'agent_end', 'agent_start', 'agent_end', 'agent_before_settle', 'agent_settled']), `the recorded order: ${hooks.join(', ')}`).toBe(true);
    expect(holdsRun(lifecycleOf(expected(session)), NEEDLES['two-starts-one-settle']!), JSON.stringify(lifecycleOf(expected(session)))).toBe(true);
    for (const c of session.cases) {
      const kinds = c.expect.map((e) => e.kind);
      if (c.payload.hook_event_name === 'agent_before_settle') expect(kinds, `${c.session}:${c.line}`).toEqual(['agent.stop']);
      if (['agent_settled', 'agent_end', 'agent_start'].includes(String(c.payload.hook_event_name))) expect(kinds, `${c.session}:${c.line}: activity, never a result`).toEqual(['session.activity']);
    }
  });

  it('AC8 a replaced session\'s pending answer: the replacement names its parent, and the case names the pending ask bound to it', () => {
    const { recorded } = caseOf('replaced-session-answer');
    expect(recorded.payload).toMatchObject({ hook_event_name: 'session_start', source: 'new' });
    expect(recorded.pending?.ask, 'the case names the ask whose answer was pending').toMatch(/^ask:/);
    expect(recorded.pending?.outcome, 'the answer it was bound to the old generation of is refused').toBe('replaced');
    expect(recorded.pending?.session).not.toBe(recorded.payload.session_id);
    expect(recorded.expect, 'the session tree keeps its lineage').toEqual([{ kind: 'session.start', data: expect.objectContaining({ session: recorded.payload.session_id, source: 'new', parent: recorded.pending?.session }) }]);
  });

  it('AC8 a nested tool record marked incomplete: complete false in the payload, in the stored event and in pi\'s own transcript', () => {
    const { session, recorded } = caseOf('nested-incomplete');
    expect(recorded.payload.hook_event_name).toBe('tool_result');
    expect(recorded.payload.nested_calls?.complete).toBe(false);
    expect(recorded.expect).toEqual([{ kind: 'tool.after', data: expect.objectContaining({ session: recorded.payload.session_id, call: recorded.payload.tool_use_id, nested: expect.objectContaining({ complete: false }) }) }]);
    expect(session.transcript.some((e) => (e.message as Line | undefined)?.nestedCalls?.complete === false), 'the transcript is the session pi really marked').toBe(true);
  });

  it('AC8 the corpus lane holds pi: replay and check pass with pi\'s set in them, each of its payloads a match', async () => {
    const replay = await run(NODE, ['scripts/corpus.mjs', 'replay'], { timeoutMs: 180_000 });
    const lines = replay.stdout.split('\n').flatMap((l) => { try { return [JSON.parse(l) as Line]; } catch { return []; } });
    const mine = lines.filter((l) => l.type === 'payload' && l.agent === 'pi');
    expect(mine.length, 'replay reads pi\'s set').toBeGreaterThan(0);
    expect(mine.filter((l) => l.result !== 'match')).toEqual([]);
    const check = await run(NODE, ['scripts/corpus.mjs', 'check'], { timeoutMs: 180_000 });
    expect(check.stdout.split('\n').filter((l) => /^FAIL corpus: .*\bpi\b/.test(l))).toEqual([]);
  }, 400_000);

  for (const [name, patch, needle] of [
    ['settled treated as a result', (f: Line) => { f.mapping.agent_settled = f.mapping.agent_before_settle; }, 'agent_settled'],
    ['agent_end treated as a result', (f: Line) => { f.mapping.agent_end = f.mapping.agent_before_settle; }, 'agent_end'],
    ['edit mapped as write', (f: Line) => { f.toolKinds.tools.edit = 'write'; }, null],
  ] as const) {
    it(`AC8 (wrong program) replay on facts with ${name} fails, naming the cases`, async () => {
      readFacts();
      const facts = plantedFacts(patch);
      const replay = await run(NODE, ['scripts/corpus.mjs', 'replay', '--facts', facts], { timeoutMs: 180_000 });
      const lines = replay.stdout.split('\n').flatMap((l) => { try { return [JSON.parse(l) as Line]; } catch { return []; } });
      const wrong = lines.filter((l) => l.type === 'payload' && l.agent === 'pi' && l.result !== 'match' && (needle === null || l.hook === needle));
      if (needle !== null) expect(wrong.length, `replay names the ${needle} cases as mismatches: ${replay.stdout.slice(-400)}`).toBeGreaterThan(0);
      else if (corpusSessions().some((s) => s.cases.some((c) => c.payload.tool_name === 'edit'))) expect(wrong.length, 'replay names the edit call').toBeGreaterThan(0);
      else throw Error('the pi corpus records no edit call, so its replay can\'t hold the edit mapping: record one');
      expect(replay.code).not.toBe(0);
    }, 200_000);
  }

  it('AC8 pi\'s facts keep the four apart: only the pre-settle hook may continue a run', () => {
    const facts = readFacts();
    expect(facts.continuation?.hook, 'the facts\' continuation names the one hook that may continue').toBe('agent_before_settle');
    expect(facts.mapping.agent_before_settle?.kind).toBe('agent.stop');
    for (const hook of ['agent_start', 'agent_end', 'agent_settled']) expect(facts.mapping[hook]?.kind, `${hook} is activity`).toBe('session.activity');
  });
});

/** The lifecycle the hub recorded for a session, in log order. */
async function liveLifecycle(w: Awaited<ReturnType<typeof openWorld>>, session: string): Promise<string[]> {
  return lifecycleOf((await w.client.events()).filter((e) => e.session === session) as { kind: string; data: Line }[]);
}

describe('AC9 #40.249583fd Scripted pi sessions in RPC mode reproduce the four lifecycle cases the pi corpus records', () => {
  it('AC9 a prompt handled without a run: the same case as the corpus\'s, its disposition from pi itself', async () => {
    const { session } = caseOf('prompt-handled');
    const marker = `handle-${word()}`;
    const w = await openWorld({ handle: marker, steps: [{ text: 'never asked' }] });
    const reply = await w.pi.call({ type: 'prompt', message: `please ${marker}` });
    expect(reply.data?.disposition, 'pi says it handled the prompt').toBe('handled');
    await waitFor(async () => (await liveLifecycle(w, w.pi.session)).includes('prompt:handled'), 8000, 'a user.ask recorded with disposition handled');
    await sleep(1500);
    expect(w.pi.count('agent_start')).toBe(0);
    const live = await liveLifecycle(w, w.pi.session);
    expect(live, 'no run, no stop').toEqual(['prompt:handled']);
    expect(holdsRun(lifecycleOf(expected(session)), NEEDLES['prompt-handled']!)).toBe(true);
  }, 90_000);

  it('AC9 two starts before one settle: a retried run reads as the corpus does, with one stop and settled as activity', async () => {
    const { session } = caseOf('two-starts-one-settle');
    const w = await openWorld({ steps: [{ error: '503 overloaded' }, { text: 'Recovered.' }] });
    await w.pi.call({ type: 'prompt', message: 'Do the work.' });
    await w.pi.until('agent_settled', 1, 30_000);
    await sleep(1500);
    expect(w.pi.count('agent_start'), 'pi started twice').toBe(2);
    const live = await liveLifecycle(w, w.pi.session);
    expect(live, 'the record').toEqual(['prompt', ...NEEDLES['two-starts-one-settle']!]);
    expect(holdsRun(lifecycleOf(expected(session)), NEEDLES['two-starts-one-settle']!)).toBe(true);
    const stop = (await w.client.events()).filter((e) => e.kind === 'agent.stop' && e.session === w.pi.session);
    expect(stop.map((e) => e.data.outcome), 'the one stop is the run\'s final result').toEqual(['finished']);
  }, 90_000);

  it('AC9 settled is activity, never a result: a run that settles aborted reads failed at its pre-settle stop, and settled adds no stop', async () => {
    const w = await openWorld({ steps: [{ holdMs: 20_000, text: 'never' }] });
    await w.pi.call({ type: 'prompt', message: 'Hold.' });
    await waitFor(() => w.pi.requests().length > 0, 10_000, 'the held request');
    await w.pi.call({ type: 'abort' });
    await w.pi.until('agent_settled', 1, 30_000);
    await sleep(1500);
    const all = (await w.client.events()).filter((e) => e.session === w.pi.session);
    expect(all.filter((e) => e.kind === 'agent.stop').map((e) => e.data.outcome), 'one stop, and an aborted run isn\'t finished').toEqual(['failed']);
    expect(all.filter((e) => e.kind === 'session.activity').map((e) => e.data.activity)).toContain('agent_settled');
    expect(all.filter((e) => ['claim.made', 'verdict.made'].includes(String(e.kind))), 'settled made no claim or verdict').toEqual([]);
  }, 90_000);

  it('AC9 a replaced session\'s pending answer: refused as replaced, and the replacement names its parent as the corpus does', async () => {
    const { recorded } = caseOf('replaced-session-answer');
    const question = `Which ${word()} door?`;
    const label = `Door ${word()}`;
    const w = await openWorld({ steps: [askStep(question, label)] });
    const handle = await pendingAsk(w, question);
    const old = w.pi.session;
    await w.pi.call({ type: 'new_session' });
    const state = await w.pi.call({ type: 'get_state' });
    const fresh = String(state.data.sessionId);
    const start = await waitFor(async () => (await w.client.events()).find((e) => e.kind === 'session.start' && e.session === fresh), 15_000, 'the replacement\'s session.start');
    expect(start.data.parent, 'the session tree keeps its lineage in the record').toBe(old);
    expect(recorded.expect[0]!.data.parent).toBe(recorded.pending?.session);
    await answer(w, handle);
    const outcome = await waitFor(async () => (await outcomesOf(w, handle))[0], 10_000, 'the answer\'s delivery outcome');
    expect(outcome.data.outcome).toBe(recorded.pending?.outcome);
  }, 90_000);

  it('AC9 a nested tool record marked incomplete: the stored shape of the corpus\'s case', async () => {
    const { recorded } = caseOf('nested-incomplete');
    const w = await openWorld({ steps: [{ tools: [{ name: 'nest', arguments: { count: 300 } }] }, { text: 'Done.' }] });
    await w.pi.call({ type: 'prompt', message: 'Nest.' });
    await w.pi.until('agent_settled', 1, 60_000);
    const after = await waitFor(async () => (await w.client.events()).find((e) => e.kind === 'tool.after' && e.session === w.pi.session && e.data?.call === 'call_1_0'), 8000, 'tool.after for the calling tool');
    expect(after.data.nested?.complete).toBe(false);
    expect(Object.keys(after.data.nested as Line).sort(), 'the record has the fields the corpus stores').toEqual(Object.keys(recorded.expect[0]!.data.nested as Line).sort());
  }, 120_000);

  it('AC9 the adapter maps each recorded case as the facts say, with the real mapper: each case\'s stored events are its own', () => {
    const facts = readFacts();
    for (const tag of TAGS) {
      const { session, recorded } = caseOf(tag);
      const mapped = mapHook({ facts, version: String(session.meta.version), payload: recorded.payload, transcript: session.transcript });
      expect(mapped.verified, `${tag}: a recorded payload of a covered version verifies: ${JSON.stringify(mapped.readings)}`).toBe(true);
      expect(mapped.events.map(({ kind, data }) => ({ kind, data })), `${tag}: ${recorded.session}:${recorded.line}`).toEqual(recorded.expect);
    }
  });
});
