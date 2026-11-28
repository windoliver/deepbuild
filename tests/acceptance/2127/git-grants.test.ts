import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { openRecord } from '@deepbuild/record';
import { openRunner } from '@deepbuild/runner';
import type { Exit, Grant, StartSpec, Supervisor } from '@deepbuild/supervisor';
import { expect, test } from 'vitest';

const GIT_GRANTS = '#2127.d74dbbf0';
const XCODE_FOLDERS = ['/var/db/xcode_select_link', '/Applications/Xcode.app/Contents/Developer', '/Library/Developer/CommandLineTools'];

interface Handed { argv: string[]; grant: Grant | undefined }

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function grantRecordingSupervisor(handed: Handed[]): Supervisor {
  const exits = new Map<string, Promise<Exit>>();
  return {
    name: 'grant-recording',
    async start(spec: StartSpec) {
      handed.push({ argv: [...spec.argv], grant: spec.grant === undefined ? undefined : structuredClone(spec.grant) });
      const env = spec.inherit === false ? { ...(spec.env ?? {}) } : { ...process.env, ...(spec.env ?? {}) };
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => { out.push(c); spec.output?.stdout(c); });
      child.stderr.on('data', (c: Buffer) => { err.push(c); spec.output?.stderr(c); });
      child.stdin.on('error', () => undefined);
      exits.set(spec.run, new Promise<Exit>((resolve) => {
        const done = (code: number | null, signal: NodeJS.Signals | null) => resolve({ run: spec.run, code, signal, evidence: { stdout: sha256(Buffer.concat(out)), stderr: sha256(Buffer.concat(err)) } });
        child.on('error', () => done(null, null));
        child.on('close', done);
      }));
      const input = typeof spec.input === 'function' ? spec.input() : spec.input;
      child.stdin.end(input);
      return { run: spec.run, status: 'started', pid: child.pid ?? 0, pgid: child.pid ?? 0, start: new Date().toISOString(), leases: [] };
    },
    async signal() {},
    wait: (run: string) => exits.get(run) ?? Promise.reject(Error(`no run ${run}`)),
    async facts() { return { host: 'grant-recording', platform: 'linux', arch: process.arch, cores: 1, memory: 0 }; },
    async cleanup(run: string) { return { run, outcome: 'clean', left: [], stopped: [] }; },
    async status(run: string) { return { run, state: exits.has(run) ? 'exited' : 'cleaned' }; },
    async lives() { return false; },
    used() { return undefined; },
    follow() {},
    async unfollow() { return undefined; },
    async tick() {},
    async close() {},
  };
}

function makeRepo(dir: string): { repo: string; commit: string } {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'base.txt'), 'the base commit\n');
  git('add', 'base.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
  return { repo, commit: git('rev-parse', 'HEAD') };
}

test(`${GIT_GRANTS} The runner's git steps on Linux are granted the repo and git's own folders, never /: with process.platform 'linux' and a supervisor that records its grants, no grant handed to start while the runner checks out a base commit holds / in read`, async () => {
  if (!existsSync('/usr/bin/git')) throw Error(`BLOCKED: ${GIT_GRANTS} needs git at /usr/bin/git, the git the runner runs on Linux; this machine is ${process.platform} without it`);
  const xcode = XCODE_FOLDERS.filter((f) => existsSync(f));
  if (xcode.length) throw Error(`BLOCKED: ${GIT_GRANTS} needs a machine with no Xcode developer folder, where the runner's git is /usr/bin/git as on Linux; this machine is ${process.platform} with ${xcode.join(', ')}`);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2127-git-')));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const developerDir = process.env.DEVELOPER_DIR;
  delete process.env.DEVELOPER_DIR;
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  const handed: Handed[] = [];
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  try {
    const { repo, commit } = makeRepo(dir);
    const home = join(dir, 'home');
    const emptyBin = join(dir, 'empty-bin');
    mkdirSync(home);
    mkdirSync(emptyBin);
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const ledger = await openLedger({ record, asks, now: Date.now, price: async () => 0.5 });
    const runner = await openRunner({
      record, asks, supervisor: grantRecordingSupervisor(handed), ledger, now: Date.now, root: join(dir, 'root'), loginPath: emptyBin,
      env: { HOME: home, PATH: '/usr/bin:/bin' }, settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 86_400_000 } } },
    });
    try {
      const rec = await runner.submit({ kind: 'draft', agent: 'claude-code', prompt: 'Draft.', checkout: { repo, commit } });
      const gitSteps = handed.filter((h) => h.argv[0] === '/usr/bin/git');
      if (gitSteps.length === 0) throw Error(`BLOCKED: ${GIT_GRANTS}: the runner handed no git step to start, so no checkout ran (job ${JSON.stringify({ state: rec.state, refused: rec.refused })})`);
      expect.soft(rec.refused ?? '', 'why the job was refused, which must not be its checkout').not.toMatch(/checkout failed/);
      expect.soft(existsSync(join(rec.folder, 'base.txt')) ? readFileSync(join(rec.folder, 'base.txt'), 'utf8') : 'missing', 'the base commit\'s file in the job\'s checkout').toBe('the base commit\n');
      expect.soft(gitSteps.map((h) => h.argv.find((a) => ['init', 'fetch', 'ls-tree', 'cat-file', 'read-tree'].includes(a))), 'the git steps of the checkout').toEqual(expect.arrayContaining(['init', 'fetch', 'ls-tree', 'cat-file']));
      const holdingRoot = handed.filter((h) => (h.grant?.read ?? []).includes('/')).map((h) => h.argv.slice(0, 4).join(' '));
      expect(holdingRoot, 'starts whose grant holds / in read').toEqual([]);
    } finally {
      await runner.close();
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
    if (developerDir !== undefined) process.env.DEVELOPER_DIR = developerDir;
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
