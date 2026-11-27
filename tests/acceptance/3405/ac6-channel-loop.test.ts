// AC6: a scripted Claude Code session gets 21 channel events in 10 minutes, each shaped as the recorded one (its
// entry and prompt from the channel's recording), after one prompt from you. They raise one ask naming the channel's
// server, and the next event is held at its submit (Claude Code is an adapter that can hold a prompt). A hub with no
// count for a channel starts that turn and fails, naming it.
import { afterAll, describe, it } from 'vitest';
import {
  AC6, ClaudeSession, PLANT, TAG, asksAfter, askText, cleanup, decision, entryOf, heldMust, lastPos, listed, makeWorld, must, needRecordings,
  promptsOfKind, serverOf, settle, shown, startHub, trust, worktree, type Recording,
} from './helpers.ts';

afterAll(cleanup, 60_000);

async function channelLoop(rec: Recording, plant?: string): Promise<void> {
  const c = promptsOfKind(rec, 'channel').find((x) => x.tag === TAG.channel);
  const entry = c && entryOf(rec, c);
  const server = serverOf(entry);
  if (!c || !entry || !server) throw Error(`BLOCKED: ${AC6} ${rec.ref} holds no channel's event whose entry names its server`);
  const w = makeWorld();
  const wa = worktree(w, 'wa', 'a/channel');
  await trust(w, [wa]);
  const hub = await startHub(w, plant);
  const a = await ClaudeSession.withInbox(w, wa, 'wa');
  await a.start();
  await a.typed('Watch the channel and answer what comes in.');
  await a.stop('Watching.');
  const since = await lastPos(hub);
  const t0 = Date.now();
  for (let k = 1; k <= 20; k++) {
    const r = await a.like(entry, c.payload.prompt);
    must(decision(r) === 'allow', `${AC6} the channel's event ${k} of session ${a.id} (prompt ${a.prompt}), within 20 in 10 minutes, must go through: ${shown(r)}`);
    await a.stop('Noted.');
  }
  const r21 = await a.like(entry, c.payload.prompt);
  if (decision(r21) === 'allow') await a.stop('Noted.');
  const r22 = await a.like(entry, c.payload.prompt);
  const took = Date.now() - t0;
  must(took < 600_000, `INCONCLUSIVE: ${AC6} the 22 events took ${Math.round(took / 1000)} s, past the 10 minutes the rule counts in`);
  heldMust(r22, `${AC6} after 21 channel events in 10 minutes with no prompt from you, the next one (prompt ${a.prompt} of session ${a.id}) must be held at its submit; the hub started that turn`);
  const events = await settle(hub, (e) => asksAfter(e, since).some((x) => askText(x).includes(server.name)), 15_000);
  const asks = asksAfter(events, since).filter((x) => askText(x).includes(server.name));
  must(asks.length === 1, `${AC6} 21 channel events must raise exactly one ask naming the server ${JSON.stringify(server.name)}: ${asks.length} were raised: ${listed(asksAfter(events, since))}`);
}

describe(`${AC6} 21 channel events in 10 minutes raise one ask naming the server, and the next is held`, () => {
  it(`${AC6} 21 channel events with no prompt from you raise one ask naming the server, and the 22nd is held at its submit`, async (ctx) => {
    const recs = needRecordings(ctx);
    if (!recs) return;
    await channelLoop(recs.channel);
  }, 900_000);

  it(`${AC6} the planted hub with no count for a channel (${PLANT.channelUncounted}) starts that turn and fails this test, naming it`, async (ctx) => {
    const recs = needRecordings(ctx);
    if (!recs) return;
    const failure = await channelLoop(recs.channel, PLANT.channelUncounted).then(() => undefined, (e: Error) => e);
    must(failure !== undefined, `${AC6} the planted hub ${PLANT.channelUncounted} must fail this test; it passed`);
    must(/the hub started that turn/.test(failure.message) && /prompt \S+ of session/.test(failure.message) && !/^(BLOCKED|INCONCLUSIVE)/.test(failure.message), `${AC6} the planted hub ${PLANT.channelUncounted} must fail naming the turn it started; it failed with: ${failure.message}`);
  }, 900_000);
});
