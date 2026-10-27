// Threads, not IDs (#18): `/clear` and a fork rotate a Claude Code session's ID, and the hub joins the IDs into one
// thread; an agent another agent's process started is linked as its child. Replays the recorded clear set of the
// corpus (Claude Code 2.1.304), each session's hooks coming from a stand-in agent process the test starts.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const SET = fileURLToPath(new URL('../../../adapters/corpus/claude-code/2.1.304/clear/', import.meta.url));
const jsonl = (file: string) => readFileSync(join(SET, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const cases = jsonl('events.jsonl') as { payload: Record<string, unknown>; expect: { kind: string; data: Record<string, unknown> }[] }[];
const payloads = cases.map((c) => c.payload);
const starts = payloads.filter((p) => p.hook_event_name === 'SessionStart');
const [first, cleared, forked] = starts.map((p) => String(p.session_id));
const CHILD = '0b7c2d4e-5555-4666-8777-888899990000';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
/** A stand-in agent process with these arguments; it prints the PIDs it lists, then idles. */
function agent(args: string[], code = 'setInterval(() => {}, 1000); console.log(process.pid)'): Promise<number[]> {
  const proc = spawn(process.execPath, ['-e', code, '--', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  return new Promise((resolve) => proc.stdout!.once('data', (d) => resolve(String(d).trim().split(/\s+/).map(Number))));
}

describe('threads across rotated session IDs', () => {
  it('joins the ID /clear rotates and a --fork-session fork into the first session\'s thread, and links an agent another agent started as its child', async () => {
    // The first two sessions share one Claude Code process, which also starts a child agent; the fork is a new process.
    const [claude, child] = await agent([], "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(process.pid, c.pid); setInterval(() => {}, 1000); process.on('SIGTERM', () => { c.kill(); process.exit(); })");
    const [fork] = await agent(['--resume', cleared!, '--fork-session']);
    await withHub(async (root, home) => {
      const projects = join(home, '.claude', 'projects', 'work');
      mkdirSync(projects, { recursive: true });
      const sendAs = async (payload: Record<string, unknown>, ppid: number) => {
        const transcript = join(projects, `${String(payload.session_id)}.jsonl`);
        // The fork's transcript is whole before its first hook reaches the hub, as for a hub that meets it late.
        if (payload === starts[2]) writeFileSync(transcript, jsonl('transcript.jsonl').filter((e) => e.sessionId === forked).map((e) => `${JSON.stringify(e)}\n`).join(''));
        writeFileSync(transcript, '', { flag: 'a' });
        await send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), String(payload.hook_event_name), { ...payload, transcript_path: transcript }, { ppid }));
      };
      for (const payload of payloads.filter((p) => p.hook_event_name === 'SessionStart' || p.hook_event_name === 'SessionEnd' || p.session_id === forked)) {
        await sendAs(payload, payload.session_id === forked ? fork! : claude!);
        // While the session /clear started is open, its process starts another agent.
        if (payload === starts[1]) await sendAs({ ...starts[0], session_id: CHILD, source: 'startup' }, child!);
      }

      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      type Row = { id: string; thread_id: string | null; parent_id: string | null };
      const rows = (): Map<string, Row> => new Map((db.prepare('SELECT id, thread_id, parent_id FROM sessions').all() as Row[]).map((r) => [r.id, r]));
      const stopOf = () => db.prepare("SELECT data FROM events WHERE kind = 'agent.stop' AND session_id = ?").get(forked!) as { data: string } | undefined;
      try {
        for (const until = Date.now() + 10_000; Date.now() < until && !(rows().get(CHILD)?.parent_id && stopOf()); await new Promise((r) => setTimeout(r, 50)));
        const got = rows();
        expect(got.get(first!)?.thread_id, 'the first session starts its own thread').toBe(first);
        expect(got.get(cleared!)?.thread_id, `the session /clear started (${cleared}) joins the first one's thread`).toBe(first);
        expect(got.get(forked!)?.thread_id, `the fork of ${cleared} (${forked}) joins its thread`).toBe(first);
        expect(got.get(CHILD)?.thread_id, 'an agent another agent started has a thread of its own').toBe(CHILD);
        expect(got.get(CHILD)?.parent_id, 'and is linked to the live session of the agent process that started it').toBe(cleared);
        // The fork's transcript starts with copies of the forked session's turn under the fork's first prompt ID;
        // its stop counts only its own turn, as the reviewed corpus line says.
        const { input, cached, output } = cases.find((c) => c.payload.session_id === forked && c.payload.hook_event_name === 'Stop')!.expect[0]!.data.usage as Record<string, unknown>;
        expect(JSON.parse(stopOf()?.data ?? '{}').usage, `the fork's stop (${forked}) counts its own turn`).toMatchObject({ input, cached, output });
      } finally {
        db.close();
      }
    });
  }, 60_000);
});
