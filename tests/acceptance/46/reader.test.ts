// AC4: GitHub's push.record@1 reader passes the reading's kit (#29) on recorded pushes from a fork, from a stranger
// pushing a commit authored as you, and with an empty actor; a reader that copies a commit's author into its pusher
// fails it, naming the commit.
//
// The kit is @deepbuild/gate's, unchanged. Beside it the same pushes are real: real commits pushed into real bare repos
// behind the fixture forge, read over HTTP by the reader's public entry, so the reader can't pass the kit and still read
// GitHub's answers wrong. The wrong program is the reader's plant `author-as-pusher`, as @deepbuild/gate's HeadPlant is
// selected. No hub: this is the reading itself.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headTrust, pushRecordKit, runPushRecordKit, type ProviderPush, type PushReading } from '../../../packages/gate/src/index.ts';
import { githubPushes, githubPushReader } from '../../../packages/github/src/index.ts';
import { FixtureForge } from './forge.ts';
import { AC4, STRANGER, YOU } from './helpers.ts';

const OWNER_REPO = 'acme/shop';
const FORK = `${STRANGER}/shop`;
const FORGE_ENV = (actor: string): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', FORGE_ACTOR: actor });
let dir = '';
let forge: FixtureForge;
/** The world's commits by what they are, and the base they stand on. */
const commits = { base: '', forkOwn: '', forkAsYou: '', strangerAsYou: '', noActor: '', yours: '' };

/** Git as `actor`'s machine runs it: `author` on the commits, `actor` on the forge's record of the push. */
function git(cwd: string, actor: string, author: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${author}`, '-c', `user.email=${author}@example.invalid`, '-c', 'commit.gpgsign=false', ...args], { cwd, env: FORGE_ENV(actor), encoding: 'utf8' }).trim();
}
function commit(cwd: string, actor: string, author: string, name: string): string {
  writeFileSync(join(cwd, name), `${name}\n`);
  git(cwd, actor, author, 'add', '-A');
  git(cwd, actor, author, 'commit', '-q', '-m', `Add ${name}`);
  return git(cwd, actor, author, 'rev-parse', 'HEAD');
}
const read = async (plant?: 'author-as-pusher'): Promise<{ pushes: ProviderPush[]; readings: PushReading[] }> => {
  const pushes = await githubPushes({ api: forge.url, token: 'test-gate-token', repo: OWNER_REPO });
  return { pushes, readings: githubPushReader(plant ? { plant } : {}).read(structuredClone(pushes)) };
};
const pusherOf = (readings: PushReading[], sha: string): (string | null)[] => readings.filter((r) => r.commit === sha).map((r) => r.pusher);

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh46-reader-')));
  forge = await FixtureForge.start(dir);
  const bare = forge.repo(OWNER_REPO, { private: false });
  const mine = join(dir, 'mine');
  git(dir, YOU, YOU, 'clone', '-q', bare, mine);
  git(mine, YOU, YOU, 'checkout', '-q', '-b', 'main');
  commits.base = commit(mine, YOU, YOU, 'base.md');
  git(mine, YOU, YOU, 'push', '-q', 'origin', 'main');

  // A fork, and a pull request from it: one push of two commits, the second authored and committed as you.
  const forkBare = forge.repo(FORK, { private: false, parent: OWNER_REPO });
  const theirs = join(dir, 'theirs');
  git(dir, STRANGER, STRANGER, 'clone', '-q', forkBare, theirs);
  git(theirs, STRANGER, STRANGER, 'checkout', '-q', '-b', 'patch');
  commits.forkOwn = commit(theirs, STRANGER, STRANGER, 'fork-own.md');
  commits.forkAsYou = commit(theirs, STRANGER, YOU, 'fork-as-you.md');
  git(theirs, STRANGER, STRANGER, 'push', '-q', 'origin', 'patch');
  forge.pull({ repo: OWNER_REPO, head_repo: FORK, head: 'patch' });

  // In your repo: a stranger with write access pushes a commit authored as you; a push the forge records with no actor; yours, authored by someone else.
  git(mine, YOU, YOU, 'checkout', '-q', '-b', 'topic');
  commits.strangerAsYou = commit(mine, STRANGER, YOU, 'stranger-as-you.md');
  git(mine, STRANGER, STRANGER, 'push', '-q', 'origin', 'topic');
  commits.noActor = commit(mine, '', YOU, 'no-actor.md');
  git(mine, '', YOU, 'push', '-q', 'origin', 'topic');
  commits.yours = commit(mine, YOU, STRANGER, 'yours.md');
  git(mine, YOU, YOU, 'push', '-q', 'origin', 'topic');
});
afterAll(async () => {
  await forge?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe(`${AC4} GitHub's push.record@1 reader passes the reading's kit on recorded pushes from a fork, from a stranger pushing a commit authored as you, and with an empty actor`, () => {
  it(`${AC4} runPushRecordKit passes the reader, with no failure`, () => {
    expect(runPushRecordKit(githubPushReader())).toEqual({ passed: true, failures: [] });
  });

  it(`${AC4} over GitHub's API, each pushed commit reads with the pusher the forge recorded and an empty actor stays empty, whatever its author says`, async () => {
    const { pushes, readings } = await read();
    expect(pusherOf(readings, commits.forkOwn), 'a fork\'s push').toEqual([STRANGER]);
    expect(pusherOf(readings, commits.forkAsYou), 'a fork\'s commit authored as you').toEqual([STRANGER]);
    expect(pusherOf(readings, commits.strangerAsYou), 'a stranger pushing a commit authored as you').toEqual([STRANGER]);
    expect(pusherOf(readings, commits.noActor), 'an empty actor is kept empty').toEqual([null]);
    expect(pusherOf(readings, commits.yours), 'your push of someone else\'s commit').toEqual([YOU]);
    for (const r of readings) expect(Object.keys(r).sort(), `${r.commit}: a push.record@1 reading holds these fields alone`).toEqual(['commit', 'pusher']);
    const forked = pushes.find((p) => p.commit === commits.forkAsYou);
    expect(forked, 'what the provider recorded for the fork\'s commit').toMatchObject({ author: YOU, committer: YOU, recorded: { pusher: STRANGER, repo: FORK, fork: true } });
    expect(pushes.find((p) => p.commit === commits.strangerAsYou), 'and for the push to your repo').toMatchObject({ author: YOU, recorded: { pusher: STRANGER, repo: OWNER_REPO, fork: false } });
  });

  it(`${AC4} the gate's head-trust rule, given these readings, holds a head with a stranger's or an empty actor's commit as untrusted and trusts yours`, async () => {
    const { pushes } = await read();
    const clone = join(dir, 'clone');
    git(dir, YOU, YOU, 'clone', '-q', join(dir, 'github.com', `${OWNER_REPO}.git`), clone);
    const reader = githubPushReader();
    const trust = (head: string, base: string, yours = [YOU]) => headTrust({ repo: clone, base, head, recorded: [], yours, provider: pushes, reader });
    expect(trust(commits.strangerAsYou, commits.base), 'a stranger\'s push authored as you').toMatchObject({ trusted: false, cause: 'untrusted head' });
    expect(trust(commits.noActor, commits.strangerAsYou), 'an empty actor').toMatchObject({ trusted: false, cause: 'untrusted head' });
    expect(trust(commits.yours, commits.noActor), 'your own push').toMatchObject({ trusted: true, cause: null });
  });
});

