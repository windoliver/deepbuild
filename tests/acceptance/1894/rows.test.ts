import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { transcriptReaders } from '../../../packages/adapters/src/index.ts';
import { AGENT_SESSIONS, cleanup, GOLDEN, runScenario, type Scenario } from './helpers.ts';

afterAll(cleanup);

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Scenario & { base: string };

describe('AC3 #1894: the learned rows of the recorded sessions are byte for byte the merge base\'s', () => {
  it('the golden holds every shipped format, with rows both in force and refused', () => {
    expect(Object.keys(golden.sessions)).toEqual(AGENT_SESSIONS);
    const states = golden.learned_layer.map((r) => (JSON.parse(r) as { state: string }).state);
    expect(states).toContain('applied');
    expect(states).toContain('refused');
    for (const name of AGENT_SESSIONS) expect(golden.transcripts[name], `the base read turns from the ${name} transcript`).not.toMatch(/^(undefined|\[\])$/);
  });

  it('with the shipped agents\' readers, the record gives the base\'s learned rows, resolved handles and session transcripts', async () => {
    expect(Array.isArray(transcriptReaders), '@deepbuild/adapters exports transcriptReaders, the shipped agents\' transcript readers').toBe(true);
    expect(transcriptReaders.length, 'one reader for each of Claude Code, Codex, pi and Cursor').toBeGreaterThanOrEqual(4);
    const now = await runScenario(transcriptReaders);
    expect(now.sessions).toEqual(golden.sessions);
    expect(now.learned_layer.join('\n')).toBe(golden.learned_layer.join('\n'));
    expect(now.resolved).toEqual(golden.resolved);
    expect(now.transcripts).toEqual(golden.transcripts);
    expect(now.reader).toEqual(golden.reader);
  }, 300_000);
});
