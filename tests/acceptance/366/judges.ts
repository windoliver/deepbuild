// Each criterion's assertions, as functions from what a run showed to the problems it has: [] is a pass. The tests
// run them on the real program's run and on each wrong program's (README, Wrong programs), so a judge that lets a wrong
// program through fails its own test. Every problem names what the criterion says it names.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { HttpRequest, InstallFrom } from '../../../packages/extension-host/src/index.ts';
import type { JobRecord } from '../../../packages/runner/src/index.ts';
import { hhmm, type Answer, type Got } from './helpers.ts';

// ---- AC1: "uses only these blocks" (README, Readings).
/**
 * The blocks the stocks view is built from: the first plug-in tier's view, source, secret, store, schedule, notice and
 * action (the design's "the stocks view seven"), Read now, and this issue's runner. Every one is a preview entry, so a
 * package lists each it calls in requires.preview or the host refuses the call (#139).
 */
export const BLOCKS = [
  'deep.registerView', 'deep.readNow', 'deep.registerSource', 'deep.secret', 'deep.store', 'deep.store.put', 'deep.store.get', 'deep.store.list',
  'deep.schedule', 'deep.schedule.read', 'deep.notices.send', 'deep.registerAction', 'deep.runner.run',
] as const;
/** The access words those blocks need: hosts for the market source, agent for a runner job. */
export const WORDS = ['hosts', 'agent'];
/** Manifest fields that declare a block outside them: checks, events, outputs, replacements, environments, leases, hosted processes. */
const FOREIGN = ['checks', 'events', 'provides', 'uses', 'replaces', 'environments', 'leases', 'kernel', 'host', 'templates', 'codes'];
/** What a panel would call the network with. */
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b|\bdeep\s*\.\s*fetch\b/;
const CODE = /\.(ts|mts|js|mjs|cjs)$/;
/** A package's own tests, which may call anything a test kit gives them: a tests folder, or a *.test.* file. */
const isTest = (rel: string): boolean => /(^|\/)(tests?|__tests__)\//.test(rel) || /\.test\.[a-z]+$/.test(rel);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
/** The package's panels: each folder holding a `main.js`, the entry the app mounts (deep-app's mount_panel). */
export function panelsOf(dir: string): string[] {
  return walk(dir).filter((p) => p.endsWith('/main.js') && !isTest(relative(dir, p))).map((p) => p.slice(0, -'/main.js'.length)).sort();
}
/** Every `deep.<member>…` the package's code names outside its tests, with where. */
export function deepCalls(dir: string): { name: string; where: string }[] {
  const out: { name: string; where: string }[] = [];
  for (const path of walk(dir)) {
    const rel = relative(dir, path);
    if (!CODE.test(rel) || isTest(rel)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\bdeep((?:\s*\.\s*[A-Za-z_$][\w$]*)+)/g)) out.push({ name: `deep${m[1]!.replace(/\s+/g, '')}`, where: `${rel}:${i + 1}` });
    });
  }
  return out;
}
/**
 * Whether a package uses only these blocks: its requires.preview lists only them, its manifest declares no other
 * block, its access words and grant reach only the market host, its code names no other `deep` member, it registers a
 * view with a panel, and no panel of it calls the network itself.
 */
export function blocksProblems(dir: string, grant: InstallFrom['grant'] | undefined, marketHost: string): string[] {
  const problems: string[] = [];
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as Record<string, any>;
  for (const method of (m.requires?.preview ?? []) as string[]) if (!(BLOCKS as readonly string[]).includes(method)) problems.push(`its manifest lists ${method} in requires.preview, a block outside the stocks view's`);
  for (const field of FOREIGN) if (m[field] !== undefined && !(Array.isArray(m[field]) && m[field].length === 0)) problems.push(`its manifest declares ${field}, a block outside the stocks view's`);
  for (const word of (m.access?.words ?? []) as string[]) if (!WORDS.includes(word)) problems.push(`its manifest asks for the access word ${word}`);
  for (const [key, value] of Object.entries(grant ?? {})) {
    if (key === 'hosts') {
      for (const g of (value ?? []) as { host: string }[]) if (g.host !== marketHost) problems.push(`its grant names the host ${g.host}, not the market host ${marketHost}`);
    } else if (value !== undefined && !(Array.isArray(value) && value.length === 0) && value !== false) problems.push(`its grant names ${key}: ${JSON.stringify(value)}`);
  }
  const calls = deepCalls(dir);
  for (const c of calls) {
    if (!BLOCKS.some((b) => b === c.name || b.startsWith(`${c.name}.`))) problems.push(`${c.where} calls ${c.name}, a block outside the stocks view's`);
  }
  if (!calls.some((c) => c.name === 'deep.registerView')) problems.push('it registers no view (deep.registerView)');
  const panels = panelsOf(dir);
  if (!panels.length) problems.push('it has no panel (a folder holding main.js)');
  for (const panel of panels) {
    for (const path of walk(panel).filter((p) => CODE.test(p))) {
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        const hit = NETWORK.exec(line);
        if (hit) problems.push(`${relative(dir, path)}:${i + 1}: its panel calls the network itself (${hit[0].trim()})`);
      });
    }
  }
  return problems;
}
/** The refusal of a package whose panel calls the market host itself: at install, its conformance or its load, naming the call. */
export interface Gate { install?: string; check?: { passed: boolean; reasons: string[] }; load?: { status: string; reason?: string } }
export function panelCallProblems(gate: Gate, host: string): string[] {
  const said = gate.install ?? (gate.check && !gate.check.passed ? gate.check.reasons.join('; ') : undefined) ?? (gate.load?.status === 'refused' ? gate.load.reason : undefined);
  if (said === undefined) return [`the copy whose panel fetches ${host} itself installed, passed its conformance and loaded`];
  return /\bfetch\b/.test(said) && said.includes(host) ? [] : [`the copy was refused without naming the call (fetch of ${host}): ${said}`];
}

