// #2583 AC1, its catalogue half: the event catalogue holds `brief.uncited`, from the schema brief.uncited@1 in
// packages/contracts/schemas/, as the contracts package's public entry builds the catalogue from the schemas. The
// lane half is lane.test.mjs.
import { expect, it } from 'vitest';
import { catalogue } from '../../../packages/contracts/src/index.ts';

it('#2583.8f145f1b AC1 the catalogue holds `brief.uncited`, from the schema brief.uncited@1', () => {
  const held = catalogue().filter((entry) => entry.kind === 'brief.uncited').map(({ kind, version, schema }) => ({ kind, version, schema }));
  expect(held, 'the catalogue entries of brief.uncited').toEqual([{ kind: 'brief.uncited', version: 1, schema: 'brief.uncited@1' }]);
});
