// Shared by the #1886 acceptance tests (README): the criterion's ID, the session's start environment, a loopback
// listener its ANTHROPIC_BASE_URL points at, the one story both tests tell through a real hub (#1537's review world:
// #322's hub, Claude Code sessions through the real deep-hook, the fake reviewer first on the runner's login PATH), and
// the readers of what the hub recorded. Nothing here stands in for DeepBuild: the hub, deep-hook and the CLI are the
// real ones; only the second model (#1537's fake reviewer) is ours.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { allEvents } from '../322/helpers.ts';
import {
  ASK, CLEAN, FIX, HOUR, claimAfter, commandsGreen, judged, lastPos, must, openPr, openTask, reportWindow, reviewWorld, startHub, stopHub, taskVerdicts,
  trustRepo, type Ev, type Hub, type ReviewWorld,
} from '../1537/helpers.ts';

export { cleanup, must } from '../1537/helpers.ts';
export type { Ev } from '../1537/helpers.ts';

// ---- The criterion: `#1886.<first 8 hex of SHA-256 of its text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #1886.33628f8b';

/** The words of the review's reason when the change's session ran behind another base URL (#87's surface). */
export const PROXIED = 'model unknown: proxied route';

// ---- The session's start environment. #322's sessions inherit this process's environment, less its DEEP_, CLAUDE*,
// GIT_ and billing keys; ANTHROPIC_BASE_URL isn't among those, and the agent running these tests may itself have it
// set. So the file drops it at load, and every hub and runner job starts without it; only the proxied session's own
// Claude Code process (and the deep-hook runs it starts) is given it, by `asStartedIn`.
const AMBIENT = process.env.ANTHROPIC_BASE_URL;
delete process.env.ANTHROPIC_BASE_URL;
/** Puts back what this process had (afterAll). */
export function restoreEnv(): void {
  if (AMBIENT === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = AMBIENT;
}
/**
 * Calls `start` with ANTHROPIC_BASE_URL set to `url` (or unset) in this process's environment, and drops it again as
 * soon as `start` returns. #1537's `openTask` makes its `Session` before its first await, and the session's Claude Code
 * process copies the environment then, so only that process and its deep-hook runs see the variable.
 */
export function asStartedIn<T>(url: string | undefined, start: () => T): T {
  if (url === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = url;
  try { return start(); } finally { delete process.env.ANTHROPIC_BASE_URL; }
}

/** A loopback listener, as a proxy or protocol bridge would listen: what the session's base URL points at. It counts the requests it gets. */
export interface Listener { url: string; host: string; marker: string; requests(): number; close(): Promise<void> }
export async function listener(): Promise<Listener> {
  let n = 0;
  const server: Server = createServer((_req, res) => { n += 1; res.statusCode = 502; res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const marker = 'dh1886-bridge';
  return { url: `http://127.0.0.1:${port}/${marker}`, host: `127.0.0.1:${port}`, marker, requests: () => n, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

// ---- What the hub recorded.
export interface ReviewRun { started: Ev; finished: Ev | undefined }
/** The review runs of one claim, each with its finish: the runs whose check is the review (#1862's reading). */
export function reviewRuns(events: readonly Ev[], claim: string): ReviewRun[] {
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && /\breview\b/.test(String(e.data.check)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
export const sayRuns = (runs: readonly ReviewRun[]): string =>
  runs.map((r) => `${String(r.started.data.run)} ${String(r.started.data.check)} ${r.finished ? `${String(r.finished.data.outcome)} ${JSON.stringify(r.finished.data.findings ?? [])}` : 'unfinished'}`).join('; ') || 'none';
/** What a review run's finish says: its findings and evidence, as one text. */
export const saidBy = (r: ReviewRun): string => JSON.stringify({ outcome: r.finished?.data.outcome, findings: r.finished?.data.findings ?? [], evidence: r.finished?.data.evidence ?? [] });
export const outcomeOf = (v: Ev | undefined): string => String(v?.data.outcome ?? 'none');
export const sayVerdicts = (vs: readonly Ev[]): string => vs.map((v) => `${outcomeOf(v)} ${JSON.stringify(v.data.reasons ?? v.data).slice(0, 600)}`).join(' | ') || 'none';

/** Every file under `dir` whose bytes hold any of `needles`, as `<file relative to dir>: <needle>`. */
export function filesHolding(dir: string, needles: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    let names: string[];
    try { names = readdirSync(at); } catch { return; }
    for (const name of names) {
      const path = join(at, name);
      let st;
      try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) {
        let bytes: string;
        try { bytes = readFileSync(path).toString('latin1'); } catch { continue; }
        for (const needle of needles) if (bytes.includes(needle)) out.push(`${path.slice(dir.length + 1)}: ${needle}`);
      }
    }
  };
  walk(dir);
  return out;
}

// ---- The story.
export interface Story { w: ReviewWorld; hub: Hub; claim: string; events: Ev[]; reviews: ReviewRun[]; verdicts: Ev[] }
/**
 * #1537's clean PR claim, told through a real hub: the session starts (SessionStart through the real deep-hook, its
 * Claude Code process started with ANTHROPIC_BASE_URL at `baseUrl`, or with it unset), you type the ask, the handed
 * definition locks, the session fixes the middleware (the spec's unit check and R1's drafted check pass), opens PR 21
 * and stops. Its transcript names claude-haiku-5-5 on every assistant message (#322's sessions); the second model is
 * the fake reviewer, which answers as claude-sonnet-5-5 with no finding (the diff holds no planted bug), with room in
 * the plan window. Resolves once the claim has a review run that finished and a verdict, or the wait ran out (the
 * caller's assertions say what is missing). The hub is left running; `close` stops it.
 */
export async function story(who: string, baseUrl: string | undefined): Promise<Story> {
  const w = reviewWorld();
  await trustRepo(w, true);
  const hub = await startHub(w);
  try {
    await reportWindow(hub, 5, Date.now() + 3 * HOUR);
    const { s, ref } = await asStartedIn(baseUrl, () => openTask(hub, w, ASK, who));
    await s.read('src/auth.js');
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
    await openPr(s, who);
    await s.stop('Expired tokens are rejected now, and the pull request is open for review.');
    let events = await judged(hub, ref, since);
    const claim = claimAfter(events, ref, since);
    must(claim !== undefined, `BLOCKED: ${who} the stop after opening PR 21 must make a claim: none was recorded`);
    commandsGreen(events, ref, since, who, claim, w.base);
    // The review's run may finish after the first verdict: read on until it has, for up to five minutes.
    const deadline = Date.now() + 300_000;
    while (!reviewRuns(events, claim).some((r) => r.finished) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      events = await allEvents(hub);
    }
    // And a little longer, so a verdict made on the review's finish is read too.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    events = await allEvents(hub);
    return { w, hub, claim, events, reviews: reviewRuns(events, claim), verdicts: taskVerdicts(events, ref, since) };
  } catch (error) {
    await stopHub(hub);
    throw error;
  }
}
export const close = (s: Story): Promise<void> => stopHub(s.hub);
