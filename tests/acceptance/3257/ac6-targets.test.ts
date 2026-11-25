// AC6 #3257.8b7b7fd8: "The chain's bytes are the same on macOS, on Linux and in the web player's wasm32 build, by hash"
//
// Four chains this issue makes (`JOBS`): 512 × 512 texels of random color and alpha at `alpha_cutoff` 0.5, at 0.3 and
// with none (a `blend` map), and the green fence at 0.5. Random colors reach every step of the sRGB curve, so a platform's own
// float function would show in some byte. A chain's hash is the SHA-256 of its bytes, every level end to end.
//   - macOS: the decode worker of this checkout's `deep-gpu`, as the other files drive it;
//   - the web player: the committed wasm32 build, `crates/deep-player/web/dist/full/` (its `player.json` names the
//     wasm's SHA-256, checked here), run by Node in a process of its own through its glue's `map_chain` (README: The
//     surface under test). A wasm older than the crate's code gives other bytes and fails;
//   - Linux: the decode worker of `deep-show` built at this commit on `DEEP_LINUX_AARCH64` (an ssh destination) in
//     `DEEP_LINUX_AARCH64_DIR` (a checkout there), as #172's and #2892's Linux legs are; INCONCLUSIVE without them.
// Both tests hold the hashes to macOS's, so off macOS they are INCONCLUSIVE. Each also requires the chains to be this
// issue's: the 0.5 and 0.3 chains differ from each other and from the chain with no cutoff.
// Wrong programs: the base (no `map_chain`; a cutoff that changes nothing); a platform's own pow in a mask chain's
// colors; a player built before the change.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, inconclusive, none, sha256, shown, useDir, useGpu, type JsonObject, type JsonValue } from '../1634/helpers.ts';
import { greenFence, noise } from './chains.ts';
import { AC, gitEnv, jobLine, transcode, writeMap, type Job } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const JOBS: Job[] = [
  { name: 'noise-0.5', map: noise(), cutoff: 0.5 }, { name: 'noise-0.3', map: noise(), cutoff: 0.3 },
  { name: 'noise-none', map: noise() }, { name: 'green-0.5', map: greenFence(), cutoff: 0.5 },
];
const DIST = join(REPO, 'crates', 'deep-player', 'web', 'dist', 'full');

/** macOS's hashes by job, and the faults that say they aren't this issue's chains. */
function onMac(): { hashes: string[]; faults: string[] } {
  if (process.platform !== 'darwin') inconclusive(`the hashes are held to macOS's, and this is ${process.platform}`);
  const hashes = transcode(bin(), dir(), JOBS).map((m) => sha256(m.data));
  console.log(`${AC[6]}: macOS: ${JOBS.map((j, i) => `${j.name} ${hashes[i]!.slice(0, 16)}`).join(', ')}`);
  const faults = new Set(hashes.slice(0, 3)).size === 3 ? [] : [`macOS: the noise's chains at cutoff 0.5, at 0.3 and with none are ${new Set(hashes.slice(0, 3)).size} distinct chains, not three`];
  return { hashes, faults };
}
const apart = (where: string, got: readonly JsonValue[], want: readonly string[]): string[] =>
  JOBS.flatMap((j, i) => (got[i] === want[i] ? [] : [`${where}: ${j.name} hashes ${shown(got[i])}, where macOS's chain hashes ${want[i]!}`]));

