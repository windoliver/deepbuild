// AC1 #2086.248ca2cc: "`cargo clippy --workspace --all-targets --locked -- -D warnings` exits 0 on main, or every
// finding left is one `scripts/known-failures.json` lists under `lint`, and the lint lane reads no new lint failure on
// an untouched checkout of main"
//
// asserts, in order (README: How each clause is read):
//   - the lint lane of scripts/lanes.mjs runs the issue's clippy command, exactly, and nothing in the checkout switches a
//     lint off for the workspace (the issue's Scope): no `allow` in Cargo.toml's [workspace.lints], no -A, --allow or
//     --cap-lints in .cargo/config's rustflags, no clippy.toml clippy reads for a workspace member;
//   - every finding left: the issue's command with --keep-going, so cargo goes on past a crate that fails, exits 0, or
//     each finding it prints, read into the lane's keys by scripts/affected.mjs's lintFindings, is listed under `lint`
//     as many times as it is found; no error is left that the reader can't name; and no library fails, which would
//     leave the crates that depend on it unlinted;
//   - the lint lane reads no new lint failure: the lane's own clippy command, run as scripts/lanes.mjs lists it, read
//     through lintFindings and classify (scripts/affected.mjs) against scripts/known-failures.json, as affected.mjs and
//     main-watch.mjs read the lane: nothing new, nothing unsure.
// A machine failure (no toolchain or clippy, a killed compiler, a full disk, crates that can't be fetched, a run past
// four hours) reads INCONCLUSIVE, never PASS.
// Wrong programs (twins.json): `err-past-limit`, an example in deep-canvas whose function returns an operator error
// carrying the found value unboxed, past clippy's Err size limit: a new result_large_err finding no entry lists, so the
// every-finding-left assertion fails naming it; `limit-raised`, the same with a root clippy.toml raising clippy's
// limit, which hides the finding: the switched-off assertion fails naming the file.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AC1, REPO, cargoEnv, inconclusive, none, worldLine } from './helpers.ts';

/** The issue's command, as the lint lane must run it. */
const ISSUE = ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'];
/** The same with --keep-going, so a crate that fails doesn't hide the findings of those that don't depend on it. */
const EVERY = ['clippy', '--workspace', '--all-targets', '--locked', '--keep-going', '--', '-D', 'warnings'];
/** A whole-workspace clippy takes minutes warm and hours cold on a loaded Mac. */
const RUN_LIMIT = 4 * 3_600_000;

interface Finding { state: string; key: string }
interface Judged { id: string; state: string; message: string }
interface Baseline { failures: Record<string, string>; lint: Record<string, number>; timing: string[] }
interface Affected {
  lintFindings: (cwd: string, name: string, output: string, status: number | null) => Finding[];
  classify: (failures: Judged[], findings: Finding[], baseline: Baseline) => { known: Judged[]; fresh: Judged[]; unsure: Judged[] };
}

/** A cargo command at the root, under the lease at nice 10, as the lanes run heavy commands; diagnostics then output. */
function cargo(args: string[]): { status: number; output: string } {
  const what = `cargo ${args.join(' ')}`;
  const run = spawnSync('sh', [join(REPO, 'scripts', 'lease'), 'nice', '-n', '10', 'cargo', ...args], { cwd: REPO, env: cargoEnv(), encoding: 'utf8', maxBuffer: 1 << 30, timeout: RUN_LIMIT, killSignal: 'SIGKILL' });
  if (run.error) inconclusive(`${what} didn't run to its end: ${run.error.message}`);
  if (run.status === null) inconclusive(`${what} was ended by ${run.signal}`);
  const output = `${run.stderr ?? ''}\n${run.stdout ?? ''}`;
  // The lease, not cargo, says BLOCKED or INCONCLUSIVE when it can't run the command.
  const world = run.status === 0 ? null : (worldLine(output) ?? /^(?:BLOCKED|INCONCLUSIVE)\b.*$/m.exec(output)?.[0]);
  if (world) inconclusive(`${what} was stopped by the machine, not the program: ${world}`);
  return { status: run.status, output };
}

