// Base-commit runs (#31; design: Fail before, pass after, Pinned to a commit, A base with nothing to start): the gate
// runner's service for every check kind. It writes a claim's snapshot to DeepBuild's own object store, reading the
// repo's objects as alternates, and makes temporary checkouts of the snapshot and of the merge base, so your index,
// refs, objects, stash and other worktrees stay as they were and nothing is fetched. Any kind's run gets its checkout
// here, so replacing the command check keeps base runs. The verdict is the verdict engine's; this module says only
// what a base run proved. A checkout goes once no run on it is running or queued, and a crash's goes at the next open.
import { execFile, spawn } from 'node:child_process';
import { constants, existsSync, lstatSync, readFileSync } from 'node:fs';
import { appendFile, chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import type { CheckResult, CheckRunnerFill, CheckSpec, Failure } from '@deepbuild/conformance';
import type { LeaseTable } from '@deepbuild/leases';
import type { Supervisor } from '@deepbuild/supervisor';
import { moreRuns, verdict, type BaseResult, type Result, type Run } from '@deepbuild/verdicts';
import { matches } from './glob.js';

export type CheckoutPlant =
  | 'base-in-command-check' | 'any-nonzero-base-exit' | 'any-failure-of-collected-test' | 'snapshot-through-index' | 'snapshot-into-repo' | 'keeps-skip-worktree'
  | 'links-dependencies' | 'stands-in-always' | 'stamps-time' | 'keeps-every-snapshot' | 'drops-decisions' | 'removes-at-session-end';
export interface CheckoutsOptions { store: string; root: string; kinds: CheckRunnerFill[]; host: Supervisor; leases: LeaseTable; now(): number; plant?: CheckoutPlant }
export interface Snapshot { commit: string; wrote: boolean }
export interface TempCheckout { dir: string; commit: string }
export type DeclaredSurface =
  | { check: string; kind: 'service'; routes: string[]; format: 'json' }
  | { check: string; kind: 'page'; routes: string[] }
  | { check: string; kind: 'command'; name: string }
  | { check: string; kind: 'module'; path: string; exports: string[] }
  | { check: string; kind: string };
export interface StandIn { check: string; kind: string; hash: string; port?: number; run?: string; bin?: string }
export interface BaseCheckout extends TempCheckout { standIns: StandIn[] }
export interface ClaimCheckInput { check: string; spec: CheckSpec; deadline: number; on_base: 'fails' | 'passes'; own: string[]; asserts?: string[] }
export interface ClaimInput { claim: string; worktree: string; onto: string; checks: ClaimCheckInput[]; dependencies?: string[]; baseDependencies?: string[]; earlier?: ClaimRun[] }
export interface BaseRun extends CheckResult { checkout: string; on_assertion: boolean }
export interface ClaimCheckRun { check: string; digest: string; carried: boolean; head: CheckResult; base: BaseRun | null }
export interface ClaimRun { claim: string; snapshot: string; verdict: Result; reasons: string[]; smallest: string | null; checks: ClaimCheckRun[] }
export interface Cited { open_claims: string[]; open_asks: string[]; kept_evidence: { snapshot: string; behind_decision: boolean }[] }
export interface Checkouts {
  snapshot(worktree: string): Promise<Snapshot>;
  checkout(r: { worktree: string; commit: string; dependencies?: string[]; runs: string[] }): Promise<TempCheckout>;
  baseCheckout(r: { worktree: string; onto: string; claim: string; own: string[]; dependencies?: string[]; surfaces?: DeclaredSurface[]; runs: string[] }): Promise<BaseCheckout>;
  ended(checkout: TempCheckout, run: string): Promise<void>;
  runClaim(claim: ClaimInput): Promise<ClaimRun>;
  prune(cited: Cited): Promise<{ removed: string[] }>;
  close(): Promise<void>;
}

const RETENTION_MS = 30 * 86_400_000;
const SNAPSHOTS = 'refs/deep/snapshots/';
/** A file this big is cloned from the worktree, when its bytes are the blob's, rather than written out. */
const BIG = 1 << 20;
const FIXED = { GIT_AUTHOR_NAME: 'DeepBuild', GIT_AUTHOR_EMAIL: 'snapshot@deepbuild.invalid', GIT_COMMITTER_NAME: 'DeepBuild', GIT_COMMITTER_EMAIL: 'snapshot@deepbuild.invalid' };
const FIXED_DATE = '2000-01-01T00:00:00Z';
/** A link of these names is a shared install, not part of a claim: `node_modules/` as a pattern doesn't ignore a link. */
const INSTALLS = ['node_modules', '.venv'];

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string): Promise<string> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...clean, GIT_NO_LAZY_FETCH: '1', GIT_LFS_SKIP_SMUDGE: '1', ...env } }, (error, stdout, stderr) => {
      if (error) reject(Error(`git ${args[0]}: ${stderr.trim() || error.message}`));
      else resolve(stdout.trim());
    });
    if (input !== undefined) child.stdin!.end(input);
  });
}
const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const inside = (path: string): boolean => !isAbsolute(path) && !normalize(path).startsWith('..');

