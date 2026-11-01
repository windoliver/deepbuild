// #140.12: the canvas core's crates build for wasm32-unknown-unknown with threads off in the local preflight, and a
// planted dependency that needs threads or an API only native targets have fails that build, naming the crate.
//
// The local preflight's lane is `wasm32` in scripts/lanes.mjs's `checks`, running `node scripts/wasm32.mjs`, which
// prints `PASS <crate>` for each canvas core crate it built and `FAIL <crate>: <reason>` naming the crate that broke
// the build. `--planted threads` and `--planted native` add the planted dependency crates `deep-planted-threads` and
// `deep-planted-native` under deep-canvas for that run only (README: The surface under test). Besides the lane's own
// word, this file builds the same crates for wasm32-unknown-unknown itself, with no flags that turn threads on. At the
// base there is no `wasm32` lane, no scripts/wasm32.mjs, and the wasm32 target isn't installed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, cargoErrors, lanes, metadata, runCommand, type Lane, type Ran } from './helpers.ts';

const TARGET = 'wasm32-unknown-unknown';
const SCRIPT = 'scripts/wasm32.mjs';
const LANE = 'wasm32';
const PLANTED = { threads: 'deep-planted-threads', native: 'deep-planted-native' } as const;

/**
 * The canvas core's crates (README: Readings): every workspace crate named `deep-canvas` or `deep-canvas-*` (the core
 * and its canvas modules, the canvas lint's prefix) but the test-only `deep-canvas-test-modules`, and `deep-text`, the
 * canvas's one text shaper; read from cargo metadata, so a canvas module added later joins the list.
 */
function coreCrates(): string[] {
  const meta = metadata();
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const names = meta.workspace_members.map((id) => byId.get(id)?.name).filter((n): n is string => typeof n === 'string');
  const core = names.filter((n) => (n === 'deep-canvas' || n.startsWith('deep-canvas-')) && n !== 'deep-canvas-test-modules');
  if (names.includes('deep-text')) core.push('deep-text');
  return core.sort();
}

/** The environment of a build with threads off: no flags from the caller's shell that could turn atomics on. */
function threadsOffEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS']) delete env[k];
  return env;
}

const node = process.execPath;
/** The lane's script, run once per startup and kept for the file. */
const runs = new Map<string, Ran>();
function script(planted?: keyof typeof PLANTED): Ran {
  const key = planted ?? 'clean';
  if (!runs.has(key)) {
    expect(existsSync(join(REPO, SCRIPT)), `${SCRIPT} exists (the wasm32 lane's command)`).toBe(true);
    runs.set(key, runCommand([node, SCRIPT, ...(planted ? ['--planted', planted] : [])], REPO, 3_600_000, threadsOffEnv()));
  }
  return runs.get(key)!;
}
const shown = (r: Ran): string => `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\nstdout: ${r.stdout.slice(-3000)}\nstderr: ${cargoErrors(r.stderr, 3000)}`;
const linesOf = (r: Ran): string[] => `${r.stdout}\n${r.stderr}`.split('\n').map((l) => l.trim()).filter((l) => l !== '');

describe('#140.12 the canvas core\'s crates build for wasm32-unknown-unknown with threads off in the local preflight', () => {
  it('#140.12 the local preflight has a lane named wasm32 running node scripts/wasm32.mjs; each of its commands exits 0, and it prints PASS for every canvas core crate', async () => {
    const core = coreCrates();
    expect(core, 'cargo metadata lists the canvas core (deep-canvas) and its text shaper (deep-text)').toEqual(expect.arrayContaining(['deep-canvas', 'deep-text']));
    const checks: Lane[] = await lanes();
    const lane = checks.find((l) => l.name === LANE);
    expect(lane, `scripts/lanes.mjs has a lane named ${LANE} in checks (the local preflight)`).toBeDefined();
    expect(lane!.commands.some((c) => c.length === 2 && c[1] === SCRIPT), `the ${LANE} lane runs node ${SCRIPT}: ${JSON.stringify(lane!.commands)}`).toBe(true);
    for (const command of lane!.commands) {
      const r = command[1] === SCRIPT ? script() : runCommand(command, REPO, 3_600_000, threadsOffEnv());
      expect(r.status, `${LANE} lane: ${command.join(' ')} exits 0\n${shown(r)}`).toBe(0);
    }
    const passed = new Set(linesOf(script()).filter((l) => /^PASS\s+\S+$/.test(l)).map((l) => l.split(/\s+/)[1]!));
    expect(core.filter((c) => !passed.has(c)), `the lane prints "PASS <crate>" for every canvas core crate (${core.join(', ')})`).toEqual([]);
  }, 3_600_000);

  it('#140.12 built here, apart from the lane, every canvas core crate compiles for wasm32-unknown-unknown with threads off (no atomics target feature, no flags that add it)', () => {
    const env = threadsOffEnv();
    // Threads off: the target as rustc ships it, without the atomics feature that std's threads on wasm32 need.
    const cfg = runCommand(['rustc', '--print', 'cfg', '--target', TARGET], REPO, 120_000, env);
    expect(cfg.status, `rustc --print cfg --target ${TARGET} runs: ${cfg.stderr.slice(-1500)}`).toBe(0);
    expect(cfg.stdout, `${TARGET} is configured without target_feature="atomics" (threads off)`).not.toMatch(/target_feature="atomics"/);
    const config = readFileSync(join(REPO, '.cargo', 'config.toml'), 'utf8');
    expect(config, '.cargo/config.toml turns no threads on for wasm32 (no atomics, no build-std)').not.toMatch(/atomics|build-std/);
    const core = coreCrates();
    const r = runCommand(['cargo', 'build', '--locked', '--target', TARGET, ...core.flatMap((c) => ['-p', c])], REPO, 3_600_000, env);
    expect(r.status, `cargo build --locked --target ${TARGET} -p ${core.join(' -p ')} exits 0\n${cargoErrors(r.stderr)}`).toBe(0);
  }, 3_600_000);

  for (const [planted, crate] of Object.entries(PLANTED) as [keyof typeof PLANTED, string][]) {
    const kind = planted === 'threads' ? 'needs threads (it spawns a std thread)' : 'calls an API only native targets have';
    it(`#140.12 a planted dependency that ${kind} (--planted ${planted}, the crate ${crate}) fails the wasm32 lane's build, naming the crate, where the clean run passes`, () => {
      const clean = script();
      expect(clean.status, `the clean run of ${SCRIPT} passes first, so the planted run's failure is the dependency's\n${shown(clean)}`).toBe(0);
      const r = script(planted);
      expect(r.timedOut, `${SCRIPT} --planted ${planted} finishes`).toBe(false);
      expect(r.status !== 0, `${SCRIPT} --planted ${planted} fails (exits non-zero)\n${shown(r)}`).toBe(true);
      const fails = linesOf(r).filter((l) => /^FAIL\b/.test(l));
      expect(fails.length, `${SCRIPT} --planted ${planted} prints a FAIL line\n${shown(r)}`).toBeGreaterThan(0);
      expect(fails.some((l) => l.split(/[\s:,()`'"]+/).includes(crate)), `a FAIL line names the planted crate ${crate}: ${JSON.stringify(fails)}`).toBe(true);
    }, 3_600_000);
  }
});
