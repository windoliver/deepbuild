// The fixture forge for #1335 (README: What is real, what is played): GitHub as far as a standing run reaches it, on
// 127.0.0.1. It sits in front of #1332's fixture forge (tests/acceptance/1332/forge.ts, imported by path, not
// copied), which holds the bare repos, git over HTTP, pull requests, merges, issues, their bodies, blocked-by links and
// comments. This layer adds what a rule on structure reads that those don't serve: each issue's author with GitHub's
// `author_association` and the `performed_via_github_app` of one an app opened, its labels and milestone in GitHub's
// REST shapes, the issue list with GitHub's filters a page at a time, an issue opened through the API by whoever holds
// the token, the repo's collaborators, the token's own user, the repo's labels and milestones, and a file's contents
// at a ref. It decides nothing about DeepBuild, and it records every call, so a test knows when the hub read issues.
import { execFile } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WorkForge } from '../1332/forge.ts';

type Obj = Record<string, unknown>;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** An author as GitHub shows one on an issue: the account, its type, and its association with the repo. */
export interface Author { login: string; type: 'User' | 'Bot'; association: 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'NONE' }
/** You: the repo's admin, whose token is the hub's GH_TOKEN. */
export const MAYA: Author = { login: 'maya', type: 'User', association: 'OWNER' };
/** An outside author: on no list of the repo's collaborators. */
export const DRIFTER: Author = { login: 'drifter', type: 'User', association: 'NONE' };
/** The repo's collaborators, as GitHub lists them: maya alone, an admin. */
const COLLABORATORS = new Map([['maya', 'admin']]);
/** The users the forge knows, with an ID each. */
const IDS: Record<string, number> = { maya: 4101, drifter: 4102, acme: 4100 };

export class RuleForge {
  /** Every call that reached this layer, in order, with the login of the token it carried. */
  readonly calls: { method: string; path: string; at: number; login: string | null }[] = [];
  /** Each issue opened through the API: its number, who opened it and when. */
  readonly opened: { issue: number; by: string; at: number }[] = [];
  /** Each issue's author and labels, when it was opened, and the app that opened it. */
  private readonly meta = new Map<number, { author: Author; labels: string[]; at: number; app: Obj | null }>();
  private constructor(readonly work: WorkForge, private readonly server: http.Server, readonly url: string, readonly repoName: string) {}

  static async start(dir: string, repoName: string): Promise<RuleForge> {
    const work = await WorkForge.start(dir, repoName);
    let forge: RuleForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new RuleForge(work, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, repoName);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.work.close();
  }
  get gate() { return this.work.gate; }
  get issues() { return this.work.issues; }
  get merges() { return this.work.merges; }
  pullsLinking(n: number): number[] { return this.work.pullsLinking(n); }

  /** An open issue, written by `author`, with its labels; its blocked-by links are the body's `### Depends on` list. */
  issue(o: { title: string; body: string; author: Author; labels: string[]; app?: Obj | null }): number {
    const n = this.work.issue({ title: o.title, body: o.body, blockedBy: dependsOn(o.body) });
    this.meta.set(n, { author: o.author, labels: [...o.labels], at: Date.now(), app: o.app ?? null });
    return n;
  }
  /** Whether the hub, by your token, read the issue list, or issue `n`, after `at`. */
  readAfter(at: number, n?: number): boolean {
    const list = `/repos/${this.repoName}/issues`;
    return this.calls.some((c) => c.method === 'GET' && c.at > at && c.login === MAYA.login
      && (c.path === list || c.path.startsWith(`${list}?`) || (n !== undefined && (c.path === `${list}/${n}` || c.path.startsWith(`${list}/${n}?`)))));
  }

