// #880.25cf9ef0: a helper whose code signature differs from the one recorded at setup isn't started, which the test
// proves by a marker file the helper would write, and the answer is refused naming the path (README: The contract per
// criterion, 3). The impostor shares the recorded helper's identifier and differs in its code (its CDHash); started, it
// writes the marker first and then signs honestly with the recorded key, so only the code-signature check can stop it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { buildHelper, cleanup, deep, expectCountedOnce, expectOpen, expectRefusedNaming, identity, impostorMarker, installHelper, ready, setMode } from './helpers.ts';

afterEach(cleanup, 60_000);

test('#880.25cf9ef0 a helper whose code signature differs from the one recorded at setup isn\'t started, and the answer is refused naming the path', async () => {
  const { rig, hub, asks: [ask] } = await ready(['release v1']);

  const impostor = join(rig.tmp, 'impostor.bin');
  buildHelper(rig, 'impostor', impostor);
  const recorded = identity(rig.built);
  const differs = identity(impostor);
  if (!recorded.cdhash || recorded.identifier !== differs.identifier || recorded.cdhash === differs.cdhash) {
    throw Error(`BLOCKED: the impostor must share the recorded helper's identifier and differ in its CDHash: ${JSON.stringify({ recorded, differs })}`);
  }
  installHelper(rig, impostor);

  setMode(rig, { mode: 'sign' });
  const r = await deep(rig, ['inbox', 'answer', ask!, 'approve']);
  const marker = impostorMarker(rig);
  expect(existsSync(marker) ? readFileSync(marker, 'utf8') : null, `the helper whose code signature differs from the one recorded at setup (CDHash ${differs.cdhash}, not ${recorded.cdhash}) was started: it wrote ${marker}`).toBeNull();
  await expectOpen(hub, ask!, 'the helper replaced by one whose code signature differs from the one recorded at setup');
  expectRefusedNaming(r, rig.helper, 'a helper whose code signature differs');

  // The helper setup recorded, put back: the same answer counts, so the refusal came from the impostor's signature.
  installHelper(rig, rig.built);
  const again = await deep(rig, ['inbox', 'answer', ask!, 'approve']);
  expect(again.code, `with the recorded helper back in place, the same answer counts and exits 0: ${again.stdout} ${again.stderr}`).toBe(0);
  await expectCountedOnce(hub, ask!, 'approve', 'the recorded helper back in place');
  expect(existsSync(marker), 'the impostor never ran').toBe(false);
}, 600_000);
