// Test-side tools for the #280 acceptance tests (README: The surface under test). They reuse #549's, #550's and #551's
// suites for what those already drive (building `deep-show` per feature set, `deep-show run` without blocking this
// process, `match`, a copy's report with its rollbacks and record, a check's report, net.budget's five runs and the
// reference Macs, deep_kinds' pages, the merge base built apart) and add what #280's criteria read: net.budget's
// `windows` report per host and its failures by host, the net.feel check kind run through `match` with its readings
// per copy, a claim's verdict on net.feel, and the working agent's patch to a document's own checks. Nothing here
// stands in for the net module, a check, the relay or the piece: every reading, window, rollback, track and report a
// test reads is the implementation's own, and every expected value comes from the issue, the design and fixtures.ts.

import { existsSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { expect } from 'vitest';
import {
  CHROME, FULL, LIVE_MS, Script, TIMEOUT, arr, blocked, failsNaming, isObject, none, num, obj, presented, putEvidence, runShow, show, str, useBuilds, useChildren, useTemp,
} from '../549/helpers.ts';
import { budgetFailures, budgetOf, checkOf, copiesOf, inconclusive, referenceMacProblem, type Check, type Copy551 } from '../551/helpers.ts';
import { CORE, baseBuild, kindsEntries } from '../550/helpers.ts';
import { SEATS, fieldProgram, type Feel, type JsonObject, type JsonValue, type Planted, type Plays } from './fixtures.ts';

export { CORE, FULL, LIVE_MS, TIMEOUT, baseBuild, blocked, budgetFailures, budgetOf, failsNaming, inconclusive, isObject, kindsEntries, none, num, obj, referenceMacProblem, show, str, useBuilds, useChildren, useTemp };
export type { Check, Copy551, JsonObject };

/** Each criterion's ID: `#280.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #280.5334836f',
  2: 'AC2 #280.c693445e',
  3: 'AC3 #280.f6f631ae',
  4: 'AC4 #280.3cddbab4',
  5: 'AC5 #280.b13fcc01',
  6: 'AC6 #280.456285f7',
  7: 'AC7 #280.9c96115f',
  8: 'AC8 #280.60cc3f22',
  9: 'AC9 #280.4335448f',
} as const;

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393): #550's world (one agent's session, the process table with your shell's peer pid 3002, the
// documents on panels `main`, `side-1`, …, #383's clock), with this suite's planted names, net.budget's Chrome
// (README: `chrome`) and #403's claims.

const AGENT = { id: 'sess-280', thread: 'thread-280', name: 'Test agent: net fit and feel', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 },
];
export const SESSION = AGENT.id;
/** `seeds`: documents the store holds and the hub opens at revision 0 (#1958's scenario `docs.<id>.document`). */
export interface World { planted?: Planted | undefined; chrome?: string; claims?: JsonObject; seeds?: Record<string, JsonObject> }
export function scenario(evidence: string, docs: string[], calls: JsonObject[], o: World = {}): JsonObject {
  const panels: JsonObject = {};
  const byId: JsonObject = {};
  docs.forEach((d, k) => {
    const panel = k === 0 ? 'main' : `side-${k}`;
    panels[panel] = { rect: k === 0 ? [0, 0, 640, 360] : [0, 720, 640, 360] };
    byId[d] = { panel, ...(o.seeds?.[d] ? { document: o.seeds[d] } : {}) };
  });
  if (!docs.length) panels['main'] = { rect: [0, 0, 640, 360] };
  return {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels, docs: byId, clock: { refresh_hz: 60, lead: 0, check: 0 },
    ...(o.planted ? { planted: o.planted } : {}), ...(o.chrome ? { chrome: o.chrome } : {}), ...(o.claims ? { claims: o.claims } : {}), calls,
  };
}
/** The program the fixture's logic runs, in the evidence store by its bytes' hash. */
export function putProgram(evidence: string): void { putEvidence(evidence, fieldProgram().bytes); }

/** A reading taken on the wall clock counts only on a reference Mac at a 1-minute load below its cores (the five-run
 * rule's machines: docs/parallel-proof.md §12a); elsewhere the test reads INCONCLUSIVE, never a pass. */
export function timingProblem(): string | null {
  const off = referenceMacProblem();
  if (off) return off;
  const load = loadavg()[0] ?? 0;
  return load >= cpus().length ? `a 1-minute load of ${load.toFixed(1)} on ${cpus().length} cores` : null;
}

// ---------------------------------------------------------------------------------------------------
// net.feel through `match` (README: `match` with net.feel): `check: "net.feel"` and `feel`, net.feel's check input but
// `steps`, which is the match's own. The relay's members (#549's `relay.seed`, and `relay.late`) add to the profile.

/** `late`: README: `relay.late`, `[{player, to, steps}]`: each of `player`'s messages, for step k, reaches copy `to` once
 * that copy has run step k + `steps`, and not before. */
export interface RelayAsk { seed: number; late?: JsonObject[] }
export interface FeelAsk { document: JsonObject; steps: number; plays: Plays; feel: Feel; relay?: RelayAsk; planted?: Planted }
export const feelCall = (doc: string, a: FeelAsk): JsonObject => ({
  call: 'match', doc, steps: a.steps, plays: a.plays as unknown as JsonObject, ...(a.relay ? { relay: a.relay as unknown as JsonObject } : {}),
  check: 'net.feel', feel: a.feel as unknown as JsonObject,
});

/** One copy's readings (the Fields line): `{stall_ms_per_min, depth: {p50, p99}, correction: {p50, p99}}`. */
export interface Reading { copy: number; stall: number; depth: { p50: number; p99: number }; correction: { p50: number; p99: number }; raw: JsonObject }
export interface FeelReport { verdict: string; failures: JsonObject[]; readings: Reading[]; raw: JsonObject }
const pair = (v: JsonValue | undefined, what: string): { p50: number; p99: number } => {
  const o = obj(v, what);
  return { p50: num(o['p50'], `${what}.p50`), p99: num(o['p99'], `${what}.p99`) };
};
/** net.feel's report (README: net.feel's report): its verdict, its failures, and one reading per copy, in copy order. */
export function feelOf(c: Check, players: number, what: string): FeelReport {
  expect(c.kind, `${what}: the check is net.feel`).toBe('net.feel');
  const readings = arr(c.raw['readings'], `${what}: check.readings (net.feel's readings, one per copy)`).map((x, i) => {
    const r = obj(x, `${what}: readings[${i}]`);
    return {
      copy: num(r['copy'], `${what}: readings[${i}].copy`), stall: num(r['stall_ms_per_min'], `${what}: readings[${i}].stall_ms_per_min`),
      depth: pair(r['depth'], `${what}: readings[${i}].depth`), correction: pair(r['correction'], `${what}: readings[${i}].correction`), raw: r,
    };
  }).sort((a, b) => a.copy - b.copy);
  expect(readings.map((r) => r.copy), `${what}: one reading a copy, 1 to ${players}`).toEqual(Array.from({ length: players }, (_, i) => i + 1));
  return { verdict: c.verdict, failures: c.failures, readings, raw: c.raw };
}
export interface Felt { copies: Copy551[]; report: FeelReport; reply: JsonObject }
/** The fixture shown from your shell, then one net.feel over it, in one `deep-show run`. */
export async function playFeel(bin: string, evidence: string, what: string, a: FeelAsk): Promise<Felt> {
  putProgram(evidence);
  const doc = String(a.document['id']);
  const s = new Script();
  s.present(doc, a.document);
  const m = s.add(feelCall(doc, a));
  const r = await runShow(bin, scenario(evidence, [doc], s.calls, { planted: a.planted }), what);
  presented(r[0], `${what}: the eight-seat fixture`);
  const players = a.feel.players ?? SEATS;
  return { copies: copiesOf(r[m], players, what), report: feelOf(checkOf(r[m], what), players, what), reply: r[m]! };
}
/** A reading by copy. */
export const readingOf = (f: FeelReport, copy: number): Reading => f.readings.find((r) => r.copy === copy)!;
/** The readings as canonical JSON: keys sorted, so two runs compare byte for byte. */
export function canonical(v: JsonValue): string {
  const canon = (x: JsonValue): JsonValue => (Array.isArray(x) ? x.map(canon) : isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k]!)])) : x);
  return JSON.stringify(canon(v));
}
/** Two runs' readings, byte for byte: the first reading that differs is named, `copy <n>'s <reading>`. */
export function sameReadings(a: FeelReport, b: FeelReport, what: string): string[] {
  const flat = (f: FeelReport): Map<string, JsonValue> => {
    const out = new Map<string, JsonValue>();
    for (const r of f.readings) {
      const walk = (v: JsonValue, path: string): void => { if (isObject(v)) for (const k of Object.keys(v).sort()) walk(v[k]!, path ? `${path}.${k}` : k); else out.set(`copy ${r.copy}'s ${path}`, v); };
      walk(r.raw, '');
    }
    return out;
  };
  const [x, y] = [flat(a), flat(b)];
  for (const k of new Set([...x.keys(), ...y.keys()])) {
    if (canonical(x.get(k) ?? null) !== canonical(y.get(k) ?? null)) return [`${what}: the two runs' readings differ at ${k}: ${show(x.get(k) ?? null)} and ${show(y.get(k) ?? null)}`];
  }
  if (canonical(a.raw['readings'] ?? null) !== canonical(b.raw['readings'] ?? null)) return [`${what}: the two runs' readings aren't byte-equal`];
  return [];
}

