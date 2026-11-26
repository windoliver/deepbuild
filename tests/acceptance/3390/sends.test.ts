// AC4 and AC5: a send is never covered by a saved decision. Your answer to one holds for that call alone, is saved as no
// decision, and no other call's ask supersedes its ask.
//
// A send's handler counts its runs and sends nothing outside (#363's stocks plug-in). The refusal of `saveDecision` is
// read on the hub's own record, through the asks core's public entry, once the hub has stopped.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AskRefused, openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import {
  answer, answerAndSave, answerOpen, brief, call, card, entered, events, expectStaysOpen, hold, named, openWorld, pkg, raised, runs, runsOn, savedFrom, SEND, SET_ALERT, stateOf,
  stopHub, TEST_MS, type Held, type World,
} from './world.ts';

/** You, on the trusted path, as `deep inbox answer` reaches the asks core. */
const YOU: Connection = { writer: 'cli', actor: 'you', scope: 'you' };
const THIS_ASK_ONLY = { scope: 'Answering saves it for this ask only', also: 0 };

const records: RecordStore[] = [];
afterAll(async () => {
  for (const record of records.splice(0)) await record.close().catch(() => undefined);
});

/** The stopped hub's own record, with the asks core on it. */
async function askCore(w: World) {
  const root = join(w.home, '.deepbuild');
  const evidence = await openEvidenceStore({ root: join(root, 'evidence') });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now, evidence });
  records.push(record);
  return { record, asks: await openAsks({ record, now: Date.now, deliver: () => undefined, home: root }) };
}
const A = { to: 'a@example.invalid' };
const B = { to: 'b@example.invalid' };

describe('AC4 #3390.78c40059 After your yes to a held send, a second call of the same send action under another request ID is held by an ask that stays open, once with the same input and once with another, and each runs once on your yes to its own ask; no decision.created names a send\'s ask, its card reads Answering saves it for this ask only with also 0, and the asks core refuses saveDecision of a send\'s answered ask', () => {
  it('AC4 after your yes to a send, the same send under another request ID, with the same input and then with another, is held by an ask of its own that stays open, and runs once on your yes to it', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const first = await hold(w, a, SEND, A);
    expect(entered(await events(w), first), `${named(first)} enters nothing before your yes`).toEqual([]);
    expect((await runs(w, a)).send_digest, 'no send ran before your yes').toBe(0);
    await answer(w, first.ask, 'approve');
    await runsOn(w, a, first, 'runs on your yes to its ask');

    const sends: Held[] = [first];
    for (const input of [A, B]) {
      const next = await hold(w, a, SEND, input);
      const what = `${named(next)}, another send after your yes to ${first.ask}`;
      await expectStaysOpen(w, a, next, next.ask);
      expect(sends.map((s) => s.ask), `${what}, has an ask of its own`).not.toContain(next.ask);
      expect(entered(await events(w), next), `${what}, enters nothing before your yes to ${next.ask}`).toEqual([]);
      expect((await runs(w, a)).send_digest, `${what}, runs nothing before your yes to ${next.ask}`).toBe(sends.length);
      await answerOpen(w, a, next.ask, 'approve', `your yes to ${what}`);
      await runsOn(w, a, next, `runs on your yes to ${next.ask}`);
      sends.push(next);
    }
    const all = await events(w);
    for (const s of sends) expect(entered(all, s), `the input of ${named(s)} entered once`).toEqual([s.input]);
    expect((await runs(w, a)).send_digest, 'three sends ran, each once').toBe(3);
    expect(raised(all, a), 'each send asked once').toEqual(sends.map((s) => s.ask));
  }, TEST_MS);

  it('AC4 a send ask\'s card reads Answering saves it for this ask only with also 0, no decision.created names the ask, and the asks core refuses saveDecision of it', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    // The control: your yes to a change is saved as a decision, and the asks core saves it again at another scope.
    const change = await hold(w, a, SET_ALERT, { symbol: 'NVDA', above: 200 });
    await answerAndSave(w, change, 'approve');

    // Two sends held at once, so a card that counts another open send would say so; one is answered no and one yes.
    const yes = await hold(w, a, SEND, A);
    const no = await hold(w, a, SEND, B);
    const sends = [yes, no];
    for (const s of sends) {
      const { saves } = await card(w, s.ask);
      expect.soft(saves, `the card of ${s.ask}, raised by ${named(s)}, says your answer holds for this ask only`).toEqual(THIS_ASK_ONLY);
    }
    const answered: Held[] = [];
    for (const [s, option] of [[no, 'decline'], [yes, 'approve']] as const) {
      const state = await stateOf(w, a, s.ask);
      expect.soft(state, `${s.ask}, raised by ${named(s)}, is open and takes your answer`).toBe('open');
      if (state !== 'open') continue;
      await answer(w, s.ask, option);
      answered.push(s);
    }
    const all = await events(w);
    for (const s of answered) {
      expect(all.filter((e) => e.kind === 'ask.answered' && e.subject === s.ask), `${s.ask}, raised by ${named(s)}, was answered by you, once`).toHaveLength(1);
      expect.soft(savedFrom(all, s.ask).map((e) => e.data), `your answer to ${s.ask}, raised by ${named(s)}, is saved as no decision`).toEqual([]);
    }

    await stopHub(w);
    const { record, asks } = await askCore(w);
    for (const s of answered) {
      for (const scope of ['session', 'repo', 'all'] as const) {
        const said = await asks.saveDecision(YOU, s.ask, scope).then((decision) => `saved ${decision}`, (error: unknown) => error);
        expect.soft(said instanceof AskRefused, `the asks core refuses saveDecision of ${s.ask}, raised by ${named(s)}, at ${scope}: ${said instanceof Error ? `${said.name}: ${said.message}` : brief(said)}`).toBe(true);
      }
    }
    expect(await asks.saveDecision(YOU, change.ask, 'session'), `the control: the asks core saves ${change.ask}, a change's answered ask`).toMatch(/^decision:/);
    await record.sync();
    const saved = (await record.read({ after: 0, limit: 1000, kinds: ['decision.created'] })).map((e) => (e.data as { ask?: unknown }).ask);
    expect.soft(saved.filter((ask) => sends.some((s) => s.ask === ask)), 'no decision.created names a send\'s ask').toEqual([]);
    expect(saved, 'the control: the decisions saved are the change\'s').toContain(change.ask);
  }, TEST_MS);
});

