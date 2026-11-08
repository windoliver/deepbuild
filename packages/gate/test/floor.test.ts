// The floor's cite of a run: a heavy command deep-hook rewrote into its `deep lease` form (#1015) is the run the agent
// typed, so a claim citing it isn't sent back as citing a run never made (#669's AC2, found by #70's Linux run).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { floor, lockDefinition, type DefinitionParts, type SessionRun } from '../src/index.js';

const checkout = mkdtempSync(join(tmpdir(), 'gate-floor-'));
afterAll(() => rmSync(checkout, { recursive: true, force: true }));
const definition: DefinitionParts = { task_ref: 'task:01K74G0A1B2C3D4E5F6G7H8J9K', requirements: [], deliverables: [], files: {} };
const ran = (...commands: string[]): SessionRun[] => commands.map((command) => ({ command, exit_status: 0, output: '' }));
const runFindings = (message: string, runs: SessionRun[]) => {
  const result = floor({ claim: { claim: 'claim:01K74G0A1B2C3D4E5F6G7H8J9K', message }, checkout, definition, locked: lockDefinition(definition), session: { read: [], ran: runs } });
  return result.ok ? [] : result.findings.filter((f) => f.kind === 'run').map((f) => f.ref);
};

describe('a claim citing a run deep-hook leased', () => {
  it('counts `npm test`, run as `deep lease -- npm test`, as made', () => {
    expect(runFindings('Fixed: `npm test` passes 3 of 3.', ran('deep lease -- npm test'))).toEqual([]);
  });
  it('counts a run leased with its kinds, `deep lease browser -- npm run e2e`, as made', () => {
    expect(runFindings('`npm run e2e` passes.', ran('deep lease browser -- npm run e2e'))).toEqual([]);
  });
  it('still finds `npm run lint`, which the session never ran, beside a leased run it did', () => {
    expect(runFindings('`npm test` passes and `npm run lint` is clean.', ran('deep lease -- npm test'))).toEqual(['npm run lint']);
  });
});
