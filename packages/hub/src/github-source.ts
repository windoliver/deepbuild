// The GitHub issues work source (#322; design: Work source): an issue a prompt links becomes `work.item@2` readings,
// one for the issue and one for each comment, read through the REST API with your existing `gh` login. Each author's
// role comes from the repo's membership record and never from the text: `owner` for the repo's owner, `collaborator`
// for an account the collaborators list holds, `outside` for any other; an account GitHub types as a Bot, an app's,
// also carries `automated`, so its text counts as outside whatever its membership. Roles come only from a complete
// membership read: a collaborators read cut short (a page that fails) gives no role from the pages it did get, and
// every author but the repo's owner reads outside, so their text waits as outside text does. The acceptance criteria
// are the `- [ ]` lines under the issue's `### Acceptance criteria` heading, as this repo writes them. In tests the
// API's answers are recorded (DEEP_HUB_TEST_GITHUB): nothing is fetched from the network.
import { readFile } from 'node:fs/promises';
import type { Plant } from './plant.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One answer the API gave: its status, headers (`link` for paging) and JSON body. */
export interface Answer { status: number; headers: Record<string, string>; body: unknown }
/** How the source reaches the API: by the request's path (no query) and its page. */
export type Fetch = (path: string, page: number) => Promise<Answer>;

/** A reading's author: the account, its role from the membership record, and whether the provider marks it automated. */
interface Author { handle: string; role: 'owner' | 'collaborator' | 'outside'; automated?: boolean }
/** A `work.item@2` reading as the source gives it; `body` is the text itself here, which the lock reads for nothing but a planted wrong program. */
export interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: Author[]; updated: string }

/** An issue's link in a prompt: its owner, repo and number. */
export const ISSUE_LINK = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(?![\d/])/;

