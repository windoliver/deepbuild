// #1411 AC3: a held-back pool never reaches 0 tokens, so a running build always finishes. The same world and stand-in
// build as AC1's, at `normal` with all 8 out. The level turns `critical`: the pool must hold back all but one within 15
// s, else no pool is held back to read. After 3 s more the build is let go: it runs 10 more jobs, on what the pool leaves
// it, and must exit 0 within 120 s, the level still critical. Then, still critical and with no build running, the pool's
// pipe is read every 200 ms for 3 s (#1016's read: every byte taken without waiting and written back): every read must
// hold at least one token. Its wrong program holds back every token at critical, the last one too, once the build that
// ran on it ends (DEEP_HUB_PLANT=holds-back-every-token).
import { describe, expect, it } from 'vitest';
import { mustFail, tokensIn } from '../1016/helpers.ts';
import { AC3, CORES, entriesRepo, fullAtNormal, heldBack, joinedPool, pressed, sleep, startBuild, timeline, World, type Phase } from './helpers.ts';

const TAIL = 10;
const FINISH_MS = 120_000;
const IDLE_MS = 3000;

interface Seen { w: World; critical: Phase; exit?: number | null; idle: { ms: number; pipe: number }[] }

async function underCritical(plant?: string): Promise<Seen> {
  const w = new World({ cores: CORES, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const repo = entriesRepo(w);
    const t0 = Date.now();
    const { build, full, fifo } = await startBuild(w, repo, { DH1411_TAIL: String(TAIL) });
    joinedPool(w, build);
    fullAtNormal(w, full);
    const critical = await pressed(w, 'critical', 3000);
    const goAt = Date.now();
    w.go('build');
    const end = await Promise.race([build.done, sleep(FINISH_MS).then(() => undefined)]);
    const idle: { ms: number; pipe: number }[] = [];
    if (end && fifo) {
      const t1 = Date.now();
      while (Date.now() - t1 <= IDLE_MS) {
        idle.push({ ms: Date.now() - t1, pipe: tokensIn(fifo) });
        await sleep(200);
      }
    }
    // The Proof's reading: the pool driven by the scripted level, its tokens out over time, then the idle pipe.
    console.log(`AC3 ${plant ?? 'as built'}: tokens out over time (level in brackets): ${timeline(w, t0, goAt)} at critical: ${end ? `exit ${end.code} after its last ${TAIL} jobs` : `still running after ${FINISH_MS} ms`}; then, critical, no build running, the pipe held: ${idle.map((x) => `+${x.ms} ms ${x.pipe}`).join(', ') || 'not read'}`);
    return { w, critical, ...(end ? { exit: end.code } : {}), idle };
  } finally {
    w.setLevel('normal');
    await w.stopHub();
  }
}

/** Held back at critical; the build let go there finishes; and the pool keeps a token out once it has ended. */
function neverEmpty(s: Seen): void {
  heldBack(s.w, s.critical, 'a "held-back pool" needs the pool held back at critical first: ');
  expect(s.exit, `a running build always finishes: let go at \`critical\`, the build must run its last ${TAIL} jobs and exit 0 within ${FINISH_MS / 1000} s, the level still critical: ${s.exit === undefined ? 'it was still running' : `it exited ${s.exit}`}`).toBe(0);
  expect(s.idle.length, 'the pool\'s pipe must be read once the build has ended').toBeGreaterThan(0);
  const empty = s.idle.find((x) => x.pipe === 0);
  if (empty) expect.fail(`a held-back pool never reaches 0 tokens: at \`critical\`, with the build ended, the pool's pipe held 0 tokens ${empty.ms} ms after its \`deep lease\` exited (reads: ${s.idle.map((x) => x.pipe).join(', ')})`);
}

describe(`${AC3} a held-back pool keeps a token out, so a running build finishes`, () => {
  it(`${AC3} a held-back pool never reaches 0 tokens, so a running build always finishes`, async () => {
    neverEmpty(await underCritical());
  }, 600_000);

  it(`${AC3} (wrong program) a pool that holds back every token at critical (DEEP_HUB_PLANT=holds-back-every-token) is left with none once the build ends, and fails`, async () => {
    const s = await underCritical('holds-back-every-token');
    await mustFail('holds-back-every-token', () => neverEmpty(s), ['never reaches 0 tokens']);
  }, 600_000);
});
