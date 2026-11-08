// The gate identity and a session's own credential (#1325; design: Threats, and what stops each one). Each is a GitHub
// App: the gate's posts every status, and a ruleset's required check names it, so the same status from anyone else
// doesn't count; the agents' app mints each session a token of its own for one repo, which can push branches, open
// PRs and comment, never post a status, and which the hub revokes when its session ends. An app's key stays in the
// hub's process: it signs a JWT there, and only the tokens it mints leave it, a session's own to that session alone.
import { createSign } from 'node:crypto';
import { ForgeRefused } from './pushes.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export type Permissions = Record<string, 'read' | 'write'>;
/** An app as your settings name it: its ID, and its private key (PEM) as the hub reads it, from the Keychain. */
export interface AppKey { app_id: number; key(): Promise<string | undefined> }
/** A token minted for one repo: what it may do, when GitHub stops taking it, and the login GitHub records its pushes as. */
export interface AppToken { token: string; expires: number; permissions: Permissions; login: string | null }

/** What a session's credential may do, each at most at the level the agents' app was granted: push branches, open PRs and comment. Never statuses. */
const SESSION: Permissions = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' };
/** What the gate's token needs to post a verdict. */
const GATE: Permissions = { statuses: 'write', metadata: 'read' };
/** A gate token is used again until this long before GitHub stops taking it. */
const SPARE_MS = 5 * 60_000;

/** An app's JWT (RS256, issued by its ID, a minute back for clock skew, nine minutes on: GitHub takes ten at most). */
export function jwtOf(appId: number, pem: string, now = Date.now()): string {
  const at = Math.floor(now / 1000);
  const part = (o: Obj): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: at - 60, exp: at + 540, iss: appId })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(pem).toString('base64url')}`;
}

async function call(api: string, method: string, path: string, auth: string, body?: Obj): Promise<unknown> {
  const res = await fetch(`${api}${path}`, {
    method, signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new ForgeRefused(res.status, undefined, path);
  return res.status === 204 ? undefined : res.json();
}

/** A token of `app` for `repo` (owner/name), its permissions narrowed to `wanted`, each no higher than its installation holds. */
export async function mint(api: string, app: AppKey, repo: string, wanted: Permissions): Promise<AppToken> {
  const kept = (await app.key())?.trim();
  if (!kept) throw Error(`app ${app.app_id}'s private key isn't in the Keychain`);
  // `security find-generic-password -w` prints a value with line breaks, as a PEM has, in hex.
  const pem = !kept.includes('-----BEGIN') && /^(?:[0-9a-f]{2})+$/i.test(kept) ? Buffer.from(kept, 'hex').toString('utf8') : kept;
  const jwt = jwtOf(app.app_id, pem);
  const installation = await call(api, 'GET', `/repos/${repo}/installation`, jwt);
  if (!isObj(installation) || typeof installation.id !== 'number') throw Error(`app ${app.app_id} isn't installed on ${repo}`);
  const held = isObj(installation.permissions) ? installation.permissions : {};
  const permissions: Permissions = {};
  for (const [name, level] of Object.entries(wanted)) {
    if (held[name] === 'write') permissions[name] = level;
    else if (held[name] === 'read') permissions[name] = 'read';
  }
  const made = await call(api, 'POST', `/app/installations/${installation.id}/access_tokens`, jwt, { repositories: [repo.split('/')[1]!], permissions });
  if (!isObj(made) || typeof made.token !== 'string') throw Error(`app ${app.app_id} minted no token for ${repo}`);
  const slug = typeof installation.app_slug === 'string' && installation.app_slug ? installation.app_slug : null;
  return { token: made.token, expires: Date.parse(String(made.expires_at)), permissions, login: slug && `${slug}[bot]` };
}
/** A token revoked: GitHub takes it no more. */
export async function revoke(api: string, token: string): Promise<void> {
  await call(api, 'DELETE', '/installation/token', token);
}

/** The gate's token for a repo, minted once and used again until shortly before it expires. */
export function gateTokens(api: string, app: () => AppKey | undefined): (repo: string) => Promise<string | undefined> {
  const kept = new Map<string, AppToken & { app: number }>();
  return async (repo) => {
    const a = app();
    if (!a) return undefined;
    const have = kept.get(repo);
    if (have && have.app === a.app_id && have.expires - SPARE_MS > Date.now()) return have.token;
    const made = await mint(api, a, repo, GATE);
    kept.set(repo, { ...made, app: a.app_id });
    return made.token;
  };
}
/** A session's own token for a repo, from the agents' app; `statuses` only for the planted wrong program. */
export const sessionToken = (api: string, app: AppKey, repo: string, statuses = false): Promise<AppToken> =>
  mint(api, app, repo, statuses ? { ...SESSION, statuses: 'write' } : SESSION);