// ---- AC2: every model job through the runner; no model key in the hub; a failed job returns its failure.
/** Hosts a hub holding a model key would call itself. */
const MODEL_HOSTS = /(^|\.)(anthropic\.com|openai\.com|claude\.ai|chatgpt\.com)$/;
export interface RunnerRun { got: Got; expected: string; promptLine: string; jobs: { rec: JobRecord; stdin: string; apiKeySource: unknown }[]; asked: HttpRequest[]; keyHits: string[] }
export function throughRunnerProblems(r: RunnerRun): string[] {
  const problems: string[] = [];
  if (!r.got.ok) problems.push(`the plug-in got no answer: ${r.got.error}`);
  else if (r.got.answer?.value !== r.expected) problems.push(`the plug-in's answer isn't the one the agent gave (${JSON.stringify(r.expected)}): ${JSON.stringify(r.got.answer)}`);
  const ran = r.jobs.filter((j) => j.stdin.split('\n').includes(r.promptLine));
  if (ran.length !== 1) problems.push(`${ran.length} of the runner's ${r.jobs.length} jobs carried the plug-in's prompt to your agent; the model job didn't go through the runner once`);
  for (const j of ran) {
    if (j.rec.agent !== 'claude-code' || j.rec.state !== 'finished') problems.push(`the job ${j.rec.job} reads ${j.rec.agent} ${j.rec.state}, not your Claude Code, finished`);
    if (j.apiKeySource !== 'none') problems.push(`the job ${j.rec.job} ran on a key (${String(j.apiKeySource)}), not your sign-in and plan`);
  }
  for (const a of r.asked) {
    const hostname = new URL(a.url).hostname;
    if (MODEL_HOSTS.test(hostname)) problems.push(`the hub called the model host ${hostname} itself (${a.method} ${a.url})`);
  }
  for (const hit of r.keyHits) problems.push(`the hub holds a model key: ${hit}`);
  return problems;
}
export interface FailedRun { got: Got; jobs: JobRecord[]; key: string; reachedProvider: number; sent: { key: string; outcome: string }[] }
export function failedJobProblems(r: FailedRun): string[] {
  const problems: string[] = [];
  const failed = r.jobs.filter((j) => j.stop?.cause === 'rate_limited');
  if (!failed.length) problems.push(`no job of the runner stopped rate_limited: ${JSON.stringify(r.jobs.map((j) => [j.job, j.state, j.stop]))}`);
  if (r.got.ok) problems.push(`a job that failed came back as an answer, canned text: ${JSON.stringify(r.got.answer?.value)}`);
  else if (!/rate_limited/.test(r.got.error ?? '')) problems.push(`the plug-in got a failure that doesn't name the job's own (rate_limited): ${r.got.error}`);
  if (r.reachedProvider) problems.push(`the brief ${r.key} went out (${r.reachedProvider} request(s) reached the mail host) though its job failed`);
  for (const s of r.sent.filter((s) => s.key === r.key && s.outcome === 'sent')) problems.push(`the hub reads the brief ${s.key} sent though its job failed`);
  return problems;
}

