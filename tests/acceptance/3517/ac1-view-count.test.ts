import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC1, FIXTURES, REPO, arr, blocked, buildEnv, cleanUpAfterTheFile, count, obj, proof, said, str, tempDir, type JsonValue } from './helpers.ts';

cleanUpAfterTheFile();

const CHECK = join('scripts', 'view-count.mjs');
const KEPT = join('crates', 'deep-app', 'view-count.json');
const POPULATION = [join('packs', 'examples'), join('tests', 'acceptance')];
const REFUSED_FIXTURE = 'tests/acceptance/3517/fixtures/needs-physics.json';
const REFUSED_FOR = 'module_missing: physics';
const PLANTED = 'packs/examples/planted-3517.json';

interface Checked { status: number | null; lines: string[]; told: string }

function viewCountCheck(root?: string): Checked {
  const args = [join(REPO, CHECK), ...(root ? ['--root', root] : [])];
  const r = spawnSync(process.execPath, args, { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_300_000, killSignal: 'SIGKILL' });
  if (r.error) throw blocked(`node ${CHECK} could not run: ${r.error.message}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  const told = `exit ${r.status}; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-600)}`;
  if (r.status === 3) throw blocked(`node ${CHECK} couldn't build or run the app: ${told}`);
  return { status: r.status, lines, told };
}

interface Kept { counted: number; refused: Map<string, string[]> }

function keptCount(root: string): Kept {
  const file = join(root, KEPT);
  expect(existsSync(file), `the count is kept in ${KEPT}`).toBe(true);
  const kept = obj(JSON.parse(readFileSync(file, 'utf8')) as JsonValue, KEPT);
  const refused = new Map<string, string[]>();
  for (const [reason, paths] of Object.entries(obj(kept['refused'], `${KEPT}: refused`))) {
    refused.set(reason, arr(paths, `${KEPT}: refused["${reason}"]`).map((p, i) => str(p, `${KEPT}: refused["${reason}"][${i}]`)));
  }
  return { counted: count(kept['counted'], `${KEPT}: counted`), refused };
}

function scratchTreeOfWhatTheCheckReads(): string {
  const tree = join(tempDir(), 'tree');
  for (const folder of POPULATION) {
    for (const entry of readdirSync(join(REPO, folder), { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.json') || entry.split(sep).includes('node_modules')) continue;
      const from = join(REPO, folder, entry);
      if (!lstatSync(from).isFile()) continue;
      mkdirSync(dirname(join(tree, folder, entry)), { recursive: true });
      copyFileSync(from, join(tree, folder, entry));
    }
  }
  if (existsSync(join(REPO, KEPT))) {
    mkdirSync(dirname(join(tree, KEPT)), { recursive: true });
    copyFileSync(join(REPO, KEPT), join(tree, KEPT));
  }
  return tree;
}

describe(`${AC1} the count is in the record for the examples and the fixtures, by reason`, () => {
  it(`${AC1} the kept count names each 3D document the app's view refuses under its reason, and the check finds it equal to what the view says of every example and fixture`, () => {
    const ran = viewCountCheck();
    expect(ran.status, `node ${CHECK} exits 0 on the checkout; ${ran.told}`).toBe(0);
    expect(ran.lines.filter((l) => l.startsWith('PASS view count:')).length, `node ${CHECK} prints one PASS view count line; ${ran.told}`).toBe(1);
    const kept = keptCount(REPO);
    const listed = [...kept.refused.values()].flat();
    proof('ac1-view-count.json', { counted: kept.counted, refused: Object.fromEntries([...kept.refused].map(([reason, paths]) => [reason, paths.length])) });
    said(`AC1 the count: ${kept.counted} 3D documents read, ${listed.length} refused: ${[...kept.refused].map(([reason, paths]) => `${reason} ${paths.length}`).join(', ')}`);
    expect(kept.counted, `${KEPT}: counted holds every refused document, ${listed.length} of them`).toBeGreaterThanOrEqual(listed.length);
    for (const [reason, paths] of kept.refused) {
      expect(reason.trim(), `${KEPT}: a reason is the text the view gives`).not.toBe('');
      expect(paths, `${KEPT}: the documents refused for "${reason}" are sorted`).toEqual([...paths].sort());
      for (const path of paths) {
        expect(POPULATION.some((folder) => path.startsWith(`${folder.split(sep).join('/')}/`)) && path.endsWith('.json'), `${KEPT}: ${path} is a JSON file under ${POPULATION.join(' or ')}`).toBe(true);
        expect(existsSync(join(REPO, path)), `${KEPT}: ${path} is a file of the checkout`).toBe(true);
      }
    }
    expect(kept.refused.get(REFUSED_FOR) ?? [], `${KEPT}: this suite's document that requires physics is counted under "${REFUSED_FOR}"`).toContain(REFUSED_FIXTURE);
  }, 3_600_000);

  it(`${AC1} planted example: one more document the view refuses, which the count leaves out, fails the check, naming the document`, () => {
    const tree = scratchTreeOfWhatTheCheckReads();
    copyFileSync(join(FIXTURES, 'needs-physics.json'), join(tree, PLANTED));
    const ran = viewCountCheck(tree);
    const failures = ran.lines.filter((l) => l.startsWith('FAIL view count:'));
    said(`AC1 the planted example: ${JSON.stringify(failures)}`);
    expect(ran.status, `node ${CHECK} --root <a copy with ${PLANTED} planted> exits 1; ${ran.told}`).toBe(1);
    expect(failures, `the check names the planted document and why the view refuses it; ${ran.told}`).toContain(`FAIL view count: ${PLANTED}: the view refuses it (${REFUSED_FOR}) and the count leaves it out`);
    const kept = keptCount(REPO);
    expect([...failures].sort(), 'the planted document is the check\'s only finding, with the count it moves').toEqual([
      `FAIL view count: ${PLANTED}: the view refuses it (${REFUSED_FOR}) and the count leaves it out`,
      `FAIL view count: counted ${kept.counted + 1}, the file says ${kept.counted}`,
    ].sort());
  }, 3_600_000);
});
