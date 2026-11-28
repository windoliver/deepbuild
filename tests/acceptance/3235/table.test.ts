import { execFileSync } from 'node:child_process';
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { AC8, HERE, REPO, cardOf, checkoutAt, expectNotQuoted, expectStopped, gitRepo, proposeSkill, script, skillTree, start, stop, world, type Checkout } from './helpers.ts';

const KNOWN = 'GIT_SSL_NO_VERIFY';
const ADDED = 'DEEP_AC3235_CHECKS_OFF';
const LINE = `${ADDED}=1 npm test`;
const LEFT_OUT = new Set(['.git', 'node_modules', 'target', 'tests', 'docs', 'reports', 'spikes', 'benchmarks', 'brand', 'vendor', '.deepbuild', '.claude']);
const NOT_SOURCE = new Set(['node_modules', 'dist', 'test', 'tests', 'fixtures', '__tests__']);
const copies: string[] = [];

afterAll(() => { for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return NOT_SOURCE.has(e.name) ? [] : sourceFiles(path);
    return e.isFile() && /\.(ts|mts|js|mjs|json)$/.test(e.name) && !/\.test\./.test(e.name) ? [path] : [];
  });
}

function filesHolding(root: string, token: string): string[] {
  return ['packages', 'adapters', 'contracts'].flatMap((d) => (existsSync(join(root, d)) ? sourceFiles(join(root, d)) : []))
    .filter((f) => readFileSync(f, 'utf8').includes(token)).map((f) => relative(root, f)).sort();
}

function copyCheckout(): string {
  const copy = realpathSync(mkdtempSync('/tmp/ac3235-table-'));
  copies.push(copy);
  for (const name of readdirSync(REPO)) {
    if (LEFT_OUT.has(name)) continue;
    cpSync(join(REPO, name), join(copy, name), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
  }
  symlinkSync(join(REPO, 'target'), join(copy, 'target'));
  mkdirSync(join(copy, 'node_modules'));
  for (const name of readdirSync(join(REPO, 'node_modules'))) {
    if (name !== '@deepbuild') { symlinkSync(join(REPO, 'node_modules', name), join(copy, 'node_modules', name)); continue; }
    mkdirSync(join(copy, 'node_modules', name));
    for (const pkg of readdirSync(join(REPO, 'node_modules', name))) {
      const link = join(REPO, 'node_modules', name, pkg);
      const real = resolve(dirname(link), readlinkSync(link));
      const inside = relative(REPO, real);
      symlinkSync(inside.startsWith('..') || isAbsolute(inside) ? real : join(copy, inside), join(copy, 'node_modules', name, pkg));
    }
  }
  return copy;
}

function plantRow(file: string): void {
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.includes(KNOWN));
  const row = lines[at]!.split(KNOWN).join(ADDED);
  lines.splice(at, 0, /,\s*$/.test(row) ? row : `${row},`);
  writeFileSync(file, lines.join('\n'));
}

function buildPackageHolding(copy: string, file: string): void {
  const pkg = /^packages\/([^/]+)\//.exec(file)?.[1];
  if (!pkg || !existsSync(join(copy, 'packages', pkg, 'package.json'))) return;
  execFileSync('npm', ['run', 'build', '--if-present'], { cwd: join(copy, 'packages', pkg), stdio: 'pipe', env: { ...process.env, PATH: `${join(copy, 'node_modules/.bin')}:${process.env.PATH ?? ''}` }, timeout: 600_000 });
}

function learnedState(checkout: Checkout): { state: string | null; reason: string | null } {
  const out = execFileSync(process.execPath, [join(REPO, 'tests/acceptance/3235/fixtures/learned-state.mjs'), checkout.root, LINE], { cwd: checkout.root, encoding: 'utf8', timeout: 120_000 });
  return JSON.parse(out.trim().split('\n').at(-1)!) as { state: string | null; reason: string | null };
}

async function auditCard(checkout: Checkout): Promise<string> {
  const w = world();
  await start(w, checkout);
  const r = gitRepo(w, 'source', skillTree({ 'run.sh': script(LINE, 'echo done') }));
  const card = await cardOf(w, await proposeSkill(w, r.dir, r.commit));
  await stop(w);
  return card;
}

it(`AC8 ${AC8} a flag added to the one table is refused by the audit and held by the learned layer's loosening read, with no other change`, async () => {
  const holding = filesHolding(REPO, KNOWN);
  expect(holding.length, `AC8 the flags the learned layer holds as switching verification off live in one table: ${KNOWN} is in ${holding.join(', ') || 'no file'}`).toBeGreaterThan(0);
  expect.soft(holding, `AC8 one table, not a second list: ${KNOWN} is in ${holding.join(', ')}`).toHaveLength(1);

  const unplantedLearned = learnedState(HERE);
  expect(unplantedLearned.state, `AC8 the control: without the added flag, the learned layer applies a step that runs ${LINE} (${unplantedLearned.reason ?? ''})`).toBe('applied');
  expectNotQuoted(await auditCard(HERE), { file: 'run.sh', line: 3, text: LINE }, 'AC8 the control: without the added flag, the audit');

  const copy = copyCheckout();
  const table = holding[0]!;
  plantRow(join(copy, table));
  expect(readFileSync(join(copy, table), 'utf8'), `AC8 the flag ${ADDED} is added to ${table} as one more row`).toContain(ADDED);
  buildPackageHolding(copy, table);
  const planted = checkoutAt(copy);
  expect(statSync(planted.cli).isFile(), 'AC8 the copy with the added row has the deep CLI').toBe(true);

  const learned = learnedState(planted);
  expect.soft(learned.state, `AC8 the learned layer's loosening read holds a step that adds ${LINE} once ${ADDED} is in ${table} (${learned.reason ?? 'no reason'})`).toBe('held');
  expectStopped(await auditCard(planted), { file: 'run.sh', line: 3, text: LINE }, `AC8 the audit, once ${ADDED} is in ${table},`);
});
