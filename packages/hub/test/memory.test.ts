// Who said a direction was rejected (#111): only your own prompt or message, never words an agent can put in an option or a page.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { captureRejected, dropKept, reaches, rejectedDirections, revives } from '../src/memory.js';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';
import type { Connection, Message, RecordStore } from '@deepbuild/record';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '5f1c2d3e-1111-4222-8333-444455556666';
const key = (scope: string, d: string) => createHash('sha256').update(`rejected ${scope} ${d}`).digest('hex');
const row = (id: string, k: string, answer: string, ask: string | null = null) => ({ id, key: k, answer: JSON.stringify(answer), scope: JSON.stringify('repo:p'), ask });

describe('rejected directions', () => {
  it('reads as said only the decision a capture saved: not an option an agent named so, nor a page line with the same words', async () => {
    const choice = JSON.stringify({ kind: 'choice', options: [{ id: 'rejected: `npm`', label: 'Yes, continue' }, { id: 'no', label: 'No' }] });
    const rows = [row('a', key('repo:p', 'kafka'), 'rejected: `kafka`'), row('b', 'other', 'rejected: `npm`', choice), row('c', 'page-line', 'rejected: `git`')];
    expect((await rejectedDirections(async () => rows)).filter((r) => r.said).map((r) => r.direction)).toEqual(['kafka']);
  });

  it('stops a proposal naming what you said in any case, without backticks, and not a longer name; an option passed over only as its exact key', async () => {
    const rows = [row('a', key('repo:p', 'kafka'), 'rejected: `kafka`'), row('b', 'k', 'no', JSON.stringify({ kind: 'choice', options: [{ id: 'no', label: 'Stay' }, { id: 'yes', label: 'Use `redis`' }] }))];
    const raw = async () => rows;
    expect((await revives(raw, 'switch to Kafka for events', 'p', 's'))?.direction).toBe('kafka');
    expect(await revives(raw, 'use kafka-lite', 'p', 's')).toBeUndefined();
    expect(await revives(raw, 'use kafka', 'other', 's')).toBeUndefined();
    expect(await revives(raw, 'use redis', 'p', 's')).toBeUndefined();
    expect((await revives(raw, 'use `redis`', 'p', 's'))?.direction).toBe('redis');
  });

  it('captures your sentence, not what a host wrote under your role or the phrase quoted mid-sentence', async () => {
    const saved: string[] = [];
    const record = { raw: async () => [], append: async (_: unknown, e: { data: { answer: string } }) => { saved.push(e.data.answer); } } as unknown as RecordStore;
    const message = (id: string, text: string) => ({ id, role: 'user', text, outside: false }) as Message;
    const messages = [message('m1', 'No. rejected: `kafka`.'), message('m2', '# AGENTS.md instructions\nrejected: `pnpm`'), message('m3', '<user_instructions>\nrejected: `git`\n</user_instructions>'), message('m4', 'was it rejected: `redis` then?')];
    await captureRejected(record, { actor: 'you', scope: 'x' } as unknown as Connection, () => 1, [{ session: 's', project: 'p', messages, from: 0 }]);
    expect(saved).toEqual(['rejected: `kafka`']);
  });

  it('overruling a keep takes that lesson\'s guard out of rules.json, and only its guard', async () => {
    await withHub(async (root) => {
      const file = join(root, 'rules.json');
      writeFileSync(file, JSON.stringify({ v: 1, entries: { 'memory-abc': { match: 'run:x' }, 'memory-def': { match: 'run:y' }, mine: { match: 'run:z' } } }));
      dropKept(root, createHash('sha256').update('memory lesson-abc').digest('hex'));
      expect(Object.keys((JSON.parse(readFileSync(file, 'utf8')) as { entries: object }).entries).sort()).toEqual(['memory-def', 'mine']);
    });
  });

  it('leaves a guard you added under a free-text repo: scope reaching everywhere; only its own entries are held to their repo', () => {
    expect(reaches('mine', 'repo:my-app', 'other', 's')).toBe(true);
    expect(reaches('rejected-a', 'repo:p', 'other', 's')).toBe(false);
    expect(reaches('memory-a', 'repo:p', 'p', 's')).toBe(true);
  });

  it('what you reject in a prompt while a session runs is saved and reaches rules.json at once', async () => {
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
      const file = join(root, 'rules.json');
      writeFileSync(file, JSON.stringify({ v: 1, entries: {} }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'Not that. rejected: `kafka`.', prompt_id: 'p1' });
      const words = () => (existsSync(file) ? Object.values((JSON.parse(readFileSync(file, 'utf8')) as { entries?: Record<string, { match: string }> }).entries ?? {}).map((e) => e.match) : []);
      for (const until = Date.now() + 10_000; Date.now() < until && !words().includes('word:kafka'); await new Promise((r) => setTimeout(r, 50)));
      expect(words()).toContain('word:kafka');
    });
  }, 60_000);
});
