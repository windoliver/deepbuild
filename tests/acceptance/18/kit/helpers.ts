// Shared test-side tools for #18's kit criteria (AC16, AC17, AC18): the environment, temp folders, the surface
// #18 adds to the conformance package (README, The surface under test), the conformance runner as a process, the
// recorded PermissionRequest, and the machine gate and timing judge the budget tests share with #26 and #387.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, type TestContext } from 'vitest';
import * as conformance from '../../../../packages/conformance/src/index.ts';
import type { Fill } from '../../../../packages/conformance/src/index.ts';
import type { HookRequestLine, JsonObject } from '../../../../packages/adapters/src/index.ts';
import type { JsonValue } from '../../../../packages/contracts/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..', '..');
export const NODE = process.execPath;

export const AC16 = 'AC16 #18.d4f60451';
export const AC17 = 'AC17 #18.c798e28d';
export const AC18 = 'AC18 #18.42323f56';

// ---- The environment: nothing an agent session or a DeepBuild home set leaks in, and HOME is a temp folder ------

for (const key of Object.keys(process.env)) if (/^(CLAUDE|DEEP_)/.test(key) || key === 'AI_AGENT') delete process.env[key];

const made: string[] = [];
/** A fresh folder under /tmp (short, so a socket path in it fits in 104 bytes), removed by `cleanup`. */
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dk18-'));
  made.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
process.env.HOME = tempDir();

/** The environment every process a test starts gets: the cleaned one, with HOME a temp folder of its own. */
export const childEnv = (home: string = tempDir()): NodeJS.ProcessEnv => ({ ...process.env, HOME: home });

// ---- The surface #18 adds (README, The surface under test) ------------------------------------------------------

/** The planted twins `shippedFill` takes: the issue's two broken twins, and AC17's two wrong permission replies. */
export type Plant = 'duplicate-event-id' | 'event-after-stop' | 'allow-from-label' | 'allow-from-yes';
export type ShippedFill = (agent: string, options?: { planted?: Plant }) => Fill;

/** What the adapter is handed for a permission request: the asks core's Delivery plus the chosen option's label. */
export interface PermissionAnswer {
  ask: string;
  session: string;
  option: string | null;
  label: string | null;
  decision: 'allow' | 'deny' | 'none';
  words: string | null;
  provisional: boolean;
  undoes: string | null;
}
export type PermissionReply = (answer: PermissionAnswer, request: HookRequestLine) => JsonValue;

/** The registry name of the shipped Claude Code adapter: its facts' `agent` field. */
export const AGENT = String((JSON.parse(readFileSync(join(REPO, 'adapters', 'claude-code.facts.json'), 'utf8')) as JsonObject).agent);

/** `shippedFill` from the conformance package's public entry; the test fails naming the surface when it isn't there. */
export function shippedFill(planted?: Plant): Fill {
  const fn = (conformance as unknown as { shippedFill?: ShippedFill }).shippedFill;
  expect(typeof fn, '@deepbuild/conformance exports shippedFill(agent, { planted }), the fill of a shipped adapter (#18, README)').toBe('function');
  return planted === undefined ? fn!(AGENT) : fn!(AGENT, { planted });
}

/** The adapter's permission reply, through the fill's adapter; fails naming the surface when it has none. */
export function permissionReply(fill: Fill): PermissionReply {
  const reply = (fill.adapter as unknown as { permissionReply?: PermissionReply }).permissionReply;
  expect(typeof reply, `the ${AGENT} adapter has permissionReply(answer, request) (#18, README)`).toBe('function');
  return reply!.bind(fill.adapter);
}

// ---- The recorded PermissionRequest ------------------------------------------------------------------------------

export const REQUEST_PAYLOAD = JSON.parse(readFileSync(join(HERE, 'fixtures', 'permission-request.json'), 'utf8')) as JsonObject;
export const SESSION = String(REQUEST_PAYLOAD.session_id);
/** The request line deep-hook sends the hub for the recorded payload. */
export const REQUEST_LINE: HookRequestLine = {
  v: 1, agent: 'claude-code', event: 'PermissionRequest', seq: '1760013451123456789', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 81234, ppid: 81200, matched: [], payload: REQUEST_PAYLOAD,
};

// ---- The conformance runner as a process -------------------------------------------------------------------------

export interface CaseLine { outcome: string; id: string; message: string; line: string }
export interface RunnerRun { status: number | null; out: string; cases: CaseLine[]; verdict: string }

const runs = new Map<string, RunnerRun>();
/**
 * `deep-conformance run --fill <module>` (the built bin) on a module whose default export is
 * `shippedFill(AGENT[, { planted }])`, imported from the built conformance package. One run per fill per file.
 */
export function runner(planted?: Plant): RunnerRun {
  const key = planted ?? '';
  const cached = runs.get(key);
  if (cached) return cached;
  const dir = tempDir();
  const module = join(dir, 'fill.mjs');
  const entry = pathToFileURL(join(REPO, 'packages', 'conformance', 'dist', 'index.js')).href;
  writeFileSync(module, `import { shippedFill } from ${JSON.stringify(entry)};\nexport default shippedFill(${JSON.stringify(AGENT)}${planted ? `, { planted: ${JSON.stringify(planted)} }` : ''});\n`);
  const r = spawnSync(NODE, [join(REPO, 'packages', 'conformance', 'dist', 'bin.js'), 'run', '--fill', module], {
    cwd: REPO, env: childEnv(), encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  const out = `${r.stdout}\n${r.stderr}`;
  const cases: CaseLine[] = [];
  let verdict = '';
  for (const line of r.stdout.split('\n')) {
    const total = /^(PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE) \S+ revision \d+: \d+ cases$/.exec(line);
    if (total) { verdict = total[1]!; continue; }
    const m = /^(PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE) (\S+?)(?:: (.*))?$/.exec(line);
    if (m) cases.push({ outcome: m[1]!, id: m[2]!, message: m[3] ?? '', line });
  }
  const run = { status: r.status, out, cases, verdict };
  runs.set(key, run);
  return run;
}
export const shown = (run: RunnerRun): string => run.out.trim().split('\n').slice(-40).join('\n');

// ---- The machine gate and the timing judge (the design's rule for timing results) --------------------------------

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing budget can't count on this machine now, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('/usr/sbin/sysctl', '-n', 'hw.model');
    chip = read('/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('/usr/sbin/sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('/usr/bin/pmset', '-g', 'batt');
    power = read('/usr/bin/pmset', '-g');
    therm = read('/usr/bin/pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `${fingerprint} not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return `${fingerprint}: Low Power Mode state unknown (no lowpowermode line in pmset -g)`;
  if (lpm[1] !== '0') return `${fingerprint}: Low Power Mode is on`;
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `${fingerprint}: thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}

/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}

/** The last line a process printed, parsed as one JSON object. */
export function lastJson(stdout: string, what: string): JsonObject {
  const last = stdout.trim().split('\n').pop() ?? '';
  let value: unknown;
  try { value = JSON.parse(last); } catch { throw Error(`${what} printed ${JSON.stringify(last.slice(0, 400))} as its last line, not one JSON object`); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error(`${what} printed ${last.slice(0, 400)}, not one JSON object`);
  return value as JsonObject;
}
