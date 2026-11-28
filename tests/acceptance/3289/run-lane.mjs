import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, out, ...files] = process.argv.slice(2);
const lines = [];
let summary;
const entries = (map) => Object.fromEntries(map ?? []);
try {
  const { prepareRuns, before, removeTemporaries } = await import(pathToFileURL(join(root, 'scripts/proof-runs.mjs')).href);
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const change = { root, base: head, head, commits: [], whole: files.map((path) => ({ path, status: 'A', hunks: [] })) };
    const runs = prepareRuns({ root, change, issue: null });
    before(runs, new Map(), (state, lane, detail) => lines.push(`${state} ${lane}: ${detail}`), (line) => lines.push(line));
    summary = {
      files: runs.files, byHand: runs.byHand, unrun: runs.unrun ?? [],
      base: { blocked: runs.base.blocked ?? null, unrunnable: entries(runs.base.unrunnable), fileErrors: entries(runs.base.fileErrors) },
      head: { unrunnable: entries(runs.head.unrunnable), fileErrors: entries(runs.head.fileErrors) },
      tests: runs.tests.map((test) => ({
        key: test.key, path: test.path, name: test.name, tags: test.tags, status: test.status, failure: test.failure, twinsError: test.twinsError ?? null,
        base: runs.base.results.get(test.key) ?? null,
        twins: (test.twins ?? []).map(({ tag, twin, key }) => {
          const laid = runs.twins.get(key);
          return {
            tag, twin, key, ran: Boolean(laid), stale: laid?.stale ?? null, refused: laid?.refused ?? null,
            unrunnable: laid?.unrunnable.get(test.path) ?? null, fileError: laid?.fileErrors.get(test.path) ?? null, result: laid?.results.get(test.key) ?? null,
          };
        }),
      })),
    };
  } finally {
    const left = removeTemporaries();
    if (left) lines.push(`cleanup: ${left}`);
  }
} catch (error) {
  summary = { error: String(error?.stack ?? error) };
}
writeFileSync(out, JSON.stringify({ ...summary, lines }, null, 2));
