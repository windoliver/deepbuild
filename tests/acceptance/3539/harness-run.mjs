// The spike's harness, run by this suite (#3539; README.md, "The harness's command"): on the kept script in which
// the person's session never stops, for criterion 2's planted twin, and on a script of this suite's own whose pool
// the test holds full, for criterion 3. The harness runs in a temporary home, with nothing of the caller's
// environment that could choose a planted program, and is ended by PID if it outlives its deadline.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, tempDir } from './base.mjs';
import { HARNESS, outputProblems, PERSON, sha256, SLOW_MS } from './validate.mjs';

// deadline: bounds one run of the harness, so a hang ends as BLOCKED; no time is read from it.
const DEADLINE_MS = 30 * 60_000;

/**
 * One run of the harness: `node docs/spikes/3539/harness.mjs --script <file> --order <order> --out <file>
 * [--plant <name>]`, from the checkout's root. `file` is a kept script; `script` is one of this suite's own, written
 * to a temporary file. Returns the output it wrote, or the problems: BLOCKED when there is no harness or it didn't
 * run to its end.
 */
export function runHarness({ file, script, order, plant, harness = join(REPO, HARNESS) }) {
  if (!existsSync(harness)) return { problems: [`BLOCKED: ${HARNESS} is not in this checkout: the spike's harness hasn't been written, so nothing can be held to what it reads`] };
  const dir = tempDir('run');
  try {
    const home = join(dir, 'home');
    mkdirSync(home);
    const at = file ?? join(dir, 'script.json');
    if (!file) writeFileSync(at, `${JSON.stringify(script, null, 2)}\n`);
    const out = join(dir, 'out.json');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('GIT_') && k !== 'NODE_OPTIONS'));
    const ran = spawnSync(process.execPath, [harness, '--script', at, '--order', order, '--out', out, ...(plant ? ['--plant', plant] : [])], {
      cwd: REPO, env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') }, encoding: 'utf8', timeout: DEADLINE_MS, killSignal: 'SIGKILL', maxBuffer: 2 ** 26,
    });
    const said = `node ${HARNESS} --order ${order}${plant ? ` --plant ${plant}` : ''}`;
    if (ran.status !== 0) return { problems: [`BLOCKED: ${said} didn't run to its end: ${ran.error?.message ?? `exit ${ran.status}${ran.signal ? ` on ${ran.signal}` : ''}`}\n${String(ran.stderr ?? '').slice(-2000)}`] };
    if (!existsSync(out)) return { problems: [`${said} exited 0 and wrote no output to --out`] };
    let read;
    try { read = JSON.parse(readFileSync(out, 'utf8')); } catch (error) { return { problems: [`${said} wrote an output that is not JSON: ${error.message}`] }; }
    const shape = outputProblems(read, `the output of ${said}`, { sha: sha256(readFileSync(at)), order });
    return shape.length ? { problems: shape } : { out: read, problems: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The script whose pool the test holds full (README.md, "The pool held full"): one session a person is at, stopping
 * green once with the issue's three slow checks, on a pool of two slots that `foreign` holds, both, from the script's
 * start until an hour in. `held` says what any reading of it must show.
 */
export function heldFullScript() {
  const [session, snapshot, stopAt, heldUntil, pool] = ['person', 'person-1', 60_000, 3_600_000, 2];
  const checks = SLOW_MS.map((ms) => ({ id: `check-${ms / 60_000}m`, on_base: 'passes', inputs: ['src/**'], expected_ms: ms, took_ms: ms }));
  return {
    script: {
      config: { slots: pool },
      sessions: [{ id: session, checks, events: [{ at: 0, kind: 'prompt', origin: PERSON }, { at: stopAt, kind: 'stop', snapshot, changed: ['src/person.ts'] }] }],
      foreign: [{ at: 0, ms: heldUntil, slots: pool }],
    },
    held: { session, snapshot, checks: checks.map((c) => c.id), stopAt, heldUntil },
  };
}
