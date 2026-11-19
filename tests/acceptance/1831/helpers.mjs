// Shared by the #1831 acceptance tests: the two planted Macs, the fake `sysctl`, `pmset` and `osascript` that
// describe one of them (the operating system is the one boundary these tests stand in for), and the cargo build.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const AC1 = 'AC1 #1831.13f43b1f';
export const AC2 = 'AC2 #1831.2e170a8b';

// The design's third reference Mac ("The reference Macs": Mac17,10, M5 Max, 18 CPU cores, 64 GB), one it has had
// from the start, and a Mac that was never one: the 13-inch M2 MacBook Air, as sysctl names each.
export const M5_MAX = { model: 'Mac17,10', chip: 'Apple M5 Max', memoryGb: 64, cores: 18 };
export const M3_PRO = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryGb: 36, cores: 12 };
export const M2_AIR = { model: 'Mac14,2', chip: 'Apple M2', memoryGb: 16, cores: 8 };

export const show = (result) => `exit ${result.status}${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${(result.stdout ?? '').slice(-3000)}\nstderr:\n${(result.stderr ?? '').slice(-3000)}`;

export function scratch(t, prefix) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// A bin/ whose `sysctl`, `pmset` and `osascript` describe `mac` on mains power, with Low Power Mode off and a
// nominal thermal state, and nothing else: a question they don't know fails, so no value of this Mac leaks in.
export function fakeMachine(directory, { model, chip, memoryGb, cores }) {
  const bin = join(directory, `machine-${model.replace(',', '-')}`);
  mkdirSync(bin);
  const values = { 'hw.model': model, 'hw.memsize': String(memoryGb * 2 ** 30), 'machdep.cpu.brand_string': chip,
    ...Object.fromEntries(['hw.ncpu', 'hw.physicalcpu', 'hw.physicalcpu_max', 'hw.logicalcpu', 'hw.logicalcpu_max', 'hw.activecpu'].map((key) => [key, String(cores)])) };
  const scripts = {
    sysctl: `quiet=0; [ "$1" = "-n" ] && { quiet=1; shift; }
status=0
for key in "$@"; do
  case "$key" in
${Object.entries(values).map(([key, value]) => `    '${key}') value='${value}' ;;`).join('\n')}
    *) echo "sysctl: unknown oid '$key'" >&2; status=1; continue ;;
  esac
  if [ $quiet = 1 ]; then printf '%s\\n' "$value"; else printf '%s: %s\\n' "$key" "$value"; fi
done
exit $status`,
    pmset: `case "$*" in
  '-g ps'|'-g batt') printf "Now drawing from 'AC Power'\\n -InternalBattery-0 (id=1)\\t100%%; charged; 0:00 remaining present: true\\n" ;;
  '-g') printf 'System-wide power settings:\\nCurrently in use:\\n standby              1\\n sleep                1\\n lowpowermode         0\\n' ;;
  '-g therm') printf 'Note: No thermal warning level has been recorded\\nNote: No performance warning level has been recorded\\nNote: No CPU power status has been recorded\\n' ;;
  *) echo "pmset: not faked in #1831's tests: $*" >&2; exit 1 ;;
esac`,
    osascript: `case "$*" in
  *isLowPowerModeEnabled*) echo false ;;
  *thermalState*) echo 0 ;;
  *) echo "osascript: not faked in #1831's tests: $*" >&2; exit 1 ;;
esac`,
  };
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}

// The environment every build here gets, as the sibling suites build: the pinned toolchain first on PATH, no
// incremental build and no debug info.
export const buildEnv = () => ({
  ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0',
  PATH: [join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin'), process.env.PATH].join(delimiter),
});

/** `cargo build --locked --bin <bin>` in the checkout: '' when it built, else why this suite is BLOCKED. */
export function cargoBuild(bin) {
  const args = ['build', '--locked', '--bin', bin];
  const built = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: buildEnv() });
  if (built.error) return `BLOCKED: cargo could not run: ${built.error.message}`;
  if (built.status !== 0) return `BLOCKED: cargo ${args.join(' ')} failed:\n${built.stderr.split('\n').filter((line) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(line)).join('\n').slice(0, 4000)}`;
  return '';
}
