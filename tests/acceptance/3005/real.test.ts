// Criterion 3 of #3005: a hub whose home is spelled by its real path still installs packages/jobs/import and
// packages/jobs/typeset with `deep install`, each printing it is installed and exiting 0.
import { beforeAll, describe, test } from 'vitest';
import { AC, IMPORT, TIMEOUT, TYPESET, expectInstalled, install, openWorld, type World } from './helpers.ts';

describe('a hub whose home is spelled by its real path', () => {
  let w: World;
  beforeAll(async () => { w = await openWorld(false); }, TIMEOUT);

  test(`${AC[3]} deep install packages/jobs/import installs deepbuild/import@1.0.0 and exits 0`, async () => {
    expectInstalled(await install(w, IMPORT), 'packages/jobs/import', 'deepbuild/import@1.0.0');
  }, TIMEOUT);

  test(`${AC[3]} deep install packages/jobs/typeset installs deepbuild/typeset@1.0.0 and exits 0`, async () => {
    expectInstalled(await install(w, TYPESET), 'packages/jobs/typeset', 'deepbuild/typeset@1.0.0');
  }, TIMEOUT);
});
