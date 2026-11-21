// Test-side tools for the #551 acceptance tests (README: The surface under test). They reuse #549's suite for what it
// already drives (building `deep-show` and the shipped relay, `deep-show run` without blocking this process, the
// throwaway certificate, the door in front of the relay, a live copy in the app joined by a person's click, the web
// bundle, its server and headless Chrome) and add what #551's criteria read: a match held back by a seeded or chosen
// schedule, each copy's rollbacks and occurrences, a seek after the match, a replay of a record, and net.rollback's and
// net.budget's reports. Nothing here stands in for the net module, a check, the relay, the player or the piece: every
// hash, rollback, report and frame a test reads is the implementation's own, and every expected value comes from the
// issue, the design and fixtures.ts.

import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  Chrome, FULL, LIVE_MS, Script, TIMEOUT, arr, copyOf, exportBundle, failsNaming, firstDifference, fragmentOf, gaveUp, isObject, linkFrom, liveCopy, none, num, obj,
  pinOf, playedOf, presented, putEvidence, runShow, scenario, serve, show, startDoor, startRelay, str, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp,
  type Certs, type Copy,
} from '../549/helpers.ts';
import {
  DELAY, EVERY_STEP, FLICKS, PADDLE2_KEYS, RATE, paddleDoc, rulesProgram,
  type JsonObject, type JsonValue, type Planted, type Plays, type Program,
} from './fixtures.ts';

export {
  FULL, TIMEOUT, failsNaming, firstDifference, isObject, none, num, obj, show, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp,
};
export type { Copy, JsonObject };

/** Each criterion's ID: `#551.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #551.6a2c4947',
  2: 'AC2 #551.9b064904',
  3: 'AC3 #551.5f93fc7b',
  4: 'AC4 #551.44ef3626',
  5: 'AC5 #551.25b0bcea',
  6: 'AC6 #551.8bad0f6c',
  7: 'AC7 #551.9ce1e5fd',
  8: 'AC8 #551.1600fba6',
  9: 'AC9 #551.75e2a4bd',
  10: 'AC10 #551.4b4f0458',
  11: 'AC11 #551.b7783405',
} as const;

/** A reading this machine can't decide: the test fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393): #549's scenario, with this suite's planted names.

export function world(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  return { ...scenario({ evidence, docs: docs.map((id) => ({ id })), calls }), ...(planted ? { planted } : {}) };
}

/** README: `match`. The test relay's schedule on its own clock. `back`: each frame held back a seeded whole number of
 * match steps up to `up_to`, or exactly `exactly`. `deliver`: player `player`'s message for match step `step` reaches
 * copy `to` only once that copy has run step `at`, every frame carrying it held till then. `latency`: each player's
 * one-way latency to the relay, ms. */
