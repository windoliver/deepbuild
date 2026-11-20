// Issue #2175's cuts, measured: instructions retired (/usr/bin/time -l) by the release deep-hook for `--version` and
// for a forwarded PreToolUse Read with the hub away, built from the merge base as it is and with each cut's patch,
// 15 rounds, the variants interleaved run by run. Run from the repo root on macOS with cargo on PATH:
//   node docs/spikes/2175/measure.mjs            prints one JSON object: record.json's `cuts`
// Each variant is the merge base's Cargo.toml, Cargo.lock, rust-toolchain.toml, .cargo, crates, vendor and adapters
// (`git archive`), the cut's patch applied with `git apply`, built with `cargo build --release --locked -p deep-hook`
// into one shared target folder; the cuts that move the joined-hub route out build with --no-default-features.
// Every binary runs once before the timed rounds (macOS checks a new binary on its first launch). A Read run gets a
// fresh HOME with an empty ~/.deepbuild, so no hub answers and the call spools.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUNDS = 15;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));
const { fingerprint } = await import(join(REPO, 'scripts/benchmark.mjs'));
const VARIANTS = [
  { name: 'base', patch: null, features: [] },
  { name: 'cut-a', patch: 'cut-a-spawn.patch', features: [] },
  { name: 'cut-b', patch: 'cut-b-joined.patch', features: ['--no-default-features'] },
  { name: 'cut-ab', patch: 'cut-ab-both.patch', features: ['--no-default-features'] },
];

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => { const s = sorted(xs); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const load = () => execFileSync('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim();

const base = git('merge-base', 'HEAD', 'origin/main');
const work = mkdtempSync(join(tmpdir(), 'deep-2175-'));
const target = join(work, 'target');
const read = (home) => JSON.stringify({
  session_id: 'spike-2175', transcript_path: join(home, 'transcript.jsonl'), cwd: home,
  hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: join(home, 'a.txt') },
});

try {
  for (const v of VARIANTS) {
    const src = join(work, `src-${v.name}`);
    mkdirSync(src);
    const tar = join(work, `${v.name}.tar`);
    execFileSync('git', ['archive', '-o', tar, base, 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo', 'crates', 'vendor', 'adapters'], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', src]);
    rmSync(tar);
    if (v.patch) execFileSync('git', ['apply', join(HERE, v.patch)], { cwd: src });
    const build = spawnSync('cargo', ['build', '--release', '--locked', '-q', '-p', 'deep-hook', ...v.features], {
      cwd: src, env: { ...process.env, CARGO_TARGET_DIR: target }, encoding: 'utf8', maxBuffer: 1 << 26,
    });
    if (build.status !== 0) throw Error(`${v.name}: cargo build exited ${build.status}: ${build.stderr.slice(-3000)}`);
    mkdirSync(join(work, 'bin', v.name), { recursive: true });
    v.bin = join(work, 'bin', v.name, 'deep-hook');
    copyFileSync(join(target, 'release', 'deep-hook'), v.bin);
    rmSync(src, { recursive: true, force: true });
    v.imports = execFileSync('nm', ['-u', v.bin], { encoding: 'utf8' }).trim().split('\n').length;
    v.bytes = statSync(v.bin).size;
    execFileSync(v.bin, ['--version']); // first launch, untimed
    v.readings = { version: [], read: [] };
  }

  // One run: the instructions /usr/bin/time -l says the program retired, and its exit status.
  const timed = (bin, args, input, env) => {
    const r = spawnSync('/usr/bin/time', ['-l', bin, ...args], { input, env, encoding: 'utf8' });
    const m = r.stderr.match(/(\d+)\s+instructions retired/);
    if (r.status !== 0 || !m) throw Error(`${bin} ${args.join(' ')} exited ${r.status}: ${r.stderr.slice(-1000)}`);
    return Number(m[1]);
  };
  const loads = [];
  for (let round = 0; round < ROUNDS; round++) {
    // The order turns each round, so no variant always runs first.
    const order = VARIANTS.map((_, i) => VARIANTS[(i + round) % VARIANTS.length]);
    for (const v of order) {
      v.readings.version.push(timed(v.bin, ['--version'], '', { PATH: '/usr/bin:/bin', HOME: work }));
      const home = mkdtempSync(join(work, 'home-'));
      mkdirSync(join(home, '.deepbuild'));
      v.readings.read.push(timed(v.bin, ['claude-code', 'PreToolUse'], read(home), { PATH: '/usr/bin:/bin', HOME: home }));
    }
    loads.push(load());
  }

  const at = (v, k) => median(v.readings[k]);
  const [b] = VARIANTS;
  console.log(JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    machine: fingerprint(),
    command: 'node docs/spikes/2175/measure.mjs',
    method: `instructions retired as /usr/bin/time -l reports them for the release deep-hook, ${ROUNDS} rounds, each round running every variant in a turning order (interleaved run by run), each variant's --version and then a forwarded PreToolUse Read with the hub away (a fresh HOME with an empty ~/.deepbuild, so the call spools); the base side is the merge base with origin/main as it is, each cut is that commit with its patch applied; every binary ran once untimed after its build; the load averages after each round are recorded`,
    base,
    head: git('rev-parse', 'HEAD'),
    rustc: execFileSync('rustc', ['--version'], { cwd: REPO, encoding: 'utf8' }).trim(),
    loads,
    variants: Object.fromEntries(VARIANTS.map((v) => [v.name, {
      patch: v.patch && `docs/spikes/2175/${v.patch}`,
      build: ['cargo', 'build', '--release', '--locked', '-p', 'deep-hook', ...v.features].join(' '),
      imports: v.imports,
      bytes: v.bytes,
      medians: { version: at(v, 'version'), read: at(v, 'read') },
      againstBase: v === b ? null : { version: at(v, 'version') - at(b, 'version'), read: at(v, 'read') - at(b, 'read') },
      // Run against the base's run of the same round: the median of those differences, and in how many rounds the cut
      // retired fewer.
      paired: v === b ? null : Object.fromEntries(['version', 'read'].map((k) => {
        const d = v.readings[k].map((x, i) => x - b.readings[k][i]);
        return [k, { median: median(d), fewerIn: d.filter((x) => x < 0).length, of: d.length }];
      })),
      readings: v.readings,
    }])),
  }, null, 1));
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
