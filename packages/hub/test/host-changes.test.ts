// What a claim on a host changed (#3511), with the SSH link as the boundary: the script host-sessions.ts sends is run
// here by `sh -s` in a real repo, as the host's shell runs it there, and the gate runner judges the claim on its read.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import type { Connection } from '@deepbuild/record';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';
import { HostSessions } from '../src/host-sessions.js';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** The link's one call: the script on a shell's stdin with its arguments, as hosts.ts's sshScript gives it to the host's, whose environment adds `env`. */
const shell = (env: NodeJS.ProcessEnv = {}) => (_host: string, args: string[], script: string): Promise<{ code: number | null; stdout: string; stderr: string }> => new Promise((done) => {
  const child = spawn('sh', ['-s', '--', ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  child.on('close', (code) => done({ code, stdout, stderr }));
  child.stdin.end(`{\n${script}\n}\n`);
});

/**
 * A claim of a session on the host `gpu-box`: its folder there, alone in a temporary folder, holds `base` committed
 * (with `before` done first, at a fixed time), then `head` written over it and `there` done in it, `broken` making its
 * index no index; the host's shell runs with `env` added. Its one approved check ran there and exited 0, recording no read files, as a
 * run on a host does. Returns the claim's verdict.
 */
async function claimed(o: { base: Record<string, string>; head: Record<string, string>; broken?: boolean; before?: (git: (...args: string[]) => string, dir: string) => void; there?: (git: (...args: string[]) => string, dir: string) => void; link?: ReturnType<typeof shell>; env?: NodeJS.ProcessEnv }) {
  const root = mkdtempSync(join(tmpdir(), 'host-changes-'));
  dirs.push(root);
  const dir = join(root, 'repo');
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000' } }).toString().trim();
  const put = (files: Record<string, string>) => { for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); } };
  git('init', '-q', '-b', 'main');
  put(o.base);
  o.before?.(git, dir);
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  put(o.head);
  o.there?.(git, dir);
  if (o.broken) writeFileSync(join(dir, '.git', 'index'), 'not an index\n');
  const sessions = new HostSessions({ root: dir, hosts: { exec: o.link ?? shell(o.env), read: o.link ?? shell(o.env) } } as unknown as ConstructorParameters<typeof HostSessions>[0]);
  let gate: GateRunner;
  const options = {
    raw: async () => [], now: () => Date.now(), append: async () => undefined, core: {} as Connection,
    start: async () => 'run1',
    ended: async (run: string) => {
      gate.recorded(run, { run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null, exit: { code: 0, signal: null, cause: 'exit' }, output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } }, attempts: [], seeded: [], contract: null } as unknown as RecordedRun);
      return 'passed';
    },
    changesOn: (host: string, cwd: string, b: string, ms: number) => sessions.changes(host, cwd, b, ms),
    slots: () => ({ free: 1 }), budget_ms: 10_000, hold_ms: o.link ? 2_000 : 60_000, invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
  } as unknown as GateOptions;
  gate = new GateRunner(options);
  const check = { check: 'price-approved', approved: null, command: 'npm test', covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], expected_ms: 1, source: 'spec' as const };
  await gate.stop({ session: 'S', claim: 'claim:c', task: 'task:1', cwd: dir, base, requirements: [], checks: [check], stopAt: Date.now(), host: 'gpu-box' });
  return gate.verdictOf('claim:c');
}
const pkg = (test: string) => JSON.stringify({ scripts: { test } });
const BASE = { 'src/a.txt': 'export const a = 1;\n', 'price.txt': '20.00\n', 'tests/price_test.sh': 'compare\n', 'package.json': pkg('sh tests/price_test.sh') };

