// Verdicts as commit statuses, and what the hub reads of each push (#46). Nothing here decides a verdict: it reads the
// record, and writes one status per verdict to the commit that verdict covers, once the repo's delivery rule is on.
// A verdict on a snapshot waits for a pushed commit with the snapshot's tree. Head trust is the gate's rule, fed by
// GitHub's record of each push. The same read of that record finds the ref changes no guarded call named, and the open
// pull requests a move left in conflict.
import { execFile } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitEnv, headTrust } from '@deepbuild/gate';
import { commitsOf, defaultBranch, firstPushes, ForgeRefused, githubPushReader, namesRef, openPulls, pushesWithForks, refChanges, repoOf, restOf, type Push, type RefChange, type Rest } from './pushes.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const CONTEXT = 'deepbuild/verdict';
/** GitHub refuses a longer description. */
const DESCRIPTION_MAX = 140;
const SHA = /^[0-9a-f]{40}$/;
const ZERO = '0'.repeat(40);
/** How soon a pull request GitHub is still computing is read again. */
const RECHECK_MS = 5000;
/** How far a push's time and a call's may differ: GitHub keeps whole seconds, on a clock of its own. */
const SKEW_MS = 2000;
/** How long a verdict waits for a pushed commit: as long as DeepBuild keeps an unheld snapshot. */
const HELD_MS = 30 * 86_400_000;
/** How far back a call may have started and still be running at a push. */
const LONGEST_CALL_MS = 6 * 3600_000;

export type GitHubPlant = 'posts-on-head' | 'unguarded-marks-every-push' | 'unguarded-marks-none';
export interface GitHubSession { id: string; agent: string; cwd: string }
export interface GitHubOptions {
  /** The REST root. */
  api: string;
  /** The token reads go with; none, and nothing is read. */
  reads(): Promise<string | undefined>;
  /** The gate's own token: the hub's process holds it, and no session's login stands in for it (#1325). */
  posts(): string | undefined;
  /** `github` in your settings, read at each use. */
  settings(): { delivery: Record<string, unknown>; yours: string[] };
  raw(query: string, params?: (string | number | null)[]): Promise<unknown[]>;
  /** The sessions working now. */
  sessions(): GitHubSession[];
  unguarded(session: GitHubSession | undefined, data: { ref: string; commit: string; pusher: string | null; call: string | null; command: string | null }): Promise<void>;
  /** Words for a session: an idle one wakes with them. */
  hear(session: GitHubSession, text: string): void;
  /** Where what must outlive a restart is kept: a file. */
  state: string;
  /** DeepBuild's object store, which holds the snapshots. */
  snapshots: string;
  plant?: GitHubPlant;
}
export interface GitHub {
  /** A verdict landed in the record. */
  verdicts(): void;
  /** One read of the repos sessions work in. */
  pass(): Promise<void>;
}
/** A verdict on its way to a status. `sha`, once a pushed commit has its snapshot's tree. */
interface Going { outcome: string; claim: string; repo: string; cwd: string; at: number; sha?: string }
interface State { after: number | null; held: Record<string, Going>; seen: Record<string, number> }
/** What a read of one repo keeps: its pushed commits by SHA and by tree. */
interface Watch { base?: string; pushes: Map<string, Push>; trees: Map<string, string>; recheck: boolean; told: Set<string>; complaint?: string }

/** The status a verdict posts: green only for a PASS on a head that isn't untrusted, its open items in the description while they fit. */
function describeStatus(outcome: string, open: string[], untrusted: boolean): { state: 'success' | 'pending' | 'failure' | 'error'; description: string } {
  const state = untrusted ? 'pending' : outcome === 'PASS' ? 'success' : outcome === 'FAIL' ? 'failure' : outcome === 'INVALID' ? 'error' : 'pending';
  const word = `${outcome}${untrusted ? ': untrusted head' : ''}`;
  const named = open.length ? `${word}; open: ${open.join('; ').replace(/\s+/g, ' ')}` : word;
  return { state, description: named.length <= DESCRIPTION_MAX ? named : `${word}; ${open.length} open item${open.length === 1 ? '' : 's'}` };
}