export interface Deliver { player: number; step: number; to: number; at: number }
export interface RelayAsk { seed: number; log?: boolean; back?: { up_to: number } | { exactly: number }; deliver?: Deliver[]; latency?: number[] }
export interface MatchAsk {
  plays: Plays;
  relay?: RelayAsk;
  check?: 'net.rollback' | 'net.budget';
  /** net.budget's hosts (the design's `on`). */
  on?: ('app' | 'web')[];
  /** README: `seek`. After the match, in copy `player`, a seek to match step `step`. */
  seek?: { player: number; step: number }[];
  /** README: `ring`. `full`: logic's rollback checkpoints hold its whole memory (the reference for criterion 4). */
  ring?: 'full';
}
export function matchCall(doc: string, steps: number, o: MatchAsk): JsonObject {
  return {
    call: 'match', doc, steps, plays: o.plays as unknown as JsonObject,
    ...(o.relay ? { relay: o.relay as unknown as JsonObject } : {}), ...(o.check ? { check: o.check } : {}), ...(o.on ? { on: o.on } : {}),
    ...(o.seek ? { seek: o.seek as unknown as JsonValue[] } : {}), ...(o.ring ? { ring: o.ring } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// A copy's report (README: A copy's report): #549's, with what #551 adds.

export interface Rollback { from: number; to: number }
export interface Copy551 extends Copy {
  /** Every rollback: `from` the last match step the copy had run, `to` the step whose checkpoints it restored. Null
   * where the report has no `rolled_back`. */
  rolledBack: Rollback[] | null;
  /** The occurrences of every step the copy confirmed, as it holds them at the end: rows `{step, item, kind, …}`. Null
   * where the report has none. */
  occurrences: JsonObject[] | null;
}
export function copy551Of(v: JsonValue | undefined, what: string): Copy551 {
  const c = copyOf(v, what);
  const raw = c.raw;
  const rolledBack = Array.isArray(raw['rolled_back']) ? raw['rolled_back'].map((x, i) => {
    const r = obj(x, `${what}: rolled_back[${i}]`);
    return { from: num(r['from'], `${what}: rolled_back[${i}].from`), to: num(r['to'], `${what}: rolled_back[${i}].to`) };
  }) : null;
  const occurrences = Array.isArray(raw['occurrences']) ? raw['occurrences'].map((x, i) => {
    const r = obj(x, `${what}: occurrences[${i}]`);
    num(r['step'], `${what}: occurrences[${i}].step`);
    str(r['item'], `${what}: occurrences[${i}].item`);
    return r;
  }) : null;
  return { ...c, rolledBack, occurrences };
}
/** A `match` reply's copies, in player order, one a player from 1 to `n`; a refusal fails, naming it. */
export function copiesOf(reply: JsonObject | undefined, n: number, what: string): Copy551[] {
  const m = obj(reply, what);
  expect(m['code'], `${what}: the match call answers, not refuses: ${show(m, 1500)}`).toBeUndefined();
  const copies = arr(m['copies'], `${what}: copies`).map((c, i) => copy551Of(c, `${what}: copies[${i}]`)).sort((a, b) => a.player - b.player);
  expect(copies.map((c) => c.player), `${what}: one copy a player, 1 to ${n}`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  return copies;
}
/** A copy's rollbacks; a report without `rolled_back` fails, naming what it holds. */
export function rollbacksOf(c: Copy551, what: string): Rollback[] {
  expect(c.rolledBack, `${what}: copy ${c.player} reports each rollback (rolled_back: [{from, to}]); its report holds ${Object.keys(c.raw).join(', ')}`).not.toBeNull();
  return c.rolledBack!;
}
/** A rollback's depth: the match steps it stepped again, from `to` through `from`. */
export const depthOf = (r: Rollback): number => r.from - r.to + 1;

/** README: A check's report. net.rollback adds `schedules`; net.budget adds its runs, the class's frame time, the
 * busiest step, the snapshot bytes a second by canvas module and the blocked hosts. */
export interface Check { kind: string; verdict: string; failures: JsonObject[]; raw: JsonObject }
export function checkOf(reply: JsonObject | undefined, what: string): Check {
  const c = obj(obj(reply, what)['check'], `${what}: check (the check's report)`);
  return { kind: str(c['kind'], `${what}: check.kind`), verdict: str(c['verdict'], `${what}: check.verdict`), failures: arr(c['failures'], `${what}: check.failures`).filter(isObject), raw: c };
}
/** The lowest step net.rollback's failures name, or null. */
export const lowestNamed = (c: Check): number | null => c.failures.map((f) => f['step']).filter((s): s is number => typeof s === 'number').sort((a, b) => a - b)[0] ?? null;

// ---------------------------------------------------------------------------------------------------
// One `deep-show run`: a document shown, then one match of it over the test relay.

export interface Played { copies: Copy551[]; check: Check | null; seeks: JsonObject[]; reply: JsonObject }
export interface PlayAsk extends MatchAsk { document: JsonObject; steps: number; programs?: Program[]; planted?: Planted }
export async function play(bin: string, evidence: string, what: string, ask: PlayAsk): Promise<Played> {
  for (const p of ask.programs ?? [rulesProgram()]) putEvidence(evidence, p.bytes);
  const doc = String(ask.document['id']);
  const s = new Script();
  s.present(doc, ask.document);
  const m = s.add(matchCall(doc, ask.steps, ask));
  const r = await runShow(bin, world(evidence, [doc], s.calls, ask.planted), what);
  presented(r[0], `${what}: the piece`);
  const net = ((ask.document['items'] as JsonObject)['match'] as JsonObject)['params'] as JsonObject;
  return {
    copies: copiesOf(r[m], Number(net['players'] ?? 2), what), check: ask.check ? checkOf(r[m], what) : null,
    seeks: ask.seek ? arr(r[m]!['seeks'], `${what}: seeks (each seek after the match)`).filter(isObject) : [], reply: r[m]!,
  };
}

/** README: `replay`. The piece played alone from its start on `track`, with no network, for `steps` match steps; its
 * full-state hash every `hashEvery` steps. */
export function replayCall(doc: string, track: JsonValue[], steps: number, hashEvery: number): JsonObject {
  return { call: 'replay', doc, track, steps, hash_every: hashEvery };
}
export function hashesOf(reply: JsonObject | undefined, what: string): Map<number, string> {
  const r = obj(reply, what);
  expect(r['code'], `${what}: replay answers, not refuses: ${show(r, 1200)}`).toBeUndefined();
  const out = new Map<number, string>();
  for (const [i, h] of arr(r['hashes'], `${what}: hashes`).entries()) {
    const row = obj(h, `${what}: hashes[${i}]`);
    out.set(num(row['step'], `${what}: hashes[${i}].step`), str(row['hash'], `${what}: hashes[${i}].hash`));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The judges each criterion shares. Each failure names what it found.

/** Every full-state hash `got` gives at a step `want` gives too equals it: the first that differs is named. */
export function sameHashes(got: Copy, want: Copy | Map<number, string>, what: string, atLeast: number): string[] {
  const theirs = want instanceof Map ? want : new Map(want.hashes.map((h) => [h.step, h.hash]));
  const f: string[] = [];
  let shared = 0;
  for (const h of got.hashes) {
    const w = theirs.get(h.step);
    if (w === undefined) continue;
    shared += 1;
    if (w !== h.hash) { f.push(`${what}: the full-state hashes differ first at match step ${h.step}: ${h.hash}, and ${w} on the run it is held to`); break; }
  }
  if (shared < atLeast) f.push(`${what}: only ${shared} full-state hashes at steps both give, fewer than ${atLeast}`);
  return f;
}
/** The first step at which any of `copies` parts from its own player's copy of `onTime`, or null. */
export function firstParted(copies: readonly Copy[], onTime: readonly Copy[]): number | null {
  return copies.map((c) => firstDifference(c, onTime[c.player - 1]!)).filter((s): s is number => s !== null).sort((a, b) => a - b)[0] ?? null;
}
/** A record's merged track up to (not including) match step `before`, as each entry's step, player, control and value
 * in (step, player, seq) order; the writer isn't compared (your entry is a peer's on the other copy). */
export function trackLines(track: readonly { t: number; player: number; control: string; value: JsonValue; seq: number }[], before: number, rate = RATE): string[] {
  const step = FLICKS / rate;
  return track.filter((e) => e.t < before * step).slice().sort((x, y) => x.t - y.t || x.player - y.player || x.seq - y.seq)
    .map((e) => `${e.t / step} p${e.player} ${e.control}=${JSON.stringify(e.value)}`);
}
/** Every entry of a script, as the merged track must hold it once stamped `delay` steps later. */
export function scriptLines(plays: Plays, before: number, delay = DELAY): string[] {
  const out: { step: number; player: number; line: string }[] = [];
  for (const [player, list] of Object.entries(plays)) for (const e of list) if (e.step + delay < before) out.push({ step: e.step + delay, player: Number(player), line: `${e.step + delay} p${player} ${e.control}=${JSON.stringify(e.value)}` });
  return out.sort((x, y) => x.step - y.step || x.player - y.player).map((x) => x.line);
}
/** Two lists of track lines: the first line that differs, naming its step. */
export function trackFailures(got: string[], want: string[], what: string): string[] {
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] === want[i]) continue;
    const step = Number((got[i] ?? want[i] ?? 'NaN').split(' ')[0]);
    return [`${what}: the tracks part at match step ${step}: ${got[i] ?? '(nothing)'} where the other holds ${want[i] ?? '(nothing)'}`];
  }
  return [];
}
/** The occurrence rows of steps before `before`, each as canonical JSON, sorted. */
export function occurrenceLines(c: Copy551, before: number, what: string): string[] {
  expect(c.occurrences, `${what}: copy ${c.player} reports the occurrences of the steps it confirmed (occurrences); its report holds ${Object.keys(c.raw).join(', ')}`).not.toBeNull();
  const canon = (v: JsonValue): JsonValue => (Array.isArray(v) ? v.map(canon) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k]!)])) : v);
  return c.occurrences!.filter((r) => (r['step'] as number) < before).map((r) => JSON.stringify(canon(r))).sort();
}
/** Two copies' occurrences agree, row for row, on every step before `before`: an extra row (one a replaced step made,
 * even beside the same row made again) is named with its step. The on-time run must hold some. */
