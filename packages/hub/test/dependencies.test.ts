// A dependency's registry reading and a bare install's names (#1509). The blind suite (tests/acceptance/1509) proves
// the npm runs and the ask through deep-hook and the hub; these hold what it leaves out: PyPI's document read for a
// version's and a name's first upload, a range named no single version, a registry that can't be reached said as
// couldn't check, and the names a requirements file and a package.json add since the base, read from git.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addedSince, readingWords, readRegistry, settled } from '../src/dependencies.js';

const DAY = 86_400_000;
const now = Date.now();
const iso = (ago: number) => new Date(now - ago).toISOString();
const DOCS: Record<string, unknown> = {
  '/left-pad': { 'dist-tags': { latest: '1.3.0' }, time: { created: iso(1200 * DAY), modified: iso(DAY), '1.0.0': iso(1200 * DAY), '1.3.0': iso(1100 * DAY) } },
  '/pypi/ruff/json': {
    info: { version: '0.5.0' },
    releases: { '0.4.0': [{ upload_time_iso_8601: iso(400 * DAY) }], '0.5.0': [{ upload_time_iso_8601: iso(2 * DAY) }, { upload_time_iso_8601: iso(DAY) }] },
  },
};

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    const doc = DOCS[req.url ?? ''];
    res.writeHead(doc ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(doc ?? {}));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe('the registry reading (#1509)', () => {
  it("reads PyPI's first upload of the version and of the name, and names a version under a week old as new", async () => {
    const r = await readRegistry('pypi', 'ruff', base);
    expect(r).toMatchObject({ name: 'ruff', version: '0.5.0', published: now - 2 * DAY, first: now - 400 * DAY });
    expect(settled(r, now)).toBe(false);
    expect(readingWords(r, 'pypi', now)).toBe('PyPI says ruff 0.5.0 was published 2 days ago, so it is new (under 7 days), and the name ruff was first published 13 months ago.');
    const pinned = await readRegistry('pypi', 'ruff@0.4.0', base);
    expect(settled(pinned, now), JSON.stringify(pinned)).toBe(true);
  });

  it("reads npm's latest and its time, past a week old for both", async () => {
    const r = await readRegistry('npm', 'left-pad', base);
    expect(r).toMatchObject({ version: '1.3.0', published: now - 1100 * DAY, first: now - 1200 * DAY });
    expect(settled(r, now)).toBe(true);
  });

  it("says couldn't check for a range, a name it doesn't know and a registry that can't be reached, never a pass", async () => {
    const range = await readRegistry('pypi', 'ruff@>=0.4', base);
    const unknown = await readRegistry('npm', 'no-such-pkg', base);
    const down = await readRegistry('npm', 'left-pad', 'http://127.0.0.1:1');
    for (const r of [range, unknown, down]) {
      expect(settled(r, now), JSON.stringify(r)).toBe(false);
      expect(readingWords(r, 'npm', now)).toMatch(/^DeepBuild couldn't check the npm registry for /);
    }
  });
});

describe("a bare install's names since the base (#1509)", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh1509t-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: dir });

  it('counts the names a requirements file and a package.json add since the base, and none when nothing was added', async () => {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.31.0\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } }));
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const manifests = [join(dir, 'requirements.txt'), join(dir, 'package.json')];
    expect(await addedSince(manifests)).toEqual([]);
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.31.0\n# a comment\n-r more.txt\nFlask_Login>=0.6  # login\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' }, devDependencies: { 'is-odd': '^3.0.1' } }));
    expect(await addedSince(manifests)).toEqual(['flask-login', 'is-odd']);
  });
});
