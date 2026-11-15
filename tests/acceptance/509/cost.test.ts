// #509.a5c9def9: "A narration job shows its cost before it runs and counts against your budget"
//
// A real hub with deepbuild/speech installed (its model host on 8720) and the test plug-in test/speech-paid
// (fixtures/voice), whose speech tool paid-voice@1.0.0 declares `cost: {usd: 0.015}` a run: a local program that makes
// no call and speaks the kind's fixture line from a recording the test made with `say` (nothing is paid). Shown before
// it runs: deep_job {op: "list"} names each speech tool's `cost: {usd}`, 0.015 for paid-voice, 0 for the free
// kokoro@0.9.4 and platform-say@1.0.0, and more than 0 for azure-speech@1.0.0 (networked and paid, never run here); and
// a run of paid-voice on the fixture line is held, with no output and no process started, on one ask that names the
// tool and its price. Counted against your budget: after your yes the run is done, and the record holds the ledger's
// `spend.reserved` of 0.015 for the run, appended before the tool's process starts, and its `spend.charged` of 0.015
// (Budget: a paid run reserves its price against the budgets that cover it before it starts and is charged once its
// cost reading lands; a yes to a run no budget covers approves a budget for that run alone).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AZURE, FIXTURE_LINE, KOKORO, PLATFORM, SPEECH, TIMEOUT, asks, dataOf, deepJob, done, events, install, kinds, lastPos, lineWav, openWorld, outputOf,
  proof, shown, toolsOf, voicePlugin, withPlugin, yes, type Line,
} from './helpers.ts';

const TOOL = 'paid-voice@1.0.0';
const USD = 0.015;
const close = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const usdOf = (t: Line | undefined): unknown => t?.['cost']?.['usd'];

describe(`${AC[13]} a narration job shows its cost before it runs and counts against your budget`, () => {
  it(`${AC[13]} deep_job lists each speech tool's cost; ${TOOL} at $${USD} is held on one ask naming its price before any process starts; after your yes it runs, reserved before it starts and charged $${USD}`, async () => {
    const w = await openWorld([]);
    await withPlugin(w, SPEECH);
    const dir = await voicePlugin(join(w.tmp, 'paid'), { id: 'test/speech-paid', tool: 'paid-voice', version: '1.0.0', cost: { usd: USD } }, lineWav());
    const installed = await install(w, dir);
    expect(installed.code, `deep install of test/speech-paid: ${shown(installed)}`).toBe(0);
    const tools = toolsOf(await kinds(w), 'speech');
    const by = (t: string): Line | undefined => tools.find((x) => x['tool'] === t);

    const pos = await lastPos(w);
    const args = { op: 'run', kind: 'speech', tool: TOOL, params: JSON.stringify({ say: FIXTURE_LINE, voice: 'samantha', rate: 1 }) };
    const held = await deepJob(w, args);
    const beforeYes = await events(w, pos);
    const raised = (await asks(w, pos)).filter((a) => a.text.includes('paid-voice'));
    const ran = raised[0] ? await yes(w, raised[0]) : undefined;
    const after = await deepJob(w, args);
    const all = await events(w, pos);
    const reserved = all.filter((e) => e['kind'] === 'spend.reserved');
    const charged = all.filter((e) => e['kind'] === 'spend.charged');
    const started = all.filter((e) => e['kind'] === 'process.starting');
    proof('ac13-cost.json', { tools, held: held.value, asks: raised.map((a) => a.data), yes: ran ?? null, after: after.value, reserved: reserved.map(dataOf), charged: charged.map(dataOf), started: started.length });

    expect(close(usdOf(by(TOOL)), USD), `deep_job lists ${TOOL} with cost {usd: ${USD}}: ${JSON.stringify(by(TOOL))}`).toBe(true);
    expect([usdOf(by(KOKORO)), usdOf(by(PLATFORM))], `deep_job lists the free tools at cost {usd: 0}: ${JSON.stringify([by(KOKORO), by(PLATFORM)])}`).toEqual([0, 0]);
    expect(typeof usdOf(by(AZURE)) === 'number' && (usdOf(by(AZURE)) as number) > 0, `deep_job lists ${AZURE}'s price, more than 0: ${JSON.stringify(by(AZURE))}`).toBe(true);

    expect(done(held) || outputOf(held, 'audio') !== undefined, `before your yes the paid run is held, with no output: ${held.text.slice(0, 800)}`).toBe(false);
    expect(beforeYes.filter((e) => e['kind'] === 'process.starting' || e['kind'] === 'spend.charged').map((e) => e['kind']), 'before your yes no process starts and nothing is charged').toEqual([]);
    expect(raised.length, `one ask names ${TOOL}: ${JSON.stringify(raised.map((a) => a.data)).slice(0, 1500)}`).toBe(1);
    expect(raised[0]!.text.includes(String(USD)), `the ask shows the run's price, $${USD}, before it runs: ${raised[0]!.text.slice(0, 1500)}`).toBe(true);
    expect(ran?.code, `your yes to the ask: ${ran ? shown(ran) : 'none'}`).toBe(0);
    expect(done(after) && outputOf(after, 'audio') !== undefined, `after your yes the run is done with its audio: ${after.text.slice(0, 800)}`).toBe(true);

    const hold = reserved.find((e) => {
      const budgets = dataOf(e)['budgets'];
      return Array.isArray(budgets) && close(budgets.reduce((s: number, b: Line) => s + Number(b['usd'] ?? 0), 0), USD);
    });
    expect(hold, `the record holds a spend.reserved of $${USD} for the run: ${JSON.stringify(reserved.map(dataOf)).slice(0, 1500)}`).toBeDefined();
    expect(started.length, 'after your yes the tool runs as a process of its own').toBeGreaterThan(0);
    const first = Math.min(...started.map((e) => Number(e['log_pos'])));
    expect(Number(hold!['log_pos']) < first, `the price is reserved before the tool's process starts (reserved at ${String(hold!['log_pos'])}, the first process at ${first})`).toBe(true);
    const charge = charged.find((e) => dataOf(e)['run'] === dataOf(hold!)['run']);
    expect(close(charge ? dataOf(charge)['usd'] : undefined, USD), `the run is charged $${USD} against the budget it reserved: ${JSON.stringify(charged.map(dataOf))}`).toBe(true);
  }, TIMEOUT);
});
