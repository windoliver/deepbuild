// Criterion 10 (#140.a4a4b47c): on a Mac whose headless rendering works, deep doctor lists the GPU tier's
// features and gives a healthy canvas verdict after its fixture renders within its golden; with headless
// rendering forced to fail, the verdict is unhealthy and the finding names a fix an agent can run; with the
// render skipped, the verdict is unverified, never healthy.
//
// `deep doctor --json` (#19: one doctor.item@1 object per line with its `item` and `agent`), run from the built
// CLI with a temporary HOME. Its canvas items are `canvas.*`, the verdict `canvas.verdict` (README: The doctor's
// canvas items). Headless rendering is forced to fail or skipped with DEEP_DOCTOR_CANVAS_FAULT, a fault fixture
// only tests set. The doctor's canvas items run the build's canvas binaries, so the file builds the workspace's
// binaries and the CLI first.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLI, REPO, chipName, inconclusive, isObject, useDir, type JsonObject, type JsonValue } from './helpers.ts';

const dir = useDir();
let buildError = '';
beforeAll(() => {
  const cargo = spawnSync('cargo', ['build', '--locked', '--workspace', '--bins'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (cargo.status !== 0) buildError = `cargo build --locked --workspace --bins failed: ${(cargo.stderr ?? '').slice(-3000)}`;
  if (!existsSync(CLI)) {
    const npm = spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (npm.status !== 0) buildError += `\nnpm run build --workspaces failed: ${(npm.stdout ?? '').slice(-3000)}`;
  }
}, 3_600_000);

interface Item { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
function doctor(fault?: 'render_fails' | 'render_skipped'): Item[] {
  expect(buildError, 'the workspace\'s binaries and the CLI build').toBe('');
  const home = join(dir(), 'home');
  const cwd = join(dir(), 'work');
  mkdirSync(home, { recursive: true }); mkdirSync(cwd, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env['DEEP_DOCTOR_CANVAS_FAULT'];
  if (fault) env['DEEP_DOCTOR_CANVAS_FAULT'] = fault;
  const run = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd, env, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  expect(run.error, `deep doctor ran: ${run.error?.message}`).toBeUndefined();
  const items = (run.stdout ?? '').split('\n').filter((l) => l.trim() !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  const notJson = items.filter((i) => !isObject(i as JsonValue));
  expect(notJson, `deep doctor --json prints one JSON item per line; stderr: ${(run.stderr ?? '').slice(-1500)}`).toEqual([]);
  return items.map((i) => {
    const o = i as JsonObject;
    return { item: String(o['item']), agent: String(o['agent']), code: String(o['code']), level: String(o['level']), evidence: String(o['evidence']), fix: String(o['fix']) };
  });
}
const canvas = (items: Item[]): Item[] => items.filter((i) => i.item.startsWith('canvas'));
const verdict = (items: Item[]): Item => {
  const v = items.filter((i) => i.item === 'canvas.verdict');
  expect(v.length, `deep doctor gives one canvas verdict; its canvas items: ${JSON.stringify(canvas(items))}`).toBe(1);
  return v[0]!;
};
const LEVELS = ['ok', 'warn', 'fail', 'skip'];

describe('#140.a4a4b47c (C10) deep doctor\'s canvas verdict: healthy, unhealthy with a fix, or unverified', () => {
  it('#140.a4a4b47c (C10) on this Mac, whose headless rendering works, the doctor lists the GPU adapter and its tier\'s features and gives a healthy verdict once its fixture renders within its golden', () => {
    if (process.platform !== 'darwin') inconclusive('the healthy verdict is read on a Mac whose headless rendering works');
    const items = doctor();
    const f: string[] = [];
    for (const i of canvas(items)) {
      if (!LEVELS.includes(i.level)) f.push(`${i.item}: level ${i.level} is not ok, warn, fail or skip`);
      if (!i.evidence || !i.fix) f.push(`${i.item}: has no evidence or no fix`);
    }
    const gpu = items.find((i) => i.item === 'canvas.gpu');
    if (!gpu) f.push('no canvas.gpu item');
    else {
      if (gpu.level !== 'ok') f.push(`canvas.gpu is ${gpu.level} (${gpu.code}) on this Mac`);
      const chip = chipName();
      if (chip && !gpu.evidence.includes(chip)) f.push(`canvas.gpu's evidence doesn't name this Mac's adapter, ${chip}: ${gpu.evidence}`);
      for (const [feature, pattern] of [['pass timestamps', /timestamp/i], ['depth-clip control', /depth.?clip/i], ['ray queries', /ray/i], ['MSAA counts', /msaa|multisampl|sample count/i]] as const) {
        if (!pattern.test(gpu.evidence)) f.push(`canvas.gpu's evidence doesn't list the tier's ${feature}: ${gpu.evidence}`);
      }
    }
    const v = verdict(items);
    if (v.code !== 'healthy' || v.level !== 'ok') f.push(`the canvas verdict is ${v.code} at ${v.level}, not healthy: ${v.evidence}`);
    if (!/golden/i.test(v.evidence)) f.push(`the verdict's evidence doesn't say its fixture rendered within its golden: ${v.evidence}`);
    expect(f, 'deep doctor\'s canvas items on a healthy Mac').toEqual([]);
  }, 1_200_000);

  it('#140.a4a4b47c (C10) with headless rendering forced to fail, the verdict is unhealthy and the failed finding names a fix an agent can run', () => {
    const items = doctor('render_fails');
    const v = verdict(items);
    expect({ level: v.level, healthy: v.code === 'healthy' || v.code === 'not_checked' }, `the verdict: ${JSON.stringify(v)}`).toEqual({ level: 'fail', healthy: false });
    const failed = canvas(items).filter((i) => i.level === 'fail' && i.item !== 'canvas.verdict');
    expect(failed.length, `a canvas finding fails: ${JSON.stringify(canvas(items))}`).toBeGreaterThanOrEqual(1);
    expect(failed.some((i) => /`[^`\s][^`]*`/.test(i.fix)), `a failed finding's fix names a command an agent can run, in backticks: ${JSON.stringify(failed)}`).toBe(true);
  }, 1_200_000);

  it('#140.a4a4b47c (C10) with the render skipped, the verdict is unverified, never healthy', () => {
    const items = doctor('render_skipped');
    const v = verdict(items);
    const f: string[] = [];
    if (v.code === 'healthy' || v.level === 'ok') f.push(`the verdict reads ${v.code} at ${v.level}`);
    if (v.level !== 'skip') f.push(`the verdict's level is ${v.level}, not skip (not checked)`);
    if (!['not_checked', 'unverified'].includes(v.code)) f.push(`the verdict's code is ${v.code}, not not_checked`);
    if (!/unverified/i.test(`${v.code} ${v.evidence}`)) f.push(`the verdict doesn't say unverified: ${v.evidence}`);
    expect(f, `the verdict: ${JSON.stringify(v)}`).toEqual([]);
  }, 1_200_000);
});
