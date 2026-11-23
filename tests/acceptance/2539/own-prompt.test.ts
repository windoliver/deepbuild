// #2539.948b73c4 (README): with each evidence sync slowed to 4 s, a resuming prompt over 8,192 characters that contains
// a typed rule line, `rejected:` or a status question replies within 1 s, and the rule or rejection is still saved
// with the right origin.
//
// The installed hub runs under #1410's sync shim, every sync under its evidence folder taking SLOW_MS. A session's
// turn ends; its next prompt, longer than the record keeps of a field, resumes it: the record stores the prompt's
// whole text as evidence and cites it in a FULL commit, which waits for that evidence's sync (#1410). The prompt also
// carries one of the three things whose reply reads the prompt's origin. Its reply is timed from the request to the
// hub's reply line; what it saved is read back from the record.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  askOf, BOUND_MS, C1, cleanup, endedSession, guardsFor, KEPT_CHARS, load, longText, recordUntil, recordWithin, said, settledSyncs, SLOW_MS, slowedCommit, spans,
  startWorld, stopWorld, type Call, type Ev, type World,
} from './helpers.ts';

let w: World | undefined;
afterEach(async () => { await stopWorld(w); w = undefined; }, 120_000);
afterAll(cleanup, 60_000);

const learned = (events: Ev[], line: string): Ev[] => events.filter((e) => e.kind === 'learn.applied' && e.data?.diff === `+ ${line}`);
const decided = (events: Ev[], word: string): Ev[] => events.filter((e) => e.kind === 'decision.created' && e.data?.answer === `rejected: \`${word}\``);

/**
 * The resuming prompt, sent and judged: its reply within the bound; its event in the record with the origin it was
 * sent with, naming its whole text as evidence; that evidence synced, slowed, or the test shows nothing.
 */
async function resume(world: World, text: string, origin: 'person' | 'scheduled', what: string): Promise<{ call: Call; problems: string[]; events: Ev[] }> {
  const s = await endedSession(world);
  const call = await s.prompt(text, origin);
  const events = await recordUntil(world, `${what} (user.ask ${call.id})`, (all) => askOf(all, call) !== undefined);
  const syncs = await settledSyncs(world);
  const ask = askOf(events, call);
  const { problems, own } = slowedCommit(world, ask, what, syncs);
  console.log(`${C1} ${what}: ${text.length} characters, reply in ${Math.round(call.ms)} ms (hold ${JSON.stringify(call.ack?.hold_until_ms ?? null)}, sent ${call.sent}); recorded from ${String(ask?.data?.from)}; its evidence's slowed syncs ${spans(own)}; ${load()}`);
  if (!call.reply) problems.push(`${what} got no reply`);
  else if (call.ms >= BOUND_MS) problems.push(`${what}'s reply took ${Math.round(call.ms)} ms, with each evidence sync taking ${SLOW_MS} ms; it must come within ${BOUND_MS} ms (${load()})`);
  if (ask && ask.data?.from !== origin) problems.push(`${what} was sent as ${origin}'s but is recorded with origin ${String(ask.data?.from)}`);
  if (ask && String(ask.data?.text ?? '').length > KEPT_CHARS) problems.push(`BLOCKED: the record kept ${String(ask.data?.text).length} characters of the prompt, more than ${KEPT_CHARS}`);
  return { call, problems, events };
}

