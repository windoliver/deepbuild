// #356.482272ce two entities merge only on an exact key (a path, a command, a variable name); similar names with
// different keys stay separate, and an unclear merge comes to you. A blind redraft: see README.md.
import { afterAll, describe, expect, it } from 'vitest';
import { claims, cleanup, control, onMac, setupWithWindows, shown, world, type Claim, type World } from '../helpers.ts';
import { fixture, type Fixture, type Sess } from '../history.ts';

afterAll(cleanup);

interface Ask { ask: string; status: string; outcome: string; question: string }
type Json = { sources?: { at?: string; quote?: string }[]; proof?: number };

// ---- What the wiki says about an entity. Claims live on the repo pages, you.md, setup.md and rules.md; the pages
// under questions/ are rewritten from the repo pages' claims (the base's `STANDING` questions), so they are derived
// copies and are never counted: a claim counts once, where it is held.
const derived = (c: Claim): boolean => c.page.startsWith('questions/');
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A claim states an exact key when the key is a whole word in its line or in a quote it cites (`npm run dev` is not `npm run dev:api`). */
export const states = (c: Claim, key: string): boolean => {
  const quotes = ((c.json as Json).sources ?? []).map((s) => String(s.quote ?? ''));
  return new RegExp(`(^|[^A-Za-z0-9_])${esc(key)}(?![A-Za-z0-9_:-])`).test([c.text, ...quotes].join('\n'));
};
const sessionOf = (fx: Fixture) => (c: Claim): Sess[] => {
  const out = new Set<Sess>();
  for (const s of (c.json as Json).sources ?? []) {
    const id = /^session:([0-9A-Za-z-]+)/.exec(String(s.at ?? ''))?.[1]?.replace(/-/g, '');
    const hit = fx.sessions.find((x) => x.id.replace(/[^0-9A-Za-z]/g, '') === id);
    if (hit) out.add(hit);
  }
  return [...out];
};
const norm = (p: string): string => p.replace(/^\/private/, '');
const holds = (question: string, path: string): boolean => question.includes(path) || question.includes(norm(path));
const naming = (asks: Ask[], a: string, b: string): Ask[] => asks.filter((k) => holds(k.question, a) && holds(k.question, b));

