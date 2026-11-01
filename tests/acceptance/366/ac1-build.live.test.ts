// AC1's recording step, by hand only (README, The recorded builds): it spends plan usage on real agents, so no lane
// runs it. For each agent it has Claude Code or Codex build a package from the stocks sentence, headless, in a temp
// folder holding the extension guide, its examples and a note on the market feed; installs, checks and loads what the
// agent wrote on a host whose market host is a server on 127.0.0.1, reads each polled source and runs the package's
// own tests, recording every source call; on a failure the agent gets the failure back, up to two repair rounds. It
// then writes the build where ac1-replay.test.ts reads it: <out>/<agent>/{package/, recording.json, build.json}, <out>
// being $DEEP366_LIVE_OUT or docs/evidence/366/stocks.
//
//   DEEP366_LIVE=1 DEEP366_CLAUDE_OAUTH_TOKEN=... CODEX_API_KEY=... \
//     node node_modules/vitest/vitest.mjs run --root tests/acceptance/366 ac1-build.live.test.ts
//
// The agents' sign-ins come only from those variables: HOME is a temp folder (helpers.ts), so neither CLI reads yours.
// How often each agent builds it on the first try is a reading for #59, recorded in build.json, never a pass or fail.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost, Installed } from '../../../packages/extension-host/src/index.ts';
import {
  AGENTS, clock, home, hostsGrant, json, MARKET, memoryStore, openHost, openWorld, provider, RECORDED, REPO, routedClient, SENTENCE, setDigest, tempDir, YOU,
} from './helpers.ts';

const LIVE = process.env.DEEP366_LIVE === '1';
const OUT = process.env.DEEP366_LIVE_OUT ?? RECORDED;
/** The recorded clock: a Monday in market hours. */
const CLOCK = Date.parse('2026-11-02T14:30:00Z');
const REPAIRS = 2;
const PRICES: Record<string, number> = { NVDA: 187.25, AAPL: 231.4, AMD: 162.85, MSFT: 512.1 };
const MARKET_NOTE = `# Your market feed

Host: ${MARKET} (HTTPS). Every call carries your key in the header \`X-Api-Key\`; keep it as a secret named \`market_key\`.

- \`GET /v1/quote?symbol=<SYMBOL>\` answers \`{"symbol": "NVDA", "price": 187.25, "currency": "USD"}\`.
- \`GET /v1/history?symbol=<SYMBOL>&days=<n>\` answers \`{"symbol": "NVDA", "currency": "USD", "points": [{"t": <ms>, "price": <number>}, ...]}\`, one point a day.
- An unknown symbol answers 404; a missing or wrong key answers 401.
`;
const PROMPT = (guide: string) => `${SENTENCE}

Build this as a DeepBuild package in the folder ./package: its manifest deepbuild.json, its code, its panel and its own tests, as ${guide} and the examples beside it say. The market feed you have is described in ./MARKET.md. Don't run anything that reaches the network; DeepBuild runs your package's tests on recorded calls.`;

/** The market feed, on 127.0.0.1. */
const feed = (c: ReturnType<typeof clock>) => provider(c, (req) => {
  const url = new URL(req.url, 'https://x');
  const symbol = url.searchParams.get('symbol') ?? '';
  if (!req.headers['x-api-key']) return json({ error: 'missing key' }, 401);
  if (!(symbol in PRICES)) return json({ error: 'unknown symbol' }, 404);
  if (url.pathname === '/v1/quote') return json({ symbol, price: PRICES[symbol], currency: 'USD' });
  if (url.pathname === '/v1/history') {
    const days = Math.min(Number(url.searchParams.get('days') ?? 30) || 30, 365);
    return json({ symbol, currency: 'USD', points: Array.from({ length: days }, (_, i) => ({ t: c.now() - (days - i) * 86_400_000, price: Math.round(PRICES[symbol]! * (0.9 + 0.1 * (i / days)) * 100) / 100 })) });
  }
  return { status: 404 };
});

/** One headless run of the agent in `ws`, the prompt on stdin. */
function runAgent(agent: (typeof AGENTS)[number], ws: string, prompt: string): { ok: boolean; out: string } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home(), LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR ?? '/tmp' };
  const [bin, args] = agent === 'claude-code'
    ? ['claude', ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'json']]
    : ['codex', ['exec', '--full-auto', '--skip-git-repo-check', '-']];
  if (agent === 'claude-code') env.CLAUDE_CODE_OAUTH_TOKEN = process.env.DEEP366_CLAUDE_OAUTH_TOKEN ?? '';
  else env.CODEX_API_KEY = process.env.CODEX_API_KEY ?? '';
  const r = spawnSync(bin, args, { cwd: ws, env, input: prompt, encoding: 'utf8', timeout: 40 * 60_000, maxBuffer: 256 << 20 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
}
function versionOf(agent: (typeof AGENTS)[number]): string {
  const r = spawnSync(agent === 'claude-code' ? 'claude' : 'codex', ['--version'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home() } });
  return /\d+\.\d+\.\d+/.exec(r.stdout ?? '')?.[0] ?? '';
}