describe(`${C1} a resuming prompt over 8,192 characters that reads its own origin replies within 1 s of slowed evidence syncs, and saves what it saved before`, () => {
  it(`${C1} a typed rule line: the reply comes within 1 s, and the rule is saved once, from a prompt recorded as a person's`, async () => {
    w = await startWorld();
    const line = 'Keep the changelog current for long prompts';
    const r = await resume(w, longText(`rule: ${line}.`), 'person', 'the resuming prompt with a typed rule line');
    const saved = await recordWithin(w, (all) => learned(all, line).length > 0, 60_000);
    const n = learned(saved ?? r.events, line).length;
    if (n !== 1) r.problems.push(`the rule line you typed must be saved once (a learn.applied adding "${line}"); it was saved ${n} time(s)`);
    expect(r.problems, r.problems.join('\n')).toEqual([]);
  }, 400_000);

  it(`${C1} rejected: the reply comes within 1 s, and the rejection is saved as your decision with its guard entry, from a prompt recorded as a person's`, async () => {
    w = await startWorld();
    writeFileSync(join(w.h.root, 'rules.json'), JSON.stringify({ v: 1, entries: {} }));
    const word = 'leftpad';
    const r = await resume(w, longText(`No. rejected: \`${word}\`.`), 'person', 'the resuming prompt with rejected:');
    const saved = await recordWithin(w, (all) => decided(all, word).length > 0, 60_000);
    const n = decided(saved ?? r.events, word).length;
    if (n < 1) r.problems.push(`rejected: \`${word}\` typed by you must be saved as your decision (decision.created "rejected: \`${word}\`"); none is in the record`);
    const deadline = Date.now() + 30_000;
    while (!guardsFor(w, word).length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 200));
    if (!guardsFor(w, word).length) r.problems.push(`rejected: \`${word}\` typed by you must write a guard entry word:${word} into the hub's rules.json; none is there`);
    expect(r.problems, r.problems.join('\n')).toEqual([]);
  }, 400_000);

  it(`${C1} a status question: the reply comes within 1 s and is the status answer from the record, to a prompt recorded as a person's`, async () => {
    w = await startWorld();
    // One of #83's four status questions, exactly, with the one-word tag it allows after: the only shape of a status
    // question that can be over 8,192 characters (README: Left open by the issue).
    const text = `still going? (${'longtag'.repeat(1200)})`;
    if (text.length <= KEPT_CHARS) throw Error('the status question must be over 8,192 characters');
    const r = await resume(w, text, 'person', 'the resuming status question');
    const shown = said(r.call);
    if (!/needs you: \d+/.test(shown)) r.problems.push(`the status question's reply must be the status answer from the record (its state and "needs you: <n>"); it was ${JSON.stringify(shown).slice(0, 600)}`);
    expect(r.problems, r.problems.join('\n')).toEqual([]);
  }, 400_000);

  it(`${C1} the right origin: the same rule line and rejected: in a long resuming prompt nobody typed (scheduled) reply within 1 s and save nothing, while yours after it are saved`, async () => {
    w = await startWorld();
    writeFileSync(join(w.h.root, 'rules.json'), JSON.stringify({ v: 1, entries: {} }));
    const line = 'Name every branch after its ticket';
    const word = 'rightpad';
    const r = await resume(w, longText(`rule: ${line}.\nNo. rejected: \`${word}\`.`), 'scheduled', 'the scheduled resuming prompt with a rule line and rejected:');
    // The positive control, after the scheduled prompt's syncs are over: a person's short prompt saves its own.
    const control = { line: 'Write the migration before the model', word: 'padstart' };
    const mine = await endedSession(w);
    await mine.prompt(`rule: ${control.line}.\nNo. rejected: \`${control.word}\`.\nSound good?`);
    const after = await recordWithin(w, (all) => learned(all, control.line).length > 0 && decided(all, control.word).length > 0, 90_000);
    if (!after) r.problems.push(`BLOCKED: the control, a rule line and rejected: you typed in a short prompt, was not saved within 90 s, so nothing can be said of what the scheduled prompt saved (${load()})`);
    else {
      if (learned(after, line).length) r.problems.push(`a rule line in a prompt recorded as scheduled was saved (learn.applied adding "${line}")`);
      if (decided(after, word).length || guardsFor(w, word).length) r.problems.push(`rejected: \`${word}\` in a prompt recorded as scheduled was saved (decisions ${decided(after, word).length}, guard entries ${JSON.stringify(guardsFor(w, word))})`);
    }
    expect(r.problems, r.problems.join('\n')).toEqual([]);
  }, 500_000);
});
