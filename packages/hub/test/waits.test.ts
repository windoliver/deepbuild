// The waits: expected times from kind and history, overruns, the in-call line, the deadline rewrite and the
// ten-minute line (#120), driven with a hand-held clock.
import { describe, expect, it } from 'vitest';
import { ANNOUNCE_MS, History, KIND_EXPECTED_MS, LINE_EVERY_MS, Waits, historyKey, neverEnds, span, type HookSeen } from '../src/waits.js';

const T0 = 1_760_000_000_000;
const S = 'sess-1';
const seen = (event: string, extra: Partial<HookSeen> = {}): HookSeen => ({ event, session: S, agent: 'claude-code', cwd: '/work', ...extra });
const shell = (id: string, command: string, mode = 'default', extra: Partial<NonNullable<HookSeen['call']>> = {}) =>
  ({ id, kind: 'shell', tool: 'Bash', command, input: { command }, mode, ...extra });
/** The waits, with a turn begun in the session: calls outside a turn the hub saw begin are no waits. */
const waits = (plant?: string, prompt = 'do the work') => {
  const w = new Waits({ rewrites: (agent) => agent === 'claude-code', ...(plant ? { plant } : {}) });
  w.hook(seen('UserPromptSubmit', { prompt }), T0 - 1);
  return w;
};

describe('expected times', () => {
  it('come from the kind with no history, and from the median of the command\'s past runs with it', () => {
    const h = new History();
    expect(h.expected(historyKey('shell', 'npm test', 'Bash'), 'shell')).toBe(KIND_EXPECTED_MS.shell);
    for (const ms of [30_000, 90_000, 400_000]) h.add(historyKey('shell', 'npm test', 'Bash'), ms);
    expect(h.expected(historyKey('shell', 'npm   test', 'Bash'), 'shell')).toBe(90_000);
    expect(h.expected(historyKey('read', null, 'Read'), 'read')).toBe(KIND_EXPECTED_MS.read);
    // The commands remembered are capped; the one least used for longest goes first.
    for (let i = 0; i < 2000; i++) h.add(historyKey('shell', `cmd ${i}`, 'Bash'), 5000);
    expect(h.expected(historyKey('shell', 'npm test', 'Bash'), 'shell')).toBe(KIND_EXPECTED_MS.shell);
    expect(h.expected(historyKey('shell', 'cmd 1999', 'Bash'), 'shell')).toBe(5000);
  });
  it('know a command that never ends on its own', () => {
    for (const c of ['tail -f /var/log/x', 'kubectl logs -f pod', 'npm run dev', 'cd app && tail -F log | grep x', 'ping example.com', 'vitest --watch', 'sleep infinity']) expect(neverEnds(c), c).toBe(true);
    for (const c of ['ls -la', 'tail -n 5 file', 'vitest run', 'ping -c 3 example.com', 'npm test', 'git log -5', 'find . -name x']) expect(neverEnds(c), c).toBe(false);
  });
  it('say a span in words', () => {
    expect(span(40_000)).toBe('40 s');
    expect(span(3 * 60_000)).toBe('3 min');
    expect(span(80 * 60_000)).toBe('1 h 20 min');
  });
});

describe('an overrun', () => {
  it('is due at the expected time, shows one line while the call runs, and tells the agent at the call\'s next hook', () => {
    const w = waits();
    expect(w.hook(seen('UserPromptSubmit', { prompt: 'run the suite' }), T0)).toEqual({});
    expect(w.hook(seen('PreToolUse', { call: shell('c1', 'npm test') }), T0 + 1000)).toEqual({});
    expect(w.nextDue()).toBe(T0 + 1000 + KIND_EXPECTED_MS.shell!);
    expect(w.due(T0 + 1000 + KIND_EXPECTED_MS.shell! - 1)).toEqual([]);
    const due = w.due(T0 + 1000 + KIND_EXPECTED_MS.shell!);
    expect(due).toHaveLength(1);
    expect(due[0]!.kind).toBe('overrun');
    expect(due[0]!.line).toContain('still waiting on `npm test`');
    expect(due[0]!.line).toContain('1 min so far');
    // The in-call route reads the line once.
    expect(w.fileChanged(S, T0 + 62_000)).toEqual({ message: due[0]!.line });
    expect(w.fileChanged(S, T0 + 63_000)).toEqual({});
    const after = w.hook(seen('PostToolUse', { call: shell('c1', 'npm test') }), T0 + 1000 + 150_000);
    expect(after.message).toContain('`npm test` ran 3 min, about 1 min was expected');
    expect(after.context).toContain('read what it did before retrying');
    expect(w.nextDue()).toBeNull();
    // The run taught the next call its time.
    expect(w.history.expected(historyKey('shell', 'npm test', 'Bash'), 'shell')).toBe(150_000);
  });
  it('is not recorded for a call that ends in time, and a failed call teaches nothing', () => {
    const w = waits();
    w.hook(seen('PreToolUse', { call: shell('c1', 'npm test') }), T0);
    expect(w.hook(seen('PostToolUseFailure', { call: shell('c1', 'npm test', 'default', { failed: true }) }), T0 + 5000)).toEqual({});
    expect(w.history.expected(historyKey('shell', 'npm test', 'Bash'), 'shell')).toBe(KIND_EXPECTED_MS.shell);
  });
});

