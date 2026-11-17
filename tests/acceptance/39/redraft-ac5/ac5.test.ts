// Blind redraft of #39's AC5 (README.md beside this file). One daemon stand-in is the parent of two Codex threads' hooks
// and of one `deep mcp`, so only the PreToolUse deep-hook stamped for each `deep_ask` call can tell the threads apart
// (design: Socket roles and contract versions). Each case fixes its order: A's PreToolUse, then B's, each in the record
// before the next step; then the two calls, each call's ask in the record before the next call. The calls come in the
// PreToolUse order in one case and against it in the other, so a hub that binds a call to the newest unspent PreToolUse
// fails the first, one that binds to the oldest fails the second, and one that binds the `deep mcp` to one session both.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, Daemon, allEvents, asksOf, choice, cleanup, hookShown, hubWithSetup, makeHome, newThread, ofSession, tag, waitFor, type Home, type Line, type Thread } from '../helpers.ts';

const HUB_TEST = 180_000;
/** Each step's wait for the record. A `deep mcp` that serves one call at a time files the second ask only once the
 * first call says "still waiting", 55 s in at Codex's default tool timeout, so that fits too (README: Surfaces assumed). */
const WAIT = 90_000;
const TOOL = 'mcp__deep__deep_ask';

interface Asker { name: 'A' | 'B'; thread: Thread; question: string; args: Line; sent: Line; call: string }
/** A thread with a question and option IDs of its own, so its call's arguments match its own PreToolUse alone. */
function asker(h: Home, name: 'A' | 'B', topic: string, options: readonly [string, string]): Asker {
  const question = `${topic} (thread ${name}, ${tag()})`;
  const args = { ...choice(question), options: options.map((id) => ({ id, label: `${id} for thread ${name}` })), recommended: options[0] };
  return { name, thread: newThread(h), question, args, sent: args, call: `call_${tag(6)}` };
}
const who = (x: Asker) => `thread ${x.name} (session ${x.thread.id}, question "${x.question}")`;

async function bothAsk(calls: readonly ('A' | 'B')[]): Promise<void> {
  const h = makeHome();
  const hub = await hubWithSetup(h);
  const daemon = Daemon.start(h, h.tmp);
  try {
    // The daemon's one `deep mcp` is up before either thread's first turn, where Codex fires SessionStart (issue, Oct 9).
    await daemon.init();
    const a = asker(h, 'A', 'Which header colour should the cart page use?', ['blue', 'green']);
    const b = asker(h, 'B', 'Which font should the receipt use?', ['serif', 'sans']);
    await daemon.begin(a.thread, 'Pick a header colour for the cart page.');
    await daemon.begin(b.thread, 'Pick a font for the receipt.');
    for (const x of [a, b]) {
      const hooked = await daemon.hook(x.thread, 'PreToolUse', { tool_name: TOOL, tool_input: x.args, tool_use_id: x.call });
      const out: Line = hooked.reply?.hookSpecificOutput ?? {};
      expect(hooked.reply?.decision !== 'block' && out.permissionDecision !== 'deny', `${who(x)}: its PreToolUse for deep_ask lets the call run: ${hookShown(hooked)}`).toBe(true);
      // Codex runs a call with the input an allow rewrote, so a binding by one-time nonce gets its nonce.
      if (out.permissionDecision === 'allow' && typeof out.updatedInput === 'object' && out.updatedInput !== null) x.sent = out.updatedInput as Line;
      await waitFor(async () => ofSession(await allEvents(hub), x.thread.id, 'tool.before').length > 0, WAIT, `${who(x)}: its PreToolUse for deep_ask in the record as a tool.before of its session`);
    }
    const replies = new Map<Asker, string>();
    for (const x of calls.map((n) => (n === 'A' ? a : b))) {
      // Not awaited: `deep_ask` waits for an answer. The ask it files is what the next call waits for.
      void daemon.mcp('tools/call', { name: 'deep_ask', arguments: x.sent }).then((reply) => { replies.set(x, JSON.stringify(reply)); }, (error: unknown) => { replies.set(x, String(error)); });
      await waitFor(async () => replies.has(x) || asksOf(await allEvents(hub), x.question).length > 0, WAIT, `${who(x)}: its deep_ask's ask in the record, or its call's reply`);
    }
    const events = await allEvents(hub);
    for (const [x, other] of [[a, b], [b, a]] as const) {
      const filed = asksOf(events, x.question).map((e) => e.session ?? 'no session');
      const replied = replies.get(x);
      expect(filed, `${who(x)}: its ask is filed once, under its own session ${x.thread.id}, not under thread ${other.name}'s ${other.thread.id}${replied === undefined ? '' : `; its call replied ${replied.slice(0, 800)}`}`).toEqual([x.thread.id]);
    }
  } finally {
    daemon.stop();
  }
}

describe(`${AC[5]} Two Codex threads on one daemon each call deep_ask, and each ask is filed under its own session`, () => {
  afterEach(cleanup);
  it(`${AC[5]} A's PreToolUse, then B's, both in the record; then the calls in that order, A's, then B's: each ask under its own session`, () => bothAsk(['A', 'B']), HUB_TEST);
  it(`${AC[5]} A's PreToolUse, then B's, both in the record; then the calls against that order, B's, then A's: each ask under its own session`, () => bothAsk(['B', 'A']), HUB_TEST);
});
