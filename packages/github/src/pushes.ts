// GitHub's record of each push (#46): `GET /repos/{repo}/activity` names who changed each ref, and `compare` the commits
// each change brought. The pusher is that record's actor, an empty one kept empty; a commit's author and committer are
// kept beside it, and never read as its pusher. A commit two pushes carried reads as the first's: that's who brought it.
import type { ProviderPush, PushRecordReader } from '@deepbuild/gate';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ZERO = '0'.repeat(40);

/** A forge's answer that isn't a 2xx: its status, and when it may be asked again if it's a rate limit. */
export class ForgeRefused extends Error {
  constructor(readonly status: number, readonly retryAt: number | undefined, path: string) { super(`the forge answered ${status} for ${path}`); }
}
/** When a rate limit lifts: `Retry-After`, or the reset of a quota at zero; a 429 that says neither, a minute on. */
function limitLifts(res: Response, now: number): number | undefined {
  if (res.status !== 429 && res.status !== 403) return undefined;
  const after = Number(res.headers.get('retry-after'));
  if (after > 0) return now + after * 1000;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (res.headers.get('x-ratelimit-remaining') === '0' && reset > 0) return reset * 1000;
  return res.status === 429 ? now + 60_000 : undefined;
}
export type Rest = (method: 'GET' | 'POST', path: string, body?: Obj) => Promise<{ body: unknown; next: string | undefined }>;
/** One call to the REST API at `api`: a refused one throws ForgeRefused, naming when a limit lifts. */
export const restOf = (api: string, token: string | undefined): Rest => async (method, path, body) => {
  const res = await fetch(path.startsWith('http') ? path : `${api}${path}`, {
    method, signal: AbortSignal.timeout(4000),
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new ForgeRefused(res.status, limitLifts(res, Date.now()), path);
  return { body: await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] };
};

/** One ref change as GitHub records it, oldest first in what reads them. */
export interface RefChange { id: number; ref: string; before: string; after: string; at: number; pusher: string | null }
/** A pushed commit: what the reading's kit reads, with the ref that took it and its tree. */
export interface Push extends ProviderPush { ref: string; tree: string | null }

/** The ref changes newer than `seen`, oldest first; with no `seen`, those of the newest page. */
export async function refChanges(rest: Rest, repo: string, seen?: number): Promise<RefChange[]> {
  const out: RefChange[] = [];
  for (let next: string | undefined = `/repos/${repo}/activity?per_page=100`; next;) {
    const page: { body: unknown; next: string | undefined } = await rest('GET', next);
    const items = (Array.isArray(page.body) ? page.body : []).filter(isObj);
    for (const a of items) {
      if (seen !== undefined && Number(a.id) <= seen) return out.reverse();
      out.push({ id: Number(a.id), ref: String(a.ref), before: String(a.before), after: String(a.after), at: Date.parse(String(a.timestamp)), pusher: isObj(a.actor) && typeof a.actor.login === 'string' ? a.actor.login || null : null });
    }
    next = seen === undefined ? undefined : page.next;
  }
  return out.reverse();
}
const login = (account: unknown, person: unknown): string => (isObj(account) && typeof account.login === 'string' ? account.login : isObj(person) && typeof person.name === 'string' ? person.name : '');
/**
 * Each commit a ref change brought. A new branch has no `before`, so it reads against `base`; a commit `compare` leaves
 * out, or a change it can't read, has no entry, which head trust reads as untrusted.
 */
export async function commitsOf(rest: Rest, repo: string, fork: boolean, base: string, change: RefChange): Promise<Push[]> {
  if (change.after === ZERO) return [];
  const range = `${change.before === ZERO ? base : change.before}...${change.after}`;
  const compared = await rest('GET', `/repos/${repo}/compare/${range}`).catch((error: unknown) => { if (error instanceof ForgeRefused && error.status === 404) return undefined; throw error; });
  const commits = isObj(compared?.body) && Array.isArray(compared.body.commits) ? compared.body.commits.filter(isObj) : [];
  return commits.map((c) => {
    const git = isObj(c.commit) ? c.commit : {};
    return {
      commit: String(c.sha), author: login(c.author, git.author), committer: login(c.committer, git.committer), ref: change.ref,
      tree: isObj(git.tree) && typeof git.tree.sha === 'string' ? git.tree.sha : null, recorded: { pusher: change.pusher, repo, fork },
    };
  });
}
/** The first push of each commit. */
export const firstPushes = (pushes: Push[]): Push[] => [...new Map(pushes.toReversed().map((p) => [p.commit, p])).values()].toReversed();
const pushesOf = async (rest: Rest, repo: string, fork: boolean, base: string): Promise<Push[]> => {
  const out: Push[] = [];
  for (const change of await refChanges(rest, repo)) out.push(...await commitsOf(rest, repo, fork, base, change));
  return out;
};
export const defaultBranch = async (rest: Rest, repo: string): Promise<string> => {
  const { body } = await rest('GET', `/repos/${repo}`);
  return isObj(body) && typeof body.default_branch === 'string' ? body.default_branch : 'main';
};
/** The open pull requests into `repo`, as the list shows them. */
export async function openPulls(rest: Rest, repo: string): Promise<Obj[]> {
  const out: Obj[] = [];
  for (let next: string | undefined = `/repos/${repo}/pulls?state=open&per_page=100`; next;) {
    const page: { body: unknown; next: string | undefined } = await rest('GET', next);
    out.push(...(Array.isArray(page.body) ? page.body : []).filter(isObj));
    next = page.next;
  }
  return out;
}
/** Every push `rest` can read of `repo` and of the forks with a pull request into it. */
export async function pushesWithForks(rest: Rest, repo: string): Promise<Push[]> {
  const own = await pushesOf(rest, repo, false, await defaultBranch(rest, repo));
  const forks = new Map<string, string>();
  for (const pull of await openPulls(rest, repo)) {
    const name = isObj(pull.head) && isObj(pull.head.repo) ? pull.head.repo.full_name : undefined;
    if (typeof name === 'string' && name !== repo) forks.set(name, isObj(pull.base) ? String(pull.base.ref) : 'main');
  }
  const theirs = await Promise.all([...forks].map(([name, base]) => pushesOf(rest, name, true, base)));
  return firstPushes([...own, ...theirs.flat()]);
}
/** GitHub's record of each push of `repo` and of the forks with a pull request into it, one entry per pushed commit. */
export const githubPushes = (o: { api: string; token?: string; repo: string }): Promise<ProviderPush[]> => pushesWithForks(restOf(o.api, o.token), o.repo);
/** `push.record@1` readings of those: the pusher GitHub recorded, an empty one null. `author-as-pusher` is the kit's wrong program. */
export function githubPushReader(o: { plant?: 'author-as-pusher' } = {}): PushRecordReader {
  return { id: 'github', read: (pushes) => pushes.map((p) => ({ commit: p.commit, pusher: o.plant === 'author-as-pusher' ? p.author : p.recorded.pusher || null })) };
}
const GIT_PUSH = /\bgit(?:\s+(?:-[cC]\s+\S+|-\S+))*\s+push\b([^;&|)\n]*)/g;
/**
 * Whether a shell command names a change of `ref`: a `git push` of it, of a branch the words don't say (bare, `HEAD`,
 * `--all`), or a `gh pr merge`, which names a pull request and so whichever ref is its base.
 */
export function namesRef(command: string, ref: string): boolean {
  if (/\bgh\s+pr\s+merge\b/.test(command)) return true;
  const short = ref.replace(/^refs\/(?:heads|tags)\//, '');
  return [...command.matchAll(GIT_PUSH)].some(([, rest]) => {
    const words = (rest ?? '').trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, '')).filter(Boolean);
    const specs = words.filter((w) => !w.startsWith('-')).slice(1).map((w) => w.replace(/^\+/, '').split(':').at(-1)!);
    if (!specs.length || words.some((w) => /^--(?:all|mirror|tags)$/.test(w))) return true;
    return specs.some((to) => to === 'HEAD' || to === ref || to === short);
  });
}
/** The `owner/name` an origin URL names on GitHub, as the archive reads it; a local path ending in one counts. */
export const repoOf = (origin: string): string | undefined => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(origin)?.[1];
