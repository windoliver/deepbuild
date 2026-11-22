// AC3 #1828.44a54c78: "On the same hub, an update that drops an interface an installed package uses raises one
// `extension.update` ask and installs nothing before your yes." The hub is the shipped one, with acme/feed 1.0.0
// (providing ext.acme.feed@1) and acme/board (using it) installed under its root, and acme/feed 2.0.0 (providing only
// ext.acme.feed@2, with no adapter for @1) in its release too (README, The packages). You run `deep install` on
// acme/feed 2.0.0 from your own terminal; while it waits, the record holds one ask about the update and the extension
// host's installed.json still names 1.0.0; your yes with `deep inbox answer <ask> approve` lets the install finish,
// and installed.json then names 2.0.0.
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  AC3, allEvents, answer, asksNaming, authorityShape, BOARD, boardPackage, built, cleanup, deep, FEED, FEED_V1, feedPackage, installAll, installedVersion, loadReading, makeHome, ofAsk, poll, said, shown, sleep, startHub, stopHub, verdict, type Ran,
} from './helpers.ts';

afterAll(cleanup, 180_000);

/** How long the update is watched with its ask open and no answer, for anything it installs before your yes. */
const UNANSWERED_MS = 5000;

test(`${AC3} an update that drops an interface an installed package uses raises one extension.update ask and installs nothing before your yes`, async (ctx) => verdict(ctx, async () => {
  const missing = built();
  if (missing) throw Error(`BLOCKED: ${missing}`);
  const w = makeHome();
  const dir = join(w.tmp, 'test-packages');
  const v1 = feedPackage(dir, '1.0.0');
  const board = boardPackage(dir);
  const v2 = feedPackage(dir, '2.0.0');
  await installAll(w, [v1, board], [v1, board, v2]);
  const hub = await startHub(w, { release: [v1, board, v2] });
  try {
    if (installedVersion(w, FEED) !== '1.0.0' || installedVersion(w, BOARD) !== '1.0.0') throw Error(`BLOCKED: ${FEED} 1.0.0 and ${BOARD} must be installed before the update; installed.json names ${FEED} ${String(installedVersion(w, FEED))}, ${BOARD} ${String(installedVersion(w, BOARD))}`);
    const named = `${FEED} 2.0.0`;
    let install: Ran | undefined;
    const installing = deep(w.home, ['install', v2.folder], { timeoutMs: 300_000 }).then((r) => (install = r));
    const ask = await poll(60_000, async () => asksNaming(await allEvents(hub), FEED).find((a) => JSON.stringify(a.data).includes('2.0.0')) ?? (install ? null : undefined), 200);
    if (!ask) {
      await installing;
      const events = await allEvents(hub);
      throw Error(`${AC3} \`deep install\` of ${named}, which drops ${FEED_V1} that ${BOARD} uses, raised no extension.update ask: it ended ${shown(install!)}; installed.json names ${FEED} ${String(installedVersion(w, FEED))}; asks naming ${FEED}: ${asksNaming(events, FEED).map(said).join('; ') || 'none'}`);
    }
    // Unanswered for a while: nothing is installed, and the install still waits.
    await sleep(UNANSWERED_MS);
    const before = { version: installedVersion(w, FEED), waiting: install === undefined };
    const yes = await answer(w, `ask:${ask.id}`, 'approve');
    await poll(120_000, () => install);
    await installing;
    const events = await allEvents(hub);
    const asks = asksNaming(events, FEED).filter((a) => JSON.stringify(a.data).includes('2.0.0'));
    console.log(`${AC3} the update's asks: ${asks.map(said).join('; ')}; what followed: ${ofAsk(events, ask).map(said).join('; ') || 'nothing'}; before the yes ${JSON.stringify(before)}; deep install ${shown(install!)}; deep inbox answer ${shown(yes)}; ${loadReading()}`);

    expect(asks.length, `${AC3} the update of ${named} raises one ask naming it: ${asks.map(said).join('; ')}`).toBe(1);
    expect(authorityShape(ask), `${AC3} the update's ask is extension.update's: an authority ask, approve to install and decline to keep 1.0.0: ${said(ask)}`).toBe(true);
    expect(JSON.stringify(ask.data), `${AC3} the update's ask names ${BOARD}, the installed package that uses ${FEED_V1}`).toContain(BOARD);
    expect(before, `${AC3} with the ask open and no answer for ${UNANSWERED_MS} ms, nothing is installed: installed.json still names ${FEED} 1.0.0 and deep install still waits`).toEqual({ version: '1.0.0', waiting: true });
    expect(yes.code, `${AC3} your yes counts: ${shown(yes)}`).toBe(0);
    expect(install!.code, `${AC3} on your yes the update installs: deep install ${shown(install!)}`).toBe(0);
    expect(installedVersion(w, FEED), `${AC3} on your yes installed.json names ${FEED} 2.0.0`).toBe('2.0.0');
  } finally {
    await stopHub(hub);
  }
}), 900_000);
