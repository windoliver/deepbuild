// The fixture forge for #1347's fifth criterion (README: What is real, what is played): GitHub as far as moving a
// workspace to a repo reaches it, on 127.0.0.1. It sits in front of #1332's fixture forge (../1332/forge.ts, imported by
// path, not copied), which holds the bare repo, git over HTTP, the issues, their bodies (PATCH included) and their
// comments. This layer adds what filing issues reads and writes that those don't: each issue's `id` beside its number,
// as GitHub gives one; an issue opened through `POST /repos/{owner}/{repo}/issues` by whoever holds the token, each
// recorded; GitHub's own blocked-by links (`POST /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` with the
// blocking issue's `issue_id`, and the same list read back); and `GET /user`. It decides nothing about DeepBuild.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WorkForge } from '../1332/forge.ts';

type Obj = Record<string, unknown>;
/** An issue's `id`, which GitHub keeps apart from its number: a blocked-by link names the blocking issue by it. */
export const idOf = (n: number): number => 4_200_000 + n;
/** The issues a body's `### Depends on` list names, one `- #<n>` a line, as the base reads a body's blocked-by links. */
export function dependsOn(body: string): number[] {
  const m = /^#+\s*depends on\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body);
  return m ? [...m[1]!.matchAll(/^\s*[-*]\s*#(\d+)\b/gm)].map((x) => Number(x[1])) : [];
}

export class FileForge {
  /** Every issue opened through the API, in order, with who opened it. */
  readonly opened: { number: number; title: string; body: string; login: string; at: number }[] = [];
  /** Each issue's blocked-by links made through GitHub's dependencies API, by the blocking issues' numbers. */
  readonly blockedBy = new Map<number, number[]>();
  private constructor(readonly work: WorkForge, private readonly server: http.Server, readonly url: string, readonly repoName: string) {}

  static async start(dir: string, repoName: string): Promise<FileForge> {
    const work = await WorkForge.start(dir, repoName);
    let forge: FileForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new FileForge(work, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, repoName);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.work.close();
  }

  /** An issue's blocked-by links as the forge holds them: its body's `### Depends on` list and GitHub's own list, by number. */
  linksOf(n: number): number[] {
    return [...new Set([...dependsOn(this.work.issues.get(n)?.body ?? ''), ...(this.blockedBy.get(n) ?? [])])].sort((a, b) => a - b);
  }

  /** The inner forge's answer to the same request, with each issue's `id` beside its number. */
  private async forward(method: string, given: http.IncomingHttpHeaders, url: URL, body: Buffer): Promise<{ status: number; type: string; link: string | null; bytes: Buffer }> {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(given)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    const r = await fetch(`${this.work.url}${url.pathname}${url.search}`, { method, headers, ...(body.length ? { body: new Uint8Array(body) } : {}) });
    let bytes = Buffer.from(await r.arrayBuffer());
    if (r.ok && new RegExp(`^/repos/${this.repoName}/issues(?:/\\d+)?$`).test(url.pathname)) {
      const withId = (v: unknown): unknown => (v && typeof v === 'object' && typeof (v as Obj).number === 'number' ? { id: idOf((v as Obj).number as number), ...(v as Obj) } : v);
      try { const parsed = JSON.parse(bytes.toString('utf8')) as unknown; bytes = Buffer.from(JSON.stringify(Array.isArray(parsed) ? parsed.map(withId) : withId(parsed))); } catch { /* not JSON */ }
    }
    return { status: r.status, type: r.headers.get('content-type') ?? 'application/json', link: r.headers.get('link')?.replaceAll(this.work.url, this.url) ?? null, bytes };
  }
  /** One issue as GitHub shows it, with its `id`. */
  private async view(req: http.IncomingMessage, n: number): Promise<unknown> {
    const r = await this.forward('GET', { authorization: req.headers.authorization }, new URL(`/repos/${this.repoName}/issues/${n}`, this.url), Buffer.alloc(0));
    return JSON.parse(r.bytes.toString('utf8')) as unknown;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const login = this.work.loginOf(req.headers.authorization);
    const send = (status: number, value: unknown): void => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const json = (): Obj => { try { return JSON.parse(body.toString('utf8') || '{}') as Obj; } catch { return {}; } };
    const root = `/repos/${this.repoName}`;
    let m: RegExpExecArray | null;

    if (method === 'GET' && url.pathname === '/user') return login ? send(200, { login, type: 'User' }) : send(401, { message: 'Requires authentication' });
    if (method === 'POST' && url.pathname === `${root}/issues`) {
      if (!login) return send(401, { message: 'Requires authentication' });
      const j = json();
      if (typeof j.title !== 'string' || !j.title) return send(422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }] });
      const text = typeof j.body === 'string' ? j.body : '';
      const n = this.work.issue({ title: j.title, body: text });
      this.opened.push({ number: n, title: j.title, body: text, login, at: Date.now() });
      return send(201, await this.view(req, n));
    }
    if ((m = new RegExp(`^${root}/issues/(\\d+)/dependencies/blocked_by$`).exec(url.pathname))) {
      const n = Number(m[1]);
      if (!this.work.issues.has(n)) return send(404, { message: 'Not Found' });
      if (method === 'POST') {
        if (!login) return send(401, { message: 'Requires authentication' });
        const id = Number(json().issue_id);
        const blocker = [...this.work.issues.keys()].find((k) => idOf(k) === id);
        if (blocker === undefined) return send(404, { message: 'Not Found' });
        const list = this.blockedBy.get(n) ?? [];
        if (!list.includes(blocker)) list.push(blocker);
        this.blockedBy.set(n, list);
        return send(201, await this.view(req, blocker));
      }
      if (method === 'GET') return send(200, await Promise.all((this.blockedBy.get(n) ?? []).map((b) => this.view(req, b))));
    }

    // The rest is #1332's forge, each issue with its `id`.
    const r = await this.forward(method, req.headers, url, body);
    res.writeHead(r.status, { 'content-type': r.type, ...(r.link ? { link: r.link } : {}) });
    res.end(r.bytes);
  }
}
