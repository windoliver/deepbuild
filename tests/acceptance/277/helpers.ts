// Test-side tools for the #277 acceptance tests (README: The surface under test). They reuse #549's suite for what it
// already drives (building `deep-show` and the shipped relay, `deep-show run` without blocking this process, the
// throwaway certificate, the door in front of the relay, a live copy in the app joined by a person's click, the web
// bundle, its server and headless Chrome) and add what #277's criteria read: a match in which a copy is killed, frozen
// or hidden, the seat entries on each copy's track, each copy's catch-up, the `logic` call's rows and its
// logic.determinism on the web player's run, and a live match of app copies and web copies in which the test crashes a
// tab or hides one. Nothing here stands in for the net module, a check, the relay, the player or the piece: every
// entry, hash, report and frame a test reads is the implementation's own, and every expected value comes from the
// issue, the design and fixtures.ts.

import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  Chrome, LIVE_MS, REPO, Script, arr, blocked, copyOf, fragmentOf, gaveUp, isObject, joinedMatches, linkFrom, liveCopy, num, obj,
  pinOf, playedOf, presented, putEvidence, readFrame, runShow, scenario, serve, show, startDoor, startRelay, str,
  type Builds, type Certs, type Copy, type Door, type LiveCopy, type Tab,
} from '../549/helpers.ts';
import { AIM_KEYS, HASH_EVERY, STEP, rng, type JsonObject, type JsonValue, type Piece, type Planted, type Plays } from './fixtures.ts';

export {
  FULL, TIMEOUT, gaveUp, isObject, none, num, obj, show, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp,
} from '../549/helpers.ts';
export type { Copy };

/** Each criterion's ID: `#277.` and the first 8 hex digits of the SHA-256 of its text (the trace lane's criterionId). */
export const AC = {
  1: 'AC1 #277.bbe9c183',
  2: 'AC2 #277.4413887e',
  3: 'AC3 #277.a4a81099',
  4: 'AC4 #277.2c9337c4',
  5: 'AC5 #277.cda3f5b9',
  6: 'AC6 #277.402a14da',
} as const;

/** A reading this machine can't decide: the test fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393): #549's scenario, with this suite's planted names.

export function world(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  return { ...scenario({ evidence, docs: docs.map((id) => ({ id })), calls }), ...(planted ? { planted } : {}) };
}

// ---------------------------------------------------------------------------------------------------
// `match` (README: `match`'s members): #549's call, #551's relay schedules, and what this suite adds.

/** Copy `player` is killed right after it runs match step `step`: its connection ends and it sends nothing more. */
export interface Kill { player: number; step: number }
/** Copy `player` is hidden right after it runs match step `step`, and comes back `for` seconds later. */
export interface Hide { player: number; step: number; for: number }
/** When copy `player`'s connection ends, the relay never hands copy `to` the last `last` messages it sent. */
export interface Withhold { player: number; to: number; last: number }
export interface Relay277 {
  seed: number; log?: boolean;
  /** #551's: each frame held back a seeded whole number of match steps up to n. */
  back?: { up_to: number };
  /** #549's: every frame `player` sends from `at` for `for` seconds waits at the relay till then. */
  hold?: { player: number; at: number; for: number }[];
  /** #551's: each player's one-way latency to the relay, ms. */
  latency?: number[];
  withhold?: Withhold[];
}
export interface MatchAsk { plays: Plays; relay?: Relay277; kill?: Kill[]; freeze?: Kill[]; hide?: Hide[] }
export function matchCall(doc: string, steps: number, o: MatchAsk): JsonObject {
  const j = (v: unknown): JsonValue => v as JsonValue;
  return {
    call: 'match', doc, steps, plays: j(o.plays), ...(o.relay ? { relay: j(o.relay) } : {}),
    ...(o.kill ? { kill: j(o.kill) } : {}), ...(o.freeze ? { freeze: j(o.freeze) } : {}), ...(o.hide ? { hide: j(o.hide) } : {}),
  };
}