describe(`${AC[6]} the chain's bytes are the same everywhere`, () => {
  it(`${AC[6]} in the web player's wasm32 build each chain hashes as macOS's does`, () => {
    const wasm = readFileSync(join(DIST, 'player_bg.wasm'));
    const record = JSON.parse(readFileSync(join(DIST, 'player.json'), 'utf8')) as JsonObject;
    expect((record['files'] as JsonObject)['player_bg.wasm'], 'player.json names the wasm this test runs').toBe(sha256(wasm));
    const script = `
      import { createHash } from 'node:crypto';
      import { readFileSync } from 'node:fs';
      const [glueUrl, wasm, jobs] = JSON.parse(process.argv[1]);
      const glue = await import(glueUrl);
      await glue.default({ module_or_path: readFileSync(wasm) });
      const out = typeof glue.map_chain !== 'function' ? null
        : jobs.map(({ path, role, cutoff }) => createHash('sha256').update(glue.map_chain(readFileSync(path), role, cutoff ?? undefined)).digest('hex'));
      process.stdout.write(JSON.stringify(out));
    `;
    const at = dir();
    const jobs = JOBS.map((j) => ({ path: writeMap(at, j.name, j.map).path, role: j.role ?? 'base_color', cutoff: j.cutoff ?? null }));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([pathToFileURL(join(DIST, 'player.js')).href, join(DIST, 'player_bg.wasm'), jobs])], { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 1 << 24 });
    expect(run.status, `the player's wasm ran in Node: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
    const got = JSON.parse(run.stdout) as string[] | null;
    expect(got, 'the full player\'s glue exports map_chain(bytes, role, alpha_cutoff) (README: The surface under test)').not.toBeNull();
    const { hashes, faults } = onMac();
    none([...faults, ...apart('wasm32', got!, hashes)], 'the web player\'s chains against macOS\'s');
  }, TIMEOUT);

  it(`${AC[6]} on Linux each chain hashes as macOS's does; with no Linux host named, INCONCLUSIVE`, () => {
    const host = process.env['DEEP_LINUX_AARCH64'];
    const there = process.env['DEEP_LINUX_AARCH64_DIR'];
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', env: gitEnv() }).stdout.trim();
    if (!host || !there) inconclusive(`no Linux host is named: set DEEP_LINUX_AARCH64 to an ssh destination and DEEP_LINUX_AARCH64_DIR to a checkout of ${head} there with cargo, then rerun`);
    const { hashes, faults } = onMac();
    // Ship the PNGs and the jobs; the remote checks it is at this commit, builds deep-show, runs its decode worker on
    // the jobs and sends back each chain's SHA-256 in the jobs' order.
    const at = dir();
    const lines = JOBS.map((j) => { writeMap(at, j.name, j.map); return JSON.stringify(jobLine(j, `@ROOT@/${j.name}.png`, `@ROOT@/${j.name}.chain`)); });
    const tar = spawnSync('tar', ['-cf', '-', '-C', at, ...JOBS.map((j) => `${j.name}.png`)], { maxBuffer: 1 << 28 });
    const remote = [
      'set -e', 'r=$(mktemp -d)', 'tar -xf - -C "$r"', `cd ${JSON.stringify(there)}`,
      `h=$(git rev-parse HEAD); if [ "$h" != ${head} ]; then echo "the checkout is at $h, not ${head}" >&2; exit 3; fi`,
      '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"', 'cargo build --locked --bin deep-show >&2',
      `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(' ')} | sed "s|@ROOT@|$r|g" | target/debug/deep-show decode-worker >&2`,
      ...JOBS.map((j) => `sha256sum < "$r/${j.name}.chain" | cut -d' ' -f1`), 'rm -rf "$r"',
    ].join('\n');
    const script = Buffer.from(remote, 'utf8').toString('base64');
    const run = spawnSync('ssh', ['-o', 'BatchMode=yes', host!, `sh -c "$(printf %s ${script} | base64 -d)"`], { input: tar.stdout, maxBuffer: 1 << 24, timeout: TIMEOUT - 300_000 });
    if (run.status === 255) inconclusive(`ssh to ${host} failed: ${String(run.stderr).slice(-800)}`);
    if (run.status === 3) inconclusive(`${String(run.stderr).trim().split('\n').at(-1)}: check out ${head} at ${there} on ${host}`);
    expect(run.status, `the Linux decode worker ran: ${String(run.stderr).slice(-1500)}`).toBe(0);
    none([...faults, ...apart('Linux', String(run.stdout).trim().split('\n'), hashes)], 'Linux\'s chains against macOS\'s');
  }, TIMEOUT);
});
