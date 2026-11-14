import { expect, it } from 'vitest';
import { forbiddenLicense } from '../src/packs.js';

it('#1820 GPL and noncommercial license spellings remain forbidden, not unknown permissive IDs', () => {
  for (const text of ['GPLv3', 'GPL3', 'AGPLv3', 'LGPL-2.1-only', 'GNU General Public License']) expect(forbiddenLicense(text), text).toBe('GPL');
  expect(forbiddenLicense('CC-BY-NC-4.0')).toBe('NC');
  expect(forbiddenLicense('Creative Commons Attribution-ShareAlike')).toBe('CC BY-SA');
  for (const text of ['CC0-1.0', 'Creative Commons Attribution 4.0 International', 'MIT']) expect(forbiddenLicense(text), text).toBeUndefined();
});
