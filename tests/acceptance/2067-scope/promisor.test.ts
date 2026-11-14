import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { git } from '../325/helpers.ts';
import { clean, missing, q, start, world } from './fixture.ts';
afterEach(clean, 60_000);

it('#2067 scope: locally resolvable main with a promised missing tree is BLOCKED without a lazy fetch', async () => {
  const w = world();
  const trace = join(w.tmp, 'git-trace.jsonl');
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  // Observe even Git's internally spawned fetch, which bypasses a PATH git-fetch guard.
  // Every call still runs the real Git, with its original arguments/config/environment.
  const r = await start(w, `#!/bin/sh\nexport GIT_TRACE2_EVENT=${q(trace)}\nexec ${q(realGit)} "$@"\n`);
  const origin = join(w.tmp, 'origin.git'), twin = join(w.tmp, 'fetch-capable-twin');
  const elsewhere = (cwd: string, ...args: string[]) => git(w.tmp, cwd, args);
  elsewhere(w.tmp, 'clone', '--bare', '--no-hardlinks', w.repo, origin);
  elsewhere(w.tmp, 'clone', '--no-hardlinks', w.repo, twin);
  elsewhere(origin, 'config', 'uploadpack.allowFilter', 'true');
  elsewhere(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const mainTree = r.g('rev-parse', `${w.main}^{tree}`);
  const object = (repo: string) => join(repo, '.git/objects', mainTree.slice(0, 2), mainTree.slice(2));
  for (const repo of [w.repo, twin]) {
    if (repo === w.repo) elsewhere(repo, 'remote', 'add', 'origin', origin);
    else elsewhere(repo, 'remote', 'set-url', 'origin', origin);
    elsewhere(repo, 'config', 'remote.origin.promisor', 'true');
    elsewhere(repo, 'config', 'remote.origin.partialclonefilter', 'blob:none');
    elsewhere(repo, 'config', 'extensions.partialClone', 'origin');
    expect(existsSync(object(repo)), 'the mainline tree is a loose local object before removal').toBe(true);
    rmSync(object(repo));
  }
  expect(r.g('rev-parse', '--verify', 'main^{commit}'), 'main itself resolves without its tree').toBe(w.main);
  expect(existsSync(object(w.repo)), 'resolving main did not retrieve its missing tree').toBe(false);
  const controlTrace = join(w.tmp, 'control-trace.jsonl');
  const mergedTree = execFileSync(realGit, ['merge-tree', '--write-tree', w.head(), w.main], {
    cwd: twin, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: w.tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_TRACE2_EVENT: controlTrace },
  }).trim();
  const commands = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8') : '')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((e) => e.event === 'cmd_name').map((e) => e.name);
  expect(commands(controlTrace), 'positive control: real merge machinery fetched the missing input from the local promisor').toEqual(expect.arrayContaining(['merge-tree', 'fetch']));
  expect(mergedTree, 'the fetch-capable twin completed a real merge').toMatch(/^[0-9a-f]{40}$/);
  writeFileSync(trace, '');
  const result = await r.open();
  const closes = await r.closes();
  const observed = commands(trace);
  console.log(`2067 scope promisor ${JSON.stringify({ localMainResolved: true, control: commands(controlTrace).filter((c) => ['merge-tree', 'fetch'].includes(c)), observed: observed.filter((c) => ['merge-tree', 'fetch'].includes(c)), verdict: result.verdict.data.outcome, reasons: result.verdict.data.reasons, checks: result.change.checks, closes })}`);
  expect.soft(observed.filter((c) => c === 'fetch'), 'nothing is fetched, including Git internal promisor retrieval').toHaveLength(0);
  missing(result, 'preflight', /(?:main\s*(?:line)?.*(?:read|unavailable|missing)|(?:read|unavailable|missing).*main\s*(?:line)?)/i);
  expect.soft(closes.allowed, 'unreadable release input holds Closes').toBe(false);
  expect.soft(closes.reason).toMatch(/preflight/i);
}, 540_000);
