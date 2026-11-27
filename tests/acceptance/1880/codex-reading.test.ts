import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  CLAUDE_ACCOUNT, claudeSession, cleanup, codexCalls, codexSession, events, linesOf, makeHome, missingBuild, readJobs, repo,
  settled, signInClaude, signInCodex, startHub,
} from './helpers.ts';

type Obj = Record<string, any>;
const REFUSAL = 'a Codex job takes no sub-agents';
const blocked = missingBuild();
afterAll(cleanup);

const reasonOf = (o: Obj | undefined): string => {
  for (const k of ['why', 'reason', 'invalid', 'cause']) if (typeof o?.[k] === 'string' && o[k].trim()) return o[k] as string;
  return '';
};
const blockedIn = (v: unknown, out: Obj[] = []): Obj[] => {
  if (Array.isArray(v)) for (const x of v) blockedIn(x, out);
  else if (typeof v === 'object' && v !== null) {
    const o = v as Obj;
    if (o.status === 'BLOCKED' || o.state === 'BLOCKED') out.push(o);
    for (const x of Object.values(o)) blockedIn(x, out);
  }
  return out;
};

describe('AC1: with Codex the only signed-in agent, a wiki build\'s reading', () => {
  it.skipIf(blocked)('ends with a recorded result, or reads BLOCKED naming the reason before any process of the job starts; never a launch that throws', async () => {
    const h = makeHome();
    signInCodex(h);
    const app = repo(join(h.home, 'work', 'readapp'));
    codexSession(h.home, app, '0199abcd-1880-7000-8000-000000000001', ['remember: the api always needs a token.', 'the api always needs a token']);
    const hub = await startHub(h);
    try {
      let buildError = '';
      try { await hub.call('wiki.build'); } catch (e) { buildError = e instanceof Error ? e.message : String(e); }
      await settled(hub);
      const jobs = await readJobs(hub);
      const all = events(hub.root);
      const finished = all.filter((e) => e.kind === 'reading.finished').map((e) => e.data);
      const evidence = JSON.stringify({ buildError, jobs: jobs.map(({ stdout, ...j }) => ({ ...j, printed: linesOf(stdout).filter((l) => l.type === 'fake.codex') })), finished, codexCalls: codexCalls(h) }, null, 1);

      expect(jobs.filter((j) => j.agent !== 'codex').map((j) => j.agent), evidence).toEqual([]);
      const failures = [
        buildError,
        ...jobs.filter((j) => j.state === 'refused' || j.state === 'lost' || j.stop?.cause === 'unknown').map((j) => `job ${j.job} ${j.state}: ${j.refused ?? ''}`),
        ...finished.filter((f) => f.state !== 'BLOCKED' && typeof f.invalid === 'string').map((f) => `reading ${f.reading} ${f.state}: ${f.invalid}`),
      ].filter(Boolean);
      expect(failures.filter((f) => f.includes(REFUSAL)), evidence).toEqual([]);

      const ran = jobs.filter((j) => j.state === 'finished' && typeof j.pid === 'number' && typeof j.result === 'string'
        && linesOf(j.stdout).some((l) => l.type === 'fake.codex' && l.argv?.[0] === 'exec'));
      const result = ran.length > 0 && finished.some((f) => (f.runs as string[] | undefined)?.some((r) => ran.some((j) => j.job === r)) && f.state === 'finished' && f.invalid === undefined);

      const launched = jobs.some((j) => j.pid !== undefined || j.start !== undefined || j.ran !== undefined || linesOf(j.stdout).some((l) => l.type === 'fake.codex'))
        || codexCalls(h).some((c) => c.argv[0] === 'exec');
      const reasons = blockedIn([jobs.map(({ stdout, ...j }) => j), all.map((e) => e.data)]).map(reasonOf).filter(Boolean);
      const blockedFirst = !launched && reasons.length > 0;

      expect(failures, evidence).toEqual([]);
      expect(result || blockedFirst, `neither a recorded result nor BLOCKED with a reason before a process started:\n${evidence}`).toBe(true);
    } finally {
      await hub.stop();
    }
  }, 300_000);
});

describe('AC2: with Claude Code signed in, a wiki build\'s reading', () => {
  it.skipIf(blocked)('still runs with its reader sub-agent: the job\'s launch carries the reader, and the reading ends with its result', async () => {
    const h = makeHome();
    signInClaude(h);
    const app = repo(join(h.home, 'work', 'readapp'));
    claudeSession(h.home, app, '18800000-0000-4000-8000-000000000002', ['remember: the api always needs a token.', 'the api always needs a token']);
    const hub = await startHub(h);
    try {
      const now = Date.now();
      await hub.call('windows.report', { agent: 'claude-code', account: CLAUDE_ACCOUNT, rate_limits: {
        five_hour: { used_percentage: 5, resets_at: Math.floor((now + 3 * 3_600_000) / 1000) },
        seven_day: { used_percentage: 20, resets_at: Math.floor((now + 5 * 86_400_000) / 1000) },
      } });
      await hub.call('wiki.build');
      await settled(hub);
      const jobs = await readJobs(hub);
      const finished = events(hub.root).filter((e) => e.kind === 'reading.finished').map((e) => e.data);
      const evidence = JSON.stringify({ jobs: jobs.map(({ stdout, ...j }) => j), finished }, null, 1);
      expect(jobs.length, evidence).toBeGreaterThan(0);
      for (const j of jobs) {
        expect(j.agent, evidence).toBe('claude-code');
        const start = linesOf(j.stdout).find((l) => l.type === 'system' && l.subtype === 'fake' && l.report?.cmd === 'start')?.report as Obj | undefined;
        expect(start, `the fake Claude Code never started for ${j.job}:\n${evidence}`).toBeDefined();
        const argv = start!.argv as string[];
        const agents = argv.indexOf('--agents');
        expect(agents, `no --agents in the launch: ${JSON.stringify(argv)}`).toBeGreaterThanOrEqual(0);
        expect(Object.keys(JSON.parse(argv[agents + 1]!) as Obj), JSON.stringify(argv)).toContain('reader');
        expect(argv[argv.indexOf('--tools') + 1]?.split(','), JSON.stringify(argv)).toContain('Task');
        expect(j.state, evidence).toBe('finished');
      }
      const ended = finished.filter((f) => (f.runs as string[] | undefined)?.some((r) => jobs.some((j) => j.job === r)));
      expect(ended.length, evidence).toBeGreaterThan(0);
      for (const f of ended) expect({ state: f.state, invalid: f.invalid }, evidence).toEqual({ state: 'finished', invalid: undefined });
    } finally {
      await hub.stop();
    }
  }, 300_000);
});
