// #347 AC3: `npm test`, `npm run build` and `cargo build`, run from scripts this session didn't change (package.json,
// test.js, build.js and the Cargo project are in the base commit), are neither staged nor asked about, while an
// agent-written clean.sh that runs `rm -rf "$OUT"/*` is staged before it runs and can be undone. A stager that stages
// every command whose writes it can't predict (DEEP_HUB_PLANT=stages-unpredicted-writes) stages `npm run build` and
// fails, naming it.
//
// The session writes clean.sh with its Write tool first (through the hooks, as Claude Code sends them), so the three
// build commands run in a session that has changed a file, just not the scripts they run. build/ is ignored and holds
// an earlier build's output: what clean.sh deletes, and what a stager staging the working folder would copy.
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC3, agentWrites, begin, cleanup, expectStaged, expectUndone, failureOf, fill, makeWorld, must, neither, newSession, startHub, stopHub,
  verdict, type Filled, type Hub, type Session, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const CLEAN = '#!/bin/sh\n# Clear the build output before a fresh build.\nset -eu\nOUT=build\nrm -rf "$OUT"/*\n';
const RUN_CLEAN = 'bash clean.sh';
const BUILDS = ['npm run build', 'npm test', 'cargo build'];

async function world(plant?: string): Promise<{ w: World; hub: Hub; s: Session; build: Filled }> {
  const w = makeWorld();
  const build = fill(w, 'build', 30, { big: 3, prefix: 'obj' });
  const hub = await startHub(w, { plant });
  const s = newSession(w);
  await begin(s, 'Clear the build output, then rebuild and run the tests.');
  await agentWrites(s, join(w.repo, 'clean.sh'), CLEAN);
  return { w, hub, s, build };
}

/** The three build commands, each judged; then clean.sh is staged, the contrast the criterion draws. */
async function scenario(plant?: string): Promise<void> {
  const who = `AC3 ${AC3}`;
  const { w, hub, s, build } = await world(plant);
  try {
    const wrong: string[] = [];
    for (const command of BUILDS) {
      const why = await neither(w, hub, s, command, build, who);
      if (why) wrong.push(why);
    }
    must(!wrong.length, `${who} commands run from scripts this session didn't change must be neither staged nor asked about: ${wrong.join('; ')}`);
    await expectStaged(w, hub, s, RUN_CLEAN, build, who);
  } finally {
    await stopHub(hub);
  }
}

describe(`AC3 ${AC3} builds from scripts this session didn't change are neither staged nor asked about; the agent-written clean.sh is staged and can be undone`, () => {
  it(`AC3 npm test, npm run build and cargo build, from scripts this session didn't change, are neither staged nor asked about, while the agent-written clean.sh running rm -rf "$OUT"/* is staged`, async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 900_000);

  it(`AC3 the agent-written clean.sh running rm -rf "$OUT"/* is staged before it runs, and deep undo brings back build/ with its bytes`, async (ctx) => {
    await verdict(ctx, async () => {
      const who = `AC3 ${AC3} [clean.sh]`;
      const { w, hub, s, build } = await world();
      try {
        const staged = await expectStaged(w, hub, s, RUN_CLEAN, build, who);
        await expectUndone(w, staged, build, RUN_CLEAN, who);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);

  it(`AC3 (wrong program) a stager that stages every command whose writes it can't predict (DEEP_HUB_PLANT=stages-unpredicted-writes) stages npm run build and fails, naming it`, async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario('stages-unpredicted-writes'));
      must(why !== null, `AC3 ${AC3} the planted stager stages-unpredicted-writes must fail this test; it passed`);
      must(why.includes('`npm run build` was staged'), `AC3 ${AC3} the planted stager stages-unpredicted-writes must fail this test naming \`npm run build\` as staged; it failed with: ${why}`);
    });
  }, 900_000);
});
