// Shared by the #1886 acceptance tests (README): the criteria's IDs; one claim that opens PR 21 on a real hub, made
// in a Claude Code session started with or without ANTHROPIC_BASE_URL in the environment its hooks get, and the
// review check's run of it read back from the record; and one child run of #87's model suites. Everything real is
// reused from #1537's and #322's helpers (the hub as a process, the real deep-hook, the fake second model, the socket),
// which those suites keep and nobody edits. Only the second model and a loopback listener are ours.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASK, CLEAN, FIX, HOUR, claimAfter, commandsGreen, judged, lastPos, must, openPr, openTask, outcomeOf, reportWindow, reviewJobs, reviewWorld, settle,
  startHub, taskVerdicts, trustRepo, type Ev,
} from '../../1537/helpers.ts';
import { runsOf } from '../../322/helpers.ts';

export { cleanup } from '../../1537/helpers.ts';

// ---- The criteria: `#1886.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
export const AC1 = '#1886.33628f8b';
export const AC2 = '#1886.209d6f6c';
export const AC3 = '#1886.ece183af';

export const PROXIED = 'model unknown: proxied route';
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** A loopback listener the session's ANTHROPIC_BASE_URL points at, as a proxy would listen; nothing connects to it. */
export async function listener(): Promise<{ url: string; host: string; close(): Promise<void> }> {
  const server: Server = createServer((_req, res) => { res.statusCode = 502; res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: `http://${host}/dh1886-proxy`, host, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** What one claim's review came to on the hub. */
export interface Reviewed {
  claim: string;
  /** The review check's runs of the claim (check `review`), each with its finish. */
  review: { started: Ev; finished: Ev | undefined }[];
  /** The claim's verdicts after the stop. */
  verdicts: Ev[];
  /** Every event after the stop, as one text, to search for what the record holds. */
  record: string;
  /** How many review jobs the runner recorded: each one call of the fake second model. */
  jobs: number;
}

/**
 * On a fresh real hub (#1537's review world: the fake second model answers as claude-sonnet-5-5, room in the plan
 * window), one Claude Code session started with `baseUrl` as ANTHROPIC_BASE_URL in its environment, or with none
 * set: deep-hook runs as a child of the session's own process, which holds that environment, as Claude Code's hook
 * commands do; the hub never has it. The session's transcript names claude-haiku-5-5. It fixes the middleware with a
 * clean diff, opens PR 21 and stops; the review check's run is read once it finishes, with the verdict after it.
 */
export async function reviewedClaim(who: string, baseUrl: string | undefined): Promise<Reviewed> {
  const w = reviewWorld();
  await trustRepo(w, true);
  // The hub starts with no base URL of this process's in its environment.
  const held = process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
  const hub = await startHub(w);
  await reportWindow(hub, 5, Date.now() + 3 * HOUR);
  // The session's own process takes this environment when it is spawned, which openTask does before its first await.
  if (baseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = baseUrl;
  let opening: ReturnType<typeof openTask>;
  try {
    opening = openTask(hub, w, ASK, who);
  } finally {
    if (held === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = held;
  }
  const { s, ref } = await opening;
  await s.read('src/auth.js');
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
  await openPr(s, who);
  await s.stop('Expired tokens are rejected now, and the pull request is open for review.');

  let events = await judged(hub, ref, since);
  const claim = claimAfter(events, ref, since);
  must(claim !== undefined, `BLOCKED: ${who} the stop after opening PR 21 must make a claim for ${ref}: none was recorded`);
  commandsGreen(events, ref, since, who, claim, w.base);
  const reviewRuns = (all: readonly Ev[]) => runsOf(all, ref, since).filter((r) => String(r.started.data.check) === 'review');
  // The review's run, finished, and a verdict made after it.
  events = await settle(hub, (all) => {
    const done = reviewRuns(all).map((r) => r.finished).filter((f): f is Ev => f !== undefined);
    return done.length > 0 && taskVerdicts(all, ref, since).some((v) => v.log_pos > done.at(-1)!.log_pos);
  }, 300_000);
  const review = reviewRuns(events);
  must(review.some((r) => r.finished), `BLOCKED: ${who} ${claim} opened PR 21, so the review check must run on it and finish: its runs ${JSON.stringify(review.map((r) => r.started.data))}`);
  const jobs = (await reviewJobs(hub)).length;
  must(jobs > 0, `BLOCKED: ${who} the review's second model must answer through the runner: no review job was recorded`);
  return { claim: claim!, review, verdicts: taskVerdicts(events, ref, since), record: JSON.stringify(events.filter((e) => e.log_pos > since)), jobs };
}

/** The review's finished runs in one text: outcome, failures, mask, everything the record keeps of them. */
export const reviewText = (r: Reviewed): string => JSON.stringify(r.review.map((x) => x.finished?.data ?? null));
export const lastVerdict = (r: Reviewed): string => outcomeOf(r.verdicts.at(-1));
export const verdictText = (r: Reviewed): string => r.verdicts.map((v) => `${outcomeOf(v)} ${JSON.stringify(v.data).slice(0, 900)}`).join(' | ') || 'none';

// ---- #87's model suites, unchanged, in one child run of the repo's vitest.
export const MODEL_SUITES = 'tests/acceptance/87/models';
export interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

const blocked = (why: string): never => { throw new Error(`BLOCKED: ${why}`); };
const AT_BASE = JSON.parse(readFileSync(fileURLToPath(new URL('./models-at-base.json', import.meta.url)), 'utf8')) as Record<string, string>;

/** #87's model suite files whose bytes differ from the merge base's (SHA-256 of each, recorded in models-at-base.json at
 *  base 914bd5f29), each with how: edited, removed or added. */
export function editedModelSuites(): string[] {
  const now = readdirSync(join(REPO, MODEL_SUITES), { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
    .map((d) => relative(REPO, join(d.parentPath, d.name)).split(sep).join('/'));
  const out = Object.keys(AT_BASE).filter((f) => !now.includes(f)).map((f) => `removed: ${f}`);
  for (const f of now) {
    if (!(f in AT_BASE)) out.push(`added: ${f}`);
    else if (createHash('sha256').update(readFileSync(join(REPO, f))).digest('hex') !== AT_BASE[f]) out.push(`edited: ${f}`);
  }
  return out;
}

let ran: Promise<Map<string, Assertion[]>> | undefined;
/** Every test of #87's model suites, by file, from one run of the repo's vitest (run once, shared by the tests here). */
export function modelSuites(): Promise<Map<string, Assertion[]>> {
  ran ??= Promise.resolve().then(() => {
    const dir = mkdtempSync(join(tmpdir(), 'dh1886-'));
    try {
      const out = join(dir, 'report.json');
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'ANTHROPIC_BASE_URL'));
      const result = spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile.json=${out}`, '--testTimeout=600000', '--no-file-parallelism', MODEL_SUITES],
        { cwd: REPO, env, encoding: 'utf8', timeout: 3_000_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
      if (!existsSync(out)) blocked(`vitest wrote no report for ${MODEL_SUITES} (status ${result.status}, signal ${result.signal}): ${(result.stderr ?? '').slice(-2000)}`);
      const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: FileResult[] };
      const byFile = new Map<string, Assertion[]>();
      for (const file of report.testResults) {
        const path = file.name.slice(file.name.indexOf(MODEL_SUITES));
        byFile.set(path, [...file.assertionResults, ...(file.status === 'failed' && !file.assertionResults.some((a) => a.status === 'failed') ? [{ fullName: '(the file, outside its tests)', status: 'failed', failureMessages: [file.message ?? ''] }] : [])]);
      }
      return byFile;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return ran;
}
export const notPassed = (tests: readonly Assertion[]): string[] => tests.filter((t) => t.status !== 'passed')
  .map((t) => `${t.status}: ${t.fullName}${t.failureMessages?.[0] ? `\n${t.failureMessages[0].slice(0, 1500)}` : ''}`);
