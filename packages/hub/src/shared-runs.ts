// Results shared across sessions (#1018; design: Pinned to a commit): a run's key names everything its result depends
// on, so any claim in the same repo on the same host whose key is equal reads that run as carried, whichever session
// made it. The key is a stem (the repo, the host, the check's approved bytes, command, deadline, held-out variants and referenced outputs,
// the environment's installs and Node, the names of the files the snapshot holds, and for a base run the merge base
// instead of those names) and the contents of the files it reads: the files its runs read, or for a base run its own
// files. A key's runs come from every claim that ran it, each counted once.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { RecordedRun } from '@deepbuild/gate';

/** A run on a key, with the claim and session it ran for. */
export interface Source { run: string; claim: string; session: string; withheld: boolean }
/**
 * What run.finished keeps of a run's key (#1018), by which a restarted hub reads it again. `plain`: its record is whole
 * in run.finished (no retried test, no stand-in seeded, every failure on an assertion, no contract), so only a plain
 * run is read again after a restart; any other would lose what makes its verdict.
 */
export interface KeyFacts { id: string; stem: string; paths: string[]; claim: string; session: string; base: boolean; withheld: boolean; plain: boolean }
/** One key of one check (`id`): the key itself, its stem, the paths whose contents it holds, and its runs from every claim, oldest first. */
export interface Group { id: string; key: string; stem: string; paths: string[]; runs: Source[] }
/** Folders of installed dependencies: the environment the key's stem names, never files hashed one by one. */
export const INSTALLS = ['node_modules', '.venv'];

const sha = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
/** The digest of an empty output: what a withheld or unkept run shows in place of its own. */
export const EMPTY = sha('');
const installed = (path: string): boolean => INSTALLS.some((d) => path === d || path.startsWith(`${d}/`));
/** The files a run read that the key holds: those outside installed dependencies, in order. */
export const keyPaths = (read: readonly string[]): string[] => [...new Set(read.filter((p) => !installed(p)))].sort();

/** The contents of `paths` in `dir` as one digest: each path with its bytes' digest, or `-` where it's absent. */
export async function contents(dir: string, paths: readonly string[]): Promise<string> {
  const lines = await Promise.all(paths.map(async (p) => `${p}\0${await readFile(join(dir, p)).then(sha, () => '-')}`));
  return sha(lines.join('\n'));
}
export const keyId = (stem: string, paths: readonly string[], digest: string): string => sha(`${stem}\0${paths.join('\0')}\0${digest}`);

/** The repo a worktree belongs to: git's common folder, which every linked worktree of one repo shares. */
export function repoOf(cwd: string): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return new Promise((done) => execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, env }, (error, out) => done(error ? cwd : out.trim())));
}
/** The lock records package managers keep in an install, any of which names every version it holds. */
const LOCKS = ['node_modules/.package-lock.json', 'node_modules/.modules.yaml', 'node_modules/.yarn-state.yml', 'node_modules/.yarn-integrity', '.venv/pyvenv.cfg'];
/**
 * The installs a checkout has, as the key's environment, with the Node that runs its checks: each lock record there,
 * and, for a Node install with none, each package by name and version; a Python install's by its dist-info folders' names.
 */
export async function installsOf(dir: string): Promise<string> {
  const locks = await Promise.all(LOCKS.map(async (l) => `${l}\0${await readFile(join(dir, l)).then(sha, () => '-')}`));
  const names = async (at: string): Promise<string[]> => readdir(join(dir, at)).then((n) => n.sort(), () => []);
  const packages: string[] = [];
  // A Node install with a lock record has its versions there; one without is read package by package.
  const locked = locks.some((l) => l.startsWith('node_modules/') && !l.endsWith('\0-'));
  for (const name of locked ? [] : await names('node_modules')) {
    for (const p of name.startsWith('@') ? (await names(`node_modules/${name}`)).map((n) => `${name}/${n}`) : [name]) {
      const version = await readFile(join(dir, 'node_modules', p, 'package.json'), 'utf8').then((t) => String((JSON.parse(t) as { version?: unknown }).version), () => '-');
      packages.push(`${p}@${version}`);
    }
  }
  for (const lib of await names('.venv/lib')) packages.push(...(await names(`.venv/lib/${lib}/site-packages`)).map((n) => `${lib}/${n}`));
  return sha([process.version, ...locks, ...packages].join('\n'));
}
/** The names of the files a checkout holds, installs and git's folder left out: a file added or removed changes them. */
export async function namesOf(dir: string): Promise<string> {
  const out: string[] = [];
  const walk = async (at: string): Promise<void> => {
    const entries: Dirent[] = await readdir(join(dir, at), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const path = at ? `${at}/${e.name}` : e.name;
      if (!at && (INSTALLS.includes(e.name) || e.name === '.git')) continue;
      if (e.isDirectory()) await walk(path);
      else out.push(path);
    }
  };
  await walk('');
  return sha(out.sort().join('\0'));
}
/** The stem of a key: everything but the files' contents, and a workspace's state reading (#67) where a claim has one. */
export const stemOf = (facts: { repo: string; check: string; approved: string | null; command: string; deadline_ms: number | null; held_out: unknown; references?: unknown; installs: string; names: string | null; base: string | null; session?: string; state?: Record<string, string> }): string =>
  sha(JSON.stringify([facts.repo, hostname(), facts.check, facts.approved, facts.command, facts.deadline_ms, facts.held_out ?? null, facts.references ?? null, facts.installs, facts.names, facts.base, facts.session ?? null, ...facts.state ? [facts.state] : []]));
