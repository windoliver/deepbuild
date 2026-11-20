// Writes fixtures/base.json, the merge base's bytes the tests compare with (README: The merge base's bytes): each
// server's tools as tools/list gives them (name, description, input schema) and the kind the hub gives each of its own
// tools. It runs only when CAPTURE_2898=1, on a checkout of the merge base; it asserts nothing and carries no tag.
import { writeFileSync } from 'node:fs';
import { afterAll, it } from 'vitest';
import { BASE_FILE, callsWorld, cleanup, kindsOf, listings, plainHub, type Base } from './helpers.ts';

afterAll(cleanup, 60_000);

it.runIf(process.env.CAPTURE_2898 === '1')('captures the merge base\'s listings and kinds into fixtures/base.json', async () => {
  const p = await plainHub();
  const tools: Base['tools'] = {};
  for (const l of await listings(p)) tools[l.server] = l.tools.map((t) => ({ name: String(t.name), description: String(t.description), inputSchema: t.inputSchema }));
  await p.close();
  const w = await callsWorld();
  const names = [...tools['deep mcp']!.map((t) => `mcp__deep__${t.name}`), ...tools['deep mcp actions']!.map((t) => `mcp__deep-actions__${t.name}`)];
  const kinds = await kindsOf(w.hub, w.sessions.get('agent')!, names);
  await w.close();
  writeFileSync(BASE_FILE, `${JSON.stringify({ tools, kinds }, null, 1)}\n`);
}, 900_000);
