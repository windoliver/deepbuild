// #1577 AC6: every write with an effect returns the log position it landed at, and a read at that position shows the
// write (README, The surface: `log_pos`). One hub takes each of the seven writes the issue names, each with a request
// ID: an answer, an undo, an overrule, saving an offer, a run start, a staged undo and a note. For each, `events.read`
// up to the reply's `log_pos` must hold the write's own event. What each write needs is made first through the hub's
// own surfaces: asks in its record, a default by the stepped clock, a decision saved by an answer, a permission you
// said yes to in the terminal offered back, and a destructive call deep-hook matched staged before it ran.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { fromHere, hookRequest, sendHook } from '../16/helpers.ts';
import {
  AC, allEvents, cleanup, defaulted, folderWithFile, hook, liveSession, logEnd, MINUTE, note, requestId, result, said, sendOnce, signedBy, tag, world,
  type Line, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The read at a write's log position: the events after `before` up to `at`, through events.read. */
const readTo = async (w: World, before: number, at: number): Promise<Line[]> => (await allEvents(w, before)).filter((e) => (e.log_pos as number) <= at);

/**
 * One write: what it returned, judged. Null when its reply carries a log position past the log's end before it, no
 * later than the log's end after it, and a read up to it holds the write's own event; else what is wrong.
 */
async function landed(w: World, what: string, send: () => Promise<Line>, own: (e: Line, result: Line) => boolean): Promise<string | null> {
  const before = await logEnd(w);
  const reply = await send();
  if (!('result' in reply)) return `${what} was refused: ${JSON.stringify(reply.error).slice(0, 500)}`;
  const at = reply.result.log_pos;
  if (!Number.isSafeInteger(at)) return `${what}'s reply carries no log position: ${JSON.stringify(reply.result).slice(0, 500)}`;
  if (at <= before) return `${what}'s log position ${String(at)} is no later than the log's end before it, ${before}`;
  const end = await logEnd(w);
  if (at > end) return `${what}'s log position ${String(at)} is past the log's end, ${end}`;
  const read = await readTo(w, before, at);
  if (!read.some((e) => own(e, reply.result as Line))) return `a read at ${what}'s log position ${String(at)} doesn't show it: the events after ${before} up to it are ${said(read)}`;
  return null;
}

describe(`${AC[6]} Each write returns a log position, and a read at that position shows the write`, () => {
  it(`${AC[6]} an answer, an undo, an overrule, an offer saved, a run started, a staged undo and a note each return the log position a read finds them at`, async () => {
    const session = `0c0ffee0-${tag().slice(0, 4)}-4a5b-8c6d-${tag()}${tag().slice(0, 4)}`;
    const w = await world({
      rules: true,
      asks: [
        { source: 'deep_ask.choice', question: `Keep the cache on SQLite or plain files? (${tag()})` },
        { source: 'effect.push', question: `Push release/${tag()} to origin?`, waitMs: 3 * MINUTE },
        { source: 'deep_ask.choice', question: `Name the log file app.log or run.log? (${tag()})`, session },
      ],
    });
    const [choice, push, scoped] = w.asks as [typeof w.asks[number], typeof w.asks[number], typeof w.asks[number]];
    const view = async (): Promise<number> => result(await sendOnce(w, 'inbox.read', {})).log_pos as number;
    const failures: string[] = [];
    const judge = (failure: string | null) => { if (failure) failures.push(failure); };

    // Setup: a decision, saved by answering an ask raised in a session; the push ask's default; a live session.
    const saved = await sendOnce(w, 'ask.answer', await signedBy(w, w.a, 'ask.answer', { ask: scoped.handle, option: 'sqlite' }));
    expect(saved.error, `setup: answering ${scoped.handle} must save a decision: ${JSON.stringify(saved.error)}`).toBeUndefined();
    const decision = (await allEvents(w)).find((e) => e.kind === 'decision.created' && e.subject === scoped.handle);
    expect(decision, `setup: answering ${scoped.handle}, raised in session ${session}, saves a decision`).toBeDefined();
    await defaulted(w, push.handle, 4 * MINUTE);
    const s = await liveSession(w);

    // An answer.
    judge(await landed(w, `the answer to ${choice.handle}`,
      async () => sendOnce(w, 'ask.answer', await signedBy(w, w.a, 'ask.answer', { ask: choice.handle, option: 'files', request: requestId() })),
      (e) => e.kind === 'ask.answered' && e.subject === choice.handle));
    // An undo of a default.
    judge(await landed(w, `the undo of ${push.handle}'s default`,
      async () => sendOnce(w, 'ask.undo', await signedBy(w, w.a, 'ask.undo', { ask: push.handle, view: await view(), request: requestId() })),
      (e) => e.kind === 'default.undone' && e.subject === push.handle));
    // An overrule of a saved decision.
    const handle = `decision:${String(decision!.id)}`;
    judge(await landed(w, `the overrule of ${handle}`,
      async () => sendOnce(w, 'decision.overrule', await signedBy(w, w.a, 'decision.overrule', { decision: handle, view: await view(), request: requestId() })),
      (e) => e.kind === 'decision.overruled' && e.subject === handle));
    // An offer saved: a permission prompt no decision covered, then the call you said yes to in the terminal ran.
    const command = `npm run lint:${tag()}`;
    await hook(w, s, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command } });
    await hook(w, s, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: '', stderr: '', interrupted: false } });
    const offers = (result(await sendOnce(w, 'inbox.read', {})).offers ?? []) as { offer: string; command: string }[];
    const offer = offers.find((o) => o.command === command);
    expect(offer, `setup: the inbox offers \`${command}\` back once it ran: ${JSON.stringify(offers)}`).toBeDefined();
    judge(await landed(w, `saving ${offer!.offer}`,
      async () => sendOnce(w, 'offer.save', await signedBy(w, w.a, 'offer.save', { offer: offer!.offer, request: requestId() })),
      (e, r) => e.kind === 'decision.created' && `decision:${String(e.id)}` === r.decision));
    // A run started.
    judge(await landed(w, 'the run start',
      () => sendOnce(w, 'run.start', { check: 'quick', claim: `claim:01JX${tag().toUpperCase()}${'0'.repeat(14)}`, commit: 'a'.repeat(40), argv: ['/bin/sh', '-c', 'true'], cwd: s.cwd, request: requestId() }),
      (e, r) => e.kind === 'run.started' && e.subject === r.run));
    // A staged undo: a delete whose reach deep-hook couldn't work out, staged before it ran, then the folder gone.
    const { dir } = folderWithFile('cache');
    const before = await logEnd(w);
    const call = fromHere(hookRequest(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: `sh ./wipe.sh ${dir}` } }));
    call.matched = ['no-unknown-reach-delete'];
    const staging = await sendHook(w.hub.socket, { ...call, stage: { 'no-unknown-reach-delete': [dir] } } as typeof call, 60_000);
    const stagedEvent = (await allEvents(w, before)).find((e) => e.kind === 'command.staged');
    expect(stagedEvent, `setup: the hub stages ${dir} before \`sh ./wipe.sh\` runs: the PreToolUse ended ${staging.end}, ${JSON.stringify(staging.lines).slice(0, 400)}`).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
    const staged = `staged:${String(stagedEvent!.id)}`;
    judge(await landed(w, `the undo of ${staged}`,
      async () => sendOnce(w, 'staged.undo', { staged, view: await view(), request: requestId() }),
      (e) => JSON.stringify(e).includes(staged)));
    // A note.
    const text = `Leave the fixtures as they are (${tag()})`;
    const request = requestId();
    judge(await landed(w, 'the note', () => note(w, s, text, request),
      (e) => JSON.stringify(e.data).includes(text) && JSON.stringify(e.data).includes(request)));

    expect(failures, `each write must return the log position it landed at, and a read there must show it:\n${failures.join('\n')}`).toEqual([]);
  });
});
