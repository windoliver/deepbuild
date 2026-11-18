// AC6 #172.c41df47e: "The lab exported twice on macOS arm64 and once on Linux aarch64 (the Spark), each in a clean home,
// gives 3 byte-identical bundles; a planted exporter that writes the export time into the index page fails, naming the
// file and the first byte offset that differs; with no Linux host configured, that comparison is BLOCKED with one
// unblock ask, never PASS. An x86_64 export joins the comparison with the first x86_64 target."
//
// asserts:
//   - on macOS arm64, two exports of the lab on its track, each a `deep-show run` with a fresh HOME and TMPDIR, another
//     USER and LOGNAME, another evidence store and an output folder at another path, the second at least 1.5 s after
//     the first: the two bundles hold the same paths with the same bytes (compared sorted, so file-system order can't
//     enter), else the first differing file and byte offset are named;
//   - the planted exporter `web_index_export_time` beside a third clean export fails that comparison, naming index.html
//     and the first byte offset that differs;
//   - Linux aarch64: with `DEEP_LINUX_AARCH64` (an ssh destination, chosen) and `DEEP_LINUX_AARCH64_DIR` (a checkout of
//     this commit there, chosen) set, the same export runs there in a clean home and its bundle is byte-identical to
//     this Mac's; unset, BLOCKED with one unblock ask, never a pass.
// x86_64 has no target yet (the criterion's last sentence); nothing here exports on it.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, REPO, TIMEOUT, arr, blocked, bundleDifference, bundleFailures, failsNaming, labDoc, labTrack, obj, present, presented, scenarioOf, show,
  useShow, useTemp, webExport, webReceiptOf, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'web_index_export_time';

/** `deep-show run` with its own environment (a clean home): one answer line, ok, one reply per call. */
function runIn(bin: string, sc: JsonObject, env: NodeJS.ProcessEnv, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL', env });
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  expect(r.status, `${what}: deep-show run exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter(Boolean);
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonObject, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 2000)}`).toBe(true);
  return arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
}
/** A clean home: fresh HOME and TMPDIR, another user name, nothing else of this shell but PATH. */
function cleanEnv(user: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), `deep-172-home-${user}-`));
  const tmp = join(home, 'tmp');
  mkdirSync(tmp);
  return { PATH: process.env['PATH'] ?? '', HOME: home, TMPDIR: tmp, USER: user, LOGNAME: user, LANG: 'C' };
}
/** One export of the lab on its track in a clean home, into a folder at a path of its own. */
function cleanExport(user: string, depth: number, planted?: string): string {
  const env = cleanEnv(user);
  const evidence = join(temp(), ...Array.from({ length: depth }, (_, i) => `e${i}`));
  mkdirSync(evidence, { recursive: true });
  const document = labDoc(evidence);
  const out = join(temp(), ...Array.from({ length: depth }, (_, i) => `out-${user}-${i}`), 'bundle');
  const what = `the lab exported by ${user}${planted ? ` (planted ${planted})` : ''}`;
  try {
    const r = runIn(shows(FULL), scenarioOf({ evidence, docs: [DOC.lab], calls: [present(DOC.lab, document), webExport(DOC.lab, out, { track: labTrack() })], ...(planted ? { planted } : {}) }), env, what);
    presented(r[0], what);
    const receipt = webReceiptOf(r[1], what);
    expect(bundleFailures(out, receipt, what), `${what}: the bundle holds every file its receipt names, by hash`).toEqual([]);
  } finally { rmSync(String(env['HOME']), { recursive: true, force: true }); }
  return out;
}
const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const macArm64 = (): void => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') blocked(`this export must run on macOS arm64; this is ${process.platform} ${process.arch}. Unblock: run this file on the reference Mac`);
};

