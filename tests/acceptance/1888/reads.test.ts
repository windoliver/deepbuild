// #1888 AC1, AC2: what the gate reads for a command's script, through `@deepbuild/gate`'s public entry on real
// checkouts in temp folders. AC1: a claim citing `make lint`, where the Makefile's rule `test lint:` runs
// `eslint . || true`, is sent back by the floor with the masked exit named, in the words the merge base
// has for the one-target rule. AC2: a rule
// with one target, a package script and a justfile recipe each read as the merge base read them (the values below
// were recorded there), by the floor, and a Makefile rule's target by `checkSource`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { checkSource, floor, lockDefinition, validityGate } from '../../../packages/gate/src/index.ts';
import type { ApprovedCheck, DefinitionParts, Finding, FloorResult } from '../../../packages/gate/src/index.ts';
import { commitFiles, makeRepo } from '../29/helpers.ts';

const AC1 = '#1888.2a9bc364';
const AC2 = '#1888.d330ac62';

const made: string[] = [];
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** A checkout in a temp folder holding `files`. */
function checkoutOf(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1888-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const CLAIM = 'claim:1888';
const DEFINITION: DefinitionParts = { task_ref: 'task:1888', requirements: [], deliverables: [], files: {} };
/** The claim whose final message cites one run of `command`, which the session made and which exited 0. */
const citing = (command: string, files: Record<string, string>) => {
  const claim = { claim: CLAIM, message: `Lint is clean: \`${command}\` exited 0.` };
  const checkout = checkoutOf(files);
  const session = { read: [], ran: [{ command, exit_status: 0, output: '' }] };
  return { claim, checkout, session };
};
/** What the floor reads for that claim, and what the validity gate finds. */
function read(command: string, files: Record<string, string>): { floor: FloorResult; findings: Finding[] } {
  const c = citing(command, files);
  return {
    floor: floor({ ...c, definition: DEFINITION, locked: lockDefinition(DEFINITION) }),
    findings: validityGate({ ...c, deliverables: [] }),
  };
}
/** The floor's reading of a cited run whose exit status `|| true` masked: sent back, the mask named. Recorded at the merge base. */
const masked = (command: string): { floor: FloorResult; findings: Finding[] } => {
  const findings: Finding[] = [{ kind: 'masked_exit', ref: command, mask: '|| true', why: `the run \`${command}\` it cites proves nothing: exit status masked by \`|| true\`` }];
  return { floor: { ok: false, action: 'send_back', findings, claim: CLAIM }, findings };
};
const CLEAN: { floor: FloorResult; findings: Finding[] } = { floor: { ok: true }, findings: [] };
const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: 'shop', scripts }, null, 2);

it(`${AC1} with a Makefile whose rule \`test lint:\` runs \`eslint . || true\`, a claim that cites \`make lint\` reads exit_masked`, () => {
  const TWO = 'test lint:\n\teslint . || true\n';
  // The issue's case: the floor sends the claim back, and the finding names the run and its mask.
  expect.soft(read('make lint', { Makefile: TWO }), '`make lint` runs the rule `test lint:`, whose recipe masks its exit with `|| true`').toEqual(masked('make lint'));
  // The rule's other target runs the same recipe.
  expect.soft(read('make test', { Makefile: TWO }), '`make test` runs the same rule').toEqual(masked('make test'));
  // The clean twin: the same rule with no mask sends nothing back, so the reading is the recipe's, not the rule's shape.
  expect.soft(read('make lint', { Makefile: 'test lint:\n\teslint .\n' }), 'the same rule with no mask in its recipe').toEqual(CLEAN);
});

it(`${AC2} a rule with one target, a package script and a justfile recipe each read as on the merge base (the floor)`, () => {
  const cases: [string, string, Record<string, string>, { floor: FloorResult; findings: Finding[] }][] = [
    ['a one-target Makefile rule, masked', 'make lint', { Makefile: 'test:\n\tvitest run\n\nlint:\n\teslint . || true\n' }, masked('make lint')],
    ['a one-target Makefile rule, clean', 'make lint', { Makefile: 'test:\n\tvitest run\n\nlint:\n\teslint .\n' }, CLEAN],
    ['a one-target Makefile rule, clean, beside a masked rule of two other targets', 'make lint', { Makefile: 'test lint-all:\n\teslint . --fix || true\n\nlint:\n\teslint .\n' }, CLEAN],
    ['a package script, masked', 'npm run lint', { 'package.json': pkg({ test: 'vitest run', lint: 'eslint . || true' }) }, masked('npm run lint')],
    ['a package script, clean', 'npm run lint', { 'package.json': pkg({ test: 'vitest run || true', lint: 'eslint .' }) }, CLEAN],
    ['a package script run as `npm test`, masked', 'npm test', { 'package.json': pkg({ test: 'vitest run || true', lint: 'eslint .' }) }, masked('npm test')],
    ['a justfile recipe, masked', 'just lint', { justfile: 'test:\n  vitest run\n\nlint:\n  eslint . || true\n' }, masked('just lint')],
    ['a justfile recipe, clean', 'just lint', { justfile: 'test:\n  vitest run || true\n\nlint:\n  eslint .\n' }, CLEAN],
  ];
  for (const [what, command, files, expected] of cases) expect.soft(read(command, files), what).toEqual(expected);
});

it(`${AC2} a Makefile rule's target reads as on the merge base (checkSource, the one reader's other caller): a rule of two targets and a rule of one`, () => {
  const BASE = { Makefile: 'test lint:\n\teslint .\n\nbuild:\n\ttsc -b\n', 'src/cart.ts': 'export const total = 1;\n' };
  const LINT: ApprovedCheck = { check: 'make lint', reads: [], declares: { script: { file: 'Makefile', target: 'lint' } } };
  const BUILD: ApprovedCheck = { check: 'make build', reads: [], declares: { script: { file: 'Makefile', target: 'build' } } };
  const source = (check: ApprovedCheck, makefile: string): 'approved' | 'own' => {
    const { dir, commit } = makeRepo(BASE);
    made.push(dirname(dir));
    const to = commitFiles(dir, { Makefile: makefile }, 'change');
    return checkSource(check, { repo: dir, from: commit, to });
  };
  const RECIPE = 'test lint:\n\teslint . || true\n\nbuild:\n\ttsc -b\n';
  const OTHER = 'test lint:\n\teslint .\n\nbuild:\n\ttsc -b --force\n';
  expect.soft(source(LINT, RECIPE), 'the rule `test lint:` changed, and the check runs its target lint').toBe('own');
  expect.soft(source(LINT, OTHER), 'only the rule `build:` changed, and the check runs lint').toBe('approved');
  expect.soft(source(BUILD, OTHER), 'the one-target rule `build:` changed, and the check runs it').toBe('own');
  expect.soft(source(BUILD, RECIPE), 'only the rule `test lint:` changed, and the check runs build').toBe('approved');
});
