// #42 AC3: `deep doctor` reads Claude Code's telemetry protocol and address from its settings and flags the
// ones the receiver on 127.0.0.1:4318 (OTLP over HTTP) can't read, naming the setting. A doctor that checks
// only that the receiver is up exits 0 in the failing cases below, and fails them.
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { startReceiver } from '../../../packages/otlp/src/index.ts';
import type { Receiver } from '../../../packages/otlp/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { OTLP, openTempRecord, REPO, removeRoots, tempRoot } from './helpers.ts';

const MANAGED = '/Library/Application Support/ClaudeCode/managed-settings.json';
const TELEMETRY = { CLAUDE_CODE_ENABLE_TELEMETRY: '1', CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1', OTEL_TRACES_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none' };
const AT_RECEIVER = 'http://127.0.0.1:4318';
let record: RecordStore | undefined, receiver: Receiver | undefined, busy: string | undefined;

beforeAll(async () => {
  const built = spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw Error(`npm run build --workspaces failed:\n${built.stdout}\n${built.stderr}`);
  record = await openTempRecord();
  try { receiver = await startReceiver({ record, connection: OTLP, port: 4318 }); } catch (e) { busy = (e as Error).message; }
}, 600_000);
afterAll(async () => { await receiver?.close(); await record?.close(); removeRoots(); });

interface Item { item: string; agent?: string; code: string; level: string; evidence: string; fix: string }
interface Doctor { status: number; out: string; items: Item[] }
/** Runs `deep doctor` in a temp home whose Claude Code config home holds `settings` as its env block, with `shell` as the inherited env. */
async function doctor(settings: Record<string, string>, shell: Record<string, string>, json: boolean): Promise<Doctor> {
  const home = tempRoot(), config = join(home, '.claude');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ env: settings }));
  const env = { PATH: process.env.PATH ?? '', HOME: home, CLAUDE_CONFIG_DIR: config, NO_COLOR: '1', ...shell };
  const args = [join(REPO, 'packages/cli/dist/main.js'), 'doctor', ...(json ? ['--json'] : [])];
  const done = await promisify(execFile)(process.execPath, args, { cwd: home, env, encoding: 'utf8', timeout: 60_000 }).then((r) => ({ status: 0, ...r }), (e: { code?: number; stdout?: string; stderr?: string }) => ({ status: typeof e.code === 'number' ? e.code : -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
  const items = json ? done.stdout.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Item) : [];
  return { status: done.status, out: `${done.stdout}\n${done.stderr}`, items };
}
/** The receiver must hold 127.0.0.1:4318 and no managed settings may override the temp home's; otherwise INCONCLUSIVE, never a pass. */
function gate(ctx: TestContext): void {
  if (busy !== undefined) ctx.skip(`INCONCLUSIVE: the receiver could not take 127.0.0.1:4318 (${busy})`);
  if (existsSync(MANAGED)) ctx.skip(`INCONCLUSIVE: ${MANAGED} would override the settings under test`);
}
function telemetryItem(run: Doctor): Item {
  const found = run.items.filter((i) => i.item === 'otlp.telemetry' && i.agent === 'claude-code');
  expect(found, `deep doctor --json has one otlp.telemetry item for claude-code:\n${run.out}`).toHaveLength(1);
  const { item: _item, agent: _agent, ...rest } = found[0]!;
  const held = validate('doctor.item@1', rest);
  expect(held.ok, `the item is a doctor.item@1: ${JSON.stringify(held)}`).toBe(true);
  return found[0]!;
}

interface Case { name: string; where: 'settings' | 'shell'; vars: Record<string, string>; variable: string }
const grpc = { ...TELEMETRY, OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc', OTEL_EXPORTER_OTLP_ENDPOINT: AT_RECEIVER };
const flagged: Case[] = [
  { name: 'protocol grpc in settings.json', where: 'settings', vars: grpc, variable: 'OTEL_EXPORTER_OTLP_PROTOCOL' },
  { name: 'protocol grpc in the shell env', where: 'shell', vars: grpc, variable: 'OTEL_EXPORTER_OTLP_PROTOCOL' },
  { name: 'the logs protocol alone grpc', where: 'settings', vars: { ...TELEMETRY, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: AT_RECEIVER, OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'grpc' }, variable: 'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL' },
  { name: 'http/protobuf at the gRPC port', where: 'settings', vars: { ...TELEMETRY, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4317' }, variable: 'OTEL_EXPORTER_OTLP_ENDPOINT' },
];
const passing: Array<{ name: string; where: 'settings' | 'shell' }> = [{ name: 'in settings.json', where: 'settings' }, { name: 'in the shell env', where: 'shell' }];

describe('AC3 deep doctor reads Claude Code\'s telemetry settings against the receiver', () => {
  it.for(flagged)('AC3 $name: deep doctor flags Claude Code naming the variable and exits non-zero', { timeout: 120_000 }, async ({ where, vars, variable }, ctx) => {
    gate(ctx);
    const [settings, shell] = where === 'settings' ? [vars, {}] : [{}, vars];
    const json = await doctor(settings, shell, true);
    const item = telemetryItem(json);
    expect({ level: item.level, healthy: ['healthy', 'not_checked', 'unknown'].includes(item.code) }, 'the item fails with a code that says what it found').toEqual({ level: 'fail', healthy: false });
    expect(item.evidence, 'the evidence names the setting and its value').toContain(variable);
    expect(item.evidence).toContain(vars[variable]!);
    expect(item.fix.length).toBeGreaterThan(0);
    expect(json.status, 'deep doctor --json exits non-zero').not.toBe(0);
    const text = await doctor(settings, shell, false);
    expect(text.status, `deep doctor exits non-zero:\n${text.out}`).not.toBe(0);
    expect(text.out).toContain('Claude Code');
    expect(text.out).toContain(variable);
  });

  it.for(passing)('AC3 http/protobuf with the endpoint at the receiver $name: the item passes', { timeout: 120_000 }, async ({ where }, ctx) => {
    gate(ctx);
    const vars = { ...TELEMETRY, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: AT_RECEIVER };
    const item = telemetryItem(await doctor(where === 'settings' ? vars : {}, where === 'shell' ? vars : {}, true));
    expect({ level: item.level, code: item.code }).toEqual({ level: 'ok', code: 'healthy' });
  });
});
