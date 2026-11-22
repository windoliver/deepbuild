// #1411 AC4: a command leased with a fixed job count is unaffected by the held-back pool, and is named in the output.
// The repo's done.yaml gives `steadyrun` a fixed job count (`jobs: 3`, heavy.command@1's fixed number). The same world
// and stand-in build as AC1's run at `normal` with all 8 tokens out; the level turns `warn`, and 2 s later `deep lease --
// steadyrun` starts. Unaffected: it starts without waiting for a job token, is given no pool (no `--jobserver-auth` in
// MAKEFLAGS or CARGO_MAKEFLAGS) and no words of its own, its heartbeat runs on through 3 s of warn and 3 s of critical
// with no gap over 3 s, and, let go while the level is still critical, its `deep lease` exits 0. Named: a line of what
// the test's `deep lease` commands or the hub print names `steadyrun`, other than a line saying it waits or runs with
// no lease (README, Open points 7). Its wrong program runs the fixed-count command as a pool build
// (DEEP_HUB_PLANT=pool-holds-fixed-count).
import { describe, expect, it } from 'vitest';
import { mustFail } from '../1016/helpers.ts';
import { AC4, CORES, entriesRepo, fullAtNormal, joinedPool, sleep, startBuild, timeline, until, World, type Line } from './helpers.ts';

const NAME = 'steadyrun';
const START_MS = 60_000;
const GAP_MS = 3000;
/** Lines that name a command only because it waits for a lease or ran without one: not the output this criterion means. */
const NOT_NAMING = /deep lease: waiting|runs with no lease/;

interface Seen { started?: Line; waited: string[]; beats: number[]; warnAt: number; criticalAt: number; goAt: number; exit?: number | null; outputs: { what: string; text: string }[] }

