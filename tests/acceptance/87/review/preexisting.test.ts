// AC "A finding whose quote is on a context line of the diff, a line the change didn't add or alter, shows on the
// verdict line as pre-existing and sends nothing back; a check that sends it back fails this test, naming the line."
// The change adds line 6 to src/config.ts; line 4, an unchecked JSON.parse there since the base, is a context line of
// its diff, and the reviewer flags it.
import { describe, expect, it } from 'vitest';
import { history, reviewSpec, ruleReviewer, runReview, shown } from './helpers.ts';

const CONFIG = 'src/config.ts';
const base = [
  "import { readFileSync } from 'node:fs';",
  '',
  "const text = readFileSync('config.json', 'utf8');",
  'const cfg = JSON.parse(text);',
  'export const host = cfg.host;',
];

describe('AC a finding on a context line is pre-existing: a follow-up on the verdict line, never a send-back', () => {
  it(`the unchecked JSON.parse at ${CONFIG}:4, a context line, shows as pre-existing and sends nothing back`, async () => {
    const h = history({ [CONFIG]: base }, [{ label: 'A', files: { [CONFIG]: [...base, 'export const port = cfg.port ?? 8080;'] } }]);
    const reviewer = ruleReviewer();
    const result = await runReview(reviewer.reviewer, reviewSpec(h.sha.base!, h.sha.A!), h.checkout);

    expect(reviewer.requests[0]?.diff.includes(' const cfg = JSON.parse(text);'), 'line 4 is a context line of the diff the reviewer read').toBe(true);
    expect(result.sendBack, `${CONFIG}:4, a context line, is sent back: ${shown(result)}`).toBeNull();
    expect(result.outcome, shown(result)).not.toBe('failed');
    expect(result.followUps.some((f) => f.file === CONFIG && f.line === 4 && f.rule === 'unchecked-parse'), `a follow-up at ${CONFIG}:4: ${shown(result)}`).toBe(true);
    expect(result.verdictLine, shown(result)).toContain('pre-existing');
    expect(result.verdictLine, shown(result)).toContain(`${CONFIG}:4`);
  }, 60_000);
});