describe('a deadline', () => {
  it('is attached to a command that never ends, only where the adapter rewrites and the session bypasses approvals, with no decision', () => {
    const w = waits();
    const bypass = w.hook(seen('PreToolUse', { call: shell('c1', 'tail -f app.log', 'bypassPermissions') }), T0);
    expect(bypass.updatedInput).toEqual({ command: ": 'DeepBuild: ends after 1 min'; tail -f app.log", timeout: KIND_EXPECTED_MS.shell });
    expect(Object.keys(bypass)).not.toContain('permissionDecision');
    const deadlineOf = (x: Waits, at: number) => x.due(at).map((d) => (d.kind === 'overrun' ? d.call.deadline : d.kind));
    expect(deadlineOf(w, T0 + KIND_EXPECTED_MS.shell!)).toEqual(['attached']);
    w.hook(seen('PostToolUse', { call: shell('c1', 'tail -f app.log') }), T0 + 1);
    const asked = w.hook(seen('PreToolUse', { call: shell('c2', 'tail -f app.log', 'default') }), T0 + 2);
    expect(asked.updatedInput).toBeUndefined();
    expect(deadlineOf(w, T0 + 2 + KIND_EXPECTED_MS.shell!)).toEqual(['recorded']);
    const codex = waits();
    const c = codex.hook(seen('PreToolUse', { agent: 'codex', call: shell('c3', 'tail -f app.log', 'bypassPermissions') }), T0);
    expect(c.updatedInput).toBeUndefined();
    expect(deadlineOf(codex, T0 + KIND_EXPECTED_MS.shell!)).toEqual(['recorded']);
  });
});

