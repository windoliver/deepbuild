// Test-side tools for the blind redraft of #2086's criteria: the criteria's IDs, the environment every cargo child
// gets, the INCONCLUSIVE rule, and how a child's output says the machine failed rather than the program. Nothing here
// reads a lint or runs a suite in the program's place: clippy, the lint lane's reader and #1732's suite do that.

import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** The checkout root (this folder is three levels down). */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The first 8 hex digits of SHA-256 of each criterion's trimmed, whitespace-collapsed text (README). */
export const AC1 = 'AC1 #2086.248ca2cc';
export const AC2 = 'AC2 #2086.a865933b';

/** Homebrew's rustup, which isn't on PATH on the reference Macs; its cargo is rustup's proxy, so the checkout's pin applies. */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';

/**
 * Settings through which the caller's environment, not the checkout, could switch a lint off, change rustc's flags,
 * pick another toolchain or lint another platform. An untouched checkout of main is linted as the checkout says.
 */
const CALLERS = /^(?:RUSTFLAGS|RUSTDOCFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS|CLIPPY_CONF_DIR|CLIPPY_ARGS|RUSTUP_TOOLCHAIN|CARGO_BUILD_TARGET)$/;

/**
 * The environment of every child that may start cargo or rustup: the caller's, without the settings above, rustup's
 * proxies first on PATH, no toolchain installed or downloaded (rustup's servers are a closed local port), no colour.
 */
export function cargoEnv(): NodeJS.ProcessEnv {
  const own = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CALLERS.test(name)));
  return {
    ...own,
    PATH: `${RUSTUP_BIN}${delimiter}${process.env['PATH'] ?? ''}`,
    RUSTUP_AUTO_INSTALL: '0',
    RUSTUP_DIST_SERVER: 'http://127.0.0.1:9',
    RUSTUP_UPDATE_ROOT: 'http://127.0.0.1:9/rustup',
    NO_COLOR: '1',
    CARGO_TERM_COLOR: 'never',
  };
}

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

/** No problems; the message lists them. */
export function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.join('\n  ')}`).toEqual([]);
}

/**
 * Output that says the machine, not the program, stopped a cargo run: a compiler or build script ended by a signal (the
 * system kills one under memory pressure), a full disk, no memory, no toolchain or no clippy for it, crates that can't be
 * fetched, or the compiler crashing. Returns the line that says so, or null.
 */
const WORLD = [
  /\(signal: \d+, SIG\w+/,
  /No space left on device|Cannot allocate memory|Too many open files|Resource temporarily unavailable/,
  /toolchain '[^']+' is not installed|is not installed for the toolchain|no such command: `?clippy/,
  /failed to (?:download|fetch|get `|load source for dependency|update registry)|Could not resolve host|spurious network error/,
  /internal compiler error|the compiler unexpectedly panicked/,
];
export function worldLine(output: string): string | null {
  for (const pattern of WORLD) {
    const line = output.split('\n').find((l) => pattern.test(l));
    if (line !== undefined) return line.trim().slice(0, 400);
  }
  return null;
}
