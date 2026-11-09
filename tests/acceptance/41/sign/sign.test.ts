// AC7 #41 The parts of the release pack criterion that tests/acceptance/41/pack/pack.test.ts leaves open:
// the archives are packed "from a clean checkout of the commit its preflight report passed on", and "the signed
// manifest records each archive's sha256 and that commit". Design, How it installs: each package "is packed from a
// clean checkout of the commit whose preflight passed ... the signed manifest names that commit and each archive's
// hash"; Installs and updates: "the download is checked against a signed manifest".
//
// Surface assumed (issue and design name no command line; this extends the one pack.test.ts pins):
//   node scripts/release-pack.mjs --repo <dir> --commit <sha> --out <dir> --key <ed25519-private-key.pem> --preflight <report.json>
//   - --preflight <report.json>: a preflight report, JSON with at least { "commit": "<full sha>", "verdict": "PASS" }.
//     The run is refused when the report's verdict is not PASS (the message names that verdict), when its commit is
//     not --commit (the message names both shas), or when the file is missing or is not JSON (the message names
//     the path).
//   - --key <pem>: an Ed25519 private key, PKCS8 PEM. On success the run writes, besides <out>/manifest.json,
//     <out>/manifest.json.sig: the raw 64-byte Ed25519 signature over exactly manifest.json's bytes, verifiable with
//     node:crypto verify(null, bytes, publicKey, sig) against the key's public half.
//   - --key and --preflight come together: --preflight without --key is refused, naming --key (no unsigned release
//     manifest), and --key without --preflight is refused, naming --preflight. With neither, the run behaves as
//     pack.test.ts pins (that file passes neither and stays valid unchanged).
//   - any refusal: non-zero exit, a message on stdout or stderr, no manifest.json, no manifest.json.sig and no
//     tarball in <out>.
// The tests build tiny throwaway git repos (the fixture shape is copied from pack.test.ts, not imported), keep the
// key and the report outside the repo so the tree stays clean, and never pack this repository.

import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'scripts', 'release-pack.mjs');
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const ENV = {
  PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  npm_config_registry: 'http://127.0.0.1:9', // a publish could not succeed anywhere
};
const run = (cmd: string, args: string[], cwd: string) => spawnSync(cmd, args, { cwd, env: ENV, encoding: 'utf8' });
const git = (cwd: string, ...a: string[]) => {
  const r = run('git', a, cwd);
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

type Files = Record<string, string>;
const put = (root: string, files: Files) => {
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), body); }
};
const pkg = (o: object) => JSON.stringify({ version: '1.0.0', ...o }, null, 2);

const ROOT = 'deepbuild';
const DARWIN = '@deepbuild/deep-hook-darwin-arm64';
const LINUX = '@deepbuild/deep-hook-linux-x64';

function goodFiles(): Files {
  return {
    'package.json': pkg({ name: ROOT, bin: { deep: 'bin/deep.js' }, main: 'lib/index.js', workspaces: ['packages/*'],
      exports: { '.': './lib/index.js', './schemas/*': './schemas/*.json', './util': './lib/util.js' }, files: ['bin', 'lib', 'schemas'] }),
    'bin/deep.js': '#!/usr/bin/env node\nconsole.log("deep")\n',
    'lib/index.js': 'module.exports = {}\n', 'lib/util.js': 'module.exports = {}\n',
    'schemas/event.json': '{}\n', 'schemas/verdict.json': '{}\n',
    'packages/darwin/package.json': pkg({ name: DARWIN, os: ['darwin'], cpu: ['arm64'], bin: { 'deep-hook': 'bin/deep-hook' }, files: ['bin'] }),
    'packages/darwin/bin/deep-hook': 'binary-darwin\n',
    'packages/linux/package.json': pkg({ name: LINUX, os: ['linux'], cpu: ['x64'], bin: { 'deep-hook': 'bin/deep-hook' }, files: ['bin'] }),
    'packages/linux/bin/deep-hook': 'binary-linux\n',
  };
}

function makeRepo(files: Files = goodFiles()) {
  const dir = mkdtempSync(join(tmpdir(), 'dh41s-'));
  made.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  put(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  return { dir, repo, sha: git(repo, 'rev-parse', 'HEAD'), out: join(dir, 'out') };
}

// An Ed25519 key pair made in the test; the private half goes to a PKCS8 PEM file outside the repo.
function makeKey(dir: string, name = 'release-key.pem') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const path = join(dir, name);
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { path, publicKey };
}

function writeReport(dir: string, report: unknown, name = 'preflight.json') {
  const path = join(dir, name);
  writeFileSync(path, typeof report === 'string' ? report : JSON.stringify(report, null, 2));
  return path;
}

function pack(repo: string, commit: string, out: string, extra: string[]) {
  const r = run(process.execPath, [SCRIPT, '--repo', repo, '--commit', commit, '--out', out, ...extra], tmpdir());
  return { status: r.status, text: `${r.stdout}\n${r.stderr}`, manifest: join(out, 'manifest.json'), sig: join(out, 'manifest.json.sig') };
}

// What a refusal leaves in <out>: nothing that could be published or installed.
function leftovers(out: string) {
  const names = existsSync(out) ? readdirSync(out) : [];
  return names.filter((f) => f === 'manifest.json' || f === 'manifest.json.sig' || f.endsWith('.tgz'));
}

