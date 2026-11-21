// #1872 manual e2e: real commits in a fresh GitHub clone of the PR branch, judged by that clone's real
// `node scripts/proof.mjs guard`. The merge base (a local origin/main, never pushed) adds a throwaway
// security key from tests/fixtures/approver.mjs to .deepbuild/approvers, so "a valid tag" can be made without
// the owner's key. Usage: node e2e.mjs <clone>
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const clone = process.argv[2];
const { people, tag } = await import(pathToFileURL(join(clone, 'tests/fixtures/approver.mjs')));
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const keys = people();
const today = new Date().toISOString().slice(0, 10);
const KNOWN = 'scripts/known-failures.json';
const say = (text) => console.log(text);

git('config', 'user.name', 'E2E');
git('config', 'user.email', 'e2e@example.invalid');
git('checkout', '-q', '-B', 'e2e-base');
appendFileSync(join(clone, '.deepbuild/approvers'), keys.maintainer.line);
git('commit', '-qam', 'e2e: a throwaway approver key at the merge base (local only)');
git('update-ref', 'refs/remotes/origin/main', 'HEAD');
const base = git('rev-parse', 'HEAD');
say(`clone HEAD under test: ${git('rev-parse', '--short=12', 'HEAD~1')} (PR branch), local merge base ${base.slice(0, 12)}`);

const edit = (path, change) => writeFileSync(join(clone, path), change(readFileSync(join(clone, path), 'utf8')));
const commit = (subject) => {
  git('add', '-A');
  git('commit', '-qm', `${subject}\n\nPart of #1872`);
  return git('rev-parse', 'HEAD');
};
const OWN = 'tests/e2e-1872/own.test.mjs';
const OWN_ID = `${OWN} › the change's own test`;
const scenarios = {
  'a: add the change\'s own failing test to failures': () => {
    mkdirSync(join(clone, dirname(OWN)), { recursive: true });
    writeFileSync(join(clone, OWN), "import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest(\"the change's own test\", () => { assert.equal(1, 2); });\n");
    commit('Add the change\'s own test');
    edit(KNOWN, (text) => { const json = JSON.parse(text); json.failures[OWN_ID] = `fails on main (#1872, added ${today})`; return `${JSON.stringify(json, null, 2)}\n`; });
    return { sha: commit('List its failure'), items: [`${KNOWN} › ${OWN_ID}`] };
  },
  'b: loosen main-watch.mjs': () => {
    edit('scripts/main-watch.mjs', (text) => `${text}process.exitCode = 0;\n`);
    return { sha: commit('Loosen main-watch.mjs'), items: ['scripts/main-watch.mjs'] };
  },
  'c: loosen known-failures-check.mjs': () => {
    edit('scripts/known-failures-check.mjs', (text) => text.replace('const DAYS = 14;', 'const DAYS = 3650;'));
    return { sha: commit('Loosen known-failures-check.mjs'), items: ['scripts/known-failures-check.mjs'] };
  },
};

let n = 0;
for (const [name, make] of Object.entries(scenarios)) for (const signed of [false, true]) {
  git('checkout', '-q', '-B', `e2e-${++n}`, base);
  const { sha, items } = make();
  if (signed) tag(clone, `deep/approved/e2e-${n}`, sha, items, keys.maintainer);
  say(`\n=== ${name}, ${signed ? `signed tag naming ${items.join(', ')}` : 'no tag'} (commit ${sha.slice(0, 12)})`);
  say(`$ git log --oneline origin/main..HEAD\n${git('log', '--oneline', 'origin/main..HEAD')}`);
  const run = spawnSync(process.execPath, ['scripts/proof.mjs', 'guard'], { cwd: clone, encoding: 'utf8', maxBuffer: 1 << 28 });
  say(`$ node scripts/proof.mjs guard\n${run.stdout.split('\n').filter((line) => /^(PASS|FAIL|INCONCLUSIVE|BLOCKED|INVALID)\b/.test(line)).join('\n')}\nexit ${run.status}`);
}
git('checkout', '-q', 'e2e-base');
