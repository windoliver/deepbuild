// Criterion 4 (README: Criterion 4), by hand only: against a real hub, an `ask.created` changes Needs you in `deep-live`
// with no input, within the reader's tick plus one frame. The hub is #26's (`deep hub run` in a temporary home, with an
// agent stand-in whose own `deep mcp` raises each ask through `deep_ask`). `deep-live --view needs-you --out <file>
// --watch` shows the real app window on that hub's record, read through the app's own record reader and tick, sends it no
// input and forces no frame, and writes one line per frame the window draws. Each ask's delay is from its `ask.created`'s
// `ts` (the hub's clock, this Mac's) to the `at` of the first drawn frame whose Needs you names its question.
//
// It needs a shown window on this Mac's display and the built CLI (`npm run build`), so it never runs in CI:
//   DEEP_LIVE_1546=1 npx vitest run --root tests/acceptance/1546 ac4-needs-you.live.test.ts
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI, agentWorld, callTool, childEnv, cleanup, eventMatching, own, pending, sleep, type Line } from '../26/helpers.ts';
import { REPO, requireMacos, type Obj } from './helpers.ts';

afterAll(cleanup, 60_000);
const OPTED = process.env.DEEP_LIVE_1546 === '1';

/** The reader's tick: the app's record loop reads the hub every 250 ms (crates/deep-app/src/main.rs, `notifications::TICK`). */
const TICK_MS = 250;
/** One frame of a 60 Hz display, the slowest the reference Mac runs at. */
const FRAME_MS = 1000 / 60;
const BOUND_MS = TICK_MS + FRAME_MS;
/** Frames a still window may draw in 3 s with nothing changing; one redrawn every frame would draw about 180. */
const IDLE_FRAMES = 5;
const LIVE = join(REPO, 'target', 'debug', 'deep-live');

function buildLive(): void {
  const r = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-live', '--features', 'env-plants'], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !existsSync(LIVE)) expect.fail(`BLOCKED: deep-live can't be built: ${r.error?.message ?? ''}${(r.stderr ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n')}`);
}

/** The watch file's lines so far. */
const lines = (file: string): Obj[] => (existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as Obj; } catch { return { unparsed: l }; } });

describe.skipIf(!OPTED)('#1546 AC4 against a real hub, an ask.created changes Needs you in deep-live with no input, within the reader\'s tick plus one frame', () => {
  it('three asks, each drawn in Needs you within 250 ms plus one frame of its record time, by a window that draws nothing while the record is still', async () => {
    requireMacos();
    if (!existsSync(CLI)) expect.fail(`BLOCKED: the CLI isn't built (${CLI}); run npm run build`);
    buildLive();
    const world = await agentWorld();
    const out = join(world.tmp, 'needs-you.watch.jsonl');
    const child = spawn(LIVE, ['--view', 'needs-you', '--out', out, '--watch'], { cwd: REPO, env: childEnv(world.home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stderr = '';
    let exited: number | null | undefined;
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('exit', (code) => (exited = code));

    // Ready once the reader has reached the hub and the first frame is drawn.
    const readyBy = Date.now() + 60_000;
    while (!lines(out).some((l) => l.ready === true)) {
      if (exited !== undefined) expect.fail(`deep-live --watch exited ${exited} before it was ready: ${stderr.slice(-1500)}`);
      if (Date.now() > readyBy) expect.fail(`BLOCKED: deep-live --watch wrote no ready line within 60 s: ${stderr.slice(-1500)}`);
      await sleep(50);
    }
    const frames = () => lines(out).filter((l) => typeof l.frame === 'number');
    for (const l of frames()) expect(typeof l.at === 'number' && Array.isArray(l.names), `a frame line: {frame, at, log_pos, names}: ${JSON.stringify(l).slice(0, 300)}`).toBe(true);

    // With the record still, the window draws (nearly) nothing: the frames that come later are the record's.
    await sleep(1000);
    const idleFrom = Date.now();
    await sleep(3000);
    const idle = frames().filter((l) => l.at >= idleFrom && l.at < idleFrom + 3000);
    expect(idle.length, `frames drawn in 3 s of a still record: ${idle.length}`).toBeLessThanOrEqual(IDLE_FRAMES);

    const delays: { question: string; ms: number }[] = [];
    for (let n = 1; n <= 3; n++) {
      const question = `Live 1546 ask ${n}: which header colour, ${Date.now()}?`;
      void pending(callTool(world.agent, 'deep_ask', { kind: 'taste', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }], recommended: 'blue' }));
      const created = await eventMatching(world.hub, (e) => e.kind === 'ask.created' && (e.data as Line)?.question === question, 20_000);
      if (!created) expect.fail(`BLOCKED: the hub recorded no ask.created for "${question}"`);
      const shownBy = Date.now() + 5000;
      let shown: Obj | undefined;
      while (!(shown = frames().find((l) => (l.names as string[]).some((name) => name.includes(question))))) {
        if (exited !== undefined) expect.fail(`deep-live exited ${exited}: ${stderr.slice(-1500)}`);
        if (Date.now() > shownBy) break;
        await sleep(20);
      }
      expect(shown, `Needs you in deep-live never drew "${question}" with no input; frames since: ${frames().filter((l) => l.at >= created!.ts).length}`).toBeTruthy();
      const ms = (shown!.at as number) - created!.ts;
      expect(ms, `the frame that drew "${question}" comes after its ask.created (${ms} ms)`).toBeGreaterThanOrEqual(0);
      delays.push({ question, ms });
      await sleep(600);
    }
    const late = delays.filter((d) => d.ms > BOUND_MS);
    if (late.length && loadavg()[0]! > cpus().length) expect.fail(`INCONCLUSIVE: ${late.length} of 3 asks drawn later than ${BOUND_MS.toFixed(1)} ms (${late.map((d) => d.ms).join(', ')} ms) with the load average at ${loadavg()[0]!.toFixed(1)} on ${cpus().length} cores; this is not a pass`);
    expect(delays.map((d) => ({ ...d, within: d.ms <= BOUND_MS })), `each ask drawn within the reader's tick (${TICK_MS} ms) plus one frame (${FRAME_MS.toFixed(1)} ms)`).toEqual(delays.map((d) => ({ ...d, within: true })));
  }, 2_400_000);
});
