// #1579 AC4: a signed unpair works; the merge base refuses it (its `unpair` strips `device` before the check, and
// `signed` needs it). In the design's format the signer is `signature.signed.device` and the device unpaired is the
// call's `device` param, so the two no longer share a name. Through the hub's socket, as the DeepBuild app calls it.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, answeredNothing, approve, asApp, cleanup, newDevice, pairDevice, refusedNaming, signing, signNew, world, holds } from './helpers.ts';
import { countedAnswer } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC[4]} A signed unpair works. The merge base refuses it`, () => {
  it(`${AC[4]} the app's device.unpair of the paired phone, signed in the new format, unpairs it: the phone's signature then counts for nothing, the app's still counts`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push feature/1579-phone to origin?' }, { source: 'effect.push', question: 'Push feature/1579-app to origin?' }, { source: 'effect.push', question: 'Push feature/1579-before to origin?' }] });
    const [byPhone, byApp, before] = [w.asks[0]!, w.asks[1]!, w.asks[2]!];
    const phone = newDevice('your phone');
    await pairDevice(w, phone);
    // Paired, the phone's signature counts (checked below, once the unpair's outcome is known).
    const control = await countedAnswer(w, before, await asApp(w, 'ask.answer', signNew('ask.answer', approve(before), phone, await signing(w))), 'the paired phone\'s approval');
    // Unsigned, from the app, it changes nothing (unchanged): the phone stays paired.
    expect('error' in (await asApp(w, 'device.unpair', { device: phone.id! })), 'an unsigned unpair from the app is refused').toBe(true);

    const reply = await asApp(w, 'device.unpair', signNew('device.unpair', { device: phone.id! }, w.device, await signing(w)));
    expect(reply.error, `the signed unpair of ${phone.id} works: ${JSON.stringify(reply.error)}`).toBeUndefined();
    expect(reply.result?.unpaired).toBe(phone.id);
    holds(control);

    // The phone's own fresh signature now counts for nothing, refused naming its device.
    const phoneSays = await asApp(w, 'ask.answer', signNew('ask.answer', approve(byPhone), phone, await signing(w)));
    holds(refusedNaming(phoneSays, 'device', `an approval signed by the unpaired ${phone.id}`));
    holds(await answeredNothing(w, byPhone.handle));
    // The app that unpaired it is still paired.
    holds(await countedAnswer(w, byApp, await asApp(w, 'ask.answer', signNew('ask.answer', approve(byApp), w.device, await signing(w))), 'the app\'s approval after the unpair'));
  }, 300_000);
});
