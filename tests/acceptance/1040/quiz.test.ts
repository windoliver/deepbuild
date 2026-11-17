// AC1 #1040.62c32a87: "With WebGPU switched off in the browser, a quiz whose logic keeps the score over three questions
// of three options, within the page's caps, exported to the web opens its full playable page, which reaches every state
// as #169's own test does; its receipt's fallback reads page, and the player is never started"
//
// The quiz (helpers.ts `quizDoc`): #169's quiz of three waiting questions, its score kept by the logic item `scorer`,
// each option a target. asserts:
//   - its web export's receipt reads `fallback: "page"`; every file the receipt names is in the bundle by its hash; the
//     receipt marks the fallback page (README: The fallback page) and every file that page names is there by hash; its
//     manifest is the full playable page, all 27 end states at `end` among its states;
//   - opened in headless Chrome with WebGPU switched off, the index page opens the fallback page in its start state, and
//     never starts the player: the player's file is never served and no `<deep-player>` reports ready;
//   - the page reaches every state as #169's walkthrough test does: from the start, for each of the 27 answer paths, a
//     click on each answer's target (`[data-deep-target="q1/b"]`, …) plays an edge and lands in the state the manifest's
//     edge names, three targets shown at each question; every state of the manifest is reached; and the pages asked for
//     nothing but the bundle's own files, by hash.
// Wrong program: the merge base, whose bundle holds no fallback page and whose index page starts the player anyway.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, QUIZ, QUIZ_PATHS, TIMEOUT, bundleFailures, closeBundle, exportWeb, fallbackFailures, fallbackFileFailures, fallbackOf, follow, neverStartedFailures,
  none, openBundle, pathName, quizDoc, requestFailures1040, useBrowsers, useShow, useTemp, webReceipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();

describe(`${AC[1]} with WebGPU off, the quiz's bundle opens its full playable page, and the player never starts`, () => {
  it(`${AC[1]} the quiz exported to the web reads fallback page, opens its full playable page with WebGPU off, reaches every state there by its targets, and never starts the player`, async () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, quizDoc(evidence), out, 'the quiz exported to the web'), 'the quiz exported to the web');
    expect(receipt.fallback, "the quiz's receipt's fallback reads page").toBe('page');
    none(bundleFailures(out, receipt, "the quiz's bundle"), 'the bundle holds every file its receipt names, each by its hash');
    const fb = fallbackOf(out, receipt, "the quiz's bundle");
    none(fallbackFileFailures(out, receipt, fb, "the quiz's fallback page"), 'every file the fallback page names is in the bundle, by its hash');
    const ends = fb.manifest.states.filter((s) => s.marker === 'end');
    expect(ends.length, `the fallback page is the full playable page: its states hold the 27 end states at end, not a tour's (it holds ${ends.length})`).toBe(27);

    const o = browsers(await openBundle(out, { webgpu: false }));
    none(await fallbackFailures(o, receipt, fb, 'WebGPU switched off', 'the quiz'), 'with WebGPU off, the index page opens the playable page and never starts the player');

    // Every state, as #169's own test reaches them: each answer path from the start, by the targets the page shows.
    const visited = new Set<string>([fb.manifest.start]);
    const failures: string[] = [];
    for (const path of QUIZ_PATHS) {
      const name = pathName(path);
      await o.tab.navigate(`${o.server.origin}/${fb.index}`);
      const at = await o.tab.showsPage(fb.index);
      if (!at.ok || at.first !== fb.manifest.start) { failures.push(`${name}: the fallback page reopened at ${at.at} shows ${String(at.first)}, not its start ${fb.manifest.start}`); continue; }
      let here = fb.manifest.start;
      for (const [i, q] of QUIZ.questions.entries()) {
        const target = `${q}/${path[i]!}`;
        const offered = (await o.tab.targets()).sort();
        const wanted = QUIZ.options.map((x) => `${q}/${x}`);
        if (offered.join() !== wanted.join()) failures.push(`${name}: state ${here} shows the targets ${offered.join(', ') || 'none'}, not ${wanted.join(', ')}`);
        const next = follow(fb.manifest, here, q, path[i]!);
        if (next === null) { failures.push(`${name}: the manifest has no edge ${q} = ${path[i]!} from ${here}`); break; }
        const before = (await o.tab.recorded()).seen.length;
        const why = await o.tab.click(target);
        if (why) { failures.push(`${name}: ${why}`); break; }
        const landed = await o.tab.land(next, before);
        if (landed) { failures.push(`${name}: after a click on ${target} the page ${landed}`); break; }
        here = next;
        visited.add(here);
      }
    }
    none(failures, 'each answer path plays an edge per click and lands where the manifest says');
    none(fb.manifest.states.filter((s) => !visited.has(s.id)).map((s) => `state ${s.id} (${JSON.stringify(s.controls)}) is never reached`), 'the playable page reaches every state');
    none(requestFailures1040(o, receipt, 'the quiz'), "the pages asked for nothing but the bundle's own files, by hash");
    none(await neverStartedFailures(o, receipt, 'WebGPU switched off', 'the quiz, after the walk'), 'the player never started');
    await closeBundle(o);
  }, TIMEOUT);
});
