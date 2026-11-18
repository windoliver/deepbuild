// #1812 AC5 (README, The exit lint): the lint lane reads, from the code, a table of every exit a `deep` command can
// reach, and that table holds only 0 to 3; `deep lease` and `deep mcp-exec`, which exit with their child's own status,
// are left out by name (the owner's comment). The lint is `node scripts/exit-lint.mjs [--root <checkout>]`. A planted
// exit of 4, laid in a scratch copy of this checkout, must fail it, naming the file and line.
import { spawnSync } from 'node:child_process';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CHECKOUT, NODE, SECOND, cleanup, tempDir } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.58b07a01';
const LINT = join(CHECKOUT, 'scripts/exit-lint.mjs');
/** Where the plant goes: the CLI's entry, which every command runs through. */
const ENTRY = 'packages/cli/src/main.ts';

interface Linted { status: number | null; output: string; rows: { code: number; at: string }[]; fails: string[] }
/** The lint over `root` (this checkout when undefined): its table rows, `exit <n> <path>:<line>`, and its FAIL lines. */
function lint(root?: string): Linted {
  expect(existsSync(LINT), `${LINT} is missing: the lint lane reads no table of the exits a command can reach`).toBe(true);
  const r = spawnSync(NODE, [LINT, ...(root ? ['--root', root] : [])], { cwd: CHECKOUT, encoding: 'utf8', timeout: 600 * SECOND, maxBuffer: 64 * 1024 * 1024 });
  const output = `exit ${r.status}${r.error ? ` (${r.error.message})` : ''}, stdout ${JSON.stringify((r.stdout ?? '').slice(-4000))}, stderr ${JSON.stringify((r.stderr ?? '').slice(-2000))}`;
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((line) => line.trim());
  const rows = lines.flatMap((line) => {
    const m = /^exit (\d+)\s+(\S+:\d+)\b/.exec(line);
    return m ? [{ code: Number(m[1]), at: m[2]! }] : [];
  });
  return { status: r.status, output, rows, fails: lines.filter((line) => line.startsWith('FAIL')) };
}

/**
 * A scratch copy of this checkout for the lint's --root: every top-level entry but .git, node_modules, target, tests,
 * docs, crates and vendor, cloned; its node_modules a folder of links, each workspace package's link as the checkout has
 * it (relative, so it leads to the copy's own packages), every other package linked to the checkout's (#1359's way).
 */
function scratchCheckout(): string {
  const dir = join(tempDir(), 'c');
  mkdirSync(dir);
  const skip = new Set(['.git', 'node_modules', 'target', 'tests', 'docs', 'crates', 'vendor']);
  for (const name of readdirSync(CHECKOUT)) {
    if (skip.has(name)) continue;
    cpSync(join(CHECKOUT, name), join(dir, name), {
      recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
      filter: (source) => !/[\\/](?:node_modules|target)(?:[\\/]|$)/.test(source.slice(CHECKOUT.length)),
    });
  }
  const link = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const path = join(from, name);
      const s = lstatSync(path);
      if (s.isSymbolicLink() && !isAbsolute(readlinkSync(path))) symlinkSync(readlinkSync(path), join(to, name));
      else if (name.startsWith('@') && s.isDirectory()) link(path, join(to, name));
      else symlinkSync(path, join(to, name));
    }
  };
  link(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

describe(`${ID} the exits a command can reach, read from the code by the lint lane`, () => {
  it(`${ID} the lint lane prints the table of every exit a command can reach, and it holds only 0 to 3`, async () => {
    const { status, output, rows, fails } = lint();
    expect(fails, `the lint over this checkout lists exits outside 0 to 3:\n${output}`).toEqual([]);
    expect(status, `the lint over this checkout must pass:\n${output}`).toBe(0);
    expect(rows.length, `the lint prints its table, a line "exit <n> <path>:<line>" for each exit a command can reach:\n${output}`).toBeGreaterThan(0);
    const outside = rows.filter((row) => row.code > 3);
    expect(outside, `the table holds exits outside 0 to 3:\n${output}`).toEqual([]);
    expect([...new Set(rows.map((row) => row.code))].sort(), `the commands' exits 0, 1, 2 and 3 are each in the table:\n${output}`).toEqual([0, 1, 2, 3]);
    expect(rows.some((row) => row.at.startsWith(`${ENTRY}:`)), `the table reads the CLI's entry, ${ENTRY}:\n${output}`).toBe(true);
    expect(rows.some((row) => row.at.startsWith('packages/hub/src/')), `the table reads the hub's commands, under packages/hub/src/:\n${output}`).toBe(true);
    const { checks } = (await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)) as { checks: { name: string; commands: unknown[][] }[] };
    const lane = checks.find(({ name }) => name === 'lint');
    expect(lane?.commands.some((command) => command.some((part) => String(part).replaceAll('\\', '/').endsWith('scripts/exit-lint.mjs'))), 'the lint lane (scripts/lanes.mjs checks, name lint) runs scripts/exit-lint.mjs').toBe(true);
  }, 900 * SECOND);

  it(`${ID} a planted exit of 4 fails the lint, naming the file and line`, () => {
    const at = scratchCheckout();
    const entry = join(at, ENTRY);
    const text = readFileSync(entry, 'utf8').replace(/\n?$/, '\n');
    const line = text.split('\n').length + 1;
    writeFileSync(entry, `${text}// Planted by tests/acceptance/1812 (README, The plants): a command that exits 4, outside the table.\nif (process.argv[2] === 'dh1812-exits-4') process.exit(4);\n`);
    const { status, output, fails } = lint(at);
    expect(fails.some((fail) => fail.includes(`${ENTRY}:${line}`)), `the lint must fail the planted exit of 4 on a FAIL line naming ${ENTRY}:${line}:\n${output}`).toBe(true);
    expect(status, `the lint fails, exit 1, on the planted exit of 4:\n${output}`).toBe(1);
  }, 900 * SECOND);
});
