// The fixture forge for #1332 (README: What is real, what is played): GitHub as far as a work run reaches it, on
// 127.0.0.1. It sits in front of #1331's fixture forge (tests/acceptance/1331/forge.ts, imported by path, not copied),
// which holds the bare repos, git over HTTP, pull requests, statuses, merges, issues and their comments. This layer adds
// what a run reads and writes that those don't: an issue's whole view (when it was opened and closed, and by whom), the
// issue list read a page at a time, an issue's blocked-by links (its body's `### Depends on` list, as the base's
// `Forge.nextIssue` reads them, and GitHub's own `dependencies/blocked_by` list with the same links), and a pull request
// opened through the API by whoever holds the token. It decides nothing about DeepBuild.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { git, LandForge } from '../1331/forge.ts';

type Obj = Record<string, unknown>;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class WorkForge {
  /** Every call that reached this layer, in order. */
  readonly calls: { method: string; path: string; at: number; login: string | null }[] = [];
  /** When each issue was opened, and who closed one (the forge's own record). */
  private readonly opened = new Map<number, number>();
  private readonly closer = new Map<number, string>();
  /** Each pull request's head branch. */
  private readonly heads = new Map<number, string>();
  /** Each issue's blocked-by links, as its body lists them. */
  readonly links = new Map<number, number[]>();
  private constructor(readonly land: LandForge, private readonly server: http.Server, readonly url: string, readonly repoName: string) {}

  static async start(dir: string, repoName: string): Promise<WorkForge> {
    const land = await LandForge.start(dir, repoName);
    let forge: WorkForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new WorkForge(land, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, repoName);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.land.close();
  }
  get gate() { return this.land.gate; }
  get issues() { return this.land.issues; }
  get pulls() { return this.land.pulls; }
  get merges() { return this.land.merges; }
  get bareRepo(): string { return this.land.bareRepo; }

  /** An open issue with its body; `blockedBy` is the list its body's `### Depends on` section holds. */
  issue(o: { title: string; body: string; blockedBy?: number[]; openedAt?: number }): number {
    const n = this.land.issue({ title: o.title, body: o.body });
    this.opened.set(n, o.openedAt ?? Date.now());
    this.links.set(n, o.blockedBy ?? []);
    return n;
  }
  /** The issue closed by a person, as GitHub records a close from its page. */
  closeIssue(n: number, o: { by: string; at?: number }): void {
    const i = this.land.issues.get(n)!;
    i.state = 'closed';
    i.closedAt = o.at ?? Date.now();
    i.closedBy = 'person';
    this.closer.set(n, o.by);
  }
  /** A comment on the issue, as a person writes one. */
  comment(n: number, body: string): void { this.land.issues.get(n)!.comments.push({ body, at: Date.now() }); }
  /** A pull request of an existing branch, opened by `login`. */
  pull(o: { head: string; title: string; body: string; login: string }): number {
    const pr = this.land.pull(o);
    this.heads.set(pr, o.head);
    return pr;
  }
  /** The pull requests whose body links the issue (GitHub's keywords, or `Part of`). */
  pullsLinking(n: number): number[] {
    return [...this.land.pulls.entries()].filter(([, p]) => new RegExp(`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\\s+#${n}\\b`, 'i').test(p.body)).map(([pr]) => pr);
  }

  /** Who a token is: a person's own login, or an app's bot login for an installation token it issued. */
  loginOf(header: string | undefined): string | null {
    const token = /^(?:Bearer|token) (.+)$/i.exec(header ?? '')?.[1]?.trim();
    if (!token) return null;
    const person = this.gate.users.get(token);
    if (person) return person;
    const issued = this.gate.tokens.get(token);
    if (issued && issued.revoked === null && Date.now() < issued.expires) return this.gate.loginOf(this.gate.apps.get(issued.app)!);
    return null;
  }

  private view(n: number): Obj {
    const i = this.land.issues.get(n)!;
    const opened = this.opened.get(n) ?? Date.now();
    return {
      number: i.number, title: i.title, body: i.body, state: i.state, state_reason: i.state === 'closed' ? 'completed' : null,
      html_url: `https://github.com/${this.repoName}/issues/${i.number}`, url: `${this.url}/repos/${this.repoName}/issues/${i.number}`,
      user: { login: 'maya', type: 'User' }, author_association: 'OWNER', labels: [], assignees: [], milestone: null, comments: i.comments.length,
      created_at: iso(opened), updated_at: iso(Math.max(opened, i.closedAt ?? 0, ...i.comments.map((c) => c.at))),
      closed_at: i.closedAt === null ? null : iso(i.closedAt), closed_by: i.closedAt === null ? null : { login: this.closer.get(n) ?? 'maya', type: 'User' },
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const login = this.loginOf(req.headers.authorization);
    this.calls.push({ method, path: url.pathname + url.search, at: Date.now(), login });
    const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(value));
    };
    const root = `/repos/${this.repoName}`;
    let m: RegExpExecArray | null;

    if (method === 'GET' && url.pathname === `${root}/issues`) {
      const want = url.searchParams.get('state') ?? 'open';
      const all = [...this.land.issues.values()].filter((i) => want === 'all' || i.state === want).sort((a, b) => b.number - a.number);
      const per = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? 30) || 30));
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
      const slice = all.slice((page - 1) * per, page * per).map((i) => this.view(i.number));
      const next = page * per < all.length ? new URL(url) : undefined;
      next?.searchParams.set('page', String(page + 1));
      return send(200, slice, next ? { link: `<${next.toString()}>; rel="next"` } : {});
    }
    if (method === 'GET' && (m = new RegExp(`^${root}/issues/(\\d+)$`).exec(url.pathname))) {
      return this.land.issues.has(Number(m[1])) ? send(200, this.view(Number(m[1]))) : send(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = new RegExp(`^${root}/issues/(\\d+)/dependencies/blocked_by$`).exec(url.pathname))) {
      const n = Number(m[1]);
      if (!this.land.issues.has(n)) return send(404, { message: 'Not Found' });
      return send(200, (this.links.get(n) ?? []).filter((b) => this.land.issues.has(b)).map((b) => this.view(b)));
    }
    if (method === 'POST' && url.pathname === `${root}/pulls`) {
      if (!login) return send(401, { message: 'Requires authentication' });
      let j: Obj = {};
      try { j = JSON.parse(body.toString('utf8') || '{}') as Obj; } catch { return send(400, { message: 'Problems parsing JSON' }); }
      const head = String(j.head ?? '').replace(/^[^:]+:/, '');
      // GitHub opens a pull request only of a branch the repo holds.
      if (!head || (await git(this.land.bareRepo, ['rev-parse', '--verify', '--quiet', `refs/heads/${head}`])).code !== 0) {
        return send(422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }] });
      }
      const open = [...this.land.pulls.entries()].find(([pr, p]) => !p.merged && !p.closed && this.heads.get(pr) === head);
      if (open) return send(422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: `A pull request already exists for ${head}.` }] });
      let pr: number;
      try { pr = this.pull({ head, title: String(j.title ?? head), body: String(j.body ?? ''), login }); } catch (error) { return send(422, { message: String(error) }); }
      const shown = await fetch(`${this.land.url}${root}/pulls/${pr}`, { headers: { authorization: req.headers.authorization ?? '' } });
      return send(201, await shown.json());
    }

    // The rest is #1331's forge.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    const r = await fetch(`${this.land.url}${url.pathname}${url.search}`, { method, headers, ...(body.length ? { body: new Uint8Array(body) } : {}) });
    const out: Record<string, string> = { 'content-type': r.headers.get('content-type') ?? 'application/json' };
    const link = r.headers.get('link');
    if (link) out.link = link.replaceAll(this.land.url, this.url);
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  }
}
