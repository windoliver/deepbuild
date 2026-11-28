import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { storeOf as original } from '../2495-redraft-3245/helpers.ts';

export * from '../2495-redraft-3245/helpers.ts';
export async function storeOf(hubRoot: string): ReturnType<typeof original> {
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  return original(hubRoot);
}
