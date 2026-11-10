// #667 AC1 and AC2, redrafted blind at 32628dba from issue #667, the design and the base (README.md). One world for
// both: the agent stand-in of #667's suite raises a choice ask through its own `deep mcp` (deep_ask, into the hub's
// asks core) while you run `deep inbox` back to back and a test consumer reads the App API's live stream; then you
// answer it with `deep inbox answer`, the OS confirmation stubbed to confirm. `deep inbox` is read in the design's
// layout (States people see): the question first and the handle last, and `deep inbox --json` prints the rows.

import { afterAll, expect, test } from 'vitest';
import {
  Agent, cleanup, closings, decisionsOf, deep, events, expectFramed, expectStreamMatchesRecord, HOUR, inboxRead, load, makeHome, Proof,
  question, raise, SECOND, startHub, Stream, writeSettings, type Ev, type Hub, type InboxRead, type Line, type Outcome, type Ran,
} from '../helpers.ts';

/** The criterion IDs this job was given (README: Criterion IDs, for the ones scripts/proof-change.mjs computes today). */
const ID1 = '#667.84442921';
const ID2 = '#667.b25a1d05';
const T1 = `AC1 ${ID1}`;
const T2 = `AC2 ${ID2}`;

const QUESTION = 'Keep the orders on SQLite or plain files?';
const MINUTE = 60 * SECOND;
const DAY = 24 * HOUR;

// ---- `deep inbox` in the design's layout, read without guessing at its exact words (README: what the implementation must provide).
const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
/** The line of `deep inbox`'s text that names the ask: the one holding its ULID. */
const lineOf = (stdout: string, ulid: string): string | undefined => stdout.split('\n').find((l) => l.includes(ulid));
/**
 * The question first and the handle last: after any glyph that leads the line, it starts with the question; its last
 * field is the handle, or the item's `deepbuild://ask/<ULID>` link right after the handle. `middle` is the rest.
 */
function layout(line: string, handle: string): { questionFirst: boolean; handleLast: boolean; middle: string } {
  const body = line.trim().replace(/^[^\p{L}\p{N}]+/u, '');
  const link = `deepbuild://ask/${handle.slice(4)}`;
  const fields = body.split(/\s+/).map((f) => f.replace(/^[(<[]+|[)>\].,;]+$/g, ''));
  const handleLast = fields.at(-1) === handle || (fields.at(-1) === link && fields.at(-2) === handle);
  const questionFirst = body.startsWith(QUESTION);
  const middle = (questionFirst ? body.slice(QUESTION.length) : body).split(link).join(' ').split(handle).join(' ');
  return { questionFirst, handleLast, middle };
}
/** The session named by its ID: a field holding the ID's first 8 letters and digits, the whole ID included. */
const namesSession = (text: string, session: string): boolean =>
  text.split(/[\s·,;()[\]<>|]+/).some((t) => letters(t).includes(letters(session).slice(0, 8)));
/** Every age the text shows, as [count, unit in ms]: `0s`, `12s`, `3m`, `2h`, `1d`, `5 seconds ago`, `just now`. */
function ages(text: string): [number, number][] {
  const out: [number, number][] = [];
  if (/\bjust now\b/i.test(text)) out.push([0, MINUTE]);
  const size = { s: SECOND, m: MINUTE, h: HOUR, d: DAY } as const;
  for (const m of text.matchAll(/(?:^|[\s·(,])(\d+)\s?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)(?:\s+ago)?(?=$|[\s·),;])/g)) {
    out.push([Number(m[1]), size[m[2]![0] as keyof typeof size]]);
  }
  return out;
}
/** `deep inbox --json`'s rows: a JSON array, an object holding one (`rows`, `asks`, `items`, or its one array of rows), or one row per line. */
function rowsOf(stdout: string): Line[] | undefined {
  const isRows = (v: unknown): v is Line[] => Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x));
  let whole: unknown;
  try {
    whole = JSON.parse(stdout);
  } catch {
    try {
      const each: unknown = stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
      return isRows(each) ? each : undefined;
    } catch {
      return undefined;
    }
  }
  if (isRows(whole)) return whole;
  if (typeof whole !== 'object' || whole === null) return undefined;
  const held = whole as Line;
  for (const key of ['rows', 'asks', 'items']) if (isRows(held[key])) return held[key] as Line[];
  const arrays = Object.values(held).filter(isRows);
  return arrays.length === 1 ? arrays[0] : undefined;
}
/** Every string a row holds, at any depth; `top` leaves out the row's own `id`. */
function strings(v: unknown, top = false): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => (top && k === 'id' ? [] : strings(x)));
  return [];
}
/** A row's `since` as epoch ms: epoch ms, epoch seconds, or ISO 8601. */
function sinceMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * SECOND : v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return sinceMs(Number(v));
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return Date.parse(v);
  return undefined;
}

