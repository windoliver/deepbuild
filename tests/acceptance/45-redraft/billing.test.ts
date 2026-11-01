// #45 AC6 (in part): a session started with ANTHROPIC_API_KEY set shows as billing an API key, and the key's value is
// stored nowhere. The real deep-hook binary, as an agent's hook entry runs it, against a real hub; `deep status` read as
// you read it. README: Surfaces chosen.

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, expect, test } from 'vitest';
import {
  childEnv, cleanup, deep, eventMatching, filesHolding, forms, makeHome, makeWorktree, own, REPO, startHub, stopHub,
} from '../26/helpers.ts';

afterEach(cleanup, 30_000);

// A proof lane's checkout has no target folder, so the hook is built when it is missing.
beforeAll(() => {
  if (!existsSync(join(REPO, 'target/debug/deep-hook'))) spawnSync('cargo', ['build', '-p', 'deep-hook'], { cwd: REPO, stdio: 'ignore' });
}, 600_000);

const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** An obvious fixture, no real credential. */
const KEY_VALUE = 'sk-ant-FIXTURE-not-a-real-key-45redraft-0123456789abcdef';

/** The billing settings the test process may have inherited: none reaches a hook unless the test gives it. */
const NO_BILLING = { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined, CLAUDE_CODE_USE_BEDROCK: undefined, CLAUDE_CODE_USE_VERTEX: undefined, OPENAI_API_KEY: undefined };

interface Hooked { code: number | null; stdout: string; stderr: string }
/** `deep-hook claude-code SessionStart` with the hook JSON on stdin, in the environment the agent gives it. */
function sessionStart(home: string, cwd: string, session: string, env: Record<string, string | undefined>): Promise<Hooked> {
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: 'start' } })}\n`);
  const payload = { session_id: session, transcript_path: transcript, cwd, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-5-5', permission_mode: 'default' };
  return new Promise((resolve) => {
    const child = spawn(DEEP_HOOK, ['claude-code', 'SessionStart'], { cwd, env: childEnv(home, { CLAUDECODE: '1', ...NO_BILLING, ...env }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

/** A session's row in `deep status`: its line, by the session's first 8 characters, and the deeper lines under it. */
function rowOf(listing: string, session: string): string {
  const lines = listing.split('\n');
  const at = lines.findIndex((l) => l.includes(session.slice(0, 8)));
  if (at < 0) return '';
  const row = [lines[at]!];
  for (let i = at + 1; i < lines.length && /^ {4,}/.test(lines[i]!); i++) row.push(lines[i]!);
  return row.join('\n');
}

test('#45.4768ed8f AC6 a session started with ANTHROPIC_API_KEY set shows as billing an API key, its twin without the key does not, and the value is stored nowhere', async () => {
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: no deep-hook at ${DEEP_HOOK}; cargo build -p deep-hook failed`);
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home);

  const keyed = randomUUID();
  const plain = randomUUID();
  const hooks = [
    await sessionStart(home, wt.path, keyed, { ANTHROPIC_API_KEY: KEY_VALUE }),
    await sessionStart(home, wt.path, plain, {}),
  ];
  for (const h of hooks) if (h.code !== 0) throw Error(`BLOCKED: deep-hook exited ${h.code}: ${h.stdout}${h.stderr}`);
  for (const id of [keyed, plain]) {
    const started = await eventMatching(hub, (e) => e.kind === 'session.start' && e.data?.thread === id, 20_000);
    if (!started) throw Error(`BLOCKED: the hub recorded no session.start for ${id}: ${hub.output().slice(0, 1500)}`);
  }

  const status = await deep(home, ['status']);
  if (status.code !== 0) throw Error(`BLOCKED: deep status exited ${status.code}: ${status.stdout}${status.stderr}`);
  await stopHub(hub);

  // The value: in no file under the test's folder (the hub's root, its database and log, the spool, the transcripts,
  // the worktree), in any form the design scrubs, and in nothing the hook, the hub or `deep status` printed.
  const needles = forms(KEY_VALUE);
  expect(filesHolding(tmp, needles), 'the key\'s value is stored nowhere').toEqual([]);
  const printed = [...hooks.flatMap((h) => [h.stdout, h.stderr]), hub.output(), status.stdout, status.stderr].join('\n');
  expect(needles.filter((n) => printed.includes(n)), 'the key\'s value is printed nowhere').toEqual([]);

  const row = rowOf(status.stdout, keyed);
  expect(row, `deep status lists the session started with the key:\n${status.stdout}`).not.toBe('');
  expect(row, `the session started with ANTHROPIC_API_KEY set shows as billing an API key:\n${status.stdout}`).toMatch(/api[ _-]?key/i);
  const twin = rowOf(status.stdout, plain);
  expect(twin, `deep status lists the session started without the key:\n${status.stdout}`).not.toBe('');
  expect(twin, `the session started without a key does not show as billing one:\n${status.stdout}`).not.toMatch(/(?<!\bno |\bnot |\bwithout )api[ _-]?key/i);
}, 120_000);
