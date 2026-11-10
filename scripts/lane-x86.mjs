// The x86_64 lane (issue #1983; technical design: Platforms, CPU architecture; canvas primitives: Golden). No x86_64
// machine exists, so a linux/amd64 container on the reference Mac is the other architecture for CPU checks: it builds
// deep-logic for linux/amd64 in the toolchain image pinned in scripts/lane-x86.json (the channel rust-toolchain.toml
// names), with the checkout mounted read-only and its caches under target/lane-x86/, then runs the golden's replay in a
// second container with no network. It never pulls an image. It writes its evidence record as every lane does (#1115),
// ~/.deepbuild/lanes/<tree>-x86_64.json, which logic.determinism's cross_machine reads: the recording machine, the
// lane's architecture as its own deep-logic reports it, the host's, `emulated`, the image digest, the network and the
// verdict. A run under emulation proves our x86_64 build gives the same bits as the arm64 one, never a timing or a budget.
//
// Usage: node scripts/lane-x86.mjs [--planted replay_changes_step_37 | container_arm64 | native | default_network] < calls
// The calls are deep-logic JSON lines, golden_verify calls of goldens recorded on this Mac. Prints one line,
// `<STATE> x86_64: <why>`, and exits 0 on PASS, 1 on FAIL, 2 on INCONCLUSIVE and 3 on BLOCKED or INVALID. `--planted`
// runs one criterion's wrong lane: the container's deep-logic with that twin, the replay in a linux/arm64 container,
// natively on this Mac, or on the runtime's default network.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactTree, writeRecord } from './lanes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const LANE = 'x86_64';
const PLANTS = ['replay_changes_step_37', 'container_arm64', 'native', 'default_network'];
const BUILD_MS = 6_000_000; // the first linux/amd64 build runs under emulation: over 30 minutes under load
const MIB = 1024 * 1024;
const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 };
const TARGET = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };

const args = process.argv.slice(2);
const planted = args[0] === '--planted' && PLANTS.includes(args[1]) && args.length === 2 ? args[1] : null;
if (args.length && !planted) {
  console.error(`usage: node scripts/lane-x86.mjs [--planted ${PLANTS.join(' | ')}] < golden_verify calls`);
  process.exit(2);
}
const calls = readFileSync(0, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const golden = calls.find((c) => c.call === 'golden_verify' && c.golden)?.golden;
if (!golden) {
  console.error('the lane replays golden_verify calls: give at least one on stdin');
  process.exit(2);
}
const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(root, 'rust-toolchain.toml'), 'utf8'))?.[1];
const pin = JSON.parse(readFileSync(join(root, 'scripts', 'lane-x86.json'), 'utf8'));
const ref = `${pin.image}@${pin.digest}`;
const tree = exactTree(root);
if (!tree) {
  console.error("INVALID x86_64: git can't write this checkout's tree, so no record can name it");
  process.exit(3);
}

// Every record names what the replay was of and where it ran, BLOCKED ones too.
const record = {
  recording_machine: golden.machine ?? null, lane_arch: null, host_arch: process.arch, emulated: null, image_digest: null,
  network: null, bake_key: golden.bake_key ?? null, report: null, ask: null, error: null, readings: [],
};
function finish(state, why, more = {}) {
  Object.assign(record, more);
  const file = writeRecord(LANE, state, tree, [{ id: 'golden_verify', state }], record);
  console.log(`${state} ${LANE}: ${why}\n  Record: ${file}`);
  process.exit(EXIT[state]);
}

function run(command, argv, opts = {}) {
  const r = spawnSync(command, argv, { cwd: root, encoding: 'utf8', maxBuffer: 512 * MIB, killSignal: 'SIGKILL', ...opts });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? r.error?.message ?? '', timedOut };
}
const lastLine = (text) => text.trim().split('\n').slice(-1)[0] ?? '';
/** An architecture by Rust's name for it, whatever its platform calls it (Node's arm64 and x64, Docker's amd64). */
const archOf = (a) => ({ x64: 'x86_64', amd64: 'x86_64', arm64: 'aarch64' })[a] ?? a;
const lines = (list) => list.map((c) => JSON.stringify(c)).join('\n') + '\n';

/** This Mac's own deep-logic, built by its cargo in the checkout. */
function nativeLogic() {
  const build = run('cargo', ['build', '--locked', '--bin', 'deep-logic'], { env: { ...process.env, ...CARGO_ENV }, timeout: BUILD_MS });
  if (build.status !== 0) finish(build.timedOut ? 'INCONCLUSIVE' : 'FAIL', `cargo build --locked --bin deep-logic on this Mac failed`, { error: build.stderr.slice(-4000) });
  return join(TARGET, 'debug', 'deep-logic');
}

/** The recording machine's bake of each golden_verify call, from this Mac's deep-logic when this Mac recorded it, so the
 *  replay can name the field that differs (Golden: Report); otherwise the replay names the step and item alone. */
function withRecordings(bin) {
  const about = JSON.parse(run(bin, [], { input: '{"call":"about"}\n' }).stdout.split('\n')[0] || 'null');
  if (!about || about.arch !== golden.machine?.arch || about.os !== golden.machine?.os) return calls;
  return calls.map((c) => {
    if (c.call !== 'golden_verify') return c;
    const baked = JSON.parse(run(bin, [], { input: `${JSON.stringify({ ...c, call: 'bake', golden: undefined })}\n` }).stdout.split('\n')[0] || 'null');
    return baked?.ok ? { ...c, recording: baked.steps } : c;
  });
}