export interface Played { copies: Copy[]; relay: JsonObject; reply: JsonObject }
export interface PlayAsk extends MatchAsk { piece: Piece; steps: number; planted?: Planted }
/** One `deep-show run`: the piece shown, then one match of it over the test relay, every copy in this process. */
export async function play(bin: string, evidence: string, what: string, ask: PlayAsk): Promise<Played> {
  putEvidence(evidence, ask.piece.program.bytes);
  const doc = String(ask.piece.doc['id']);
  const s = new Script();
  s.present(doc, ask.piece.doc);
  const m = s.add(matchCall(doc, ask.steps, ask));
  const r = await runShow(bin, world(evidence, [doc], s.calls, ask.planted), what);
  presented(r[0], `${what}: the piece`);
  const reply = obj(r[m], `${what}: the match`);
  expect(reply['code'], `${what}: the match call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const net = obj(obj(obj(ask.piece.doc['items'], 'items')['match'], 'the net item')['params'], 'the net item\'s params');
  const copies = arr(reply['copies'], `${what}: copies`).map((c, i) => copyOf(c, `${what}: copies[${i}]`)).sort((a, b) => a.player - b.player);
  expect(copies.map((c) => c.player), `${what}: one copy a player`).toEqual(Array.from({ length: Number(net['players']) }, (_, i) => i + 1));
  return { copies, relay: obj(reply['relay'], `${what}: relay`), reply };
}

// ---------------------------------------------------------------------------------------------------
// What a copy holds (README: A copy's report): its seat entries, its catch-ups, what its desync names, its rows.

/** A seat entry on a copy's record: `seat {player, state}`, the writer `net`, at its match step. */
export interface Seat { step: number; player: number; state: string; writer: string }
/** The seat entries a copy's record holds, in step order. An entry is one when it carries `seat: {player, state}` (or,
 * read as the same, the control `seat` with that object as its value). */
export function seatsOf(c: Copy, step = STEP): Seat[] {
  const track = Array.isArray(c.record?.raw['track']) ? c.record!.raw['track'] : [];
  const out: Seat[] = [];
  for (const e of track.filter(isObject)) {
    const s = isObject(e['seat']) ? e['seat'] : e['control'] === 'seat' && isObject(e['value']) ? e['value'] : null;
    if (!s) continue;
    out.push({ step: Number(e['t']) / step, player: Number(s['player']), state: String(s['state']), writer: String(e['writer'] ?? '') });
  }
  return out.sort((a, b) => a.step - b.step || a.player - b.player);
}
/** Every copy in `copies` holds exactly one seat entry for `player` in `state` (at a step in [from, to)), each written
 * by `net`, all at one step: that step, or null with the failures naming what each holds. */
export function oneSeat(copies: readonly Copy[], player: number, state: string, what: string, o: { step?: number; from?: number; to?: number } = {}): { at: number | null; failures: string[] } {
  const f: string[] = [];
  const at = new Set<number>();
  for (const c of copies) {
    const all = seatsOf(c, o.step ?? STEP);
    const mine = all.filter((s) => s.player === player && s.state === state && s.step >= (o.from ?? 0) && s.step < (o.to ?? Infinity));
    if (mine.length !== 1) { f.push(`${what}: copy ${c.player}'s record holds ${mine.length} seat {${player}, ${state}} entries, not one; its seat entries: ${show(all, 600)}`); continue; }
    if (mine[0]!.writer !== 'net') f.push(`${what}: copy ${c.player}'s seat {${player}, ${state}} entry has the writer ${mine[0]!.writer}, not net`);
    at.add(mine[0]!.step);
  }
  if (at.size > 1) f.push(`${what}: the copies stamp seat {${player}, ${state}} at different steps: ${[...at].join(', ')}`);
  return { at: f.length === 0 && at.size === 1 ? [...at][0]! : null, failures: f };
}

/** A copy's record's merged track, as its report gives it, entries untouched. */
export const recordTrack = (c: Copy): JsonValue[] => (Array.isArray(c.record?.raw['track']) ? c.record!.raw['track'] : []);
/** A copy's catch-up (README: `catch_ups`): the steps it ran headless on its return, how long they took, and in the
 * web player each frame's share. */
