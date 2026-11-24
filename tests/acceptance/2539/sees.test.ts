// #2539.fc330be5 (README): a reply still sees every answer and ask recorded before its hook.
//
// The installed hub runs under #1410's sync shim, every sync under its evidence folder taking SLOW_MS. A session asks
// you something through deep_ask; another session's resuming prompt of over 8,192 characters is the slowed FULL
// commit. Two orders, each with the hook sent only once the record holds what it must see (read through
// events.read):
//   - "recorded, then the slowed commit": the answer (or the ask) is in the record, the other session's slowed commit
//     starts, and the hook is sent while its evidence syncs;
//   - "recorded during the slowed commit": the slowed commit starts first, the answer (or the ask) is given while its
//     evidence syncs, and the hook is sent the moment the record holds it.
// The reply must carry your answer, or count the ask. A reply that stopped waiting for what it reads, or one written
// before the hub read the answer, fails here.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  answerNorth, askFiled, asker, askOf, C3, cleanup, during, endedSession, load, longText, recordUntil, said, settledSyncs, sleep, slowedCommit, spans, startWorld, stopWorld, tag,
  type Call, type World,
} from './helpers.ts';

let w: World | undefined;
afterEach(async () => { await stopWorld(w); w = undefined; }, 120_000);
afterAll(cleanup, 60_000);

type Order = 'recorded, then the slowed commit' | 'recorded during the slowed commit';
type Hook = 'UserPromptSubmit' | 'Stop' | 'SessionStart';

/** Your answer, recorded before the asking session's next hook: that hook's reply carries it. */
async function answerSeen(world: World, order: Order, hook: Hook): Promise<string[]> {
  const t = tag();
  const question = `Which road should the path take (${t})?`;
  const north = `North road ${t}`;
  const q = await asker(world);
  await q.ask(question, north, `South road ${t}`);
  const ask = await askFiled(world, q, question);
  // The turn is cut: its deep_ask call is gone, so your answer can only reach the session through a hook's reply.
  await q.close();
  const other = await endedSession(world);
  let slowed: Promise<Call>;
  let marked: number;
  if (order === 'recorded, then the slowed commit') {
    await answerNorth(world, ask);
    slowed = other.prompt(longText('Before you go on, read this through.'));
    await sleep(1500);
    marked = Date.now();
  } else {
    slowed = other.prompt(longText('Before you go on, read this through.'));
    await sleep(1000);
    marked = (await answerNorth(world, ask)).started;
  }
  slowed.catch(() => undefined);
  const call = hook === 'UserPromptSubmit' ? await q.s.prompt('Which road did I pick?')
    : hook === 'Stop' ? await q.s.stop('I asked which road you want; I will wait for your answer.')
      : await q.s.start('resume');
  const resumed = await slowed;
  const events = await recordUntil(world, `the other session's resuming prompt (user.ask ${resumed.id})`, (all) => askOf(all, resumed) !== undefined);
  const syncs = await settledSyncs(world);
  const { problems, own } = slowedCommit(world, askOf(events, resumed), "the other session's resuming prompt", syncs);
  const shown = said(call);
  console.log(`${C3} answer seen by ${hook} (${order}): the hook was sent at ${call.sent}, replied in ${Math.round(call.ms)} ms (hold ${JSON.stringify(call.ack?.hold_until_ms ?? null)}), ${shown.includes(north) ? 'carrying' : 'WITHOUT'} the answer; the slowed syncs ${spans(own)}; ${load()}`);
  if (!call.reply) problems.push(`the asking session's ${hook} got no reply`);
  else if (!shown.includes(north)) problems.push(`your answer to ask:${ask.id} ("${north}") was in the record before the asking session's ${hook} was sent, so that hook's reply must carry it; the reply (after ${Math.round(call.ms)} ms) was ${JSON.stringify(shown).slice(0, 700)}`);
  // The slowed commit must have been in its evidence sync at the marked moment: else this showed nothing of it.
  const what = order === 'recorded, then the slowed commit' ? `the ${hook} hook was sent` : 'the answer was given';
  const at = order === 'recorded, then the slowed commit' ? call.sent : marked;
  if (own.length && !during(at, own)) problems.push(`INCONCLUSIVE: ${what} at ${at}, not while a sync of the other session's evidence ran (${spans(own)}; ${load()})`);
  return problems;
}

