// #2012.13d17890: Rapier's own determinism tests at v0.36.1 (snapshot_portability, simd_backend_determinism and
// snapshot_roundtrip) pass with the pinned features, toolchain and build flags on the reference Mac and on the Linux
// machine, and the portability test reproduces the golden Rapier commits (488,334 bytes).
//
// The tests are Rapier's own files at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (the rapier3d 0.36.1 crate ships
// the same bytes), with simd_backend_parity, which the Oracle page maps to this criterion too. Each must be the root
// file of a test target of a workspace package (README: Rapier's own tests), its text upstream's after an optional
// header of plain `//` lines (where a license notice goes); the SHA-256 of that text is pinned here, so a moved golden
// constant or a dropped assertion is caught, and snapshot_portability's text holds the golden (488,334 bytes, FNV-1a
// 0x3f5e_ac53_ad07_5243). Each of the files' tests must report `ok` from cargo test by name: a file its `#![cfg]`
// compiles out runs nothing and fails here. The features are the physics build's (`cargo tree`: rapier3d and the crates
// the bake key pins resolve the same for the tests' build as for deep-physics-rapier's, for each machine's target, and
// a planted build with rapier3d/simd8 is caught naming it); the toolchain is rust-toolchain.toml's channel on both
// machines; the flags are the checkout's, the caller's *RUSTFLAGS cleared (#2010's reading). The Linux machine is the
// #1983 lane's pinned image as linux/amd64: built there with the network, then each test run with none.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_TIMEOUT, CRITERIA, LINUX_X86, PINNED, REPO, TIMEOUT, caught, channel, cargo, cleanEnv, inLane, laneBuild, none, referenceMac,
} from './helpers.ts';

const ID = CRITERIA[2];

/** Rapier's files, by name: the SHA-256 of each at commit 3406750a38 (= rapier3d 0.36.1's tests/), and the tests it runs (its #[ignore]d one left out). */
const UPSTREAM: Record<string, { sha256: string; tests: string[] }> = {
  snapshot_portability: { sha256: '96ac7c887c03bc4199ff0d33c3e62ddd47b2637ee89343fc60100863d7637bd6', tests: ['snapshot_is_target_independent'] },
  simd_backend_determinism: { sha256: '55010b478bed24ace908c7ff93d9db6cd9aec67225c5791ca9d0d84b0f828c47', tests: ['golden_state_hash_is_backend_independent'] },
  simd_backend_parity: { sha256: 'fb8586912013b394903dc90243eeb42a364058e41a69157e0613a00a2c37afef', tests: ['portable_backend_matches_wide_bitwise'] },
  snapshot_roundtrip: {
    sha256: '0940a4d8804cf5416799e2bcda63a55cd0c55107eace8fc6209d451306a0f30f',
    tests: ['awake_pile', 'sleeping_pile', 'ccd_bodies', 'joints_and_sensor', 'multibody_articulation', 'restoring_into_a_live_pipeline', 'structural_changes', 'replacing_the_pipeline_changes_nothing'],
  },
};
/** The golden snapshot_portability commits: 488,334 bytes, FNV-1a 0x3f5e_ac53_ad07_5243, after 60 steps. */
const GOLDEN_LINE = 'const GOLDEN: (usize, u64) = (488_334, 0x3f5e_ac53_ad07_5243);';

interface Found { file: string; pkg: string; target: string; path: string }

