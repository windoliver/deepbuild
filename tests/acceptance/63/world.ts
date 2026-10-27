// A world: a hub's root (`<root>/ledger.db`, its evidence store at `<root>/evidence`, the wiki at `<root>/wiki`), the
// real record (#14), evidence store (#15), asks core, budget ledger, supervisor (#236), runner (#159), wiki (#355)
// and archive (#20) opened on it, the agents' own transcripts under a home of their own, and the fake agent installed
// as `claude` on the login PATH the runner was given. `@deepbuild/reading` is loaded lazily from its public entry, so
// this file loads at the base, where it doesn't exist. Nothing here stands in for what #63 builds.

import { join } from 'node:path';
import { shipped } from '../../../packages/adapters/src/index.ts';
import { openArchive } from '../../../packages/archive/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openLedger, type Ledger } from '../../../packages/budget/src/index.ts';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, toJson, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openRunner, type JobRecord, type Runner } from '../../../packages/runner/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { openWiki, type Wiki } from '../../../packages/wiki/src/index.ts';
import type { Reading, ReadingResult, ReadingSpec } from '../../../packages/reading/src/index.ts';
import { writeTranscript, type Session } from './corpus.ts';
import { ACCOUNT, DAY, HOME, installFake, letters, sleep, tempDir, tokensOf, ulid, WINDOW_TOKENS, type Planted } from './helpers.ts';

export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
export const ARCHIVE: Connection = { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' };
export const hookIn = (session: string, project: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session, project, agent: 'claude-code' });

/** Real time plus an offset: the runner's processes and graces are real time. */
export interface Clock { now(): number; advance(ms: number): void }
function makeClock(): Clock {
  let offset = 0;
  return { now: () => Date.now() + offset, advance: (ms) => { offset += ms; } };
}

export const READING_ENTRY = '../../../packages/reading/src/index.ts';
export const readingModule = () => import(new URL(READING_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/reading/src/index.ts')>;

export interface World {
  dir: string;
  /** The hub's root: what `deep read --root` and `deep find --root` read. */
  root: string;
  /** The agents' home: Claude Code's transcripts are under <agents>/.claude/projects, as the archive's facts name. */
  agents: string;
  fakeDir: string;
  clock: Clock;
  store: EvidenceStore;
  record: RecordStore;
  asks: Asks;
  ledger: Ledger;
  sup: Supervisor;
  runner: Runner;
  wiki: Wiki;
  /** What each message handle holds, as the agent wrote it (before redaction). */
  said: Map<string, string>;
  /** Reinstalls the fake with these planted findings (an atomic swap). */
  plant(planted: Planted[]): void;
  /** Records the sessions as their hooks would and runs one archive pass, as the archive extension would. */
  seed(sessions: readonly Session[]): Promise<void>;
  /** Opens `@deepbuild/reading` on this world, from its public entry. */
  reading(): Promise<Reading>;
  events(kinds?: readonly string[]): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(o: { planted?: Planted[] } = {}): Promise<World> {
  const dir = tempDir('world');
  const root = join(dir, 'root');
  const agents = join(dir, 'agents');
  const fakeDir = join(dir, 'bin');
  installFake(fakeDir, { planted: o.planted ?? [] });
  const clock = makeClock();
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: clock.now, evidence: store });
  const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: clock.now, price: async () => 0.5 });
  const sup = await openSupervisor({ record, asks, now: clock.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [] });
  const runner = await openRunner({
    record, asks, supervisor: sup, ledger, now: clock.now, root, loginPath: `${fakeDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    env: { HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  const wiki = await openWiki({ record, folder: join(root, 'wiki'), now: clock.now });
  const said = new Map<string, string>();
  const w: World = {
    dir, root, agents, fakeDir, clock, store, record, asks, ledger, sup, runner, wiki, said,
    plant: (planted) => { installFake(fakeDir, { planted }); },
    async seed(sessions) {
      for (const s of sessions) {
        const at = clock.now();
        await record.append(hookIn(letters(s.id), s.project), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: s.worktree, branch: 'main', thread: s.id } });
        writeTranscript(agents, s);
        for (const m of s.messages) said.set(`${s.handle}#${m.id}`, m.text);
      }
      const archive = await openArchive({ record, evidence: store, asks, adapters: shipped(), env: { HOME: agents }, connection: ARCHIVE, now: clock.now, held: () => [] });
      await archive.pass();
      await record.sync();
    },
    async reading() {
      const { openReading } = await readingModule();
      return openReading({ record, runner, root, wiki, now: clock.now });
    },
    async events(kinds) {
      const out: Event[] = [];
      for (let after = 0; ;) {
        const page = await record.read({ after, limit: 1000, ...(kinds && { kinds }) });
        if (!page.length) return out;
        out.push(...page);
        after = page[page.length - 1]!.log_pos;
      }
    },
    async close() {
      await runner.close();
      await sup.close();
      await record.close();
    },
  };
  return w;
}

/** The data of an event, as a plain object. */
export const dataOf = (e: Event): Record<string, unknown> => e.data as Record<string, unknown>;
export { toJson };

/** Claude Code's status line `rate_limits`, as the forwarder hands it on (#159). */
const limits = (fiveHourUsed: number, now: number) => ({
  five_hour: { used_percentage: fiveHourUsed, resets_at: Math.floor((now + 3 * 3_600_000) / 1000) },
  seven_day: { used_percentage: 20, resets_at: Math.floor((now + 5 * DAY) / 1000) },
});
/** One reading job's runs, each with its stdout as the runner read it. */
export interface Run { job: string; rec: JobRecord; stdout: string }
export interface JobRan { result: ReadingResult; runs: Run[]; startPct: number; tokens: number; sharePct: number }
/**
 * Runs a reading job with the plan as its boundary: the window reads `startPct` used before it starts, and the status
 * line forwarder's stand-in reports, every 250 ms and once at the end, the window used so far: the start plus the
 * tokens the job's runs reported (README, Readings: plan usage). Returns the result, every runner job that started
 * while it ran (each with its stdout), and the share of one 5-hour window the job's runs spent.
 */
export async function runReading(w: World, spec: ReadingSpec, o: { startPct?: number } = {}): Promise<JobRan> {
  const startPct = o.startPct ?? 5;
  const before = new Set((await w.runner.list()).map((j) => j.job));
  const spent = async (): Promise<number> => {
    let t = 0;
    for (const j of await w.runner.list()) if (!before.has(j.job)) t += tokensOf(await w.runner.output(j.job));
    return t;
  };
  await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(startPct, w.clock.now()) });
  let done = false;
  const forwarder = (async () => {
    while (!done) {
      await sleep(250);
      const used = startPct + (100 * (await spent())) / WINDOW_TOKENS;
      await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(Math.round(used * 100) / 100, w.clock.now()) }).catch(() => undefined);
    }
  })();
  let result: ReadingResult;
  try {
    const reading = await w.reading();
    result = await reading.run(spec);
  } finally {
    done = true;
    await forwarder;
  }
  const runs: Run[] = [];
  for (const rec of await w.runner.list()) if (!before.has(rec.job)) runs.push({ job: rec.job, rec, stdout: await w.runner.output(rec.job) });
  const tokens = await spent();
  return { result, runs, startPct, tokens, sharePct: (100 * tokens) / WINDOW_TOKENS };
}
