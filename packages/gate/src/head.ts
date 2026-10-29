// Head trust (#29; design: Threats, Untrusted PR heads). Checks run on a PR's head only when every commit since its
// base was recorded from a DeepBuild session or has a `push.record@1` reading whose pusher is an account you named
// as yours. The pusher is the provider's own record of the push; a commit's author and committer fields never count,
// and an empty pusher, or no reading at all, counts as a push by an account you didn't name. A reader is read for
// head trust only once it passes the reading's kit: recorded pushes replayed through it must give each commit the
// pusher the provider recorded. Any other head runs only in the platform sandbox, with no network and no
// credentials, or stays BLOCKED (cause: untrusted head, owner: you).
import { execFileSync } from 'node:child_process';

export interface ProviderPush { commit: string; author: string; committer: string; recorded: { pusher: string | null; repo: string; fork: boolean } }
export interface PushReading { commit: string; pusher: string | null }
export interface PushRecordReader { id: string; read(pushes: ProviderPush[]): PushReading[] }
export interface PushKit { pushes: ProviderPush[]; expected: PushReading[] }

/** The kit's recorded pushes: a fork's, a stranger's push of a commit authored as you, an empty actor, and yours. */
export function pushRecordKit(): PushKit {
  const sha = (n: number) => n.toString(16).padStart(40, `${n}`);
  const pushes: ProviderPush[] = [
    { commit: sha(1), author: 'stranger', committer: 'stranger', recorded: { pusher: 'stranger', repo: 'stranger/shop', fork: true } },
    { commit: sha(2), author: 'you', committer: 'you', recorded: { pusher: 'stranger', repo: 'stranger/shop', fork: true } },
    { commit: sha(3), author: 'you', committer: 'you', recorded: { pusher: 'dev-x', repo: 'owner/shop', fork: false } },
    { commit: sha(4), author: 'you', committer: 'you', recorded: { pusher: null, repo: 'owner/shop', fork: false } },
    { commit: sha(5), author: 'you', committer: 'you', recorded: { pusher: '', repo: 'owner/shop', fork: false } },
    { commit: sha(6), author: 'dev-x', committer: 'dev-x', recorded: { pusher: 'you', repo: 'owner/shop', fork: false } },
  ];
  return { pushes, expected: pushes.map((p) => ({ commit: p.commit, pusher: p.recorded.pusher || null })) };
}
export function runPushRecordKit(reader: PushRecordReader): { passed: boolean; failures: { commit: string; expected: string | null; got: string | null }[] } {
  const kit = pushRecordKit();
  let read: PushReading[];
  try { read = reader.read(structuredClone(kit.pushes)); } catch { read = []; }
  const failures: { commit: string; expected: string | null; got: string | null }[] = [];
  for (const e of kit.expected) {
    const got = read.filter((r) => r.commit === e.commit);
    const pusher = got.length === 1 ? got[0]!.pusher || null : null;
    if (got.length !== 1 || pusher !== e.pusher) failures.push({ commit: e.commit, expected: e.pusher, got: got.length === 1 ? got[0]!.pusher : null });
  }
  for (const r of read) if (!kit.expected.some((e) => e.commit === r.commit)) failures.push({ commit: r.commit, expected: null, got: r.pusher });
  return { passed: failures.length === 0, failures };
}

export interface HeadInput {
  repo: string; base: string; head: string;
  recorded: string[];
  yours: string[];
  provider: ProviderPush[];
  reader?: PushRecordReader;
}
export type HeadPlan = { run: 'host' } | { run: 'sandbox'; network: false; credentials: false } | { run: 'blocked'; cause: 'untrusted head'; owner: 'you' };
export interface HeadResult {
  trusted: boolean;
  commits: { commit: string; trusted: boolean; via: 'session' | 'pusher' | null; pusher: string | null }[];
  plan: HeadPlan;
  cause: 'untrusted head' | null;
}
export type HeadPlant = 'author-counts' | 'committer-counts' | 'empty-pusher-counts' | 'unvetted-reader';

/** The kit result per reader, so a reader is replayed once. */
const vetted = new WeakMap<PushRecordReader, boolean>();
function passes(reader: PushRecordReader): boolean {
  let ok = vetted.get(reader);
  if (ok === undefined) vetted.set(reader, (ok = runPushRecordKit(reader).passed));
  return ok;
}

export function headTrust(input: HeadInput, options: { sandbox?: boolean; plant?: HeadPlant } = {}): HeadResult {
  const { plant } = options;
  const shas = execFileSync('git', ['rev-list', '--reverse', `${input.base}..${input.head}`], { cwd: input.repo, encoding: 'utf8' }).split('\n').filter(Boolean);
  const recorded = new Set(input.recorded);
  const yours = new Set(input.yours);
  const reader = input.reader && (plant === 'unvetted-reader' || passes(input.reader)) ? input.reader : undefined;
  const pending = input.provider.filter((p) => shas.includes(p.commit) && !recorded.has(p.commit));
  const readings = reader && pending.length ? reader.read(pending) : [];
  const field = (sha: string, f: 'an' | 'cn'): string => execFileSync('git', ['log', '-1', `--format=%${f}`, sha], { cwd: input.repo, encoding: 'utf8' }).trim();
  const commits = shas.map((commit) => {
    if (recorded.has(commit)) return { commit, trusted: true, via: 'session' as const, pusher: null };
    const found = readings.filter((r) => r.commit === commit);
    const pusher = found.length === 1 ? found[0]!.pusher || null : null;
    // The planted wrong programs: the author or committer field, or an empty pusher, counts as yours.
    const planted = (plant === 'author-counts' && yours.has(field(commit, 'an'))) || (plant === 'committer-counts' && yours.has(field(commit, 'cn')))
      || (plant === 'empty-pusher-counts' && found.length === 1 && !found[0]!.pusher);
    const trusted = (pusher !== null && yours.has(pusher)) || planted;
    return { commit, trusted, via: trusted ? ('pusher' as const) : null, pusher };
  });
  const trusted = commits.every((c) => c.trusted);
  const plan: HeadPlan = trusted ? { run: 'host' } : options.sandbox === false ? { run: 'blocked', cause: 'untrusted head', owner: 'you' } : { run: 'sandbox', network: false, credentials: false };
  return { trusted, commits, plan, cause: trusted ? null : 'untrusted head' };
}
