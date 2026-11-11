// Shared by the #1432 acceptance tests. The size ratchet is reached only through the lint lane's
// command for it, taken from `scripts/lanes.mjs`'s exported `checks` and run as a process with cwd
// at the checkout it checks (README: Surfaces).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checks } from '../../../scripts/lanes.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SCRIPT = 'scripts/size-ratchet.mjs';
export const CEILINGS = 'scripts/size-ceilings.json';
export const lint = checks.find(({ name }) => name === 'lint');

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** A lint command that runs `script` with node, as the lane lists it. */
export const runsScript = (command, script) => [process.execPath, 'node'].includes(command[0]) && command[1] === script;

/** The lint lane's command for the ratchet; the test fails here when the lane has none. */
export function ratchetCommand() {
  const command = lint?.commands.find((candidate) => runsScript(candidate, SCRIPT));
  // The node path is left out of the message, so no local path lands in the evidence.
  assert.ok(command, `the lint lane runs no ${SCRIPT}; its node commands are ${JSON.stringify(lint?.commands.filter((c) => c[0] === process.execPath).map((c) => c.slice(1).join(' ')))}`);
  return command;
}

/** Runs the lane's ratchet command with cwd at `cwd`, timed from spawn to exit. */
export function ratchet(cwd) {
  const [program, ...args] = ratchetCommand();
  const started = performance.now();
  const result = spawnSync(program === 'node' ? process.execPath : program, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const seconds = (performance.now() - started) / 1000;
  const stdout = result.stdout ?? '';
  return { ...result, stdout, seconds, lines: stdout.split('\n') };
}

export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr ?? ''}${result.error ? `\nerror: ${result.error.message}` : ''}`;

/** A whole number as the line may print it, with or without a thousands comma: 1601 or 1,601. */
export const number = (n) => new RegExp(`(?<![\\d,])${String(n).replace(/\B(?=(\d{3})+$)/g, ',?')}(?!,?\\d)`);

/** A pass: exit 0, a PASS line, and no line in another state (a silent exit 0 is not a pass). */
export function assertPasses(result) {
  assert.equal(result.status, 0, show(result));
  assert.ok(result.lines.some((line) => line.startsWith('PASS ')), `no PASS line\n${show(result)}`);
  assert.ok(!result.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line)), show(result));
}

/** A FAIL: exit 1 and one FAIL line naming the file, its size and its ceiling. */
export function assertFails(result, path, size, ceiling) {
  assert.equal(result.status, 1, show(result));
  const named = result.lines.find((line) => line.startsWith('FAIL ') && line.includes(path) && number(size).test(line) && number(ceiling).test(line));
  assert.ok(named, `no FAIL line naming ${path}, its size ${size} and its ceiling ${ceiling}\n${show(result)}`);
}
