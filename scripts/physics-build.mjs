// The physics build's preflight (issue #2010; canvas primitives, World and backend: Rapier pinned at 0.36.1 with
// enhanced-determinism and serde-serialize, never simd8 or parallel, built "for the target's baseline features, never
// target-cpu=native or +fma", and it "can never build with fast math or features that change results"). It judges the
// build `cargo build --locked -p deep-physics-rapier --bin deep-physics <cargo arguments>` would make on this checkout
// and machine, without building it: the features cargo resolves for it, and every rustflags the environment or cargo's
// merged configuration gives its rustc runs. scripts/repo-rules.mjs runs it in the lint lane.
//
// Usage: node scripts/physics-build.mjs [<cargo argument> …]   (as `--features rapier3d/simd8` or
//        `--config 'build.rustflags=["-C", "target-cpu=native"]'`)
// Prints `PASS physics-build: …` and exits 0, or a `FAIL <flag>: <why>` line for each refused flag and exits 1.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const PINS = { rapier3d: '0.36.1', parry3d: '0.31.1' };
const REQUIRED = { rapier3d: ['enhanced-determinism'] };
// Features that change results or the cross-platform promise, by crate.
const REFUSED = {
  rapier3d: ['simd8', 'parallel', 'block-solver', 'fem', 'unsync-callbacks'],
  parry3d: ['simd8', 'parallel'],
  glam: ['fast-math'],
};
const FLAGS = [
  ['target-cpu=native', /target-cpu\s*=\s*native\b/],
  ['+fma', /target-feature\s*=\s*\S*\+fma\b/],
];

const args = process.argv.slice(2);
// `--config` is cargo's own and reaches `cargo config get` too; every argument reaches `cargo tree`.
const configArgs = args.flatMap((a, i) => (a === '--config' ? ['--config', args[i + 1]] : a.startsWith('--config=') ? [a] : []));
const fails = [];
const fail = (flag, why) => fails.push(`FAIL ${flag}: ${why}`);
const cargo = (cargoArgs, env = {}) => spawnSync('cargo', cargoArgs, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });

const tree = cargo(['tree', '--locked', '-p', 'deep-physics-rapier', '-e', 'normal', '--prefix', 'none', '-f', '{p}|{f}', ...args]);
if (tree.error || tree.status !== 0) {
  console.log(`FAIL cargo: cargo tree can't resolve the physics build: ${(tree.error?.message ?? tree.stderr).trim().split('\n').slice(-3).join(' ')}`);
  process.exit(1);
}
const resolved = new Map();
for (const line of tree.stdout.split('\n')) {
  const m = /^(\S+) v(\S+)[^|]*\|(\S*)/.exec(line.trim());
  if (m) resolved.set(`${m[1]}@${m[2]}`, { name: m[1], version: m[2], features: m[3] ? m[3].split(',') : [] });
}
const of = (name) => [...resolved.values()].filter((p) => p.name === name);
for (const [name, version] of Object.entries(PINS)) {
  const got = of(name).map((p) => p.version);
  if (got.length !== 1 || got[0] !== version) fail(name, `deep-physics-rapier resolves ${name} ${got.join(', ') || 'nowhere'}; the build pins ${version}`);
}
for (const [name, features] of Object.entries(REQUIRED)) {
  for (const p of of(name)) for (const f of features) if (!p.features.includes(f)) fail(f, `${name} ${p.version} resolves without ${f}, so its results aren't the pinned build's`);
}
for (const [name, features] of Object.entries(REFUSED)) {
  for (const p of of(name)) for (const f of features) if (p.features.includes(f)) fail(f, `${name} ${p.version} resolves ${f}, a feature that changes the physics build's results`);
}

// The rustflags each source would give the build's rustc: the environment's, then cargo's merged configuration's.
const flags = [];
for (const [k, v] of Object.entries(process.env)) {
  if (k === 'CARGO_ENCODED_RUSTFLAGS' && v) flags.push([k, v.split('\x1f').join(' ')]);
  else if (/^(RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(k) && v) flags.push([k, v]);
}
const conf = cargo([...configArgs, '-Zunstable-options', 'config', 'get', '--format', 'json'], { RUSTC_BOOTSTRAP: '1' });
if (conf.error || conf.status !== 0) {
  console.log(`FAIL cargo: cargo config get can't read the build's configuration: ${(conf.error?.message ?? conf.stderr).trim().split('\n').slice(-3).join(' ')}`);
  process.exit(1);
}
const walk = (v, path) => {
  if (path.endsWith('.rustflags') || path === 'rustflags') flags.push([path, Array.isArray(v) ? v.join(' ') : String(v)]);
  else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
};
walk(JSON.parse(conf.stdout.trim() || '{}'), '');
for (const [source, value] of flags) for (const [flag, re] of FLAGS) if (re.test(value)) fail(flag, `${source} gives the physics build's rustc ${value}; it builds for the target's baseline features`);

if (fails.length) {
  console.log(fails.join('\n'));
  process.exit(1);
}
const rapier = of('rapier3d')[0];
console.log(`PASS physics-build: rapier3d ${rapier.version} [${rapier.features.join(', ')}], parry3d ${of('parry3d')[0].version}, none of ${[...new Set(Object.values(REFUSED).flat())].join(', ')}, and no rustflags with target-cpu=native or +fma`);
