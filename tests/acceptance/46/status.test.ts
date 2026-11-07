// The verdict-to-status path through a real hub (README: The world), with the forge as GitHub:
// AC1 a PASS posts a green status only for the commit it covers. AC2 a new commit leaves no stale green status.
// AC3 an INCONCLUSIVE or BLOCKED verdict posts a pending status, never a green one, and the description names the
// verdict and the open items. AC5 a head held as untrusted gets a pending status naming the cause. AC6 nothing posts
// until the repo has a delivery rule. AC9 DeepBuild never changes branch protection; the README shows how to require it.
//
// A PASS from the gate runs the real check on the real claim; other outcomes are planted on a real claim with
// `test.verdict`, the events the core's gate would append. Each negative ends on a later status landing, so a poster
// that is merely slow can't read as one that posted nothing.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, AC2, AC3, AC5, AC6, AC9, cleanup, CONTEXT, type Outcome, QUIET_MS, READ_WAIT, REPO, sleep, STATUS_WAIT, STRANGER, Worker, World, YOU } from './helpers.ts';

afterEach(cleanup, 60_000);
const HUB = 300_000;

/** A commit of a new file, pushed by the session's own call, and a claim on it. */
async function pushedClaim(s: Worker): Promise<{ sha: string; claim: Awaited<ReturnType<Worker['claim']>> }> {
  const sha = await s.commitFile(`notes/${Math.random().toString(36).slice(2)}.md`);
  await s.push();
  return { sha, claim: await s.claim(sha) };
}

describe(`${AC1} A PASS posts a green status only for the commit it covers`, () => {
  it(`${AC1} the gate's PASS on a pushed commit posts ${CONTEXT}: success there and nowhere else, its description naming PASS`, async () => {
    const w = await World.start();
    const s = await w.session();
    const parent = await s.commitFile('notes/first.md');
    await s.push();
    await s.fix();
    const sha = await s.commit('Fix the cart total');
    await s.push();
    await s.stop('The cart total now uses the new rate.');
    await w.gatePass(sha);
    const status = await w.status(sha);
    expect(status, `the status on ${sha}`).toMatchObject({ repo: 'acme/shop', state: 'success', context: CONTEXT });
    expect(status.description, 'the description names the verdict').toContain('PASS');
    expect(w.forge.statusesOf(parent), `the parent ${parent} isn't covered`).toEqual([]);
  }, HUB);

  it(`${AC1} a PASS on an older commit lands on that commit, not on the branch's HEAD`, async () => {
    const w = await World.start();
    const s = await w.session();
    const older = await s.commitFile('notes/older.md');
    await s.push();
    const newer = await s.commitFile('notes/newer.md');
    await s.push();
    await s.verdict(await s.claim(older), 'PASS');
    expect((await w.status(older)).state, `the PASS covers ${older}`).toBe('success');
    await s.verdict(await s.claim(newer), 'INCONCLUSIVE');
    await w.status(newer);
    expect(w.forge.statusesOf(newer).map((x) => x.state), `${newer} never held ${older}'s PASS`).toEqual(['pending']);
  }, HUB);
});

describe(`${AC2} A new commit leaves no stale green status`, () => {
  it(`${AC2} after a PASS on one commit, the next pushed commit holds no green status until a verdict of its own`, async () => {
    const w = await World.start();
    const s = await w.session();
    const passed = await pushedClaim(s);
    await s.verdict(passed.claim, 'PASS');
    expect((await w.status(passed.sha)).state).toBe('success');
    const next = await s.commitFile('notes/next.md');
    await s.push();
    await sleep(QUIET_MS);
    expect(w.forge.statusesOf(next).filter((x) => x.state === 'success'), `${next} carries no green from ${passed.sha}`).toEqual([]);
    await s.verdict(await s.claim(next), 'BLOCKED');
    await waitForState(w, next, 'pending');
    expect(w.forge.statusesOf(next).map((x) => x.state), `${next}'s every status`).not.toContain('success');
  }, HUB);
});
const waitForState = async (w: World, sha: string, state: string): Promise<void> => {
  for (const deadline = Date.now() + STATUS_WAIT; Date.now() < deadline; await sleep(100)) if (w.forge.latest(sha)?.state === state) return;
  throw Error(`${sha} never held ${state}: ${JSON.stringify(w.forge.statusesOf(sha))}`);
};

