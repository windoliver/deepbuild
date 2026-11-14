// #2066: a `rule:` or `rejected:` line is saved as yours only from a prompt whose own recorded origin is a person.
// Real CLI hub on a temp home, real hook requests over its socket, real Claude Code transcript entries (fixture text only),
// a real process per session (its ppid), the record read from ledger.db read-only and guards from the real rules.json.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ulid } from '../../../packages/hub/src/wire.js';
import { hookLine, reply, session, withHub } from '../../../packages/hub/test/hub.js';

type Origin = 'person' | 'scheduled' | 'session' | 'subagent' | 'continuation' | 'unknown';
type Reply = { exit: number; stdout: string; stderr: string };
type Row = { kind: string; text: string; values: unknown[] };

// Transcript fields per origin, as adapters/claude-code.facts.json reads them (UserPromptSubmit origin rules).
const QUIT = 'The app was quit while you were working.';
const PEER = 'local_8f6f9e9a-898e-4858-aefe-44dfc1b77684';
const AGENT = 'a2711031fe8c87e48';
const FIELDS: Record<Origin, (text: string) => Record<string, unknown>> = {
  person: () => ({ origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }),
  scheduled: () => ({ isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled' }),
  session: () => ({ isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer', origin: { kind: 'peer', from: PEER, hostInjected: true } }),
  subagent: (text) => ({ isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: AGENT, senderTaskId: AGENT, name: 'general-purpose', body: text, handback: true, handbackReportText: text } }),
  continuation: () => ({ isMeta: true, promptSource: 'system' }),
  unknown: () => ({ isMeta: true, promptSource: 'system' }),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits for something that must appear (a typed twin's save), never used to prove an absence. */
const until = async (f: () => boolean, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end && !f(); await sleep(50)); };

const decode = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : typeof v === 'bigint' ? String(v) : v);
function events(root: string, where: string, ...args: (string | number)[]): Row[] {
  const file = join(root, 'ledger.db');
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare(`SELECT * FROM events WHERE ${where}`).all(...args) as Record<string, unknown>[]).map((r) => {
      const values = Object.values(r).map(decode);
      return { kind: String(r.kind), values, text: values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') };
    });
  } finally { db.close(); }
}
const find = (v: unknown): string[] => {
  if (typeof v === 'string') { try { const p: unknown = JSON.parse(v); return typeof p === 'string' && p === v ? [] : find(p); } catch { return []; } }
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => (k === 'target' && typeof x === 'string' ? [x] : find(x)));
  return [];
};
/** learn.applied events whose change carries `token`, each shown by its target(s), or its raw text when it names none. */
const applied = (root: string, token: string) => events(root, 'kind = ?', 'learn.applied').filter((e) => e.text.includes(token));
const shownTargets = (rows: Row[]) => rows.map((e) => find(e.values).join(', ') || e.text);
/** Decisions saved naming `word` (event kinds decision.*). */
const decisions = (root: string, word: string) => events(root, "kind LIKE 'decision%'").filter((e) => e.text.includes(word));
/** The session's own notes that a rule line wasn't saved, naming the origin (any event but the prompt itself). */
const NOTE = /(not|n't|never)\s+(been\s+)?saved|saved nothing|unsaved/i;
const notes = (root: string, sessionId: string, origin: string) =>
  events(root, 'session_id = ? AND kind <> ?', sessionId, 'user.ask').filter((e) => NOTE.test(e.text) && e.text.includes(origin));
const guardWords = (file: string) =>
  existsSync(file) ? Object.values((JSON.parse(readFileSync(file, 'utf8')) as { entries?: Record<string, { match: string }> }).entries ?? {}).map((e) => e.match) : [];

// Processes this test starts, stopped by PID and awaited before the hub's home is removed.
const procs: ChildProcess[] = [];
const stopAll = () => Promise.all(procs.splice(0).map((p) => new Promise<void>((resolve) => {
  if (p.exitCode !== null || p.signalCode !== null) return resolve();
  p.once('exit', () => resolve());
  p.kill('SIGTERM');
})));

/** An open Claude Code session on the hub: its own process, its transcript, and hooks answered with completed replies. */
async function open(root: string, home: string) {
  const id = randomUUID();
  const s = session(home, id);
  const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  procs.push(proc);
  let parent: string | null = null;
  const hook = (event: string, extra: Record<string, unknown> = {}): Promise<Reply> =>
    reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, s.payload(event, { permission_mode: 'default', ...extra }), { ppid: proc.pid }));
  /** Writes the prompt's own transcript entry with `origin`'s fields; returns its prompt id and text. */
  const record = (origin: Origin, body: string) => {
    const text = origin === 'continuation' ? `${QUIT}\n${body}` : body;
    const promptId = randomUUID();
    const uuid = randomUUID();
    const line = { parentUuid: parent, isSidechain: false, promptId, type: 'user', message: { role: 'user', content: text }, ...FIELDS[origin](text), uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.work, sessionId: id, version: '2.1.304', gitBranch: 'main' };
    writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
    parent = uuid;
    return { promptId, text };
  };
  const submit = (p: { promptId?: string; text: string }) => hook('UserPromptSubmit', { prompt: p.text, ...(p.promptId ? { prompt_id: p.promptId } : {}) });
  const started = await hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  if (started.exit !== 0) throw Error(`BLOCKED: SessionStart must end with exit 0: ${JSON.stringify(started)}`);
  return { id, hook, record, submit, prompt: (origin: Origin, body: string) => submit(record(origin, body)) };
}
type Open = Awaited<ReturnType<typeof open>>;

