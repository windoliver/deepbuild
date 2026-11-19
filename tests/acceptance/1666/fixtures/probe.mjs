// The one command a started session runs (README, The command): `node probe.mjs` in its worktree, a single plain
// command. It commits a new file in the worktree with git, then tries each write AC2 names: a tracked file in the
// repo's checkout, the checkout's .git/index and .git/HEAD, and the git folder of another worktree (a new file in it
// and its HEAD). It writes what happened to probe-report.json in the worktree, after the commit, so the report is
// never part of it. Paths come from probe-config.json, committed beside it.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(new URL('./probe-config.json', import.meta.url), 'utf8'));
const report = { pid: process.pid, cwd: process.cwd() };
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=dh1666', '-c', 'user.email=dh1666@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? r.error.message : null };
};

writeFileSync(config.file, 'committed by the started session\n');
report.add = git('add', '--', config.file);
report.commit = git('commit', '-q', '-m', config.subject);

const attempt = (target, write) => {
  try {
    write();
    return { target, ok: true };
  } catch (error) {
    return { target, ok: false, code: error.code ?? null, error: error.message };
  }
};
const other = (name) => join(config.otherGitDir, name);
report.writes = [
  attempt(config.checkoutFile, () => appendFileSync(config.checkoutFile, `${config.marker}\n`)),
  attempt(config.index, () => appendFileSync(config.index, config.marker)),
  attempt(config.head, () => writeFileSync(config.head, `ref: refs/heads/${config.marker}\n`)),
  attempt(other(config.marker), () => writeFileSync(other(config.marker), `${config.marker}\n`)),
  attempt(other('HEAD'), () => writeFileSync(other('HEAD'), `ref: refs/heads/${config.marker}\n`)),
];
console.log(`commit: ${report.add.code === 0 && report.commit.code === 0 ? 'made' : `failed: ${(report.add.stderr + report.commit.stderr).trim()}`}`);
for (const w of report.writes) console.log(`${w.ok ? 'wrote' : `refused (${w.code})`} ${w.target}`);
writeFileSync('probe-report.json', `${JSON.stringify(report, null, 2)}\n`);
