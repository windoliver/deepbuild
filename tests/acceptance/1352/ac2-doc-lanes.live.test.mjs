// Criterion 2, live half (needs network and gh signed in with read access to windoliver/deepbuild): with the new
// section in the design, the doc lanes (catalogue drift, design links and names, public text) find nothing the change
// brings. Each lane's own commands, from its entry in scripts/lanes.mjs, run on this checkout against one fetch of the
// open issues. A lane that fails passes this test only when the base commit's docs, read by the same commands against
// the same issues, give every finding it gives (open issues the change didn't touch can fail on main). Signed out or
// offline, or when a lane can't read all it checks, it skips as INCONCLUSIVE; it never passes then.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { BASE, CHECKOUT, NO_SECTION, findSection, readDesign } from './helpers.mjs';

// The doc lanes CONTRIBUTING.md names, each the one entry of `checks` its pattern picks.
const LANES = [
  { key: 'catalogue drift', match: /catalogue|drift/i, base: true },
  { key: 'design links', match: /\blinks?\b/i, not: /catalogue|drift/i, base: true },
  // Public text scans the change itself (against origin/main), so the base has nothing to compare: it must pass.
  { key: 'public text', match: /\bpublic\b/i, base: false },
];

const git = (args) => spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
// A lane's commands, with cwd at `cwd`; its scripts always come from this checkout.
function run(lane, cwd, env) {
  let output = '', status = 0;
  for (const [command, ...args] of lane.commands) {
    const r = spawnSync(command, args.map((a) => (a.startsWith('scripts/') ? join(CHECKOUT, a) : a)), { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`;
    status ||= r.status ?? 1;
  }
  return { output, status };
}
// Each finding a lane prints, without line numbers (they move when lines are added): the items of a one-line FAIL and
// each indented line under it.
const findings = (output) => output.split('\n').flatMap((line) => {
  const items = line.startsWith('FAIL ') && !/^FAIL \d+ links/.test(line) ? line.slice(line.indexOf(': ') + 2).split(', ') : /^\s+\S/.test(line) ? [line.trim()] : [];
  return items.map((i) => i.replace(/(\.(?:md|txt)):\d+(?:,\d+)*/g, '$1'));
});

test('#1352.7a887cd4 criterion 2 (live): with the new section in the design, the doc lanes (catalogue drift, design links and names, public text) find nothing the change brings', async (t) => {
  const section = findSection(readDesign());
  assert.ok(section, `${NO_SECTION}: the doc lanes have no new section to hold the design against`);
  const gh = spawnSync('gh', ['issue', 'list', '--repo', 'windoliver/deepbuild', '--state', 'open', '--limit', '5000', '--json', 'number,body'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (gh.status !== 0) {
    t.skip(`INCONCLUSIVE: gh couldn't list the open issues (signed out or offline), so the doc lanes can't read them: ${`${gh.error?.message ?? ''}${gh.stderr ?? ''}`.trim()}`);
    return;
  }
  if (!existsSync(join(CHECKOUT, 'packages/contracts/dist/index.js'))) {
    t.skip('INCONCLUSIVE: the catalogue drift lane reads packages/contracts/dist, which this checkout has not built (npm ci && npm run build -w @deepbuild/contracts)');
    return;
  }
  const temp = mkdtempSync(join(tmpdir(), 'deep-1352-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  writeFileSync(join(temp, 'open-issues.json'), gh.stdout);
  const env = { ...process.env, DEEP_OPEN_ISSUES: join(temp, 'open-issues.json') };
  // The base's docs and planned names, for the lanes that read them from their cwd.
  const baseDir = join(temp, 'base');
  for (const file of [...git(['ls-tree', '-r', '--name-only', BASE, 'docs']).stdout.split('\n').filter((f) => f.endsWith('.md')), 'scripts/planned-names.txt']) {
    const shown = git(['show', `${BASE}:${file}`]);
    if (shown.status !== 0) continue;
    mkdirSync(dirname(join(baseDir, file)), { recursive: true });
    writeFileSync(join(baseDir, file), shown.stdout);
  }
  const { checks } = await import(pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href);
  const report = [];
  for (const { key, match, not, base } of LANES) {
    const found = checks.filter((l) => match.test(l.name) && !(not && not.test(l.name)));
    assert.equal(found.length, 1, `scripts/lanes.mjs has ${found.length} lanes for the ${key} lane, of ${checks.map((l) => l.name).join(', ')}`);
    const lane = found[0], now = run(lane, CHECKOUT, env);
    t.diagnostic(`${lane.name}, this checkout (exit ${now.status}):\n${now.output}`);
    if (/^INCONCLUSIVE\b/m.test(now.output)) {
      t.skip(`INCONCLUSIVE: the ${lane.name} lane couldn't read all it checks:\n${now.output}`);
      return;
    }
    if (now.status === 0) continue;
    const mine = findings(now.output);
    if (!base || !mine.length) { report.push(`${lane.name} fails:\n${now.output}`); continue; }
    const before = new Set(findings(run(lane, baseDir, env).output));
    const brought = mine.filter((f) => !before.has(f));
    if (brought.length) report.push(`${lane.name} finds what the base's docs don't give:\n  ${brought.join('\n  ')}`);
  }
  assert.deepEqual(report, [], 'the doc lanes find what the change brings');
});
