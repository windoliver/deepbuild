// #2066, blind redraft: a `rule:` or `rejected:` line is saved only from a prompt whose recorded origin is a person.
// Every write goes through public hooks of a real `deep hub run` (packages/hub/test/hub.ts's withHub, hookLine, reply,
// session). The record is read read-only from ledger.db. A completed hook reply, or a positive control that must
// appear, is awaited before any claim that something is absent. See README.md.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hookLine, reply, session, withHub } from '../../../../packages/hub/test/hub.ts';

type Row = Record<string, unknown>;
type Out = { exit: number; stdout: string; stderr: string };
const NON_PERSON = ['scheduled', 'session', 'subagent', 'continuation', 'unknown'] as const;
// Claude Code's own resume prompt; the facts map a prompt that starts with it to `continuation`.
const RESUME = 'The app was quit while you were working.';
const PEER = '8f6f9e9a-898e-4858-aefe-44dfc1b77684';
const SUB = 'a2711031fe8c87e48';
// Each prompt ends with a question, so no prompt opens a task (and no drafting job) beside what is tested.
const lineOf = (origin: string): string => `Keep the changelog current for ${origin} work`;
const ruleText = (origin: string, line = lineOf(origin)): string => `${origin === 'continuation' ? `${RESUME}\n` : ''}rule: ${line}.\nSound good?`;
const CONTROL = 'Name every branch after its issue number';
const REJ = 'leftpad';
const CONTROL_REJ = 'rightpad';

/** The transcript entry fields Claude Code writes for each origin (shapes from tests/acceptance/303/helpers.ts). */
const ENTRY: Record<string, (text: string) => Row> = {
  person: () => ({ origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }),
  scheduled: () => ({ isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled' }),
  session: () => ({ isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer', origin: { kind: 'peer', from: `local_${PEER}`, hostInjected: true } }),
  subagent: (text) => ({ isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: SUB, senderTaskId: SUB, name: 'general-purpose', body: text, handback: true, handbackReportText: text } }),
  continuation: () => ({ isMeta: true, promptSource: 'system' }),
  unknown: () => ({ promptSource: 'system' }),
};

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID, as deep-hook mints a hook's event ID. */
function ulid(): string {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) { time = B32[t % 32]! + time; t = Math.floor(t / 32); }
  return time + [...randomBytes(16)].map((b) => B32[b % 32]!).join('');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Polls for a fact that must come true (a positive barrier), up to 15 s; the fact then. */
async function until(fact: () => boolean): Promise<boolean> {
  for (const end = Date.now() + 15_000; Date.now() < end && !fact(); await sleep(100));
  return fact();
}
const query = (root: string, sql: string, ...params: (string | number)[]): Row[] => {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...params) as Row[]; } finally { db.close(); }
};
const learned = (root: string) => query(root, `SELECT json_extract(data, '$.target') AS target, json_extract(data, '$.diff') AS diff FROM events WHERE kind = 'learn.applied'`) as { target: string; diff: string }[];
const targetsOf = (root: string, line: string): string[] => learned(root).filter((l) => l.diff === `+ ${line}`).map((l) => l.target);
const fromOf = (root: string, hook: string): unknown => query(root, `SELECT json_extract(data, '$.from') AS f FROM events WHERE id = ? AND kind = 'user.ask'`, hook)[0]?.f;
const decisions = (root: string, word: string): number => query(root, `SELECT 1 FROM events WHERE kind = 'decision.created' AND json_extract(data, '$.answer') = ?`, `rejected: \`${word}\``).length;
const guards = (root: string, word: string): string[] => {
  const file = join(root, 'rules.json');
  const entries = existsSync(file) ? ((JSON.parse(readFileSync(file, 'utf8')) as { entries?: Record<string, { match?: string }> }).entries ?? {}) : {};
  return Object.entries(entries).filter(([, e]) => e.match === `word:${word}`).map(([name]) => name);
};
const readings = (root: string, sid: string): string[] => query(root, `SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading' AND session_id = ? ORDER BY log_pos`, sid).map((r) => String(r.r));
/** A reading that says a rule line was not saved, naming the origin (README: the reading's words are not fixed). */
const refusals = (all: string[], origin: string): string[] => all.filter((r) => /\brule\b/i.test(r) && new RegExp(`\\b${origin}\\b`, 'i').test(r) && /\b(not|nothing|never|no)\b|n't/i.test(r));
const heard = (out: Out, text: string): boolean => JSON.stringify(out).includes(text);

/** A Claude Code session on the hub: its transcript where Claude Code keeps it, its hooks from `agent`'s process. */
async function open(root: string, home: string, agent: number) {
  const id = randomUUID();
  const s = session(home, id);
  const sock = join(root, 'hub.sock');
  const hook = async (event: string, extra: Row) => { const hid = ulid(); return { id: hid, out: await reply(sock, hookLine(hid, event, s.payload(event, extra), { ppid: agent })) }; };
  await hook('SessionStart', { source: 'startup' });
  let parent: string | null = null;
  /** A prompt: its transcript entry with `origin`'s fields first (none when `joined` is false), then its UserPromptSubmit. */
  const prompt = (origin: string, text: string, joined = true) => {
    const promptId = randomUUID();
    if (joined) {
      const uuid = randomUUID();
      appendFileSync(s.transcript, `${JSON.stringify({ parentUuid: parent, isSidechain: false, type: 'user', message: { role: 'user', content: text }, promptId, uuid, timestamp: new Date().toISOString(), sessionId: id, cwd: s.work, ...ENTRY[origin]!(text) })}\n`);
      parent = uuid;
    }
    return hook('UserPromptSubmit', { prompt: text, ...(joined ? { prompt_id: promptId } : {}) });
  };
  return { id, prompt };
}

/** One Claude Code stand-in process per test, the parent every session's hooks name; stopped by its PID. */
async function withAgent(body: (pid: number) => Promise<void>): Promise<void> {
  const agent: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '' } });
  try { await body(agent.pid!); } finally { agent.kill('SIGTERM'); }
}