export interface CatchUp { from: number; to: number; steps: number; seconds: number; stepsPerS: number; frames: { steps: number; ms: number }[] | null; raw: JsonObject }
export function catchUpsOf(c: Copy | JsonObject, what: string): CatchUp[] {
  const raw = 'raw' in c && isObject((c as Copy).raw) ? (c as Copy).raw : (c as JsonObject);
  expect(Array.isArray(raw['catch_ups']), `${what}: the copy reports its catch-ups (catch_ups: [{from, to, steps, seconds, steps_per_s}]); its report holds ${Object.keys(raw).join(', ')}`).toBe(true);
  return arr(raw['catch_ups'], `${what}: catch_ups`).map((x, i) => {
    const u = obj(x, `${what}: catch_ups[${i}]`);
    const frames = Array.isArray(u['frames']) ? u['frames'].map((y, j) => { const fr = obj(y, `${what}: catch_ups[${i}].frames[${j}]`); return { steps: num(fr['steps'], `${what}: …frames[${j}].steps`), ms: num(fr['ms'], `${what}: …frames[${j}].ms`) }; }) : null;
    return {
      from: num(u['from'], `${what}: catch_ups[${i}].from`), to: num(u['to'], `${what}: catch_ups[${i}].to`), steps: num(u['steps'], `${what}: catch_ups[${i}].steps`),
      seconds: num(u['seconds'], `${what}: catch_ups[${i}].seconds`), stepsPerS: num(u['steps_per_s'], `${what}: catch_ups[${i}].steps_per_s`), frames, raw: u,
    };
  });
}

/** The step a copy's net.desync names (`first_step` for a state desync, `step` for one of entries), or null. */
export function desyncStep(c: Copy): number | null {
  const d = c.raw['desync'];
  if (!isObject(d)) return null;
  const s = d['first_step'] ?? d['step'];
  return typeof s === 'number' ? s : null;
}

/** #540's rows of a copy (`match`) or of the `logic` call: each step's arrays, by step. */
export type Rows = Map<number, JsonObject>;
export function rowsOf(list: JsonValue | undefined, what: string): Rows {
  const out: Rows = new Map();
  for (const [i, r] of arr(list, `${what}: steps (each step's row with its arrays)`).entries()) {
    const row = obj(r, `${what}: steps[${i}]`);
    out.set(num(row['step'], `${what}: steps[${i}].step`), obj(row['arrays'], `${what}: steps[${i}].arrays`));
  }
  return out;
}
/** One element of a logic array after a step, as a row holds it. */
export function element(rows: Rows, step: number, array: string, index: number, what: string): number {
  const row = rows.get(step);
  expect(row, `${what}: a row for step ${step}`).toBeDefined();
  return num(arr(row![array], `${what}: step ${step}'s ${array}`)[index], `${what}: step ${step}'s ${array}[${index}]`);
}

// ---------------------------------------------------------------------------------------------------
// The judges the criteria share. Each failure names what it found.

/** Every pair of copies reports the same full-state hash at every step both report, each copy at least `atLeast`
 * hashes, `every` match steps apart. */
export function hashesAgree(copies: readonly Copy[], what: string, atLeast: number, every = HASH_EVERY): string[] {
  const f: string[] = [];
  for (const c of copies) {
    if (c.hashes.length < atLeast) f.push(`${what}: copy ${c.player} reports ${c.hashes.length} full-state hashes, fewer than ${atLeast}`);
    const off = c.hashes.find((h) => h.step % every !== 0);
    if (off) f.push(`${what}: copy ${c.player} reports a full-state hash at step ${off.step}, not a hash interval of ${every}`);
  }
  for (let i = 0; i < copies.length; i++) {
    for (let j = i + 1; j < copies.length; j++) {
      const s = firstDifference(copies[i]!, copies[j]!);
      if (s !== null) f.push(`${what}: copies ${copies[i]!.player} and ${copies[j]!.player} part at the hash for step ${s}`);
    }
  }
  return f;
}
/** The first step at which two copies' full-state hashes differ, or null. */
export function firstDifference(a: Copy, b: Copy): number | null {
  const other = new Map(b.hashes.map((h) => [h.step, h.hash]));
  for (const h of a.hashes) { const got = other.get(h.step); if (got !== undefined && got !== h.hash) return h.step; }
  return null;
}
/** The first step at which any two of `copies` part, or null. */
export function firstParted(copies: readonly Copy[]): number | null {
  const steps: number[] = [];
  for (let i = 0; i < copies.length; i++) for (let j = i + 1; j < copies.length; j++) { const s = firstDifference(copies[i]!, copies[j]!); if (s !== null) steps.push(s); }
  return steps.sort((a, b) => a - b)[0] ?? null;
}
/** Whether a copy reports a full-state hash at every multiple of `every` from `from` through `to`. */
export function hashedThrough(c: Copy, from: number, to: number, every = HASH_EVERY): number | null {
  const have = new Set(c.hashes.map((h) => h.step));
  for (let k = Math.ceil(from / every) * every; k <= to; k += every) if (!have.has(k)) return k;
  return null;
}
/** A record's merged track before match step `before`, one line an entry: its step, player and what it holds (every
 * member but `t`, `seq`, `writer` and `player`, canonical JSON), in (step, player, line) order. The writer isn't
 * compared: your entry is a peer's on the other copy. */