/** How run.finished names a failure among its findings, at most FINDINGS of them, and how a restarted hub reads one back. */
export const FINDINGS = 20;
const FINDING = /^(.*) \(([^()]*):(\d+)\): ([\s\S]*)$/;
export const findingOf = (f: RecordedRun['failures'][number]): string => `${f.test} (${f.file}:${f.line}): ${f.message}`;
/** A failure that reads back from its finding as it was. */
const survives = (f: RecordedRun['failures'][number]): boolean => {
  const m = FINDING.exec(findingOf(f));
  return m !== null && m[1] === f.test && m[2] === f.file && Number(m[3]) === f.line && m[4] === f.message;
};
/** Whether a test both failed and passed on its attempts: what the verdict engine reads attempts for. */
const retried = (attempts: RecordedRun['attempts']): boolean => attempts.some((a) => attempts.some((b) => b.test === a.test && b.outcome !== a.outcome));
/**
 * Whether a run's record is whole in run.finished, so a restarted hub may read it again (KeyFacts.plain): no test both
 * failed and passed on its attempts, no stand-in seeded, every failure on an assertion and read back from its finding as
 * it was, no contract, nothing uncounted.
 */
export const plain = (r: RecordedRun): boolean =>
  !retried(r.attempts) && !r.seeded.some((s) => s.standIn) && r.failures.length <= FINDINGS && r.failures.every((f) => f.assertion && survives(f)) && r.contract === null && r.mask === null;

export class SharedRuns {
  private readonly groups = new Map<string, Group>();
  /** By stem, the path sets its keys hold, each once. */
  private readonly sets = new Map<string, Map<string, string[]>>();

  group(id: string): Group | undefined {
    return this.groups.get(id);
  }
  /**
   * A run of `check` joins its key's group, and a run already in it is one run, however often it's added. Groups are
   * the check's own, so a kept key never reads as another check's.
   */
  add(check: string, facts: KeyFacts, run: string): Group {
    const id = `${check}\0${facts.id}`;
    let g = this.groups.get(id);
    if (!g) {
      g = { id, key: facts.id, stem: facts.stem, paths: facts.paths, runs: [] };
      this.groups.set(id, g);
      const sets = this.sets.get(facts.stem) ?? new Map<string, string[]>();
      sets.set(facts.paths.join('\0'), facts.paths);
      this.sets.set(facts.stem, sets);
    }
    if (!g.runs.some((r) => r.run === run)) g.runs.push({ run, claim: facts.claim, session: facts.session, withheld: facts.withheld });
    return g;
  }
  /** Takes a run off its key: one pruned with its evidence counts for no claim. */
  drop(id: string, run: string): void {
    const g = this.groups.get(id);
    if (g) g.runs = g.runs.filter((r) => r.run !== run);
  }
  /** The groups of `check` under `stem` whose files hold in `dir` what they held for the key, the one with most runs first. */
  async find(check: string, stem: string, dir: string): Promise<Group[]> {
    const found: Group[] = [];
    for (const paths of this.sets.get(stem)?.values() ?? []) {
      const g = this.groups.get(`${check}\0${keyId(stem, paths, await contents(dir, paths))}`);
      if (g) found.push(g);
    }
    return found.sort((a, b) => b.runs.length - a.runs.length);
  }
}

/**
 * A kept run's record as run.finished holds it, for a claim that reads it after a restart: its outcome, counts, the
 * failures its findings name and the digests of its output.
 */
export function keptRecord(run: string, d: { outcome: string; tests_run: number; findings: string[]; evidence: string[]; key: KeyFacts }): RecordedRun {
  const failures = d.outcome === 'failed' ? d.findings.flatMap((f) => {
    const m = FINDING.exec(f);
    return m ? [{ test: m[1]!, file: m[2]!, line: Number(m[3]), stack: null, assertion: true, message: m[4]! }] : [];
  }) : [];
  return {
    // A head run's key holds what it read outside its installs, its own files among them.
    run, outcome: d.outcome as RecordedRun['outcome'], testsRun: d.tests_run, failures, evidence: [], read: d.key.base ? [] : [...d.key.paths], mask: null, exit: null,
    output: { stdout: '', stderr: '', sha256: { stdout: d.evidence[0] ?? EMPTY, stderr: d.evidence[1] ?? EMPTY } }, attempts: [], seeded: [], contract: null,
  };
}
/**
 * A held-out variant's run as a claim may show it (#1018): its outcome, counts, attempts by an unnamed test each,
 * seeding and contract counts, never its fixture, its tests' names or its output.
 */
export function withheld(r: RecordedRun): RecordedRun {
  const message = r.outcome === 'missing' ? 'a held-out variant of its fixtures never ran' : 'failed on a held-out variant of its fixtures';
  const failures = r.failures.length ? [{ test: 'held-out variant', file: '.', line: 1, stack: null, assertion: r.failures.every((f) => f.assertion), message }] : [];
  const tests = [...new Set(r.attempts.map((a) => a.test))];
  const attempts = r.attempts.map((a) => ({ ...a, test: `held-out variant's test ${tests.indexOf(a.test) + 1}` }));
  return { ...r, failures, attempts, evidence: [], read: [], output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } } };
}
