// The model that made a change is read from its session's transcript only on the agent's own route. Claude Code's
// adapter records at session start whether ANTHROPIC_BASE_URL was set, yes or no, never its value; behind a base URL
// other than the agent's own, the transcript's model name is the proxy's word, so the change's model reads unknown
// and a review of it is uncounted, "model unknown: proxied route". The review is a real job through the runner (#159).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../159/helpers.ts';
import type { ModelPlant } from '../../../../packages/checks-review/src/index.ts';
import { AT, changeSession, claimVerdict, review, reviewJob, sessionEnv, shown, world } from './helpers.ts';

afterAll(cleanup, 30_000);

/** A local listener the session's ANTHROPIC_BASE_URL points at, as a proxy or protocol bridge would listen. */
async function listener(): Promise<{ url: string; port: string; close(): Promise<void> }> {
  const server: Server = createServer((_req, res) => { res.statusCode = 502; res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = String((server.address() as AddressInfo).port);
  return { url: `http://127.0.0.1:${port}/dh87-bridge`, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function proxied(plant?: ModelPlant): Promise<void> {
  const { reviewJobRun } = await review();
  const proxy = await listener();
  const w = await world();
  try {
    const job = await reviewJob(w, 'codex');
    expect(job.model, 'the review job\'s record').toBe('gpt-5-codex');

    // Started with ANTHROPIC_BASE_URL at the local listener: the route says it was set, never where.
    const behind = await changeSession('claude-opus-4-1', sessionEnv({ ANTHROPIC_BASE_URL: proxy.url }));
    expect(behind.route.ANTHROPIC_BASE_URL, `the route recorded at session start: ${JSON.stringify(behind.route)}`).toBe(true);
    const first = reviewJobRun(job, behind, AT, plant);
    const recorded = JSON.stringify({ route: behind.route, independence: first.independence, run: first.run });
    for (const value of [proxy.url, `127.0.0.1:${proxy.port}`, 'dh87-bridge'])expect(recorded.includes(value), `the record holds ${value}: ${recorded}`).toBe(false);
    if (!first.independence || first.independence.counted) {
      throw new Error(`a review of a change made behind ANTHROPIC_BASE_URL counted, the proxied transcript's model trusted: ${JSON.stringify(first.independence)}`);
    }
    expect(first.independence).toMatchObject({ change: 'unknown', answered: 'gpt-5-codex', reason: 'model unknown: proxied route' });
    expect(first.run.outcome).toBe('uncounted');
    const v = claimVerdict(first.run);
    expect(v.outcome, shown(v)).not.toBe('PASS');

    // The same session with the variable unset: the transcript's model stands, and the review counts.
    const direct = await changeSession('claude-opus-4-1', sessionEnv());
    expect(direct.route.ANTHROPIC_BASE_URL, `the route recorded at session start: ${JSON.stringify(direct.route)}`).toBe(false);
    const second = reviewJobRun(job, direct, AT, plant);
    expect(second.independence).toMatchObject({ change: 'claude-opus-4-1', answered: 'gpt-5-codex', counted: true, reason: null, note: null });
    expect(second.run.outcome).not.toBe('uncounted');
  } finally {
    await w.close();
    await proxy.close();
  }
}

describe('#87 behind a proxied route the change\'s model is unknown and a review of it is uncounted', () => {
  it('a change made in a Claude Code session started with ANTHROPIC_BASE_URL at a local listener, whose transcript names claude-opus-4-1, records its model as unknown, and a review answered by gpt-5-codex is uncounted, "model unknown: proxied route"; the record holds that the variable was set, never its value; with the variable unset the review counts', async () => {
    await proxied();
  }, 300_000);

  it('(wrong program) a check that trusts the proxied transcript\'s model name counts the first review, and fails', async () => {
    await expect(proxied('trusts-proxied-transcript')).rejects.toThrow(/the proxied transcript's model trusted/);
  }, 300_000);
});
