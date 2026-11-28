import { join } from 'node:path';
import { REPO, waitUntil, press, type Obj } from '../1427/helpers.ts';

export * from '../1427/helpers.ts';

export const HERE = join(REPO, 'tests', 'acceptance', '1427-redraft-panel');
export const LAB = join(HERE, 'fixtures', 'panels', 'motion-lab');

export const launchLab = (extra: Obj = {}): Obj => ({ call: 'launch', launch: { from: 'empty', panel: LAB, size: [640, 600], scale: 2, clock: 'virtual', ...extra } });
export const journey = (name: string, extra: Obj = {}): Obj[] => [
  launchLab(extra),
  press(name),
  waitUntil(6),
  { call: 'expect', locator: { role: 'button', name }, expect: { name: `${name} is there`, assert: 'visible' } },
];
