// #347 AC2: with the staging ceiling set to 1,000 files, an agent-written script that deletes an untracked folder of
// 5,000 files isn't staged: the partial copy is dropped, the command becomes an authority ask that says its reach is
// unknown before the agent's hook timeout, and the folder keeps its 5,000 files. A test file system that slows each
// clone past the seconds ceiling (DEEP_HUB_TEST_SLOW_CLONE_MS, README: Surfaces) gives the same ask, with the files
// ceiling out of reach. A stager with no ceiling (DEEP_HUB_PLANT=stages-without-ceiling) copies all 5,000, lets the
// script run with no ask, and fails this test.
//
// The agent writes wipe.sh with its Write tool (through the hooks, as Claude Code sends them), then runs
// `bash wipe.sh`. tmpdata/ is untracked and not ignored: git can't restore it.
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC2, KEEP, STAGING, agentWrites, begin, cleanup, expectAsked, failureOf, fill, makeWorld, must, newSession, startHub, stopHub, verdict,
  type Staging,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const COMMAND = 'bash wipe.sh';
const FILES = 5000;
/** The seconds ceiling for the slow file system, and how long each clone it makes takes: past the ceiling. */
const SECONDS = 2;
const SLOW_CLONE_MS = 3000;

async function scenario(o: { staging: Staging; plant?: string; slowCloneMs?: number; who: string }): Promise<void> {
  const w = makeWorld(o.staging);
  const data = fill(w, 'tmpdata', FILES, { perDir: 100, prefix: 'rec' });
  const hub = await startHub(w, { plant: o.plant, slowCloneMs: o.slowCloneMs });
  try {
    const s = newSession(w);
    await begin(s, 'Remove the generated test data in tmpdata.');
    await agentWrites(s, join(w.repo, 'wipe.sh'), '#!/bin/sh\n# Remove the generated test data.\nrm -rf tmpdata\n');
    await expectAsked(w, hub, s, COMMAND, data, o.who);
  } finally {
    await stopHub(hub);
  }
}

describe(`AC2 ${AC2} past the staging ceiling the copy is dropped and the delete becomes an authority ask that its reach is unknown, before the hook timeout, the folder kept whole`, () => {
  it(`AC2 ceiling 1,000 files: the agent-written wipe.sh deleting the untracked tmpdata/ of 5,000 files isn't staged, the partial copy is dropped, an authority ask says its reach is unknown before the hook timeout, and tmpdata/ keeps its 5,000 files`, async (ctx) => {
    await verdict(ctx, () => scenario({ staging: STAGING, who: `AC2 ${AC2} [1,000 files]` }));
  }, 600_000);

  it(`AC2 a test file system that slows each clone (${SLOW_CLONE_MS} ms) past the seconds ceiling (${SECONDS} s), files ceiling out of reach, gives the same ask, and tmpdata/ keeps its 5,000 files`, async (ctx) => {
    await verdict(ctx, () => scenario({ staging: { files: 100_000, seconds: SECONDS, keep: KEEP }, slowCloneMs: SLOW_CLONE_MS, who: `AC2 ${AC2} [${SECONDS} s, slow clones]` }));
  }, 600_000);

  it(`AC2 (wrong program) a stager with no ceiling (DEEP_HUB_PLANT=stages-without-ceiling) copies all 5,000, runs wipe.sh with no ask and fails this test`, async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario({ staging: STAGING, plant: 'stages-without-ceiling', who: `AC2 ${AC2} [1,000 files]` }));
      must(why !== null, `AC2 ${AC2} the planted stager stages-without-ceiling must fail this test; it passed`);
      must(why.includes(`\`${COMMAND}\` ran with no ask`), `AC2 ${AC2} the planted stager stages-without-ceiling must fail this test by running \`${COMMAND}\` with no ask; it failed with: ${why}`);
    });
  }, 600_000);
});
