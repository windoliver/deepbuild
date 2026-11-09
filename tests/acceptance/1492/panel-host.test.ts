// #1492.2e66f748 and #1492.40149fbb, through the panel host's `serve` lines (README: The surface under test).
// Real host, real timer on the real clock; the host is started as the app starts it.
import { afterEach, describe, expect, it } from 'vitest';
import { frames, int, sleep, startHost, str, writePanel, type Host } from './helpers.ts';

const hosts: Host[] = [];
afterEach(() => { for (const host of hosts.splice(0)) host.stop(); });
const open = async (dir: string, planted?: string): Promise<Host> => { const host = await startHost(dir, planted); hosts.push(host); return host; };

describe('#1492 a panel that re-renders the same thing draws nothing', () => {
  it('#1492.2e66f748 a test panel with a 1 Hz timer and an unchanged tree draws 0 frames over 60 s; a planted host that redraws on every render draws at least 60 and fails, naming the panel', async () => {
    const panel = writePanel(0);
    const shipped = await open(panel.dir);
    const planted = await open(panel.dir, 'redraw_every_render');
    // The app's own first draw is its invalidate; the 60 s that follow are the timer's.
    const first = await Promise.all([shipped.send({ cmd: 'invalidate' }), planted.send({ cmd: 'invalidate' })]);
    expect(str(first[0]!['hash']), 'an invalidate reply carries the tree hash').not.toBe('');
    const since = Date.now();
    await sleep(60_000);

    const stats = await shipped.send({ cmd: 'stats' });
    expect(frames(shipped, since).length, 'the unchanged panel asked for no frame in 60 s').toBe(0);
    expect(int(stats['frames']), `frames the host asked for after the first draw: ${JSON.stringify(stats)}`).toBe(0);
    // Not vacuous: the timer really re-rendered the panel about once a second.
    expect(int(stats['renders']), `the 1 Hz timer rendered the panel ${JSON.stringify(stats)}`).toBeGreaterThanOrEqual(55);
    expect(str(stats['hash']), 'the hash never moved').toBe(str(first[0]!['hash']));
    const ok = await shipped.send({ cmd: 'verdict', max_frames: 0 });
    expect(ok['status'], JSON.stringify(ok)).toBe('PASS');

    const drawn = frames(planted, since);
    expect(drawn.length, 'a host that redraws on every render draws at least once a second').toBeGreaterThanOrEqual(60);
    expect(new Set(drawn.map((d) => d.frame.hash)).size, 'every one of those frames drew the same tree').toBe(1);
    const bad = await planted.send({ cmd: 'verdict', max_frames: 0 });
    expect(bad['status'], JSON.stringify(bad)).toBe('FAIL');
    expect(str(bad['panel']), 'the failure names the panel by its manifest id').toBe(panel.id);
    expect(str(bad['reason']), `the reason names the panel and its frame count: ${JSON.stringify(bad)}`).toContain(panel.id);
    expect(str(bad['reason'])).toContain(String(int(bad['frames'])));
  }, 600_000);

  it('#1492.40149fbb a change in the tree appears within one frame', async () => {
    const panel = writePanel(3);
    const host = await open(panel.dir);
    const first = await host.send({ cmd: 'invalidate' });
    const began = Date.now();
    expect(str(first['tree']), 'the first tree shows the first text').toContain(panel.before);
    await sleep(5_500);

    const drawn = frames(host, began);
    expect(drawn.length, `one change, one frame request: ${JSON.stringify(drawn).slice(0, 800)}`).toBe(1);
    const [change] = drawn;
    expect(change!.frame.panel, 'the frame names its panel').toBe(panel.id);
    expect(change!.frame.tree, 'the frame carries the changed tree').toContain(panel.after);
    expect(change!.frame.tree, 'and not the old one').not.toContain(panel.before);
    expect(change!.frame.hash, 'under a new hash').not.toBe(str(first['hash']));
    // The third tick, plus a frame (16.7 ms at 60 Hz) and slack for a loaded machine.
    expect(change!.at - began, 'it comes at the change, the third tick').toBeGreaterThanOrEqual(2_500);
    expect(change!.at - began, 'and within a frame of it').toBeLessThanOrEqual(3_500);
    const stats = await host.send({ cmd: 'stats' });
    expect(int(stats['frames']), 'frames asked for, none for the ticks that changed nothing').toBe(1);
    expect(int(stats['renders']), 'though the timer kept rendering').toBeGreaterThanOrEqual(5);
    expect(str(stats['hash'])).toBe(change!.frame.hash);
  }, 120_000);
});
