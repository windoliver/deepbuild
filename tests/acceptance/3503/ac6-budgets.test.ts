// #3503 criterion 6: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the server's
// idle footprint and its peak for a request under the cap are no higher"
//
// The merge base is `git merge-base HEAD origin/main`. Its deep-hook is built from that commit's crates/deep-hook and
// crates/deep-contracts (git archive, with its Cargo.lock), offline, in a temp folder of its own, debug as the change's
// is. Both binaries are read three times each, interleaved:
// - idle footprint: `ps -o rss=` once the server has answered initialize and tools/list, with nothing else to do;
// - peak for a request under the cap: time's maximum resident set size of a server that answered one 8 MiB ping (the
//   issue's first measured row) and exited.
// "No higher" is read as each change reading at most the base's highest plus 5% or 256 KiB, whichever is more: resident
// memory moves by a page or so between runs of one binary. Off a reference Mac in a fit state (#1097's
// environmentProblem) the readings are printed and the test reads INCONCLUSIVE, never PASS.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type TestContext } from 'vitest';
import { environmentProblem } from '../1097/helpers.ts';
import { AC, LONG, MIB, REPO, Server, actions, hookBinary, mb, pingOf, request, tempHome } from './helpers.ts';

const RUNS = 3;

function run(command: string, args: string[], cwd: string, input?: string): Promise<{ code: number | null; out: string; err: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CARGO_TARGET_DIR'));
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...env, CARGO_INCREMENTAL: '0' }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-3000)));
    child.on('error', (e) => (err += String(e)));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** The merge base's deep-hook, built from its own sources in a temp folder. */
async function baseHook(): Promise<{ base: string; bin: string }> {
  const merge = await run('git', ['merge-base', 'HEAD', 'origin/main'], REPO);
  const base = merge.out.trim();
  if (merge.code !== 0 || !/^[0-9a-f]{40}$/.test(base)) throw Error(`BLOCKED: no merge base of HEAD and origin/main: ${merge.err}`);
  const { dir } = tempHome();
  const src = join(dir, 'src');
  mkdirSync(src);
  const tar = join(dir, 'base.tar');
  const archived = await run('git', ['archive', '-o', tar, base, 'crates/deep-hook', 'crates/deep-contracts', 'adapters', 'Cargo.lock'], REPO);
  if (archived.code !== 0 || (await run('tar', ['-xf', tar, '-C', src], src)).code !== 0) throw Error(`BLOCKED: the merge base's sources can't be read: ${archived.err}`);
  writeFileSync(join(src, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
  const built = await run('cargo', ['build', '--offline', '-q', '-p', 'deep-hook', '--target-dir', join(dir, 'target')], src);
  if (built.code !== 0) throw Error(`BLOCKED: the merge base's deep-hook didn't build: ${built.err}`);
  return { base, bin: join(dir, 'target', 'debug', 'deep-hook') };
}

async function idle(bin: string): Promise<number> {
  const { dir, home } = tempHome();
  const server = new Server(actions(bin), home, dir);
  await server.write(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3503', version: '0' } }) + request(2, 'tools/list'));
  const listed = await server.waitFor((l) => l.id === 2, 60_000);
  const rss = await server.rss();
  await server.end();
  if (!listed || !rss) throw Error(`BLOCKED: no idle reading of ${bin}: ${server.shown()}`);
  return rss;
}

async function underCap(bin: string): Promise<number> {
  const { dir, home } = tempHome();
  const server = new Server(actions(bin), home, dir);
  await server.write(`${pingOf(1, 8 * MIB)}\n`);
  const answered = await server.waitFor((l) => l.id === 1, 120_000);
  await server.end();
  if (answered?.result === undefined || !server.maxrss) throw Error(`BLOCKED: no peak reading of ${bin} for an 8 MiB request: ${server.shown()}`);
  return server.maxrss;
}

test(`${AC.budgets} on the reference Mac, deep-hook mcp actions' idle footprint and its peak for a request under the cap are no higher than the merge base's`, async (ctx: TestContext) => {
  const change = hookBinary();
  const { base, bin } = await baseHook();
  const readings: Record<string, { base: number[]; change: number[] }> = { idle: { base: [], change: [] }, 'peak for an 8 MiB request': { base: [], change: [] } };
  for (let i = 0; i < RUNS; i++) {
    for (const [side, path] of [['base', bin], ['change', change]] as const) {
      readings.idle![side].push(await idle(path));
      readings['peak for an 8 MiB request']![side].push(await underCap(path));
    }
  }
  const lines = Object.entries(readings).map(([name, r]) => {
    const top = Math.max(...r.base);
    const limit = top + Math.max(top * 0.05, 256 * 1024);
    return { name, limit, ok: r.change.every((x) => x <= limit), text: `${name}: change ${r.change.map(mb).join(', ')}; merge base ${base.slice(0, 9)} ${r.base.map(mb).join(', ')}; limit ${mb(limit)}` };
  });
  for (const line of lines) console.log(`${AC.budgets} reading: ${line.text}`);
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${lines.map((l) => l.text).join(' | ')}`);
  for (const line of lines) expect(line.ok, `the change's ${line.text}`).toBe(true);
}, LONG);