/** A file's text after an optional header of blank and plain `//` lines (not `//!` or `///`, which are Rapier's own). */
function withoutHeader(text: string): string {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i]!.trim() === '' || /^\/\/(?![!/])/.test(lines[i]!))) i++;
  return lines.slice(i).join('\n');
}
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Each of Rapier's files as the root file of a test target of a workspace package (`cargo metadata`'s targets). */
function rapierTargets(): Found[] {
  const r = cargo(['metadata', '--locked', '--no-deps', '--format-version', '1']);
  expect(r.status, `cargo metadata runs: ${r.stderr.slice(-2000)}`).toBe(0);
  const packages = (JSON.parse(r.stdout) as { packages: { name: string; targets: { name: string; kind: string[]; src_path: string }[] }[] }).packages;
  const found = new Map<string, Found>();
  for (const p of packages) {
    for (const t of p.targets) {
      if (!t.kind.includes('test')) continue;
      const body = sha256(withoutHeader(readFileSync(t.src_path, 'utf8')));
      for (const [file, u] of Object.entries(UPSTREAM)) if (u.sha256 === body && !found.has(file)) found.set(file, { file, pkg: p.name, target: t.name, path: t.src_path });
    }
  }
  const missing = Object.keys(UPSTREAM).filter((f) => !found.has(f));
  expect(missing, `Rapier 0.36.1's own ${missing.map((f) => `tests/${f}.rs`).join(', ')} is the root file of no test target of a workspace package (cargo metadata), byte for byte after an optional // header`).toEqual([]);
  const portability = found.get('snapshot_portability')!;
  expect(readFileSync(portability.path, 'utf8'), 'snapshot_portability holds the golden Rapier commits').toContain(GOLDEN_LINE);
  return [...found.values()];
}

interface Resolved { name: string; version: string; features: string[] }
function resolved(args: string[]): Resolved[] {
  const r = cargo(['tree', '--locked', ...args, '--prefix', 'none', '-f', '{p}|{f}']);
  expect(r.status, `cargo tree ${args.join(' ')} runs: ${r.stderr.slice(-2000)}`).toBe(0);
  const seen = new Map<string, Resolved>();
  for (const line of r.stdout.split('\n')) {
    const m = /^(\S+) v(\S+)(?: \([^)]*\))?\|([^ ]*)(?: \(\*\))?$/.exec(line.trim());
    if (m) seen.set(`${m[1]}@${m[2]}`, { name: m[1]!, version: m[2]!, features: m[3] === '' ? [] : m[3]!.split(',').sort() });
  }
  return [...seen.values()];
}
/**
 * The tests' build resolves rapier3d and each crate the bake key pins (parry3d, wide, glam, glamx, simba, libm) at the
 * same versions with the same features as the physics build, deep-physics-rapier's, for `target` (this host's when absent).
 */
function pinnedFeatureFailures(pkg: string, target?: string, extra: string[] = []): string[] {
  const t = target ? ['--target', target] : [];
  const tests = resolved(['-p', pkg, '-e', 'normal,dev', ...t, ...extra]);
  const pinned = resolved(['-p', 'deep-physics-rapier', '-e', 'normal', ...t]);
  const show = (list: Resolved[], name: string): string => list.filter((p) => p.name === name).map((p) => `${p.version} [${p.features.join(',')}]`).sort().join('; ') || 'nothing';
  const f: string[] = [];
  for (const name of ['rapier3d', ...PINNED]) {
    const a = show(tests, name);
    const b = show(pinned, name);
    if (a !== b) f.push(`${name}: the Rapier tests' build (${pkg}${target ? `, ${target}` : ''}) resolves ${a}; the physics build resolves ${b}`);
  }
  return f;
}

/** `rustc -vV`'s release, commit hash and host. */
function rustcOf(text: string): { release: string | undefined; commit: string | undefined; host: string | undefined } {
  const line = (k: string): string | undefined => new RegExp(`^${k}:\\s*(\\S+)$`, 'm').exec(text)?.[1];
  return { release: line('release'), commit: line('commit-hash'), host: line('host') };
}

/** Each of the file's tests reports ok by name, and cargo test exits 0. */
function libtestFailures(t: Found, status: number | null, stdout: string, stderr: string, where: string): string[] {
  const f: string[] = [];
  for (const name of UPSTREAM[t.file]!.tests) {
    const m = new RegExp(`^test ${name} \\.\\.\\. (\\w+)`, 'm').exec(stdout);
    if (!m) f.push(`${where}: ${t.file}'s ${name} didn't run (cargo test -p ${t.pkg} --test ${t.target}; a file its #![cfg] compiles out runs nothing)`);
    else if (m[1] !== 'ok') f.push(`${where}: ${t.file}'s ${name} reports ${m[1]}`);
  }
  if (status !== 0) f.push(`${where}: cargo test -p ${t.pkg} --test ${t.target} exits ${status}: ${stdout.slice(-1500)} ${stderr.slice(-1500)}`);
  return f;
}

