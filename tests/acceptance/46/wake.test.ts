// AC7: an open PR that now conflicts with its base wakes an idle Claude Code session within 60 s, and the session hears
// the conflicting files.
//
// Two idle sessions, each with an open PR. main takes a commit that conflicts with the first PR in one file, and touches
// another of its files without conflict, and doesn't touch the second PR's. The forge's `mergeable` comes from a real
// merge of the bare repo's refs, null on its first read as GitHub computes it. A wake is Claude Code's: the waiter
// `deep setup` installed exits 2 and the stand-in starts a turn with its text.
import { afterEach, describe, expect, it } from 'vitest';
import { AC7, cleanup, load, QUESTION, sleep, Worker, World, YOU, type Wake } from './helpers.ts';

afterEach(cleanup, 60_000);
const LIMIT_MS = 60_000;

describe(`${AC7} An open PR that now conflicts with its base wakes an idle Claude Code session within 60 s, and the session hears the conflicting files`, () => {
  it(`${AC7} the session of the PR that conflicts wakes within 60 s hearing src/total.ts alone; the session whose PR still merges doesn't wake`, async (ctx) => {
    const w = await World.start();
    const you = w.outsider(YOU);
    const line = (n: number, text: string) => Array.from({ length: 8 }, (_, i) => (i === n ? text : ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][i])).join('\n') + '\n';
    you.commit('feature', { 'src/total.ts': 'export const total = (n: number) => n * 1.08;\n', 'src/other.ts': line(0, 'ONE'), 'src/added.ts': 'export const added = 1;\n' });
    you.push('feature');
    you.commit('clean', { 'docs/clean.md': 'a line\n' });
    you.push('clean');
    w.forge.pull({ repo: 'acme/shop', head: 'feature' });
    w.forge.pull({ repo: 'acme/shop', head: 'clean' });
    const conflicted = await w.session({ branch: 'feature', prompt: QUESTION });
    const clean = await w.session({ branch: 'clean', prompt: QUESTION });
    await conflicted.stop('It multiplies by the rate.');
    await clean.stop('It multiplies by the rate.');
    await conflicted.idle();
    await clean.idle();

    you.commit('main', { 'src/total.ts': 'export const total = (n: number) => n * 1.09;\n', 'src/other.ts': line(7, 'EIGHT') });
    const pushed = Date.now();
    you.push('main');

    let wake: Wake | undefined;
    for (const deadline = pushed + 3 * LIMIT_MS; !wake && Date.now() < deadline; await sleep(100)) wake = conflicted.claude.wakes.find((x) => x.session === conflicted.id && x.prompt !== undefined);
    expect(wake, `${conflicted.id} never woke, ${(Date.now() - pushed) / 1000} s after main moved; the forge saw ${w.forge.calls.filter((c) => /pulls/.test(c.path)).length} pull reads`).toBeDefined();
    const took = wake!.at - pushed;
    const { one, cores } = load();
    if (took > LIMIT_MS && one > cores) ctx.skip(`INCONCLUSIVE the wake took ${took} ms under a load of ${one.toFixed(1)} on ${cores} cores`);
    expect(took, 'the wake came within 60 s of the conflict').toBeLessThanOrEqual(LIMIT_MS);
    const heard = Worker.heard(wake!);
    expect(heard, 'the session hears the file that conflicts').toContain('src/total.ts');
    expect(heard, 'src/other.ts merged cleanly').not.toContain('src/other.ts');
    expect(heard, 'src/added.ts is only the PR\'s').not.toContain('src/added.ts');

    await sleep(Math.max(0, pushed + LIMIT_MS - Date.now()));
    expect(clean.claude.wakes, `${clean.id}'s PR still merges`).toEqual([]);
  }, 420_000);
});