describe('AC5 #3390.d4dd7cfe Two sends held at once in one session keep two open asks, with no ask.superseded; your yes to one runs that one once, the other still reads held by its own ask, and it runs on your yes to it', () => {
  /** Two sends held at once; your yes to one, the newer when `newerFirst`, then to the other. */
  async function twoAtOnce(inputs: [Record<string, unknown>, Record<string, unknown>], newerFirst: boolean): Promise<void> {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const older = await hold(w, a, SEND, inputs[0]);
    const newer = await hold(w, a, SEND, inputs[1]);
    const held = [older, newer];
    expect(newer.ask, `${named(newer)} has an ask of its own, beside ${named(older)}'s`).not.toBe(older.ask);
    for (const s of held) await expectStaysOpen(w, a, s, s.ask);
    const superseded = (await events(w)).filter((e) => e.kind === 'ask.superseded').map((e) => ({ ask: e.subject, by: e.data?.by }));
    expect(superseded, `no send's ask supersedes another's: ${held.map((s) => `${s.ask} is of ${named(s)}`).join('; ')}`).toEqual([]);
    expect(held.map((s) => s.ask).sort(), 'the session has the two open asks').toEqual(raised(await events(w), a).sort());
    expect((await runs(w, a)).send_digest, 'no send ran before your yes').toBe(0);

    const [one, other] = newerFirst ? [newer, older] : [older, newer];
    await answerOpen(w, a, one.ask, 'approve', `your yes to ${named(one)}`);
    await runsOn(w, a, one, `runs on your yes to ${one.ask}`);
    const waits = await call(w, a, other);
    expect({ isError: waits.isError, status: waits.value?.status, ask: waits.value?.ask }, `${named(other)} still waits for your answer to its own ask, after your yes to ${one.ask}: ${brief(waits.reply)}`)
      .toEqual({ isError: false, status: 'held', ask: other.ask });
    await expectStaysOpen(w, a, other, other.ask);
    const between = await events(w);
    expect(entered(between, one), `the input of ${named(one)} entered once`).toEqual([one.input]);
    expect(entered(between, other), `${named(other)} enters nothing on your yes to ${one.ask}`).toEqual([]);
    expect((await runs(w, a)).send_digest, 'one send ran').toBe(1);

    await answerOpen(w, a, other.ask, 'approve', `your yes to ${named(other)}`);
    await runsOn(w, a, other, `runs on your yes to ${other.ask}`);
    const all = await events(w);
    for (const s of held) expect(entered(all, s), `the input of ${named(s)} entered once`).toEqual([s.input]);
    expect((await runs(w, a)).send_digest, 'two sends ran, each once').toBe(2);
    expect(all.filter((e) => e.kind === 'ask.superseded'), 'no ask was superseded').toEqual([]);
    expect(raised(all, a), 'each send asked once').toEqual(held.map((s) => s.ask));
  }

  it('AC5 two sends with different inputs held at once: two open asks, none superseded; your yes to the older runs it alone, and the newer waits for and runs on its own', () => twoAtOnce([A, B], false), TEST_MS);

  it('AC5 two sends with the same input held at once: two open asks, none superseded; your yes to the newer runs it alone, and the older waits for and runs on its own', () => twoAtOnce([A, A], true), TEST_MS);
});
