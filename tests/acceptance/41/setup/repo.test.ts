// AC10 #41.efef0e11 `deep setup` never changes branch protection or any repo setting.
//
// `deep setup` and a confirmed `deep setup --undo` run inside a git repository whose origin is on GitHub, with Claude
// Code and Codex both present in the home. `gh` and `git` first on PATH (for setup, the hub its login service starts,
// and anything they run) log every call; gh answers nothing and never reaches GitHub, git passes each call to the
// machine's git. Afterwards: no gh call touches branch protection, rulesets, a repo's settings, secrets, variables or
// labels, and no gh api call to a repos/ path uses a method other than GET; no git call writes config or changes a
// remote or a branch's upstream; the repository's .git/config is byte-identical, its .git/hooks, .git/info and
// description are as they were, and setup added, changed or removed nothing in its work tree (where a project's agent
// settings, .claude/ and .codex/, are kept). The wrong program is the planted `setup-writes-project-settings`
// (DEEP_HUB_PLANT), a setup that writes its entries into the repo it runs in too.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC10, calls, changes, childEnv, cleanup, firstDifference, makeHome, onMac, REAL_GIT, setup, shown, snapshot, undo, type Call, type Home } from './helpers.ts';

afterAll(cleanup, 60_000);

/** A repository at `<tmp>/repo` with one commit, origin on GitHub, an upstream for main, and a hook of yours; made with the machine's git, not through the logger. */
function gitRepo(h: Home): string {
  const dir = join(h.tmp, 'repo');
  mkdirSync(dir);
  writeFileSync(join(dir, 'README.md'), '# mine\n');
  const git = (...args: string[]) => execFileSync(REAL_GIT, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: childEnv(h), encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', 'https://github.com/example/dh41-repo.git');
  git('config', 'branch.main.remote', 'origin');
  git('config', 'branch.main.merge', 'refs/heads/main');
  writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho my-pre-commit\n');
  chmodSync(join(dir, '.git', 'hooks', 'pre-commit'), 0o755);
  return dir;
}

/** The repository's settings in .git: config (and any config.*), hooks, info and description. */
const settingsOf = (repo: string) => snapshot(join(repo, '.git'), (rel) => /^(config($|\.)|hooks($|\/)|info($|\/)|description$)/.test(rel));
/** The work tree, .git aside: a project's agent settings live here. */
const treeOf = (repo: string) => snapshot(repo, (rel) => rel !== '.git');

const shownCall = (c: Call) => `${c.args.map((a) => JSON.stringify(a)).join(' ')} (in ${c.cwd})`;
/** The arguments after git's own options (-C, -c, --git-dir= and the like): the subcommand first. */
function gitCommand(args: string[]): string[] {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(args[i]!) ? 2 : 1;
  return args.slice(i);
}
/** Why a git call changes a repo setting, or undefined for one that doesn't. */
function gitWrite(args: string[]): string | undefined {
  const [sub, ...rest] = gitCommand(args);
  if (sub === 'config') {
    const reads = rest[0] === 'get' || rest[0] === 'list' || rest.some((a) => /^(--get(-all|-regexp|-urlmatch|-color|-colorbool)?|--list|-l)$/.test(a));
    return reads ? undefined : 'writes git config';
  }
  if (sub === 'remote' && ['add', 'rename', 'remove', 'rm', 'set-head', 'set-branches', 'set-url'].includes(rest[0] ?? '')) return 'changes a remote';
  if (sub === 'branch' && rest.some((a) => /^(-u|--set-upstream-to(=.*)?|--set-upstream|--unset-upstream)$/.test(a))) return "changes a branch's upstream";
  return undefined;
}
/** Why a gh call changes branch protection or a repo setting, or undefined for one that doesn't. */
function ghWrite(args: string[]): string | undefined {
  const [sub, verb] = args;
  if (sub === 'ruleset') return 'touches rulesets';
  if (sub === 'repo' && ['edit', 'rename', 'archive', 'unarchive', 'delete', 'set-default'].includes(verb ?? '')) return 'changes a repo setting';
  if ((sub === 'secret' || sub === 'variable') && ['set', 'delete', 'remove'].includes(verb ?? '')) return `changes a repo ${sub}`;
  if (sub === 'label' && ['create', 'edit', 'delete', 'clone'].includes(verb ?? '')) return 'changes repo labels';
  if (sub !== 'api') return undefined;
  const rest = args.slice(1);
  const path = rest.find((a, i) => !a.startsWith('-') && !/^(-X|--method|-f|-F|--field|--raw-field|--input|-H|--header|-q|--jq|-t|--template|--hostname|--cache|-p|--preview)$/.test(rest[i - 1] ?? '')) ?? '';
  if (/(^|\/)protection(\/|$)|\/branches\/[^/]+\/protection/.test(path)) return 'calls the branch protection API';
  if (/(^|\/)rulesets?(\/|$)/.test(path)) return 'calls the rulesets API';
  const flag = rest.findIndex((a) => a === '-X' || a === '--method');
  const method = (flag >= 0 ? rest[flag + 1] : /^(-X|--method=)(.+)$/.exec(rest.find((a) => /^(-X.|--method=)/.test(a)) ?? '')?.[2])?.toUpperCase()
    ?? (rest.some((a) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a)) ? 'POST' : 'GET');
  if (/^\/?repos\//.test(path) && method !== 'GET') return `sends ${method} to a repos/ path`;
  return undefined;
}

/** A home with Claude Code and Codex, a repo, `deep setup` and a confirmed undo in it; every way they changed a repo setting. */
async function setupAndUndoInRepo(env: Record<string, string | undefined> = {}): Promise<string[]> {
  onMac();
  const h = makeHome();
  mkdirSync(join(h.home, '.codex'), { recursive: true });
  const repo = gitRepo(h);
  // The control: a git on this PATH is the logger.
  const probe = execFileSync('git', ['--version'], { cwd: h.tmp, env: childEnv(h), encoding: 'utf8' });
  expect(calls(h, 'git.log').map((c) => c.args.join(' ')), `the git logger must be first on the PATH setup gets (${probe.trim()})`).toEqual(['--version']);
  const configBytes = readFileSync(join(repo, '.git', 'config'));
  const settings = settingsOf(repo);
  const tree = treeOf(repo);
  const problems: string[] = [];
  const check = (when: string) => {
    const now = readFileSync(join(repo, '.git', 'config'));
    if (!now.equals(configBytes)) problems.push(`AC10 after ${when}, ${repo}/.git/config must be byte-identical: ${firstDifference(configBytes, now)}`);
    for (const c of changes(settings, settingsOf(repo))) problems.push(`AC10 after ${when}, the repo's settings in .git changed: ${c}`);
    for (const c of changes(tree, treeOf(repo))) problems.push(`AC10 after ${when}, the repo's work tree changed: ${c}`);
  };
  await setup(h, { env, cwd: repo });
  check('deep setup');
  const undone = await undo(h, { env, cwd: repo });
  check('deep setup --undo');
  for (const c of calls(h, 'gh.log')) { const why = ghWrite(c.args); if (why) problems.push(`AC10 setup or undo ran gh ${shownCall(c)}, which ${why}`); }
  for (const c of calls(h, 'git.log').slice(1)) { const why = gitWrite(c.args); if (why) problems.push(`AC10 setup or undo ran git ${shownCall(c)}, which ${why}`); }
  if (problems.length) problems.push(`(undo said: ${shown(undone)})`);
  return problems;
}

describe(`${AC10} \`deep setup\` never changes branch protection or any repo setting`, () => {
  it(`${AC10} deep setup and deep setup --undo, run inside a GitHub repo with gh and git logged, call no branch protection, ruleset or repo-settings API, write no git config, and leave .git/config byte-identical and the repo's settings and work tree as they were`, async () => {
    expect(await setupAndUndoInRepo()).toEqual([]);
  }, 300_000);

  it(`${AC10} (wrong program) a setup that writes its entries into the repo it runs in (setup-writes-project-settings) fails this test, naming .claude/settings.json`, async () => {
    const problems = await setupAndUndoInRepo({ DEEP_HUB_PLANT: 'setup-writes-project-settings' });
    expect(problems.join('\n'), 'the work-tree check must catch setup-writes-project-settings').toMatch(/^AC10 after deep setup, the repo's work tree changed: \.claude\/settings\.json added/m);
  }, 300_000);

  it(`${AC10} the call checks themselves: a gh call to branch protection, a PATCH to repos/, gh repo edit, gh ruleset and a git config write are each named; reads are not`, () => {
    const writes = [
      ['api', 'repos/example/dh41-repo/branches/main/protection'],
      ['api', '-X', 'PUT', 'repos/example/dh41-repo/branches/main/protection'],
      ['api', '--method', 'PATCH', 'repos/example/dh41-repo'],
      ['api', 'repos/example/dh41-repo', '-f', 'allow_auto_merge=true'],
      ['repo', 'edit', '--enable-auto-merge'],
      ['ruleset', 'list'],
    ];
    for (const args of writes) expect(ghWrite(args), `gh ${args.join(' ')}`).toBeTypeOf('string');
    for (const args of [['auth', 'status'], ['api', 'repos/example/dh41-repo'], ['api', 'user'], ['pr', 'list', '--json', 'number']]) expect(ghWrite(args), `gh ${args.join(' ')}`).toBeUndefined();
    for (const args of [['config', 'core.hooksPath', '/x'], ['-C', '/r', 'config', '--local', 'a.b', 'c'], ['config', '--unset', 'branch.main.merge'], ['remote', 'set-url', 'origin', 'x'], ['branch', '--set-upstream-to=origin/x']]) expect(gitWrite(args), `git ${args.join(' ')}`).toBeTypeOf('string');
    for (const args of [['config', '--get', 'remote.origin.url'], ['-C', '/r', 'config', 'get', 'user.name'], ['config', '-l'], ['-c', 'core.quotepath=off', 'status'], ['rev-parse', 'HEAD']]) expect(gitWrite(args), `git ${args.join(' ')}`).toBeUndefined();
  }, 10_000);
});