describe(`${AC3} An INCONCLUSIVE or BLOCKED verdict posts a pending status, never a green one`, () => {
  it.each(['INCONCLUSIVE', 'BLOCKED'] as const)(`${AC3} %s posts ${CONTEXT}: pending, its description naming the verdict`, async (outcome: Outcome) => {
    const w = await World.start();
    const s = await w.session();
    const { sha, claim } = await pushedClaim(s);
    await s.verdict(claim, outcome);
    const status = await w.status(sha);
    expect(status, `the status on ${sha}`).toMatchObject({ state: 'pending', context: CONTEXT });
    expect(status.description, 'the description names the verdict').toContain(outcome);
  }, HUB);

  it.each(['FAIL', 'INVALID'] as const)(`${AC3} %s is never green either: its status is a failure or an error, naming the verdict`, async (outcome: Outcome) => {
    const w = await World.start();
    const s = await w.session();
    const { sha, claim } = await pushedClaim(s);
    await s.verdict(claim, outcome);
    const status = await w.status(sha);
    expect(['failure', 'error'], `the state on ${sha}`).toContain(status.state);
    expect(status.context).toBe(CONTEXT);
    expect(status.description).toContain(outcome);
  }, HUB);

  it(`${AC3} a later INCONCLUSIVE on a commit that was green turns its status pending`, async () => {
    const w = await World.start();
    const s = await w.session();
    const { sha, claim } = await pushedClaim(s);
    await s.verdict(claim, 'PASS');
    expect((await w.status(sha)).state).toBe('success');
    await s.verdict(await s.claim(sha), 'INCONCLUSIVE');
    await waitForState(w, sha, 'pending');
    expect(w.forge.latest(sha)!.description).toContain('INCONCLUSIVE');
  }, HUB);

  it(`${AC3} the description names the verdict and each open item, and a list past GitHub's 140 characters still posts, naming the verdict and how many`, async () => {
    const w = await World.start();
    const s = await w.session();
    const few = await pushedClaim(s);
    await s.openItem('rounding test');
    await s.openItem('rate flag');
    await s.verdict(few.claim, 'BLOCKED');
    const named = await w.status(few.sha);
    for (const text of ['BLOCKED', 'rounding test', 'rate flag']) expect(named.description, `the description names ${text}`).toContain(text);

    const many = await pushedClaim(s);
    const AREAS = ['cart', 'tax', 'shipping', 'refunds', 'coupons', 'invoices', 'receipts', 'currency', 'gift cards'];
    for (const area of AREAS) await s.openItem(`the ${area} rounding that this claim leaves for later work`);
    await s.verdict(many.claim, 'BLOCKED');
    const cut = await w.status(many.sha);
    expect(cut.description, 'the verdict stays').toContain('BLOCKED');
    expect(cut.description, 'and how many are open').toMatch(/\b9\b/);
    expect(w.forge.posts().filter((c) => c.status === 422), 'GitHub refuses a description past 140 characters').toEqual([]);
  }, HUB);
});

/** A session on a branch holding `pusher`'s commit, authored as you, with a commit of its own on top, pushed: its head has one commit no session made. */
async function headOver(w: World, pusher: string): Promise<{ s: Worker; sha: string; theirs: string }> {
  const out = w.outsider(pusher, YOU);
  const theirs = out.commit('feature', { 'docs/theirs.md': 'a line\n' });
  out.push('feature');
  const s = await w.session({ branch: 'feature' });
  await s.fix();
  const sha = await s.commit('Fix the cart total');
  await s.push();
  return { s, sha, theirs };
}

