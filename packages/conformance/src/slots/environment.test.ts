// The environment kit's down rule reads the process table for the run token. (The second invariant: what the kit
// can't see is BLOCKED, never a pass.) Two kit runs on the same fixture at once share no run token, so neither
// sees the other's processes.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanFills, runKit, slotKits } from '../index.js';

const kit = () => slotKits().find((k) => k.slot === 'environment@1')!;
const path = process.env.PATH;
afterEach(() => { process.env.PATH = path; });

describe('the environment kit and the process table', () => {
  it('reads BLOCKED, not PASS, when ps can\'t be run', async () => {
    const k = kit();
    const [fill] = cleanFills(k);
    process.env.PATH = '/nonexistent';
    const report = await runKit(k, fill!, { parts: ['fixed'] });
    expect(report.cases.map((c) => c.outcome)).toEqual(['BLOCKED', 'BLOCKED']);
    expect(report.cases[0]!.message).toMatch(/ps failed/);
  });

  it('passes the clean fill on the same fixture in two kit runs at once', async () => {
    const k = kit();
    const reports = await Promise.all([0, 1].map(() => runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] })));
    expect(reports.flatMap((r) => r.cases.map((c) => `${c.outcome}${c.message ? `: ${c.message}` : ''}`))).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });
});
