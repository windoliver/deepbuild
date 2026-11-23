// Criteria 1 and 2 of #3005: a hub whose home path runs through a symlink installs packages/jobs/import and
// packages/jobs/typeset with `deep install`, each printing it is installed and exiting 0.
import { beforeAll, describe, test } from 'vitest';
import { AC, IMPORT, TIMEOUT, TYPESET, expectInstalled, install, openWorld, type World } from './helpers.ts';

describe('a hub whose home runs through a symlink', () => {
  let w: World;
  beforeAll(async () => { w = await openWorld(true); }, TIMEOUT);

  test(`${AC[1]} deep install packages/jobs/import installs deepbuild/import@1.0.0 and exits 0`, async () => {
    expectInstalled(await install(w, IMPORT), 'packages/jobs/import', 'deepbuild/import@1.0.0');
  }, TIMEOUT);

  test(`${AC[2]} deep install packages/jobs/typeset installs deepbuild/typeset@1.0.0 and exits 0`, async () => {
    expectInstalled(await install(w, TYPESET), 'packages/jobs/typeset', 'deepbuild/typeset@1.0.0');
  }, TIMEOUT);
});
