// How each commit the default branch gained was judged (#2750; design: First-party extensions that ship on by
// default). `readPushes` is one read of GitHub's record of the default branch's pushes, which the hub keeps in the
// record as `pushes.read`; `landedReadings` folds those with the record's verdicts, commits and watch-only holds into
// one reading per repo. A commit is judged by a verdict whose snapshot's tree is its tree, the rule a commit status
// follows; any other reads none, with one cause. It is a reading: nothing here posts, asks or decides a verdict.
import { execFile } from 'node:child_process';
import { gitEnv } from '@deepbuild/gate';
import { defaultBranch, ForgeRefused, restOf, type Rest } from './pushes.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ZERO = '0'.repeat(40);
const DAY = 86_400_000;
/** The reading's span. */
const SPAN_MS = 30 * DAY;
/** The share with none is outside its band past this (drafted). */
const BAND = 0.1;
/** A refresh is yours to wait for, a call at a time. */
const READ_MS = 60_000;
/** What git writes in a revert's message. */
const REVERTS = /^This reverts commit ([0-9a-f]{40})\b/m;
/** A session's watch-only causes, in the order a commit's none names them. */
const WATCH = ['checks', 'version', 'hooks'];

interface Commit { commit: string; tree: string; reverts?: string }
interface Push { id: number; at: number; pusher: string | null; commits: Commit[] | null }
/** What a `pushes.read` event holds: the ref changes one read named, and the snapshot trees it read. */
export interface PushesRead { repo: string; ref: string; as_of: number; pushes: Push[]; snapshots: { commit: string; tree: string }[] }

/** The commits a ref change brought, oldest first; a new branch's are every commit it holds. */
async function brought(rest: Rest, repo: string, before: string, after: string): Promise<Commit[]> {
  const found: Obj[] = [];
  if (before === ZERO) {
    for (let next: string | undefined = `/repos/${repo}/commits?sha=${after}&per_page=100`; next;) {
      const page: { body: unknown; next: string | undefined } = await rest('GET', next);
      found.push(...(Array.isArray(page.body) ? page.body : []).filter(isObj));
      next = page.next;
    }
    found.reverse();
  } else {
    for (let page = 1; ; page++) {
      const { body } = await rest('GET', `/repos/${repo}/compare/${before}...${after}?per_page=100&page=${page}`);
      const commits = isObj(body) && Array.isArray(body.commits) ? body.commits.filter(isObj) : [];
      found.push(...commits);
      if (!commits.length || !(isObj(body) && found.length < Number(body.total_commits))) break;
    }
  }
  return found.map((c) => {
    const git = isObj(c.commit) ? c.commit : {};
    const reverts = REVERTS.exec(String(git.message ?? ''))?.[1];
    return { commit: String(c.sha), tree: isObj(git.tree) ? String(git.tree.sha) : '', ...(reverts ? { reverts } : {}) };
  });
}
/** The trees of `commits` among the objects `dir` holds, in one git process. */
const treesIn = (dir: string, commits: string[]): Promise<[string, string][]> => new Promise((done) => {
  const child = execFile('git', ['-C', dir, 'cat-file', '--batch-check=%(objectname)'], { env: gitEnv(), encoding: 'utf8', timeout: READ_MS, maxBuffer: 64 << 20 }, (error, out) => {
    const lines = error ? [] : out.split('\n');
    done(commits.flatMap((c, i): [string, string][] => (/^[0-9a-f]{40}$/.test(lines[i] ?? '') ? [[c, lines[i]!]] : [])));
  });
  child.stdin?.on('error', () => undefined).end(commits.map((c) => `${c}^{tree}\n`).join(''));
});

/**
 * One read of `repo`'s default branch: each ref change of the last thirty days no earlier read named the commits of,
 * and the tree of each of `verdicts`' snapshots not read yet, from its session's worktree or DeepBuild's object store.
 * A change the forge refuses to name the commits of is kept with none, so its date reads missing, never zero. Throws
 * when the forge can't be read now: a limit, an error of its own, or no answer.
 */
