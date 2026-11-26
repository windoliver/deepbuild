// The doc lanes CONTRIBUTING.md names (catalogue drift, design links and names, public text), run for criterion 2 as
// the design-only suites before this one run them: each lane's own commands, from its entry in scripts/lanes.mjs,
// against one file of open issues. A lane passes, or every finding it prints is one the same commands print for the
// base commit's files against the same issues. README.md (The doc lanes) says why.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE, CHECKOUT, baseFile, git } from './helpers.mjs';

// Each lane is the one entry of `checks` its pattern picks. Public text scans the change itself, so the base has
// nothing to compare and it must pass. Catalogue drift imports the contracts package's build.
const LANES = [
  { key: 'catalogue drift', match: /catalogue|drift/i, compared: true, needs: 'packages/contracts/dist/index.js', build: 'npm ci && npm run build -w @deepbuild/contracts' },
  { key: 'design links and names', match: /\blinks?\b/i, not: /catalogue|drift/i, compared: true },
  { key: 'public text', match: /\bpublic\b/i, compared: false },
];

// A lane's commands with `cwd` as their working folder; its scripts always come from this checkout.
function run(lane, cwd, env) {
  let output = '', status = 0;
  for (const [command, ...args] of lane.commands) {
    const r = spawnSync(command, args.map((arg) => (arg.startsWith('scripts/') ? join(CHECKOUT, arg) : arg)), { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`;
    status ||= r.status ?? 1;
  }
  return { output, status };
}

/**
 * Each finding a lane prints, without line numbers (they move when lines are added): each indented line under a FAIL
 * line, and the items of a FAIL line that lists them itself, as catalogue drift's does (`FAIL <what>: a, b; <what>: c`).
 */
export const findings = (output) => output.split('\n').flatMap((line) => {
  const items = /^\s+\S/.test(line) ? [line.trim()]
    : line.startsWith('FAIL ') && !/^FAIL \d+ (?:links|studied|dependency)\b/.test(line) ? line.slice(5).split('; ').flatMap((part) => part.slice(part.indexOf(': ') + 2).split(', '))
      : [];
  return items.map((item) => item.replace(/(\.(?:md|txt)):\d+(?:,\d+)*/g, '$1'));
});

/**
 * The base commit's files the lanes read from their working folder, written under `dir`: each docs/*.md, AGENTS.md
 * (the design links lane holds the Principles to its invariants) and the two lists of names. That lane also asks
 * whether each script the Principles name is a file, so this checkout's other scripts stand in by link.
 */
function baseTree(dir) {
  const docs = git(['ls-tree', '--name-only', BASE, 'docs/']).stdout.split('\n').filter((file) => /^docs\/[^/]+\.md$/.test(file));
  for (const file of [...docs, 'AGENTS.md', 'scripts/planned-names.txt', 'scripts/not-event-kinds.txt']) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), baseFile(file));
  }
  for (const name of readdirSync(join(CHECKOUT, 'scripts'))) {
    if (!existsSync(join(dir, 'scripts', name))) symlinkSync(join(CHECKOUT, 'scripts', name), join(dir, 'scripts', name));
  }
  return dir;
}

/**
 * Runs the three lanes in `cwd` against the open issues in the file `issues`, keeping the base's files under `temp`.
 * `brought` is what the change brings, one entry a lane; `unrun` names each lane that couldn't run or couldn't read all
 * it checks; `log` is each lane's output.
 */
export async function docLanes({ issues, temp, cwd = CHECKOUT }) {
  const env = { ...process.env, DEEP_OPEN_ISSUES: issues };
  const { checks } = await import(pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href);
  const brought = [], unrun = [], log = [];
  let base;
  for (const { key, match, not, compared, needs, build } of LANES) {
    const found = checks.filter((lane) => match.test(lane.name) && !(not && not.test(lane.name)));
    if (found.length !== 1) {
      brought.push(`scripts/lanes.mjs has ${found.length} lanes for the ${key} lane, of ${checks.map((lane) => lane.name).join(', ')}`);
      continue;
    }
    const [lane] = found;
    if (needs && !existsSync(join(CHECKOUT, needs))) {
      unrun.push(`the ${lane.name} lane reads ${needs}, which this checkout has not built (${build})`);
      continue;
    }
    const now = run(lane, cwd, env);
    log.push(`${lane.name} (exit ${now.status}):\n${now.output}`);
    const unread = now.output.split('\n').find((line) => line.startsWith('INCONCLUSIVE'));
    if (unread) {
      unrun.push(`the ${lane.name} lane couldn't read all it checks: ${unread}`);
      continue;
    }
    if (now.status === 0) continue;
    const mine = findings(now.output);
    if (!compared || !mine.length) {
      brought.push(`${lane.name} fails:\n${now.output}`);
      continue;
    }
    base ??= baseTree(join(temp, 'base'));
    const before = new Set(findings(run(lane, base, env).output));
    const news = mine.filter((finding) => !before.has(finding));
    if (news.length) brought.push(`${lane.name} finds what the base's files don't give:\n  ${news.join('\n  ')}`);
  }
  return { brought, unrun, log };
}
