import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, LINT, LINT_NAME, commit, makeCopy, plantFile, run, shown } from './helpers.mjs';

const ID = '#1688.e0a10d9d';
const PACKAGE_SRC = 'packages/readings/src';
const UNREAD = 'zorvanthicUnreadHelper';
const UNTRACKED = 'zorvanthicUntrackedHelper';
const READ = 'zorvanthicReadHelper';
const UNTRACKED_FILE = `${PACKAGE_SRC}/zorvanthic-plant.ts`;
const READER_FILE = `${PACKAGE_SRC}/zorvanthic-reader.ts`;
const word = (name) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
const finding = (r, file, name) => r.lines.some((l) => l.startsWith(`FAIL ${LINT_NAME}`) && l.includes(file) && word(name).test(l));

test(`${ID} AC1: the lint fails on a planted exported function with no reader, naming it, and leaves a read one unnamed`, { timeout: 1_800_000 }, async (t) => {
  assert.ok(existsSync(join(CHECKOUT, LINT)), `${LINT}, the lint of exports with no reader outside their file, does not exist`);
  const { sandbox, repo } = makeCopy(t);
  const host = readdirSync(join(repo, PACKAGE_SRC)).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== 'index.ts').sort()[0];
  assert.ok(host, `${PACKAGE_SRC} holds no source file to plant in`);
  const hostFile = `${PACKAGE_SRC}/${host}`;
  const text = readFileSync(join(repo, hostFile), 'utf8');
  plantFile(repo, hostFile, `${text}${text.endsWith('\n') ? '' : '\n'}\nexport function ${UNREAD}(): string {\n  return 'planted, read by nothing';\n}\n\nexport function ${READ}(): string {\n  return 'planted, read by another file';\n}\n`);
  plantFile(repo, READER_FILE, `import { ${READ} } from './${host.replace(/\.ts$/, '.js')}';\n\nconsole.log(${READ}());\n`);
  commit(repo, 'change: planted exports in a package source file');
  plantFile(repo, UNTRACKED_FILE, `export function ${UNTRACKED}(): string {\n  return 'planted, untracked, read by nothing';\n}\n`);
  const r = await run(repo, sandbox, [LINT]);
  t.diagnostic(shown(r, 10));
  assert.equal(r.status, 1, `the lint does not exit 1 with ${UNREAD} planted in ${hostFile}\n${shown(r)}`);
  assert.ok(finding(r, hostFile, UNREAD), `no FAIL ${LINT_NAME} line names ${hostFile} and ${UNREAD}, a committed export with no reader\n${shown(r)}`);
  assert.ok(finding(r, UNTRACKED_FILE, UNTRACKED), `no FAIL ${LINT_NAME} line names ${UNTRACKED_FILE} and ${UNTRACKED}, an untracked file's export with no reader\n${shown(r)}`);
  assert.deepEqual(r.lines.filter((l) => word(READ).test(l)), [], `the lint names ${READ}, which ${READER_FILE} reads`);
});
