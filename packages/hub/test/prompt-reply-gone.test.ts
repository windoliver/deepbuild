// #3305: what a prompt's reply carried from a session's continues and notices waits for its next prompt again when
// deep-hook never read that reply, whether the hub hears so after the reply was built or while it was being built.
// The acceptance suite (tests/acceptance/3305) proves the first order end to end; no seam holds a reply's build past
// deep-hook's hold, so the second order is proven here on the delivery itself.
import { expect, it } from 'vitest';
import { AnswerDelivery, type AnswerDeliveryOptions } from '../src/answer-delivery.js';

function delivery() {
  const clock = { now: Date.UTC(2026, 10, 23, 12) };
  const d = new AnswerDelivery({ services: { now: () => clock.now } } as unknown as AnswerDeliveryOptions);
  return { d, clock };
}

it('#3305 a reply reported gone after it was built gives its continues and notices back, ahead of newer ones, once', () => {
  const { d } = delivery();
  d.inPromptReply('hook-1', 's1', ['continue A'], ['notice A'], false);
  const r = d.routesOf('s1');
  expect(r.later, 'a reply not reported gone gives nothing back').toEqual([]);
  r.later.push('continue B');
  d.notice('s1', '', 'notice B');
  d.promptReplyGone('hook-1');
  expect(r.later).toEqual(['continue A', 'continue B']);
  expect(r.notices).toEqual(['notice A', 'notice B']);
  d.promptReplyGone('hook-1');
  expect(r.later, 'a second report of the same hook gives nothing back again').toEqual(['continue A', 'continue B']);
  expect(r.notices).toEqual(['notice A', 'notice B']);
});

it('#3305 a reply its hook was reported gone for while it was built gives its continues and notices back at once', () => {
  const { d } = delivery();
  d.inPromptReply('hook-1', 's1', ['continue A'], ['notice A'], true);
  const r = d.routesOf('s1');
  expect(r.later).toEqual(['continue A']);
  expect(r.notices).toEqual(['notice A']);
  d.promptReplyGone('hook-1');
  expect(r.later, 'given back once').toEqual(['continue A']);
});

it('#3305 a reply is kept for 60 s: a hook reported gone later than that gives nothing back', () => {
  const { d, clock } = delivery();
  d.inPromptReply('hook-1', 's1', ['continue A'], [], false);
  clock.now += 60_001;
  d.inPromptReply('hook-2', 's1', [], [], false);
  d.promptReplyGone('hook-1');
  expect(d.routesOf('s1').later).toEqual([]);
});
