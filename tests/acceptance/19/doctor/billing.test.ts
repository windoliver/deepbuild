// AC11 #19.b637c3cc With `ANTHROPIC_API_KEY` set, the doctor warns that sessions bill an API account; with two
// `claude` installs, it names the one your sessions run and the one jobs would run.
//
// The key is set in the environment `deep doctor` runs in, the shell your sessions start from: the doctor warns
// (level warn), naming the variable and that sessions bill an API account, and never prints the key's value. With
// no key, no item warns about it. The two installs (README: AC11, Which `claude` each runs): your sessions run the
// first `claude` on the PATH `deep doctor` runs with; DeepBuild's jobs run the first `claude` on the login shell's
// PATH that setup recorded (`runner.login_path` in ~/.deepbuild/config.json, #159). Here they are two different
// stand-ins, each at a version the facts cover, and the doctor must name both paths, each as what it is.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLAUDE_OLDER, addBin, cleanup, doctor, installAgents, itemText, itemsShown, pathFor, setLoginPath, shown, tag, world } from './helpers.ts';

afterAll(cleanup, 60_000);

/** For each path, the last mention of sessions or jobs before it in `text`: what the text says that binary is. */
function saidOf(text: string, path: string): string | undefined {
  const at = text.indexOf(path);
  if (at < 0) return undefined;
  const words = [...text.slice(0, at).matchAll(/\b(session|job)s?\b/gi)];
  return words.at(-1)?.[1]?.toLowerCase();
}

describe('AC11 #19.b637c3cc With `ANTHROPIC_API_KEY` set, the doctor warns that sessions bill an API account; with two `claude` installs, it names the one your sessions run and the one jobs would run', () => {
  it('AC11 #19.b637c3cc with ANTHROPIC_API_KEY set, deep doctor warns that sessions bill an API account, naming the variable and never its value; without it, no such warning', async () => {
    const w = await world();
    const key = `sk-ant-api03-dh19dFAKE${tag(24)}`;
    const d = await doctor(w.h, [], { env: { ANTHROPIC_API_KEY: key } });
    const warned = d.items.filter((i) => itemText(i).includes('ANTHROPIC_API_KEY'));
    expect(warned.some((i) => i.level === 'warn' && /API/.test(itemText(i)) && /bill/i.test(itemText(i))), `AC11 deep doctor must warn (level warn) that with ANTHROPIC_API_KEY set your sessions bill an API account: ${shown(d.ran)}`).toBe(true);
    expect(`${d.ran.stdout}${d.ran.stderr}`.includes(key), 'AC11 deep doctor names the billing key, never its value').toBe(false);
    expect(`${d.ran.stdout}${d.ran.stderr}`.includes(key.slice(-12)), 'AC11 deep doctor shows no part of the key\'s value').toBe(false);

    const none = await doctor(w.h);
    expect(none.items.filter((i) => i.level !== 'ok' && itemText(i).includes('ANTHROPIC_API_KEY')), `AC11 with no billing key set, no item warns about ANTHROPIC_API_KEY: ${shown(none.ran)}`).toEqual([]);
  }, 600_000);

  it('AC11 #19.b637c3cc with your sessions\' `claude` and the jobs\' `claude` two different installs, deep doctor flags it, naming the one your sessions run and the one jobs would run', async () => {
    let jobs = '';
    const w = await world({
      after: (h) => {
        jobs = join(h.tmp, 'jobbin');
        installAgents(jobs, { claudeVersion: CLAUDE_OLDER, codex: false });
        setLoginPath(h, `${jobs}:${pathFor(h)}`);
      },
    });
    addBin(w.h, jobs);
    const sessions = join(w.h.bin, 'claude');
    const jobsClaude = join(jobs, 'claude');
    const d = await doctor(w.h);
    const named = d.items.filter((i) => itemText(i).includes(sessions) && itemText(i).includes(jobsClaude));
    expect(named.length, `AC11 an item must name both installs, ${sessions} (your sessions) and ${jobsClaude} (jobs): ${shown(d.ran)}`).toBeGreaterThan(0);
    expect(named.some((i) => i.level === 'warn' || i.level === 'fail'), `AC11 two different installs are flagged (warn or fail), not ok: ${itemsShown(named)}`).toBe(true);
    const right = named.filter((i) => saidOf(itemText(i), sessions) === 'session' && saidOf(itemText(i), jobsClaude) === 'job');
    expect(right.length, `AC11 the item must say ${sessions} is the one your sessions run and ${jobsClaude} the one jobs would run, not the other way round: ${itemsShown(named)}`).toBeGreaterThan(0);
  }, 600_000);
});
