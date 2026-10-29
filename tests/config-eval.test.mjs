import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Configuration evals (#112): the gate the local preflight runs for a change to an instruction file, a skill or the
// agents' settings, and the plan it builds from your transcript archive.
const script = fileURLToPath(new URL('../scripts/config-eval.mjs', import.meta.url));
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const HOUR = 3_600_000;

/** A repo whose origin/main holds AGENTS.md and CLAUDE.md, and a home of its own for ~/.deepbuild. */
function world(t) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'deep-config-eval-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const repo = join(box, 'shop');
  const home = join(box, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@shop.test', ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_DATE: new Date(T0).toISOString(), GIT_AUTHOR_DATE: new Date(T0).toISOString() },
  }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'AGENTS.md'), '# Shop\nRun the tests first.\n');
  writeFileSync(join(repo, 'CLAUDE.md'), '@AGENTS.md\n');
  writeFileSync(join(repo, 'cart.js'), 'export const total = () => 0;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: home } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { box, repo, home, git, run };
}
const keptAt = (out) => /\((\/[^)]+\.json)\)/.exec(out)?.[1];
const report = (outcome, broke = []) => ({ after: { outcome, reason: `the rule read ${outcome}`, n: 20, broke }, before: { outcome: 'INCONCLUSIVE' }, held: outcome === 'regresses', runs: [] });

test('the gate passes a change that touches no configuration, and blocks one until a replay of it as it is now passes', (t) => {
  // Failed on a gate that passed a changed instruction file with no replay, one that passed a held replay, and one
  // that kept a replay of an earlier edit of the same file.
  const w = world(t);
  writeFileSync(join(w.repo, 'cart.js'), 'export const total = (xs) => xs.length;\n');
  let r = w.run('gate');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^PASS config eval: the change touches no instruction file/m);

  writeFileSync(join(w.repo, 'AGENTS.md'), '# Shop\nRun the tests first, then lint.\n');
  r = w.run('gate');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^BLOCKED config eval: no replay of AGENTS\.md as they are now/m);
  const kept = keptAt(r.out);
  assert.ok(kept?.startsWith(join(w.home, '.deepbuild', 'evals')), r.out);

  mkdirSync(join(kept, '..'), { recursive: true });
  writeFileSync(kept, JSON.stringify(report('regresses', ['session:S3#m1', 'session:S9#m1'])));
  r = w.run('gate');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^FAIL config eval: held, it broke session:S3#m1, session:S9#m1/m);

  writeFileSync(kept, JSON.stringify(report('INCONCLUSIVE')));
  r = w.run('gate');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^PASS config eval: INCONCLUSIVE on 20 replayed tasks/m);

  writeFileSync(join(w.repo, 'AGENTS.md'), '# Shop\nRun the tests first, then lint, then push.\n');
  r = w.run('gate');
  assert.equal(r.status, 1, r.out);
  assert.notEqual(keptAt(r.out), kept, 'an edit after the replay needs a replay of its own');

  unlinkSync(join(w.repo, 'CLAUDE.md'));
  r = w.run('gate');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^BLOCKED config eval: CLAUDE\.md is deleted/m);
});

test("plan freezes the change's files against the merge base and the repo's newest archived tasks after the cutoff", async (t) => {
  // Failed on a plan that took tasks of every repo, one that let a task before the cutoff decide, and one that kept a
  // task whose words name an eval.
  const w = world(t);
  const { openEvidenceStore } = await import('@deepbuild/evidence');
  const { openRecord } = await import('@deepbuild/record');
  const root = join(w.home, '.deepbuild');
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => T0, evidence: store });
  const other = join(w.box, 'blog');
  mkdirSync(other);
  execFileSync('git', ['init', '-q'], { cwd: other });
  execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@blog.test', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: other, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_COMMITTER_DATE: new Date(T0).toISOString() } });
  let n = 0;
  const archive = async (cwd, h, text) => {
    const id = `01K74FX2B4D6F8H0K2M4P6R${String(n++).padStart(3, '0')}`;
    const line = { type: 'user', uuid: 'm1', timestamp: new Date(T0 + h * HOUR).toISOString(), cwd, gitBranch: 'main', message: { role: 'user', content: text } };
    const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new Uint8Array(Buffer.from(JSON.stringify(line))), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
    await record.append({ writer: 'app', actor: 'you', scope: 'you' }, { v: 1, id: `01K74FX2B4D6F8H0K2M4P7R${String(n).padStart(3, '0')}`, kind: 'transcript.archived', ts: T0, data: { session: `session:${id}`, evidence: put.evidence.sha256 } });
    return `session:${id}#m1`;
  };
  const before = [await archive(w.repo, 1, 'Fix the cart badge.'), await archive(w.repo, 2, 'Add a coupon field.')];
  const after = [];
  for (let h = 11; h <= 14; h++) after.push(await archive(w.repo, h, `Make the total handle case ${h}.`));
  await archive(w.repo, 15, 'Write an eval for the cart.');
  await archive(other, 16, 'Fix the blog footer.');
  await record.close();

  writeFileSync(join(w.repo, 'AGENTS.md'), '# Shop\nRun the tests first, then lint.\n');
  const out = join(w.box, 'input.json');
  const r = w.run('plan', '--cutoff', new Date(T0 + 10 * HOUR).toISOString(), '--tasks', '3', '--fitted', '1', '--out', out);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /left out session:\S+: its words would tell its agent it is in an eval/);
  const input = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(input.plan.tasks, [after[3], after[2], after[1]]);
  assert.deepEqual(input.plan.fitted, [before[1]]);
  assert.deepEqual(input.tasks.map((x) => x.id).sort(), [...input.plan.tasks, ...input.plan.fitted].sort());
  assert.deepEqual(input.plan.variants.base.files, { 'AGENTS.md': '# Shop\nRun the tests first.\n' });
  assert.deepEqual(input.plan.variants.change.files, { 'AGENTS.md': '# Shop\nRun the tests first, then lint.\n' });
  assert.equal(input.plan.cutoff, T0 + 10 * HOUR);

  const short = w.run('plan', '--cutoff', new Date(T0 + 10 * HOUR).toISOString(), '--tasks', '5', '--out', out);
  assert.equal(short.status, 1, short.out);
  assert.match(short.out, /^BLOCKED config eval: the archive holds 4 tasks of this repo from after/m);
});
