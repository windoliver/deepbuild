// The fixture forge for #1325 (README: The fixture forge): GitHub as far as these criteria reach it, on 127.0.0.1.
// It stands in for GitHub's own enforcement, the boundary this repo doesn't own, and follows GitHub's documented
// semantics for what it enforces: apps, their installation tokens and those tokens' permissions, revocation, rulesets
// (required status checks with an app as their source, restricted creations, updates and deletions, bypass actors),
// commit statuses and who posted them, pull-request merges, and git pushes over HTTP refused by a ruleset with GH013.
// Nothing here decides anything about DeepBuild.
//
// It wraps #46's fixture forge (tests/acceptance/46/forge.ts, imported, not copied): that one holds the bare repos, logs
// each push with its actor for GET /activity and answers #46's reads; this one sits in front of it, checks every
// credential, and answers what enforcement needs itself.
import { execFile, spawn } from 'node:child_process';
import { createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import { appendFileSync, chmodSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { FixtureForge } from '../46/forge.ts';

type Obj = Record<string, unknown>;
export const ZERO = '0'.repeat(40);
const NODE = process.execPath;
const GIT_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const git = (cwd: string, ...args: string[]): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 << 20 }, (error, out) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: out.trim() });
  });
});
const DOCS = {
  status: 'https://docs.github.com/rest/commits/statuses#create-a-commit-status',
  merge: 'https://docs.github.com/rest/pulls/pulls#merge-a-pull-request',
  token: 'https://docs.github.com/rest/apps/apps#create-an-installation-access-token-for-an-app',
  revoke: 'https://docs.github.com/rest/apps/installations#revoke-an-installation-access-token',
  rulesets: 'https://docs.github.com/rest/repos/rules#create-a-repository-ruleset',
};

/** An app as GitHub keeps it: its ID, slug, public key, and the permissions its installation was granted. */
export interface App { id: number; slug: string; key: KeyObject; permissions: Record<string, 'read' | 'write'>; installation: number }
/** An installation token: whose it is, what it may do, and when it stops working. */
export interface IssuedToken { token: string; app: number; installation: number; permissions: Record<string, 'read' | 'write'>; repositories: string[] | null; issued: number; expires: number; revoked: number | null }
/** Who a request is from: a person's own token, an app's installation token, or an app's JWT. */
export type Who =
  | { kind: 'user'; login: string; token: string }
  | { kind: 'app'; app: App; issued: IssuedToken; login: string; token: string }
  | { kind: 'jwt'; app: App; login: string; token: string };
/** One call that tried to change something, with who made it and what the forge answered. */
export interface Attempt {
  at: number; token: string | null; login: string | null; action: Action; method: string; target: string; status: number; refused: boolean; message: string;
}
export type Action = 'post-status' | 'merge' | 'push-default-branch' | 'push-approved-tag' | 'push-branch' | 'push-tag' | 'ruleset';
export interface Status { sha: string; state: string; context: string; description: string; creator: string; app: number | null; token: string; at: number }
interface Ruleset { id: number; body: Obj; by: string }
interface PushContext { who: Who; repo: string }

