// #1577 AC4 and AC5: your words sent with session.note (#340) are in the record before the hub says it has them, so a
// hub killed right after its reply loses nothing, and a note stays known once delivered, so a late retry delivers
// nothing more. The agent is a Claude Code session whose hook lines this process sends as its deep-hook would; a
// note reaches it as its next prompt's hook reply, as the hub delivers notes today (README, The surface: a note).
import { afterEach, describe, expect, it } from 'vitest';
import { AC, carried, cleanup, hook, kill, liveSession, note, requestId, restart, tag, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC[4]} The hub killed after a note's reply and before delivery loses nothing`, () => {
  it(`${AC[4]} a note the hub took, then the hub killed by its PID before any hook of the session: the session's next prompt after the restart carries it`, async () => {
    const w = await world();
    const s = await liveSession(w);
    const text = `Keep the old flag working too (${tag()})`;
    const request = requestId();
    const reply = await note(w, s, text, request);
    expect(reply.error, `the app's note to ${s.id} must be taken: ${JSON.stringify(reply.error)}`).toBeUndefined();
    // Killed after the reply and before the session's next hook, the only way a note reaches it here.
    await kill(w);
    await restart(w);
    const prompt = await hook(w, s, 'UserPromptSubmit');
    expect(prompt.end, `the session's next prompt after the restart must get the hub's reply: ${JSON.stringify(prompt.lines).slice(0, 600)}`).toBe('reply');
    expect(carried(prompt), `the note "${text}" (request ${request}) must reach the session at its next prompt after the restart: the hub said it had it, then was killed before delivering it; the prompt's reply was ${carried(prompt).slice(0, 1200) || 'empty'}`).toContain(text);
  });
});

describe(`${AC[5]} A note retried after delivery reaches the agent once`, () => {
  it(`${AC[5]} a note delivered at a prompt, then sent again with its request ID: the next prompt carries nothing of it`, async () => {
    const w = await world();
    const s = await liveSession(w);
    const text = `Use the staging bucket, not prod (${tag()})`;
    const request = requestId();
    const reply = await note(w, s, text, request);
    expect(reply.error, `the app's note to ${s.id} must be taken: ${JSON.stringify(reply.error)}`).toBeUndefined();
    const first = await hook(w, s, 'UserPromptSubmit');
    expect(carried(first), `the note "${text}" must reach the session at its next prompt: the prompt's reply was ${carried(first).slice(0, 1200) || 'empty'}`).toContain(text);
    // The app never saw the reply, so it sends the note again with its request ID, after the agent has it.
    await note(w, s, text, request);
    const second = await hook(w, s, 'UserPromptSubmit');
    expect(second.end, `the session's prompt after the retry must get the hub's reply: ${JSON.stringify(second.lines).slice(0, 600)}`).toBe('reply');
    const times = [first, second].filter((p) => carried(p).includes(text)).length;
    expect(times, `the note "${text}" (request ${request}) must reach the agent once; it reached it ${times} times, the second prompt's reply: ${carried(second).slice(0, 1200)}`).toBe(1);
  });
});