// ---------------------------------------------------------------------------------------------------
// net.budget's report (README: net.budget's report): #551's, with `windows: {host → window}`, `lockstep` (the hosts where
// only lockstep fits), and each failure's `host`; with `on` naming web, its web part runs in the web player in headless
// Chrome when the scenario names Chrome (`chrome`).

export type Host = 'app' | 'web';
export interface BudgetAsk { document: JsonObject; steps: number; plays: Plays; on: Host[]; planted?: Planted; programs?: Buffer[] }
export interface Budgeted { check: Check; windows: Partial<Record<Host, number>>; raw: JsonObject }
/** Chrome for net.budget's web part; BLOCKED, never a pass, where this machine has none. */
export function chrome(): string {
  if (!existsSync(CHROME)) blocked(`Google Chrome isn't at ${CHROME} (set CHROME_BIN): net.budget's web part plays in the web player in headless Chrome`);
  return CHROME;
}
/** The piece shown from your shell, then `match` with net.budget on `on`, in one `deep-show run`. */
export async function budgetRun(bin: string, evidence: string, what: string, a: BudgetAsk): Promise<Budgeted> {
  for (const p of a.programs ?? [fieldProgram().bytes]) putEvidence(evidence, p);
  const doc = String(a.document['id']);
  const s = new Script();
  s.present(doc, a.document);
  const m = s.add({ call: 'match', doc, steps: a.steps, plays: a.plays as unknown as JsonObject, check: 'net.budget', on: a.on });
  const r = await runShow(bin, scenario(evidence, [doc], s.calls, { planted: a.planted, ...(a.on.includes('web') ? { chrome: chrome() } : {}) }), what);
  presented(r[0], `${what}: the piece`);
  const check = checkOf(r[m], what);
  expect(check.kind, `${what}: the check is net.budget`).toBe('net.budget');
  const w = isObject(check.raw['windows']) ? check.raw['windows'] : {};
  const windows: Partial<Record<Host, number>> = {};
  for (const h of ['app', 'web'] as const) if (typeof w[h] === 'number') windows[h] = w[h] as number;
  return { check, windows, raw: check.raw };
}
/** The window net.budget reports for `host`: a whole number from 0 to 16. */
export function windowOf(b: Budgeted, host: Host, what: string): number {
  const w = b.windows[host];
  expect(w, `${what}: net.budget reports a window for ${host} (windows: {host → window}); its report: ${show(b.raw, 1500)}`).toBeDefined();
  expect(Number.isInteger(w) && w! >= 0 && w! <= 16, `${what}: ${host}'s window ${w} is a whole number from 0 to 16`).toBe(true);
  return w!;
}
/** The canvas module that costs most in net.budget's worst frame (#551's `worst.modules`), or null where it names none. */
export function costliest(b: Budgeted): string | null {
  const worst = isObject(b.raw['worst']) ? b.raw['worst'] : null;
  const modules = worst && isObject(worst['modules']) ? Object.entries(worst['modules']).filter((e): e is [string, number] => typeof e[1] === 'number') : [];
  return modules.sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}
