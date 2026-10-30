// #29 AC13, AC14, AC15, AC16, AC17: head trust. Real git repositories with real author and committer fields; the pusher comes
// only from the provider's push record, read through a `push.record@1` reader that passed the kit.
import { describe, expect, it } from 'vitest';
import { headTrust, pushRecordKit, runPushRecordKit } from '../../../packages/gate/src/index.ts';
import type { HeadResult, ProviderPush, PushReading, PushRecordReader } from '../../../packages/gate/src/index.ts';
import { commitFiles, git, makeRepo, mustFail } from './helpers.ts';

type Opts = NonNullable<Parameters<typeof headTrust>[1]>;
const YOU = 'you-acct';
/** The correct reader: the pusher the provider recorded, an empty actor kept empty. */
const reader: PushRecordReader = { id: 'github', read: (pushes) => pushes.map((p): PushReading => ({ commit: p.commit, pusher: p.recorded.pusher || null })) };
/** The wrong reader of the criterion: each commit's author as its pusher. */
const authorReader: PushRecordReader = { id: 'author-as-pusher', read: (pushes) => pushes.map((p): PushReading => ({ commit: p.commit, pusher: p.author })) };

interface Spec { author?: string; committer?: string; pusher: string | null; fork?: boolean; recorded?: boolean; noPush?: boolean }
/** A repository with one base commit and one commit per spec; the provider's record of each push. */
function world(specs: Spec[]) {
  const { dir, commit: base } = makeRepo({ 'src/a.ts': 'export {};\n' });
  const commits: string[] = [];
  specs.forEach((s, i) => commits.push(commitFiles(dir, { [`src/f${i}.ts`]: `export const n = ${i};\n` }, `change ${i}`, { author: s.author ?? YOU, committer: s.committer ?? s.author ?? YOU })));
  const provider: ProviderPush[] = [];
  specs.forEach((s, i) => {
    if (s.noPush) return;
    const sha = commits[i]!;
    provider.push({
      commit: sha, author: git(dir, ['log', '-1', '--format=%an', sha]), committer: git(dir, ['log', '-1', '--format=%cn', sha]),
      recorded: { pusher: s.pusher, repo: s.fork ? 'stranger/shop' : 'owner/shop', fork: s.fork ?? false },
    });
  });
  const recorded = specs.flatMap((s, i) => (s.recorded ? [commits[i]!] : []));
  return { repo: dir, base, head: commits[commits.length - 1]!, commits, provider, recorded };
}
const run = (w: ReturnType<typeof world>, o: { r?: PushRecordReader | undefined; opts?: Opts | undefined; yours?: string[] | undefined } = {}): HeadResult =>
  headTrust({ repo: w.repo, base: w.base, head: w.head, recorded: w.recorded, yours: o.yours ?? [YOU], provider: w.provider, reader: o.r ?? reader }, o.opts);

function expectUntrusted(r: HeadResult, what: string): void {
  expect(r.trusted, `${what}: the head is untrusted`).toBe(false);
  expect(r.cause, `${what}: the claim names the cause`).toBe('untrusted head');
  expect(r.plan, `${what}: runs only in the sandbox, with no network and no credentials`).toEqual({ run: 'sandbox', network: false, credentials: false });
}
function expectBlockedWithoutSandbox(w: ReturnType<typeof world>, what: string, o: { r?: PushRecordReader } = {}): void {
  const r = run(w, { ...o, opts: { sandbox: false } });
  expect(r.trusted, what).toBe(false);
  expect(r.plan, `${what}: with no sandbox it stays BLOCKED, cause untrusted head, owner you`).toEqual({ run: 'blocked', cause: 'untrusted head', owner: 'you' });
  expect(r.cause).toBe('untrusted head');
}

