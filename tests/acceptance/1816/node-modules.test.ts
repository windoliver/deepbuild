// #1816 AC4: `spine.mjs` copied node_modules with `cp -cR`, a macOS-only clone flag, so on Linux the checkout got no
// node_modules and every task read BLOCKED "the workspaces didn't build". Done when the checkout the spine judges in
// has the user's node_modules on this machine (Linux included), so the workspaces build and the task's tests run.
//
// The fixture: the user's repo's node_modules (ignored, untracked) holds the package `dh1816-marker`; the workspace
// packages/w builds with `require('dh1816-marker')`, as the real workspaces need typescript from node_modules; the task
// commit lands tests/acceptance/44/node-modules.test.mjs, which resolves `dh1816-marker` from its cwd, the checkout.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AC4, cleanup, commit, git, idOf, judge, makeFixture, must, pointSpine, shown, type Fixture, type Judging } from './helpers.ts';

const CRITERION = 'the checkout has the workspace\'s dependencies';
let fx: Fixture;
let T = '';
let j: Judging;

beforeAll(() => {
  const made = makeFixture({
    'package.json': '{"name":"fx","private":true,"workspaces":["packages/*"]}\n',
    'packages/w/package.json': '{"name":"w","version":"1.0.0","scripts":{"build":"node -e \\"require(\'dh1816-marker\')\\""}}\n',
  }, { 44: `### Acceptance criteria\n\n- [ ] ${CRITERION}\n` });
  fx = made.fx;
  T = commit(fx, {
    'tests/acceptance/44/node-modules.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
test('AC1 the checkout has node_modules with the user\\'s packages', () => {
  assert.equal(createRequire(join(process.cwd(), 'x.js'))('dh1816-marker'), 'dh1816-marker');
});
`,
  }, 'the task: Closes #44');
  git(fx.root, fx.tmp, 'push', '-q', 'origin', 'main');
  pointSpine(fx, 44, T);
  j = judge(fx, 44);
}, 900_000);
afterAll(cleanup);

describe(`${AC4} spine.mjs copies node_modules with cp -cR (macOS clone); on Linux the checkout gets no node_modules, and every task reads BLOCKED "the workspaces didn't build"`, () => {
  it(`${AC4} on ${process.platform}, the spine's checkout has the user's node_modules: the workspace that needs it builds, and the task reads PASS`, () => {
    const line = j.lines.find((l) => l.issue === 44);
    must(line !== undefined, `${AC4} the spine prints a judgment of #44: ${shown(j)}`);
    must(line.commit === T, `${AC4} #44 is judged at the fixture's commit T ${T}: ${line.commit}`);
    must(line.why === undefined && !line.criteria.some((c) => c.outcome === 'BLOCKED'), `${AC4} nothing reads BLOCKED: the workspaces build in the checkout with node_modules from the user's repo: ${JSON.stringify(line)}`);
    const c = line.criteria.find((x) => x.id === idOf(44, CRITERION));
    must(c?.outcome === 'PASS', `${AC4} the test that needs node_modules in the checkout reads PASS: ${JSON.stringify(line)}; ${shown(j)}`);
    must(line.verdict === 'PASS' && j.status === 0, `${AC4} #44 reads PASS: ${JSON.stringify(line)}`);
    must(!existsSync(join(fx.issues, 'reopened.log')), `${AC4} no issue is reopened: ${existsSync(join(fx.issues, 'reopened.log')) ? readFileSync(join(fx.issues, 'reopened.log'), 'utf8') : ''}`);
  });
});