/** Problems with how the wiki merged the fixture's entities, from the claims it holds and the asks it raised. Empty is a pass. */
export function mergeProblems(fx: Fixture, all: Claim[], asks: Ask[]): string[] {
  const problems: string[] = [];
  const held = all.filter((c) => !derived(c));
  const sessions = sessionOf(fx);
  const R = fx.repos;
  const cwds = (c: Claim): string[] => [...new Set(sessions(c).map((s) => s.cwd))];
  const repoPages = (cwd: string): Set<string> => new Set(held.filter((c) => c.page.startsWith('repos/') && cwds(c).includes(cwd)).map((c) => c.page));
  const about = (key: string): Claim[] => held.filter((c) => states(c, key));
  const idOf = (cwd: string, agent: Sess['agent']): string[] => fx.sessions.filter((s) => s.cwd === cwd && s.agent === agent).map((s) => s.id);
  const only = (key: string, where: string[], why: string): Claim[] => {
    const found = about(key);
    if (!found.length) problems.push(`no claim states \`${key}\`: ${why}`);
    for (const c of found) {
      const off = cwds(c).filter((w) => !where.includes(w));
      if (off.length) problems.push(`the claim "${c.text}" on ${c.page} states \`${key}\` but also rests on ${off.join(', ')}: ${why}`);
    }
    return found;
  };

  // 1. The same repo path and the same command, from Claude Code and Codex: one claim, with both sources counted.
  const dev = only('npm run dev', [R.api!], 'the api repo\'s start command');
  const both = (c: Claim): boolean => { const ids = sessions(c).map((s) => s.id); return idOf(R.api!, 'claude').some((i) => ids.includes(i)) && idOf(R.api!, 'codex').some((i) => ids.includes(i)); };
  for (const c of dev) {
    if (!both(c)) problems.push(`the claim "${c.text}" on ${c.page} states \`npm run dev\` from only one agent: the Claude Code and Codex sources of the same command stay split`);
    else if (Number((c.json as Json).proof) !== 2) problems.push(`the merged \`npm run dev\` claim on ${c.page} has proof ${String((c.json as Json).proof)}, not 2 (one Claude Code and one Codex source)`);
  }
  const apiPages = repoPages(R.api!);
  if (apiPages.size !== 1) problems.push(`the api repo (one path, Claude Code and Codex sessions) is on ${apiPages.size} repo pages (${[...apiPages].join(', ')}), not one`);

  // 2. Two repos both named api, at different paths: separate pages and separate claims.
  only('make serve', [R.api2!], 'the second api repo, at another path');
  const api2Pages = repoPages(R.api2!);
  if (!api2Pages.size) problems.push('no repo page holds a claim from the api repo at the second path');
  for (const p of api2Pages) if (apiPages.has(p)) problems.push(`the two api repos, at ${R.api} and ${R.api2}, share the page ${p}: merged on their name`);
  if (naming(asks, R.api!, R.api2!).length) problems.push(`an ask names ${R.api} and ${R.api2}: two live repos at different paths are not an unclear merge`);

  // 3. A similar command: `npm run dev:api` stays its own claim, on Codex's source alone.
  const docs = only('npm run dev:api', [R.api!], 'a command that only looks like `npm run dev`');
  for (const c of docs) {
    if (sessions(c).some((s) => s.agent === 'claude')) problems.push(`the \`npm run dev:api\` claim on ${c.page} rests on a Claude Code source that says \`npm run dev\`: merged on a similar command`);
    if (states(c, 'npm run dev')) problems.push(`the claim "${c.text}" states \`npm run dev\` and \`npm run dev:api\` together`);
  }

  // 4. Similar variable names: each credential claim keeps its own name and its own session.
  const gh = only('GITHUB_TOKEN', [R.api!], 'the api repo\'s release credential');
  const gt = only('GH_TOKEN', [R.web!], 'the web repo\'s deploy credential');
  for (const c of [...gh, ...gt]) if (states(c, 'GITHUB_TOKEN') && states(c, 'GH_TOKEN')) problems.push(`the claim "${c.text}" on ${c.page} states GITHUB_TOKEN and GH_TOKEN together: merged on similar variable names`);
  if (gh.length && gt.length && gh.some((a) => gt.includes(a))) problems.push('one claim is both the GITHUB_TOKEN claim and the GH_TOKEN claim');

  // 5. The unclear case: a deleted folder and a live folder, both named shop. Nothing merges; one open ask names both paths.
  only('docker compose up', [R.shopOld!], 'the deleted shop folder');
  only('npm run lint', [R.shopNew!], 'the live shop folder');
  const oldPages = repoPages(R.shopOld!); const newPages = repoPages(R.shopNew!);
  if (!oldPages.size || !newPages.size) problems.push('a shop folder has no repo page claim');
  for (const p of oldPages) if (newPages.has(p)) problems.push(`the deleted and the live shop folders share the page ${p}: merged on their name`);
  const shop = naming(asks, R.shopOld!, R.shopNew!);
  if (shop.length !== 1) problems.push(`${shop.length} asks name both ${R.shopOld} and ${R.shopNew}, not one`);
  else if (shop[0]!.status === 'closed') problems.push(`the ask about the two shop paths (${shop[0]!.ask}) is closed, not waiting on you`);
  return problems;
}

const askRows = (home: string): Promise<Ask[]> => control(home, async (c) => (await c.call('inbox.read')).asks as Ask[]);

async function scenario(env?: Record<string, string>): Promise<{ w: World; problems: string[] }> {
  onMac();
  const w = world();
  const first = await setupWithWindows(w, { env });
  expect(first.run.code, `deep setup exits 0: ${shown(first.run)}`).toBe(0);
  const asks1 = await askRows(w.h.home);
  const problems = mergeProblems(w.fx, claims(w.wiki), asks1);
  const second = await setupWithWindows(w, { env });
  expect(second.run.code, `the second deep setup exits 0: ${shown(second.run)}`).toBe(0);
  const asks2 = await askRows(w.h.home);
  problems.push(...mergeProblems(w.fx, claims(w.wiki), asks2).map((p) => `after the rerun: ${p}`));
  const before = naming(asks1, w.fx.repos.shopOld!, w.fx.repos.shopNew!).map((a) => a.ask);
  const after = naming(asks2, w.fx.repos.shopOld!, w.fx.repos.shopNew!).map((a) => a.ask);
  if (JSON.stringify(before) !== JSON.stringify(after)) problems.push(`the rerun changed the asks about the shop paths: ${before.join(',')} then ${after.join(',')}`);
  return { w, problems };
}

