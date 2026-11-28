// Writes fixtures/base.json from a checkout of the merge base (README: The merge base's bytes): deep mcp's tools/list
// as the base gives it, and the hash the base's deep_kinds fetch gives the model. Runs only with CAPTURE_3525=1, on the
// base; it carries no criterion's tag and proves nothing on its own.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { fetchUntilDone, onWorld } from '../1731/helpers.ts';
import { BASE_FILE, MODEL, deepMcp, plainHub, ruled, t26 } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

it.runIf(process.env.CAPTURE_3525 === '1')('captures the merge base\'s tools/list and the hash its fetch gives the model', async () => {
  const commit = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const p = await plainHub();
  const server = await deepMcp('deep mcp', p.home, p.cwd);
  const tools = await server.tools();
  server.child.kill('SIGTERM');

  const w = await onWorld();
  await ruled(w);
  const done = await fetchUntilDone(w, MODEL);
  expect(done.value.status, `the base's fetch brought the model in: ${done.text.slice(0, 800)}`).toBe('fetched');
  writeFileSync(BASE_FILE, `${JSON.stringify({ commit, tools, fetched: { [MODEL]: String(done.value.asset.sha256) } }, null, 2)}\n`);
}, 900_000);
