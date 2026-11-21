// Test-side tools for #1527's acceptance tests (README): #1342's world (the real hub under a temp HOME, `deep`, the box,
// the card and `deep inbox`), imported by path, with three changes made here: the hub serves `test.clock`
// (DEEP_HUB_TEST_CLOCK_STEPS=1, #965), so a test lets hours and months pass on the hub's clock; the played `claude` is
// this folder's (fixtures/claude.pl), which also plays a run's model turns and the card's dry run from the test's
// work.json; and a fixture feed on 127.0.0.1 the test changes between fires. Readings come from the record
// (`events.read` over the hub's socket), `deep`, `deep inbox`, `deep status --json` and the job's workspace on disk.
// Nothing here stands in for DeepBuild. No network beyond 127.0.0.1, no paid model; processes are stopped by PID only,
// and only ones a world started (#1342's World does that).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { control, REPO } from '../29/h-d.ts';
import { iso, MIN, NODE, real, shown, sleep, waitUntil, World, type Answer, type Card, type Ev, type Line, type Ran, type Sent } from '../1342/helpers.ts';

export { iso, MIN, real, shown, sleep, waitUntil, World };
export type { Card, Ev, Line, Ran, Sent };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** The account #1342's world signs the agent in to, whose plan window the runner reads. */
const ACCOUNT = '0a0a0a0a-1111-4222-8333-555555555555';

/** The criteria's IDs: `#1527.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: '#1527.0d2627bf', 2: '#1527.a2d33481', 3: '#1527.ad1741ab', 4: '#1527.d17d4e44', 5: '#1527.6377853f', 6: '#1527.3e630e3d', 7: '#1527.cd627fd5',
} as const;
/** The criteria's text, as the issue says it. */
export const CRITERION = {
  1: 'On a controlled clock, an hourly job over a fixture feed that changes once in 24 hours makes one model turn and 23 uncounted no-ops, with no plan usage on those 23. A planted program that wakes the model on each fire fails, naming the fire',
  2: 'A wake test that exits non-zero gives a FAIL on the claim, spaced as #365 states. A program that reads the failure as nothing new fails, naming the run',
  3: 'At approval, a wake test that stays quiet on the planted change is refused, naming it, and so is one that wakes on the twin',
  4: 'A session that edits an approved wake test changes nothing: the next fire is BLOCKED on the digest, naming the file',
  5: "A monthly report's second run, with the same columns and new numbers, makes no model turn and still passes its data check. With a column renamed, it wakes the model once",
  6: 'A card for an hourly job with no wake test is refused, naming the job',
  7: 'The card shows a cost per run and per month. A card without them fails, and a run past its per-run line stops before its next model turn',
} as const;
export const named = (n: keyof typeof AC): string => `${AC[n]} ${CRITERION[n]}`;

// ---- Fixtures.
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
/** Where the approved wake test and the job's own script live in the job's workspace (README: The contract). */
export const WAKE_FILE = '.deepbuild/wake.sh';
export const JOB_FILE = '.deepbuild/job.sh';
export const DATA_CHECK = '.deepbuild/checks/data.sh';

// ---- The research job's answer for a repeat job (README: The contract): #1342's, with what it watches and its wake test.
export interface Planted { name: string; before: string; after: string }
export interface Wake { test: string; planted: Planted; twin: Planted }
export type RepeatAnswer = Answer & { watch: string; wake?: Wake };
/** The brief a repeat job's card carries: #1342's, with its cadence and its cost lines. */
export interface Cost { run_usd: number; month_usd: number }

/** The team feed's wake test as it should be, its planted change (a third story) and its twin (the same two, fetched again). */
export const FEED_WAKE = (test = fixture('wake-ok.sh')): Wake => ({
  test,
  planted: { name: 'a third story in the feed', before: fixture('feed-two.json'), after: fixture('feed-three.json') },
  twin: { name: 'the same two stories, fetched again', before: fixture('feed-two.json'), after: fixture('feed-two-again.json') },
});