describe('#356.482272ce merges on exact keys, an unclear merge comes to you', () => {
  // The check itself, on hand-built wikis: it passes the right one and names each wrong one.
  const fx = fixture('/tmp/dh356-redraft-check/work');
  const handle = (s: Sess, n = 0): string => `session:${s.id.replace(/[^0-9A-Za-z]/g, '')}#${s.messages[n]!.id}`;
  const claim = (page: string, text: string, from: Sess[], proof = from.length): Claim => {
    const json = { id: text.replace(/\W+/g, '-').slice(0, 24), known: 'you', proof, sources: from.map((s) => ({ at: handle(s), quote: `remember: ${text}.` })) };
    return { page, line: `- ${text} <!-- deep:claim ${JSON.stringify(json)} -->`, text, json };
  };
  const [apiA, , apiCodex, web, api2, shopOld, shopNew] = fx.sessions as [Sess, Sess, Sess, Sess, Sess, Sess, Sess];
  const right = (): Claim[] => [
    claim('repos/api', 'api starts with `npm run dev`', [apiA, apiCodex]),
    claim('repos/api', 'api docs start with `npm run dev:api`', [apiCodex]),
    claim('repos/api', 'api release needs GITHUB_TOKEN from `gh auth token`', [apiA]),
    claim('repos/web', 'web deploy needs GH_TOKEN from `gh auth token`', [web]),
    claim('repos/api-2', 'api starts with `make serve`', [api2]),
    claim('repos/shop', 'shop starts with `docker compose up`', [shopOld]),
    claim('repos/shop-2', 'shop lints with `npm run lint`', [shopNew]),
  ];
  const ask = (q = `Is ${fx.repos.shopOld} the same repo as ${fx.repos.shopNew}?`): Ask => ({ ask: 'ask:1', status: 'shown', outcome: 'unanswered', question: q });
  const derivedCopy = claim('questions/api/start', 'api starts with `npm run dev`', [apiA, apiCodex]);

  it('#356.482272ce the check passes the right wiki (a derived questions/ page repeats a claim and counts once) and names each wrong one', () => {
    expect(mergeProblems(fx, [...right(), derivedCopy], [ask()])).toEqual([]);
    const without = (f: (c: Claim) => boolean): Claim[] => right().filter((c) => !f(c));
    const text = (re: RegExp) => (c: Claim) => re.test(c.text);
    // Never merged: the same command from two agents is two claims.
    const split = [...without(text(/npm run dev`/ )), claim('repos/api', 'api starts with `npm run dev`', [apiA]), claim('repos/api-codex', 'api starts with `npm run dev`', [apiCodex])];
    expect(mergeProblems(fx, split, [ask()]).join('\n')).toMatch(/only one agent/);
    expect(mergeProblems(fx, right().map((c) => c.page === 'repos/api-2' ? { ...c, page: 'repos/api' } : c), [ask()]).join('\n')).toMatch(/share the page repos\/api: merged on their name/);
    expect(mergeProblems(fx, right().map((c) => c.page === 'repos/shop-2' ? { ...c, page: 'repos/shop' } : c), [ask()]).join('\n')).toMatch(/shop folders share the page/);
    expect(mergeProblems(fx, right(), []).join('\n')).toMatch(/0 asks name both/);
    expect(mergeProblems(fx, right(), [ask(), { ...ask(), ask: 'ask:2' }]).join('\n')).toMatch(/2 asks name both/);
    expect(mergeProblems(fx, right(), [{ ...ask(), status: 'closed' }]).join('\n')).toMatch(/is closed/);
    // Similar names merged: dev:api folded into dev, GH_TOKEN into GITHUB_TOKEN, two api repos into one claim.
    const similar = [...without(text(/dev:api|GITHUB_TOKEN|GH_TOKEN/)), claim('repos/api', 'api starts with `npm run dev` and `npm run dev:api`', [apiA, apiCodex]), claim('repos/api', 'api needs GITHUB_TOKEN and GH_TOKEN', [apiA, web])];
    const out = mergeProblems(fx, similar, [ask()]).join('\n');
    expect(out).toMatch(/states `npm run dev` and `npm run dev:api` together/);
    expect(out).toMatch(/GITHUB_TOKEN and GH_TOKEN together/);
    const twoApis = [...without(text(/make serve/)), claim('repos/api', 'api starts with `make serve`', [api2, apiA])];
    expect(mergeProblems(fx, twoApis, [ask()]).join('\n')).toMatch(/states `make serve` but also rests on/);
    expect(mergeProblems(fx, right(), [ask(), { ...ask(`Merge ${fx.repos.api} with ${fx.repos.api2}?`), ask: 'ask:3' }]).join('\n')).toMatch(/not an unclear merge/);
    expect(mergeProblems(fx, [], [ask()]).join('\n')).toMatch(/no claim states/);
  });

  it('#356.482272ce setup merges the same path and command from Claude Code and Codex, keeps similar names apart, and raises one ask for the deleted and the live shop; a rerun adds none', async () => {
    const { problems } = await scenario();
    expect(problems, problems.join('\n')).toEqual([]);
  }, 1_800_000);

  it('#356.482272ce (wrong program) a setup that merges by repo name, or never merges, is caught', async () => {
    for (const plant of ['merge-by-name', 'never-merge']) {
      const { problems } = await scenario({ DEEP_HUB_PLANT: plant });
      expect(problems.join('\n'), `plant ${plant} is caught`).toMatch(plant === 'merge-by-name' ? /share the page|also rests on|asks name both/ : /only one agent|asks name both|proof/);
    }
  }, 3_600_000);
});
