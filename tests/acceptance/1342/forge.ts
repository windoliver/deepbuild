// The fixture forge for #1342 (README: What is real, what is played): GitHub as far as making a project reaches it, on
// 127.0.0.1. It sits in front of #1325's fixture forge (../1325/forge.ts, imported by path, not copied), which holds
// the bare repos, git over HTTP with a person's token, and its own record of every push. This layer adds what making a
// project reads and writes that that one doesn't: `GET /user`, a repo made through `POST /user/repos` or
// `POST /orgs/{org}/repos` (each kept with whether it is private), a repo's visibility changed through
// `PATCH /repos/{owner}/{repo}`, and every call that reached it, in order. It decides nothing about DeepBuild.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GateForge } from '../1325/forge.ts';

type Obj = Record<string, unknown>;
/** One call that reached the forge's API, with its parsed body. */
export interface Call { method: string; path: string; at: number; login: string | null; body: Obj | null }
/** A repo made through the API: its name, whether it is private now, and the call that made it. */
export interface Made { full_name: string; private: boolean; at: number; call: Call }

/** A repo is private when the call says so: `private: true` or `visibility: "private"`; GitHub's default is public. */
const privateOf = (body: Obj | null): boolean => body?.private === true || body?.visibility === 'private';

export class RepoForge {
  readonly calls: Call[] = [];
  readonly repos: Made[] = [];
  private constructor(readonly gate: GateForge, private readonly server: http.Server, readonly url: string) {}

  static async start(dir: string): Promise<RepoForge> {
    const gate = await GateForge.start(dir);
    let forge: RepoForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new RepoForge(gate, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.gate.close();
  }
  /** A person's own token, with admin on every repo the forge holds. */
  person(login: string): string { return this.gate.person(login, true); }

  /**
   * Every call that changes something on the forge, oldest first: each API call but a GET or HEAD, and each push the
   * forge's git took or refused, as `<METHOD> <path>` (a push names its ref).
   */
  writes(): { at: number; line: string }[] {
    const api = this.calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD').map((c) => ({ at: c.at, line: `${c.method} ${c.path}` }));
    const pushes = this.gate.attempts.filter((a) => a.action.startsWith('push')).map((a) => ({ at: a.at, line: `push ${a.target}` }));
    return [...api, ...pushes].sort((a, b) => a.at - b.at);
  }

  private view(r: Made): Obj {
    const [owner, name] = r.full_name.split('/') as [string, string];
    return {
      id: 7_000_000 + this.repos.indexOf(r), name, full_name: r.full_name, owner: { login: owner, type: 'User' }, private: r.private,
      visibility: r.private ? 'private' : 'public', html_url: `https://github.com/${r.full_name}`, clone_url: this.gate.gitUrl(r.full_name), default_branch: 'main',
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const token = /^(?:Bearer|token) (.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim();
    const login = token ? this.gate.users.get(token) ?? null : null;
    let body: Obj | null = null;
    try { const v = JSON.parse(raw.toString('utf8')) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) body = v as Obj; } catch { /* not JSON */ }
    const call: Call = { method, path: url.pathname, at: Date.now(), login, body };
    this.calls.push(call);
    const send = (status: number, value: unknown): void => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    let m: RegExpExecArray | null;

    if (method === 'GET' && url.pathname === '/user') return login ? send(200, { login, id: login.length, type: 'User' }) : send(401, { message: 'Requires authentication' });
    if (method === 'POST' && (url.pathname === '/user/repos' || (m = /^\/orgs\/([^/]+)\/repos$/.exec(url.pathname)))) {
      if (!login) return send(401, { message: 'Requires authentication' });
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!/^[\w.-]+$/.test(name)) return send(422, { message: 'Validation Failed', errors: [{ resource: 'Repository', field: 'name', code: 'missing_field' }] });
      const owner = url.pathname === '/user/repos' ? login : /^\/orgs\/([^/]+)\/repos$/.exec(url.pathname)![1]!;
      const full_name = `${owner}/${name}`;
      if (this.repos.some((r) => r.full_name === full_name)) return send(422, { message: 'Repository creation failed.', errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }] });
      this.gate.repo(full_name);
      const made: Made = { full_name, private: privateOf(body), at: call.at, call };
      this.repos.push(made);
      return send(201, this.view(made));
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname))) {
      const made = this.repos.find((r) => r.full_name === m![1]);
      if (made && method === 'PATCH') {
        if (!login) return send(401, { message: 'Requires authentication' });
        if (body && ('private' in body || 'visibility' in body)) made.private = privateOf(body);
        return send(200, this.view(made));
      }
      if (made && method === 'GET') return send(200, this.view(made));
    }

    // The rest is #1325's forge.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    const r = await fetch(`${this.gate.url}${url.pathname}${url.search}`, { method, headers, ...(raw.length ? { body: new Uint8Array(raw) } : {}) });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
    res.end(Buffer.from(await r.arrayBuffer()));
  }
}
