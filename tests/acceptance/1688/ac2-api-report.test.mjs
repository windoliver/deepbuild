import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, EXTENSION_API, REPORT, REPORT_DIR, atBase, base, git, plantFile, run, sandboxOnly, shown } from './helpers.mjs';

const ID = '#1688.9c597d35';

test(`${ID} AC2: the API report in ${REPORT_DIR} is unchanged from the merge base, and the change's extension API still gives it`, { timeout: 600_000 }, async (t) => {
  const was = git(CHECKOUT, ['ls-tree', '-r', '--name-only', base(), '--', REPORT_DIR]).stdout.split('\n').filter(Boolean).sort();
  assert.ok(was.includes(REPORT), `${REPORT} is not at the merge base ${base()}`);
  const dir = join(CHECKOUT, REPORT_DIR);
  const now = existsSync(dir) ? readdirSync(dir, { recursive: true }).map((f) => `${REPORT_DIR}/${f}`).filter((f) => statSync(join(CHECKOUT, f)).isFile()).sort() : [];
  assert.deepEqual(now, was, `the files of ${REPORT_DIR} differ from the merge base's`);
  const differ = was.filter((f) => readFileSync(join(CHECKOUT, f), 'utf8') !== atBase(f));
  assert.deepEqual(differ, [], `files of ${REPORT_DIR} changed against the merge base ${base()}`);

  const sandbox = sandboxOnly(t);
  const root = join(sandbox, 'root');
  plantFile(root, EXTENSION_API, readFileSync(join(CHECKOUT, EXTENSION_API), 'utf8'));
  plantFile(root, REPORT, atBase(REPORT));
  const r = await run(CHECKOUT, sandbox, ['scripts/api-surface.mjs', '--root', root]);
  t.diagnostic(shown(r, 8));
  assert.deepEqual(r.lines.filter((l) => l.startsWith('FAIL api')), [], `the report API Extractor makes of the change's ${EXTENSION_API} differs from the merge base's ${REPORT}\n${shown(r)}`);
  const extractor = r.lines.filter((l) => /^BLOCKED api: .*(API Extractor|report)/.test(l));
  assert.deepEqual(extractor, [], `API Extractor did not make the report, so it was not compared\n${shown(r)}`);
  assert.ok(r.status === 0 || r.lines.some((l) => /^BLOCKED api: .*(cargo-semver-checks|no commit at HEAD)/.test(l)), `scripts/api-surface.mjs stopped before or while comparing the TypeScript report\n${shown(r)}`);
});