describe(`${AC5} A head the gate runner holds as untrusted gets a pending status whose description names the cause untrusted head, never a green one`, () => {
  it(`${AC5} a head holding a commit authored as you and pushed by a stranger gets ${CONTEXT}: pending, naming untrusted head, from the gate's own verdict and from a PASS alike`, async () => {
    const w = await World.start();
    const { s, sha, theirs } = await headOver(w, STRANGER);
    await s.stop('The cart total now uses the new rate.');
    await w.verdictOn(sha);
    const status = await w.status(sha);
    expect(status, `${sha} sits on ${theirs}, pushed by ${STRANGER}`).toMatchObject({ state: 'pending', context: CONTEXT });
    expect(status.description, 'the description names the cause').toContain('untrusted head');
    await s.verdict(await s.claim(sha), 'PASS');
    await sleep(QUIET_MS);
    expect(w.forge.statusesOf(sha).map((x) => x.state), 'never green').not.toContain('success');
    expect(w.forge.latest(sha)!.description, 'the cause stays').toContain('untrusted head');
  }, HUB);

  it(`${AC5} the same head pushed by an account you named goes green, so the cause comes from the pusher and not from a commit being made outside a session`, async () => {
    const w = await World.start({ yours: [YOU, 'cloud-agent'] });
    const { s, sha } = await headOver(w, 'cloud-agent');
    await s.verdict(await s.claim(sha), 'PASS');
    const status = await w.status(sha, READ_WAIT);
    expect(status, `${sha}'s every commit is yours`).toMatchObject({ state: 'success', context: CONTEXT });
  }, HUB);
});

describe(`${AC6} Nothing posts to GitHub until the repo has a delivery rule; public repos start with it off`, () => {
  it.each(['private', 'public'] as const)(`${AC6} a %s repo with no rule, then a rule that's off, posts nothing; a rule that's on posts the next verdict`, async (visibility) => {
    const w = await World.start({ rule: null, visibility });
    const s = await w.session();
    await s.verdict((await pushedClaim(s)).claim, 'PASS');
    await sleep(QUIET_MS);
    expect(w.forge.calls.filter((c) => c.method !== 'GET'), `a ${visibility} repo with no delivery rule: nothing written to GitHub`).toEqual([]);
    w.configure({ rule: 'off' });
    await s.verdict((await pushedClaim(s)).claim, 'PASS');
    await sleep(QUIET_MS);
    expect(w.forge.calls.filter((c) => c.method !== 'GET'), 'a rule that is off: nothing written either').toEqual([]);
    w.configure({ rule: 'on' });
    const { sha, claim } = await pushedClaim(s);
    await s.verdict(claim, 'PASS');
    expect((await w.status(sha)).state, 'the rule on: the verdict posts, so the silence above was the rule').toBe('success');
  }, HUB);
});

describe(`${AC9} DeepBuild never changes branch protection itself; the README shows how to require the status`, () => {
  const sourceFiles = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|mjs)$/.test(name) ? [path] : [];
  });

  it(`${AC9} while statuses post, the forge sees no call that changes branch protection or a ruleset, and no source names such a route`, async () => {
    const w = await World.start();
    const s = await w.session();
    const passed = await pushedClaim(s);
    await s.verdict(passed.claim, 'PASS');
    await w.status(passed.sha);
    const held = await pushedClaim(s);
    await s.verdict(held.claim, 'BLOCKED');
    await w.status(held.sha);
    expect(w.forge.statuses.length, 'both statuses landed, so the path ran').toBe(2);
    expect(w.forge.refused, 'calls that would change branch protection').toEqual([]);
    const named = [...readdirSync(join(REPO, 'packages')).flatMap((p) => sourceFiles(join(REPO, 'packages', p, 'src'))), ...sourceFiles(join(REPO, 'scripts'))]
      .filter((file) => /branches\/[^\s'"`]*\/protection|\/rulesets\b|(?:create|update|delete)(?:BranchProtectionRule|RepositoryRuleset)/.test(readFileSync(file, 'utf8')));
    expect(named, 'source files naming a route that changes branch protection').toEqual([]);
  }, HUB);

  it(`${AC9} the README's section on the status names ${CONTEXT} and says how to require it in branch protection`, () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
    const section = readme.split(/^#{1,6} /m).find((part) => part.includes(CONTEXT));
    expect(section, `a README section names the context ${CONTEXT}`).toBeDefined();
    expect(section, 'and branch protection').toMatch(/branch protection/i);
    expect(section, 'and how: the setting to turn on, or the command').toMatch(/require[sd]?\b[^\n]*status|required_status_checks|gh api/i);
  });
});