export function occurrenceFailures(got: Copy551, want: Copy551, before: number, what: string): string[] {
  const count = (lines: string[]): Map<string, number> => { const m = new Map<string, number>(); for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const [a, b] = [count(occurrenceLines(got, before, what)), count(occurrenceLines(want, before, what))];
  const f: string[] = [];
  if (b.size === 0) f.push(`${what}: the on-time run holds no occurrence before step ${before}, so none could be replaced`);
  const extra = [...a].filter(([l, n]) => n > (b.get(l) ?? 0)).map(([l]) => l);
  const missing = [...b].filter(([l, n]) => n > (a.get(l) ?? 0)).map(([l]) => l);
  if (extra.length) f.push(`${what}: copy ${got.player} holds occurrences the on-time run doesn't, the first ${extra[0]}`);
  if (missing.length) f.push(`${what}: copy ${got.player} lacks occurrences the on-time run holds, the first ${missing[0]}`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// net.budget (README: net.budget's report) and the design's five-run rule (Frame budget; technical design: Every task
// carries its own budgets): PASS when all five runs are within the class's frame time, FAIL when all five are over by
// more than the margin (the larger of 5% and the five runs' spread), INCONCLUSIVE otherwise, and only on a reference Mac.

/** The reference Macs, as the technical design lists them (The reference Macs). */
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const sh = (...args: string[]): string => execFileSync('sysctl', ['-n', ...args], { encoding: 'utf8' }).trim();
  try {
    const [model, chip, gib] = [sh('hw.model'), sh('machdep.cpu.brand_string'), Math.round(Number(sh('hw.memsize')) / 2 ** 30)];
    return REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib) ? null : `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
}
export interface BudgetRun { stepMs: number; windowMs: number }
export interface Budget { verdict: string; failures: JsonObject[]; runs: BudgetRun[]; frameMs: number; raw: JsonObject }
export function budgetOf(c: Check, what: string): Budget {
  expect(c.kind, `${what}: the check is net.budget`).toBe('net.budget');
  const runs = arr(c.raw['runs'], `${what}: check.runs (net.budget's five runs, each {step_ms, window_ms})`).map((x, i) => {
    const r = obj(x, `${what}: check.runs[${i}]`);
    return { stepMs: num(r['step_ms'], `${what}: check.runs[${i}].step_ms`), windowMs: num(r['window_ms'], `${what}: check.runs[${i}].window_ms`) };
  });
  return { verdict: c.verdict, failures: c.failures, runs, frameMs: num(c.raw['frame_ms'], `${what}: check.frame_ms (the class's frame time)`), raw: c.raw };
}
const worst = (r: BudgetRun): number => r.stepMs + r.windowMs;
/** The verdict the five-run rule gives these runs. */
export function fiveRun(b: Budget): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  const w = b.runs.map(worst);
  const spread = Math.max(...w) - Math.min(...w);
  const margin = Math.max(0.05 * b.frameMs, spread);
  if (w.every((x) => x <= b.frameMs)) return 'PASS';
  if (w.every((x) => x > b.frameMs + margin)) return 'FAIL';
  return 'INCONCLUSIVE';
}
/** A timing verdict that must be `want`: INCONCLUSIVE (never a pass) off a reference Mac, when net.budget says so, or
 * when the five runs leave it undecided and the machine is loaded; else net.budget's verdict, its five runs and the
 * rule must agree on `want`. */