export function trackLines(c: Copy, before: number, step = STEP): string[] {
  const canon = (v: JsonValue): JsonValue => (Array.isArray(v) ? v.map(canon) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k]!)])) : v);
  const track = Array.isArray(c.record?.raw['track']) ? c.record!.raw['track'].filter(isObject) : [];
  return track.filter((e) => Number(e['t']) < before * step).map((e) => {
    const { t, seq, writer, player, ...rest } = e;
    void seq; void writer;
    return { k: Number(t) / step, p: Number(player), line: `${Number(t) / step} p${String(player)} ${JSON.stringify(canon(rest))}` };
  }).sort((x, y) => x.k - y.k || x.p - y.p || (x.line < y.line ? -1 : x.line > y.line ? 1 : 0)).map((x) => x.line);
}
/** Every copy's record holds the same merged track before `before`: the first line that differs is named. */
export function tracksAgree(copies: readonly Copy[], before: number, what: string, step = STEP): string[] {
  const [first, ...rest] = copies;
  if (!first) return [];
  const want = trackLines(first, before, step);
  const f: string[] = [];
  if (want.length === 0) f.push(`${what}: copy ${first.player}'s record holds no entry before step ${before}`);
  for (const c of rest) {
    const got = trackLines(c, before, step);
    const i = Array.from({ length: Math.max(got.length, want.length) }, (_, k) => k).find((k) => got[k] !== want[k]);
    if (i !== undefined) f.push(`${what}: copy ${c.player}'s record and copy ${first.player}'s part at line ${i}: ${got[i] ?? '(nothing)'} where the other holds ${want[i] ?? '(nothing)'}`);
  }
  return f;
}
/** A match's work, counted by what the module and the test relay report, so no load can move it (README: Criterion 4):
 * the frames the relay carried (one row a frame and copy), their bytes and the messages they held, the rollbacks and
 * the steps they ran again, and the steps run. */
export interface Work { frames: number; bytes: number; messages: number; rollbacks: number; rerun: number; ran: number }
export function workOf(r: Played, what: string): Work {
  const log = arr(r.relay['log'], `${what}: relay.log (the match asks for it)`).map((x, i) => obj(x, `${what}: relay.log[${i}]`));
  const rerun = r.copies.reduce((n, c) => n + (Array.isArray(c.raw['rolled_back']) ? c.raw['rolled_back'].filter(isObject).reduce((m, b) => m + Number(b['from']) - Number(b['to']) + 1, 0) : 0), 0);
  return {
    frames: log.length, bytes: log.reduce((n, row) => n + str(row['bytes'], `${what}: relay.log[].bytes`).length / 2, 0), messages: log.reduce((n, row) => n + Number(row['count']), 0),
    rollbacks: r.copies.reduce((n, c) => n + c.rollbacks, 0), rerun, ran: r.copies.reduce((n, c) => n + c.ran, 0),
  };
}
/** Runs `part`, and adds what it throws to `f` instead of ending the test, so one test reports every part it holds; a
 * BLOCKED or INCONCLUSIVE part still ends it so, never as a plain failure. */
export async function attempt(f: string[], what: string, part: () => Promise<void> | void): Promise<void> {
  try { await part(); } catch (e) {
    const m = (e as Error).message;
    if (/^(BLOCKED|INCONCLUSIVE)/.test(m)) throw e;
    f.push(`${what}: ${m.split('\n').slice(0, 6).join(' ')}`);
  }
}
/** The waits a copy reports for `player`, each with its length in seconds (an open one as Infinity). */
export function waitsFor(c: Copy, player: number): { step: number; seconds: number }[] {
  return c.waits.filter((w) => w.player === player).map((w) => ({ step: w.step, seconds: w.to === null ? Infinity : w.to - w.from }));
}

// ---------------------------------------------------------------------------------------------------
// The `logic` call (#539's, #548's `track`): the piece's logic items stepped on a recorded track, each step's row, and
// logic.determinism with `compare: "web"` on the web player's run (README: logic.determinism on the web copy's run).