const git = (cwd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> => new Promise((done) => {
  execFile('git', ['-C', cwd, ...args], { env: { ...gitEnv(), ...env }, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 << 20 }, (error, out) => {
    done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: out.trim() });
  });
});
const lines = (text: string): string[] => text.split('\n').filter(Boolean);

export function openGitHub(o: GitHubOptions): GitHub {
  const reader = githubPushReader();
  const state: State = { after: null, held: {}, seen: {} };
  try { Object.assign(state, JSON.parse(readFileSync(o.state, 'utf8'))); } catch { /* none yet */ }
  const save = (): void => {
    writeFileSync(`${o.state}.tmp`, JSON.stringify(state));
    renameSync(`${o.state}.tmp`, o.state);
  };
  const watches = new Map<string, Watch>();
  const watch = (repo: string): Watch => {
    let w = watches.get(repo);
    if (!w) watches.set(repo, w = { pushes: new Map(), trees: new Map(), recheck: true, told: new Set() });
    return w;
  };
  const keep = (w: Watch, pushes: Push[]): void => {
    for (const p of firstPushes(pushes)) {
      if (!w.pushes.has(p.commit)) w.pushes.set(p.commit, p);
      if (p.tree && !w.trees.has(p.tree)) w.trees.set(p.tree, p.commit);
    }
  };
  /** When every call to the forge may go again: a rate limit stops them all. */
  let limited = 0;
  const limitedUntil = (at: number): void => {
    limited = Math.max(limited, at);
    setTimeout(kick, Math.max(0, limited - Date.now())).unref();
  };
  const origins = new Map<string, string | undefined>();
  const originOf = async (cwd: string): Promise<string | undefined> => {
    if (!origins.has(cwd)) origins.set(cwd, repoOf((await git(cwd, ['remote', 'get-url', 'origin'])).out));
    return origins.get(cwd);
  };
  const reading = async (): Promise<Rest | undefined> => { const token = await o.reads(); return token ? restOf(o.api, token) : undefined; };
  const ruleOn = (repo: string): boolean => o.settings().delivery[repo] === 'on';

  /** Whether the gate's rule trusts `sha`'s head: every commit since the default branch came from a session or is pushed by an account you named. */
  const trusted = async (v: Going, sha: string): Promise<boolean> => {
    const rest = await reading();
    if (!rest) return false;
    const w = watch(v.repo);
    const base = `refs/remotes/origin/${w.base ??= await defaultBranch(rest, v.repo)}`;
    const since = await git(v.cwd, ['rev-list', `${base}..${sha}`]);
    if (since.code !== 0) return false;
    const shas = lines(since.out);
    const rows = shas.length ? await o.raw(`SELECT sha FROM commits WHERE worktree IS NOT NULL AND sha IN (${shas.map(() => '?').join(', ')})`, shas) as { sha: string }[] : [];
    const recorded = rows.map((r) => r.sha);
    const others = shas.filter((c) => !recorded.includes(c));
    if (!others.length) return true;
    if (others.some((c) => !w.pushes.has(c))) keep(w, await pushesWithForks(rest, v.repo));
    return headTrust({ repo: v.cwd, base, head: sha, recorded, yours: o.settings().yours, provider: [...w.pushes.values()], reader }).trusted;
  };
  /** One verdict's one call. False: it stays, for when the forge can take it. */
  const post = async (v: Going, sha: string): Promise<boolean> => {
    if (!ruleOn(v.repo)) return true;
    if (Date.now() < limited) return false;
    const token = o.posts();
    if (!token) { process.stderr.write(`deep hub: no gate token (GH_TOKEN) in the hub's environment, so ${v.claim}'s status on ${sha} wasn't posted\n`); return true; }
    try {
      const open = await o.raw(`SELECT text FROM open_items WHERE closed IS NULL AND task_ref = (SELECT subject_ref FROM claims WHERE id = ?)`, [v.claim.slice(6)]) as { text: string }[];
      const untrusted = !await trusted(v, sha);
      await restOf(o.api, token)('POST', `/repos/${v.repo}/statuses/${sha}`, { context: CONTEXT, ...describeStatus(v.outcome, open.map((r) => r.text), untrusted) });
      return true;
    } catch (error) {
      if (!(error instanceof ForgeRefused) || error.status >= 500) return false;
      if (error.retryAt !== undefined) { limitedUntil(error.retryAt); return false; }
      process.stderr.write(`deep hub: ${v.claim}'s status on ${sha} was refused: ${error.message}\n`);
      return true;
    }
  };
  /** A verdict's commit is pushed when a remote-tracking ref holds it: asking GitHub would cost a call a verdict. */
  const pushed = async (cwd: string, sha: string): Promise<boolean> => {
    const r = await git(cwd, ['for-each-ref', '--count=1', '--contains', sha, 'refs/remotes/origin']);
    return r.code === 0 && r.out !== '';
  };
  const treeOf = async (cwd: string, sha: string): Promise<string | undefined> => {
    for (const dir of [cwd, o.snapshots]) {
      const r = await git(dir, ['rev-parse', '--verify', '-q', `${sha}^{tree}`]);
      if (r.code === 0) return r.out;
    }
    return undefined;
  };
  /** True once the verdict needs nothing more. */
  const deliver = async (commit: string, outcome: string, claim: string): Promise<boolean> => {
    const [row] = await o.raw(`SELECT s.worktree AS cwd FROM claims c JOIN sessions s ON s.id = c.session_id WHERE c.id = ?`, [claim.slice(6)]) as { cwd: string | null }[];
    const repo = row?.cwd ? await originOf(row.cwd) : undefined;
    if (!repo || !row?.cwd || !ruleOn(repo) || !SHA.test(commit) || commit === ZERO) return true;
    const v: Going = { outcome, claim, repo, cwd: row.cwd, at: Date.now() };
    if (o.plant === 'posts-on-head') return post(v, (await git(row.cwd, ['rev-parse', 'HEAD'])).out);
    if (await pushed(row.cwd, commit)) return post(v, commit);
    const tree = await treeOf(row.cwd, commit);
    if (tree) state.held[tree] = { ...v, ...(watch(repo).trees.has(tree) ? { sha: watch(repo).trees.get(tree)! } : {}) };
    return true;
  };

  let draining = false;
  let again = false;
  const drain = async (): Promise<void> => {
    for (const [tree, v] of Object.entries(state.held)) {
      if (!v.sha) continue;
      if (!await post(v, v.sha)) return;
      delete state.held[tree];
      save();
    }
    if (state.after === null) {
      const [row] = await o.raw(`SELECT COALESCE(MAX(log_pos), 0) AS at FROM events`) as { at: number }[];
      state.after = Number(row?.at ?? 0);
      return save();
    }
    const rows = await o.raw(`SELECT log_pos, data FROM events WHERE kind = 'verdict.made' AND log_pos > ? ORDER BY log_pos LIMIT 100`, [state.after]) as { log_pos: number; data: string }[];
    for (const row of rows) {
      const v = JSON.parse(row.data) as { commit: string; outcome: string; claim: string };
      if (!await deliver(v.commit, v.outcome, v.claim)) return;
      state.after = row.log_pos;
      save();
    }
    if (rows.length === 100) again = true;
  };
  function kick(): void {
    if (draining) { again = true; return; }
    draining = true;
    void (async () => {
      do { again = false; await drain(); } while (again);
    })().catch((error: unknown) => { process.stderr.write(`deep hub: github: ${error instanceof Error ? error.message : String(error)}\n`); }).finally(() => { draining = false; if (again) kick(); });
  }

  /** The shell calls sessions ran around a push, by when each started and ended. */
  const callsAround = async (sessions: GitHubSession[], at: number): Promise<{ session: GitHubSession; call: string; command: string; from: number; to: number }[]> => {
    if (!sessions.length) return [];
    const rows = await o.raw(`SELECT session_id, kind, ts, json_extract(data, '$.call') AS call, json_extract(data, '$.command') AS command FROM events
      WHERE kind IN ('tool.before', 'tool.after') AND session_id IN (${sessions.map(() => '?').join(', ')}) AND ts >= ? ORDER BY log_pos`, [...sessions.map((s) => s.id), at - LONGEST_CALL_MS]) as { session_id: string; kind: string; ts: number; call: string | null; command: string | null }[];
    const calls = new Map<string, { session: GitHubSession; call: string; command: string; from: number; to: number }>();
    for (const r of rows) {
      if (!r.call) continue;
      const found = calls.get(r.call);
      if (found) found.to = r.ts;
      else if (r.kind === 'tool.before' && r.command) calls.set(r.call, { session: sessions.find((s) => s.id === r.session_id)!, call: r.call, command: r.command, from: r.ts, to: Infinity });
    }
    return [...calls.values()].filter((c) => c.from <= at + 1000 + SKEW_MS && c.to >= at - SKEW_MS);
  };
  /** A ref change no guarded call named is recorded, with the call that was running in the session whose clone holds what it pushed. */
  const unguard = async (change: RefChange, sessions: GitHubSession[]): Promise<void> => {
    if (o.plant === 'unguarded-marks-none') return;
    const calls = await callsAround(sessions, change.at);
    if (o.plant !== 'unguarded-marks-every-push' && calls.some((c) => namesRef(c.command, change.ref))) return;
    const commit = change.after === ZERO ? change.before : change.after;
    const held = (await Promise.all(calls.map(async (c) => ((await git(c.session.cwd, ['cat-file', '-e', `${commit}^{commit}`])).code === 0 ? c : undefined)))).filter((c) => c !== undefined);
    // GitHub's second holds the push: the call nearest its middle was running, the latest of any that tie.
    const mid = change.at + 500;
    const apart = (c: { from: number; to: number }): number => Math.max(c.from - mid, mid - c.to, 0);
    const running = held.reduce<typeof held[number] | undefined>((best, c) => (!best || apart(c) <= apart(best) ? c : best), undefined);
    await o.unguarded(running?.session, { ref: change.ref, commit: change.after, pusher: change.pusher, call: running?.call ?? null, command: running?.command ?? null });
  };
  /** The files a real merge of `head` into `base` leaves in conflict, fetched into a folder of its own: your repo stays as it was. */
  const conflicted = async (cwd: string, baseRef: string, headRef: string, base: string, head: string): Promise<string[]> => {
    const objects = await mkdtemp(join(tmpdir(), 'deep-merge-'));
    try {
      const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).out;
      const env = { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common, 'objects'), GIT_TERMINAL_PROMPT: '0' };
      await git(cwd, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', `refs/heads/${baseRef}`, `refs/heads/${headRef}`], env);
      const merge = await git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, head], env);
      return merge.code === 1 ? lines(merge.out).slice(1) : [];
    } finally {
      await rm(objects, { recursive: true, force: true });
    }
  };
  /** Tells each session whose branch's open pull request no longer merges, once per pair of commits. */
  const conflicts = async (rest: Rest, repo: string, w: Watch, sessions: GitHubSession[]): Promise<void> => {
    const onBranch = new Map<string, GitHubSession[]>();
    for (const s of sessions) {
      const branch = (await git(s.cwd, ['branch', '--show-current'])).out;
      if (branch) onBranch.set(branch, [...onBranch.get(branch) ?? [], s]);
    }
    if (!onBranch.size) return;
    for (const pull of await openPulls(rest, repo)) {
      const head = isObj(pull.head) ? pull.head : {};
      const working = onBranch.get(String(head.ref));
      if (!working || (isObj(head.repo) && head.repo.full_name !== repo)) continue;
      const { body } = await rest('GET', `/repos/${repo}/pulls/${String(pull.number)}`);
      if (!isObj(body)) continue;
      if (body.mergeable === null) { w.recheck = true; continue; }
      if (body.mergeable !== false || !isObj(body.base) || !isObj(body.head)) continue;
      const baseRef = String(body.base.ref);
      const tip = (await rest('GET', `/repos/${repo}/commits?sha=${encodeURIComponent(baseRef)}&per_page=1`)).body;
      const base = Array.isArray(tip) && isObj(tip[0]) ? String(tip[0].sha) : String(body.base.sha);
      const key = `${String(pull.number)} ${base} ${String(body.head.sha)}`;
      if (w.told.has(key)) continue;
      w.told.add(key);
      const files = await conflicted(working[0]!.cwd, baseRef, String(head.ref), base, String(body.head.sha));
      const where = files.length ? ` in ${files.join(', ')}` : '';
      for (const s of working) o.hear(s, `DeepBuild: pull request #${String(pull.number)} now conflicts with ${baseRef}${where}. Merge ${baseRef} into your branch, resolve it and push.`);
    }
  };
  const readRepo = async (rest: Rest, repo: string, sessions: GitHubSession[]): Promise<void> => {
    const w = watch(repo);
    const changes = await refChanges(rest, repo, state.seen[repo]);
    if (changes.length) w.base ??= await defaultBranch(rest, repo);
    // Only while a session has worked in the repo: GitHub's second may hold a session's first moment.
    const [first] = changes.length && sessions.length ? await o.raw(`SELECT MIN(ts) AS since FROM events WHERE session_id IN (${sessions.map(() => '?').join(', ')})`, sessions.map((s) => s.id)) as { since: number | null }[] : [];
    for (const change of changes) {
      keep(w, await commitsOf(rest, repo, false, w.base!, change));
      if (first?.since != null && change.at >= first.since - 1000) await unguard(change, sessions);
      state.seen[repo] = change.id;
      save();
    }
    for (const v of Object.entries(state.held).filter(([tree, h]) => h.repo === repo && !h.sha && w.trees.has(tree))) v[1].sha = w.trees.get(v[0])!;
    if (changes.length || w.recheck) { w.recheck = false; await conflicts(rest, repo, w, sessions); }
    if (w.recheck) setTimeout(() => void pass(), RECHECK_MS).unref();
  };
  let passing = false;
  const pass = async (): Promise<void> => {
    if (passing || Date.now() < limited) return;
    passing = true;
    try {
      for (const [tree, h] of Object.entries(state.held)) if (Date.now() - h.at > HELD_MS) delete state.held[tree];
      const repos = new Map<string, GitHubSession[]>(Object.values(state.held).map((h) => [h.repo, []]));
      for (const s of o.sessions()) {
        const repo = await originOf(s.cwd);
        if (repo) repos.set(repo, [...repos.get(repo) ?? [], s]);
      }
      const rest = repos.size ? await reading() : undefined;
      if (!rest) return;
      for (const [repo, sessions] of repos) {
        await readRepo(rest, repo, sessions).catch((error: unknown) => {
          const complaint = error instanceof Error ? error.message : String(error);
          const w = watch(repo);
          if (error instanceof ForgeRefused && error.retryAt !== undefined) limitedUntil(error.retryAt);
          else if (w.complaint !== complaint) process.stderr.write(`deep hub: github: ${repo}: ${w.complaint = complaint}\n`);
        });
      }
    } finally {
      passing = false;
    }
    kick();
  };
  kick();
  return { verdicts: kick, pass };
}
