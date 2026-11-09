// The cases of the threat row "Signatures used again" (design: Threats, and what stops each one), each against a
// real hub through its socket. Each returns what went wrong, or null. AC1 and AC2 run them one by one; together they
// are the row's kit (`signatureKit`), which AC5 runs against the planted verifier that skips the time.
import {
  answeredNothing, approve, asApp, defaulted, eventsOf, fieldPointer, inboxRow, MINUTE, refusedNaming, restart, sha256, signing, signNew,
  undoneCount, world, type Line, type Seeded, type World,
} from './helpers.ts';

/** An undo ask: an authority ask (it defaults to no) that waits 3 minutes, so stepping the clock 4 defaults it. */
export const UNDO_WAIT_MS = 3 * MINUTE;
export const PAST_WAIT_MS = 4 * MINUTE;

/** An answer that must count: a result, one ask.answered, and the ask answered in the inbox. */
export async function countedAnswer(w: World, ask: Seeded, reply: Line, what: string): Promise<string | null> {
  if (!('result' in reply)) return `${what} didn't count: ${JSON.stringify(reply.error ?? reply).slice(0, 600)}`;
  const answered = await eventsOf(w, 'ask.answered', ask.handle);
  if (answered.length !== 1) return `${what}: ${ask.handle} has ${answered.length} ask.answered, not 1`;
  const row = await inboxRow(w, ask.handle);
  if (row?.outcome !== 'answered') return `${what}: ${ask.handle} isn't answered in the inbox: ${JSON.stringify(row)}`;
  return null;
}
/** An undo that must count: a result, one more default.undone, and the ask open again. */
async function countedUndo(w: World, ask: Seeded, reply: Line, before: number, what: string): Promise<string | null> {
  if (!('result' in reply)) return `${what} didn't count: ${JSON.stringify(reply.error ?? reply).slice(0, 600)}`;
  const n = await undoneCount(w, ask.handle);
  if (n !== before + 1) return `${what}: ${ask.handle} was opened again ${n - before} times, not once`;
  const row = await inboxRow(w, ask.handle);
  if (row?.outcome !== 'unanswered') return `${what}: ${ask.handle} isn't open again: ${JSON.stringify(row)}`;
  return null;
}

/**
 * AC1: a signature captured on an undo, sent on another method. The app signs `ask.undo` for a defaulted ask, which
 * counts and opens it again; the same params with the same signature then go to `ask.answer` (the call's params,
 * `{ask}`, are the same bytes, so only `method` differs from what was signed). Refused naming `method`, the refusal
 * naming `ask.undo`, the method the signature is for; nothing answered.
 */
export async function caseMethod(w: World, x: Seeded): Promise<string | null> {
  await defaulted(w, x.handle, PAST_WAIT_MS);
  const before = await undoneCount(w, x.handle);
  const captured = signNew('ask.undo', { ask: x.handle }, w.device, await signing(w));
  const undo = await countedUndo(w, x, await asApp(w, 'ask.undo', captured), before, `the undo of ${x.handle} signed for ask.undo`);
  if (undo) return undo;
  const reply = await asApp(w, 'ask.answer', captured);
  const wrong = refusedNaming(reply, 'method', `the signature captured on the undo of ${x.handle}, sent on ask.answer`);
  if (wrong) return wrong;
  if (!JSON.stringify(reply.error).includes('ask.undo')) return `the refusal doesn't name the method the signature is for, ask.undo: ${JSON.stringify(reply.error).slice(0, 600)}`;
  return answeredNothing(w, x.handle);
}

