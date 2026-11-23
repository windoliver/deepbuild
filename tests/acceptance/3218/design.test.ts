// #3218 AC10: the Lease section of docs/technical-design.md states the rule, each decision the issue takes with what
// wasn't taken, and what a pool with units can never do, and the doc lanes pass.
//
// The section is the one under the heading `#### Lease`, to the next heading of its level or higher, so its own
// subheadings belong to it. "States" is read as a floor, not a reading of the text (a person judges the words): for
// each item the section holds the words any statement of it has to use, taken from the issue's own wording (README,
// How each criterion is read), and it says "Not taken" once for each of the seven decisions.
//
// The doc lanes are the three CONTRIBUTING.md names (design links and names, catalogue drift, public text), each run
// with its own commands from scripts/lanes.mjs against one fetch of the open issues, as #1352's suite runs them: a lane
// passes, or every finding it prints is also printed when the same commands read the merge base's docs (open issues
// this change didn't touch can fail on main); public text scans the change, so it must pass. Offline, signed out of
// gh, or with packages/contracts unbuilt, the lanes can't be read: INCONCLUSIVE, which fails, never a pass.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { git, gitEnv, inconclusive, mergeBase, REPO, tempDir } from './helpers.ts';

const AC10 = '#3218.7172f4c8';
const DESIGN = 'docs/technical-design.md';