describe(`${AC[6]} three byte-identical bundles of the lab from clean homes on macOS arm64 and Linux aarch64`, () => {
  it(`${AC[6]} two macOS arm64 exports in clean homes are byte-identical, and the planted ${PLANTED} fails, naming index.html and the first differing byte`, () => {
    macArm64();
    const a = cleanExport('deep172a', 1);
    pause(1_500);
    const b = cleanExport('deep172bb', 3);
    const diff = bundleDifference(a, b);
    expect(diff, `two macOS arm64 exports of the lab are byte-identical${diff ? `: ${diff}` : ''}`).toBeNull();
    pause(1_500);
    const planted = cleanExport('deep172c', 2, PLANTED);
    const pdiff = bundleDifference(a, planted);
    const failures = pdiff ? [`the bundles differ: ${pdiff}`] : [];
    failsNaming(failures, 'index.html', `the planted exporter ${PLANTED}`);
    expect(/byte \d+/.test(failures[0]!), `the failure names the first byte offset that differs: ${failures[0]}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[6]} the Linux aarch64 export (the Spark) in a clean home is byte-identical to the macOS arm64 one; with no Linux host configured, BLOCKED`, () => {
    const host = process.env['DEEP_LINUX_AARCH64'];
    const dir = process.env['DEEP_LINUX_AARCH64_DIR'];
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    if (!host || !dir) blocked(`no Linux aarch64 host is configured for the third export. Unblock: set DEEP_LINUX_AARCH64 to the Spark's ssh destination and DEEP_LINUX_AARCH64_DIR to a checkout of ${head} there with cargo, then rerun`);
    macArm64();
    const mac = cleanExport('deep172m', 1);
    // Ship the scenario and its evidence store; the remote checks it is at this commit, builds deep-show, runs the
    // export with a fresh HOME and TMPDIR, and sends back the answer and the bundle as one tar stream.
    const ship = temp();
    const evidence = join(ship, 'evidence');
    mkdirSync(evidence);
    const document = labDoc(evidence);
    const sc = scenarioOf({ evidence: '@ROOT@/evidence', docs: [DOC.lab], calls: [present(DOC.lab, document), webExport(DOC.lab, '@ROOT@/out/bundle', { track: labTrack() })] });
    writeFileSync(join(ship, 'scenario.json'), JSON.stringify(sc));
    const tar = execFileSync('tar', ['-cf', '-', '-C', ship, '.'], { maxBuffer: 1 << 30 });
    const remote = [
      'set -e', 'r=$(mktemp -d)', 'tar -xf - -C "$r"', 'mkdir -p "$r/out"', `cd ${JSON.stringify(dir)}`,
      `h=$(git rev-parse HEAD); if [ "$h" != ${head} ]; then echo "the checkout is at $h, not ${head}" >&2; exit 3; fi`,
      '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"', 'cargo build --locked --bin deep-show >&2',
      'c=$(mktemp -d); mkdir -p "$c/tmp"', 'sed "s|@ROOT@|$r|g" "$r/scenario.json" | env -i PATH="$PATH" HOME="$c" TMPDIR="$c/tmp" USER=deep172s LOGNAME=deep172s LANG=C target/debug/deep-show run > "$r/answer.json"',
      'tar -cf - -C "$r" answer.json out', 'rm -rf "$r" "$c"',
    ].join('\n');
    const script = Buffer.from(remote, 'utf8').toString('base64');
    const r = spawnSync('ssh', ['-o', 'BatchMode=yes', host!, `sh -c "$(printf %s ${script} | base64 -d)"`], { input: tar, maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000 });
    if (r.status === 255) blocked(`ssh to ${host} failed: ${String(r.stderr).slice(-800)}. Unblock: make DEEP_LINUX_AARCH64 an ssh destination this Mac reaches without a prompt`);
    if (r.status === 3) blocked(`${String(r.stderr).trim()}. Unblock: check out ${head} at ${dir} on ${host}`);
    expect(r.status, `the Linux aarch64 export ran: ${String(r.stderr).slice(-1500)}`).toBe(0);
    const back = mkdtempSync(join(tmpdir(), 'deep-172-linux-'));
    try {
      execFileSync('tar', ['-xf', '-', '-C', back], { input: r.stdout });
      const answer = obj(JSON.parse(readFileSync(join(back, 'answer.json'), 'utf8')) as JsonObject, 'the Linux answer');
      expect(answer['ok'], `the Linux deep-show run takes the scenario: ${show(answer, 1500)}`).toBe(true);
      webReceiptOf(arr(answer['replies'], 'the Linux replies').map((v) => obj(v, 'a reply'))[1], 'the lab exported on Linux aarch64');
      const linux = join(back, 'out', 'bundle');
      cpSync(linux, join(temp(), 'linux-bundle'), { recursive: true });
      const diff = bundleDifference(mac, linux);
      expect(diff, `the Linux aarch64 bundle is byte-identical to the macOS arm64 one${diff ? `: ${diff}` : ''}`).toBeNull();
    } finally { rmSync(back, { recursive: true, force: true }); }
  }, TIMEOUT);
});