describe('#2066 rules and rejections come only from prompts a person typed', () => {
  it('AC1 #2066.be686212 AC2 #2066.0f5e890b AC4 #2066.99a5e19f a rule: or rejected: line in a prompt of any other origin saves nothing, reaches no open session, and is said once, naming the origin', async () => {
    await withAgent((agent) => withHub(async (root, home) => {
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: {} }));
      const observer = await open(root, home, agent);
      await observer.prompt('person', 'Hello there, are you set up?');
      const sent: { origin: string; sid: string; hooks: string[]; before: number }[] = [];
      for (const origin of NON_PERSON) {
        const s = await open(root, home, agent);
        // A person's prompt first: the origin read must be this prompt's own, not the session's last one.
        await s.prompt('person', 'Hello, ready?');
        const before = readings(root, s.id).length;
        const first = await s.prompt(origin, ruleText(origin));
        const again = await s.prompt(origin, ruleText(origin));
        sent.push({ origin, sid: s.id, hooks: [first.id, again.id], before });
      }
      // No recorded origin: a prompt that joins no transcript entry (no prompt_id).
      const loose = await open(root, home, agent);
      await loose.prompt('person', 'Hello, ready?');
      const none = await loose.prompt('unknown', ruleText('unplaced'), false);
      // The rejected: line in a scheduled prompt.
      const rs = await open(root, home, agent);
      await rs.prompt('person', 'Hello, ready?');
      const rejected = await rs.prompt('scheduled', `No. rejected: \`${REJ}\`.\nSound good?`);
      // The positive control: a person's rule and rejection, after a scheduled prompt in the same session.
      const control = await open(root, home, agent);
      await control.prompt('scheduled', 'Wake up, is anything due?');
      await control.prompt('person', `rule: ${CONTROL}.\nNo. rejected: \`${CONTROL_REJ}\`.\nSound good?`);
      const next = await observer.prompt('person', 'Carry on with the plan?');

      expect.soft(targetsOf(root, CONTROL).length, `control: a person's rule line is saved as learn.applied; saved targets ${JSON.stringify(learned(root))}`).toBe(1);
      expect.soft(heard(next.out, CONTROL), `control: the open observer session's next prompt carries the rule a person typed; its reply ${JSON.stringify(next.out).slice(0, 600)}`).toBe(true);
      for (const { origin, sid, hooks, before } of sent) {
        for (const hook of hooks) {
          await until(() => fromOf(root, hook) !== undefined);
          expect.soft(fromOf(root, hook), `the prompt sent as ${origin} is recorded with origin ${origin}`).toBe(origin);
        }
        const targets = targetsOf(root, lineOf(origin));
        expect.soft(targets, `origin ${origin}: its rule line appended learn.applied for target(s) ${JSON.stringify(targets)}`).toEqual([]);
        expect.soft(heard(next.out, lineOf(origin)), `origin ${origin}: the open observer session's next prompt carried its rule (targets ${JSON.stringify(targets)})`).toBe(false);
        await until(() => refusals(readings(root, sid).slice(before), origin).length > 0);
        const said = refusals(readings(root, sid).slice(before), origin);
        expect.soft(said.length, `origin ${origin}: after two prompts with the same rule line, the session's record says once that it was not saved, naming ${origin}; it said ${JSON.stringify(said)}`).toBe(1);
      }
      await until(() => fromOf(root, none.id) !== undefined);
      expect.soft(fromOf(root, none.id), 'a prompt that joins no transcript entry is not recorded as a person\'s').not.toBe('person');
      const loose_targets = targetsOf(root, lineOf('unplaced'));
      expect.soft(loose_targets, `no recorded origin (${String(fromOf(root, none.id))}): its rule line appended learn.applied for target(s) ${JSON.stringify(loose_targets)}`).toEqual([]);
      expect.soft(heard(next.out, lineOf('unplaced')), `no recorded origin: the observer's next prompt carried its rule (targets ${JSON.stringify(loose_targets)})`).toBe(false);

      // Positive barrier: the person's rejection is saved and its guard written before the scheduled one is judged absent.
      expect.soft(await until(() => decisions(root, CONTROL_REJ) > 0 && guards(root, CONTROL_REJ).length > 0), `control: a person's rejected: \`${CONTROL_REJ}\` saves a decision and a guard entry`).toBe(true);
      await until(() => fromOf(root, rejected.id) !== undefined);
      expect.soft(fromOf(root, rejected.id), 'the rejected: prompt sent as scheduled is recorded with origin scheduled').toBe('scheduled');
      expect.soft(decisions(root, REJ), `origin scheduled: rejected: \`${REJ}\` saved a decision`).toBe(0);
      expect.soft(guards(root, REJ), `origin scheduled: rejected: \`${REJ}\` wrote guard entr(ies) ${JSON.stringify(guards(root, REJ))}`).toEqual([]);
    }));
  }, 180_000);

  it('AC3 #2066.6caf3df8 AC4 #2066.99a5e19f the same lines typed by you are saved once, and reach open sessions at their next prompt, a person\'s or an automatic one', async () => {
    await withAgent((agent) => withHub(async (root, home) => {
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: {} }));
      const line = lineOf('scheduled');
      const typedNext = await open(root, home, agent);
      await typedNext.prompt('person', 'Hello there, are you set up?');
      const autoNext = await open(root, home, agent);
      await autoNext.prompt('person', 'Hello there, are you set up?');
      const you = await open(root, home, agent);
      // A scheduled prompt first: the origin read must be this prompt's own, not the session's last one.
      await you.prompt('scheduled', 'Wake up, is anything due?');
      const typed = await you.prompt('person', `rule: ${line}.\nNo. rejected: \`${REJ}\`.\nSound good?`);
      await you.prompt('person', ruleText('scheduled'));
      const next = await typedNext.prompt('person', 'Carry on with the plan?');
      const auto = await autoNext.prompt('scheduled', 'Wake up, is anything due?');

      await until(() => fromOf(root, typed.id) !== undefined);
      expect.soft(fromOf(root, typed.id), 'the typed prompt is recorded with origin person').toBe('person');
      const targets = targetsOf(root, line);
      expect.soft(targets.length, `origin person: the rule line, typed twice, is saved once; target(s) ${JSON.stringify(targets)}`).toBe(1);
      expect.soft(heard(next.out, line), `origin person (target(s) ${JSON.stringify(targets)}): a second open session's next prompt carries the rule; its reply ${JSON.stringify(next.out).slice(0, 600)}`).toBe(true);
      expect.soft(heard(auto.out, line), `origin person (target(s) ${JSON.stringify(targets)}): an open session whose next prompt is scheduled is still given your rule; its reply ${JSON.stringify(auto.out).slice(0, 600)}`).toBe(true);
      expect.soft(await until(() => decisions(root, REJ) > 0), `origin person: rejected: \`${REJ}\` saves your decision`).toBe(true);
      expect.soft(await until(() => guards(root, REJ).length > 0), `origin person: rejected: \`${REJ}\` writes a guard entry word:${REJ}; rules.json has ${existsSync(join(root, 'rules.json')) ? readFileSync(join(root, 'rules.json'), 'utf8').slice(0, 400) : 'nothing'}`).toBe(true);
    }));
  }, 180_000);
});
