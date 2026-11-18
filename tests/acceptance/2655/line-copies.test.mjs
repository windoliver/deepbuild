// AC4 #2655: "A 512 KiB hook line reaches the parser with one copy made on the event loop, counted by the test, and its
// event is the merge base's. A planted server that hands over a view of the socket's pooled chunk fails, naming the line
// that changed under the parser."
//
// The line is a PreToolUse request of exactly 524,288 bytes (its newline follows), written by one connection as deep-hook writes it. The copies
// are counted in the hub's own process by copies-preload.mjs (the byte-copying calls of the main thread, and each
// postMessage's buffers that are cloned instead of transferred), between the line's write and the hub's reply to it.
// The event is read back through events.read, on the checkout under test and on the merge base, from the same bytes.
// "Changed under the parser" is judged from outside: the 512 KiB line's event, and three requests written at once on one
// connection, which reach the hub in one chunk of its socket, must each be answered as the line that was sent.
//   DEEP_2655_BASE=<built merge base> node --test tests/acceptance/2655/line-copies.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { control, eventOf, exchange, HERE, hookLine, idOf, needBase, needChange, seqOf, sleep, startHub, tempHome } from './lib.mjs';

/** The planted wrong program this test names: a server that hands the parser a view of the socket's chunk, no copy of the line. */
const PLANT = 'hands-over-socket-chunk';
const LINE_BYTES = 512 * 1024;
const SESSION = '6f1c2b9e-1111-4222-8333-444455552655';
/** The same payload bytes on every hub: no path of the hub's own home. */
const payload = (event, more = {}) => ({ session_id: SESSION, transcript_path: '/tmp/d2655-nowhere/session.jsonl', cwd: '/tmp/d2655-nowhere/work', hook_event_name: event, ...more });
const BIG = { id: idOf(4), call: 'call_2655_512k' };

/** The 512 KiB line: a Bash call that writes a file from a heredoc of numbered rows, with the call's ID after the command. */
function bigLine() {
  let rows = '';
  for (let i = 0; rows.length < 500_000; i++) rows += `row ${String(i).padStart(7, '0')} of the fixture\n`;
  const make = (fill) => hookLine({ id: BIG.id, seq: seqOf(4), event: 'PreToolUse', payload: payload('PreToolUse', { tool_name: 'Bash', tool_input: { command: `cat > out.txt <<'EOF'\n${rows}EOF\n# ${fill}` }, tool_use_id: BIG.call }) });
  // The rows leave room, and a comment of one-byte characters fills the line to the byte.
  const line = make('x'.repeat(LINE_BYTES - Buffer.byteLength(make(''))));
  assert.equal(Buffer.byteLength(line), LINE_BYTES, 'the fixture line is 512 KiB, its newline after it');
  return line;
}

/** A hub that has served the session's start, a prompt and one small call, so the 512 KiB line is no first of anything. */
async function warmHub(checkout, env = {}, home = tempHome()) {
  const hub = await startHub(checkout, { env, home });
  try {
    const first = [
      ['SessionStart', { source: 'startup' }],
      ['UserPromptSubmit', { prompt: 'write the fixture file' }],
      ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_2655_small' }],
    ];
    for (const [n, [event, more]] of first.entries()) {
      const got = await exchange(hub.socket, hookLine({ id: idOf(n + 1), seq: seqOf(n + 1), event, payload: payload(event, more) }));
      if (!got.reply || got.reply.exit !== 0) throw Error(`BLOCKED: the hub didn't serve the session's ${event}: ${JSON.stringify(got.lines).slice(0, 300)}`);
    }
    return hub;
  } catch (error) {
    await hub.stop();
    throw error;
  }
}
/** The 512 KiB line's event as the record holds it, less where it sits in this hub's log. */
async function bigEvent(hub, conn) {
  const got = await exchange(hub.socket, bigLine());
  if (!got.reply || got.reply.exit !== 0) return { refused: got.error ?? got.lines };
  const event = await eventOf(conn, BIG.id);
  if (!event) return { missing: true };
  const { log_pos: _at, ...rest } = event;
  return { event: rest };
}