const lettersAndDigits = (n: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(n), (b) => chars[b % chars.length]).join('');
};
const b64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** A ref pattern as rulesets read one: `~DEFAULT_BRANCH`, `~ALL`, or a full ref with `*` and `**`. */
function refMatches(pattern: string, ref: string, target: string): boolean {
  if (pattern === '~ALL') return true;
  if (pattern === '~DEFAULT_BRANCH') return target === 'branch' && ref === 'refs/heads/main';
  const re = new RegExp(`^${pattern.split(/(\*\*|\*)/).map((p) => (p === '**' ? '.*' : p === '*' ? '[^/]*' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
  return re.test(ref);
}
const docs = (message: string, url: string, status: number): Obj => ({ message, documentation_url: url, status: String(status) });

export class GateForge {
  readonly inner: FixtureForge;
  readonly apps = new Map<number, App>();
  readonly tokens = new Map<string, IssuedToken>();
  /** The people's own tokens: login by token. */
  readonly users = new Map<string, string>();
  /** Accounts with admin on the repo: a ruleset's RepositoryRole 5 bypass names them. */
  readonly admins = new Set<string>();
  /** Every JWT the forge took as an app's, with that app. */
  readonly jwts: { jwt: string; app: number }[] = [];
  readonly statuses: Status[] = [];
  readonly rulesets: Ruleset[] = [];
  readonly attempts: Attempt[] = [];
  private readonly pushes = new Map<string, PushContext>();
  private constructor(inner: FixtureForge, private readonly server: http.Server, private readonly dir: string, readonly url: string) { this.inner = inner; }

  static async start(dir: string): Promise<GateForge> {
    const inner = await FixtureForge.start(dir);
    let forge: GateForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(error) }));
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new GateForge(inner, server, dir, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    return forge;
  }
  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.inner.close();
  }

  /** A repository, as #46's forge makes it, with a pre-receive hook that asks this forge whether the rulesets let each ref change through. */
  repo(full_name: string): string {
    const bare = this.inner.repo(full_name, { private: true });
    const hook = join(bare, 'hooks', 'pre-receive');
    writeFileSync(hook, `#!${NODE}\n${PRE_RECEIVE}`);
    chmodSync(hook, 0o755);
    return bare;
  }
  /** The URL git clones and pushes the repo at: it ends in github.com/<owner>/<name>.git, as #46's reader of origins expects. */
  gitUrl(full_name: string): string { return `${this.url}/github.com/${full_name}.git`; }
  /** A person's own token, with admin on the repo when `admin`. */
  person(login: string, admin: boolean): string {
    const token = `ghp_${lettersAndDigits(36)}`;
    this.users.set(token, login);
    if (admin) this.admins.add(login);
    return token;
  }
  /** An app installed on the forge's repos, with the permissions its installation was granted. */
  app(o: { id: number; slug: string; publicKeyPem: string; permissions: Record<string, 'read' | 'write'> }): App {
    const app: App = { id: o.id, slug: o.slug, key: createPublicKey(o.publicKeyPem), permissions: o.permissions, installation: o.id * 10 + 7 };
    this.apps.set(app.id, app);
    return app;
  }
  /** An installation token, as POST /app/installations/{id}/access_tokens issues one: an hour, the app's permissions unless narrowed. */
  issue(app: App, permissions?: Record<string, 'read' | 'write'>, repositories?: string[]): IssuedToken | string {
    const asked = permissions ?? app.permissions;
    for (const [name, level] of Object.entries(asked)) {
      const has = app.permissions[name];
      if (!has || (level === 'write' && has !== 'write')) return `The permissions requested are not granted to this installation: ${name}=${level}`;
    }
    const now = Date.now();
    const issued: IssuedToken = { token: `ghs_${lettersAndDigits(36)}`, app: app.id, installation: app.installation, permissions: { ...asked }, repositories: repositories ?? null, issued: now, expires: now + 3600_000, revoked: null };
    this.tokens.set(issued.token, issued);
    return issued;
  }
  /** Whether a token works now. */
  works(token: string): boolean {
    const t = this.tokens.get(token);
    return this.users.has(token) || (t !== undefined && t.revoked === null && Date.now() < t.expires);
  }
  /** The statuses a commit holds, oldest first. */
  statusesOf(sha: string): Status[] { return this.statuses.filter((s) => s.sha === sha); }
  loginOf(app: App): string { return `${app.slug}[bot]`; }

  // ---- Who a request is from.
  private who(header: string | undefined): Who | null | undefined {
    if (!header) return null;
    let token: string | undefined;
    const bearer = /^(?:Bearer|token) (.+)$/i.exec(header);
    if (bearer) token = bearer[1]!.trim();
    const basic = /^Basic (.+)$/i.exec(header);
    if (basic) token = Buffer.from(basic[1]!, 'base64').toString('utf8').split(':').slice(1).join(':');
    if (!token) return undefined;
    const login = this.users.get(token);
    if (login) return { kind: 'user', login, token };
    const issued = this.tokens.get(token);
    if (issued) {
      if (issued.revoked !== null || Date.now() >= issued.expires) return undefined;
      const app = this.apps.get(issued.app)!;
      return { kind: 'app', app, issued, login: this.loginOf(app), token };
    }
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const header = JSON.parse(b64url(parts[0]!).toString('utf8')) as Obj;
        const payload = JSON.parse(b64url(parts[1]!).toString('utf8')) as Obj;
        const app = this.apps.get(Number(payload.iss));
        const now = Math.floor(Date.now() / 1000);
        // GitHub's rule: RS256, issued by the app, expiring no more than 10 minutes out.
        if (!app || header.alg !== 'RS256' || typeof payload.exp !== 'number' || payload.exp <= now || payload.exp > now + 660) return undefined;
        if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), app.key, b64url(parts[2]!))) return undefined;
        this.jwts.push({ jwt: token, app: app.id });
        return { kind: 'jwt', app, login: this.loginOf(app), token };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  /** What a caller may do on a repo by a permission: a person by being a collaborator (maya is), an app's token by its permissions. */
  private may(who: Who, permission: string, level: 'read' | 'write'): boolean {
    if (who.kind === 'user') return this.admins.has(who.login);
    if (who.kind === 'jwt') return false;
    const has = who.issued.permissions[permission];
    return has === 'write' || (level === 'read' && has === 'read');
  }

  // ---- Rulesets.
  /** The violations a ref change meets, for a caller, as GitHub's rulesets judge it; none when every ruleset that applies lets it through. */
  violations(o: { who: Who; ref: string; old: string; next: string; ff: boolean; viaPull: boolean; checkOn?: string }): string[] {
    const target = o.ref.startsWith('refs/tags/') ? 'tag' : 'branch';
    const out: string[] = [];
    for (const { body } of this.rulesets) {
      if (body.enforcement !== 'active' || body.target !== target) continue;
      const names = ((body.conditions as Obj | undefined)?.ref_name ?? {}) as { include?: string[]; exclude?: string[] };
      if (!(names.include ?? []).some((p) => refMatches(p, o.ref, target)) || (names.exclude ?? []).some((p) => refMatches(p, o.ref, target))) continue;
      if (this.bypasses(body, o.who, o.viaPull)) continue;
      for (const rule of (body.rules ?? []) as { type: string; parameters?: Obj }[]) {
        const p = rule.parameters ?? {};
        if (rule.type === 'creation' && o.old === ZERO) out.push('Cannot create ref due to creations being restricted.');
        if (rule.type === 'update' && o.old !== ZERO && o.next !== ZERO) out.push('Cannot update this protected ref.');
        if (rule.type === 'deletion' && o.next === ZERO) out.push('Cannot delete this protected ref.');
        if (rule.type === 'non_fast_forward' && o.old !== ZERO && o.next !== ZERO && !o.ff) out.push('Cannot force-push to this branch');
        if (rule.type === 'pull_request' && o.next !== ZERO) {
          if (!o.viaPull) out.push('Changes must be made through a pull request.');
          else if (Number(p.required_approving_review_count ?? 0) > 0) out.push(`At least ${Number(p.required_approving_review_count)} approving review is required by reviewers with write access.`);
        }
        if (rule.type === 'required_status_checks' && o.next !== ZERO) {
          for (const check of (p.required_status_checks ?? []) as { context: string; integration_id?: number }[]) {
            if (!this.satisfied(o.checkOn ?? o.next, check)) out.push(`Required status check "${check.context}" is expected.`);
          }
        }
      }
    }
    return out;
  }
  /** Whether a caller is one of a ruleset's bypass actors: `pull_request` bypasses only a merge of a pull request. */
  private bypasses(body: Obj, who: Who, viaPull: boolean): boolean {
    return ((body.bypass_actors ?? []) as { actor_id?: number | null; actor_type: string; bypass_mode?: string }[]).some((b) => {
      if (b.bypass_mode === 'pull_request' && !viaPull) return false;
      if (b.actor_type === 'RepositoryRole' || b.actor_type === 'OrganizationAdmin') return who.kind === 'user' && this.admins.has(who.login) && (b.actor_type === 'OrganizationAdmin' || b.actor_id === 5);
      if (b.actor_type === 'Integration') return who.kind !== 'user' && who.app.id === b.actor_id;
      return false;
    });
  }
  /** A required check, as GitHub reads one: the newest status with its context, from its app when it names one, is success. */
  satisfied(sha: string, check: { context: string; integration_id?: number }): boolean {
    const from = this.statusesOf(sha).filter((s) => s.context === check.context && (check.integration_id === undefined || check.integration_id === null || s.app === check.integration_id));
    return from.at(-1)?.state === 'success';
  }
  /** A pull request's mergeable_state: dirty or unknown as #46's forge computes them; else blocked while a required status check of a ruleset on its base is unmet, clean once none is (README). */
  private mergeableState(head: string, base: string, inner: Obj): string {
    if (inner.mergeable === null) return 'unknown';
    if (inner.mergeable === false) return 'dirty';
    for (const { body } of this.rulesets) {
      if (body.enforcement !== 'active' || body.target !== 'branch') continue;
      const names = ((body.conditions as Obj | undefined)?.ref_name ?? {}) as { include?: string[]; exclude?: string[] };
      if (!(names.include ?? []).some((p) => refMatches(p, `refs/heads/${base}`, 'branch')) || (names.exclude ?? []).some((p) => refMatches(p, `refs/heads/${base}`, 'branch'))) continue;
      for (const rule of (body.rules ?? []) as { type: string; parameters?: Obj }[]) {
        if (rule.type === 'required_status_checks' && ((rule.parameters?.required_status_checks ?? []) as { context: string; integration_id?: number }[]).some((c) => !this.satisfied(head, c))) return 'blocked';
        if (rule.type === 'pull_request' && Number(rule.parameters?.required_approving_review_count ?? 0) > 0) return 'blocked';
      }
    }
    return 'clean';
  }

  // ---- HTTP.
  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(value === undefined ? '' : JSON.stringify(value));
    };
    if (url.pathname === '/_fixture/pre-receive' && method === 'POST') return send(200, this.preReceive(JSON.parse(body.toString('utf8')) as Obj));
    if (url.pathname.startsWith('/github.com/')) return this.gitHttp(req, res, url, body);
    const who = this.who(req.headers.authorization);
    if (who === undefined) return send(401, docs('Bad credentials', 'https://docs.github.com/rest', 401));
    const json = (): Obj => { try { return JSON.parse(body.toString('utf8') || '{}') as Obj; } catch { return {}; } };

    // Apps (JWT): the app, its installation on a repo, and an installation token.
    if (method === 'GET' && url.pathname === '/app') {
      if (who?.kind !== 'jwt') return send(401, docs('A JSON web token could not be decoded', DOCS.token, 401));
      return send(200, { id: who.app.id, slug: who.app.slug, name: who.app.slug, permissions: who.app.permissions });
    }
    let m = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(url.pathname);
    if (method === 'GET' && m) {
      if (who?.kind !== 'jwt') return send(401, docs('A JSON web token could not be decoded', DOCS.token, 401));
      return send(200, { id: who.app.installation, app_id: who.app.id, app_slug: who.app.slug, account: { login: m[1]!.split('/')[0] }, permissions: who.app.permissions, repository_selection: 'all' });
    }
    m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (method === 'POST' && m) {
      if (who?.kind !== 'jwt') return send(401, docs('A JSON web token could not be decoded', DOCS.token, 401));
      if (Number(m[1]) !== who.app.installation) return send(404, docs('Not Found', DOCS.token, 404));
      const asked = json();
      const repositories = Array.isArray(asked.repositories) ? asked.repositories.map(String) : undefined;
      const issued = this.issue(who.app, asked.permissions as Record<string, 'read' | 'write'> | undefined, repositories);
      if (typeof issued === 'string') return send(422, docs(issued, DOCS.token, 422));
      return send(201, { token: issued.token, expires_at: new Date(issued.expires).toISOString(), permissions: issued.permissions, repository_selection: repositories ? 'selected' : 'all' });
    }
    if (method === 'DELETE' && url.pathname === '/installation/token') {
      if (who?.kind !== 'app') return send(401, docs('Bad credentials', DOCS.revoke, 401));
      who.issued.revoked = Date.now();
      return send(204, undefined);
    }
    if (method === 'GET' && url.pathname === '/installation/repositories') {
      if (who?.kind !== 'app') return send(401, docs('Bad credentials', DOCS.revoke, 401));
      return send(200, { total_count: 1, repositories: [{ full_name: 'acme/shop', name: 'shop' }] });
    }

    m = /^\/repos\/([^/]+\/[^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!m) return send(404, docs('Not Found', 'https://docs.github.com/rest', 404));
    const repo = m[1]!;
    const rest = m[2] ?? '';
    // A private repo answers 404 to a caller with no access to it, as GitHub does.
    if (!who || who.kind === 'jwt' || (who.kind === 'app' && who.issued.repositories && !who.issued.repositories.includes(repo.split('/')[1]!))) return send(404, docs('Not Found', 'https://docs.github.com/rest', 404));

    if (rest === 'rulesets') {
      if (method === 'GET') return send(200, this.rulesets.map((r) => ({ id: r.id, ...r.body })));
      if (method !== 'POST') return send(404, docs('Not Found', DOCS.rulesets, 404));
      const asked = json();
      const refused = (status: number, message: string) => {
        this.attempts.push({ at: Date.now(), token: who.token, login: who.login, action: 'ruleset', method, target: url.pathname, status, refused: true, message });
        return send(status, docs(message, DOCS.rulesets, status));
      };
      if (who.kind !== 'user' || !this.admins.has(who.login)) return refused(403, 'Resource not accessible by integration');
      const okRules = Array.isArray(asked.rules) && asked.rules.every((r) => typeof (r as Obj)?.type === 'string');
      if (typeof asked.name !== 'string' || !['branch', 'tag'].includes(String(asked.target)) || !['active', 'evaluate', 'disabled'].includes(String(asked.enforcement)) || !okRules
        || !Array.isArray(((asked.conditions as Obj | undefined)?.ref_name as Obj | undefined)?.include)) return refused(422, 'Invalid request: a ruleset needs name, target (branch or tag), enforcement, conditions.ref_name.include and rules');
      const set: Ruleset = { id: this.rulesets.length + 1, body: asked, by: who.login };
      this.rulesets.push(set);
      this.attempts.push({ at: Date.now(), token: who.token, login: who.login, action: 'ruleset', method, target: url.pathname, status: 201, refused: false, message: '' });
      return send(201, { id: set.id, ...asked });
    }
    let found: RegExpExecArray | null;
    if (method === 'POST' && (found = /^statuses\/([0-9a-f]{40})$/.exec(rest))) return this.postStatus(who, url.pathname, found[1]!, json(), send);
    if (method === 'GET' && (found = /^commits\/([0-9a-f]{40})\/status$/.exec(rest))) {
      const latest = new Map(this.statusesOf(found[1]!).map((s) => [s.context, s]));
      const states = [...latest.values()].map((s) => s.state);
      return send(200, { sha: found[1], state: states.some((s) => s !== 'success') || !states.length ? 'pending' : 'success', statuses: [...latest.values()].map(shownStatus) });
    }
    if (method === 'GET' && (found = /^commits\/([0-9a-f]{40})\/statuses$/.exec(rest))) return send(200, this.statusesOf(found[1]!).reverse().map(shownStatus));
    if (method === 'PUT' && (found = /^pulls\/(\d+)\/merge$/.exec(rest))) return this.merge(who, repo, url.pathname, Number(found[1]), send);
    if (method !== 'GET') return send(404, docs('Not Found', 'https://docs.github.com/rest', 404));
    // Everything else is #46's forge's to answer.
    const answer = await fetch(`${this.inner.url}${url.pathname}${url.search}`, { headers: { authorization: 'Bearer fixture' } });
    const text = await answer.text();
    const headers: Record<string, string> = {};
    const link = answer.headers.get('link');
    if (link) headers.link = link.split(this.inner.url).join(this.url);
    if ((found = /^pulls\/(\d+)$/.exec(rest)) && answer.ok) {
      const pull = JSON.parse(text) as Obj;
      const head = String((pull.head as Obj).sha);
      return send(200, { ...pull, mergeable_state: this.mergeableState(head, String((pull.base as Obj).ref), pull) }, headers);
    }
    res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(text);
  }

  private postStatus(who: Who, path: string, sha: string, asked: Obj, send: (s: number, v: unknown) => void): void {
    const note = (status: number, message: string) => this.attempts.push({ at: Date.now(), token: who.token, login: who.login, action: 'post-status', method: 'POST', target: path, status, refused: status >= 400, message });
    if (!this.may(who, 'statuses', 'write')) {
      note(403, 'Resource not accessible by integration');
      return send(403, docs('Resource not accessible by integration', DOCS.status, 403));
    }
    const state = String(asked.state);
    if (!['error', 'failure', 'pending', 'success'].includes(state)) { note(422, 'Validation Failed'); return send(422, docs('Validation Failed', DOCS.status, 422)); }
    const status: Status = {
      sha, state, context: typeof asked.context === 'string' ? asked.context : 'default', description: typeof asked.description === 'string' ? asked.description : '',
      creator: who.login, app: who.kind === 'app' ? who.app.id : null, token: who.token, at: Date.now(),
    };
    this.statuses.push(status);
    note(201, '');
    send(201, shownStatus(status));
  }

  /** PUT /pulls/{n}/merge: an update of the base by the caller, through the pull request, refused as GitHub's rulesets refuse one. */
  private async merge(who: Who, repo: string, path: string, number: number, send: (s: number, v: unknown) => void): Promise<void> {
    const note = (status: number, message: string) => this.attempts.push({ at: Date.now(), token: who.token, login: who.login, action: 'merge', method: 'PUT', target: path, status, refused: status >= 400, message });
    if (!this.may(who, 'contents', 'write')) {
      note(403, 'Resource not accessible by integration');
      return send(403, docs('Resource not accessible by integration', DOCS.merge, 403));
    }
    const inner = await (await fetch(`${this.inner.url}/repos/${repo}/pulls/${number}`)).json() as Obj;
    if (!inner.head) { note(404, 'Not Found'); return send(404, docs('Not Found', DOCS.merge, 404)); }
    const bare = join(this.dir, 'github.com', `${repo}.git`);
    const head = String((inner.head as Obj).sha);
    const baseRef = String((inner.base as Obj).ref);
    const base = (await git(bare, 'rev-parse', `refs/heads/${baseRef}`)).out;
    if ((await git(bare, 'merge-base', '--is-ancestor', head, base)).code === 0) { note(405, 'Pull Request is not mergeable'); return send(405, docs('Pull Request is not mergeable', DOCS.merge, 405)); }
    const tree = await git(bare, 'merge-tree', '--write-tree', base, head);
    if (tree.code !== 0) { note(405, 'Pull Request is not mergeable'); return send(405, docs('Pull Request is not mergeable', DOCS.merge, 405)); }
    const found = this.violations({ who, ref: `refs/heads/${baseRef}`, old: base, next: head, ff: true, viaPull: true, checkOn: head });
    if (found.length) {
      const message = `Repository rule violations found\n\n${found.join('\n')}\n`;
      note(405, message);
      return send(405, docs(message, DOCS.merge, 405));
    }
    const commit = await new Promise<string>((resolve) => {
      execFile('git', ['commit-tree', tree.out.split('\n')[0]!, '-p', base, '-p', head, '-m', `Merge pull request #${number}`], {
        cwd: bare, encoding: 'utf8', env: { ...GIT_ENV, GIT_AUTHOR_NAME: who.login, GIT_AUTHOR_EMAIL: 'noreply@example.invalid', GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@example.invalid' },
      }, (_e, out) => resolve(out.trim()));
    });
    await git(bare, 'update-ref', `refs/heads/${baseRef}`, commit, base);
    appendFileSync(join(this.dir, `${repo.replace('/', '-')}.pushes`), `${base} ${commit} refs/heads/${baseRef} ${Math.floor(Date.now() / 1000)} ${who.login}\n`);
    note(200, '');
    send(200, { sha: commit, merged: true, message: 'Pull Request successfully merged' });
  }

  /** git over HTTP: `git http-backend` on the bare repos, its caller named by the credential; a push needs contents:write, and each ref change passes the rulesets in pre-receive. */
  private async gitHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: Buffer): Promise<void> {
    const m = /^\/github\.com\/([^/]+\/[^/]+?)\.git(\/.*)$/.exec(url.pathname);
    const pushing = url.searchParams.get('service') === 'git-receive-pack' || url.pathname.endsWith('/git-receive-pack');
    const deny = (status: number, message: string) => {
      res.writeHead(status, { 'content-type': 'text/plain', ...(status === 401 ? { 'www-authenticate': 'Basic realm="GitHub"' } : {}) });
      res.end(`${message}\n`);
    };
    if (!m) return deny(404, 'Repository not found.');
    const who = this.who(req.headers.authorization);
    if (!who || who.kind === 'jwt') return deny(401, 'Invalid username or token.');
    if (!this.may(who, 'contents', pushing ? 'write' : 'read')) {
      if (pushing) this.attempts.push({ at: Date.now(), token: who.token, login: who.login, action: 'push-branch', method: 'POST', target: url.pathname, status: 403, refused: true, message: 'Permission denied' });
      return deny(403, `Permission to ${m[1]}.git denied to ${who.login}.`);
    }
    const id = randomBytes(8).toString('hex');
    this.pushes.set(id, { who, repo: m[1]! });
    const env: NodeJS.ProcessEnv = {
      ...GIT_ENV, GIT_PROJECT_ROOT: this.dir, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: `/github.com/${m[1]}.git${m[2]}`, REQUEST_METHOD: req.method ?? 'GET',
      QUERY_STRING: url.search.slice(1), CONTENT_TYPE: req.headers['content-type'] ?? '', CONTENT_LENGTH: String(body.length), REMOTE_USER: who.login, REMOTE_ADDR: '127.0.0.1',
      FORGE_ACTOR: who.login, FORGE_PUSH: id, FORGE_URL: this.url,
      ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: String(req.headers['content-encoding']) } : {}),
      ...(req.headers['git-protocol'] ? { GIT_PROTOCOL: String(req.headers['git-protocol']) } : {}),
    };
    const child = spawn('git', ['http-backend'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(body);
    const out: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', () => undefined);
    await new Promise<void>((resolve) => child.on('close', () => resolve()));
    this.pushes.delete(id);
    const raw = Buffer.concat(out);
    const split = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
    const gap = raw.indexOf('\r\n\r\n') >= 0 ? 4 : 2;
    const head = raw.subarray(0, split).toString('utf8');
    const headers: Record<string, string> = {};
    let status = 200;
    for (const line of head.split(/\r?\n/)) {
      const at = line.indexOf(':');
      if (at < 0) continue;
      const k = line.slice(0, at).trim();
      const v = line.slice(at + 1).trim();
      if (k.toLowerCase() === 'status') status = Number(v.split(' ')[0]);
      else headers[k] = v;
    }
    res.writeHead(status, headers);
    res.end(raw.subarray(split + gap));
  }

  /** The pre-receive hook's question: may these ref changes go through? Refused as GitHub refuses one: GH013, naming the ref and each violation. */
  private preReceive(asked: Obj): { ok: boolean; lines: string[] } {
    const context = this.pushes.get(String(asked.push));
    if (!context) return { ok: false, lines: ['error: this push names no request the forge knows'] };
    const lines: string[] = [];
    const results: { u: { old: string; next: string; ref: string }; found: string[] }[] = [];
    for (const u of (asked.updates ?? []) as { old: string; next: string; ref: string; ff: boolean }[]) {
      const found = this.violations({ who: context.who, ref: u.ref, old: u.old, next: u.next, ff: u.ff, viaPull: false });
      results.push({ u, found });
      if (found.length) {
        lines.push(`error: GH013: Repository rule violations found for ${u.ref}.`, `Review all repository rules at ${this.url}/${context.repo}/rules?ref=${encodeURIComponent(u.ref)}`, '', ...found.map((f) => `- ${f}`), '');
      }
    }
    const ok = results.every((r) => !r.found.length);
    for (const { u, found } of results) {
      const action: Action = u.ref === 'refs/heads/main' ? 'push-default-branch' : u.ref.startsWith('refs/tags/deep/approved/') ? 'push-approved-tag' : u.ref.startsWith('refs/tags/') ? 'push-tag' : 'push-branch';
      this.attempts.push({ at: Date.now(), token: context.who.token, login: context.who.login, action, method: 'PUSH', target: `${u.ref} ${u.old}..${u.next}`, status: ok ? 200 : 403, refused: !ok, message: found.join(' ') });
    }
    return { ok, lines };
  }
}

const shownStatus = (s: Status): Obj => ({ state: s.state, context: s.context, description: s.description, created_at: new Date(s.at).toISOString(), creator: { login: s.creator, type: s.app === null ? 'User' : 'Bot' } });

/** The bare repo's pre-receive hook: asks the forge about each ref change, fast-forward or not (read here, where the quarantined objects are), and prints what it says. */
const PRE_RECEIVE = `import { execFileSync } from 'node:child_process';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const ZERO = '0'.repeat(40);
const updates = input.split('\\n').filter(Boolean).map((line) => {
  const [old, next, ref] = line.split(' ');
  let ff = true;
  if (old !== ZERO && next !== ZERO) { try { execFileSync('git', ['merge-base', '--is-ancestor', old, next], { stdio: 'ignore' }); } catch { ff = false; } }
  return { old, next, ref, ff };
});
const answer = await fetch(process.env.FORGE_URL + '/_fixture/pre-receive', { method: 'POST', body: JSON.stringify({ push: process.env.FORGE_PUSH, updates }) }).then((r) => r.json());
for (const line of answer.lines) process.stderr.write(line + '\\n');
process.exit(answer.ok ? 0 : 1);
`;
