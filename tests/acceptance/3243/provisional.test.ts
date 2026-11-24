// #3243.48cf467d A provisional ask still goes on at once (#84's rule).
//
// A real hub, `deep setup` into a test home, and a Claude Code stand-in (#25's routes fixture) that runs DeepBuild's
// hook entries through the real deep-hook and talks to its own `deep mcp`. The session starts and you type a prompt:
// no work run started it. Its agent calls deep_ask with a choice between two options and recommends the second, so an
// answer that is merely the first option can't pass. deep_ask returns, without anyone answering, `provisional` with the
// recommended option; and the record holds the ask as raised provisional, with that recommendation, still open: in
// your inbox, and with no answer, default, cancel, moot or supersede recorded for it.
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, allEvents, appendTranscript, callId, cleanup, control, makeHome, newSession, parseObject, payload, setup, startHub, tag, typedPrompt, waitFor,
  type Line,
} from '../25/routes/helpers.ts';

afterAll(cleanup, 60_000);

const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.cancelled', 'ask.moot', 'ask.superseded']);

/** The JSON objects in a tools/call reply's text content. */
const replied = (reply: Line): Line[] => (Array.isArray(reply.result?.content) ? reply.result.content : [])
  .flatMap((c: Line) => (c?.type === 'text' && typeof c.text === 'string' ? [parseObject(c.text)].filter((x): x is Line => x !== undefined) : []));

describe('#3243.48cf467d A provisional ask still goes on at once', () => {
  it('#3243.48cf467d a choice with a recommendation in a session no work run started: deep_ask returns provisional with the recommended option, and the ask stays open', async () => {
    const { home } = makeHome();
    const hub = await startHub(home, { noAskWait: true });
    await setup(home);

    const s = newSession(home);
    const claude = Claude.start(home);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, 'Pick a header colour and go on.');
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour and go on.' }));
    await claude.initialize();

    const t = tag(4);
    const blue = { id: `blue${t}`, label: `Blue header ${t}` };
    const green = { id: `green${t}`, label: `Green header ${t}` };
    const question = `Which header colour for ${t}?`;
    // The recommended option is the second, so the first option (a question's default) can't stand in for it.
    const args = { kind: 'choice', question, options: [blue, green], recommended: green.id };
    const call = callId();
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call }));
    const reply = await claude.request('tools/call', { name: 'deep_ask', arguments: args }).catch((error: Error): Line => ({ error: error.message }));
    const said = JSON.stringify(reply).slice(0, 2000);

    // Nobody answered: deep_ask's own reply goes on with the recommended option.
    const objects = replied(reply);
    expect(objects.length, `#3243.48cf467d deep_ask replies with its result as JSON text: ${said}`).toBeGreaterThan(0);
    const result = objects[0]!;
    expect({ status: result.status, answer: result.answer }, `#3243.48cf467d deep_ask returns provisional with the recommended option ${green.id}, not the first: ${said}`).toEqual({ status: 'provisional', answer: green.id });
    const handle = String(result.ask ?? '');
    expect(handle, `#3243.48cf467d deep_ask names its ask: ${said}`).toMatch(/^ask:\S+$/);
    const id = handle.slice(4);

    // The record: raised provisional with that recommendation, under this session, and nothing has closed it.
    const events = await allEvents(hub);
    const created = events.find((e) => e.kind === 'ask.created' && e.id === id);
    expect(created && { session: created.session, question: created.data?.question, provisional: created.data?.provisional, recommended: created.data?.recommended },
      `#3243.48cf467d the record holds ${handle} raised provisional, recommending ${green.id}: ${JSON.stringify(created ?? events.filter((e) => e.kind === 'ask.created')).slice(0, 1500)}`)
      .toEqual({ session: s.id, question, provisional: true, recommended: green.id });
    const closed = events.filter((e) => CLOSING.has(e.kind) && (e.subject === handle || e.data?.ask === handle));
    expect(closed.map((e) => e.kind), `#3243.48cf467d ${handle} is still open: nothing answered, defaulted or closed it`).toEqual([]);

    // Still open in your inbox, as a reader of the list sees it.
    const inbox = await waitFor(async () => {
      const read = await control(hub, (conn) => conn.call('inbox.read', {}));
      return [...(read.rows ?? []), ...(read.asks ?? [])].some((r: Line) => r.id === handle || r.ask === handle) ? read : undefined;
    }, 60_000, `${handle} in inbox.read`).catch(() => undefined);
    expect(inbox !== undefined, `#3243.48cf467d ${handle} is open in your inbox`).toBe(true);
    const row = [...(inbox!.rows ?? []), ...(inbox!.asks ?? [])].find((r: Line) => r.id === handle || r.ask === handle) as Line;
    expect({ session: row.session, entry: row.entry, waits_on: row.waits_on }, `#3243.48cf467d ${handle}'s inbox row is open, waiting on you in Needs you: ${JSON.stringify(row).slice(0, 1500)}`)
      .toEqual({ session: s.id, entry: 'needs_you', waits_on: 'you' });
  }, 600_000);
});
