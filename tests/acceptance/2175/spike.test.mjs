// Acceptance tests for issue #2175, the deep-hook start-cost spike, on its public record alone: docs/spikes/2175/
// (the table, the record file, the measuring script, the recommendation) and the release deep-hook's `nm -u`.
// The timed measurement is never rerun here and no model runs.
// Run: node --test tests/acceptance/2175/spike.test.mjs   (needs the Rust toolchain; builds deep-hook once)
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = join(REPO, 'docs/spikes/2175');
const AC1 = 'AC1 #2175.4aade462';
const AC2 = 'AC2 #2175.720f6375';
const AC3 = 'AC3 #2175.247c2609';

const files = (ext) => (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(ext)).map((f) => join(DIR, f)) : []);
const git = (...a) => spawnSync('/usr/bin/git', a, { cwd: REPO, encoding: 'utf8' });
const recordPath = () => files('.json').find((f) => /record/.test(f)) ?? files('.json')[0];
const loadRecord = () => {
  const p = recordPath();
  assert.ok(p, 'docs/spikes/2175/ holds a record file (.json)');
  return JSON.parse(readFileSync(p, 'utf8'));
};
const walk = (v, visit) => {
  visit(v);
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, visit));
};

let imported;
const importedSymbols = () => {
  if (imported) return imported;
  const env = { ...process.env, PATH: `${process.env.PATH}:/usr/sbin:${process.env.HOME}/.cargo/bin` };
  execFileSync('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook'], { cwd: REPO, env, stdio: 'pipe' });
  const out = execFileSync('nm', ['-u', join(REPO, 'target/release/deep-hook')], { encoding: 'utf8' });
  imported = [...new Set(out.split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith(':')).map((l) => l.split(/\s+/).pop().replace(/^_/, '')))];
  return imported;
};

test(`${AC1} every symbol \`nm -u\` prints for the release deep-hook is a table row under docs/spikes/2175/ with code and paths cells`, () => {
  const docs = files('.md');
  assert.ok(docs.length > 0, 'docs/spikes/2175/ holds a markdown file with the table');
  const rows = docs.flatMap((f) => readFileSync(f, 'utf8').split('\n')).filter((l) => l.trim().startsWith('|') && !/^\|[\s:|-]+\|?$/.test(l.trim()));
  const syms = importedSymbols();
  assert.ok(syms.length > 0, 'nm -u prints imported symbols');
  const bad = [];
  for (const s of syms) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])_?${s.replace(/[$.]/g, '\\$&')}($|[^A-Za-z0-9_])`);
    const ok = rows.some((r) => {
      const cells = r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      return cells.length >= 3 && re.test(cells[0]) && cells.slice(1).filter((c) => c.length > 0).length >= 2;
    });
    if (!ok) bad.push(s);
  }
  assert.deepEqual(bad, [], `symbols missing from the table, or without non-empty code and paths cells (${bad.length} of ${syms.length})`);
});

test(`${AC2} the record holds, per cut, --version and forwarded-Read instructions-retired readings, 15 or more a side`, () => {
  const rec = loadRecord();
  const text = JSON.stringify(rec);
  assert.match(text, /--version/, 'record names the --version workload');
  assert.match(text, /read/i, 'record names the forwarded Read workload');
  assert.match(text, /instructions/i, 'record says the metric is instructions retired');
  const series = [];
  walk(rec, (v) => {
    if (Array.isArray(v) && v.length >= 15 && v.every((x) => typeof x === 'number' && x > 0)) series.push(v);
  });
  // At least the two cuts the issue names, each with two workloads and two sides.
  assert.ok(series.length >= 8, `at least 8 reading series of 15+ runs (2 cuts x 2 workloads x 2 sides); found ${series.length}`);
});

test(`${AC2} the base side is the merge base, an ancestor of HEAD, and the runs were interleaved`, () => {
  const text = JSON.stringify(loadRecord());
  assert.match(text, /interleav/i, 'record says the runs were interleaved');
  const mb = git('merge-base', 'HEAD', 'origin/main').stdout.trim();
  assert.match(mb, /^[0-9a-f]{40}$/, 'a merge base with origin/main exists');
  const shas = [...new Set(text.match(/\b[0-9a-f]{7,40}\b/g) ?? [])];
  const named = shas.filter((s) => git('cat-file', '-e', `${s}^{commit}`).status === 0 && git('merge-base', '--is-ancestor', s, 'HEAD').status === 0);
  assert.ok(named.length > 0, 'record names a commit (an ancestor of HEAD) as the base side');
  assert.ok(named.some((s) => git('rev-parse', s).stdout.trim() === mb || git('merge-base', '--is-ancestor', s, mb).status === 0), 'the named base is the merge base or an ancestor of it');
});

test(`${AC2} the measuring script is under docs/spikes/2175/ and the record gives the command that runs it`, () => {
  const scripts = [...files('.mjs'), ...files('.sh')];
  assert.ok(scripts.length > 0, 'a measuring script (.mjs or .sh) sits under docs/spikes/2175/');
  const text = JSON.stringify(loadRecord());
  assert.ok(scripts.some((s) => text.includes(s.split('/').pop())), 'the record names the measuring script in its command');
  assert.match(text, /command/i, 'the record has the command that measures');
});

test(`${AC3} a recommendation names the cuts worth an issue of their own, or says none is`, () => {
  const heading = /^#+\s*.*recommend.*$/im;
  const docs = files('.md').map((f) => readFileSync(f, 'utf8'));
  const body = docs.find((d) => heading.test(d));
  assert.ok(body, 'a markdown file under docs/spikes/2175/ has a Recommendation heading');
  const rest = body.slice(heading.exec(body).index);
  const section = rest.split('\n').slice(1).join('\n').split(/^#+\s/m)[0];
  assert.ok(section.trim().length >= 20, 'the recommendation section has content');
  assert.match(section, /\bnone\b|\bno cut\b|\bnot worth\b|\bissue\b/i, 'it names cuts for an issue, or says none is');
});
