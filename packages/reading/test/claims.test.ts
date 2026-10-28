// An install's claim id names its text: the same finding again is the same claim, and two different findings never
// share an id, whichever run wrote each, so a later install never replaces a claim it didn't restate.
import { expect, test } from 'vitest';
import { claimId } from '../src/claims.ts';

test('different texts get different ids, even sharing their first 40 characters or with no Latin letters', () => {
  const ids = ['Before you push, run npm run lint and npm test', 'Before you push, run npm run lint and npm run typecheck', '推送前先运行测试', '部署前先检查配置', 'Το api ξεκινά στη θύρα 3000'].map(claimId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
});

test('the same text, up to whitespace, gets the same id', () => {
  expect(claimId('api  starts on\nport 3000')).toBe(claimId('api starts on port 3000'));
});
