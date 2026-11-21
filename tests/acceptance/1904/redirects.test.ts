// #1904 AC1: with a stand-in forge that redirects off its origin, every caller of GitHub's REST API refuses and sends
// its token nowhere else. GitHub is a boundary the repo doesn't own, so the forge is a local HTTP server on 127.0.0.1
// and "elsewhere" is a second one on another port (another origin). Each caller is reached through what its module
// exports, with the forge's URL as its API root and a token of its own, so a leak names the caller.
//
// The loop case holds the issue's Scope, "one client, with archive's redirect and deadline rules": a forge that
// redirects to itself forever ends in a refusal after at most archive's five redirects (six requests), not a hang.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, expect, it } from 'vitest';
import { githubPushes, revoke } from '../../../packages/github/src/index.ts';
import { Forge } from '../../../packages/hub/src/forge.ts';
import { liveFetch, liveGraphql } from '../../../packages/hub/src/github-source.ts';
import { allEvents, openArchiveOn, openWorld, removeTemps } from '../20/helpers.ts';

const AC1 = '#1904.b57b5ae4';
const TIMEOUT = 30_000;

interface Seen { method: string; url: string; authorization: string | undefined }
interface Stub { url: string; seen: Seen[] }
const servers: Server[] = [];
async function stub(answer: (req: IncomingMessage, self: string) => { status: number; headers?: Record<string, string>; body?: string }): Promise<Stub> {
  const seen: Seen[] = [];
  let self = '';
  const server = createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization });
    req.resume();
    req.on('end', () => {
      const a = answer(req, self);
      res.writeHead(a.status, { 'content-type': 'application/json', ...a.headers }).end(a.body ?? '');
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  self = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: self, seen };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); })));
});
afterAll(removeTemps);

const pathOf = (req: IncomingMessage): string => (req.url ?? '').split('?')[0]!;
const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });
const SHA = (c: string) => c.repeat(40);

type Outcome = { ok: unknown } | { err: unknown };
interface Caller {
  name: string;
  token: string;
  /** 302 for a GET, 307 for a method a 302 may turn into GET. */
  code: 302 | 307;
  /** What elsewhere answers, shaped as GitHub would, so a caller that follows the redirect gets a usable answer. */
  elsewhere: (req: IncomingMessage) => { status: number; body?: string };
  /** Calls through the caller's exported surface with `api` as the REST root; true when the caller refused. */
  run: (api: string, token: string) => Promise<{ outcome: Outcome; refused: boolean }>;
}
const settle = async (p: Promise<unknown>): Promise<Outcome> => p.then((ok) => ({ ok }), (err: unknown) => ({ err }));
const threw = (o: Outcome): boolean => 'err' in o;

