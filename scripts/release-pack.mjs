#!/usr/bin/env node
// The release pack check (#41): packs the root package and every public workspace package from a clean
// checkout of one commit, reads each archive back from its own bytes, and requires its `bin`, `main` and
// every `exports` target (wildcards included) to resolve to a file in that archive. Only then does it
// write <out>/manifest.json with the commit and each archive's sha256. It never publishes anything.
//   node scripts/release-pack.mjs --repo <dir> --commit <sha> --out <dir> [--key <ed25519.pem> --preflight <report.json>]
// A release passes --key and --preflight together: the preflight report must say PASS on this very commit, and the
// manifest is signed with the offline key into manifest.json.sig. Without both it is the pack check alone, unsigned.
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fail = (message) => {
  console.error(`release-pack: ${message}`);
  process.exit(1);
};
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.error}`);
  return r.stdout;
};

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const [repoArg, commit, outArg] = [flag('repo'), flag('commit'), flag('out')];
if (!repoArg || !commit || !outArg) fail('usage: release-pack.mjs --repo <dir> --commit <sha> --out <dir>');
const repo = resolve(repoArg);
const out = resolve(outArg);

// One changed file, or another commit, refuses the run, naming it.
const head = run('git', ['rev-parse', 'HEAD'], repo).trim();
const wanted = run('git', ['rev-parse', `${commit}^{commit}`], repo).trim();
if (wanted !== head) fail(`the checkout is at ${head}, not the commit ${wanted} the release was asked to pack`);
const changed = run('git', ['status', '--porcelain', '--untracked-files=all'], repo).split('\n').filter(Boolean).map((l) => l.slice(3));
if (changed.length) fail(`the tree has changed files, so it is not commit ${head}: ${changed.join(', ')}`);

// A signed release only from a commit whose preflight passed, and never an unsigned release manifest.
const [keyArg, reportArg] = [flag('key'), flag('preflight')];
if (keyArg && !reportArg) fail('--key signs a release, which needs --preflight: the report of the preflight that passed on this commit');
if (reportArg && !keyArg) fail('--preflight is for a release, which needs --key: a release manifest is never left unsigned');
let key;
if (keyArg) {
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(reportArg), 'utf8'));
  } catch (error) {
    fail(`the preflight report ${resolve(reportArg)} can't be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (report?.verdict !== 'PASS') fail(`the preflight report's verdict is ${report?.verdict === undefined ? 'missing' : report.verdict}, not PASS, so nothing is released`);
  if (report.commit !== wanted) fail(`the preflight passed on ${report.commit}, not on ${wanted}, the commit asked to pack`);
  try {
    key = createPrivateKey(readFileSync(resolve(keyArg)));
  } catch (error) {
    fail(`the key ${resolve(keyArg)} isn't a private key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const work = mkdtempSync(join(tmpdir(), 'release-pack-'));
try {
  const clean = join(work, 'checkout');
  run('git', ['clone', '-q', '--no-hardlinks', repo, clean], work);
  run('git', ['checkout', '-q', '--detach', wanted], clean);

  const readJson = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const root = readJson(clean);
  const dirs = [clean];
  for (const glob of Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? [])) {
    const parent = join(clean, glob.replace(/\/\*$/, ''));
    if (glob.endsWith('/*') && existsSync(parent)) for (const d of readdirSync(parent)) if (statSync(join(parent, d)).isDirectory() && existsSync(join(parent, d, 'package.json'))) dirs.push(join(parent, d));
    else if (!glob.endsWith('/*') && existsSync(join(clean, glob, 'package.json'))) dirs.push(join(clean, glob));
  }

  const staged = join(work, 'archives');
  mkdirSync(staged);
  const archives = [];
  const problems = [];
  for (const dir of dirs) {
    const meta = readJson(dir);
    if (meta.private) continue;
    const [{ filename }] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', staged], dir));
    const file = join(staged, filename);
    // The archive's own listing, never the working tree's.
    const entries = new Set(run('tar', ['-tzf', file], work).split('\n').filter((e) => e.startsWith('package/') && !e.endsWith('/')).map((e) => e.slice('package/'.length)));
    const norm = (p) => p.replace(/^\.\//, '');
    const need = (label, target) => {
      const path = norm(target);
      if (path.includes('*')) {
        const re = new RegExp(`^${path.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
        if (![...entries].some((e) => re.test(e))) problems.push(`${meta.name}: ${label} ${target} matches no file in the archive`);
      } else if (!entries.has(path)) problems.push(`${meta.name}: ${label} ${target} is not in the archive`);
    };
    const targets = (value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(targets) : value && typeof value === 'object' ? Object.values(value).flatMap(targets) : []);
    for (const bin of typeof meta.bin === 'string' ? [meta.bin] : Object.values(meta.bin ?? {})) need('bin', bin);
    if (meta.main) need('main', meta.main);
    const exp = meta.exports;
    const map = typeof exp === 'string' || Array.isArray(exp) ? { '.': exp } : (exp ?? {});
    // A conditions object at the top level is the "." entry.
    const keyed = Object.keys(map).some((k) => k.startsWith('.')) ? map : { '.': map };
    for (const [key, value] of Object.entries(keyed)) for (const t of targets(value)) need(`exports entry ${key} ->`, t);
    archives.push({ name: meta.name, file: filename, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
  }
  if (problems.length) fail(`nothing was written or published:\n  ${problems.join('\n  ')}`);

  mkdirSync(out, { recursive: true });
  for (const a of archives) copyFileSync(join(staged, a.file), join(out, a.file));
  const manifest = Buffer.from(`${JSON.stringify({ commit: wanted, archives }, null, 2)}\n`);
  writeFileSync(join(out, 'manifest.json'), manifest);
  // Ed25519 over exactly the manifest's bytes, as the installer checks it.
  if (key) writeFileSync(join(out, 'manifest.json.sig'), sign(null, manifest, key));
  console.log(`release-pack: ${archives.length} archives from ${wanted} recorded in ${join(out, 'manifest.json')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
