// #854.926cdce7: Every task's timings come from a release build, and a coefficient file or a perf reading taken
// from a debug build is refused, naming the profile.
//
// "Every task's timings come from a release build" is held twice: each task's own recording test (tagged with
// this ID too) requires its report's fingerprint to name the release profile, and the lane's judge (`node
// benchmarks/canvas.mjs judge`) refuses any reading whose fingerprint names another profile, or none, so no other
// timing is ever judged. "A perf reading taken from a debug build is refused, naming the profile": for each of
// the four tasks, a reading within every target on a reference Mac's fingerprint, marked with Cargo's debug
// profile `dev`, is refused (INVALID) naming `dev`; marked with no profile, refused naming none; its twin marked
// `release` is judged and passes, so a judge that refuses everything fails. "A coefficient file … taken from a
// debug build is refused, naming the profile": the cost model's own refusal (#855's `deep-show run --costs`),
// on the committed costs.json marked `dev`, and its twin marked `release` read. The wrong programs: the base (no
// judge for the tasks); a judge that times or passes a debug build's reading; a judge that refuses every reading;
// a cost model that reads a debug build's coefficients.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO, TASKS, TASK_KEYS, judged, obj, readJson, synthetic, type JsonObject, type JsonValue } from './helpers.ts';

const ID = '#854.926cdce7';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'deep-854-')); dirs.push(d); return d; };

/** `deep-show run [args]` of the shipped build on one registry call: its exit status and stdout lines. */
function deepShow(bin: string, args: string[]): { status: number | null; lines: JsonValue[]; stderr: string } {
  const r = spawnSync(bin, ['run', ...args], { cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, input: `${JSON.stringify({ evidence: temp(), calls: [{ call: 'registry' }] })}\n` });
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, lines, stderr: r.stderr ?? '' };
}

describe(`${ID} every task's timings come from a release build, and a coefficient file or a perf reading taken from a debug build is refused, naming the profile`, () => {
  it(`${ID} the lane refuses each task's perf reading taken from a debug build (dev), naming the profile, and one naming no build; the same reading from a release build is judged and passes; and the cost model refuses a coefficient file from a debug build, naming the profile, while reading its release twin`, () => {
    for (const key of TASK_KEYS) {
      const id = TASKS[key].id;
      const dev = judged(synthetic(key, 'dev'));
      expect(dev['status'], `${id}: a reading from a debug build is refused: ${JSON.stringify(dev).slice(0, 1500)}`).toBe('INVALID');
      expect(dev['profile'], `${id}: the refusal names the profile`).toBe('dev');
      expect(String(dev['reason']), `${id}: and says it`).toMatch(/\bdev\b/);
      const none = judged(synthetic(key, null));
      expect(none['status'], `${id}: a reading that names no build is refused too: ${JSON.stringify(none).slice(0, 1500)}`).toBe('INVALID');
      expect(none['profile'], `${id}: with no profile to name`).toBeNull();
      const release = judged(synthetic(key, 'release'));
      expect(release['status'], `${id}: the same reading from a release build is judged and passes: ${JSON.stringify(release).slice(0, 1500)}`).toBe('PASS');
    }

    // The coefficient file: the cost model's refusal, on the committed file marked dev and its release twin.
    const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(build.status, `cargo build --locked --bin deep-show: ${(build.stderr ?? '').slice(-3000)}`).toBe(0);
    const dir = temp();
    const bin = join(dir, 'deep-show');
    copyFileSync(join(REPO, 'target', 'debug', 'deep-show'), bin);
    const committed = obj(readJson(join(REPO, 'crates', 'deep-canvas', 'costs.json')), 'crates/deep-canvas/costs.json');
    const marked = (profile: string): string => {
      const path = join(dir, `costs-${profile}.json`);
      writeFileSync(path, JSON.stringify({ ...committed, build: { ...obj(committed['build'], 'costs.json build'), profile } } satisfies JsonObject));
      return path;
    };
    const refused = deepShow(bin, ['--costs', marked('dev')]);
    expect(refused.status, `a coefficient file from a debug build stops the start: ${JSON.stringify(refused.lines).slice(0, 1000)} ${refused.stderr.slice(-1000)}`).toBe(2);
    const line = obj(refused.lines[0], 'the refusal line');
    expect([line['code'], line['profile']], `the cost model refuses it, naming the profile: ${JSON.stringify(line)}`).toEqual(['costs_refused', 'dev']);
    const read = deepShow(bin, ['--costs', marked('release')]);
    expect(read.status, `its release twin is read: ${JSON.stringify(read.lines).slice(0, 1000)} ${read.stderr.slice(-1000)}`).toBe(0);
    expect(obj(read.lines[0], 'the answer')['ok'], 'the scenario is answered').toBe(true);
  }, 3_600_000);
});
