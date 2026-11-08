// Each criterion's assertions that a named wrong program must fail, as functions returning problems: the real hub's
// observations must give none, and each twin's (twins.ts) must give one naming what the criterion says.
import { HOUR, words, type DeliveryRow, type WorkResult } from './helpers.ts';

/** AC9: what a run of the 20 items left. */
export interface ReadsSeen { taken: string[]; verdicts: { verdict: string | null; cause: string | null }[]; paused: boolean; dropped: { id: string; at: number }[] }
export function judgeReads(seen: ReadsSeen, x: { all: string[]; deleted: string; notFound: string; firstFailed: number; now: number }): string[] {
  const problems: string[] = [];
  const missing = x.all.filter((id) => id !== x.deleted && id !== x.notFound && !seen.taken.includes(id));
  if (missing.length) problems.push(`not taken in: ${missing.join(', ')}`);
  for (const r of seen.verdicts) if (r.verdict === 'FAIL') problems.push(`a run ended FAIL: ${r.cause ?? 'no cause'}`);
  if (seen.paused) problems.push('the source paused');
  if (!seen.dropped.some((d) => d.id === x.deleted)) problems.push(`${x.deleted}, answered deleted, wasn't dropped at once`);
  const nf = seen.dropped.find((d) => d.id === x.notFound);
  if (nf && nf.at < x.firstFailed + 24 * HOUR) problems.push(`${x.notFound} dropped ${((nf.at - x.firstFailed) / HOUR).toFixed(1)} h after its first failed read, before 24 h`);
  if (!nf && x.now >= x.firstFailed + 24 * HOUR) problems.push(`${x.notFound} not dropped 24 h after its first failed read`);
  return problems;
}

/** AC10: the tasks the backlog made. */
export function judgeBacklog(tasks: string[], backlog: Set<string>): string[] {
  const from = tasks.filter((t) => backlog.has(t));
  return from.length ? [`${from.length} tasks made from the backlog of ${backlog.size} messages`] : [];
}

/** AC12: the events taken in on issue 42's thread after the delivery; `delivered` the source IDs of the comments the delivery wrote. */
export function judgeReadBack(taken: string[], delivered: string[], key: string): string[] {
  const back = taken.filter((id) => delivered.includes(id));
  return back.length ? [`the delivery ${key} came back as an update: ${back.join(', ')}`] : [];
}

/** AC13: a delivery to a target that can never take it. */
export function judgeGone(row: DeliveryRow | undefined, x: { key: string; task_ref: string; attempts: number; fails: number; paused: boolean }): string[] {
  const problems: string[] = [];
  if (!row) return [`${x.key}: no delivery recorded`];
  if (row.outcome !== 'gone') problems.push(`${x.key} reads ${row.outcome}, not gone`);
  if (!row.cause) problems.push(`${x.key} is gone with no cause`);
  if (row.at === null) problems.push(`${x.key} is gone with no time`);
  if (row.task_ref !== x.task_ref) problems.push(`${x.key} names the task ${row.task_ref}, not ${x.task_ref}`);
  if (x.attempts !== 1) problems.push(`${x.key} was tried ${x.attempts} times`);
  if (x.fails) problems.push(`${x.key} made ${x.fails} FAIL runs of the source's schedule`);
  if (x.paused) problems.push(`${x.key} paused the source's schedule`);
  return problems;
}

/** AC14: after the restart, the delivery reads sent or not sent, and one comment with its marker is at the provider. */
export function judgeSettled(row: DeliveryRow | undefined, key: string, marked: number): string[] {
  const problems: string[] = [];
  if (!row || row.outcome === 'unknown') problems.push(`${key} left unknown, though the tracker can answer whether it holds the marker`);
  if (marked !== 1) problems.push(`${key}: ${marked} comments carry its marker`);
  return problems;
}

/** AC15: the order the tracker got the two keys' requests in: each request's key and status. */
export function judgeOrder(requests: { key: string | null; status: number }[], first: string, second: string): string[] {
  const firstDone = requests.findIndex((r) => r.key === first && r.status === 201);
  const secondAt = requests.findIndex((r) => r.key === second);
  if (secondAt < 0 || firstDone < 0) return [`${first} or ${second} never reached the tracker: ${JSON.stringify(requests)}`];
  return secondAt < firstDone ? [`${second} reached the tracker before ${first} was settled`] : [];
}

/** AC18: a chat reply holds the verdict line and at most 100 words, with the receipt's link. */
export function judgeChat(text: string | undefined, key: string, r: WorkResult): string[] {
  if (text === undefined) return [`${key}: no reply in the chat thread`];
  const problems: string[] = [];
  const n = words(text);
  if (n > 100) problems.push(`${key} posted ${n} words into the chat`);
  if (!text.split('\n')[0]!.includes(r.verdict)) problems.push(`${key}'s first line isn't the verdict line: ${JSON.stringify(text.split('\n')[0])}`);
  if (!text.includes(r.receipt)) problems.push(`${key} carries no link to its receipt`);
  return problems;
}
/** AC18: an issue comment carries each requirement's verdict. */
export function judgeIssue(text: string | undefined, key: string, r: WorkResult): string[] {
  if (text === undefined) return [`${key}: no comment on the issue`];
  const lines = text.split('\n');
  return r.requirements.filter((q) => !lines.some((l) => l.includes(q.id) && l.includes(q.verdict))).map((q) => `${key} gives no verdict for ${q.id}`);
}