const packagesOf = (targets: Found[]): string[] => [...new Set(targets.map((t) => t.pkg))];

describe(`${ID} Rapier's own determinism tests at 0.36.1 pass with the pinned features, toolchain and flags on the Mac and on Linux, the portability test reproducing its 488,334-byte golden`, () => {
  it(`${ID} on the reference Mac: snapshot_portability (its 488,334-byte golden), simd_backend_determinism, simd_backend_parity and snapshot_roundtrip, upstream's bytes, pass under the physics build's features and rust-toolchain.toml's toolchain; a build with rapier3d/simd8 is caught`, () => {
    referenceMac();
    const targets = rapierTargets();
    none(packagesOf(targets).flatMap((pkg) => pinnedFeatureFailures(pkg)), 'the Rapier tests build with the physics build\'s resolved features');
    const off = packagesOf(targets).flatMap((pkg) => pinnedFeatureFailures(pkg, undefined, ['--features', 'rapier3d/simd8']));
    caught(off, 'a planted build of the Rapier tests with rapier3d/simd8');
    expect(off.join('\n'), 'the judge names simd8').toContain('simd8');

    const tc = spawnSync('rustc', ['-vV'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
    expect(rustcOf(tc.stdout ?? '').release, `the checkout's rustc is rust-toolchain.toml's channel: ${tc.stdout}${tc.stderr}`).toBe(channel());

    none(targets.flatMap((t) => {
      const r = cargo(['test', '--locked', '-p', t.pkg, '--test', t.target]);
      return libtestFailures(t, r.status, r.stdout, r.stderr, 'on this Mac');
    }), 'every one of Rapier\'s tests passes on the reference Mac');
  }, TIMEOUT);

  it(`${ID} on the Linux machine (the lane's pinned image as linux/amd64): the same files pass under the physics build's features for x86_64-unknown-linux-gnu and the same toolchain, built there and run with no network`, () => {
    referenceMac();
    const targets = rapierTargets();
    none(packagesOf(targets).flatMap((pkg) => pinnedFeatureFailures(pkg, LINUX_X86)), 'for x86_64-unknown-linux-gnu, the Rapier tests build with the physics build\'s resolved features');
    for (const pkg of packagesOf(targets)) laneBuild('linux/amd64', ['test', '--locked', '--no-run', '-p', pkg, ...targets.filter((t) => t.pkg === pkg).flatMap((t) => ['--test', t.target])]);

    const mac = rustcOf(spawnSync('rustc', ['-vV'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() }).stdout ?? '');
    const there = inLane('linux/amd64', ['rustc', '-vV'], { network: false, timeoutMs: 600_000 });
    const linux = rustcOf(there.stdout);
    expect(linux.host, `the lane's rustc is the x86_64 Linux toolchain: ${there.stdout}${there.stderr}`).toBe(LINUX_X86);
    expect(linux.release, 'the lane\'s rustc is rust-toolchain.toml\'s channel').toBe(channel());
    expect(linux.commit, 'the lane\'s rustc is the same release build as this Mac\'s').toBe(mac.commit);

    none(targets.flatMap((t) => {
      const r = inLane('linux/amd64', ['cargo', 'test', '--locked', '--offline', '-p', t.pkg, '--test', t.target], { network: false, timeoutMs: 3_600_000 });
      return r.timedOut ? [`on Linux x86_64: cargo test --test ${t.target} timed out`] : libtestFailures(t, r.status, r.stdout, r.stderr, 'on Linux x86_64');
    }), 'every one of Rapier\'s tests passes on the Linux machine');
  }, CONTAINER_TIMEOUT + 3_600_000);
});
