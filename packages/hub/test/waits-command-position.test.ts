import { expect, it } from 'vitest';
import { neverEnds } from '../src/waits.js';

it('does not mistake logical OR for a pipe supplying cat with finite input', () => {
  expect(neverEnds('false || cat')).toBe(true);
});
