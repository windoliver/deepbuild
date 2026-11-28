// AC1 #1867.e9a5b9d7 With a Codex session's shell call running, removing DeepBuild's Stop entry from hooks.json puts
// it back within a second, byte-identical, with a reading naming the call, and Codex's hook list still reports it
// trusted. A hub that only reports it in health fails this test, naming the entry.
//
// The home's ~/.codex/hooks.json is a link into a dotfiles folder whose file already holds a Stop entry of yours
// (issue, Scope: the hub watches hooks.json "through its link if it is one"; README: Readings, 2). `deep setup` adds
// DeepBuild's entries after yours, and you approve them once, in the home's own CODEX_HOME, so the machine's real
// Codex lists them trusted. Then a Codex thread's shell call runs the script (fixtures/tamper.mjs), a child of the
// thread's own process, which takes DeepBuild's Stop entry out of the file in place and stays running. The call is
// still running when the file is read for the entry, and until it is back or 30 s have passed.

import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, Agent, NODE, TAMPER, againstSecond, begin, callAfter, callBefore, cleanup, codexThread, cut, health, hooksList, hubWithSetup, linkProblem,
  listedOurs, loadNow, makeHome, ourEntry, oursNow, parseObject, quoted, readingNames, tag, tilde, trustAll, watchBack,
} from './helpers.ts';

afterAll(cleanup, 120_000);

/** How long the entry may stay gone before the test stops reading for it. The criterion's bound is a second; this only ends the wait. */
const GIVE_UP_MS = 30_000;

describe(`${AC[1]} With a Codex session's shell call running, removing DeepBuild's Stop entry from hooks.json puts it back within a second, byte-identical, with a reading naming the call, and Codex's hook list still reports it trusted. A hub that only reports it in health fails this test, naming the entry`, () => {
  it(`${AC[1]} a running shell call's script takes DeepBuild's Stop entry out of a linked ~/.codex/hooks.json: it is back within a second, byte for byte, through the link, a reading names the call, and Codex's own hook list still reports it trusted`, async () => {
    const h = makeHome({ realCodex: true, linked: true });
    const hub = await hubWithSetup(h);
    const stop = ourEntry(h, 'Stop');
    const entry = `DeepBuild's Stop entry (${tilde(h, String(stop.hook.command))})`;
    const file = '~/.codex/hooks.json';

    // You approve the entries once; Codex's own list then reports DeepBuild's Stop entry trusted (the control).
    const approved = listedOurs(await trustAll(h), 'Stop');
    if (approved?.trustStatus !== 'trusted') throw Error(`BLOCKED: after its approval Codex's hook list must report ${entry} trusted, and reports ${tilde(h, JSON.stringify(approved ?? 'no such entry'))}`);

    // A Codex thread's shell call runs the script, which removes the entry while the call runs.
    const codex = Agent.start(h);
    const t = codexThread(h, codex);
    await begin(hub, t, 'Tidy the hook settings.');
    const call = await callBefore(hub, t, [NODE, TAMPER, 'remove-hook', 'Stop', tag()].map(quoted).join(' '));
    const running = await codex.open(call.command, t.cwd);
    const did = parseObject(running.line);
    if (did?.removed !== 1 || typeof did.at !== 'number') throw Error(`BLOCKED: the call's script took no Stop entry of DeepBuild's out of ${file}: ${tilde(h, running.line)}`);
    const seen = await watchBack(() => oursNow(h, 'Stop').length > 0, did.at, GIVE_UP_MS);
    await callAfter(hub, t, call, await codex.close(running.id));

    const name = `the Codex call ${call.id}`;
    const problems: string[] = [];
    const now = oursNow(h, 'Stop');
    // The criterion's second, read once: from the script's write to the first read that found the entry back.
    const second = seen.back ? againstSecond(seen) : undefined;
    if (!seen.back) {
      const said = (await health(hub)).codex?.readings;
      problems.push(`${AC[1]} ${entry} was removed from ${file} while ${name} was running and was not put back: ${Math.round(seen.ms / 1000)} s later the file holds no Stop entry of DeepBuild's. The hub only reports it: hub.health's codex.readings are ${tilde(h, cut(JSON.stringify(said ?? null), 600))}`);
    } else {
      if (second === 'over') problems.push(`${AC[1]} ${entry} was back in ${file} ${seen.ms} ms after ${name}'s script removed it, over the criterion's second (a read ${seen.gone} ms after the removal still found it gone, at ${loadNow()})`);
      if (now.length !== 1 || now[0]!.raw !== stop.raw) problems.push(`${AC[1]} ${entry} must go back into ${file} byte for byte: setup wrote ${tilde(h, JSON.stringify(stop.raw))}, and the file now holds ${tilde(h, JSON.stringify(now.map((e) => e.raw)))}`);
    }
    const link = linkProblem(h);
    if (link) problems.push(`${AC[1]} ${file} was a link to ${h.link} and is now ${link}: ${entry} must go back through the link, into the file it points to`);
    if (!await readingNames(hub, t, call, 'hooks.json')) problems.push(`${AC[1]} a reading must name ${name} ("${tilde(h, call.command)}"), which was running when ${entry} went from ${file}, and name that file: none does`);
    // Codex's own word, from its hook list in this home: the entry is there and still trusted, so Codex asks nothing again.
    const listed = listedOurs(await hooksList(h), 'Stop');
    if (listed?.trustStatus !== 'trusted') problems.push(`${AC[1]} Codex's own hook list must still report ${entry} trusted after ${name} removed it from ${file}: it reports ${listed ? `${listed.trustStatus} (${tilde(h, listed.key)})` : 'no such entry'}`);

    expect(problems, `${AC[1]} ${entry} in ${file}, removed while ${name} ran`).toEqual([]);
    // Back, but too late to read against the second on this machine in this run: never a pass.
    if (second === 'unmeasured') throw Error(`INCONCLUSIVE: ${AC[1]} ${entry} was back in ${file} ${seen.ms} ms after its removal, past the criterion's second, at ${loadNow()}; the last read that found it gone was ${seen.gone ?? 'none'} ms after the removal. On a machine this busy, or with reads this far apart, this run can't say whether the hub took the time: run it again under a timed grant`);
  }, 900_000);
});
