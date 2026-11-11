// The fixture forge for #1331 (README: The fixture forge): GitHub as far as landing reaches it, on 127.0.0.1. It sits in
// front of #1325's fixture forge (tests/acceptance/1325/forge.ts, imported by path, not copied), which holds the bare
// repos, git over HTTP, pull requests, statuses and merges. This layer adds what #1331 reads and writes that those
// don't have: issues and their comments, a pull request's body, author and activity time, merged and closed states, and
// GitHub's closing keywords on a merge. It decides nothing about DeepBuild. With `drop` set it is the planted forge of
// the seventh criterion: it answers a merge `merged: true` and then drops one file from the commit it made.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateForge } from '../1325/forge.ts';

type Obj = Record<string, unknown>;
const GIT_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
export const git = (cwd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile('git', args, { cwd, env: { ...GIT_ENV, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 }, (error, out) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: out.trim() }));
});

export interface Issue { number: number; title: string; body: string; state: 'open' | 'closed'; comments: { body: string; at: number }[]; closedAt: number | null; closedBy: string | null }
export interface PullMeta { body: string; login: string; created: number; updated: number; merged: boolean; mergedSha: string | null; closed: boolean }
export interface Call { method: string; path: string; at: number; body: string }
export interface Drop { /** The merge (1 is the first) that loses the file. */ nth: number; path: string }

export class LandForge {
  readonly calls: Call[] = [];
  readonly issues = new Map<number, Issue>();
  readonly pulls = new Map<number, PullMeta>();
  /** Merges in the order they began, with when each began and ended. */
  readonly merges: { pr: number; began: number; ended: number; sha: string }[] = [];
  maxInFlight = 0;
  private inFlight = 0;
  private mergeCount = 0;
  drop: Drop | null = null;
  private constructor(readonly gate: GateForge, private readonly server: http.Server, readonly url: string, readonly repoName: string, private readonly bare: string) {}

  static async start(dir: string, repoName: string): Promise<LandForge> {
    const gate = await GateForge.start(dir);
    const bare = gate.repo(repoName);
    let forge: LandForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new LandForge(gate, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, repoName, bare);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.gate.close();
  }
  get bareRepo(): string { return this.bare; }

  issue(o: { title: string; body?: string }): number {
    const number = 100 + this.issues.size;
    this.issues.set(number, { number, title: o.title, body: o.body ?? '', state: 'open', comments: [], closedAt: null, closedBy: null });
    return number;
  }
  /** Opens a pull request of an existing branch of the repo, with its body, author and activity time. */
  pull(o: { head: string; title: string; body: string; login: string; daysIdle?: number }): number {
    const number = this.gate.inner.pull({ repo: this.repoName, head: o.head, base: 'main', title: o.title });
    const at = Date.now() - (o.daysIdle ?? 0) * 86_400_000;
    this.pulls.set(number, { body: o.body, login: o.login, created: at, updated: at, merged: false, mergedSha: null, closed: false });
    return number;
  }
  /** The statuses a commit holds, oldest first. */
  statusesOf(sha: string) { return this.gate.statusesOf(sha); }