// ---- What a base run proved.
/** The deadline a check names in `asserts`, as `deadline:5s`. */
const namesDeadline = (asserts: string[] | undefined): boolean => asserts?.some((a) => a.startsWith('deadline:')) ?? false;
/** A failure at an assertion its check names: one of `asserts`, or with no such list any assertion in its own files. */
function atNamed(f: Failure, c: Pick<ClaimCheckInput, 'own' | 'asserts'>): boolean {
  if (!f.assertion) return false;
  if (c.asserts?.length) return c.asserts.includes(`${f.file}:${f.line}`);
  return !c.own.length || c.own.some((o) => f.file === o || f.file.startsWith(`${o}/`));
}
/** Whether a run on the base proves the fix, and why not: only a test that started and failed at a named assertion, or overran a named deadline. */
export function baseProof(r: CheckResult, c: Pick<ClaimCheckInput, 'own' | 'asserts'>, plant?: CheckoutPlant): { on_assertion: boolean; why: string | null } {
  if (r.outcome === 'passed') return { on_assertion: false, why: 'passes on the merge base, so it can\'t prove the fix' };
  if (plant === 'any-nonzero-base-exit') return { on_assertion: true, why: null };
  const started = r.testsRun > 0 || r.failures.some((f) => f.test !== '(run)' && f.file !== '.') && r.outcome === 'overran';
  if (plant === 'any-failure-of-collected-test' && started) return { on_assertion: true, why: null };
  if (r.outcome === 'stopped' || r.outcome === 'uncounted') return { on_assertion: false, why: `its run on the base ended ${r.outcome}, so it proves nothing` };
  if (!started) return { on_assertion: false, why: 'failed on the base before its tests ran' };
  if (r.outcome === 'overran' && namesDeadline(c.asserts) && r.failures.some((f) => f.unended)) return { on_assertion: true, why: null };
  if (r.failures.some((f) => atNamed(f, c))) return { on_assertion: true, why: null };
  const f = r.failures[0];
  if (!f) return { on_assertion: false, why: r.outcome === 'overran' ? 'failed on the base only elsewhere: overran with no deadline named' : 'failed on the base before its tests ran' };
  const name = r.outcome === 'overran' ? 'overran' : /^\s*(\w*Error)\b/m.exec(f.stack ?? '')?.[1] ?? f.message;
  return { on_assertion: false, why: `failed on the base only elsewhere: ${name} at ${f.file}:${f.line}` };
}

// ---- A base with nothing to start: one fixed form per kind.
const SERVICE = (type: string, body: string): string => `import { createServer } from 'node:http';\ncreateServer((_, res) => { res.writeHead(200, { 'content-type': '${type}' }); res.end(${JSON.stringify(body)}); }).listen(Number(process.env.PORT), '127.0.0.1');\n`;
const FORMS = {
  service: SERVICE('application/json', '{}'),
  page: SERVICE('text/html', '<!doctype html><html><head></head><body></body></html>'),
  command: '#!/bin/sh\nexit 0\n',
};
const moduleForm = (exports: string[]): string => exports.map((name) => `export function ${name}() {}\n`).join('');
const PACKAGE_FILES = ['package.json', 'go.mod', 'pyproject.toml', 'Cargo.toml'];
const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
/** Whether the base already has an entry point of the kind a surface enters through; one with no fixed form is no stand-in's. */
function hasEntry(dir: string, s: DeclaredSurface): boolean {
  let pkg: { scripts?: Record<string, unknown>; bin?: unknown } = {};
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as typeof pkg; } catch { /* no package */ }
  if (s.kind === 'service' || s.kind === 'page') return ['start', 'dev', 'serve'].some((n) => typeof pkg.scripts?.[n] === 'string') || COMPOSE.some((f) => existsSync(join(dir, f)));
  if (s.kind === 'command' && 'name' in s) {
    const program = s.name.trim().split(/\s+/)[0]!;
    const bin = typeof pkg.bin === 'object' && pkg.bin !== null && program in pkg.bin;
    return bin || typeof pkg.scripts?.[program] === 'string' || existsSync(join(dir, 'bin', program));
  }
  if (s.kind === 'module' && 'path' in s) {
    if (existsSync(join(dir, s.path))) return true;
    for (let at = dirname(s.path); ; at = dirname(at)) {
      if (PACKAGE_FILES.some((f) => existsSync(join(dir, at, f)))) return true;
      if (at === '.' || at === '/') return false;
    }
  }
  return true;
}
const listening = async (port: number): Promise<boolean> => new Promise((resolve) => {
  const sock = connect(port, '127.0.0.1');
  sock.once('connect', () => { sock.destroy(); resolve(true); });
  sock.once('error', () => resolve(false));
});

