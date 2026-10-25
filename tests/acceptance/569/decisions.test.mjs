// #569 acceptance: the guard covers your decisions (criterion 11): the four invariants in AGENTS.md
// and the rows under Decisions in docs/technical-design.md, through `node scripts/proof.mjs guard`.
import test from 'node:test';
import { AGENTS, DESIGN, ISSUE, assertFails, assertPasses, line, lineNumber, proof, repo } from './helpers.mjs';

const INVARIANT = "3. Agents can't change checks or decisions.";
const REWORDED = "3. Agents can't change checks or decisions without a reason.";
const CELL = '| Your rules reserve every commit |';
const EDITED = '| Never |';
const invariantLine = lineNumber(AGENTS, INVARIANT);
const rowLine = lineNumber(DESIGN, 'Work-in-progress commits');

const BASE_FILES = { 'AGENTS.md': AGENTS, 'docs/technical-design.md': DESIGN, 'src/cart.mjs': 'export const add = (a, b) => a + b;\n' };
const code = { files: { 'src/cart.mjs': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n' }, message: `Add sub\n\nCloses #${ISSUE}` };
const reworded = { 'AGENTS.md': AGENTS.replace(INVARIANT, REWORDED) };
const edited = { 'docs/technical-design.md': DESIGN.replace(CELL, EDITED) };
const scene = (t, commits) => repo(t, { base: BASE_FILES, issues: { [ISSUE]: ['The sum of two numbers is their total'] }, commits });

test('#569.ec1582c6 rewording invariant 3 in AGENTS.md fails the guard, naming the file and the line', (t) => {
  const result = proof(scene(t, [code, { files: reworded, message: 'Reword invariant 3' }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', `AGENTS.md:${invariantLine}`);
});

test('#569.ec1582c6 editing the Reopens if cell of the Decided row "Work-in-progress commits" fails the guard, naming the file and the line', (t) => {
  const result = proof(scene(t, [code, { files: edited, message: 'Narrow when WIP commits reopen' }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', `docs/technical-design.md:${rowLine}`);
});

test('#569.ec1582c6 the same two edits, each sent as its own proposal and approved by you, pass the guard', (t) => {
  const result = proof(scene(t, [
    code,
    { files: reworded, message: 'Propose rewording invariant 3', approve: { items: ['AGENTS.md'] } },
    { files: edited, message: 'Propose narrowing when WIP commits reopen', approve: { items: ['docs/technical-design.md'] } },
  ]), ['guard']);
  assertPasses(result, 'guard');
});

test('#569.ec1582c6 an approval that names only AGENTS.md lets the Decisions edit in the same proposal fail, naming its file and line', (t) => {
  const result = proof(scene(t, [code, { files: { ...reworded, ...edited }, message: 'Propose both', approve: { items: ['AGENTS.md'] } }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', `docs/technical-design.md:${rowLine}`);
});

test('#569.ec1582c6 a change elsewhere in AGENTS.md and the design, outside the invariants and the Decisions rows, passes the guard', (t) => {
  const result = proof(scene(t, [code, {
    files: {
      'AGENTS.md': AGENTS.replace('Keep this file under one page.', 'Keep this file under one page, and short.').replace('- Every behavior fix starts with a test failing for the expected reason.', '- Every behavior fix starts with a test that fails for the expected reason.'),
      'docs/technical-design.md': DESIGN.replace('A claim is an agent\'s statement that work is done.', 'A claim is what an agent says is done.').replace('before its platform ships.', 'before its platform ships, on every backend.'),
    },
    message: 'Tidy wording',
  }]), ['guard']);
  assertPasses(result, 'guard');
});