/** The package's checks on a fresh host recording its calls: what failed, in words, and the recording. */
async function tryPackage(agent: string, dir: string, grant: { hosts: ReturnType<typeof hostsGrant> }): Promise<{ failed: string[]; recording?: unknown }> {
  const c = clock(CLOCK);
  const routed = routedClient({ [MARKET]: await feed(c) });
  const w = await openWorld(c);
  const h: ExtensionHost = await openHost(w, { secrets: memoryStore(), http: routed.client });
  const failed: string[] = [];
  let p: Installed;
  try { p = await h.install({ from: dir, builtBy: agent, grant }); } catch (e) { return { failed: [`install: ${String((e as Error).message)}`] }; }
  const checked = await h.check(p);
  if (!checked.passed) return { failed: checked.reasons.map((r) => `conformance: ${r}`) };
  const manifest = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { secrets?: { name: string }[]; sources?: { name: string; variant: string }[] };
  const load = await h.load(p);
  if (load.status !== 'loaded') return { failed: [`load: ${load.reason}`] };
  for (const s of manifest.secrets ?? []) await h.enterSecret(YOU, p.id, s.name, 'dh366-live-test-key');
  for (const s of (manifest.sources ?? []).filter((x) => x.variant === 'polled')) {
    const read = await h.readSource(s.name);
    if (read.status !== 'reading') failed.push(`${s.name} gave no reading: ${JSON.stringify(read)}`);
  }
  const tests = await h.testPackage(p);
  if (!tests.passed || tests.testsRun < 1) failed.push(`its own tests: ${tests.testsRun} ran; ${tests.failures.map((f) => `${f.test}: ${f.message}`).join('; ') || 'none ran'}`);
  return { failed, recording: h.recording() };
}

describe.skipIf(!LIVE)('AC1 live: record the stocks package each agent builds from the sentence', () => {
  for (const agent of AGENTS) {
    it(`AC1 live: ${agent} builds the stocks package from the sentence, and its build is recorded for the replay`, async () => {
      const version = versionOf(agent);
      expect(version, `${agent} is installed on PATH`).not.toBe('');
      const ws = tempDir(`build-${agent}`);
      cpSync(join(REPO, 'docs', 'extension-guide.md'), join(ws, 'extension-guide.md'));
      cpSync(join(REPO, 'docs', 'extension-guide'), join(ws, 'extension-guide'), { recursive: true });
      writeFileSync(join(ws, 'MARKET.md'), MARKET_NOTE);
      const grant = { hosts: hostsGrant(MARKET) };
      let said = runAgent(agent, ws, PROMPT('./extension-guide.md'));
      let result: { failed: string[]; recording?: unknown } = { failed: ['the agent wrote no package'] };
      let repairs = 0;
      for (;;) {
        if (existsSync(join(ws, 'package', 'deepbuild.json'))) {
          setDigest(join(ws, 'package'));
          result = await tryPackage(agent, join(ws, 'package'), grant);
        }
        if (!result.failed.length || repairs === REPAIRS) break;
        repairs++;
        said = runAgent(agent, ws, `${PROMPT('./extension-guide.md')}\n\nDeepBuild checked ./package and it failed:\n${result.failed.join('\n')}\nFix the package in ./package.`);
      }
      expect(result.failed, `${agent}'s package after ${repairs} repair round(s); its last words: ${said.out.slice(-2000)}`).toEqual([]);
      const out = join(OUT, agent);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      cpSync(join(ws, 'package'), join(out, 'package'), { recursive: true });
      writeFileSync(join(out, 'recording.json'), `${JSON.stringify(result.recording, null, 2)}\n`);
      writeFileSync(join(out, 'build.json'), `${JSON.stringify({
        format: 'deep.build@1', sentence: SENTENCE, agent: { name: agent, version }, clock: CLOCK, grant,
        first_try: repairs === 0, repair_rounds: repairs, built: new Date().toISOString(),
      }, null, 2)}\n`);
    }, 3 * 60 * 60_000);
  }
});
