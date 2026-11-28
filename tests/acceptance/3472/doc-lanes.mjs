// The doc lanes CONTRIBUTING.md names (design links and names, catalogue drift, public text), run as
// tests/acceptance/1336/ and 1352/ run them: each lane's own commands, from its entry in scripts/lanes.mjs, against
// one list of the open issues, and a lane that fails held to what the base commit's docs give under the same commands
// (README.md, The doc lanes). Changed from theirs in two ways, each read against this base. The base's folder also
// holds AGENTS.md and the scripts' names, which the design links lane's principles check reads from its working
// folder and without which it stops before it prints a finding. And each lane is judged by itself, so a lane that
// can't run doesn't hide what another finds. Kept apart from the test file so a planted folder can stand in.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE, CHECKOUT, git, said } from './helpers.mjs';

/** The doc lanes, each the one entry of `checks` its pattern picks. */
const LANES = [
  { key: 'catalogue drift', match: /catalogue|drift/i, base: true, needs: 'packages/contracts/dist/index.js', build: 'npm ci && npm run build -w @deepbuild/contracts' },
  { key: 'design links and names', match: /\blinks?\b/i, not: /catalogue|drift/i, base: true },
  // Public text scans the change itself, against origin/main, so the base has nothing to compare: it must pass.
  { key: 'public text', match: /\bpublic\b/i, base: false },
];

/**
 * Each finding a lane prints, without line numbers (they move when lines are added): each indented line under a FAIL
 * line, and the items of a FAIL line that lists them after a colon, part by part. The design links lane's FAIL line
 * only counts what the indented lines name.
 */
export const findings = (output) => output.split('\n').flatMap((line) => {
  if (/^\s+\S/.test(line)) return [line.trim()];
  if (!line.startsWith('FAIL ') || /^FAIL \d+ links/.test(line)) return [];
  return line.slice(5).split('; ').flatMap((part) => (part.includes(': ') ? part.slice(part.indexOf(': ') + 2).split(', ') : [part]));
}).map((item) => item.replace(/(\.(?:md|txt)):\d+(?:,\d+)*/g, '$1'));

/** Writes under `dir` what the lanes read of the base from their working folder: each doc at the top of docs/, AGENTS.md, and scripts/, its lists whole and every other file by name alone. */
export function baseFolder(dir) {
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const show = (path) => {
    const shown = git(['show', `${BASE}:${path}`]);
    if (shown.status !== 0) throw new Error(`git show ${BASE}:${path} failed (the checkout needs the base commit): ${said(shown)}`);
    return shown.stdout;
  };
  const list = (...args) => {
    const listed = git(['ls-tree', '--name-only', ...args]);
    if (listed.status !== 0) throw new Error(`git ls-tree ${args.join(' ')} failed (the checkout needs the base commit): ${said(listed)}`);
    return listed.stdout.split('\n').filter(Boolean);
  };
  for (const path of list('-r', BASE, '--', 'scripts')) put(path, path.endsWith('.txt') ? show(path) : '');
  for (const path of [...list(BASE, 'docs/').filter((file) => /^docs\/[^/]+\.md$/.test(file)), 'AGENTS.md']) put(path, show(path));
}

// A lane's commands, with `cwd` as their working folder; its scripts always come from this checkout.
function run(lane, cwd, env) {
  let output = '', status = 0;
  for (const [command, ...args] of lane.commands) {
    const r = spawnSync(command, args.map((a) => (a.startsWith('scripts/') ? join(CHECKOUT, a) : a)), { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900_000 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`;
    status ||= r.status ?? 1;
  }
  return { output, status };
}
const inconclusive = (output) => output.split('\n').find((line) => /^INCONCLUSIVE\b/.test(line));

/**
 * Runs the three doc lanes with `cwd` as their working folder, against the open issues in the file `issues`, and
 * returns `{ failures, unrun }`, one line each. A lane passes, or every finding it prints is one the same commands
 * print in `baseDir`, the base's folder; public text has no base and must pass. A lane that prints INCONCLUSIVE, or
 * that needs a build this checkout lacks, or whose run on the base printed no result, is unrun: never a pass.
 */
export async function runDocLanes({ cwd = CHECKOUT, baseDir, issues, log = () => {} }) {
  const env = { ...process.env, DEEP_OPEN_ISSUES: issues };
  const { checks } = await import(pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href);
  const failures = [], unrun = [];
  for (const { key, match, not, base, needs, build } of LANES) {
    const found = checks.filter((l) => match.test(l.name) && !(not && not.test(l.name)));
    if (found.length !== 1) {
      failures.push(`scripts/lanes.mjs has ${found.length} lanes for the ${key} lane, of ${checks.map((l) => l.name).join(', ')}`);
      continue;
    }
    const lane = found[0];
    if (needs && !existsSync(join(CHECKOUT, needs))) {
      unrun.push(`the ${lane.name} lane reads ${needs}, which this checkout has not built (${build})`);
      continue;
    }
    const now = run(lane, cwd, env);
    log(`${lane.name} (exit ${now.status}):\n${now.output}`);
    if (inconclusive(now.output)) {
      unrun.push(`the ${lane.name} lane couldn't read all it checks: ${inconclusive(now.output)}`);
      continue;
    }
    if (now.status === 0) continue;
    const mine = findings(now.output);
    if (!base || !mine.length) {
      failures.push(`${lane.name} fails:\n${now.output.trim()}`);
      continue;
    }
    const before = run(lane, baseDir, env);
    if (before.status !== 0 && !/^FAIL /m.test(before.output)) {
      unrun.push(`the ${lane.name} lane fails here, and its run on the base's docs printed no result to hold that to: ${before.output.trim().replace(/\s+/g, ' ').slice(0, 300)}`);
      continue;
    }
    const held = new Set(findings(before.output));
    const brought = mine.filter((finding) => !held.has(finding));
    if (brought.length) failures.push(`${lane.name} finds what the base's docs don't give:\n  ${brought.join('\n  ')}`);
  }
  return { failures, unrun };
}
