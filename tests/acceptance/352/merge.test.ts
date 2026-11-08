// AC1: when a sibling's PR merges and touches a file this session changed, the session is told at its next tool call.
// Two worktrees of one repo: a Codex session whose patch names its files every way a raw patch can (README, AC1), and
// a Claude Code session; each time the other's branch merges into main as a pull request, and the session's next tool
// call must carry the notice.
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import {
  AC1, ClaudeSession, CodexSession, MERGE_SETTLE_MS, cleanup, commitAll, change, fromSession, lastPos, link, makeWorld,
  mergePr, must, names, noticeText, noticesTo, settle, sleep, startHub, toldMust, trust, worktree, listed, aboutFile, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const TOTAL = '  total: (xs) => xs.reduce((a, b) => a + b, 0),';
const ROUNDED = '  total: (xs) => xs.reduce((a, b) => a + Math.round(b * 100) / 100, 0),';
const FILES = {
  'src/old-price.js': 'module.exports = (x) => x;\n',
  'src/legacy.js': 'module.exports = { legacy: true };\n',
  'src/other.js': 'module.exports = { other: 1 };\n',
  'lib/index.js': "module.exports = require('../src/cart.js');\n",
};

/**
 * The merge's notices to the session, read from the record and then from what its next tool call was told: they name
 * the sibling, the PR, each file it changed that the merge touched and no other, ask for a rebase, and reached it in
 * that call's replies.
 */
async function judge(hub: Hub, a: Session, from: number, pos: number, sibling: string, pr: number, files: string[], notFiles: string[]): Promise<void> {
  const events = await settle(hub, (all) => noticesTo(all, a.id, pos).some((n) => fromSession(n, sibling)), 15_000);
  const got = noticesTo(events, a.id, pos).filter((n) => fromSession(n, sibling));
  must(got.length > 0, `${AC1} session ${a.id} must be told at its next tool call that session ${sibling}'s pull request #${pr} merged over its files: the record holds no notice.delivered to it from ${sibling} (notices to it: ${listed(noticesTo(events, a.id, pos))})`);
  const text = got.map(noticeText).join('\n');
  must(names(text, sibling), `${AC1} the notice to session ${a.id} must name session ${sibling}: ${JSON.stringify(text)}`);
  must(new RegExp(`(#|PR |pull request )${pr}\\b`, 'i').test(text), `${AC1} the notice to session ${a.id} must name the merged pull request #${pr}: ${JSON.stringify(text)}`);
  for (const f of files) must(got.some((n) => aboutFile(n, f)), `${AC1} the notice to session ${a.id} must name ${f}, a file it changed that #${pr} touched: ${listed(got)}`);
  for (const f of notFiles) must(!got.some((n) => aboutFile(n, f)), `${AC1} the notice to session ${a.id} must not name ${f}, which #${pr} touched but the session never changed: ${listed(got)}`);
  must(/rebase/i.test(text), `${AC1} the notice to session ${a.id} must tell it to rebase before it says done: ${JSON.stringify(text)}`);
  const told = a.toldSince(from);
  toldMust(a, from, got.every((n) => told.includes(noticeText(n))), `${AC1} the notice must reach session ${a.id} at its next tool call, in that call's replies: they told it ${JSON.stringify(told.slice(0, 800))}`);
}

describe(`${AC1} a sibling's merged PR that touches this session's files is told at its next tool call`, () => {
  it(`${AC1} Codex: a session working through a symlinked folder, whose patch updated lib/../src/cart.js, moved src/old-price.js to lib/../src/price.js and deleted src/legacy.js, is told of #42 (cart, price, legacy) at its next tool call, and not of src/other.js`, async () => {
    const w = makeWorld({ files: FILES });
    const wa = worktree(w, 'wa', 'a/cart');
    const wb = worktree(w, 'wb', 'b/cart');
    const la = link(w, 'la', wa);
    await trust(w, [wa, wb, la]);
    const hub = await startHub(w);

    const a = CodexSession.open(w, la);
    await a.start();
    await a.typed('Round each cart line to cents.');
    const patch = [
      '*** Begin Patch',
      '*** Update File: lib/../src/cart.js', '@@', `-${TOTAL}`, `+${ROUNDED}`,
      '*** Update File: src/old-price.js', '*** Move to: lib/../src/price.js', '@@', '-module.exports = (x) => x;', '+module.exports = (x) => Math.round(x * 100) / 100;',
      '*** Delete File: src/legacy.js',
      '*** Add File: src/tax.js', '+module.exports = 0.2;',
      '*** End Patch', '',
    ].join('\n');
    // The patch's effect on disk, left uncommitted: the hub knows A's files only from the patch's path lines.
    await a.patch(patch, () => {
      change(`${wa}/src/cart.js`, TOTAL, ROUNDED);
      renameSync(`${wa}/src/old-price.js`, `${wa}/src/price.js`);
      writeFileSync(`${wa}/src/price.js`, 'module.exports = (x) => Math.round(x * 100) / 100;\n');
      unlinkSync(`${wa}/src/legacy.js`);
      writeFileSync(`${wa}/src/tax.js`, 'module.exports = 0.2;\n');
    });

    const b = ClaudeSession.open(w, wb);
    await b.start();
    await b.typed('Make the cart skip empty lines.');
    await b.edit('src/cart.js', '  // end of cart', '  skipEmpty: true,\n  // end of cart');
    await b.write('src/price.js', 'module.exports = (x) => Number(x.toFixed(2));\n');
    await b.edit('src/legacy.js', 'legacy: true', 'legacy: false');
    await b.edit('src/other.js', 'other: 1', 'other: 2');
    await b.bash('git commit -am "Skip empty lines"', { effect: () => commitAll(wb, 'Skip empty lines') });
    await b.stop('Done: empty lines are skipped.');

    mergePr(w, 'b/cart', 42, 'Skip empty cart lines');
    await sleep(MERGE_SETTLE_MS);
    const from = a.fired.length;
    const pos = await lastPos(hub);
    await a.bash('node --test tests/unit.test.js', { stdout: 'ok' });
    await judge(hub, a, from, pos, b.id, 42, ['src/cart.js', 'src/price.js', 'src/legacy.js'], ['src/other.js']);
  }, 600_000);

  it(`${AC1} Claude Code: a session that edited src/cart.js is told at its next tool call when a Codex sibling's #43, patched from the sibling's src folder, merges over it`, async () => {
    const w = makeWorld();
    const wa = worktree(w, 'wa', 'a/cart');
    const wb = worktree(w, 'wb', 'b/cart');
    await trust(w, [wa, wb]);
    const hub = await startHub(w);

    const a = ClaudeSession.open(w, wa);
    await a.start();
    await a.typed('Round each cart line to cents.');
    await a.edit('src/cart.js', TOTAL, ROUNDED);

    const b = CodexSession.open(w, `${wb}/src`);
    await b.start();
    await b.typed('Make the cart skip empty lines.');
    await b.patch(['*** Begin Patch', '*** Update File: cart.js', '@@', '-  // end of cart', '+  skipEmpty: true,', '+  // end of cart', '*** End Patch', ''].join('\n'),
      () => change(`${wb}/src/cart.js`, '  // end of cart', '  skipEmpty: true,\n  // end of cart'));
    await b.bash('git commit -am "Skip empty lines"', { effect: () => commitAll(wb, 'Skip empty lines') });
    await b.stop('Done: empty lines are skipped.');

    mergePr(w, 'b/cart', 43, 'Skip empty cart lines');
    await sleep(MERGE_SETTLE_MS);
    const from = a.fired.length;
    const pos = await lastPos(hub);
    await a.read('src/cart.js');
    await judge(hub, a, from, pos, b.id, 43, ['src/cart.js'], []);
  }, 600_000);
});