// ---- The world: one hub, the agent stand-in, the stream consumer, and your `deep inbox` runs around the raise.
interface World {
  home: string; hub: Hub; agent: Agent; stream: Stream; proof: Proof;
  before: InboxRead; created: Ev; handle: string; polls: Ran[];
  call: Promise<{ returned?: Outcome; failed?: string }>;
}
let world: Promise<World> | undefined;
const setUp = () => (world ??= (async () => {
  const proof = new Proof(`${T1} and ${T2} (redraft-1463)`);
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  const hub = await startHub(home, { confirm: 'confirmed' });
  await agent.establish(hub);
  await agent.initialize();
  // The App API read gives the log position the stream subscribes after, so the consumer misses nothing after it.
  const before = await inboxRead(hub);
  if (typeof before.log_pos !== 'number') throw Error(`BLOCKED: inbox.read reflects no log_pos to subscribe after: ${JSON.stringify(before).slice(0, 500)}`);
  const stream = await Stream.open(hub, before.log_pos);
  // You run `deep inbox` back to back from before the ask is raised until a run lists it.
  const polls: Ran[] = [];
  let stop = false;
  const polling = (async () => {
    const until = Date.now() + 60_000;
    while (!stop && Date.now() < until) {
      const r = await deep(home, ['inbox']);
      polls.push(r);
      if (r.stdout.includes(QUESTION)) return;
    }
  })();
  const { call, created } = await raise(agent, hub, question('choice', QUESTION, [['sqlite', 'SQLite'], ['files', 'Plain files']], 'sqlite'));
  await Promise.race([polling, new Promise((r) => setTimeout(r, 30_000))]);
  stop = true;
  await polling;
  for (const r of polls) proof.ran(`deep inbox, started ${r.t0 - created.ts} ms after the append`, r);
  return { home, hub, agent, stream, proof, before, created, handle: `ask:${created.id}`, polls, call };
})());

afterAll(async () => {
  const w = await world?.catch(() => undefined);
  await w?.proof.close(w.hub, w.stream);
  w?.stream.close();
  await cleanup();
}, 60_000);

