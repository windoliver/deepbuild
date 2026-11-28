import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import { FLICKS, MS, TICKS, seededOffsets, type CapName, type Play, type Rate, type Tick } from './judges.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const BUILD_DEADLINE_MS = 3_600_000;
export const TEST_DEADLINE_MS = 900_000;
const RUN_DEADLINE_MS = 600_000;

export const homeAsTilde = (text: string): string => text.split(homedir()).join('~');
const brief = (value: unknown, most = 600): string => homeAsTilde(JSON.stringify(value) ?? String(value)).slice(0, most);
export const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const SUPPLIED_BIN_DIR = process.env['DEEP_BIN_DIR'];
const TARGET_DIR = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

export function useShow(): () => string {
  const path = join(SUPPLIED_BIN_DIR === undefined ? join(TARGET_DIR, 'debug') : resolve(SUPPLIED_BIN_DIR), 'deep-show');
  let missing = 'its file was never looked for';
  beforeAll(() => {
    missing = '';
    if (SUPPLIED_BIN_DIR === undefined) {
      const built = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
      if (built.error) missing = `cargo could not run: ${built.error.message}`;
      else if (built.status !== 0) missing = `cargo build --locked --bin deep-show failed:\n${homeAsTilde(built.stderr).split('\n').filter((line) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(line)).join('\n').slice(-4000)}`;
    } else if (SUPPLIED_BIN_DIR.trim() === '') missing = 'DEEP_BIN_DIR is empty';
    if (missing === '') {
      try {
        accessSync(path, constants.X_OK);
      } catch {
        missing = `${homeAsTilde(path)} is missing or not executable`;
      }
    }
  }, BUILD_DEADLINE_MS);
  return () => {
    if (missing !== '') expect.fail(`BLOCKED: the binary deep-show isn't there (${SUPPLIED_BIN_DIR === undefined ? 'cargo build --locked --bin deep-show' : 'DEEP_BIN_DIR'}): ${missing}; this is not a pass`);
    return path;
  };
}

export type Planted = 'window_cap_time_threshold' | 'model_cap_time_threshold' | 'window_cap_defers_forced';
export const MERGE_BASE_RULE: Planted = 'window_cap_time_threshold';
export const MODEL_KEEPS_A_TIME_THRESHOLD: Planted = 'model_cap_time_threshold';
export const CAP_DEFERS_FORCED_FRAMES: Planted = 'window_cap_defers_forced';

