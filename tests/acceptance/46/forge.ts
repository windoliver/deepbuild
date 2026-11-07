// The fixture forge (README: The fixture forge): real HTTP on 127.0.0.1 shaped like GitHub's REST API, over real bare
// git repositories. A push reaches it the way a push reaches GitHub: `git push` runs the bare repo's post-receive hook,
// which logs the ref change with its actor, and GET /activity reads that log. FORGE_ACTOR, in the pushing process's
// environment, is the account the forge records; empty or unset, it records no actor. Nothing here decides anything
// about DeepBuild. Unknown routes answer 404, and every call is kept, so a test can read what reached the forge.
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';

type Obj = Record<string, unknown>;
export interface Call { method: string; path: string; query: Record<string, string>; at: number; status: number; token: string | null }
export interface Status { repo: string; sha: string; state: string; context: string; description: string; target_url: string | null; at: number; token: string | null }
/** One answer forced on the next POST of a status, as a rate limit gives it. */
export interface Forced { status: number; headers: Record<string, string>; message: string }
interface Repo { full_name: string; bare: string; log: string; private: boolean; fork: boolean; parent: string | null }
interface Pull { number: number; repo: string; head_repo: string; head: string; base: string; title: string; computed: string }

const ZERO = '0'.repeat(40);
const FIELDS = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%T', '%s'].join('%x00');
const GIT_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const git = (cwd: string, ...args: string[]): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 << 20 }, (error, out) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: out.trim() });
  });
});
/** The reference a push log's ref or a branch name holds in a bare repo, or undefined. */
const shaOf = async (bare: string, ref: string): Promise<string | undefined> => {
  const r = await git(bare, 'rev-parse', '--verify', '-q', `${ref}^{commit}`);
  return r.code === 0 ? r.out : undefined;
};
const user = (login: string): Obj => ({ login, id: login.length, type: 'User' });
const isoSeconds = (epoch: number): string => new Date(epoch * 1000).toISOString().replace('.000Z', 'Z');

/** One commit as GitHub's API shows it: the git fields under `commit`, the accounts they map to beside them. */
function commitOf(line: string): Obj {
  const [sha, parents, an, ae, ad, cn, ce, cd, tree, subject] = line.split('\0') as [string, string, string, string, string, string, string, string, string, string];
  return {
    sha, parents: parents ? parents.split(' ').map((p) => ({ sha: p })) : [],
    commit: { author: { name: an, email: ae, date: ad }, committer: { name: cn, email: ce, date: cd }, message: subject, tree: { sha: tree } },
    author: user(an), committer: user(cn),
  };
}

export class FixtureForge {
  readonly calls: Call[] = [];
  readonly statuses: Status[] = [];
  /** Every call that would change branch protection or a ruleset: refused with 403, kept here. */
  readonly refused: Call[] = [];
  private readonly repos = new Map<string, Repo>();
  private readonly pulls: Pull[] = [];
  private readonly forced: Forced[] = [];
  private constructor(private readonly server: http.Server, private readonly dir: string, readonly url: string) {}

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

