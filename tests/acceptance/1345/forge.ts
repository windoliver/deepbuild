// The fixture forge for #1345 (README: What is real, what is played): GitHub as far as a standing run reaches it, on
// 127.0.0.1. It sits in front of #1335's fixture forge (tests/acceptance/1335/forge.ts, imported by path, not copied),
// which holds the bare repo, git over HTTP, issues with their authors and labels, blocked-by links, comments, pull
// requests, statuses and merges. This layer adds what reaching a published page and a release reads, in GitHub's REST
// shapes: the repo's GitHub Pages site (`GET /repos/{owner}/{repo}/pages`, built from main's `docs/` folder when the
// world has one, else 404 as GitHub answers for a repo with none), its releases (none), and a pull request's body
// edited through the API, as GitHub applies it. It decides nothing about DeepBuild.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RuleForge } from '../1335/forge.ts';

type Obj = Record<string, unknown>;

export class PagesForge {
  private constructor(readonly rule: RuleForge, private readonly server: http.Server, readonly url: string, readonly repoName: string, readonly pages: boolean) {}

  /** The forge for `repoName`; with `pages`, the repo's Pages site is built from main's `docs/` folder. */
  static async start(dir: string, repoName: string, o: { pages: boolean }): Promise<PagesForge> {
    const rule = await RuleForge.start(dir, repoName);
    let forge: PagesForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new PagesForge(rule, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, repoName, o.pages);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.rule.close();
  }
  get gate() { return this.rule.gate; }
  get issues() { return this.rule.issues; }
  get merges() { return this.rule.merges; }
  get bareRepo(): string { return this.rule.work.bareRepo; }
  /** Every commit status the forge holds, oldest first: the context, its state and its description. */
  get statuses() { return this.rule.gate.statuses; }
  pullsLinking(n: number): number[] { return this.rule.pullsLinking(n); }
  /** A pull request's body as the forge holds it now. */
  bodyOf(pr: number): string { return this.rule.work.land.pulls.get(pr)?.body ?? ''; }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const send = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    const root = `/repos/${this.repoName}`;
    let m: RegExpExecArray | null;

    if (method === 'GET' && url.pathname === `${root}/pages`) {
      if (!this.pages) return send(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest/pages/pages#get-a-apiname-pages-site', status: '404' });
      const [owner, name] = this.repoName.split('/') as [string, string];
      return send(200, {
        url: `${this.url}${root}/pages`, status: 'built', cname: null, custom_404: false, html_url: `https://${owner}.github.io/${name}/`,
        build_type: 'legacy', source: { branch: 'main', path: '/docs' }, public: true, https_enforced: true,
      });
    }
    if (method === 'GET' && url.pathname === `${root}/releases`) return send(200, []);
    if (method === 'GET' && (url.pathname === `${root}/releases/latest` || new RegExp(`^${root}/releases/tags/.+$`).test(url.pathname))) {
      return send(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest/releases/releases', status: '404' });
    }
    // GitHub applies a pull request's new body; #1331's forge below keeps only its state.
    if (method === 'PATCH' && (m = new RegExp(`^${root}/pulls/(\\d+)$`).exec(url.pathname))) {
      let j: Obj = {};
      try { j = JSON.parse(body.toString('utf8') || '{}') as Obj; } catch { return send(400, { message: 'Problems parsing JSON' }); }
      const meta = this.rule.work.land.pulls.get(Number(m[1]));
      if (meta && typeof j.body === 'string') { meta.body = j.body; meta.updated = Date.now(); }
    }

    // The rest is #1335's forge.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers[k] = v;
    const r = await fetch(`${this.rule.url}${url.pathname}${url.search}`, { method, headers, ...(body.length ? { body: new Uint8Array(body) } : {}) });
    const out: Record<string, string> = { 'content-type': r.headers.get('content-type') ?? 'application/json' };
    const link = r.headers.get('link');
    if (link) out.link = link.replaceAll(this.rule.url, this.url);
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  }
}
