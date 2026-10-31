// What the hub reads from outside for a task's check (#85), held to what review found: a slow outside never holds the
// hub's queue or its lock, a failure's text holds nothing Slack or the file sent, and only Claude Code's stops are tried.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { apiHost, slackThreads } from '../src/reach.js';
import { ulid } from '../src/wire.js';
import { hookLine, reply, send, withHub } from './hub.js';

const LINK = 'https://acme.slack.com/archives/C0TEST/p1700000000000100';
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) { s.closeAllConnections(); s.close(); }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A local Slack answering each request as `answer` says. */
async function slack(answer: (res: http.ServerResponse) => void, token = 'fake-token-for-a-test'): Promise<string> {
  const server = http.createServer((_req, res) => answer(res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'reach-'));
  dirs.push(root);
  writeFileSync(join(root, 'slack.json'), JSON.stringify({ token, you: 'U0YOU', api: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` }), { mode: 0o600 });
  return root;
}
/** What a read says after the background read had time to land. */
async function settled(root: string): Promise<string> {
  const threads = slackThreads(root);
  await threads.read(LINK).catch(() => undefined);
  await pause(300);
  return threads.read(LINK).then((m) => JSON.stringify(m), (e: Error) => e.message);
}

describe('the Slack connector', () => {
  it('answers at once while Slack hangs, so a read never holds the asks lock', async () => {
    const root = await slack(() => undefined);
    const at = Date.now();
    expect(await slackThreads(root).read(LINK), 'nothing known yet').toEqual([]);
    expect(Date.now() - at, 'it did not wait for Slack').toBeLessThan(500);
  });
  it('hands over what the background read found', async () => {
    const root = await slack((res) => res.end(JSON.stringify({ ok: true, messages: [{ user: 'U0YOU', text: 'hi', ts: '1700000000.000100' }, { bot_id: 'B1', text: 'yo', ts: '1700000001.000100' }] })));
    expect(await settled(root)).toBe(JSON.stringify([{ from: 'you', text: 'hi', at: 1700000000000 }, { from: 'B1', text: 'yo', at: 1700000001000 }]));
  });
  it('never puts what Slack sent, or the token, in a failure', async () => {
    const page = await settled(await slack((res) => res.end('<html>Bearer fake-token-for-a-test</html>')));
    expect(page).toContain('Slack');
    expect(page).not.toMatch(/html|Bearer|fake-token/);
    const header = await settled(await slack((res) => res.end('{}'), 'fake-to\nken-pasted-badly'));
    expect(header).toContain('Slack');
    expect(header).not.toMatch(/ken-pasted-badly/);
  });
});

describe('a stop the hub tries', () => {
  const SESSION = '3b9f1c2e-1111-4222-8333-44445555aaaa';
  const OTHER = '3b9f1c2e-1111-4222-8333-44445555bbbb';
  const stopOwner = (root: string): string | undefined => {
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try { return (db.prepare("SELECT json_extract(data, '$.owner') AS owner FROM events WHERE kind = 'agent.stop' AND session_id = ?").get(SESSION) as { owner?: string } | undefined)?.owner; } finally { db.close(); }
  };
  const world = (root: string, home: string, env: Record<string, string>, agent = 'claude-code') => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env }));
    const project = join(home, '.claude', 'projects', 'tmp');
    mkdirSync(project, { recursive: true });
    let n = 0;
    const line = (session: string, event: string, extra: Record<string, unknown>, wire: Record<string, unknown> = {}) => {
      const transcript = join(project, `${session}.jsonl`);
      appendFileSync(transcript, event === 'UserPromptSubmit' ? `${JSON.stringify({ type: 'user', uuid: `t${++n}`, promptId: extra.prompt_id, message: { role: 'user', content: 'go' }, origin: { kind: 'human' } })}\n` : '');
      return hookLine(ulid(Date.now() + ++n), event, { session_id: session, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid, agent, ...wire });
    };
    return { line, sock: join(root, 'hub.sock') };
  };
  const owner = async (root: string): Promise<string | undefined> => {
    for (const end = Date.now() + 10_000; Date.now() < end; await pause(50)) { const got = stopOwner(root); if (got) return got; }
    return undefined;
  };

  it('holds no other session\'s hook while it tries', async () => {
    await withHub(async (root, home) => {
      // Reserved for documentation (RFC 5737): a connection there hangs until the try's limit.
      const { line, sock } = world(root, home, { ANTHROPIC_BASE_URL: 'https://192.0.2.1' });
      for (const s of [SESSION, OTHER]) {
        await send(sock, line(s, 'SessionStart', { source: 'startup' }));
        await send(sock, line(s, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' }));
      }
      await send(sock, line(SESSION, 'StopFailure', { error: 'server_error', prompt_id: 'p1' }));
      const at = Date.now();
      await reply(sock, line(OTHER, 'UserPromptSubmit', { prompt: 'again', prompt_id: 'p2' }));
      expect(Date.now() - at, 'the other session\'s prompt did not wait for the try').toBeLessThan(1000);
      expect(await owner(root), 'the failed try still made the stop yours').toBe('you');
    });
  }, 60_000);

  it('never tries for another agent that runs Claude Code\'s hooks', async () => {
    await withHub(async (root, home) => {
      // Nothing listens on port 9 here: Claude Code's stop would read as yours.
      const { line, sock } = world(root, home, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }, 'grok');
      await send(sock, line(SESSION, 'SessionStart', { source: 'startup' }));
      await send(sock, line(SESSION, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' }));
      await send(sock, line(SESSION, 'StopFailure', { error: 'server_error', prompt_id: 'p1' }));
      expect(await owner(root)).toBe('service');
    });
  }, 60_000);

  it('keeps a stop the hub is told to stop during', async () => {
    await withHub(async (root, home, { restart }) => {
      const { line, sock } = world(root, home, { ANTHROPIC_BASE_URL: 'https://192.0.2.1' });
      await send(sock, line(SESSION, 'SessionStart', { source: 'startup' }));
      await send(sock, line(SESSION, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' }));
      await send(sock, line(SESSION, 'StopFailure', { error: 'server_error', prompt_id: 'p1' }));
      await restart();
      expect(await owner(root), 'the acknowledged stop reached the record').toBe('you');
    });
  }, 60_000);

  it('makes one try per host for a whole spool, so a replay holds later hooks for one try at most', async () => {
    await withHub(async (root, home) => {
      const { line, sock } = world(root, home, { ANTHROPIC_BASE_URL: 'https://192.0.2.1' });
      const sessions = [SESSION, OTHER, '3b9f1c2e-1111-4222-8333-44445555cccc'];
      for (const s of sessions) {
        await send(sock, line(s, 'SessionStart', { source: 'startup' }));
        await send(sock, line(s, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' }));
      }
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), sessions.map((s) => line(s, 'StopFailure', { error: 'server_error', prompt_id: 'p1' }, { late: true })).join(''), { mode: 0o600 });
      const at = Date.now();
      await reply(sock, line(OTHER, 'UserPromptSubmit', { prompt: 'again', prompt_id: 'p2' }));
      expect(Date.now() - at, 'a prompt behind the replay waits for one try, not three').toBeLessThan(3000);
      expect(await owner(root), 'the replayed stop was tried').toBe('you');
    });
  }, 60_000);

  it('tries a stop replayed from the spool', async () => {
    await withHub(async (root, home) => {
      const { line, sock } = world(root, home, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
      await send(sock, line(SESSION, 'SessionStart', { source: 'startup' }));
      await send(sock, line(SESSION, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' }));
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), line(SESSION, 'StopFailure', { error: 'server_error', prompt_id: 'p1' }, { late: true }), { mode: 0o600 });
      await send(sock, line(OTHER, 'SessionStart', { source: 'startup' }));
      expect(await owner(root)).toBe('you');
    });
  }, 60_000);
});

describe('the host a session\'s API calls go to', () => {
  const home = process.env.HOME;
  afterEach(() => { process.env.HOME = home; });
  it('skips a value with no http scheme or no host', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reach-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.claude'));
    process.env.HOME = dir;
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { HTTPS_PROXY: 'proxy.corp:8080', ANTHROPIC_BASE_URL: 'https://gateway.corp:8443' } }));
    expect(apiHost()).toBe('gateway.corp:8443');
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'localhost:4000' } }));
    expect(apiHost()).toBe('api.anthropic.com:443');
  });
});