async function besideAHeldPool(plant?: string): Promise<Seen> {
  const w = new World({ cores: CORES, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const repo = entriesRepo(w);
    const t0 = Date.now();
    const { build, full } = await startBuild(w, repo);
    joinedPool(w, build);
    fullAtNormal(w, full);
    const warnAt = Date.now();
    w.setLevel('warn');
    await sleep(2000);
    const fixed = w.lease(['--', NAME], repo, { DH1411_LABEL: 'fixed' });
    const waited = () => fixed.output().split('\n').filter((l) => /deep lease: waiting/.test(l));
    await until(() => Boolean(w.first('fixed', 'started')) || waited().length > 0 || fixed.finished(), START_MS);
    await sleep(3000);
    const criticalAt = Date.now();
    w.setLevel('critical');
    await sleep(3000);
    const goAt = Date.now();
    w.go('fixed');
    // One that never started waits for the pool still, and its `deep lease` ends with the hub.
    const end = w.first('fixed', 'started') ? await Promise.race([fixed.done, sleep(60_000).then(() => undefined)]) : undefined;
    const buildGoAt = Date.now();
    w.go('build');
    await Promise.race([build.done, sleep(60_000)]);
    const started = w.first('fixed', 'started');
    const seen: Seen = {
      ...(started ? { started } : {}), waited: waited(), beats: w.lines('fixed').filter((l) => l.what === 'beat').map((l) => Number(l.ms)), warnAt, criticalAt, goAt,
      ...(end ? { exit: end.code } : {}),
      outputs: [{ what: `\`deep lease -- ${NAME}\``, text: fixed.output() }, { what: '`deep lease -- jobbuild`', text: build.output() }, { what: 'the hub', text: w.hub?.stderr() ?? '' }],
    };
    // The Proof's reading: the build's tokens out over time beside the fixed-count command, and what was printed.
    console.log(`AC4 ${plant ?? 'as built'}: the build's tokens out over time (level in brackets): ${timeline(w, t0, buildGoAt)}; \`${NAME}\` ${started ? `started ${Number(started.ms) - warnAt} ms after warn, MAKEFLAGS ${JSON.stringify(started.makeflags)}, CARGO_MAKEFLAGS ${JSON.stringify(started.cargo_makeflags)}, words ${JSON.stringify(started.argv)}` : 'never started'}; ${seen.beats.length} heartbeats; exit ${seen.exit ?? 'none'}; printed: ${seen.outputs.map((o) => `${o.what} ${JSON.stringify(o.text.slice(-800))}`).join('; ')}`);
    return seen;
  } finally {
    w.setLevel('normal');
    await w.stopHub();
  }
}

/** It starts at warn without a token, gets no pool and no words, runs on through warn and critical, and exits 0 there. */
function unaffected(s: Seen): void {
  expect(s.waited, `a command leased with a fixed job count takes no token from the pool, so \`${NAME}\` must start at once at \`warn\` beside the held-back pool; it waited: ${s.waited.join(' | ')}`).toEqual([]);
  expect(s.started, `\`deep lease -- ${NAME}\` must start its command within ${START_MS / 1000} s at \`warn\`: it never did`).toBeDefined();
  const flags = [s.started!.makeflags, s.started!.cargo_makeflags].filter((f) => typeof f === 'string' && f.includes('--jobserver-auth'));
  expect(flags, `a command leased with a fixed job count is unaffected by the pool: \`${NAME}\` must be given no jobserver, but MAKEFLAGS was ${JSON.stringify(s.started!.makeflags)} and CARGO_MAKEFLAGS ${JSON.stringify(s.started!.cargo_makeflags)}`).toEqual([]);
  expect(s.started!.argv, `\`${NAME}\` runs its own fixed job count: its words must be as typed, none added`).toEqual([]);
  const beats = [Number(s.started!.ms), ...s.beats.filter((ms) => ms <= s.goAt)];
  const gaps = beats.slice(1).map((ms, i) => ({ at: ms, gap: ms - beats[i]! })).filter((g) => g.gap > GAP_MS);
  expect(gaps, `\`${NAME}\` must run on, never stopped, through \`warn\` and \`critical\`: its heartbeat stopped for ${gaps.map((g) => `${g.gap} ms before +${g.at - s.warnAt} ms`).join(', ')}`).toEqual([]);
  expect(s.beats.some((ms) => ms > s.criticalAt + 1000 && ms <= s.goAt), `\`${NAME}\` must still run at \`critical\`: no heartbeat after the level turned critical`).toBe(true);
  expect(s.exit, `let go while the level is still \`critical\`, \`deep lease -- ${NAME}\` must exit 0 within 60 s: ${s.exit === undefined ? 'it was still running' : `it exited ${s.exit}`}`).toBe(0);
}
/** Some printed line names it, other than a waiting or no-lease line. */
function named(s: Seen): void {
  const lines = s.outputs.flatMap((o) => o.text.split('\n').filter((l) => l.includes(NAME) && !NOT_NAMING.test(l)).map((l) => `${o.what}: ${l}`));
  expect(lines.length, `a command leased with a fixed job count is named in the output: no line ${s.outputs.map((o) => o.what).join(', ')} printed names \`${NAME}\``).toBeGreaterThan(0);
  console.log(`AC4 named: ${lines.join(' | ')}`);
}

describe(`${AC4} a command leased with a fixed job count is unaffected by the held-back pool and named in the output`, () => {
  it(`${AC4} a command leased with a fixed job count is unaffected and is named in the output`, async () => {
    const s = await besideAHeldPool();
    unaffected(s);
    named(s);
  }, 600_000);

  it(`${AC4} (wrong program) a fixed-count command run as a pool build (DEEP_HUB_PLANT=pool-holds-fixed-count) is held by the pool and fails`, async () => {
    const s = await besideAHeldPool('pool-holds-fixed-count');
    await mustFail('pool-holds-fixed-count', () => unaffected(s), ['a command leased with a fixed job count', 'the pool']);
  }, 600_000);
});