describe('the lines', () => {
  it('announce a wait expected to take over a minute when it starts', () => {
    const w = waits();
    w.history.add(historyKey('shell', 'cargo build', 'Bash'), ANNOUNCE_MS + 30_000);
    const start = w.hook(seen('PreToolUse', { call: shell('c1', 'cargo build') }), T0);
    expect(start.message).toBe('DeepBuild: waiting on `cargo build` · about 2 min expected');
    const w2 = waits();
    expect(w2.hook(seen('PreToolUse', { call: shell('c1', 'ls') }), T0)).toEqual({});
  });
  it('follow no call outside a turn the hub saw begin, and at most 256 calls of one turn at once', () => {
    const w = new Waits({ rewrites: () => true });
    expect(w.hook(seen('PreToolUse', { call: shell('c0', 'npm test') }), T0)).toEqual({});
    expect(w.nextDue()).toBeNull();
    const turn = waits();
    for (let i = 0; i < 300; i++) turn.hook(seen('PreToolUse', { call: { id: `r${i}`, kind: 'read', tool: 'Read', command: null, input: {}, mode: 'default' } }), T0);
    expect(turn.due(T0 + KIND_EXPECTED_MS.read!)).toHaveLength(256);
  });
  it('rewrite the command the agent typed, not the record\'s redacted copy; cap the timeout; follow no background call', () => {
    const w = waits();
    const typed = 'curl -H "Authorization: Bearer sk-live-123" https://x | tail -f -';
    const r = w.hook(seen('PreToolUse', { call: { id: 'c1', kind: 'shell', tool: 'Bash', command: typed.replace('sk-live-123', '[redacted]'), input: { command: typed }, mode: 'bypassPermissions' } }), T0);
    expect(r.updatedInput?.command).toBe(`: 'DeepBuild: ends after 1 min'; ${typed}`);
    w.history.add(historyKey('shell', 'tail -f big.log', 'Bash'), 2 * 3_600_000);
    const long = w.hook(seen('PreToolUse', { call: shell('c2', 'tail -f big.log', 'bypassPermissions') }), T0);
    expect(long.updatedInput?.timeout).toBe(600_000);
    const bg = w.hook(seen('PreToolUse', { call: shell('c3', 'npm run dev', 'bypassPermissions', { input: { command: 'npm run dev', run_in_background: true } }) }), T0);
    expect(bg).toEqual({});
    w.hook(seen('PostToolUse', { call: shell('c3', 'npm run dev', 'bypassPermissions', { input: { command: 'npm run dev', run_in_background: true } }) }), T0 + 5);
    expect(w.history.expected(historyKey('shell', 'npm run dev', 'Bash'), 'shell')).toBe(KIND_EXPECTED_MS.shell);
  });
  it('drop a call blocked or denied before it ran, and every call of a turn at its stop or at the next prompt', () => {
    const w = waits();
    w.hook(seen('PreToolUse', { call: shell('c1', 'npm test') }), T0);
    w.drop(S, 'c1');
    expect(w.nextDue()).toBeNull();
    w.hook(seen('PreToolUse', { call: shell('c2', 'npm test') }), T0);
    w.hook(seen('Stop'), T0 + 1);
    expect(w.nextDue()).toBeNull();
    w.hook(seen('PreToolUse', { call: shell('c3', 'npm test') }), T0 + 2);
    w.hook(seen('UserPromptSubmit', { prompt: 'next' }), T0 + 3);
    expect(w.nextDue()).toBeNull();
  });
  it('give a turn ten minutes without a readable line one at its next hook, naming the ask, the step, the time so far and the time left', () => {
    const w = waits();
    w.hook(seen('UserPromptSubmit', { prompt: 'fix the flaky test in auth' }), T0);
    let t = T0;
    for (let i = 0; i < 20; i++) {
      t += 25_000;
      expect(w.hook(seen('PreToolUse', { call: shell(`c${i}`, `echo ${i}`) }), t)).toEqual({});
      t += 1000;
      expect(w.hook(seen('PostToolUse', { call: shell(`c${i}`, `echo ${i}`) }), t)).toEqual({});
    }
    const at = T0 + LINE_EVERY_MS + 5000;
    const line = w.hook(seen('PreToolUse', { call: shell('c99', 'npm test') }), at);
    expect(line.message).toBe('DeepBuild: fix the flaky test in auth · waiting on `npm test` · 10 min so far · about 1 min left');
    // The next comes ten minutes after that one, not before.
    expect(w.hook(seen('PostToolUse', { call: shell('c99', 'npm test') }), at + 2000)).toEqual({});
    w.hook(seen('PreToolUse', { call: shell('c100', 'sleep 1000') }), at + 3000);
    expect(w.due(at + LINE_EVERY_MS - 1)).toHaveLength(1);
  });
  it('come every ten minutes while a single call still runs, through the in-call route', () => {
    const w = waits();
    w.hook(seen('UserPromptSubmit', { prompt: 'build it' }), T0);
    w.history.add(historyKey('shell', 'make', 'Bash'), 60 * 60_000);
    w.hook(seen('PreToolUse', { call: shell('c1', 'make') }), T0);
    expect(w.nextDue()).toBe(T0 + LINE_EVERY_MS);
    const first = w.due(T0 + LINE_EVERY_MS);
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe('progress');
    expect(first[0]!.line).toBe('DeepBuild: build it · waiting on `make` · 10 min so far · about 50 min left');
    expect(w.due(T0 + LINE_EVERY_MS + 1000)).toEqual([]);
    expect(w.due(T0 + 2 * LINE_EVERY_MS)).toHaveLength(1);
  });
  it('wait for the stop under the planted wrong program, so a long turn shows none', () => {
    const w = waits('line-at-stop');
    w.hook(seen('UserPromptSubmit', { prompt: 'go' }), T0);
    w.hook(seen('PreToolUse', { call: shell('c1', 'npm test') }), T0);
    expect(w.due(T0 + 2 * KIND_EXPECTED_MS.shell!)).toEqual([]);
    expect(w.hook(seen('PreToolUse', { call: shell('c2', 'npm test') }), T0 + 3 * LINE_EVERY_MS)).toEqual({});
  });
});
