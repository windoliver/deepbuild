// A review holds a change to the rubric's rules; a rubric page with no rule holds it to nothing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { review } from '../src/review.js';
import type { ReviewSpec } from '../src/types.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

it('a rubric page with no readable rule ran nothing, never a pass (AGENTS.md invariant 2)', async () => {
  const checkout = mkdtempSync(join(tmpdir(), 'deep-review-'));
  try {
    // Rules written as prose and with a space in the name: none reads as `- <rule>: <text>`.
    writeFileSync(join(checkout, 'rubric.md'), '# Rubric\n\nBe careful.\n\n- Swallowed errors: a catch block that drops the error\n');
    // A repository to diff in; git knows the empty tree in any.
    execFileSync('git', ['init', '-q', checkout]);
    const spec = { kind: 'review', runner: 'second-model', oracle: 'model', base: EMPTY_TREE, head: EMPTY_TREE, rubric: 'rubric.md', since: null } as ReviewSpec;
    const result = await review(spec, { checkout, deadline: 5_000, now: Date.now }, () => ({ findings: [] }));
    expect([result.outcome, result.testsRun]).toEqual(['ran_nothing', 0]);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