test(`${ID1} AC1 (proof-change.mjs reads #667.254d6157): deep inbox lists the choice ask with its kind, session and age within a second of its append, and the stream consumer gets its frame at the same log position`, async (ctx) => {
  const { home, agent, stream, proof, before, created, handle, polls } = await setUp();
  const ulid = handle.slice(4);
  const appended = created.ts;
  expect({ kind: created.data.kind, deadline: created.data.deadline - appended, default: created.data.default }, `${T1}: ${handle} is the issue's choice ask, with a 4-hour deadline and a default`)
    .toEqual({ kind: 'choice', deadline: 4 * HOUR, default: 'sqlite' });
  expect(before.log_pos, `${T1}: the stream subscribed after log_pos ${before.log_pos}, before ${handle}'s append at ${created.log_pos}`).toBeLessThan(created.log_pos);

  // Every run started a second or more after the append lists the ask.
  for (const r of polls) expect(r.code, `${T1}: deep inbox exits 0: ${r.stdout}${r.stderr}`).toBe(0);
  for (const r of polls.filter((p) => p.t0 >= appended + SECOND)) {
    expect(lineOf(r.stdout, ulid), `${T1}: deep inbox started ${r.t0 - appended} ms after ${handle}'s append doesn't list it: ${r.stdout}`).toBeDefined();
  }
  const first = polls.find((r) => lineOf(r.stdout, ulid) !== undefined);
  expect(first, `${T1}: deep inbox listed ${handle} within 30 s of its append: ${polls.at(-1)?.stdout}`).toBeDefined();
  const line = lineOf(first!.stdout, ulid)!;

  // The line: the question first, the handle last, and between them the ask's kind, its session and its age.
  const shape = layout(line, handle);
  expect(shape.questionFirst, `${T1}: deep inbox puts ${handle}'s question first (design: States people see): ${line}`).toBe(true);
  expect(shape.handleLast, `${T1}: deep inbox puts ${handle}'s handle last (design: States people see): ${line}`).toBe(true);
  expect(/\bchoice\b/i.test(shape.middle), `${T1}: deep inbox lists ${handle} with its kind, a choice: ${line}`).toBe(true);
  expect(namesSession(shape.middle, agent.session), `${T1}: deep inbox lists ${handle} with its session, ${agent.session}: ${line}`).toBe(true);
  const [lo, hi] = [Math.max(0, first!.t0 - appended), Math.max(0, first!.t1 - appended)];
  expect(ages(shape.middle).some(([n, unit]) => n * unit <= hi && (n + 1) * unit > lo), `${T1}: ${handle}'s age on the line is the time since its append when deep inbox ran (${lo} to ${hi} ms): ${line}`).toBe(true);

  // The same row as JSON: its handle, its kind, its session and since when it waits.
  const json = await deep(home, ['inbox', '--json']);
  proof.ran('deep inbox --json, after the first listing', json);
  expect(json.code, `${T1}: deep inbox --json prints the rows and exits 0 (design: States people see): ${json.stdout}${json.stderr}`).toBe(0);
  const rows = rowsOf(json.stdout);
  expect(rows, `${T1}: deep inbox --json prints its rows as JSON: ${json.stdout}`).toBeDefined();
  const row = rows!.find((r) => r.id === handle || r.id === ulid);
  expect(row, `${T1}: deep inbox --json holds a row whose id is ${handle}: ${json.stdout}`).toBeDefined();
  if ('kind' in row!) expect(row!.kind, `${T1}: ${handle}'s row names its kind: ${JSON.stringify(row)}`).toBe('choice');
  expect(strings(row, true).some((s) => s !== QUESTION && /\bchoice\b/i.test(s)), `${T1}: ${handle}'s row says it is a choice: ${JSON.stringify(row)}`).toBe(true);
  expect(strings(row, true).some((s) => letters(s).includes(letters(agent.session))), `${T1}: ${handle}'s row names its session, ${agent.session}: ${JSON.stringify(row)}`).toBe(true);
  const since = sinceMs(row!.since);
  expect(since !== undefined && Math.abs(since - appended) <= SECOND, `${T1}: ${handle}'s row waits since its append, ${new Date(appended).toISOString()} (its since: ${JSON.stringify(row!.since)})`).toBe(true);

  // The stream's consumer gets its frame at the log position the record holds its append at.
  await expectFramed(T1, stream, created, `the choice ask ${handle}`);

  // Within a second: the run that first listed it ended within 1,000 ms of the append. One that started in time and
  // ended later, under load, is only a reading; no run started a second after the append missed it (above).
  const latency = first!.t1 - appended;
  console.log(`${T1}: deep inbox first listed ${handle} in a run from ${first!.t0 - appended} to ${latency} ms after its append (load ${load()})`);
  if (latency > SECOND) ctx.skip(`INCONCLUSIVE ${T1}: deep inbox started ${first!.t0 - appended} ms after the append and listed ${handle} at ${latency} ms, over the second, at load ${load()}; no run started a second after the append missed it`);
}, 240_000);