export const LEAD = 2 * MS;
const CHECK = MS / 2;
export const FIRST_VSYNC = 4 * MS;
const PATCH_AHEAD_OF_ITS_LATCH = MS;
const READ_AFTER_THE_LAST_VSYNC = 10 * MS;
const PANEL = 'x';
const DOC = '01JB3441D00000000000000001';
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'agent alpha', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
const DISPLAYS: Record<Rate, JsonObject> = {
  60: { uuid: '3441D060-0000-4000-8000-000000000060', bounds: [0, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: FIRST_VSYNC, color_space: 'srgb' },
  120: { uuid: '3441D120-0000-4000-8000-000000000120', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FIRST_VSYNC, color_space: 'p3' },
};
const BOARD: JsonObject = {
  format: 1, profile: 'board', title: 'Ticks, live', description: 'A board an agent writes before every latch, so that the model opens every vsync a cap allows.', size: [600, 350],
  layers: { 'alpha-main': { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } },
  items: { 'alpha.box': { id: 'alpha.box', kind: 'rect@1', layer: 'alpha-main', name: 'Box alpha.box', order: 'a0', params: { box: [0, 0, 60, 40], paint: { fill: { role: 'muted' } } }, at: { pos: [40, 280, 0] } } },
};

function dotBeforeTheLatchOf(vsync: number, k: number): JsonObject {
  return {
    call: 'deep_show', session: ALPHA.id, doc: DOC, at: vsync - LEAD - PATCH_AHEAD_OF_ITS_LATCH,
    patch: {
      patch: `01JB3441P${String(k).padStart(17, '0')}`, doc: DOC, base: 0, reason: 'add a dot',
      ops: [{ op: 'create', item: { id: `alpha.d${k}`, kind: 'rect@1', name: `Dot ${k}`, order: `b${String(k).padStart(4, '0')}`, params: { box: [0, 0, 6, 6], paint: { fill: { role: 'ink' } } }, at: { pos: [10 + 8 * (k % 70), 20 + 8 * Math.floor(k / 70), 0] } } }],
    },
  };
}

function answered(bin: string, hz: Rate, planted: Planted | undefined, calls: readonly JsonObject[], what: string): JsonObject[] {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-3441-'));
  try {
    const ordered = calls.map((call, index) => ({ call, index })).sort((a, b) => Number(a.call['at']) - Number(b.call['at']) || a.index - b.index).map(({ call }) => call);
    const scenario: JsonObject = {
      evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: LEAD, check: CHECK }, displays: [DISPLAYS[hz]], window: [1200, 700],
      panels: { [PANEL]: { rect: [0, 0, 600, 350] } }, docs: { [DOC]: { panel: PANEL, document: BOARD } }, ...(planted ? { planted } : {}), calls: ordered,
    };
    const ran = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: RUN_DEADLINE_MS, killSignal: 'SIGKILL' });
    if (ran.error) expect.fail(`${what}: deep-show run did not finish: ${ran.error.message}`);
    expect(ran.status, `${what}: deep-show run exits 0 (${ran.signal ?? 'no signal'}); stdout: ${homeAsTilde(ran.stdout ?? '').slice(0, 800)}; stderr: ${homeAsTilde(ran.stderr ?? '').slice(-2000)}`).toBe(0);
    const lines = (ran.stdout ?? '').split('\n').filter((line) => line !== '');
    expect(lines.length, `${what}: deep-show run writes one line for the one scenario`).toBe(1);
    let answer: JsonValue = null;
    try {
      answer = JSON.parse(lines[0]!) as JsonValue;
    } catch {
      expect.fail(`${what}: deep-show run's line is not JSON: ${homeAsTilde(lines[0]!).slice(0, 600)}`);
    }
    const surface = `the #400 scenario with one display at ${hz} Hz, this suite's \`tick\` call${planted ? ` and planted ${planted}` : ''} (README: The surface under test)`;
    expect(isObject(answer) && answer['ok'], `${what}: deep-show run answers the scenario ok: ${surface}; got ${brief(answer)}`).toBe(true);
    const replies = (answer as JsonObject)['replies'];
    expect(Array.isArray(replies) && replies.length === ordered.length && replies.every(isObject), `${what}: one reply, an object, for each of the ${ordered.length} calls; got ${brief(replies)}`).toBe(true);
    return calls.map((call) => (replies as JsonObject[])[ordered.indexOf(call)]!);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

const mainWindows = new Map<string, string>();
function mainWindow(bin: string, hz: Rate, planted: Planted | undefined): string {
  const key = `${bin} ${hz} ${planted ?? ''}`;
  const known = mainWindows.get(key);
  if (known !== undefined) return known;
  const what = `the windows of the scenario at ${hz} Hz${planted ? ` (planted ${planted})` : ''}`;
  const [reply] = answered(bin, hz, planted, [{ call: 'windows', at: 1 }], what);
  const windows = reply!['windows'];
  const main = Array.isArray(windows) ? windows.filter(isObject).find((window) => window['kind'] === 'main') : undefined;
  const id = main?.['window'];
  if (typeof id !== 'string') expect.fail(`${what}: the windows reply names no main window: ${brief(reply)}`);
  mainWindows.set(key, id);
  return id;
}

export const vsyncsOf = (hz: Rate): number[] => Array.from({ length: TICKS }, (_, k) => FIRST_VSYNC + k * (FLICKS / hz));