const callers: Caller[] = [
  {
    name: 'github restOf (githubPushes)', token: 'tok-1904-pushes', code: 302,
    elsewhere: (req) => {
      const p = pathOf(req);
      if (p === '/repos/o/r') return json({ default_branch: 'main' });
      if (p === '/repos/o/r/activity') return json([{ id: 1, ref: 'refs/heads/main', before: SHA('a'), after: SHA('b'), timestamp: '2026-11-20T00:00:00Z', actor: { login: 'elsewhere' } }]);
      if (p.startsWith('/repos/o/r/compare/')) return json({ commits: [{ sha: SHA('e'), author: { login: 'elsewhere' }, committer: { login: 'elsewhere' }, commit: { tree: { sha: SHA('f') } } }] });
      return json([]);
    },
    run: async (api, token) => { const outcome = await settle(githubPushes({ api, token, repo: 'o/r' })); return { outcome, refused: threw(outcome) }; },
  },
  {
    name: 'github apps call (revoke)', token: 'tok-1904-apps', code: 307,
    elsewhere: () => ({ status: 204 }),
    run: async (api, token) => { const outcome = await settle(revoke(api, token)); return { outcome, refused: threw(outcome) }; },
  },
  {
    name: 'hub Forge (pullFor)', token: 'tok-1904-forge', code: 302,
    elsewhere: () => json([{ head: { ref: 'b' }, html_url: 'http://elsewhere.invalid/o/r/pull/1' }]),
    // pullFor reads a forge that doesn't answer as undefined: that is its refusal.
    run: async (api, token) => { const outcome = await settle(new Forge(api, token).pullFor('o/r', 'b')); return { outcome, refused: 'ok' in outcome && outcome.ok === undefined }; },
  },
  {
    name: 'hub github-source liveFetch', token: 'tok-1904-issues', code: 302,
    elsewhere: () => json({ elsewhere: true }),
    // An Answer: refused when it isn't elsewhere's 200 (a 599, the redirect itself, or a throw).
    run: async (api, token) => {
      const outcome = await settle(liveFetch(api, token)('/repos/o/r', 1));
      return { outcome, refused: threw(outcome) || ((outcome as { ok: { status?: number } }).ok?.status !== 200 && JSON.stringify((outcome as { ok: { body?: unknown } }).ok?.body) !== '{"elsewhere":true}') };
    },
  },
  {
    name: 'hub github-source liveGraphql', token: 'tok-1904-graphql', code: 307,
    elsewhere: () => json({ data: { elsewhere: true } }),
    run: async (api, token) => {
      const outcome = await settle(liveGraphql(api, token)('query { viewer { login } }', {}));
      return { outcome, refused: threw(outcome) || ((outcome as { ok: { status?: number } }).ok?.status !== 200 && JSON.stringify((outcome as { ok: { body?: unknown } }).ok?.body) !== '{"data":{"elsewhere":true}}') };
    },
  },
  {
    name: 'archive forgeRuns (openArchive pass)', token: 'tok-1904-archive', code: 302,
    elsewhere: (req) => {
      const p = pathOf(req);
      if (p === '/repos/o/r/actions/runs') return json({ workflow_runs: /[?&]page=1(?:&|$)/.test(req.url ?? '') ? [{ id: 7, status: 'completed', conclusion: 'success' }] : [] });
      if (p.endsWith('/jobs')) return json({ jobs: [{ id: 8 }] });
      return { status: 200, body: 'log from elsewhere\n' };
    },
    // The pass rejects, and no CI run is archived from elsewhere's answer.
    run: async (api, token) => {
      const w = await openWorld({ env: { GH_TOKEN: token } });
      try {
        const archive = await openArchiveOn(w, { forge: { api, repos: ['o/r'] } });
        const outcome = await settle(archive.pass());
        const archived = await allEvents(w.record, ['ci.archived']);
        return { outcome, refused: threw(outcome) && archived.length === 0 };
      } finally { await w.close(); }
    },
  },
];

const shown = (o: Outcome): string => ('err' in o ? `threw ${String((o.err as Error)?.message ?? o.err).slice(0, 160)}` : `returned ${JSON.stringify(o.ok)?.slice(0, 160)}`);

for (const c of callers) {
  it(`${AC1} ${c.name}: a forge that redirects off its origin is refused, and the token goes nowhere else`, async () => {
    const elsewhere = await stub((req) => c.elsewhere(req));
    const forge = await stub((req) => ({ status: c.code, headers: { location: `${elsewhere.url}${req.url ?? '/'}` } }));
    const { outcome, refused } = await c.run(forge.url, c.token);
    const summary = {
      // The caller reached the forge with its token: a caller that did nothing can't pass.
      forgeAskedWithToken: forge.seen.some((s) => s.authorization?.includes(c.token) ?? false),
      refused,
      tokenSentElsewhere: elsewhere.seen.filter((s) => s.authorization?.includes(c.token)).length,
      // Archive's rule: refused before the other origin is asked at all.
      requestsElsewhere: elsewhere.seen.length,
    };
    expect(summary, shown(outcome)).toEqual({ forgeAskedWithToken: true, refused: true, tokenSentElsewhere: 0, requestsElsewhere: 0 });
  }, TIMEOUT);

  it(`${AC1} ${c.name}: a forge that redirects to itself forever ends in a refusal within five redirects`, async () => {
    const forge = await stub((req, self) => ({ status: c.code, headers: { location: `${self}${req.url ?? '/'}` } }));
    const { outcome, refused } = await c.run(forge.url, c.token);
    const summary = { refused, bounded: forge.seen.length >= 1 && forge.seen.length <= 6 };
    expect(summary, `${shown(outcome)}; the forge was asked ${forge.seen.length} times`).toEqual({ refused: true, bounded: true });
  }, TIMEOUT);
}