/** The Lease section's text: from `#### Lease` to the next heading of level 4 or higher, outside fenced code. */
function leaseSection(text: string): string | undefined {
  const lines = text.split('\n');
  let fenced = false;
  let start = -1;
  for (const [i, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (start < 0) {
      if (heading && heading[1] === '####' && heading[2] === 'Lease') start = i;
    } else if (heading && heading[1]!.length <= 4) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start < 0 ? undefined : lines.slice(start).join('\n');
}

// The rule, each decision with what wasn't taken, and what a pool with units can never do: the words each needs.
const RULE: [string, RegExp[]][] = [
  ['the rule: a lease on a pool(n) kind carries units, and an ask past the pool\'s size is BLOCKED', [/\bunits\b/, /\bpool\(n\)/, /\bBLOCKED\b/]],
];
const DECISIONS: [string, RegExp[]][] = [
  ['a lease on a pool takes k of its n (not a second table for amounts; not k leases of one unit each)', [/\bsecond table\b/i, /\bone unit\b/i]],
  ['n is the host\'s capacity, read when the kind is declared (not an n that follows a live reading)', [/\bcapacity\b/i, /\bdeclared\b/i, /\blive reading\b|\bfree memory\b/i]],
  ['a lease\'s units are fixed for its life (not resizing)', [/\bfixed\b/i, /\bresiz(?:e|es|ed|ing)\b/i]],
  ['all or none across kinds, one ask decided on one read of the log (not one kind at a time)', [/\ball or none\b|\ball-or-none\b/i, /\bone kind at a time\b/i]],
  ['first in line holds (not serving whichever fits)', [/\bfirst in line\b/i, /\bwhichever fits\b/i]],
  ['job tokens stay a pipe (not tokens as units)', [/\btokens? as units\b/i]],
  ['one kind follows now: mem, in MB; cpu.slot, browser and stack stay counts; GPU memory gets a kind when a reading shows it binding', [/\bmem\b/, /\bMB\b/, /\bGPU memory\b/i]],
];
const NEVER: [string, RegExp[]][] = [
  ['sum past n on a host', [/\bsums? past\b/i]],
  ['count units across hosts', [/\bacross hosts\b/i]],
  ['take units on a kind that isn\'t a pool', [/\b(?:isn't|is not|that isn't|not) a pool\b/i]],
  ['be granted in part', [/\bin part\b|\bpartly\b|\bpartial(?:ly)?\b/i]],
  ['wait for more than its pool holds', [/\bmore than (?:its|the) pool\b/i]],
  ['have its units named or raised by an agent\'s call', [/\braised\b/i, /\bagent's call\b|\bagent\b/i]],
];
const missing = (body: string, items: [string, RegExp[]][]): string[] => items.filter(([, words]) => !words.every((w) => w.test(body)))
  .map(([item, words]) => `${item}: missing ${words.filter((w) => !w.test(body)).join(', ')}`);

const NO_SECTION = `${DESIGN} has no \`#### Lease\` section`;

describe(`AC10 ${AC10} the Lease section states the rule, the decisions and what a pool with units can never do`, () => {
  it(`AC10 ${AC10} the Lease section states the rule, each of the seven decisions with what wasn't taken, and the six things a pool with units can never do`, () => {
    const now = leaseSection(readFileSync(join(REPO, DESIGN), 'utf8'));
    expect(now, NO_SECTION).toBeDefined();
    const before = leaseSection(git('show', `${mergeBase()}:${DESIGN}`));
    expect(now, 'the Lease section changed from the merge base\'s').not.toBe(before);
    const unstated = [...missing(now!, RULE), ...missing(now!, DECISIONS), ...missing(now!, NEVER)];
    expect(unstated, `the Lease section doesn't state these:\n  ${unstated.join('\n  ')}`).toEqual([]);
    const notTaken = now!.match(/\bnot taken\b/gi)?.length ?? 0;
    expect(notTaken, `the Lease section says "Not taken" ${notTaken} times; each of the ${DECISIONS.length} decisions needs what wasn't taken`).toBeGreaterThanOrEqual(DECISIONS.length);
  });

  it(`AC10 ${AC10} (live) the doc lanes (design links and names, catalogue drift, public text) find nothing the change brings`, async () => {
    const now = leaseSection(readFileSync(join(REPO, DESIGN), 'utf8'));
    const before = leaseSection(git('show', `${mergeBase()}:${DESIGN}`));
    expect(now !== undefined && now !== before, 'the Lease section changed from the merge base\'s, for the doc lanes to hold').toBe(true);
    const gh = spawnSync('gh', ['issue', 'list', '--repo', 'windoliver/deepbuild', '--state', 'open', '--limit', '5000', '--json', 'number,body'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (gh.status !== 0) inconclusive(`gh couldn't list the open issues (signed out or offline), so the doc lanes can't read them: ${`${gh.error?.message ?? ''}${gh.stderr ?? ''}`.trim()}`);
    if (!existsSync(join(REPO, 'packages/contracts/dist/index.js'))) inconclusive('the catalogue drift lane reads packages/contracts/dist, which this checkout has not built (npm run build -w @deepbuild/contracts)');
    const temp = tempDir();
    writeFileSync(join(temp, 'open-issues.json'), gh.stdout);
    const env = { ...gitEnv(), DEEP_OPEN_ISSUES: join(temp, 'open-issues.json') };
    // The merge base's docs and planned names, for the lanes that read them from their working folder.
    const baseDir = join(temp, 'base');
    const base = mergeBase();
    for (const file of [...git('ls-tree', '-r', '--name-only', base, 'docs').split('\n').filter((f) => f.endsWith('.md')), 'scripts/planned-names.txt']) {
      let shown: string;
      try { shown = git('show', `${base}:${file}`); } catch { continue; }
      mkdirSync(dirname(join(baseDir, file)), { recursive: true });
      writeFileSync(join(baseDir, file), shown);
    }
    const run = (commands: string[][], cwd: string): { output: string; status: number } => {
      let output = '';
      let status = 0;
      for (const [command, ...args] of commands) {
        const r = spawnSync(command!, args.map((a) => (a.startsWith('scripts/') ? join(REPO, a) : a)), { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000 });
        output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`;
        status ||= r.status ?? 1;
      }
      return { output, status };
    };
    // Each finding a lane prints, without line numbers.
    const findings = (output: string): string[] => output.split('\n').flatMap((line) => {
      const items = line.startsWith('FAIL ') && !/^FAIL \d+ links/.test(line) ? line.slice(line.indexOf(': ') + 2).split(', ') : /^\s+\S/.test(line) ? [line.trim()] : [];
      return items.map((i) => i.replace(/(\.(?:md|txt)):\d+(?:,\d+)*/g, '$1'));
    });
    const { checks } = (await import(pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href)) as { checks: { name: string; commands: string[][] }[] };
    const report: string[] = [];
    for (const { name, compare } of [{ name: 'design links and names', compare: true }, { name: 'catalogue drift', compare: true }, { name: 'public text', compare: false }]) {
      const lane = checks.find((l) => l.name === name);
      expect(lane, `scripts/lanes.mjs has the ${name} lane, of ${checks.map((l) => l.name).join(', ')}`).toBeDefined();
      const got = run(lane!.commands, REPO);
      console.log(`${name} (exit ${got.status}):\n${got.output}`);
      if (/^INCONCLUSIVE\b/m.test(got.output)) inconclusive(`the ${name} lane couldn't read all it checks:\n${got.output}`);
      if (got.status === 0) continue;
      const mine = findings(got.output);
      if (!compare || !mine.length) { report.push(`${name} fails:\n${got.output}`); continue; }
      const was = new Set(findings(run(lane!.commands, baseDir).output));
      const brought = mine.filter((f) => !was.has(f));
      if (brought.length) report.push(`${name} finds what the merge base's docs don't give:\n  ${brought.join('\n  ')}`);
    }
    expect(report, 'the doc lanes find what the change brings').toEqual([]);
  }, 1_800_000);
});