export function budgetFailures(b: Budget, want: 'PASS' | 'FAIL', what: string): string[] {
  const off = referenceMacProblem();
  if (off) inconclusive(`${what}: a timing budget counts only on a reference Mac (${off})`);
  if (b.runs.length !== 5) return [`${what}: net.budget reports ${b.runs.length} runs, not the five the rule takes`];
  const rule = fiveRun(b);
  const said = `${b.verdict}; runs ${JSON.stringify(b.runs)}; frame ${b.frameMs} ms`;
  if (b.verdict === 'INCONCLUSIVE' || rule === 'INCONCLUSIVE') {
    if (b.verdict === 'INCONCLUSIVE' && rule === 'INCONCLUSIVE') inconclusive(`${what}: net.budget's five runs don't decide (${said}; 1-minute load ${(loadavg()[0] ?? 0).toFixed(1)} on ${cpus().length} cores)`);
    return [`${what}: net.budget reads ${b.verdict} where its own five runs give ${rule} (${said})`];
  }
  const f: string[] = [];
  if (b.verdict !== rule) f.push(`${what}: net.budget reads ${b.verdict} where its five runs give ${rule} (${said})`);
  if (rule !== want) f.push(`${what}: net.budget reads ${b.verdict}, not ${want} (${said})`);
  return f;
}
/** net.budget's failures name the canvas module that costs most. */
export function namesModule(b: Budget, module: string, what: string): string[] {
  return b.failures.some((x) => x['module'] === module) ? [] : [`${what}: no failure of net.budget names the canvas module ${module}: ${show(b.failures, 800)}`];
}

