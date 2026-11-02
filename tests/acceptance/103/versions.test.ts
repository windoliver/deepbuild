// Changes travel along edges (README, Criteria): AC5, a new version or a rollback reopens the claims of every direct and
// indirect user, each once; AC6, env-local's environment is an output in the composition graph whose users are the
// pieces whose journeys ran in it, and its new version reopens them; AC7, a provider's new version whose readings break
// a user's own test fails the install, naming the edge, and one that changes nothing they read installs.
// "Reopens the claims" is read on the record: one composition.reopened event per reopened piece (README).
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  admit, admitted, closeHost, edgesOf, ID, loadedVersion, makePackage, openHost, openWorld, piece, provides, readThrough, reopenCounts, shape, sleep,
  tempDir, tested, uses, waitUntil, type FirstParty, type Json, type World,
} from './helpers.ts';

const LEVEL = shape({ level: { type: 'integer' } });
const levelOf = (p: string) => `ext.${p}.level@1`;
/** A generic piece `acme/<p>` that provides ext.<p>.level@1 (unless `provide` is false) and uses each of `on`'s levels. */
function levelPiece(p: string, on: string[], o: { version?: string; level?: number; provide?: boolean } = {}): Promise<string> {
  const provide = o.provide ?? true;
  return piece({
    id: `acme/${p}`, ...(o.version ? { version: o.version } : {}),
    spec: { outputs: provide ? [{ interface: levelOf(p), kind: 'reading', schema: LEVEL, value: { level: o.level ?? 1 } }] : [], uses: on.map(levelOf), read: true },
    manifest: { ...(provide ? { provides: [provides(levelOf(p), [LEVEL])] } : {}), ...(on.length ? { uses: on.map((q) => uses(levelOf(q), 0, LEVEL)) } : {}) },
  });
}
async function scene(): Promise<{ w: World; h: ExtensionHost }> {
  const w = await openWorld();
  return { w, h: await openHost(w) };
}

describe(`${ID.ac5} a new version of a piece, or a rollback, reopens the claims of everything that uses it, directly or through other pieces, each once`, () => {
  it('AC5 with A using B and B using C, a new version of C reopens B\'s and A\'s claims once each, and a rollback of C does it again', async () => {
    const { w, h } = await scene();
    const c1 = await levelPiece('c', [], { level: 1 });
    await admitted(h, c1, 'C');
    await admitted(h, await levelPiece('b', ['c']), 'B, using C');
    await admitted(h, await levelPiece('a', ['b'], { provide: false }), 'A, using B');
    await admitted(h, await levelPiece('e', []), 'E, using nothing');
    await admitted(h, await levelPiece('c', [], { version: '2.0.0', level: 2 }), 'C\'s new version');
    expect(await reopenCounts(w, 'acme/c', '2.0.0'), 'C 2.0.0 reopens B (direct) and A (through B), each once, and nothing else').toEqual({ 'acme/b': 1, 'acme/a': 1 });
    expect((await readThrough(h, 'acme/b', levelOf('c')))?.value, 'B reads C 2.0.0').toEqual({ level: 2 });

    await admitted(h, c1, 'C\'s rollback to 1.0.0');
    expect(await loadedVersion(h, 'acme/c'), 'C is back at 1.0.0').toBe('1.0.0');
    expect(await reopenCounts(w, 'acme/c', '1.0.0'), 'the rollback reopens B and A, each once').toEqual({ 'acme/b': 1, 'acme/a': 1 });
    expect((await readThrough(h, 'acme/b', levelOf('c')))?.value, 'B reads C 1.0.0 again').toEqual({ level: 1 });
  }, 240_000);

  it('AC5 with A using B and C, both using D, a new version of D reopens A\'s claims once (and B\'s and C\'s once each)', async () => {
    const { w, h } = await scene();
    await admitted(h, await levelPiece('d', []), 'D');
    await admitted(h, await levelPiece('b', ['d']), 'B, using D');
    await admitted(h, await levelPiece('c', ['d']), 'C, using D');
    await admitted(h, await levelPiece('a', ['b', 'c'], { provide: false }), 'A, using B and C');
    await admitted(h, await levelPiece('d', [], { version: '2.0.0', level: 2 }), 'D\'s new version');
    const counts = await reopenCounts(w, 'acme/d', '2.0.0');
    expect(counts['acme/a'], `A's claims reopen once, though it uses D along two paths: ${JSON.stringify(counts)}`).toBe(1);
    expect(counts, 'B and C once each, and nothing else').toEqual({ 'acme/a': 1, 'acme/b': 1, 'acme/c': 1 });
  }, 240_000);
});

