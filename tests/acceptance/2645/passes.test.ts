// #2645 AC4: a transcript with no task-list call returns nothing after one pass, and a transcript whose first megabyte
// was rewritten since the last read is read again from its start.
//
// Bytes read are counted in this process by #2365's instrument (tests/acceptance/2365/reads.ts: node:fs,
// node:fs/promises and FileHandle reads of a watched path), around one claim made in this process.
import { appendFileSync, closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { codexReadings } from '../../../packages/hub/src/codex-loops.ts';
import { watchReads, type Read } from '../2365/reads.ts';
import { removeTemps as removeTwentyTemps, T0 } from '../20/helpers.ts';
import { session as generated } from '../20/generate.ts';
import { baseCodexReadings, baseNewestList } from './merge-base.ts';
import {
  canon, claimer, everyItem, factsOf, fmt, goalCall, goalOutput, longText, must, planCall, planOutput, projection, removeTemps, show, tempDir, todoMention,
} from './helpers.ts';

const AC4 = 'AC4 #2645.a875ed8b';

afterAll(() => {
  removeTemps();
  removeTwentyTemps();
});

const summary = (reads: readonly Read[]): string => {
  const by = new Map<string, { calls: number; bytes: number }>();
  for (const r of reads) {
    const s = by.get(r.how) ?? { calls: 0, bytes: 0 };
    by.set(r.how, { calls: s.calls + 1, bytes: s.bytes + r.bytes });
  }
  return [...by].map(([how, s]) => `${s.calls} ${how} of ${fmt(s.bytes)} bytes`).join(', ') || 'no read';
};

describe(`${AC4} no task-list call, and a first megabyte rewritten`, () => {
  it(`${AC4} a Claude Code transcript with no task-list call, in which lines name TodoWrite and assign nothing, returns nothing after one pass: no item, and no byte read twice`, async () => {
    const dir = tempDir('none');
    const session = 'dh2645-none';
    // A 2.3 MB answer that names the tool at its start, #20's generator's work (Read, Bash and Edit calls) for 4 MB, a
    // Bash call whose command names the tool, and a typed prompt that names it last: none is a call of it.
    const answer = JSON.stringify({ type: 'assistant', sessionId: session, uuid: 'dh2645-answer', message: { role: 'assistant', content: [{ type: 'text', text: `TodoWrite is not needed here: ${longText()}` }] } });
    const grep = JSON.stringify({ type: 'assistant', sessionId: session, uuid: 'dh2645-grep', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_dh2645_grep', name: 'Bash', input: { command: 'grep -rn "TodoWrite" docs', description: 'Find TodoWrite in the docs' } }] } });
    const lines = [answer, ...generated(0x2645_4a, 4_000_000, T0).lines, grep, todoMention(session)];
    const path = join(dir, `${session}.jsonl`);
    writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
    const size = Buffer.byteLength(lines.map((l) => `${l}\n`).join(''));
    const claim = claimer(join(dir, 'repo'));
    const facts = everyItem(factsOf('claude-code'));
    const watch = await watchReads([path]);
    let items: string[];
    try {
      items = await claim(path, 'claude-code', facts);
    } finally {
      watch.stop();
    }
    must(items.length === 0, `${AC4} the claim on a ${fmt(size)}-byte transcript with no TodoWrite call recorded task items: ${show(items)}`);
    const bytes = watch.bytes(path);
    must(bytes <= size, `${AC4} the claim on a ${fmt(size)}-byte transcript with no TodoWrite call read ${fmt(bytes)} bytes of it (${summary(watch.reads)}): one pass reads no byte twice, so at most ${fmt(size)}`);
    if (bytes < size) throw new Error(`INCONCLUSIVE: ${AC4} the read counter saw ${fmt(bytes)} of the ${fmt(size)} bytes a reader must read to find no call (${summary(watch.reads)}): the claim read where this process's counter can't see, another thread or process, or a native addon`);
  }, 600_000);

  it(`${AC4} a Codex rollout whose first megabyte was rewritten since the last read, and which then grew, is read again from its start: the list and the readings after it are the merge base's for the rewritten file`, async () => {
    const dir = tempDir('rewrite');
    const thread = '019f2645-0000-7000-8000-000000000001';
    const [t1, t2, t3] = ['019f2645-0000-7000-8000-0000000000a1', '019f2645-0000-7000-8000-0000000000a2', '019f2645-0000-7000-8000-0000000000a3'];
    const at = (s: number): string => new Date(T0 + s * 1000).toISOString();
    const rec = (s: number, type: string, payload: Record<string, unknown>): string => JSON.stringify({ timestamp: at(s), type, payload });
    const tokens = (s: number, limits: Record<string, unknown>): string => rec(s, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1200 + s, output_tokens: 80 } }, rate_limits: { limit_id: 'codex', ...limits } });
    const turn = (s: number, id: string, text: string): string[] => [rec(s, 'event_msg', { type: 'task_started', turn_id: id }), rec(s + 1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] })];
    // The rollout as Codex wrote it, and as it reads once its first megabyte is rewritten: each changed value keeps its
    // length (0.160.0/0.144.0, active/paused, 40/90, team/plus, the plan's words, the output's letters' case), so every
    // line keeps its bytes' count and the file its size until it grows.
    const write = (rewritten: boolean): string[] => {
      const plan = [
        { step: rewritten ? 'Round the taxes once' : 'Round the total once', status: 'in_progress' },
        { step: rewritten ? 'Test the 東京 refund' : 'Test the 東京 prices', status: 'pending' },
      ];
      const out = [
        rec(0, 'session_meta', { id: thread, session_id: thread, timestamp: at(0), cwd: '/tmp/dh2645-work/shop', originator: 'codex_cli_rs', cli_version: rewritten ? '0.144.0' : '0.160.0', source: 'cli' }),
        ...turn(1, t1, 'make the checkout total round once'),
        goalCall('call_dh2645_g1'), goalOutput('call_dh2645_g1', thread, rewritten ? 'paused' : 'active'),
        planCall('call_dh2645_p1', plan), planOutput('call_dh2645_p1'),
        tokens(5, { primary: { used_percent: 20, window_minutes: 300 }, secondary: { used_percent: rewritten ? 90 : 40, window_minutes: 10080 }, plan_type: rewritten ? 'plus' : 'team' }),
      ];
      // Turn 1's work: shell output to past the second megabyte, its letters upper case in the rewrite.
      for (let n = 0, bytes = 0; bytes < 2_500_000; n++) {
        const text = Array.from({ length: 900 }, (_, i) => `ok ${n}.${i} checkout total rounds to ${i % 100} cents`).join('\n');
        const call = rec(10 + n, 'response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', `npm test -- --grep part-${n}`] }), call_id: `call_dh2645_s${n}` });
        const output = rec(10 + n, 'response_item', { type: 'function_call_output', call_id: `call_dh2645_s${n}`, output: rewritten ? text.toUpperCase() : text });
        out.push(call, output);
        bytes += call.length + output.length + 2;
      }
      out.push(rec(900, 'event_msg', { type: 'task_complete', turn_id: t1 }));
      out.push(...turn(901, t2, 'and the refund page'), tokens(903, { primary: { used_percent: 30, window_minutes: 300 }, plan_type: null }), rec(904, 'event_msg', { type: 'task_complete', turn_id: t2 }));
      return out;
    };
    const before = write(false);
    const after = write(true);
    const bytesOf = (lines: readonly string[]): Buffer => Buffer.from(lines.map((l) => `${l}\n`).join(''));
    if (bytesOf(before).length !== bytesOf(after).length || bytesOf(before).length < 2_000_000) throw new Error('BLOCKED: the rewrite must keep the rollout over 2 MB at the same size');
    const path = join(dir, 'codex-home', 'sessions', '2026', '11', '19', `rollout-2026-11-19T10-00-00-${thread}.jsonl`);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, bytesOf(before));

    const claim = claimer(join(dir, 'repo'));
    const facts = everyItem(factsOf('codex'));
    const read = async (turnId: string) => ({ list: await claim(path, 'codex', facts), readings: await codexReadings(thread, path, turnId, false) });
    const base = async (turnId: string) => ({ list: projection(facts, await baseNewestList(facts, path), join(dir, 'repo')), readings: await baseCodexReadings(thread, path, turnId, false) });

    // Turn 2's stop: the last read before the rewrite.
    const first = await read(t2);
    const firstBase = await base(t2);
    must(canon(first) === canon(firstBase), `${AC4} at turn 2's stop, before any rewrite, the hub's list and readings are not the merge base's: the merge base's ${show(firstBase)}; the hub's ${show(first)}`);

    // The first megabyte rewritten in place, then turn 3 appended.
    const fd = openSync(path, 'r+');
    try { writeSync(fd, bytesOf(after), 0, 1_000_000, 0); } finally { closeSync(fd); }
    appendFileSync(path, [...turn(905, t3, 'now the receipts'), tokens(907, { primary: { used_percent: 35, window_minutes: 300 }, plan_type: null }), rec(908, 'event_msg', { type: 'task_complete', turn_id: t3 })].map((l) => `${l}\n`).join(''));

    // Turn 3's stop: the first read since the rewrite.
    const second = await read(t3);
    const secondBase = await base(t3);
    if (canon(secondBase.list) === canon(firstBase.list) || canon(secondBase.readings) === canon(firstBase.readings)) throw new Error(`BLOCKED: ${AC4} the rewrite must change what the merge base reads: before ${show(firstBase)}, after ${show(secondBase)}`);
    const stale = (got: unknown, was: unknown): string => (canon(got) === canon(was) ? ', which is what it read before the rewrite' : '');
    must(canon(second.readings) === canon(secondBase.readings), `${AC4} after the rollout's first megabyte was rewritten and turn 3 appended, codexReadings is not the merge base's for the rewritten file: the merge base's ${show(secondBase.readings)}; the hub's ${show(second.readings)}${stale(second.readings, firstBase.readings)}`);
    must(canon(second.list) === canon(secondBase.list), `${AC4} after the rollout's first megabyte was rewritten and turn 3 appended, the claim's list is not the merge base's for the rewritten file: the merge base's ${show(secondBase.list)}; the hub's ${show(second.list)}${stale(second.list, firstBase.list)}`);
  }, 600_000);
});