function world(body: (root: string, open: () => Promise<Open>) => Promise<void>) {
  return withHub(async (root, home) => {
    try { await body(root, () => open(root, home)); } finally { await stopAll(); }
  });
}

/** Your typed twin: saved once from session `a`, it is the barrier that proves the hub finished every earlier prompt. */
async function typedTwin(root: string, a: Open, token: string) {
  const r = await a.prompt('person', `Please. rule: keep the ${token} ledger tidy.`);
  await until(() => applied(root, token).length > 0);
  return r;
}

describe('#2066 a rule line is saved only from a prompt a person typed', () => {
  it.each(['scheduled', 'session', 'subagent', 'continuation', 'unknown'] as const)(
    'a %s prompt saves no rule and no other session gets it; the typed twin is saved once and reaches a second open session',
    async (origin) => {
      await world(async (root, openSession) => {
        const a = await openSession();
        const b = await openSession();
        const token = `zq-${origin}`;
        await a.prompt(origin, `Wake-up note. rule: keep the ${token} ledger tidy.`);
        await a.prompt(origin, `Second wake-up. rule: keep the ${token}-again ledger tidy.`);
        await typedTwin(root, a, 'zq-typed');
        const next = await b.prompt('person', 'What is next?');

        expect.soft(shownTargets(applied(root, token)), `a ${origin} prompt's rule line was saved as yours; learn.applied target(s) listed`).toEqual([]);
        expect.soft(next.stdout, `the rule from the ${origin} prompt reached the second open session`).not.toContain(token);
        expect.soft(applied(root, 'zq-typed').length, 'the rule you typed is saved once (learn.applied)').toBe(1);
        expect.soft(next.stdout, 'the rule you typed reaches the second open session at its next prompt').toContain('zq-typed');
        expect.soft(notes(root, a.id, origin).length, `the session's record says once that a rule line was not saved, naming "${origin}"`).toBe(1);
      });
    },
    180_000,
  );

  it('a prompt with no recorded origin saves nothing; the typed twin still does', async () => {
    await world(async (root, openSession) => {
      const a = await openSession();
      await a.submit({ promptId: randomUUID(), text: 'rule: keep the zq-unrecorded ledger tidy.' });
      await a.submit({ text: 'rule: keep the zq-noprompt ledger tidy.' });
      await typedTwin(root, a, 'zq-typed');
      expect.soft(shownTargets(applied(root, 'zq-unrecorded')), 'a prompt with no transcript entry saved its rule; learn.applied target(s)').toEqual([]);
      expect.soft(shownTargets(applied(root, 'zq-noprompt')), 'a prompt with no prompt_id saved its rule; learn.applied target(s)').toEqual([]);
      expect.soft(applied(root, 'zq-typed').length, 'the rule you typed is saved once').toBe(1);
    });
  }, 180_000);

  it("the origin is the prompt's own, not the latest entry's; rules you typed still reach an automatic prompt", async () => {
    await world(async (root, openSession) => {
      const a = await openSession();
      const b = await openSession();
      // A scheduled prompt whose hook arrives after a person's entry was written behind it.
      const tick = a.record('scheduled', 'Tick. rule: keep the zq-tick ledger tidy.');
      a.record('person', 'Thanks, carry on.');
      await a.submit(tick);
      // A typed prompt whose hook arrives after a scheduled entry was written behind it.
      const mine = a.record('person', 'Note this. rule: keep the zq-mine ledger tidy.');
      a.record('scheduled', 'Tick again.');
      await a.submit(mine);
      await until(() => applied(root, 'zq-mine').length > 0);
      const auto = await b.prompt('scheduled', 'Scheduled check-in.');

      expect.soft(shownTargets(applied(root, 'zq-tick')), 'a scheduled prompt was judged by a later person entry; learn.applied target(s)').toEqual([]);
      expect.soft(applied(root, 'zq-mine').length, 'a typed prompt was judged by a later scheduled entry: not saved once').toBe(1);
      expect.soft(auto.stdout, "a rule you typed earlier reaches the second session's automatic prompt").toContain('zq-mine');
      expect.soft(auto.stdout, 'the scheduled rule reached the second session').not.toContain('zq-tick');
    });
  }, 180_000);

  it('a rejected: line in a scheduled prompt saves no decision and no guard entry; typed by you it saves both', async () => {
    await world(async (root, openSession) => {
      const file = join(root, 'rules.json');
      writeFileSync(file, JSON.stringify({ v: 1, entries: {} }));
      const a = await openSession();
      await a.prompt('scheduled', 'Not that. rejected: `zqkafka`.');
      await a.prompt('person', 'Not that. rejected: `zqredis`.');
      await until(() => guardWords(file).includes('word:zqredis') && decisions(root, 'zqredis').length > 0);

      expect.soft(decisions(root, 'zqkafka').map((e) => e.kind), 'a scheduled prompt saved a decision as yours').toEqual([]);
      expect.soft(guardWords(file), 'a scheduled prompt wrote a guard entry').not.toContain('word:zqkafka');
      expect.soft(decisions(root, 'zqredis').length, 'the rejection you typed saves a decision').toBeGreaterThan(0);
      expect.soft(guardWords(file), 'the rejection you typed writes a guard entry').toContain('word:zqredis');
    });
  }, 180_000);
});
