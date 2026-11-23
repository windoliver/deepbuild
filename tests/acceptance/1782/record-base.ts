// Records fixtures/base-frames.json, the hashes AC8 compares with: every frame of unchanged.ts drawn once by the
// base's `deep-gpu` on Metal. It is not a test and vitest never runs it. Run it once, at the base commit, on the
// reference Mac, with cargo on PATH:
//
//   node tests/acceptance/1782/record-base.ts
//
// It refuses to run anywhere else: when HEAD isn't the base commit, or when anything but this suite differs from
// it, the frames it would record are not "before this change". Recording again at the base is harmless; recording
// anywhere else would make unchanged.test.ts prove nothing, and the script won't do it.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { REPO, type JsonObject } from '../1640/helpers.ts';
import { BASE, BASE_FRAMES, baseCalls, hashOf } from './unchanged.ts';

const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

function record(out: string): string {
  const head = git('rev-parse', 'HEAD');
  if (!head.startsWith(BASE)) throw Error(`HEAD is ${head.slice(0, 9)}, not the base ${BASE}; the hashes are the base's and are recorded there only`);
  const changed = git('status', '--porcelain').split('\n').filter((l) => l !== '' && !/^\?\? (node_modules|tests\/acceptance\/1782)\/?/.test(l));
  if (changed.length) throw Error(`the checkout differs from the base outside this suite:\n${changed.join('\n')}`);
  if (process.platform !== 'darwin') throw Error('the frames are drawn on macOS\'s Metal device, the reference Mac');

  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (build.error || build.status !== 0) throw Error(`cargo build --locked --bin deep-gpu failed: ${build.error?.message ?? build.stderr.slice(-2000)}`);
  const bin = join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', 'deep-gpu');

  const calls = baseCalls(out);
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls: calls.map((c) => c.call) })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw Error(`deep-gpu run failed: ${run.error?.message ?? run.stderr.slice(-2000)}`);
  const answer = JSON.parse(run.stdout.split('\n').find((l) => l !== '') ?? 'null') as { ok?: boolean; replies?: JsonObject[] } | null;
  const replies = answer?.ok ? answer.replies ?? [] : [];
  if (replies.length !== calls.length) throw Error(`deep-gpu run didn't answer every call: ${run.stdout.slice(0, 500)}`);
  const frames: Record<string, string> = {};
  calls.forEach((c, i) => {
    const h = hashOf(replies[i]!);
    if ('why' in h) throw Error(`${c.name}: ${h.why}`);
    frames[c.name] = h.hash;
  });
  mkdirSync(dirname(BASE_FRAMES), { recursive: true });
  const about = 'pixel_hash of each frame of unchanged.ts, drawn by the base\'s deep-gpu on Metal (record-base.ts)';
  writeFileSync(BASE_FRAMES, `${JSON.stringify({ base: BASE, about, frames }, null, 2)}\n`);
  return `wrote ${Object.keys(frames).length} hashes to ${relative(REPO, BASE_FRAMES)}`;
}

const out = mkdtempSync(join(tmpdir(), 'deep-1782-base-'));
try {
  console.log(`record-base: ${record(out)}`);
} catch (e) {
  console.error(`record-base: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