describe('AC13 a PR from a fork, or from a branch an account you didn\'t name pushed, runs no check outside the sandbox', () => {
  it('AC13 a PR from a fork: untrusted head, sandbox only', () => {
    const w = world([{ author: 'stranger', pusher: 'stranger', fork: true }, { author: 'stranger', pusher: 'stranger', fork: true }]);
    const r = run(w);
    expectUntrusted(r, 'fork');
    expect(r.commits.map((c) => c.commit)).toEqual(w.commits);
    expect(r.commits.every((c) => !c.trusted && c.via === null)).toBe(true);
    expectBlockedWithoutSandbox(w, 'fork');
  });
  it('AC13 a branch pushed by an account you didn\'t name: untrusted head', () => {
    const w = world([{ author: 'dev-x', pusher: 'dev-x' }]);
    expectUntrusted(run(w), 'unnamed pusher');
    expectBlockedWithoutSandbox(w, 'unnamed pusher');
  });
  it('AC13 one untrusted commit among trusted ones makes the whole head untrusted, and names it', () => {
    const w = world([{ pusher: YOU }, { author: 'dev-x', pusher: 'dev-x' }, { pusher: YOU }]);
    const r = run(w);
    expectUntrusted(r, 'mixed');
    expect(r.commits.map((c) => c.trusted)).toEqual([true, false, true]);
    expect(r.commits[1]!.pusher).toBe('dev-x');
  });
});

describe('AC14 a PR whose commits were all recorded from your sessions gets its checks as usual', () => {
  it('AC14 every commit recorded from a DeepBuild session: trusted, on the host, with no provider reading needed', () => {
    const w = world([{ author: 'agent', pusher: null, recorded: true, noPush: true }, { author: 'agent', pusher: 'dev-x', recorded: true, noPush: true }]);
    const r = run(w);
    expect(r.trusted).toBe(true);
    expect(r.cause).toBeNull();
    expect(r.plan).toEqual({ run: 'host' });
    expect(r.commits.map((c) => c.via)).toEqual(['session', 'session']);
  });
  it('AC14 recorded commits and commits pushed by your account: trusted', () => {
    const w = world([{ author: 'agent', pusher: null, recorded: true, noPush: true }, { author: 'someone', pusher: YOU }]);
    const r = run(w);
    expect(r.trusted).toBe(true);
    expect(r.plan).toEqual({ run: 'host' });
    expect(r.commits.map((c) => c.via)).toEqual(['session', 'pusher']);
  });
  it('AC14 one commit not recorded and not pushed by you makes it untrusted', () => {
    const w = world([{ author: 'agent', pusher: null, recorded: true, noPush: true }, { author: 'agent', pusher: 'dev-x' }]);
    expectUntrusted(run(w), 'one commit outside');
  });
});

describe('AC15 a commit whose author and committer name your account is still untrusted when a stranger pushed it', () => {
  const holds = (opts?: Opts) => {
    const fork = world([{ author: YOU, committer: YOU, pusher: 'stranger', fork: true }]);
    expectUntrusted(run(fork, { opts }), 'authored and committed as you, pushed by a stranger to a fork');
    expectBlockedWithoutSandbox(fork, 'fork');
    const repo = world([{ author: YOU, committer: YOU, pusher: 'dev-x' }]);
    expectUntrusted(run(repo, { opts }), 'authored and committed as you, pushed to the repo by an account you didn\'t name');
    const committerOnly = world([{ author: 'stranger', committer: YOU, pusher: 'stranger' }]);
    expectUntrusted(run(committerOnly, { opts }), 'committer field is yours');
  };
  it('AC15 neither the author nor the committer field ever counts', () => holds());
  it('AC15 your account as the pusher is trusted whatever the author says', () => {
    const w = world([{ author: 'stranger', committer: 'stranger', pusher: YOU }]);
    expect(run(w).trusted).toBe(true);
  });
  it('AC15 planted twins that read the author or the committer fail', async () => {
    await mustFail('author-counts', () => holds({ plant: 'author-counts' }), ['untrusted']);
    await mustFail('committer-counts', () => holds({ plant: 'committer-counts' }), ['untrusted']);
  });
});

describe('AC16 a push with an empty pusher, or no reading at all, counts as a push by an account you didn\'t name', () => {
  const holds = (opts?: Opts) => {
    expectUntrusted(run(world([{ pusher: null }]), { opts }), 'a reading whose pusher is empty (null)');
    expectUntrusted(run(world([{ pusher: '' }]), { opts }), 'a reading whose pusher is empty (empty string)');
    expectUntrusted(run(world([{ pusher: YOU, noPush: true }]), { opts }), 'a commit with no reading at all');
    expectUntrusted(run(world([{ pusher: YOU }, { pusher: null }]), { opts }), 'one empty pusher among yours');
    expectBlockedWithoutSandbox(world([{ pusher: null }]), 'empty pusher');
    expectBlockedWithoutSandbox(world([{ pusher: YOU, noPush: true }]), 'no reading');
  };
  it('AC16 an empty pusher or a commit with no reading: sandbox only, or BLOCKED (cause: untrusted head)', () => holds());
  it('AC16 a planted program that trusts an empty pusher fails', async () => {
    await mustFail('empty-pusher-counts', () => holds({ plant: 'empty-pusher-counts' }), ['empty']);
  });
});