/** The issue's Scope: what in the checkout would switch a lint off for the whole workspace. */
function switchedOff(members: string[]): string[] {
  const problems: string[] = [];
  let section = '';
  for (const raw of readFileSync(join(REPO, 'Cargo.toml'), 'utf8').split('\n')) {
    const line = raw.replace(/^\s*#.*$/, '').trim();
    const header = /^\[+\s*([^\]]+?)\s*\]+$/.exec(line);
    if (header) section = header[1]!;
    else if (/^workspace\.lints\b/.test(`${section}.${line.split('=')[0]!.trim()}`) && /["']allow["']/.test(line)) problems.push(`Cargo.toml [${section}] ${line}: a lint allowed for the workspace`);
  }
  for (const name of ['.cargo/config.toml', '.cargo/config']) {
    if (!existsSync(join(REPO, name))) continue;
    const text = readFileSync(join(REPO, name), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const [flag] of text.matchAll(/["'](?:-A|--allow\b|--cap-lints\b)[^"']*["']/g)) problems.push(`${name} passes rustc ${flag}: a lint switched off for every crate it builds`);
  }
  const seen = new Set<string>();
  for (const member of members) {
    for (let dir = member; ; dir = dirname(dir)) {
      for (const name of ['clippy.toml', '.clippy.toml']) {
        const file = join(dir, name);
        if (!seen.has(file) && existsSync(file)) problems.push(`${relative(REPO, file)}: clippy reads it for ${relative(REPO, member) || '.'}, a clippy configuration for the workspace the base has none of (a raised limit or an allowance there switches a lint off)`);
        seen.add(file);
      }
      if (dir === REPO || dirname(dir) === dir) break;
    }
  }
  return problems;
}

/** Error lines the lane's reader can't place at a file and line, but cargo's own summaries of the placed ones. */
const SUMMARY = /^error: (?:could not compile `[^`]+` \([^)]*\) due to \d+ previous errors?(?:; \d+ warnings? emitted)?$|\d+ targets? failed:?$|aborting due to)/;
function unplaced(output: string): string[] {
  const lines = output.split('\n');
  return lines.flatMap((line, i) => (/^error(?:\[[\w:]+\])?: /.test(line) && !SUMMARY.test(line) && !/^\s*--> /.test(lines[i + 1] ?? '') ? [line.slice(0, 300)] : []));
}
/** Libraries clippy failed: cargo lints none of the crates that depend on one, so their findings go unread. */
const failedLibraries = (output: string): string[] => [...output.matchAll(/^error: could not compile `([^`]+)` \((lib|build script|proc-macro)\)/gm)].map(([, name, kind]) => `${name} (${kind})`);

describe(`${AC1} workspace clippy on main exits 0 or leaves only listed findings, and the lint lane reads no new lint failure`, () => {
  it(`${AC1} cargo clippy --workspace --all-targets --locked -- -D warnings leaves no finding scripts/known-failures.json doesn't list under lint, and the lint lane's own run reads no new lint failure`, async () => {
    // The checkout's own toolchain, with clippy, is installed; nothing here installs one.
    const version = spawnSync('cargo', ['clippy', '--version'], { cwd: REPO, env: cargoEnv(), encoding: 'utf8' });
    if (version.status !== 0) inconclusive(`the checkout's toolchain has no clippy here: ${`${version.stderr ?? ''}${version.error?.message ?? ''}`.trim().split('\n')[0]}`);

    // The lint lane runs the issue's command, unchanged.
    const { checks } = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { checks: { name: string; commands: string[][] }[] };
    const lane = checks.find(({ name }) => name === 'lint');
    expect(lane, 'scripts/lanes.mjs has a lint lane').toBeDefined();
    const clippyCommands = lane!.commands.filter(([command, sub]) => command === 'cargo' && sub === 'clippy');
    expect(clippyCommands, 'the lint lane runs workspace clippy exactly as the issue names it, once').toEqual([ISSUE]);

    // No lint switched off for the workspace (the issue's Scope).
    const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked'], { cwd: REPO, env: cargoEnv(), encoding: 'utf8', maxBuffer: 1 << 28 });
    if (metadata.status !== 0) inconclusive(`cargo metadata didn't answer: ${(metadata.stderr ?? '').trim().split('\n')[0]}`);
    const members = (JSON.parse(metadata.stdout) as { packages: { manifest_path: string }[] }).packages.map(({ manifest_path }) => dirname(manifest_path));
    expect(members.length, 'the workspace has members').toBeGreaterThan(0);
    none(switchedOff(members), 'nothing in the checkout switches a lint off for the workspace');

    const baseline = JSON.parse(readFileSync(join(REPO, 'scripts/known-failures.json'), 'utf8')) as Baseline;
    const { lintFindings, classify } = (await import(pathToFileURL(join(REPO, 'scripts/affected.mjs')).href)) as Affected;

    // Every finding left: the issue's command, going on past a crate that fails.
    const every = cargo(EVERY);
    if (every.status !== 0) {
      const found = lintFindings(REPO, 'clippy', every.output, every.status).filter(({ state }) => state === 'FAIL');
      expect(found.length, `clippy exited ${every.status}, so the lane's reader names what failed:\n${every.output.slice(-3000)}`).toBeGreaterThan(0);
      const counts = new Map<string, number>();
      for (const { key } of found) counts.set(key, (counts.get(key) ?? 0) + 1);
      const unlisted = [...counts].filter(([key, n]) => n > (baseline.lint[key] ?? 0)).map(([key, n]) => `${key} (found ${n}, listed ${baseline.lint[key] ?? 0})`);
      none(unlisted, `clippy exited ${every.status}, and every finding left is one scripts/known-failures.json lists under lint, as many times as found (${found.length} found)`);
      none(unplaced(every.output), 'no error is left that the lane\'s reader can\'t place at a file and line');
      none(failedLibraries(every.output), 'no library fails clippy, which would leave every crate that depends on it unlinted');
    }

    // The lint lane reads no new lint failure: its own clippy command, read as affected.mjs and main-watch.mjs read it.
    const run = cargo(clippyCommands[0]!.slice(1));
    const findings = lintFindings(REPO, 'lint', run.output, run.status);
    const failing = findings.filter(({ state }) => state === 'FAIL');
    if (run.status !== 0) expect(failing.length, `the lane's clippy exited ${run.status}, so its reader names what failed:\n${run.output.slice(-3000)}`).toBeGreaterThan(0);
    const { known, fresh, unsure } = classify([], findings, baseline);
    expect(known.length + fresh.length, 'the lane\'s reader judges every finding it read').toBe(failing.length);
    none([...fresh, ...unsure].map(({ id, state }) => `${state} ${id}`), `the lint lane's clippy (exit ${run.status}) reads no new lint failure: ${known.length} known`);
  }, 2 * 4 * 3_600_000 + 600_000);
});
