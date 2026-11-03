// #55 on a real paseo daemon, the release the facts pin (README, The worlds): AC1 (the turn's end reaches the hub with
// the agent's own session ID; an ask in paseo's phone app), AC5 (every agent paseo creates lists DeepBuild's MCP tools)
// and AC7 (removing the plugin leaves paseo's configuration as it was). The agent is fixtures/fake-provider, a stand-in
// for the model and the agent's CLI; paseo, the hub, `deep setup` and the plugin are real.
// First: what you gave the suite by hand, before ../29's helpers delete it (README, Disputes D1).
import './env.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deep, setup, startHub } from '../27/helpers.ts';
import {
  AC, FAKE_PROVIDER, PLUGIN, Paseo, about, cleanup, events, kinds, makeHome, needPlugin, packed, readFacts, registry, tempDir, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 120_000);

/** The plugin's ID in paseo (README, The surface). */
const ID = 'deepbuild';
/** The tools the criterion names: what makes deep_claim, deep_ask, deep_propose and deep_search work in every agent. */
const NAMED = ['deep_claim', 'deep_ask', 'deep_propose', 'deep_search'];

/** A home with the hub running, and paseo's daemon with the stand-in agent and the plugin from packages/paseo. */
async function world(): Promise<{ home: string; paseo: Paseo }> {
  needPlugin();
  const { home } = makeHome({ paseo: true });
  await startHub(home);
  const paseo = await Paseo.start(home);
  await paseo.install(FAKE_PROVIDER, 'dh55-fake');
  await paseo.install(PLUGIN, ID);
  return { home, paseo };
}
/** What the stand-in agent in `dir` listed from each MCP server it was opened with, once it has listed them all. */
async function listed(dir: string): Promise<Line[]> {
  const done = () => {
    const seen = Paseo.seen(dir);
    const open = seen.find((l) => l.open);
    const tools = seen.filter((l) => l.tools);
    return open && tools.length >= Object.keys(open.servers ?? {}).length ? tools : undefined;
  };
  return waitFor(done, 60_000, `the agent in ${dir} to list its MCP servers' tools`).catch(() => Paseo.seen(dir).filter((l) => l.tools));
}

describe(`${AC[1]} On the pinned paseo version, the plugin's turn-end hook fires with the session ID, and an ask shows in paseo's phone app`, () => {
  it(`${AC[1]} on the pinned paseo, a turn's end reaches the hub as the agent's stop under the session ID paseo reads for the agent`, async () => {
    const { home, paseo } = await world();
    const id = await paseo.runAgent(join(tempDir(), 'w'), 'Say done.');
    // The agent's own session ID as paseo keeps it for the agent: runtimeInfo in its saved file.
    const saved = await waitFor(() => paseo.saved(id), 30_000, `paseo's saved file for agent ${id}`);
    const session = String(saved.runtimeInfo?.sessionId ?? saved.persistence?.sessionId ?? '');
    expect(session, `${AC[1]} paseo reads a session ID for agent ${id}: ${JSON.stringify(saved).slice(0, 800)}`).not.toBe('');
    const stop = await waitFor(async () => (await events(home)).find((e) => e.kind === 'agent.stop' && e.session === session), 60_000, `agent.stop under ${session}`).catch(() => undefined);
    const all = await events(home);
    expect(stop, `${AC[1]} paseo's agent.turn.after for agent ${id} must reach the hub as the stop of session ${session}, the agent's own session ID as paseo reads it; the record about it holds ${kinds(all.filter((e) => about(e, session) || about(e, id))) || 'nothing'}; daemon ${paseo.output().slice(-800)}`).toBeDefined();
    expect(all.filter((e) => e.session === id), `${AC[1]} nothing is recorded under paseo's own agent ID ${id} as if it were the session`).toEqual([]);
  }, 600_000);

  it(`${AC[1]} an ask shows in paseo's phone app`, () => {
    // Paseo's phone app, paired with a person's phone, and the paseo channel (#65) that draws Needs you there, are what
    // this half needs. Neither is on this Mac, and no test can look at a phone: it reads BLOCKED, never a skip.
    throw Error('BLOCKED: no paseo phone app is paired on this Mac, and no paseo channel (#65) puts Needs you there; #55, #65 and #146 are BLOCKED until a person sees an ask in paseo\'s phone app (README, AC1)');
  });
});

