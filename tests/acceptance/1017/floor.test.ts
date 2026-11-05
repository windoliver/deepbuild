// #1017 AC6, Disk floor: with the test volume held at the floor plus 1 GB, an entry build waits, and its line names the
// floor. Products in two ended sessions' worktrees are removed first, oldest first. A worktree where a test process
// holds a file open never loses its products, and no source file or uncommitted edit changes. A planted reclaim that
// removes the open worktree's products fails, naming the process.
//
// The floor is the issue's 30 GB, on a sparse 40 GB test volume, held at 31 GB free by an APFS volume that reserves
// the rest (nothing written). The entry to build is the product's next key, whose last entry took 1.3 GB, so it can't
// start without going under the floor; the three ended sessions' worktrees each added 0.2 GB of their own on top of
// their clone, so the build needs both reclaimable worktrees' products gone, and the third, oldest, is held open.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import { AC6, advanceMain, allEvents, contextOf, doneYaml, FLOOR, GB, gb, holdOpen, logEnd, makeRepo, mustFail, rpc, running, sleep, sourceDigests, waitBuilt, World, worktree, type HookCall, type Product } from './helpers.ts';

const BLOB: Product = { name: 'blob', path: 'out', key: ['blob.lock'], key_values: [], build: 'sh build.sh' };
const ENTRY_BYTES = 1.3 * GB;
const OWN_BYTES = 0.2 * GB;

