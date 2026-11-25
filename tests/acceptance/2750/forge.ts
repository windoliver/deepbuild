// The fixture forge (README: The fixture forge): real HTTP on 127.0.0.1 shaped like GitHub's REST API, over a real bare
// git repository. Copied from tests/acceptance/46/forge.ts (same repo, same license) and cut to what a reading of the
// default branch's pushes can ask: the repo, its activity, compare, commits, statuses and pull-request lists. A push
// reaches it the way a push reaches GitHub: `git push` runs the bare repo's post-receive hook, which logs the ref change
// with its actor (FORGE_ACTOR in the pushing process's environment; empty, the forge records none) and its time
// (FORGE_AT, whole seconds since the epoch; unset, the wall clock). Three things are this suite's own: FORGE_AT, since
// the fixture's pushes are spread over thirty days; a commit's whole message under `commit.message`, as GitHub gives
// it, since a revert says what it reverts there; and `withhold`, the forge refusing to name some commits.
// Nothing here decides anything about DeepBuild. Unknown routes answer 404, and every call is kept.
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';

type Obj = Record<string, unknown>;
export interface Call { method: string; path: string; query: Record<string, string>; at: number; status: number; token: string | null }
export interface Status { repo: string; sha: string; state: string; context: string; description: string; target_url: string | null; at: number; token: string | null }
/** One ref change as the forge logs it. */
export interface RefChange { before: string; after: string; ref: string; at: number; actor: string }
interface Repo { full_name: string; bare: string; log: string; private: boolean }
interface Answer { status: number; body?: unknown; headers?: Record<string, string>; next?: string; refused?: boolean }

export const ZERO = '0'.repeat(40);
const FIELDS = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%T', '%B'].join('%x1f');
const GIT_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const git = (cwd: string, ...args: string[]): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', maxBuffer: 256 << 20 }, (error, out) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: out.trim() });
  });
});
/** The commit a ref or a SHA names in a bare repo, or undefined. */
const shaOf = async (bare: string, ref: string): Promise<string | undefined> => {
  const r = await git(bare, 'rev-parse', '--verify', '-q', `${ref}^{commit}`);
  return r.code === 0 ? r.out : undefined;
};
const user = (login: string): Obj => ({ login, id: login.length, type: 'User' });
const isoSeconds = (epoch: number): string => new Date(epoch * 1000).toISOString().replace('.000Z', 'Z');
const NOT_FOUND: Answer = { status: 404, body: { message: 'Not Found' } };
/** What a withheld commit's reads get: refused, and not as a rate limit, so nothing says when to ask again. */
const WITHHELD: Answer = { status: 403, body: { message: 'Forbidden' } };
const PERIODS: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };

/** One commit as GitHub's API shows it: the git fields under `commit`, the accounts they map to beside them. */
function commitOf(record: string): Obj {
  const [sha, parents, an, ae, ad, cn, ce, cd, tree, message] = record.split('\x1f') as [string, string, string, string, string, string, string, string, string, string];
  return {
    sha, parents: parents ? parents.split(' ').map((p) => ({ sha: p })) : [],
    commit: { author: { name: an, email: ae, date: ad }, committer: { name: cn, email: ce, date: cd }, message: message.trimEnd(), tree: { sha: tree } },
    author: user(an), committer: user(cn),
  };
}
const shown = (s: Status): Obj => ({ state: s.state, context: s.context, description: s.description, target_url: s.target_url, created_at: new Date(s.at).toISOString(), creator: user('deepbuild-gate') });
/** A list as GitHub pages it: `per_page` up to 100 (30 by default), the next page in `Link`, by `page` or, for activity, by the `after` cursor. */
function paged(items: Obj[], q: Record<string, string>, cursor = false): Answer {
  const per = Math.min(100, Number(q.per_page) || 30);
  const start = cursor ? (q.after ? items.findIndex((i) => String(i.id) === q.after) + 1 : 0) : ((Number(q.page) || 1) - 1) * per;
  const left = items.slice(start, start + per);
  const more = start + per < items.length;
  const shared = new URLSearchParams(Object.entries(q).filter(([k]) => k !== 'page' && k !== 'after'));
  shared.set('per_page', String(per));
  if (more) shared.set(cursor ? 'after' : 'page', cursor ? String(left.at(-1)!.id) : String((Number(q.page) || 1) + 1));
  return { status: 200, body: left, ...(more ? { next: shared.toString() } : {}) };
}

export class FixtureForge {
  readonly calls: Call[] = [];
  readonly statuses: Status[] = [];
  /** Every call that would change branch protection or a ruleset: refused with 403, kept here. */
  readonly refused: Call[] = [];
  readonly url: string;
  private readonly server: http.Server;
  private readonly dir: string;
  private readonly repos = new Map<string, Repo>();
  /** The commits the forge refuses to name. */
  private readonly withheld = new Set<string>();
  private constructor(server: http.Server, dir: string, url: string) {
    this.server = server;
    this.dir = dir;
    this.url = url;
  }