/** An hourly watcher of the team feed: `deep "<words>"`'s words (heading on the first line, the feed's link on the second) and the research answer. */
export function hourly(feed: string, o: { topic?: string; wake?: Wake | null } = {}): { words: string; heading: string; answer: RepeatAnswer } {
  const topic = o.topic ?? 'team feed';
  const heading = `every hour, check the ${topic} for new stories`;
  const answer: RepeatAnswer = {
    makes: 'report',
    lines: [
      { id: 'L1', field: 'makes', text: `A note of each new story in the ${topic}`, cites: [{ at: 'words', quote: `check the ${topic} for new stories` }] },
      { id: 'L2', field: 'holds', text: 'Each new story, noted once', cites: [{ at: 'words', quote: 'new stories' }] },
      { id: 'L3', field: 'proves', text: `Every story in the ${topic} is in the notes`, cites: [{ at: 'words', quote: `check the ${topic}` }] },
    ],
    promises: [{ line: 'L3', kind: 'document' }],
    tasks: [{ title: 'Note the new stories', serves: ['L1', 'L2'] }],
    held: [],
    fits: null,
    watch: feed,
    ...(o.wake === null ? {} : { wake: o.wake ?? FEED_WAKE() }),
  };
  return { words: `${heading}\n${feed}`, heading, answer };
}

/** A monthly report from an attached CSV: words, heading and the research answer (one task, unless `tasks` names more). */
export function monthly(csv: string, o: { topic?: string; tasks?: string[] } = {}): { words: string; heading: string; answer: RepeatAnswer } {
  const topic = o.topic ?? 'sales';
  const heading = `every month, write the ${topic} report from the attached file`;
  const tasks = o.tasks ?? [`Write the ${topic} report`];
  const answer: RepeatAnswer = {
    makes: 'report',
    lines: [
      { id: 'L1', field: 'makes', text: `A monthly ${topic} report`, cites: [{ at: 'words', quote: `write the ${topic} report` }] },
      { id: 'L2', field: 'proves', text: `The report's total is the sum of the file's amounts`, cites: [{ at: 'words', quote: `${topic} report from the attached file` }] },
    ],
    promises: [{ line: 'L2', kind: 'data' }],
    tasks: tasks.map((title) => ({ title, serves: ['L1', 'L2'] })),
    held: [],
    fits: null,
    watch: csv,
  };
  return { words: heading, heading, answer };
}

// ---- What the played model does: work.json beside the played claude (README: What is played).
export interface Turn { match?: string; cost_usd: number | null; files?: Record<string, string>; says?: string }
export interface Work { dry: Turn[]; turns: Turn[] }