// ---------------------------------------------------------------------------------------------------
// The app and the web player in one live match (criterion 1, and the Oracle lane's portability case): the shipped relay
// behind #549's door on 127.0.0.1, which holds each frame it forwards back by a seeded time of up to 8 match steps
// (order kept), the app's copy joined by a person's click and playing player 1's script, and headless Chrome's web
// player joined through its link by a person's click, whose person presses paddle 2's keys while the match runs.

export interface LiveAsk { builds: { show: (set?: string) => string; relay: () => string }; certs: () => Certs; temp: () => string; closing: (f: () => Promise<void> | void) => void; steps: number; plays: Plays; holdSteps: number; what: string }
export interface LivePlayed { app: Copy551; web: Copy551; presses: number[]; framesThrough: number }
/** The keys a person presses on the web player, one every 0.3 s, by a seeded order. */
export function pressOrder(n: number): string[] {
  const keys = Object.keys(PADDLE2_KEYS);
  let a = 551;
  return Array.from({ length: n }, () => { a = (a * 1103515245 + 12345) >>> 0; return keys[(a >>> 16) % keys.length]!; });
}
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
export async function appAndWeb(o: LiveAsk): Promise<LivePlayed> {
  const relay = await startRelay(o.builds.relay(), o.certs());
  o.closing(() => relay.stop());
  const holdMs = Math.round((o.holdSteps * 1000) / RATE);
  const door = await startDoor(relay.host, o.certs(), { delayMs: [0, holdMs], seed: 551, signals: false });
  o.closing(() => door.close());
  const program = rulesProgram();
  // A timeout of 120 s, so a slow machine can't end the match; nothing here measures a time.
  const document = paddleDoc({ relay: door.url, hash_every: EVERY_STEP, timeout: 120 });
  const [appStore, webStore, out, links] = [o.temp(), o.temp(), join(o.temp(), 'bundle'), o.temp()];
  for (const store of [appStore, webStore]) putEvidence(store, program.bytes);
  await exportBundle(o.builds.show(), webStore, document, out, `${o.what}: the web bundle`);
  const served = await serve(out);
  o.closing(() => served.stop());
  const linkFile = join(links, 'link');
  const app = liveCopy(o.builds.show(), { evidence: appStore, document, steps: o.steps, plays: o.plays['1'] ?? [], relayCa: o.certs().ca, linkTo: linkFile }, `${o.what}: the app's copy`);
  let appDone = false;
  app.then(() => { appDone = true; }, () => { appDone = true; });
  const link = await linkFrom(linkFile, `${o.what}: the app's copy`, app);
  const chrome = await Chrome.open([pinOf(o.certs().cert)]);
  o.closing(() => chrome.close());
  const tab = await chrome.open(`${served.origin}/index.html${fragmentOf(link, null, `${o.what}: the app's link`)}`);
  await tab.mustBeReady(`${o.what}: the web player`);
  const prompt = await tab.prompt();
  expect(prompt?.button, `${o.what}: the web player draws its own Join prompt with a button: ${JSON.stringify(prompt)}`).toBeTruthy();
  await tab.click(prompt!.button!.x + prompt!.button!.w / 2, prompt!.button!.y + prompt!.button!.h / 2);
  // The person's keys: one every 0.3 s from the web player's first match step while the app's copy plays, each the
  // browser's own input.
  const started = Date.now() + LIVE_MS;
  while (!appDone && Date.now() < started && !(Number((await tab.match())?.['ran'] ?? 0) >= 1)) await sleep(100);
  if (!appDone && Date.now() >= started) gaveUp(`${o.what}: the web player's copy ran no match step after its Join`);
  const order = pressOrder(10_000);
  const presses: number[] = [];
  for (let i = 0; !appDone && i < order.length; i++) {
    const key = order[i]!;
    const code = `Digit${key}`;
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: 48 + Number(key) });
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: 48 + Number(key) });
    presses.push(PADDLE2_KEYS[key]!);
    await sleep(300);
  }
  const played = await app;
  const a = playedOf(played.reply, `${o.what}: the app's copy`);
  // The app's copy left after its steps, which ends the match on the web player's copy too.
  const until = Date.now() + LIVE_MS;
  let seen = await tab.match();
  while ((seen?.['end'] === null || seen?.['end'] === undefined) && Date.now() < until) { await sleep(250); seen = await tab.match(); }
  if (seen?.['end'] === null || seen?.['end'] === undefined) gaveUp(`${o.what}: the web player's match didn't end after the app's copy left: ${JSON.stringify(seen)?.slice(0, 600)}`);
  const framesThrough = door.connections.reduce((n, c) => n + c.sent.filter((m) => m.kind === 'binary').length, 0);
  return { app: copy551Of(a.raw, `${o.what}: the app's copy`), web: copy551Of(seen, `${o.what}: the web player's copy (probe().match)`), presses, framesThrough };
}
/** The entries a copy's record holds for `player`, each as the play that made it (`delay` steps before its step). */
export function playsFromRecord(c: Copy, player: number, before: number): Plays[string] {
  const step = FLICKS / RATE;
  return (c.record?.track ?? []).filter((e) => e.player === player && e.t < before * step).sort((x, y) => x.t - y.t || x.seq - y.seq)
    .map((e) => ({ step: e.t / step - DELAY, control: e.control, value: Number(e.value) }));
}
