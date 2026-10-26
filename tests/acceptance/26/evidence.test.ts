// #26.2ba61e05 A link in a session's working folder that points to a planted file outside it is refused with the
// same answer as a path that doesn't exist, and nothing from the planted file reaches the store or a log; a file
// inside the folder is stored by hash with origin agent; a hub that checks the path before resolving links stores
// the planted file and fails this test, naming the link.

import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  agentWorld, callTool, cleanup, errorOf, eventMatching, existsIn, filesHolding, rootOf, sha256, stopHub, valueOf, word, type Line, type Outcome,
} from './helpers.ts';

afterEach(cleanup, 30_000);

const LINK = 'notes.txt';
/**
 * The session's working folder holds `notes.txt`, a link to a planted file outside it, and `real.txt`, a file of its
 * own. The agent attaches the link, a path that doesn't exist, a path that climbs out with `..`, and the real file.
 */
async function attach(plant?: string): Promise<void> {
  const planted = `planted ${word(16)} content`;
  const inside = `inside ${word(16)} content`;
  const w = await agentWorld({ plant, files: { 'real.txt': inside } });
  const outside = join(w.tmp, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'planted.txt'), planted);
  symlinkSync(join(outside, 'planted.txt'), join(w.wt.path, LINK));

  const tried: [string, Outcome][] = [];
  for (const path of [LINK, 'missing.txt', '../outside/planted.txt']) tried.push([path, await callTool(w.agent, 'deep_evidence', { path })]);
  const real = await callTool(w.agent, 'deep_evidence', { path: 'real.txt' });

  const [link, missing, climbs] = tried.map(([path, o]) => [path, errorOf(o, `deep_evidence of ${path} (the link ${LINK} points outside the working folder to a planted file)`)] as [string, Line]);
  // The same answer as a path that doesn't exist: the same code, path, retryable and evidence, the same remediation
  // with the path sent in place of the other, and `actual` the path as it was sent.
  const shape = ([path, e]: [string, Line]) => ({
    code: e.code, path: e.path, retryable: e.retryable, evidence: e.evidence, remediation: String(e.remediation).split(path).join('<path>'), actual: e.actual === path ? '<path>' : e.actual,
  });
  expect(shape(link!), `deep_evidence answers the link ${LINK}, which points outside the working folder, exactly as missing.txt, which doesn't exist`).toEqual(shape(missing!));
  expect(shape(climbs!), `deep_evidence answers ../outside/planted.txt exactly as missing.txt (the link ${LINK} points there too)`).toEqual(shape(missing!));

  const stored = valueOf(real, 'deep_evidence of real.txt, a file inside the working folder');
  expect(stored?.sha256, 'real.txt is stored by its hash').toBe(sha256(inside));
  await eventMatching(w.hub, (e) => e.kind === 'evidence.stored' && e.data?.sha256 === sha256(inside), 10_000).then((e) => {
    expect(e?.data?.origin, 'real.txt is stored with origin agent').toBe('agent');
  });
  await stopHub(w.hub);
  const root = rootOf(w.home);
  expect(existsIn(root, `evidence/${sha256(inside).slice(0, 2)}/${sha256(inside).slice(2)}`), 'real.txt\'s bytes are in the store under their hash').toBe(true);
  expect(existsIn(root, `evidence/${sha256(planted).slice(0, 2)}/${sha256(planted).slice(2)}`), `the planted file behind the link ${LINK} is not in the store`).toBe(false);
  const leaked = [...filesHolding(root, [planted]), ...(w.hub.output().includes(planted) ? ['the hub\'s output'] : [])];
  expect(leaked, `nothing from the planted file behind the link ${LINK} reaches the store or a log`).toEqual([]);
}

test('#26.2ba61e05 a link out of the working folder is answered as a missing path and nothing of its target is kept; a file inside is stored by hash with origin agent', async () => {
  await attach();
}, 120_000);

test('#26.2ba61e05 (wrong program) a hub that checks the path before resolving links stores the planted file and fails, naming the link', async () => {
  await expect(attach('evidence-checks-path-first')).rejects.toThrow(new RegExp(`the link ${LINK.replace('.', '\\.')}`));
}, 120_000);