  /** Who a token is: a person's login, or the bot login of the app whose installation token it is. */
  private who(header: string | undefined): { login: string; type: 'User' | 'Bot'; app: Obj | null } | null {
    const login = this.work.loginOf(header);
    if (!login) return null;
    if (!login.endsWith('[bot]')) return { login, type: 'User', app: null };
    const slug = login.slice(0, -'[bot]'.length);
    const app = [...this.gate.apps.values()].find((a) => a.slug === slug);
    return { login, type: 'Bot', app: { id: app?.id ?? 0, slug, name: slug, owner: this.user('acme') } };
  }
  private user(login: string, type: 'User' | 'Bot' | 'Organization' = 'User'): Obj {
    return { login, id: IDS[login] ?? 9000 + login.length, type, site_admin: false, html_url: `https://github.com/${login}` };
  }
  private label(name: string): Obj {
    const id = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_000_007, 7);
    return { id, node_id: `LA_${id}`, url: `${this.url}/repos/${this.repoName}/labels/${encodeURIComponent(name)}`, name, color: 'ededed', default: false, description: null };
  }
  /** An issue as GitHub's REST API shows one. */
  private view(n: number): Obj {
    const i = this.issues.get(n)!;
    const m = this.meta.get(n) ?? { author: MAYA, labels: [], at: Date.now(), app: null };
    const base = `${this.url}/repos/${this.repoName}/issues/${n}`;
    return {
      id: 7_000_000 + n, node_id: `I_${n}`, url: base, repository_url: `${this.url}/repos/${this.repoName}`, labels_url: `${base}/labels{/name}`, comments_url: `${base}/comments`,
      events_url: `${base}/events`, html_url: `https://github.com/${this.repoName}/issues/${n}`, number: n, state: i.state, state_reason: i.state === 'closed' ? 'completed' : null,
      title: i.title, body: i.body, user: this.user(m.author.login, m.author.type), labels: m.labels.map((l) => this.label(l)), assignee: null, assignees: [], milestone: null, locked: false,
      comments: i.comments.length, created_at: iso(m.at), updated_at: iso(Math.max(m.at, i.closedAt ?? 0, ...i.comments.map((c) => c.at))),
      closed_at: i.closedAt === null ? null : iso(i.closedAt), closed_by: i.closedAt === null ? null : this.user(MAYA.login), author_association: m.author.association,
      active_lock_reason: null, performed_via_github_app: m.app, timeline_url: `${base}/timeline`,
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const who = this.who(req.headers.authorization);
    this.calls.push({ method, path: url.pathname + url.search, at: Date.now(), login: who?.login ?? null });
    const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(value === undefined ? '' : JSON.stringify(value));
    };
    const root = `/repos/${this.repoName}`;
    let m: RegExpExecArray | null;

    if (method === 'GET' && url.pathname === '/user') {
      if (!req.headers.authorization) return send(401, { message: 'Requires authentication' });
      if (!who) return send(401, { message: 'Bad credentials' });
      return who.type === 'Bot' ? send(403, { message: 'Resource not accessible by integration' }) : send(200, this.user(who.login));
    }
    if (method === 'GET' && url.pathname === `${root}/collaborators`) {
      return send(200, [...COLLABORATORS].map(([login, role]) => ({ ...this.user(login), role_name: role, permissions: { admin: role === 'admin', maintain: role === 'admin', push: true, triage: true, pull: true } })));
    }
    if (method === 'GET' && (m = new RegExp(`^${root}/collaborators/([^/]+)(/permission)?$`).exec(url.pathname))) {
      const login = decodeURIComponent(m[1]!);
      const role = COLLABORATORS.get(login);
      if (!m[2]) return role ? send(204, undefined) : send(404, { message: 'Not Found' });
      if (!role && !(login in IDS) && !login.endsWith('[bot]')) return send(404, { message: 'Not Found' });
      return send(200, { permission: role ?? 'none', role_name: role ?? 'none', user: this.user(login, login.endsWith('[bot]') ? 'Bot' : 'User') });
    }
    if (method === 'GET' && url.pathname === `${root}/labels`) return send(200, [...new Set([...this.meta.values()].flatMap((x) => x.labels))].map((l) => this.label(l)));
    if (method === 'GET' && url.pathname === `${root}/milestones`) return send(200, []);
    if (method === 'GET' && (m = new RegExp(`^${root}/contents/(.+)$`).exec(url.pathname))) {
      const path = decodeURIComponent(m[1]!);
      const ref = url.searchParams.get('ref') ?? 'main';
      const bytes = await show(this.work.bareRepo, `${ref}:${path}`);
      if (!bytes) return send(404, { message: 'Not Found' });
      return send(200, { type: 'file', encoding: 'base64', size: bytes.length, name: path.split('/').at(-1), path, content: bytes.toString('base64'), url: `${this.url}${url.pathname}`, html_url: `https://github.com/${this.repoName}/blob/${ref}/${path}` });
    }
    if (method === 'GET' && url.pathname === `${root}/issues`) return this.list(url, send);
    if (method === 'POST' && url.pathname === `${root}/issues`) {
      if (!who) return send(401, { message: 'Requires authentication' });
      let j: Obj = {};
      try { j = JSON.parse(body.toString('utf8') || '{}') as Obj; } catch { return send(400, { message: 'Problems parsing JSON' }); }
      if (typeof j.title !== 'string' || !j.title) return send(422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }] });
      const labels = Array.isArray(j.labels) ? j.labels.map((l) => (typeof l === 'string' ? l : String((l as Obj)?.name ?? ''))).filter(Boolean) : [];
      const author: Author = { login: who.login, type: who.type, association: COLLABORATORS.has(who.login) ? (who.login === MAYA.login ? MAYA.association : 'COLLABORATOR') : 'NONE' };
      const n = this.issue({ title: j.title, body: typeof j.body === 'string' ? j.body : '', author, labels, app: who.app });
      this.opened.push({ issue: n, by: who.login, at: Date.now() });
      return send(201, this.view(n));
    }
    if (method === 'GET' && (m = new RegExp(`^${root}/issues/(\\d+)$`).exec(url.pathname))) {
      return this.issues.has(Number(m[1])) ? send(200, this.view(Number(m[1]))) : send(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = new RegExp(`^${root}/issues/(\\d+)/labels$`).exec(url.pathname))) {
      const n = Number(m[1]);
      return this.issues.has(n) ? send(200, (this.meta.get(n)?.labels ?? []).map((l) => this.label(l))) : send(404, { message: 'Not Found' });
    }

    // The rest is #1332's forge.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    const r = await fetch(`${this.work.url}${url.pathname}${url.search}`, { method, headers, ...(body.length ? { body: new Uint8Array(body) } : {}) });
    const out: Record<string, string> = { 'content-type': r.headers.get('content-type') ?? 'application/json' };
    const link = r.headers.get('link');
    if (link) out.link = link.replaceAll(this.work.url, this.url);
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  /** GitHub's issue list: its state, labels (each one named), creator, milestone, since, sort and direction, a page at a time. */
  private list(url: URL, send: (status: number, value: unknown, headers?: Record<string, string>) => void): void {
    const q = url.searchParams;
    const state = q.get('state') ?? 'open';
    const labels = (q.get('labels') ?? '').split(',').map((l) => l.trim()).filter(Boolean);
    const creator = q.get('creator');
    const milestone = q.get('milestone');
    const since = q.get('since') ? Date.parse(q.get('since')!) : undefined;
    let all = [...this.issues.values()].map((i) => this.view(i.number)).filter((v) => {
      const author = (v.user as Obj).login;
      const names = (v.labels as Obj[]).map((l) => l.name);
      // No fixture issue has a milestone: `none` and no filter keep each one, `*` or a number none.
      const inMilestone = milestone === null || milestone === 'none';
      return (state === 'all' || v.state === state) && labels.every((l) => names.includes(l)) && (!creator || author === creator) && inMilestone
        && (since === undefined || Date.parse(String(v.updated_at)) >= since);
    });
    const key = q.get('sort') === 'updated' ? 'updated_at' : q.get('sort') === 'comments' ? 'comments' : 'created_at';
    all = all.sort((a, b) => (String(a[key]).localeCompare(String(b[key]), 'en', { numeric: true }) || Number(a.number) - Number(b.number)) * (q.get('direction') === 'asc' ? 1 : -1));
    const per = Math.min(100, Math.max(1, Number(q.get('per_page') ?? 30) || 30));
    const page = Math.max(1, Number(q.get('page') ?? 1) || 1);
    const next = page * per < all.length ? new URL(url) : undefined;
    next?.searchParams.set('page', String(page + 1));
    send(200, all.slice((page - 1) * per, page * per), next ? { link: `<${next.toString()}>; rel="next"` } : {});
  }
}

/** The issues a body's `### Depends on` list names, one `- #<n>` a line, as this repo writes them. */
function dependsOn(body: string): number[] {
  const m = /^#+\s*depends on\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body);
  return m ? [...m[1]!.matchAll(/^\s*[-*]\s*#(\d+)\b/gm)].map((x) => Number(x[1])) : [];
}
/** A file's bytes at a ref of a bare repo, or undefined when it holds none there. */
function show(bare: string, spec: string): Promise<Buffer | undefined> {
  return new Promise((resolve) => execFile('git', ['--git-dir', bare, 'cat-file', 'blob', spec], { encoding: 'buffer', maxBuffer: 16 << 20, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' } },
    (error, out) => resolve(error ? undefined : out)));
}
