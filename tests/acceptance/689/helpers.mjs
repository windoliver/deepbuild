// A copy of this checkout's preflight with every lane command replaced by a recorder. Each recorder
// appends one line to <box>/records.jsonl: the command it stands for and the RUSTUP_HOME and
// CARGO_HOME it was started with. No real cargo, rustc, npm, tsc or vitest runs.
//
//   <box>/bin/cargo, <box>/bin/npm          first on PATH, so the lanes and warm() reach them
//   <box>/repo/scripts/                     this checkout's scripts/, with the lanes' own node scripts
//                                           (repo-rules, canvas-lint, ...) replaced by recorders and
//                                           perf.mjs by a no-op; preflight, preflight.mjs, checks.mjs,
//                                           lanes.mjs and benchmark.mjs stay real
//   <box>/repo/node_modules/...             recorders at the paths the typecheck and unit lanes run
//   <box>/repo/tests/record.test.mjs        a recorder the unit lane's `node --test` runs
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

// Valid as both CommonJS and an ES module, since node_modules/typescript/bin/tsc has no extension.
const recorder = (log, name) => `const fs = process.getBuiltinModule('node:fs');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  command: [${JSON.stringify(name)}, ...process.argv.slice(2)].join(' '),
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? null,
  CARGO_HOME: process.env.CARGO_HOME ?? null,
}) + '\\n');
`;

const write = (path, content, mode) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
};

export function stubbedPreflight(t) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'deep-689-preflight-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const log = join(box, 'records.jsonl');
  const repo = join(box, 'repo');
  writeFileSync(log, '');
  cpSync(join(root, 'scripts'), join(repo, 'scripts'), { recursive: true });
  chmodSync(join(repo, 'scripts/preflight'), 0o755);
  for (const tool of ['cargo', 'npm']) {
    write(join(box, 'bin', `${tool}.mjs`), recorder(log, tool));
    write(join(box, 'bin', tool), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(box, 'bin', `${tool}.mjs`))} "$@"\n`, 0o755);
  }
  for (const script of ['repo-rules', 'canvas-lint', 'conformance-lint', 'catalogue-drift', 'corpus', 'parity'])
    write(join(repo, 'scripts', `${script}.mjs`), recorder(log, script));
  write(join(repo, 'scripts/perf.mjs'), '');
  write(join(repo, 'node_modules/typescript/bin/tsc'), recorder(log, 'tsc'));
  write(join(repo, 'node_modules/vitest/vitest.mjs'), recorder(log, 'vitest'));
  write(join(repo, 'tests/record.test.mjs'), recorder(log, 'node --test'));
  write(join(repo, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture.' }, tasks: [] }));
  write(join(repo, 'package.json'), '{ "private": true }');

  // Runs `scripts/preflight` as a caller would, with `homes` as the caller's RUSTUP_HOME and CARGO_HOME
  // (a value of undefined leaves that variable unset). Returns the records the lanes made: every record
  // from the typecheck lane's first command on, so warm()'s unmeasured builds before it are left out.
  return (homes) => {
    const env = { ...process.env, PATH: `${join(box, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, RUSTUP_AUTO_INSTALL: '0' };
    // A nested test runner that inherits this runner's context runs no files.
    for (const name of ['NODE_TEST_CONTEXT', 'RUSTUP_HOME', 'CARGO_HOME', 'CARGO_TARGET_DIR']) delete env[name];
    for (const [name, value] of Object.entries(homes)) if (value !== undefined) env[name] = value;
    const result = spawnSync(join(repo, 'scripts/preflight'), [], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? result.error.message : ''}`;
    const records = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const first = records.findIndex(({ command }) => command.startsWith('tsc'));
    return { status: result.status, output, lanes: first < 0 ? [] : records.slice(first) };
  };
}

// One command from each lane: typecheck, lint, unit (vitest, cargo test, node --test), catalogue
// drift, corpus and parity quick. Each must have run.
export const laneCommands = ['tsc', 'cargo fmt', 'cargo clippy', 'vitest', 'cargo test --workspace --locked', 'node --test', 'catalogue-drift', 'corpus', 'cargo build', 'parity'];
