// AC2: no notice contains text written by another agent. A Codex session B plants its own words everywhere an agent
// writes (its prompt, its messages, its patch, its commit, its last words, its pull request's title); a Claude Code
// session A then hears of B at all three moments the issue names: at its start, before it edits a file B changed, and
// at its next tool call after B's PR merges. No notice, and nothing A's hooks told it, may carry any planted word.
import { afterAll, describe, it } from 'vitest';
import {
  AC2, ClaudeSession, CodexSession, MERGE_SETTLE_MS, aboutFile, allNotices, allEvents, change, cleanup, commitAll, decision, heard,
  lastPos, listed, makeWorld, mergePr, must, names, noticeText, plant, startHub, sleep, toldMust, trust, worktree,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC2} no notice contains text written by another agent`, () => {
  it(`${AC2} B's planted words in its prompt, messages, patch, commit, last words and PR title reach no notice; A still hears of B at its start, before its edit of src/cart.js, and after #44 merges`, async () => {
    const w = makeWorld();
    const wa = worktree(w, 'wa', 'a/cart');
    const wb = worktree(w, 'wb', 'b/cart');
    await trust(w, [wa, wb]);
    const hub = await startHub(w);
    const [prompt, message, patched, commit, last, title, shell] = [plant('prompt'), plant('message'), plant('patch'), plant('commit'), plant('last words'), plant('pr title'), plant('shell')] as const;
    const plants = [prompt, message, patched, commit, last, title, shell];

    const b = CodexSession.open(w, wb);
    await b.start();
    await b.typed(`Make the cart skip empty lines. ${prompt.text}`);
    b.say(message.text);
    await b.patch(['*** Begin Patch', '*** Update File: src/cart.js', '@@', '-  // end of cart', `+  // ${patched.text}`, '+  // end of cart', '*** End Patch', ''].join('\n'),
      () => change(`${wb}/src/cart.js`, '  // end of cart', `  // ${patched.text}\n  // end of cart`));
    await b.bash(`echo '${shell.text}' && git commit -am '${commit.text}'`, { stdout: shell.text, effect: () => commitAll(wb, commit.text) });
    await b.stop(last.text);

    // 1. A's start: who else is in the repo and on what.
    const a = ClaudeSession.open(w, wa);
    let pos = await lastPos(hub);
    await a.start();
    const atStart = await heard(hub, a.id, pos, b.id);
    must(atStart.length > 0 && names(atStart.map(noticeText).join(' '), b.id), `${AC2} session ${a.id}'s start must tell it who else is in the repo (session ${b.id}, which changed src/cart.js): the record holds no notice to it naming ${b.id}: ${listed(atStart)}`);
    toldMust(a, 0, atStart.every((n) => a.toldSince(0).includes(noticeText(n))), `${AC2} session ${a.id}'s SessionStart reply must carry the notice: it was told ${JSON.stringify(a.toldSince(0).slice(0, 600))}`);

    // 2. Before an edit to a file B changed: which session changed it.
    await a.typed('Round each cart line to cents.');
    const before = a.fired.length;
    pos = await lastPos(hub);
    const call = await a.begin('Edit', { file_path: `${wa}/src/cart.js`, old_string: '  // end of cart', new_string: '  rounded: true,\n  // end of cart', replace_all: false });
    const atEdit = (await heard(hub, a.id, pos, b.id)).filter((n) => aboutFile(n, 'src/cart.js'));
    must(atEdit.length > 0, `${AC2} before its edit of src/cart.js, session ${a.id} must hear that session ${b.id} changed it: the record holds no such notice`);
    toldMust(a, before, atEdit.every((n) => a.toldSince(before).includes(noticeText(n))), `${AC2} the Edit's PreToolUse reply must carry the notice: it was told ${JSON.stringify(a.toldSince(before).slice(0, 600))}`);
    if (decision(call.before) === 'allow') {
      change(`${wa}/src/cart.js`, '  // end of cart', '  rounded: true,\n  // end of cart');
      await a.finish(call, { filePath: `${wa}/src/cart.js`, oldString: '  // end of cart', newString: '  rounded: true,\n  // end of cart', replaceAll: false, structuredPatch: [], userModified: false });
    }

    // 3. After B's PR merges over A's file: rebase before saying done.
    mergePr(w, 'b/cart', 44, title.text);
    await sleep(MERGE_SETTLE_MS);
    pos = await lastPos(hub);
    const merged = a.fired.length;
    await a.read('src/cart.js');
    const atMerge = (await heard(hub, a.id, pos, b.id)).filter((n) => /rebase/i.test(noticeText(n)));
    must(atMerge.length > 0, `${AC2} at its next tool call after #44 merged, session ${a.id} must hear that session ${b.id}'s change merged over src/cart.js and to rebase: the record holds no such notice`);
    toldMust(a, merged, atMerge.every((n) => a.toldSince(merged).includes(noticeText(n))), `${AC2} that call's replies must carry the notice: they told it ${JSON.stringify(a.toldSince(merged).slice(0, 600))}`);

    // Nothing planted reaches a notice, or anything A was told.
    const notices = allNotices(await allEvents(hub));
    const told = a.toldSince(0);
    for (const p of plants) {
      const inNotice = notices.find((n) => noticeText(n).includes(p.token) || JSON.stringify(n.data).includes(p.token));
      must(!inNotice, `${AC2} notice ${inNotice?.data?.notice ?? inNotice?.id} carries text session ${b.id} wrote (${p.token}): ${(JSON.stringify(inNotice?.data) ?? "").slice(0, 600)}`);
      must(!told.includes(p.token), `${AC2} session ${a.id} was told text session ${b.id} wrote (${p.token}): ${JSON.stringify(told.slice(told.indexOf(p.token) - 200, told.indexOf(p.token) + 200))}`);
    }
  }, 600_000);
});