export interface Setup { hz: Rate; cap: CapName | null; seed: number | null; planted?: Planted; forceRenderAt?: number; requirePresentationAt?: number; withModel?: boolean }
export interface Played extends Play { vsyncs: number[]; model: number[] | null }

const plays = new Map<string, Played>();
export function play(bin: string, setup: Setup): Played {
  const key = `${bin} ${JSON.stringify(setup)}`;
  const known = plays.get(key);
  if (known !== undefined) return known;
  const { hz, cap, seed, planted } = setup;
  const spaced = seed === null ? `${TICKS} ticks exactly 1/${hz} s apart` : `${TICKS} ticks 1/${hz} s apart, each moved by seed ${seed}'s offset`;
  const what = `${cap === null ? 'under no cap' : `under the ${cap} cap`} at ${hz} Hz, ${spaced}${planted ? ` (planted ${planted})` : ''}`;
  const window = mainWindow(bin, hz, planted);
  const vsyncs = vsyncsOf(hz);
  const offsets = seed === null ? vsyncs.map(() => 0) : seededOffsets(seed, TICKS);
  const ticks: Tick[] = vsyncs.map((vsync, k) => ({
    at: vsync - LEAD + offsets[k]!,
    ...(setup.forceRenderAt === k ? { force_render: true } : {}),
    ...(setup.requirePresentationAt === k ? { require_presentation: true } : {}),
  }));
  const reports: JsonObject[] = cap === 'thermal' ? [{ call: 'thermal', at: 2, state: 'serious' }]
    : cap === 'inactive' ? [{ call: 'activate', at: 1, window }, { call: 'activate', at: 2, window: null }] : [];
  const tickCalls: JsonObject[] = ticks.map((tick) => ({ call: 'tick', window, ...tick }));
  const patches = setup.withModel ? vsyncs.slice(1).map((vsync, k) => dotBeforeTheLatchOf(vsync, k + 1)) : [];
  const reads: JsonObject[] = setup.withModel ? [{ call: 'presented', at: vsyncs.at(-1)! + READ_AFTER_THE_LAST_VSYNC, panel: PANEL }] : [];
  const replies = answered(bin, hz, planted, [...reports, ...tickCalls, ...patches, ...reads], what);
  const of = <T>(from: number, calls: readonly T[]): JsonObject[] => replies.slice(from, from + calls.length);
  of(0, reports).forEach((reply, k) => expect(reply['code'], `${what}: the ${String(reports[k]!['call'])} report is taken, not refused: ${brief(reply)}`).toBeUndefined());
  const presented = of(reports.length, tickCalls).map((reply, k) => {
    const shown = reply['presented'];
    if (typeof shown !== 'boolean') expect.fail(`${what}: the reply to tick ${k} has no \`presented\`, true or false: ${brief(reply)}`);
    return shown;
  });
  of(reports.length + tickCalls.length, patches).forEach((reply, k) => expect(reply['outcome'], `${what}: the dot before the latch of vsync ${k + 1} is applied, so that latch sees something new: ${brief(reply)}`).toBe('applied'));
  let model: number[] | null = null;
  if (setup.withModel) {
    const reply = replies.at(-1)!;
    const frames = reply['frames'];
    if (!Array.isArray(frames)) expect.fail(`${what}: the presented reply has no \`frames\`: ${brief(reply)}`);
    model = frames.flatMap((frame, k) => {
      const vsync = isObject(frame) ? frame['vsync'] : undefined;
      if (typeof vsync !== 'number') expect.fail(`${what}: frames[${k}] has no \`vsync\`, a number of flicks: ${brief(frame)}`);
      if (vsync > vsyncs.at(-1)!) return [];
      if (!vsyncs.includes(vsync)) expect.fail(`${what}: frames[${k}].vsync is no vsync of the display: ${brief(frame)}`);
      return [vsync];
    });
  }
  const played: Played = { what, hz, cap, ticks, presented, vsyncs, model };
  plays.set(key, played);
  return played;
}

export const presentedVsyncs = (played: Played): number[] => played.vsyncs.filter((_, tick) => played.presented[tick]);
