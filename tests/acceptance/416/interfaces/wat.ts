// This suite's assembler (README: Run): #190's (tests/acceptance/190/wat/src/main.rs, used in place) under this
// folder's wat/Cargo.toml and Cargo.lock. #190's own `assemble` reads BLOCKED on this base: its lockfile's
// [[patch.unused]] list predates patches the checkout's .cargo/config.toml has since gained, so `cargo build --locked`
// there wants to rewrite it. Cargo reads .cargo/config.toml from its working directory's ancestors, so this one is
// built from the system's temporary folder: no [patch] table of the checkout's applies, today's or a later one, and the
// lockfile holds none. Its toolchain is rust-toolchain.toml's channel.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, blocked, sha256, type Program } from '../../190/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout's cargo target folder (honoring CARGO_TARGET_DIR). */
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUSTUP_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '', '.cargo', 'bin')].filter((d) => existsSync(d));
/** Cargo's environment, as #190's helpers give it: no incremental build, no debug info, rustup's cargo on PATH. */
export const cargoEnv = (more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUSTUP_BINS.length ? { PATH: `${RUSTUP_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
  ...more,
});

let bin = '';
function assembler(): string {
  if (bin) return bin;
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? blocked('rust-toolchain.toml names no channel');
  const target = join(TARGET, 'acceptance-416-wat');
  const run = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(HERE, 'wat', 'Cargo.toml')], {
    cwd: tmpdir(), encoding: 'utf8', maxBuffer: 1 << 26, env: cargoEnv({ CARGO_TARGET_DIR: target, RUSTUP_TOOLCHAIN: channel }),
  });
  if (run.error || run.status !== 0) blocked(`this suite's assembler (wat/) didn't build: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  bin = join(target, 'debug', process.platform === 'win32' ? 'acceptance-416-wat.exe' : 'acceptance-416-wat');
  return bin;
}

const assembled = new Map<string, Program>();
/** WebAssembly text as a whole module (`module`) or a relocatable object (`program`, `library`: #190's README). */
export function assemble(name: string, text: string, form: 'module' | 'program' | 'library' = 'module'): Program {
  const key = `${form}\n${name}\n${text}`;
  const known = assembled.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-416-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, ...(form === 'module' ? [] : [`--${form}`]), file], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(key, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