/** An ask, recorded before the asking session's next hook: its status question's reply counts it. */
async function askSeen(world: World, order: Order): Promise<string[]> {
  const t = tag();
  const question = `Which road should the path take (${t})?`;
  const q = await asker(world);
  const other = await endedSession(world);
  let slowed: Promise<Call>;
  let marked: number;
  if (order === 'recorded, then the slowed commit') {
    await q.ask(question, `North road ${t}`, `South road ${t}`);
    await askFiled(world, q, question);
    slowed = other.prompt(longText('Before you go on, read this through.'));
    await sleep(1500);
    marked = Date.now();
  } else {
    slowed = other.prompt(longText('Before you go on, read this through.'));
    await sleep(1000);
    marked = await q.ask(question, `North road ${t}`, `South road ${t}`);
    await askFiled(world, q, question);
  }
  slowed.catch(() => undefined);
  // One of #83's status questions, typed by you: answered from the record, with the count of what needs you.
  const call = await q.s.prompt('anything for me?');
  const resumed = await slowed;
  const events = await recordUntil(world, `the other session's resuming prompt (user.ask ${resumed.id})`, (all) => askOf(all, resumed) !== undefined);
  const syncs = await settledSyncs(world);
  const { problems, own } = slowedCommit(world, askOf(events, resumed), "the other session's resuming prompt", syncs);
  const shown = said(call);
  const count = /needs you: (\d+)/.exec(shown)?.[1];
  console.log(`${C3} ask seen by a status question (${order}): the hook was sent at ${call.sent}, replied in ${Math.round(call.ms)} ms (hold ${JSON.stringify(call.ack?.hold_until_ms ?? null)}), needs you: ${count ?? 'not said'}; the slowed syncs ${spans(own)}; ${load()}`);
  if (!call.reply) problems.push(`the asking session's status question got no reply`);
  else if (count !== '1') problems.push(`the ask "${question}" was in the record before the status question was sent and is the only open one, so the reply must say "needs you: 1"; the reply (after ${Math.round(call.ms)} ms) was ${JSON.stringify(shown).slice(0, 700)}`);
  const what = order === 'recorded, then the slowed commit' ? 'the status question was sent' : 'deep_ask was called';
  const at = order === 'recorded, then the slowed commit' ? call.sent : marked;
  if (own.length && !during(at, own)) problems.push(`INCONCLUSIVE: ${what} at ${at}, not while a sync of the other session's evidence ran (${spans(own)}; ${load()})`);
  await q.close();
  return problems;
}

describe(`${C3} a reply still sees every answer and ask recorded before its hook`, () => {
  it(`${C3} your answer, recorded before another session's slowed commit starts, is carried by the asking session's prompt sent while that commit's evidence syncs`, async () => {
    w = await startWorld();
    const problems = await answerSeen(w, 'recorded, then the slowed commit', 'UserPromptSubmit');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
  it(`${C3} your answer, given while another session's slowed commit syncs its evidence, is carried by the asking session's prompt sent once the record holds it`, async () => {
    w = await startWorld();
    const problems = await answerSeen(w, 'recorded during the slowed commit', 'UserPromptSubmit');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
  it(`${C3} your answer, given while another session's slowed commit syncs its evidence, is carried by the asking session's Stop sent once the record holds it`, async () => {
    w = await startWorld();
    const problems = await answerSeen(w, 'recorded during the slowed commit', 'Stop');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
  it(`${C3} your answer, given while another session's slowed commit syncs its evidence, is carried by the asking session's SessionStart (resume) sent once the record holds it`, async () => {
    w = await startWorld();
    const problems = await answerSeen(w, 'recorded during the slowed commit', 'SessionStart');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
  it(`${C3} an ask, recorded before another session's slowed commit starts, is counted by the asking session's status question sent while that commit's evidence syncs`, async () => {
    w = await startWorld();
    const problems = await askSeen(w, 'recorded, then the slowed commit');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
  it(`${C3} an ask, filed while another session's slowed commit syncs its evidence, is counted by the asking session's status question sent once the record holds it`, async () => {
    w = await startWorld();
    const problems = await askSeen(w, 'recorded during the slowed commit');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
});
