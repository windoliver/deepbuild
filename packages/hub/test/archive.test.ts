// The transcript archive ships on by default (#20): a hub that starts copies each transcript under the agents' folders
// and the CI runs of the GitHub repos its sessions worked in, with no setting. The forge is a fake of GitHub's Actions
// REST routes on 127.0.0.1, named by DEEP_HUB_TEST_FORGE; nothing else is faked.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord } from '@deepbuild/record';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const DAY = 86_400_000;
const SESSION = '7d2e4f60-2222-4333-8444-555566667777';
const LOG = 'npm test\n12 passing\n';

/** GitHub's runs list, a run's jobs and a job's log (through a 302, as GitHub sends it) for octo/shop run 41, job 7. */
async function forge(): Promise<{ api: string; close(): void }> {
  const server = createServer((req, res) => {
    const json = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/repos/octo/shop/actions/runs') return json({ total_count: 1, workflow_runs: new URL(req.url ?? '/', 'http://x').searchParams.get('page') === '1' ? [{ id: 41, status: 'completed', conclusion: 'success' }] : [] });
    if (path === '/repos/octo/shop/actions/runs/41/jobs') return json({ total_count: 1, jobs: [{ id: 7, run_id: 41, status: 'completed', conclusion: 'success' }] });
    if (path === '/repos/octo/shop/actions/jobs/7/logs') { res.writeHead(302, { location: '/_download/7' }); return res.end(); }
    if (path === '/_download/7') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(LOG); }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}

describe('the archive in the hub', () => {
  it('runs at start with no setting: copies a transcript and the CI run of a repo a session worked in', async () => {
    const fake = await forge();
    const env = { GH_TOKEN: 'test-token-not-a-secret', DEEP_HUB_TEST_FORGE: fake.api };
    try {
      await withHub(async (root, home, { restart }) => {
        const work = join(home, 'work');
        mkdirSync(work, { recursive: true });
        execFileSync('git', ['init', '-q', work]);
        execFileSync('git', ['-C', work, 'remote', 'add', 'origin', 'git@github.com:octo/shop.git']);
        const folder = join(home, '.claude', 'projects', work.replace(/[^0-9A-Za-z]/g, '-'));
        mkdirSync(folder, { recursive: true });
        const transcript = join(folder, `${SESSION}.jsonl`);
        writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'm1', message: { role: 'user', content: 'fix the checkout total' } })}\n`);
        const payload = { session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'startup' };
        expect(await send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', payload, { ppid: process.pid }))).toContain('"ack"');
        // The session's worktree is in the record now; the next start's pass reads its repo's runs.
        await restart(env);
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          const kinds = () => (db.prepare("SELECT kind, data FROM events WHERE kind IN ('transcript.archived', 'ci.archived')").all() as { kind: string; data: string }[]);
          for (const until = Date.now() + 15_000; Date.now() < until && kinds().length < 2; await new Promise((r) => setTimeout(r, 100)));
          const copies = kinds().map((r) => ({ kind: r.kind, data: JSON.parse(r.data) as Record<string, unknown> }));
          expect(copies.find((c) => c.kind === 'transcript.archived')?.data.session, 'the transcript was archived by the hub').toBe(`session:${SESSION.replace(/-/g, '')}`);
          const ci = copies.find((c) => c.kind === 'ci.archived')?.data;
          expect(ci && [ci.repo, ci.run, ci.result], "the repo's CI run was copied, found from the session's worktree").toEqual(['octo/shop', '41', 'success']);
        } finally {
          db.close();
        }
      }, env);
    } finally {
      fake.close();
    }
  }, 60_000);
});

describe("the hub's retention", () => {
  it('keeps a CI log a ci.archived event links past 30 days, beside an uncited file it removes', async () => {
    const home = realpathSync(mkdtempSync('/tmp/hub-20-'));
    const root = join(home, '.deepbuild');
    const t0 = Date.now();
    try {
      const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => t0 });
      const record = await openRecord({ path: join(root, 'ledger.db'), now: () => t0, evidence: store });
      const writer = store.connect({ role: 'deepbuild', via: 'capture' });
      const put = async (text: string) => {
        const stored = await writer.put({ bytes: new Uint8Array(Buffer.from(text)), kind: 'ci.log', source: 'test', redaction: 'complete', license: { name: 'session', allows: [] } });
        if (stored.status !== 'stored') throw Error(stored.reason);
        return stored.evidence.sha256;
      };
      const [log, uncited] = [await put(LOG), await put('a log nobody links\n')];
      await record.append({ writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' }, { v: 1, id: ulid(t0), kind: 'ci.archived', ts: t0, data: { repo: 'octo/shop', run: '41', result: 'success', logs: [{ job: '7', evidence: log }] }, evidence: [log] });
      await record.close();
      const file = (sha: string) => join(root, 'evidence', sha.slice(0, 2), sha.slice(2));
      // 31 days on, the hub starts and runs its retention pass.
      const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home, DEEP_HUB_TEST_CLOCK: String(t0 + 31 * DAY) }, stdio: ['ignore', 'pipe', 'inherit'] });
      try {
        for (const until = Date.now() + 15_000; Date.now() < until && existsSync(file(uncited)); await new Promise((r) => setTimeout(r, 100)));
        expect(existsSync(file(uncited)), 'the retention pass ran: the uncited file is gone').toBe(false);
        expect(existsSync(file(log)), 'the CI log ci.archived links is kept').toBe(true);
      } finally {
        hub.kill('SIGTERM');
        await new Promise((resolve) => (hub.exitCode !== null ? resolve(null) : hub.once('exit', resolve)));
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
