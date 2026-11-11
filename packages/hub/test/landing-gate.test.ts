// #1331's gap beyond its blind suite (tests/acceptance/1331, whose world this reuses by path): the Scope's "the hub lands
// one change at a time per repo, through the gate identity (#1325)". With DeepBuild's own rulesets on the forge
// (`deep gate rules`) and the gate's app named in your settings, a change with a PASS lands through the gate's app: the
// forge records the merge by the gate's app, never by your login. The wrong program is a lander that merges with your
// login, as #2279's first draft did: the same round then lands through the admin's bypass, and this test names it.
import { execFile } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile, draftFor, requirement, World } from '../../../tests/acceptance/1331/helpers.ts';
import { CLI, NODE, stopHub } from '../../../tests/acceptance/29/h-d.ts';

const GATE = { id: 913251, slug: 'deepbuild-gate', service: 'deepbuild.github.gate' };

/** The gate's app on the world's forge, its key in the hub's test Keychain, your settings naming it, and DeepBuild's rules on main. */
async function gated(w: World): Promise<string> {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  w.forge.gate.app({ id: GATE.id, slug: GATE.slug, publicKeyPem: createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }).toString(),
    permissions: { metadata: 'read', contents: 'write', pull_requests: 'write', issues: 'write', statuses: 'write' } });
  mkdirSync(join(w.home, 'Library/Keychains'), { recursive: true, mode: 0o700 });
  writeFileSync(join(w.home, 'Library/Keychains/deepbuild-test.json'), JSON.stringify({ [GATE.service]: pem }), { mode: 0o600 });
  const config = JSON.parse(readFileSync(join(w.root, 'config.json'), 'utf8')) as { github: Record<string, unknown> };
  config.github.gate = { app_id: GATE.id, key: GATE.service };
  writeFileSync(join(w.root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  // `deep gate rules` reads the settings, as you'd run it; maya, the admin, puts each ruleset on.
  const printed = await new Promise<string>((resolve, reject) => execFile(NODE, [CLI, 'gate', 'rules', '--json'], { env: { ...process.env, HOME: w.home } }, (e, out, err) => (e ? reject(Error(`deep gate rules: ${err}`)) : resolve(out))));
  for (const body of (JSON.parse(printed) as { rulesets: unknown[] }).rulesets) {
    const res = await fetch(`${w.forge.url}/repos/acme/shop/rulesets`, { method: 'POST', headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status, `the forge takes DeepBuild's ruleset: ${await res.text()}`).toBe(201);
  }
  return join(w.home, 'Library/Keychains/deepbuild-test.json');
}

/** One change judged and landed under the rules; the forge's record of its merge. */
async function landOnce(plant?: string): Promise<{ w: World; merges: { login: string | null; status: number }[] }> {
  const w = await World.open({ drafts: [draftFor(100, [requirement('R1', 'x1 works', checkFile('own1'))])], ...(plant ? { plant } : {}) });
  const keychain = await gated(w);
  // The hub reads the gate's key from its test Keychain (DEEP_HUB_TEST_KEYCHAIN), so it starts again with it.
  const self = w as unknown as { env(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv; startHub(): Promise<World['hub']> };
  const env = self.env.bind(w);
  self.env = (extra = {}) => env({ ...extra, DEEP_HUB_TEST_KEYCHAIN: keychain });
  await stopHub(w.hub);
  w.hub = await self.startHub();
  await w.change('gated', { 'src/x1.ts': "export const v = 'gated';\n" });
  const judged = await w.judge();
  expect(judged.code, `deep land judge: ${judged.stderr.slice(0, 400)}`).toBe(0);
  const round = await w.land();
  expect(round.code, `deep land: ${round.stderr.slice(0, 400)}`).toBe(0);
  return { w, merges: w.forge.gate.attempts.filter((a) => a.action === 'merge').map((a) => ({ login: a.login, status: a.status })) };
}

describe('#1331 Scope: the hub lands through the gate identity (#1325)', () => {
  it("lands a change with a PASS through the gate's app, under DeepBuild's rules; a lander that merges with your login fails, naming it", async () => {
    const { w, merges } = await landOnce();
    expect(merges, 'one merge, by the gate\'s app, which the forge took').toEqual([{ login: `${GATE.slug}[bot]`, status: 200 }]);
    expect((await w.landings()).length, 'the change landed on main').toBe(1);
    expect(w.forge.issues.get(100)!.state, 'its issue closed once it landed').toBe('closed');

    const planted = await landOnce('lands-as-person');
    const by = planted.merges.map((m) => m.login);
    expect(by, 'the planted lander merged with your login').toContain('maya');
    expect(by, "and so the gate's app made no merge").not.toContain(`${GATE.slug}[bot]`);
  }, 30 * 60_000);
});