export async function readPushes(o: { api: string; token: string | undefined; repo: string; now: number; read: readonly PushesRead[]; verdicts: readonly { commit: string; cwd: string }[]; store: string }): Promise<PushesRead> {
  const rest = restOf(o.api, o.token, READ_MS);
  const ref = `refs/heads/${await defaultBranch(rest, o.repo)}`;
  const had = new Map(o.read.filter((r) => r.repo === o.repo).flatMap((r) => r.pushes).sort((a, b) => Number(!!a.commits) - Number(!!b.commits)).map((p) => [p.id, !!p.commits]));
  const pushes: Push[] = [];
  for (let next: string | undefined = `/repos/${o.repo}/activity?ref=${encodeURIComponent(ref)}&time_period=month&per_page=100`; next;) {
    const page: { body: unknown; next: string | undefined } = await rest('GET', next);
    for (const a of (Array.isArray(page.body) ? page.body : []).filter(isObj)) {
      const id = Number(a.id);
      if (had.get(id) || String(a.after) === ZERO) continue;
      const commits = await brought(rest, o.repo, String(a.before), String(a.after)).catch((error: unknown) => {
        if (error instanceof ForgeRefused && error.retryAt === undefined && error.status < 500) return null;
        throw error;
      });
      if (commits || !had.has(id)) pushes.push({ id, at: Date.parse(String(a.timestamp)), pusher: isObj(a.actor) && typeof a.actor.login === 'string' ? a.actor.login || null : null, commits });
    }
    next = page.next;
  }
  const known = new Set([...o.read.flatMap((r) => [...r.pushes, { commits: r.snapshots }]), ...pushes].flatMap((p) => p.commits ?? []).map((c) => c.commit));
  const within = new Map<string, Set<string>>();
  for (const v of o.verdicts) if (!known.has(v.commit)) (within.get(v.cwd) ?? within.set(v.cwd, new Set()).get(v.cwd)!).add(v.commit);
  const trees = new Map<string, string>();
  for (const [dir, commits] of within) for (const [commit, tree] of await treesIn(dir, [...commits])) trees.set(commit, tree);
  const left = [...new Set([...within.values()].flatMap((commits) => [...commits]))].filter((c) => !trees.has(c));
  if (left.length) for (const [commit, tree] of await treesIn(o.store, left)) trees.set(commit, tree);
  return { repo: o.repo, ref, as_of: o.now, pushes: pushes.reverse(), snapshots: [...trees].map(([commit, tree]) => ({ commit, tree })) };
}

/** An event of the record, as the hub's readings hold one. */
interface Ev { kind: string; ts: number; session: string | null; data: Obj }
type Row = Obj & { commit: string; judged: string };

/**
 * One reading per repo whose pushes were read, `landed.none`: the share of the commits its default branch gained in
 * the thirty days before its last read that no verdict judged. Its rows are the counts, then each commit with how it
 * was judged, then each span of dates the forge refused the pushes of, which reads missing and gives no number.
 * `events` are the record's `pushes.read`, `verdict.made`, `commit.made` and `holds.watch`, in the log's order, and
 * each `tool.before` a hook reported, which takes back hooks that didn't reach, as a session's row reads them.
 */