/**
 * The lines that changed under the parser, each named; empty when every line was read as it was sent. `expected` is the
 * 512 KiB line's event from a hub of the same checkout with no plant, or undefined to judge it by what was sent alone.
 */
async function changedLines(hub, expected) {
  const changed = [];
  const conn = await control(hub);
  try {
    const big = await bigEvent(hub, conn);
    const sent = `the 512 KiB hook line (id ${BIG.id})`;
    if (big.refused) changed.push(`${sent} changed under the parser: it was sent as one hook.request JSON object, and the hub answered ${JSON.stringify(big.refused).slice(0, 300)}`);
    else if (big.missing) changed.push(`${sent} changed under the parser: the hub acknowledged it and the record holds no event of its ID`);
    else {
      const data = big.event.data ?? {};
      if (data.call !== BIG.call) changed.push(`${sent} changed under the parser: its call was sent as ${BIG.call} and recorded as ${JSON.stringify(data.call)}`);
      else if (typeof data.command !== 'string' || !data.command.startsWith("cat > out.txt <<'EOF'\nrow 0000000 of the fixture\nrow 0000001 of the fixture\n")) changed.push(`${sent} changed under the parser: its command was recorded as ${JSON.stringify(String(data.command).slice(0, 120))}`);
      else if (expected && JSON.stringify(big.event) !== JSON.stringify(expected)) changed.push(`${sent} changed under the parser: its event is ${JSON.stringify(big.event).slice(0, 400)}, and with no plant it is ${JSON.stringify(expected).slice(0, 400)}`);
    }
    // Three requests in one write: they reach the hub in one chunk of its socket, each a view of it until it is copied out.
    const count = 3;
    const held = (await conn.call('events.read', { after: 0, limit: 10 })).events?.length ?? 0;
    if (held < count) throw Error(`BLOCKED: the record holds ${held} events after a session's first hooks, so a read of ${count} can't tell one line from another`);
    conn.write(Array.from({ length: count }, (_, i) => `${JSON.stringify({ v: 1, id: `p${i + 1}`, method: 'events.read', params: { after: 0, limit: i + 1 } })}\n`).join(''));
    const deadline = Date.now() + 15_000;
    for (let i = 1; i <= count; i++) {
      const name = `line ${i} of ${count} written at once on one connection (id p${i}, events.read with limit ${i})`;
      const reply = await conn.until((l) => l.id === `p${i}`, Math.max(0, deadline - Date.now()));
      if (!reply) changed.push(`${name} changed under the parser: the hub gave it no answer in 15 s`);
      else if (reply.error) changed.push(`${name} changed under the parser: the hub refused it, ${JSON.stringify(reply.error).slice(0, 200)}`);
      else if (reply.result?.events?.length !== i) changed.push(`${name} changed under the parser: it asked for ${i} events and was answered ${reply.result?.events?.length}`);
    }
    // An answer the hub wrote for no line that was sent: a line read as other bytes.
    const stray = await conn.until((l) => l.id === null || (typeof l.id === 'string' && /^p\d+$/.test(l.id)), 500);
    if (stray) changed.push(`a line written at once on one connection changed under the parser: beside its answers the hub wrote ${JSON.stringify(stray).slice(0, 200)}`);
    return { changed, event: big.event };
  } finally {
    conn.close();
  }
}