  /** A repository: a bare repo at `<dir>/github.com/<full_name>.git`, its pushes logged with their actor; a fork starts as a clone of its parent. */
  repo(full_name: string, o: { private?: boolean; parent?: string } = {}): string {
    const bare = join(this.dir, 'github.com', `${full_name}.git`);
    mkdirSync(dirname(bare), { recursive: true });
    const parent = o.parent ? this.repos.get(o.parent)! : undefined;
    const quiet = { env: GIT_ENV, stdio: 'ignore' as const };
    if (parent) execFileSync('git', ['clone', '-q', '--bare', parent.bare, bare], quiet);
    else execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], quiet);
    const log = join(this.dir, `${full_name.replace('/', '-')}.pushes`);
    writeFileSync(log, '');
    writeFileSync(join(bare, 'hooks', 'post-receive'), `#!/bin/sh\nwhile read before after ref; do\n  printf '%s %s %s %s %s\\n' "$before" "$after" "$ref" "$(date +%s)" "\${FORGE_ACTOR:-}" >> '${log}'\ndone\n`);
    chmodSync(join(bare, 'hooks', 'post-receive'), 0o755);
    this.repos.set(full_name, { full_name, bare, log, private: o.private ?? true, fork: parent !== undefined, parent: o.parent ?? null });
    return bare;
  }
  /** Opens a pull request of `head` (a branch of `head_repo`) into `base`, and returns its number. */
  pull(o: { repo: string; head: string; base?: string; head_repo?: string; title?: string }): number {
    const number = this.pulls.length + 1;
    this.pulls.push({ number, repo: o.repo, head_repo: o.head_repo ?? o.repo, head: o.head, base: o.base ?? 'main', title: o.title ?? o.head, computed: '' });
    return number;
  }
  /** The next POST of a status gets this answer and changes nothing. */
  limitNext(forced: Forced): void { this.forced.push(forced); }

  /** Every status a commit holds, oldest first. */
  statusesOf(sha: string): Status[] { return this.statuses.filter((s) => s.sha === sha); }
  latest(sha: string): Status | undefined { return this.statusesOf(sha).at(-1); }
  /** Every POST of a status that reached the forge, refused ones too. */
  posts(): Call[] { return this.calls.filter((c) => c.method === 'POST' && /\/statuses\//.test(c.path)); }

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
    if (rest === '') return { status: 200, body: { full_name: repo.full_name, name: repo.full_name.split('/')[1], owner: user(repo.full_name.split('/')[0]!), private: repo.private, visibility: repo.private ? 'private' : 'public', fork: repo.fork, parent: repo.parent ? { full_name: repo.parent } : undefined, default_branch: 'main' } };
    if (rest === 'activity') return this.activity(repo, q);
    if (rest === 'commits') {
      const sha = await shaOf(repo.bare, q.sha ?? 'main');
      if (!sha) return NOT_FOUND;
      return paged(await this.log(repo, [sha]), q);
    }
    let found: RegExpExecArray | null;
    if ((found = /^commits\/([^/]+)$/.exec(rest))) {
      const sha = await shaOf(repo.bare, found[1]!);
      return sha ? { status: 200, body: (await this.log(repo, ['-1', sha]))[0] } : NOT_FOUND;
    }
    if ((found = /^commits\/([^/]+)\/status$/.exec(rest))) return this.combined(repo, found[1]!);
    if ((found = /^commits\/([^/]+)\/statuses$/.exec(rest))) return { status: 200, body: this.statusesOf(found[1]!).filter((s) => s.repo === repo.full_name).reverse().map(shown) };
    if ((found = /^compare\/(.+)\.\.\.(.+)$/.exec(rest))) return this.compare(repo, found[1]!, found[2]!);
    if (rest === 'pulls') return this.listPulls(repo, q);
    if ((found = /^pulls\/(\d+)(?:\/(commits|files))?$/.exec(rest))) {
      const pull = this.pulls.find((p) => p.repo === repo.full_name && p.number === Number(found![1]));
      if (!pull) return NOT_FOUND;
      if (found[2] === 'commits') return this.pullCommits(pull, q);
      if (found[2] === 'files') return this.pullFiles(pull, q);
      return { status: 200, body: await this.pullOf(pull, true) };
    }
    return NOT_FOUND;
  }

  /** GitHub's checks on a status: a known commit, one of its four states, a description of at most 140 characters, a token. */
  private async postStatus(repo: Repo, sha: string, raw: string, token: string | null, at: number): Promise<Answer> {
    const forced = this.forced.shift();
    if (forced) return { status: forced.status, headers: forced.headers, body: { message: forced.message } };
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
    const latest = new Map(this.statusesOf(sha).filter((s) => s.repo === repo.full_name).map((s) => [s.context, s]));
    const states = [...latest.values()].map((s) => s.state);
    const state = states.some((s) => s === 'failure' || s === 'error') ? 'failure' : states.some((s) => s === 'pending') || !states.length ? 'pending' : 'success';
    return { status: 200, body: { sha, state, total_count: states.length, statuses: [...latest.values()].map(shown) } };
  }
  /** GitHub's record of ref changes, newest first unless `direction=asc`, a page by the `after` cursor. */
  private activity(repo: Repo, q: Record<string, string>): Answer {
    const lines = readFileSync(repo.log, 'utf8').split('\n').filter(Boolean);
    const items = lines.map((line, i) => {
      const [before, after, ref, epoch, actor] = line.split(' ') as [string, string, string, string, string | undefined];
      const type = before === ZERO ? 'branch_creation' : after === ZERO ? 'branch_deletion' : 'push';
      return { id: i + 1, before, after, ref, timestamp: isoSeconds(Number(epoch)), activity_type: type, actor: actor ? user(actor) : null };
    });
    return paged(q.direction === 'asc' ? items : items.reverse(), q, true);
  }
  private async log(repo: Repo, args: string[]): Promise<Obj[]> {
    const r = await git(repo.bare, 'log', `--format=${FIELDS}`, ...args);
    return r.out.split('\n').filter(Boolean).map(commitOf);
  }
  private async compare(repo: Repo, base: string, head: string): Promise<Answer> {
    const [from, to] = [await shaOf(repo.bare, base), await shaOf(repo.bare, head)];
    if (!from || !to) return NOT_FOUND;
    const commits = await this.log(repo, ['--reverse', `${from}..${to}`]);
    const behind = (await git(repo.bare, 'rev-list', '--count', `${to}..${from}`)).out;
    const files = (await git(repo.bare, 'diff', '--name-status', `${from}...${to}`)).out.split('\n').filter(Boolean).map((l) => ({ filename: l.split('\t').at(-1), status: l[0] === 'A' ? 'added' : l[0] === 'D' ? 'removed' : 'modified' }));
    return { status: 200, body: { status: commits.length && Number(behind) ? 'diverged' : commits.length ? 'ahead' : Number(behind) ? 'behind' : 'identical', ahead_by: commits.length, behind_by: Number(behind), total_commits: commits.length, commits, files } };
  }
  /** A pull's head in its base repo: a fork's is fetched there, as refs/pull/<n>/head is on GitHub. */
  private async headIn(pull: Pull): Promise<string | undefined> {
    const repo = this.repos.get(pull.repo)!;
    const from = this.repos.get(pull.head_repo)!;
    if (from === repo) return shaOf(repo.bare, `refs/heads/${pull.head}`);
    await git(repo.bare, 'fetch', '-q', from.bare, `+refs/heads/${pull.head}:refs/pull/${pull.number}/head`);
    return shaOf(repo.bare, `refs/pull/${pull.number}/head`);
  }
  /** One pull request. The single GET carries `mergeable`, null on its first read after either side moved, as GitHub computes it in the background; a list never carries it. */
  private async pullOf(pull: Pull, single: boolean): Promise<Obj> {
    const repo = this.repos.get(pull.repo)!;
    const [head, base] = [await this.headIn(pull), await shaOf(repo.bare, `refs/heads/${pull.base}`)];
    const side = (name: Repo, ref: string, sha: string | undefined) => ({ ref, sha, label: `${name.full_name.split('/')[0]}:${ref}`, repo: { full_name: name.full_name, fork: name.fork, private: name.private } });
    const body: Obj = {
      number: pull.number, state: 'open', title: pull.title, body: '', merged: false, html_url: `https://github.com/${pull.repo}/pull/${pull.number}`, user: user(pull.head_repo.split('/')[0]!),
      head: side(this.repos.get(pull.head_repo)!, pull.head, head), base: side(repo, pull.base, base),
    };
    if (!single) return body;
    const key = `${base}:${head}`;
    if (pull.computed !== key) { pull.computed = key; return { ...body, mergeable: null, mergeable_state: 'unknown' }; }
    const clean = (await git(repo.bare, 'merge-tree', '--write-tree', '--name-only', base!, head!)).code === 0;
    return { ...body, mergeable: clean, mergeable_state: clean ? 'clean' : 'dirty' };
  }
  private async listPulls(repo: Repo, q: Record<string, string>): Promise<Answer> {
    const open = q.state === 'closed' ? [] : this.pulls.filter((p) => p.repo === repo.full_name);
    const named = open.filter((p) => (!q.head || q.head === `${p.head_repo.split('/')[0]}:${p.head}`) && (!q.base || q.base === p.base));
    return paged(await Promise.all(named.map((p) => this.pullOf(p, false))), q);
  }
  private async pullCommits(pull: Pull, q: Record<string, string>): Promise<Answer> {
    const repo = this.repos.get(pull.repo)!;
    return paged(await this.log(repo, ['--reverse', `refs/heads/${pull.base}..${(await this.headIn(pull))!}`]), q);
  }
  private async pullFiles(pull: Pull, q: Record<string, string>): Promise<Answer> {
    const repo = this.repos.get(pull.repo)!;
    const out = (await git(repo.bare, 'diff', '--name-only', `refs/heads/${pull.base}...${(await this.headIn(pull))!}`)).out;
    return paged(out.split('\n').filter(Boolean).map((filename) => ({ filename, status: 'modified' })), q);
  }
}

interface Answer { status: number; body?: unknown; headers?: Record<string, string>; next?: string; refused?: boolean }
const NOT_FOUND: Answer = { status: 404, body: { message: 'Not Found' } };
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