  static async start(dir: string): Promise<FixtureForge> {
    let forge: FixtureForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new FixtureForge(server, dir, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    return forge;
  }
  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** A repository: a bare repo at `<dir>/github.com/<full_name>.git`, its pushes logged with their actor and time. */
  repo(full_name: string, o: { private?: boolean } = {}): string {
    const bare = join(this.dir, 'github.com', `${full_name}.git`);
    mkdirSync(dirname(bare), { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: GIT_ENV, stdio: 'ignore' });
    const log = join(this.dir, `${full_name.replace('/', '-')}.pushes`);
    writeFileSync(log, '');
    writeFileSync(join(bare, 'hooks', 'post-receive'), `#!/bin/sh\nwhile read before after ref; do\n  printf '%s %s %s %s %s\\n' "$before" "$after" "$ref" "\${FORGE_AT:-$(date +%s)}" "\${FORGE_ACTOR:-}" >> '${log}'\ndone\n`);
    chmodSync(join(bare, 'hooks', 'post-receive'), 0o755);
    this.repos.set(full_name, { full_name, bare, log, private: o.private ?? true });
    return bare;
  }
  /** Ref changes written to the push log as a push would write them, for commits already in the bare repo. */
  record(full_name: string, changes: readonly RefChange[]): void {
    appendFileSync(this.repos.get(full_name)!.log, changes.map((c) => `${c.before} ${c.after} ${c.ref} ${Math.floor(c.at / 1000)} ${c.actor}\n`).join(''));
  }
  /** From now on the forge refuses, with a 403, every read whose answer would name one of these commits. */
  withhold(shas: readonly string[]): void { for (const sha of shas) this.withheld.add(sha); }

  /** Every call that isn't a read, refused ones too. */
  writes(): Call[] { return this.calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD'); }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const at = Date.now();
    const url = new URL(req.url ?? '/', this.url);
    const query = Object.fromEntries(url.searchParams);
    const token = /^(?:Bearer|token) (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const answer = await this.route(req.method ?? 'GET', url.pathname, query, raw, token, at).catch((error: unknown): Answer => ({ status: 500, body: { message: String(error) } }));
    const call: Call = { method: req.method ?? 'GET', path: url.pathname, query, at, status: answer.status, token };
    this.calls.push(call);
    if (answer.refused) this.refused.push(call);
    res.writeHead(answer.status, {
      'content-type': 'application/json; charset=utf-8', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.ceil(at / 1000) + 3600),
      ...(answer.next ? { link: `<${this.url}${url.pathname}?${answer.next}>; rel="next"` } : {}), ...answer.headers,
    });
    res.end(JSON.stringify(answer.body ?? null));
  }

  private async route(method: string, path: string, q: Record<string, string>, raw: string, token: string | null, at: number): Promise<Answer> {
    const write = method !== 'GET' && method !== 'HEAD';
    if (write && /^\/repos\/[^/]+\/[^/]+\/(?:branches\/.+\/protection|rulesets)(?:\/|$)/.test(path)) return { status: 403, refused: true, body: { message: 'DeepBuild never changes branch protection' } };
    if (write && path === '/graphql' && /mutation[\s\S]*(?:BranchProtection|Ruleset)/i.test(raw)) return { status: 403, refused: true, body: { message: 'DeepBuild never changes branch protection' } };
    const m = /^\/repos\/([^/]+\/[^/]+)(?:\/(.*))?$/.exec(path);
    const repo = m ? this.repos.get(m[1]!) : undefined;
    if (!repo) return NOT_FOUND;
    const rest = m![2] ?? '';
    if (method === 'POST') {
      const status = /^statuses\/([0-9a-f]{40})$/.exec(rest);
      return status ? this.postStatus(repo, status[1]!, raw, token, at) : NOT_FOUND;
    }
    if (method !== 'GET') return NOT_FOUND;
    if (rest === '') return { status: 200, body: { full_name: repo.full_name, name: repo.full_name.split('/')[1], owner: user(repo.full_name.split('/')[0]!), private: repo.private, visibility: repo.private ? 'private' : 'public', fork: false, default_branch: 'main' } };
    if (rest === 'activity') return this.activity(repo, q, at);
    if (rest === 'commits') {
      const sha = await shaOf(repo.bare, q.sha ?? 'main');
      if (!sha) return NOT_FOUND;
      const page = paged(await this.log(repo, [sha]), q);
      return (page.body as Obj[]).some((c) => this.withheld.has(String(c.sha))) ? WITHHELD : page;
    }
    let found: RegExpExecArray | null;
    if ((found = /^commits\/([^/]+)$/.exec(rest))) {
      const sha = await shaOf(repo.bare, found[1]!);
      if (!sha) return NOT_FOUND;
      return this.withheld.has(sha) ? WITHHELD : { status: 200, body: (await this.log(repo, ['-1', sha]))[0] };
    }
    if ((found = /^commits\/([^/]+)\/status$/.exec(rest))) return this.combined(repo, found[1]!);
    if ((found = /^commits\/([^/]+)\/statuses$/.exec(rest))) return { status: 200, body: this.statuses.filter((s) => s.sha === found![1] && s.repo === repo.full_name).reverse().map(shown) };
    if ((found = /^compare\/(.+)\.\.\.(.+)$/.exec(rest))) return this.compare(repo, found[1]!, found[2]!);
    // No pull request is open or closed here: the lists are empty, as GitHub's are for a repo with none.
    if (rest === 'pulls') return { status: 200, body: [] };
    return NOT_FOUND;
  }

  /** GitHub's checks on a status: a token, a known commit, one of its four states, a description of at most 140 characters. */
  private async postStatus(repo: Repo, sha: string, raw: string, token: string | null, at: number): Promise<Answer> {
    if (!token) return { status: 401, body: { message: 'Requires authentication' } };
    if (!(await shaOf(repo.bare, sha))) return { status: 422, body: { message: `No commit found for SHA: ${sha}` } };
    const body = JSON.parse(raw || '{}') as Obj;
    const state = String(body.state);
    if (!['error', 'failure', 'pending', 'success'].includes(state)) return { status: 422, body: { message: 'Validation Failed', errors: [{ resource: 'Status', field: 'state', code: 'custom' }] } };
    const description = typeof body.description === 'string' ? body.description : '';
    if (description.length > 140) return { status: 422, body: { message: 'Validation Failed', errors: [{ resource: 'Status', field: 'description', code: 'custom', message: 'description is too long (maximum is 140 characters)' }] } };
    const status: Status = { repo: repo.full_name, sha, state, context: typeof body.context === 'string' ? body.context : 'default', description, target_url: typeof body.target_url === 'string' ? body.target_url : null, at, token };
    this.statuses.push(status);
    return { status: 201, body: shown(status) };
  }
  private combined(repo: Repo, sha: string): Answer {
    const latest = new Map(this.statuses.filter((s) => s.sha === sha && s.repo === repo.full_name).map((s) => [s.context, s]));
    const states = [...latest.values()].map((s) => s.state);
    const state = states.some((s) => s === 'failure' || s === 'error') ? 'failure' : states.some((s) => s === 'pending') || !states.length ? 'pending' : 'success';
    return { status: 200, body: { sha, state, total_count: states.length, statuses: [...latest.values()].map(shown) } };
  }
  /**
   * GitHub's record of ref changes, newest first unless `direction=asc`, a page by the `after` cursor; `ref` (a full
   * ref or a branch's name), `actor`, `activity_type` and `time_period` (day, week, month, quarter, year) narrow it,
   * as GitHub's do.
   */
  private activity(repo: Repo, q: Record<string, string>, now: number): Answer {
    const lines = readFileSync(repo.log, 'utf8').split('\n').filter(Boolean);
    const since = q.time_period && PERIODS[q.time_period] ? now / 1000 - PERIODS[q.time_period]! * 86_400 : 0;
    const items = lines.map((line, i) => {
      const [before, after, ref, epoch, actor] = line.split(' ') as [string, string, string, string, string | undefined];
      const type = before === ZERO ? 'branch_creation' : after === ZERO ? 'branch_deletion' : 'push';
      return { id: i + 1, before, after, ref, timestamp: isoSeconds(Number(epoch)), activity_type: type, actor: actor ? user(actor) : null, epoch: Number(epoch) };
    }).filter((a) => (!q.ref || a.ref === q.ref || a.ref === `refs/heads/${q.ref}`) && (!q.actor || (a.actor as Obj | null)?.login === q.actor) && (!q.activity_type || a.activity_type === q.activity_type) && a.epoch >= since)
      .map(({ epoch: _, ...a }): Obj => a);
    return paged(q.direction === 'asc' ? items : items.reverse(), q, true);
  }
  private async log(repo: Repo, args: string[]): Promise<Obj[]> {
    const r = await git(repo.bare, 'log', `--format=${FIELDS}%x1e`, ...args);
    return r.out.split('\x1e').map((record) => record.replace(/^\n/, '')).filter(Boolean).map(commitOf);
  }
  /** `commits` are those of `head` that `base` lacks, oldest first; 404 for a commit the repo doesn't hold, the all-zero SHA among them. */
  private async compare(repo: Repo, base: string, head: string): Promise<Answer> {
    const [from, to] = [await shaOf(repo.bare, base), await shaOf(repo.bare, head)];
    if (!from || !to) return NOT_FOUND;
    const commits = await this.log(repo, ['--reverse', `${from}..${to}`]);
    if (commits.some((c) => this.withheld.has(String(c.sha)))) return WITHHELD;
    const behind = (await git(repo.bare, 'rev-list', '--count', `${to}..${from}`)).out;
    const files = (await git(repo.bare, 'diff', '--name-status', `${from}...${to}`)).out.split('\n').filter(Boolean).map((l) => ({ filename: l.split('\t').at(-1), status: l[0] === 'A' ? 'added' : l[0] === 'D' ? 'removed' : 'modified' }));
    return { status: 200, body: { status: commits.length && Number(behind) ? 'diverged' : commits.length ? 'ahead' : Number(behind) ? 'behind' : 'identical', ahead_by: commits.length, behind_by: Number(behind), total_commits: commits.length, commits, files } };
  }
}