test('AC4 #2655 a 512 KiB hook line reaches the parser with one copy made on the event loop', { timeout: 300_000 }, async (t) => {
  const home = tempHome('c');
  const log = join(home, 'copies.log');
  const hub = await warmHub(needChange(), { NODE_OPTIONS: `--import=${join(HERE, 'copies-preload.mjs')}`, DEEP_2655_COPIES: log }, home);
  try {
    if (!existsSync(log) || !readFileSync(log, 'utf8').startsWith('armed ')) throw Error(`BLOCKED: the copy counter never armed in the hub's main thread (${log}), so no copy can be counted`);
    const line = bigLine();
    const from = statSync(log).size;
    const got = await exchange(hub.socket, line);
    assert.equal(got.reply?.exit, 0, `the hub served the 512 KiB line: ${JSON.stringify(got.lines).slice(0, 300)}`);
    // The reply comes after the parser's answer, so every copy on the line's way to the parser is in the log by now;
    // it is read before anything else is sent, so only this line's copies are in it.
    await sleep(200);
    const made = readFileSync(log, 'utf8').slice(from).split('\n').filter(Boolean).map((l) => ({ what: l.slice(0, l.lastIndexOf(' ')), bytes: Number(l.slice(l.lastIndexOf(' ') + 1)) }));
    const conn = await control(hub);
    try {
      const event = await eventOf(conn, BIG.id);
      assert.equal(event?.data?.call, BIG.call, 'the 512 KiB line reached the parser: its event is in the record');
    } finally { conn.close(); }
    const bytes = made.reduce((sum, m) => sum + m.bytes, 0);
    const copies = Math.floor(bytes / LINE_BYTES);
    const said = `${bytes} bytes copied on the event loop for the ${LINE_BYTES}-byte line, ${copies} whole ${copies === 1 ? 'copy' : 'copies'} of it (${made.map((m) => `${m.what} ${m.bytes}`).join(', ') || 'no copying call counted'})`;
    t.diagnostic(said);
    if (copies < 1) throw Error(`INCONCLUSIVE: ${said}: either the line crossed with no copy, as views of the socket's chunks, or it was copied by a call copies-preload.mjs doesn't count`);
    assert.equal(copies, 1, `${said}; one copy is required`);
  } finally {
    await hub.stop();
  }
});

test("AC4 #2655 the 512 KiB line's event is the merge base's", { timeout: 300_000 }, async () => {
  const [change, base] = [needChange(), needBase()];
  const events = {};
  for (const [side, checkout] of [['base', base], ['change', change]]) {
    const hub = await warmHub(checkout);
    try {
      const conn = await control(hub);
      try { events[side] = await bigEvent(hub, conn); } finally { conn.close(); }
    } finally { await hub.stop(); }
  }
  if (!events.base.event) throw Error(`BLOCKED: the merge base recorded no event for the 512 KiB line, so there is nothing to compare with: ${JSON.stringify(events.base).slice(0, 300)}`);
  assert.ok(events.change.event, `the checkout under test recorded the 512 KiB line's event: ${JSON.stringify(events.change).slice(0, 300)}`);
  assert.deepEqual(events.change.event, events.base.event, "the 512 KiB line's event differs from the merge base's");
});

test('AC4 #2655 every line reaches the parser as it was sent: the 512 KiB line, and three lines that share a chunk of the socket', { timeout: 300_000 }, async () => {
  const hub = await warmHub(needChange());
  try {
    const { changed } = await changedLines(hub);
    assert.deepEqual(changed, [], changed.join('\n'));
  } finally {
    await hub.stop();
  }
});

test(`AC4 #2655 (wrong program) a server that hands over a view of the socket's chunk (DEEP_HUB_PLANT=${PLANT}) fails, naming the line that changed under the parser`, { timeout: 300_000 }, async (t) => {
  const change = needChange();
  const clean = await warmHub(change);
  let expected;
  try { expected = (await changedLines(clean)).event; } finally { await clean.stop(); }
  let planted;
  try {
    planted = await warmHub(change, { DEEP_HUB_PLANT: PLANT });
  } catch (error) {
    throw Error(`BLOCKED: no planted server ran: \`DEEP_HUB_PLANT=${PLANT} deep hub run\` must start a hub that hands its parser a view of the socket's chunk in place of the line's own bytes. ${error.message}`);
  }
  try {
    const { changed } = await changedLines(planted, expected);
    for (const line of changed) t.diagnostic(line);
    assert.notEqual(changed.length, 0, `the planted server passed: every line it read reached its parser as it was sent, so this test can't tell it from a right one`);
    assert.ok(changed.every((c) => / changed under the parser: /.test(c) && /\(id [0-9A-Za-z]+\)|on one connection/.test(c)), `each failure names the line that changed under the parser: ${changed.join('\n')}`);
  } finally {
    await planted.stop();
  }
});
