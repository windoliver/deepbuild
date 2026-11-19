// #1415 AC4 on the state table's crate, deep-show (the canvas core's binary crate, outside the canvas lint's scope; README: The
// planted call): with the planted call that leaves one state undecided the crate doesn't compile, and with its twin that decides
// every state it does.

import { describe, expect, it } from 'vitest';
import { cargo } from './helpers.ts';

/** The planted call with no decision for `hidden`, and its twin that decides all six states (README: The planted call). */
const UNDECIDED = 'test-session-call-undecided';
const DECIDED = 'test-session-call-decided';
const check = (feature: string) => cargo(['check', '--locked', '-p', 'deep-show', '--bin', 'deep-show', '--features', feature, '--message-format', 'short']);
const cut = (text: string): string => (text.length > 4000 ? `…${text.slice(-4000)}` : text);

describe('#1415: the state table decides every cell', () => {
  // AC4: "A planted call added with no decision for one state fails to compile"
  it('AC4 deep-show with the planted call undecided for Hidden fails to compile with E0004 naming Hidden; its twin that decides every state compiles', () => {
    const undecided = check(UNDECIDED);
    const e0004 = undecided.stderr.split('\n').filter((l) => l.includes('E0004'));
    expect(undecided.status, `cargo check -p deep-show --features ${UNDECIDED} must fail to compile; it exited ${undecided.status}:\n${cut(undecided.stderr)}`).not.toBe(0);
    expect(e0004.length, `cargo check -p deep-show --features ${UNDECIDED} fails with error[E0004] (the table's match is no longer exhaustive), not for another reason:\n${cut(undecided.stderr)}`).toBeGreaterThan(0);
    expect(e0004.some((l) => /\bHidden\b/.test(l)), `the E0004 error names Hidden, the state the planted call leaves undecided: ${e0004.join('\n')}`).toBe(true);
    // The twin: the same planted call with a decision for every state compiles, so the error above is the missing cell alone.
    const decided = check(DECIDED);
    expect(decided.status, `cargo check -p deep-show --features ${DECIDED} (the planted call decided for every state) compiles:\n${cut(decided.stderr)}`).toBe(0);
  }, 3_600_000);
});
