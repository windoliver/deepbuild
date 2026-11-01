// AC1: the recorded package built from the stocks sentence in each agent, replayed, uses only these blocks and passes
// its own tests; its copy whose panel calls the market host itself is refused, naming the call (README, Readings: AC1,
// and The recorded builds). The recordings are read from docs/evidence/366/stocks/<agent>/, which only a by-hand run of
// ac1-build.live.test.ts writes; with none there, the replay fails, naming the missing files. The fixture stocks
// package shows the refusal of a panel that calls the market host on its own, and the blocks judge is shown to name
// each wrong package it must.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost, HttpClient, InstallFrom, Recording } from '../../../packages/extension-host/src/index.ts';
import {
  AGENTS, clock, hostsGrant, ID, installAndLoad, MAIL, MARKET, memoryStore, openHost, openWorld, pkg, RECORDED, SENTENCE, setDigest, tempDir,
} from './helpers.ts';
import { blocksProblems, panelCallProblems, panelsOf, recordedProblems, type Gate } from './judges.ts';

/** The line planted in a copy's panel: the panel fetching the market host itself. */
const PLANTED = `\nfetch("https://${MARKET}/q?symbol=NVDA");\n`;
/** A replay makes no live call: a request the recording doesn't hold fails as on a machine with no network. */
const noNetwork: HttpClient = async (request) => { throw new TypeError(`fetch failed: no network in a replay (${request.url})`); };

interface Build {
  format: string; sentence: string; agent: { name: string; version: string }; clock: number; grant: InstallFrom['grant'];
  first_try: boolean; repair_rounds: number;
}

/** A package copied to a temp folder, its panel planted to fetch the market host, its digest set again. */
function plantedCopy(from: string): string {
  const dir = join(tempDir('planted'), 'package');
  cpSync(from, dir, { recursive: true });
  const panel = panelsOf(dir)[0];
  if (!panel) throw Error(`${from} has no panel to plant the call in`);
  appendFileSync(join(panel, 'main.js'), PLANTED);
  setDigest(dir);
  return dir;
}
/** Install, conformance and load, each refusal kept as what it said. */
async function gate(h: ExtensionHost, from: string, builtBy: string | null, grant: InstallFrom['grant']): Promise<Gate> {
  const g: Gate = {};
  let p;
  try { p = await h.install({ from, builtBy, ...(grant ? { grant } : {}) }); } catch (e) { g.install = String((e as Error)?.message ?? e); return g; }
  g.check = await h.check(p);
  if (!g.check.passed) return g;
  g.load = await h.load(p);
  return g;
}

