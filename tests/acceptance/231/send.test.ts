// AC4 #231.63877b11: "A Send of a draft is refused, naming `purpose`"
//
// Through `deep-show run`'s `export` with `purpose: "draft"` (README: `export`) and its `send` call (the capture
// suite's: a Send by a session's agent of files, by hash, from the evidence store). One process exports a 2 s hold as
// a draft and a 1 s hold as a delivery: two films, so the two files can't be the same bytes (a draft and a delivery
// of one film may be, and are at the base). A second process, on the same store, is asked to send each file by its
// bytes' SHA-256: the draft's Send must be refused with nothing queued, the refusal naming `purpose` (README: The
// refusal), and the delivery's must be taken as any file's is, so the refusal is the draft's and not the Send's. The
// draft stays a draft across processes: a draft "can never be shared, attached or sent". Wrong program: the merge
// base, which reads no `purpose`, exports a delivery both times and takes both Sends.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, DOC, DRAFT, FULL, countFailures, countedOf, exportCall, holdFilm, isObject, none, obj, present, presented, putEvidence, runShow, scenario, show as shown,
  str, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const TO = 'http://127.0.0.1:9/shared';

/** Whether a reply names `purpose`: the field `purpose` reading `draft`, on the reply or on one of its issues. */
const namesPurpose = (reply: JsonObject): boolean =>
  reply['purpose'] === 'draft' || (Array.isArray(reply['issues']) && reply['issues'].some((i) => isObject(i) && i['purpose'] === 'draft'));

describe(`${AC[4]} a draft can never be sent`, () => {
  it(`${AC[4]} a Send of a draft is refused, naming purpose, with nothing queued, while a Send of a delivery is taken`, () => {
    const bin = show(FULL);
    const evidence = temp(); const dir = temp();
    const draft = join(dir, 'draft.mp4'); const delivery = join(dir, 'delivery.mp4');
    const [long, short, a, b] = runShow(bin, scenario(evidence, [
      present(DOC.a, holdFilm(evidence, 2).document), present(DOC.b, holdFilm(evidence, 1).document), exportCall(DOC.a, draft, DRAFT), exportCall(DOC.b, delivery),
    ]), 'a 2 s hold as a draft and a 1 s hold as a delivery');
    presented(long, 'the 2 s hold'); presented(short, 'the 1 s hold');
    // A draft is an export that ran no delivery decode; the delivery drew its one frame again for export.fidelity.
    none([
      ...countFailures('the draft', countedOf(a, 'the draft'), { frames: 120, draws: 1, purpose: 'draft' }),
      ...countFailures('the delivery', countedOf(b, 'the delivery'), { frames: 60, draws: 1, purpose: 'delivery' }),
    ], 'a 2 s hold as a draft and a 1 s hold as a delivery');
    expect([existsSync(draft), existsSync(delivery)], 'the draft and the delivery are each a file at their out').toEqual([true, true]);
    // Both files are in the store by hash, as a Send takes them.
    const files = [draft, delivery].map((path) => putEvidence(evidence, readFileSync(path)));
    expect(files[0], 'the draft and the delivery are different files').not.toBe(files[1]);
    const [sentDraft, sentDelivery] = runShow(bin, scenario(evidence, [
      { call: 'send', session: AGENT.id, to: TO, files: [files[0]!] },
      { call: 'send', session: AGENT.id, to: TO, files: [files[1]!] },
    ]), 'a Send of the draft and a Send of the delivery');
    // The control: a delivery's Send is queued, as the capture suite's is.
    const taken = obj(sentDelivery!['send'], `the delivery's Send is taken: ${shown(sentDelivery ?? null, 600)}`);
    expect(['waiting', 'sent'], `the delivery's Send waits for your approval or is sent: ${shown(taken)}`).toContain(str(taken['state'], 'send.state'));
    expect(sentDraft!['send'], `the draft's Send queues nothing: ${shown(sentDraft ?? null, 600)}`).toBeUndefined();
    expect(sentDraft!['outcome'] === 'refused' || typeof sentDraft!['code'] === 'string', `the draft's Send is refused: ${shown(sentDraft ?? null, 600)}`).toBe(true);
    expect(namesPurpose(sentDraft!), `the refusal names purpose (purpose: "draft", on the reply or on one of its issues): ${shown(sentDraft ?? null, 600)}`).toBe(true);
  });
});
