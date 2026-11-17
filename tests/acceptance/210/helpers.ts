// Test-side tools for the #210 acceptance tests (README: The surface under test). They drive two binaries the base
// already has, through the calls the README names: `deep-show run`, the hub's canvas side, which plays a piece live
// in a panel, holds its ports and draws the app's Connect prompt, with a plug-in installed by its recorded port (#401's
// install); and `deep-logic`, the logic module's sessions and bakes, where a source's values arrive (#533's append).
// Builds, scenarios and JSON rules are reused by import from #533's, #498's, #169's, #172's and #1636's suites (read
// only). Nothing here stands in for a port, the gate, the read region or the export: every message, state, entry, row,
// step record, issue and refusal read here is the implementation's own; the expected values come from the issue's text
// and this suite's fixtures.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect } from 'vitest';
import {
  CLOCK, MS, SEC, SLOTS, WINDOW, ALPHA, click as clickIn, play as pressPlay, secs, serialOf,
  type Rect,
} from '../498/gate/helpers.ts';
import {
  FLICKS, REPO, arr, blocked, failsNaming, filesUnder, inconclusive, int, isObject, mentions, none, obj, present, presented, putEvidence, runShow,
  sha256, show, str, useTemp, type JsonObject, type JsonValue,
} from '../172/helpers.ts';
import {
  STEP_60, bakeCall, checkCall, deepShow, firstDiff, logicBin, onLogic, prebuild, replies, start, stepped, stepsOf,
  type Layout, type Program, type StepRecord,
} from '../533/helpers.ts';
import { hitsProgram, layoutProbe } from './programs.ts';

export { GAUGE_WRITES, TILT_WRITES, gaugeProgram, tiltProgram } from './programs.ts';

export {
  FLICKS, MS, REPO, SEC, arr, bakeCall, blocked, deepShow, failsNaming, filesUnder, firstDiff, inconclusive, int, isObject, logicBin, mentions, none, obj,
  onLogic, prebuild, presented, secs, sha256, show, stepped, stepsOf, str, useTemp,
};
export type { JsonObject, JsonValue, Layout, Program, StepRecord };

/** Each criterion's ID: `#210.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: '#210.6dc8d5b9', 2: '#210.6f3c36ec', 3: '#210.da5965d7', 4: '#210.2cf346a3', 5: '#210.92486e89',
  6: '#210.e496d38b', 7: '#210.ca29345d', 8: '#210.91594eec', 9: '#210.e8c7cf01',
} as const;

/** Every test passes this: a cold `deep-show` build takes the better part of an hour on a loaded machine. */
export const TIMEOUT = 7_200_000;
/** One 60 Hz step: 11,760,000 flicks. */
export const STEP = STEP_60;
/** One audio block, 128 samples on the device gate's 48 kHz clock (#498's): 1,881,600 flicks. */
export const BLOCK = (128 * FLICKS) / 48_000;

// ---------------------------------------------------------------------------------------------------
// The world: #498's clock, displays, window and slots, #533's sessions and process table, two panels