describe(`${AC[5]} Every agent paseo creates lists DeepBuild's MCP tools`, () => {
  it(`${AC[5]} two agents paseo creates each start DeepBuild's MCP server and list ${NAMED.join(', ')}`, async () => {
    const { paseo } = await world();
    const folders = [join(tempDir(), 'a'), join(tempDir(), 'b')];
    for (const dir of folders) await paseo.runAgent(dir, 'Say done.');
    for (const dir of folders) {
      const seen = await listed(dir);
      const names = seen.flatMap((l) => (l.tools.names ?? []) as string[]);
      for (const tool of NAMED) expect(names, `${AC[5]} the agent paseo created in ${dir} lists ${tool}; it was opened with ${JSON.stringify(Paseo.seen(dir).find((l) => l.open)?.servers ?? {})} and listed ${JSON.stringify(seen)}`).toContain(tool);
    }
  }, 600_000);
});

describe(`${AC[7]} Removing the plugin leaves paseo's configuration as it was`, () => {
  it(`${AC[7]} deep setup adds the pinned plugin to the paseo it finds, and deep setup --undo puts paseo's config.json back byte for byte, with no DeepBuild server left in an agent paseo saved meanwhile`, async () => {
    const facts = readFacts();
    const { name, version, tgz } = await packed();
    expect(facts.install?.source, `${AC[7]} the facts pin the plugin at its package's exact version`).toBe(`npm:${name}@${version}`);
    // A newer version on the registry: only the pin installs the one the facts name.
    const newer = `${version.split('.').slice(0, 2).join('.')}.${Number(version.split('.')[2]) + 1}`;
    const url = await registry(name, { [version]: tgz, [newer]: tgz });
    const { home, tmp } = makeHome({ paseo: true });
    const npm = { npm_config_registry: url, npm_config_cache: join(tmp, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
    await startHub(home);
    const paseo = await Paseo.start(home, { env: npm });
    await paseo.install(FAKE_PROVIDER, 'dh55-fake');
    const file = join(paseo.root, 'config.json');
    const before = readFileSync(file);

    await setup(home, npm);
    const installed = await paseo.running(ID, 120_000).catch(() => undefined);
    expect(installed, `${AC[7]} deep setup installs the plugin as ${ID} into the paseo it found; paseo lists ${JSON.stringify(await paseo.plugins())}`).toBeDefined();
    expect(JSON.stringify(installed), `${AC[7]} paseo holds the plugin at the pinned ${version}, not ${newer}`).toContain(version);
    expect(JSON.stringify(installed), `${AC[7]} paseo holds the plugin at the pinned ${version}, not ${newer}`).not.toContain(newer);
    const dir = join(tempDir(), 'w');
    const agent = await paseo.runAgent(dir, 'Say done.');
    const tools = (await listed(dir)).flatMap((l) => (l.tools.names ?? []) as string[]);
    if (!tools.includes('deep_claim')) throw Error(`BLOCKED: the plugin setup installed gave the new agent no DeepBuild MCP server: ${JSON.stringify(Paseo.seen(dir))}`);

    const undo = await deep(home, ['setup', '--undo'], { env: npm });
    expect(undo.code, `${AC[7]} deep setup --undo exits 0: ${undo.stdout} ${undo.stderr}`).toBe(0);
    const after = readFileSync(file);
    expect(after.toString('utf8'), `${AC[7]} paseo's ${file} must be byte for byte what it was before setup`).toBe(before.toString('utf8'));
    const left = await paseo.plugins();
    expect(left.filter((p) => (p.id ?? p.plugin) === ID), `${AC[7]} paseo no longer lists the plugin: ${JSON.stringify(left)}`).toEqual([]);
    const saved = paseo.saved(agent);
    expect(saved, `${AC[7]} paseo saved the agent it made while the plugin was in`).toBeDefined();
    const servers = (saved!.config?.mcpServers ?? {}) as Record<string, unknown>;
    expect(Object.entries(servers).filter(([, s]) => /deep/.test(JSON.stringify(s))), `${AC[7]} the agent's saved configuration keeps no DeepBuild server once the plugin is gone: ${JSON.stringify(saved!.config)}`).toEqual([]);
  }, 900_000);
});