describe('AC17 the push.record@1 kit', () => {
  it('AC17 the kit replays a fork\'s push, a stranger\'s push of a commit authored by someone else, and an empty actor', () => {
    const { pushes, expected } = pushRecordKit();
    expect(pushes.some((p) => p.recorded.fork), 'a fork\'s push').toBe(true);
    expect(pushes.some((p) => p.recorded.pusher && p.recorded.pusher !== p.author), 'a stranger\'s push of a commit authored as someone else').toBe(true);
    expect(pushes.some((p) => !p.recorded.pusher), 'an empty actor').toBe(true);
    expect(expected.map((e) => e.commit).sort()).toEqual(pushes.map((p) => p.commit).sort());
    for (const e of expected) expect(e.pusher).toBe(pushes.find((p) => p.commit === e.commit)!.recorded.pusher || null);
  });
  it('AC17 a reader that gives each commit the pusher the provider recorded passes', () => {
    expect(runPushRecordKit(reader)).toEqual({ passed: true, failures: [] });
  });
  it('AC17 a planted reader that reports each commit\'s author as its pusher fails, naming the commit', () => {
    const r = runPushRecordKit(authorReader);
    expect(r.passed).toBe(false);
    const authored = pushRecordKit().pushes.filter((p) => (p.recorded.pusher || null) !== p.author).map((p) => p.commit);
    expect(authored.length).toBeGreaterThan(0);
    for (const sha of authored) expect(r.failures.map((f) => f.commit), `the failure names ${sha}`).toContain(sha);
    const f = r.failures.find((x) => x.commit === authored[0])!;
    expect(f.expected).toBe(pushRecordKit().pushes.find((p) => p.commit === authored[0])!.recorded.pusher || null);
    expect(f.got).toBe(pushRecordKit().pushes.find((p) => p.commit === authored[0])!.author);
  });
  it('AC17 a reader that drops or invents a commit, or fills an empty actor, fails', () => {
    const fills: PushRecordReader = { id: 'fills', read: (ps) => ps.map((p) => ({ commit: p.commit, pusher: p.recorded.pusher || p.author })) };
    expect(runPushRecordKit(fills).passed).toBe(false);
    const drops: PushRecordReader = { id: 'drops', read: (ps) => ps.slice(1).map((p) => ({ commit: p.commit, pusher: p.recorded.pusher || null })) };
    expect(runPushRecordKit(drops).passed).toBe(false);
  });
  const neverRead = (opts?: Opts) => {
    // Authored as you, pushed by a stranger to a fork: the author-as-pusher reader would say it's yours.
    const w = world([{ author: YOU, committer: YOU, pusher: 'stranger', fork: true }]);
    const shas = new Set(w.commits);
    let reads = 0;
    const spy: PushRecordReader = { id: authorReader.id, read: (ps) => { if (ps.some((p) => shas.has(p.commit))) reads++; return authorReader.read(ps); } };
    const r = run(w, { r: spy, opts });
    expect(reads, 'a reader that failed the kit is never read for head trust').toBe(0);
    expectUntrusted(r, 'the unvetted reader\'s readings say yours');
  };
  it('AC17 a reader that hasn\'t passed the kit is never read for head trust, and the head is untrusted', () => neverRead());
  it('AC17 a reader that passed the kit is read for head trust', () => {
    const w = world([{ pusher: YOU }]);
    const shas = new Set(w.commits);
    let reads = 0;
    const spy: PushRecordReader = { id: reader.id, read: (ps) => { if (ps.some((p) => shas.has(p.commit))) reads++; return reader.read(ps); } };
    expect(run(w, { r: spy }).trusted).toBe(true);
    expect(reads).toBeGreaterThan(0);
  });
  it('AC17 a gate that reads an unvetted reader fails', async () => {
    await mustFail('unvetted-reader', () => neverRead({ plant: 'unvetted-reader' }), ['never read']);
  });
});
