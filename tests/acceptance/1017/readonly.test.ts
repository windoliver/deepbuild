// #1017 AC5, Read-only store: an agent's `rm -rf` of the store and an agent's write into a kept product are each
// denied before they run, naming the guard entry. An agent-written script that changes a kept product is found after
// it ends and recorded on its attempt, and the entry is rebuilt before the next worktree receives it. A planted store
// that a session can write fails this test, naming the file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import { AC5, allEvents, builtEvents, decisionOf, doneYaml, GUARD, keptEntries, logEnd, makeRepo, mustFail, shownHook, sleep, storeRoot, waitBuilt, World, worktree, type Product } from './helpers.ts';

/** A product with no toolchain at all: `out`, built by the repo's own script from `gen.lock`. */
const GEN: Product = { name: 'gen', path: 'out', key: ['gen.lock'], key_values: [], build: 'sh gen.sh' };
const files = {
  'gen.lock': 'gen 1\n',
  'gen.sh': 'set -e\nmkdir -p out\ncp gen.lock out/lock\nprintf built > out/stamp\n',
  '.gitignore': 'out/\n',
  '.deepbuild/done.yaml': doneYaml([GEN]),
};
/** The agent's script: it finds the kept product's file only when it runs, so its reach can't be worked out before. */
const TAMPER = 'f=$(find "$HOME/.deepbuild/products" -path "*/out/stamp" -type f | head -n 1)\nchmod u+w "$f" "$(dirname "$f")" 2>/dev/null\nchflags nouchg "$f" 2>/dev/null\nprintf tampered >> "$f"\necho "$f"\n';

async function scenario(ctx: TestContext | undefined, plant?: string): Promise<void> {
  const w = new World({ plant });
  try {
    await w.startHub();
    const repo = makeRepo(w, 'shop', files);
    w.trust(repo);
    const s0 = w.session(repo);
    await s0.start();
    await s0.prompt('Build it.');
    await waitBuilt(w, [GEN]);
    const [entry] = keptEntries(w, 'out');
    expect(entry, `the store under ${storeRoot(w)} must keep the product's folder out`).toBeDefined();
    const kept = join(entry!, 'stamp');

    const wt = join(w.dir, 'wt-1');
    w.trust(wt);
    worktree(w, repo, 'wt-1');
    const s = w.session(wt);
    await s.start();
    await s.prompt('Tidy up the build output.');

    // An agent's write into a kept product.
    const write = await s.call('Write', { file_path: kept, content: 'agent' }, {
      during: (_input, before) => { if (!decisionOf(before).denied) writeFileSync(kept, 'agent'); return { type: 'create', filePath: kept }; },
    });
    const wrote = decisionOf(write.before);
    console.log(`AC5 Write ${kept}: ${shownHook(write.before)}`);
    expect(wrote.denied && wrote.reason.includes(`(guard ${GUARD})`), `an agent's write into the kept product's file ${kept} must be denied before it runs, naming the guard entry ${GUARD}: ${shownHook(write.before)}`).toBe(true);

    // An agent's rm -rf of the store. Never run, whatever the hook says: the test would lose its store.
    const command = `rm -rf ${storeRoot(w)}`;
    const rm = await s.call('Bash', { command }, { response: { stdout: '', stderr: '', interrupted: false, isImage: false } });
    const removed = decisionOf(rm.before);
    console.log(`AC5 ${command}: ${shownHook(rm.before)}`);
    expect(removed.denied && removed.reason.includes(`(guard ${GUARD})`), `an agent's \`${command}\`, whose reach holds ${kept}, must be denied before it runs, naming the guard entry ${GUARD}: ${shownHook(rm.before)}`).toBe(true);

    // An agent-written script that changes the kept product, whose reach is known only once it has run.
    await s.call('Write', { file_path: join(wt, 'tidy.sh'), content: TAMPER }, { during: () => { writeFileSync(join(wt, 'tidy.sh'), TAMPER); return { type: 'create', filePath: join(wt, 'tidy.sh') }; } });
    const from = await logEnd(w.hub!);
    const script = await s.call('Bash', { command: 'sh tidy.sh' }, {
      during: (_input, before) => {
        if (decisionOf(before).denied) return { stdout: '', stderr: 'denied', interrupted: false, isImage: false };
        const r = w.run('sh', ['tidy.sh'], wt);
        return { stdout: r.out, stderr: '', interrupted: false, isImage: false };
      },
    });
    const changed = existsSync(kept) && readFileSync(kept, 'utf8').includes('tampered');
    console.log(`AC5 sh tidy.sh: ${shownHook(script.before)}; the kept file ${changed ? 'changed' : 'unchanged'}`);
    if (!changed) {
      if (ctx) ctx.skip(`INCONCLUSIVE: the agent's script couldn't change ${kept}, so there was nothing to find after it ended (${shownHook(script.before)})`);
      expect.fail(`the agent's script couldn't change ${kept}`);
    }
    const names = [kept, relative(storeRoot(w), kept)];
    let found: string | undefined;
    for (const deadline = Date.now() + 60_000; !found && Date.now() < deadline; await sleep(1000)) {
      found = (await allEvents(w.hub!)).filter((e) => e.log_pos > from).map((e) => JSON.stringify(e))
        .find((text) => names.some((n) => text.includes(n)) && (text.includes(s.id) || text.includes(script.id)));
    }
    console.log(`AC5 the record of the script's change: ${found?.slice(0, 800) ?? 'none'}`);
    expect(found, `the agent-written script's change to ${kept} must be found after it ends and recorded on its attempt (an event naming the file and the session ${s.id} or its call ${script.id})`).toBeDefined();
    const rebuilt = (await builtEvents(w.hub!, GEN.name)).find((e) => e.log_pos > from);
    if (!rebuilt) await waitBuilt(w, [GEN], { after: from, ms: 10 * 60_000 }).catch(() => undefined);

    // The next worktree receives the entry rebuilt, never the changed one.
    const next = join(w.dir, 'wt-2');
    w.trust(next);
    worktree(w, repo, 'wt-2');
    await w.session(next).start();
    const stamp = join(next, 'out', 'stamp');
    const got = existsSync(stamp) ? readFileSync(stamp, 'utf8') : undefined;
    console.log(`AC5 the next worktree's out/stamp: ${JSON.stringify(got)}`);
    expect(got, `the next worktree must receive the entry rebuilt, so its out/stamp reads "built", not the changed ${kept}`).toBe('built');
  } finally {
    await w.close();
  }
}

describe(`${AC5} the store is read-only to every session`, () => {
  it(`${AC5} rm -rf of the store and a write into a kept product are denied naming ${GUARD}; a script's change is recorded on its attempt and the entry rebuilt before the next worktree`, async (ctx) => {
    await scenario(ctx);
  }, 3_600_000);

  it(`${AC5} a planted store that a session can write fails, naming the file`, async () => {
    await mustFail('AC5 store-writable', () => scenario(undefined, 'store-writable'), ['out/stamp']);
  }, 3_600_000);
});
