// The wrong programs the criteria name, built here, never by editing a package: each is a model beside the hub that
// reads or writes the same local provider the real hub's test used, at the same point of the scenario, and hands the
// criterion's judge (judges.ts) what it saw. They prove the judge tells the wrong program from a right one on the
// scenario's own answers; the real hub's observations are judged by the same function.
import type { DeliveryRow } from './helpers.ts';
import type { ReadsSeen } from './judges.ts';
import { LABEL, REPO_WEB, type Chat, type Gmail, type Tracker } from './providers.ts';

const get = (base: string, path: string, auth = false) => fetch(`${base}${path}`, auth ? { headers: { authorization: 'Bearer twin' } } : {});
const post = (base: string, path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const n = (id: string) => Number(id.split('#')[1]);

/** AC9: a source that ends its run FAIL at the first item whose read fails. */
export async function failsRunOnItem(tr: Tracker, all: string[]): Promise<ReadsSeen> {
  const taken: string[] = [];
  for (const id of all) {
    const r = await get(tr.p.base, `/repos/${REPO_WEB}/issues/${n(id)}`);
    if (r.status !== 200) return { taken, verdicts: [{ verdict: 'FAIL', cause: `${id} answered ${r.status}` }], paused: false, dropped: [] };
    taken.push(id);
  }
  return { taken, verdicts: [{ verdict: 'PASS', cause: null }], paused: false, dropped: [] };
}
/** AC9: a source that drops an item at its first failed read, whatever the answer. */
export async function dropsAtOnce(tr: Tracker, all: string[], now: number): Promise<ReadsSeen> {
  const seen: ReadsSeen = { taken: [], verdicts: [{ verdict: 'PASS', cause: null }], paused: false, dropped: [] };
  for (const id of all) {
    const r = await get(tr.p.base, `/repos/${REPO_WEB}/issues/${n(id)}`);
    if (r.status === 200) seen.taken.push(id);
    else seen.dropped.push({ id, at: now });
  }
  return seen;
}

/** AC10: a source that turns every message in the label into a task. */
export async function backlogAsTasks(gm: Gmail): Promise<string[]> {
  const ids: string[] = [];
  for (let token: string | undefined = '0'; token !== undefined;) {
    const r = await get(gm.p.base, `/gmail/v1/users/me/messages?labelIds=${LABEL}&maxResults=100&pageToken=${token}`, true);
    const page = (await r.json()) as { messages: { id: string }[]; nextPageToken?: string };
    ids.push(...page.messages.map((m) => m.id));
    token = page.nextPageToken;
  }
  return ids;
}

/** AC12: a source that reads every comment on the issue back, its own delivery's among them: their source IDs. */
export async function readsOwnDelivery(tr: Tracker, issue: number): Promise<string[]> {
  const r = await get(tr.p.base, `/repos/${REPO_WEB}/issues/${issue}/comments`);
  return ((await r.json()) as { id: number }[]).map((c) => `${REPO_WEB}#${issue}.c${c.id}`);
}

/** AC13: a hub that tries a gone delivery again: the same comment once more. Returns how many times it was tried. */
export async function triesAgain(tr: Tracker, issue: number, key: string): Promise<number> {
  const first = tr.posts(issue).find((s) => s.body.includes(key));
  await post(tr.p.base, `/repos/${REPO_WEB}/issues/${issue}/comments`, JSON.parse(first?.body ?? '{}'));
  return tr.posts(issue).filter((s) => s.body.includes(key)).length;
}

/** AC14: a hub that, after its restart, leaves the delivery as it found it: unknown. */
export const leavesUnknown = (row: DeliveryRow): DeliveryRow => ({ ...row, outcome: 'unknown' });

/** AC15: a hub that sends the second delivery first, each tried again until the tracker takes it. */
export async function sendsSecondFirst(tr: Tracker, issue: number, bodies: { key: string; body: string }[]): Promise<{ key: string | null; status: number }[]> {
  const out: { key: string | null; status: number }[] = [];
  const pending = [...bodies].reverse();
  for (let i = 0; i < 10 && pending.length; i++) {
    const next = pending[i % pending.length]!;
    const r = await post(tr.p.base, `/repos/${REPO_WEB}/issues/${issue}/comments`, { body: next.body });
    out.push({ key: next.key, status: r.status });
    if (r.status === 201) pending.splice(pending.indexOf(next), 1);
  }
  return out;
}

/** AC18: a send that posts the full receipt, as the issue got it, into the chat thread under its key. */
export async function postsFullReceipt(ch: Chat, ts: string, key: string, receipt: string): Promise<string | undefined> {
  await post(ch.p.base, `/channels/C1/threads/${ts}/replies`, { text: receipt, key });
  return ch.replies(ts).find((r) => r.key === key)?.text;
}