export interface LogicAsk { piece: Piece; track: JsonValue[]; steps: number; web?: JsonValue; atTimes?: number[] }
export async function logicCall(bin: string, evidence: string, what: string, ask: LogicAsk): Promise<JsonObject> {
  putEvidence(evidence, ask.piece.program.bytes);
  const doc = String(ask.piece.doc['id']);
  const s = new Script();
  s.present(doc, ask.piece.doc);
  const call: JsonObject = { call: 'logic', doc, steps: ask.steps, track: ask.track };
  if (ask.web !== undefined) Object.assign(call, { check: 'logic.determinism', compare: 'web', web: ask.web, at_times: ask.atTimes ?? [] });
  const l = s.add(call);
  const r = await runShow(bin, world(evidence, [doc], s.calls), what);
  presented(r[0], `${what}: the piece`);
  const reply = obj(r[l], `${what}: the logic call`);
  expect(reply['code'], `${what}: the logic call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  return reply;
}
/** A check's report in a reply: its kind, verdict and failures. */
export interface Check { kind: string; verdict: string; failures: JsonObject[]; raw: JsonObject }
export function checkOf(reply: JsonObject, what: string): Check {
  const c = obj(reply['check'], `${what}: check`);
  return { kind: str(c['kind'], `${what}: check.kind`), verdict: str(c['verdict'], `${what}: check.verdict`), failures: arr(c['failures'], `${what}: check.failures`).filter(isObject), raw: c };
}

// ---------------------------------------------------------------------------------------------------
// Timings: the repo's perf rule (scripts/benchmark.mjs, the design's five-run rule), as #172's budgets read it.

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
export const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;
/** The 95th percentile of a list (nearest rank). */
export const p95 = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] ?? NaN; };
/** Five runs judged against a limit by the repo's judgeLimit: FAIL fails, BLOCKED is BLOCKED, anything else but PASS is
 * INCONCLUSIVE. */
export async function judgeFive(what: string, limit: number, runs: number[], loads: { start: number; end: number }[], unit: string): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((x) => x.toFixed(3)).join(', ')} ${unit} against ${limit} ${unit} on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(reading);
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status === 'BLOCKED') blocked(reading);
  if (result.status !== 'PASS') inconclusive(reading);
}
/** The one-minute load now, and the core count. */
export const load = (): number => loadavg()[0] ?? 0;
export const loadNote = (): string => `1-minute load ${load().toFixed(1)} on ${cpus().length} cores`;

// ---------------------------------------------------------------------------------------------------
// A live match (criteria 1 and 5): the shipped relay behind #549's door on 127.0.0.1 with signals dropped, so every
// frame crosses the door; `apps` copies in the app, each a `deep-show run` whose person clicks the app's Join, the
// first opening the match and writing its link; then `webs` copies in headless Chrome's web player, each in a browser
// of its own (a page in a window no other tab covers, so it stays visible until the test hides it), joined through the
// link by a person's click. Players are numbered in the order the relay seated them: the app copies first.

export interface LiveAsk {
  builds: Builds; certs: () => Certs; temp: () => string; closing: (f: () => Promise<void> | void) => void;
  /** The piece, its net item's relay left for this helper to set to the door. */
  piece: (relay: string) => Piece;
  apps: number; webs: number;
  /** The app copies' `play_match` steps, and their scripts by player. */
  steps: number; plays: Plays;
  /** The web bundle's export scenario's planted name. */
  planted?: Planted;
  what: string;
}
export interface Live { door: Door; piece: Piece; apps: Promise<LiveCopy>[]; tabs: Map<number, Tab>; started: number }

/** The web export (#172's `export` with `video.codec: web`), its scenario's `planted` given. */
async function exportWeb(bin: string, evidence: string, document: JsonObject, out: string, what: string, planted?: Planted): Promise<void> {
  const doc = String(document['id']);
  const s = new Script();
  s.present(doc, document);
  const e = s.add({ call: 'export', doc, out, video: { codec: 'web' } });
  const r = await runShow(bin, world(evidence, [doc], s.calls, planted), what);
  presented(r[0], `${what}: the piece`);
  expect(r[e]!['outcome'], `${what}: the web export delivers the bundle: ${show(r[e], 2000)}`).toBe('exported');
}
async function joins(door: Door, n: number, what: string): Promise<void> {
  const until = Date.now() + LIVE_MS;
  while (joinedMatches(door).length < n) {
    if (Date.now() > until) gaveUp(`${what}: only ${joinedMatches(door).length} of ${n} copies joined within ${LIVE_MS / 60_000} minutes`);
    await sleep(100);
  }
}
export async function liveMatch(o: LiveAsk): Promise<Live> {
  const relay = await startRelay(o.builds.relay(), o.certs());
  o.closing(() => relay.stop());
  const door = await startDoor(relay.host, o.certs(), { signals: false });
  o.closing(() => door.close());
  const piece = o.piece(door.url);
  const linkFile = join(o.temp(), 'link');
  const bundleStore = o.temp();
  putEvidence(bundleStore, piece.program.bytes);
  const out = join(o.temp(), 'bundle');
  if (o.webs > 0) await exportWeb(o.builds.show(), bundleStore, piece.doc, out, `${o.what}: the web bundle`, o.planted);
  const apps: Promise<LiveCopy>[] = [];
  const store = (): string => { const s = o.temp(); putEvidence(s, piece.program.bytes); return s; };
  const first = liveCopy(o.builds.show(), { evidence: store(), document: piece.doc, steps: o.steps, plays: o.plays['1'] ?? [], relayCa: o.certs().ca, linkTo: linkFile }, `${o.what}: the app's copy 1`);
  first.catch(() => undefined);
  apps.push(first);
  const link = await linkFrom(linkFile, `${o.what}: the app's copy 1`, first);
  await joins(door, 1, o.what);
  for (let p = 2; p <= o.apps; p++) {
    const c = liveCopy(o.builds.show(), { evidence: store(), document: piece.doc, steps: o.steps, plays: o.plays[String(p)] ?? [], relayCa: o.certs().ca, link }, `${o.what}: the app's copy ${p}`);
    c.catch(() => undefined);
    apps.push(c);
    await joins(door, p, o.what);
  }
  const tabs = new Map<number, Tab>();
  if (o.webs > 0) {
    const served = await serve(out);
    o.closing(() => served.stop());
    for (let w = 1; w <= o.webs; w++) {
      const chrome = await Chrome.open([pinOf(o.certs().cert)]);
      o.closing(() => chrome.close());
      const tab = await chrome.open(`${served.origin}/index.html${fragmentOf(link, null, `${o.what}: the app's link`)}`);
      await tab.mustBeReady(`${o.what}: web copy ${w}`);
      const prompt = await tab.prompt();
      expect(prompt?.button, `${o.what}: web copy ${w} draws the player's own Join prompt with a button: ${JSON.stringify(prompt)}`).toBeTruthy();
      await tab.click(prompt!.button!.x + prompt!.button!.w / 2, prompt!.button!.y + prompt!.button!.h / 2);
      await joins(door, o.apps + w, o.what);
      tabs.set(o.apps + w, tab);
    }
  }
  return { door, piece, apps, tabs, started: Date.now() };
}
/** probe().match of a web copy, or null (a crashed page answers nothing). */
export async function webMatch(tab: Tab): Promise<JsonObject | null> {
  return tab.match().catch(() => null);
}
const ended = (m: JsonObject | null): boolean => m !== null && m['end'] !== null && m['end'] !== undefined;
/** A web copy's probe().match once it has run match step `step` or its match has ended, whichever comes first. */
export async function webUntil(tab: Tab, step: number, what: string): Promise<JsonObject> {
  const until = Date.now() + LIVE_MS;
  for (;;) {
    const m = await webMatch(tab);
    if (m && ((typeof m['ran'] === 'number' && m['ran'] >= step) || ended(m))) return m;
    if (Date.now() > until) gaveUp(`${what}: the web copy neither reached match step ${step} nor ended: ${show(m, 400)}`);
    await sleep(100);
  }
}
/** Waits until a web copy reports `n` catch-ups (or its match ended), and returns its probe().match then. */
export async function webCaughtUp(tab: Tab, n: number, what: string): Promise<JsonObject> {
  const until = Date.now() + LIVE_MS;
  for (;;) {
    const m = await webMatch(tab);
    if (m && ((Array.isArray(m['catch_ups']) && m['catch_ups'].length >= n) || ended(m))) return m;
    if (Date.now() > until) gaveUp(`${what}: the web copy reported no catch-up ${n} after it was shown again: ${show(m, 400)}`);
    await sleep(50);
  }
}
/** The web copy's golden (README: `golden`): its step hashes by logic item, step k at index k, null where it never ran
 * step k. */
export function goldenOf(m: JsonObject, item: string, what: string): (string | null)[] {
  const g = obj(m['golden'], `${what}: probe().match.golden (the copy's own golden of the steps it ran: {step_hashes: {<item>: [hash | null]}}); probe().match holds ${Object.keys(m).join(', ')}`);
  return arr(obj(g['step_hashes'], `${what}: golden.step_hashes`)[item], `${what}: golden.step_hashes.${item}`).map((h) => (typeof h === 'string' ? h : null));
}
/** Waits until a web copy has run match step `step` (probe().match.ran), giving up after LIVE_MS. */
export async function webReaches(tab: Tab, step: number, what: string): Promise<JsonObject> {
  const until = Date.now() + LIVE_MS;
  for (;;) {
    const m = await webMatch(tab);
    if (m && typeof m['ran'] === 'number' && m['ran'] >= step) return m;
    if (m && m['end'] !== null && m['end'] !== undefined) throw Error(`${what}: the web copy's match ended (${String(m['end'])}) at step ${String(m['ran'])}, before step ${step}: ${show(m['ended'] ?? null)}`);
    if (Date.now() > until) gaveUp(`${what}: the web copy didn't reach match step ${step}: ${show(m, 400)}`);
    await sleep(50);
  }
}
/** A person pressing `aim`'s keys on a web copy, one every 0.3 s in a seeded order, while `go()` holds. */
export function pressKeys(tab: Tab, seed: number, go: () => boolean): Promise<void> {
  const keys = Object.keys(AIM_KEYS);
  const draw = rng(seed);
  return (async () => {
    while (go()) {
      const key = keys[Math.floor(draw() * keys.length)]!;
      const code = `Digit${key}`;
      try {
        await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: 48 + Number(key) }, 5_000);
        await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: 48 + Number(key) }, 5_000);
      } catch { return; }
      await sleep(300);
    }
  })();
}
/** Hides a web copy's page as a person does who minimizes its window, or shows it again, and waits until the page's
 * `document.visibilityState` says so; a browser that can't hide a page headless is BLOCKED. */
