// #1577 AC6: each write returns a log position, and a read at that position shows the write. Every write the issue's
// Scope lists, made as the app makes it, each with a request ID: an answer, an undo, an overrule, saving an offer, a run
// start, a staged undo and a note. Each reply must carry `log_pos`, a positive integer; `events.read` from the log's end
// before the write, cut at that `log_pos`, must hold the write's event, and the log must have reached it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fromHere, hookRequest, sendHook } from '../16/helpers.ts';
import {
  AC, cleanup, defaulted, events, hook, logEnd, newRequest, note, readTo, REPO, result, session, shown, signedCall, sleep, SHORT_WAIT_MS, waitFor, world,
  type Line, type World,
} from './helpers.ts';

afterAll(cleanup, 120_000);

/** The reply's log position, and the write's event in a read at it: what is wrong, or null. */
async function landed(w: World, what: string, before: number, reply: Line, shows: (e: Line) => boolean): Promise<void> {
  expect(reply.error, `${AC[6]} ${what} must be taken: ${shown(reply)}`).toBeUndefined();
  const at = reply.result?.log_pos;
  expect(Number.isSafeInteger(at) && at > 0, `${AC[6]} ${what}'s reply must carry the log position it landed at, log_pos, a positive integer; its reply is ${shown(reply.result)}`).toBe(true);
  expect(await logEnd(w), `${AC[6]} the log must have reached ${what}'s log_pos ${String(at)}`).toBeGreaterThanOrEqual(at);
  const read = await readTo(w, before, at);
  expect(read.some(shows), `${AC[6]} a read at ${what}'s log_pos ${String(at)} must show the write; events ${before + 1} to ${String(at)} are ${shown(read.map((e) => [e.log_pos, e.kind, e.subject]))}`).toBe(true);
}

describe(`${AC[6]} Each write returns a log position, and a read at that position shows the write`, () => {
  it(`${AC[6]} ask.answer, ask.undo, offer.save, decision.overrule, run.start, staged.undo and session.note each return log_pos, and a read at it shows the write`, async () => {
    const w = await world({ asks: [
      { source: 'deep_ask.choice', question: 'Keep the 1577 store in SQLite or in plain files?' },
      { source: 'deep_ask.taste', question: 'Which header colour on the 1577 billing page?', waitMs: SHORT_WAIT_MS },
    ] });
    writeFileSync(join(w.root, 'rules.json'), readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8'));
    const [choice, taste] = w.asks as [typeof w.asks[0], typeof w.asks[0]];
    const h = await session(w);

    // An answer.
    let before = await logEnd(w);
    await landed(w, 'ask.answer', before, await signedCall(w, w.device, 'ask.answer', { ask: choice.handle, option: 'sqlite', request: newRequest() }),
      (e) => e.kind === 'ask.answered' && e.subject === choice.handle);

    // An undo of a default.
    await defaulted(w, taste.handle);
    before = await logEnd(w);
    await landed(w, 'ask.undo', before, await signedCall(w, w.device, 'ask.undo', { ask: taste.handle, request: newRequest() }),
      (e) => e.kind === 'default.undone' && e.subject === taste.handle);

    // An offer saved: a permission you said yes to in the terminal, offered back.
    const input = { command: 'npm publish --tag w1577' };
    await hook(w, h, 'PermissionRequest', { tool_name: 'Bash', tool_input: input });
    await hook(w, h, 'PostToolUse', { tool_name: 'Bash', tool_input: input, tool_response: { stdout: '', stderr: '', interrupted: false } });
    const offer = await waitFor(async () => (result(await w.cli.call('inbox.read', {}, 60_000)).offers as Line[]).find((o) => o.command === input.command)?.offer as string | undefined, 60_000, 'the offer of npm publish');
    before = await logEnd(w);
    const saved = await signedCall(w, w.device, 'offer.save', { offer, request: newRequest() });
    await landed(w, 'offer.save', before, saved, (e) => e.kind === 'decision.created' && `decision:${String(e.id)}` === saved.result?.decision);

    // An overrule of that decision.
    const decision = String(saved.result?.decision);
    before = await logEnd(w);
    await landed(w, 'decision.overrule', before, await signedCall(w, w.device, 'decision.overrule', { decision, request: newRequest() }),
      (e) => e.kind === 'decision.overruled' && (e.subject === decision || e.data?.decision === decision));

    // A run start.
    before = await logEnd(w);
    const run = await w.app.call('run.start', { check: 'w1577', claim: 'claim:01J0000000000000000000157A', commit: '4f6dec54f6dec54f6dec54f6dec54f6dec54f6de', cwd: h.s.cwd, argv: ['/bin/sh', '-c', 'true'], request: newRequest() }, 60_000);
    await landed(w, 'run.start', before, run, (e) => e.kind === 'run.started' && e.subject === run.result?.run);

    // A staged undo: a delete whose reach can't be worked out, staged first (#347), then undone.
    const cache = join(h.s.cwd, 'cache');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'a.txt'), 'keep me');
    const req = fromHere(hookRequest(h.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'sh ./wipe.sh' } })) as Line;
    req.matched = ['no-unknown-reach-delete'];
    req.stage = { 'no-unknown-reach-delete': [cache] };
    await sendHook(w.hub.socket, req as Parameters<typeof sendHook>[1], 60_000);
    const staging = await waitFor(async () => (await events(w)).find((e) => e.kind === 'command.staged'), 60_000, 'the staging of sh ./wipe.sh');
    const handle = `staged:${String(staging.id)}`;
    before = await logEnd(w);
    await landed(w, 'staged.undo', before, await w.app.call('staged.undo', { staged: handle, request: newRequest() }, 60_000),
      (e) => e.subject === handle || JSON.stringify(e.data ?? {}).includes(handle) || JSON.stringify(e.data ?? {}).includes(String(staging.id)));

    // A note: your words are in the record before the hub says it has them.
    await sleep(500);
    const request = newRequest();
    before = await logEnd(w);
    await landed(w, 'session.note', before, await note(w, h, 'Also add a 1577 footer to the page.', request),
      (e) => JSON.stringify(e.data ?? {}).includes(request));
  }, 600_000);
});