// ---- The fixture feed: one link, its body set by the test.
export class Feed {
  readonly requests: { at: number; path: string }[] = [];
  private constructor(private readonly server: http.Server, readonly url: string, private body: string, private type: string) {}
  static async start(body: string): Promise<Feed> {
    let feed: Feed | undefined;
    const server = http.createServer((req, res) => {
      feed!.requests.push({ at: Date.now(), path: req.url ?? '/' });
      if ((req.url ?? '/').split('?')[0] !== '/feed.json') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found\n'); return; }
      res.writeHead(200, { 'content-type': feed!.type });
      res.end(feed!.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    feed = new Feed(server, `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.json`, body, 'application/json');
    return feed;
  }
  /** What the feed answers from now on. */
  set(body: string, type = 'application/json'): void { this.body = body; this.type = type; }
  async close(): Promise<void> { this.server.closeAllConnections(); await new Promise<void>((resolve) => this.server.close(() => resolve())); }
}

// ---- The world: #1342's, its hub serving test.clock, this folder's played claude installed over #1342's.
const steps = World.prototype.env;
World.prototype.env = function env(this: World): NodeJS.ProcessEnv { return { ...steps.call(this), DEEP_HUB_TEST_CLOCK_STEPS: '1' }; };
const VERSION = (JSON.parse(readFileSync(join(REPO, 'adapters', 'claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
const feeds: Feed[] = [];
afterAll(async () => { for (const f of feeds.splice(0)) await f.close(); }, 60_000);

/** One run of a repeat job, folded from its `schedule.run` events (README: The contract). */
export interface Run { run: string; schedule: string; due: number; first: Ev; ended?: Ev; verdict?: string; noop: boolean; cause: string }
/** One fire: the clock let pass, the runs of the job it began, and the record between. */
export interface Fire { i: number; at: number; from: number; to: number; runs: Run[]; events: Ev[]; turns: Ev[]; usage: Ev[] }

export class Job {
  feed?: Feed;
  private constructor(readonly w: World) {}
  static async open(o: { feed?: string } = {}): Promise<Job> {
    // The hub's guards name deep-hook, so it won't start without it; a missing build reads BLOCKED.
    const w = await World.open({ sessions: true });
    const j = new Job(w);
    writeFileSync(join(w.bin, 'claude'), fixture('claude.pl').replace("'__VERSION__'", `'${VERSION}'`).replace("'__NODE__'", `'${NODE}'`).replace("'__SESSION__'", `'${join(w.agents, 'session.mjs')}'`), { mode: 0o755 });
    j.work({ dry: [{ cost_usd: 0.05 }], turns: [{ cost_usd: 0.05 }] });
    if (o.feed !== undefined) { j.feed = await Feed.start(o.feed); feeds.push(j.feed); }
    await j.pass(0);
    return j;
  }

  /** What the played research job answers. */
  answers(list: { match: string; answer: RepeatAnswer }[]): void { this.w.answers(list as unknown as Parameters<World['answers']>[0]); }
  /** What the played model does on the card's dry run and on a run's turns, from now on. */
  work(work: Work): void { writeFileSync(join(this.w.bin, 'work.json'), `${JSON.stringify(work, null, 2)}\n`); }

  // ---- The hub's clock.
  /** Lets `ms` pass on the hub's clock (test.clock) and reports a plan window with room at the new time; the hub's now. */
  async pass(ms: number): Promise<number> {
    const r: Line = await control(this.w.hub, 'test.clock', { advance_ms: ms }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
    if (typeof r.now !== 'number') throw Error(`BLOCKED: the hub serves no test.clock with DEEP_HUB_TEST_CLOCK_STEPS=1 (README: How to run): ${JSON.stringify(r)}`);
    const s = Math.floor(r.now / 1000);
    await control(this.w.hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: s + 10_800 }, seven_day: { used_percentage: 20, resets_at: s + 400_000 } } });
    return r.now;
  }

  /**
   * One fire: `ms` passes on the hub's clock, then the test waits until a run of the job began (or 12 s with none) and
   * nothing of it, and no job on the runner, is still going (5 minutes at most).
   */
  async fire(i: number, key: string, ms: number): Promise<Fire> {
    const from = await this.w.lastPos();
    const at = await this.pass(ms);
    await this.settle(key, from);
    const events = (await this.w.events()).filter((e) => e.log_pos > from);
    const runs = runsOf(events, key);
    return { i, at, from, to: events.at(-1)?.log_pos ?? from, runs, events, turns: turnsIn(events), usage: usageIn(events) };
  }
  private async settle(key: string, from: number): Promise<void> {
    const t0 = Date.now();
    await sleep(3000);
    for (;;) {
      const all = await this.w.events();
      const after = all.filter((e) => e.log_pos > from);
      const begun = runsOf(after, key).length > 0;
      const busy = runsOf(all, key).some((r) => !r.ended) || jobsGoing(all).length > 0;
      if (!busy && (begun || Date.now() - t0 > 12_000)) return;
      if (Date.now() - t0 > 5 * MIN) return;
      await sleep(1000);
    }
  }

  // ---- Send, the card and your yes.
  /** `deep "<words>" [--file <path>]... --json`, and its card once raised (or none once it ended). */
  async ask(words: string, files: string[] = []): Promise<{ sent: Sent; card: Card | undefined }> {
    const sent = await this.w.send(words, files);
    const card = await this.w.card(sent, 10 * MIN);
    await Promise.race([sent.done!, sleep(60_000)]);
    return { sent, card };
  }
  /** Your yes to a card on the trusted path, `deep inbox answer <card> <option>`; what it printed. */
  async yes(card: Card): Promise<{ at: number; pos: number; ran: Ran }> {
    const option = ((card.created.data.options ?? []) as { id: string; decision?: string }[]).find((x) => x.decision === 'allow');
    const pos = await this.w.lastPos();
    const at = Date.now();
    const ran = await this.w.deep(['inbox', 'answer', card.ask, option?.id ?? 'allow']);
    return { at, pos, ran };
  }
  /**
   * The first run after your yes: a run of the job recorded within 2 minutes of it, then until it ended (10 minutes).
   * Undefined when none began.
   */
  async firstRun(key: string, pos: number): Promise<Run | undefined> {
    const begun = await waitUntil(async () => runsOf((await this.w.events()).filter((e) => e.log_pos > pos), key)[0], 2 * MIN, 1000);
    if (!begun) return undefined;
    const ended = await waitUntil(async () => {
      const all = await this.w.events();
      const r = runsOf(all.filter((e) => e.log_pos > pos), key)[0];
      return r?.ended && !jobsGoing(all).length ? r : undefined;
    }, 10 * MIN, 1000);
    return ended ?? runsOf((await this.w.events()).filter((e) => e.log_pos > pos), key)[0];
  }
  /** The workspace your yes made after `pos`, by its `workspace.created`. */
  async workspace(pos: number): Promise<{ id: string; folder: string } | undefined> {
    return waitUntil(async () => {
      const e = (await this.w.events()).find((x) => x.kind === 'workspace.created' && x.log_pos > pos);
      return e ? { id: String(e.data.workspace), folder: real(String(e.data.folder)) } : undefined;
    }, 5 * MIN, 1000);
  }

  /**
   * What DeepBuild told you about one input after `since` (README: Readings, "refused, naming it"): what `deep` and
   * `deep inbox answer` printed, each refusal on the record, each ask other than a card, and each row of the list.
   */
  async told(sent: Sent, also: Ran[] = []): Promise<string> {
    const after = (await this.w.events()).filter((e) => e.log_pos > sent.since);
    const cards = new Set(after.filter((e) => e.kind === 'brief.drafted').map((e) => String(e.data.ask)));
    // A card's own row says what the card says, so it names nothing on the card's behalf.
    const rows = (await this.w.frame(0)).rows.filter((r) => ![...cards].some((ask) => JSON.stringify(r).includes(ask.slice(4))));
    return [
      ...[sent.ran, ...also].filter((r): r is Ran => !!r).map((r) => `${r.stdout}\n${r.stderr}`),
      ...after.filter((e) => e.kind === 'brief.made' && e.data.step === 'refused').map((e) => String(e.data.reason)),
      ...after.filter((e) => e.kind === 'schedule.run' && e.data.cause).map((e) => String(e.data.cause)),
      ...after.filter((e) => e.kind === 'ask.created' && !cards.has(`ask:${e.id}`)).map((e) => JSON.stringify(e.data)),
      ...rows.map((r) => JSON.stringify(r)),
    ].join('\n');
  }

  /**
   * One input taken as far as it goes (README: Readings, "refused"): sent, its card answered yes when one is raised,
   * then until what DeepBuild told you holds `naming` or a workspace was made for it (3 minutes at most). What it told
   * you, the card if any, and the workspaces and runs made since the input.
   */
  async refused(words: string, naming: RegExp | string, files: string[] = []): Promise<{ text: string; card?: Card; made: Ev[]; runs: Run[] }> {
    const { sent, card } = await this.ask(words, files);
    const answers: Ran[] = [];
    if (card) answers.push((await this.yes(card)).ran);
    const holds = (text: string): boolean => (typeof naming === 'string' ? text.includes(naming) : naming.test(text));
    const made = async (): Promise<Ev[]> => (await this.w.events()).filter((e) => e.log_pos > sent.since && e.kind === 'workspace.created');
    await waitUntil(async () => holds(await this.told(sent, answers)) || (await made()).length > 0, 3 * MIN, 2000);
    await sleep(5000);
    const events = (await this.w.events()).filter((e) => e.log_pos > sent.since);
    return { text: await this.told(sent, answers), ...(card ? { card } : {}), made: await made(), runs: card ? runsOf(events, String(card.drafted.data.key)) : [] };
  }

  /** A file of the job's workspace: on disk, else at its default branch. */
  async file(folder: string, path: string): Promise<string | undefined> {
    if (existsSync(join(folder, path))) return readFileSync(join(folder, path), 'utf8');
    return this.w.shown(folder, path);
  }
}

// ---- Readings of the record.

/** The runs of the job whose brief has `key`: each `schedule.run` whose schedule names the key's first 12 hex digits, folded by run. */
export function runsOf(events: readonly Ev[], key: string): Run[] {
  const mark = key.slice(0, 12);
  const out = new Map<string, Run>();
  for (const e of events) {
    if (e.kind !== 'schedule.run' || !String(e.data.schedule ?? '').includes(mark)) continue;
    const id = String(e.data.run);
    const r = out.get(id) ?? { run: id, schedule: String(e.data.schedule), due: Number(e.data.due), first: e, noop: false, cause: '' };
    if (e.data.phase === 'ended') Object.assign(r, { ended: e, verdict: e.data.verdict === undefined ? undefined : String(e.data.verdict), noop: e.data.noop === true, cause: String(e.data.cause ?? '') });
    out.set(id, r);
  }
  return [...out.values()].sort((a, b) => a.first.log_pos - b.first.log_pos);
}
/** Model turns on the record: each job the runner recorded before it started, and each session a run started. */
export const turnsIn = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'job.recorded' || e.kind === 'start.started');
/** Plan usage on the record: a model turn, a job's end with what it used, a turn's usage, or a spend. */
export const usageIn = (events: readonly Ev[]): Ev[] => events.filter((e) => ['job.recorded', 'job.ended', 'turn.usage', 'start.started', 'spend.reserved', 'spend.charged'].includes(e.kind));
/** The runner's jobs recorded and not yet ended. */
function jobsGoing(events: readonly Ev[]): string[] {
  const ended = new Set(events.filter((e) => e.kind === 'job.ended').map((e) => String(e.data.job)));
  return events.filter((e) => e.kind === 'job.recorded' && !ended.has(String(e.data.job))).map((e) => String(e.data.job));
}
/** A run in one line, for a failure message. */
export const runLine = (r: Run): string => `${r.run} due ${iso(r.due)}: ${r.ended ? (r.noop ? 'no-op' : `verdict ${r.verdict ?? 'none'}`) : 'not ended'}${r.cause ? ` (${r.cause.slice(0, 200)})` : ''}`;
/** A fire in one line, for a failure message. */
export const fireLine = (f: Fire): string => `fire ${f.i} at ${iso(f.at)} (${f.runs.map(runLine).join('; ') || 'no run'}): ${f.turns.length} model turn(s) [${f.turns.map((e) => e.kind).join(', ')}]`;
/** The cost lines a card's brief carries, if any (README: The contract). */
export const costOf = (card: Card): Partial<Cost> => ((card.brief as unknown as { cost?: Partial<Cost> }).cost ?? {});
/** Dollars as a card says them: whole dollars bare, else to the cent. */
export const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