/** A recording's answers, or none when the file can't be read. */
async function recorded(file: string): Promise<Obj[]> {
  try {
    const value = (JSON.parse(await readFile(file, 'utf8')) as Obj).answers;
    return Array.isArray(value) ? value.filter(isObj) : [];
  } catch {
    return [];
  }
}
/** The recorded answers (tests only): the file is read at each request, so a test can rewrite it between two reads. */
export function recordedFetch(file: string): Fetch {
  return async (path, page) => {
    const found = (await recorded(file)).find((a) => (a.method === undefined || a.method === 'GET') && a.path === path && (Number(a.page ?? 1) === page));
    if (!found) return { status: 404, headers: {}, body: { message: 'Not Found' } };
    const headers = Object.fromEntries(Object.entries(isObj(found.headers) ? found.headers : {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { status: Number(found.status ?? 200), headers, body: found.body };
  };
}
/** The live API at `api`, the token as a bearer when set; a request that fails to reach it reads as a 599. */
export function liveFetch(api: string, token: string | undefined): Fetch {
  return async (path, page) => {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      const res = await fetch(`${api}${path}?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(20_000) });
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
      return { status: res.status, headers: out, body: await res.json().catch(() => undefined) };
    } catch {
      return { status: 599, headers: {}, body: undefined };
    }
  };
}

/** How the gate reaches GitHub's GraphQL API (#323): one query with its variables. */
export type Graphql = (query: string, variables: Obj) => Promise<Answer>;
/** The recorded GraphQL answers (tests only): an entry matches when each variable it records equals the request's. */
export function recordedGraphql(file: string): Graphql {
  return async (_query, variables) => {
    const found = (await recorded(file)).find((a) => a.method === 'POST' && a.path === '/graphql' && Object.entries(isObj(a.variables) ? a.variables : {}).every(([k, v]) => variables[k] === v));
    return found ? { status: Number(found.status ?? 200), headers: {}, body: found.body } : { status: 404, headers: {}, body: { message: 'Not Found' } };
  };
}
/** The live GraphQL API at `api`, the token as a bearer when set; a request that fails to reach it reads as a 599. */
export function liveGraphql(api: string, token: string | undefined): Graphql {
  return async (query, variables) => {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      const res = await fetch(`${api}/graphql`, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000) });
      return { status: res.status, headers: {}, body: await res.json().catch(() => undefined) };
    } catch {
      return { status: 599, headers: {}, body: undefined };
    }
  };
}

/** The acceptance criteria an issue body lists: its `- [ ]` lines under the Acceptance criteria heading, as scripts/proof-change.mjs reads them. */
export function criteriaOf(body: string): string[] {
  const m = /^#+\s*acceptance criteria\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body);
  if (!m) return [];
  return [...m[1]!.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, text]) => text!.trim()).filter(Boolean);
}

/** Every page of a list the API gives, following `link: rel="next"`; undefined when any page fails, so a read cut short is never taken as complete. */
async function pages(fetch: Fetch, path: string): Promise<Obj[] | undefined> {
  const out: Obj[] = [];
  for (let page = 1; ; page++) {
    const r = await fetch(path, page);
    if (r.status !== 200 || !Array.isArray(r.body)) return undefined;
    out.push(...r.body.filter(isObj));
    if (!/<[^>]+>;\s*rel="next"/.test(r.headers.link ?? '')) return out;
  }
}
/** The repo's membership as one complete read: its owner and every collaborator, or incomplete when any page failed. */
async function membership(fetch: Fetch, owner: string, repo: string): Promise<{ owner: string | null; members: Map<string, { admin: boolean; bot: boolean }>; complete: boolean }> {
  const about = await fetch(`/repos/${owner}/${repo}`, 1);
  const login = about.status === 200 && isObj(about.body) && isObj(about.body.owner) && typeof about.body.owner.login === 'string' ? about.body.owner.login : null;
  const members = new Map<string, { admin: boolean; bot: boolean }>();
  const collaborators = await pages(fetch, `/repos/${owner}/${repo}/collaborators`);
  for (const c of collaborators ?? []) {
    if (typeof c.login !== 'string') continue;
    members.set(c.login, { admin: c.role_name === 'admin' || (isObj(c.permissions) && c.permissions.admin === true), bot: c.type === 'Bot' });
  }
  return { owner: login, members, complete: collaborators !== undefined };
}

/**
 * The readings of one issue: the issue itself (`owner/repo#n`) and each comment (`owner/repo#n.c<id>`), each author's
 * role from the membership read. Undefined when the issue can't be read. The planted wrong programs read a role from
 * the comment's text, mark every author a collaborator, or take an app's membership as a collaborator's.
 */
export async function readIssue(fetch: Fetch, owner: string, repo: string, n: number, plant: Plant | undefined): Promise<Reading[] | undefined> {
  const issue = await fetch(`/repos/${owner}/${repo}/issues/${n}`, 1);
  if (issue.status !== 200 || !isObj(issue.body)) return undefined;
  const comments = await pages(fetch, `/repos/${owner}/${repo}/issues/${n}/comments`);
  const who = await membership(fetch, owner, repo);
  const authorOf = (user: unknown, text: string): Author => {
    const login = isObj(user) && typeof user.login === 'string' ? user.login : 'unknown';
    const bot = (isObj(user) && user.type === 'Bot') || who.members.get(login)?.bot === true;
    let role: Author['role'];
    if (plant === 'every-author-collaborator') role = 'collaborator';
    else if (plant === 'role-from-comment-text' && /\brepo owner\b/i.test(text)) role = 'owner';
    else if (who.owner !== null && login === who.owner) role = 'owner';
    // An author on neither page of a read cut short is never a collaborator from the pages that came.
    else if (!who.complete) role = 'outside';
    else role = who.members.has(login) ? (who.members.get(login)!.admin && who.owner === null ? 'owner' : 'collaborator') : 'outside';
    // The planted wrong program takes the app's membership as a collaborator's: it never marks it automated.
    return bot && plant !== 'app-membership-as-collaborator' ? { handle: login, role, automated: true } : { handle: login, role };
  };
  const id = `${owner}/${repo}#${n}`;
  const body = typeof issue.body.body === 'string' ? issue.body.body : '';
  const link = typeof issue.body.html_url === 'string' ? issue.body.html_url : `https://github.com/${owner}/${repo}/issues/${n}`;
  const readings: Reading[] = [{
    source_id: id, link, title: typeof issue.body.title === 'string' ? issue.body.title : id, body, criteria: criteriaOf(body),
    authors: [authorOf(issue.body.user, body)], updated: typeof issue.body.updated_at === 'string' ? issue.body.updated_at : '',
  }];
  for (const c of comments ?? []) {
    const text = typeof c.body === 'string' ? c.body : '';
    readings.push({
      source_id: `${id}.c${String(c.id)}`, link: typeof c.html_url === 'string' ? c.html_url : `${link}#issuecomment-${String(c.id)}`, title: `Comment on ${id}`, body: text, criteria: [],
      authors: [authorOf(c.user, text)], updated: typeof c.updated_at === 'string' ? c.updated_at : '',
    });
  }
  return readings;
}