/** Reads the replay's replies: `about` first, then one per call. */
function judge(replay, input, more) {
  if (replay.timedOut) finish('INCONCLUSIVE', 'the replay timed out', { ...more, error: replay.stderr.slice(-4000) });
  const replies = replay.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const about = replies.shift();
  if (replay.status !== 0 || !about?.arch || replies.length !== input.length) {
    finish('FAIL', `the replay's deep-logic exited ${replay.status} with ${replies.length} of ${input.length} replies`, { ...more, error: replay.stderr.slice(-4000) });
  }
  Object.assign(more, { lane_arch: about.arch, emulated: archOf(process.arch) !== archOf(about.arch) });
  const verdicts = replies.filter((r) => r.verdict);
  const bad = replies.find((r) => !r.ok);
  if (bad) finish('INVALID', `deep-logic refused a call: ${JSON.stringify(bad)}`, more);
  const failed = verdicts.find((r) => r.verdict === 'FAIL');
  if (failed) {
    const at = failed.report ? `step ${failed.report.first_step}, ${failed.report.field ? `${failed.report.field.id}.${failed.report.field.field}` : failed.report.item}` : 'the bake keys or checkpoints';
    finish('FAIL', `the replay on ${about.arch} differs from the golden recorded on ${golden.machine?.arch}: ${at}`, { ...more, report: failed.report });
  }
  finish('PASS', `the replay on ${about.arch} matches the golden recorded on ${golden.machine?.os} ${golden.machine?.arch}${more.emulated ? ', under emulation' : ''}`, more);
}

if (planted === 'native') {
  // A planted wrong lane: the replay on this Mac itself, which can never count as another machine.
  const bin = nativeLogic();
  const input = withRecordings(bin);
  judge(run(bin, [], { input: lines([{ call: 'about' }, ...input]), timeout: BUILD_MS }), input, { network: 'host' });
}

const docker = (argv, timeout = 60_000) => run('docker', argv, { timeout });
const info = docker(['info', '--format', '{{.ServerVersion}}'], 30_000);
if (info.status !== 0) {
  finish('BLOCKED', 'the container runtime is unreachable', {
    ask: `docker is unreachable (docker info: ${lastLine(info.stderr) || `exit ${info.status}`}); the x86_64 lane runs in this Mac's container runtime: start it (colima start), then run node scripts/lane-x86.mjs again`,
  });
}
const platform = planted === 'container_arm64' ? 'linux/arm64' : 'linux/amd64';
const arch = platform.split('/')[1];
const image = docker(['image', 'inspect', '--platform', platform, '--format', '{{.Architecture}}', ref]);
if (image.status !== 0 || image.stdout.trim() !== arch) {
  finish('BLOCKED', `no ${platform} image of the pinned digest`, {
    ask: `Docker has no ${platform} image of the pinned ${ref} here, and a check never pulls one: run docker pull --platform ${platform} ${ref}`,
  });
}
if (!pin.image.startsWith(`rust:${channel}`)) {
  finish('INVALID', `the pin names ${pin.image}, not the toolchain image of rust-toolchain.toml's channel ${channel}`);
}
const input = withRecordings(nativeLogic());

const cache = join(TARGET, 'lane-x86', arch);
for (const d of ['target', 'registry', 'git']) mkdirSync(join(cache, d), { recursive: true });
const build = docker(['run', '--rm', '--pull', 'never', '--platform', platform,
  '-v', `${root}:/src:ro`, '-v', `${join(cache, 'target')}:/target`,
  '-v', `${join(cache, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(cache, 'git')}:/usr/local/cargo/git`,
  '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel}`,
  '-e', `CARGO_INCREMENTAL=${CARGO_ENV.CARGO_INCREMENTAL}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV.CARGO_PROFILE_DEV_DEBUG}`,
  ref, 'cargo', 'build', '--locked', '--bin', 'deep-logic'], BUILD_MS);
const ran = { image_digest: pin.digest };
if (build.status !== 0) {
  finish(build.timedOut ? 'INCONCLUSIVE' : 'FAIL', `cargo build --locked --bin deep-logic in ${platform} ${build.timedOut ? 'timed out' : 'failed'}`, { ...ran, error: build.stderr.slice(-4000) });
}

// The replay: no network (unless planted), the build's target read-only, and the container's own interfaces reported,
// so the record says the network the replay ran on, not the flag the lane meant to pass.
const network = planted === 'default_network' ? [] : ['--network', 'none'];
const replay = run('docker', ['run', '--rm', '-i', '--pull', 'never', '--platform', platform, ...network, '-v', `${join(cache, 'target')}:/target:ro`,
  ref, 'sh', '-c', 'echo "lane-interfaces: $(ls /sys/class/net | tr "\\n" " ")" >&2; exec /target/debug/deep-logic "$@"', 'deep-logic',
  ...(planted === 'replay_changes_step_37' ? ['--planted', planted] : [])], { input: lines([{ call: 'about' }, ...input]), timeout: BUILD_MS });
const interfaces = /lane-interfaces: (.*)/.exec(replay.stderr)?.[1]?.trim().split(/\s+/).filter(Boolean);
ran.network = !interfaces ? null : interfaces.every((i) => i === 'lo') ? 'none' : 'bridge';
judge(replay, input, ran);