// ---- AC6
const ENV = 'environment@1';
const ENV_LOCAL = (version: string): FirstParty => ({ id: 'env-local', version, provides: [ENV] });
/** A plug-in whose check kind ext.<p>.journey is a journey: it passes. */
const journey = (p: string) => makePackage({
  id: `acme/${p}`, manifest: { checks: [`ext.${p}.journey`] },
  index: `export default async function (deep: any): Promise<void> {
  await deep.registerCheck('ext.${p}.journey', async () => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null }));
}
`,
});
const runJourney = (h: ExtensionHost, p: string, environment?: string) => h.runCheck(`ext.${p}.journey`, { kind: `ext.${p}.journey`, runner: 'journey', inputs: [], depth: 'e2e', oracle: 'code', contract: null },
  { checkout: tempDir('co'), deadline: 30_000, ...(environment ? { environment } : {}) } as { checkout: string; deadline: number });
/** A host on the world after the hub's next start, with env-local at `version`: every installed piece loads again. */
async function restart(w: World, version: string): Promise<ExtensionHost> {
  const h = await openHost(w, { firstParty: [ENV_LOCAL(version)] });
  for (const p of await h.installed()) {
    if (!h.checked(p)) await h.check(p);
    const load = await h.load(p);
    if (load.status !== 'loaded') throw Error(`${p.id} didn't load again at the hub's next start: ${load.reason}`);
  }
  return h;
}

describe(`${ID.ac6} the environment env-local registers shows in the composition graph as an output, with the pieces whose journeys used it as users, and a new version of it reopens those users' claims`, () => {
  it('AC6 env-local\'s environment@1 is an output whose users are the pieces whose journeys ran in it; env-local\'s new version reopens each of them once', async () => {
    const w = await openWorld();
    const h1 = await openHost(w, { firstParty: [ENV_LOCAL('0.0.0')] });
    await admitted(h1, await journey('web'), 'acme/web, whose journey runs in the environment');
    await admitted(h1, await journey('api'), 'acme/api, whose journey runs with no environment');
    await admitted(h1, await journey('docs'), 'acme/docs, whose journey never runs');
    expect((await runJourney(h1, 'web', ENV)).outcome, 'acme/web\'s journey ran in env-local\'s environment').toBe('passed');
    expect((await runJourney(h1, 'api')).outcome, 'acme/api\'s journey ran with none').toBe('passed');

    const users = (es: Awaited<ReturnType<typeof edgesOf>>) => es.filter((e) => e.provider === 'env-local');
    expect(users(await edgesOf(h1)), 'the graph shows env-local\'s environment@1 with acme/web as its one user').toEqual([{ user: 'acme/web', uses: ENV, interface: ENV, provider: 'env-local' }]);
    expect(await reopenCounts(w, 'env-local', '0.0.0'), 'nothing reopened yet').toEqual({});

    // The hub's next start with env-local's new version.
    await closeHost(h1);
    const h2 = await restart(w, '0.0.1');
    await waitUntil(async () => Object.keys(await reopenCounts(w, 'env-local', '0.0.1')).length > 0, 15_000, 'a reopen for env-local 0.0.1');
    await sleep(500);
    expect(await reopenCounts(w, 'env-local', '0.0.1'), 'env-local 0.0.1 reopens acme/web\'s claims once, and no piece whose journey didn\'t use it').toEqual({ 'acme/web': 1 });
    expect(users(await edgesOf(h2)), 'the graph, kept in the record, still shows acme/web as its user').toEqual([{ user: 'acme/web', uses: ENV, interface: ENV, provider: 'env-local' }]);

    // The next start at the same version reopens nothing again.
    await closeHost(h2);
    await restart(w, '0.0.1');
    await sleep(1_000);
    expect(await reopenCounts(w, 'env-local', '0.0.1'), 'still once').toEqual({ 'acme/web': 1 });
  }, 240_000);
});

