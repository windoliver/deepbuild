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

export const AC1 = 'AC1 #1886.33628f8b';

export const PROXIED = 'model unknown: proxied route';

const AMBIENT = process.env.ANTHROPIC_BASE_URL;
delete process.env.ANTHROPIC_BASE_URL;
export function restoreEnv(): void {
  if (AMBIENT === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = AMBIENT;
}
export function asStartedIn<T>(url: string | undefined, start: () => T): T {
  if (url === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = url;
  try { return start(); } finally { delete process.env.ANTHROPIC_BASE_URL; }
}

export interface Listener { url: string; host: string; marker: string; requests(): number; close(): Promise<void> }
export async function listener(): Promise<Listener> {
  let n = 0;
  const server: Server = createServer((_req, res) => { n += 1; res.statusCode = 502; res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const marker = 'dh1886-bridge';
  return { url: `http://127.0.0.1:${port}/${marker}`, host: `127.0.0.1:${port}`, marker, requests: () => n, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

export interface ReviewRun { started: Ev; finished: Ev | undefined }
export function reviewRuns(events: readonly Ev[], claim: string): ReviewRun[] {
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && /\breview\b/.test(String(e.data.check)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
export const sayRuns = (runs: readonly ReviewRun[]): string =>
  runs.map((r) => `${String(r.started.data.run)} ${String(r.started.data.check)} ${r.finished ? `${String(r.finished.data.outcome)} ${JSON.stringify(r.finished.data.findings ?? [])}` : 'unfinished'}`).join('; ') || 'none';
export const saidBy = (r: ReviewRun): string => JSON.stringify({ outcome: r.finished?.data.outcome, findings: r.finished?.data.findings ?? [], evidence: r.finished?.data.evidence ?? [] });
export const outcomeOf = (v: Ev | undefined): string => String(v?.data.outcome ?? 'none');
export const sayVerdicts = (vs: readonly Ev[]): string => vs.map((v) => `${outcomeOf(v)} ${JSON.stringify(v.data.reasons ?? v.data).slice(0, 600)}`).join(' | ') || 'none';

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

export interface Story { w: ReviewWorld; hub: Hub; claim: string; events: Ev[]; reviews: ReviewRun[]; verdicts: Ev[] }
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
    const deadline = Date.now() + 300_000;
    while (!reviewRuns(events, claim).some((r) => r.finished) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      events = await allEvents(hub);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    events = await allEvents(hub);
    return { w, hub, claim, events, reviews: reviewRuns(events, claim), verdicts: taskVerdicts(events, ref, since) };
  } catch (error) {
    await stopHub(hub);
    throw error;
  }
}
export const close = (s: Story): Promise<void> => stopHub(s.hub);
