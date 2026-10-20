// Regressions for event kinds whose schemas read the design looser, or other, than it says.
import { describe, expect, it } from 'vitest';
import { fixtures, validate } from '../src/index.js';

type Event = Record<string, unknown> & { data: Record<string, unknown> };
const first = (name: string): Event => structuredClone(fixtures(name)[0]) as Event;
const ok = (name: string, event: unknown) => validate(name, event).ok;

describe('the design says', () => {
  it('only the core appends the kinds that record a decision', () => {
    for (const kind of ['verdict.made', 'verdict.stale', 'definition.locked', 'definition.revised', 'decision.created', 'decision.applied', 'ask.answered', 'ask.defaulted']) {
      const name = `${kind}@1`;
      expect(ok(name, first(name)), kind).toBe(true);
      for (const writer of ['hook', 'app', 'ext:planted']) expect(ok(name, { ...first(name), writer }), `${kind} by ${writer}`).toBe(false);
    }
  });

  it('an unblock adds its steps, where, why, unblocks and proves, and no other ask has them', () => {
    const asks = fixtures('ask.created@1') as Event[];
    const unblock = asks.find((a) => a.data.kind === 'unblock')!;
    const other = asks.find((a) => a.data.kind !== 'unblock')!;
    expect(ok('ask.created@1', unblock)).toBe(true);
    const { steps: _steps, ...withoutSteps } = unblock.data;
    expect(ok('ask.created@1', { ...unblock, data: withoutSteps })).toBe(false);
    expect(ok('ask.created@1', { ...other, data: { ...other.data, steps: ['x'] } })).toBe(false);
  });

  it('an ask is pinned to a commit, or an evidence hash, in its form', () => {
    const ask = first('ask.created@1');
    expect(ok('ask.created@1', { ...ask, data: { ...ask.data, pinned_to: { kind: 'commit', ref: 'x' } } })).toBe(false);
    expect(ok('ask.created@1', { ...ask, data: { ...ask.data, pinned_to: { kind: 'evidence', ref: 'not-a-hash' } } })).toBe(false);
  });

  it('an event whose data names no ask, task or session says which one in its subject', () => {
    for (const kind of ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.later', 'task.closed', 'agent.stop', 'session.attention']) {
      const name = `${kind}@1`;
      const { subject: _subject, ...without } = first(name);
      expect(ok(name, first(name)), kind).toBe(true);
      expect(ok(name, without), `${kind} without subject`).toBe(false);
    }
  });

  it("a learned change's layer, scope and replay take the design's example", () => {
    const learn = first('learn.proposed@1');
    const example = { ...learn.data, layer: 'learned', scope: 'session:01J9ABC', replay: { tasks: 20, regressions: 0 }, applied_by: 'you' };
    expect(ok('learn.proposed@1', { ...learn, data: example })).toBe(true);
    expect(ok('learn.proposed@1', { ...learn, data: { ...example, layer: 'rules' } })).toBe(false);
    expect(ok('learn.proposed@1', { ...learn, data: { ...example, applied_by: 'agent' } })).toBe(false);
  });

  it('a lease names its resource by host, kind and key', () => {
    const lease = first('lease.acquired@1');
    expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, resource: { host: 'local', kind: 'port', key: '4317' } } })).toBe(true);
    expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, resource: 'port:4317' } })).toBe(false);
  });

  it("a task's task_ref may be the message that asked for it", () => {
    const task = first('task.created@1');
    expect(ok('task.created@1', { ...task, data: { ...task.data, task_ref: 'session:01K74G1Z3X5V7T9R1P3N5M7K9H#msg3' } })).toBe(true);
  });

  it("evidence carries its source and origin, and a verdict its reasons", () => {
    const evidence = first('evidence.put@1');
    expect(evidence.data.origin).toBeDefined();
    expect(ok('evidence.put@1', { ...evidence, data: { ...evidence.data, origin: 'model' } })).toBe(false);
    const { reasons: _reasons, ...noReasons } = first('verdict.made@1').data;
    expect(ok('verdict.made@1', first('verdict.made@1'))).toBe(true);
    expect(ok('verdict.made@1', { ...first('verdict.made@1'), data: noReasons })).toBe(false);
  });

  it('a time in flicks fits an i64', () => {
    const note = first('note.opened@1');
    for (const t of ['9223372036854775807', '-9223372036854775807']) expect(ok('note.opened@1', { ...note, data: { ...note.data, t } }), t).toBe(true);
    for (const t of ['9223372036854775808', '9999999999999999999', '-9999999999999999999']) expect(ok('note.opened@1', { ...note, data: { ...note.data, t } }), t).toBe(false);
  });
});
