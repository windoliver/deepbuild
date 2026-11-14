// The floor's cite of a run: a heavy command deep-hook rewrote into its `deep lease` form (#1015) is the run the agent
// typed, so a claim citing it isn't sent back as citing a run never made (#669's AC2, found by #70's Linux run).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { floor, lockDefinition, validityGate, type DefinitionParts, type SessionRun } from '../src/index.js';

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

describe('a claim with a fenced code block', () => {
  it('reads no cite out of the fence, and still finds an inline cite of a run never made after it', () => {
    const message = 'The fix:\n\n```js\nreturn totalCents - Math.round((totalCents * coupon.percent) / 100);\n```\n\n`npm test` passes; `npm run lint` is clean.';
    expect(runFindings(message, ran('deep lease -- npm test'))).toEqual(['npm run lint']);
  });
});

// #1888: the floor reads a Makefile rule through the gate's one script reader, whichever of the rule's targets is cited.
describe('a cited make target on a rule with several targets (property)', () => {
  const name = fc.stringMatching(/^[a-z][a-z0-9_.-]{0,7}$/);
  const masks = (target: string, makefile: string): string[] => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-floor-make-'));
    try {
      writeFileSync(join(dir, 'Makefile'), makefile);
      const command = `make ${target}`;
      return validityGate({ claim: { claim: 'claim:01K74G0A1B2C3D4E5F6G7H8J9K', message: `\`${command}\` exited 0.` }, checkout: dir, deliverables: [], session: { read: [], ran: ran(command) } })
        .filter((f) => f.kind === 'masked_exit').map((f) => f.mask ?? '');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  it('reads the recipe mask for every target the rule names, and none for a rule that does not name it', () => {
    fc.assert(fc.property(fc.uniqueArray(name, { minLength: 3, maxLength: 5 }), fc.nat(), fc.constantFrom(' ', '  ', '\t'), fc.constantFrom('', ' '), (names, pick, gap, beforeColon) => {
      const [other, ...targets] = names as [string, ...string[]];
      const cited = targets[pick % targets.length]!;
      // A prerequisite of the cited name is not its rule; the masked rule is the one that names it.
      const makefile = `${other}: ${cited}\n\ttrue\n\n${targets.join(gap)}${beforeColon}:\n\teslint . || true\n`;
      expect(masks(cited, makefile)).toEqual(['|| true']);
      expect(masks(other, makefile)).toEqual([]);
    }), { numRuns: 60 });
  });
});