// ---- AC7
const P1 = 'ext.stocks.prices@1';
const PRICES = shape({ readings: { type: 'array', items: shape({ symbol: { type: 'string' }, cents: { type: 'integer' } }) } });
const NEWS = shape({ headline: { type: 'string' } });
const WATCH = [{ symbol: 'ACME', cents: 10000 }, { symbol: 'INIT', cents: 20000 }];
/** The stocks plug-in at `version`, its readings each `factor` times the watchlist's, and with `news` a second output no one uses. */
const stocks = (version: string, factor: number, news?: string) => piece({
  id: 'acme/stocks', version,
  spec: { outputs: [
    { interface: P1, kind: 'reading', schema: PRICES, value: { readings: WATCH.map((r) => ({ ...r, cents: r.cents * factor })) } },
    ...(news ? [{ interface: 'ext.stocks.news@1', kind: 'reading' as const, schema: NEWS, value: { headline: news } }] : []),
  ] },
  manifest: { provides: [provides(P1, [PRICES]), ...(news ? [provides('ext.stocks.news@1', [NEWS])] : [])] },
});
/** The brief's own test: the watchlist's total, from the prices it reads through its use. */
const TOTAL_TEST = `export default {
  'the watchlist totals 300.00': async (t) => {
    const r = await t.read('${P1}');
    if (!r || !('value' in r)) throw Error('no prices: ' + JSON.stringify(r));
    const total = r.value.readings.reduce((sum, x) => sum + x.cents, 0);
    if (total !== 30000) throw Error('the watchlist totals ' + total + ' cents, not 30000');
  },
};
`;
const total = (read: Json): number => (read?.value?.readings as { cents: number }[] | undefined)?.reduce((s, r) => s + r.cents, 0) ?? NaN;

describe(`${ID.ac7} a provider's new version whose readings keep their schema but halve every value fails a user's contract test, so the install fails, naming the edge, and the version in use stays; one that changes nothing those tests read installs`, () => {
  it('AC7 the halving version is refused, naming the edge; 1.0.0 stays in use and the brief still totals 300.00; a version that changes only an output no test reads installs', async () => {
    const { w, h } = await scene();
    await admitted(h, await stocks('1.0.0', 1), 'stocks 1.0.0');
    const brief = await admitted(h, await piece({ id: 'acme/brief', spec: { uses: [P1], read: true }, manifest: { uses: [uses(P1, 0, PRICES)] }, files: { 'tests/total.test.mjs': TOTAL_TEST } }), 'the brief, with its own test');
    expect(await h.testPackage(brief), 'the brief\'s own test passes on 1.0.0 (t.read reads through its use)').toMatchObject({ passed: true, testsRun: 1 });

    const halved = await admit(h, await stocks('2.0.0', 0.5));
    expect(halved.ok, 'the halving version isn\'t admitted').toBe(false);
    if (!halved.ok) {
      expect(halved.reason, 'the refusal names the edge whose contract test failed').toContain(`acme/brief uses ${P1}`);
      expect(halved.reason, 'and the provider').toContain('acme/stocks');
    }
    expect(await loadedVersion(h, 'acme/stocks'), 'the version in use stays').toBe('1.0.0');
    expect(total(await readThrough(h, 'acme/brief', P1)), 'the brief still reads 1.0.0\'s prices').toBe(30000);
    expect((await edgesOf(h)).filter((e) => e.user === 'acme/brief'), 'its edge is as it was').toEqual([{ user: 'acme/brief', uses: P1, interface: P1, provider: 'acme/stocks' }]);

    await admitted(h, await stocks('1.0.1', 1, 'ACME beats estimates'), 'a version that changes only its news');
    expect(await loadedVersion(h, 'acme/stocks'), '1.0.1 is in use').toBe('1.0.1');
    expect(total(await readThrough(h, 'acme/brief', P1)), 'the brief reads 1.0.1\'s prices').toBe(30000);
    const runs = (await tested(w)).filter((t) => t.provider === 'acme/stocks' && t.version === '1.0.1');
    expect(runs, 'the brief\'s contract test ran against 1.0.1 and passed').toEqual([{ user: 'acme/brief', interface: P1, provider: 'acme/stocks', version: '1.0.1', passed: true }]);
  }, 240_000);
});