describe('AC7 #41.377b5cb2 The signed manifest records each archive\'s sha256 and the commit its preflight report passed on', { timeout: 120000 }, () => {
  it('AC7 #41.377b5cb2 a PASS report on the commit and a key give a manifest with that commit and each archive\'s sha256, signed over its exact bytes by the key\'s private half', () => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const report = writeReport(dir, { commit: sha, verdict: 'PASS' });
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).toBe(0);

    const bytes = readFileSync(r.manifest);
    const m = JSON.parse(bytes.toString('utf8'));
    expect(m.commit).toBe(sha);
    expect(m.archives.map((a: { name: string }) => a.name).sort()).toEqual([DARWIN, LINUX, ROOT].sort());
    for (const a of m.archives) {
      expect(readdirSync(out)).toContain(a.file);
      expect(a.sha256, `sha256 of ${a.file} must be that of the archive's bytes`).toBe(sha256(join(out, a.file)));
    }

    expect(existsSync(r.sig), 'manifest.json.sig must be written beside manifest.json').toBe(true);
    const sig = readFileSync(r.sig);
    expect(sig.length, 'a raw Ed25519 signature is 64 bytes').toBe(64);
    expect(verify(null, bytes, key.publicKey, sig), 'the signature must verify over manifest.json\'s exact bytes').toBe(true);
  });

  it('AC7 #41.377b5cb2 the signature binds the manifest: one byte changed after signing fails verification', () => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const report = writeReport(dir, { commit: sha, verdict: 'PASS' });
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).toBe(0);

    const bytes = readFileSync(r.manifest);
    const sig = readFileSync(r.sig);
    expect(verify(null, bytes, key.publicKey, sig)).toBe(true);

    const at = bytes.indexOf(Buffer.from(sha));
    expect(at, 'the manifest\'s bytes must hold the commit').toBeGreaterThanOrEqual(0);
    const changed = Buffer.from(bytes);
    changed[at] = changed[at] === 0x30 ? 0x31 : 0x30; // one hex digit of the commit
    expect(changed.equals(bytes)).toBe(false);
    expect(verify(null, changed, key.publicKey, sig), 'a manifest changed by one byte must fail verification').toBe(false);
  });
});

describe('AC7 #41.377b5cb2 The release packs only the commit its preflight report passed on', { timeout: 120000 }, () => {
  it.each(['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'INVALID'])('AC7 #41.377b5cb2 a report whose verdict is %s refuses the run, naming the verdict, and leaves no manifest, signature or tarball', (verdict) => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const report = writeReport(dir, { commit: sha, verdict });
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain(verdict);
    expect(leftovers(out)).toEqual([]);
  });

  it('AC7 #41.377b5cb2 a report with no verdict is refused, since nothing missing passes', () => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const report = writeReport(dir, { commit: sha });
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).not.toBe(0);
    expect(leftovers(out)).toEqual([]);
  });

  it('AC7 #41.377b5cb2 a PASS report on another commit refuses the run, naming both commits', () => {
    const { dir, repo, sha: first, out } = makeRepo();
    writeFileSync(join(repo, 'lib', 'util.js'), 'module.exports = { second: 1 }\n');
    git(repo, 'commit', '-q', '-am', 'two');
    const head = git(repo, 'rev-parse', 'HEAD');
    expect(head).not.toBe(first);
    const key = makeKey(dir);
    const report = writeReport(dir, { commit: first, verdict: 'PASS' }); // the preflight passed on the older commit
    const r = pack(repo, head, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain(first);
    expect(r.text).toContain(head);
    expect(leftovers(out)).toEqual([]);
  });

  it('AC7 #41.377b5cb2 a PASS report on the commit, with a changed file in the tree, refuses the run, naming the file', () => {
    const { dir, repo, sha, out } = makeRepo();
    writeFileSync(join(repo, 'lib', 'util.js'), 'module.exports = { changed: true }\n');
    const key = makeKey(dir);
    const report = writeReport(dir, { commit: sha, verdict: 'PASS' });
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('lib/util.js');
    expect(leftovers(out)).toEqual([]);
  });

  it('AC7 #41.377b5cb2 a missing report refuses the run, naming its path', () => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const missing = join(dir, 'no-such-preflight.json');
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', missing]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('no-such-preflight.json');
    expect(leftovers(out)).toEqual([]);
  });

  it('AC7 #41.377b5cb2 a report that is not JSON refuses the run, naming its path', () => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const report = writeReport(dir, `verdict: PASS\ncommit: ${sha}\n`, 'garbled-preflight.json');
    const r = pack(repo, sha, out, ['--key', key.path, '--preflight', report]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('garbled-preflight.json');
    expect(leftovers(out)).toEqual([]);
  });
});

describe('AC7 #41.377b5cb2 A release manifest is never unsigned: --key and --preflight come together', { timeout: 120000 }, () => {
  it('AC7 #41.377b5cb2 a PASS report without --key refuses the run, naming --key, and writes no manifest', () => {
    const { dir, repo, sha, out } = makeRepo();
    const report = writeReport(dir, { commit: sha, verdict: 'PASS' });
    const r = pack(repo, sha, out, ['--preflight', report]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('--key');
    expect(leftovers(out)).toEqual([]);
  });

  it('AC7 #41.377b5cb2 a key without --preflight refuses the run, naming --preflight, and writes no manifest', () => {
    const { dir, repo, sha, out } = makeRepo();
    const key = makeKey(dir);
    const r = pack(repo, sha, out, ['--key', key.path]);
    expect(r.status, r.text).not.toBe(0);
    expect(r.text).toContain('--preflight');
    expect(leftovers(out)).toEqual([]);
  });
});