interface Live { dir: string; runs: Set<string>; standIns: StandIn[] }

const chmodAll = (dir: string): Promise<number | null> => new Promise((resolve) => {
  const child = spawn('/bin/chmod', ['-R', 'u+rwX', dir], { stdio: 'ignore' });
  child.on('error', () => resolve(null));
  child.on('close', resolve);
});

/** Removes a checkout, a read-only folder in it included: `chmod -R` doesn't follow the links it meets. */
const clear = async (dir: string): Promise<void> => {
  await rm(dir, { recursive: true, force: true }).catch(async () => {
    await chmodAll(dir);
    await rm(dir, { recursive: true, force: true });
  });
};

/** Opens the service: makes the store, and removes whatever checkout a crash left in `root`. */
export async function openCheckouts(given: CheckoutsOptions): Promise<Checkouts> {
  const o: CheckoutsOptions = { ...given, plant: given.plant ?? 'removes-at-session-end' };
  await mkdir(o.store, { recursive: true });
  if (!existsSync(join(o.store, 'HEAD'))) await git(o.store, ['init', '-q', '--bare', '.']);
  await mkdir(o.root, { recursive: true });
  const root = await realpath(o.root);
  await Promise.all((await readdir(root)).map((name) => clear(join(root, name))));
  const objects = join(o.store, 'objects');
  const live = new Map<string, Live>();
  // Snapshots and the prune each touch the store's objects: one at a time, so a prune never takes what a snapshot is still writing.
  let turn: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };
  const inStore = (args: string[], input?: string): Promise<string> => git(o.store, [`--git-dir=${o.store}`, ...args], {}, input);

  /** The repo seen with DeepBuild's store as its object folder: what's written goes to the store, and its own objects read through. */
  const repoEnv = async (repo: string): Promise<NodeJS.ProcessEnv> => {
    const common = await git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const theirs = join(common, 'objects');
    // The store's own reads (a snapshot's tree, its carry) reach the repo's objects as alternates too.
    const file = join(objects, 'info', 'alternates');
    const known = existsSync(file) ? await readFile(file, 'utf8') : '';
    if (!known.split('\n').includes(theirs)) { await mkdir(dirname(file), { recursive: true }); await appendFile(file, `${theirs}\n`); }
    return { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: theirs };
  };
  const refOf = async (commit: string): Promise<string | undefined> =>
    (await inStore(['for-each-ref', '--format=%(refname)', SNAPSHOTS])).split('\n').find((r) => r.endsWith(`/${commit}`));

  /** A session may sit in a subfolder; every path and git call here is from the repo's top. */
  const topOf = (folder: string): Promise<string> => git(folder, ['rev-parse', '--show-toplevel']);

  const snapshot = (folder: string): Promise<Snapshot> => serial(async () => {
    const worktree = await topOf(folder);
    const head = await git(worktree, ['rev-parse', 'HEAD']);
    const gitDir = await git(worktree, ['rev-parse', '--absolute-git-dir']);
    const dir = await mkdtemp(join(o.store, 'index-'));
    try {
      const index = join(dir, 'index');
      const store = o.plant === 'snapshot-into-repo' ? {} : await repoEnv(worktree);
      const env = { ...store, ...(o.plant === 'snapshot-through-index' ? {} : { GIT_INDEX_FILE: index }) };
      if (existsSync(join(gitDir, 'index'))) {
        await writeFile(index, await readFile(join(gitDir, 'index')));
        // The copy keeps the index's time: git reads a file edited in that second by its bytes only by comparing the two.
        const { atime, mtime } = await stat(join(gitDir, 'index'));
        await utimes(index, atime, mtime);
      } else await git(worktree, ['read-tree', 'HEAD'], env);
      if (o.plant !== 'keeps-skip-worktree') {
        // Marks hide a change from `add`: cleared in the copy, each by its own option, since one call applies only its first.
        // One missing from disk keeps its mark, or `add` would read a sparse checkout's absent files as deleted.
        const lines = (await git(worktree, ['ls-files', '-v', '-z'], env)).split('\0').filter(Boolean);
        const marked = (test: (tag: string) => boolean): string => lines.filter((l) => test(l[0]!) && existsSync(join(worktree, l.slice(2)))).map((l) => l.slice(2)).join('\0');
        const skip = marked((t) => t === 'S' || t === 's');
        const assumed = marked((t) => t >= 'a' && t <= 'z');
        if (skip) await git(worktree, ['update-index', '--no-skip-worktree', '-z', '--stdin'], env, skip);
        if (assumed) await git(worktree, ['update-index', '--no-assume-unchanged', '-z', '--stdin'], env, assumed);
      }
      await git(worktree, ['add', '-A'], env);
      const untracked = (await git(worktree, ['ls-files', '-o', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
      const links = untracked.filter((p) => INSTALLS.includes(basename(p)) && lstatSync(join(worktree, p)).isSymbolicLink());
      if (links.length) await git(worktree, ['update-index', '--force-remove', '-z', '--stdin'], env, links.join('\0'));
      const tree = await git(worktree, ['write-tree'], env);
      if (tree === await git(worktree, ['rev-parse', `${head}^{tree}`])) return { commit: head, wrote: false };
      const date = o.plant === 'stamps-time' ? new Date().toISOString() : FIXED_DATE;
      const commit = await git(worktree, ['commit-tree', tree, '-p', head, '-m', 'deep snapshot'], { ...env, ...FIXED, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      if (o.plant === 'snapshot-into-repo') return { commit, wrote: true };
      const known = await refOf(commit);
      // Written again: its 30 days start over, so a new claim on old bytes never loses its snapshot.
      if (known) await inStore(['update-ref', '-d', known]);
      await inStore(['update-ref', `${SNAPSHOTS}${Math.floor(o.now())}/${commit}`, commit]);
      if (known) return { commit, wrote: false };
      return { commit, wrote: true };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /** Clones the ignored folders named, and any of those names deeper down, into a checkout from the worktree: copy-on-write where the file system can, never linked. */
  const cloneIn = async (worktree: string, dir: string, folders: string[]): Promise<void> => {
    const links = folders.length ? (await git(worktree, ['ls-files', '-o', '--exclude-standard', '-z'])).split('\0').filter((p) => p && folders.includes(basename(p)) && lstatSync(join(worktree, p)).isSymbolicLink()) : [];
    const deeper = folders.length ? (await git(worktree, ['ls-files', '-oi', '--exclude-standard', '--directory', '-z'])).split('\0').flatMap((p) => {
      const parts = p.split('/');
      const at = parts.findIndex((part) => folders.includes(part));
      return at < 0 ? [] : [parts.slice(0, at + 1).join('/')];
    }) : [];
    for (const folder of new Set([...folders, ...deeper, ...links])) {
      if (!inside(folder) || !existsSync(join(worktree, folder))) continue;
      // Git doesn't call a folder ignored once it tracks a file in it, though the rest of it still is.
      const linked = lstatSync(join(worktree, folder)).isSymbolicLink();
      const ignored = linked || await git(worktree, ['check-ignore', '-q', folder]).then(() => true, () => false) || !!await git(worktree, ['ls-files', '-oi', '--exclude-standard', '--directory', '--', folder]);
      if (!ignored) continue;
      await mkdir(dirname(join(dir, folder)), { recursive: true });
      if (o.plant === 'links-dependencies') { await symlink(join(worktree, folder), join(dir, folder)); continue; }
      // A folder that is itself a link is cloned from where it points, so nothing written here reaches it.
      const source = await realpath(join(worktree, folder));
      const copy = (args: string[]): Promise<number | null> => new Promise((resolve) => {
        const child = spawn('/bin/cp', [...args, source, join(dir, folder)], { stdio: 'ignore' });
        child.on('error', () => resolve(null));
        child.on('close', resolve);
      });
      const cow = process.platform === 'darwin' ? ['-cR'] : ['-R', '--reflink=auto'];
      if (await copy(cow) !== 0) {
        await rm(join(dir, folder), { recursive: true, force: true });
        if (await copy(['-R']) !== 0) throw Error(`can't copy ${folder} into the checkout`);
      }
      // A read-only folder keeps its mode in the clone, where the tree's files must still go.
      await chmodAll(join(dir, folder));
      // What isn't ignored in it comes from the tree alone, so a file only the worktree has isn't left behind.
      // A link the clone keeps on the way to one is removed itself: never what it points at.
      for (const path of (await git(worktree, ['ls-files', '-co', '--exclude-standard', '-z', '--', folder])).split('\0').filter((p) => p && p !== folder)) await rm(linkOn(dir, path) ?? join(dir, path), { recursive: true, force: true });
    }
  };
  /** The first link on the way to `path` in `dir`, if there is one. */
  const linkOn = (dir: string, path: string): string | undefined => {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const at = join(dir, ...parts.slice(0, i));
      if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) return at;
    }
    return undefined;
  };
  /**
   * Writes `tree` into `dir`. A big file whose blob the worktree's bytes are is cloned from there, then its clone hashed
   * against the blob, so a later edit can't reach the checkout; anything else git writes out.
   */
  const materialize = async (worktree: string, env: NodeJS.ProcessEnv, tree: string, dir: string): Promise<void> => {
    const holder = await mkdtemp(join(o.store, 'index-'));
    try {
      const indexed = { ...env, GIT_INDEX_FILE: join(holder, 'index') };
      await git(worktree, ['read-tree', tree], indexed);
      const entries = (await git(worktree, ['ls-tree', '-r', '-l', '-z', tree], env)).split('\0').filter(Boolean).map((l) => {
        const [meta, path] = [l.slice(0, l.indexOf('\t')), l.slice(l.indexOf('\t') + 1)];
        const [mode, type, blob, size] = meta.trim().split(/\s+/) as [string, string, string, string];
        return { mode, type, blob, size: Number(size), path };
      });
      const cloned = new Set<string>();
      for (const e of entries) {
        if (e.type !== 'blob' || e.mode === '120000' || e.size < BIG) continue;
        const from = join(worktree, e.path);
        const to = join(dir, e.path);
        if (linkOn(dir, e.path)) continue;
        try {
          if (!(await lstat(from)).isFile() || (await stat(from)).size !== e.size) continue;
          await mkdir(dirname(to), { recursive: true });
          await copyFile(from, to, constants.COPYFILE_FICLONE_FORCE);
          if (await git(worktree, ['hash-object', '--no-filters', to]) !== e.blob) { await rm(to, { force: true }); continue; }
          await chmod(to, e.mode === '100755' ? 0o755 : 0o644);
          cloned.add(e.path);
        } catch { await rm(to, { force: true }); }
      }
      const out = ['checkout-index', '-f', `--prefix=${dir}/`];
      if (!cloned.size) await git(worktree, [...out, '-a'], indexed);
      else {
        const rest = entries.filter((e) => e.type === 'blob' && !cloned.has(e.path)).map((e) => e.path);
        if (rest.length) await git(worktree, [...out, '-z', '--stdin'], indexed, `${rest.join('\0')}\0`);
      }
    } finally {
      await rm(holder, { recursive: true, force: true });
    }
  };
  const made = async (commit: string, runs: string[], standIns: StandIn[] = []): Promise<Live & { commit: string }> => {
    const dir = await mkdtemp(join(root, 'c-'));
    const l = { dir, runs: new Set(runs), standIns };
    live.set(dir, l);
    return { ...l, commit };
  };
  const remove = async (l: Live): Promise<void> => {
    live.delete(l.dir);
    for (const s of l.standIns) if (s.run) await o.host.cleanup(s.run).catch(() => undefined);
    await clear(l.dir);
  };

  const checkout: Checkouts['checkout'] = async (given) => {
    const r = { ...given, worktree: await topOf(given.worktree) };
    const c = await made(r.commit, r.runs);
    try {
      // The clone first: a file the tree holds in a cloned folder is the tree's, never the worktree's.
      await cloneIn(r.worktree, c.dir, r.dependencies ?? []);
      await materialize(r.worktree, await repoEnv(r.worktree), `${r.commit}^{tree}`, c.dir);
      return { dir: c.dir, commit: r.commit };
    } catch (error) { await remove(c); throw error; }
  };

  /** Builds the surfaces' stand-ins, each in `built` as soon as it's up, so a later failure still stops it. */
  const buildStandIns = async (dir: string, surfaces: DeclaredSurface[], built: StandIn[]): Promise<void> => {
    for (const s of surfaces) {
      if (o.plant !== 'stands-in-always' && hasEntry(dir, s)) continue;
      if (s.kind === 'service' || s.kind === 'page') {
        const form = FORMS[s.kind];
        const file = join(dir, '.deep-stand-in', `${s.check.replace(/[^\w-]/g, '-')}.mjs`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, form);
        const run = `run:${randomBytes(12).toString('hex')}`;
        const started = await o.host.start({ run, argv: [process.execPath, file], cwd: dir, grant: { read: [dirname(dirname(process.execPath))] }, leases: [{ kind: 'port', env: 'PORT' }] });
        if (started.status !== 'started') throw Error(`BLOCKED: no ${started.kind} free for the stand-in of ${s.check}`);
        const port = Number(started.leases.find((l) => l.kind === 'port')!.key);
        built.push({ check: s.check, kind: s.kind, hash: sha256(form), port, run });
        let up = false;
        for (let tries = 0; tries < 250 && !(up = await listening(port)); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
        if (!up) throw Error(`BLOCKED: the stand-in of ${s.check} never listened`);
      } else if (s.kind === 'command' && 'name' in s) {
        const bin = join(dir, '.deep-stand-in', 'bin', s.name.trim().split(/\s+/)[0]!.replace(/[^\w.-]/g, '-'));
        await mkdir(dirname(bin), { recursive: true });
        await writeFile(bin, FORMS.command, { mode: 0o755 });
        built.push({ check: s.check, kind: s.kind, hash: sha256(FORMS.command), bin });
      } else if (s.kind === 'module' && 'path' in s && inside(s.path) && /\.[cm]?[jt]sx?$/.test(s.path) && s.exports.every((e) => /^[A-Za-z_$][\w$]*$/.test(e))) {
        // Through a link it would land outside the checkout: no stand-in, so the check can't import it.
        if (linkOn(dir, s.path) || lstatSync(join(dir, s.path), { throwIfNoEntry: false })) continue;
        const form = moduleForm(s.exports);
        await mkdir(dirname(join(dir, s.path)), { recursive: true });
        await writeFile(join(dir, s.path), form);
        built.push({ check: s.check, kind: s.kind, hash: sha256(form) });
      }
    }
  };

  const baseCheckout: Checkouts['baseCheckout'] = async (given) => {
    const r = { ...given, worktree: await topOf(given.worktree) };
    const env = await repoEnv(r.worktree);
    const claim = await git(r.worktree, ['rev-parse', r.claim], env);
    const base = await git(r.worktree, ['merge-base', claim, r.onto], env);
    // The check's own files from the claim's commit, the rest from the merge base: a tree of its own, written to the store.
    const own = r.own.filter(inside);
    const c = await made(base, r.runs);
    const write = async (): Promise<void> => {
      if (!own.length) return materialize(r.worktree, env, `${base}^{tree}`, c.dir);
      const holder = await mkdtemp(join(o.store, 'index-'));
      try {
        const indexed = { ...env, GIT_INDEX_FILE: join(holder, 'index') };
        await git(r.worktree, ['read-tree', base], indexed);
        const listed = await git(r.worktree, ['ls-tree', '-r', '-z', claim, '--', ...own], env);
        if (listed) await git(r.worktree, ['update-index', '-z', '--index-info'], indexed, listed);
        await materialize(r.worktree, env, await git(r.worktree, ['write-tree'], indexed), c.dir);
      } finally {
        await rm(holder, { recursive: true, force: true });
      }
    };
    try {
      await cloneIn(r.worktree, c.dir, r.dependencies ?? []);
      // Its own tree has no ref, so a prune waits until it's written out.
      await (own.length ? serial(write) : write());
      await buildStandIns(c.dir, r.surfaces ?? [], c.standIns);
      return { dir: c.dir, commit: base, standIns: c.standIns };
    } catch (error) { await remove(c); throw error; }
  };

  const ended: Checkouts['ended'] = async (c, run) => {
    const l = live.get(c.dir);
    if (!l) return;
    l.runs.delete(run);
    if (!l.runs.size && o.plant !== 'removes-at-session-end') await remove(l);
  };

  const runOne = async (c: ClaimCheckInput, dir: string): Promise<CheckResult> => {
    const kind = o.kinds.find((k) => k.kind === c.spec.kind);
    if (!kind) return { outcome: 'missing', testsRun: 0, failures: [{ test: '(run)', file: '.', line: 1, stack: null, assertion: false, message: `no check kind ${c.spec.kind}` }], evidence: [], read: [], mask: null };
    return kind.run(c.spec, { checkout: dir, deadline: c.deadline, now: o.now });
  };
  /** The result of an earlier claim this check keeps: its snapshot is still there, and nothing its inputs or reads name changed. */
  const carried = async (c: ClaimCheckInput, digest: string, worktree: string, commit: string, earlier: ClaimRun[]): Promise<ClaimCheckRun | null> => {
    for (const e of [...earlier].reverse()) {
      const was = e.checks.find((x) => x.check === c.check && x.digest === digest);
      if (!was || was.head.outcome !== 'passed') continue;
      // A base run cut short proved nothing either way: it runs again rather than carry.
      if (was.base && !['passed', 'failed', 'overran'].includes(was.base.outcome)) continue;
      if (!await inStore(['cat-file', '-e', `${e.snapshot}^{commit}`]).then(() => true, () => false)) continue;
      // Both names of a rename, each as it is: a rename or a quoted name must not hide an input that changed.
      const diff = await git(worktree, ['diff', '--name-only', '--no-renames', '-z', e.snapshot, commit], await repoEnv(worktree)).catch(() => null);
      if (diff === null) continue;
      const changed = diff.split('\0').filter(Boolean);
      const inputs = c.spec.inputs;
      if (changed.some((p) => !inputs.length || inputs.some((g) => matches(g, p)) || was.head.read.includes(p))) continue;
      return { ...was, carried: true };
    }
    return null;
  };

  const runClaim: Checkouts['runClaim'] = async (claim) => {
    const { commit } = await snapshot(claim.worktree);
    const rows: ClaimCheckRun[] = [];
    const records: Run[] = [];
    const digestOf = (c: ClaimCheckInput): string => sha256(JSON.stringify(c.spec));
    const toDo: ClaimCheckInput[] = [];
    for (const c of claim.checks) {
      const kept = await carried(c, digestOf(c), claim.worktree, commit, claim.earlier ?? []);
      if (kept) rows.push(kept); else toDo.push(c);
    }
    const record = (c: ClaimCheckInput, r: CheckResult, i: number): void => {
      records.push({
        run: `run:${claim.claim.replace(/\W/g, '')}${records.length}`, check: c.check, claim: claim.claim, commit, digest: digestOf(c), environment: {}, tools: {}, outcome: r.outcome, ended: i, tests_run: r.testsRun, reads: [], evidence: [], kept: true,
        failures: r.failures.map((f) => ({ test: f.test, message: f.message, cause: c.check, frames: [{ file: f.file, line: f.line }], covers: [], case: null })),
        ...(r.outcome === 'missing' ? { missing: { cause: r.failures[0]?.message ?? `${c.check} couldn't start`, owner: 'you', since: o.now() } } : {}),
      });
    };
    if (toDo.length) {
      const head = await checkout({ worktree: claim.worktree, commit, dependencies: claim.dependencies ?? [], runs: toDo.map((c) => c.check) });
      try {
        for (const c of toDo) {
          // A failed run starts up to two more, as any check's does (#28). An uncounted run ends it: nothing says another would count.
          const outcomes: CheckResult['outcome'][] = [];
          let r: CheckResult;
          do {
            r = await runOne(c, head.dir);
            outcomes.push(r.outcome);
            record(c, r, outcomes.length);
          } while (r.outcome !== 'uncounted' && moreRuns({}, outcomes) > 0);
          let base: BaseRun | null = null;
          // A fix check always; a check of what must not change only when it failed, for what it inherits.
          const onBase = (c.on_base === 'fails' || r.outcome !== 'passed') && !(o.plant === 'base-in-command-check' && c.spec.kind !== 'command');
          if (onBase) {
            const b = await baseCheckout({ worktree: claim.worktree, onto: claim.onto, claim: commit, own: c.own, dependencies: claim.baseDependencies ?? claim.dependencies ?? [], runs: [c.check] });
            try {
              const ran = await runOne(c, b.dir);
              base = { ...ran, checkout: b.dir, on_assertion: baseProof(ran, c, o.plant).on_assertion };
            } finally { await ended(b, c.check); }
          }
          rows.push({ check: c.check, digest: digestOf(c), carried: false, head: r, base });
        }
      } finally {
        await Promise.all(toDo.map((c) => ended(head, c.check)));
      }
    }
    for (const row of rows) if (row.carried) record(claim.checks.find((c) => c.check === row.check)!, row.head, 1);
    // What a base run failed to prove, by name: the engine says only that it failed off its named assertions.
    const whys: string[] = [];
    const judged = verdict({
      claim: claim.claim, agent: 'session:gate', repo: claim.worktree, task: claim.claim, commit, changes: [], waivers: [], now: o.now(), runs: records,
      requirements: claim.checks.map((c) => ({ req: c.check, depth: 'unit' as const, oracle: 'code' as const, on_base: c.on_base })),
      checks: claim.checks.map((c) => {
        const row = rows.find((x) => x.check === c.check)!;
        const proof = row.base && baseProof(row.base, c, o.plant);
        if (proof?.why) whys.push(`${c.check} ${proof.why}`);
        const base: BaseResult | undefined = row.base ? {
          outcome: row.base.outcome === 'passed' ? 'passed' : 'failed', on_assertion: row.base.on_assertion, failed_tests: row.base.failures.map((f) => f.test),
        } : undefined;
        return { check: c.check, digest: digestOf(c), source: 'definition' as const, depth: 'unit' as const, proof: 'test_run' as const, covers: [c.check], inputs: c.spec.inputs, environment: {}, tools: {}, state: 'ended' as const, ...(base ? { base } : {}) };
      }),
    });
    return { claim: claim.claim, snapshot: commit, verdict: judged.outcome, reasons: judged.outcome === 'PASS' ? [] : judged.outcome === 'INVALID' ? [...whys, ...judged.reasons] : judged.reasons, smallest: judged.smallest, checks: claim.checks.map((c) => rows.find((x) => x.check === c.check)!) };
  };

  const prune: Checkouts['prune'] = (cited) => serial(async () => {
    const kept = new Set([...cited.open_claims, ...cited.open_asks, ...cited.kept_evidence.filter((e) => o.plant !== 'drops-decisions' || !e.behind_decision).map((e) => e.snapshot)]);
    const removed: string[] = [];
    const refs = (await inStore(['for-each-ref', '--format=%(refname)', SNAPSHOTS])).split('\n').filter(Boolean);
    const stay: string[] = [];
    for (const ref of refs) {
      const [at, commit] = ref.slice(SNAPSHOTS.length).split('/') as [string, string];
      if (o.plant === 'keeps-every-snapshot' || kept.has(commit) || o.now() - Number(at) < RETENTION_MS) { stay.push(commit); continue; }
      await inStore(['update-ref', '-d', ref]);
      removed.push(commit);
    }
    // The store holds loose objects only, as nothing here repacks it. What no kept snapshot's own tree holds goes; the
    // walk stops at each snapshot, since its parent is the repo's, which may be gone.
    const hold = new Set(stay.length ? (await inStore(['rev-list', '--objects', '--no-walk', '--missing=allow-any', '--stdin'], `${stay.join('\n')}\n`)).split('\n').map((l) => l.split(' ')[0]!) : []);
    for (const fan of await readdir(objects)) {
      if (!/^[0-9a-f]{2}$/.test(fan)) continue;
      for (const name of await readdir(join(objects, fan))) if (!hold.has(`${fan}${name}`)) await rm(join(objects, fan, name), { force: true });
      await rm(join(objects, fan), { recursive: false }).catch(() => undefined);
    }
    return { removed };
  });

  return {
    snapshot, checkout, baseCheckout, ended, runClaim, prune,
    close: async () => { await Promise.all([...live.values()].map(remove)); await turn; },
  };
}