/** A failure of net.budget that names `host`, and (`module`) the canvas module that costs most. */
export function namesHost(b: Budgeted, host: Host, what: string, o: { module?: boolean } = {}): string[] {
  const named = b.check.failures.filter((f) => f['host'] === host);
  if (!named.length) return [`${what}: no failure of net.budget names host ${host}: ${show(b.check.failures, 900)}`];
  if (!o.module) return [];
  const most = costliest(b);
  if (!named.some((f) => typeof f['module'] === 'string' && f['module'] !== '' && (most === null || f['module'] === most))) {
    return [`${what}: no failure naming host ${host} names the canvas module that costs most${most ? ` (${most}, by the report's worst frame)` : ''}: ${show(named, 900)}`];
  }
  return [];
}
/** A timing verdict on `host` that must be `want`. A pass on app is #551's five-run judgement of net.budget's own runs;
 * on web, net.budget's verdict. A failure is net.budget's verdict, which may be its window rule's (a declared window
 * past the report's) as well as its frame time's. INCONCLUSIVE (never a pass) off a reference Mac, or where the check
 * doesn't decide. */
export function hostVerdict(b: Budgeted, host: Host, want: 'PASS' | 'FAIL', what: string): string[] {
  if (host === 'app' && want === 'PASS') return budgetFailures(budgetOf(b.check, what), want, what);
  const off = referenceMacProblem();
  if (off) inconclusive(`${what}: a timing budget counts only on a reference Mac (${off})`);
  if (b.check.verdict === 'INCONCLUSIVE') inconclusive(`${what}: net.budget on ${host} doesn't decide (${show(b.raw, 600)}; 1-minute load ${(loadavg()[0] ?? 0).toFixed(1)} on ${cpus().length} cores)`);
  return b.check.verdict === want ? [] : [`${what}: net.budget on ${host} reads ${b.check.verdict}, not ${want}: ${show(b.raw, 900)}`];
}

// ---------------------------------------------------------------------------------------------------
// A claim's verdict, deep_run's check kinds (#550's and #1939's suites: `{call: "verdict", claim}`).

export const CLAIM = 'claim:01JB280C000000000000000001';
export const REQUIREMENT = 'req:01JB280Q000000000000000001';
/** One claim of the agent's on `doc`, its one requirement `check`, judged by `verdict` after the agent's deep_show. */
export async function verdictRow(bin: string, evidence: string, document: JsonObject, check: JsonObject, what: string): Promise<JsonObject> {
  putProgram(evidence);
  const doc = String(document['id']);
  const claims: JsonObject = { [CLAIM]: { session: SESSION, deliverables: [doc], requirements: [{ id: REQUIREMENT, check }] } };
  const s = new Script();
  const shown = s.add({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
  const v = s.add({ call: 'verdict', claim: CLAIM });
  const r = await runShow(bin, scenario(evidence, [doc], s.calls, { claims }), what);
  const issues = Array.isArray(r[shown]?.['issues']) ? (r[shown]!['issues'] as JsonValue[]).filter(isObject).filter((i) => i['severity'] === 'error') : [];
  expect(issues, `${what}: deep_show presents the eight-seat fixture with no error: ${show(r[shown], 1500)}`).toEqual([]);
  const row = arr(obj(r[v], `${what}: the verdict`)['requirements'], `${what}: the verdict's requirements`).filter(isObject).find((x) => x['id'] === REQUIREMENT);
  expect(row, `${what}: the verdict has a row for the requirement: ${show(r[v], 1500)}`).toBeDefined();
  return row!;
}

export { Script, runShow, presented };
