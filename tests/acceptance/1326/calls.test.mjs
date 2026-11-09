import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, repository, defaults, checked, call, entry, withHub, add } from './fixtures.mjs';
import { hardware } from './authenticator.mjs';

test('#1326.7ee1e41b AC5 default signing and tag-push guards hold their plants, allow the signed-commit twin, and refuse an overbroad install', async (t) => {
  const w = repository(world(t), hardware('listed').line), shipped = defaults();
  const signing = call(w, 'git tag -s deep/approved/fixture -m "Approves: tests/receipt.test.mjs"');
  const push = call(w, 'git push origin refs/tags/deep/approved/fixture');
  const twin = call(w, 'git commit -S -m "work on my branch"');
  // The repo's session/1326 branch has no rule forbidding signed commits. Commands are data, not executed.
  const blocks = Object.entries(shipped.entries).filter(([, rule]) => rule.mode === 'block');
  const observed = blocks.map(([name, rule]) => ({ name, rule, sign: rule.fail_closed && checked(w, rule, signing),
    push: rule.fail_closed && checked(w, rule, push), twin: checked(w, rule, twin) }));
  t.diagnostic(`default signing holds: ${observed.filter((r) => r.sign).map((r) => r.name).join(', ') || '(none)'}; tag-push holds: ${observed.filter((r) => r.push).map((r) => r.name).join(', ') || '(none)'}`);

  // A concrete planted bad guard: broadens git tag -s to all git, so its signed-commit twin is held.
  // It must fail precisely at install, not at schema parsing or at an OS prompt.
  const badName = 'fixture-1326-holds-signed-commit', goodName = 'fixture-1326-signing-only';
  const bad = entry('run:git'), good = entry('run:git tag -s');
  assert.equal(checked(w, bad, signing), true, 'bad entry must hold its planted signing call');
  assert.equal(checked(w, bad, twin), true, 'bad entry must actually hold the signed-commit twin');
  await withHub(w, () => {
    const refused = add(w, badName, bad, signing, twin);
    t.diagnostic(`overbroad install: exit ${refused.status}\n${refused.out}`);
    assert.equal(refused.status, 1, `held twin must refuse install: ${refused.out}`);
    assert.ok(refused.out.includes(badName) && refused.out.includes('twin'), `refusal must name the entry and its twin: ${refused.out}`);
    const rules = join(w.home, '.deepbuild/rules.json');
    const before = existsSync(rules) ? JSON.parse(readFileSync(rules, 'utf8')).entries : {};
    assert.ok(!before[badName], 'refused entry must not reach rules.json');
    const installed = add(w, goodName, good, signing, twin);
    assert.equal(installed.status, 0, `precise entry must install: ${installed.out}`);
    assert.ok(installed.out.includes(goodName), 'install must name its entry');
    const after = JSON.parse(readFileSync(rules, 'utf8')).entries;
    assert.deepEqual(after[goodName], good, 'install persists the actual checked entry');
    assert.ok(!after[badName], 'a later install cannot resurrect the refused entry');
  });

  assert.deepEqual({ signingHeld: observed.some((r) => r.sign), pushHeld: observed.some((r) => r.push),
    twinHeldBy: observed.filter((r) => r.twin).map((r) => r.name) },
  { signingHeld: true, pushHeld: true, twinHeldBy: [] },
  'shipped guard@1 must hold approval signing and tag pushes even hub-away, but allow the own-branch signed commit');
  for (const { name, rule } of observed.filter((r) => r.sign || r.push)) {
    const raw = shipped.proofs?.[name], pairs = Array.isArray(raw) ? raw : [raw];
    assert.ok(pairs.length && pairs.every((p) => p?.planted && p?.twin), `${name} must ship a planted call and twin`);
    for (const pair of pairs) {
      const resolve = (c) => JSON.parse(JSON.stringify({ ...c, cwd: c.cwd ?? w.repo })
        .replaceAll('{home}', w.home).replaceAll('{repo}', w.repo).replaceAll('{work}', w.repo));
      assert.equal(checked(w, rule, resolve(pair.planted)), true, `${name}: shipped planted call must be held`);
      assert.equal(checked(w, rule, resolve(pair.twin)), false, `${name}: shipped twin must go through`);
    }
  }
});
