// #995.1c8866b5, written blind (README): the canvas panel keeps only the pictures a shown revision uses. The check is
// crates/deep-app/tests/sweep_995_panel.rs, one panel on gpui's headless test context (no window, GPU or display)
// presented 1,000 revisions of one document, each with its own new 1 MB picture, beside a second document kept shown.
// This file builds and runs it with cargo. A hand run allows two hours; a lane stops each vitest run after 20 minutes
// (scripts/proof-runs.mjs TIMEOUT), and a lane copy's cold deep-app test build past that reads as not run, never PASS.
// A build or setup that fails, or a test that panics short of its verdict, throws (not run), never reaches an expect.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const HOURS_2 = 2 * 60 * 60 * 1000;

it(
  '#995.1c8866b5 presenting 1,000 revisions, each with a new 1 MB picture, into one panel leaves the app\'s memory within 20 MB of its level after the first 10, and only the shown pictures held',
  () => {
    const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
    const env = {
      ...process.env,
      PATH: [join(cargoHome, 'bin'), process.env.PATH ?? '', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      CARGO_HOME: cargoHome,
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      CARGO_INCREMENTAL: '0',
      CARGO_PROFILE_DEV_DEBUG: '0',
    };
    const run = spawnSync(
      'cargo',
      ['test', '--locked', '-p', 'deep-app', '--test', 'sweep_995_panel', '--', '--nocapture', '--test-threads', '1'],
      { cwd: REPO, env, encoding: 'utf8', timeout: HOURS_2, maxBuffer: 256 * 1024 * 1024 },
    );
    const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const lines = out.split('\n');
    const fails = lines.filter((l) => /FAIL|BLOCKED|panicked|^error/.test(l));
    const readings = lines.filter((l) => l.startsWith('#995 memory'));
    console.log([...readings, ...fails].join('\n'));
    const tail = lines.slice(-40).join('\n');
    if (run.error) throw Error(`BLOCKED: cargo didn't run: ${run.error.message}`);
    if (!/^running 1 test$/m.test(out) || !/^test result: /m.test(out)) {
      throw Error(`BLOCKED: the sweep_995_panel test didn't build or run (cargo exited ${run.status}${run.signal ? `, signal ${run.signal}` : ''}):\n${lines.filter((l) => /^error|could not compile/.test(l)).slice(0, 20).join('\n') || tail}`);
    }
    // A Rust panic's message starts the line after libtest's `thread '…' panicked at <file>:<line>:<col>:` line, so a
    // compiler warning quoting a `BLOCKED:` or `FAIL #995:` source line never counts as one.
    const panic = (verdict: string): boolean => new RegExp(`panicked at [^\\n]*:\\n${verdict}`).test(out);
    if (panic('BLOCKED:')) throw Error(`BLOCKED: ${lines.filter((l) => l.startsWith('BLOCKED:')).join('\n')}`);
    // A failure counts only as the test's verdict, its one FAIL #995 assert; any other panic is not a run.
    if (run.status !== 0 && !panic('FAIL #995:')) throw Error(`BLOCKED: the panel test ended short of its verdict (cargo exited ${run.status}):\n${fails.join('\n') || tail}`);
    expect(run.status, `cargo exited ${run.status}\n${[...readings, ...fails].join('\n')}`).toBe(0);
    expect(/^test result: ok\. 1 passed/m.test(out), tail).toBe(true);
  },
  HOURS_2 + 60_000,
);