  private async forward(req: http.IncomingMessage, url: URL, body: Buffer): Promise<{ status: number; text: string; headers: Headers }> {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    const r = await fetch(`${this.gate.url}${url.pathname}${url.search}`, { method: req.method ?? 'GET', headers, ...(body.length ? { body: new Uint8Array(body) } : {}) });
    return { status: r.status, text: await r.text(), headers: r.headers };
  }
  private overlay(pull: Obj): Obj {
    const meta = this.pulls.get(Number(pull.number));
    if (!meta) return pull;
    return {
      ...pull, body: meta.body, user: { login: meta.login, type: 'User' }, created_at: new Date(meta.created).toISOString(), updated_at: new Date(meta.updated).toISOString(),
      state: meta.merged || meta.closed ? 'closed' : 'open', merged: meta.merged, merged_at: meta.merged ? new Date(meta.updated).toISOString() : null, merge_commit_sha: meta.mergedSha,
    };
  }
  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    this.calls.push({ method, path: url.pathname + url.search, at: Date.now(), body: body.toString('utf8') });
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(value === undefined ? '' : JSON.stringify(value)); };
    const json = (): Obj => { try { return JSON.parse(body.toString('utf8') || '{}') as Obj; } catch { return {}; } };
    const root = `/repos/${this.repoName}`;
    let m: RegExpExecArray | null;
    const issueView = (i: Issue): Obj => ({ number: i.number, title: i.title, body: i.body, state: i.state, html_url: `https://github.com/${this.repoName}/issues/${i.number}`, comments: i.comments.length, user: { login: 'maya' }, labels: [] });

    if (url.pathname === `${root}/issues` && method === 'GET') {
      const want = url.searchParams.get('state') ?? 'open';
      return send(200, [...this.issues.values()].filter((i) => want === 'all' || i.state === want).map(issueView));
    }
    if (url.pathname === `${root}/issues` && method === 'POST') { const j = json(); return send(201, issueView(this.issues.get(this.issue({ title: String(j.title), body: String(j.body ?? '') }))!)); }
    if ((m = new RegExp(`^${root}/issues/(\\d+)(/comments)?$`).exec(url.pathname))) {
      const issue = this.issues.get(Number(m[1]));
      if (!issue) return send(404, { message: 'Not Found' });
      if (m[2]) {
        if (method === 'POST') { issue.comments.push({ body: String(json().body ?? ''), at: Date.now() }); return send(201, { body: json().body }); }
        return send(200, issue.comments.map((c) => ({ body: c.body, created_at: new Date(c.at).toISOString() })));
      }
      if (method === 'PATCH') {
        const j = json();
        if (typeof j.body === 'string') issue.body = j.body;
        if (j.state === 'closed' && issue.state !== 'closed') { issue.state = 'closed'; issue.closedAt = Date.now(); issue.closedBy = 'api'; }
        if (j.state === 'open') { issue.state = 'open'; issue.closedAt = null; }
        return send(200, issueView(issue));
      }
      return send(200, issueView(issue));
    }
    if (method === 'PATCH' && (m = new RegExp(`^${root}/pulls/(\\d+)$`).exec(url.pathname))) {
      const meta = this.pulls.get(Number(m[1]));
      if (meta && json().state === 'closed') meta.closed = true;
      return send(200, { number: Number(m[1]), state: meta?.closed ? 'closed' : 'open' });
    }
    if (method === 'PUT' && (m = new RegExp(`^${root}/pulls/(\\d+)/merge$`).exec(url.pathname))) return this.merge(req, url, body, Number(m[1]), send);

    const r = await this.forward(req, url, body);
    if (method === 'GET' && r.status === 200 && new RegExp(`^${root}/pulls(/\\d+)?$`).test(url.pathname)) {
      const parsed = JSON.parse(r.text) as Obj | Obj[];
      let out: unknown = Array.isArray(parsed) ? parsed.map((p) => this.overlay(p)).filter((p) => url.searchParams.get('state') === 'all' || p.state === 'open') : this.overlay(parsed);
      if (Array.isArray(parsed) && url.searchParams.get('state') === 'closed') out = parsed.map((p) => this.overlay(p)).filter((p) => p.state === 'closed');
      return send(200, out);
    }
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
    res.end(r.text);
  }

  /** A merge: made by the fixture's real forge; the planted forge then drops its file. GitHub's closing keywords close the issues the body names. */
  private async merge(req: http.IncomingMessage, url: URL, body: Buffer, pr: number, send: (s: number, v: unknown) => void): Promise<void> {
    const began = Date.now();
    this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight);
    try {
      const r = await this.forward(req, url, body);
      if (r.status !== 200) return send(r.status, JSON.parse(r.text || '{}'));
      let sha = String((JSON.parse(r.text) as Obj).sha);
      const nth = ++this.mergeCount;
      if (this.drop && this.drop.nth === nth) {
        const bare = this.bare;
        const step = async (args: string[], env: Record<string, string> = {}): Promise<string> => {
          const r = await git(bare, args, env);
          if (r.code !== 0) throw new Error(`the planted forge's drop failed at \`git ${args[0]}\` (exit ${r.code}): ${r.out}`);
          return r.out;
        };
        const parents = (await step(['rev-list', '--parents', '-n', '1', sha])).split(' ').slice(1);
        const idx = `${bare}/dh1331.index`;
        // update-index refuses a bare repository; an empty work tree (never written to) lets it edit the temporary index.
        const work = await mkdtemp(join(tmpdir(), 'dh1331-drop-'));
        const env = { GIT_INDEX_FILE: idx, GIT_WORK_TREE: work, GIT_AUTHOR_NAME: 'GitHub', GIT_AUTHOR_EMAIL: 'noreply@example.invalid', GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@example.invalid' };
        let dropped: string;
        try {
          await step(['read-tree', sha], env);
          await step(['update-index', '--force-remove', '--', this.drop.path], env);
          const tree = await step(['write-tree'], env);
          dropped = await step(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', `Merge pull request #${pr}`], env);
          await step(['update-ref', 'refs/heads/main', dropped, sha]);
        } finally { await rm(work, { recursive: true, force: true }); await rm(idx, { force: true }); }
        sha = dropped;
      }
      const meta = this.pulls.get(pr);
      if (meta) { meta.merged = true; meta.mergedSha = sha; meta.updated = Date.now(); for (const n of /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi[Symbol.matchAll](meta.body)) this.closeByMerge(Number(n[1])); }
      this.merges.push({ pr, began, ended: Date.now(), sha });
      send(200, { sha, merged: true, message: 'Pull Request successfully merged' });
    } finally { this.inFlight--; }
  }
  private closeByMerge(n: number): void {
    const issue = this.issues.get(n);
    if (issue && issue.state === 'open') { issue.state = 'closed'; issue.closedAt = Date.now(); issue.closedBy = 'merge'; }
  }
}
