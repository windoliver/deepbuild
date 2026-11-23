// The wiki's passes page as the hub reads it (#2748): each pass with its ID, name, prompt, scope and the PRs and bug
// sites behind it. A wrong reading runs a pass with another prompt, on diffs outside its scope, or with no replay.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PostClosePass } from '@deepbuild/checks-review';
import { passesOf } from '../src/review-passes.js';

const page = (passes: readonly PostClosePass[]): string => `# Review passes\n\nKept by you.\n\n${passes.map((p) => [
  `## ${p.id}: ${p.name}`, '',
  `- prompt: ${p.prompt}`,
  ...(p.scope ? [`- scope: ${p.scope.join(', ')}`] : []),
  ...p.found.map((f) => `- found: PR ${f.pr}, ${f.base}..${f.head}: ${f.bugs.map((b) => `${b.file}:${b.line}`).join(', ')}`),
].join('\n')).join('\n\n')}\n`;

const text = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,'()-]{0,40}[A-Za-z0-9.]$/);
const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
const path = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}(\/[a-z][a-z0-9_.]{0,8}){0,3}$/);
const pass: fc.Arbitrary<PostClosePass> = fc.record({
  id: fc.stringMatching(/^[a-z][a-z0-9.-]{0,10}$/), name: text, prompt: text,
  scope: fc.option(fc.array(fc.stringMatching(/^[a-z]{1,6}\/\*\*(\/\*\.[a-z]{1,3})?$/), { minLength: 1, maxLength: 3 }), { nil: undefined }),
  found: fc.array(fc.record({ pr: fc.integer({ min: 1, max: 99999 }), base: sha, head: sha, bugs: fc.array(fc.record({ file: path, line: fc.integer({ min: 1, max: 99999 }) }), { minLength: 1, maxLength: 3 }) }), { maxLength: 3 }),
}).map(({ scope, ...p }) => (scope ? { ...p, scope } : p));

describe('the passes page', () => {
  it('reads back every pass it holds: ID, name, prompt, scope, and each PR with its commits and bug sites', () => {
    fc.assert(fc.property(fc.array(pass, { maxLength: 4 }), (passes) => { expect(passesOf(page(passes))).toEqual(passes); }));
  });

  it('leaves out a pass with no prompt, a PR whose commits are not full SHAs, and list items under no pass', () => {
    const read = passesOf([
      '# Review passes', '- prompt: under no pass', '## silent: asks nothing', '- scope: src/**',
      '## audit: a code audit', '- prompt: Audit the change.', `- found: PR 12, abc123..def456: src/a.ts:2`, `- found: PR 17, ${'1'.repeat(40)}..${'2'.repeat(40)}: src/b.ts:3`,
      '## Notes', '- prompt: prose, under a heading that opens no pass',
    ].join('\n'));
    expect(read).toEqual([{ id: 'audit', name: 'a code audit', prompt: 'Audit the change.', found: [{ pr: 17, base: '1'.repeat(40), head: '2'.repeat(40), bugs: [{ file: 'src/b.ts', line: 3 }] }] }]);
  });
});