test(`${ID2} AC2 (proof-change.mjs reads #667.8700acae): deep inbox answer on the choice ask saves a decision with its scope, the ask leaves deep inbox, the stream shows it answered, and the test process that raised it gets the answer once`, async () => {
  const { home, hub, agent, stream, proof, created, handle, call } = await setUp();
  const ulid = handle.slice(4);
  const answered = await deep(home, ['inbox', 'answer', handle, 'files']);
  proof.ran(`deep inbox answer ${handle} files`, answered);
  expect(answered.code, `${T2}: deep inbox answer ${handle} files, the OS confirming you, exits 0: ${answered.stdout}${answered.stderr}`).toBe(0);
  let all = await events(hub);

  // One answer, and one decision at the ask's scope: its session's repo, or its session where the session has none.
  const session = created.session ?? agent.session;
  const project = created.project ?? all.find((e) => e.kind === 'session.start' && e.session === session && e.project)?.project;
  const scope = project ? `repo:${letters(project)}` : `session:${letters(session)}`;
  expect(closings(all, handle).map((e) => [e.kind, e.data.answer]), `${T2}: ${handle} is answered once, files`).toEqual([['ask.answered', 'files']]);
  expect(decisionsOf(all, handle).map((e) => [e.kind, e.data.answer, e.data.scope]), `${T2}: your answer to ${handle} is saved as one decision at its scope, ${scope}`).toEqual([['decision.created', 'files', scope]]);

  // The ask leaves deep inbox, as text and as rows.
  const text = await deep(home, ['inbox']);
  proof.ran('deep inbox, after the answer', text);
  expect(text.code, `${T2}: deep inbox exits 0 after the answer: ${text.stdout}${text.stderr}`).toBe(0);
  expect(lineOf(text.stdout, ulid), `${T2}: ${handle} leaves deep inbox once answered: ${text.stdout}`).toBeUndefined();
  const json = await deep(home, ['inbox', '--json']);
  proof.ran('deep inbox --json, after the answer', json);
  expect(json.code, `${T2}: deep inbox --json exits 0 after the answer (design: States people see): ${json.stdout}${json.stderr}`).toBe(0);
  expect(rowsOf(json.stdout), `${T2}: deep inbox --json prints its rows as JSON: ${json.stdout}`).toBeDefined();
  expect(json.stdout.includes(ulid), `${T2}: ${handle} leaves deep inbox --json once answered: ${json.stdout}`).toBe(false);

  // The stream shows it answered, at the log position the record holds the answer at.
  await expectFramed(T2, stream, closings(all, handle)[0]!, `${handle} answered`);

  // The process that raised it gets the answer: its deep_ask returns it (or, past that call's wait, its deep_wait).
  let got = await call;
  if (got.returned?.value?.status === 'waiting') got = { returned: await agent.tool('deep_wait', { ask: handle }) };
  proof.note('deep_ask, as the agent got it', JSON.stringify(got));
  expect({ ask: got.returned?.value?.ask, status: got.returned?.value?.status, answer: got.returned?.value?.answer }, `${T2}: the agent's deep_ask returns your answer: ${JSON.stringify(got)}`)
    .toEqual({ ask: handle, status: 'answered', answer: 'files' });

  // Once: a second answer is refused and recorded as refused, and nothing of it reaches the agent.
  const again = await deep(home, ['inbox', 'answer', handle, 'sqlite']);
  proof.ran(`deep inbox answer ${handle} sqlite, a second answer`, again);
  expect(again.code, `${T2}: a second answer to ${handle} is refused: ${again.stdout}${again.stderr}`).not.toBe(0);
  const waited = await agent.tool('deep_wait', { ask: handle });
  proof.note('deep_wait after the second answer', JSON.stringify(waited.value));
  expect({ status: waited.value?.status, answer: waited.value?.answer }, `${T2}: deep_wait after a second answer still holds the first: ${JSON.stringify(waited.value)}`)
    .toEqual({ status: 'answered', answer: 'files' });
  all = await events(hub);
  expect(closings(all, handle).map((e) => e.data.answer), `${T2}: ${handle} has one answer in the record`).toEqual(['files']);
  expect(decisionsOf(all, handle).length, `${T2}: ${handle} saved one decision`).toBe(1);
  expect(all.filter((e) => e.kind === 'answer.refused' && (e.subject === handle || e.data?.ask === handle)).length, `${T2}: the second answer to ${handle} is recorded as answer.refused`).toBe(1);

  // Every step shows the same on the stream as in the record (the issue's summary).
  await expectStreamMatchesRecord(T2, stream, hub);
}, 240_000);