describe(`AC1 ${ID.ac1} The recorded package built from "${SENTENCE}" in each agent, replayed, uses only these blocks and passes its own tests; its copy whose panel calls the market host itself is refused, naming the call`, () => {
  for (const agent of AGENTS) {
    it(`AC1 the package built in ${agent}, replayed on its recording and clock, uses only these blocks, passes conformance and its own tests, and its copy whose panel fetches the market host is refused, naming the call`, async () => {
      const dir = join(RECORDED, agent);
      expect(recordedProblems(dir), `no recorded build from ${agent}: run tests/acceptance/366/ac1-build.live.test.ts by hand (README, The recorded builds)`).toEqual([]);
      const build = JSON.parse(readFileSync(join(dir, 'build.json'), 'utf8')) as Build;
      const recording = JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8')) as Recording;
      expect(build.format).toBe('deep.build@1');
      expect(build.sentence, 'built from the issue\'s sentence, word for word').toBe(SENTENCE);
      expect(build.agent.name).toBe(agent);
      expect(build.agent.version, 'the agent\'s version is pinned').toMatch(/^\d+\.\d+\.\d+/);
      expect(recording.v).toBe(1);
      expect(recording.calls.length, 'the recording holds the source calls the replay serves').toBeGreaterThan(0);
      for (const call of recording.calls) expect(new URL(call.request.url).hostname, 'every recorded call went to the market host').toBe(MARKET);
      const source = join(dir, 'package');
      expect(blocksProblems(source, build.grant, MARKET)).toEqual([]);

      // Replayed: the recording, the recorded clock, and no network.
      const copy = join(tempDir('replay'), 'package');
      cpSync(source, copy, { recursive: true });
      const w = await openWorld(clock(build.clock));
      const h = await openHost(w, { secrets: memoryStore(), http: noNetwork, replay: recording });
      const p = await h.install({ from: copy, builtBy: agent, ...(build.grant ? { grant: build.grant } : {}) });
      const checked = await h.check(p);
      expect(checked.passed, `its conformance: ${checked.reasons.join('; ')}`).toBe(true);
      const load = await h.load(p);
      expect(load.status, `it loads: ${JSON.stringify(load)}`).toBe('loaded');
      const manifest = JSON.parse(readFileSync(join(copy, 'deepbuild.json'), 'utf8')) as { sources?: { name: string; variant: string }[] };
      for (const s of (manifest.sources ?? []).filter((x) => x.variant === 'polled')) {
        const read = await h.readSource(s.name);
        expect(read.status, `${s.name} reads from the recording: ${JSON.stringify(read)}`).toBe('reading');
      }
      const tests = await h.testPackage(p);
      expect(tests.failures, 'its own tests\' failures').toEqual([]);
      expect(tests.passed, 'its own tests pass').toBe(true);
      expect(tests.testsRun, 'its own tests ran').toBeGreaterThan(0);

      const w2 = await openWorld(clock(build.clock));
      const h2 = await openHost(w2, { secrets: memoryStore(), http: noNetwork, replay: recording });
      expect(panelCallProblems(await gate(h2, plantedCopy(source), agent, build.grant), MARKET)).toEqual([]);
    }, 300_000);
  }

  it('AC1 the fixture stocks package loads with its view, and its copy whose panel fetches the market host itself is refused, naming the call', async () => {
    const from = pkg('stocks', { view: true });
    const grant = { hosts: hostsGrant(MARKET, MAIL) };
    const w = await openWorld(clock(Date.parse('2026-11-02T10:00:00Z')));
    const h = await openHost(w, { secrets: memoryStore(), http: noNetwork });
    await installAndLoad(h, from, grant);
    const w2 = await openWorld(clock(Date.parse('2026-11-02T10:00:00Z')));
    const h2 = await openHost(w2, { secrets: memoryStore(), http: noNetwork });
    expect(panelCallProblems(await gate(h2, plantedCopy(from), null, grant), MARKET)).toEqual([]);
  }, 180_000);

  it('AC1 (wrong program) the blocks judge passes a package built from these blocks, and names each wrong one: another block, a panel that fetches, a wider grant, no view', () => {
    const dir = join(tempDir('blocks'), 'package');
    mkdirSync(join(dir, 'panel'), { recursive: true });
    mkdirSync(join(dir, 'tests'), { recursive: true });
    const preview = ['deep.registerView', 'deep.registerSource', 'deep.secret', 'deep.store', 'deep.store.put', 'deep.schedule', 'deep.notices.send', 'deep.registerAction'];
    const write = (extra: { preview?: string[]; code?: string; panel?: string; view?: boolean } = {}) => {
      writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify({ id: 'test/stocks', version: '1.0.0', access: { words: ['hosts'] }, requires: { preview: [...preview, ...(extra.preview ?? [])] } }));
      writeFileSync(join(dir, 'index.ts'), [
        'export default async function (deep: any) {',
        '  await deep.registerSource("ext.stocks.price", {}); await deep.secret("market_key"); await deep.store("ext.stocks.watch", {});',
        '  await deep.store.put("ext.stocks.watch", "NVDA", {}); await deep.schedule("ext.stocks.poll", {}, async () => {});',
        '  await deep.notices.send({}); deep.registerAction("ext.stocks.add", {}, async () => ({}));',
        extra.view === false ? '' : '  await deep.registerView("ext.stocks.watchlist", "panel", "sidebar", {});',
        extra.code ?? '', '}',
      ].join('\n'));
      writeFileSync(join(dir, 'panel', 'main.js'), extra.panel ?? 'export default class Stocks {}\n');
      writeFileSync(join(dir, 'tests', 'stocks.test.ts'), 'await deep.record.query({});\n');
    };
    const grant = { hosts: hostsGrant(MARKET) };
    write();
    expect(blocksProblems(dir, grant, MARKET), 'a package of these blocks, its tests free to use more').toEqual([]);
    write({ preview: ['deep.record.query'], code: '  await deep.record.query({ kinds: ["task.created"] });' });
    expect(blocksProblems(dir, grant, MARKET).filter((p) => p.includes('deep.record.query')).length).toBe(2);
    write({ panel: `export default class Stocks { init() { fetch("https://${MARKET}/q"); } }\n` });
    expect(blocksProblems(dir, grant, MARKET).some((p) => p.includes('panel/main.js:1') && p.includes('fetch'))).toBe(true);
    write();
    expect(blocksProblems(dir, { ...grant, record: ['*'] }, MARKET).some((p) => p.includes('record'))).toBe(true);
    expect(blocksProblems(dir, { hosts: hostsGrant(MARKET, MAIL) }, MARKET).some((p) => p.includes(MAIL))).toBe(true);
    write({ view: false });
    expect(blocksProblems(dir, grant, MARKET).some((p) => p.includes('registers no view'))).toBe(true);
    expect(existsSync(join(dir, 'panel', 'main.js'))).toBe(true);
  });
});
