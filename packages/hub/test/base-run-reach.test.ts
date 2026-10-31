// A fix claim's base run through a real hub, where the check is one the command check kind reads: it reaches the
// stand-in of its declared surface (#874), and a claim can't turn the assertion rule off by editing what the check runs (#875).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allEvents, Session, settle, sleep, startHub, stopHub, type Ev } from '../../../tests/acceptance/29/h-d.ts';
import { ASK, CHECK, draft, HEALTH_LINE, makeWorld, NEW_APP, PACKAGE, SERVER, type World874 } from '../../../tests/acceptance/874/helpers.ts';

const TEST = 'test/health.test.mjs';

/** Asserts only 200, which a stand-in also answers: the app's handler where no surface is served to the run. */
function healthTest(reach: string): string {
  return `import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
test('GET /health answers 200', async () => {
  const status = (await (async () => { ${reach} return (await (await import(pathToFileURL(join(process.cwd(), 'app.mjs')).href)).handle('GET', '/health')).status; })());
  assert.equal(status, 200);
});
`;
}
const line = (bytes: string): number => bytes.split('\n').findIndex((l) => l.includes('assert.equal')) + 1;

function handed(w: World874, surface: object | undefined, check: string, asserts: string[]): void {
  writeFileSync(join(w.repo, CHECK), check, { mode: 0o755 });
  const [r] = (draft(asserts, 'ok') as { requirements: Record<string, unknown>[] }).requirements;
  const { surface: _, ...rest } = r!;
  writeFileSync(w.drafts, JSON.stringify({ drafts: [{ ...draft(asserts, 'ok'), requirements: [{ ...rest, ...(surface ? { surface } : {}) }] }] }));
}

/** Types ASK, waits for the lock, does the agent's writes and stops; returns the reasons of the claim's verdicts once its head and base runs ended. */
async function claim(w: World874, writes: Record<string, string>): Promise<{ events: Ev[]; verdicts: { outcome: unknown; reasons: unknown }[] }> {
  const hub = await startHub(w);
  try {
    const s = new Session(w);
    await s.start();
    await s.typed(ASK);
    await settle(hub, (e) => e.some((x) => x.kind === 'definition.locked'), 60_000);
    await s.read(CHECK);
    for (const [file, content] of Object.entries(writes)) {
      const path = join(w.repo, file);
      mkdirSync(dirname(path), { recursive: true });
      const r = await s.call('Write', { file_path: path, content }, { response: { type: 'create', filePath: path, content, structuredPatch: [], originalFile: null }, effect: () => writeFileSync(path, content) });
      if (!r.allowed) throw Error(`BLOCKED: the Write of ${file} must be allowed`);
    }
    await s.stop('Done.');
    await settle(hub, (e) => {
      const made = e.find((x) => x.kind === 'claim.made');
      const started = e.filter((x) => x.kind === 'run.started' && x.data.claim === `claim:${made?.id}`).map((x) => String(x.data.run));
      const finished = new Set(e.filter((x) => x.kind === 'run.finished').map((x) => String(x.data.run)));
      return started.length >= 2 && started.every((run) => finished.has(run));
    }, 180_000);
    await sleep(2000);
    const events = await allEvents(hub);
    return { events, verdicts: events.filter((e) => e.kind === 'verdict.made').map((e) => ({ outcome: e.data.outcome, reasons: e.data.reasons })) };
  } finally {
    await stopHub(hub);
  }
}

const APP = { 'package.json': PACKAGE, 'server.mjs': SERVER, 'app.mjs': NEW_APP };

describe('a readable check on the base', () => {
  it('reaches a service stand-in at DEEP_SURFACE_URL, so a check that passes there is INVALID', async () => {
    const w = makeWorld('empty', 'ok');
    const bytes = healthTest("if (process.env.DEEP_SURFACE_URL) return (await fetch(new URL('/health', process.env.DEEP_SURFACE_URL))).status;");
    mkdirSync(join(w.repo, 'test'));
    writeFileSync(join(w.repo, TEST), bytes);
    handed(w, { kind: 'service', routes: ['/health'], format: 'json' }, `#!/bin/sh\nnode --test ${TEST}\n`, [`${TEST}:${line(bytes)}`]);
    const { verdicts } = await claim(w, APP);
    expect(JSON.stringify(verdicts)).toContain('passes on its stand-in');
  }, 300_000);

  it('reaches a command stand-in on its PATH, so a check that passes there is INVALID', async () => {
    const w = makeWorld('empty', 'ok');
    const bytes = healthTest("if (process.env.PATH.split(':').some((dir) => existsSync(join(dir, 'shopctl')))) return 200;");
    mkdirSync(join(w.repo, 'test'));
    writeFileSync(join(w.repo, TEST), bytes);
    handed(w, { kind: 'command', name: 'shopctl' }, `#!/bin/sh\nnode --test ${TEST}\n`, [`${TEST}:${line(bytes)}`]);
    const { events, verdicts } = await claim(w, APP);
    expect(JSON.stringify(verdicts), JSON.stringify(events.filter((e) => e.kind.startsWith('run.') || e.kind.includes('stood')).map((e) => [e.kind, e.data.check, e.data.outcome, e.data.cause, e.data.failures, e.data.stderr]))).toContain('passes on its stand-in');
  }, 300_000);
});

describe('what a claim edits', () => {
  it('a claim that turns the check\'s program into a plain shell script still has its base run judged by where it failed', async () => {
    const w = makeWorld('starts', 'ok');
    const run = join(w.repo, 'tools/run-tests');
    mkdirSync(dirname(run));
    writeFileSync(run, "#!/usr/bin/env node\nimport('node:child_process').then(({ spawnSync }) => process.exit(spawnSync(process.execPath, ['--test', 'test/cart.test.mjs'], { stdio: 'inherit' }).status ?? 1));\n");
    chmodSync(run, 0o755);
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.home, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' };
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: w.repo, encoding: 'utf8', env }).trim();
    git('add', 'tools/run-tests');
    git('commit', '-q', '--amend', '--no-edit');
    w.base = git('rev-parse', 'HEAD');
    handed(w, undefined, '#!/bin/sh\n./tools/run-tests\n', []);
    const { verdicts } = await claim(w, {
      'src/discount.mjs': 'export const discount = () => 10;\n',
      'test/cart.test.mjs': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { discount } from '../src/discount.mjs';\ntest('discount', () => assert.equal(discount(), 10));\n",
      'tools/run-tests': '#!/bin/sh\nexec node --test test/cart.test.mjs\n',
      'app.mjs': `export function handle(method, path) {\n${HEALTH_LINE}  return { status: 404, body: {} };\n}\n`,
    });
    expect(verdicts.map((v) => v.outcome), `verdicts ${JSON.stringify(verdicts)}`).toContain('INVALID');
    expect(JSON.stringify(verdicts)).toContain('failed on the base');
  }, 300_000);
});