export function landedReadings(events: readonly Ev[]) {
  const repos = new Map<string, { as_of: number; pushes: Map<number, Push> }>();
  const trees = new Map<string, string>();
  const verdicts: { commit: string; outcome: string; ts: number }[] = [];
  const made = new Map<string, { session: string | null; branch: unknown }>();
  const holds: { session: string | null; cause: string; on: boolean; ts: number }[] = [];
  for (const e of events) {
    if (e.kind === 'pushes.read') {
      const read = e.data as unknown as PushesRead;
      const repo = repos.get(read.repo) ?? repos.set(read.repo, { as_of: 0, pushes: new Map() }).get(read.repo)!;
      repo.as_of = read.as_of;
      for (const p of read.pushes) {
        if (p.commits || !repo.pushes.get(p.id)?.commits) repo.pushes.set(p.id, p);
        for (const c of p.commits ?? []) trees.set(c.commit, c.tree);
      }
      for (const s of read.snapshots) trees.set(s.commit, s.tree);
    } else if (e.kind === 'verdict.made') verdicts.push({ commit: String(e.data.commit), outcome: String(e.data.outcome), ts: e.ts });
    else if (e.kind === 'commit.made') made.set(String(e.data.sha), { session: e.session, branch: e.data.branch });
    else if (e.kind === 'holds.watch') holds.push({ session: e.session, cause: String(e.data.cause), on: e.data.on === true, ts: e.ts });
    else if (e.kind === 'tool.before') holds.push({ session: e.session, cause: 'hooks', on: false, ts: e.ts });
  }
  /** The newest verdict on each tree. */
  const judging = new Map<string, (typeof verdicts)[number]>();
  for (const v of verdicts) { const tree = trees.get(v.commit); if (tree) judging.set(tree, v); }
  const held = (session: string | null, cause: string, at: number): boolean => holds.findLast((h) => h.session === session && h.cause === cause && h.ts <= at)?.on === true;
  /** How one commit reads: its tree's verdict, or none with the first cause that applies when it was pushed. */
  const judge = (c: Commit, p: Push): Row => {
    const on = judging.get(c.tree);
    if (on) return { commit: c.commit, judged: on.outcome };
    const by = made.get(c.commit);
    const cause = held(null, 'off', p.at) ? 'off' : by ? WATCH.find((w) => held(by.session, w, p.at)) : 'no_session';
    if (cause) return { commit: c.commit, judged: 'none', cause, ...(cause === 'no_session' ? { pusher: p.pusher } : {}) };
    const near = by!.branch ? verdicts.findLast((v) => v.ts <= p.at && made.get(v.commit)?.branch === by!.branch) : undefined;
    return { commit: c.commit, judged: 'none', cause: 'tree', ...(near ? { verdict: near.outcome, verdict_commit: near.commit } : {}) };
  };
  return [...repos].map(([repo, { as_of, pushes }]) => {
    const rows = new Map<string, Row>();
    const listed: Row[] = [];
    const spans: { missing: true; from: string; to: string }[] = [];
    for (const p of [...pushes.values()].sort((a, b) => a.at - b.at || a.id - b.id)) {
      const within = p.at > as_of - SPAN_MS;
      const date = new Date(p.at).toISOString().slice(0, 10);
      if (!p.commits && within && spans.at(-1)?.to !== date) {
        const last = spans.at(-1);
        if (last && Date.parse(date) - Date.parse(last.to) === DAY) last.to = date;
        else spans.push({ missing: true, from: date, to: date });
      }
      for (const c of p.commits ?? []) {
        if (rows.has(c.commit)) continue;
        const row = judge(c, p);
        // A revert of a commit that read none is a commit never judged, counted apart from an escape after PASS.
        const reverted = c.reverts ? rows.get(c.reverts)?.judged : undefined;
        if (c.reverts) Object.assign(row, { reverts: c.reverts }, reverted === 'none' ? { counted: 'never_judged' } : reverted === 'PASS' ? { counted: 'escape' } : {});
        rows.set(c.commit, row);
        if (within) listed.push(row);
      }
    }
    const counts: Record<string, number> = { commits: listed.length };
    for (const row of listed) for (const word of [row.judged, row.cause, row.counted]) if (typeof word === 'string') counts[word] = (counts[word] ?? 0) + 1;
    const value = listed.length ? (counts.none ?? 0) / listed.length : null;
    return {
      id: 'landed.none', subject: repo, value, unit: 'share', source: 'github', as_of, basis: 'observed' as const,
      ...(value === null ? {} : { band: value > BAND ? 'over' as const : 'inside' as const }), detail: [counts, ...listed, ...spans],
    };
  });
}