/** AC2: a signature 11 minutes old by the hub's clock, refused naming `at`; nothing answered. */
export async function caseAt(w: World, a: Seeded): Promise<string | null> {
  const reply = await asApp(w, 'ask.answer', signNew('ask.answer', approve(a), w.device, await signing(w, 11 * MINUTE)));
  return refusedNaming(reply, 'at', `an approval of ${a.handle} signed 11 minutes ago`) ?? answeredNothing(w, a.handle);
}
/** The window's other side: a signature 9 minutes old counts, so the window is 10 minutes and no shorter. */
export async function caseWithinWindow(w: World, a: Seeded): Promise<string | null> {
  const reply = await asApp(w, 'ask.answer', signNew('ask.answer', approve(a), w.device, await signing(w, 9 * MINUTE)));
  return countedAnswer(w, a, reply, `an approval of ${a.handle} signed 9 minutes ago`);
}
/** AC2: a signature for another hub, refused naming `hub`; nothing answered. */
export async function caseHub(w: World, a: Seeded): Promise<string | null> {
  const other = { ...(await signing(w)), hub: sha256(`another hub than ${w.hubId}`) };
  if (other.hub === w.hubId) throw Error('BLOCKED: setup: the other hub ID is this one');
  const reply = await asApp(w, 'ask.answer', signNew('ask.answer', approve(a), w.device, other));
  return refusedNaming(reply, 'hub', `an approval of ${a.handle} signed for another hub`) ?? answeredNothing(w, a.handle);
}
/** A fresh signature by the paired app counts: what a refusal above refused was the field it names. */
export async function caseFresh(w: World, a: Seeded): Promise<string | null> {
  const reply = await asApp(w, 'ask.answer', signNew('ask.answer', approve(a), w.device, await signing(w)));
  return countedAnswer(w, a, reply, `a fresh approval of ${a.handle}`);
}
/**
 * AC2: a replayed signature, as the issue tells it: a signed undo counts, the ask defaults again, and the same signed
 * undo comes back within its 10 minutes. Refused naming `once`, and the ask stays defaulted. With `restart`, the hub
 * is stopped and started again and the replay is refused the same way: a spent ID stays spent across restarts.
 */
export async function caseOnce(w: World, x: Seeded, o: { restart?: boolean } = {}): Promise<string | null> {
  await defaulted(w, x.handle, PAST_WAIT_MS);
  const first = await undoneCount(w, x.handle);
  const captured = signNew('ask.undo', { ask: x.handle }, w.device, await signing(w));
  const undo = await countedUndo(w, x, await asApp(w, 'ask.undo', captured), first, `the first undo of ${x.handle}`);
  if (undo) return undo;
  await defaulted(w, x.handle, PAST_WAIT_MS);
  const replays = o.restart ? ['replayed', 'replayed after the hub restarted'] : ['replayed'];
  for (const replay of replays) {
    if (replay !== 'replayed') await restart(w);
    const before = await undoneCount(w, x.handle);
    const wrong = refusedNaming(await asApp(w, 'ask.undo', captured), 'once', `the undo of ${x.handle} ${replay}`);
    if (wrong) return wrong;
    if ((await undoneCount(w, x.handle)) !== before) return `the undo of ${x.handle} ${replay} opened it again`;
    if ((await inboxRow(w, x.handle))?.outcome !== 'defaulted') return `${x.handle} didn't stay defaulted after the undo was ${replay}`;
  }
  return null;
}

// ---- The kit.
export const KIT_ASKS = [
  { source: 'effect.push', question: 'Push release/1579-method to origin?', waitMs: UNDO_WAIT_MS },
  { source: 'effect.push', question: 'Push release/1579-once to origin?', waitMs: UNDO_WAIT_MS },
  { source: 'effect.push', question: 'Push feature/1579-at to origin?' },
  { source: 'effect.push', question: 'Push feature/1579-hub to origin?' },
  { source: 'effect.push', question: 'Push feature/1579-window to origin?' },
] as const;
export type KitCase = 'at' | 'within the window' | 'hub' | 'fresh after the refusals' | 'method' | 'once';
export type KitReport = Record<KitCase, string | null>;
/**
 * Every case of the row on one hub, the time cases before the clock steps: an 11-minute-old signature, a 9-minute-old
 * one, another hub's, a fresh one for the ask the old and other-hub ones were refused for, the captured undo on
 * another method, the replayed undo. A hub passes the kit when every case is null.
 */
export async function signatureKit(plant?: string): Promise<KitReport> {
  const w = await world({ asks: [...KIT_ASKS], ...(plant ? { plant } : {}) });
  const [xMethod, xOnce, aAt, aHub, aWindow] = w.asks as [Seeded, Seeded, Seeded, Seeded, Seeded];
  const report = {} as KitReport;
  report.at = await caseAt(w, aAt);
  report['within the window'] = await caseWithinWindow(w, aWindow);
  report.hub = await caseHub(w, aHub);
  report['fresh after the refusals'] = await caseFresh(w, aHub);
  report.method = await caseMethod(w, xMethod);
  report.once = await caseOnce(w, xOnce);
  return report;
}
export { fieldPointer };
