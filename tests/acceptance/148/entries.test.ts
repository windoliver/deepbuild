// AC15 #148.930bb7b7: A server spec carrying a field Codex's facts mark as one it refuses is refused for Codex before the
// plan shows, naming the field, while Claude Code gets the server; the same spec from your words, a pasted link and a
// restore is refused the same way; a write path that skips the check writes a config that Codex's own list command
// rejects and fails this test, naming the path.
//
// The field is `env` on an HTTP server: Codex 0.166.0-alpha.5.1's own loader refuses it ("env is not supported for
// streamable_http"), while Claude Code loads an HTTP entry that carries it. Codex's facts must mark it refused. The four
// write paths are `agents.propose` with `via` app, words, link and restore (README: The surface). The restore's backup
// comes from a hub running the wrong program, which wrote the server for Codex too; it is restored with `deep restore`
// into this test's world, whose hub then plans the restored set again. Each path's plan must refuse the server for Codex
// naming `env` and leave Codex's config.toml out; after your yes, config.toml is byte for byte as before, Codex's own
// list command reads it, and Claude Code lists the server.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, answer, claudeList, claudeLists, codexList, codexToml, deep, digest, factsOf, failsNaming, failureOf, makeWorld, propose, ranText, same, shown, startHub, stopHub, syncReaches, tag, useCleanup,
  type Line, type World,
} from './helpers.ts';

useCleanup();
const TWO = ['claude-code', 'codex'];
const WRONG = 'skips-entry-check';
const httpServer = (name: string): Line => ({ name, transport: 'http', url: 'http://127.0.0.1:9/mcp', env: { MCP_LOG: 'debug' } });

/** Whether the facts mark `field` refused: an object naming it as `field`, or a string, under a key that reads "refus...". */
function marksRefused(value: unknown, field: string, under = false): boolean {
  if (Array.isArray(value)) return value.some((v) => (under && v === field) || marksRefused(v, field, under));
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Line;
  if (under && o.field === field) return true;
  return Object.entries(o).some(([k, v]) => marksRefused(v, field, under || /refus/i.test(k)));
}

async function oneRoute(w: World, route: string, params: Line, name: string): Promise<void> {
  const before = digest(codexToml(w));
  const p = await propose(w, params);
  await answer(w, p.ask, 'apply');
  await syncReaches(w, p.sync, ['complete', 'refused', 'conflict'], 60_000).catch(() => undefined);
  const codex = await codexList(w);
  expect(codex.ran.code, `${route}: Codex's own list command reads ${codexToml(w)}: ${ranText(codex.ran)}`).toBe(0);
  expect(digest(codexToml(w)), `${route}: nothing is written to ${codexToml(w)} for a server Codex can't express`).toBe(before);
  expect(p.refused.some((r) => r.agent === 'codex' && r.field === 'env'), `${route}: the plan refuses ${name} for Codex, naming the field env: ${shown(p.refused)}`).toBe(true);
  expect(p.files.filter((f) => same(f.path, codexToml(w))).map((f) => f.path), `${route}: the plan leaves Codex's config.toml out`).toEqual([]);
  const claude = await claudeList(w);
  expect(claudeLists(claude, name), `${route}: Claude Code gets ${name}: ${ranText(claude)}`).toBe(true);
}

async function everyWritePath(plant?: string): Promise<void> {
  const w = await makeWorld();
  await startHub(w, { plant });
  const app = `forge-${tag()}`;
  await oneRoute(w, 'the app', { via: 'app', server: httpServer(app), agents: TWO }, app);
  const words = `forge-${tag()}`;
  await oneRoute(w, 'your words', { via: 'words', words: `add the ${words} server to Claude Code and Codex`, server: httpServer(words), agents: TWO }, words);
  const link = `forge-${tag()}`;
  await oneRoute(w, 'a pasted link', { via: 'link', link: `deepbuild:mcp/add?server=${Buffer.from(JSON.stringify(httpServer(link))).toString('base64url')}`, agents: TWO }, link);

  // A backup whose record wants the server for Codex too, from a hub running the wrong program.
  const a = await makeWorld();
  await startHub(a, { plant: WRONG });
  const restored = `forge-${tag()}`;
  const pa = await propose(a, { via: 'app', server: httpServer(restored), agents: TWO });
  await answer(a, pa.ask, 'apply');
  await syncReaches(a, pa.sync, ['complete', 'refused', 'conflict'], 60_000).catch(() => undefined);
  const backup = join(a.tmp, 'backup');
  const b = await deep(a, ['backup', backup]);
  expect(b.code, `deep backup: ${ranText(b)}`).toBe(0);
  await stopHub(a);
  await stopHub(w);
  const r = await deep(w, ['restore', backup], { env: { DEEP_HUB_PLANT: plant } });
  expect(r.code, `deep restore: ${ranText(r)}`).toBe(0);
  await startHub(w, { plant });
  await oneRoute(w, 'a restore', { via: 'restore' }, restored);
}

describe('#148 each agent\'s rules for an entry', () => {
  it(`${AC[15]} a server carrying a field Codex's facts refuse is refused for Codex before the plan shows, naming the field, from the app, your words, a pasted link and a restore, while Claude Code gets it`, async () => {
    expect(marksRefused(factsOf('codex'), 'env'), 'adapters/codex.facts.json marks env refused (for an HTTP server)').toBe(true);
    await everyWritePath();
  });
  it(`${AC[15]} twin: a write path that skips the check writes a config Codex's own list command rejects, and fails the check, naming the path`, async () => {
    failsNaming(await failureOf(() => everyWritePath(WRONG)), '.codex/config.toml', `DEEP_HUB_PLANT=${WRONG}`);
  });
});
