// Shared by #3171's acceptance tests (README.md beside this file). They reach the work only through the surfaces the
// issue names: `deep-gpu`'s test `a_span_holds_its_submission_and_not_the_gap_after_it`, run by `cargo test`, read as
// the lanes read cargo's output (`cargoResults`, scripts/lanes.mjs), alone and beside a second process that keeps the
// GPU busy (load.rs, the example `acceptance_3171_load`). Nothing here imports the code under test.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoResults, crates } from '../../../scripts/lanes.mjs';

/** The checkout these tests are in: the change, a twin laid over it, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const MINUTE = 60_000;
/** The test the issue names, by its own name: in whichever deep-gpu target holds it. */
export const SPAN_TEST = 'a_span_holds_its_submission_and_not_the_gap_after_it';
/** The base test's bound on what the spans add to the passes' own time, in ms: half its 200 ms gap. */
export const BOUND_MS = 100;

/** A reason of the machine, not the work: the test reads INCONCLUSIVE, never PASS and never a failure of the work. */
export function inconclusive(why) {
  throw new Error(`INCONCLUSIVE ${why}`);
}

/** This process's environment for cargo: ~/.cargo/bin on PATH, no colour, no git variables. */
function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'NODE_TEST_CONTEXT' && !key.startsWith('GIT_')) env[key] = value;
  return Object.assign(env, { PATH: [join(homedir(), '.cargo/bin'), process.env.PATH ?? '/usr/bin:/bin'].join(delimiter), CARGO_TERM_COLOR: 'never', NO_COLOR: '1' });
}

function cargo(args) {
  const ran = spawnSync('cargo', args, { cwd: ROOT, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: 40 * MINUTE });
  if (ran.error) inconclusive(`cargo ${args.join(' ')} did not run: ${ran.error.message}`);
  if (ran.signal) inconclusive(`cargo ${args.join(' ')} was stopped by ${ran.signal}`);
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

let built;
/** deep-gpu's test targets and the load, built once; the load's executable. A build that fails is the work's. */
function build() {
  if (built) return built;
  const tests = cargo(['test', '--locked', '-p', 'deep-gpu', '--no-run']);
  if (tests.status !== 0) throw new Error(`cargo test -p deep-gpu --no-run fails:\n${tests.out.slice(-4000)}`);
  const load = cargo(['build', '--locked', '-p', 'deep-gpu', '--example', 'acceptance_3171_load', '--message-format=json']);
  if (load.status !== 0) throw new Error(`the load example doesn't build:\n${load.out.slice(-4000)}`);
  const executable = load.out.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    .find((message) => message.reason === 'compiler-artifact' && message.target?.name === 'acceptance_3171_load')?.executable;
  if (!executable || !existsSync(executable)) throw new Error('cargo names no executable for the load example');
  built = { load: executable };
  return built;
}

/** Starts the load for `seconds` and resolves once its first passes are done; with no GPU, INCONCLUSIVE. */
async function startLoad(executable, seconds) {
  const child = spawn(executable, [String(seconds)], { cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  const line = await new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('\n')) resolve(out.split('\n')[0]);
    });
    child.on('exit', () => resolve(out.split('\n')[0]));
  });
  if (!line.startsWith('busy ')) {
    child.kill('SIGKILL');
    inconclusive(`the GPU load didn't start: ${line || 'it printed nothing'}`);
  }
  return { child, passMs: Number(line.slice(5)) / 2 };
}

/**
 * One run of the span test, alone or beside the load: `cargo test -p deep-gpu --no-fail-fast -- <name> --show-output`,
 * read by the lanes' own cargoResults. `state` is the lanes' reading of the test: PASS, FAIL, INCONCLUSIVE, BLOCKED or
 * INVALID (a run of its target that proves nothing, named for the test, counts as its own), or null when no target ran
 * it; `message` what a state below PASS says; `trials` the readings its output states as the base's message words them.
 */
export async function spanRun({ beside }) {
  const { load } = build();
  const busy = beside ? await startLoad(load, 600) : null;
  let ran;
  try {
    ran = cargo(['test', '--locked', '-p', 'deep-gpu', '--no-fail-fast', '--', SPAN_TEST, '--show-output']);
  } finally {
    // Only the process this run started, by its own handle.
    busy?.child.kill('SIGKILL');
  }
  const { failures, passed } = cargoResults(ran.out, ran.status, crates(ROOT));
  const own = (id) => id.endsWith(` › ${SPAN_TEST}`) || id.endsWith(`::${SPAN_TEST}`);
  const named = failures.filter(({ id, message }) => own(id) || message.includes(SPAN_TEST));
  const states = [...named.map(({ state }) => state), ...passed.filter(own).map(() => 'PASS')];
  const state = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'PASS'].find((s) => states.includes(s)) ?? null;
  const trials = [...ran.out.matchAll(/trial (\d+): ([\d.]+) ms covered, the passes' own ([\d.]+)/g)]
    .map(([, trial, covered, own]) => ({ trial: Number(trial), covered: Number(covered), own: Number(own) }));
  const message = named.map(({ message: m }) => m).join('; ');
  return { state, message, trials, passMs: busy?.passMs ?? null, out: ran.out };
}

/** What a run printed of the span test, for a failure message: its result lines, readings and panics. */
export const shown = (run) => run.out.split('\n').filter((line) => /a_span_holds|trial \d|panicked|test result|INCONCLUSIVE|GPU/.test(line)).slice(0, 40).join('\n');