describe(`${AC4} A reader that copies a commit's author into its pusher fails the kit, naming the commit`, () => {
  it(`${AC4} (planted author-as-pusher) runPushRecordKit fails it, naming each commit whose author isn't its pusher`, () => {
    const { pushes } = pushRecordKit();
    const { passed, failures } = runPushRecordKit(githubPushReader({ plant: 'author-as-pusher' }));
    expect(passed, 'the kit refuses the reader').toBe(false);
    const wrong = pushes.filter((p) => p.author !== (p.recorded.pusher || null)).map((p) => p.commit);
    expect(wrong.length, 'the kit holds such pushes').toBeGreaterThan(0);
    expect(failures.map((f) => f.commit), 'each failure names its commit').toEqual(wrong);
    expect(failures.find((f) => f.commit === wrong[0]), 'with what it should have read').toMatchObject({ expected: pushes.find((p) => p.commit === wrong[0])!.recorded.pusher, got: pushes.find((p) => p.commit === wrong[0])!.author });
  });

  it(`${AC4} (planted author-as-pusher) over GitHub's API the wrong reader says you pushed the stranger's commit, and the gate doesn't use it`, async () => {
    const { pushes, readings } = await read('author-as-pusher');
    expect(pusherOf(readings, commits.strangerAsYou), 'the wrong program, driven').toEqual([YOU]);
    const clone = join(dir, 'clone');
    const held = headTrust({ repo: clone, base: commits.base, head: commits.strangerAsYou, recorded: [], yours: [YOU], provider: pushes, reader: githubPushReader({ plant: 'author-as-pusher' }) });
    expect(held, 'a reader that fails the kit is never read for head trust').toMatchObject({ trusted: false, cause: 'untrusted head' });
  });
});
