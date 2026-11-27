import { openRecord, testStorage, ulid, type Connection } from '@deepbuild/record';
import { describe, expect, it } from 'vitest';
import { resolvePeerSender } from '../src/peer-sender.js';
import type { Session } from '../src/session-types.js';

const T = 1_760_013_451_123;

function liveSession(id: string, ended = false): Session {
  return {
    id,
    thread: id,
    agent: 'claude-code',
    pid: 100,
    start: '',
    cwd: '/tmp/work',
    transcript: '/tmp/t.jsonl',
    ended,
    read: 0,
    turn: undefined,
    closed: [],
    reached: new Set(),
    pending: new Map(),
    prompts: new Map(),
    entries: [],
  };
}

function startEvent(inbox?: string) {
  return {
    v: 3,
    id: ulid(T),
    kind: 'session.start',
    ts: T,
    data: {
      agent: 'claude-code',
      worktree: '/tmp/work',
      branch: null,
      thread: 'thread-1',
      loads: [],
      ...(inbox ? { inbox } : {}),
    },
  };
}

describe('resolvePeerSender', () => {
  it('matches a live session across /tmp and /private/tmp spellings of its inbox path', async () => {
    const r = await openRecord({ path: 'record.db', now: () => T, storage: testStorage() });
    try {
      const conn = (session: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
      await r.append(conn('sender-tmp'), startEvent('/tmp/cc-socks/1001.sock'));
      await r.append(conn('sender-priv'), startEvent('/private/tmp/cc-socks/1002.sock'));
      await r.append(conn('sender-ended'), startEvent('/tmp/cc-socks/1003.sock'));
      await r.append(conn('sender-ended'), { v: 1, id: ulid(T + 1), kind: 'session.end', ts: T + 1, data: { reason: 'other' } });
      const sessions = new Map<string, Session>([
        ['receiver', liveSession('receiver')],
        ['sender-tmp', liveSession('sender-tmp')],
        ['sender-priv', liveSession('sender-priv')],
        ['sender-ended', liveSession('sender-ended', true)],
      ]);
      const raw = (q: string, p?: readonly (string | number | null)[]) => r.raw(q, p);

      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/1001.sock' } })).toBe('sender-tmp');
      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'uds:/private/tmp/cc-socks/1001.sock' } })).toBe('sender-tmp');
      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/1002.sock' } })).toBe('sender-priv');
      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/1003.sock' } })).toBeUndefined();
      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/9999.sock' } })).toBeUndefined();
      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'local_sender-tmp' } })).toBe('sender-tmp');
      expect(await resolvePeerSender(raw, sessions, 'receiver', { origin: { kind: 'peer', from: 'local_unknown-id' } })).toBeUndefined();
    } finally {
      await r.close();
    }
  });
});
