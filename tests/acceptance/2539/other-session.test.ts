// #2539.10f656f1 (README): while one session's FULL commit is in its evidence sync, another session's prompt,
// tool-call and Stop replies come within 1 s.
//
// The installed hub runs under #1410's sync shim, every sync under its evidence folder taking SLOW_MS. Session A's
// turn has ended; its next prompt, over 8,192 characters, resumes it: a FULL commit that names the prompt's whole
// text as evidence and waits for that evidence's sync (#1410). It is sent and not waited for. While its syncs run,
// session B, of the same Claude Code, goes on working: turn after turn, each with a prompt, tool calls and a Stop.
// Each test times one kind of B's hooks, from the request to the hub's reply line. A's prompt comes two ways: plain,
// and with a typed rule line (the issue's Where: a prompt whose reply reads its origin holds the hub's serial queue
// through its own sync, "and other sessions' hooks queue behind it meanwhile").
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  askOf, BOUND_MS, C2, cleanup, during, endedSession, load, longText, recordUntil, Sess, settledSyncs, sleep, SLOW_MS, slowedCommit, spans, startWorld, stopWorld,
  type Call, type World,
} from './helpers.ts';

let w: World | undefined;
afterEach(async () => { await stopWorld(w); w = undefined; }, 120_000);
afterAll(cleanup, 60_000);

type Kind = 'prompt' | 'tool call' | 'Stop';
const A_PROMPTS = {
  plain: () => longText('Before you go on, read this through.'),
  'with a typed rule line': () => longText('rule: Keep the release notes current for long prompts.'),
} as const;
/** Whether the hub held a hook for a reply still to come (the acknowledgement's hold_until_ms; design: Hook protocol). */
const held = (c: Call): boolean => c.ack?.hold_until_ms != null;

/**
 * Session B's turns while A's slowed commit runs, for as long as its syncs can take. Every turn has the three kinds
 * of hook; only `kind`'s replies are judged, the others being what a working session sends between them. Each turn
 * runs a call that passes, then the same failing command twice: the hub writes most tool-call replies at once, and
 * holds a call that failed as the session's last one did for its core's reply (#2019), the tool-call reply that could
 * wait on something.
 */
async function other(world: World, kind: Kind, a: keyof typeof A_PROMPTS): Promise<string[]> {
  const sa = await endedSession(world);
  const sb = new Sess(world);
  await sb.start();
  await sb.prompt('Is the build file in this folder?');
  await sb.tool('warm');
  await sb.stop();
  await recordUntil(world, `the first stop of session B ${sb.id}`, (events) => events.some((e) => e.session === sb.id && e.kind === 'agent.stop'));

  const judged: Call[] = [];
  const sent = Date.now();
  const resumed = sa.prompt(A_PROMPTS[a]());
  resumed.catch(() => undefined);
  // A moment for A's hook to reach the hub and its commit to start its first sync; whether it had is judged below.
  await sleep(400);
  // File, folder and evidence root can each take a slowed sync; B works through all of them and a little past.
  const spanEnd = sent + 3 * SLOW_MS + 3000;
  for (let n = 0; Date.now() < spanEnd; n++) {
    const prompt = await sb.prompt(`Is step ${n} of the plan still right?`);
    const calls = [...await sb.tool(`${n}a`), ...await sb.failed(`${n}b`), ...await sb.failed(`${n}c`)];
    const stop = await sb.stop();
    if (kind === 'prompt') judged.push(prompt);
    else if (kind === 'tool call') judged.push(...calls);
    else judged.push(stop);
    await sleep(100);
  }
  const call = await resumed;
  const events = await recordUntil(world, `session A's resuming prompt (user.ask ${call.id})`, (all) => askOf(all, call) !== undefined);
  const syncs = await settledSyncs(world);
  const { problems, own } = slowedCommit(world, askOf(events, call), `session A's resuming prompt (${a})`, syncs);
  const inside = judged.filter((c) => during(c.sent, own));
  const slowest = judged.reduce((x, y) => (y.ms > x.ms ? y : x), judged[0]!);
  console.log(`${C2} session B's ${kind} replies while session A's prompt (${a}) synced: ${judged.length} judged, ${inside.length} sent while a slowed sync of A's evidence ran (${inside.filter(held).length} of them held for a reply), slowest ${slowest.event} at ${Math.round(slowest.ms)} ms; each ${Math.round(SLOW_MS)} ms sync: ${spans(own)}; A's own reply ${Math.round(call.ms)} ms; ${load()}`);
  for (const c of judged) {
    const where = during(c.sent, own) ? 'sent while a slowed sync of session A\'s evidence ran' : 'sent outside session A\'s syncs';
    if (!c.reply) problems.push(`session B's ${c.event} (${where}) got no reply`);
    else if (c.ms >= BOUND_MS) problems.push(`session B's ${c.event} (${where}) replied in ${Math.round(c.ms)} ms, with each evidence sync taking ${SLOW_MS} ms; it must come within ${BOUND_MS} ms`);
  }
  // A hook of this kind sent while A's evidence synced, and one the hub held for a reply: else none of them could
  // have waited on that sync, and they show nothing.
  if (own.length && !inside.length) problems.push(`INCONCLUSIVE: no ${kind} hook of session B was sent while a sync of session A's evidence ran (syncs ${spans(own)}, B's ${kind} hooks sent ${JSON.stringify(judged.map((c) => c.sent))}; ${load()})`);
  else if (own.length && !inside.some(held)) problems.push(`INCONCLUSIVE: the hub held no ${kind} hook of session B sent while a sync of session A's evidence ran for a reply (each was answered at once, hold_until_ms null), so none of them could have waited (syncs ${spans(own)}; ${load()})`);
  return problems;
}

describe(`${C2} while one session's FULL commit is in its evidence sync, another session's replies come within 1 s`, () => {
  for (const a of Object.keys(A_PROMPTS) as (keyof typeof A_PROMPTS)[]) {
    it(`${C2} another session's prompt replies within 1 s while session A's resuming prompt (${a}) is in its 4 s evidence syncs`, async () => {
      w = await startWorld();
      const problems = await other(w, 'prompt', a);
      expect(problems, problems.join('\n')).toEqual([]);
    }, 500_000);
    it(`${C2} another session's tool-call replies (PreToolUse, PostToolUse, PostToolUseFailure) come within 1 s while session A's resuming prompt (${a}) is in its 4 s evidence syncs`, async () => {
      w = await startWorld();
      const problems = await other(w, 'tool call', a);
      expect(problems, problems.join('\n')).toEqual([]);
    }, 500_000);
    it(`${C2} another session's Stop replies within 1 s while session A's resuming prompt (${a}) is in its 4 s evidence syncs`, async () => {
      w = await startWorld();
      const problems = await other(w, 'Stop', a);
      expect(problems, problems.join('\n')).toEqual([]);
    }, 500_000);
  }
});