async function scenario(ctx: TestContext | undefined, plant?: string): Promise<void> {
  const w = new World({ plant, gb: 40 });
  try {
    await w.startHub();
    const marks = join(w.dir, 'marks');
    writeFileSync(marks, '');
    const repo = makeRepo(w, 'shop', {
      'blob.lock': 'blob 1\n',
      'build.sh': `set -e\nprintf 'start %s %s\\n' "$(cat blob.lock)" "$(date +%s)" >> '${marks}'\nmkdir -p out\ndd if=/dev/zero of=out/blob bs=1000000 count=${ENTRY_BYTES / 1e6} 2>/dev/null\nprintf 'end %s\\n' "$(cat blob.lock)" >> '${marks}'\n`,
      'README.md': '# shop\n',
      '.gitignore': 'out/\n',
      '.deepbuild/done.yaml': doneYaml([BLOB]),
    });
    w.trust(repo);
    const s0 = w.session(repo);
    await s0.start();
    await s0.prompt('Build it.');
    await waitBuilt(w, [BLOB]);

    // Three worktrees, each with the product cloned in, 0.2 GB of its own build on top, and an uncommitted edit.
    const names = ['wt-c', 'wt-a', 'wt-b'] as const;
    const wts: Record<string, string> = {};
    const sessions = [];
    for (const name of names) {
      const at = join(w.dir, name);
      w.trust(at);
      worktree(w, repo, name);
      const s = w.session(at);
      await s.start();
      expect(existsSync(join(at, 'out', 'blob')), `${name} must receive the product at its session's start, before the floor is reached`).toBe(true);
      writeFileSync(join(at, 'out', 'own'), Buffer.alloc(OWN_BYTES));
      mkdirSync(join(at, 'out', 'many'));
      for (let i = 0; i < 1500; i++) writeFileSync(join(at, 'out', 'many', `f${i}`), Buffer.alloc(4096, i % 251));
      writeFileSync(join(at, 'README.md'), `# shop\n\nedited in ${name}\n`);
      writeFileSync(join(at, 'notes.txt'), `uncommitted in ${name}\n`);
      wts[name] = at;
      sessions.push(s);
    }
    const [C, A, B] = [wts['wt-c']!, wts['wt-a']!, wts['wt-b']!];
    const held = join(C, 'out', 'held.log');
    writeFileSync(held, 'held open\n');
    const holder = holdOpen(held);
    await sleep(500);
    const digests = Object.fromEntries(names.map((n) => [n, sourceDigests(w, wts[n]!)]));
    // Their sessions end oldest first: wt-c (held open), then wt-a, then wt-b.
    for (const s of sessions) { await s.end(); await sleep(1500); }

    w.vol.holdFreeAt(FLOOR + GB);
    const freeAtHold = w.vol.free();
    console.log(`AC6 the test volume held at ${gb(freeAtHold)} free, the floor ${gb(FLOOR)} plus 1 GB; the last entry took ${gb(ENTRY_BYTES)}, each ended worktree added ${gb(OWN_BYTES)} of its own`);

    // The default branch moves to a new key; a worktree made from it starts a session, so its entry is to be built.
    const from = await logEnd(w.hub!);
    advanceMain(w, repo, { 'blob.lock': 'blob 2\n' }, 'blob 2');
    const D = join(w.dir, 'wt-d');
    w.trust(D);
    worktree(w, repo, 'wt-d');
    let dStart: HookCall | undefined;
    const dStarted = w.session(D).start().then((h) => { dStart = h; });

    const gone: Record<string, number | undefined> = {};
    const t0 = Date.now();
    let startedAt: number | undefined;
    for (const deadline = Date.now() + 20 * 60_000; Date.now() < deadline;) {
      for (const [n, at] of [['wt-c', C], ['wt-a', A], ['wt-b', B]] as const) if (gone[n] === undefined && !existsSync(join(at, 'out'))) gone[n] = Date.now() - t0;
      if (startedAt === undefined && /^start blob 2\b/m.test(readFileSync(marks, 'utf8'))) startedAt = Date.now() - t0;
      if (startedAt !== undefined && Date.now() - t0 > startedAt + 3000) break;
      await sleep(10);
    }
    await Promise.race([dStarted, sleep(60_000)]);
    const texts = [
      dStart ? contextOf(dStart) : '',
      ...(await allEvents(w.hub!)).filter((e) => e.log_pos > from).map((e) => JSON.stringify(e)),
      ...(((await rpc(w.hub!, 'status.read').catch(() => ({ rows: [] }))).rows ?? []) as unknown[]).map((r) => JSON.stringify(r)),
    ];
    const floorLine = texts.find((t) => /floor/i.test(t) && /\b30(\.0+)?\s?GB\b/.test(t));
    console.log(`AC6 removed (ms after the trigger): ${JSON.stringify(gone)}; the entry build started at ${startedAt ?? 'never'} ms; free now ${gb(w.vol.free())}; the line naming the floor: ${floorLine?.slice(0, 600) ?? 'none'}`);

    expect(gone['wt-c'], `the products of ${C}, where a test process holds a file open, must never be removed: pid ${holder} (tail) holds ${held} open${running(holder) ? '' : ' (it has since ended)'}`).toBeUndefined();
    for (const n of names) {
      const now = sourceDigests(w, wts[n]!);
      const differ = [...new Set([...digests[n]!.keys(), ...now.keys()])].filter((p) => digests[n]!.get(p) !== now.get(p));
      expect(differ, `no source file or uncommitted edit in ${n} may change; these did: ${differ.join(', ')}`).toEqual([]);
    }
    expect(startedAt, 'the entry build for the new key must start once room is made').toBeDefined();
    expect(gone['wt-a'] !== undefined && gone['wt-b'] !== undefined && gone['wt-a']! <= startedAt! && gone['wt-b']! <= startedAt!,
      `with the volume at the floor plus 1 GB, the entry build must wait until the products of the two ended sessions' worktrees are removed; it started at ${startedAt} ms, wt-a's went at ${gone['wt-a'] ?? 'never'}, wt-b's at ${gone['wt-b'] ?? 'never'}`).toBe(true);
    expect(floorLine, `while the entry build waits, its line must name the floor (${gb(FLOOR)}), in the session start, the record or deep status`).toBeDefined();
    expect(gone['wt-a']! <= gone['wt-b']!, `the ended sessions' products are removed oldest first: wt-a's session ended before wt-b's, yet wt-b's went at ${gone['wt-b']} ms and wt-a's at ${gone['wt-a']} ms`).toBe(true);
    if (gone['wt-a'] === gone['wt-b'] && ctx) ctx.skip(`INCONCLUSIVE: wt-a's and wt-b's products went within one 10 ms reading of each other, so their order wasn't seen`);
  } finally {
    await w.close();
  }
}

describe(`${AC6} one disk floor per machine`, () => {
  it(`${AC6} at the floor plus 1 GB an entry build waits naming the floor; the two ended sessions' products go first, oldest first; the open worktree keeps its products and every source and edit`, async (ctx) => {
    await scenario(ctx);
  }, 3_600_000);

  it(`${AC6} a planted reclaim that removes the open worktree's products fails, naming the process`, async () => {
    await mustFail('AC6 reclaims-open-worktree', () => scenario(undefined, 'reclaims-open-worktree'), [/pid \d+ \(tail\)/]);
  }, 3_600_000);
});
