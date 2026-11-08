// #1426 AC9, the guard's half: `node <guard> guard` run in a scratch repository whose main holds the carried-patch
// table, as #1113's and #1115's suites drive the real scripts/proof.mjs. A throwaway SSH key stands for the maintainer.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carriedText, cleanEnv, clip, linesOf, README, remove, TABLE_ROWS, tempRoot } from './common.mjs';

const ISSUE = 9426;
const RAISED = '1 over: the draw path is one branch';
const text = (budget, prose = '') => carriedText(TABLE_ROWS.map((row) => (row.budget === RAISED ? { ...row, budget } : row)), { extra: prose });

function scratch() {
  const dir = tempRoot('guard');
  const cwd = join(dir, 'repo');
  mkdirSync(cwd);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path, content) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  git('init', '-q', '-b', 'main');
  write('scripts/proof-guard.mjs', '// the guard\n');
  write(README, text(RAISED));
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  const issues = join(dir, 'issues');
  mkdirSync(issues);
  writeFileSync(join(issues, `${ISSUE}.md`), 'Planted for #1426.\n\n### Acceptance criteria\n- [ ] Nothing real\n');
  const keys = join(dir, 'keys');
  mkdirSync(keys);
  for (const name of ['maintainer', 'stranger']) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `${name}@example.invalid`, '-f', join(keys, name)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const approvers = join(keys, 'approvers');
  writeFileSync(approvers, `maintainer@example.invalid namespaces="git" ${readFileSync(join(keys, 'maintainer.pub'), 'utf8').trim()}\n`);
  let tags = 0;
  return {
    dir,
    commit(path, content) {
      write(path, content);
      git('add', '-A');
      git('commit', '-qm', `Change the table\n\nPart of #${ISSUE}`);
      return git('rev-parse', 'HEAD').trim();
    },
    approve(commit, item, signer) {
      git('-c', 'gpg.format=ssh', '-c', `user.signingkey=${join(keys, signer)}`, 'tag', '-s', '-m', `Approves: ${item}`, `deep/approved/${tags += 1}`, commit);
    },
    guard(script) {
      const run = spawnSync(process.execPath, [script, 'guard'], { cwd, encoding: 'utf8', timeout: 120_000, env: cleanEnv({ HOME: dir, DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: approvers }) });
      return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
    },
  };
}

function scene(script, act, judge) {
  if (!existsSync(script)) return [`no guard at ${script}`];
  const repo = scratch();
  try {
    act(repo);
    return judge(repo.guard(script));
  } finally {
    remove(repo.dir);
  }
}
const refused = (run) => run.status !== 0 && linesOf(run.output, 'FAIL').some((line) => line.startsWith('FAIL guard:') && line.includes(README));
const allowed = (run) => run.status === 0 && !linesOf(run.output, 'FAIL').length;

/** An unsigned change to a row's number is refused, up or down, naming the table's file. */
export function judgeUnsigned(script) {
  return [
    ...scene(script, (repo) => repo.commit(README, text('2 over: the draw path is one branch')), (run) => (refused(run) ? [] : [`an unsigned raise of the number passes the guard (exit ${run.status}): ${clip(run.output)}`])),
    ...scene(script, (repo) => repo.commit(README, text('0 over: the draw path is one branch')), (run) => (refused(run) ? [] : [`an unsigned change of the number downward passes the guard (exit ${run.status}): ${clip(run.output)}`])),
  ];
}

/** A signature decides: the maintainer's own proposal passes, a stranger's doesn't, and prose beside the table is free. */
export function judgeSigned(script) {
  return [
    ...scene(script, (repo) => repo.approve(repo.commit(README, text('2 over: the draw path is one branch')), README, 'maintainer'), (run) => (allowed(run) ? [] : [`the number's change as a signed proposal is refused (exit ${run.status}): ${clip(run.output)}`])),
    ...scene(script, (repo) => repo.approve(repo.commit(README, text('2 over: the draw path is one branch')), README, 'stranger'), (run) => (refused(run) ? [] : [`a stranger's signature passes the guard (exit ${run.status}): ${clip(run.output)}`])),
    ...scene(script, (repo) => repo.commit(README, text(RAISED, '## Rebase trial\n\nPlanted prose outside the table.\n')), (run) => (allowed(run) ? [] : [`prose outside the table is refused (exit ${run.status}): ${clip(run.output)}`])),
  ];
}