describe('what a claim on a host changed (#3511)', () => {
  it('an edited test file makes the approved check the agent\'s own, naming it: a run there records no read files, so each changed test file counts', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n', 'tests/price_test.sh': 'nothing\n' } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/price_test\.sh, which it may load \(its run on gpu-box records no read files\)/));
  }, 60_000);

  it('an untracked file under a test folder counts too, and so does a package.json whose scripts changed', async () => {
    const v = await claimed({ base: BASE, head: { 'tests/setup.sh': 'new\n', 'package.json': pkg('true') } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed package\.json, tests\/setup\.sh,/));
  }, 60_000);

  it('a claim that changed only the code under test, or package.json outside its scripts, passes, an empty test file and a link beside', async () => {
    const v = await claimed({ base: { ...BASE, 'tests/__init__.py': '' }, before: (_git, dir) => symlinkSync('price_test.sh', join(dir, 'tests/data')), head: { 'price.txt': '17.00\n', 'package.json': JSON.stringify({ name: 'cart', scripts: { test: 'sh tests/price_test.sh' } }) } });
    expect(v?.outcome, JSON.stringify(v?.reasons)).toBe('PASS');
  }, 60_000);

  it('a clean claim whose repo holds a submodule outside its test folders passes', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '17.00\n' }, before: (_git, dir) => {
      const sub = join(dir, 'vendor', 'sm');
      mkdirSync(sub, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: sub });
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'sub'], { cwd: sub });
    } });
    expect(v?.outcome, JSON.stringify(v?.reasons)).toBe('PASS');
  }, 60_000);

  it('a read that fails there never reads as no change: the check counts as the agent\'s own, naming the read', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '17.00\n' }, broken: true });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, git ls-files --cached --others --exclude-standard exited \d+/));
  }, 60_000);

  // Each a way the folder's own git could take an edited test file for the base's: the read compares bytes, so none does.
  const GUTTED = '[ "$(cat price.txt)" = 17.00 ] || exit 2\n';
  const hides: [string, (git: (...args: string[]) => string, dir: string) => void][] = [
    ['the index told to assume it unchanged', (git, dir) => { git('update-index', '--assume-unchanged', 'tests/price_test.sh'); writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED); }],
    ['the index told to skip it', (git, dir) => { git('update-index', '--skip-worktree', 'tests/price_test.sh'); writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED); }],
    ['the base replaced by a commit that holds the edit', (git, dir) => {
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
      git('add', '-A');
      const edited = git('commit-tree', git('write-tree'), '-m', 'edited');
      git('reset', '-q');
      git('replace', base, edited);
    }],
    ['a clean filter that gives back the base\'s bytes', (git, dir) => {
      writeFileSync(join(dir, '.git', 'info', 'attributes'), 'tests/price_test.sh filter=x\n');
      git('config', 'filter.x.clean', `git cat-file blob ${git('rev-parse', 'HEAD')}:tests/price_test.sh`);
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
    }],
    ['a working-tree encoding that reads the edit as the base\'s text', (_git, dir) => {
      writeFileSync(join(dir, '.git', 'info', 'attributes'), 'tests/price_test.sh working-tree-encoding=UTF-7\n');
      writeFileSync(join(dir, 'tests/price_test.sh'), 'c+AG8-mpare\n');
    }],
    ['a second, older pack in its store holding the test folder forged beside a tree of the base the newer one lacks', (git, dir) => {
      // Each git process searches the pack it last found an object in first, so a walk in path order and one in id order can find two copies of one id.
      const [src, tests, file] = ['HEAD:src', 'HEAD:tests', 'HEAD:tests/price_test.sh'].map((at) => git('rev-parse', at));
      const tree = (oid: string) => execFileSync('git', ['cat-file', 'tree', oid], { cwd: dir });
      const gutted = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: GUTTED }).toString().trim();
      const [genuine, forged] = [tree(src), Buffer.from(tree(tests).toString('hex').replace(file, gutted), 'hex')];
      execFileSync('git', ['pack-objects', '-q', '.git/objects/pack/pack'], { cwd: dir, input: `${git('rev-list', '--objects', '--all').split('\n').map((l) => l.split(' ')[0]).filter((oid) => oid !== src).join('\n')}\n` });
      git('prune-packed');
      rmSync(loose(dir, src));
      packed(dir, [[src, genuine], [tests, forged]]);
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
      rmSync(join(dir, '.git', 'index'));
      git('update-index', '--add', ...Object.keys(BASE));
    }],
    ['an edit of the same size with its file times put back, ctime not trusted', (git, dir) => {
      // An hour back, with the index written after it, so git takes the entry's times for the file's and reads no bytes.
      git('config', 'core.trustctime', 'false');
      const file = join(dir, 'tests/price_test.sh');
      const then = new Date(Date.now() - 3_600_000);
      utimesSync(file, then, then);
      git('add', 'tests/price_test.sh');
      writeFileSync(file, 'cOmpare\n');
      utimesSync(file, then, then);
    }],
  ];
  it.each(hides)('an edited test file is named though the folder\'s git is set to hide it: %s', async (_how, hide) => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n' }, there: hide });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/price_test\.sh, which it may load/));
  }, 60_000);

  it('a test folder\'s link pointed elsewhere is named, though the index is told to assume it unchanged', async () => {
    const v = await claimed({ base: { ...BASE, 'tests/b.txt': 'b\n' }, head: { 'price.txt': '18.00\n' }, before: (_git, dir) => symlinkSync('price_test.sh', join(dir, 'tests/data')), there: (git, dir) => {
      git('update-index', '--assume-unchanged', 'tests/data');
      rmSync(join(dir, 'tests/data'));
      symlinkSync('b.txt', join(dir, 'tests/data'));
    } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/data, which it may load/));
  }, 60_000);

  it('an added test file is named though the host\'s environment tells git to ignore it', async () => {
    const away = mkdtempSync(join(tmpdir(), 'host-env-'));
    dirs.push(away);
    writeFileSync(join(away, 'ignore'), 'tests/new_test.sh\n');
    const v = await claimed({ base: BASE, head: { 'tests/new_test.sh': 'new\n' }, env: { GIT_CONFIG_PARAMETERS: `'core.excludesfile'='${join(away, 'ignore')}'` } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/new_test\.sh, which it may load/));
  }, 60_000);

  it('a step of the read that fails there, as one does when the host\'s disk fills, ends it with no change set, though git is set to hide the edit', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'host-bin-'));
    dirs.push(bin);
    const awk = execFileSync('sh', ['-c', 'command -v awk']).toString().trim();
    writeFileSync(join(bin, 'awk'), `#!/bin/sh\ncase "$*" in *'ENVIRON["RE"]'*) exit 2 ;; esac\nexec ${awk} "$@"\n`, { mode: 0o755 });
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n' }, there: hides[0][1], env: { PATH: `${bin}:${process.env.PATH ?? ''}` } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, the read of what the claim changed didn't end/));
  }, 60_000);

  it('a folder whose git takes another folder for its work tree is no change set: nothing is known of it', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n' }, there: (git, dir) => { mkdirSync(join(dirname(dir), 'decoy')); git('config', 'core.worktree', join(dirname(dir), 'decoy')); } });
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, git there takes .* for the work tree, not the folder/));
  }, 60_000);

  // Each a way to make the folder's git show another tree than the one in it, or keep from looking in a folder: then
  // nothing is known of what changed.
  const loose = (dir: string, oid: string) => join(dir, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
  const forge = (dir: string, oid: string, kind: string, body: Buffer) => { chmodSync(loose(dir, oid), 0o644); writeFileSync(loose(dir, oid), deflateSync(Buffer.concat([Buffer.from(`${kind} ${body.length}\0`), body]))); };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const sha1 = (b: Buffer) => createHash('sha1').update(b).digest();
  /** A pack in the folder's store, older than its others, holding each of `trees` under the id given: its index can name any bytes by any id. */
  const packed = (dir: string, trees: [string, Buffer][]) => {
    const parts = [Buffer.from('PACK'), u32(2), u32(trees.length)];
    const entries = trees.map(([oid, body]) => {
      const head: number[] = [];
      let b = 0x20 | (body.length & 15);
      for (let n = body.length >> 4; n; n >>= 7) { head.push(b | 0x80); b = n & 0x7f; }
      head.push(b);
      const bytes = Buffer.concat([Buffer.from(head), deflateSync(body)]);
      const at = Buffer.concat(parts).length;
      parts.push(bytes);
      return { oid: Buffer.from(oid, 'hex'), crc: crc32(bytes), at };
    }).sort((x, y) => Buffer.compare(x.oid, y.oid));
    const pack = Buffer.concat(parts);
    const fan = Array.from({ length: 256 }, (_, i) => u32(entries.filter((e) => e.oid[0]! <= i).length));
    const idx = Buffer.concat([Buffer.from([0xff, 0x74, 0x4f, 0x63]), u32(2), ...fan, ...entries.map((e) => e.oid), ...entries.map((e) => u32(e.crc)), ...entries.map((e) => u32(e.at)), sha1(pack)]);
    const then = new Date('2020-01-01');
    for (const [ext, bytes] of [['pack', Buffer.concat([pack, sha1(pack)])], ['idx', Buffer.concat([idx, sha1(idx)])]] as const) {
      const file = join(dir, '.git', 'objects', 'pack', `pack-forged.${ext}`);
      writeFileSync(file, bytes);
      utimesSync(file, then, then);
    }
  };
  const blinds: [string, (git: (...args: string[]) => string, dir: string) => void, RegExp][] = [
    ['a repo of its own in the folder above, taken for the work tree', (git, dir) => {
      const up = dirname(dir);
      for (const [path, text] of Object.entries(BASE)) { mkdirSync(join(up, path, '..'), { recursive: true }); writeFileSync(join(up, path), text); }
      execFileSync('git', ['init', '-q'], { cwd: up });
      execFileSync('git', ['add', ...Object.keys(BASE)], { cwd: up });
      git('config', 'core.worktree', up);
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
    }, /holds a \.git of its own/],
    ['a repo of its own in a new folder', (_git, dir) => {
      mkdirSync(join(dir, 'x', 'tests'), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: join(dir, 'x') });
      writeFileSync(join(dir, 'x', 'conftest.py'), 'new\n');
    }, /git lists x\/ as a folder it did not look in/],
    ['the test folder swapped for a link to a copy of it with a file added', (_git, dir) => {
      const other = join(dirname(dir), 'other');
      renameSync(join(dir, 'tests'), other);
      writeFileSync(join(other, 'conftest.py'), 'new\n');
      symlinkSync(other, join(dir, 'tests'));
    }, /git lists tests as a folder it did not look in/],
    ['the folder inside a store of its own, whose work tree above holds the base\'s files', (_git, dir) => {
      const up = dirname(dir);
      for (const entry of readdirSync(join(dir, '.git'))) renameSync(join(dir, '.git', entry), join(up, entry));
      rmSync(join(dir, '.git'), { recursive: true });
      for (const [key, value] of [['core.bare', 'false'], ['core.worktree', up]]) execFileSync('git', ['--git-dir', up, 'config', key!, value!]);
      for (const [path, text] of Object.entries(BASE)) { mkdirSync(join(up, path, '..'), { recursive: true }); writeFileSync(join(up, path), text); }
      // And the folder itself kept from that work tree's listing, so only the copy above is read.
      writeFileSync(join(up, 'info', 'exclude'), '/repo/\n');
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
    }, /git there finds no work tree holding a \.git for the folder/],
    ['the base\'s test folder forged in the folder\'s own store', (git, dir) => {
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: GUTTED }).toString().trim();
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
      forge(dir, git('rev-parse', 'HEAD:tests'), 'tree', Buffer.concat([Buffer.from('100644 price_test.sh\0'), Buffer.from(blob, 'hex')]));
    }, /or a tree it holds there is not the object its id names/],
    ['the base\'s package.json forged in the folder\'s own store with the new scripts', (git, dir) => {
      writeFileSync(join(dir, 'package.json'), pkg('true'));
      forge(dir, git('rev-parse', 'HEAD:package.json'), 'blob', Buffer.from(pkg('true')));
    }, /holds no package\.json there that is the object its id names/],
    ['the base\'s commit graph and test folder forged to name the edited tree', (git, dir) => {
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
      git('add', '-A');
      const [real, edited, tests] = [git('rev-parse', 'HEAD^{tree}'), git('write-tree'), git('rev-parse', 'HEAD:tests')];
      git('commit-graph', 'write', '--reachable');
      const graph = join(dir, '.git', 'objects', 'info', 'commit-graph');
      const body = Buffer.from(readFileSync(graph).subarray(0, -20).toString('hex').replace(real, edited), 'hex');
      chmodSync(graph, 0o644);
      writeFileSync(graph, Buffer.concat([body, createHash('sha1').update(body).digest()]));
      forge(dir, tests, 'tree', execFileSync('git', ['cat-file', 'tree', git('rev-parse', `${edited}:tests`)], { cwd: dir }));
    }, /or a tree it holds there is not the object its id names/],
  ];
  it.each(blinds)('a folder whose git is kept from showing what changed is no change set: %s', async (_how, blind, why) => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n' }, there: blind });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(new RegExp(`price-approved counts as the agent's own: what the claim changed couldn't be read \\(on gpu-box, .*${why.source}`)));
  }, 60_000);

  it('a test file added beside one whose name differs only in case is named, though the folder\'s git ignores case', async () => {
    // Where the temporary folder folds case, the new name overwrites the old file: then that one is named.
    const probe = mkdtempSync(join(tmpdir(), 'host-case-'));
    dirs.push(probe);
    writeFileSync(join(probe, 'a'), '');
    const named = existsSync(join(probe, 'A')) ? /tests\/price_test\.sh/ : /tests\/Price_test\.sh/;
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n', 'tests/Price_test.sh': GUTTED }, there: (git) => { git('config', 'core.ignorecase', 'true'); } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(new RegExp(`price-approved counts as the agent's own: the claim changed ${named.source}, which it may load`)));
  }, 60_000);

  it('a changed test file whose name git still quotes is no change set: nothing is known of it', async () => {
    const v = await claimed({ base: { ...BASE, 'tests/a"b.sh': 'compare\n' }, head: { 'tests/a"b.sh': 'nothing\n' } });
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, git names a path it can't list plainly/));
  }, 60_000);

  it('an edited test file whose name git would quote is named plainly, and counts', async () => {
    const v = await claimed({ base: { ...BASE, 'tests/prix_é.sh': 'compare\n' }, head: { 'tests/prix_é.sh': 'nothing\n' } });
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/prix_é\.sh,/));
  }, 60_000);

  it('a link that never answers: the stop returns at its hold with the check still to run, and the claim has no verdict yet, never PASS', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '17.00\n' }, link: () => new Promise(() => undefined) });
    expect(v?.outcome, JSON.stringify(v)).toBe('pending');
    expect(v?.reasons).toEqual(['price-approved: runs still to come']);
  }, 60_000);
});
