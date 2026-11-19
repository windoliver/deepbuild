// Shared by #2538's acceptance tests: the repo's paths, the three codes the issue names, doctor.item@1's enum as the
// schema file on disk lists it, the lint's real run, and the repo's own tsc over the hub's project or a twin of it.
// runLint is copied from tests/acceptance/2146/helpers.ts, which this suite doesn't import.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
/** The codes the issue's table names: what `deep doctor` emits and doctor.item@1 must list. */
export const CODES = ['polkit_action_missing', 'hooks_modified', 'mod_overrides_guard'] as const;
export const SCHEMA_FILE = join(REPO, 'packages', 'contracts', 'schemas', 'doctor.item@1.json');
/** The lint takes about a minute on a loaded machine; a test that waits for it gets ten. */
export const LINT_TIMEOUT_MS = 600_000;
/** One type-check of the hub takes under a minute on a loaded machine; a test that waits for two gets ten. */
export const TSC_TIMEOUT_MS = 600_000;

/** The schema file as it is on disk: its `code` enum, read without the contracts package. */
export function listedCodes(): string[] {
  const schema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as { properties?: { code?: { enum?: unknown } } };
  const listed = schema.properties?.code?.enum;
  if (!Array.isArray(listed)) throw Error('doctor.item@1.json has no enum at /properties/code');
  return listed.map(String);
}

export interface Lint { status: number | null; signal: string | null; lines: string[]; stderr: string }
/** One real run of `node scripts/conformance-lint.mjs` in the checkout, over the built packages. */
export function runLint(): Lint {
  const ran = spawnSync(process.execPath, ['scripts/conformance-lint.mjs'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: LINT_TIMEOUT_MS - 30_000 });
  if (ran.error) throw ran.error;
  return { status: ran.status, signal: ran.signal, lines: ran.stdout.split('\n').filter(Boolean), stderr: ran.stderr };
}

export interface Tsc { status: number | null; signal: string | null; out: string }
/** The repo's own tsc over one project, writing nothing: `tsc -p <project> --noEmit`. */
export function typeCheck(project: string): Tsc {
  const ran = spawnSync(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project, '--noEmit', '--pretty', 'false'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TSC_TIMEOUT_MS / 2 - 30_000 });
  if (ran.error) throw ran.error;
  return { status: ran.status, signal: ran.signal, out: `${ran.stdout}${ran.stderr}` };
}

export interface Plant { file: string; listed: string; made: string }
/**
 * A twin of the hub's project in a temp folder laid out as the repo is: the root's and the hub's tsconfig.json and
 * package.json copied as they are, packages/hub/src copied whole, and node_modules a link to the
 * repo's, so every import resolves as it does in the hub's own build. In each plant's file every `'<listed>'` literal
 * becomes `'<made>'`; a file without the literal is a setup error, never a pass. The real source is only read.
 */
export function hubTwin(plants: readonly Plant[]): { project: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'deep-2538-twin-'));
  const hub = join(root, 'packages', 'hub');
  mkdirSync(hub, { recursive: true });
  // package.json too: the hub's says its files are ES modules, which tsc reads from the nearest one.
  for (const file of ['tsconfig.json', 'package.json']) {
    cpSync(join(REPO, file), join(root, file));
    cpSync(join(REPO, 'packages', 'hub', file), join(hub, file));
  }
  cpSync(join(REPO, 'packages', 'hub', 'src'), join(hub, 'src'), { recursive: true });
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const { file, listed, made } of plants) {
    const path = join(hub, 'src', file);
    const text = readFileSync(path, 'utf8');
    const literal = `'${listed}'`;
    if (!text.includes(literal)) throw Error(`packages/hub/src/${file} passes no ${literal} literal to plant on`);
    writeFileSync(path, text.replaceAll(literal, `'${made}'`));
  }
  return { project: join(hub, 'tsconfig.json'), root };
}
