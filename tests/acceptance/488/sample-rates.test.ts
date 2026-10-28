// #488.3783b684: a sample rate is valid only when its sample is a whole number of flicks: 8, 11.025,
// 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192 and 352.8 kHz pass; a 128 kHz source (5,512.5 flicks
// a sample), a 384 kHz one and a 44,056 Hz one are resampled, and an export set to 128 kHz is refused,
// naming the rate; a planted check that accepts every rate from 8 to 192 kHz passes 128 kHz and fails
// this test, naming the rate. The rule is asked through the `rate` call (a source with `source: true`),
// a document's `transport.sample_rate` through deep_show, and an export's `audio.sample_rate` through
// the `export` call (README). The wrong programs: the base (no `rate` or `export` call; a document
// at 128 kHz is presented), and the planted `accepts_every_sample_rate_8_to_192k`.
import { describe, expect, it } from 'vitest';
import {
  BACK, DOC, FLICKS, FULL, board, exportCall, int, label, outcome, presented, rateReply, rect, refusedNaming, run, sampleRate, sampleRateText, sampleRuleFailures, scenario, show,
  tryRun, useBuilds, useEvidence, validLength, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The valid list, in Hz, each with its whole-flick sample: 705,600,000 ÷ Hz. */
const VALID = [8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800];
/** Not valid: 5,512.5, 1,837.5 and 16,016.34… flicks a sample. */
const INVALID = [128_000, 384_000, 44_056];

const withSampleRate = (hz: number | undefined): JsonObject =>
  board(`Board at ${hz ?? 'the default'} Hz`, [BACK, rect('r1', [16, 40, 40, 30], 'a1', 'ink'), label('l1', 'Samples', [16, 150], 'a2')], { transport: { span: '2s', ...(hz === undefined ? {} : { sample_rate: hz }) } });

/** The rule on 128 kHz through `rate`, as a source, and through an export: what the planted check must fail, naming the rate. */
function rule128(): { calls: JsonObject[]; check: (replies: JsonObject[] | null) => string[] } {
  const calls = [show(withSampleRate(undefined)), sampleRate(128_000), sampleRate(128_000, { source: true }), exportCall(DOC.a, { sample_rate: 128_000 }), sampleRate(44_056), sampleRate(384_000)];
  const check = (replies: JsonObject[] | null): string[] => {
    const failures = [...sampleRuleFailures(replies?.[1], 128_000, 'rate'), ...sampleRuleFailures(replies?.[4], 44_056, 'rate'), ...sampleRuleFailures(replies?.[5], 384_000, 'rate')];
    const source = replies?.[2];
    if (!source || outcome(source) !== 'resampled') failures.push(`a 128000 Hz source is resampled, not ${source ? outcome(source) : 'unanswered'}`);
    const exp = replies?.[3];
    if (!exp || outcome(exp) !== 'refused' || exp['code'] !== 'bad_rate') failures.push(`an export at 128000 Hz is refused with bad_rate, not ${exp ? JSON.stringify(exp).slice(0, 200) : 'unanswered'}`);
    else if (!JSON.stringify(exp).includes('128000')) failures.push(`the refused export at 128000 Hz doesn't name the rate: ${JSON.stringify(exp).slice(0, 200)}`);
    return failures;
  };
  return { calls, check };
}

describe('#488.3783b684 a sample rate is valid only when its sample is a whole number of flicks; invalid sources are resampled and an invalid export refused, naming the rate; a planted accept-all check passes 128 kHz and fails', () => {
  it('#488.3783b684 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192 and 352.8 kHz are valid, each with its whole-flick sample', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), VALID.map((hz) => sampleRate(hz))));
    for (const [i, hz] of VALID.entries()) {
      expect(validLength(replies[i]!, sampleRateText(hz)), `${hz} Hz has a sample of ${FLICKS / hz} flicks`).toBe(FLICKS / hz);
      expect(rateReply(replies[i]!, sampleRateText(hz)).rate, 'the reply names the rate').toBe(sampleRateText(hz));
    }
  }, 600_000);

  it('#488.3783b684 128 kHz, 384 kHz and 44,056 Hz are not valid: refused as a rate, naming it, and resampled as a source', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), INVALID.flatMap((hz) => [sampleRate(hz), sampleRate(hz, { source: true })])));
    for (const [i, hz] of INVALID.entries()) {
      const refused = rateReply(replies[2 * i]!, sampleRateText(hz));
      expect(refused.outcome, `${hz} Hz is refused as a rate (${FLICKS / hz} flicks a sample): ${JSON.stringify(refused.raw).slice(0, 400)}`).toBe('refused');
      expect(refused.raw['code'], 'with bad_rate').toBe('bad_rate');
      expect(refused.rate, 'naming the rate').toBe(sampleRateText(hz));
      const source = rateReply(replies[2 * i + 1]!, `${sampleRateText(hz)} as a source`);
      expect(source.outcome, `a ${hz} Hz source is resampled: ${JSON.stringify(source.raw).slice(0, 400)}`).toBe('resampled');
      expect(source.rate, 'naming the rate').toBe(sampleRateText(hz));
    }
  }, 600_000);

  it('#488.3783b684 a document at 128 kHz is refused with bad_rate at transport/sample_rate naming the rate; one at 44.1 kHz is presented and its export defaults to it; the default is 48 kHz', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(withSampleRate(128_000)), show(withSampleRate(44_100)), exportCall(DOC.a), show(withSampleRate(undefined), { doc: DOC.b }), exportCall(DOC.b), exportCall(DOC.b, { sample_rate: 128_000 }), exportCall(DOC.b, { sample_rate: 96_000 })]));
    refusedNaming(replies[0]!, 'bad_rate', 'transport/sample_rate', '128000', 'the board at 128 kHz');
    presented(replies[1]!, 'the board at 44.1 kHz');
    expect(outcome(replies[2]!), `its export is planned: ${JSON.stringify(replies[2]).slice(0, 400)}`).toBe('planned');
    expect(int(replies[2]!['sample_rate'], 'the export\'s sample rate'), 'defaults to the document\'s').toBe(44_100);
    expect(int(replies[2]!['sample'], 'the export\'s sample'), '705,600,000 ÷ 44,100').toBe(16_000);
    presented(replies[3]!, 'the board at the default rate');
    expect(int(replies[4]!['sample_rate'], 'the default export rate'), 'transport.sample_rate defaults to 48,000').toBe(48_000);
    expect(int(replies[4]!['sample'], 'its sample')).toBe(14_700);
    expect(outcome(replies[5]!), 'an export at 128 kHz is refused').toBe('refused');
    expect(replies[5]!['code']).toBe('bad_rate');
    expect(JSON.stringify(replies[5]), 'naming the rate').toContain('128000');
    expect(outcome(replies[6]!), 'an export at 96 kHz is planned').toBe('planned');
    expect(int(replies[6]!['sample'], 'its sample')).toBe(7_350);
  }, 600_000);

  it('#488.3783b684 a planted check that accepts every rate from 8 to 192 kHz (accepts_every_sample_rate_8_to_192k) passes 128 kHz and fails this test, naming the rate', () => {
    const honest = rule128();
    expect(honest.check(run(builds.bin(FULL), scenario(evidence(), honest.calls))), 'the honest rule passes the check').toEqual([]);
    const planted = rule128();
    const failures = planted.check(tryRun(builds.bin(FULL), scenario(evidence(), planted.calls, { planted: 'accepts_every_sample_rate_8_to_192k' })));
    expect(failures.length, 'the planted check fails').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names 128000 Hz').toContain('128000');
  }, 600_000);
});
