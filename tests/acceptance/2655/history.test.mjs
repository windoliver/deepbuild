// AC5 #2655: "With 2,000 commands of 100 KB each in the history, the main thread holds under 20 MB for them, and the
// expected time the history gives for a repeated command is the merge base's. On the merge base it holds the 2,000 keys
// whole, about 200 MB."
//
// The history is filled the only way a hub fills it: one session's turn runs 2,000 different Bash commands of 100,000
// characters each (a heredoc; they differ from their first line on), each a PreToolUse and a PostToolUse as deep-hook
// sends them. What the main thread holds for them is its heap after two full collections (through the hub's inspector,
// as benchmarks/hub-churn.mjs reads a thread's heap), after the 2,000 less before them, 50 small commands having run
// first so nothing a first call loads is counted. The last command takes 2.7 s; it is then run again and left 4.8 s,
// past the time its one earlier run gives and far short of the 60 s a shell call with no history is given, so the hub's
// line at its end says the expected time the history gave ("about 3 s was expected"). That time is read on both sides.
//   DEEP_2655_BASE=<built merge base> node --test tests/acceptance/2655/history.test.mjs
// DEEP_2655_COMMANDS=<n> runs fewer commands as a sanity run: it reads INCONCLUSIVE at best, never PASS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { control, exchange, hookLine, idOf, inspector, MB, mb, needBase, needChange, payloadOf, seqOf, sleep, startHub } from './lib.mjs';

const COMMANDS = 2000;
const commands = Number(process.env.DEEP_2655_COMMANDS) || COMMANDS;
const COMMAND_CHARS = 100_000;
const LIMIT = 20 * MB;
const WARM = 50;
const FIRST_RUN_MS = 2700;
const REPEAT_RUN_MS = 4800;
const SESSION = '6f1c2b9e-1111-4222-8333-444455552655';

/** Command `i`: 100,000 ASCII characters, its file's name on the first line, so no two share a prefix of any length past it. */
function command(i) {
  const head = `cat > /tmp/fixture-${String(i).padStart(5, '0')}.txt <<'EOF'\n`;
  const tail = '\nEOF';
  let rows = '';
  for (let r = 0; rows.length < COMMAND_CHARS; r++) rows += `fixture ${String(i).padStart(5, '0')} row ${String(r).padStart(6, '0')}: the quick brown fox jumps over the lazy dog\n`;
  const text = head + rows.slice(0, COMMAND_CHARS - head.length - tail.length) + tail;
  assert.equal(text.length, COMMAND_CHARS);
  return text;
}

/** One run on a hub of `checkout`: what its main thread holds for the history, and the expected time it gives the repeated command. */
async function historyRun(checkout) {
  const hub = await startHub(checkout, { nodeArgs: ['--inspect=127.0.0.1:0'] });
  let n = 0;
  const hook = async (event, more) => {
    const at = ++n;
    const got = await exchange(hub.socket, hookLine({ id: idOf(at), seq: seqOf(at), event, payload: payloadOf(hub.home, SESSION, event, more) }), 300_000);
    if (!got.reply || got.reply.exit !== 0) throw Error(`BLOCKED: the hub didn't serve hook ${at} (${event}): ${JSON.stringify(got.lines).slice(0, 300)}`);
    return got.reply;
  };
  const call = async (id, text, runMs = 0) => {
    await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: text }, tool_use_id: id });
    if (runMs) await sleep(runMs);
    return hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: text }, tool_use_id: id, tool_response: { stdout: '', stderr: '', interrupted: false } });
  };
  let insp, conn;
  try {
    insp = await inspector(hub);
    conn = await control(hub);
    /** The hooks so far have left the event loop: the core answers a read sent after them, and the main thread is idle. */
    const settled = async () => { await conn.call('status.read', {}, 300_000); await sleep(500); };
    await hook('SessionStart', { source: 'startup' });
    await hook('UserPromptSubmit', { prompt: 'write the fixture files' });
    for (let i = 0; i < WARM; i++) await call(`call_warm_${i}`, `echo warm-up ${i}`);
    await settled();
    const before = await insp.heap();
    // Four calls at a time, each its own connections, as a turn's parallel tool calls arrive.
    let next = 1;
    await Promise.all(Array.from({ length: 4 }, async () => { while (next < commands) { const i = next++; await call(`call_fill_${i}`, command(i)); } }));
    const last = command(commands);
    await call(`call_fill_${commands}`, last, FIRST_RUN_MS);
    await settled();
    const after = await insp.heap();
    const reply = await call('call_repeat', last, REPEAT_RUN_MS);
    const expected = /about ([^"\\`]+?) was expected/.exec(JSON.stringify(reply))?.[1] ?? null;
    return { held: after - before, before, after, expected, reply: JSON.stringify(reply).slice(0, 600) };
  } finally {
    conn?.close();
    insp?.close();
    await hub.stop();
  }
}

const runs = {};
const run = (side, checkout) => (runs[side] ??= historyRun(checkout).then((r) => ({ r }), (error) => ({ error })));
const short = () => { if (commands !== COMMANDS) throw Error(`INCONCLUSIVE: ${commands} commands ran, and the criterion is about ${COMMANDS}`); };

test(`AC5 #2655 with 2,000 commands of 100 KB each in the history, the main thread holds under 20 MB for them`, { timeout: 3_600_000 }, async (t) => {
  const { r, error } = await run('change', needChange());
  if (error) throw error;
  t.diagnostic(`change: the main thread holds ${mb(r.held)} for ${commands} commands of ${COMMAND_CHARS} characters (heap after two full collections ${mb(r.before)} before them, ${mb(r.after)} after)`);
  assert.ok(Number.isSafeInteger(r.held), `INCONCLUSIVE: the heap readings are missing (${r.before}, ${r.after})`);
  assert.ok(r.held < LIMIT * (commands / COMMANDS), `the main thread holds ${mb(r.held)} for ${commands} commands of 100 KB in its history; under ${mb(LIMIT * (commands / COMMANDS))} is required`);
  short();
});

test("AC5 #2655 the expected time the history gives for a repeated command is the merge base's", { timeout: 3_600_000 }, async (t) => {
  const [change, base] = [needChange(), needBase()];
  const there = await run('base', base);
  if (there.error) throw Error(`BLOCKED: the run on the merge base failed, so there is nothing to compare with: ${there.error.message}`);
  t.diagnostic(`merge base: the main thread holds ${mb(there.r.held)} for ${commands} commands; expected time for the repeated command: ${there.r.expected}`);
  if (!there.r.expected) throw Error(`BLOCKED: the merge base said no expected time at the repeated command's end, so there is nothing to compare with: ${there.r.reply}`);
  const here = await run('change', change);
  if (here.error) throw here.error;
  t.diagnostic(`change: expected time for the repeated command: ${here.r.expected}`);
  assert.ok(here.r.expected, `the history gave the repeated command no expected time: the hub's reply at its end says none (${here.r.reply})`);
  assert.equal(here.r.expected, there.r.expected, `the history gives the repeated command ${here.r.expected}, and the merge base's gives it ${there.r.expected}`);
  short();
});
