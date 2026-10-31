// The hub writes a session's spend off a stop's hook (#45), whether or not the stop names its prompt, and a subagent's stop
// doesn't count it again.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { call } from '../src/client.js';
import { Forge } from '../src/forge.js';
import { search } from '../src/search.js';
import { startOf, ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '6b3e4f50-2222-4333-8444-555566667777';

describe('turn.usage at a stop', () => {
  it('records the transcript\'s running total for a stop with no prompt_id, and none for a subagent\'s', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: claude.pid }));
      const usages = () => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try { return (db.prepare("SELECT data FROM events WHERE kind = 'turn.usage'").all() as { data: string }[]).map((r) => JSON.parse(r.data) as { covers: string; tokens: { input: number; cached: number; output: number } }); } finally { db.close(); }
      };
      const until = async (n: number) => { for (let i = 0; i < 100 && usages().length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
      await hook('SessionStart', { source: 'startup' });
      await until(0);
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'go' } })}\n${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 1 } } })}\n`);
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'ok' });
      await until(1);
      expect(usages().map((u) => [u.covers, u.tokens.input, u.tokens.cached, u.tokens.output])).toEqual([['session', 11, 20, 5]]);
      await hook('SubagentStop', { agent_id: 'a1', stop_hook_active: false });
      await new Promise((r) => setTimeout(r, 500));
      expect(usages(), 'a subagent\'s stop adds no row').toHaveLength(1);
    });
  }, 60_000);
});

describe('labelling a period from before the hub', () => {
  it('takes the manifest\'s messages from before the date, hidden and scrubbed, and your labels on them pass; a labels file can\'t add any', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: claude.pid }));
      await hook('SessionStart', { source: 'startup' });
      await new Promise((r) => setTimeout(r, 500));
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'now', promptId: 'p1', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: 'typed after the date' } })}\n`);
      await hook('UserPromptSubmit', { prompt: 'typed after the date', prompt_id: 'p1' });
      const long = 'a long prompt '.repeat(800);
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'long', promptId: 'p2', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: long } })}\n`);
      await hook('UserPromptSubmit', { prompt: long, prompt_id: 'p2' });

      const line = (uuid: string, timestamp: string, content: unknown) => JSON.stringify({ type: 'user', uuid, timestamp, message: { role: 'user', content } });
      const secret = `ghp_${'a1'.repeat(18)}`;
      const old = Array.from({ length: 99 }, (_, i) => line(`u${i}`, '2026-09-02T00:00:00Z', `rename file ${i}`));
      const text = [...old, line('asked', '2026-09-03T00:00:00Z', 'is it done yet?'), line('asked', '2026-09-03T00:00:00Z', 'is it done yet?'), line('key', '2026-09-03T00:00:01Z', `use ${secret}`), line('after', '2026-10-05T00:00:00Z', 'after the date, in the window'), line('older', '2026-09-03T00:00:02Z', 'typed after the date'), line('same', new Date().toISOString(), 'typed after the date'), line('samelong', new Date().toISOString(), long), line('out', '2026-10-25T00:00:00Z', 'outside the window')].join('\n');
      const sha = createHash('sha256').update(text).digest('hex');
      mkdirSync(join(home, 'pilot'));
      writeFileSync(join(home, 'pilot', sha), text);
      const manifest = join(home, 'manifest.json');
      writeFileSync(manifest, JSON.stringify({ baseline_sha256: 'a'.repeat(64), archive_dir: 'pilot', measures: [{ id: 'asks', kind: 'is_it_done', window: { from: '2026-09-01', to: '2026-10-10' }, transcripts: [{ sha256: sha }, { sha256: 'b'.repeat(64) }] }] }));
      const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
      const socket = join(root, 'hub.sock');
      const before = Date.parse('2026-10-01');
      type Drawn = { warning?: string; messages: { message: string; text: string }[] };
      let drawn: Drawn = { messages: [] };
      for (let i = 0; i < 50; i++) {
        drawn = (await call(socket, token, 'numbers.sample', { before, manifest }) as { result: Drawn }).result;
        if (drawn.messages.filter((m) => m.text === 'typed after the date' || m.text.startsWith('a long prompt')).length === 2) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(drawn.warning, 'says what it couldn\'t read').toContain('1 of the manifest\'s transcripts');
      expect(JSON.stringify(drawn), 'scrubbed').not.toContain(secret);
      expect(JSON.stringify(drawn), 'no date to see').not.toContain('2026-09');
      mkdirSync(join(root, 'labels'), { recursive: true });
      const write = (labels: { message: string; label: boolean }[]) => writeFileSync(join(root, 'labels', 'is_it_done.json'), JSON.stringify({ threshold: 0.8, before, labels }));
      const decision = async () => (await call(socket, token, 'numbers.read', {}) as { result: { decision_one: { used: string[]; refused: { id: string; why: string }[] } } }).result.decision_one;
      // The drawn sample is 60 a side, and a check needs 100: more of the pool's messages, by the ids a later draw shows.
      const all = new Map(drawn.messages.map((m) => [m.message, m.text]));
      for (let i = 0; i < 40 && all.size < 104; i++) for (const m of (await call(socket, token, 'numbers.sample', { before, manifest }) as { result: Drawn }).result.messages) all.set(m.message, m.text);
      expect(all.size, 'the whole pool and the record\'s two').toBe(104);
      const texts = [...all.values()];
      expect(texts).toContain('is it done yet?');
      expect(texts.filter((t) => t === 'is it done yet?'), 'a resume\'s repeated line is one message').toHaveLength(1);
      expect(texts.filter((t) => t === 'typed after the date'), 'the same words from an earlier day are another message').toHaveLength(2);
      expect(texts).not.toContain('after the date, in the window');
      expect(texts).not.toContain('outside the window');
      expect(JSON.stringify(texts), 'scrubbed, in every draw').not.toContain(secret);
      write([...all].map(([message, t]) => ({ message, label: t === 'is it done yet?' })));
      expect((await decision()).used, 'your labels, on both periods, pass').toContain('is_it_done');
      const noManifest = (await call(socket, token, 'numbers.sample', { before }) as { result: Drawn }).result;
      expect(noManifest.warning, 'the pool is still the earlier side').toBeUndefined();
      expect(noManifest.messages.length, 'and is drawn from').toBeGreaterThan(2);
      renameSync(join(home, 'pilot'), join(home, 'moved'));
      const lost = (await call(socket, token, 'numbers.sample', { before, manifest }) as { result: Drawn }).result;
      expect(lost.warning, 'both named hashes').toContain('2 of the manifest\'s transcripts');
      expect((await decision()).used, 'a draw that can\'t read the archive undoes no label').toContain('is_it_done');
      // The same message, on the record and in the transcript, is the record's once the date is past both.
      renameSync(join(home, 'moved'), join(home, 'pilot'));
      writeFileSync(manifest, JSON.stringify({ baseline_sha256: 'a'.repeat(64), archive_dir: 'pilot', measures: [{ id: 'all', kind: 'is_it_done', window: { from: '2026-09-01', to: Date.now() + 86_400_000 }, transcripts: [{ sha256: sha }] }] }));
      const later = new Map<string, string>();
      for (let i = 0; i < 40; i++) for (const m of (await call(socket, token, 'numbers.sample', { before: Date.now() + 86_400_000, manifest }) as { result: Drawn }).result.messages) later.set(m.message, m.text);
      expect([...later.values()].filter((t) => t === 'typed after the date'), 'the record\'s and the older one').toHaveLength(2);
      expect([...later.values()].filter((t) => t.startsWith('a long prompt')), 'a long prompt the record cut is still one message').toHaveLength(1);
      write([...all].slice(0, 2).map(([message, t]) => ({ message, label: t === 'is it done yet?' })).concat([{ message: 'constructor', label: false }, ...Array.from({ length: 100 }, (_, i) => ({ message: `forged${i}`, label: false }))]));
      expect((await decision()).refused.find((r) => r.id === 'is_it_done')?.why, 'ids nothing holds count for nothing').toMatch(/over 2 messages/);
    });
  }, 120_000);
});

describe('deep_search', () => {
  it('marks a reading from a stale source STALE, never current', async () => {
    const reading = { id: 'reading:firstpass', subject: null, value: 3, unit: 'count' };
    const { hits } = await search({ query: 'firstpass', index: { search: async () => [] } as never, raw: async () => [], worktree: undefined, session: undefined, covers: () => true, readings: async () => [{ reading, source: 'github', as_of: 1, status: 'STALE' }] });
    expect(hits).toMatchObject([{ status: 'STALE', quote: 'STALE reading:firstpass: 3 count' }]);
  });
});

describe('the forge\'s merged pull requests', () => {
  const pr = (number: number) => ({ number, merged_at: '2026-10-01T00:00:00Z', created_at: '2026-09-30T00:00:00Z', body: '' });
  const serving = async (answer: (url: string, res: ServerResponse) => void) => {
    const server = createServer((req, res) => answer(req.url ?? '', res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { server, api: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };
  it('keeps what it read when the budget runs out, and reads no answer as unread', async () => {
    const { server, api } = await serving((url, res) => {
      if (url.includes('/pulls/2/')) return; // never answers
      res.end(JSON.stringify(url.includes('/reviews') ? [] : [pr(1), pr(2)]));
    });
    try {
      expect((await new Forge(api, undefined, 1000).merged('o', 'r'))?.map((p) => p.number)).toEqual([1]);
      expect(await new Forge(api, undefined, 0).merged('o', 'r')).toBeUndefined();
    } finally { server.closeAllConnections(); server.close(); }
  }, 30_000);
  it('a forge error partway reads unread, never a short count', async () => {
    const { server, api } = await serving((url, res) => {
      if (url.includes('/pulls/2/')) { res.statusCode = 500; res.end('{}'); return; }
      res.end(JSON.stringify(url.includes('/reviews') ? [] : [pr(1), pr(2)]));
    });
    try { expect(await new Forge(api, undefined, 30_000).merged('o', 'r')).toBeUndefined(); } finally { server.close(); }
  }, 30_000);
});

describe('deep numbers from an agent\'s process tree', () => {
  it('refuses what feeds your numbers, and still reads them', async () => {
    await withHub(async (root, home) => {
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, cwd: home, transcript_path: join(home, '.claude', 'projects', 'tmp', `${SESSION}.jsonl`), hook_event_name: event, ...extra }, { ppid: process.ppid }));
      await hook('SessionStart', { source: 'startup' });
      // This process stands for a deep command the agent, its parent, ran.
      const peer = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
      const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
      // The hub acknowledges a hook before it holds the session.
      let refused = await call(join(root, 'hub.sock'), token, 'numbers.refresh', {}, peer);
      for (let i = 0; i < 50 && 'result' in refused; i++) {
        await new Promise((r) => setTimeout(r, 100));
        refused = await call(join(root, 'hub.sock'), token, 'numbers.refresh', {}, peer);
      }
      expect('error' in refused && refused.error.remediation).toMatch(/no agent feeds its own numbers/);
      expect('result' in await call(join(root, 'hub.sock'), token, 'numbers.read', {}, peer)).toBe(true);
      // The command itself, a child of this process, names itself to the hub.
      const cli = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
      const ran = spawnSync(process.execPath, [cli, 'numbers', 'refresh'], { env: { ...process.env, HOME: home }, cwd: home, encoding: 'utf8' });
      expect(ran.stderr).toMatch(/no agent feeds its own numbers/);
      expect(ran.status).toBe(3);
    });
  }, 60_000);
});

describe('Codex\'s usage', () => {
  it('reads the session\'s total from its rollout at a stop, unpriced', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      mkdirSync(work, { recursive: true });
      const transcript = join(home, 'rollout.jsonl');
      writeFileSync(transcript, [
        { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5-codex' } },
        { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 }, last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7, total_tokens: 107 } } } },
      ].map((l) => JSON.stringify(l)).join('\n') + '\n');
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, turn_id: 't1', model: 'gpt-5-codex', ...extra }, { ppid: claude.pid, agent: 'codex' }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'go' });
      await hook('Stop', { stop_hook_active: false, last_assistant_message: 'ok' });
      const usages = () => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try { return (db.prepare("SELECT data FROM events WHERE kind = 'turn.usage'").all() as { data: string }[]).map((r) => JSON.parse(r.data) as { cost: unknown; tokens: { output: number } }); } finally { db.close(); }
      };
      for (let i = 0; i < 100 && !usages().length; i++) await new Promise((r) => setTimeout(r, 100));
      expect(usages()[0]?.cost).toEqual({ basis: 'unpriced' });
      expect(usages()[0]?.tokens.output).toBe(7);
    });
  }, 60_000);
});
