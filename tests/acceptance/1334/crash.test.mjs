// #1334 AC1 on the rollback scene with a planted build that crashes at start (README: The scenes), and the Scope line
// on where the hub runs from, read from the same scene's first promotion.
import { after, before, test } from 'node:test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { LONG, assert, rolledBack, rollbackScene, serviceCalls, sha7, shown } from './helpers.mjs';

let scene;
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
before(async () => { scene = await rollbackScene({ after: (cleanup) => cleanups.push(cleanup) }, 'crash'); }, LONG);

test('#1334.775c65d4 a planted build that crashes at start is rolled back within 60 s, with no attempt lost and one notice naming the commit', LONG, (t) => {
  t.diagnostic(rolledBack(scene, '#1334.775c65d4', 'a build that crashes at start must be rolled back by itself, with no one asked'));
});

test('the hub runs from a promoted build in a versioned folder: its login service names ~/.deepbuild/versions/current, never a checkout or a temporary path', LONG, () => {
  const { box, fx, first, firstProgram } = scene;
  assert.equal(first.status, 0, `the first promotion, of a build of ${sha7(fx.c1)} that main watch passed, failed: ${shown(first)}`);
  const versions = realpathSync(join(box.root, 'versions'));
  assert.equal(firstProgram, join(box.root, 'versions', 'current', 'bin', 'deep'), `the login service must run the versions folder's current link, ~/.deepbuild/versions/current/bin/deep, which every promotion switches; it names ${firstProgram}`);
  assert.ok(realpathSync(firstProgram).startsWith(`${versions}/`), `the service's program must resolve into a build's folder under ${versions}`);
  assert.deepEqual(serviceCalls(box), [], 'nothing may call launchctl or systemctl where DEEP_HUB_LAUNCHER names the service manager');
});