// ---- AC3: a stock's page from ⌘K, with the stock as its parameter.
export interface PageRun { entries: string[]; clicked: string | null; shown: boolean; main: boolean }
export function pageProblems(r: PageRun, entry: string, text: string): string[] {
  const problems: string[] = [];
  if (!r.entries.includes(entry)) problems.push(`⌘K lists no ${entry} for the query: it lists ${JSON.stringify(r.entries)}`);
  if (r.clicked) problems.push(`${entry} couldn't be opened from ⌘K: ${r.clicked}`);
  if (!r.shown) problems.push(`${entry} didn't open its page with its parameter: "${text}" isn't drawn${r.main ? ' (the view shows its main page)' : ''}`);
  return problems;
}

// ---- AC4: a session handle refused before any job, naming the grant; nothing a job finds past the grant.
export function refusalProblems(got: Got, handle: string, jobs: JobRecord[]): string[] {
  const problems: string[] = [];
  const started = jobs.filter((j) => j.pid !== undefined || j.start !== undefined || ['running', 'finished', 'stopping', 'stopped'].includes(j.state));
  for (const j of started) problems.push(`a job started (${j.job}, ${j.state}) for ${handle}, which the grant doesn't reach`);
  if (got.ok) problems.push(`deep.runner.run with ${handle} answered: ${JSON.stringify(got.answer)}`);
  else if (!(got.error ?? '').includes(handle) || !/grant/.test(got.error ?? '') || !/\btext\b|content-free/.test(got.error ?? '')) problems.push(`the refusal doesn't name ${handle} and the grant (content-free fields, no text): ${got.error}`);
  return problems;
}
export function foundProblems(got: Got, markers: Record<string, string>, allowed: string[]): string[] {
  const problems: string[] = [];
  const seen = JSON.stringify(got);
  for (const [what, marker] of Object.entries(markers)) if (seen.includes(marker)) problems.push(`the plug-in got ${what}`);
  for (const cite of got.answer?.cites ?? []) if (!allowed.includes(cite)) problems.push(`the plug-in got the handle ${cite}, which its grant doesn't reach`);
  return problems;
}

// ---- AC5: an answer as old as the price it cites; stale 5 minutes after the price's as-of time.
export interface StaleRun { priceAsOf: number; answer: Answer | undefined; before: Got; after: Got }
export function staleProblems(r: StaleRun, freshFor: number): string[] {
  const problems: string[] = [];
  if (!r.answer) return ['the runner gave no answer citing the price'];
  if (r.answer.as_of !== r.priceAsOf) problems.push(`the answer is as of ${hhmm(r.answer.as_of)}, not the price's ${hhmm(r.priceAsOf)}`);
  if (r.answer.stale_at !== r.priceAsOf + freshFor) problems.push(`the answer reads fresh until ${hhmm(r.answer.stale_at)}, not until ${hhmm(r.priceAsOf + freshFor)}, 5 minutes after the price's as-of time`);
  if (!r.before.ok) problems.push(`a notice citing the answer while it was fresh was refused: ${r.before.error}`);
  if (r.after.ok) problems.push(`the notice citing the answer at ${hhmm(r.priceAsOf + freshFor)} went out (${r.after.notice}), citing a stale answer`);
  else if (!(r.after.error ?? '').includes(r.answer.handle)) problems.push(`the notice at ${hhmm(r.priceAsOf + freshFor)} was refused without naming the stale answer ${r.answer.handle}: ${r.after.error}`);
  return problems;
}

// ---- AC6: the same order every time, each name first for itself, nothing from the live app's recency file.
export interface RankRun { first: Record<string, string[][]>; second: Record<string, string[]>; exact: Record<string, string[]> }
export function rankProblems(r: RankRun, names: string[]): string[] {
  const problems: string[] = [];
  for (const [query, [a, b]] of Object.entries(r.first)) {
    if (!a?.length) problems.push(`⌘K lists nothing for "${query}" in the first replica`);
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`"${query}" twice in one replica gave two orders: ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
    const other = r.second[query];
    if (JSON.stringify(a) !== JSON.stringify(other)) {
      const moved = (other ?? []).find((n, i) => a?.[i] !== n) ?? a?.[0] ?? query;
      problems.push(`"${query}" in a second replica gave another order, ${moved} moved: ${JSON.stringify(a)} then ${JSON.stringify(other)}`);
    }
  }
  for (const name of names) {
    const top = r.exact[name]?.[0];
    if (top !== name) problems.push(`${name} isn't first for its exact name: ⌘K put ${top ?? 'nothing'} first (${JSON.stringify(r.exact[name])})`);
  }
  return problems;
}

/** Whether a recorded build is where AC1 reads it: the folder, its build.json, recording.json and package/. */
export function recordedProblems(dir: string): string[] {
  return ['build.json', 'recording.json', 'package/deepbuild.json'].filter((f) => !existsSync(join(dir, f))).map((f) => `${relative(join(dir, '..', '..', '..', '..', '..'), join(dir, f))} is missing`);
}
