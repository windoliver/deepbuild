// What deep-hook's deep-actions server lists (#824): the two action tools, the codes' pages and its instructions (#2897), written from the built
// hub to crates/deep-hook/src/actions.json, which deep-hook compiles in. Run after `npm run build -w @deepbuild/hub`;
// packages/hub/test/actions-server.test.ts fails while the file holds anything else.
import { writeFileSync } from 'node:fs';
import { CODES } from '../packages/hub/dist/codes.js';
import { actionToolList, instructionsFor } from '../packages/hub/dist/tools.js';

writeFileSync(new URL('../crates/deep-hook/src/actions.json', import.meta.url), `${JSON.stringify({ tools: actionToolList(), codes: CODES, instructions: instructionsFor('deep-actions') }, null, 1)}\n`);