export async function setHidden(tab: Tab, hidden: boolean, what: string): Promise<void> {
  const w = await tab.send('Browser.getWindowForTarget', {});
  await tab.send('Browser.setWindowBounds', { windowId: w['windowId'], bounds: { windowState: hidden ? 'minimized' : 'normal' } });
  const want = hidden ? 'hidden' : 'visible';
  const until = Date.now() + 10_000;
  let state = '';
  while (Date.now() < until && state !== want) { state = await tab.evaluate<string>('document.visibilityState').catch(() => ''); if (state !== want) await sleep(50); }
  if (state !== want) blocked(`${what}: headless Chrome left the page ${state || 'unreadable'} after its window was ${hidden ? 'minimized' : 'restored'}, so it can't be ${hidden ? 'hidden' : 'shown'} here. Unblock: run where Chrome's headless windows hide their pages`);
}
/** The highest match step any frame `player`'s copy sent through the door carries a message for: the copy found by the
 * relay's `joined` answer on its connection (relay@1 numbers players from 0). */
export function lastSentThrough(door: Door, player: number, what: string): number {
  const conn = door.connections.find((c) => c.received.some((m) => isObject(m.json?.['joined']) && m.json['joined']['player'] === player - 1));
  expect(conn, `${what}: the door saw the relay seat player ${player}`).toBeDefined();
  const steps = conn!.sent.filter((m) => m.kind === 'binary').map((m) => readFrame(m.bytes, `${what}: a frame of player ${player}`)).filter((f) => f.count > 0).map((f) => f.first + f.count - 1);
  expect(steps.length, `${what}: player ${player}'s copy sent frames through the door`).toBeGreaterThan(0);
  return Math.max(...steps);
}
/** An app copy's `play_match` report. */
export async function appCopy(copy: Promise<LiveCopy>, what: string): Promise<Copy> {
  const c = await copy;
  return playedOf(c.reply, what);
}
export const webCopy = (m: JsonObject | null, what: string): Copy => copyOf(m ?? undefined, `${what} (probe().match)`);