/** The piece's panel and another panel; the fixture is shown in `stage`. */
export const STAGE = 'stage';
export const OTHER = 'other';
const RECTS: Record<string, Rect> = { [STAGE]: SLOTS[0]!, [OTHER]: SLOTS[2]! };
const DISPLAYS: JsonObject[] = [
  { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' },
  { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' },
];
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];

/** The wrong programs (README: Planted programs), each chosen by a scenario's `planted`. */
export type ShowPlanted = 'port_sends_on_seek' | 'mute_leaves_port_sending' | 'gate_trusts_document_sound' | 'web_export_keeps_port';
export interface World { evidence: string; quiet?: { from: number; to: number }[]; planted?: ShowPlanted }

/** A scenario: the calls in `at` order (ties as given), the fixture on `stage`. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => Number(p.c['at']) - Number(q.c['at']) || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } }, processes: PROCESSES,
    clock: CLOCK, displays: DISPLAYS, window: WINDOW,
    panels: Object.fromEntries(Object.entries(RECTS).map(([id, rect]) => [id, { rect }])), docs: { [DOC_ID]: { panel: STAGE } },
    ...(w.quiet ? { quiet_hours: w.quiet } : {}), ...(w.planted ? { planted: w.planted } : {}), calls: sorted,
  };
}
/** One `deep-show run` of the world with these calls; each call's reply, by the call. */
export function playWorld(bin: string, w: World, calls: JsonObject[], what: string): Map<JsonObject, JsonObject> {
  const s = scenario(w, calls);
  const rs = runShow(bin, s, `${what}${w.planted ? ` (planted ${w.planted})` : ''}`);
  return new Map((s['calls'] as JsonObject[]).map((c, i) => [c, rs[i]!]));
}
/**
 * Drives one world on the virtual clock as #498's Driver does: each step adds calls later than every call so far (a
 * Connect or a Play carrying the serial an earlier step's click was given) and plays the whole world again from the
 * start. Nothing reads wall time, so each run answers the same.
 */
export class Driver {
  readonly calls: JsonObject[] = [];
  private last = new Map<JsonObject, JsonObject>();
  constructor(private readonly bin: string, private readonly world: World) {}
  step(added: JsonObject[], what: string): void {
    this.calls.push(...added);
    this.last = playWorld(this.bin, this.world, this.calls, what);
  }
  reply(c: JsonObject, what: string): JsonObject {
    const r = this.last.get(c);
    expect(r, `${what}: the run answered the call ${show(c, 200)}`).toBeDefined();
    return r!;
  }
  /** Your click in a panel (a press, its release 60 ms later): add it, play, and return its serial. */
  click(t: number, panel: string, what: string, also: JsonObject[] = []): number {
    const [down, up] = clickIn(t, panel, RECTS[panel]!) as [JsonObject, JsonObject];
    this.step([...also, down, up], what);
    return serialOf(this.reply(down, what), `${what}: your click in ${panel}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// The port fixture (README: The fixture): a drum pad whose logic item emits a `hit` row for each `notes` entry it reads

export const DOC_ID = '01JB210D000000000000000001';
export const NOTES = 'notes';
export const TEMPO = 'tempo';
export const HITS = 'hits.occurrences';
/** The test plug-ins at the far end of a port, and the hosts each one's grant names. */
export const GEAR = { id: 'test.gear', hosts: ['gear.local'] } as const;
export const LAMP = { id: 'test.lamp', hosts: ['lamp.local'] } as const;
export const GREEDY = { id: 'test.greedy', hosts: ['greedy.local'] } as const;

export interface DocPort { plugin: string; out?: string[]; in?: string[]; sound?: boolean }
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #210 acceptance tests at test time.' };
const rect = (id: string, box: [number, number, number, number], role: string, order: string): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, role: 'decoration' });

/** The drum pad (12 s, 640 × 360), its program put in `evidence`, with `ports` when given (none: no `ports` field). */
export function pieceDoc(evidence: string, ports?: Record<string, DocPort>): JsonObject {
  const program = hitsProgram();
  putEvidence(evidence, program.bytes);
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [320, 180, 0], view_width: 640 } },
    rect('back', [0, 0, 640, 360], 'ground', 'a0001'),
    rect('band', [0, 240, 640, 120], 'ink', 'a0002'),
    {
      id: 'hits', kind: 'logic@1', name: 'Hits', order: 'a0003',
      params: { program: program.sha, step_rate: 60, reads: [NOTES], writes: { n: { type: 'i32' } }, emits: { hit: { fields: { note: 'f64' }, max_per_step: 16 } } },
    },
  ];
  const portsJson: JsonObject = {};
  for (const [name, p] of Object.entries(ports ?? {})) {
    portsJson[name] = { plugin: p.plugin, ...(p.out ? { out: p.out } : {}), ...(p.in ? { in: p.in } : {}), ...(p.sound === undefined ? {} : { sound: p.sound }) };
  }
  return {
    format: 1, id: DOC_ID, profile: 'figure', title: 'Drum pad', description: 'A drum pad whose notes and hits go out through a port: the #210 acceptance fixture.',
    size: [640, 360], camera: 'cam', seed: 210, transport: { span: '12s', frame_rate: [30, 1] },
    requires: { modules: { input: '^1', logic: '^1' } },
    controls: {
      [NOTES]: { kind: 'slider', class: 'document', label: 'Note', role: 'slider', range: [0, 127], default: 60, increment: 1 },
      [TEMPO]: { kind: 'slider', class: 'document', label: 'Tempo', role: 'slider', range: [40, 240], default: 120, increment: 1 },
    },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    assets: { hits_program: { sha256: program.sha, license: LICENSE } },
    ...(ports ? { ports: portsJson } : {}),
  };
}
/** The fixture's one port to the synthesizer: its notes control and its hits list out. */
export const SYNTH_OUT = [NOTES, HITS];

// ---------------------------------------------------------------------------------------------------
// Calls (README: The surface under test). Every one carries `at` (flicks on the virtual clock).

/** What `deep.registerPort(name, port)` declares, as the plug-in's install carries it. */
export interface PluginPort { entries: string[]; rows: string[]; sources: string[]; sound: boolean }
export const install = (t: number, plugin: { id: string; hosts: readonly string[] }, ports: Record<string, PluginPort>): JsonObject => ({
  call: 'install', at: t, plugin: plugin.id,
  manifest: { panels: {}, grant: { hosts: [...plugin.hosts] }, ports: Object.fromEntries(Object.entries(ports).map(([n, p]) => [n, { entries: p.entries, rows: p.rows, sources: p.sources, sound: p.sound }])) },
});
/** `deep show` of the fixture from your shell (#169's `present`), on `stage`. */
export const showPiece = (t: number, document: JsonObject): JsonObject => present(DOC_ID, document, { at: t });
/** Your press of Play in the piece's panel, carrying the serial of your click there (#498's `play`). */
export const playPiece = (t: number, serial: number): JsonObject => pressPlay(t, STAGE, { serial });
export type Asker = 'tour' | 'logic' | 'agent' | 'bridge' | 'replica';
export const connect = (t: number, port: string, who: { serial: number } | { by: Asker }): JsonObject => ({ call: 'connect', at: t, panel: STAGE, port, ...who });
export const portCall = (t: number, port: string): JsonObject => ({ call: 'port', at: t, panel: STAGE, port });
/** Your input of a note on the `notes` slider of the playing piece (#504's control event). */
export const note = (t: number, value: number): JsonObject => ({ call: 'input', at: t, panel: STAGE, event: { type: 'control', control: NOTES, value } });
export const seek = (t: number, to: number): JsonObject => ({ call: 'seek', at: t, panel: STAGE, to });
export const mute = (t: number, owner: string): JsonObject => ({ call: 'mute', at: t, owner });
export const inputTrack = (t: number): JsonObject => ({ call: 'input_track', at: t, panel: STAGE });
export const occurrences = (t: number): JsonObject => ({ call: 'occurrences', at: t, panel: STAGE });
export const transport = (from: number, to: number): JsonObject => ({ call: 'transport', at: to, panel: STAGE, from, to });

// ---------------------------------------------------------------------------------------------------
// Replies

export const STATES = ['closed', 'open', 'stopped'] as const;
export interface Received { at: number; message: JsonObject; delay_ns: number | null }
export interface PortView { name: string; state: string; prompt: JsonObject | null; received: Received[] }
/** A `port` reply, or an accepted `connect`'s: `{port: {name, state, prompt, received}}`. A missing field fails, naming it. */
export function portOf(reply: JsonObject | undefined, what: string): PortView {
  const p = obj(obj(reply, what)['port'], `${what}: port (got ${show(reply, 600)})`);
  const state = str(p['state'], `${what}: port.state`);
  expect(STATES as readonly string[], `${what}: port.state is closed, open or stopped`).toContain(state);
  expect('prompt' in p, `${what}: port.prompt is present (null or the prompt)`).toBe(true);
  const prompt = p['prompt'] === null ? null : obj(p['prompt'], `${what}: port.prompt`);
  const received = arr(p['received'], `${what}: port.received`).map((v, i) => {
    const r = obj(v, `${what}: port.received[${i}]`);
    return { at: int(r['at'], `${what}: port.received[${i}].at`), message: obj(r['message'], `${what}: port.received[${i}].message`), delay_ns: 'delay_ns' in r ? int(r['delay_ns'], `${what}: port.received[${i}].delay_ns`) : null };
  });
  return { name: str(p['name'], `${what}: port.name`), state, prompt, received };
}
/** A refusal: a string `code` and no port. */
export function refusalOf(reply: JsonObject | undefined, what: string): JsonObject {
  const r = obj(reply, what);
  expect(typeof r['code'], `${what} is refused with a code, got ${show(r, 600)}`).toBe('string');
  expect('port' in r && isObject(r['port']), `${what}: a refusal opens nothing (no port object)`).toBe(false);
  return r;
}

/** An Out message as the plug-in received it (Port: `{port, step, t, entries | rows}`). */
export interface Out { at: number; step: number; t: number; entries: JsonObject[]; rows: JsonObject[]; message: JsonObject; delay_ns: number | null }
export function outsOf(p: PortView, what: string): Out[] {
  return p.received.filter((r) => 'step' in r.message).map((r, i) => {
    const m = r.message;
    const list = (k: string): JsonObject[] => (k in m ? arr(m[k], `${what}: Out ${i}.${k}`).map((x, j) => obj(x, `${what}: Out ${i}.${k}[${j}]`)) : []);
    return { at: r.at, step: int(m['step'], `${what}: Out ${i}.step`), t: int(m['t'], `${what}: Out ${i}.t`), entries: list('entries'), rows: list('rows'), message: m, delay_ns: r.delay_ns };
  });
}
/** When the plug-in was told its port stopped (`{port, state: "stopped"}`). */
export const stopsOf = (p: PortView): number[] => p.received.filter((r) => !('step' in r.message) && r.message['state'] === 'stopped').map((r) => r.at);

/** A JSON value with its object keys sorted, as text: what two values must share to be the same. */
export const canon = (v: JsonValue | undefined): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]` : isObject(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null);
export const hashOf = (v: JsonValue): string => sha256(canon(v));

// ---------------------------------------------------------------------------------------------------
// Judgements, each failure a sentence naming what failed

const OUT_FIELDS = ['port', 'step', 't', 'entries', 'rows'];
/** Each Out holds only the issue's fields, names its port, carries the step's time and only that step's entries and rows. */
export function outShapeFailures(outs: Out[], port: string, control: string): string[] {
  const f: string[] = [];
  for (const o of outs) {
    const extra = Object.keys(o.message).filter((k) => !OUT_FIELDS.includes(k));
    if (extra.length) f.push(`${port}'s Out of step ${o.step} carries ${extra.join(', ')}: an Out holds only ${OUT_FIELDS.join(', ')}`);
    if (o.message['port'] !== port) f.push(`an Out of step ${o.step} names the port ${show(o.message['port'])}, not ${port}`);
    if (o.t !== o.step * STEP) f.push(`${port}'s Out of step ${o.step} has t ${o.t}, not the step's flick ${o.step * STEP}`);
    if (!o.entries.length && !o.rows.length) f.push(`${port}'s Out of step ${o.step} carries no entry and no row`);
    for (const e of o.entries) {
      const t = Number(e['t']);
      if (e['control'] !== control) f.push(`${port}'s Out of step ${o.step} carries an entry of ${show(e['control'])}, which the port doesn't list`);
      if (!(t > (o.step - 1) * STEP && t <= o.step * STEP)) f.push(`${port}'s Out of step ${o.step} carries the entry stamped ${t}, which step ${o.step} doesn't read`);
    }
    for (const r of o.rows) if (r['step'] !== o.step) f.push(`${port}'s Out of step ${o.step} carries a row of step ${show(r['step'])}`);
  }
  return f;
}
/** Each step's entries and rows go out once, in step order: in the order the plug-in received them, every Out's step
 * is past the last step already sent with entries (or rows). The first failure names the first step sent again. */
export function orderFailures(outs: Out[], port: string): string[] {
  const f: string[] = [];
  const last = { entries: -1, rows: -1 };
  for (const o of outs) {
    for (const kind of ['entries', 'rows'] as const) {
      if (!o[kind].length) continue;
      if (o.step <= last[kind]) f.push(`${port} sent step ${o.step} again (its ${kind}, at host ${o.at}), after it had sent up to step ${last[kind]}`);
      last[kind] = Math.max(last[kind], o.step);
    }
  }
  return f;
}
/** The entries and rows delivered are exactly the recorded ones, each once, by hash. */
export function matchFailures(outs: Out[], entries: JsonObject[], rows: JsonObject[], port: string): string[] {
  const f: string[] = [];
  const count = (xs: JsonObject[]): Map<string, { n: number; x: JsonObject }> => {
    const m = new Map<string, { n: number; x: JsonObject }>();
    for (const x of xs) { const h = hashOf(x); m.set(h, { n: (m.get(h)?.n ?? 0) + 1, x }); }
    return m;
  };
  for (const [kind, recorded, delivered] of [['entry', entries, outs.flatMap((o) => o.entries)], ['row', rows, outs.flatMap((o) => o.rows)]] as const) {
    const want = count(recorded); const got = count(delivered);
    for (const [h, w] of want) if ((got.get(h)?.n ?? 0) !== w.n) f.push(`${port} delivered the recorded ${kind} ${show(w.x, 200)} (sha256 ${h.slice(0, 12)}) ${got.get(h)?.n ?? 0} times, not ${w.n}`);
    for (const [h, g] of got) if (!want.has(h)) f.push(`${port} delivered ${g.n} ${kind}(s) the record doesn't hold: ${show(g.x, 200)} (sha256 ${h.slice(0, 12)})`);
  }
  return f;
}
/** A mute at host `m`: the port was sending before it, sends nothing from one audio block after it, its plug-in is told
 * to stop within that block, and the port reads stopped. */
export function muteFailures(p: PortView, port: string, m: number, what: string): string[] {
  const f: string[] = [];
  const outs = outsOf(p, what);
  if (!outs.some((o) => o.at < m && o.at >= m - SEC)) f.push(`${port} delivered nothing in the second before the mute, so its stop can't be seen`);
  const late = outs.filter((o) => o.at >= m + BLOCK);
  if (late.length) f.push(`${port} kept sending through the mute at host ${m}: ${late.length} Out message(s) at or past one audio block after it, the first at host ${late[0]!.at} (step ${late[0]!.step})`);
  if (!stopsOf(p).some((at) => at >= m && at <= m + BLOCK)) f.push(`${port}'s plug-in was told no stop within one audio block of the mute (stops at ${JSON.stringify(stopsOf(p))})`);
  if (p.state !== 'stopped') f.push(`${port} reads ${p.state} after the mute, not stopped`);
  return f;
}
/** The note values the port delivered in its entries. */
export const deliveredValues = (outs: Out[]): number[] => outs.flatMap((o) => o.entries.map((e) => Number(e['value'])));

// ---------------------------------------------------------------------------------------------------
// deep-logic (README: deep-logic): pieces with sources, deliveries, step replies and their issues

/** A source as a piece declares the sources its items read (Logic: readings): `shape` "scalar" or `{vec: {n}}`. */
export interface Source { shape: 'scalar' | { vec: { n: number } }; delivery: 'latest' | 'each'; max_per_step?: number }
export interface LogicItem { program: Program; reads: string[]; writes: Record<string, { type: string; count?: number }> }
export function logicPiece(seed: number, items: Record<string, LogicItem>, sources: Record<string, Source>): JsonObject {
  const assets: JsonObject = {};
  const out: JsonObject = {};
  for (const [id, it] of Object.entries(items)) {
    assets[it.program.sha] = it.program.b64;
    out[id] = { kind: 'logic@1', params: { program: it.program.sha, reads: it.reads, writes: it.writes as unknown as JsonObject } };
  }
  return { seed, sources: sources as unknown as JsonObject, items: out, assets };
}
/** The layout `check` gives item `id` of this piece built from the layout probe (#533's way). */
export function layoutOf(id: string, reads: string[], writes: LogicItem['writes'], sources: Record<string, Source>): Layout {
  const [reply] = onLogic([checkCall(logicPiece(210, { [id]: { program: layoutProbe(), reads, writes } }, sources))]);
  expect(reply!['ok'], `check admits the layout probe's piece with the sources ${show(sources as unknown as JsonValue)}: ${show(reply)}`).toBe(true);
  const l = obj(obj(obj(reply!['items'], 'check: items')[id], `check: items.${id}`)['layout'], `check: items.${id}.layout`);
  return {
    digest: str(l['digest'], 'layout.digest'),
    entries: arr(l['entries'], 'layout.entries').map((e, i) => {
      const x = obj(e, `layout.entries[${i}]`);
      return { region: str(x['region'], 'region'), name: str(x['name'], 'name'), offset: int(x['offset'], 'offset'), size: int(x['size'], 'size') };
    }),
  };
}
/** A value a source delivers, as the hub hands it to the logic module (README: append): `arrived` is when it reached
 * the hub, on the clock its as-of time is on (µs). */
export const deliver = (session: string, reading: string, value: JsonValue, as_of: number, arrived: number): JsonObject =>
  ({ call: 'append', session, entry: { reading, value, as_of, arrived } });
export const openPiece = (p: JsonObject): JsonObject => ({ call: 'open', piece: p, track: [] });
export const stepTo = (session: string, to: number): JsonObject => ({ call: 'step', session, to });
export type LogicPlanted = 'read_region_keeps_last';
/** `deep-logic --planted <name>`, one process, one reply per call. */
export const onLogicPlanted = (calls: JsonObject[], planted: LogicPlanted): JsonObject[] =>
  replies(start(logicBin(), ['--planted', planted], calls), calls, `deep-logic --planted ${planted}`);
/** One process of the `deep-logic` at `bin` (a release build, for a timing), one reply per call. */
export const onLogicAt = (bin: string, calls: JsonObject[]): JsonObject[] => replies(start(bin, [], calls), calls, `${bin} (deep-logic)`);
/** A `step` reply's `issues`: every issue the steps it ran raised. */
export function issuesOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['issues'], `${what}: issues (the issues the steps this call ran raised)`).map((x, i) => obj(x, `${what}: issues[${i}]`));
}
/** Each step's `items.<item>.<field>` in a step or bake reply. */
export function perStep(reply: JsonObject, item: string, field: string, what: string): { step: number; value: JsonValue }[] {
  return arr(reply['steps'], `${what}: steps`).map((s, i) => {
    const o = obj(s, `${what}: steps[${i}]`);
    const row = obj(obj(o['items'], `${what}: steps[${i}].items`)[item], `${what}: steps[${i}].items.${item}`);
    expect(field in row, `${what}: step ${String(o['step'])}'s items.${item}.${field} is present`).toBe(true);
    return { step: int(o['step'], `${what}: steps[${i}].step`), value: row[field] ?? null };
  });
}

// ---------------------------------------------------------------------------------------------------
// Release builds for the timed budgets (README: Criterion 8), only where a timing can be judged

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
let releaseDir = '';
afterAll(() => { if (releaseDir) rmSync(releaseDir, { recursive: true, force: true }); releaseDir = ''; });
/** `cargo build --locked --release --bin <bin>` (deep-show with the full set), copied out of the target folder. */
export function releaseBin(bin: 'deep-show' | 'deep-logic'): string {
  if (!releaseDir) releaseDir = mkdtempSync(join(tmpdir(), 'deep-210-release-'));
  const args = ['build', '--locked', '--release', '--bin', bin, ...(bin === 'deep-show' ? ['--no-default-features', '--features', 'full'] : [])];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', PATH: `${TOOLCHAIN}:${process.env['PATH'] ?? ''}` } });
  if (r.error) blocked(`cargo could not run: ${r.error.message}`);
  expect(r.status, `cargo ${args.join(' ')}: ${(r.stderr ?? '').split('\n').filter((l) => !/Compiling|Finished|Blocking/.test(l)).join('\n').slice(-3000)}`).toBe(0);
  const to = join(releaseDir, `${bin}-release`);
  copyFileSync(join(TARGET, 'release', bin), to);
  return to;
}
