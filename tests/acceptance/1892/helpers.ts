// Test-side tools for the #1892 acceptance tests: a temp folder with a temp HOME, a stand-in agent binary that
// prints a fixed stream, and a world of real parts: the real record on SQLite, the real asks core, budget ledger
// and supervisor (its platform sandbox included), and the runner opened on them through its public entry,
// `openRunner` of packages/runner/src/index.ts. Nothing here stands in for the runner: the only stand-in is the
// agent's binary, a boundary the repo doesn't own (as packages/runner/test/pi-cost.test.ts has it).
//
// Safety: no hub, no port of a test's own, no real agent, no sign-in, no model call. Every folder is under the
// system temp folder and removed when its world closes; the tests stop no process themselves: the supervisor ends
// what it started.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { openRunner, type Agent, type JobRecord, type Runner } from '../../../packages/runner/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const DAY = 86_400_000;
/** The account the fake Claude Code sign-in records (`oauthAccount.accountUuid` in ~/.claude.json): a made-up value. */
export const ACCOUNT = '0e0e0e0e-1111-4222-8333-444444441892';

interface Facts { agent: string; versions: string[]; errorTexts: { causes?: Record<string, string> }; stop?: { cause?: { errors?: { field: string; values: Record<string, string> } } } }
/** A shipped agent's facts, as the repo's adapters/ folder holds them. */
export const factsOf = (file: string): Facts => JSON.parse(readFileSync(join(REPO, 'adapters', file), 'utf8')) as Facts;

/** One line of a stream as the binary prints it: an object as its JSON, a string as it stands. */
export type StreamLine = Record<string, unknown> | string;
const text = (lines: StreamLine[]): string => lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + (lines.length ? '\n' : '');

export interface World {
  dir: string;
  runner: Runner;
  record: RecordStore;
  /** What its `job.ended` event recorded for a job. */
  ended(job: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
/** Closes every world a test opened: call from afterEach. */
export async function closeWorlds(): Promise<void> {
  for (const world of worlds.splice(0)) await world.close();
}

/**
 * A world whose login shell's PATH holds one stand-in binary named `binary`: it answers `--version` with `version`,
 * and otherwise reads its prompt from stdin, prints `lines` and exits `exit`. The stream is a file beside it, which
 * a job's sandbox lets it read: the binary's own folder.
 */
export async function openWorld(binary: string, version: string, lines: StreamLine[], exit = 0): Promise<World> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1892-')));
  const [home, bin] = [join(dir, 'home'), join(dir, 'bin')];
  mkdirSync(home);
  mkdirSync(bin);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT } }));
  writeFileSync(join(bin, 'stream.jsonl'), text(lines));
  writeFileSync(join(bin, binary), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${version}"; exit 0; }; done
/bin/cat >/dev/null
/bin/cat "$(/usr/bin/dirname "$0")/stream.jsonl"
exit ${exit}
`, { mode: 0o755 });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: Date.now, price: async () => 0.5 });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [] });
  const runner = await openRunner({
    record, asks, supervisor, ledger, now: Date.now, root: join(home, '.deepbuild'), loginPath: `${bin}:/usr/bin:/bin`,
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  const world: World = {
    dir, runner, record,
    ended: async (job) => (await record.read({ after: 0, limit: 100_000 })).filter((e) => e.kind === 'job.ended' && (e.data as { job?: string }).job === job).map((e) => e.data as Record<string, unknown>),
    close: async () => {
      await runner.close();
      await supervisor.close();
      await record.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
  worlds.push(world);
  return world;
}

/** What a job's record shows of its stream: every field its output decides. A field the record lacks reads undefined. */
export interface Shown {
  state: JobRecord['state'];
  result: string | undefined;
  session: string | undefined;
  model: string | undefined;
  usage: { input: number; cached: number; output: number } | undefined;
  cost_usd: number | undefined;
  cause: string | undefined;
  refused: string | undefined;
  blocked: string | undefined;
}
export const shown = (rec: JobRecord): Shown => ({
  state: rec.state, result: rec.result, session: rec.session, model: rec.model, usage: rec.usage, cost_usd: rec.cost_usd,
  cause: rec.stop?.cause, refused: rec.refused, blocked: rec.blocked?.cause,
});
/** The same fields as its `job.ended` event recorded them. */
export const shownEnded = (data: Record<string, unknown>): Omit<Shown, 'blocked'> => ({
  state: data.state as Shown['state'], result: data.result as string | undefined, session: data.session as string | undefined, model: data.model as string | undefined,
  usage: data.usage as Shown['usage'], cost_usd: data.cost_usd as number | undefined, cause: data.cause as string | undefined, refused: data.refused as string | undefined,
});

export interface Ran { rec: JobRecord; output: string; ended: Record<string, unknown>[] }
/**
 * One read job of `agent` run to its end in a world of its own, on a stand-in binary of `factsFile`'s agent at the
 * newest version those facts cover, printing `lines`. Claude Code's parts wait for a plan window's reading, so one
 * is reported first when `window` is set; a 60 s deadline ends a job that would never end.
 */
export async function runJob(agent: string, factsFile: string, lines: StreamLine[], o: { exit?: number; window?: boolean } = {}): Promise<Ran> {
  const facts = factsOf(factsFile);
  const world = await openWorld(facts.agent, facts.versions.at(-1)!, lines, o.exit ?? 0);
  if (o.window) {
    const resets = Math.floor(Date.now() / 1000) + 3 * 3600;
    await world.runner.report({ agent: agent as Agent, account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: resets }, seven_day: { used_percentage: 1, resets_at: resets } } });
  }
  const rec = await world.runner.run({ kind: 'read', agent: agent as Agent, prompt: 'Read.', deadline_ms: 60_000 });
  return { rec, output: await world.runner.output(rec.job), ended: await world.ended(rec.job) };
}
/** The bytes a stream's binary prints: what `runner.output` gives back for its job. */
export const printed = text;
